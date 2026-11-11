// Enhetstester for vedtakslogikken (public/badehusappen/js/forslag.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const F = createRequire(import.meta.url)("../../public/badehusappen/js/forslag.js");

const ja = hus => ({ hus, stemme: "ja" });
const nei = hus => ({ hus, stemme: "nei" });
const r = (krav, stemmer, today = "2026-11-11", frist = "2026-11-20", lukket_at = null) =>
  F.resultat({ krav, frist, lukket_at }, stemmer, today);

test("3av4: åpen med 0–2 ja, vedtatt ved 3 ja (også før fristen)", () => {
  assert.equal(r("3av4", []).status, "apen");
  assert.equal(r("3av4", [ja("A")]).status, "apen");
  assert.equal(r("3av4", [ja("A"), ja("B")]).status, "apen");
  const tre = r("3av4", [ja("A"), ja("B"), ja("C")]);
  assert.equal(tre.status, "vedtatt");
  assert.equal(tre.tidlig, true);
  assert.equal(tre.ja, 3);
  assert.equal(tre.nei, 0);
  assert.equal(tre.prosent, 100);
  assert.equal(r("3av4", [ja("A"), ja("B"), ja("C"), ja("D")]).status, "vedtatt");
});

test("3av4: umulig (2 nei) gir Ikke vedtatt før fristen; 1 nei er fortsatt åpent", () => {
  assert.equal(r("3av4", [nei("A")]).status, "apen");
  const umulig = r("3av4", [nei("A"), nei("B")]);
  assert.equal(umulig.status, "ikke_vedtatt");
  assert.equal(umulig.tidlig, true);
  assert.equal(r("3av4", [ja("A"), ja("B"), nei("C"), nei("D")]).status, "ikke_vedtatt");
});

test("3av4 etter fristen: 3 ja = vedtatt, 2 ja = ikke vedtatt, 0 stemmer = ikke vedtatt", () => {
  assert.equal(r("3av4", [ja("A"), ja("B"), ja("C")], "2026-11-21").status, "vedtatt");
  assert.equal(r("3av4", [ja("A"), ja("B")], "2026-11-21").status, "ikke_vedtatt");
  assert.equal(r("3av4", [], "2026-11-21").status, "ikke_vedtatt");
  // Hele fristdagen er åpen
  assert.equal(r("3av4", [ja("A")], "2026-11-20").status, "apen");
});

test("4av4: vedtatt bare når alle 4 sier ja; ett nei gjør det umulig med en gang", () => {
  assert.equal(r("4av4", [ja("A"), ja("B"), ja("C")]).status, "apen");
  assert.equal(r("4av4", [ja("A"), ja("B"), ja("C"), ja("D")]).status, "vedtatt");
  const ettNei = r("4av4", [nei("A")]);
  assert.equal(ettNei.status, "ikke_vedtatt");
  assert.equal(ettNei.tidlig, true);
  assert.equal(r("4av4", [ja("A"), ja("B"), ja("C"), nei("D")]).status, "ikke_vedtatt");
});

test("flertall: avgjøres etter fristen (flere ja enn nei); uavgjort er ikke vedtatt", () => {
  assert.equal(r("flertall", [ja("A")], "2026-11-21").status, "vedtatt");
  assert.equal(r("flertall", [ja("A"), nei("B")], "2026-11-21").status, "ikke_vedtatt");
  assert.equal(r("flertall", [ja("A"), ja("B"), nei("C"), nei("D")], "2026-11-21").status, "ikke_vedtatt");
  assert.equal(r("flertall", [ja("A"), ja("B"), ja("C"), nei("D")], "2026-11-21").status, "vedtatt");
  assert.equal(r("flertall", [], "2026-11-21").status, "ikke_vedtatt");
  assert.equal(r("flertall", [nei("A")], "2026-11-21").status, "ikke_vedtatt");
});

test("flertall før fristen: tidlig vedtatt/ikke vedtatt bare når utfallet ikke lenger kan snus", () => {
  assert.equal(r("flertall", [ja("A")]).status, "apen");              // 3 kan fortsatt stemme nei
  assert.equal(r("flertall", [ja("A"), ja("B")]).status, "apen");    // 2 gjenstår
  const sikkert = r("flertall", [ja("A"), ja("B"), ja("C")]);        // 3>0+1
  assert.equal(sikkert.status, "vedtatt");
  assert.equal(sikkert.tidlig, true);
  const tapt = r("flertall", [nei("A"), nei("B"), nei("C")]);        // 0+1 <= 3
  assert.equal(tapt.status, "ikke_vedtatt");
  assert.equal(r("flertall", []).status, "apen");
  assert.equal(r("flertall", [ja("A"), ja("B"), nei("C"), nei("D")]).status, "ikke_vedtatt");
});

test("prosent og antall: 2 ja og 1 nei er 67 %, 0 stemmer gir null prosent", () => {
  const x = r("3av4", [ja("A"), ja("B"), nei("C")]);
  assert.equal(x.ja, 2); assert.equal(x.nei, 1); assert.equal(x.avgitt, 3);
  assert.equal(x.gjenstaar, 1); assert.equal(x.prosent, 67);
  assert.equal(r("3av4", []).prosent, null);
  assert.equal(r("3av4", [ja("A")]).prosent, 100);
});

test("admin lukker: behandles som om fristen er ute, også på fristdagen", () => {
  assert.equal(r("3av4", [ja("A"), ja("B")], "2026-11-11", "2026-11-20", "2026-11-11T10:00:00Z").status, "ikke_vedtatt");
  assert.equal(r("3av4", [ja("A"), ja("B"), ja("C")], "2026-11-11", "2026-11-20", "2026-11-11T10:00:00Z").status, "vedtatt");
  assert.equal(r("flertall", [ja("A")], "2026-11-11", "2026-11-20", "2026-11-11T10:00:00Z").status, "vedtatt");
});

test("validateCreate: tittel, begrunnelse, frist i dag eller senere, kjent krav", () => {
  const today = "2026-11-11";
  const base = { tittel: "Nytt tak", begrunnelse: "Det lekker.", frist: "2026-12-01", krav: "3av4" };
  assert.equal(F.validateCreate(base, today).ok, true);
  assert.equal(F.validateCreate({ ...base, tittel: "  Nytt tak  " }, today).tittel, "Nytt tak");
  assert.equal(F.validateCreate({ ...base, tittel: "" }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, tittel: "x".repeat(121) }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, begrunnelse: "" }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, begrunnelse: "x".repeat(4001) }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, frist: "2026-11-10" }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, frist: "2026-11-11" }, today).ok, true, "i dag er gyldig (åpent ut dagen)");
  assert.equal(F.validateCreate({ ...base, frist: "i-morgen" }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, frist: "2029-11-11" }, today).error, "INVALID_INPUT");
  assert.equal(F.validateCreate({ ...base, krav: "2av4" }, today).error, "INVALID_INPUT");
});

test("validateVote: bare A–D, ja/nei, og bare mens avstemningen er åpen", () => {
  const f = { krav: "3av4", frist: "2026-11-20", lukket_at: null };
  assert.equal(F.validateVote({ hus: "A", stemme: "ja" }, f, [], "2026-11-11").ok, true);
  assert.equal(F.validateVote({ hus: "A", stemme: "nei" }, f, [], "2026-11-11").ok, true);
  assert.equal(F.validateVote({ hus: "A", stemme: "ja" }, f, [], "2026-11-20").ok, true, "hele fristdagen");
  assert.equal(F.validateVote({ hus: "E", stemme: "ja" }, f, [], "2026-11-11").error, "NO_HOUSE");
  assert.equal(F.validateVote({ hus: null, stemme: "ja" }, f, [], "2026-11-11").error, "NO_HOUSE");
  assert.equal(F.validateVote({ hus: "A", stemme: "kanskje" }, f, [], "2026-11-11").error, "INVALID_INPUT");
  assert.equal(F.validateVote({ hus: "A", stemme: "ja" }, f, [], "2026-11-21").error, "CLOSED");
  assert.equal(F.validateVote({ hus: "A", stemme: "ja" }, { ...f, lukket_at: "2026-11-11T09:00:00Z" }, [], "2026-11-11").error, "CLOSED");
  // Stemmeendring er tillatt så lenge det er åpent (selv om 3 allerede har sagt ja)
  assert.equal(F.validateVote({ hus: "A", stemme: "nei" }, f, [ja("A"), ja("B"), ja("C")], "2026-11-11").ok, true);
});
