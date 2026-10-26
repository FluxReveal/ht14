/**
 * Nattlig kopi av sameiets data til GitHub-repoet FluxReveal/ht14-data (privat).
 *
 * Skriver CSV + JSON til mappen data/ i repoet. Git-historikken gir en kopi per natt.
 * Tas med:  bookinger, innlogginger (uten passord-hash, salt og iterasjoner),
 *           Om oss-kontakter og hendelseslogg.
 * Tas ALDRI med: passord-hasher, salt, økter (sessions) eller innloggingsforsøk.
 *
 * Krever hemmeligheten GH_DATA_TOKEN (fine-grained token med bare «Contents: Read and write»
 * på FluxReveal/ht14-data) og at cron-linjen i wrangler.jsonc slås på.
 */
const REPO = "FluxReveal/ht14-data";
const BRANCH = "main";

const QUERIES = {
  bookings: "SELECT id, group_id, date, period, house_id, created_by, source, status, quota, created_at, checked_in_at, confirmed_at, cancelled_at, cancelled_by, updated_at FROM bookings ORDER BY date, id",
  users: "SELECT id, house_id, email, display_name, role, active, created_at, updated_at, pw_changed_at, last_login_at FROM users ORDER BY id",
  contacts: "SELECT house_id, household, c1_name, c1_email, c1_phone, c2_name, c2_email, c2_phone, note, updated_at, updated_by FROM house_info ORDER BY house_id",
  events: "SELECT id, ts, actor_user_id, house_id, action, target, from_json, to_json, comment FROM events ORDER BY id"
};

export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = v => {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;               // hindrer formler i Excel
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export async function collect(env) {
  const out = {};
  for (const [name, sql] of Object.entries(QUERIES)) out[name] = (await env.DB.prepare(sql).all()).results;
  return out;
}

const b64utf8 = s => { const b = new TextEncoder().encode(s); let x = ""; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };

async function putFile(token, path, content, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "ht14-worker", "X-GitHub-Api-Version": "2022-11-28" };
  const cur = await fetch(`${url}?ref=${BRANCH}`, { headers });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ message, content: b64utf8(content), branch: BRANCH, sha }) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
}

export async function runExport(env) {
  if (!env.GH_DATA_TOKEN) { console.log(JSON.stringify({ msg: "export_skipped", reason: "GH_DATA_TOKEN mangler" })); return; }
  const data = await collect(env);
  const day = new Date().toISOString().slice(0, 10);
  const msg = `Nattlig kopi ${day}`;
  for (const [name, rows] of Object.entries(data)) {
    await putFile(env.GH_DATA_TOKEN, `data/${name}.csv`, toCsv(rows), msg);
    await putFile(env.GH_DATA_TOKEN, `data/${name}.json`, JSON.stringify(rows, null, 1), msg);
  }
  console.log(JSON.stringify({ msg: "export_done", day, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) }));
}
