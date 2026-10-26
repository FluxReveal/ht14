-- =====================================================================
-- HT14 versjon 0.5 – D1-database «ht14» (og «ht14-test» for forhåndsvisninger)
-- Legges inn med:  npx wrangler d1 execute ht14 --remote --file=schema.sql
-- Trygt å kjøre flere ganger (IF NOT EXISTS / INSERT OR IGNORE).
-- Tider lagres som ISO 8601 i UTC (tekst). Datoer (YYYY-MM-DD) er norsk dato.
-- D1 håndhever fremmednøkler (foreign keys) automatisk.
-- =====================================================================

-- Husene i sameiet. Faste: A–D.
CREATE TABLE IF NOT EXISTS houses (
  id         TEXT PRIMARY KEY CHECK (id IN ('A', 'B', 'C', 'D')),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL
);
INSERT OR IGNORE INTO houses (id, name, color) VALUES
  ('A', 'Halden Terrasse 14A', '#2563eb'),
  ('B', 'Halden Terrasse 14B', '#16a34a'),
  ('C', 'Halden Terrasse 14C', '#ea580c'),
  ('D', 'Halden Terrasse 14D', '#7c3aed');

-- Innlogginger: én felles innlogging per hus (role = 'house'), pluss administratorer (role = 'admin').
-- Passord lagres bare som PBKDF2-SHA256-hash: pw_hash = PBKDF2(HMAC-SHA256(SESSION_PEPPER, passord), pw_salt, pw_iterations).
-- pw_hash, pw_salt og pw_iterations forlater ALDRI databasen (ikke i API, eksport eller logg).
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  house_id       TEXT REFERENCES houses(id),
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'house' CHECK (role IN ('house', 'admin')),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  pw_hash        TEXT NOT NULL,
  pw_salt        TEXT NOT NULL,
  pw_iterations  INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  pw_changed_at  TEXT,
  last_login_at  TEXT,
  CHECK (role <> 'house' OR house_id IS NOT NULL)
);
-- Bare én aktiv hus-innlogging per hus.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_login_per_house
  ON users (house_id) WHERE role = 'house' AND active = 1;

-- Bookinger. Én rad per periode; flere perioder samme dag har felles group_id.
-- Perioder: AM = 10–14, MID = 14–17, PM = 17–24 (se public/badehusappen/rules.json).
CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY,
  group_id       TEXT NOT NULL,
  date           TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period         TEXT NOT NULL CHECK (period IN ('AM', 'MID', 'PM')),
  house_id       TEXT NOT NULL REFERENCES houses(id),
  created_by     INTEGER REFERENCES users(id),
  source         TEXT NOT NULL DEFAULT 'BOOKING' CHECK (source IN ('BOOKING', 'CHECKIN')),
  status         TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN
                   ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NOT_CONFIRMED', 'CANCELLED')),
  quota          INTEGER NOT NULL DEFAULT 0 CHECK (quota IN (0, 1)),      -- teller i sommerkvoten
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  checked_in_at  TEXT,
  confirmed_at   TEXT,
  cancelled_at   TEXT,
  cancelled_by   INTEGER REFERENCES users(id),
  updated_at     TEXT
);
-- Ingen dobbeltbooking: bare én aktiv booking per dato og periode (avbestilte teller ikke).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_slot
  ON bookings (date, period) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date);
CREATE INDEX IF NOT EXISTS bookings_house_date ON bookings (house_id, date);

-- Om oss: husstanden (hvem som bor der), inntil to kontaktpersoner per hus og et fritt tekstfelt.
-- Alt her vises bare for innloggede. Navnene legges inn i databasen, aldri i repoet.
CREATE TABLE IF NOT EXISTS house_info (
  house_id    TEXT PRIMARY KEY REFERENCES houses(id),
  household   TEXT NOT NULL DEFAULT '',   -- f.eks. «Ola og Kari Nordmann» (kan være flere enn to personer)
  c1_name     TEXT NOT NULL DEFAULT '',
  c1_email    TEXT NOT NULL DEFAULT '',
  c1_phone    TEXT NOT NULL DEFAULT '',
  c2_name     TEXT NOT NULL DEFAULT '',
  c2_email    TEXT NOT NULL DEFAULT '',
  c2_phone    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT,
  updated_by  INTEGER REFERENCES users(id)
);
INSERT OR IGNORE INTO house_info (house_id) VALUES ('A'), ('B'), ('C'), ('D');

-- Økter (cookie __Host-ht14_okt, ca. ett år). Bare SHA-256 av cookie-verdien lagres (id).
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at  TEXT,
  expires_at    TEXT NOT NULL,
  user_agent    TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- Feil passord: pause etter flere forsøk. key = 'e:' + SHA-256(e-post) eller 'i:' + SHA-256(IP).
CREATE TABLE IF NOT EXISTS login_attempts (
  key               TEXT PRIMARY KEY,
  failures          INTEGER NOT NULL DEFAULT 0,
  first_failure_at  TEXT,
  locked_until      TEXT
);

-- Hendelseslogg: hvem, når, hva, fra, til og kommentar. Aldri passord.
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY,
  ts             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_user_id  INTEGER REFERENCES users(id),
  house_id       TEXT REFERENCES houses(id),
  action         TEXT NOT NULL,   -- BOOK, CANCEL, CHECKIN, CONFIRM, LOGIN, LOGOUT, PASSWORD_CHANGE, PASSWORD_RESET, USER_CREATE, USER_DEACTIVATE, CONTACTS_UPDATE
  target         TEXT,
  from_json      TEXT,
  to_json        TEXT,
  comment        TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

-- Den nattlige kopien til FluxReveal/ht14-data (scheduled() i src/index.js) leser
-- bookings, users (uten pw_*), house_info og events – aldri sessions eller login_attempts.
