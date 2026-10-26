-- =====================================================================
-- HT14 – D1-database «ht14»  ·  UTKAST
-- Dette er bare et førsteutkast. Det er IKKE lagt inn i databasen.
-- Legges inn først når sameiet har godkjent reglene, med:
--   npx wrangler d1 execute ht14 --remote --file=schema.sql
-- Tider lagres som ISO 8601 i UTC (tekst). Datoer (YYYY-MM-DD) er norsk dato.
-- =====================================================================

-- D1 håndhever fremmednøkler (foreign keys) automatisk.

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

-- Innlogginger: én felles innlogging per hus (role = 'house'), pluss administratorer.
-- Passord lagres bare som PBKDF2-hash (salt + antall runder + SESSION_PEPPER som hemmelighet).
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
  must_change_pw INTEGER NOT NULL DEFAULT 1 CHECK (must_change_pw IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  CHECK (role <> 'house' OR house_id IS NOT NULL)
);
-- Bare én aktiv hus-innlogging per hus.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_login_per_house
  ON users (house_id) WHERE role = 'house' AND active = 1;

-- Bookinger. Én rad per periode; en heldag er tre rader med samme group_id.
-- Perioder: AM = 10–14, MID = 14–17, PM = 17–24.
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY,
  group_id      TEXT NOT NULL,
  date          TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period        TEXT NOT NULL CHECK (period IN ('AM', 'MID', 'PM')),
  house_id      TEXT NOT NULL REFERENCES houses(id),
  user_id       INTEGER REFERENCES users(id),
  source        TEXT NOT NULL DEFAULT 'BOOKING' CHECK (source IN ('BOOKING', 'CHECKIN')),
  status        TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN
                  ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NOT_CONFIRMED', 'CANCELLED', 'CANCELLED_LATE')),
  quota         INTEGER NOT NULL DEFAULT 1 CHECK (quota IN (0, 1)),      -- teller i sommerkvoten
  override      INTEGER NOT NULL DEFAULT 0 CHECK (override IN (0, 1)),   -- admin-unntak
  corrected     INTEGER NOT NULL DEFAULT 0 CHECK (corrected IN (0, 1)),  -- rettet av admin
  comment       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT,
  cancelled_at  TEXT
);
-- Ingen dobbeltbooking: bare én aktiv booking per dato og periode.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_slot
  ON bookings (date, period) WHERE status NOT IN ('CANCELLED', 'CANCELLED_LATE');
CREATE INDEX IF NOT EXISTS bookings_house_date ON bookings (house_id, date);
CREATE INDEX IF NOT EXISTS bookings_group ON bookings (group_id);

-- Økter (cookie __Host-ht14_okt, ca. ett år). Bare SHA-256 av cookie-verdien lagres.
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

-- Feil passord: gir en kort pause etter flere forsøk.
CREATE TABLE IF NOT EXISTS login_attempts (
  key               TEXT PRIMARY KEY,            -- e-post (små bokstaver) eller hash av IP
  failures          INTEGER NOT NULL DEFAULT 0,
  first_failure_at  TEXT,
  locked_until      TEXT
);

-- Hendelseslogg: hvem, når, hva, fra, til og kommentar. Slettes aldri.
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY,
  ts             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_user_id  INTEGER REFERENCES users(id),
  house_id       TEXT REFERENCES houses(id),
  action         TEXT NOT NULL,   -- f.eks. BOOK, CANCEL, CHECKIN, CONFIRM, CORRECT, LOGIN, LOGOUT, PASSWORD_RESET, RULES_CHANGE
  target         TEXT,            -- f.eks. booking-id eller bruker-id
  from_json      TEXT,
  to_json        TEXT,
  comment        TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

-- Den nattlige kopien til FluxReveal/ht14-data leser bookings og users,
-- men tar ALDRI med pw_hash, pw_salt eller pw_iterations.
