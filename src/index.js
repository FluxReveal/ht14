/**
 * HT14 versjon 0.5 – Cloudflare Worker for ht14.no
 *
 * Statiske filer (public/) serveres direkte. Bare /api/* går gjennom Workeren
 * (run_worker_first i wrangler.jsonc). Data ligger i D1 (binding DB).
 *
 * Reglene håndheves her på serveren med den SAMME regelmotoren som appen bruker
 * (public/badehusappen/js/rules-engine.js + rules.json), så klient og server
 * alltid er enige. Databasen stopper i tillegg dobbeltbooking med en unik indeks.
 *
 * Sikkerhet: egen innlogging (e-post + passord), økt-cookie __Host-ht14_okt
 * (HttpOnly, Secure, SameSite=Lax), Origin-sjekk på alle endringer, pause etter
 * gjentatte feil passord, generelle feilmeldinger og ingen passord-hasher ut.
 */
import R from "../public/badehusappen/js/rules-engine.js";
import RULES from "../public/badehusappen/rules.json";
import {
  PW_ITERATIONS, SESSION_DAYS, sha256hex, hashPassword, verifyPassword, passwordProblem,
  newSessionToken, sessionCookie, clearCookie, readCookie
} from "./auth.js";
import { runExport } from "./export.js";

const VERSION = "0.5";
const HOUSES = ["A", "B", "C", "D"];
const LOCK_MIN = 15;            // pause i minutter
const MAX_FAIL_EMAIL = 5;       // feil passord per e-post innen 15 min
const MAX_FAIL_IP = 20;         // feil passord per IP innen 15 min
const MAX_BODY = 16 * 1024;

/* ---------------- Hjelpere ---------------- */

const SEC_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SEC_HEADERS, ...extra } });
}
class ApiError extends Error {
  constructor(status, error, message, extra) { super(message); this.status = status; this.error = error; this.extra = extra; }
}
const fail = (status, error, message, extra) => { throw new ApiError(status, error, message, extra); };
const need = (res, status = 400) => {
  if (!res.ok) fail(res.error === "SLOT_TAKEN" ? 409 : res.error === "FORBIDDEN" ? 403 : res.error === "NOT_FOUND" ? 404 : status, res.error, res.message);
  return res;
};
const nowIso = () => new Date().toISOString();
const plusMin = m => new Date(Date.now() + m * 60000).toISOString();

async function readJson(request) {
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) fail(413, "TOO_LARGE", "For mye data.");
  const text = await request.text();
  if (text.length > MAX_BODY) fail(413, "TOO_LARGE", "For mye data.");
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; }
  catch { fail(400, "BAD_JSON", "Noe gikk galt. Prøv igjen."); }
}

/** Klokke (Oslo-tid). Testklokke bare lokalt når ALLOW_TEST_CLOCK=1 i .dev.vars – aldri i produksjon. */
function clock(request, env) {
  const t = env.ALLOW_TEST_CLOCK === "1" && request.headers.get("X-Test-Now");
  return R.osloNow(t ? new Date(t) : new Date());
}

const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/* ---------------- Økter ---------------- */

async function currentUser(request, env, ctx) {
  const token = readCookie(request);
  if (!token || token.length > 100) return null;
  const sid = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.house_id, u.email, u.display_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`
  ).bind(sid, nowIso()).first();
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 3600e3)
    ctx.waitUntil(env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(nowIso(), sid).run());
  return row;
}
const publicUser = u => ({ id: u.id, house: u.house_id, email: u.email, name: u.display_name, role: u.role, admin: u.role === "admin" });
function requireUser(u) { if (!u) fail(401, "LOGIN_REQUIRED", "Du må logge inn."); return u; }
function requireAdmin(u) { requireUser(u); if (u.role !== "admin") fail(403, "FORBIDDEN", "Bare administrator kan gjøre dette."); return u; }

function logEvent(env, actor, house, action, target, from, to, comment) {
  return env.DB.prepare(
    "INSERT INTO events (actor_user_id, house_id, action, target, from_json, to_json, comment) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(actor ? actor.id : null, house || null, action, target == null ? null : String(target),
    from == null ? null : JSON.stringify(from), to == null ? null : JSON.stringify(to), comment || null);
}

/* ---------------- Innlogging ---------------- */

async function attemptKeys(request, email) {
  const ip = request.headers.get("CF-Connecting-IP") || "lokal";
  return ["e:" + await sha256hex(email), "i:" + await sha256hex(ip)];
}
async function isLocked(env, keys) {
  const { results } = await env.DB.prepare(
    `SELECT key FROM login_attempts WHERE key IN (?, ?) AND locked_until IS NOT NULL AND locked_until > ?`
  ).bind(keys[0], keys[1], nowIso()).all();
  return results.length > 0;
}
async function recordFailure(env, keys) {
  const now = nowIso(), windowStart = new Date(Date.now() - LOCK_MIN * 60000).toISOString();
  const stmts = keys.map((key, i) => env.DB.prepare(
    `INSERT INTO login_attempts (key, failures, first_failure_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       failures = CASE WHEN first_failure_at < ?3 THEN 1 ELSE failures + 1 END,
       first_failure_at = CASE WHEN first_failure_at < ?3 THEN ?2 ELSE first_failure_at END,
       locked_until = CASE WHEN first_failure_at >= ?3 AND failures + 1 >= ?4 THEN ?5 ELSE locked_until END`
  ).bind(key, now, windowStart, i === 0 ? MAX_FAIL_EMAIL : MAX_FAIL_IP, plusMin(LOCK_MIN)));
  await env.DB.batch(stmts);
}

async function login(request, env) {
  if (!env.SESSION_PEPPER) fail(503, "NOT_READY", "Innlogging er ikke satt opp ennå.");
  const body = await readJson(request);
  const email = str(body.email, 200).toLowerCase();
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const keys = await attemptKeys(request, email);
  if (await isLocked(env, keys))
    fail(429, "LOCKED", `For mange forsøk. Vent ${LOCK_MIN} minutter og prøv igjen.`);
  const user = EMAIL_RE.test(email) ? await env.DB.prepare(
    "SELECT id, house_id, email, display_name, role, pw_hash, pw_salt, pw_iterations FROM users WHERE email = ? AND active = 1"
  ).bind(email).first() : null;
  const good = await verifyPassword(password, user, env.SESSION_PEPPER);   // regner alltid, også uten bruker
  if (!good) {
    await recordFailure(env, keys);
    fail(401, "BAD_LOGIN", "Feil e-post eller passord.");
  }
  const token = newSessionToken(), sid = await sha256hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  const stmts = [
    env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)")
      .bind(sid, user.id, expires, nowIso(), str(request.headers.get("User-Agent"), 200)),
    env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(keys[0]),
    env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(nowIso(), user.id),
    logEvent(env, user, user.house_id, "LOGIN", "user:" + user.id)
  ];
  if (user.pw_iterations !== PW_ITERATIONS) {                 // oppgrader eldre hash
    const h = await hashPassword(password, env.SESSION_PEPPER);
    stmts.push(env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ? WHERE id = ?")
      .bind(h.pw_hash, h.pw_salt, h.pw_iterations, user.id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, user: publicUser(user), version: VERSION }, 200,
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function logout(request, env, user) {
  const token = readCookie(request);
  if (token) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(nowIso(), await sha256hex(token)).run();
  if (user) await logEvent(env, user, user.house_id, "LOGOUT", "user:" + user.id).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

async function changeOwnPassword(request, env, user) {
  requireUser(user);
  const body = await readJson(request);
  const row = await env.DB.prepare("SELECT id, pw_hash, pw_salt, pw_iterations FROM users WHERE id = ?").bind(user.id).first();
  if (!await verifyPassword(typeof body.current === "string" ? body.current : "", row, env.SESSION_PEPPER))
    fail(400, "BAD_PASSWORD", "Det nåværende passordet stemmer ikke.");
  const problem = passwordProblem(body.next);
  if (problem) fail(400, "WEAK_PASSWORD", problem);
  const h = await hashPassword(body.next, env.SESSION_PEPPER);
  const sid = await sha256hex(readCookie(request));
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ?, pw_changed_at = ?, updated_at = ? WHERE id = ?")
      .bind(h.pw_hash, h.pw_salt, h.pw_iterations, nowIso(), nowIso(), user.id),
    // Logg ut alle andre enheter, men ikke denne.
    env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").bind(nowIso(), user.id, sid),
    logEvent(env, user, user.house_id, "PASSWORD_CHANGE", "user:" + user.id)
  ]);
  return json({ ok: true, message: "Passordet er endret. Andre enheter er logget ut." });
}

/* ---------------- Bookinger ---------------- */

const toClient = (r, now) => {
  const b = {
    id: String(r.id), groupId: r.group_id, date: r.date, period: r.period, household: r.house_id,
    source: r.source, status: r.status, quota: !!r.quota, createdAt: r.created_at,
    checkedInAt: r.checked_in_at, confirmedAt: r.confirmed_at, cancelledAt: r.cancelled_at
  };
  b.displayStatus = R.effectiveStatus(b, RULES, now);
  return b;
};
const BCOLS = "id, group_id, date, period, house_id, source, status, quota, created_at, checked_in_at, confirmed_at, cancelled_at";

async function bookingsBetween(env, from, to, now) {
  const { results } = await env.DB.prepare(`SELECT ${BCOLS} FROM bookings WHERE date >= ? AND date <= ? ORDER BY date, id`)
    .bind(from, to).all();
  return results.map(r => toClient(r, now));
}
/** Alle bookinger som kan påvirke reglene for en dato (måneden ± 7 dager, for uke over månedsskifte). */
function ruleWindow(date) {
  const first = date.slice(0, 8) + "01";
  return [R.addDays(first, -7), R.addDays(R.addMonths(first, 1), 6)];
}
async function getBookingRow(env, id, now) {
  if (!/^\d{1,12}$/.test(id)) fail(404, "NOT_FOUND", "Fant ikke bookingen.");
  const r = await env.DB.prepare(`SELECT ${BCOLS} FROM bookings WHERE id = ?`).bind(+id).first();
  if (!r) fail(404, "NOT_FOUND", "Fant ikke bookingen.");
  return toClient(r, now);
}
const houseFor = (user, wanted) => {
  if (user.role === "admin") {
    if (!HOUSES.includes(wanted)) fail(400, "INVALID_INPUT", "Velg hvilket hus bookingen gjelder.");
    return wanted;
  }
  return user.house_id;
};
const uniqueClash = e => /UNIQUE constraint failed/i.test(String(e && e.message));

async function createBooking(request, env, user, now) {
  requireUser(user);
  const body = await readJson(request);
  const date = str(body.date, 10);
  if (!R.isDate(date)) fail(400, "INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
  const household = houseFor(user, body.household);
  const periods = Array.isArray(body.periods) ? body.periods.slice(0, 3).map(String) : [];
  const [from, to] = ruleWindow(date);
  const existing = await bookingsBetween(env, from, to, now);
  const res = need(R.validateBookingMulti({ date, periods, household }, existing, RULES, now));
  const groupId = crypto.randomUUID();
  const stmts = res.periods.map(p => env.DB.prepare(
    "INSERT INTO bookings (group_id, date, period, house_id, created_by, source, status, quota) VALUES (?, ?, ?, ?, ?, 'BOOKING', 'BOOKED', ?) RETURNING " + BCOLS
  ).bind(groupId, date, p, household, user.id, res.quota ? 1 : 0));
  stmts.push(logEvent(env, user, household, "BOOK", "group:" + groupId, null, { date, periods: res.periods, quota: !!res.quota }));
  let out;
  try { out = await env.DB.batch(stmts); }
  catch (e) {
    if (uniqueClash(e)) fail(409, "SLOT_TAKEN", "Noen var litt raskere – perioden er nettopp booket. Se kalenderen på nytt.");
    throw e;
  }
  const made = out.slice(0, res.periods.length).map(r => toClient(r.results[0], now));
  return json({ bookings: made, periods: res.periods, fullDay: res.fullDay, quota: !!res.quota, lifted: !!res.lifted }, 201);
}

async function cancelBooking(env, user, id, now) {
  requireUser(user);
  const b = await getBookingRow(env, id, now);
  const res = need(R.validateCancel(b, user.role === "admin" ? b.household : user.house_id, RULES, now));
  const r = await env.DB.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ? AND status = 'BOOKED'")
    .bind(nowIso(), user.id, nowIso(), +id).run();
  if (!r.meta.changes) fail(409, "NOT_CANCELLABLE", "Denne bookingen kan ikke avbestilles.");
  await logEvent(env, user, b.household, "CANCEL", id, { status: b.status }, { status: "CANCELLED" }, user.role === "admin" && b.household !== user.house_id ? "avbestilt av administrator" : null).run();
  return json(Object.assign(await getBookingRow(env, id, now), { message: res.message }));
}

async function checkIn(env, user, id, now) {
  requireUser(user);
  const b = await getBookingRow(env, id, now);
  need(R.validateCheckin(b, user.role === "admin" ? b.household : user.house_id, RULES, now));
  const day = await bookingsBetween(env, b.date, b.date, now);
  const chain = R.checkinChain(day.find(x => x.id === b.id), day, RULES);
  const ts = nowIso();
  await env.DB.batch(chain.flatMap(x => [
    env.DB.prepare("UPDATE bookings SET status = 'CHECKED_IN', checked_in_at = ?, updated_at = ? WHERE id = ? AND status = 'BOOKED'").bind(ts, ts, +x.id),
    logEvent(env, user, b.household, "CHECKIN", x.id, { status: "BOOKED" }, { status: "CHECKED_IN" }, x.id === b.id ? null : "fulgte med innsjekken")
  ]));
  return json(Object.assign(await getBookingRow(env, id, now), { until: RULES.periods[chain[chain.length - 1].period].end, count: chain.length }));
}

async function spontaneous(request, env, user, now) {
  requireUser(user);
  const body = await readJson(request);
  const household = houseFor(user, body.household);
  const periods = Array.isArray(body.periods) ? body.periods.slice(0, 3).map(String) : [];
  const day = await bookingsBetween(env, now.date, now.date, now);
  const res = need(R.validateSpontaneous({ periods, household }, day, RULES, now));
  const groupId = crypto.randomUUID(), ts = nowIso();
  const stmts = res.periods.map(p => env.DB.prepare(
    "INSERT INTO bookings (group_id, date, period, house_id, created_by, source, status, quota, checked_in_at) VALUES (?, ?, ?, ?, ?, 'CHECKIN', 'CHECKED_IN', ?, ?) RETURNING " + BCOLS
  ).bind(groupId, now.date, p, household, user.id, res.quota ? 1 : 0, ts));
  stmts.push(logEvent(env, user, household, "CHECKIN", "group:" + groupId, null, { date: now.date, periods: res.periods }, "spontan"));
  let out;
  try { out = await env.DB.batch(stmts); }
  catch (e) { if (uniqueClash(e)) fail(409, "SLOT_TAKEN", "Den perioden er ikke ledig akkurat nå."); throw e; }
  return json({ bookings: out.slice(0, res.periods.length).map(r => toClient(r.results[0], now)), until: RULES.periods[res.periods[res.periods.length - 1]].end }, 201);
}

async function confirm(env, user, id, now) {
  requireUser(user);
  const b = await getBookingRow(env, id, now);
  need(R.validateConfirm(b, user.role === "admin" ? b.household : user.house_id, RULES, now));
  await env.DB.batch([
    env.DB.prepare("UPDATE bookings SET status = 'COMPLETED', confirmed_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), +id),
    logEvent(env, user, b.household, "CONFIRM", id, { status: "NOT_CONFIRMED" }, { status: "COMPLETED" }, "Vi brukte badehuset")
  ]);
  return json(await getBookingRow(env, id, now));
}

async function bookingDetails(env, user, id, now) {
  requireUser(user);
  const booking = await getBookingRow(env, id, now);
  const { results } = await env.DB.prepare(
    `SELECT e.ts, e.action, e.comment, e.house_id, u.display_name AS who FROM events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.target = ? OR e.target = ? ORDER BY e.id`
  ).bind(id, "group:" + booking.groupId).all();
  return json({ booking, events: results });
}

/* ---------------- Om oss (kontakter) ---------------- */

async function listContacts(env, user) {
  requireUser(user);
  const { results } = await env.DB.prepare(
    "SELECT h.id, h.name, h.color, i.* FROM houses h LEFT JOIN house_info i ON i.house_id = h.id ORDER BY h.id").all();
  return json(results.map(r => ({
    house: r.id, name: r.name, color: r.color, household: r.household || "",
    contacts: [1, 2].map(n => ({ name: r[`c${n}_name`] || "", email: r[`c${n}_email`] || "", phone: r[`c${n}_phone`] || "" })),
    note: r.note || "", updatedAt: r.updated_at || null,
    canEdit: user.role === "admin" || user.house_id === r.id
  })));
}

async function saveContacts(request, env, user, house) {
  requireUser(user);
  if (!HOUSES.includes(house)) fail(404, "NOT_FOUND", "Fant ikke huset.");
  if (user.role !== "admin" && user.house_id !== house) fail(403, "FORBIDDEN", "Du kan bare endre ditt eget hus.");
  const body = await readJson(request);
  const c = (Array.isArray(body.contacts) ? body.contacts : []).slice(0, 2);
  while (c.length < 2) c.push({});
  const clean = c.map(x => ({ name: str(x && x.name, 80), email: str(x && x.email, 120), phone: str(x && x.phone, 30) }));
  for (const x of clean) {
    if (x.email && !EMAIL_RE.test(x.email)) fail(400, "INVALID_INPUT", `«${x.email}» ser ikke ut som en e-postadresse.`);
    if (x.phone && !/^[0-9+() \-]{4,30}$/.test(x.phone)) fail(400, "INVALID_INPUT", `«${x.phone}» ser ikke ut som et mobilnummer.`);
  }
  const note = str(body.note, 1000);
  // Husstanden (navnene) endres bare når feltet er med i forespørselen.
  const household = typeof body.household === "string" ? str(body.household, 200)
    : ((await env.DB.prepare("SELECT household FROM house_info WHERE house_id = ?").bind(house).first()) || {}).household || "";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO house_info (house_id, household, c1_name, c1_email, c1_phone, c2_name, c2_email, c2_phone, note, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(house_id) DO UPDATE SET household = excluded.household, c1_name = excluded.c1_name, c1_email = excluded.c1_email, c1_phone = excluded.c1_phone,
        c2_name = excluded.c2_name, c2_email = excluded.c2_email, c2_phone = excluded.c2_phone, note = excluded.note,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(house, household, clean[0].name, clean[0].email, clean[0].phone, clean[1].name, clean[1].email, clean[1].phone, note, nowIso(), user.id),
    logEvent(env, user, house, "CONTACTS_UPDATE", "house:" + house)
  ]);
  return json({ ok: true, message: "Lagret." });
}

/* ---------------- Admin ---------------- */

async function adminUsers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, house_id, email, display_name, role, active, created_at, last_login_at, pw_changed_at FROM users ORDER BY role DESC, house_id, id").all();
  return json(results.map(u => ({ id: u.id, house: u.house_id, email: u.email, name: u.display_name, role: u.role,
    active: !!u.active, createdAt: u.created_at, lastLoginAt: u.last_login_at, passwordChangedAt: u.pw_changed_at })));
}

async function adminCreateUser(request, env, admin) {
  const body = await readJson(request);
  const house = str(body.house, 1).toUpperCase();
  const email = str(body.email, 200).toLowerCase();
  if (!HOUSES.includes(house)) fail(400, "INVALID_INPUT", "Velg hus A, B, C eller D.");
  if (!EMAIL_RE.test(email)) fail(400, "INVALID_INPUT", "Skriv en gyldig e-postadresse.");
  const problem = passwordProblem(body.password);
  if (problem) fail(400, "WEAK_PASSWORD", problem);
  const name = str(body.name, 80) || `Hus ${house}`;
  const taken = await env.DB.prepare("SELECT id FROM users WHERE role = 'house' AND house_id = ? AND active = 1").bind(house).first();
  if (taken) fail(409, "HOUSE_HAS_LOGIN", `Hus ${house} har allerede en innlogging. Deaktiver den først, eller gi den nytt passord.`);
  const old = await env.DB.prepare("SELECT id, role, active FROM users WHERE email = ?").bind(email).first();
  if (old && (old.active || old.role !== "house")) fail(409, "EMAIL_TAKEN", "Den e-postadressen er allerede i bruk.");
  const h = await hashPassword(body.password, env.SESSION_PEPPER);
  let id;
  if (old) {        // gjenbruk en deaktivert innlogging med samme e-post
    await env.DB.prepare("UPDATE users SET house_id = ?, display_name = ?, active = 1, pw_hash = ?, pw_salt = ?, pw_iterations = ?, pw_changed_at = ?, updated_at = ? WHERE id = ?")
      .bind(house, name, h.pw_hash, h.pw_salt, h.pw_iterations, nowIso(), nowIso(), old.id).run();
    id = old.id;
  } else {
    const r = await env.DB.prepare("INSERT INTO users (house_id, email, display_name, role, pw_hash, pw_salt, pw_iterations, pw_changed_at) VALUES (?, ?, ?, 'house', ?, ?, ?, ?) RETURNING id")
      .bind(house, email, name, h.pw_hash, h.pw_salt, h.pw_iterations, nowIso()).first();
    id = r.id;
  }
  await logEvent(env, admin, house, "USER_CREATE", "user:" + id, null, { house, email }).run();
  return json({ ok: true, id, message: `Innlogging for Hus ${house} er laget.` }, 201);
}

async function adminUserById(env, id) {
  if (!/^\d{1,9}$/.test(id)) fail(404, "NOT_FOUND", "Fant ikke brukeren.");
  const u = await env.DB.prepare("SELECT id, house_id, role, active FROM users WHERE id = ?").bind(+id).first();
  if (!u) fail(404, "NOT_FOUND", "Fant ikke brukeren.");
  return u;
}

async function adminResetPassword(request, env, admin, id) {
  const u = await adminUserById(env, id);
  const body = await readJson(request);
  const problem = passwordProblem(body.password);
  if (problem) fail(400, "WEAK_PASSWORD", problem);
  const h = await hashPassword(body.password, env.SESSION_PEPPER);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ?, pw_changed_at = ?, updated_at = ? WHERE id = ?")
      .bind(h.pw_hash, h.pw_salt, h.pw_iterations, nowIso(), nowIso(), u.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(nowIso(), u.id),
    logEvent(env, admin, u.house_id, "PASSWORD_RESET", "user:" + u.id)
  ]);
  return json({ ok: true, message: "Nytt passord er satt. Brukeren er logget ut på alle enheter." });
}

async function adminDeactivate(env, admin, id) {
  const u = await adminUserById(env, id);
  if (u.id === admin.id) fail(400, "INVALID_INPUT", "Du kan ikke deaktivere deg selv.");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").bind(nowIso(), u.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(nowIso(), u.id),
    logEvent(env, admin, u.house_id, "USER_DEACTIVATE", "user:" + u.id)
  ]);
  return json({ ok: true, message: "Innloggingen er deaktivert og logget ut." });
}

async function adminEvents(env, url) {
  const limit = Math.min(200, Math.max(1, +url.searchParams.get("limit") || 50));
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.ts, e.action, e.house_id AS house, e.target, e.comment, u.display_name AS who
       FROM events e LEFT JOIN users u ON u.id = e.actor_user_id ORDER BY e.id DESC LIMIT ?`).bind(limit).all();
  return json(results);
}

/* ---------------- Ruter ---------------- */

async function api(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  if (path === "/api/helse") return json({ ok: true, version: VERSION });

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    // Origin-sjekk: endringer må komme fra ht14.no selv (stopper CSRF).
    if (request.headers.get("Origin") !== url.origin) fail(403, "BAD_ORIGIN", "Forespørselen ble avvist.");
  }
  const now = clock(request, env);
  const user = await currentUser(request, env, ctx);
  let m;

  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") return logout(request, env, user);
  if (path === "/api/me" && method === "GET") {
    requireUser(user);
    return json({ user: publicUser(user), version: VERSION, now });
  }
  if (path === "/api/password" && method === "POST") return changeOwnPassword(request, env, user);

  if (path === "/api/bookings" && method === "GET") {
    requireUser(user);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!R.isDate(from) || !R.isDate(to) || to < from || R.diffDays(to, from) > 550) fail(400, "INVALID_INPUT", "Ugyldig periode.");
    return json(await bookingsBetween(env, from, to, now));
  }
  if (path === "/api/bookings" && method === "POST") return createBooking(request, env, user, now);
  if ((m = path.match(/^\/api\/bookings\/([^/]+)$/)) && method === "GET") return bookingDetails(env, user, m[1], now);
  if ((m = path.match(/^\/api\/bookings\/([^/]+)\/(cancel|checkin|confirm)$/)) && method === "POST")
    return ({ cancel: cancelBooking, checkin: checkIn, confirm })[m[2]](env, user, m[1], now);
  if (path === "/api/checkin" && method === "POST") return spontaneous(request, env, user, now);
  if (path === "/api/stats" && method === "GET") {
    requireUser(user);
    const year = +url.searchParams.get("year") || +now.date.slice(0, 4), month = +url.searchParams.get("month") || +now.date.slice(5, 7);
    if (year < 2020 || year > 2100 || month < 1 || month > 12) fail(400, "INVALID_INPUT", "Ugyldig periode.");
    return json(R.stats(await bookingsBetween(env, `${year}-01-01`, `${year}-12-31`, now), RULES, now, year, month));
  }

  if (path === "/api/contacts" && method === "GET") return listContacts(env, user);
  if ((m = path.match(/^\/api\/contacts\/([A-D])$/)) && method === "PUT") return saveContacts(request, env, user, m[1]);

  if (path.startsWith("/api/admin/")) {
    requireAdmin(user);
    if (path === "/api/admin/users" && method === "GET") return adminUsers(env);
    if (path === "/api/admin/users" && method === "POST") return adminCreateUser(request, env, user);
    if ((m = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/)) && method === "POST") return adminResetPassword(request, env, user, m[1]);
    if ((m = path.match(/^\/api\/admin\/users\/([^/]+)\/deactivate$/)) && method === "POST") return adminDeactivate(env, user, m[1]);
    if (path === "/api/admin/events" && method === "GET") return adminEvents(env, url);
  }
  fail(404, "NOT_FOUND", "Fant ikke denne adressen.");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, ctx, url);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.error, message: e.message, ...(e.extra || {}) }, e.status);
      // Logger bare feiltype og sti – aldri innhold i forespørselen (kan inneholde passord).
      console.error(JSON.stringify({ msg: "api_error", path: url.pathname, method: request.method, error: String(e && e.message || e).slice(0, 300) }));
      return json({ error: "SERVER", message: "Noe gikk galt. Prøv igjen om litt." }, 500);
    }
  },
  /** Nattlig kopi til GitHub (FluxReveal/ht14-data). Aktiveres med cron i wrangler.jsonc + GH_DATA_TOKEN. */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runExport(env));
  }
};
