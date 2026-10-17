/**
 * BUILD ROOM REMOTE SHARE — the pure half (lambda-functions/game/build-lan.js).
 * docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md §4.3,
 * plan docs/superpowers/plans/2026-10-16-build-room-remote-share.md Task 1.
 *
 * The rules that matter most: a participant's shared view never carries the
 * tunnel's address or anyone's key, and a key opens nothing once its person is
 * removed, has moved devices, or was given a newer key.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'lambda-functions/game/build-lan.js'));

let pass = 0; let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}
const NOW = '2026-10-16T12:00:00.000Z';
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();
const ADDRESS = 'https://window-jpg-you-quiet.trycloudflare.com';
const wifiLive = {
  SK: L.SK_LAN, Wanted: true, Status: 'live', ReportedAt: ago(5000), LiveSince: ago(60000), Open: 3,
  Key: 'KEYkeyKEYkeyKEYkey1234', Map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }],
};
const remoteRow = (over = {}) => ({
  ...wifiLive, RemoteWanted: true, RemoteSupported: true, RemoteStatus: 'live', RemoteAddress: ADDRESS,
  RemoteTarget: 'http://localhost:5173', RemoteError: '', RemoteDevices: { Sam: 2, Priya: 1 }, RemoteLiveSince: ago(30000), ...over,
});
const room = (lan) => ({ lan, logs: [{ By: 'agent', Link: 'http://localhost:5173/board?x=1#top' }], asks: [], state: null });

console.log('\nremote share: keys');
check('hashKey is SHA-256 base64url (43 characters) and stable', () => {
  const h = L.hashKey('abc');
  assert.strictEqual(h, 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  assert.strictEqual(L.hashKey('abc'), h);
});
check('mintRemoteKey gives a 128-bit key and its hash; 1000 are all different', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const { key, hash } = L.mintRemoteKey();
    assert.match(key, /^[A-Za-z0-9_-]{22}$/);
    assert.strictEqual(hash, L.hashKey(key));
    seen.add(key);
  }
  assert.strictEqual(seen.size, 1000);
});
check('liveRemoteKeys keeps a present, unremoved player on the same device', () => {
  const h = L.hashKey('k1');
  const keys = L.liveRemoteKeys([{ PlayerName: 'Sam', Hash: h, ClientId: 'c1' }], [{ PlayerName: 'Sam', ClientId: 'c1' }]);
  assert.deepStrictEqual(keys, [{ hash: h, player: 'Sam' }]);
});
check('liveRemoteKeys drops a removed player, a missing one, a moved one (handover) and a malformed hash', () => {
  const h = (k) => L.hashKey(k);
  const keys = L.liveRemoteKeys([
    { PlayerName: 'Removed', Hash: h('a'), ClientId: 'c' },
    { PlayerName: 'Flagged', Hash: h('b'), ClientId: 'c' },
    { PlayerName: 'Gone', Hash: h('c'), ClientId: 'c' },
    { PlayerName: 'Moved', Hash: h('d'), ClientId: 'old' },
    { PlayerName: 'Bad', Hash: 'not-a-hash', ClientId: 'c' },
  ], [
    { PlayerName: 'Removed', ClientId: 'c', RemovedAt: ago(1000) },
    { PlayerName: 'Flagged', ClientId: 'c', Removed: true },
    { PlayerName: 'Moved', ClientId: 'new' },
    { PlayerName: 'Bad', ClientId: 'c' },
  ]);
  assert.deepStrictEqual(keys, []);
});
check('liveRemoteKeys keeps a key when the player row records no device (an old row)', () => {
  const h = L.hashKey('k');
  assert.deepStrictEqual(L.liveRemoteKeys([{ PlayerName: 'Old', Hash: h, ClientId: 'c' }], [{ PlayerName: 'Old' }]), [{ hash: h, player: 'Old' }]);
});

console.log('\nremote share: the report');
const goodRemote = { status: 'live', address: ADDRESS, target: 'http://localhost:5173', error: '', devices: { Sam: 2 } };
const report = (remote) => L.normalizeReport({ status: 'live', key: 'abcdefghijklmnopqrstuv', open: 1, map: [], ...(remote === undefined ? {} : { remote }) });
check('a good remote block is kept', () => {
  const r = report(goodRemote);
  assert.ok(r.value, JSON.stringify(r));
  assert.strictEqual(r.value.RemoteSupported, true);
  assert.strictEqual(r.value.RemoteStatus, 'live');
  assert.strictEqual(r.value.RemoteAddress, ADDRESS);
  assert.strictEqual(r.value.RemoteTarget, 'http://localhost:5173');
  assert.deepStrictEqual(r.value.RemoteDevices, { Sam: 2 });
});
check('a plugin that sends no remote block is recorded as unable to share remotely', () => {
  const r = report(undefined);
  assert.ok(r.value);
  assert.strictEqual(r.value.RemoteSupported, false);
  assert.strictEqual(r.value.RemoteStatus, 'off');
});
check('only an https trycloudflare.com origin is an address', () => {
  for (const address of ['http://x.trycloudflare.com', 'https://evil.com', 'https://x.trycloudflare.com.evil.com', 'https://a.b.trycloudflare.com', 'https://x.trycloudflare.com/path']) {
    const r = report({ ...goodRemote, address });
    assert.ok(r.error, `${address} should be refused`);
  }
});
check('a live remote report needs its address; a starting one may have none', () => {
  assert.ok(report({ ...goodRemote, address: '' }).error);
  assert.ok(report({ status: 'off', address: '', target: '', error: '', devices: {} }).value);
  const failedR = report({ status: 'failed', address: '', target: '', error: '  Cloudflare   said no  ', devices: {} });
  assert.strictEqual(failedR.value.RemoteError, 'Cloudflare said no');
});
check('the target must be a loopback address', () => {
  assert.ok(report({ ...goodRemote, target: 'http://192.168.1.5:3000' }).error);
});
check('devices: names to counts 0-50, at most 200 people', () => {
  assert.ok(report({ ...goodRemote, devices: { Sam: 51 } }).error);
  assert.ok(report({ ...goodRemote, devices: { Sam: 1.5 } }).error);
  assert.ok(report({ ...goodRemote, devices: { Sam: -1 } }).error);
  const many = {};
  for (let i = 0; i < 201; i += 1) many[`P${i}`] = 1;
  assert.ok(report({ ...goodRemote, devices: many }).error);
});

console.log('\nremote share: status');
check('off unless both sharing and remote are wanted', () => {
  assert.strictEqual(L.remoteStatus(remoteRow({ RemoteWanted: false }), NOW), 'off');
  assert.strictEqual(L.remoteStatus(remoteRow({ Wanted: false }), NOW), 'off');
  assert.strictEqual(L.remoteStatus(null, NOW), 'off');
});
check('live, failed and starting follow the freshness rule the Wi-Fi share uses', () => {
  assert.strictEqual(L.remoteStatus(remoteRow(), NOW), 'live');
  assert.strictEqual(L.remoteStatus(remoteRow({ RemoteStatus: 'failed' }), NOW), 'failed');
  assert.strictEqual(L.remoteStatus(remoteRow({ ReportedAt: ago(L.REPORT_FRESH_MS + 1) }), NOW), 'starting');
  assert.strictEqual(L.remoteStatus(remoteRow({ RemoteStatus: 'off' }), NOW), 'starting');
});
check('a fresh report from a plugin that cannot share remotely reads as failed', () => {
  assert.strictEqual(L.remoteStatus(remoteRow({ RemoteSupported: false, RemoteStatus: 'off' }), NOW), 'failed');
});
check('RemoteLiveSince is set by the report that first says live and kept after', () => {
  assert.strictEqual(L.remoteLiveSince({}, { RemoteStatus: 'live' }, NOW), NOW);
  assert.strictEqual(L.remoteLiveSince({ RemoteStatus: 'live', RemoteLiveSince: ago(9000), RemoteAddress: ADDRESS }, { RemoteStatus: 'live', RemoteAddress: ADDRESS }, NOW), ago(9000));
  // a reopened tunnel (new address) is a new since: phones must refetch their link
  assert.strictEqual(L.remoteLiveSince({ RemoteStatus: 'live', RemoteLiveSince: ago(9000), RemoteAddress: ADDRESS }, { RemoteStatus: 'live', RemoteAddress: 'https://other.trycloudflare.com' }, NOW), NOW);
  assert.strictEqual(L.remoteLiveSince({ RemoteStatus: 'live', RemoteLiveSince: ago(9000) }, { RemoteStatus: 'failed' }, NOW), null);
});

console.log('\nremote share: the participant\'s view');
const leaks = (v) => /trycloudflare|[?&]k=/.test(JSON.stringify(v));
check('remote live: the status, when it went live, the newest path; no Wi-Fi link, no address, no key', () => {
  const v = L.lanPublicView(room(remoteRow()), NOW);
  assert.deepStrictEqual(v, { remote: 'live', remoteSince: ago(30000), remotePath: '/board?x=1#top' });
});
check('remote starting or failed: the Wi-Fi link stays, with the remote status beside it', () => {
  const s = L.lanPublicView(room(remoteRow({ RemoteStatus: 'off' })), NOW);
  assert.strictEqual(s.remote, 'starting');
  assert.strictEqual(s.open, 'http://192.168.1.20:4900/board?x=1&k=KEYkeyKEYkeyKEYkey1234#top');
  const f = L.lanPublicView(room(remoteRow({ RemoteStatus: 'failed' })), NOW);
  assert.strictEqual(f.remote, 'failed');
  assert.ok(f.open);
});
check('remote not wanted: exactly today\'s view, no remote field', () => {
  const v = L.lanPublicView(room(remoteRow({ RemoteWanted: false })), NOW);
  assert.deepStrictEqual(v, { open: 'http://192.168.1.20:4900/board?x=1&k=KEYkeyKEYkeyKEYkey1234#top' });
});
check('remote live while the Wi-Fi share is not live: still the remote route', () => {
  const v = L.lanPublicView(room(remoteRow({ Status: 'failed' })), NOW);
  assert.strictEqual(v.remote, 'live');
  assert.strictEqual(v.open, undefined);
});
check('nothing shown by Claude yet: remote path is the root', () => {
  const v = L.lanPublicView({ lan: remoteRow(), logs: [], asks: [], state: null }, NOW);
  assert.strictEqual(v.remotePath, '/');
});
check('no status of the remote share ever puts the address or a key in the remote fields', () => {
  for (const RemoteStatus of ['live', 'failed', 'off']) {
    for (const Status of ['live', 'failed', 'off']) {
      const v = L.lanPublicView(room(remoteRow({ RemoteStatus, Status })), NOW) || {};
      const { open, ...rest } = v;
      assert.ok(!leaks(rest), `${RemoteStatus}/${Status}: ${JSON.stringify(v)}`);
      if (open) assert.ok(!/trycloudflare/.test(open));
    }
  }
});
check('remoteLink: origin, the path asked for, and the key; empty unless live', () => {
  assert.strictEqual(L.remoteLink(remoteRow(), '/board?x=1#top', 'KEY123', NOW), `${ADDRESS}/board?x=1&k=KEY123#top`);
  assert.strictEqual(L.remoteLink(remoteRow({ RemoteStatus: 'failed' }), '/', 'KEY123', NOW), '');
});

console.log('\nremote share: one tunnel, aimed at the demo (Share demo S3)');
check('the demo Claude marked wins over a newer link, for both the address and the path', () => {
  const r = { lan: remoteRow(), asks: [], state: null, logs: [
    { By: 'agent', Link: 'http://localhost:5173/demo/index.html', Role: 'demo' },
    { By: 'agent', Link: 'http://localhost:6006/mockups/a.html', Role: 'mockup' },
  ] };
  assert.strictEqual(L.remoteTarget(r), 'http://localhost:5173');
  assert.strictEqual(L.remotePath(r), '/demo/index.html');
});
check('nothing marked: the newest link Claude showed', () => {
  const r = { lan: remoteRow(), asks: [], state: null, logs: [
    { By: 'agent', Link: 'http://localhost:5173/old' }, { By: 'agent', Link: 'http://localhost:6006/new?x=1' },
  ] };
  assert.strictEqual(L.remoteTarget(r), 'http://localhost:6006');
  assert.strictEqual(L.remotePath(r), '/new?x=1');
});
check('the remote target is always one of the Wi-Fi targets, or nothing', () => {
  const r = { lan: remoteRow(), asks: [], state: null, logs: [{ By: 'agent', Link: 'https://example.com/' }] };
  assert.strictEqual(L.remoteTarget(r), '');
  assert.strictEqual(L.remotePath(r), '/');
});

console.log('\nremote share: the host\'s view');
check('remote live: who opened it, most devices first, then by name', () => {
  const v = L.lanHostView(remoteRow({ RemoteDevices: { Jordan: 1, Sam: 2, Priya: 1 } }), NOW, { withKey: true });
  assert.deepStrictEqual(v.remote, {
    wanted: true, status: 'live', error: '',
    people: [{ name: 'Sam', devices: 2 }, { name: 'Jordan', devices: 1 }, { name: 'Priya', devices: 1 }],
  });
});
check('remote failed: the reason; no people', () => {
  const v = L.lanHostView(remoteRow({ RemoteStatus: 'failed', RemoteError: 'Cloudflare said no' }), NOW, {});
  assert.deepStrictEqual(v.remote, { wanted: true, status: 'failed', error: 'Cloudflare said no', people: [] });
});
check('a plugin too old to share remotely: failed, with what to do', () => {
  const v = L.lanHostView(remoteRow({ RemoteSupported: false, RemoteStatus: 'off' }), NOW, {});
  assert.strictEqual(v.remote.status, 'failed');
  assert.match(v.remote.error, /Update/);
});
check('the host view never carries the tunnel\'s address', () => {
  assert.ok(!/trycloudflare/.test(JSON.stringify(L.lanHostView(remoteRow(), NOW, { withKey: true }))));
});
check('remote not wanted: the host view says so and lists nobody', () => {
  const v = L.lanHostView(remoteRow({ RemoteWanted: false }), NOW, {});
  assert.deepStrictEqual(v.remote, { wanted: false, status: 'off', error: '', people: [] });
});

console.log(`\n${pass} passed, ${failed} failed`);
suiteFinished();
process.exit(failed ? 1 : 0);
