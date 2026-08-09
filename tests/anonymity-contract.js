/**
 * The redaction gate.
 *
 * Every anonymity decision in the product routes through isHidden(). It is
 * deliberately a pure function over the two records that decide it, so it can
 * be tested without AWS and so there is exactly one place to read when asking
 * "why did this round show names".
 *
 * The copy-drift guard at the end is not ceremony. Lambda CodeUri is
 * per-directory and there are no layers, so this file exists twice; a gate that
 * says "hidden" in one directory and "visible" in the other is a leak that no
 * single-file test can see.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const GAME_COPY = path.join(REPO, 'lambda-functions/game/anonymity.js');
const WS_COPY = path.join(REPO, 'lambda-functions/websocket/anonymity.js');

const { isHidden, redactAnswer, redactAnswers, ANON_FIELDS } = require(GAME_COPY);

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const on = { HostPreferences: { anonymousUntilReveal: true } };
const off = { HostPreferences: { anonymousUntilReveal: false } };
const bare = {};

(async () => {

console.log('\n1. the gate');

// Default ON is the owner's explicit requirement, and it must survive every
// shape of missing data — a game created before this feature existed has no
// HostPreferences at all and must still be anonymous.
await check('absent preferences default to hidden', () =>
  assert.strictEqual(isHidden(bare, {}), true));
await check('absent metadata entirely defaults to hidden', () =>
  assert.strictEqual(isHidden(undefined, undefined), true));
await check('explicitly on is hidden', () =>
  assert.strictEqual(isHidden(on, {}), true));
await check('explicitly off is never hidden', () =>
  assert.strictEqual(isHidden(off, {}), false));
await check('off stays off even before reveal', () =>
  assert.strictEqual(isHidden(off, { AuthorsRevealed: false }), false));

console.log('\n2. reveal ends it, per round');

await check('revealed round is not hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: true }), false));
await check('an unrevealed round is still hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: false }), true));
// Per-round, not per-game: revealing round 3 must not unmask round 4.
await check('reveal on another round does not leak into this one', () =>
  assert.strictEqual(isHidden(on, {}), true));

console.log('\n3. redaction omits, never nulls');

const row = {
  playerId: 'Ada', playerName: 'Ada', name: 'Ada',
  answer: 'a splendid answer', answerType: 'text', submittedAt: '2026-01-01T00:00:00.000Z'
};

await check('all three attribution fields are absent, not null', () => {
  const out = redactAnswer(row);
  for (const f of ANON_FIELDS) {
    assert.ok(!(f in out), `'${f}' is still present as ${JSON.stringify(out[f])}`);
  }
});
await check('the answer itself survives', () =>
  assert.strictEqual(redactAnswer(row).answer, 'a splendid answer'));
await check('non-attribution fields survive', () => {
  const out = redactAnswer(row);
  assert.strictEqual(out.answerType, 'text');
  assert.strictEqual(out.submittedAt, '2026-01-01T00:00:00.000Z');
});
await check('the input is not mutated', () => {
  const input = { ...row };
  redactAnswer(input);
  assert.strictEqual(input.playerName, 'Ada', 'redactAnswer mutated its argument');
});

console.log('\n4. order is preserved — the ballot runs on it');

// get-results tallies vote index -> answers[index]. Any reorder or filter here
// lands votes on the wrong answers, silently.
const many = ['Ada', 'Grace', 'Alan', 'Barbara'].map((n, i) => ({
  playerName: n, name: n, playerId: n, answer: `answer ${i}`
}));

await check('length is unchanged', () =>
  assert.strictEqual(redactAnswers(many).length, 4));
await check('order is unchanged', () =>
  assert.deepStrictEqual(redactAnswers(many).map(a => a.answer),
    ['answer 0', 'answer 1', 'answer 2', 'answer 3']));
await check('an empty round redacts to an empty array', () =>
  assert.deepStrictEqual(redactAnswers([]), []));
await check('a non-array is treated as empty rather than thrown', () =>
  assert.deepStrictEqual(redactAnswers(undefined), []));

console.log('\n5. the two copies have not drifted');

await check('game/anonymity.js and websocket/anonymity.js are byte-identical', () => {
  const a = fs.readFileSync(GAME_COPY, 'utf8');
  const b = fs.readFileSync(WS_COPY, 'utf8');
  assert.strictEqual(a, b,
    'the copies have diverged — a gate that disagrees with itself across two ' +
    'Lambda directories is a leak no single-file test can see');
});

console.log('\n6. the setup flag survives a create round-trip');

// Stubs must be installed before the handler loads. Same shape as
// tests/vote-state-broadcast.js.
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  }
};

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: createGameHandler } =
  require(path.join(REPO, 'lambda-functions/websocket/create-game.js'));

const metadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));

async function createWith(body) {
  store.clear();
  const res = await createGameHandler({ body: JSON.stringify(body) });
  const gameId = JSON.parse(res.body).gameId;
  return metadataOf(gameId);
}

// This is the exact failure mode create-game.js documents: triviaTimer was sent
// by the frontend for months and silently discarded because one of the three
// edits was missed. Assert on the PERSISTED item, not the response.
await check('omitting the flag persists anonymous ON', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer' });
  assert.ok(md, 'no METADATA item was written at all');
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
await check('explicit false persists as false', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: false });
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, false);
});
await check('explicit true persists as true', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: true });
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
await check('the existing shuffle preference is not disturbed', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', randomizeQuestions: false });
  assert.strictEqual(md.HostPreferences?.randomizeQuestions, false);
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
await check('the persisted flag drives the gate', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: false });
  assert.strictEqual(isHidden(md, {}), false);
});

console.log('\n7. the gate binds only formats that hold a vote');

const trivia = { GameType: 'trivia', HostPreferences: { anonymousUntilReveal: true } };
const wavelength = { GameType: 'wavelength', HostPreferences: { anonymousUntilReveal: true } };
const callAndAnswer = { GameType: 'call-and-answer', HostPreferences: { anonymousUntilReveal: true } };

// Trivia's response is a letter — there is nothing authored to attribute, and
// redacting it breaks the host's view of who answered what. Wavelength never
// attributes on the stage. Neither format is ever offered the option, so
// neither may be caught by a flag that defaults ON.
await check('trivia is never hidden, even with the flag explicitly on', () =>
  assert.strictEqual(isHidden(trivia, {}), false));
await check('wavelength is never hidden, even with the flag explicitly on', () =>
  assert.strictEqual(isHidden(wavelength, {}), false));
await check('a voting format with the flag on is still hidden', () =>
  assert.strictEqual(isHidden(callAndAnswer, {}), true));

// THE CASE THIS TASK EXISTS FOR. Every game created before this feature has no
// HostPreferences at all, so the default-ON rule caught legacy trivia and
// wavelength games and silently redacted them.
await check('a legacy trivia game with no HostPreferences is not hidden', () =>
  assert.strictEqual(isHidden({ GameType: 'trivia' }, undefined), false));
await check('a legacy call-and-answer game with no HostPreferences is hidden', () =>
  assert.strictEqual(isHidden({ GameType: 'call-and-answer' }, undefined), true));
await check('an absent GameType still defaults to the voting behaviour', () =>
  assert.strictEqual(isHidden(bare, {}), true));

// Legacy spellings are stored in this table. `quiz` is trivia; a row written
// under the old spelling must not be redacted either.
await check('the legacy spelling "quiz" is treated as trivia', () =>
  assert.strictEqual(isHidden({ GameType: 'quiz' }, {}), false));

// Drift guard, in the spirit of the byte-identical one above. anonymity.js
// cannot require game-types.js — that module lives only in lambda-functions/game/
// and anonymity.js must stay byte-identical across both Lambda directories — so
// the set is inlined there. This asserts the inlined copy still agrees with the
// canonical vocabulary for every spelling the table can hold.
const { GAME_TYPE_IDS, ALIASES, normalizeGameType } =
  require(path.join(REPO, 'lambda-functions/game/game-types.js'));

await check('the inlined skip-set agrees with game-types.js for every spelling', () => {
  const SKIPS_VOTE = new Set(['trivia', 'wavelength']);
  for (const spelling of [...GAME_TYPE_IDS, ...Object.keys(ALIASES)]) {
    const expectedHidden = !SKIPS_VOTE.has(normalizeGameType(spelling));
    assert.strictEqual(
      isHidden({ GameType: spelling, HostPreferences: { anonymousUntilReveal: true } }, {}),
      expectedHidden,
      `'${spelling}' normalises to '${normalizeGameType(spelling)}' but the gate disagreed`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
