/**
 * API-tester mot en lokal Worker (wrangler dev) med lokal D1 – ALDRI mot produksjon.
 *
 *   npx wrangler d1 execute ht14 --local --file schema.sql
 *   (lag lokal admin med tools/lag-admin-sql.mjs og .dev.vars, se README)
 *   npx wrangler dev --port 8787 &
 *   API_BASE=http://127.0.0.1:8787 ADMIN_EMAIL=… ADMIN_PASSWORD=… node --test tools/tests/api.test.mjs
 *
 * Krever ALLOW_TEST_CLOCK=1 i .dev.vars (fast testklokke via X-Test-Now).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../../public/badehusappen/js/rules-engine.js");

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
if (/ht14\.no/.test(BASE)) throw new Error("API-testene skal ikke kjøres mot produksjon.");
const NOW = "2027-04-15T08:00:00Z";            // torsdag 15. april 2027
const RUN = Date.now().toString(36);

async function call(method, path, { body, cookie, origin = BASE, headers = {} } = {}) {
  const h = { "X-Test-Now": NOW, ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: set ? set.split(";")[0] : null, setCookie: set };
}
const login = async (email, password) => (await call("POST", "/api/login", { body: { email, password } }));

// Første torsdag/fredag i juni 2027 osv.
const days = wd => { const out = []; for (let d = "2027-06-01"; d <= "2027-06-30"; d = R.addDays(d, 1)) if (R.weekday(d) === wd) out.push(d); return out; };
const THU = days("thu"), FRI = days("fri"), SUN = days("sun");

let admin, houseA, houseB, emailA, emailB;
const PW_A = "Hus-A-test-" + RUN, PW_B = "Hus-B-test-" + RUN;

test("helse svarer uten innlogging", async () => {
  const r = await call("GET", "/api/helse");
  assert.equal(r.status, 200); assert.equal(r.data.ok, true);
});

test("kontakter, bookinger og admin er skjult uten innlogging (401)", async () => {
  for (const p of ["/api/contacts", "/api/me", "/api/bookings?from=2027-06-01&to=2027-06-30", "/api/admin/users"])
    assert.equal((await call("GET", p)).status, 401, p);
});

test("feil innlogging gir samme generelle melding (ingen avsløring av e-post)", async () => {
  const a = await login(process.env.ADMIN_EMAIL, "feil-passord-123");
  const b = await login("finnes-ikke-" + RUN + "@example.no", "feil-passord-123");
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(a.data, b.data);
  assert.equal(a.cookie, null);
});

test("Origin-sjekk: POST uten eller med fremmed Origin avvises", async () => {
  assert.equal((await call("POST", "/api/login", { body: {}, origin: null })).status, 403);
  assert.equal((await call("POST", "/api/login", { body: {}, origin: "https://ondsinnet.example" })).status, 403);
});

test("admin logger inn og cookien er riktig satt", async () => {
  const r = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  assert.equal(r.status, 200); assert.equal(r.data.user.admin, true);
  assert.match(r.setCookie, /^__Host-ht14_okt=[\w-]{40,};/);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=31536000"]) assert.ok(r.setCookie.includes(flag), flag);
  assert.ok(!JSON.stringify(r.data).includes("pw_"));
  admin = r.cookie;
});

test("admin lager én innlogging for Hus A og Hus B (uten hasher i svar)", async () => {
  const list = await call("GET", "/api/admin/users", { cookie: admin });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.data).match(/pw_|hash|salt/i));
  for (const u of list.data.filter(u => u.role === "house" && u.active))       // rydd fra forrige kjøring
    assert.equal((await call("POST", `/api/admin/users/${u.id}/deactivate`, { cookie: admin })).status, 200);
  emailA = `hus-a-${RUN}@example.no`; emailB = `hus-b-${RUN}@example.no`;
  assert.equal((await call("POST", "/api/admin/users", { cookie: admin, body: { house: "A", email: emailA, password: PW_A } })).status, 201);
  assert.equal((await call("POST", "/api/admin/users", { cookie: admin, body: { house: "B", email: emailB, password: PW_B } })).status, 201);
  const dup = await call("POST", "/api/admin/users", { cookie: admin, body: { house: "A", email: "x" + emailA, password: PW_A } });
  assert.equal(dup.status, 409, "bare én aktiv innlogging per hus");
  const weak = await call("POST", "/api/admin/users", { cookie: admin, body: { house: "C", email: "c" + emailA, password: "kort" } });
  assert.equal(weak.status, 400);
  houseA = (await login(emailA, PW_A)).cookie; houseB = (await login(emailB, PW_B)).cookie;
  assert.ok(houseA && houseB);
});

test("hus-bruker stoppes fra alle admin-endepunkter (403)", async () => {
  assert.equal((await call("GET", "/api/admin/users", { cookie: houseA })).status, 403);
  assert.equal((await call("POST", "/api/admin/users", { cookie: houseA, body: { house: "C", email: "c@example.no", password: "12345678910" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/users/1/password", { cookie: houseA, body: { password: "12345678910" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/users/1/deactivate", { cookie: houseA })).status, 403);
  assert.equal((await call("GET", "/api/admin/events", { cookie: houseA })).status, 403);
});

let firstThu;
test("sommerkvote: én torsdag per måned, ikke to begrensede dager samme uke", async () => {
  const a = await call("POST", "/api/bookings", { cookie: houseA, body: { date: THU[0], periods: ["PM"] } });
  assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(a.data.quota, true);
  firstThu = a.data.bookings[0];
  assert.equal(firstThu.household, "A");
  const b = await call("POST", "/api/bookings", { cookie: houseA, body: { date: THU[1], periods: ["PM"] } });
  assert.equal(b.status, 400); assert.equal(b.data.error, "QUOTA_WEEKDAY");
  const c = await call("POST", "/api/bookings", { cookie: houseA, body: { date: FRI[0] > THU[0] && R.mondayOf(FRI[0]) === R.mondayOf(THU[0]) ? FRI[0] : FRI[1], periods: ["PM"] } });
  assert.equal(c.status, 400); assert.equal(c.data.error, "WEEK_LIMIT");
  const s = await call("POST", "/api/bookings", { cookie: houseA, body: { date: SUN[0], periods: ["PM"] } });
  assert.equal(s.status, 201); assert.equal(s.data.quota, false, "søndag er fri");
});

test("hus-bruker kan ikke booke for et annet hus", async () => {
  const r = await call("POST", "/api/bookings", { cookie: houseB, body: { date: SUN[1], periods: ["PM"], household: "A" } });
  assert.equal(r.status, 201); assert.equal(r.data.bookings[0].household, "B");
});

test("dobbeltbooking stoppes – også ved samtidige forespørsler", async () => {
  const taken = await call("POST", "/api/bookings", { cookie: houseB, body: { date: THU[0], periods: ["PM"] } });
  assert.equal(taken.status, 409); assert.equal(taken.data.error, "SLOT_TAKEN");
  const day = SUN[2];
  const [x, y] = await Promise.all([
    call("POST", "/api/bookings", { cookie: houseA, body: { date: day, periods: ["AM", "MID"] } }),
    call("POST", "/api/bookings", { cookie: houseB, body: { date: day, periods: ["MID"] } })
  ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  const list = await call("GET", `/api/bookings?from=${day}&to=${day}`, { cookie: houseA });
  assert.equal(list.data.filter(b => b.period === "MID" && b.status !== "CANCELLED").length, 1);
});

test("avbestilling frigjør kvoten; andre hus kan ikke avbestille", async () => {
  const other = await call("POST", `/api/bookings/${firstThu.id}/cancel`, { cookie: houseB });
  assert.equal(other.status, 403);
  const own = await call("POST", `/api/bookings/${firstThu.id}/cancel`, { cookie: houseA });
  assert.equal(own.status, 200); assert.equal(own.data.status, "CANCELLED");
  const again = await call("POST", "/api/bookings", { cookie: houseA, body: { date: THU[1], periods: ["PM"] } });
  assert.equal(again.status, 201, "ny torsdag går fordi den avbestilte ikke teller");
  const freed = await call("POST", "/api/bookings", { cookie: houseB, body: { date: THU[0], periods: ["PM"] } });
  assert.equal(freed.status, 201, "perioden er ledig for andre");
  const adm = await call("POST", `/api/bookings/${freed.data.bookings[0].id}/cancel`, { cookie: admin });
  assert.equal(adm.status, 200, "admin kan avbestille alle");
});

test("Om oss: eget hus kan endres, andre hus ikke; husstanden beholdes", async () => {
  const body = { contacts: [{ name: "Test Person", email: "test@example.no", phone: "+47 400 00 000" }], note: "Hei" };
  assert.equal((await call("PUT", "/api/contacts/A", { cookie: houseA, body })).status, 200);
  assert.equal((await call("PUT", "/api/contacts/B", { cookie: houseA, body })).status, 403);
  assert.equal((await call("PUT", "/api/contacts/B", { cookie: admin, body: { contacts: [], note: "Admin" } })).status, 200);
  assert.equal((await call("PUT", "/api/contacts/A", { cookie: houseA, body: { contacts: [{ email: "ikke-epost" }] } })).status, 400);
  const before = (await call("GET", "/api/contacts", { cookie: houseB })).data;
  const a = before.find(h => h.house === "A");
  assert.equal(a.contacts[0].name, "Test Person"); assert.equal(a.canEdit, false);
  assert.equal(a.contacts.length, 2);
  assert.equal(typeof a.household, "string");
});

test("bytte eget passord logger ut andre enheter", async () => {
  const second = (await login(emailA, PW_A)).cookie;
  const bad = await call("POST", "/api/password", { cookie: houseA, body: { current: "feil", next: "Nytt-passord-" + RUN } });
  assert.equal(bad.status, 400);
  const ok = await call("POST", "/api/password", { cookie: houseA, body: { current: PW_A, next: "Nytt-passord-" + RUN } });
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/api/me", { cookie: houseA })).status, 200, "denne enheten er fortsatt innlogget");
  assert.equal((await call("GET", "/api/me", { cookie: second })).status, 401, "andre enheter er logget ut");
  assert.equal((await login(emailA, "Nytt-passord-" + RUN)).status, 200);
});

test("admin nullstiller passord og deaktiverer – øktene stoppes", async () => {
  const users = (await call("GET", "/api/admin/users", { cookie: admin })).data;
  const b = users.find(u => u.email === emailB);
  assert.equal((await call("POST", `/api/admin/users/${b.id}/password`, { cookie: admin, body: { password: "Reset-pass-" + RUN } })).status, 200);
  assert.equal((await call("GET", "/api/me", { cookie: houseB })).status, 401);
  const nb = (await login(emailB, "Reset-pass-" + RUN)).cookie;
  assert.equal((await call("POST", `/api/admin/users/${b.id}/deactivate`, { cookie: admin })).status, 200);
  assert.equal((await call("GET", "/api/me", { cookie: nb })).status, 401);
  assert.equal((await login(emailB, "Reset-pass-" + RUN)).status, 401);
});

test("utlogging stopper økten", async () => {
  const c = (await login(emailA, "Nytt-passord-" + RUN)).cookie;
  const out = await call("POST", "/api/logout", { cookie: c });
  assert.equal(out.status, 200); assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call("GET", "/api/me", { cookie: c })).status, 401);
});

test("pause etter 5 feil passord – også riktig passord stoppes en stund", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login(emailA, "feil-" + i)).status, 401);
  const locked = await login(emailA, "Nytt-passord-" + RUN);
  assert.equal(locked.status, 429); assert.equal(locked.cookie, null);
  const unknown = "ukjent-" + RUN + "@example.no";
  for (let i = 0; i < 5; i++) await login(unknown, "feil-" + i);
  assert.equal((await login(unknown, "x")).status, 429, "samme oppførsel for ukjent e-post");
});
