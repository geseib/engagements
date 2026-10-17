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
/** One plugin process (1.18.0+): random at its start, so two copies on one room differ. */
const REPORTER_RE = /^[A-Za-z0-9_-]{12,64}$/;

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
/** Every address Claude linked, in "shown" order: its posts, then ask options, then the wrap-up. */
function shownUrls(room) {
  const r = room || {};
  const urls = [];
  for (const l of r.logs || []) if (l.By === 'agent' && l.Link) urls.push(l.Link);
  for (const a of r.asks || []) for (const o of a.Options || []) if (o && o.url) urls.push(o.url);
  const outcome = r.state && r.state.Outcome;
  for (const l of (outcome && outcome.links) || []) if (l && l.url) urls.push(l.url);
  return urls;
}

/**
 * WHAT THE PROJECT DECLARES (Share demo S3, plugin 1.20.0, owner 2026-10-17).
 * `.engage/share.json` in the project names the demo page, the mockups page and
 * a short label for this session; the plugin reports it each round and it wins
 * over any guess. Only a loopback http address that is certainly this laptop.
 */
const DECLARED_URL_MAX = 500;
const DECLARED_LABEL_MAX = 60;
function declaredUrl(v) {
  if (typeof v !== 'string' || !v || v.length > DECLARED_URL_MAX) return '';
  const u = hostOf(v);
  if (!u || u.protocol !== 'http:') return '';
  const h = u.hostname.toLowerCase();
  const sure = h === 'localhost' || h === '[::1]' || (/^127\./.test(h) && isValidIpv4(h));
  return sure ? u.toString() : '';
}
function normalizeDeclared(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const out = {};
  const demo = declaredUrl(d.demo);
  const mockups = declaredUrl(d.mockups);
  // eslint-disable-next-line no-control-regex
  const label = typeof d.label === 'string' ? d.label.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, DECLARED_LABEL_MAX).trim() : '';
  if (demo) out.demo = demo;
  if (mockups) out.mockups = mockups;
  if (label) out.label = label;
  return out;
}
const declaredOf = (room) => {
  const d = room && room.lan && room.lan.Declared;
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
};
const originOf = (url) => (isLoopbackUrl(url) ? hostOf(url).origin : '');

/**
 * THE DEMO (S3): the declared demo page, else the newest link Claude posted
 * with role "demo", else the newest link it posted (before 1.20.0, the only rule).
 * @returns {string[]} candidates, best first
 */
function demoCandidates(room) {
  const logs = ((room && room.logs) || []).filter((l) => l.By === 'agent' && l.Link);
  const out = [];
  const d = declaredOf(room).demo;
  if (d) out.push(d);
  for (let i = logs.length - 1; i >= 0; i -= 1) if (logs[i].Role === 'demo') out.push(logs[i].Link);
  for (let i = logs.length - 1; i >= 0; i -= 1) out.push(logs[i].Link);
  return out;
}
function lanDemoUrl(room) {
  return demoCandidates(room)[0] || '';
}

function lanTargets(room) {
  const d = declaredOf(room);
  const kept = [];
  for (const url of [d.demo, d.mockups]) {
    const origin = url ? originOf(url) : '';
    if (origin && !kept.includes(origin)) kept.push(origin);
  }
  const first = kept.length;
  const urls = shownUrls(room);
  const rest = [];
  for (let i = urls.length - 1; i >= 0 && first + rest.length < MAX_TARGETS; i -= 1) {
    const origin = originOf(urls[i]);
    if (origin && !kept.includes(origin) && !rest.includes(origin)) rest.push(origin);
  }
  return [...kept, ...rest.reverse()];
}

/**
 * WHICH SERVER IS WHICH (S3 c): origin -> { role, ask }. "demo" is the server
 * of the declared demo, else of the newest link Claude marked demo; never a
 * guess. "mockups" is the declared mockups server, any server Claude marked
 * mockup, and any serving a Choose ask's options (`ask`: the newest such ask).
 */
function lanRoles(room) {
  const r = room || {};
  const d = declaredOf(r);
  const logs = (r.logs || []).filter((l) => l.By === 'agent' && l.Link);
  let demo = d.demo ? originOf(d.demo) : '';
  for (let i = logs.length - 1; i >= 0 && !demo; i -= 1) if (logs[i].Role === 'demo') demo = originOf(logs[i].Link);
  const out = {};
  if (demo) out[demo] = { role: 'demo', ask: null };
  const mock = (origin, ask = null) => {
    if (!origin || origin === demo) return;
    const had = out[origin] || { role: 'mockups', ask: null };
    out[origin] = { role: 'mockups', ask: ask !== null && (had.ask === null || ask > had.ask) ? ask : had.ask };
  };
  if (d.mockups) mock(originOf(d.mockups));
  for (const l of logs) if (l.Role === 'mockup') mock(originOf(l.Link));
  for (const a of r.asks || []) {
    const n = Number(a.AskId);
    for (const o of a.Options || []) if (o && o.url) mock(originOf(o.url), Number.isInteger(n) && n > 0 ? n : null);
  }
  return out;
}

/**
 * WHAT A SHARED SERVER MAY SHOW (Share demo S1, dev game 1215, owner
 * 2026-10-17). A link's scope is its folder: a page's own folder, or the folder
 * a link names. The URL parser has already resolved any "..".
 */
function scopeOf(url) {
  const u = hostOf(url);
  if (!u) return '';
  const p = u.pathname || '/';
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
}

/**
 * For each server being shared (the same ones as lanTargets), the folders of
 * the pages Claude linked on it. The plugin's gateway opens a page only inside
 * one of them, so the room never browses the rest of a served folder (Claude's
 * helper files, a project root). A folder inside another is dropped.
 * @returns {Object<string, string[]>} origin -> sorted scopes
 */
function lanScopes(room) {
  const targets = new Set(lanTargets(room));
  const by = {};
  const d = declaredOf(room);
  for (const url of [...shownUrls(room), d.demo, d.mockups].filter(Boolean)) {
    if (!isLoopbackUrl(url)) continue;
    const origin = hostOf(url).origin;
    if (!targets.has(origin)) continue;
    const scope = scopeOf(url);
    if (!scope) continue;
    (by[origin] = by[origin] || new Set()).add(scope);
  }
  const out = {};
  for (const [origin, set] of Object.entries(by)) {
    const all = [...set].sort();
    out[origin] = all.filter((x) => !all.some((y) => y !== x && x.startsWith(y)));
  }
  return out;
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
  const reporter = REPORTER_RE.test(String(b.reporter || '')) ? String(b.reporter) : '';
  // 1.20.0+: what .engage/share.json declares. An older plugin sends none: nothing declared.
  const declared = normalizeDeclared(b.declared);
  return { value: { Status: status, Map: map, Key: validKey, Open: open, Error: error, Reporter: reporter, Declared: declared } };
}

/**
 * ONE REPORTER PER ROOM (owner, 2026-10-16: the count "oscillating between 0
 * and 1" on a participant's screen). Two plugin copies on one room — the old
 * prod plugin beside the test one, or two Claude Code windows in one folder —
 * each run a gateway with its own key, port and count, and the row kept
 * whichever reported last, every 4 s. The copy that reported first keeps the
 * room while its reports are fresh; any other copy is told not wanted, so it
 * closes its gateway. A plugin too old to send a reporter id ('') keeps a room
 * only from another old one, never from a copy that names itself.
 */
function reportOwnsRoom(before, reporter, now) {
  const b = before || {};
  const fresh = b.ReportedAt && Date.parse(now) - Date.parse(b.ReportedAt) < REPORT_FRESH_MS;
  if (!fresh) return true;
  const owner = String(b.Reporter || '');
  if (owner === reporter) return true;
  return !owner && Boolean(reporter);
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
  // The demo first (S3): declared, then marked, then the newest link; the first one shared wins.
  for (const url of demoCandidates(room)) {
    const open = t(url);
    if (open) return { open };
  }
  const first = room && room.lan && (room.lan.Map || [])[0];
  const open = first ? t(first.local) : '';
  if (open) return { open };
  // SHARE DEMO (docs/design/build-room-share-demo D5 b): not shared, but Claude
  // has shown an app running on this laptop, so a phone can say why there is
  // nothing to open. Screenshots alone are just pictures: null, as before
  // anything is shown (owner, 2026-10-11).
  return lanTargets(room).length ? { state: 'off' } : null;
}

function lanHostView(row, now, { withKey: showKey = false, room = null } = {}) {
  const r = row || {};
  const status = lanStatus(r, now);
  // Which server is which (S3 c), so the host can tell the demo from the mockups.
  const roles = room ? lanRoles({ ...room, lan: r }) : {};
  return {
    // THE DEMO ITSELF (dev 1215, owner 2026-10-17): the page Claude showed, with its
    // path, the address the phones open (lanPublicView). The map's links are each
    // server's root, which is a directory listing when Claude serves a folder.
    ...(showKey && room ? { demo: (lanPublicView({ ...room, lan: r }, now) || {}).open || '' } : {}),
    wanted: Boolean(r.Wanted),
    status,
    map: status === 'off' ? [] : (r.Map || []).map((m) => ({
      local: m.local, lan: m.lan, ...(showKey && r.Key ? { link: withKey(m.lan, '/', r.Key) } : {}),
      role: (roles[m.local] && roles[m.local].role) || null,
      ask: (roles[m.local] && roles[m.local].ask) || null,
    })),
    // The session's own name on this laptop, from .engage/share.json (S3 c).
    label: (r.Declared && typeof r.Declared.label === 'string' && r.Declared.label) || '',
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
  isLoopbackUrl, isPrivateLanUrl, lanTargets, lanRoles, lanDemoUrl, normalizeDeclared, scopeOf, lanScopes, normalizeReport, reportOwnsRoom, lanStatus, lanTranslator, lanPublicView, lanHostView,
};
