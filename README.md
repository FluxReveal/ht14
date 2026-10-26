# HT14 – ht14.no

Nettsiden til **Sameiet Halden Terrasse 14** (fire hus, 14A–14D):

- **Startside** – `/`
- **Dokumentasjon** – `/dokumentasjon/` (teknisk dokumentasjon, regler, forslag til vedtekter, årshjul, hva er nytt)
- **Badehusappen** – `/badehusappen/` (utkast: ingen innlogging ennå, bookingene lagres bare på egen telefon)

Thomas har laget dette som et forslag til resten av sameiet. Ingenting er bestemt ennå, så si gjerne fra hva dere synes.

## Slik er det bygget

Alt ligger hos Cloudflare, på gratisplanene:

- **Én Cloudflare Worker** (`ht14`) serverer de statiske filene i `public/` på **ht14.no**, og svarer på `/api/…`.
  I dag finnes bare `GET /api/helse` → `{"ok":true}`. Innlogging og booking kommer når sameiet har godkjent reglene.
- **D1-database** `ht14` for bookinger, innlogginger (én per hus), økter og hendelseslogg. `schema.sql` er et **utkast** og er ikke lagt inn ennå.
- **Nattlig kopi** (Cron Trigger, slås på senere) skriver bookinger og brukere som CSV + JSON til det private repoet
  [`FluxReveal/ht14-data`](https://github.com/FluxReveal/ht14-data) – aldri passord-hasher.
- **Workers Builds** publiserer automatisk når `main` endres. Andre grener får en forhåndsvisningslenke.

Repoet er offentlig fordi det ikke inneholder noen hemmeligheter. Hemmeligheter (`SESSION_PEPPER`, `GH_DATA_TOKEN`)
legges bare inn som Worker-secrets i Cloudflare.

## Struktur

```
public/                 alt som vises på ht14.no
  index.html            startside (lages av tools/build.py)
  dokumentasjon/        dokumentasjonen (lages av tools/build.py) + gamle adresser som sender videre
  badehusappen/         Badehusappen (HTML, CSS, JS, rules.json, manifest, service worker)
  404.html, _headers, favicon.svg
src/index.js            Workeren
wrangler.jsonc          oppsett: navn, statiske filer, D1, ht14.no
schema.sql              utkast til databasen (ikke lagt inn)
tools/
  build.py, gen_start.py  generator for dokumentasjonen og startsiden
  src/                    kildetekst for teknisk, regler og vedtekter
  redirects.json          gamle avsnitt → nye avsnitt
  checklinks.py           sjekker alle lenker og ankere i public/
  tests/                  18 tester for regelmotoren
  e2e-sjekk.js            nettleser-sjekk (Safari/WebKit og Chrome i iPhone-størrelse)
```

## Endre noe

1. Rett teksten i `tools/src/*.html` (eller «Hva er nytt»/årshjulet i `tools/gen_start.py`).
2. `python3 tools/build.py` – lager sidene i `public/` på nytt.
3. `python3 tools/checklinks.py` og `npm test` – skal gi 0 problemer og 18 grønne tester.
4. Prøv lokalt: `npx wrangler dev` og åpne http://localhost:8787/. Vil du sjekke i nettleser automatisk: `node tools/e2e-sjekk.js` (krever Playwright).

Endrer du Badehusappen: bytt navnet på `CACHE` i `public/badehusappen/sw.js` og `?v=` i `public/badehusappen/index.html`,
så får alle den nye versjonen.

## Publisere

- Lag en gren, push, og åpne forhåndsvisningslenken (Cloudflare legger den i GitHub og under *Previews*).
- Ser det bra ut («kjør»): flett inn i `main`. Workers Builds publiserer på ht14.no av seg selv.
- Skriv en linje i «Hva er nytt».
- Gikk noe galt? Cloudflare → Workeren → *Deployments* → *Rollback* til forrige versjon.

Oppsettet i Cloudflare-dashbordet steg for steg står i dokumentasjonen: *Teknisk dokumentasjon → Drift og oppsett*.

## Overlevering

HT14 er en egen pakke som kan overleveres til sameiet. FluxReveal (Thomas) er IT-avdeling og driftsleverandør
(drift, sikkerhetskopi og oppdateringer). Sameiet eier domenet, dataene, innholdet og reglene.

Slik tar sameiet over:

1. Overfør repoene `FluxReveal/ht14` og `FluxReveal/ht14-data` til sameiets GitHub-konto.
2. Lag sameiets egen Cloudflare-konto (gratis), en ny D1-database (oppdater `database_id` i `wrangler.jsonc`),
   legg inn siste kopi fra `ht14-data`, og koble repoet med Workers Builds.
3. Legg inn hemmelighetene på nytt (ny `SESSION_PEPPER` og nytt `GH_DATA_TOKEN`). Alle husene logger inn én gang til.
4. Flytt domenet: eierskifte for ht14.no hos Domeneshop til sameiet, og legg ht14.no til i sameiets Cloudflare-konto.
