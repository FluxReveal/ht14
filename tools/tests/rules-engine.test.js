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
  assert.equal(R.weekendKey("2027-08-01"), "2027-07-30");      // søndag 1. aug → fredag 30. juli
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
  assert.equal(multi("2027-07-10", FULL, "C", day("2027-07-10", "A", { status: "CANCELLED_LATE" })).ok, true);
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

test("④ helgebegrensning: én dag per helg (uansett antall perioder)", () => {
  const ex = day("2027-07-09", "B");
  assert.equal(multi("2027-07-10", FULL, "B", ex).error, "WEEKEND_LIMIT");
  assert.equal(multi("2027-07-11", ["AM"], "B", ex).error, "WEEKEND_LIMIT");
  assert.equal(multi("2027-07-17", FULL, "B", ex).ok, true);                          // neste helg, lørdag
});

test("Å3: helg over månedsskifte – kvote følger datoen, helgeregel følger helgen", () => {
  const ex = [...day("2027-07-30", "C"), bk("2027-07-02", "PM", "C", { status: "COMPLETED" })];
  assert.equal(multi("2027-08-01", FULL, "C", ex).error, "WEEKEND_LIMIT");
  assert.equal(multi("2027-08-08", FULL, "C", ex).ok, true);                          // august-søndag, annen helg
});

test("⑤ 7-dagersregel: under 7 dager → førstemann til mølla og ikke kvote (Å1)", () => {
  const now = at("2027-07-04", "08:00");
  const ex = [...day("2027-07-02", "A", { status: "COMPLETED" }), ...day("2027-07-03", "A")];
  const fre = multi("2027-07-09", FULL, "A", ex, now);                               // 5 dager før
  assert.equal(fre.ok, true); assert.equal(fre.lifted, true); assert.equal(fre.quota, false);
  assert.equal(multi("2027-07-10", ["MID"], "A", ex, now).ok, true);                  // 6 dager før
  assert.equal(multi("2027-07-11", FULL, "A", ex, now).ok, true);                     // 7 dager før → regler gjelder, men ingen søndag brukt ennå
  const ex2 = ex.concat([bk("2027-07-04", "PM", "A")]);                               // søndag 4. juli med kvote
  assert.equal(multi("2027-07-11", ["AM"], "A", ex2, now).error, "QUOTA_WEEKDAY");
});

test("Å4: utenfor sommer ingen begrensninger", () => {
  const ex = day("2027-09-03", "D");
  assert.equal(multi("2027-09-04", FULL, "D", ex, at("2027-07-01")).ok, true);
  assert.equal(multi("2027-09-10", FULL, "D", ex, at("2027-07-01")).ok, true);
});

test("⑥ avbestilling per periode: tidlig vs. sen, og sen teller i kvoten", () => {
  const b = bk("2027-07-10", "MID", "A");
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-02")).status, "CANCELLED");      // 8 dager før
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-03")).status, "CANCELLED_LATE"); // 7 dager før
  assert.match(R.validateCancel(b, "A", rules, at("2027-07-03")).message, /Ettermiddagen blir ledig/);
  assert.equal(R.validateCancel(b, "B", rules, at("2027-07-02")).error, "FORBIDDEN");       // Å6
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-10", "17:00")).error, "NOT_CANCELLABLE"); // perioden er over
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-10", "15:00")).ok, true);              // pågår: kan frigis til andre
  const late = [bk("2027-07-10", "PM", "A", { status: "CANCELLED_LATE" })];
  assert.equal(multi("2027-07-24", FULL, "A", late).error, "QUOTA_WEEKDAY");                 // teller fortsatt
  const early = [bk("2027-07-10", "PM", "A", { status: "CANCELLED" })];
  assert.equal(multi("2027-07-24", FULL, "A", early).ok, true);                              // ut av kvoten
  // avbestiller bare kvelden av en heldag tidlig → lørdagen teller fortsatt (formiddag og ettermiddag står)
  const partly = [bk("2027-07-10", "AM", "A"), bk("2027-07-10", "MID", "A"), bk("2027-07-10", "PM", "A", { status: "CANCELLED" })];
  assert.equal(multi("2027-07-24", ["PM"], "A", partly).error, "QUOTA_WEEKDAY");
  // og den ledige kvelden kan tas av et annet hus
  assert.equal(multi("2027-07-10", ["PM"], "C", partly).ok, true);
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
