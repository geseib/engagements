/**
 * PROMOTING A BATCH FROM ONE TIER TO THE NEXT — the link that carries it, and reading it back.
 *
 * docs/design/archive-promotion/REVIEW.md, improvement 1. Each tier's Lambdas write only their
 * own table and the archive is the one thing the tiers share, so "promote" is not one call: it
 * is an export on this tier, then a link that opens the target tier's Archive with exactly that
 * batch selected and its preview open. The admin still signs in there and still confirms.
 *
 *   https://engage.test.seibtribe.us/admin?section=archive&promote=<id>,<id>&from=dev
 *
 * SIGN-IN KEEPS IT. /admin is behind ProtectedRoute, which renders the sign-in form IN PLACE
 * (App.jsx), so the address bar keeps the query through an email/password sign-in, and the
 * page reloads onto it. A Google sign-in leaves the site; googleSignIn.js records
 * `pathname + search` with rememberReturnPath() before it goes, and OAuthCallback returns
 * there (auth/returnPath.js). Both are pinned in __tests__/archivePromotion.test.js.
 *
 * AdminPage reads `promote` once at mount to open the console as Engage (the Archive lives
 * only there); ArchivePanel reads it to select the batch, then strips it from the address so a
 * reload or Back does not open the preview again.
 */
import { TIERS } from './archiveItems';
import { tierOrigin } from '../config/tierHosts';

export const PROMOTE_PARAM = 'promote';
export const FROM_PARAM = 'from';
/** An archive id as the service issues them (UUIDs), with room for the test fixtures' `arc-2`. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_IDS = 200;

/** The link that opens `target`'s Archive with these archive ids selected, or '' if it cannot be built. */
export function promoteLink(target, archiveIds, from) {
  const origin = tierOrigin(target);
  const ids = [...new Set((archiveIds || []).map(String).filter((id) => ID.test(id)))];
  if (!origin || ids.length === 0) return '';
  const params = new URLSearchParams({ section: 'archive' });
  // Commas left literal: the link is read by people as well as by the panel.
  const query = `${params.toString()}&${PROMOTE_PARAM}=${ids.join(',')}${TIERS.includes(from) ? `&${FROM_PARAM}=${from}` : ''}`;
  return `${origin}/admin?${query}`;
}

/** `{ids, from}` when the address asks for a promotion, otherwise null. Untrusted input: validated. */
export function readPromotion(search) {
  const params = new URLSearchParams(String(search || ''));
  const raw = params.get(PROMOTE_PARAM);
  if (!raw) return null;
  const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => ID.test(id)))].slice(0, MAX_IDS);
  if (ids.length === 0) return null;
  const from = String(params.get(FROM_PARAM) || '').toLowerCase();
  return { ids, from: TIERS.includes(from) ? from : '' };
}

/** `href` with the promotion removed and everything else (the section) kept. */
export function withoutPromotion(href) {
  const url = new URL(href);
  url.searchParams.delete(PROMOTE_PARAM);
  url.searchParams.delete(FROM_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
