/**
 * AN ATTENDEE'S TOKEN AND ROW — lambda-functions/websocket/events/
 * attendee-store.js and agenda-rules.checkAttendeeName (events M2).
 *
 * The controller's ruling: an OPAQUE random bearer token of at least 128 bits,
 * base64url; only its SHA-256 on the attendee row; no new secret, key or
 * resource; the row carries the event's ttl, and an unknown or expired token
 * is "not joined". The name is personal data, so it is sealed.
 *
 * rejects: a token short of 128 random bits, or one that is not base64url; the
 * token itself stored anywhere; two mints alike; a token opening a row it was
 * not minted for — another attendee's, another event's, another
 * organisation's; a token accepted after its row's ttl; a compare that is not
 * constant-time; the name in the clear at rest; a name that is blank, padded
 * or longer than 80 characters; the rule module growing a require.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { installEventHarness } = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const A = h.load('lambda-functions/websocket/events/attendee-store.js');
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NOW = Math.floor(Date.now() / 1000);
const META = { PK: 'EVENT#1124', SK: 'METADATA', orgId: 'org_nw', ttl: NOW + 90 * 86400 };

(async () => {
  table.clear();

  console.log('\n1. the token');
  const first = A.mintToken();
  await check('it is <attendeeId>.<secret>: at_ and 16 hex digits, a dot, 43 base64url characters', () => {
    assert.match(first.token, /^at_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    assert.ok(first.token.startsWith(`${first.attendeeId}.`));
  });
  await check('the secret is 32 random bytes — 256 bits, over the 128 the ruling asks for', () => {
    const secret = first.token.split('.')[1];
    assert.strictEqual(Buffer.from(secret, 'base64url').length, 32);
  });
  await check('no two mints are alike, in the id or the secret', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const t = A.mintToken();
      assert.ok(!seen.has(t.token) && !seen.has(t.attendeeId));
      seen.add(t.token); seen.add(t.attendeeId);
    }
  });
  await check('what is kept is the SHA-256 of the whole token, base64url', () => {
    const want = require('crypto').createHash('sha256').update(first.token).digest('base64url');
    assert.strictEqual(first.tokenHash, want);
    assert.strictEqual(A.hashToken(first.token), want);
  });
  await check('a token parses to its id; anything else parses to nothing', () => {
    assert.deepStrictEqual(A.parseToken(first.token), { attendeeId: first.attendeeId });
    for (const bad of ['', null, undefined, 'at_12.x', `${first.attendeeId}.short`, `${first.token}x`,
      first.token.replace('.', ':'), `AT_${first.token.slice(3)}`, ` ${first.token}`]) {
      assert.strictEqual(A.parseToken(bad), null, JSON.stringify(bad));
    }
  });
  await check('the match is constant-time and refuses a missing hash', () => {
    assert.strictEqual(A.tokenMatches(first.token, first.tokenHash), true);
    assert.strictEqual(A.tokenMatches(`${first.attendeeId}.${'A'.repeat(43)}`, first.tokenHash), false);
    assert.strictEqual(A.tokenMatches(first.token, ''), false);
    assert.strictEqual(A.tokenMatches(first.token, undefined), false);
    const code = fs.readFileSync(path.join(h.REPO, 'lambda-functions/websocket/events/attendee-store.js'), 'utf8');
    assert.match(code, /crypto\.timingSafeEqual\(/);
  });
  await check('the bearer token is read from Authorization, either spelling, and nothing else', () => {
    assert.strictEqual(A.bearerOf({ headers: { authorization: `Bearer ${first.token}` } }), first.token);
    assert.strictEqual(A.bearerOf({ headers: { Authorization: `bearer ${first.token}` } }), first.token);
    for (const request of [{}, { headers: {} }, { headers: { authorization: first.token } }, { headers: { authorization: 'Bearer ' } }]) {
      assert.strictEqual(A.bearerOf(request), '');
    }
  });

  console.log('\n2. the row');
  const joined = await A.putAttendee(table.doc, 'test-table', { code: '1124', meta: META, name: 'Priya Raman' });
  const stored = table.get('EVENT#1124', `ATTENDEE#${joined.attendeeId}`);
  await check('it lives under the event, keyed by the attendee id', () => {
    assert.ok(stored, 'no ATTENDEE# row under EVENT#1124');
    assert.match(joined.attendeeId, /^at_[0-9a-f]{16}$/);
  });
  await check('it holds the sealed name, the hash, when, the org and the event\'s ttl — never the token', () => {
    assert.deepStrictEqual(Object.keys(stored).sort(), ['AttendeeName', 'JoinedAt', 'PK', 'SK', 'TokenHash', 'orgId', 'ttl']);
    assert.ok(isEnvelope(stored.AttendeeName), 'the name is not sealed');
    assert.strictEqual(stored.TokenHash, A.hashToken(joined.token));
    assert.strictEqual(stored.orgId, 'org_nw');
    assert.strictEqual(stored.ttl, META.ttl);
    assert.ok(!JSON.stringify(stored).includes(joined.token.split('.')[1]), 'the secret is in the row');
    assert.ok(!JSON.stringify(stored).includes('Priya'), 'the name is in the clear');
  });
  await check('a key that is taken draws a fresh id rather than overwriting', async () => {
    const taken = table.inject((c) => c.type === 'put',
      () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }), 1);
    const again = await A.putAttendee(table.doc, 'test-table', { code: '1124', meta: META, name: 'Second' });
    assert.strictEqual(taken.thrown, 1);
    assert.ok(table.get('EVENT#1124', `ATTENDEE#${again.attendeeId}`), 'the second draw was not written');
    assert.strictEqual(table.get('EVENT#1124', `ATTENDEE#${joined.attendeeId}`).TokenHash, stored.TokenHash);
  });

  console.log('\n3. opening a row with a token');
  const open = (token, meta = META, nowSeconds = NOW) => A.openAttendee(table.doc, 'test-table', { code: '1124', meta, token, nowSeconds });
  await check('the right token opens its own row, decrypted', async () => {
    const row = await open(joined.token);
    assert.deepStrictEqual(A.projectAttendee(row), { name: 'Priya Raman', joinedAt: stored.JoinedAt });
  });
  await check('another attendee\'s id with this secret, or this id with another secret: nothing', async () => {
    const other = A.mintToken();
    assert.strictEqual(await open(`${other.attendeeId}.${joined.token.split('.')[1]}`), null);
    assert.strictEqual(await open(`${joined.attendeeId}.${other.token.split('.')[1]}`), null);
  });
  await check('this token presented to another event: nothing', async () => {
    const got = await A.openAttendee(table.doc, 'test-table', {
      code: '5307', meta: { ...META, PK: 'EVENT#5307' }, token: joined.token, nowSeconds: NOW,
    });
    assert.strictEqual(got, null);
  });
  await check('a row that names another organisation: nothing', async () => {
    assert.strictEqual(await open(joined.token, { ...META, orgId: 'org_md' }), null);
  });
  await check('expiry: refused at and after the row\'s ttl, even while the row is still in the table', async () => {
    assert.ok(await open(joined.token, META, META.ttl - 1));
    assert.strictEqual(await open(joined.token, META, META.ttl), null);
    assert.strictEqual(await open(joined.token, META, META.ttl + 3600), null);
    assert.ok(table.get('EVENT#1124', `ATTENDEE#${joined.attendeeId}`), 'the test needs the row still present');
  });
  await check('a row with no ttl is expired, never immortal', async () => {
    const key = table.keyOf('EVENT#1124', `ATTENDEE#${joined.attendeeId}`);
    const row = table.store.get(key);
    try {
      table.store.set(key, { ...row, ttl: undefined });
      assert.strictEqual(await open(joined.token), null);
    } finally { table.store.set(key, row); }
  });
  await check('a malformed token never reaches the table', async () => {
    const logFrom = table.log.length;
    assert.strictEqual(await open('not-a-token'), null);
    assert.strictEqual(table.log.slice(logFrom).filter((e) => e.type === 'get').length, 0);
  });

  console.log('\n4. the name');
  await check('trimmed, as a session\'s name is', () => {
    assert.deepStrictEqual(rules.checkAttendeeName('  Priya Raman  '), { value: 'Priya Raman' });
  });
  for (const blank of ['', '   ', null, undefined, 42, {}]) {
    await check(`${JSON.stringify(blank)} is refused in plain words`, () =>
      assert.deepStrictEqual(rules.checkAttendeeName(blank), { error: 'Type your name.' }));
  }
  await check('80 characters is a name; 81 is refused with the cap in the sentence', () => {
    assert.deepStrictEqual(rules.checkAttendeeName('x'.repeat(80)), { value: 'x'.repeat(80) });
    assert.deepStrictEqual(rules.checkAttendeeName('x'.repeat(81)), { error: 'A name can be 80 characters at most.' });
    assert.strictEqual(rules.ATTENDEE_NAME_MAX, rules.LED_BY_MAX);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
