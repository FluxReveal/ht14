/*
 * Badehusappen – brukergrensesnitt (prøveversjon)
 * ---------------------------------------------------------------
 * Viser kalender, booking, innsjekk, Mine bookinger og statistikk.
 * All data hentes og lagres via Store (js/store.js). Reglene sjekkes
 * med RulesEngine (js/rules-engine.js) for rask tilbakemelding, og
 * Store sjekker dem på nytt før noe lagres – slik Workeren skal gjøre.
 */
(function () {
  "use strict";
  const R = window.RulesEngine, S = window.Store;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HOUSES = ["A", "B", "C", "D"];
  const HOUSE_KEY = "ht14-badehusappen-hus", MODE_KEY = "ht14-badehusappen-visning", HINT_KEY = "ht14-badehusappen-har-booket";
  // Fylles fra rules.json i init(): AM = formiddag 10–14, MID = ettermiddag 14–17, PM = kveld 17–24
  let PLABEL = {}, PTIME = {}, PKEYS = [], FULLDAY = [];
  const hh = t => t === "24:00" ? "24" : t.slice(0, 2).replace(/^0/, "");
  /** «heldag» / «formiddag og kveld» */
  const periodsText = ps => FULLDAY.every(p => ps.includes(p)) ? "heldag"
    : (a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " og " + a[a.length - 1])(ps.map(p => PLABEL[p].toLowerCase()));
  const periodsTime = ps => `${hh(rules.periods[ps[0]].start)}–${hh(rules.periods[ps[ps.length - 1]].end)}`;
  const STATUS = { BOOKED: "Booket", CHECKED_IN: "Sjekket inn", COMPLETED: "Brukt", NOT_CONFIRMED: "Ikke bekreftet",
    CANCELLED: "Avbestilt", CANCELLED_LATE: "Sent avbestilt" };
  const WD_SHORT = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
  const MON_SHORT = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

  let rules, mode = localStorage.getItem(MODE_KEY) || "week", anchor, view = "kalender", statAnchor;
  let myHouse = localStorage.getItem(HOUSE_KEY) || null;

  /* ---------- Testklokke: ?tid=2027-07-05T10:00 (kun for prøving) ---------- */
  const tidParam = new URLSearchParams(location.search).get("tid");
  if (tidParam && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(tidParam)) {
    const [d, t] = tidParam.split("T"), [h, m] = t.split(":").map(Number);
    S.setClock(() => ({ date: d, minutes: h * 60 + m }));
    $("#clockNote").textContent = `(Testklokke: ${R.dateLabel(d)} ${d.slice(0, 4)} kl. ${t})`;
  }

  /* ---------- Små hjelpere ---------- */
  const now = () => S.now();
  const d2 = s => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
  const shortDate = s => { const p = d2(s); return `${p.d}. ${MON_SHORT[p.m - 1]}`; };
  function isoWeek(s) {
    const p = d2(s), t = new Date(Date.UTC(p.y, p.m - 1, p.d)), day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  function toast(text) {
    const t = $("#toast"); t.textContent = text; t.classList.add("show");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 3200);
  }
  const houseChip = h => `<span class="chip h${h}">Hus ${h}</span>`;
  function setMyHouse(h) {
    myHouse = h; localStorage.setItem(HOUSE_KEY, h);
    $("#myHouseLabel").textContent = "Hus " + h;
  }
  async function allBookings() { return S.history({}); }
  function activeOn(list, date) { return list.filter(b => b.date === date && R.isActive(b.displayStatus)); }
  const lastBookable = () => R.addMonths(now().date, rules.bookingWindow.months);

  /* ---------- Kalender ---------- */
  async function renderCalendar() {
    const n = now();
    if (mode === "week") {
      const from = R.mondayOf(anchor), to = R.addDays(from, 6);
      $("#calTitle").textContent = `Uke ${isoWeek(from)} · ${shortDate(from)} – ${shortDate(to)}`;
      const list = await S.calendar({ from, to });
      let html = '<ol class="week">';
      for (let i = 0; i < 7; i++) {
        const date = R.addDays(from, i), act = activeOn(list, date);
        const past = R.hasEnded(rules, date, PKEYS[PKEYS.length - 1], n);
        // Tre rader per dag: formiddag, ettermiddag, kveld
        const slot = (b, p) => {
          if (b) return `<span class="slot taken h${b.household}${b.displayStatus === "NOT_CONFIRMED" ? " nc" : ""}"><span class="t">${PTIME[p]}</span> <span>Hus ${b.household}${b.displayStatus !== "BOOKED" ? " · " + STATUS[b.displayStatus].toLowerCase() : ""}</span></span>`;
          const open = !R.hasStarted(rules, date, p, n);
          const now = !open && !R.hasEnded(rules, date, p, n);
          return `<span class="slot${open ? " free" : ""}" ${open ? `data-period="${p}"` : ""}><span class="t">${PTIME[p]}</span> <span>${open ? "Ledig" : now ? "Ledig nå" : "–"}</span></span>`;
        };
        const slots = PKEYS.map(p => slot(act.find(b => b.period === p), p)).join("");
        const aria = PKEYS.map(p => { const b = act.find(x => x.period === p); return `${PLABEL[p].toLowerCase()} ${PTIME[p]} ${b ? "Hus " + b.household : "ledig"}`; }).join(", ");
        html += `<li><button type="button" class="day${date === n.date ? " today" : ""}${past ? " past" : ""}" data-date="${date}" aria-label="${esc(R.dateLabel(date))}${date === n.date ? " (i dag)" : ""}: ${esc(aria)}">
          <span class="dnum"><small>${WD_SHORT[i]}</small><b>${d2(date).d}</b></span><span class="slots">${slots}</span></button></li>`;
      }
      $("#calendar").innerHTML = html + "</ol>";
    } else {
      const p = d2(anchor), first = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
      const last = R.addDays(R.addMonths(first, 1), -1);
      const from = R.mondayOf(first), to = R.addDays(R.mondayOf(last), 6);
      $("#calTitle").textContent = `${R.MONTHS[p.m - 1].replace(/^./, c => c.toUpperCase())} ${p.y}`;
      const list = await S.calendar({ from, to });
      let html = '<div class="month">' + WD_SHORT.map(w => `<div class="wd" aria-hidden="true">${w}</div>`).join("");
      for (let date = from; date <= to; date = R.addDays(date, 1)) {
        const act = activeOn(list, date), per = PKEYS.map(p => act.find(b => b.period === p));
        const past = R.hasEnded(rules, date, PKEYS[PKEYS.length - 1], now());
        const aria = `${R.dateLabel(date)}: ` + PKEYS.map((p, k) => `${PLABEL[p].toLowerCase()} ${per[k] ? "Hus " + per[k].household : "ledig"}`).join(", ");
        // én stripe per periode; «Hus A» skrives bare der et nytt hus starter
        const halves = per.map((b, k) => `<span class="half${b ? " taken h" + b.household : ""}">${b && (!k || !per[k - 1] || per[k - 1].household !== b.household) ? `<i aria-hidden="true">Hus ${b.household}</i>` : ""}</span>`).join("");
        html += `<button type="button" class="mcell${date.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${date === now().date ? " today" : ""}${past ? " past" : ""}${per[0] ? " has" : ""}" data-date="${date}" aria-label="${esc(aria)}">
          <span class="n">${d2(date).d}</span>${halves}</button>`;
      }
      $("#calendar").innerHTML = html + "</div>";
    }
    $("#modeWeek").setAttribute("aria-pressed", mode === "week");
    $("#modeMonth").setAttribute("aria-pressed", mode === "month");
    $("#calendar").querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", e => {
      const slot = e.target.closest("[data-period]");
      openDay(b.dataset.date, slot ? slot.dataset.period : null);
    }));
    $("#hint").hidden = mode !== "week" || !!localStorage.getItem(HINT_KEY);
  }

  /* ---------- Ark: én dag ---------- */
  const sheet = $("#sheet");
  let fallbackBackdrop = null;
  /** Åpner arket. footHtml = fast nederste felt (f.eks. «Book»-knappen). */
  function openSheet(title, html, footHtml) {
    $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = html;
    const foot = $("#sheetFoot");
    foot.innerHTML = footHtml || ""; foot.hidden = !footHtml; sheet.classList.toggle("nofoot", !footHtml);
    $("#sheetBody").scrollTop = 0;
    document.documentElement.classList.add("sheet-open");
    if (sheet.open) return;
    if (typeof sheet.showModal === "function") sheet.showModal();
    else {                                    // eldre Safari uten <dialog>
      sheet.setAttribute("open", "");
      fallbackBackdrop = document.createElement("div");
      fallbackBackdrop.className = "sheet-fallback-backdrop";
      fallbackBackdrop.addEventListener("click", closeSheet);
      document.body.appendChild(fallbackBackdrop);
    }
  }
  function closeSheet() {
    document.documentElement.classList.remove("sheet-open");
    if (fallbackBackdrop) { fallbackBackdrop.remove(); fallbackBackdrop = null; }
    if (typeof sheet.close === "function" && sheet.open) sheet.close();
    else sheet.removeAttribute("open");
  }
  sheet.addEventListener("close", () => document.documentElement.classList.remove("sheet-open"));

  function bookingItem(b, n) {
    const mine = b.household === myHouse;
    let acts = "";
    if (mine) {
      if (R.validateCheckin(b, myHouse, rules, n).ok) acts += `<button type="button" class="primary" data-act="checkin" data-id="${b.id}">Sjekk inn</button>`;
      if (b.displayStatus === "BOOKED") acts += `<button type="button" class="secondary" data-act="cancel" data-id="${b.id}">Avbestill</button>`;
      if (b.displayStatus === "NOT_CONFIRMED") acts += `<button type="button" class="primary" data-act="confirm" data-id="${b.id}">Vi brukte badehuset</button>`;
    }
    const extra = b.source === "CHECKIN" ? " · spontan" : "";
    return `<li class="pitem" id="item-${b.id}"><div class="row">${houseChip(b.household)} <span>${PLABEL[b.period]} ${PTIME[b.period]}</span><span class="stat">${STATUS[b.displayStatus]}${extra}</span></div>
      ${acts ? `<div class="acts">${acts}</div>` : ""}</li>`;
  }

  async function openDay(date, wanted) {
    const n = now(), all = await allBookings(), day = all.filter(b => b.date === date);
    const act = day.filter(b => R.isActive(b.displayStatus)), gone = day.filter(b => !R.isActive(b.displayStatus));
    // Hver periode: ledig? startet? (en periode kan bookes til den starter)
    const types = PKEYS.map(p => ({ p, free: !act.some(b => R.overlaps(rules, b.period, p)), started: R.hasStarted(rules, date, p, n), ended: R.hasEnded(rules, date, p, n) }));
    const can = types.filter(t => t.free && !t.started);
    const dayOver = R.hasEnded(rules, date, PKEYS[PKEYS.length - 1], n);
    const ongoingFree = types.find(t => t.free && t.started && !t.ended);
    const fullOk = can.length === PKEYS.length && R.canBookFullDay(rules, date, n);
    const title = R.dateLabel(date).replace(/^./, c => c.toUpperCase()) + (date === n.date ? " · i dag" : "");
    let html = "", foot = "";
    // 1) Kort beskjed rett under datoen
    if (dayOver) html += `<p class="lead">Denne dagen er over, så den kan ikke bookes. Trykk › i kalenderen for å se kommende uker.</p>`;
    else if (date > lastBookable()) html += `<div class="msg no">Denne datoen kan ikke bookes ennå. Du kan booke maks ${rules.bookingWindow.months} måneder frem – den åpner ${R.dateLabel(R.addMonths(date, -rules.bookingWindow.months))}.</div>`;
    else if (!can.length) html += `<p class="lead">${ongoingFree ? `Det er ingen flere perioder å booke i dag, men ${PLABEL[ongoingFree.p].toLowerCase()} er ledig nå – bruk «Sjekk inn nå».` : "Hele dagen er booket."}</p>`;
    else if (fullOk) html += `<p class="lead">Ledig hele dagen – velg hus og tid under.</p>`;
    else html += `<p class="lead">${cap(periodsText(can.map(t => t.p)))} er ledig – velg hus og tid under.</p>`;
    // 2) Bookingskjema: hus først, så perioder (kryss av én eller flere); «Book» står fast nederst
    if (!dayOver && date <= lastBookable() && can.length) {
      // Forhåndsvalg: perioden man trykket på, ellers heldag, ellers resten av dagen
      const sel = (wanted && can.some(t => t.p === wanted)) ? [wanted] : can.map(t => t.p);
      const fdTime = periodsTime(FULLDAY);
      html += `<h3 class="label">Hvilket hus?</h3><div class="pick" role="group" aria-label="Velg hus">${HOUSES.map(h =>
        `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>
        <h3 class="label" id="whenLbl">Når? <span class="muted">Velg én eller flere</span></h3>
        <div class="types" role="group" aria-labelledby="whenLbl">
        <button type="button" class="fullday" data-full aria-pressed="${fullOk && sel.length === PKEYS.length}" ${fullOk ? "" : "disabled"}><span>Heldag (vanligst)</span><span class="t">${fdTime}${fullOk ? "" : R.canBookFullDay(rules, date, n) ? " · noe er opptatt" : ` · bare før kl. ${hh(rules.periods[FULLDAY[0]].start)}`}</span></button>
        ${types.map(t => `<button type="button" role="checkbox" class="per" data-type="${t.p}" aria-checked="${sel.includes(t.p) && t.free && !t.started}" ${t.free && !t.started ? "" : "disabled"}><span><span class="box" aria-hidden="true"></span>${PLABEL[t.p]}</span><span class="t">${PTIME[t.p]}${!t.free ? " · opptatt" : t.ended ? " · over" : t.started ? " · har startet" : ""}</span></button>`).join("")}
        </div>
        <div id="ruleMsg" aria-live="polite"></div>`;
      foot = `<button type="button" class="primary wide" id="bookBtn">Book</button>`;
    }
    // 3) Det som allerede er booket denne dagen (hver periode kan avbestilles for seg)
    if (act.length) html += `<h3 class="label">Booket denne dagen</h3><ul class="plist">${act.sort(byPeriod).map(b => bookingItem(b, n)).join("")}</ul>`;
    if (gone.length) html += `<p class="muted">Avbestilt: ${gone.map(b => `Hus ${b.household} ${PLABEL[b.period].toLowerCase()} (${STATUS[b.status].toLowerCase()})`).join(", ")}</p>`;
    if (dayOver && !act.length && !gone.length) html += `<p class="muted">Ingen brukte badehuset denne dagen.</p>`;
    openSheet(title, html, foot);
    wireDay(date, all);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const byPeriod = (a, b) => PKEYS.indexOf(a.period) - PKEYS.indexOf(b.period);

  function wireDay(date, all) {
    const body = $("#sheetBody");
    let house = myHouse;
    const chosen = () => [...body.querySelectorAll('[data-type][aria-checked="true"]')].map(b => b.dataset.type);
    const syncFull = () => { const f = body.querySelector("[data-full]"); if (f && !f.disabled) f.setAttribute("aria-pressed", PKEYS.every(p => chosen().includes(p))); };
    const check = () => {
      const box = $("#ruleMsg"), btn = $("#bookBtn"); if (!box) return;
      const ps = chosen();
      if (!house) { box.innerHTML = `<div class="msg ok">Velg hvilket hus du booker for.</div>`; btn.disabled = true; btn.textContent = "Velg hus for å booke"; return; }
      if (!ps.length) { box.innerHTML = ""; btn.disabled = true; btn.textContent = "Velg minst én periode"; return; }
      const res = R.validateBookingMulti({ date, periods: ps, household: house }, all, rules, now());
      btn.disabled = !res.ok;
      btn.textContent = `Book ${periodsText(ps)} for Hus ${house}`;
      if (!res.ok) { box.innerHTML = `<div class="msg no">${esc(res.message)}</div>`; return; }
      const wd = R.weekday(date), summer = rules.summer.months.includes(R.monthOf(date)) && rules.summer.weekendDays.includes(wd);
      const info = res.lifted ? (summer ? "Under 7 dager igjen – da er det førstemann til mølla, og bookingen teller ikke i sommerkvoten." : "Dette går fint.")
        : res.quota ? `Dette går fint. Dagen blir Hus ${house} sin ${R.WD_NB[wd]} i ${R.MONTHS[R.monthOf(date) - 1]} – uansett hvor mange perioder dere tar.`
        : "Dette går fint.";
      box.innerHTML = `<div class="msg ok">${esc(info)}</div>`;
    };
    body.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => {
      house = b.dataset.house; body.querySelectorAll("[data-house]").forEach(x => x.setAttribute("aria-pressed", x === b)); check();
    }));
    body.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
      b.setAttribute("aria-checked", b.getAttribute("aria-checked") !== "true"); syncFull(); check();
    }));
    const full = body.querySelector("[data-full]");
    if (full) full.addEventListener("click", () => {
      const on = full.getAttribute("aria-pressed") !== "true";
      body.querySelectorAll("[data-type]:not(:disabled)").forEach(x => x.setAttribute("aria-checked", on));
      full.setAttribute("aria-pressed", on); check();
    });
    const bookBtn = $("#bookBtn");
    if (bookBtn) bookBtn.addEventListener("click", async () => {
      try {
        bookBtn.disabled = true;
        const r = await S.createBooking({ date, periods: chosen(), household: house });
        setMyHouse(house); localStorage.setItem(HINT_KEY, "1");
        closeSheet(); await refresh();
        const contiguous = r.periods.every((p, k) => !k || rules.periods[r.periods[k - 1]].end === rules.periods[p].start);
        toast(`Booket! Hus ${house} · ${periodsText(r.periods)}${contiguous ? ` ${periodsTime(r.periods)}` : ""} ${R.dateLabel(date)} 🎉`);
      } catch (e) { $("#ruleMsg").innerHTML = `<div class="msg no">${esc(e.message)}</div>`; bookBtn.disabled = false; }
    });
    check();
    wireActions(body, () => openDay(date));
  }

  /** Knapper på en booking: sjekk inn, avbestill (med forhåndsvisning), bekreft bruk. */
  function wireActions(scope, after) {
    scope.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.id, act = btn.dataset.act;
      try {
        if (act === "checkin") { const r = await S.checkIn(id, { household: myHouse }); toast(`Sjekket inn til kl. ${hh(r.until)} – kos dere! ♨️`); }
        if (act === "confirm") { await S.confirmUsage(id, { household: myHouse }); toast("Takk! Registrert som brukt."); }
        if (act === "cancel") {
          const { booking } = await S.getBooking(id);
          const pre = R.validateCancel(booking, myHouse, rules, now());
          const box = btn.closest(".acts");
          box.innerHTML = `<div class="msg ${pre.ok ? (pre.late ? "no" : "ok") : "no"}" style="width:100%">${esc(pre.ok ? pre.message : pre.message)}</div>
            ${pre.ok ? `<button type="button" class="danger" data-yes>Ja, avbestill</button>` : ""}<button type="button" class="ghost" data-no>Behold bookingen</button>`;
          box.querySelector("[data-no]").addEventListener("click", after);
          const yes = box.querySelector("[data-yes]");
          if (yes) yes.addEventListener("click", async () => {
            try { const r = await S.cancelBooking(id, { household: myHouse }); await refresh(); await after(); toast(r.status === "CANCELLED_LATE" ? "Avbestilt (sen avbestilling)." : "Avbestilt."); }
            catch (e) { toast(e.message); }
          });
          return;
        }
        await refresh(); await after();
      } catch (e) { toast(e.message); }
    }));
  }

  /* ---------- Sjekk inn nå ---------- */
  async function openCheckin() {
    const n = now(), all = await allBookings();
    const mineToday = all.filter(b => b.date === n.date && b.household === myHouse && R.validateCheckin(b, myHouse, rules, n).ok);
    const plans = R.spontaneousPlans(all, rules, n);       // f.eks. kl. 15: til 17, eller til 24
    const opens = rules.periods[PKEYS[0]].start;
    let html = "";
    if (mineToday.length) html += `<p>Dere har booket nå:</p><ul class="plist">${mineToday.sort(byPeriod).map(b => bookingItem(b, n)).join("")}</ul>`;
    if (plans.length) {
      html += `<p>${mineToday.length ? "Eller sjekk inn" : "Er badehuset ledig og dere vil bruke det nå? Sjekk inn"} uten booking:</p>
        <h3 class="label">Hvem er dere?</h3><div class="pick" role="group" aria-label="Velg hus">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>
        <h3 class="label">Hvor lenge?</h3><div class="types" role="group" aria-label="Hvor lenge">${plans.map((ps, i) => `<button type="button" data-plan="${i}" aria-pressed="${i === 0}"><span>Til kl. ${hh(rules.periods[ps[ps.length - 1]].end)}</span><span class="t">${cap(periodsText(ps))}</span></button>`).join("")}</div>
        <p class="muted">Spontan innsjekk teller i statistikken, men ikke i sommerkvoten. Dere sjekkes ut automatisk når tiden er ute (kl. 14, 17 eller 24).</p>`;
    } else if (!mineToday.length) {
      html += n.minutes < R.range(rules, PKEYS[0]).start ? `<p>Badehuset kan brukes fra kl. ${opens}. Kom tilbake da – eller book en dag i kalenderen.</p>`
        : `<p>Akkurat nå er badehuset opptatt eller dagen er over. Se kalenderen for ledige tider.</p>`;
    }
    openSheet("Sjekk inn nå", html, plans.length ? `<button type="button" class="primary wide" id="spontBtn">Sjekk inn</button>` : "");
    const body = $("#sheetBody");
    let house = myHouse, plan = plans[0];
    body.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { house = b.dataset.house; body.querySelectorAll("[data-house]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    body.querySelectorAll("[data-plan]").forEach(b => b.addEventListener("click", () => { plan = plans[+b.dataset.plan]; body.querySelectorAll("[data-plan]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    const sb = $("#spontBtn");
    if (sb) sb.addEventListener("click", async () => {
      if (!house) { toast("Velg hvilket hus dere er."); return; }
      try { const r = await S.spontaneousCheckIn({ periods: plan, household: house }); setMyHouse(house); closeSheet(); await refresh(); toast(`Sjekket inn til kl. ${hh(r.until)} – kos dere! ♨️`); }
      catch (e) { toast(e.message); }
    });
    wireActions(body, () => { closeSheet(); });
  }

  /* ---------- Mine bookinger ---------- */
  async function renderMine() {
    const box = $("#mine");
    if (!myHouse) { box.innerHTML = `<p>Velg hvilket hus du hører til, så ser du husets bookinger her.</p><div class="pick">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}">Hus ${h}</button>`).join("")}</div>`;
      box.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { setMyHouse(b.dataset.house); renderMine(); })); return; }
    const n = now(), all = (await allBookings()).filter(b => b.household === myHouse);
    const need = all.filter(b => b.displayStatus === "NOT_CONFIRMED");
    const coming = all.filter(b => b.displayStatus === "BOOKED" || b.displayStatus === "CHECKED_IN");
    const past = all.filter(b => ["COMPLETED", "CANCELLED", "CANCELLED_LATE"].includes(b.displayStatus)).reverse().slice(0, 30);
    const li = b => `<li class="pitem"><div class="row"><b>${esc(R.dateLabel(b.date).replace(/^./, c => c.toUpperCase()))}</b><span class="stat">${STATUS[b.displayStatus]}</span></div>
      <div class="row muted">${PLABEL[b.period]} ${PTIME[b.period]}${b.source === "CHECKIN" ? " · spontan" : ""}${b.quota ? " · i sommerkvoten" : ""}</div>${bookingItemActs(b, n)}</li>`;
    let html = `<p class="muted">Viser ${houseChip(myHouse)}. Alle i huset ser og kan endre de samme bookingene.</p>`;
    html += quotaSummary(all, n);
    if (need.length) html += `<h2>Ble badehuset brukt?</h2><ul class="list">${need.map(li).join("")}</ul>`;
    html += `<h2>Kommende</h2>` + (coming.length ? `<ul class="list">${coming.map(li).join("")}</ul>` : `<p class="muted">Ingen kommende bookinger. Trykk på en dag i kalenderen for å booke.</p>`);
    if (past.length) html += `<h2>Tidligere</h2><ul class="list">${past.map(li).join("")}</ul>`;
    box.innerHTML = html;
    wireActions(box, renderMine);
  }
  function bookingItemActs(b, n) {
    const m = bookingItem(b, n).match(/<div class="acts">[\s\S]*?<\/div>/);
    return m ? m[0] : "";
  }
  /** Sommerkvoten for sommermåneder innenfor bookingvinduet. */
  function quotaSummary(mine, n) {
    const out = [], end = lastBookable();
    for (let d = n.date.slice(0, 7) + "-01"; d <= end; d = R.addMonths(d, 1)) {
      const m = R.monthOf(d), y = R.yearOf(d);
      if (!rules.summer.months.includes(m)) continue;
      const parts = rules.summer.weekendDays.map(wd => {
        const used = [...new Set(mine.filter(b => R.countsForQuota(b) && R.monthOf(b.date) === m && R.yearOf(b.date) === y && R.weekday(b.date) === wd).map(b => b.date))];
        return `${R.WD_NB[wd]}: ${used.length ? "brukt (" + used.map(shortDate).join(", ") + ")" : "ledig"}`;
      });
      out.push(`<li class="card"><b>${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())} ${y}</b><br><span class="muted">${parts.join(" · ")}</span></li>`);
    }
    return out.length ? `<h2>Sommerkvote</h2><ul class="list">${out.join("")}</ul>` : "";
  }

  /* ---------- Statistikk ---------- */
  async function renderStats() {
    const { y, m } = statAnchor;
    $("#statMonth").textContent = `${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())} ${y}`;
    const s = await S.stats({ year: y, month: m });
    const card = (title, data) => {
      const max = Math.max(1, ...HOUSES.map(h => data[h].used + data[h].notConfirmed + data[h].upcoming));
      return `<div class="card"><b>${title}</b><div class="bars">${HOUSES.map(h => {
        const d = data[h], extra = [d.notConfirmed ? `${d.notConfirmed} ikke bekreftet` : "", d.upcoming ? `${d.upcoming} booket` : ""].filter(Boolean).join(", ");
        return `<div class="bar"><span>${houseChip(h)}</span><span class="track" aria-hidden="true"><span class="fill h${h}" style="display:block;width:${(d.used / max) * 100}%"></span><span class="fill nc h${h}" style="display:block;width:${(d.notConfirmed / max) * 100}%"></span></span><span><b>${d.used}</b> ${extra ? `<small>(${extra})</small>` : ""}</span></div>`;
      }).join("")}</div></div>`;
    };
    $("#stats").innerHTML = `<div class="statgrid">${card(`${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())}`, s.month)}${card(`Sesongen ${y} (juni–august)`, s.season)}${card(`Hele ${y}`, s.year)}</div>`;
  }

  /* ---------- Navigasjon ---------- */
  async function refresh() {
    if (view === "kalender") await renderCalendar();
    if (view === "mine") await renderMine();
    if (view === "statistikk") await renderStats();
  }
  function show(v) {
    view = v;
    document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
    document.querySelectorAll(".tabs button").forEach(b => b.toggleAttribute("aria-current", b.dataset.view === v));
    document.querySelectorAll(".tabs button[aria-current]").forEach(b => b.setAttribute("aria-current", "page"));
    window.scrollTo(0, 0);
    refresh();
  }
  function step(dir) {
    anchor = mode === "week" ? R.addDays(anchor, 7 * dir) : R.addMonths(anchor.slice(0, 8) + "01", dir);
    renderCalendar();
  }

  async function init() {
    try { rules = await S.getRules(); }
    catch (e) { $("#calendar").innerHTML = `<p class="msg no">${esc(e.message)}</p>`; return; }
    for (const h of HOUSES) document.documentElement.style.setProperty("--" + h, rules.households[h].color);
    PKEYS = R.periodKeys(rules); FULLDAY = R.fullDayPeriods(rules);
    for (const p of PKEYS) { PLABEL[p] = rules.periods[p].label; PTIME[p] = `${hh(rules.periods[p].start)}–${hh(rules.periods[p].end)}`; }
    $("#legend").innerHTML = HOUSES.map(h => `<span><span class="dot h${h}"></span>Hus ${h}</span>`).join("") + `<span>Stripete = ikke bekreftet</span>`;
    anchor = now().date;
    const p = d2(anchor); statAnchor = { y: p.y, m: p.m };
    if (myHouse) $("#myHouseLabel").textContent = "Hus " + myHouse;
    $("#prevBtn").addEventListener("click", () => step(-1));
    $("#nextBtn").addEventListener("click", () => step(1));
    $("#todayBtn").addEventListener("click", () => { anchor = now().date; renderCalendar(); });
    $("#modeWeek").addEventListener("click", () => { mode = "week"; localStorage.setItem(MODE_KEY, mode); renderCalendar(); });
    $("#modeMonth").addEventListener("click", () => { mode = "month"; localStorage.setItem(MODE_KEY, mode); renderCalendar(); });
    $("#checkinNowBtn").addEventListener("click", openCheckin);
    $("#sheetClose").addEventListener("click", closeSheet);
    sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });
    $("#statPrev").addEventListener("click", () => { statAnchor = statAnchor.m === 1 ? { y: statAnchor.y - 1, m: 12 } : { y: statAnchor.y, m: statAnchor.m - 1 }; renderStats(); });
    $("#statNext").addEventListener("click", () => { statAnchor = statAnchor.m === 12 ? { y: statAnchor.y + 1, m: 1 } : { y: statAnchor.y, m: statAnchor.m + 1 }; renderStats(); });
    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
    $("#myHouseBtn").addEventListener("click", () => {
      openSheet("Hvilket hus hører du til?", `<p class="muted">Huset du velger, huskes på denne enheten. Du kan alltid velge et annet hus når du booker.</p><div class="pick">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>`);
      $("#sheetBody").querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { setMyHouse(b.dataset.house); closeSheet(); refresh(); }));
    });
    $("#resetBtn").addEventListener("click", async () => {
      if (!confirm("Vil du slette alle prøvebookingene på denne enheten?")) return;
      await S.reset(); toast("Prøvedata er nullstilt."); show("kalender");
    });
    // Oppdater visningen jevnlig, så status (pågår/ferdig) følger klokka.
    setInterval(() => { if (!sheet.open) refresh(); }, 60000);
    await renderCalendar();
  }
  init();

  // Enkel service worker (nett først), så appen åpner også uten nett.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/badehusappen/sw.js", { scope: "/badehusappen/" }).catch(() => {});
  }
})();
