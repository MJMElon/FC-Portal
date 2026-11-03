/* Offline re-login, for a phone that has signed in before.
 *
 * Signing in fresh needs the Supabase server — the password lives there, and
 * no signal means no answer. But logging OUT and back IN on a shared phone in
 * a nursery with no line is a real morning, so the phone keeps what it can:
 * on every successful ONLINE password login, the session Supabase handed back
 * is stored SEALED UNDER THAT PASSWORD — PBKDF2 (SHA-256, 310,000 rounds)
 * derives an AES-GCM key, and only the ciphertext is kept, one entry per
 * email. Nothing readable is stored: without the password the entry is noise,
 * and a wrong password does not "almost" open it — GCM authenticates, so it
 * simply fails.
 *
 * Sign-out clears the LIVE session exactly as it always did. The vault entry
 * stays, because it is the whole point: at the login screen with no line, the
 * typed password either opens the sealed copy — and the person is back in on
 * their own credentials — or nothing happens. A phone that has never signed
 * in as that account has nothing to open, so the FIRST login still needs
 * signal; that is not a gap, it is the security model.
 *
 * Same file, same rules, in the Mobile (admin portal) repository —
 * src/lib/offlineVault.js there. Change one, change the other.
 */

const VKEY = 'mjm_offline_vault_v1';

const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const norm = (email) => String(email || '').trim().toLowerCase();

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(VKEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveAll(v) {
  try {
    localStorage.setItem(VKEY, JSON.stringify(v));
  } catch (e) { /* full or refused storage — the online path is unaffected */ }
}

async function keyFor(password, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Seal `payload` under this person's password. Quietly does nothing when
    WebCrypto is unavailable (http:// on a LAN, an ancient webview) — the
    phone then simply cannot re-login offline, same as before this existed. */
export async function sealOffline(email, password, payload) {
  try {
    if (!norm(email) || !password || !payload) return false;
    if (typeof crypto === 'undefined' || !crypto.subtle) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(password, salt);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      te.encode(JSON.stringify(payload))
    );
    const all = loadAll();
    all[norm(email)] = { salt: b64(salt), iv: b64(iv), ct: b64(ct), at: Date.now() };
    saveAll(all);
    return true;
  } catch (e) {
    return false;
  }
}

/** The sealed payload back, or null — wrong password, no entry, no WebCrypto.
    Which of those it was is not distinguishable from the ciphertext, and that
    is a feature; hasOffline() answers the "is there anything here" half. */
export async function openOffline(email, password) {
  try {
    const e = loadAll()[norm(email)];
    if (!e || typeof crypto === 'undefined' || !crypto.subtle) return null;
    const key = await keyFor(password, unb64(e.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct));
    return JSON.parse(td.decode(pt));
  } catch (e) {
    return null;
  }
}

/** Whether this phone holds a sealed copy for this email at all. */
export function hasOffline(email) {
  return !!loadAll()[norm(email)];
}

/** Throw away this phone's sealed copy for one email. Used when the account
    turns out to be one that may not use this portal at all (a Sales Web
    customer) — keeping a way to re-enter offline for an account the portal
    has just refused would be keeping the door it just shut. */
export function forgetOffline(email) {
  const all = loadAll();
  if (!all[norm(email)]) return false;
  delete all[norm(email)];
  saveAll(all);
  return true;
}
