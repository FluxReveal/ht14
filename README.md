# HT14 – ht14.no

Nettsiden til **Sameiet Halden Terrasse 14** (fire hus, 14A–14D):

- **Startside** – `/`, med «Om oss» (Hus A–D; navn og kontaktinfo bare etter innlogging)
- **Dokumentasjon** – `/dokumentasjon/` (teknisk dokumentasjon, regler, forslag til vedtekter, årshjul, hva er nytt)
- **Badehusappen** – `/badehusappen/`, kortadresse **badehusappen.ht14.no** (felles booking for alle fire husene, én innlogging per hus)

Dette er **HT14 versjon 0.6**.

Thomas har laget dette som et forslag til resten av sameiet. Ingenting er bestemt ennå, så si gjerne fra hva dere synes.

## Slik er det bygget

Alt ligger hos Cloudflare, på gratisplanene:

- **Én Cloudflare Worker** (`ht14`) serverer de statiske filene i `public/` på **ht14.no**, og svarer på `/api/…`.
  API-et (`src/index.js`): innlogging, booking, Om oss og administrasjon. Reglene sjekkes på serveren med den samme
  regelmotoren som appen (`public/badehusappen/js/rules-engine.js`).
- **D1-database** `ht14` for bookinger, innlogginger (én per hus + admin), Om oss, økter og hendelseslogg (`schema.sql`).
  Forhåndsvisninger av grener bruker `ht14-test`.
- **Innlogging:** egen e-post + passord. PBKDF2-SHA256 (10 000 runder – målt 4–6 ms CPU per innlogging, eget salt, HMAC-pepper `SESSION_PEPPER`),
  cookie `__Host-ht14_okt` (HttpOnly, Secure, SameSite=Lax, ca. ett år), pause etter 5 feil passord, Origin-sjekk.
- **Nattlig kopi** (`src/export.js`, Cron Trigger slås på når `GH_DATA_TOKEN` er lagt inn) skriver bookinger, brukere,
  Om oss og hendelser som CSV + JSON til det private repoet
  [`FluxReveal/ht14-data`](https://github.com/FluxReveal/ht14-data) – aldri passord-hasher eller økter.
- **Workers Builds** publiserer automatisk når `main` endres. Andre grener får en forhåndsvisningslenke.

Repoet er offentlig fordi det ikke inneholder noen hemmeligheter. Hemmeligheter (`SESSION_PEPPER`, `GH_DATA_TOKEN`)
legges bare inn som Worker-secrets i Cloudflare.

## Struktur

```
public/                 alt som vises på ht14.no
  index.html            startside med Om oss (lages av tools/build.py)
  om-oss.js             Om oss på startsiden (henter fra /api/contacts)
  dokumentasjon/        dokumentasjonen (lages av tools/build.py) + gamle adresser som sender videre
  badehusappen/         Badehusappen (HTML, CSS, JS, rules.json, manifest, service worker, ikoner/ med SVG)
  404.html, _headers, favicon.svg, ht14-logo.svg
src/index.js            Workeren (API-et)
src/auth.js             passord-hash og økter
src/export.js           nattlig kopi til ht14-data
src/ikoner.js           PNG/ICO-ikonene som base64 (lages av tools/lag-ikoner.mjs fra SVG-ene; Workeren serverer dem)
wrangler.jsonc          oppsett: navn, statiske filer, D1 (ht14 + ht14-test), ht14.no
schema.sql              databasen (lagt inn i ht14 og ht14-test)
tools/
  build.py, gen_start.py  generator for dokumentasjonen og startsiden
  src/                    kildetekst for teknisk, regler og vedtekter
  redirects.json          gamle avsnitt → nye avsnitt
  checklinks.py           sjekker alle lenker og ankere i public/
  tests/                  regelmotoren, serverdelen og API-et (api.test.mjs, bare lokalt)
  lag-admin-sql.mjs       lager SQL for første administrator uten å vise passordet
  e2e-sjekk.js            nettleser-sjekk (Safari/WebKit og Chrome i iPhone-størrelse)
```

## Endre noe

1. Rett teksten i `tools/src/*.html` (eller «Hva er nytt»/årshjulet i `tools/gen_start.py`).
2. `python3 tools/build.py` – lager sidene i `public/` på nytt.
3. `python3 tools/checklinks.py` og `npm test` – skal gi 0 problemer og bare grønne tester.
4. Prøv lokalt (Node 22):
   - `cp .dev.vars.example .dev.vars` (en egen test-pepper, aldri den ekte)
   - `npx wrangler d1 execute ht14 --local --file schema.sql`
   - lag en lokal admin: legg e-post, passord og test-pepper i tre filer og kjør
     `PEPPER_FILE=… EMAIL_FILE=… PASSWORD_FILE=… OUT=admin.sql node tools/lag-admin-sql.mjs`, så
     `npx wrangler d1 execute ht14 --local --file admin.sql` (slett filene etterpå)
   - `npx wrangler dev` og åpne http://localhost:8787/
   - API-tester: `API_BASE=http://127.0.0.1:8787 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run test:api` (aldri mot produksjon)
   - nettleser-sjekk: `ADMIN_EMAIL=… ADMIN_PASSWORD=… node tools/e2e-sjekk.js` (krever Playwright)

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
3. Legg inn hemmelighetene på nytt (ny `SESSION_PEPPER` og nytt `GH_DATA_TOKEN`). Kopien har ingen passord, så lag
   administratoren på nytt med `tools/lag-admin-sql.mjs` og gi husene nye passord i appen.
4. Flytt domenet: eierskifte for ht14.no hos Domeneshop til sameiet, og legg ht14.no til i sameiets Cloudflare-konto.
