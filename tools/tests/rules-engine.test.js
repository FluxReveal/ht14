// Kjør: node --test tools/tests/   (Node 18+, ingen avhengigheter)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../public/badehusappen/js/rules-engine.js");
const rules = require("../../public/badehusappen/rules.json");

const at = (date, hhmm = "09:00") => { const [h, m] = hhmm.split(":").map(Number); return { date, minutes: h * 60 + m }; };
let n = 0;
const bk = (date, period, household, extra = {}) =>
  Object.assign({ id: "t" + (++n), date, period, household, status: "BOOKED", quota: true, source: "BOOKING" }, extra);
const day = (date, household, extra) => ["AM", "MID", "PM"].map(p => bk(date, p, household, extra));   // heldag = tre perioder
const book = (date, period, household, bookings = [], now = at("2027-05-20")) =>
  R.validateBooking({ date, period, household }, bookings, rules, now);
const multi = (date, periods, household, bookings = [], now = at("2027-05-20")) =>
  R.validateBookingMulti({ date, periods, household }, bookings, rules, now);
const FULL = ["AM", "MID", "PM"];

test("dato-hjelpere", () => {
  assert.equal(R.weekday("2027-07-10"), "sat");
  assert.equal(R.mondayOf("2027-08-01"), "2027-07-26");        // søndag 1. aug hører til uka som starter mandag 26. juli
  assert.equal(R.addMonths("2027-04-15", 3), "2027-07-15");
  assert.equal(R.addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(R.diffDays("2027-07-10", "2027-07-03"), 7);
  assert.equal(R.mondayOf("2026-10-25"), "2026-10-19");
});

test("Oslo-tid og sommertid", () => {
  assert.deepEqual(R.osloNow(new Date("2027-07-10T21:59:00Z")), { date: "2027-07-10", minutes: 23 * 60 + 59 }); // CEST
  assert.deepEqual(R.osloNow(new Date("2027-01-10T23:30:00Z")), { date: "2027-01-11", minutes: 30 });          // CET
  assert.deepEqual(R.osloNow(new Date("2026-10-25T01:30:00Z")), { date: "2026-10-25", minutes: 2 * 60 + 30 }); // etter omstilling
});

test("tre perioder: 10–14, 14–17, 17–24 i riktig rekkefølge og uten overlapp", () => {
  assert.deepEqual(R.periodKeys(rules), ["AM", "MID", "PM"]);
  assert.deepEqual(R.range(rules, "AM"), { start: 600, end: 840 });
  assert.deepEqual(R.range(rules, "MID"), { start: 840, end: 1020 });
  assert.deepEqual(R.range(rules, "PM"), { start: 1020, end: 1440 });
  for (const a of FULL) for (const b of FULL) assert.equal(R.overlaps(rules, a, b), a === b, `${a}/${b}`);
  assert.deepEqual(R.fullDayPeriods(rules), FULL);
});

test("① opptatt periode: andre hus kan ta de andre periodene", () => {
  const ex = [bk("2027-07-10", "MID", "A")];
  assert.equal(book("2027-07-10", "AM", "C", ex).ok, true);
  assert.equal(book("2027-07-10", "PM", "C", ex).ok, true);
  const r = book("2027-07-10", "MID", "C", ex);
  assert.equal(r.error, "SLOT_TAKEN");
  assert.match(r.message, /Ettermiddagen er allerede booket av Hus A/);
  assert.match(r.message, /Formiddagen og kvelden er fortsatt ledig/);
  const h = multi("2027-07-10", FULL, "C", ex);                     // heldag når én periode er tatt
  assert.equal(h.error, "SLOT_TAKEN"); assert.equal(h.period, "MID");
  assert.equal(multi("2027-07-10", ["AM", "PM"], "C", ex).ok, true); // perioder trenger ikke henge sammen
});

test("flere perioder: alt eller ingenting, heldag = alle tre", () => {
  const r = multi("2027-07-10", ["PM", "AM", "MID", "AM"], "B");
  assert.equal(r.ok, true); assert.deepEqual(r.periods, FULL); assert.equal(r.fullDay, true);
  assert.equal(multi("2027-07-10", ["MID", "PM"], "B").fullDay, false);
  assert.equal(multi("2027-07-10", [], "B").error, "NO_PERIOD");
  assert.equal(multi("2027-07-10", ["FULL"], "B").error, "INVALID_INPUT");          // gammel nøkkel finnes ikke lenger
});

test("avbestilte bookinger opptar ikke perioden", () => {
  assert.equal(multi("2027-07-10", FULL, "C", day("2027-07-10", "A", { status: "CANCELLED" })).ok, true);
});

test("② bookingvindu: rullerende 3 måneder (Å5)", () => {
  const now = at("2027-04-15");
  assert.equal(multi("2027-07-15", FULL, "A", [], now).ok, true);
  assert.equal(multi("2027-07-16", FULL, "A", [], now).error, "OUTSIDE_WINDOW");
});

test("samme dag: en periode kan bookes til den starter; heldag bare før kl. 10", () => {
  const d = "2027-07-10";
  assert.equal(multi(d, FULL, "A", [], at(d, "09:59")).ok, true);
  assert.equal(R.canBookFullDay(rules, d, at(d, "09:59")), true);
  assert.equal(R.canBookFullDay(rules, d, at(d, "10:00")), false);
  assert.equal(multi(d, FULL, "A", [], at(d, "10:00")).error, "FULLDAY_STARTED");
  assert.match(multi(d, FULL, "A", [], at(d, "10:00")).message, /før kl\. 10/);
  assert.equal(multi(d, ["MID", "PM"], "A", [], at(d, "10:30")).ok, true);           // resten av dagen
  assert.equal(book(d, "AM", "A", [], at(d, "10:30")).error, "STARTED");             // pågår → «Sjekk inn nå»
  assert.equal(book(d, "MID", "A", [], at(d, "13:59")).ok, true);
  assert.equal(book(d, "MID", "A", [], at(d, "14:00")).error, "STARTED");
  assert.equal(book(d, "PM", "A", [], at(d, "16:59")).ok, true);
  assert.equal(book(d, "AM", "A", [], at(d, "14:00")).error, "IN_PAST");
  assert.equal(book(d, "PM", "A", [], at(d, "23:59")).error, "STARTED");            // 24:00 = slutt på dagen (Å10)
  assert.equal(R.canBookFullDay(rules, "2027-07-11", at(d, "23:00")), true);          // neste dag
});

test("③ sommerkvote teller DAGER, ikke perioder", () => {
  const ex = [bk("2027-07-09", "AM", "B")];
  assert.equal(multi("2027-07-09", ["MID", "PM"], "B", ex).ok, true);                 // samme fredag = fortsatt 1 dag
  const r = multi("2027-07-16", ["PM"], "B", ex);
  assert.equal(r.error, "QUOTA_WEEKDAY");
  assert.match(r.message, /fredag i juli/);
  assert.equal(multi("2027-07-16", ["PM"], "A", ex).ok, true);                        // et annet hus
  assert.equal(multi("2027-08-06", FULL, "B", ex).ok, true);                          // ny måned
  assert.equal(multi("2027-07-09", FULL, "C").quota, true);                           // heldag på fredag = én kvotedag
});

test("standard er kveld, og heldag er ikke forhåndsvalgt", () => {
  assert.deepEqual(rules.defaultPeriods, ["PM"]);
  assert.equal(rules.fullDay.default, false);
  assert.deepEqual(rules.summer.limitedDays, ["thu", "fri", "sat"]);
  assert.equal(multi("2027-07-10", ["AM"], "A").ok, true);                           // dagtid kan fortsatt velges – ingen teknisk sperre
});

test("sommer: torsdag nr. 2 i samme måned avvises", () => {
  const ex = [bk("2027-07-01", "PM", "A")];                                          // torsdag 1. juli
  const r = multi("2027-07-15", ["PM"], "A", ex);
  assert.equal(r.error, "QUOTA_WEEKDAY");
  assert.match(r.message, /torsdag i juli/);
  assert.match(r.message, /én torsdag, én fredag og én lørdag per måned/);
  assert.equal(multi("2027-08-05", ["PM"], "A", ex, at("2027-06-01")).ok, true);      // ny måned
});

test("sommer: torsdag og lørdag i samme uke avvises (uke = mandag–søndag)", () => {
  const ex = [bk("2027-07-08", "PM", "A")];                                          // torsdag 8. juli
  assert.equal(multi("2027-07-10", ["PM"], "A", ex).error, "WEEK_LIMIT");            // lørdag samme uke
  assert.equal(multi("2027-07-09", FULL, "A", ex).error, "WEEK_LIMIT");              // fredag samme uke
  assert.match(multi("2027-07-10", ["PM"], "A", ex).message, /torsdag, fredag og lørdag i samme uke/);
  assert.equal(multi("2027-07-10", ["PM"], "B", ex).ok, true);                       // et annet hus
});

test("sommer: torsdag i uke 1 og fredag i uke 2 går fint", () => {
  const ex = [bk("2027-07-01", "PM", "A")];                                          // torsdag 1. juli
  const r = multi("2027-07-09", ["PM"], "A", ex);                                    // fredag 9. juli, neste uke
  assert.equal(r.ok, true); assert.equal(r.quota, true);
  assert.equal(multi("2027-07-17", ["PM"], "A", ex.concat([bk("2027-07-09", "PM", "A")])).ok, true); // lørdag uka etter
});

test("sommer: søndag er ikke begrenset", () => {
  const ex = [bk("2027-07-04", "PM", "A"), bk("2027-07-11", "PM", "A"), bk("2027-07-10", "PM", "A")];
  const r = multi("2027-07-18", FULL, "A", ex);                                      // tredje søndag i juli
  assert.equal(r.ok, true); assert.equal(r.quota, false);
  assert.equal(multi("2027-07-25", ["PM"], "A", ex).ok, true);
});

test("sommerregelen gjelder bare juni–august", () => {
  const now = at("2027-03-01");
  const mai = [bk("2027-05-06", "PM", "D")];                                         // torsdag 6. mai
  assert.equal(multi("2027-05-13", ["PM"], "D", mai, now).ok, true);                 // ny torsdag i mai
  assert.equal(multi("2027-05-07", ["PM"], "D", mai, now).ok, true);                 // fredag samme uke
  const juni = [bk("2027-06-03", "PM", "D")];
  assert.equal(multi("2027-06-10", ["PM"], "D", juni, at("2027-04-01")).error, "QUOTA_WEEKDAY"); // juni: begrenset
  const sep = [bk("2027-09-02", "PM", "D")];
  assert.equal(multi("2027-09-09", ["PM"], "D", sep, at("2027-07-01")).ok, true);    // september: fritt
  assert.equal(multi("2027-09-03", ["PM"], "D", sep, at("2027-07-01")).ok, true);
});

test("uke over månedsskifte: kvoten følger datoen, ukeregelen følger uka", () => {
  const now = at("2026-05-20");
  const ex = day("2026-07-31", "C");                                                 // fredag 31. juli 2026
  assert.equal(multi("2026-08-01", ["PM"], "C", ex, now).error, "WEEK_LIMIT");       // lørdag 1. august, samme uke
  assert.equal(multi("2026-08-07", ["PM"], "C", ex, now).ok, true);                  // fredag i august: egen kvote
});

test("⑤ 7-dagersregel: under 7 dager → førstemann til mølla og ikke kvote (Å1)", () => {
  const now = at("2027-07-04", "08:00");
  const ex = [...day("2027-07-02", "A", { status: "COMPLETED" }), ...day("2027-07-03", "A")];
  const fre = multi("2027-07-09", FULL, "A", ex, now);                               // 5 dager før
  assert.equal(fre.ok, true); assert.equal(fre.lifted, true); assert.equal(fre.quota, false);
  assert.equal(multi("2027-07-10", ["MID"], "A", ex, now).ok, true);                  // 6 dager før
  assert.equal(multi("2027-07-11", FULL, "A", ex, now).quota, false);                 // 7 dager før, men søndag er ikke begrenset
  assert.equal(multi("2027-07-15", ["PM"], "A", ex, now).quota, true);                 // torsdag 11 dager før: teller i kvoten
  assert.equal(multi("2027-07-16", ["PM"], "A", ex, now).error, "QUOTA_WEEKDAY");      // fredag nr. 2 i juli (fredag 2. er brukt)
});

test("Å4: utenfor sommer ingen begrensninger", () => {
  const ex = day("2027-09-03", "D");
  assert.equal(multi("2027-09-04", FULL, "D", ex, at("2027-07-01")).ok, true);
  assert.equal(multi("2027-09-10", FULL, "D", ex, at("2027-07-01")).ok, true);
});

test("⑥ avbestilling per periode: alltid CANCELLED, uansett hvor kort tid det er igjen", () => {
  const b = bk("2027-07-10", "MID", "A");
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-02")).status, "CANCELLED");      // 8 dager før
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-03")).status, "CANCELLED");      // 7 dager før: ingen «sen avbestilling»
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-09")).status, "CANCELLED");      // dagen før
  assert.match(R.validateCancel(b, "A", rules, at("2027-07-03")).message, /Ettermiddagen blir ledig/);
  assert.equal(R.validateCancel(b, "B", rules, at("2027-07-02")).error, "FORBIDDEN");       // Å6
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-10", "17:00")).error, "NOT_CANCELLABLE"); // perioden er over
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-10", "15:00")).ok, true);              // pågår: kan frigis til andre
  const early = [bk("2027-07-10", "PM", "A", { status: "CANCELLED" })];
  assert.equal(multi("2027-07-24", FULL, "A", early).ok, true);                              // ut av kvoten
  // avbestiller bare kvelden av en heldag → lørdagen teller fortsatt (formiddag og ettermiddag står)
  const partly = [bk("2027-07-10", "AM", "A"), bk("2027-07-10", "MID", "A"), bk("2027-07-10", "PM", "A", { status: "CANCELLED" })];
  assert.equal(multi("2027-07-24", ["PM"], "A", partly).error, "QUOTA_WEEKDAY");
  // og den ledige kvelden kan tas av et annet hus
  assert.equal(multi("2027-07-10", ["PM"], "C", partly).ok, true);
});

test("avbestilling frigjør kvoten: book torsdag i juli, avbestill, book en annen torsdag", () => {
  const thu = bk("2027-07-01", "PM", "A");                                           // torsdag 1. juli
  assert.equal(multi("2027-07-15", ["PM"], "A", [thu]).error, "QUOTA_WEEKDAY");      // før avbestilling
  const res = R.validateCancel(thu, "A", rules, at("2027-05-20"));
  assert.equal(res.ok, true); assert.match(res.message, /booke en annen dag/);
  const r = multi("2027-07-15", ["PM"], "A", [{ ...thu, status: res.status }]);
  assert.equal(r.ok, true); assert.equal(r.quota, true);                             // ny torsdag i juli går fint
});

test("sen avbestilling teller ikke lenger i kvoten (heller ikke gamle CANCELLED_LATE)", () => {
  const thu = bk("2027-07-08", "PM", "A");                                           // torsdag 8. juli
  const now = at("2027-07-03");                                                      // 5 dager før
  const res = R.validateCancel(thu, "A", rules, now);
  assert.equal(res.status, "CANCELLED");
  assert.equal(R.countsForQuota({ ...thu, status: res.status }), false);
  assert.equal(R.countsForQuota({ ...thu, status: "CANCELLED_LATE" }), false);       // gamle prøvedata
  assert.equal(multi("2027-07-22", ["PM"], "A", [{ ...thu, status: "CANCELLED_LATE" }], now).ok, true);
});

test("avbestilt booking teller ALDRI i noen kvote – uansett når den ble avbestilt", () => {
  // Torsdag 1., fredag 9. og lørdag 17. juli, avbestilt på ulike tidspunkt (også samme dag og etter at perioden startet).
  const when = ["2027-05-01T10:00:00Z", "2027-06-30T20:00:00Z", "2027-07-01T16:30:00Z", "2027-07-09T18:00:00Z", "2027-07-17T23:00:00Z"];
  const cancelled = [bk("2027-07-01", "PM", "A"), bk("2027-07-09", "PM", "A"), bk("2027-07-17", "AM", "A"), ...day("2027-07-08", "A"),
    bk("2027-07-02", "PM", "A", { source: "CHECKIN" })]
    .map((b, i) => ({ ...b, status: "CANCELLED", cancelledAt: when[i % when.length] }));
  for (const b of cancelled) assert.equal(R.countsForQuota(b), false, b.date + " " + b.period);
  const now = at("2027-05-20");
  // Månedsregelen: ny torsdag, fredag og lørdag i juli går fint
  assert.equal(multi("2027-07-15", ["PM"], "A", cancelled, now).ok, true);
  assert.equal(multi("2027-07-23", ["PM"], "A", cancelled, now).ok, true);
  assert.equal(multi("2027-07-24", ["PM"], "A", cancelled, now).ok, true);
  // Ukeregelen: lørdag 3. juli i samme uke som avbestilt torsdag 1./fredag 2. går fint
  const r = multi("2027-07-03", FULL, "A", cancelled, now);
  assert.equal(r.ok, true); assert.equal(r.quota, true);
  // Statistikk og rettferdighet: ingenting av det avbestilte telles – verken brukt, ikke bekreftet eller booket
  for (const n of [at("2027-06-01"), at("2027-07-10", "12:00"), at("2027-12-31", "23:00")]) {
    const s = R.stats(cancelled, rules, n, 2027, 7);
    for (const k of ["month", "season", "year"]) assert.deepEqual(s[k].A, { used: 0, notConfirmed: 0, upcoming: 0 }, k);
  }
});

test("innsjekk gjelder alle perioder, også formiddag og ettermiddag", () => {
  for (const [p, t] of [["AM", "10:00"], ["MID", "14:00"], ["PM", "17:00"]]) {
    const b = bk("2027-07-10", p, "A");
    assert.equal(R.validateCheckin(b, "A", rules, at("2027-07-10", t)).ok, true, p);
  }
});

test("statusmaskin: automatisk utsjekk kl. 14, 17 og 24", () => {
  const am = bk("2027-07-10", "AM", "A"), mid = bk("2027-07-10", "MID", "A", { status: "CHECKED_IN" }), pm = bk("2027-07-10", "PM", "A", { status: "CHECKED_IN" });
  assert.equal(R.effectiveStatus(am, rules, at("2027-07-10", "13:59")), "BOOKED");
  assert.equal(R.effectiveStatus(am, rules, at("2027-07-10", "14:00")), "NOT_CONFIRMED");
  assert.equal(R.effectiveStatus({ ...am, status: "CHECKED_IN" }, rules, at("2027-07-10", "14:00")), "COMPLETED");
  assert.equal(R.effectiveStatus(mid, rules, at("2027-07-10", "16:59")), "CHECKED_IN");
  assert.equal(R.effectiveStatus(mid, rules, at("2027-07-10", "17:00")), "COMPLETED");
  assert.equal(R.effectiveStatus(pm, rules, at("2027-07-10", "23:59")), "CHECKED_IN");
  assert.equal(R.effectiveStatus(pm, rules, at("2027-07-11", "00:00")), "COMPLETED");
  assert.equal(R.validateConfirm(am, "A", rules, at("2027-07-11")).ok, true);
});

test("innsjekk på egen booking: fra kl. 10, og sammenhengende perioder følger med", () => {
  const [am, mid, pm] = day("2027-07-10", "A");
  assert.equal(R.validateCheckin(am, "A", rules, at("2027-07-10", "09:59")).error, "TOO_EARLY");
  assert.match(R.validateCheckin(am, "A", rules, at("2027-07-10", "09:59")).message, /10:00/);
  assert.equal(R.validateCheckin(am, "A", rules, at("2027-07-10", "10:00")).ok, true);
  assert.equal(R.validateCheckin(am, "C", rules, at("2027-07-10", "10:05")).error, "FORBIDDEN");
  assert.deepEqual(R.checkinChain(am, [am, mid, pm], rules).map(b => b.period), FULL);
  assert.deepEqual(R.checkinChain(mid, [am, mid, pm], rules).map(b => b.period), ["MID", "PM"]);
  const gap = [am, bk("2027-07-10", "PM", "A")];                                       // formiddag + kveld, ikke ettermiddag
  assert.deepEqual(R.checkinChain(am, gap, rules).map(b => b.period), ["AM"]);
  const other = [am, bk("2027-07-10", "MID", "B")];
  assert.deepEqual(R.checkinChain(am, other, rules).map(b => b.period), ["AM"]);        // annet hus følger ikke med
});

test("spontan innsjekk: pågående ledig periode, eventuelt til 17 eller 24", () => {
  assert.deepEqual(R.spontaneousOptions([], rules, at("2027-07-10", "09:00")), []);   // åpner kl. 10
  assert.deepEqual(R.spontaneousOptions([], rules, at("2027-07-10", "10:00")), ["AM"]);
  assert.deepEqual(R.spontaneousPlans([], rules, at("2027-07-10", "11:00")), [["AM"], ["AM", "MID"], ["AM", "MID", "PM"]]);
  assert.deepEqual(R.spontaneousPlans([], rules, at("2027-07-10", "15:00")), [["MID"], ["MID", "PM"]]);
  assert.deepEqual(R.spontaneousPlans([], rules, at("2027-07-10", "18:00")), [["PM"]]);
  const pmTaken = [bk("2027-07-10", "PM", "B")];
  assert.deepEqual(R.spontaneousPlans(pmTaken, rules, at("2027-07-10", "15:00")), [["MID"]]);
  assert.deepEqual(R.spontaneousPlans([bk("2027-07-10", "MID", "B")], rules, at("2027-07-10", "15:00")), []);
  assert.equal(R.validateSpontaneous({ periods: ["MID", "PM"], household: "D" }, [], rules, at("2027-07-10", "15:00")).quota, false); // Å2
  assert.equal(R.validateSpontaneous({ periods: ["MID", "PM"], household: "D" }, pmTaken, rules, at("2027-07-10", "15:00")).error, "SLOT_TAKEN");
  assert.equal(R.validateSpontaneous({ periods: ["PM"], household: "D" }, [], rules, at("2027-07-10", "15:00")).error, "SLOT_TAKEN"); // må starte med pågående
  assert.equal(R.validateSpontaneous({ period: "PM", household: "D" }, [], rules, at("2027-07-10", "23:00")).ok, true);
});

test("statistikk: perioder (heldag = 3), NOT_CONFIRMED separat, avbestilt teller ikke (Å7)", () => {
  const now = at("2027-07-20");
  const list = [
    ...day("2027-07-03", "A", { status: "COMPLETED" }),          // heldag brukt = 3
    bk("2027-07-10", "AM", "A"),                                  // passert uten innsjekk → NOT_CONFIRMED
    bk("2027-07-11", "PM", "B", { status: "CHECKED_IN" }),        // → COMPLETED
    ...day("2027-07-17", "C", { status: "CANCELLED_LATE" }),
    ...day("2027-07-25", "D"),                                    // fremover = 3
    bk("2027-05-01", "MID", "A", { status: "COMPLETED" }),
    bk("2027-07-12", "FULL", "A", { status: "COMPLETED" })        // gammel nøkkel fra før: hoppes over
  ];
  const s = R.stats(list, rules, now, 2027, 7);
  assert.deepEqual(s.month.A, { used: 3, notConfirmed: 1, upcoming: 0 });
  assert.equal(s.month.B.used, 1);
  assert.deepEqual(s.month.C, { used: 0, notConfirmed: 0, upcoming: 0 });
  assert.equal(s.month.D.upcoming, 3);
  assert.equal(s.season.A.used, 3);
  assert.equal(s.year.A.used, 4);
});
