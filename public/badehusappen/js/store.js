/*
 * Badehusappen – datalag (HT14 versjon 0.6)
 * ---------------------------------------------------------------
 * All lesing og skriving går til Workeren på /api/… (felles for alle hus).
 * Reglene sjekkes her i appen for rask tilbakemelding, og Workeren sjekker
 * dem på nytt med samme regelmotor før noe lagres.
 *
 * Innlogging er en HttpOnly-cookie (__Host-ht14_okt) – appen ser den aldri.
 * Feil kastes som { error: "KODE", message: "Norsk tekst", status }.
 * Ingen nøkler, tokens eller passord finnes i denne fila.
 */
(function (root) {
  "use strict";
  const R = root.RulesEngine;
  let rules = null, me = null;
  let clock = () => R.osloNow();
  let testNow = null;                       // bare lokalt (?tid=), Workeren godtar den ikke i produksjon
  let onLoggedOut = () => {};

  // Rydd bort prøvedata fra før versjon 0.5 (bookinger som bare lå på denne telefonen).
  try { ["ht14-badehusappen-data", "ht14-badehusappen-hus", "ht14-badehusappen-har-booket"].forEach(k => localStorage.removeItem(k)); } catch (e) {}

  const err = (error, message, status) => { const e = new Error(message); e.error = error; e.status = status; return e; };
  async function api(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (testNow) headers["X-Test-Now"] = testNow;
    let res;
    try { res = await fetch("/api/" + path, { method, headers, credentials: "same-origin", cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw err("OFFLINE", "Får ikke kontakt. Sjekk nettet og prøv igjen.", 0); }
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && path !== "login" && path !== "password") { me = null; onLoggedOut(); }
      throw err((data && data.error) || "SERVER", (data && data.message) || "Noe gikk galt. Prøv igjen om litt.", res.status);
    }
    return data;
  }
  const get = p => api("GET", p), post = (p, b) => api("POST", p, b === undefined ? {} : b);

  const Store = {
    async getRules() {
      if (rules) return rules;
      try {
        const res = await fetch("rules.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(res.status);
        rules = await res.json();
        localStorage.setItem("ht14-badehusappen-rules", JSON.stringify(rules));
      } catch (e) {
        rules = JSON.parse(localStorage.getItem("ht14-badehusappen-rules") || "null");
        if (!rules) throw err("RULES_INVALID", "Fikk ikke lest reglene. Sjekk nettet og prøv igjen.");
      }
      return rules;
    },
    now() { return clock(); },
    setClock(fn, iso) { clock = fn; testNow = iso || null; },
    onLoggedOut(fn) { onLoggedOut = fn; },
    user() { return me; },

    /* Innlogging */
    async me() { try { me = (await get("me")).user; } catch (e) { if (e.status !== 401) throw e; me = null; } return me; },
    async login(email, password) { const r = await post("login", { email, password }); me = r.user; return me; },
    async logout() { try { await post("logout"); } finally { me = null; } },
    async changePassword(current, next) { return post("password", { current, next }); },

    /* Bookinger (felles for alle hus) */
    async calendar({ from, to }) { return get(`bookings?from=${from}&to=${to}`); },
    async getBooking(id) { return get("bookings/" + encodeURIComponent(id)); },
    /** Alt fra ett år tilbake til slutten av bookingvinduet. */
    async history() {
      const n = clock(), from = R.addDays(n.date, -366), to = R.addDays(R.addMonths(n.date, (rules && rules.bookingWindow.months || 3) + 1), 7);
      return get(`bookings?from=${from}&to=${to}`);
    },
    async stats({ year, month }) { return get(`stats?year=${year}&month=${month}`); },
    async createBooking({ date, periods, household }) { return post("bookings", { date, periods, household }); },
    async cancelBooking(id) { return post(`bookings/${encodeURIComponent(id)}/cancel`); },
    async checkIn(id) { return post(`bookings/${encodeURIComponent(id)}/checkin`); },
    async spontaneousCheckIn({ periods, household }) { return post("checkin", { periods, household }); },
    async confirmUsage(id) { return post(`bookings/${encodeURIComponent(id)}/confirm`); },

    /* Om oss */
    async contacts() { return get("contacts"); },
    async saveContacts(house, data) { return api("PUT", "contacts/" + house, data); },

    /* Admin */
    async users() { return get("admin/users"); },
    async createUser(data) { return post("admin/users", data); },
    async resetPassword(id, password) { return post(`admin/users/${id}/password`, { password }); },
    async deactivate(id) { return post(`admin/users/${id}/deactivate`); },
    async events() { return get("admin/events?limit=30"); }
  };
  root.Store = Store;
})(self);
