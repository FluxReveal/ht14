/**
 * HT14 – innlogging, passord og økter.
 *
 * Passord: PBKDF2-SHA256 (WebCrypto) med eget salt per bruker og en hemmelig «pepper»:
 *   pw_hash = PBKDF2( HMAC-SHA256(SESSION_PEPPER, passord), salt, iterasjoner, 256 bit )
 * Antall iterasjoner (PW_ITERATIONS) er valgt så én innlogging bruker noen få ms CPU
 * og holder seg godt innenfor gratisplanens 10 ms per forespørsel (målt: ca. 4 ms).
 * Salt og iterasjoner lagres per bruker, så tallet kan økes senere: gamle hasher
 * oppgraderes automatisk ved neste vellykkede innlogging.
 *
 * Økter: tilfeldig 32-byte nøkkel i cookien __Host-ht14_okt. I databasen lagres
 * bare SHA-256 av nøkkelen, så en lekket database gir ingen gyldige økter.
 */
export const PW_ITERATIONS = 30000;
export const COOKIE = "__Host-ht14_okt";
export const SESSION_DAYS = 365;
const enc = new TextEncoder();

export const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** PBKDF2-SHA256 av (HMAC(pepper, passord)). Returnerer 32 byte. */
export async function derive(password, saltBytes, iterations, pepper) {
  const hk = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", hk, enc.encode(password));
  const pk = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, pk, 256);
}

export async function hashPassword(password, pepper) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PW_ITERATIONS, pepper);
  return { pw_hash: b64(bits), pw_salt: b64(salt), pw_iterations: PW_ITERATIONS };
}

/** Sammenligner i konstant tid. */
function sameBytes(a, b) {
  a = new Uint8Array(a); b = new Uint8Array(b);
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// Brukes når e-posten ikke finnes, så svaret tar like lang tid (ingen avsløring av hvem som har konto).
const DUMMY = { pw_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", pw_salt: "AAAAAAAAAAAAAAAAAAAAAA==", pw_iterations: PW_ITERATIONS };

export async function verifyPassword(password, user, pepper) {
  const u = user || DUMMY;
  const bits = await derive(password, unb64(u.pw_salt), u.pw_iterations, pepper);
  return !!user && sameBytes(bits, unb64(u.pw_hash));
}

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Passordet må ha minst 8 tegn.";
  if (pw.length > 200) return "Passordet er for langt.";
  return null;
}

export function newSessionToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

export function sessionCookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export function readCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}
