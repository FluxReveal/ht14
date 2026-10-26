// Enhetstester for serverdelen: passord-hash (src/auth.js), eksport (src/export.js)
// og at Workeren bruker den samme regelmotoren som appen.  Kjøres med «npm test».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPassword, verifyPassword, passwordProblem, PW_ITERATIONS, sessionCookie, readCookie, sha256hex } from "../../src/auth.js";
import { toCsv, collect } from "../../src/export.js";

test("passord: hash kan verifiseres, feil passord og feil pepper avvises", async () => {
  const h = await hashPassword("Hemmelig-passord-1", "pepper-1");
  assert.equal(h.pw_iterations, PW_ITERATIONS);
  assert.ok(!JSON.stringify(h).includes("Hemmelig"));
  assert.equal(await verifyPassword("Hemmelig-passord-1", h, "pepper-1"), true);
  assert.equal(await verifyPassword("hemmelig-passord-1", h, "pepper-1"), false);
  assert.equal(await verifyPassword("Hemmelig-passord-1", h, "pepper-2"), false);
  assert.equal(await verifyPassword("Hemmelig-passord-1", null, "pepper-1"), false, "ukjent bruker");
});

test("passord: eget salt per bruker gir ulike hasher for samme passord", async () => {
  const a = await hashPassword("samme-passord", "p"), b = await hashPassword("samme-passord", "p");
  assert.notEqual(a.pw_salt, b.pw_salt); assert.notEqual(a.pw_hash, b.pw_hash);
});

test("passord: iterasjoner er innenfor workerd-grensen og gir noen ms CPU", async () => {
  assert.ok(PW_ITERATIONS >= 5000 && PW_ITERATIONS <= 100000);
  const t = performance.now(); await hashPassword("x".repeat(20), "p"); const ms = performance.now() - t;
  assert.ok(ms < 50, `${ms} ms`);
});

test("passord: minst 8 tegn", () => {
  assert.ok(passwordProblem("kort"));
  assert.equal(passwordProblem("langt-nok"), null);
});

test("cookie: __Host- med HttpOnly, Secure, SameSite=Lax og Path=/", () => {
  const c = sessionCookie("abc", 31536000);
  assert.match(c, /^__Host-ht14_okt=abc; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(readCookie(new Request("https://ht14.no/", { headers: { Cookie: "a=1; __Host-ht14_okt=xyz" } })), "xyz");
});

test("økt-id er SHA-256 (ikke selve cookien)", async () => {
  assert.equal(await sha256hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("eksport: aldri passord-hash, salt, økter eller innloggingsforsøk", async () => {
  const seen = [];
  const env = { DB: { prepare: sql => { seen.push(sql); return { all: async () => ({ results: [] }) }; } } };
  await collect(env);
  const all = seen.join("\n");
  assert.ok(!/pw_hash|pw_salt|pw_iterations/.test(all), "ingen passordfelt");
  assert.ok(!/sessions|login_attempts/.test(all), "ingen økter");
  assert.ok(!/\*/.test(all), "ingen SELECT *");
});

test("eksport: CSV med anførselstegn og vern mot formler i Excel", () => {
  const csv = toCsv([{ a: 'Hei, "du"', b: "=1+1", c: null }]);
  assert.equal(csv, 'a,b,c\r\n"Hei, ""du""",\'=1+1,\r\n');
});

test("Workeren bruker samme regelmotor og rules.json som appen", () => {
  const src = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/public\/badehusappen\/js\/rules-engine\.js"/);
  assert.match(src, /from "\.\.\/public\/badehusappen\/rules\.json"/);
  assert.match(src, /R\.validateBookingMulti\(/); assert.match(src, /R\.validateCancel\(/);
  assert.match(src, /R\.validateCheckin\(/); assert.match(src, /R\.validateSpontaneous\(/); assert.match(src, /R\.validateConfirm\(/);
});

test("skjemaet stopper dobbeltbooking og har én aktiv innlogging per hus", () => {
  const sql = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_slot\s+ON bookings \(date, period\) WHERE status <> 'CANCELLED'/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS users_one_login_per_house\s+ON users \(house_id\) WHERE role = 'house' AND active = 1/);
});

test("ikonene (src/ikoner.js) er gyldige PNG/ICO og matcher manifestet", async () => {
  const { ICONS } = await import("../../src/ikoner.js");
  const { readFileSync } = await import("node:fs");
  const bytes = b64 => Buffer.from(b64, "base64");
  for (const [path, icon] of Object.entries(ICONS)) {
    const b = bytes(icon.b64);
    if (icon.type === "image/png") assert.equal(b.subarray(1, 4).toString(), "PNG", path);
    else { assert.equal(icon.type, "image/x-icon"); assert.equal(b.readUInt16LE(2), 1, path); assert.equal(b.readUInt16LE(4), 3, path + " (16/32/48)"); }
  }
  const man = JSON.parse(readFileSync(new URL("../../public/badehusappen/manifest.webmanifest", import.meta.url), "utf8"));
  for (const i of man.icons.filter(i => i.type === "image/png")) {
    assert.ok(ICONS[i.src], i.src);
    const b = bytes(ICONS[i.src].b64);
    assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, i.sizes, i.src);
  }
  assert.ok(ICONS["/apple-touch-icon.png"] && ICONS["/badehusappen/ikoner/apple-touch-icon.png"]);
});
