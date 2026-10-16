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
 *
 * REMOTE SHARE (owner, 2026-10-16; docs/superpowers/specs/
 * 2026-10-16-build-room-remote-share-design.md). One more switch on the same
 * row: one Cloudflare quick tunnel per session, forwarding to the newest thing
 * Claude showed, behind a key per PERSON. While it is live everyone's Open the
 * demo goes that way. The shared view carries only its status, when it went
 * live and the newest path: never the tunnel's address, never a key. Each
 * person gets their own link from their own phone route; keys are stored and
 * sent to the laptop as SHA-256 hashes only.
 */
const crypto = require('crypto');

const SK_LAN = 'BUILD#LAN';
const REPORT_FRESH_MS = 30 * 1000;
const QUIET_AFTER_MS = 2 * 60 * 1000;
const MAX_TARGETS = 4;
const STATUSES = Object.freeze(['off', 'live', 'failed']);
const KEY_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** One plugin process (1.18.0+): random at its start, so two copies on one room differ. */
const REPORTER_RE = /^[A-Za-z0-9_-]{12,64}$/;
/** SHA-256, base64url, no padding. */
const KEY_HASH_RE = /^[A-Za-z0-9_-]{43}$/;
/** The only remote address there is: a quick tunnel's origin. */
const TUNNEL_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const MAX_DEVICES = 50;
const MAX_PEOPLE = 200;
const OLD_PLUGIN = "This laptop's Engage plugin is too old to share remotely. Update it from Connect.";

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

/** The remote block of a report. A plugin before 1.19.0 sends none: it cannot share remotely. */
function normalizeRemote(remote) {
  if (remote === undefined || remote === null) {
    return { value: { RemoteSupported: false, RemoteStatus: 'off', RemoteAddress: '', RemoteTarget: '', RemoteError: '', RemoteDevices: {} } };
  }
  const m = remote || {};
  const status = String(m.status || '');
  if (!STATUSES.includes(status)) return { error: `remote.status must be one of ${STATUSES.join(', ')}` };
  const address = String(m.address || '');
  if (address && !TUNNEL_RE.test(address)) return { error: 'remote.address must be a quick tunnel origin' };
  if (status === 'live' && !address) return { error: 'A live remote report needs its address' };
  const target = String(m.target || '');
  if (target && !isLoopbackUrl(target)) return { error: 'remote.target must be a loopback address' };
  const devices = {};
  const entries = Object.entries(m.devices && typeof m.devices === 'object' ? m.devices : {});
  if (entries.length > MAX_PEOPLE) return { error: 'remote.devices lists too many people' };
  for (const [name, n] of entries) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_DEVICES) return { error: 'remote.devices must be counts' };
    const clean = String(name).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (clean && n > 0) devices[clean] = n;
  }
  return { value: {
    RemoteSupported: true,
    RemoteStatus: status,
    RemoteAddress: status === 'off' ? '' : address,
    RemoteTarget: target ? hostOf(target).origin : '',
    RemoteError: String(m.error || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    RemoteDevices: status === 'live' ? devices : {},
  } };
}

function normalizeReport(body) {
  const b = body || {};
  const remote = normalizeRemote(b.remote);
  if (remote.error) return { error: remote.error };
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
  return { value: { Status: status, Map: map, Key: validKey, Open: open, Error: error, Reporter: reporter, ...remote.value } };
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

/** 'off' | 'starting' | 'live' | 'failed', on the freshness rule lanStatus uses. */
function remoteStatus(row, now) {
  if (!row || !row.Wanted || !row.RemoteWanted) return 'off';
  const fresh = row.ReportedAt && Date.parse(now) - Date.parse(row.ReportedAt) < REPORT_FRESH_MS;
  if (!fresh) return 'starting';
  if (row.RemoteSupported === false) return 'failed';
  if (row.RemoteStatus === 'failed') return 'failed';
  if (row.RemoteStatus === 'live' && TUNNEL_RE.test(String(row.RemoteAddress || ''))) return 'live';
  return 'starting';
}

/**
 * When this tunnel went live. A new address is a new tunnel, so a new time:
 * that is how a phone learns its saved link is stale.
 */
function remoteLiveSince(before, value, now) {
  if (!value || value.RemoteStatus !== 'live') return null;
  const b = before || {};
  if (b.RemoteStatus === 'live' && b.RemoteLiveSince && b.RemoteAddress === value.RemoteAddress) return b.RemoteLiveSince;
  return now;
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('base64url');
}

/** 128 bits; the raw key goes to its phone and nowhere else. */
function mintRemoteKey() {
  const key = crypto.randomBytes(16).toString('base64url');
  return { key, hash: hashKey(key) };
}

/**
 * The keys that open the remote gateway now. A key counts only while its
 * person is in the session, not removed, and on the device it was minted for:
 * a handover gives the name a new ClientId, which ends the old device's key.
 */
function liveRemoteKeys(rkeys, players) {
  const byName = new Map((players || []).map((p) => [p.PlayerName || p.playerName, p]));
  return (rkeys || []).filter((k) => {
    const p = byName.get(k.PlayerName);
    if (!p || p.Removed || p.RemovedAt) return false;
    if (p.ClientId && p.ClientId !== k.ClientId) return false;
    return KEY_HASH_RE.test(String(k.Hash || ''));
  }).map((k) => ({ hash: k.Hash, player: k.PlayerName }));
}

/** Path, search and hash of the newest local address Claude showed: what Open the demo opens. */
function remotePath(room) {
  const logs = (room && room.logs) || [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const l = logs[i];
    if (l.By === 'agent' && l.Link && isLoopbackUrl(l.Link)) {
      const u = hostOf(l.Link);
      return `${u.pathname}${u.search}${u.hash}` || '/';
    }
  }
  return '/';
}

/** A person's link: the tunnel's origin, a path, their key. '' unless remote is live. */
function remoteLink(row, pathAndMore, key, now) {
  if (remoteStatus(row, now) !== 'live') return '';
  const u = new URL(pathAndMore || '/', row.RemoteAddress);
  u.searchParams.set('k', key);
  return u.toString();
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
  const wifi = wifiPublicView(room, now);
  const remote = remoteStatus(room && room.lan, now);
  if (remote === 'off') return wifi;
  if (remote === 'live') {
    // Everyone takes the remote route (owner, 2026-10-16): no Wi-Fi link.
    return { remote, remoteSince: room.lan.RemoteLiveSince || null, remotePath: remotePath(room) };
  }
  return { ...(wifi || {}), remote };
}

function wifiPublicView(room, now) {
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
  // has shown an app running on this laptop, so a phone can say why there is
  // nothing to open. Screenshots alone are just pictures: null, as before
  // anything is shown (owner, 2026-10-11).
  return lanTargets(room).length ? { state: 'off' } : null;
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
    remote: remoteHostView(r, now),
  };
}

/** Never the tunnel's address: the host has nothing to copy (spec §3). */
function remoteHostView(r, now) {
  const status = remoteStatus(r, now);
  const people = status === 'live'
    ? Object.entries(r.RemoteDevices || {}).map(([name, devices]) => ({ name, devices }))
      .sort((a, b) => b.devices - a.devices || a.name.localeCompare(b.name))
    : [];
  let error = '';
  if (status === 'failed') error = r.RemoteSupported === false ? OLD_PLUGIN : (r.RemoteError || '');
  return { wanted: Boolean(r.Wanted && r.RemoteWanted), status, error, people };
}

module.exports = {
  SK_LAN, REPORT_FRESH_MS, QUIET_AFTER_MS, MAX_TARGETS,
  isLoopbackUrl, isPrivateLanUrl, lanTargets, normalizeReport, reportOwnsRoom, lanStatus, lanTranslator, lanPublicView, lanHostView,
  KEY_HASH_RE, TUNNEL_RE, remoteStatus, remoteLiveSince, hashKey, mintRemoteKey, liveRemoteKeys, remotePath, remoteLink,
};
