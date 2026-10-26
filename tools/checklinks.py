"""Sjekker alle lenker og ankere i public/ – relative, rotrelative (/…) og https://ht14.no/…,
pluss målene i omdirigeringssidene. Kjør fra repo-roten:  python3 tools/checklinks.py"""
import re, pathlib, json, sys
root = (pathlib.Path(__file__).resolve().parent.parent / "public")
bad = 0
def ids_of(t):
    return set(re.findall(r'\sid="([^"]+)"', t.read_text())) if t.suffix == ".html" else set()
def check(f, href):
    global bad
    if href.startswith("https://ht14.no/"):
        href = href[len("https://ht14.no"):]
    elif href.startswith(("http", "data:", "mailto:", "javascript:")) or (href.startswith("#") and len(href) == 1):
        return
    path, _, frag = href.partition("#")
    path = path.split("?")[0]
    if path.startswith("/"): target = root / path.lstrip("/")
    else: target = (f.parent / path).resolve() if path else f
    if target.is_dir() or path.endswith("/"): target = target / "index.html"
    if not target.exists() and target.suffix == "" and target.with_suffix(".html").exists():
        target = target.with_suffix(".html")                     # /dokumentasjon/regler → regler.html
    if not target.exists():
        print("MANGLER", f.relative_to(root), href); bad += 1; return
    if frag and frag not in ids_of(target):
        print("FEIL ANKER", f.relative_to(root), href); bad += 1
n = 0
for f in sorted(root.rglob("*.html")):
    s = f.read_text()
    if "/HT14/" in s or "fluxreveal.com" in s:
        print("GAMMEL ADRESSE", f.relative_to(root)); bad += 1
    s_nocode = re.sub(r"<pre.*?</pre>|<code.*?</code>", "", s, flags=re.S)
    for href in re.findall(r'(?:href|src)="([^"]+)"', s_nocode):
        check(f, href); n += 1
    m = re.search(r'var m=(\{.*?\}),h=location', s)          # omdirigeringskart
    if m:
        for v in json.loads(m.group(1)).values():
            if v and ("." in v.split("#")[0]): check(f, v); n += 1
# manifest og service worker
man = json.loads((root / "badehusappen/manifest.webmanifest").read_text())
for k in ("start_url", "id"):
    check(root / "badehusappen/index.html", man[k]); n += 1
for ic in man["icons"]:
    check(root / "badehusappen/index.html", ic["src"]); n += 1
print("lenker sjekket:", n, "problemer:", bad)
sys.exit(1 if bad else 0)
