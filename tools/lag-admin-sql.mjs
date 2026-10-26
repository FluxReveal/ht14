#!/usr/bin/env node
/**
 * Lager SQL som legger inn en administrator, uten at passordet vises noe sted.
 * Brukes bare første gang (senere lager admin alt i appen).
 *
 *   PEPPER_FILE=sti EMAIL_FILE=sti PASSWORD_FILE=sti OUT=admin.sql node tools/lag-admin-sql.mjs
 *
 * Fila OUT inneholder hash (ikke passord) og skal slettes etter bruk. Ikke commit den.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hashPassword } from "../src/auth.js";

const read = k => readFileSync(process.env[k], "utf8").trim();
const email = read("EMAIL_FILE").toLowerCase();
const h = await hashPassword(read("PASSWORD_FILE"), read("PEPPER_FILE"));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
writeFileSync(process.env.OUT, `INSERT INTO users (house_id, email, display_name, role, pw_hash, pw_salt, pw_iterations, pw_changed_at)
VALUES (NULL, ${q(email)}, 'Thomas (admin)', 'admin', ${q(h.pw_hash)}, ${q(h.pw_salt)}, ${h.pw_iterations}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin', active = 1, pw_hash = excluded.pw_hash, pw_salt = excluded.pw_salt,
  pw_iterations = excluded.pw_iterations, pw_changed_at = excluded.pw_changed_at;\n`, { mode: 0o600 });
console.log("SQL skrevet (uten passord).");
