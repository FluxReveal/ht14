#!/usr/bin/env python3
"""Generator for ht14.no: setter sammen dokumentasjonssidene fra tools/src/*.html med felles layout,
og lager startsiden. Resultatet havner i public/ og er ren statisk HTML – Workeren trenger ikke noe byggesteg.
Kjør fra repo-roten:  python3 tools/build.py"""
import re, json, html, calendar, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent          # tools/
PUBLIC = ROOT.parent / "public"                         # det som serveres på ht14.no
OUT = PUBLIC / "dokumentasjon"
APP = "Badehusappen"

PAGES = [
  ("teknisk.html",     "Teknisk dokumentasjon",            "Dokumentasjon"),
  ("regler.html",      "Regler for bruk av badehuset",     "Dokumentasjon"),
  ("vedtekter.html",   "Forslag til tillegg i vedtektene", "Dokumentasjon"),
  ("arshjul.html",     "Årshjul",                          "Dokumentasjon"),
  ("hva-er-nytt.html", "Hva er nytt",                      "Dokumentasjon"),
]
# Gamle adresser blir små videresendingssider (noindex), så gamle lenker virker.
# Verdien er standardmålet; avsnitt (#…) oversettes i redirect_map() nedenfor.
REDIRECTS = {
  "index.html":        "teknisk.html",
  "om-losningen.html": "teknisk.html",
  "beskrivelse.html":  "teknisk.html#kort-for-alle",
  "hld.html":          "teknisk.html#hld",
  "lld.html":          "teknisk.html#lld",
  "brukermanual.html": "regler.html#badehusappen",
  "adminmanual.html":  "teknisk.html#drift",
  "beslutninger.html": "/",
}
# Gamle avsnitt på sider som beholder adressen
ALIASES = {
  "regler.html": {"reglene-pa-n-side": "reglene-kort", "kan-jeg-booke-denne-dagen": "reglene-kort",
                  "dager-telles-ikke-perioder": "regel-3", "innsjekk-utsjekk-og-bekreftelse": "innsjekk",
                  "helg-over-to-maneder": "regel-4", "utenfor-sommer-september-mai": "regel-2",
                  "administrator-overstyrer": "innsjekk", "statistikk-hvordan-bruk-telles": "statistikk"},
}

LOGO = '''<svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#0891b2"/><path d="M10 25 24 13l14 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="15" y="24" width="18" height="12" rx="2" fill="#fff"/><path d="M8 40c3-2 5-2 8 0s5 2 8 0 5-2 8 0 5 2 8 0" fill="none" stroke="#a5f3fc" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="30" r="2" fill="#2563eb"/><circle cx="28" cy="30" r="2" fill="#16a34a"/></svg>'''
FAVICON = "data:image/svg+xml," + LOGO.replace('"', "'").replace("#", "%23").replace("\n", "")
SEARCH_ICO = '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9cc3d1" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>'
BURGER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'

def slug(t):
    t = t.lower().replace("æ", "ae").replace("ø", "o").replace("å", "a")
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:60] or "seksjon"

def strip_tags(s):
    s = re.sub(r"<pre class=\"mermaid\".*?</pre>", " ", s, flags=re.S)
    s = re.sub(r"<svg.*?</svg>", " ", s, flags=re.S)
    s = re.sub(r"<table class=\"cal\".*?</table>", " ", s, flags=re.S)
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

# ---------------------------------------------------------------
# Kalender-generator (HTML-tabell) brukt i regler og manualer
# events: {dag: [(klasse, tekst), ...]}  klasse: a|b|c|d|x|ok (+ " half")
# ---------------------------------------------------------------
MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"]
def cal(year, month, events=None, blocked=(), today=None, caption=""):
    events = events or {}
    c = calendar.Calendar(firstweekday=0)
    rows = []
    for week in c.monthdayscalendar(year, month):
        tds = []
        for i, d in enumerate(week):
            if d == 0:
                tds.append('<td class="out"></td>'); continue
            cls = []
            if i >= 4: cls.append("wk")
            if d in blocked: cls.append("blocked")
            if d == today: cls.append("today")
            inner = f'<span class="d">{d}</span>'
            for k, t in events.get(d, []):
                inner += f'<span class="p {k}" title="{html.escape(t)}">{t}</span>'
            tds.append(f'<td class="{" ".join(cls)}">{inner}</td>')
        rows.append("<tr>" + "".join(tds) + "</tr>")
    head = "".join(f"<th>{d}</th>" for d in ["Man","Tir","Ons","Tor","Fre","Lør","Søn"])
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return (f'<figure><div style="font-weight:700;margin-bottom:6px">{MONTHS[month-1].capitalize()} {year}</div>'
            f'<table class="cal" aria-label="Kalender {MONTHS[month-1]} {year}"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>{cap}</figure>')

CALS = {
 # Oversikt / beskrivelse: en typisk juli
 "juli-typisk": cal(2027, 7, {
     2: [("a","Hus A")], 3: [("b","Hus B")], 4: [("c","Hus C")],
     9: [("d","Hus D")], 10: [("a half","10–17 A"),("c half","17–24 C")], 11: [("b","Hus B")],
     14: [("c half","10–14 C")], 16: [("b","Hus B")], 17: [("d","Hus D")], 18: [("a","Hus A")],
     21: [("d half","17–24 D")], 23: [("c","Hus C")], 25: [("d","Hus D")],
     27: [("b","Hus B")]},
     caption="Eksempel (fiktive data): fargen viser hvilken husstand som har dagen. Har flere hus samme dag, vises hver del som et eget felt."),
 # Regel: maks 1 fredag/lørdag/søndag per måned
 "regel-kvote": cal(2027, 7, {
     2: [("a","Hus A ✓")], 10: [("a","Hus A ✓")], 18: [("a","Hus A ✓")],
     9: [("x","A: 2. fredag ✗")], 24: [("x","A: 2. lørdag ✗")]},
     caption="Hus A har allerede én fredag (2.), én lørdag (10.) og én søndag (18.) i juli. Nye forsøk (gjort mer enn 7 dager i forveien) på fredag 9. og lørdag 24. avvises."),
 # Regel: helgebegrensning
 "regel-helg": cal(2027, 8, {
     6: [("b","Hus B ✓")], 7: [("x","B: lør ✗")], 8: [("x","B: søn ✗")],
     14: [("ok","B: lør ✓ (ny helg)")]},
     caption="Hus B har fredag 6. august. Lørdag 7. og søndag 8. samme helg avvises. Lørdag 14. er en ny helg og er greit (B har ingen lørdag i august ennå)."),
 # Regel: 7-dagersregel
 "regel-7dager": cal(2027, 7, {
     2: [("a","Hus A")], 3: [("a","Hus A")], 4: [("a","Hus A")]},
     blocked=(), today=1,
     caption="I dag er 1. juli (markert). Fredag 2. – søndag 4. er under 7 dager unna: sommerbegrensningene gjelder ikke, førstemann til mølla."),
 # Regel: sen avbestilling
 "regel-avbestill": cal(2027, 7, {
     16: [("x","B: avbestilt sent")], 23: [("x","B: fre ✗ kvote brukt")]},
     today=12,
     caption="I dag er 12. juli. Hus B avbestiller fredag 16. (4 dager før) → CANCELLED_LATE: dagen blir ledig for andre, men teller fortsatt som Hus Bs fredag i juli. Et nytt forsøk på fredag 23. (11 dager frem) avvises derfor."),
 # Regel: helg over to måneder
 "regel-maanedsskifte": cal(2027, 7, {
     30: [("c","Hus C fre")], 31: [("x","C: lør ✗")]},
     caption="Fredag 30. juli – søndag 1. august er én helg. Forslaget: kvoten telles i datoens måned, men helgeregelen følger helgen (fre–søn)."),
 # Brukermanual: kalendervisning
 "manual-kalender": cal(2027, 7, {
     2: [("a","Hus A")], 3: [("b","Hus B")], 10: [("a half","10–14 A")],
     12: [("b half","14–24 B")], 17: [("d","Hus D")], 18: [("c","Hus C")], 24: [("c","Hus C")]},
     today=8, caption="Månedskalenderen: hver husstand har sin faste farge. Trykk på en dato for detaljer."),
}


# ---------------------------------------------------------------
# Meta-linjen øverst: kategori (eyebrow) og lesetid beholdes.
# Versjon, godkjenning og status fjernes alltid.
# ---------------------------------------------------------------
BANNED_CHIP = re.compile(r'\s*<span class="chip (?:draft|regel|teknisk|ok)[^"]*">.*?</span>', re.S)
BANNED_TEXT = re.compile(r'\s*<span class="chip">\s*(?:Status|Utkast|Planlagt|Til drøfting|Ca\. \d+ minutter? å lese|v\d)[^<]*</span>', re.S)
def clean_meta(body):
    def fix(m):
        inner = BANNED_TEXT.sub("", BANNED_CHIP.sub("", m.group(1)))
        return '<div class="meta">' + inner + '</div>'
    return re.sub(r'<div class="meta">(.*?)</div>', fix, body, count=1, flags=re.S)

def add_lesetid(body):
    words = len(strip_tags(body).split())
    mins = max(1, round(words / 200))
    chip = f'<span class="chip">⏱ Ca. {mins} min lesetid</span>'
    if '<div class="meta">' in body:
        return body.replace('<div class="meta">', '<div class="meta">' + chip, 1)
    return body

FORBIDDEN = [r'class="chip draft', r'class="chip regel', r'class="chip teknisk', r'badge-regel', r'badge-teknisk',
             r'badge-forslag', r'badge-vedtatt', r'callout status', r'callout regel', r'callout teknisk',
             r'draft-banner', r'\bv0\.\d', r'Badehus Booking',
             r'/HT14/', r'fluxreveal\.com', r'workers\.dev', r'GitHub Pages', r'Workers KV']
def guard(fname, page):
    for f in FORBIDDEN:
        assert not re.search(f, page), (fname, f, re.search(f, page).group(0))

def nav_html(current):
    # Felles meny for hele HT14: Sameiet HT14 → Hjem / Badehusappen, og dokumentasjonssidene under.
    items = ['<li class="nav-label">Sameiet HT14</li>',
        '<li><a href="/"><span class="num">⌂</span>Hjem</a></li>',
        '<li><a href="/badehusappen/"><span class="num">📱</span>Badehusappen <small>utkast</small></a></li>',
        '<li class="nav-label">Dokumentasjon</li>']
    for i, (f, t, g) in enumerate(PAGES, 1):
        cur = ' aria-current="page"' if f == current else ""
        items.append(f'<li><a href="{f}" data-sok{cur}><span class="num">{i}</span>{t}</a></li>')
    return "\n".join(items)

def redirect_page(base, mapping):
    """Liten side som sender videre til ny adresse (og riktig avsnitt hvis mulig)."""
    js = json.dumps(mapping, ensure_ascii=False)
    return f'''<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Flyttet – Sameiet HT14</title>
<link rel="canonical" href="{base}">
<meta http-equiv="refresh" content="0; url={base}">
<script>(function(){{var m={js},h=location.hash.slice(1);location.replace(m[h]||"{base}");}})();</script>
<style>body{{font:17px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#0f172a}}a{{color:#0e7490}}</style>
</head>
<body>
<p>Denne siden har flyttet. <a href="{base}">Gå videre</a>.</p>
</body>
</html>
'''

def layout(fname, title, body, needs_mermaid, desc, extra_head="", extra_foot=""):
    idx = [p[0] for p in PAGES].index(fname)
    prev = PAGES[idx-1] if idx > 0 else None
    nxt = PAGES[idx+1] if idx < len(PAGES)-1 else None
    pn = '<nav class="pagenav" aria-label="Forrige og neste side">'
    pn += f'<a class="prev" href="{prev[0]}"><small>← Forrige</small>{prev[1]}</a>' if prev else "<span></span>"
    pn += f'<a class="next" href="{nxt[0]}"><small>Neste →</small>{nxt[1]}</a>' if nxt else "<span></span>"
    pn += "</nav>"
    mm = '\n<script type="module" src="mermaid-init.js"></script>' if needs_mermaid else ""
    return f'''<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} – Dokumentasjon – Sameiet HT14</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="style.css?v=20261026a">
<script src="app.js?v=20261026a" defer></script>{mm}{extra_head}
</head>
<body>
<a href="#innhold" class="chip" style="position:absolute;left:-9999px" onfocus="this.style.left='8px'">Hopp til innhold</a>
<header class="topbar">
  <button class="hamburger" aria-label="Åpne meny" aria-expanded="false" aria-controls="sidemeny">{BURGER}</button>
  <a class="topbar-home" href="/"><b>Sameiet HT14</b></a><span class="topbar-sep" aria-hidden="true">›</span><span>Dokumentasjon</span>
  <a class="topbar-app" href="/badehusappen/">Badehusappen</a>
</header>
<div class="scrim"></div>
<nav class="sidebar" id="sidemeny" aria-label="Hovedmeny">
  <a class="brand" href="/">{LOGO}<span><b>Sameiet HT14</b><small>Halden Terrasse 14</small></span></a>
  <div class="search" role="search">{SEARCH_ICO}
    <input id="sok" type="search" placeholder="Søk i dokumentasjonen  ( / )" aria-label="Søk i dokumentasjonen" autocomplete="off">
    <ul id="sok-resultat" class="search-results" aria-live="polite"></ul>
  </div>
  <ul class="nav">
{nav_html(fname)}
  </ul>
  <div class="side-foot">
    <div class="legend-mini"><span style="background:var(--hus-a)">A</span><span style="background:var(--hus-b)">B</span><span style="background:var(--hus-c)">C</span><span style="background:var(--hus-d)">D</span></div>
    Laget av Thomas for oss i HT14.
  </div>
</nav>
<main class="main" id="innhold">
  <div class="content-wrap">
    <article>
{body}
{pn}
      <p class="footer">Sameiet HT14. Et utkast til Badehusappen kan prøves på <a href="/badehusappen/">ht14.no/badehusappen/</a> – bookingene lagres foreløpig bare på din egen telefon. Navn i eksemplene er oppdiktet. Spørsmål eller ideer? Si fra til Thomas.</p>
    </article>
    <aside class="toc" aria-label="Innhold på denne siden"><h4>På denne siden</h4><ol></ol></aside>
  </div>
</main>{extra_foot}
</body>
</html>
'''

def main():
    import gen_start
    GENERATED = {
        "arshjul.html": (gen_start.ARSHJUL_BODY, "\n<style>" + gen_start.ARSHJUL_CSS + "</style>", "\n" + gen_start.ARSHJUL_JS),
        "hva-er-nytt.html": (gen_start.nytt_body(""), "\n<style>" + gen_start.ARSHJUL_CSS + "</style>", ""),
    }
    search = []
    for fname, title, _ in PAGES:
        extra_head = extra_foot = ""
        if fname in GENERATED:
            raw, extra_head, extra_foot = GENERATED[fname]
        else:
            raw = (ROOT / "src" / fname).read_text(encoding="utf-8")
        if fname in ALIASES:
            extra_head += ('\n<script>(function(){var m=' + json.dumps(ALIASES[fname]) +
                           ',h=location.hash.slice(1);if(m[h])location.replace("#"+m[h]);})();</script>')
        m = re.match(r"<!--\s*desc:(.*?)-->\s*", raw, re.S)
        desc = m.group(1).strip() if m else title
        body = raw[m.end():] if m else raw
        for ph in ("{{STATUS}}", "{{TEKNISK}}", "{{REGEL}}", "{{DETALJ}}", "{{FORSLAG}}", "{{VEDTATT}}"):
            body = body.replace(ph, "")
        body = clean_meta(body)
        body = add_lesetid(body)
        for k, v in CALS.items():
            body = body.replace("{{CAL:%s}}" % k, v)
        assert "{{" not in body, (fname, re.findall(r"\{\{[^}]*\}\}", body))
        used = set()
        def addid(mo):
            tag, attrs, inner = mo.group(1), mo.group(2), mo.group(3)
            if "id=" in attrs:
                used.add(re.search(r'id="([^"]+)"', attrs).group(1)); return mo.group(0)
            s_ = slug(strip_tags(inner))
            while s_ in used: s_ += "-x"
            used.add(s_)
            return f'<h{tag} id="{s_}"{attrs}>{inner}</h{tag}>'
        body = re.sub(r"<h([23])([^>]*)>(.*?)</h\1>", addid, body, flags=re.S)
        parts = re.split(r'(<h[23] id="[^"]+"[^>]*>.*?</h[23]>)', body, flags=re.S)
        search.append(fname)
        search += [1 for i in range(1, len(parts), 2)]
        needs_mm = 'class="mermaid"' in body
        page = layout(fname, title, body, needs_mm, desc, extra_head, extra_foot)
        guard(fname, page)
        (OUT / fname).write_text(page, encoding="utf-8")
    rmap = json.load(open(ROOT / "redirects.json", encoding="utf-8"))
    for old, target in REDIRECTS.items():
        (OUT / old).write_text(redirect_page(target, rmap.get(old, {})), encoding="utf-8")
    n = gen_start.write_start(LOGO, PUBLIC / "index.html")
    print("ok", len(PAGES), "sider,", len(search), "søkeoppføringer,", len(REDIRECTS), "omdirigeringer, startside", n)

if __name__ == "__main__":
    main()
