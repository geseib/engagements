# Build Room Wi-Fi Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People in a Build Room open the app Claude is running on the host's laptop, from their own laptops, tablets and phones on the same Wi-Fi, through a locked gateway the host switches on and off.

**Architecture:** The plugin (`src/public/engage-mcp.mjs`, one file the host installs) runs a small HTTP gateway inside its MCP process, bound to the laptop's Wi-Fi address, one port per local app Claude has shown, locked by a random key that becomes a cookie. The server keeps the switch and the plugin's report on one new row (`BUILD#LAN`), tells the plugin which local addresses to open, and translates local links into Wi-Fi links in the participants' view only while sharing is live. The host page gets a Wi-Fi chip, a panel, a one-time offer and a wall QR; participants get Open the build.

**Tech Stack:** Node 18 Lambda (CommonJS), DynamoDB single table, React (CRA, jest + Testing Library), the plugin as a plain Node ESM script using only `node:` built-ins.

**Spec:** `docs/design/build-room-lan-share/PLAN.md` (sections 1 to 5) and the mockups `docs/design/build-room-lan-share/index.html` (L1 to L5). Read both.

## Global Constraints

- **Laptops, tablets and phones, never phones only.** Every line of copy a person reads names all three or none ("Open the build yourself", "devices"). Owner, 2026-10-07.
- **Plain words**, no emoji anywhere in `src/src/buildroom/` (`node tests/build-room-copy.js`).
- **The plugin stays one file with no dependencies** (`node:http`, `node:net`, `node:os`, `node:crypto` only). Every edit to `engage-mcp.mjs` bumps `VERSION` (to **1.11.0**) and the pin in `tests/engage-plugin-version.js` (run it; it prints the new pin).
- **The gateway binds the Wi-Fi IPv4 address only, never `0.0.0.0`.** It forwards only to `localhost` / `127.0.0.1` / `[::1]` on a port the server listed as a target.
- **Key:** `crypto.randomBytes(16).toString('base64url')`, new every time sharing turns on. Cookie `engage_lan`, `HttpOnly; SameSite=Lax; Path=/`.
- **Ports from 4900** (env `ENGAGE_LAN_PORT`), up to 4 gateways, each tries up to 20 ports.
- **Reporting:** every 4 s while wanted or live, every 15 s while off (env `ENGAGE_LAN_FAST_MS`, `ENGAGE_LAN_IDLE_MS`). A report older than **30 s** counts as off.
- **"None open yet"** after **2 minutes** live with 0 open. Open = distinct remote addresses seen in the last **5 minutes**.
- **Sealed in team rooms:** new entity `buildLan: ['Map', 'Key', 'Error']` in all three `tenant-crypto.js` copies, byte-identical (`lambda-functions/game/`, `lambda-functions/websocket/`, `lambda-functions/admin/shared/`).
- **No new Lambda, no template change.** New routes live under the existing `/games/{gameId}/build/{proxy+}`.
- **A share report never takes Claude's inbox and never counts as Claude being seen** (it comes from a background loop that discards the answer).
- **Gates before any push:** backend `for f in tests/*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` (skip `tests/verify-question-set-ui.spec.js`), all pass (286 suites before this work, plus any new); `cd src && ./node_modules/.bin/jest --maxWorkers=3` (444 suites before, plus new), `npm run lint` (0 errors, 10 warnings), `npm run build`. A push to `dev` is a deploy (CLAUDE.md).
- **Deviation from the spec, on purpose:** the share state is its own row `BUILD#LAN`, not a field on `BUILD#STATE`, and the plugin reports on its own route `POST share/report`, not on `activity`. Reason: a write every 4 s must not touch the room's Rev row, and the activity route returns before doing anything when there is no activity. Devices are counted by remote address, not cookie: every device's cookie carries the same key. **Wrap-up does not turn sharing off; ending the session does** (the spec said both). Wrap-up is when the room most wants to try the finished build, and the close steps already stop Claude's servers only after asking the host, which takes the gateway's targets away. Owner to confirm.

## Review Focus

1. **The host turns sharing off while a participant has the app open and its hot-reload socket connected.** Expect the socket to be cut within one round (gateway `close()` must destroy open sockets, not wait for them) and the next page load to get the locked page.
2. **Claude restarts its dev server on a new port mid-session.** Expect the new local address to get its own gateway port within one round, the old one to keep its port (refusing connections upstream with a 502 page, not hanging), and participants' links to follow the newest one.
3. **A participant opens an old link after sharing was turned off and on again.** Expect the locked page, not the app (old key refused) — and pressing Open the build again works.
4. **The laptop has no Wi-Fi address (wired only, or offline), or every port is taken.** Expect the chip to read Didn't start with that reason, and the server never to hand participants a link.
5. **A team room (org session).** Expect `Map`, `Key` and `Error` to be sealed at rest and the participants' links still to carry a working key (decrypted in the view).

---

## File Structure

| File | Responsibility |
|---|---|
| `lambda-functions/game/build-lan.js` (new) | Pure: the row's shape, normalising a report, the targets list, the host view, the participants' link translator. No DynamoDB, no imports from build-store. |
| `lambda-functions/game/build-store.js` | `SK.lan`, `entityForSk`, `roomFromRows` gain the row; `hostView` and `publicView` use build-lan. |
| `lambda-functions/game/build-room.js` | Routes `POST share` (host) and `POST share/report` (agent); the wrapper skips inbox and touch for the report; ended sessions are never wanted. |
| `lambda-functions/{game,websocket,admin/shared}/tenant-crypto.js` | `buildLan` entity. |
| `src/public/engage-mcp.mjs` | The gateway, the report loop, room_status's line, the instructions and skill, VERSION 1.11.0. |
| `src/src/buildroom/wifiShare.js` (new) | Pure: the chip's state and label, whether to offer. |
| `src/src/buildroom/BuildWifiShare.jsx` (new) | `WifiChip`, `WifiPanel`, `WifiOffer`, `WallBuildQr`, `BuildScreenQr`. |
| `src/src/buildroom/buildHostApi.js` | `share(body)`. |
| `src/src/buildroom/BuildRoomPage.jsx` | Mounts the chip in the header, the offer on the Host screen, the QR on the Build screen, the macOS line in Connect. |
| `src/src/buildroom/BuildPlayer.jsx` | Open the build on the Now tab. |
| `src/src/buildroom/BuildRoom.css`, `BuildPlayer.css` | `brm-wifi*`, `bpl-open*`. |
| Tests | `tests/build-room-lan.js` (new, pure), `tests/build-room.js` (routes), `tests/engage-lan-gateway.js` (new, the real plugin against a fake API and a real app), `tests/engage-mcp.js`, `tests/engage-plugin-version.js`, `src/src/__tests__/wifiShare.test.js` (new), `buildWifiShare.test.jsx` (new), `buildPlayer.test.jsx`. |

---

### Task 1: The share row, as pure functions (`build-lan.js`)

**Files:**
- Create: `lambda-functions/game/build-lan.js`
- Test: `tests/build-room-lan.js` (new)

**Interfaces:**
- Produces (all on `module.exports`):
  - `SK_LAN = 'BUILD#LAN'`
  - `REPORT_FRESH_MS = 30000`, `QUIET_AFTER_MS = 120000`, `MAX_TARGETS = 4`
  - `isLoopbackUrl(url) → boolean` (localhost, `*.localhost`, `127.*`, `::1`, http or https)
  - `lanTargets(room) → string[]` local origins in the order Claude first showed them (log `link`s by the agent, then ask option `url`s, then outcome `links[].url`), deduped, loopback only, at most 4.
  - `normalizeReport(body) → {value:{Status,Map,Key,Open,Error}} | {error}`
  - `lanStatus(row, now) → 'off'|'starting'|'live'|'failed'`
  - `lanHostView(row, now, {withKey}) → {wanted, status, map:[{local, lan, link}], open, error, liveSince, offerDismissed, reportedAt}` (`link` is `lan + '?k=' + key` only when `withKey`)
  - `lanTranslator(row, now) → (url) => string` ('' when it cannot translate)
  - `lanPublicView(room, now) → {open: string} | null` (the newest local link Claude showed, translated)

- [ ] **Step 1: Write the failing test** — `tests/build-room-lan.js`:

```js
/**
 * BUILD ROOM WI-FI SHARE — the pure half (lambda-functions/game/build-lan.js).
 * docs/design/build-room-lan-share/PLAN.md §3.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'lambda-functions/game/build-lan.js'));

let pass = 0; let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}
const NOW = '2026-10-07T12:00:00.000Z';
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();
const liveRow = (over = {}) => ({
  SK: L.SK_LAN, Wanted: true, Status: 'live', ReportedAt: ago(5000), LiveSince: ago(60000), Open: 3,
  Key: 'KEYkeyKEYkeyKEYkey1234', Map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }], ...over,
});

console.log('\nbuild-lan: targets');
check('only loopback addresses, in the order Claude showed them, deduped, at most 4', () => {
  const room = {
    logs: [
      { By: 'agent', Link: 'http://localhost:5173/' },
      { By: 'agent', Link: 'https://example.com/live' },
      { By: 'agent', Link: 'http://localhost:5173/b' },
      { By: 'host', Link: 'http://localhost:9999/' },
    ],
    asks: [{ Options: [{ url: 'http://127.0.0.1:5174/a' }, { url: 'http://192.168.1.5:3000/' }] }],
    state: { Outcome: { links: [{ url: 'http://localhost:6000/' }, { url: 'http://localhost:6001/' }, { url: 'http://localhost:6002/' }] } },
  };
  assert.deepStrictEqual(L.lanTargets(room), ['http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:6000', 'http://localhost:6001']);
});
check('a room with nothing shown has no targets', () => {
  assert.deepStrictEqual(L.lanTargets({ logs: [], asks: [], state: null }), []);
});

console.log('\nbuild-lan: the report');
check('a good report is kept; the map keeps only private Wi-Fi addresses for loopback origins', () => {
  const r = L.normalizeReport({ status: 'live', key: 'abcdefghijklmnopqrstuv', open: 2, error: '', map: [
    { local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' },
    { local: 'http://localhost:5174', lan: 'http://8.8.8.8:4901' },
    { local: 'https://example.com', lan: 'http://192.168.1.20:4902' },
  ] });
  assert.deepStrictEqual(r.value.Map, [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }]);
  assert.strictEqual(r.value.Status, 'live');
  assert.strictEqual(r.value.Open, 2);
});
check('an unknown status, a short key or a negative count is refused', () => {
  assert.ok(L.normalizeReport({ status: 'on', key: 'abcdefghijklmnopqrstuv' }).error);
  assert.ok(L.normalizeReport({ status: 'live', key: 'short' }).error);
  assert.ok(L.normalizeReport({ status: 'live', key: 'abcdefghijklmnopqrstuv', open: -1 }).error);
});
check('off needs no key; the error is plain text, trimmed to 200', () => {
  const r = L.normalizeReport({ status: 'failed', error: 'x'.repeat(500) });
  assert.strictEqual(r.value.Key, '');
  assert.strictEqual(r.value.Error.length, 200);
});

console.log('\nbuild-lan: status');
check('off when not wanted, whatever the plugin last said', () => {
  assert.strictEqual(L.lanStatus(liveRow({ Wanted: false }), NOW), 'off');
  assert.strictEqual(L.lanStatus(null, NOW), 'off');
});
check('live only while the report is fresh', () => {
  assert.strictEqual(L.lanStatus(liveRow(), NOW), 'live');
  assert.strictEqual(L.lanStatus(liveRow({ ReportedAt: ago(31000) }), NOW), 'starting');
});
check('failed when the plugin says so, starting before any report', () => {
  assert.strictEqual(L.lanStatus(liveRow({ Status: 'failed' }), NOW), 'failed');
  assert.strictEqual(L.lanStatus({ Wanted: true }, NOW), 'starting');
});

console.log('\nbuild-lan: what participants get');
check('a local link becomes its Wi-Fi twin with the key, keeping path and query', () => {
  const t = L.lanTranslator(liveRow(), NOW);
  assert.strictEqual(t('http://localhost:5173/b?x=1#top'), 'http://192.168.1.20:4900/b?x=1&k=KEYkeyKEYkeyKEYkey1234#top');
  assert.strictEqual(t('http://localhost:5173'), 'http://192.168.1.20:4900/?k=KEYkeyKEYkeyKEYkey1234');
});
check('nothing translates when off, stale, failed, or the address is not in the map', () => {
  assert.strictEqual(L.lanTranslator(liveRow({ Wanted: false }), NOW)('http://localhost:5173/'), '');
  assert.strictEqual(L.lanTranslator(liveRow({ ReportedAt: ago(40000) }), NOW)('http://localhost:5173/'), '');
  assert.strictEqual(L.lanTranslator(liveRow({ Status: 'failed' }), NOW)('http://localhost:5173/'), '');
  assert.strictEqual(L.lanTranslator(liveRow(), NOW)('http://localhost:9000/'), '');
});
check('the participants\' Open the build is the newest local link Claude showed', () => {
  const room = { lan: liveRow({ Map: [
    { local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' },
    { local: 'http://localhost:5174', lan: 'http://192.168.1.20:4901' },
  ] }), logs: [{ By: 'agent', Link: 'http://localhost:5173/' }, { By: 'agent', Link: 'http://localhost:5174/b' }], asks: [], state: null };
  assert.deepStrictEqual(L.lanPublicView(room, NOW), { open: 'http://192.168.1.20:4901/b?k=KEYkeyKEYkeyKEYkey1234' });
  assert.strictEqual(L.lanPublicView({ ...room, lan: liveRow({ Wanted: false }) }, NOW), null);
});

console.log('\nbuild-lan: the host\'s view');
check('the host sees the links with the key; Claude\'s copy has no key', () => {
  const host = L.lanHostView(liveRow(), NOW, { withKey: true });
  assert.strictEqual(host.status, 'live');
  assert.strictEqual(host.map[0].link, 'http://192.168.1.20:4900/?k=KEYkeyKEYkeyKEYkey1234');
  const agent = L.lanHostView(liveRow(), NOW, { withKey: false });
  assert.strictEqual(agent.map[0].link, undefined);
  assert.ok(!JSON.stringify(agent).includes('KEYkey'));
});

console.log(`\n${pass} passed, ${failed} failed`);
suiteFinished();
process.exit(failed ? 1 : 0);
```

Note the row shape the tests use: logs carry `By` and `Link` (the stored names; check `logView` in build-store.js and use whatever the stored log rows really call them — `Link` and `By` — before writing the implementation), options carry `url`, the outcome carries `links[].url`.

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/build-room-lan.js`
Expected: FAIL, `Cannot find module .../build-lan.js`.

- [ ] **Step 3: Write `lambda-functions/game/build-lan.js`**

```js
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

function isLoopbackUrl(url) {
  const u = hostOf(url);
  if (!u || !['http:', 'https:'].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h);
}

function isPrivateLanUrl(url) {
  const u = hostOf(url);
  if (!u || u.protocol !== 'http:') return false;
  const h = u.hostname;
  return /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/** Every local address Claude has shown, oldest first: the plugin opens these. */
function lanTargets(room) {
  const r = room || {};
  const urls = [];
  for (const l of r.logs || []) if (l.By === 'agent' && l.Link) urls.push(l.Link);
  for (const a of r.asks || []) for (const o of a.Options || []) if (o && o.url) urls.push(o.url);
  const outcome = r.state && r.state.Outcome;
  for (const l of (outcome && outcome.links) || []) if (l && l.url) urls.push(l.url);
  const seen = [];
  for (const u of urls) {
    if (!isLoopbackUrl(u)) continue;
    const origin = hostOf(u).origin;
    if (!seen.includes(origin)) seen.push(origin);
    if (seen.length === MAX_TARGETS) break;
  }
  return seen;
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
  return { value: { Status: status, Map: map, Key: status === 'off' ? '' : key, Open: open, Error: error } };
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
  return open ? { open } : null;
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
  };
}

module.exports = {
  SK_LAN, REPORT_FRESH_MS, QUIET_AFTER_MS, MAX_TARGETS,
  isLoopbackUrl, isPrivateLanUrl, lanTargets, normalizeReport, lanStatus, lanTranslator, lanPublicView, lanHostView,
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `node tests/build-room-lan.js`
Expected: every line PASS, `0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/game/build-lan.js tests/build-room-lan.js
git commit -m "Build Room Wi-Fi share: the share row as pure functions (targets, report, status, the participants' links)"
```

---

### Task 2: The server routes, the views and the seal

**Files:**
- Modify: `lambda-functions/game/build-store.js` (`SK` ~305, `entityForSk` ~340, `roomFromRows` ~481, `hostView` ~839, `publicView` ~870, `publicAsk` / `publicOutcome` ~912)
- Modify: `lambda-functions/game/build-room.js` (`routeHost` ~1612, handler wrapper ~1846)
- Modify: `lambda-functions/game/tenant-crypto.js:523`, `lambda-functions/websocket/tenant-crypto.js`, `lambda-functions/admin/shared/tenant-crypto.js` (same line)
- Test: `tests/build-room.js` (new section near the end, before the final tally)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `POST /games/{id}/build/share` (host) body `{on?: boolean, dismissOffer?: true}` → `200 {lan: lanHostView(withKey)}`; 409 when the session has ended and `on` is true.
  - `POST /games/{id}/build/share/report` (agent) body = the plugin's report → `200 {wanted: boolean, targets: string[]}`. No `inbox` in the answer.
  - `hostView(...).lan` = `lanHostView(room.lan, now, {withKey: audience !== 'agent'})`.
  - `publicView(...).lan` = `lanPublicView(room, now)` (null when not live); local links in `log[].link`, `current.options[].url` and `outcome.links` are translated when live, dropped otherwise.

- [ ] **Step 1: Write the failing tests** in `tests/build-room.js`, a new section before the final `console.log` tally:

```js
  console.log('\nWi-Fi share (docs/design/build-room-lan-share/PLAN.md §3)');
  const report = (body) => agentCall('POST', 'share/report', body);
  const LIVE = (over = {}) => ({ status: 'live', key: 'abcdefghijklmnopqrstuv', open: 2, map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }], ...over });

  await check('off by default: the plugin is told not wanted, and is given the local addresses Claude showed', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'The first board', link: 'http://localhost:5173/' });
    const r = await report({ status: 'off' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { wanted: false, targets: ['http://localhost:5173'] });
  });
  await check('a report never takes Claude\'s inbox and never marks Claude as seen', async () => {
    seed();
    await hostCall('POST', 'directions', { text: 'Make the counters bigger' });
    const r = await report({ status: 'off' });
    assert.strictEqual(r.body.inbox, undefined);
    const st = store.get(key(`GAME#${GAME}`, 'BUILD#STATE')) || {};
    assert.strictEqual(st.AgentSeenAt, undefined);
    const next = await agentCall('GET', 'inbox');
    assert.ok(next.body.inbox.some((d) => /bigger/.test(d.text)), 'the direction is still waiting for Claude');
  });
  await check('only the host turns it on; Claude cannot, and a participant cannot', async () => {
    seed();
    assert.strictEqual((await agentCall('POST', 'share', { on: true })).status, 403);
    const r = await hostCall('POST', 'share', { on: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lan.status, 'starting');
    assert.strictEqual((await report({ status: 'off' })).body.wanted, true);
  });
  await check('live: participants get the Wi-Fi link with the key; off: they get nothing, at once', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'The first board', link: 'http://localhost:5173/b' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    let v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan.open, 'http://192.168.1.20:4900/b?k=abcdefghijklmnopqrstuv');
    assert.ok(v.log.some((l) => l.link === 'http://192.168.1.20:4900/b?k=abcdefghijklmnopqrstuv'));
    await hostCall('POST', 'share', { on: false });
    v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan, null);
    assert.ok(!JSON.stringify(v).includes('192.168.1.20'));
  });
  await check('the host sees each address with its link and the count; Claude sees no key', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const host = (await hostCall('GET', 'state')).body.lan;
    assert.strictEqual(host.status, 'live');
    assert.strictEqual(host.open, 2);
    assert.ok(host.map[0].link.includes('k=abcdefghijklmnopqrstuv'));
    const agent = (await agentCall('GET', 'state')).body;
    assert.ok(!JSON.stringify(agent.lan).includes('abcdefghijklmnopqrstuv'));
  });
  await check('a stale report counts as off for participants', async () => {
    seed();
    await agentCall('POST', 'log', { kind: 'showing', text: 'x', link: 'http://localhost:5173/' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const k = key(`GAME#${GAME}`, 'BUILD#LAN');
    store.set(k, { ...store.get(k), ReportedAt: new Date(Date.now() - 60000).toISOString() });
    assert.strictEqual((await playCall('GET', 'state', priya)).body.lan, null);
  });
  await check('an ended session is never wanted, and cannot be turned on', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'ENDED' });
    assert.strictEqual((await report({ status: 'off' })).body.wanted, false);
    assert.strictEqual((await hostCall('POST', 'share', { on: true })).status, 409);
  });
  await check('dismissing the offer is remembered', async () => {
    seed();
    await hostCall('POST', 'share', { dismissOffer: true });
    assert.strictEqual((await hostCall('GET', 'state')).body.lan.offerDismissed, true);
  });
  await check('a team room seals the map, the key and the error at rest, and still hands out a working link', async () => {
    seed({ orgId: ORG });
    await agentCall('POST', 'log', { kind: 'showing', text: 'x', link: 'http://localhost:5173/' });
    await hostCall('POST', 'share', { on: true });
    await report(LIVE());
    const raw = store.get(key(`GAME#${GAME}`, 'BUILD#LAN'));
    assert.ok(!JSON.stringify(raw).includes('abcdefghijklmnopqrstuv'), 'the key is sealed');
    assert.ok(!JSON.stringify(raw).includes('192.168.1.20'), 'the map is sealed');
    const v = (await playCall('GET', 'state', priya)).body;
    assert.strictEqual(v.lan.open, 'http://192.168.1.20:4900/?k=abcdefghijklmnopqrstuv');
  });
  await check('a change in what the plugin reports is announced; the same report again is not', async () => {
    seed();
    await hostCall('POST', 'share', { on: true });
    sent = [];
    await report(LIVE());
    assert.ok(sent.some((m) => m.message.type === 'buildChanged'));
    sent = [];
    await report(LIVE());
    assert.ok(!sent.some((m) => m.message.type === 'buildChanged'));
  });
```

Before writing these, read how `seed({ orgId })` sets up the org key for a team room in this suite (search `seed({ orgId: ORG })` in `tests/build-room.js`) and copy whatever extra row or loader call that suite's existing team-room checks use. Read how the GET state test calls `playCall('GET', 'state', priya)` (search `'state', priya`) and use the same.

- [ ] **Step 2: Run to see them fail**

Run: `node tests/build-room.js 2>&1 | grep -A2 "Wi-Fi share" ; node tests/build-room.js >/dev/null; echo exit=$?`
Expected: the new checks FAIL (404 on `share/report`), exit 1.

- [ ] **Step 3: The seal, in all three copies.** In each `tenant-crypto.js`, after the `buildActivity` line:

```js
  // The Wi-Fi share (build-lan.js): the local and Wi-Fi addresses, the key
  // that opens the gateway, and the plugin's last error.
  buildLan: Object.freeze(['Map', 'Key', 'Error']),
```

Then check they are still identical: `cmp lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js && cmp lambda-functions/game/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js && echo identical`.

- [ ] **Step 4: The store.** In `build-store.js`:

```js
const LAN = require('./build-lan');
```
at the top with the other requires; in `SK` add `lan: LAN.SK_LAN,`; in `entityForSk` add `if (sk === SK.lan) return 'buildLan';` after the activity line; in `roomFromRows` add `lan: null,` to the initial object and `else if (sk === SK.lan) room.lan = r;` after the activity branch.

In `hostView`, after `activity:`:
```js
    lan: LAN.lanHostView(room.lan, now, { withKey: !isAgent }),
```

In `publicView`, at its top:
```js
  const lanLink = LAN.lanTranslator(room.lan, now);
  const forRoom = (u) => (u && !isLocalUrl(u) ? u : (u ? lanLink(u) : ''));
```
then replace `publicAsk(askView(...))` with `publicAsk(askView(current, room, 'public', me), forRoom)`, `.map((l) => ({ ...l, link: publicUrl(l.link) }))` with `.map((l) => ({ ...l, link: forRoom(l.link) }))`, `publicOutcome(outcomeView(...))` with `publicOutcome(outcomeView(room.state && room.state.Outcome), forRoom)`, and add `lan: LAN.lanPublicView(room, now),` to the returned object. Change the two helpers to:

```js
/** A participant's copy of an ask: a preview they cannot open is not offered. */
function publicAsk(ask, forRoom = publicUrl) {
  return { ...ask, options: ask.options.map((o) => ({ ...o, url: forRoom(o.url) })) };
}
function publicOutcome(o, forRoom = publicUrl) {
  return o ? { ...o, links: o.links.map((l) => ({ ...l, url: forRoom(l.url) })).filter((l) => l.url) } : o;
}
```
`publicView` is called with `now` already (check its callers pass it; if a caller omits it, pass `new Date().toISOString()`).

- [ ] **Step 5: The routes.** In `build-room.js`, require `const LAN = require('./build-lan');`, then add these two functions above `routeHost`:

```js
/**
 * WI-FI SHARE (docs/design/build-room-lan-share/PLAN.md §3). The row is
 * written with UpdateItem so the host's switch and the plugin's report never
 * overwrite each other's fields. Sealed fields are encrypted by hand, as the
 * brief draft is.
 */
async function updateLan(ctx, set) {
  const sealed = ctx.orgId ? await encryptItem(ctx.orgId, 'buildLan', set) : set;
  const names = {}; const values = { ':ttl': ctx.ttl }; const sets = ['#ttl = :ttl'];
  names['#ttl'] = 'ttl';
  Object.entries(sealed).forEach(([k, v], i) => { names[`#f${i}`] = k; values[`:f${i}`] = v; sets.push(`#f${i} = :f${i}`); });
  await db.send(new UpdateCommand({ TableName: TABLE(), Key: { PK: ctx.pk, SK: LAN.SK_LAN }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
}

/** The host's switch: `{on}` turns sharing on or off; `{dismissOffer}` hides the one-time offer. */
async function hostShare(ctx, body) {
  const b = body || {};
  const now = new Date().toISOString();
  if (b.dismissOffer === true) await updateLan(ctx, { OfferDismissedAt: now });
  if (typeof b.on === 'boolean') {
    if (b.on && (await sessionState(ctx)) === 'ENDED') return fail(409, 'This session has ended');
    await updateLan(ctx, { Wanted: b.on, WantedAt: now, OfferDismissedAt: now });
    await logEntry(ctx, { kind: 'note', by: 'host', text: b.on ? 'You shared the build on this Wi-Fi' : 'You stopped sharing the build on this Wi-Fi' });
  }
  const room = await loadRoom(ctx);
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(200, { lan: LAN.lanHostView(room.lan, now, { withKey: true }) });
}

/** The plugin's report, every 4 to 15 seconds. Answers what to open. */
async function shareReport(ctx, body) {
  const norm = LAN.normalizeReport(body);
  if (norm.error) return fail(400, norm.error);
  const now = new Date().toISOString();
  const room = await loadRoom(ctx);
  const before = room.lan || {};
  const v = norm.value;
  const set = { ...v, ReportedAt: now };
  if (v.Status === 'live' && before.Status !== 'live') set.LiveSince = now;
  await updateLan(ctx, set);
  const changed = ['Status', 'Key', 'Open', 'Error'].some((k) => before[k] !== v[k])
    || JSON.stringify(before.Map || []) !== JSON.stringify(v.Map);
  if (changed) {
    const rev = (await touchState(ctx)).Rev;
    await announce(ctx, rev);
  }
  const ended = (await sessionState(ctx)) === 'ENDED';
  return reply(200, { wanted: Boolean(before.Wanted) && !ended, targets: LAN.lanTargets(room) });
}
```

Check `logEntry` accepts `kind: 'note'` with `by: 'host'` (search `HOST_LOG_KINDS` in build-store.js); if `note` is a host-private kind that participants never see, that is right: the timeline entry is for the host. If no suitable kind exists, drop the `logEntry` call rather than invent a kind.

In `routeHost`, before the `ended` check (so an ended session can still answer the plugin with `wanted: false`):

```js
  if (method === 'POST' && a === 'share' && b === 'report' && !c) return role === 'agent' ? shareReport(ctx, body) : fail(403, 'Only Claude Code reports the Wi-Fi share');
```
and after the `ended` check, with the other host-only routes:
```js
  if (a === 'share' && !b) return hostOnly() || hostShare(ctx, body);
```

In the handler wrapper, replace `await agentTouch(ctx, event, role);` with:

```js
    // The Wi-Fi share report comes from the plugin's background loop: it
    // neither counts as Claude being seen nor takes Claude's inbox.
    const shareReportCall = parts[0] === 'share' && parts[1] === 'report';
    if (!shareReportCall) await agentTouch(ctx, event, role);
```
and add `&& !shareReportCall` to the condition `if (res.statusCode < 500 && !res.isBase64Encoded && parts[0] !== 'activity' && !hookCheckpoint)`.

- [ ] **Step 6: Run to see them pass**

Run: `node tests/build-room.js; echo exit=$?` then `node tests/build-room-lan.js; echo exit=$?`
Expected: all PASS, exit 0 for both. Then run every backend suite (the loop in Global Constraints); expected: no FAIL lines.

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/game/build-store.js lambda-functions/game/build-room.js lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js tests/build-room.js
git commit -m "Build Room Wi-Fi share: the host's switch, the plugin's report, and participants' links translated only while live"
```

---

### Task 3: The gateway in the plugin

**Files:**
- Modify: `src/public/engage-mcp.mjs` (new section after `checkLocalLink`; the startup tail ~2628; `renderState` ~370; `INSTRUCTIONS` ~1782; `BUILD_ROOM_SKILL` ~2283; `VERSION` line 34)
- Modify: `tests/engage-plugin-version.js` (the pin)
- Create: `tests/engage-lan-gateway.js`
- Modify: `tests/engage-mcp.js` (room_status line)

**Interfaces:**
- Consumes: `POST share/report` → `{wanted, targets}` (Task 2); the plugin's existing `api()`, `reloadConfig()`, `CONFIG`, `listenerDir()`, `within()`, `projectDir()`, `log()`.
- Produces: the report body `{status:'off'|'live'|'failed', map:[{local, lan}], key, open, error}`; the gateway's behaviour (the HTTP contract the tests pin); env knobs `ENGAGE_LAN_ADDRESS`, `ENGAGE_LAN_PORT`, `ENGAGE_LAN_FAST_MS`, `ENGAGE_LAN_IDLE_MS`.

- [ ] **Step 1: Write the failing test** — `tests/engage-lan-gateway.js`. It starts a real app server (refusing any `Host` that is not `localhost:<port>`, as Vite does, and echoing raw bytes after an upgrade), a fake Engage API, and the real plugin with `ENGAGE_LAN_ADDRESS=127.0.0.1` (CI has no Wi-Fi; the gateway's forwarding is what is under test).

```js
/**
 * BUILD ROOM WI-FI SHARE — the gateway inside the real plugin
 * (src/public/engage-mcp.mjs), against a fake Engage API and a real app.
 * docs/design/build-room-lan-share/PLAN.md §2 and §5.
 *
 * ENGAGE_LAN_ADDRESS=127.0.0.1 stands in for the Wi-Fi address: CI has no
 * Wi-Fi, and what is under test is the lock and the forwarding.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const KEY = `eng_4821_${'k'.repeat(43)}`;
let pass = 0; let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50); }
}

// The app: refuses a foreign Host like Vite, records what it saw, echoes after an upgrade.
const seen = [];
const app = http.createServer((req, res) => {
  seen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie || '' });
  if (req.headers.host !== `localhost:${app.address().port}`) { res.writeHead(403); return res.end('Blocked request. This host is not allowed.'); }
  if (req.url === '/go') { res.writeHead(302, { Location: `http://localhost:${app.address().port}/there` }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Four in a row</h1>');
});
app.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
  socket.on('data', (d) => socket.write(d));
});

// The fake Engage API: records reports, answers with the switch.
let wanted = false;
let targets = [];
const reports = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/build/share/report')) {
      reports.push(JSON.parse(body));
      return res.end(JSON.stringify({ wanted, targets }));
    }
    res.end('{}');
  });
});

const lastReport = () => reports[reports.length - 1] || {};
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const appOrigin = `http://localhost:${app.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-'));
  fs.mkdirSync(path.join(dir, '.engage'));
  fs.writeFileSync(path.join(dir, '.engage', 'session.json'), JSON.stringify({ key: KEY, api: `http://127.0.0.1:${api.address().port}/`, gameId: '4821' }));
  const base = 47000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: dir,
    env: { ...process.env, ENGAGE_LAN_ADDRESS: '127.0.0.1', ENGAGE_LAN_PORT: String(base), ENGAGE_LAN_FAST_MS: '100', ENGAGE_LAN_IDLE_MS: '100', ENGAGE_ACTIVITY_MS: '60000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const gw = `http://127.0.0.1:${base}`;

  console.log('\nThe Wi-Fi gateway');
  await check('off: the plugin reports off, and nothing listens', async () => {
    await until(() => reports.length >= 2);
    assert.strictEqual(lastReport().status, 'off');
    await assert.rejects(get(`${gw}/`));
  });

  let key;
  await check('on: a gateway opens for the app Claude showed, and the report says live with a key', async () => {
    targets = [appOrigin]; wanted = true;
    await until(() => lastReport().status === 'live');
    key = lastReport().key;
    assert.match(key, /^[A-Za-z0-9_-]{22}$/);
    assert.deepStrictEqual(lastReport().map, [{ local: appOrigin, lan: gw }]);
  });
  await check('no key and no cookie: the locked page, and the app never sees the request', async () => {
    const n = seen.length;
    const r = await get(`${gw}/`);
    assert.strictEqual(r.status, 403);
    assert.match(r.body, /Open this from the Build Room/);
    assert.strictEqual(seen.length, n);
  });
  let cookie;
  await check('the key becomes a cookie and the address loses it', async () => {
    const r = await get(`${gw}/b?x=1&k=${key}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/b?x=1');
    cookie = r.headers['set-cookie'][0].split(';')[0];
    assert.match(r.headers['set-cookie'][0], /HttpOnly/);
    assert.match(r.headers['set-cookie'][0], /SameSite=Lax/);
  });
  await check('with the cookie: the app, seeing localhost as its host and origin, without the gateway\'s cookie', async () => {
    const r = await get(`${gw}/`, { Cookie: `${cookie}; theme=dark`, Origin: gw });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /Four in a row/);
    const last = seen[seen.length - 1];
    assert.strictEqual(last.host, `localhost:${app.address().port}`);
    assert.strictEqual(last.origin, appOrigin);
    assert.ok(!last.cookie.includes('engage_lan'));
    assert.ok(last.cookie.includes('theme=dark'));
  });
  await check('a redirect to the app\'s own address comes back as the gateway\'s', async () => {
    const r = await get(`${gw}/go`, { Cookie: cookie });
    assert.strictEqual(r.headers.location, `${gw}/there`);
  });
  await check('a websocket-style upgrade passes through both ways', async () => {
    const sock = net.connect(base, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${base}\r\nUpgrade: echo\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
    let got = '';
    sock.on('data', (d) => { got += d.toString(); });
    await until(() => got.includes('101'));
    sock.write('ping');
    await until(() => got.includes('ping'));
    sock.destroy();
  });
  await check('the count says how many devices opened it', async () => {
    await until(() => lastReport().open >= 1);
  });
  await check('an app that has stopped answers with a plain 502, it does not hang', async () => {
    const dead = http.createServer();
    await new Promise((r) => dead.listen(0, '127.0.0.1', r));
    const deadOrigin = `http://localhost:${dead.address().port}`;
    await new Promise((r) => dead.close(r));
    targets = [appOrigin, deadOrigin];
    await until(() => lastReport().map.length === 2);
    const second = lastReport().map.find((m) => m.local === deadOrigin).lan;
    const r = await get(`${second}/`, { Cookie: cookie });
    assert.strictEqual(r.status, 502);
    assert.match(r.body, /not answering/);
    targets = [appOrigin];
  });
  await check('turned off: the port closes, an open hot-reload socket is cut, and the report says off', async () => {
    const sock = net.connect(base, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${base}\r\nUpgrade: echo\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
    let got = ''; let closed = false;
    sock.on('data', (d) => { got += d.toString(); });
    sock.on('close', () => { closed = true; });
    await until(() => got.includes('101'));
    wanted = false;
    await until(() => lastReport().status === 'off');
    await until(() => closed);
    await assert.rejects(get(`${gw}/`, { Cookie: cookie }));
  });
  await check('turned on again: a new key, and the old cookie is refused', async () => {
    wanted = true;
    await until(() => lastReport().status === 'live');
    assert.notStrictEqual(lastReport().key, key);
    const r = await get(`${gw}/`, { Cookie: cookie });
    assert.strictEqual(r.status, 403);
  });
  await check('it never opens a port for an address that is not on this laptop', async () => {
    targets = [appOrigin, 'http://192.168.1.50:3000'];
    await sleep(400);
    assert.strictEqual(lastReport().map.length, 1);
  });

  child.kill();
  app.close(); api.close();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
```

Check `.engage/session.json`'s real field names against `readConfig()` (engage-mcp.mjs ~55-86) and adjust the test's `writeFileSync` to match; read how `tests/engage-plugin.js` sets up a connected project folder and copy it.

- [ ] **Step 2: Run to see it fail**

Run: `node tests/engage-lan-gateway.js; echo exit=$?`
Expected: FAIL at "off: the plugin reports off" (no reports arrive), exit 1.

- [ ] **Step 3: Write the gateway section** in `engage-mcp.mjs`, after `checkLocalLink`. Add `import http from 'node:http'; import net from 'node:net'; import os from 'node:os'; import { randomBytes } from 'node:crypto';` to the imports if not already there (check the file's existing import lines and reuse their style).

```js
// ---------------------------------------------------------------------------
// THE WI-FI SHARE (owner, 2026-10-07; docs/design/build-room-lan-share/PLAN.md)
// ---------------------------------------------------------------------------
//
// While the host's switch is on, a small gateway puts the app Claude is
// running on this laptop's Wi-Fi address, so the room's laptops, tablets and
// phones can open it. The app itself stays on localhost. The gateway:
//   - binds the Wi-Fi IPv4 address only (never 0.0.0.0);
//   - opens one port per local address Engage lists (the ones Claude showed);
//   - refuses anything without the key (?k=) or its cookie, and never shows
//     the app to a refused request;
//   - tells the app it is being opened on localhost (Host, Origin), so a dev
//     server that checks its host (Vite does) serves it;
//   - pipes websocket upgrades, so hot reload reaches every device.

const LAN_FAST_MS = Math.max(50, Number(process.env.ENGAGE_LAN_FAST_MS) || 4000);
const LAN_IDLE_MS = Math.max(50, Number(process.env.ENGAGE_LAN_IDLE_MS) || 15000);
const LAN_PORT = Math.max(1024, Number(process.env.ENGAGE_LAN_PORT) || 4900);
const LAN_MAX = 4;
const LAN_COOKIE = 'engage_lan';
const LAN_SEEN_MS = 5 * 60 * 1000;
const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|[^.]+\.localhost)$/i;
const PRIVATE_V4_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

const lan = { key: '', gateways: new Map(), seen: new Map(), error: '' };

/** This laptop's Wi-Fi address: en0 first on macOS, then any private IPv4. */
function lanAddress() {
  if (process.env.ENGAGE_LAN_ADDRESS) return process.env.ENGAGE_LAN_ADDRESS;
  const all = os.networkInterfaces();
  const names = Object.keys(all).sort((a, b) => (a === 'en0' ? -1 : b === 'en0' ? 1 : 0));
  for (const name of names) {
    for (const ni of all[name] || []) {
      const v4 = ni.family === 'IPv4' || ni.family === 4;
      if (v4 && !ni.internal && PRIVATE_V4_RE.test(ni.address)) return ni.address;
    }
  }
  return '';
}

const cookiesOf = (header) => String(header || '').split(';').map((s) => s.trim()).filter(Boolean);
const hasKey = (req) => Boolean(lan.key) && cookiesOf(req.headers.cookie).includes(`${LAN_COOKIE}=${lan.key}`);
const withoutOurCookie = (header) => cookiesOf(header).filter((c) => !c.startsWith(`${LAN_COOKIE}=`)).join('; ');

const LOCKED_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Engage Build Room</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.5rem;color:#1B2942">' +
  '<h1 style="font-size:1.6rem">Open this from the Build Room</h1>' +
  '<p>This build is only for people in the room. Join the session on your phone, laptop or tablet and press Open the build.</p>' +
  '<p>If you were in the room, the host may have turned sharing off.</p></body>';

/** Headers for the app: it is being opened on localhost. */
function forwardHeaders(req, target) {
  const h = { ...req.headers, host: target.host };
  if (h.origin) h.origin = target.origin;
  if (h.referer) h.referer = h.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  const cookie = withoutOurCookie(h.cookie);
  if (cookie) h.cookie = cookie; else delete h.cookie;
  return h;
}

function openGateway(local, port, address) {
  const target = new URL(local);
  const lanOrigin = `http://${address}:${port}`;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, lanOrigin);
    if (lan.key && url.searchParams.get('k') === lan.key) {
      url.searchParams.delete('k');
      res.writeHead(302, {
        'Set-Cookie': `${LAN_COOKIE}=${lan.key}; HttpOnly; SameSite=Lax; Path=/`,
        Location: `${url.pathname}${url.search}`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    if (!hasKey(req)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(LOCKED_PAGE);
    }
    lan.seen.set(req.socket.remoteAddress || '', Date.now());
    const up = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req, target) }, (upRes) => {
      const headers = { ...upRes.headers };
      if (headers.location && headers.location.startsWith(target.origin)) headers.location = lanOrigin + headers.location.slice(target.origin.length);
      res.writeHead(upRes.statusCode || 502, headers);
      upRes.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The app is not answering on the host\'s laptop right now. Try again in a moment.');
    });
    req.pipe(up);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    if (!hasKey(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    lan.seen.set(socket.remoteAddress || '', Date.now());
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const h = forwardHeaders(req, target);
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).map(([k, v]) => `${k}: ${v}`), '', ''];
      upstream.write(lines.join('\r\n'));
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    const kill = () => { socket.destroy(); upstream.destroy(); };
    upstream.on('error', kill); socket.on('error', kill);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => resolve({ local, lan: lanOrigin, server, sockets }));
  });
}

function closeGateway(g) {
  for (const s of g.sockets) s.destroy();
  g.server.close();
}

function closeAllGateways() {
  for (const g of lan.gateways.values()) closeGateway(g);
  lan.gateways.clear();
  lan.key = '';
  lan.seen.clear();
}

/** Bring the open gateways in line with what Engage asked for. */
async function syncGateways(wanted, targets) {
  if (!wanted) { closeAllGateways(); lan.error = ''; return 'off'; }
  const address = lanAddress();
  if (!address) { closeAllGateways(); lan.error = 'No Wi-Fi address on this laptop. It may be on a wired network only, or offline.'; return 'failed'; }
  const wantedLocals = (targets || []).filter((t) => { try { return LOOPBACK_RE.test(new URL(t).hostname); } catch { return false; } }).slice(0, LAN_MAX);
  // Not this project's server (an earlier session's still running): never open it.
  const ours = wantedLocals.filter((t) => {
    const owner = listenerDir(Number(new URL(t).port));
    return !owner || owner === '/' || within(owner, projectDir()) || within(projectDir(), owner);
  });
  if (!ours.length) { lan.error = 'Claude has not shown anything running on this laptop yet.'; return 'failed'; }
  if (!lan.key) lan.key = randomBytes(16).toString('base64url');
  const used = new Set([...lan.gateways.values()].map((g) => Number(new URL(g.lan).port)));
  for (const local of ours) {
    if (lan.gateways.has(local)) continue;
    let opened = null;
    for (let port = LAN_PORT; port < LAN_PORT + 20 && !opened; port += 1) {
      if (used.has(port)) continue;
      try { opened = await openGateway(local, port, address); used.add(port); } catch (e) { if (e && e.code !== 'EADDRINUSE') { lan.error = `Could not open a port on the Wi-Fi (${e.code || e.message}).`; break; } }
    }
    if (opened) lan.gateways.set(local, opened);
  }
  if (!lan.gateways.size) { lan.error = lan.error || 'Every port from 4900 is in use on this laptop.'; return 'failed'; }
  lan.error = '';
  return 'live';
}

function lanOpenCount() {
  const now = Date.now();
  for (const [ip, at] of lan.seen) if (now - at > LAN_SEEN_MS) lan.seen.delete(ip);
  return lan.seen.size;
}

/** One round: report what is open, read back what the host wants. */
let lanStatusNow = 'off';
async function lanRound() {
  try {
    reloadConfig();
    if (CONFIG.problems.length || !existsSync(sessionFile())) return;
    const report = {
      status: lanStatusNow,
      map: [...lan.gateways.values()].map((g) => ({ local: g.local, lan: g.lan })),
      key: lanStatusNow === 'live' ? lan.key : '',
      open: lanOpenCount(),
      error: lan.error,
    };
    const answer = await api('POST', 'share/report', report, AbortSignal.timeout(8000));
    lanStatusNow = await syncGateways(Boolean(answer && answer.wanted), (answer && answer.targets) || []);
  } catch (e) {
    log('wi-fi share round failed:', e && e.message);
  }
}

function lanLoop() {
  lanRound().finally(() => {
    const t = setTimeout(lanLoop, lanStatusNow === 'off' ? LAN_IDLE_MS : LAN_FAST_MS);
    if (t.unref) t.unref();
  });
}
```

Note: a round reports the state **before** syncing, so the first live report arrives one round after the host's switch. That is within the spec's "up to 15 seconds". Check `sessionFile()` and `existsSync` exist under those names in the file (they are used by `hookActivity`); use the file's names.

In the startup tail, beside the activity pump:

```js
// The Wi-Fi share's report loop, only while running as Claude's MCP server.
if (!CLI) {
  const t = setTimeout(lanLoop, Math.min(LAN_IDLE_MS, 2000));
  if (t.unref) t.unref();
}
```

- [ ] **Step 4: What Claude is told.** In `renderState`, after the outcome line:

```js
  if (st.lan && st.lan.status === 'live') {
    lines.push('', 'SHARING ON WI-FI: the room opens your app on their own laptops, tablets and phones through Engage\'s gateway on this laptop. Keep starting servers on localhost (never --host 0.0.0.0). Route backend calls through your dev server (/api proxied to the backend) instead of calling another port from the page, and make every page work at phone, tablet and laptop widths.');
  }
```

Add the same rule as one bullet in `INSTRUCTIONS` (in the list that begins "Run THIS project's server on a port…", ~1798) and one line in `BUILD_ROOM_SKILL` where it talks about servers:

```
- Start servers on localhost, never --host 0.0.0.0. When the host shares the build on Wi-Fi, Engage's gateway opens it to the room's laptops, tablets and phones. So route backend calls through the dev server (/api proxied), and make every page work at phone, tablet and laptop widths.
```

Also change the existing line "Local URLs (localhost) are right here — the host opens them on this laptop, on the projector; phones only ever see public URLs." to: "Local URLs (localhost) are right here: the host opens them on this laptop, and when the host shares on Wi-Fi the room opens them too, on their laptops, tablets and phones."

Add a test to `tests/engage-mcp.js` in its room_status section: make the fake `GET state` answer include `lan: { status: 'live', map: [], open: 2 }` for one call and assert the tool's text contains `SHARING ON WI-FI`. Follow how that suite already varies the fake state (`stateBrief`, `stateInbox`).

- [ ] **Step 5: Bump the version.** `const VERSION = '1.11.0';`, then `node tests/engage-plugin-version.js` and paste the sha it prints into `PIN` with version `'1.11.0'`.

- [ ] **Step 6: Run to see it pass**

Run: `node tests/engage-lan-gateway.js; echo exit=$?` then `node tests/engage-mcp.js; echo $?`, `node tests/engage-plugin.js; echo $?`, `node tests/engage-crew-mcp.js; echo $?`, `node tests/engage-plugin-version.js; echo $?`, `node tests/build-room-copy.js; echo $?`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/public/engage-mcp.mjs tests/engage-lan-gateway.js tests/engage-mcp.js tests/engage-plugin-version.js
git commit -m "Build Room Wi-Fi share: the plugin's locked gateway on the laptop's Wi-Fi address, its report loop, and what Claude is told (plugin 1.11.0)"
```

---

### Task 4: The chip's state, as pure functions (`wifiShare.js`) and the API call

**Files:**
- Create: `src/src/buildroom/wifiShare.js`
- Modify: `src/src/buildroom/buildHostApi.js` (inside `buildApi`, beside `saveSettings`)
- Test: `src/src/__tests__/wifiShare.test.js`

**Interfaces:**
- Consumes: `room.lan` = Task 2's `lanHostView` shape; `room.log` entries `{by, kind, link}`; `room.asks[].options[].url`.
- Produces:
  - `wifiState(lan, now) → {state: 'off'|'starting'|'on'|'quiet'|'failed', label: string, open: number}`
  - `shouldOfferWifi(room) → boolean`
  - `QUIET_AFTER_MS = 120000`
  - `buildApi(gameId).share(body)` → `{lan}`

- [ ] **Step 1: Write the failing test** — `src/src/__tests__/wifiShare.test.js`:

```js
import { wifiState, shouldOfferWifi } from '../buildroom/wifiShare';

const NOW = '2026-10-07T12:00:00.000Z';
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

describe('wifiState: the chip says what is happening, in words', () => {
  test('off, and off with no lan at all', () => {
    expect(wifiState(null, NOW)).toEqual({ state: 'off', label: 'Wi-Fi · Off', open: 0 });
    expect(wifiState({ wanted: false, status: 'off' }, NOW).label).toBe('Wi-Fi · Off');
  });
  test('starting', () => {
    expect(wifiState({ wanted: true, status: 'starting' }, NOW).label).toBe('Wi-Fi · Starting…');
  });
  test('on, with how many devices', () => {
    expect(wifiState({ wanted: true, status: 'live', open: 9, liveSince: ago(600000) }, NOW)).toEqual({ state: 'on', label: 'Wi-Fi · On · 9 open', open: 9 });
  });
  test('on but none open: says nothing for 2 minutes, then "none open yet"', () => {
    expect(wifiState({ wanted: true, status: 'live', open: 0, liveSince: ago(60000) }, NOW).state).toBe('on');
    expect(wifiState({ wanted: true, status: 'live', open: 0, liveSince: ago(121000) }, NOW)).toEqual({ state: 'quiet', label: 'Wi-Fi · On · none open yet', open: 0 });
  });
  test('failed', () => {
    expect(wifiState({ wanted: true, status: 'failed', error: 'No Wi-Fi address' }, NOW).label).toBe("Wi-Fi · Didn't start");
  });
});

describe('shouldOfferWifi: once, when Claude first shows something running on this laptop', () => {
  const lan = { wanted: false, status: 'off', offerDismissed: false };
  test('a showing entry by Claude with a local link', () => {
    expect(shouldOfferWifi({ lan, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(true);
  });
  test('a choice option with a local url', () => {
    expect(shouldOfferWifi({ lan, log: [], asks: [{ options: [{ url: 'http://127.0.0.1:5174/a' }] }] })).toBe(true);
  });
  test('not for a public link, not once dismissed, not once on', () => {
    expect(shouldOfferWifi({ lan, log: [{ by: 'agent', kind: 'showing', link: 'https://example.com/' }], asks: [] })).toBe(false);
    expect(shouldOfferWifi({ lan: { ...lan, offerDismissed: true }, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(false);
    expect(shouldOfferWifi({ lan: { ...lan, wanted: true }, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/wifiShare.test.js`
Expected: FAIL, cannot find module `../buildroom/wifiShare`.

- [ ] **Step 3: Write `src/src/buildroom/wifiShare.js`**

```js
/**
 * BUILD ROOM WI-FI SHARE — the host's chip, as pure rules
 * (docs/design/build-room-lan-share/PLAN.md §4, mockups L1-L3).
 * `lan` is the server's lanHostView (lambda-functions/game/build-lan.js).
 */
export const QUIET_AFTER_MS = 2 * 60 * 1000;

const LOOPBACK = /^(localhost|[^.]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;
function isLoopback(url) {
  try { return LOOPBACK.test(new URL(String(url)).hostname); } catch (e) { return false; }
}

export function wifiState(lan, now) {
  const l = lan || {};
  if (!l.wanted || l.status === 'off' || !l.status) return { state: 'off', label: 'Wi-Fi · Off', open: 0 };
  if (l.status === 'failed') return { state: 'failed', label: "Wi-Fi · Didn't start", open: 0 };
  if (l.status !== 'live') return { state: 'starting', label: 'Wi-Fi · Starting…', open: 0 };
  const open = Number(l.open) || 0;
  const since = l.liveSince ? Date.parse(now) - Date.parse(l.liveSince) : 0;
  if (open === 0 && since >= QUIET_AFTER_MS) return { state: 'quiet', label: 'Wi-Fi · On · none open yet', open: 0 };
  return { state: 'on', label: `Wi-Fi · On · ${open} open`, open };
}

export function shouldOfferWifi(room) {
  const lan = (room && room.lan) || {};
  if (lan.wanted || lan.offerDismissed) return false;
  const shown = ((room && room.log) || []).some((l) => l.by === 'agent' && isLoopback(l.link));
  const option = ((room && room.asks) || []).some((a) => (a.options || []).some((o) => isLoopback(o.url)));
  return shown || option;
}
```

In `buildHostApi.js`, inside the object `buildApi` returns, beside `saveSettings`:

```js
    /** The Wi-Fi share: `{on}` or `{dismissOffer: true}` → `{lan}` */
    share: (body) => post('share', body),
```

- [ ] **Step 4: Run to see it pass**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/wifiShare.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/buildroom/wifiShare.js src/src/buildroom/buildHostApi.js src/src/__tests__/wifiShare.test.js
git commit -m "Build Room Wi-Fi share: the chip's states and the one-time offer, as pure rules"
```

---

### Task 5: The host's screens (chip, panel, offer, wall QR, Build screen QR, Connect line)

**Files:**
- Create: `src/src/buildroom/BuildWifiShare.jsx`
- Modify: `src/src/buildroom/BuildRoomPage.jsx` (`RoomHeader` ~1037; Host screen `<main>` ~682; `BuildScreen` ~1299; `ConnectPanel` steps ~2975)
- Modify: `src/src/buildroom/BuildRoom.css`
- Test: `src/src/__tests__/buildWifiShare.test.jsx`

**Interfaces:**
- Consumes: `wifiState`, `shouldOfferWifi` (Task 4); `api.share` (Task 4); `run(fn)` (the page's existing busy wrapper); `Modal` (`src/src/components/Modal.jsx`); `QRCodeSVG` from `qrcode.react`; `CopyLinkButton` (BuildRoomPage, find its export or move it if needed).
- Produces: `WifiChip({lan, now, onOpen, open})`, `WifiPanel({lan, now, busy, run, api, onClose, onShowWall})`, `WifiOffer({busy, run, api})`, `WallBuildQr({link, onClose})`, `BuildScreenQr({link})`, and `wifiLink(lan, room)` (the link the QR encodes: the host map entry for the newest local link Claude showed, else the first).

- [ ] **Step 1: Write the failing test** — `src/src/__tests__/buildWifiShare.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WifiChip, WifiPanel, WifiOffer, WallBuildQr, wifiLink } from '../buildroom/BuildWifiShare';

const NOW = '2026-10-07T12:00:00.000Z';
const LIVE = {
  wanted: true, status: 'live', open: 9, liveSince: '2026-10-07T11:50:00.000Z', offerDismissed: true,
  map: [
    { local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900', link: 'http://192.168.1.20:4900/?k=KEY' },
    { local: 'http://localhost:5174', lan: 'http://192.168.1.20:4901', link: 'http://192.168.1.20:4901/?k=KEY' },
  ],
};
const runNow = (fn) => fn();

test('the chip reads the state and opens the panel', () => {
  const onOpen = jest.fn();
  render(<WifiChip lan={LIVE} now={NOW} onOpen={onOpen} open={false} />);
  const chip = screen.getByRole('button', { name: /Wi-Fi · On · 9 open/ });
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalled();
});

test('the panel lists each address, says who can open it, and turns sharing off', () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  render(<WifiPanel lan={LIVE} now={NOW} busy={false} run={runNow} api={api} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/Anyone on this Wi-Fi with the link can open the app Claude is running/)).toBeInTheDocument();
  expect(screen.getByText('http://192.168.1.20:4900')).toBeInTheDocument();
  expect(screen.getByText('http://192.168.1.20:4901')).toBeInTheDocument();
  expect(screen.getByText(/devices opened it in the last 5 minutes/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: /Share on this Wi-Fi/ }));
  expect(api.share).toHaveBeenCalledWith({ on: false });
});

test('the key is never shown as text, only copied', () => {
  render(<WifiPanel lan={LIVE} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.queryByText(/k=KEY/)).toBeNull();
});

test('none open yet: the panel says the Wi-Fi may keep devices apart, and names the VPN case', () => {
  const quiet = { ...LIVE, open: 0, liveSince: '2026-10-07T11:55:00.000Z' };
  render(<WifiPanel lan={quiet} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/keep devices apart/)).toBeInTheDocument();
  expect(screen.getByText(/laptops not on a work VPN/)).toBeInTheDocument();
});

test("didn't start: the reason, and Try again", () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  const failed = { wanted: true, status: 'failed', error: 'No Wi-Fi address on this laptop. It may be on a wired network only, or offline.', map: [] };
  render(<WifiPanel lan={failed} now={NOW} busy={false} run={runNow} api={api} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/No Wi-Fi address on this laptop/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(api.share).toHaveBeenCalledWith({ on: true });
});

test('the offer turns it on, or is dismissed for the session', () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  render(<WifiOffer busy={false} run={runNow} api={api} />);
  expect(screen.getByText('Let the room open it themselves?')).toBeInTheDocument();
  expect(screen.getByText(/on a phone, laptop or tablet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Share on this Wi-Fi' }));
  expect(api.share).toHaveBeenCalledWith({ on: true });
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(api.share).toHaveBeenCalledWith({ dismissOffer: true });
});

test('the wall says laptops, tablets and phones, never phones only', () => {
  render(<WallBuildQr link="http://192.168.1.20:4900/?k=KEY" onClose={() => {}} />);
  expect(screen.getByText('Open the build yourself')).toBeInTheDocument();
  expect(screen.getByText(/On your phone, laptop or tablet/)).toBeInTheDocument();
  expect(screen.queryByText(/on your phone\b(?!, laptop)/i)).toBeNull();
});

test('the QR encodes the address for the newest app Claude showed', () => {
  const room = { lan: LIVE, log: [{ by: 'agent', link: 'http://localhost:5173/' }, { by: 'agent', link: 'http://localhost:5174/b' }] };
  expect(wifiLink(room)).toBe('http://192.168.1.20:4901/?k=KEY');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/buildWifiShare.test.jsx`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write `src/src/buildroom/BuildWifiShare.jsx`.** Look at `AutoSwitch` and `QrZoom` in `BuildRoomPage.jsx` first and match their markup: the switch is a `<button role="switch" aria-checked>` or a labelled checkbox, whichever `AutoSwitch` uses; the wall QR uses `Modal` the way `QrZoom` does.

```jsx
/**
 * BUILD ROOM WI-FI SHARE — the host's side (docs/design/build-room-lan-share/,
 * mockups L1-L4). The chip in the header, its panel (a popover: the room keeps
 * running behind it), the one-time offer on the Host screen, the QR on the
 * wall and on the Build screen. Copy names laptops, tablets and phones, never
 * phones alone (owner, 2026-10-07).
 */
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../components/Modal';
import { wifiState } from './wifiShare';

const LOOPBACK = /^(localhost|[^.]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;
const originOf = (u) => { try { const x = new URL(String(u)); return LOOPBACK.test(x.hostname) ? x.origin : ''; } catch (e) { return ''; } };

/** The link the wall's QR opens: the newest app Claude showed, else the first one shared. */
export function wifiLink(room) {
  const map = (room && room.lan && room.lan.map) || [];
  const log = (room && room.log) || [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const o = log[i].by === 'agent' ? originOf(log[i].link) : '';
    const hit = o && map.find((m) => m.local === o);
    if (hit && hit.link) return hit.link;
  }
  return (map[0] && map[0].link) || '';
}

export function WifiChip({ lan, now, onOpen, open }) {
  const s = wifiState(lan, now);
  return (
    <button type="button" className={`brm-wifi brm-wifi--${s.state}${open ? ' is-open' : ''}`} aria-expanded={open} onClick={onOpen} data-testid="brm-wifi">
      {s.label}
    </button>
  );
}

const LABELS = { 0: 'Latest build', 1: 'Second app', 2: 'Third app', 3: 'Fourth app' };

export function WifiPanel({ lan, now, busy, run, api, onClose, onShowWall }) {
  const s = wifiState(lan, now);
  const on = Boolean(lan && lan.wanted);
  const toggle = () => run(() => api.share({ on: !on }));
  return (
    <div className="brm-wifipanel" role="dialog" aria-label="Share on this Wi-Fi">
      <div className="brm-wifipanel-top">
        <h3>Share on this Wi-Fi</h3>
        <button type="button" role="switch" aria-checked={on} aria-label="Share on this Wi-Fi" className={`brm-switch${on ? ' is-on' : ''}`} disabled={busy} onClick={toggle}>
          <i aria-hidden="true" />{on ? 'On' : 'Off'}
        </button>
        <button type="button" className="brm-wifipanel-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <p className="brm-wifipanel-say">Anyone on this Wi-Fi with the link can open the app Claude is running, on a phone, laptop or tablet. Turn it off at any time. Everyone loses it at once.</p>
      {s.state === 'failed' && (
        <div className="brm-wifipanel-err"><b>It didn&apos;t start.</b> {lan.error}</div>
      )}
      {s.state === 'quiet' && (
        <div className="brm-wifipanel-warn">
          <b>None open yet.</b> It has been on for 2 minutes and no device has opened it. Some Wi-Fi networks (hotels, conferences, guest networks) keep devices apart, so nobody else can reach this laptop.
          <p>Check that everyone is on the same Wi-Fi as this laptop: phones and tablets not on mobile data, laptops not on a work VPN. Try it yourself on another device first.</p>
        </div>
      )}
      {s.state === 'on' && (
        <p className="brm-wifipanel-stat"><b>{s.open}</b> devices opened it in the last 5 minutes</p>
      )}
      {(lan && lan.map && lan.map.length > 0) && (
        <ul className="brm-wifipanel-apps">
          {lan.map.map((m, i) => (
            <li key={m.lan}>
              <span className="brm-wifipanel-k">{LABELS[i]}</span>
              <span className="brm-wifipanel-u" title={m.local}>{m.lan}</span>
              {m.link && <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={() => navigator.clipboard && navigator.clipboard.writeText(m.link)}>Copy</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="brm-wifipanel-foot">
        {s.state === 'failed'
          ? <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => run(() => api.share({ on: true }))}>Try again</button>
          : <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={!on || s.state === 'starting'} onClick={onShowWall}>Show the QR on the wall</button>}
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function WifiOffer({ busy, run, api }) {
  return (
    <section className="brm-wifioffer" aria-label="Share the build on this Wi-Fi">
      <p className="brm-wifioffer-t">Let the room open it themselves?</p>
      <p className="brm-wifioffer-s">Anyone in the room on this laptop&apos;s Wi-Fi can open the app Claude is running, on a phone, laptop or tablet. You can turn it off at any time.</p>
      <div className="brm-row">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => run(() => api.share({ on: true }))}>Share on this Wi-Fi</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => run(() => api.share({ dismissOffer: true }))}>Not now</button>
      </div>
    </section>
  );
}

export function WallBuildQr({ link, onClose }) {
  return (
    <Modal overlayClassName="brm-qrzoom" contentClassName="brm-qrzoom-card brm-wallqr" onClose={onClose} label="Open the build yourself">
      <div className="brm-wallqr-body">
        <div className="brm-qrzoom-qr" role="img" aria-label="QR code to open the build">
          <QRCodeSVG value={link} size={512} level="M" includeMargin={false} />
        </div>
        <div>
          <span className="brm-wallqr-eb">The build is live</span>
          <h2 className="brm-wallqr-h">Open the build yourself</h2>
          <p className="brm-wallqr-l">On your phone, laptop or tablet: scan the code, or press Open the build in Engage.</p>
          <p className="brm-wallqr-m">You need to be on the same Wi-Fi as this laptop.</p>
          <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

export function BuildScreenQr({ link }) {
  if (!link) return null;
  return (
    <div className="brm-buildqr">
      <QRCodeSVG value={link} size={96} level="M" includeMargin={false} />
      <p>Open the build yourself<small>Phone, laptop or tablet · same Wi-Fi</small></p>
    </div>
  );
}
```

Check `Modal`'s import path and prop names against `QrZoom` (it uses `overlayClassName`, `contentClassName`, `onClose`, `label`) and adjust. Every dialog needs an X and a bottom exit (engage-design rule 2): `WallBuildQr` has Close at the bottom; give it the same X that `Modal` provides, or add one if `QrZoom` relies on click-anywhere.

- [ ] **Step 4: Wire it into `BuildRoomPage.jsx`.**
  - `import { WifiChip, WifiPanel, WifiOffer, WallBuildQr, BuildScreenQr, wifiLink } from './BuildWifiShare';` and `import { shouldOfferWifi, wifiState } from './wifiShare';`.
  - In `RoomHeader`: state `const [wifiOpen, setWifiOpen] = useState(false); const [wallQr, setWallQr] = useState(false);`. Before `<AgentChip …/>` render `{host && !ended && <WifiChip lan={room.lan} now={now} open={wifiOpen} onOpen={() => setWifiOpen((o) => !o)} />}`; after it, `{wifiOpen && <WifiPanel lan={room.lan} now={now} busy={busy} run={run} api={api} onClose={() => setWifiOpen(false)} onShowWall={() => { setWifiOpen(false); onScreen('stage'); setWallQr(true); }} />}` and `{wallQr && wifiLink(room) && <WallBuildQr link={wifiLink(room)} onClose={() => setWallQr(false)} />}`. Close the panel on Escape and on a click outside, the way `SessionMenu` does (copy its `useEffect`). Close `wallQr` when sharing stops: `useEffect(() => { if (wifiState(room.lan, now).state !== 'on' && wifiState(room.lan, now).state !== 'quiet') setWallQr(false); }, [room.lan, now]);`. `RoomHeader` must receive `busy`, `run`, `api`, `ended` — it already does (see its signature).
  - Host screen: inside `<main>`, directly before `{current ? (…`, render `{!ended && shouldOfferWifi(room) && <WifiOffer busy={busy} run={run} api={api} />}`.
  - `BuildScreen`: add `<BuildScreenQr link={['on', 'quiet'].includes(wifiState(room.lan, now).state) ? wifiLink(room) : ''} />` after the shot.
  - `ConnectPanel`: in the "Check for the latest Engage plugin" step, add a short line after its existing text: `<p className="brm-help">If your Mac asks whether node may accept incoming connections, click Allow. That is how the room&apos;s phones, laptops and tablets on this Wi-Fi reach the build.</p>` (use the class the neighbouring help text uses).

- [ ] **Step 5: The styles.** In `BuildRoom.css`, under the existing `.brm-conn` rules, using only tokens the sheet already uses (read `buildRoomPalette.test.js` first: it lists the tokens and may require new selectors to be rooted at `.brm-` and colours to be tokens). Draw from the mockup's `.wifi*`, `.wpanel*`, `.offer*`, `.wallqr*`, `.buildqr` rules in `docs/design/build-room-lan-share/index.html`, renamed `brm-wifi*`, `brm-wifipanel*`, `brm-wifioffer*`, `brm-wallqr*`, `brm-buildqr`. The panel is `position: absolute` under the header, `z-index` above the columns, width 440px, `max-width: calc(100vw - 32px)`. The chip states: `--off` muted, `--starting` and `--quiet` amber (`var(--primary)` text on the amber tint), `--on` green (the sheet's success-text token), `--failed` `var(--danger-text)` on the red tint — never `color: var(--danger)`.

- [ ] **Step 6: Run to see it pass**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/buildWifiShare.test.jsx src/__tests__/buildRoomPage.test.jsx src/__tests__/buildRoomPalette.test.js`
Expected: PASS. If `buildRoomPage.test.jsx` fixtures lack `lan`, the chip renders Off and the offer does not show (no local links in fixtures); if a fixture does have a local showing link, the offer appears — update that test's expectation only if it counts buttons.

- [ ] **Step 7: Commit**

```bash
git add src/src/buildroom/BuildWifiShare.jsx src/src/buildroom/BuildRoomPage.jsx src/src/buildroom/BuildRoom.css src/src/__tests__/buildWifiShare.test.jsx
git commit -m "Build Room Wi-Fi share: the host's chip, panel, one-time offer, the QR on the wall and the Build screen, and the macOS line in Connect"
```

---

### Task 6: Open the build, for participants

**Files:**
- Modify: `src/src/buildroom/BuildPlayer.jsx` (`nowExtras` ~1018)
- Modify: `src/src/buildroom/BuildPlayer.css`
- Test: `src/src/__tests__/buildPlayer.test.jsx`

**Interfaces:**
- Consumes: `view.lan` = `{open: string} | null` (Task 2's `lanPublicView`).
- Produces: a section `aria-label="Open the build"` with a link (not a button: it navigates) `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 1: Write the failing test** in `buildPlayer.test.jsx`, following how that file renders `BuildPlayer` with a fake view (find its helper, e.g. `renderPlayer(view)`):

```jsx
test('Open the build: shown while sharing is live, opens in a new tab, says same Wi-Fi', async () => {
  renderPlayer({ ...baseView, lan: { open: 'http://192.168.1.20:4900/?k=KEY' } });
  const link = await screen.findByRole('link', { name: 'Open the build' });
  expect(link).toHaveAttribute('href', 'http://192.168.1.20:4900/?k=KEY');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Works on the same Wi-Fi as the host')).toBeInTheDocument();
});

test('Open the build: absent when sharing is off', async () => {
  renderPlayer({ ...baseView, lan: null });
  await screen.findByText(/Send an idea to the host/);
  expect(screen.queryByRole('link', { name: 'Open the build' })).toBeNull();
});
```

Use the file's own names for `renderPlayer` and `baseView`; if it builds the view inline, copy one existing "building" view.

- [ ] **Step 2: Run to see it fail**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/buildPlayer.test.jsx -t "Open the build"`
Expected: FAIL, no link named Open the build.

- [ ] **Step 3: Implement.** In `BuildPlayer.jsx`, at the top of `nowExtras`'s fragment (before the preview note):

```jsx
      {view.lan && view.lan.open && (
        <section className="bpl-open" aria-label="Open the build">
          <a className="bpl-send bpl-open-btn" href={view.lan.open} target="_blank" rel="noopener noreferrer">Open the build</a>
          <p className="plr-help bpl-open-note">Works on the same Wi-Fi as the host</p>
        </section>
      )}
```

Also change the preview note's hint so it reads "Try it, then say what you think." only when `view.lan && view.lan.open` (the mockups' L5), keeping today's words otherwise.

In `BuildPlayer.css`: `.bpl-open` a bordered box in the success tint (copy the tokens `.bpl-pvnote` or the sheet's success colours use), `.bpl-open-btn` full width, `min-height: 48px`, centred text, `text-decoration: none`; `.bpl-open-note` centred. Read `buildPlayerPalette.test.js` first and satisfy it.

- [ ] **Step 4: Run to see it pass**

Run: `cd src && ./node_modules/.bin/jest src/__tests__/buildPlayer.test.jsx src/__tests__/buildPlayerPalette.test.js src/__tests__/playerBuildRoom.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/buildroom/BuildPlayer.jsx src/src/buildroom/BuildPlayer.css src/src/__tests__/buildPlayer.test.jsx
git commit -m "Build Room Wi-Fi share: Open the build for participants, on laptops, tablets and phones"
```

---

### Task 7: The gates, dev, and the real network

**Files:** none new. Updates `docs/design/build-room-lan-share/PLAN.md` status line and the memory note.

- [ ] **Step 1: Every gate.** From the worktree root:

```bash
rm -rf .aws-sam
for f in tests/*.js; do case "$f" in *verify-question-set-ui.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo backend-done
cd src && ./node_modules/.bin/jest --maxWorkers=3 2>&1 | tail -5 && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3; cd ..
node tests/build-room-copy.js
cmp lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js && cmp lambda-functions/game/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js && echo crypto-identical
```
Expected: no `FAIL` lines; jest suite count = 444 + 2 new, all passing; lint 0 errors; build succeeds; copy check passes; `crypto-identical`.

- [ ] **Step 2: Deploy to dev.** CLAUDE.md allows Claude to deploy dev. Push the branch head to `dev` (branch push, not a tag): `git fetch origin && git push origin HEAD:dev` (only if `origin/dev` is an ancestor of HEAD; otherwise merge `origin/dev` first and re-run Step 1). Watch: `AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 1`. Say the commit and the tier.

- [ ] **Step 3: The owner's real-network check** (needs the owner and their devices; Claude prepares it and reports what it saw):
  - the owner updates the plugin to 1.11.0 from the Connect panel, starts a room on `engage.dev.seibtribe.us`, Claude builds a small Vite app;
  - Share on this Wi-Fi from the offer; the chip goes Starting… then On;
  - a second laptop, a tablet and a phone on the same Wi-Fi: each opens it from Open the build, and the tablet and phone from the wall QR;
  - Claude edits the page: all three update without a reload;
  - Claude shows a second variant on another port: Open B works;
  - turn it off: every device's next load shows the locked page, the button is gone;
  - one try on a guest network: "none open yet" after 2 minutes.

- [ ] **Step 4: Record it.** Set PLAN.md's status line to "built, on dev at <commit>; real-network check <passed/what failed>", update the memory note `engage2-build-room-lan-share.md`, commit.
