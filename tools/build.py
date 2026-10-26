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
  "regler.html": {"reglene-pa-n-side": "maal", "kan-jeg-booke-denne-dagen": "hvor-mye", "reglene-kort": "maal",
                  "regel-1": "perioder", "regel-2": "hvor-mye", "regel-3": "hvor-mye", "regel-4": "hvor-mye", "regel-5": "hvor-mye",
                  "dager-telles-ikke-perioder": "hvor-mye", "helg-over-to-maneder": "hvor-mye", "utenfor-sommer-september-mai": "hvor-mye",
                  "regel-6": "avbestille", "innsjekk": "avbestille", "innsjekk-utsjekk-og-bekreftelse": "avbestille",
                  "administrator-overstyrer": "avbestille", "statistikk": "maal", "statistikk-hvordan-bruk-telles": "maal",
                  "booke": "badehusappen", "avbestille-i-appen": "badehusappen", "sjekke-inn": "badehusappen", "hjem-skjerm": "badehusappen", "sporsmal": "badehusappen"},
}

# HT14-logoen: fire terrassehus som trapper seg ned mot fjorden en sommerkveld (samme som /favicon.svg).
LOGO_INNER = '''<defs><linearGradient id="ht14-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2a4a"/><stop offset=".62" stop-color="#155e75"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#ht14-bg)"/><circle cx="50" cy="14" r="5.5" fill="#fdba74"/><path d="M0 25 L9 25 L56 50 L0 50 Z" fill="#0f3d3a" opacity=".8"/><g><rect x="6" y="13" width="15" height="10" rx="1.5" fill="#fff"/><rect x="8.5" y="16.5" width="10" height="3.5" rx=".8" fill="#fbbf24"/><rect x="17" y="21" width="15" height="10" rx="1.5" fill="#fff"/><rect x="19.5" y="24.5" width="10" height="3.5" rx=".8" fill="#fbbf24"/><rect x="28" y="29" width="15" height="10" rx="1.5" fill="#fff"/><rect x="30.5" y="32.5" width="10" height="3.5" rx=".8" fill="#fbbf24"/><rect x="39" y="37" width="15" height="10" rx="1.5" fill="#fff"/><rect x="41.5" y="40.5" width="10" height="3.5" rx=".8" fill="#fbbf24"/></g><path d="M5 53c4.5-3 9-3 13.5 0s9 3 13.5 0 9-3 13.5 0 9 3 13.5 0" fill="none" stroke="#67e8f9" stroke-width="3.2" stroke-linecap="round"/><path d="M12 59c3.3-2 6.7-2 10 0s6.7 2 10 0 6.7-2 10 0 6.7 2 10 0" fill="none" stroke="#a5f3fc" stroke-width="2" stroke-linecap="round" opacity=".7"/>'''
LOGO = f'<svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true">{LOGO_INNER}</svg>'
LOGO_SMALL = f'<svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">{LOGO_INNER}</svg>'
ICON_LINKS = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">'
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
            if i in (3, 4, 5): cls.append("wk")          # torsdag–lørdag: begrenset om sommeren
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
 # Sommerregelen: maks én torsdag, én fredag og én lørdag per måned – og bare én av dem per uke
 "regel-kvote": cal(2027, 7, {
     1: [("a","A tor ✓")], 9: [("a","A fre ✓")], 11: [("a","A søn ✓")], 17: [("a","A lør ✓")],
     10: [("x","A lør ✗")], 15: [("x","A tor ✗")]},
     caption="Hus A har torsdag 1., fredag 9. og lørdag 17. – i hver sin uke. Lørdag 10. går ikke (samme uke som fredag 9.), og torsdag 15. går ikke (andre torsdag i juli). Søndag 11. går fint."),
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
        '<li><a href="/badehusappen/"><span class="num">📱</span>Badehusappen</a></li>',
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
{ICON_LINKS}
<link rel="stylesheet" href="style.css?v=20261027v06">
<script src="app.js?v=20261027v06" defer></script>{mm}{extra_head}
</head>
<body>
<a href="#innhold" class="chip" style="position:absolute;left:-9999px" onfocus="this.style.left='8px'">Hopp til innhold</a>
<header class="topbar">
  <button class="hamburger" aria-label="Åpne meny" aria-expanded="false" aria-controls="sidemeny">{BURGER}</button>
  <a class="topbar-home" href="/">{LOGO_SMALL}<b>Sameiet HT14</b></a><span class="topbar-sep" aria-hidden="true">›</span><span>Dokumentasjon</span>
  <a class="topbar-app" href="/badehusappen/"><img src="/badehusappen/ikoner/ikon.svg" width="18" height="18" alt="">Badehusappen</a>
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
      <p class="footer">Sameiet HT14 · HT14 versjon 0.6. Badehusappen ligger på <a href="/badehusappen/">ht14.no/badehusappen/</a> – logg inn med husets innlogging. Navn i eksemplene er oppdiktet. Spørsmål eller ideer? Si fra til Thomas.</p>
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
    n = gen_start.write_start(LOGO_SMALL.replace('width="24" height="24"', 'width="30" height="30"'), PUBLIC / "index.html")
    print("ok", len(PAGES), "sider,", len(search), "søkeoppføringer,", len(REDIRECTS), "omdirigeringer, startside", n)

if __name__ == "__main__":
    main()
