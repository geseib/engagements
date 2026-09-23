/**
 * SHARING A SAVED REPORT: A LINK AND A PASSKEY.
 *
 * A saved report used to be shared by its download link alone, and that link
 * was built from the session's title, the date and the join code — all of
 * which everyone in the room knows. The owner, 2026-09-23: "a second item a
 * passkey that the host can give out so that if you are not logged in you
 * could share it with the passkey."
 *
 * So Save hands the host two things (lambda-functions/game/save-report.js): a
 * link to /shared-report, and a ten-character passkey shown only that once.
 * The recipient opens the link, types the passkey, and the page fetches
 * GET /games/{gameId}/report/download with it in the X-Report-Passkey header
 * (download-report.js checks it against the hash stored with the report).
 *
 * WHY A HEADER AND NOT `&passkey=` ON THE LINK. A link gets forwarded, pasted,
 * logged and kept in history; the passkey is the part that must not travel
 * with it. That is also why the recipient page never pre-fills it from the URL.
 *
 * WHY PLAIN fetch. The download route is public on purpose — the recipient
 * has no account — so there is no token to attach. `window.fetch` is named
 * explicitly so nobody reads this as a closed route missing its authFetch.
 */

/** The request header download-report.js reads. template-clean.yaml allows it in CORS. */
export const PASSKEY_HEADER = 'X-Report-Passkey';

/** The public page a recipient opens. App.jsx routes it with no sign-in. */
export const SHARED_REPORT_PATH = '/shared-report';

/** An example in the passkey's real shape, for placeholders and hints. */
export const PASSKEY_EXAMPLE = 'K7QM3-XPD9Z';

/** The link a host sends: this site's own page, never the API's address. */
export function shareLinkFor(origin, gameId, key) {
  const q = new URLSearchParams({ game: String(gameId), key: String(key) });
  return `${origin}${SHARED_REPORT_PATH}?${q.toString()}`;
}

/** `{ gameId, key }` from the page's query string, or null when either is missing. */
export function readShareLink(search) {
  const q = new URLSearchParams(search || '');
  const gameId = (q.get('game') || '').trim();
  const key = (q.get('key') || '').trim();
  if (!/^\d+$/.test(gameId) || !key) return null;
  return { gameId, key };
}

/**
 * What the key says about the report, for the page's heading.
 * save-report.js builds `<Title-With-Dashes>-<YYYY-MM-DD>-<gameId>.pdf[.enc]`,
 * optionally under `permanent/`. Anything else describes as an unnamed report.
 */
export function describeReportKey(key, gameId) {
  const base = String(key || '').replace(/^permanent\//, '').replace(/\.enc$/, '');
  const m = base.match(new RegExp(`^(.*)-(\\d{4}-\\d{2}-\\d{2})-${gameId}\\.pdf$`));
  if (!m) return { title: 'Session report', savedOn: null };
  const title = m[1].replace(/-+/g, ' ').trim() || 'Session report';
  return { title, savedOn: m[2] };
}

/** The filename the downloaded PDF is saved under. */
export function reportFilename(key) {
  const base = String(key || '').split('/').pop().replace(/\.enc$/, '');
  return base.endsWith('.pdf') ? base : 'session-report.pdf';
}

/**
 * Is this plausibly a passkey? Ten letters and numbers once spaces and dashes
 * are ignored. The server decides whether it is the RIGHT one; this only saves
 * a round trip on something that cannot be.
 */
export function looksLikePasskey(input) {
  return String(input || '').replace(/[^0-9a-z]/gi, '').length === 10;
}

/**
 * Fetch the report with its passkey.
 * @returns {Promise<{ok:true, blob:Blob} | {ok:false, reason:'mismatch'|'network'}>}
 *   `mismatch` covers a wrong passkey, an expired link and a missing report
 *   alike — the server answers all three the same, on purpose.
 */
export async function fetchSharedReport({
  apiBase, gameId, key, passkey,
  fetchFn = (...args) => window.fetch(...args),
}) {
  const url = `${apiBase}games/${encodeURIComponent(gameId)}/report/download?key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetchFn(url, { method: 'GET', headers: { [PASSKEY_HEADER]: String(passkey).trim() } });
  } catch (err) {
    return { ok: false, reason: 'network' };
  }
  if (!res.ok) return { ok: false, reason: res.status === 404 ? 'mismatch' : 'network' };
  return { ok: true, blob: await res.blob() };
}

/** Hand a blob to the browser as a file download. */
export function saveBlob(blob, filename, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "Tuesday 29 September" — how long a share link works, in words. */
export function formatShareUntil(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
