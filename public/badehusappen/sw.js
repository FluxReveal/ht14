/*
 * Badehusappen – enkel service worker.
 * «Nett først»: prøver alltid å hente nyeste versjon fra nettet, og
 * bruker lagret kopi bare når man er uten nett. Da blir oppdateringer
 * aldri hengende fast i hurtigbufferen.
 * Registreres med scope /badehusappen/ på ht14.no.
 */
const CACHE = "ht14-badehusappen-2026-10-26b";   // endres ved oppdatering, så gamle kopier ryddes
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  // Bare GET fra ht14.no, og aldri /api/ (innlogging og bookinger skal ikke ligge i hurtigbufferen).
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
