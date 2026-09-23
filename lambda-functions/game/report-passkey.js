/**
 * THE SECOND ITEM A SHARED REPORT NEEDS.
 *
 * A saved report is shared by link, and the link alone used to be enough. It
 * was meant to be a bearer URL, but its key is `<title>-<date>-<gameId>.pdf.enc`
 * and everyone in the room knows all three parts — the title is on the
 * projector, the date is today, the code is the code. Anyone there could build
 * the link and read every answer with a name against it.
 *
 * The owner, 2026-09-23: "perhaphs for anyone to get it there could be a second
 * item a passkey that the host can give out so that if you are not logged in
 * you could share it with the passkey."
 *
 * So save-report.js mints one of these per saved report, hands it to the host
 * ONCE, and stores only a salted hash beside the object. download-report.js
 * opens the report only for a request carrying it. Signed-in members of the
 * owning team never need it: they open reports from the Reports list, which
 * authorises on their own index row (download-saved-report.js).
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────
 *
 * Ten characters of Crockford base32, shown as two groups of five: 50 bits,
 * short enough to read aloud or type from a text message. No I, L, O or U, so
 * nothing is ambiguous, and input is forgiving the way Crockford specifies —
 * case, spaces and dashes are ignored, and I/L read as 1, O as 0.
 *
 * ── WHY SCRYPT, AND NOT A PLAIN HASH ─────────────────────────────────────
 *
 * The hash lives in S3 object metadata, which anyone who can list the bucket
 * can read. 50 bits under a salted SHA-256 falls to one GPU in minutes, and the
 * passkey would then open the decrypted PDF through the public route with no
 * KMS permission of the attacker's own. scrypt at N=2^14 costs ~50ms per guess,
 * which puts the same search out of reach, and one hash per save or download
 * is nothing on a Lambda.
 */
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

/** A fresh passkey, formatted for the host: `XXXXX-XXXXX`. */
function generatePasskey() {
  const bytes = crypto.randomBytes(LENGTH);
  let out = '';
  // 256 is a multiple of 32, so `byte % 32` is uniform over the alphabet.
  for (let i = 0; i < LENGTH; i += 1) out += ALPHABET[bytes[i] % 32];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** What a person typed, reduced to the canonical ten characters, or ''. */
function normalizePasskey(input) {
  const s = String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (s.length !== LENGTH) return '';
  for (const ch of s) if (!ALPHABET.includes(ch)) return '';
  return s;
}

function scrypt(passkey, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passkey, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * The two values to store: `{ salt, hash }`, both base64url, both safe as S3
 * user metadata (US-ASCII, well under its 2KB).
 */
async function hashPasskey(passkey) {
  const canonical = normalizePasskey(passkey);
  if (!canonical) throw new Error('hashPasskey: not a passkey');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(canonical, salt);
  return { salt: salt.toString('base64url'), hash: hash.toString('base64url') };
}

/**
 * Does `input` open a report stored with this salt and hash?
 * False, never a throw, for anything missing or malformed — including a report
 * saved before passkeys existed, which has neither value and so opens for no one
 * on the public route.
 */
async function verifyPasskey(input, salt, hash) {
  const canonical = normalizePasskey(input);
  if (!canonical || !salt || !hash) return false;
  let expected;
  try { expected = Buffer.from(String(hash), 'base64url'); } catch { return false; }
  if (expected.length !== KEYLEN) return false;
  const actual = await scrypt(canonical, Buffer.from(String(salt), 'base64url'));
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { generatePasskey, normalizePasskey, hashPasskey, verifyPasskey, ALPHABET, LENGTH };
