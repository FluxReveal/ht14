/*
 * Badehusappen – datalag (prøveversjon)
 * ---------------------------------------------------------------
 * ALL lesing og skriving av data går gjennom dette ene modulet.
 * I prøveversjonen lagres alt i nettleseren (localStorage) på
 * brukerens egen enhet. Når Cloudflare Workeren er klar, byttes
 * bare denne fila ut med en som kaller /api/… – resten av appen
 * bruker de samme async-funksjonene og trenger ingen endring.
 *
 * Funksjon                      → fremtidig Worker-endepunkt
 *   getRules()                  → GET  /api/rules
 *   calendar({from, to})        → GET  /api/calendar?week=… / ?month=…
 *   getBooking(id)              → GET  /api/bookings/{id}
 *   history({year})             → GET  /api/history?year=…
 *   stats({year, month})        → GET  /api/stats?year=…&month=…
 *   createBooking({date, periods, household})  → POST /api/bookings
 *       periods = én eller flere av "AM" (10–14), "MID" (14–17), "PM" (17–24).
 *       Lagres som én booking per periode (felles groupId), alt eller ingenting.
 *   cancelBooking(id, {household})             → POST /api/bookings/{id}/cancel   (én periode)
 *   checkIn(id, {household})                   → POST /api/bookings/{id}/checkin  (+ husets neste perioder i strekk)
 *   spontaneousCheckIn({periods, household})   → POST /api/checkin
 *   confirmUsage(id, {household})              → POST /api/bookings/{id}/confirm
 *
 * Feil kastes som { error: "KODE", message: "Norsk tekst" }, samme
 * format som Workeren skal bruke (se LLD: Feilhåndtering).
 *
 * Ingen nøkler, tokens eller passord finnes i denne fila.
 */
(function (root) {
  "use strict";
  const R = root.RulesEngine;
  const KEY = "ht14-badehusappen-data";
  const RULES_KEY = "ht14-badehusappen-rules";
  let rules = null;
  let clock = () => R.osloNow();          // kan byttes for testing (se app.js)

  const err = (error, message) => { const e = new Error(message); e.error = error; e.message = message; return e; };
  const load = () => {
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch (e) { db = blank(); }
    return migrate(db);
  };
  const blank = () => ({ schemaVersion: 2, bookings: [], audit: [], seq: {} });
  /**
   * Prøvedata fra før dagen ble delt i tre (08–14 / 14–24 / heldag 08–24):
   * heldag → tre perioder, gammel formiddag → formiddag, gammel kveld → ettermiddag + kveld.
   */
  function migrate(db) {
    if ((db.schemaVersion || 1) >= 2) return db;
    const map = { FULL: ["AM", "MID", "PM"], AM: ["AM"], PM: ["MID", "PM"] }, out = [];
    for (const b of db.bookings || []) {
      const ps = map[b.period] || [b.period];
      ps.forEach((p, i) => out.push(Object.assign({}, b, { id: i ? `${b.id}-${p.toLowerCase()}` : b.id, period: p, groupId: b.groupId || b.id })));
    }
    db.bookings = out; db.schemaVersion = 2;
    db.audit = (db.audit || []).concat([{ ts: stamp(), actor: "system", role: "system", action: "MIGRATED_TO_3_PERIODS", target: null, from: 1, to: 2, comment: null }]);
    save(db);
    return db;
  }
  const save = db => localStorage.setItem(KEY, JSON.stringify(db));
  const stamp = () => new Date().toISOString();
  const actor = household => "hus-" + household;      // ingen innlogging ennå: «brukeren» er huset
  const withStatus = (b, now) => Object.assign({}, b, { displayStatus: R.effectiveStatus(b, rules, now) });
  function audit(db, action, b, from, to, household, comment) {
    db.audit.push({ ts: stamp(), actor: actor(household), role: "user", action, target: b.id, from, to, comment: comment || null });
  }
  function nextId(db, date) {
    const y = R.yearOf(date);
    db.seq[y] = (db.seq[y] || 0) + 1;
    return `b-${y}-${String(db.seq[y]).padStart(4, "0")}`;
  }
  function need(res) { if (!res.ok) throw err(res.error, res.message); return res; }
  function find(db, id) { const b = db.bookings.find(x => x.id === id); if (!b) throw err("NOT_FOUND", "Fant ikke bookingen."); return b; }

  const Store = {
    /** Leser rules.json (og husker siste kopi, så appen virker uten nett). */
    async getRules() {
      if (rules) return rules;
      try {
        const res = await fetch("rules.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(res.status);
        rules = await res.json();
        localStorage.setItem(RULES_KEY, JSON.stringify(rules));
      } catch (e) {
        rules = JSON.parse(localStorage.getItem(RULES_KEY) || "null");
        if (!rules) throw err("RULES_INVALID", "Fikk ikke lest reglene. Sjekk nettet og prøv igjen.");
      }
      return rules;
    },
    now() { return clock(); },
    setClock(fn) { clock = fn; },

    async calendar({ from, to }) {
      const now = clock();
      return load().bookings.filter(b => b.date >= from && b.date <= to).map(b => withStatus(b, now));
    },
    async getBooking(id) {
      const db = load();
      return { booking: withStatus(find(db, id), clock()), events: db.audit.filter(a => a.target === id) };
    },
    async history({ year } = {}) {
      const now = clock();
      return load().bookings.filter(b => !year || R.yearOf(b.date) === year).map(b => withStatus(b, now))
        .sort((a, b) => a.date.localeCompare(b.date) || R.range(rules, a.period).start - R.range(rules, b.period).start);
    },
    async stats({ year, month }) { return R.stats(load().bookings, rules, clock(), year, month); },

    /** Booker én eller flere perioder samme dag. Returnerer { bookings, periods, fullDay, quota, lifted }. */
    async createBooking({ date, periods, period, household }) {
      const db = load(), now = clock();
      const res = need(R.validateBookingMulti({ date, periods: periods || (period ? [period] : []), household }, db.bookings, rules, now));
      let groupId = null;
      const made = res.periods.map(p => {
        const b = {
          id: nextId(db, date), groupId: null, date, period: p, household, userId: actor(household), source: "BOOKING",
          status: "BOOKED", quota: !!res.quota, createdAt: stamp(), createdBy: actor(household),
          checkedInAt: null, confirmedAt: null, confirmedBy: null, cancelledAt: null, cancelledBy: null,
          override: false, corrected: false
        };
        groupId = groupId || b.id; b.groupId = groupId;
        db.bookings.push(b);
        audit(db, "BOOKING_CREATED", b, null, { status: "BOOKED", date, period: p }, household);
        return b;
      });
      save(db);
      return { bookings: made.map(b => withStatus(b, now)), periods: res.periods, fullDay: res.fullDay, quota: !!res.quota, lifted: !!res.lifted };
    },
    async cancelBooking(id, { household }) {
      const db = load(), now = clock(), b = find(db, id);
      const res = need(R.validateCancel(b, household, rules, now));
      const from = { status: b.status };
      b.status = res.status; b.cancelledAt = stamp(); b.cancelledBy = actor(household);
      audit(db, "BOOKING_CANCELLED", b, from, { status: b.status }, household);
      save(db);
      return Object.assign(withStatus(b, now), { message: res.message });
    },
    async checkIn(id, { household }) {
      const db = load(), now = clock(), b = find(db, id);
      need(R.validateCheckin(b, household, rules, now));
      const chain = R.checkinChain(b, db.bookings, rules);       // f.eks. heldag: sjekket inn til kl. 24
      for (const x of chain) {
        x.status = "CHECKED_IN"; x.checkedInAt = stamp();
        audit(db, "CHECKED_IN", x, { status: "BOOKED" }, { status: "CHECKED_IN" }, household, x === b ? null : "fulgte med innsjekken");
      }
      save(db);
      return Object.assign(withStatus(b, now), { until: rules.periods[chain[chain.length - 1].period].end, count: chain.length });
    },
    /** Spontan innsjekk: pågående periode, eventuelt med de neste ledige (til 17 eller 24). */
    async spontaneousCheckIn({ periods, period, household }) {
      const db = load(), now = clock();
      const res = need(R.validateSpontaneous({ periods: periods || [period], household }, db.bookings, rules, now));
      let groupId = null;
      const made = res.periods.map(p => {
        const b = {
          id: nextId(db, now.date), groupId: null, date: now.date, period: p, household, userId: actor(household), source: "CHECKIN",
          status: "CHECKED_IN", quota: !!res.quota, createdAt: stamp(), createdBy: actor(household),
          checkedInAt: stamp(), confirmedAt: null, confirmedBy: null, cancelledAt: null, cancelledBy: null,
          override: false, corrected: false
        };
        groupId = groupId || b.id; b.groupId = groupId;
        db.bookings.push(b);
        audit(db, "CHECKED_IN", b, null, { status: "CHECKED_IN", period: p }, household, "spontan");
        return b;
      });
      save(db);
      return { bookings: made.map(b => withStatus(b, now)), until: rules.periods[res.periods[res.periods.length - 1]].end };
    },
    async confirmUsage(id, { household }) {
      const db = load(), now = clock(), b = find(db, id);
      need(R.validateConfirm(b, household, rules, now));
      b.status = "COMPLETED"; b.confirmedAt = stamp(); b.confirmedBy = actor(household);
      audit(db, "USAGE_CONFIRMED", b, { status: "NOT_CONFIRMED" }, { status: "COMPLETED" }, household, "Vi brukte badehuset");
      save(db);
      return withStatus(b, now);
    },

    /** Bare i prøveversjonen: sletter alle prøvedata på denne enheten. */
    async reset() { localStorage.removeItem(KEY); }
  };
  root.Store = Store;
})(self);
