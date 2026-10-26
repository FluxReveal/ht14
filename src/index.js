/**
 * HT14 – Worker for ht14.no
 *
 * De statiske filene i public/ (startside, dokumentasjon og Badehusappen)
 * serveres direkte av Cloudflare. Workeren kjører bare for /api/* og når
 * ingen fil passer. Innlogging og booking kommer senere, når sameiet har
 * godkjent reglene.
 */

const JSON_HEADERS = { "cache-control": "no-store" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Helsesjekk: brukes for å se at Workeren lever.
    if (url.pathname === "/api/helse") {
      return Response.json({ ok: true }, { headers: JSON_HEADERS });
    }

    // Ingen andre API-endepunkter ennå.
    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "NOT_FOUND", message: "Dette finnes ikke (ennå)." },
        { status: 404, headers: JSON_HEADERS },
      );
    }

    // Alt annet: statiske filer. Finnes ikke fila, svarer Cloudflare
    // med public/404.html og status 404 (not_found_handling i wrangler.jsonc).
    return env.ASSETS.fetch(request);
  },
};
