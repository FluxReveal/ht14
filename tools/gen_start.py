import math, html

CATS = {
 'dugnad':  ('Dugnad og nabofest', '#16a34a', '#dcfce7', 205, 238),
 'badehus': ('Badehuset',          '#0891b2', '#cffafe', 170, 203),
 'mote':    ('Møter i sameiet',    '#7c3aed', '#ede9fe', 135, 168),
 'regning': ('Regninger',          '#d97706', '#fef3c7', 100, 133),
}
# (nr, cat, start, end, title, when, kilde(True)/forslag(False), note)
EV = [
 (1,'badehus',0.0,2.0,'Vi booker badehuset for sommeren','januar–februar',True,
  'Sommerbookingene har tidligere blitt lagt inn i januar–februar. Med de foreslåtte reglene kan man booke tre måneder frem, altså juni fra 1. mars.'),
 (2,'mote',2.0,3.0,'Kort vårmøte: planlegge dugnad og badesesong','mars',False,
  'Forslag – avklares. Et kort møte før våren, gjerne sammen med planleggingen av dugnaden.'),
 (3,'dugnad',3.55,5.0,'Vårdugnad med grilling','slutten av april – mai',True,
  'Vi tar dugnad og rydder ute, og avslutter med grilling sammen. Dato avtales hvert år.'),
 (4,'badehus',3.5,5.0,'Badehuset gjøres klart og åpner for sesongen','april–mai',True,
  'Badehuset vaskes og gjøres klart, gjerne på vårdugnaden. Første bookinger har vært i slutten av april / starten av mai. Fast åpningsdag: forslag – avklares.'),
 (5,'regning',4.0,5.0,'Oppgjør av utlegg etter dugnaden','mai',False,
  'Forslag – avklares. Den som har lagt ut for noe til dugnaden, får pengene tilbake og utgiftene deles.'),
 (6,'badehus',5.0,8.0,'Sommerregler for booking','juni–august',False,
  'Forslag: maks én torsdag, én fredag og én lørdag per hus per måned, og ikke to av dem i samme uke (vedlegg 1 punkt 6).'),
 (7,'badehus',8.0,9.0,'Badehuset stenges for vinteren','september',False,
  'Forslag – avklares. Badesesongen har vart fra mai til ut i september. Ingen fast stengedato er avtalt.'),
 (8,'dugnad',8.5,10.0,'Høstdugnad med nabofest','september–oktober',False,
  'Forslag – avklares. Rydde før vinteren og avslutte sesongen med en nabofest.'),
 (9,'mote',9.0,11.0,'Sameiemøte etter sommeren','oktober–november',False,
  'Forslag – avklares: minst ett møte i året, gjerne etter sommeren. Neste møte er foreslått torsdag 12. november 2026 (ikke bekreftet).'),
 (10,'regning',9.0,10.0,'Regning for snømåking for vinteren','oktober',True,
  'Regningen for snømåking for sesongen har kommet i oktober, og deles på husene.'),
]
# ---------------------------------------------------------------
# «Hva er nytt» – legg nye linjer ØVERST. Dato (ÅÅÅÅ-MM-DD), overskrift, kort tekst, lenke (eller None).
# Ingen versjonsnumre i sidene – bare dato og hva som er nytt (unntak: «HT14 versjon 0.6», bestemt av Thomas).
# ---------------------------------------------------------------
NYTT = [
 ("2026-10-27", "Ryddigere teknisk dokumentasjon", "Den tekniske dokumentasjonen er strammet inn: bakgrunnen om den gamle måten å booke på og et punkt om ting som kan komme senere er tatt bort.", "/dokumentasjon/teknisk.html#hva-er-det"),
 ("2026-10-27", "HT14 versjon 0.6: Om oss på forsiden og nye logoer", "«Om oss» ligger nå på forsiden ht14.no: alle ser Hus A–D, og når dere logger inn med husets innlogging ser dere navn og kontaktinfo og kan endre deres eget hus. Kalenderen i Badehusappen starter i dag og viser de neste 30 dagene, Statistikk viser bare sesongen og hele året, og en avbestilt booking teller aldri i noen kvote. HT14 og Badehusappen har også fått egne logoer og app-ikon.", "/#om-oss"),
 ("2026-10-26", "HT14 versjon 0.5: felles booking med innlogging", "Badehusappen er nå felles for alle fire husene: hvert hus logger inn med sin egen innlogging, og alle ser den samme kalenderen. Nytt er også «Om oss» med kontaktinfo (bare for innloggede), kortadressen badehusappen.ht14.no og et enklere utseende som ligner en iPhone-app. Prøvebookinger som bare lå på telefonen, er fjernet.", "/dokumentasjon/regler.html#badehusappen"),
 ("2026-10-26", "Avbestilling frigjør kvoten, og innsjekk gjelder alle perioder", "Avbestiller dere, teller ikke bookingen i kvoten, så dere kan booke en annen dag. Sjekk inn hver gang dere er i badehuset – også formiddag og ettermiddag.", "/dokumentasjon/regler.html#avbestille"),
 ("2026-10-26", "Nye sommerregler og enklere regler", "Sommerregelen gjelder nå torsdag, fredag og lørdag – maks én av hver per måned, og ikke to i samme uke. Vanlig booking er én kveld; formiddag og ettermiddag bare når dere har gjester. Reglene og vedtektsforslaget er kortere og enklere.", "/dokumentasjon/regler.html#hvor-mye"),
 ("2026-10-26", "Vedtektsforslaget sier nå én innlogging per hus", "Hvert hus (A–D) har én felles innlogging i Badehusappen, og husstanden bestemmer selv hvem som booker for huset. Word-fila er oppdatert.", "/dokumentasjon/vedtekter.html#punkt-2"),
 ("2026-10-26", "HT14 får egen adresse: ht14.no", "Startsiden, dokumentasjonen og Badehusappen flytter til Cloudflare på ht14.no. Bookingene skal lagres i en database med en kopi hver natt, og hvert hus får én felles innlogging.", "/dokumentasjon/teknisk.html"),
 ("2026-10-25", "Kortere og ryddigere dokumentasjon", "Dokumentasjonen er omtrent halvert og samlet i fem sider: Teknisk dokumentasjon, Regler for bruk av badehuset, Forslag til tillegg i vedtektene, Årshjul og Hva er nytt. Gamle lenker virker fortsatt.", "/dokumentasjon/teknisk.html"),
 ("2026-10-25", "Felles meny for hele HT14", "Hjem, Badehusappen og Dokumentasjon henger sammen, med «Sameiet HT14» øverst – så det er lett å finne fram og tilbake.", None),
 ("2026-10-25", "Samlet teknisk dokumentasjon", "Overordnet beskrivelse, HLD og LLD er slått sammen til ett dokument.", "/dokumentasjon/teknisk.html"),
 ("2026-10-25", "Ny inndeling av dagen", "Formiddag 10–14, ettermiddag 14–17 og kveld 17–24. Dette er en del av forslaget til sameiemøtet.", "/dokumentasjon/regler.html#perioder"),
 ("2026-10-25", "Badehusappen på alle skjermer", "Fungerer fint på iPhone, Android, nettbrett og PC – også med stor tekst og mørk modus.", "/badehusappen/"),
 ("2026-10-25", "Enklere booking", "Velg hus og tid rett under datoen, trykk rett på en ledig tid i uka, og «Book»-knappen er alltid synlig nederst.", "/badehusappen/"),
 ("2026-10-25", "Utkast til Badehusappen", "Prøv å booke badehuset på mobilen. Ingen innlogging ennå – du velger bare huset ditt, og bookingene lagres på din egen telefon.", "/badehusappen/"),
 ("2026-10-25", "Dokumentasjon for Badehusappen", "Regler, forslag til vedtekter og hvordan løsningen er bygget.", "/dokumentasjon/teknisk.html"),
 ("2026-10-25", "Sameiets årshjul", "Dugnader, badesesongen, møter og regninger gjennom året.", "/dokumentasjon/arshjul.html"),
]
MND_NB = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']
def nytt_html(prefix=''):
    out, dates = [], []
    for d, *_ in NYTT:
        if d not in dates: dates.append(d)
    for d in sorted(dates, reverse=True):
        y, m, dd = map(int, d.split("-"))
        items = "".join(
            f'<li><b>{html.escape(t)}</b> – {html.escape(txt)}{f" <a href=\"{html.escape(prefix+u)}\">Se her</a>" if u else ""}</li>'
            for dt, t, txt, u in NYTT if dt == d)
        out.append(f'<div class="nytt-dag"><h3><time datetime="{d}">{dd}. {MND_NB[m-1]} {y}</time></h3><ul>{items}</ul></div>')
    return "\n".join(out)

MON = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember']
CX=CY=300
def pt(r,m):
    a=math.radians(m*30-90); return CX+r*math.cos(a), CY+r*math.sin(a)
def sector(r1,r2,m1,m2):
    x1,y1=pt(r2,m1); x2,y2=pt(r2,m2); x3,y3=pt(r1,m2); x4,y4=pt(r1,m1)
    large=1 if (m2-m1)>6 else 0
    return f'M{x1:.1f} {y1:.1f}A{r2} {r2} 0 {large} 1 {x2:.1f} {y2:.1f}L{x3:.1f} {y3:.1f}A{r1} {r1} 0 {large} 0 {x4:.1f} {y4:.1f}Z'
svg=[]
svg.append('<svg class="wheel" viewBox="0 0 600 600" role="img" aria-labelledby="hjul-tittel hjul-desc">')
svg.append('<title id="hjul-tittel">Sameiets årshjul</title><desc id="hjul-desc">Sirkel med tolv måneder. Fargede buer viser når dugnader, badehuset, møter og regninger skjer i løpet av året. Heltrukne buer er kjent fra tidligere år, stiplede er forslag. Den samme informasjonen står i listen under.</desc>')
svg.append('<defs>')
for k,(n,c,bg,r1,r2) in CATS.items():
    svg.append(f'<pattern id="stripe-{k}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="{bg}"/><rect width="3" height="8" fill="{c}" opacity=".35"/></pattern>')
svg.append('</defs>')
# month ring
for i,m in enumerate(MON):
    fill = '#f1f5f9' if i%2 else '#e2e8f0'
    svg.append(f'<path d="{sector(245,290,i,i+1)}" fill="{fill}" class="mnd" data-m="{i}"/>')
    x,y=pt(267.5,i+.5)
    svg.append(f'<text x="{x:.1f}" y="{y:.1f}" class="mlabel" text-anchor="middle" dominant-baseline="central">{m[:3]}</text>')
# category background rings
for k,(n,c,bg,r1,r2) in CATS.items():
    svg.append(f'<circle cx="300" cy="300" r="{(r1+r2)/2}" fill="none" stroke="{bg}" stroke-width="{r2-r1}" opacity=".55"/>')
# month divider lines
for i in range(12):
    x1,y1=pt(95,i); x2,y2=pt(290,i)
    svg.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#fff" stroke-width="2"/>')
# events
for nr,cat,s,e,t,when,src,note in EV:
    n,c,bg,r1,r2=CATS[cat]
    d=sector(r1+2,r2-2,s+.03,e-.03)
    if src:
        svg.append(f'<path d="{d}" fill="{c}" class="ev" data-ev="{nr}"><title>{nr}. {html.escape(t)} ({when}) – kjent fra tidligere år</title></path>')
    else:
        svg.append(f'<path d="{d}" fill="url(#stripe-{cat})" stroke="{c}" stroke-width="2" stroke-dasharray="5 4" class="ev" data-ev="{nr}"><title>{nr}. {html.escape(t)} ({when}) – forslag, avklares</title></path>')
    x,y=pt((r1+r2)/2,(s+e)/2)
    fc = '#fff' if src else c
    tc = c if src else '#fff'
    svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" fill="{fc}" stroke="{c}" stroke-width="1.5"/><text x="{x:.1f}" y="{y:.1f}" class="evnum" fill="{tc}" text-anchor="middle" dominant-baseline="central">{nr}</text>')
# proposed meeting marker 12 Nov
mx,my=pt(151.5,10+11.5/30)
svg.append(f'<g class="pin"><circle cx="{mx:.1f}" cy="{my:.1f}" r="6" fill="#fff" stroke="#7c3aed" stroke-width="3"/><title>Neste møte: torsdag 12. november 2026 – foreslått</title></g>')
# centre
svg.append('<circle cx="300" cy="300" r="95" fill="#fff" stroke="#e2e8f0"/>')
svg.append('<text x="300" y="282" text-anchor="middle" class="c1">HT14</text><text x="300" y="312" text-anchor="middle" class="c2">Sameiets årshjul</text><text x="300" y="334" text-anchor="middle" class="c3">4 hus · 12 måneder</text>')
# today needle (positioned by JS)
svg.append('<g id="naa" style="display:none"><line x1="300" y1="205" x2="300" y2="18" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" opacity=".75"/><circle cx="300" cy="18" r="5" fill="#0f172a"/></g>')
svg.append('</svg>')
SVG='\n'.join(svg)

def evcard(ev, compact=False):
    nr,cat,s,e,t,when,src,note=ev
    n,c,bg,r1,r2=CATS[cat]
    tag = '<span class="tag kilde">kjent fra tidligere år</span>' if src else '<span class="tag forslag">forslag – avklares</span>'
    cls='ev-item'+('' if src else ' er-forslag')
    return (f'<li class="{cls}" style="--c:{c};--bg:{bg}"><span class="nr">{nr}</span><div><b>{html.escape(t)}</b> '
            f'<span class="when">{when}</span><br><span class="cat">{n}</span> {tag}<p>{html.escape(note)}</p></div></li>')
legend=''.join(f'<li><span class="sw" style="background:{c}"></span>{n}</li>' for k,(n,c,bg,r1,r2) in CATS.items())
legend+='<li><span class="sw solid"></span>Heltrukket = kjent fra tidligere år</li><li><span class="sw dashed"></span>Stiplet = forslag – avklares</li>'
evlist=''.join(evcard(e) for e in EV)

# ---------------------------------------------------------------
# Fragmenter som build.py setter inn i dokumentasjonssidene
# (Årshjul og Hva er nytt), og den korte startsiden.
# ---------------------------------------------------------------
ARSHJUL_CSS = """
  .hjul-boks{background:#fff;border:1px solid var(--line);border-radius:22px;padding:14px;box-shadow:var(--shadow);max-width:560px;margin:0 auto 18px}
  .wheel{width:100%;height:auto;display:block}
  .wheel .mlabel{font:700 15px system-ui,sans-serif;fill:#334155}
  .wheel .evnum{font:800 12px system-ui,sans-serif}
  .wheel .c1{font:800 34px system-ui,sans-serif;fill:#0e7490}
  .wheel .c2{font:700 15px system-ui,sans-serif;fill:#0f172a}
  .wheel .c3{font:500 12px system-ui,sans-serif;fill:#64748b}
  .wheel .mnd.naa{fill:#0e7490}
  .legend{list-style:none;padding:0;margin:10px 4px 2px;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.88rem;color:var(--ink-2)}
  .legend .sw{display:inline-block;width:14px;height:14px;border-radius:4px;margin-right:6px;vertical-align:-2px}
  .legend .sw.solid{background:#94a3b8}
  .legend .sw.dashed{background:repeating-linear-gradient(45deg,#e2e8f0 0 3px,#94a3b8 3px 5px);outline:2px dashed #64748b;outline-offset:-1px}
  .evlist{list-style:none;padding:0;margin:0;display:grid;gap:10px}
  .ev-item{display:flex;gap:12px;background:#fff;border:1px solid var(--line);border-left:6px solid var(--c);border-radius:14px;padding:12px 14px}
  .ev-item.er-forslag{border-style:dashed;border-left-style:dashed;background:linear-gradient(90deg,var(--bg),#fff 40%)}
  .ev-item p{margin:.35rem 0 0;color:var(--ink-2);font-size:.93rem}
  .ev-item .when{color:var(--muted);font-size:.9rem}
  .ev-item .cat{font-size:.78rem;font-weight:700;color:var(--c);text-transform:uppercase;letter-spacing:.04em}
  .nr{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--c);color:#fff;font-weight:800;font-size:.85rem}
  .er-forslag .nr{background:#fff;color:var(--c);border:2px dashed var(--c)}
  .tag{display:inline;font-size:.8rem;font-style:italic;font-weight:500;margin-left:4px;color:var(--muted)}
  .tag::before{content:"· "}
  .tag.forslag{color:#b45309}
  .nytt-dag h2{font-size:1.15rem;color:var(--brand)}
  .nytt-dag ul{padding-left:1.1rem;display:grid;gap:8px}
  .nytt-dag li b{color:var(--ink)}
"""
ARSHJUL_JS = """<script>
(function(){
  var m=new Date().getMonth();
  var s=document.querySelector('.wheel .mnd[data-m="'+m+'"]'); if(s) s.classList.add('naa');
  var n=document.getElementById('naa');
  if(n){ var d=new Date(), dim=new Date(d.getFullYear(),m+1,0).getDate();
    var ang=(m+(d.getDate()-.5)/dim)*30; n.setAttribute('transform','rotate('+ang.toFixed(2)+' 300 300)'); n.style.display=''; }
  document.querySelectorAll('.wheel .mlabel').forEach(function(t,i){ if(i===m) t.style.fill='#fff'; });
})();
</script>"""

ARSHJUL_BODY = f'''<!-- desc: Sameiets årshjul: dugnader, badesesongen, møter og regninger gjennom året i Sameiet HT14. -->
<section class="hero">
  <div class="eyebrow">For alle</div>
  <h1>Årshjul</h1>
  <p>Det som skjer i sameiet gjennom året – dugnader, badesesongen, møter og regninger.</p>
  <div class="meta"></div>
</section>
<p>Hjulet går med klokka fra januar øverst. <b>Heltrukne</b> buer er ting vi har gjort på omtrent samme tid tidligere år, <b>stiplede</b> er forslag vi må bli enige om. Nummeret finner du igjen i listen.</p>
<div class="hjul-boks">
{SVG}
  <ul class="legend">{legend}</ul>
</div>
<h2 id="gjennom-aret">Gjennom året</h2>
<ol class="evlist" aria-label="Aktiviteter i årshjulet">{evlist}</ol>
<p>Forsikring og eventuelle andre faste regninger står ikke i hjulet ennå – de legges inn når vi vet når de kommer.</p>
<h2 id="hvor-kommer-tidspunktene-fra">Hvor kommer tidspunktene fra?</h2>
<p>«Kjent fra tidligere år» bygger på e-poster og bookinger fra de siste årene: sommerbookinger i januar–februar (2023, 2024, 2026), vårdugnad med grilling i april–mai (2023–2026), klargjøring av badehuset i april–mai (2024–2026) og regning for snømåking i oktober (2019–2025). Resten er forslag. Vi viser bare måned – ingen navn eller beløp.</p>
'''

def nytt_body(prefix):
    out = []
    dates = sorted({d for d, *_ in NYTT}, reverse=True)
    for d in dates:
        y, m, dd = map(int, d.split("-"))
        items = "".join(
            f'<li><b>{html.escape(t)}</b> – {html.escape(txt)}{f" <a href=\"{html.escape(prefix+u)}\">Se her</a>" if u else ""}</li>'
            for dt, t, txt, u in NYTT if dt == d)
        out.append(f'<div class="nytt-dag"><h2 id="d-{d}"><time datetime="{d}">{dd}. {MND_NB[m-1]} {y}</time></h2><ul>{items}</ul></div>')
    return ('<!-- desc: Hva er nytt i Badehusappen og på sidene til Sameiet HT14 – nyest først. -->\n'
            '<section class="hero">\n  <div class="eyebrow">For alle</div>\n  <h1>Hva er nytt</h1>\n'
            '  <p>Det siste som er lagt til eller endret – nyest først.</p>\n  <div class="meta"></div>\n</section>\n'
            + "\n".join(out) + "\n")

def write_start(LOGO, out_path):
    PAGE = f'''<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sameiet HT14</title>
<meta name="description" content="Startside for Sameiet Halden Terrasse 14 på Snarøya: Badehusappen, Om oss, regler, vedtektsforslag, årshjul og hva er nytt.">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<meta name="theme-color" content="#0b2a4a">
<link rel="stylesheet" href="/dokumentasjon/style.css?v=20261027v06">
<script>(function(){{var h=location.hash;if(h==="#arshjul")location.replace("/dokumentasjon/arshjul.html");else if(h==="#hva-er-nytt")location.replace("/dokumentasjon/hva-er-nytt.html");}})();</script>
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro",system-ui,"Segoe UI",Roboto,Arial,sans-serif;display:block;background:radial-gradient(1100px 480px at 0% 0%,#cffafe,transparent 60%),radial-gradient(900px 420px at 100% 0%,#fef3c7,transparent 55%),var(--bg);margin:0}}
  .wrap{{max-width:1080px;margin:0 auto;padding:28px max(20px,env(safe-area-inset-right)) 60px max(20px,env(safe-area-inset-left))}}
  .sitebar{{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top)}}
  .sitebar-in{{max-width:1080px;margin:0 auto;padding:6px max(20px,env(safe-area-inset-right)) 6px max(20px,env(safe-area-inset-left));display:flex;align-items:center;justify-content:space-between;gap:4px 12px;flex-wrap:wrap}}
  .site-brand{{display:inline-flex;align-items:center;gap:8px;font-weight:800;color:var(--ink);text-decoration:none;min-height:44px;font-size:1.05rem}}
  .site-brand svg{{width:30px;height:30px;border-radius:8px}}
  .cards a.hoved .ico img{{width:64px;height:64px;border-radius:15px;display:block;box-shadow:0 4px 14px rgba(0,0,0,.18)}}
  .cards a.hoved .ico.app{{background:none}}
  .om{{margin:30px 0 0;scroll-margin-top:140px}}
  .om h2{{font-size:1.6rem;margin:0 0 .3rem;letter-spacing:-.01em}}
  .om .ingress{{color:var(--ink-2);margin:0 0 14px;max-width:62ch}}
  .omtekst{{color:var(--ink-2);margin:12px 4px}}
  .omliste{{list-style:none;margin:0 0 6px;padding:0;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}}
  .omcelle{{display:flex;align-items:center;gap:.3rem .9rem;flex-wrap:wrap;min-height:48px;padding:10px 16px;border-bottom:1px solid var(--line)}}
  .omliste>li:last-child,.omliste>li:last-child .omcelle{{border-bottom:0}}
  .omcelle.kontakt b{{flex:1 0 100%;font-weight:600}}
  .omcelle a{{min-height:32px;display:inline-flex;align-items:center}}
  .omcelle.dempet{{color:var(--muted)}}
  .omhus{{margin:0 0 18px;scroll-margin-top:70px}}
  .omhus h3{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:1.05rem;margin:18px 4px 8px}}
  .omnavn{{font-weight:600;color:var(--ink)}}
  .omendre{{width:100%;background:none;border:0;font:inherit;color:#007aff;text-align:left;cursor:pointer}}
  .omskjema h4{{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 16px 6px;font-weight:600}}
  .omgruppe{{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}}
  .omfelt{{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-bottom:1px solid var(--line)}}
  .omfelt:last-child{{border-bottom:0}}
  .omfelt span{{flex:0 0 5.5em;font-weight:500}}
  .omfelt input,.omfelt textarea{{flex:1;min-width:0;border:0;outline:0;background:none;font:inherit;font-size:16px;padding:12px 0;color:var(--ink)}}
  .omtekstfelt{{align-items:flex-start}} .omtekstfelt span{{padding-top:12px}}
  .ommelding{{color:#d70015;min-height:1.2em;margin:8px 4px}}
  .ombtn{{display:block;width:100%;min-height:50px;border:0;border-radius:14px;background:#007aff;color:#fff;font:inherit;font-weight:600;font-size:1.05rem;cursor:pointer}}
  .ombtn:disabled{{opacity:.6}}
  .omknapper{{display:grid;gap:8px}}
  .omlenke{{background:none;border:0;font:inherit;color:#007aff;cursor:pointer;min-height:44px;padding:0 4px}}
  @media (min-width:760px){{ .omskjema{{max-width:520px}} }}
  .sitenav{{display:flex;gap:4px;flex-wrap:wrap}}
  .sitenav a{{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;font-weight:600;text-decoration:none;color:var(--ink-2)}}
  .sitenav a:hover{{background:var(--brand-bg)}}
  .sitenav a[aria-current="page"]{{color:var(--brand);box-shadow:inset 0 -3px 0 var(--brand-2)}}
  .hero2{{background:#fff;border:1px solid var(--line);border-radius:22px;padding:30px;box-shadow:var(--shadow)}}
  .hero2 h1{{font-size:clamp(1.8rem,4vw,2.6rem);margin:.2rem 0 .5rem}}
  .hero2 p{{font-size:1.06rem;color:var(--ink-2);max-width:760px}}
  .husrad{{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}}
  .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:14px;margin:22px 0}}
  .cards a{{display:block;background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;text-decoration:none;color:var(--ink);box-shadow:var(--shadow);transition:transform .15s;min-width:0;overflow-wrap:anywhere}}
  .cards a:hover{{transform:translateY(-2px);border-color:var(--brand-2)}}
  .cards a.hoved{{grid-column:1/-1;display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#0a84ff,#0e7490);color:#fff;border:0;border-radius:20px;padding:20px 22px;min-height:96px;box-shadow:0 10px 30px rgba(10,132,255,.28)}}
  .cards a.hoved .ico{{font-size:2.4rem;width:64px;height:64px;display:grid;place-items:center;background:rgba(255,255,255,.18);border-radius:16px;flex:none}}
  .cards a.hoved b{{font-size:1.45rem;margin:0 0 .15rem;color:#fff}}
  .cards a.hoved span{{color:rgba(255,255,255,.9);font-size:1rem}}
  .cards a.hoved .txt{{flex:1;min-width:0}}
  .cards a.hoved .pil{{font-size:2.2rem;line-height:1;opacity:.85}}
  .cards a.hoved:active{{transform:scale(.98)}}
  .ver{{font-size:.85rem}}
  .cards a .ico{{font-size:1.5rem}}
  .cards a b{{display:block;margin:.3rem 0 .2rem}}
  .cards a span{{color:var(--muted);font-size:.92rem}}
  footer.fot{{margin-top:36px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line);padding-top:16px}}
  @media (max-width:520px){{ .sitenav a{{padding:0 9px}} .wrap{{padding-top:18px}} .hero2{{padding:22px}} }}
</style>
</head>
<body>
<header class="sitebar">
  <div class="sitebar-in">
    <a class="site-brand" href="/" aria-label="Sameiet HT14 – hjem">{LOGO}<span>Sameiet HT14</span></a>
    <nav class="sitenav" aria-label="Sameiet HT14"><a href="/" aria-current="page">Hjem</a><a href="/badehusappen/">Badehusappen</a><a href="/dokumentasjon/teknisk.html">Dokumentasjon</a></nav>
  </div>
</header>
<div class="wrap">
  <header class="hero2">
    <div class="eyebrow">Hei, nabo! 👋</div>
    <h1>Velkommen til HT14</h1>
    <p>Vi er fire hus og gode naboer med felles uteområder og et felles badehus. I <b>Badehusappen</b> booker vi badehuset selv. Hvert hus logger inn, og alle ser den samme kalenderen. Lenger ned på siden finner du <a href="#om-oss">Om oss</a>.</p>
    <div class="husrad"><span class="hus a">Hus A</span><span class="hus b">Hus B</span><span class="hus c">Hus C</span><span class="hus d">Hus D</span></div>
    <p>Thomas har laget dette som et forslag til resten av sameiet. Ingenting er bestemt ennå, så si gjerne fra hva dere synes.</p>
  </header>
  <nav class="cards" aria-label="Snarveier">
    <a class="hoved" href="/badehusappen/"><div class="ico app"><img src="/badehusappen/ikoner/ikon.svg" width="64" height="64" alt=""></div><div class="txt"><b>Badehusappen</b><span>Book badehuset – logg inn med husets innlogging.</span></div><div class="pil" aria-hidden="true">›</div></a>
    <a href="#om-oss"><div class="ico">🏡</div><b>Om oss</b><span>Hus A–D: hvem bor hvor, og hvordan dere når hverandre.</span></a>
    <a href="/dokumentasjon/regler.html"><div class="ico">⚖️</div><b>Regler for bruk av badehuset</b><span>Booking, sommerregler og hvordan du bruker Badehusappen.</span></a>
    <a href="/dokumentasjon/vedtekter.html"><div class="ico">📜</div><b>Forslag til tillegg i vedtektene</b><span>§ 10 og reglene for badehuset – til sameiemøtet.</span></a>
    <a href="/dokumentasjon/arshjul.html"><div class="ico">🗓️</div><b>Årshjul</b><span>Hva skjer når i løpet av året?</span></a>
    <a href="/dokumentasjon/hva-er-nytt.html"><div class="ico">✨</div><b>Hva er nytt</b><span>Det siste som er lagt til eller endret.</span></a>
    <a href="/dokumentasjon/teknisk.html"><div class="ico">🛠️</div><b>Teknisk dokumentasjon</b><span>Hvordan Badehusappen er bygget og driftes.</span></a>
  </nav>
  <section class="om" id="om-oss" aria-labelledby="omTittel">
    <h2 id="omTittel">Om oss</h2>
    <p class="ingress">Fire hus i Halden Terrasse 14 på Snarøya, med fjorden rett nedenfor og et felles badehus ved sjøen.</p>
    <div id="omInnhold" aria-live="polite"><ul class="omliste"><li class="omcelle"><span class="hus a">Hus A</span></li><li class="omcelle"><span class="hus b">Hus B</span></li><li class="omcelle"><span class="hus c">Hus C</span></li><li class="omcelle"><span class="hus d">Hus D</span></li></ul></div>
  </section>
  <footer class="fot">
    <p>Laget av Thomas Gude Svensrud for oss i HT14. Rettelser eller ideer? Si fra til Thomas.</p>
    <p class="ver">HT14 versjon 0.6</p>
  </footer>
</div>
<script src="/om-oss.js?v=06" defer></script>
</body>
</html>
'''
    assert '{{' not in PAGE
    import re as _re
    for _f in (r'callout status', r'\bv0\.\d', r'Status:', r'godkjent', r'Badehus Booking', r'/HT14/', r'fluxreveal\.com'):
        assert not _re.search(_f, PAGE), _f
    open(out_path, 'w', encoding='utf8').write(PAGE)
    return len(PAGE)
