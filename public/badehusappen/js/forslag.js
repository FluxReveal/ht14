/*
 * HT14 – forslag og stemming (versjon 0.8)
 * ---------------------------------------------------------------
 * Rene funksjoner uten sideeffekter. Samme fil brukes i nettleseren
 * og i Cloudflare Workeren, så status og validering alltid er enige.
 *
 * Frist er en kalenderdato i Europe/Oslo. Avstemningen er åpen hele
 * fristdagen og stenger når Oslo-datoen er dagen etter (eller når
 * administrator lukker den).
 *
 * Krav (settes når forslaget eller en ny runde lages):
 *   3av4     – minst 3 av 4 hus sier ja (flertall av alle husene)
 *   4av4     – alle 4 hus sier ja
 *   flertall – flere ja enn nei blant de som har stemt
 *
 * Et forslag kan ha flere avstemningsrunder. Runde 2 brukes når
 * vurderingen sier at endringen koster penger. Stemmer er per runde
 * (UNIQUE forslag_id + runde + hus).
 *
 * Status: «vedtatt» så snart kravet ikke lenger kan feile, «ikke_vedtatt»
 * så snart det ikke lenger kan oppfylles (eller etter fristen), ellers «apen».
 * Stemmer kan endres så lenge avstemningen er åpen, også etter at status
 * allerede er avgjort – da kan et hus som ombestemmer seg, åpne saken igjen.
 *
 * Vurdering (kompleksitet, tiltak, kostnad, tid) og gjennomføring kan bare
 * skrives av administrator, og først når alle fire husene har sagt ja i
 * minst én runde.
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
  const KOMPLEKSITET = ["lav", "middels", "hoy"];
  const KOMPLEKSITET_TEKST = { lav: "Lav", middels: "Middels", hoy: "Høy" };
  const KOSTER = ["nei", "ja", "usikkert"];
  const KOSTER_TEKST = { nei: "Nei", ja: "Ja", usikkert: "Usikkert" };
  const GJENNOMFORING = ["ikke_startet", "planlagt", "pagar", "ferdig"];
  const GJENNOMFORING_TEKST = {
    ikke_startet: "Ikke startet", planlagt: "Planlagt", pagar: "Pågår", ferdig: "Ferdig"
  };
  const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
    "august", "september", "oktober", "november", "desember"];
  const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  const MONTH = /^[0-9]{4}-[0-9]{2}$/;

  const lukketAv = r => (r && (r.lukket_at || r.lukketAt)) || null;
  const fail = (error, message) => ({ ok: false, error, message });
  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const isDate = s => {
    if (!DATE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
  };
  const isYearMonth = s => {
    if (!MONTH.test(s)) return false;
    const m = +s.slice(5, 7);
    return m >= 1 && m <= 12;
  };
  const isTidspunkt = s => isDate(s) || isYearMonth(s);

  function kravTekst(krav) { return KRAV_TEKST[krav] || ""; }
  function statusTekst(status) { return STATUS_TEKST[status] || status; }
  function kompleksitetTekst(v) { return KOMPLEKSITET_TEKST[v] || ""; }
  function kosterTekst(v) { return KOSTER_TEKST[v] || ""; }
  function gjennomforingTekst(v) { return GJENNOMFORING_TEKST[v] || ""; }

  function tidspunktTekst(s) {
    if (!s) return "";
    if (isDate(s)) {
      const [y, m, d] = s.split("-").map(Number);
      return `${d}. ${MONTHS[m - 1]} ${y}`;
    }
    if (isYearMonth(s)) {
      const [y, m] = s.split("-").map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }
    return s;
  }

  function belopTekst(n) {
    if (n == null || n === "") return "";
    const s = String(Math.round(+n));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + " kr";
  }

  function alleJa(stemmer) {
    const list = stemmer || [];
    return HOUSES.every(h => list.some(s => s.hus === h && s.stemme === "ja"));
  }

  /**
   * Beregn resultat og status for én runde.
   * runde: { frist, krav, lukket_at }
   * stemmer: [{ hus, stemme: "ja"|"nei" }]
   * today: "YYYY-MM-DD" i Oslo-tid
   */
  function resultat(forslag, stemmer, today) {
    const ja = (stemmer || []).filter(s => s.stemme === "ja").length;
    const nei = (stemmer || []).filter(s => s.stemme === "nei").length;
    const avgitt = ja + nei;
    const gjenstaar = HOUSES.length - avgitt;
    const ended = !!lukketAv(forslag) || !!(today && forslag && today > forslag.frist);
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

  function rundeMerkelapp(nr, res) {
    if (res.status === "vedtatt") return `Runde ${nr}: vedtatt ${res.ja} av 4`;
    if (res.status === "apen") return `Runde ${nr}: åpen`;
    return `Runde ${nr}: ikke vedtatt`;
  }

  function addYears(s, n) {
    const [y, m, d] = s.split("-").map(Number);
    const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
    return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }

  function validateFristKrav(frist, krav, today) {
    frist = (typeof frist === "string" ? frist : "").trim();
    krav = (typeof krav === "string" ? krav : "").trim();
    if (!isDate(frist)) return fail("INVALID_INPUT", "Velg en gyldig frist.");
    if (!today || frist < today) return fail("INVALID_INPUT", "Fristen må være i dag eller senere.");
    if (today && frist > addYears(today, 2)) return fail("INVALID_INPUT", "Velg en frist innen to år.");
    if (!KRAV.includes(krav)) return fail("INVALID_INPUT", "Velg hva som skal til for at forslaget blir vedtatt.");
    return ok({ frist, krav });
  }

  function validateCreate(input, today) {
    const tittel = (typeof input.tittel === "string" ? input.tittel : "").trim();
    const begrunnelse = (typeof input.begrunnelse === "string" ? input.begrunnelse : "").trim();
    if (!tittel) return fail("INVALID_INPUT", "Skriv en tittel på forslaget.");
    if (tittel.length > 120) return fail("INVALID_INPUT", "Tittelen kan være på inntil 120 tegn.");
    if (!begrunnelse) return fail("INVALID_INPUT", "Skriv en begrunnelse, så de andre skjønner bakgrunnen.");
    if (begrunnelse.length > 4000) return fail("INVALID_INPUT", "Begrunnelsen kan være på inntil 4000 tegn.");
    const fk = validateFristKrav(input.frist, input.krav, today);
    if (!fk.ok) return fk;
    return ok({ tittel, begrunnelse, frist: fk.frist, krav: fk.krav });
  }

  function validateVote(input, runde, stemmer, today) {
    const hus = input && input.hus;
    const stemme = input && input.stemme;
    if (!HOUSES.includes(hus)) return fail("NO_HOUSE", "Stemming er per hus. Innloggingen din er ikke knyttet til et hus, så du kan ikke stemme.");
    if (stemme !== "ja" && stemme !== "nei") return fail("INVALID_INPUT", "Velg ja eller nei.");
    if (!runde) return fail("NOT_FOUND", "Fant ikke forslaget.");
    if (lukketAv(runde) || (today && today > runde.frist))
      return fail("CLOSED", "Avstemningen er avsluttet, så stemmen kan ikke endres.");
    return ok({ hus, stemme, runde: runde.runde || 1 });
  }

  function parseBelop(v) {
    if (v == null || v === "") return null;
    if (typeof v === "string") {
      const t = v.trim().replace(/\s/g, "").replace(",", ".");
      if (!t) return null;
      if (!/^\d+(\.0+)?$/.test(t)) return undefined;
      v = +t;
    }
    if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 999999999 || Math.floor(v) !== v) return undefined;
    return v;
  }

  function validateVurdering(input, admin, runderMedStemmer) {
    if (!admin) return fail("FORBIDDEN", "Bare administrator kan skrive en vurdering.");
    const harAlleJa = (runderMedStemmer || []).some(r => alleJa(r.stemmer));
    if (!harAlleJa) return fail("NOT_READY", "Vurderingen kan skrives når alle fire husene har sagt ja.");
    const kompleksitet = (typeof input.kompleksitet === "string" ? input.kompleksitet : "").trim();
    const tiltak = (typeof input.tiltak === "string" ? input.tiltak : "").trim();
    const koster = (typeof input.koster === "string" ? input.koster : "").trim();
    const tidspunkt = (typeof input.tidspunkt === "string" ? input.tidspunkt : "").trim();
    const tidKommentar = (typeof input.tidKommentar === "string" ? input.tidKommentar : "").trim();
    if (!KOMPLEKSITET.includes(kompleksitet)) return fail("INVALID_INPUT", "Velg om det er lav, middels eller høy kompleksitet.");
    if (!tiltak) return fail("INVALID_INPUT", "Skriv hva som skal til for å gjennomføre endringen.");
    if (tiltak.length > 4000) return fail("INVALID_INPUT", "Beskrivelsen kan være på inntil 4000 tegn.");
    if (!KOSTER.includes(koster)) return fail("INVALID_INPUT", "Si om det koster penger: nei, ja eller usikkert.");
    const belop = parseBelop(input.belopKr);
    if (belop === undefined) return fail("INVALID_INPUT", "Anslaget må være et helt antall kroner, uten øre.");
    if (koster !== "ja" && belop != null) return fail("INVALID_INPUT", "Beløp hører bare med når det koster penger.");
    if (!isTidspunkt(tidspunkt)) return fail("INVALID_INPUT", "Oppgi når det kan gjennomføres, som måned (2027-03) eller dato.");
    if (tidKommentar.length > 1000) return fail("INVALID_INPUT", "Kommentaren kan være på inntil 1000 tegn.");
    return ok({
      kompleksitet, tiltak, koster,
      belopKr: koster === "ja" ? belop : null,
      tidspunkt, tidKommentar: tidKommentar || null
    });
  }

  function validateNyRunde(input, admin, vurdering, runder, stemmer, today) {
    if (!admin) return fail("FORBIDDEN", "Bare administrator kan sende forslaget til ny avstemning.");
    if (!vurdering || vurdering.koster !== "ja")
      return fail("NOT_READY", "Ny avstemning kan sendes ut når vurderingen sier at det koster penger.");
    const open = (runder || []).some(r => !lukketAv(r) && today && today <= r.frist);
    if (open) return fail("OPEN_ROUND", "Det er allerede en åpen avstemning på dette forslaget. Lukke den først, eller vent til fristen.");
    const krav = (typeof input.krav === "string" && input.krav.trim()) ? input.krav.trim() : "4av4";
    return validateFristKrav(input.frist, krav, today);
  }

  function validateGjennomforing(input, admin, harVurdering) {
    if (!admin) return fail("FORBIDDEN", "Bare administrator kan sette gjennomføring.");
    if (!harVurdering) return fail("NOT_READY", "Gjennomføring kan settes etter at vurderingen er skrevet.");
    const v = (typeof input === "string" ? input : (input && input.gjennomforing) || "").trim();
    if (!GJENNOMFORING.includes(v)) return fail("INVALID_INPUT", "Velg ikke startet, planlagt, pågår eller ferdig.");
    return ok({ gjennomforing: v });
  }

  /** Sett sammen visningen av et forslag med alle runder. */
  function samle(row, runder, stemmer, today, bruker) {
    const hus = bruker && bruker.hus, admin = !!(bruker && bruker.admin);
    const src = (runder && runder.length ? runder.slice() : [{
      runde: 1, frist: row.frist, krav: row.krav, lukket_at: row.lukket_at
    }]).sort((a, b) => a.runde - b.runde);
    const rundetall = src.map(r => {
      const list = (stemmer || []).filter(s => (s.runde || 1) === (r.runde || 1));
      const res = resultat(r, list, today);
      const min = list.find(s => s.hus === hus);
      return {
        runde: r.runde || 1, frist: r.frist, krav: r.krav, kravTekst: kravTekst(r.krav),
        lukketAt: r.lukket_at || null,
        status: res.status, statusTekst: statusTekst(res.status),
        ja: res.ja, nei: res.nei, avgitt: res.avgitt, gjenstaar: res.gjenstaar,
        prosent: res.prosent, tidlig: res.tidlig, ended: res.ended,
        stemmer: list, minStemme: min ? min.stemme : null,
        kanStemme: !!(hus && HOUSES.includes(hus) && !r.lukket_at && today && today <= r.frist),
        alleJa: alleJa(list), merkelapp: rundeMerkelapp(r.runde || 1, res)
      };
    });
    const aktiv = [...rundetall].reverse().find(r => r.status === "apen") || rundetall[rundetall.length - 1];
    const harAlleJa = rundetall.some(r => r.alleJa);
    const vurdering = row.vurdering_at || row.kompleksitet ? {
      kompleksitet: row.kompleksitet, kompleksitetTekst: kompleksitetTekst(row.kompleksitet),
      tiltak: row.tiltak || "", koster: row.koster, kosterTekst: kosterTekst(row.koster),
      belopKr: row.belop_kr == null ? null : row.belop_kr,
      belopTekst: row.koster === "ja" && row.belop_kr != null ? belopTekst(row.belop_kr) : "",
      tidspunkt: row.tidspunkt || "", tidspunktTekst: tidspunktTekst(row.tidspunkt || ""),
      tidKommentar: row.tid_kommentar || "",
      oppdatert: row.vurdering_at || null
    } : null;
    return {
      id: String(row.id), tittel: row.tittel, begrunnelse: row.begrunnelse,
      hus: row.opprettet_av_hus, createdAt: row.created_at,
      runder: rundetall, aktivRunde: aktiv ? aktiv.runde : 1,
      frist: aktiv.frist, krav: aktiv.krav, kravTekst: aktiv.kravTekst, lukketAt: aktiv.lukketAt,
      status: aktiv.status, statusTekst: aktiv.statusTekst,
      ja: aktiv.ja, nei: aktiv.nei, avgitt: aktiv.avgitt, gjenstaar: aktiv.gjenstaar,
      prosent: aktiv.prosent, tidlig: aktiv.tidlig, ended: aktiv.ended,
      stemmer: aktiv.stemmer, minStemme: aktiv.minStemme, kanStemme: aktiv.kanStemme,
      vurdering,
      gjennomforing: row.gjennomforing || null,
      gjennomforingTekst: gjennomforingTekst(row.gjennomforing || "") || null,
      kanVurdere: !!(admin && harAlleJa),
      kanNyRunde: !!(admin && vurdering && vurdering.koster === "ja" && !rundetall.some(r => !r.lukketAt && today && today <= r.frist)),
      kanSetteGjennomforing: !!(admin && vurdering)
    };
  }

  return {
    HOUSES, KRAV, KRAV_TEKST, STATUS_TEKST,
    KOMPLEKSITET, KOSTER, GJENNOMFORING,
    isDate, isTidspunkt, kravTekst, statusTekst,
    kompleksitetTekst, kosterTekst, gjennomforingTekst, tidspunktTekst, belopTekst,
    alleJa, resultat, rundeMerkelapp, samle,
    validateCreate, validateVote, validateVurdering, validateNyRunde, validateGjennomforing
  };
});
