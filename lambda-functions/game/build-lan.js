/**
 * BUILD ROOM WI-FI SHARE (owner, 2026-10-07;
 * docs/design/build-room-lan-share/PLAN.md). The host's switch and the
 * plugin's report live on one row, BUILD#LAN. Pure functions only: the
 * handler (build-room.js) reads and writes the row; build-store.js builds the
 * views with these.
 *
 * A participant is given a Wi-Fi link only while the host wants sharing on
 * AND the plugin said "live" in the last 30 seconds. Otherwise local links are
 * dropped from their view exactly as before this existed.
 */
const SK_LAN = 'BUILD#LAN';
const REPORT_FRESH_MS = 30 * 1000;
const QUIET_AFTER_MS = 2 * 60 * 1000;
const MAX_TARGETS = 4;
const STATUSES = Object.freeze(['off', 'live', 'failed']);
const KEY_RE = /^[A-Za-z0-9_-]{20,64}$/;

const hostOf = (url) => { try { return new URL(String(url)); } catch (e) { return null; } };

/** Validate that a string is a valid IPv4 address (four octets 0-255). */
function isValidIpv4(addr) {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isLoopbackUrl(url) {
  const u = hostOf(url);
  if (!u || !['http:', 'https:'].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  // IPv4 loopback: 127.x.y.z where x, y, z are valid octets
  return /^127\./.test(h) && isValidIpv4(h);
}

function isPrivateLanUrl(url) {
  const u = hostOf(url);
  if (!u || u.protocol !== 'http:') return false;
  const h = u.hostname;
  // Check IPv4 ranges with full octet validation
  if (/^10\./.test(h) && isValidIpv4(h)) return true;
  if (/^192\.168\./.test(h) && isValidIpv4(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) && isValidIpv4(h)) return true;
  return false;
}

/**
 * The local addresses the plugin opens: the MAX_TARGETS most recently shown
 * distinct ones, oldest first. "Shown" order is the agent's log links, then ask
 * options, then outcome links; an address shown again counts as newest.
 */
function lanTargets(room) {
  const r = room || {};
  const urls = [];
  for (const l of r.logs || []) if (l.By === 'agent' && l.Link) urls.push(l.Link);
  for (const a of r.asks || []) for (const o of a.Options || []) if (o && o.url) urls.push(o.url);
  const outcome = r.state && r.state.Outcome;
  for (const l of (outcome && outcome.links) || []) if (l && l.url) urls.push(l.url);
  const kept = [];
  for (let i = urls.length - 1; i >= 0 && kept.length < MAX_TARGETS; i -= 1) {
    if (!isLoopbackUrl(urls[i])) continue;
    const origin = hostOf(urls[i]).origin;
    if (!kept.includes(origin)) kept.push(origin);
  }
  return kept.reverse();
}

function normalizeReport(body) {
  const b = body || {};
  const status = String(b.status || '');
  if (!STATUSES.includes(status)) return { error: `status must be one of ${STATUSES.join(', ')}` };
  const key = String(b.key || '');
  if (status === 'live' && !KEY_RE.test(key)) return { error: 'A live report needs its key' };
  const open = b.open === undefined ? 0 : Number(b.open);
  if (!Number.isInteger(open) || open < 0 || open > 10000) return { error: 'open must be a count' };
  const map = (Array.isArray(b.map) ? b.map : [])
    .filter((m) => m && isLoopbackUrl(m.local) && isPrivateLanUrl(m.lan))
    .slice(0, MAX_TARGETS)
    .map((m) => ({ local: hostOf(m.local).origin, lan: hostOf(m.lan).origin }));
  const error = String(b.error || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const validKey = status === 'off' ? '' : (KEY_RE.test(key) ? key : '');
  return { value: { Status: status, Map: map, Key: validKey, Open: open, Error: error } };
}

function lanStatus(row, now) {
  if (!row || !row.Wanted) return 'off';
  const fresh = row.ReportedAt && Date.parse(now) - Date.parse(row.ReportedAt) < REPORT_FRESH_MS;
  if (fresh && row.Status === 'failed') return 'failed';
  if (fresh && row.Status === 'live') return 'live';
  return 'starting';
}

const withKey = (lanOrigin, rest, key) => {
  const u = new URL(rest || '/', lanOrigin);
  u.searchParams.set('k', key);
  return u.toString();
};

function lanTranslator(row, now) {
  if (lanStatus(row, now) !== 'live' || !KEY_RE.test(String(row.Key || ''))) return () => '';
  const byOrigin = new Map((row.Map || []).map((m) => [m.local, m.lan]));
  return (url) => {
    if (!isLoopbackUrl(url)) return '';
    const u = hostOf(url);
    const lan = byOrigin.get(u.origin);
    return lan ? withKey(lan, `${u.pathname}${u.search}${u.hash}`, row.Key) : '';
  };
}

function lanPublicView(room, now) {
  const t = lanTranslator(room && room.lan, now);
  const logs = (room && room.logs) || [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const l = logs[i];
    if (l.By === 'agent' && l.Link) {
      const open = t(l.Link);
      if (open) return { open };
    }
  }
  const first = room && room.lan && (room.lan.Map || [])[0];
  const open = first ? t(first.local) : '';
  if (open) return { open };
  // SHARE DEMO (docs/design/build-room-share-demo D5 b): not shared, but Claude
  // has shown this laptop's app or a screenshot of it, so a phone can say why
  // there is nothing to open. Before anything is shown: null, as before.
  return shownSomething(room) ? { state: 'off' } : null;
}

/** Claude has shown a local app (a link, an option, the wrap-up) or a screenshot that is not a mockup. */
function shownSomething(room) {
  const r = room || {};
  if (lanTargets(r).length) return true;
  return (r.images || []).some((im) => im && im.Kind !== 'mockup' && (im.By || 'agent') === 'agent');
}

function lanHostView(row, now, { withKey: showKey = false } = {}) {
  const r = row || {};
  const status = lanStatus(r, now);
  return {
    wanted: Boolean(r.Wanted),
    status,
    map: status === 'off' ? [] : (r.Map || []).map((m) => ({
      local: m.local, lan: m.lan, ...(showKey && r.Key ? { link: withKey(m.lan, '/', r.Key) } : {}),
    })),
    open: status === 'live' ? Number(r.Open) || 0 : 0,
    error: status === 'failed' ? r.Error || '' : '',
    liveSince: status === 'live' ? r.LiveSince || null : null,
    offerDismissed: Boolean(r.OfferDismissedAt),
    reportedAt: r.ReportedAt || null,
    wantedAt: r.WantedAt || null,
  };
}

module.exports = {
  SK_LAN, REPORT_FRESH_MS, QUIET_AFTER_MS, MAX_TARGETS,
  isLoopbackUrl, isPrivateLanUrl, lanTargets, normalizeReport, lanStatus, lanTranslator, lanPublicView, lanHostView,
};
