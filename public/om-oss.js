/*
 * «Om oss» på startsiden ht14.no (HT14 versjon 0.6).
 * Uten innlogging: bare Hus A–D og et innloggingsskjema.
 * Innlogget (samme innlogging som Badehusappen): navn på husstandene, kontaktpersoner
 * og fritekst – og huset ditt kan endre sitt eget. Navn og kontaktinfo ligger bare i
 * databasen og hentes fra /api/contacts; de står aldri i selve nettsiden.
 */
(function () {
  "use strict";
  const box = document.getElementById("omInnhold");
  if (!box) return;
  const HOUSES = ["A", "B", "C", "D"];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let user = null, list = [];

  async function api(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try { res = await fetch("/api/" + path, { method, headers, credentials: "same-origin", cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { const er = new Error("Får ikke kontakt. Sjekk nettet og prøv igjen."); er.status = 0; throw er; }
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const er = new Error((data && data.message) || "Noe gikk galt. Prøv igjen om litt."); er.status = res.status; throw er; }
    return data;
  }

  const husRad = () => `<ul class="omliste">${HOUSES.map(h => `<li class="omcelle"><span class="hus ${h.toLowerCase()}">Hus ${h}</span></li>`).join("")}</ul>`;

  function visUtlogget(msg) {
    box.innerHTML = `${husRad()}
      <p class="omtekst">Logg inn med husets innlogging (den samme som i Badehusappen) for å se hvem som bor hvor og hvordan dere når hverandre.</p>
      <form id="omLogin" class="omskjema" method="post" action="#" novalidate>
        <div class="omgruppe">
          <label class="omfelt"><span>E-post</span><input id="omEpost" name="username" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="navn@eksempel.no"></label>
          <label class="omfelt"><span>Passord</span><input id="omPassord" name="password" type="password" autocomplete="current-password" required placeholder="Passord"></label>
        </div>
        <p class="ommelding" role="alert">${esc(msg || "")}</p>
        <button type="submit" class="ombtn">Logg inn</button>
      </form>`;
    const f = document.getElementById("omLogin");
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const email = f.elements.username.value.trim(), password = f.elements.password.value;
      const m = f.querySelector(".ommelding"), b = f.querySelector("button");
      if (!email || !password) { m.textContent = "Skriv e-post og passord."; return; }
      b.disabled = true; b.textContent = "Logger inn …"; m.textContent = "";
      try { user = (await api("POST", "login", { email, password })).user; await visInnlogget(); }
      catch (err) { m.textContent = err.message; b.disabled = false; b.textContent = "Logg inn"; }
    });
  }

  async function visInnlogget() {
    try { list = await api("GET", "contacts"); }
    catch (e) { if (e.status === 401) { user = null; return visUtlogget(); } box.innerHTML = `<p class="ommelding">${esc(e.message)}</p>`; return; }
    const hvem = user.admin ? `${esc(user.name || "Administrator")} (administrator)` : `Hus ${esc(user.house)}`;
    box.innerHTML = `<p class="omtekst">Du er logget inn som <b>${hvem}</b>. Bare de som er logget inn ser navn og kontaktinfo.</p>` +
      list.map(h => {
        const folk = h.contacts.filter(c => c.name || c.email || c.phone);
        return `<article class="omhus" id="hus-${h.house}">
          <h3><span class="hus ${h.house.toLowerCase()}">Hus ${h.house}</span>${h.household ? ` <span class="omnavn">${esc(h.household)}</span>` : ""}</h3>
          <ul class="omliste">${folk.length ? folk.map(c => `<li class="omcelle kontakt"><b>${esc(c.name || "Kontakt")}</b>
            ${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ""))}">${esc(c.phone)}</a>` : ""}
            ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}</li>`).join("")
            : `<li class="omcelle dempet">Ingen kontaktpersoner lagt inn ennå.</li>`}
            ${h.note ? `<li class="omcelle">${esc(h.note).replace(/\n/g, "<br>")}</li>` : ""}
            ${h.canEdit ? `<li><button type="button" class="omcelle omendre" data-endre="${h.house}">Endre ${h.house === user.house ? "vårt hus" : "Hus " + h.house} ›</button></li>` : ""}
          </ul></article>`;
      }).join("") +
      `<p class="omtekst"><button type="button" class="omlenke" id="omUt">Logg ut</button></p>`;
    box.querySelectorAll("[data-endre]").forEach(b => b.addEventListener("click", () => endre(list.find(x => x.house === b.dataset.endre))));
    document.getElementById("omUt").addEventListener("click", async () => {
      try { await api("POST", "logout", {}); } catch (e) {}
      user = null; visUtlogget();
    });
  }

  const felt = (label, name, value, attrs) => `<label class="omfelt"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs || ""}></label>`;
  function endre(h) {
    const el = document.getElementById("hus-" + h.house), c = h.contacts;
    el.innerHTML = `<h3><span class="hus ${h.house.toLowerCase()}">Hus ${h.house}</span></h3>
      <form class="omskjema" autocomplete="off">
        <h4>Husstanden</h4><div class="omgruppe">${felt("Navn", "household", h.household, 'maxlength="200" placeholder="F.eks. Ola og Kari Nordmann"')}</div>
        ${[0, 1].map(i => `<h4>Kontaktperson ${i + 1}</h4><div class="omgruppe">
          ${felt("Navn", "n" + i, c[i].name, 'maxlength="80"')}
          ${felt("E-post", "e" + i, c[i].email, 'type="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="120"')}
          ${felt("Mobil", "p" + i, c[i].phone, 'type="tel" inputmode="tel" maxlength="30"')}</div>`).join("")}
        <h4>Til naboene</h4><div class="omgruppe"><label class="omfelt omtekstfelt"><span>Fritekst</span><textarea name="note" rows="4" maxlength="1000" placeholder="F.eks. «Ring gjerne etter kl. 17»">${esc(h.note)}</textarea></label></div>
        <p class="ommelding" role="alert"></p>
        <div class="omknapper"><button type="submit" class="ombtn">Lagre</button><button type="button" class="omlenke" data-avbryt>Avbryt</button></div>
      </form>`;
    const f = el.querySelector("form");
    f.querySelector("[data-avbryt]").addEventListener("click", visInnlogget);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const x = f.elements;
      try {
        await api("PUT", "contacts/" + h.house, { household: x.household.value, note: x.note.value,
          contacts: [0, 1].map(i => ({ name: x["n" + i].value, email: x["e" + i].value, phone: x["p" + i].value })) });
        await visInnlogget();
        const ny = document.getElementById("hus-" + h.house); if (ny) ny.scrollIntoView({ block: "start", behavior: "smooth" });
      } catch (err) { f.querySelector(".ommelding").textContent = err.message; }
    });
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  (async () => {
    try { user = (await api("GET", "me")).user; } catch (e) { user = null; }
    if (user) await visInnlogget(); else visUtlogget();
  })();
})();
