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
