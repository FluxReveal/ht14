/*
 * HT14 – forslag og stemming (versjon 0.7)
 * ---------------------------------------------------------------
 * Rene funksjoner uten sideeffekter. Samme fil brukes i nettleseren
 * og i Cloudflare Workeren, så status og validering alltid er enige.
 *
 * Frist er en kalenderdato i Europe/Oslo. Avstemningen er åpen hele
 * fristdagen og stenger når Oslo-datoen er dagen etter (eller når
 * administrator lukker den).
 *
 * Krav (settes når forslaget lages):
 *   3av4     – minst 3 av 4 hus sier ja (flertall av alle husene)
 *   4av4     – alle 4 hus sier ja
 *   flertall – flere ja enn nei blant de som har stemt
 *
 * Status: «vedtatt» så snart kravet ikke lenger kan feile, «ikke_vedtatt»
 * så snart det ikke lenger kan oppfylles (eller etter fristen), ellers «apen».
 * Stemmer kan endres så lenge avstemningen er åpen, også etter at status
 * allerede er avgjort – da kan et hus som ombestemmer seg, åpne saken igjen.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Forslag = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HOUSES = ["A", "B", "C", "D"];
  const KRAV = ["3av4", "4av4", "flertall"];
  const KRAV_TEKST = {
    "3av4": "Minst 3 av 4 hus må si ja",
    "4av4": "Alle 4 hus må si ja",
    "flertall": "Flertall av de som stemmer (flere ja enn nei)"
  };
  const STATUS_TEKST = { apen: "Åpen", vedtatt: "Vedtatt", ikke_vedtatt: "Ikke vedtatt" };
  const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  const fail = (error, message) => ({ ok: false, error, message });
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const isDate = s => {
    if (!DATE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
  };

  function kravTekst(krav) { return KRAV_TEKST[krav] || ""; }
  function statusTekst(status) { return STATUS_TEKST[status] || status; }

  /**
   * Beregn resultat og status.
   * forslag: { frist, krav, lukket_at }
   * stemmer: [{ hus, stemme: "ja"|"nei" }]
   * today: "YYYY-MM-DD" i Oslo-tid
   */
  function resultat(forslag, stemmer, today) {
    const ja = (stemmer || []).filter(s => s.stemme === "ja").length;
    const nei = (stemmer || []).filter(s => s.stemme === "nei").length;
    const avgitt = ja + nei;
    const gjenstaar = HOUSES.length - avgitt;
    const ended = !!(forslag && forslag.lukket_at) || !!(today && forslag && today > forslag.frist);
    let vedtatt = false, umulig = false;
    const krav = forslag && forslag.krav;
    if (krav === "3av4") {
      vedtatt = ja >= 3;
      umulig = ja + gjenstaar < 3;
    } else if (krav === "4av4") {
      vedtatt = ja >= 4;
      umulig = nei > 0;
    } else if (krav === "flertall") {
      if (ended) {
        vedtatt = ja > nei;
        umulig = !vedtatt;
      } else {
        vedtatt = ja > nei + gjenstaar;
        umulig = nei >= ja + gjenstaar;
      }
    }
    const status = vedtatt ? "vedtatt" : (ended || umulig) ? "ikke_vedtatt" : "apen";
    return {
      status, ja, nei, avgitt, gjenstaar,
      prosent: avgitt ? Math.round((ja / avgitt) * 100) : null,
      ended, tidlig: !ended && status !== "apen"
    };
  }

  function validateCreate(input, today) {
    const tittel = (typeof input.tittel === "string" ? input.tittel : "").trim();
    const begrunnelse = (typeof input.begrunnelse === "string" ? input.begrunnelse : "").trim();
    const frist = (typeof input.frist === "string" ? input.frist : "").trim();
    const krav = (typeof input.krav === "string" ? input.krav : "").trim();
    if (!tittel) return fail("INVALID_INPUT", "Skriv en tittel på forslaget.");
    if (tittel.length > 120) return fail("INVALID_INPUT", "Tittelen kan være på inntil 120 tegn.");
    if (!begrunnelse) return fail("INVALID_INPUT", "Skriv en begrunnelse, så de andre skjønner bakgrunnen.");
    if (begrunnelse.length > 4000) return fail("INVALID_INPUT", "Begrunnelsen kan være på inntil 4000 tegn.");
    if (!isDate(frist)) return fail("INVALID_INPUT", "Velg en gyldig frist.");
    if (!today || frist < today) return fail("INVALID_INPUT", "Fristen må være i dag eller senere.");
    if (today && frist > addYears(today, 2)) return fail("INVALID_INPUT", "Velg en frist innen to år.");
    if (!KRAV.includes(krav)) return fail("INVALID_INPUT", "Velg hva som skal til for at forslaget blir vedtatt.");
    return ok({ tittel, begrunnelse, frist, krav });
  }

  function addYears(s, n) {
    const [y, m, d] = s.split("-").map(Number);
    const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
    return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }

  function validateVote(input, forslag, stemmer, today) {
    const hus = input && input.hus;
    const stemme = input && input.stemme;
    if (!HOUSES.includes(hus)) return fail("NO_HOUSE", "Stemming er per hus. Innloggingen din er ikke knyttet til et hus, så du kan ikke stemme.");
    if (stemme !== "ja" && stemme !== "nei") return fail("INVALID_INPUT", "Velg ja eller nei.");
    if (!forslag) return fail("NOT_FOUND", "Fant ikke forslaget.");
    if (forslag.lukket_at || (today && today > forslag.frist))
      return fail("CLOSED", "Avstemningen er avsluttet, så stemmen kan ikke endres.");
    return ok({ hus, stemme });
  }

  return {
    HOUSES, KRAV, KRAV_TEKST, STATUS_TEKST,
    isDate, kravTekst, statusTekst, resultat, validateCreate, validateVote
  };
});
