/*
 * Badehusappen – regelmotor
 * ---------------------------------------------------------------
 * Rene funksjoner uten sideeffekter. Den samme fila skal senere
 * brukes både i nettleseren og i Cloudflare Workeren.
 *
 * Tid: Alt regnes i Europe/Oslo som «veggklokke»: en dato
 * ("2027-07-10") og minutter etter midnatt (0–1440). 24:00 betyr
 * slutten av dagen (avklaring 10), også ved sommertid.
 *
 * Reglene leses fra rules.json – ingen regelverdier er hardkodet her.
 *
 * Dagen er delt i tre perioder (forslag, se rules.json):
 *   AM  = formiddag   10–14
 *   MID = ettermiddag 14–17
 *   PM  = kveld       17–24
 * Man kan booke én eller flere perioder samme dag. «Heldag» er alle tre,
 * og er bare et valg i appen – hver periode lagres som sin egen booking,
 * så den kan avbestilles, sjekkes inn og telles hver for seg.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RulesEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Dato og tid (Europe/Oslo) ---------- */

  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
    "august", "september", "oktober", "november", "desember"];
  const WD_NB = { mon: "mandag", tue: "tirsdag", wed: "onsdag", thu: "torsdag",
    fri: "fredag", sat: "lørdag", sun: "søndag" };

  /** Nå i Oslo: { date: "YYYY-MM-DD", minutes: 0–1439 } */
  function osloNow(d = new Date(), tz = "Europe/Oslo") {
    const p = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour) * 60 + (+p.minute) };
  }

  const pad = n => String(n).padStart(2, "0");
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y, m: mo, d, t };
  }
  const isDate = s => parseDate(s) !== null;
  const fmt = t => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  function addDays(s, n) { const p = parseDate(s); p.t.setUTCDate(p.t.getUTCDate() + n); return fmt(p.t); }
  /** Antall kalenderdager fra b til a (a − b). */
  function diffDays(a, b) { return Math.round((parseDate(a).t - parseDate(b).t) / 86400000); }
  /** Samme dato n kalendermåneder senere (31. nov finnes ikke → 30. nov). */
  function addMonths(s, n) {
    const p = parseDate(s);
    const y = p.y + Math.floor((p.m - 1 + n) / 12), m = ((p.m - 1 + n) % 12 + 12) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return `${y}-${pad(m + 1)}-${pad(Math.min(p.d, last))}`;
  }
  const weekday = s => WD[parseDate(s).t.getUTCDay()];
  const monthOf = s => parseDate(s).m;
  const yearOf = s => parseDate(s).y;
  /** Helgenøkkel = fredagens dato for helgen datoen hører til (avklaring 3). */
  function weekendKey(s) {
    const w = weekday(s);
    if (w === "fri") return s;
    if (w === "sat") return addDays(s, -1);
    if (w === "sun") return addDays(s, -2);
    return null;
  }
  /** Mandagen i uka datoen ligger i. */
  function mondayOf(s) { const i = parseDate(s).t.getUTCDay(); return addDays(s, -((i + 6) % 7)); }
  /** «lørdag 10. juli» */
  function dateLabel(s, withWeekday = true) {
    const p = parseDate(s);
    return (withWeekday ? WD_NB[weekday(s)] + " " : "") + `${p.d}. ${MONTHS[p.m - 1]}`;
  }
  const hm = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

  /* ---------- Perioder og statuser ---------- */

  function range(rules, period) {
    const p = rules.periods[period];
    return { start: hm(p.start), end: hm(p.end) };
  }
  /** Periodene i rekkefølge etter starttid. */
  const periodKeys = rules => Object.keys(rules.periods).sort((a, b) => range(rules, a).start - range(rules, b).start);
  /** Periodene som utgjør heldag (rules.fullDay.periods). */
  const fullDayPeriods = rules => (rules.fullDay && rules.fullDay.periods) || periodKeys(rules);
  /** Overlapper to perioder i tid? (De tre periodene overlapper ikke hverandre.) */
  function overlaps(rules, p1, p2) {
    const a = range(rules, p1), b = range(rules, p2);
    return a.start < b.end && b.start < a.end;
  }
  const cmp = (d1, m1, d2, m2) => (d1 < d2 ? -1 : d1 > d2 ? 1 : m1 - m2);
  /** Er perioden over (nå ≥ slutt)? */
  function hasEnded(rules, date, period, now) {
    return cmp(now.date, now.minutes, date, range(rules, period).end) >= 0;
  }
  /** Har perioden startet (nå ≥ start)? */
  function hasStarted(rules, date, period, now) {
    return cmp(now.date, now.minutes, date, range(rules, period).start) >= 0;
  }
  /**
   * Er perioden «over» for innsjekk? Det er den når den er slutt, eller når
   * en kortere periode inni den er slutt (brukes bare hvis rules.json en gang
   * får perioder som ligger inni hverandre).
   */
  function isOver(rules, date, period, now) {
    if (hasEnded(rules, date, period, now)) return true;
    const r = range(rules, period);
    return Object.keys(rules.periods).some(q => {
      const x = range(rules, q);
      return q !== period && x.start >= r.start && x.end <= r.end && hasEnded(rules, date, q, now);
    });
  }
  const ACTIVE = ["BOOKED", "CHECKED_IN", "COMPLETED", "NOT_CONFIRMED"];
  const isActive = st => ACTIVE.includes(st);

  /** Visningsstatus beregnet fra klokka (automatisk utsjekk / ikke bekreftet). */
  function effectiveStatus(b, rules, now) {
    if (!hasEnded(rules, b.date, b.period, now)) return b.status;
    if (b.status === "CHECKED_IN") return "COMPLETED";
    if (b.status === "BOOKED") return "NOT_CONFIRMED";
    return b.status;
  }
  /** Teller i sommerkvoten: quota=true og aktiv eller sent avbestilt. */
  const countsForQuota = b => b.quota === true && (isActive(b.status) || b.status === "CANCELLED_LATE");

  /* ---------- Hjelpere for meldinger ---------- */
  const fail = (error, message, extra) => Object.assign({ ok: false, error, message }, extra || {});
  const ok = extra => Object.assign({ ok: true }, extra || {});
  const periodName = (rules, p) => ({ AM: "formiddagen", MID: "ettermiddagen", PM: "kvelden" }[p] || rules.periods[p].label.toLowerCase());
  const hhmm = (rules, p, which) => { const t = rules.periods[p][which]; return t === "24:00" ? "24" : t.replace(/:00$/, "").replace(/^0/, ""); };
  const listNb = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " og " + a[a.length - 1];

  /* ---------- Booking ---------- */

  /**
   * Sjekker en ny booking. req = { date, period, household }.
   * Returnerer { ok:true, quota, lifted } eller { ok:false, error, message }.
   * Rekkefølgen følger LLD: input → passert/startet → vindu → ledig → 7 dager → sommer.
   * En periode kan bookes frem til den starter. Har den startet og er ledig,
   * bruker man «Sjekk inn nå» i stedet.
   */
  function validateBooking(req, bookings, rules, now) {
    const today = now.date;
    if (!isDate(req.date) || !rules.periods[req.period] || !rules.households[req.household])
      return fail("INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
    if (hasEnded(rules, req.date, req.period, now))
      return fail("IN_PAST", `${cap(periodName(rules, req.period))} er allerede over.`);
    if (hasStarted(rules, req.date, req.period, now))
      return fail("STARTED", `${cap(periodName(rules, req.period))} har allerede startet. Er badehuset ledig, kan dere bruke «Sjekk inn nå».`);
    const last = addMonths(today, rules.bookingWindow.months);
    if (req.date > last)
      return fail("OUTSIDE_WINDOW", `Du kan booke maks ${rules.bookingWindow.months} måneder frem i tid – akkurat nå til og med ${dateLabel(last)}. Denne datoen åpner ${dateLabel(addMonths(req.date, -rules.bookingWindow.months))}.`);

    const clash = bookings.find(b => b.date === req.date && isActive(b.status) && overlaps(rules, b.period, req.period));
    if (clash) {
      const free = periodKeys(rules).filter(p => p !== req.period && !hasStarted(rules, req.date, p, now)
        && !bookings.some(b => b.date === req.date && isActive(b.status) && overlaps(rules, b.period, p)));
      let msg = clash.household === req.household
        ? `Hus ${req.household} har allerede ${periodName(rules, clash.period)} denne dagen.`
        : `${cap(periodName(rules, clash.period))} er allerede booket av Hus ${clash.household}.`;
      if (free.length) msg += ` ${cap(listNb(free.map(p => periodName(rules, p))))} er fortsatt ledig.`;
      return fail("SLOT_TAKEN", msg, { taken: clash.household });
    }

    const daysBefore = diffDays(req.date, today);
    if (daysBefore < rules.liftSummerRulesWhenDaysBefore)
      return ok({ quota: rules.shortNoticeCountsTowardQuota, lifted: true });          // Å1

    if (!rules.summer.months.includes(monthOf(req.date))) return ok({ quota: false });  // Å4
    const wd = weekday(req.date);
    if (!rules.summer.weekendDays.includes(wd)) return ok({ quota: false });

    const mine = bookings.filter(b => b.household === req.household && countsForQuota(b));
    const opens = dateLabel(addDays(req.date, -(rules.liftSummerRulesWhenDaysBefore - 1)));
    const tail = ` Fra ${opens} (under 7 dager før) er det førstemann til mølla, så da kan dere ta den hvis den er ledig.`;

    // 1) Maks én av hver helgedag per måned – teller DAGER. En annen periode
    //    samme dato som husstanden allerede har, teller ikke som en ny dag.
    const sameWd = distinct(mine.filter(b => b.date !== req.date && monthOf(b.date) === monthOf(req.date)
      && yearOf(b.date) === yearOf(req.date) && weekday(b.date) === wd));
    if (sameWd.length >= rules.summer.maxPerWeekdayPerMonth[wd])
      return fail("QUOTA_WEEKDAY", `Hus ${req.household} har allerede en ${WD_NB[wd]} i ${MONTHS[monthOf(req.date) - 1]} (${dateLabel(sameWd[0], false)}). Om sommeren kan hvert hus ha én fredag, én lørdag og én søndag per måned.` + tail, { rule: "summer.maxPerWeekdayPerMonth" });

    // 2) Maks én helgedag per helg (fre–søn), også over månedsskifte (Å3).
    const wk = weekendKey(req.date);
    const sameWeekend = distinct(mine.filter(b => b.date !== req.date && weekendKey(b.date) === wk));
    if (sameWeekend.length >= rules.summer.maxDaysPerWeekend)
      return fail("WEEKEND_LIMIT", `Hus ${req.household} har allerede ${dateLabel(sameWeekend[0])} denne helgen. Om sommeren kan hvert hus ta én dag per helg.` + tail, { rule: "summer.maxDaysPerWeekend" });

    return ok({ quota: true });
  }
  const distinct = list => [...new Set(list.map(b => b.date))].sort();

  /** Kan heldag (alle tre periodene) bookes denne datoen nå? Bare før første periode starter. */
  function canBookFullDay(rules, date, now) {
    const first = fullDayPeriods(rules)[0];
    return !(rules.fullDay && rules.fullDay.onlyBeforeStart === false ? hasEnded(rules, date, first, now) : hasStarted(rules, date, first, now));
  }

  /**
   * Sjekker en booking av én eller flere perioder samme dag.
   * req = { date, periods: ["AM","MID",…], household }.
   * Alle periodene må gå gjennom, ellers lagres ingen (alt eller ingenting).
   * Sommerkvoten teller DAGER: flere perioder samme dato er fortsatt én dag.
   */
  function validateBookingMulti(req, bookings, rules, now) {
    const keys = periodKeys(rules);
    const periods = [...new Set(req.periods || (req.period ? [req.period] : []))];
    if (!periods.length) return fail("NO_PERIOD", "Velg minst én periode.");
    if (periods.some(p => !rules.periods[p])) return fail("INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
    periods.sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
    const fd = fullDayPeriods(rules);
    if (fd.every(p => periods.includes(p)) && !canBookFullDay(rules, req.date, now))
      return fail("FULLDAY_STARTED", `Heldag kan bare bookes før kl. ${hhmm(rules, fd[0], "start")} samme dag. Velg de periodene som er igjen.`);
    let res = null; const tmp = bookings.slice();
    for (const p of periods) {
      res = validateBooking({ date: req.date, period: p, household: req.household }, tmp, rules, now);
      if (!res.ok) return Object.assign(res, { period: p });
      tmp.push({ id: "_ny_" + p, date: req.date, period: p, household: req.household, status: "BOOKED", quota: !!res.quota });
    }
    return ok({ quota: res.quota, lifted: !!res.lifted, periods, fullDay: fd.every(p => periods.includes(p)) });
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- Avbestilling ---------- */

  /** Å6: alle i husstanden kan avbestille husstandens bookinger. Hver periode avbestilles for seg. */
  function validateCancel(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (effectiveStatus(b, rules, now) !== "BOOKED")
      return fail("NOT_CANCELLABLE", "Denne bookingen kan ikke avbestilles.");
    if (rules.cancelPermission === "household" && b.household !== household)
      return fail("FORBIDDEN", `Bare Hus ${b.household} kan avbestille denne bookingen.`);
    const daysBefore = diffDays(b.date, now.date);
    const late = daysBefore <= rules.lateCancellationDays;
    return ok({
      late, status: late ? "CANCELLED_LATE" : "CANCELLED",
      message: late
        ? (b.quota ? `Det er 7 dager eller mindre igjen, så dette er en sen avbestilling. ${cap(periodName(rules, b.period))} blir ledig for andre, men dagen teller fortsatt i sommerkvoten deres.`
                   : `${cap(periodName(rules, b.period))} blir ledig for andre. (Sen avbestilling, men denne bookingen telte ikke i kvoten.)`)
        : `${cap(periodName(rules, b.period))} blir ledig for andre.${b.quota ? " Har dere ingen andre perioder denne dagen, teller den ikke lenger i kvoten." : ""}`
    });
  }

  /* ---------- Innsjekk og bekreftelse ---------- */

  function validateCheckin(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (b.household !== household) return fail("FORBIDDEN", `Dette er Hus ${b.household} sin booking.`);
    if (effectiveStatus(b, rules, now) !== "BOOKED") return fail("NOT_CHECKIN", "Denne bookingen kan ikke sjekkes inn.");
    if (b.date !== now.date || !hasStarted(rules, b.date, b.period, now))
      return fail("TOO_EARLY", `Du kan sjekke inn når perioden starter (kl. ${rules.periods[b.period].start}).`);
    return ok();
  }

  /**
   * Innsjekk på egen booking sjekker også inn husets neste perioder samme dag
   * som henger sammen (f.eks. booket heldag → sjekket inn til kl. 24).
   * Hver periode sjekkes ut automatisk når den slutter (14, 17, 24).
   */
  function checkinChain(b, bookings, rules) {
    const chain = [b]; let end = range(rules, b.period).end;
    for (;;) {
      const next = bookings.find(x => x.date === b.date && x.household === b.household && x.status === "BOOKED"
        && range(rules, x.period).start === end && !chain.includes(x));
      if (!next) return chain;
      chain.push(next); end = range(rules, next.period).end;
    }
  }

  const freeNow = (bookings, rules, date, p) => !bookings.some(b => b.date === date && isActive(b.status) && overlaps(rules, b.period, p));
  /** Perioden man kan sjekke inn spontant på nå (pågår og er ledig) – 0 eller 1 periode. */
  function spontaneousOptions(bookings, rules, now) {
    return periodKeys(rules).filter(p =>
      hasStarted(rules, now.date, p, now) && !isOver(rules, now.date, p, now) && freeNow(bookings, rules, now.date, p));
  }
  /**
   * Valg for spontan innsjekk: nåværende periode, eventuelt sammen med de
   * neste ledige periodene i strekk. Eks. kl. 15: [["MID"], ["MID","PM"]].
   */
  function spontaneousPlans(bookings, rules, now) {
    const cur = spontaneousOptions(bookings, rules, now)[0];
    if (!cur) return [];
    const keys = periodKeys(rules), plans = [[cur]];
    let end = range(rules, cur).end;
    for (const p of keys.slice(keys.indexOf(cur) + 1)) {
      if (range(rules, p).start !== end || !freeNow(bookings, rules, now.date, p)) break;
      plans.push(plans[plans.length - 1].concat(p)); end = range(rules, p).end;
    }
    return plans;
  }
  function validateSpontaneous(req, bookings, rules, now) {
    const periods = req.periods || (req.period ? [req.period] : []);
    if (!periods.length || periods.some(p => !rules.periods[p]) || !rules.households[req.household]) return fail("INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
    const plan = spontaneousPlans(bookings, rules, now).find(x => x.join() === periods.join());
    if (!plan) return fail("SLOT_TAKEN", "Den perioden er ikke ledig akkurat nå.");
    return ok({ quota: rules.spontaneousCheckinCountsTowardQuota, periods: plan });     // Å2
  }

  function validateConfirm(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (b.household !== household) return fail("FORBIDDEN", `Dette er Hus ${b.household} sin booking.`);
    if (effectiveStatus(b, rules, now) !== "NOT_CONFIRMED") return fail("NOT_CONFIRMABLE", "Denne bookingen trenger ingen bekreftelse.");
    return ok();
  }

  /* ---------- Statistikk ---------- */

  /**
   * Perioder per husstand. Formiddag, ettermiddag og kveld = 1 hver, heldag = 3
   * (rules.periods[*].units).
   * Å7: COMPLETED og CHECKED_IN = bruk. NOT_CONFIRMED vises separat.
   * BOOKED (fremover) vises også separat. Avbestilte teller ikke som bruk.
   */
  function stats(bookings, rules, now, year, month) {
    const empty = () => Object.fromEntries(Object.keys(rules.households).map(h => [h, { used: 0, notConfirmed: 0, upcoming: 0 }]));
    const out = { month: empty(), season: empty(), year: empty() };
    for (const b of bookings) {
      if (yearOf(b.date) !== year || !rules.periods[b.period]) continue;     // ukjent/gammel periode hoppes over
      const st = effectiveStatus(b, rules, now);
      const key = (st === "COMPLETED" || st === "CHECKED_IN") ? "used"
        : st === "NOT_CONFIRMED" ? "notConfirmed" : st === "BOOKED" ? "upcoming" : null;
      if (!key || !out.year[b.household]) continue;
      const u = rules.periods[b.period].units;
      out.year[b.household][key] += u;
      if (rules.summer.months.includes(monthOf(b.date))) out.season[b.household][key] += u;
      if (monthOf(b.date) === month) out.month[b.household][key] += u;
    }
    return out;
  }

  return {
    osloNow, isDate, addDays, diffDays, addMonths, weekday, weekendKey, mondayOf, monthOf, yearOf,
    dateLabel, MONTHS, WD_NB, range, periodKeys, fullDayPeriods, overlaps, hasEnded, isOver, hasStarted, isActive, effectiveStatus,
    countsForQuota, validateBooking, validateBookingMulti, canBookFullDay, validateCancel, validateCheckin, checkinChain,
    spontaneousOptions, spontaneousPlans, validateSpontaneous, validateConfirm, stats
  };
});
