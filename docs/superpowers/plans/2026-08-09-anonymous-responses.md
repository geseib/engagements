# Anonymous Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Until the host reveals them, nobody — not the room, not the host — learns which participant wrote which answer, so the room votes on ideas rather than on people.

**Architecture:** A pure redaction over the existing positional ballot. The vote already identifies answers by array index (`Votes: {"0": 1, "1": 2}`), so no key change, no data migration and no new identifier are required. A single gate — `hidden = anonymousUntilReveal && !AuthorsRevealed` — decides whether four payloads and one WebSocket frame carry attribution. A new idempotent `POST /games/{id}/reveal-authors` flips per-round state and joins the names back on.

**Tech Stack:** Node.js 20 Lambda (CommonJS), DynamoDB single-table via `@aws-sdk/lib-dynamodb`, SAM (`template-clean.yaml`), React 18 frontend, plain-node test harness (`tests/*.js`, no framework).

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` §5.6. Every task's requirements implicitly include this section.

- **Omit, do not null.** A redacted field is *absent* from the payload, never `null`. A client that forgets to handle anonymity then renders nothing rather than the string "null", and the redaction is visible in a payload diff.
- **Answer order is never changed by redaction.** Order is what the ballot runs on (§5.6.5a). Redact fields; never sort, filter or reindex.
- **Reveal state is per round, not per game:** `Round.AuthorsRevealed` (boolean, default false). A host may reveal round 3 and end the session before round 4.
- **Voting closing reveals the round.** *(Owner decision, 2026-08-09, amending Tasks 8 and 10.)* The promise this feature makes is the one already written into the room-facing sentence below — *until voting closes*, not "until the host presses a button". So `AuthorsRevealed` flips automatically when the round enters `RESULTS#nnn`, which is the moment voting closes. From that point names are attributed everywhere: results, Field Notes, standings, the report and the archive export. The report attributes **every** round; there is no unattributed-forever case, because Workie and the host need to see who contributed what. `POST /reveal-authors` survives as a manual override for a host who wants names back *before* closing the vote; it is no longer the only path. The host's on-stage reveal becomes a **display** step over data that already carries names — which is why `‹ Hide again` was always described as display-only and never as a security control.
- **The gate applies only to formats that hold a vote.** Anonymity is meaningless for trivia (the response is a letter) and wavelength (never attributed on stage), and `hostRunsVotePhase()` already computes exactly that set. Because the flag defaults ON for any game with no recorded preference, a format check inside `isHidden` is what stops every pre-existing trivia and wavelength game from being silently redacted.
- **The host is inside "nobody".** `role` is a client-supplied query parameter (`get-answers.js:11`), so any payload emitted to a caller claiming `role=host` is emitted to anyone. There is no host-only branch anywhere in this feature.
- **Default ON.** `anonymousUntilReveal: anonymousUntilReveal !== false`.
- **Applies only to formats that hold a vote** — call-and-answer, poll, survey. `hostRunsVotePhase()` in `src/src/config/hostControls.js` already computes exactly this set. Trivia and wavelength hide the option entirely rather than showing it disabled.
- **The vote itself is not anonymised.** `playerVoted` keeps its `playerName`. This feature is about who *wrote* an answer, not who voted for it.
- **Never overclaim.** User-facing copy is *"This hides names, not identities."* Never describe this as anonymity in the cryptographic sense.
- **Room-facing sentence, exact wording:** *"Nobody sees who wrote what — the host included — until voting closes."*
- **Do not deploy.** `CLAUDE.md` carries a critical rule: the user performs all deployments. Never run a deploy script, never push to `test` or `prod`.
- **Out of scope, do not bundle:** Risk R1 (stable `answerId`, §5.6.5a) and Risk R2 (`reopen-round`, §5.3). Both are recorded independently and must not block or be blocked by this work.

## Baselines — verify before claiming a regression

| Suite | Command | Expected at start |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | 635 passed, 0 failed, 18 suites |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / 242 passed |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |

The 5 failing frontend suites are stale and out of scope — they predate the auth system (`useAuth must be used within an AuthProvider`) and call `new WebSocketClient()` on a singleton export. Do not "fix" them.

Aggregate backend counts with `grep -E '^[0-9]+ passed'`, **not** `tail -1` — some suites print a trailing line and `tail -1` silently drops them.

## File Structure

Lambda `CodeUri` is per-directory (`lambda-functions/game/` or `lambda-functions/websocket/`) and there are no Lambda layers and no shared-code build step — `lambda-functions/build.sh` only copies `websocket/*` into `dist/`. A module in one directory **cannot** be required from the other. This is why `broadcastToGame` already exists in four separate copies in this repo.

The redaction gate must therefore exist in both directories. Two byte-identical copies, guarded by a test that fails if they drift.

**Create:**
- `lambda-functions/game/anonymity.js` — the gate and the redactors. Canonical copy.
- `lambda-functions/websocket/anonymity.js` — byte-identical duplicate.
- `lambda-functions/game/reveal-authors.js` — the new endpoint.
- `tests/anonymity-contract.js` — the gate, the redactors, and the copy-drift guard.
- `tests/anonymous-round-flow.js` — end-to-end over the real handlers, stubbed AWS.

**Modify:**
- `lambda-functions/websocket/create-game.js:9` (destructure) and `:17-38` (`createGame` argument)
- `lambda-functions/websocket/schema-compliant-manager.js` — `HostPreferences` on the METADATA item
- `lambda-functions/game/get-answers.js:76-82`
- `lambda-functions/websocket/start-vote.js:73-78`
- `lambda-functions/game/get-results.js:323`, `:414`
- `lambda-functions/websocket/message.js:566-582`
- `lambda-functions/game/get-ai-summary.js:1175-1176`
- `lambda-functions/game/create-report.js:278`, `:317`, `:436`, `:441`
- `template-clean.yaml` — one new function + route
- `src/src/GameHostPage.jsx` — setup toggle, redacted render, reveal action
- `src/src/PlayerPage.jsx` — redacted voting list

---

### Task 1: The redaction gate

The single decision every other task depends on. Pure functions, no AWS, no I/O.

**Files:**
- Create: `lambda-functions/game/anonymity.js`
- Create: `lambda-functions/websocket/anonymity.js` (byte-identical)
- Test: `tests/anonymity-contract.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isHidden(metadata, round)` → `boolean`
  - `redactAnswer(answer)` → new object without `playerId`, `playerName`, `name`
  - `redactAnswers(answers)` → array, **same order, same length**
  - `ANON_FIELDS` → `['playerId', 'playerName', 'name']`

- [ ] **Step 1: Write the failing test**

Create `tests/anonymity-contract.js`:

```js
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
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const on = { HostPreferences: { anonymousUntilReveal: true } };
const off = { HostPreferences: { anonymousUntilReveal: false } };
const bare = {};

console.log('\n1. the gate');

// Default ON is the owner's explicit requirement, and it must survive every
// shape of missing data — a game created before this feature existed has no
// HostPreferences at all and must still be anonymous.
check('absent preferences default to hidden', () =>
  assert.strictEqual(isHidden(bare, {}), true));
check('absent metadata entirely defaults to hidden', () =>
  assert.strictEqual(isHidden(undefined, undefined), true));
check('explicitly on is hidden', () =>
  assert.strictEqual(isHidden(on, {}), true));
check('explicitly off is never hidden', () =>
  assert.strictEqual(isHidden(off, {}), false));
check('off stays off even before reveal', () =>
  assert.strictEqual(isHidden(off, { AuthorsRevealed: false }), false));

console.log('\n2. reveal ends it, per round');

check('revealed round is not hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: true }), false));
check('an unrevealed round is still hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: false }), true));
// Per-round, not per-game: revealing round 3 must not unmask round 4.
check('reveal on another round does not leak into this one', () =>
  assert.strictEqual(isHidden(on, {}), true));

console.log('\n3. redaction omits, never nulls');

const row = {
  playerId: 'Ada', playerName: 'Ada', name: 'Ada',
  answer: 'a splendid answer', answerType: 'text', submittedAt: '2026-01-01T00:00:00.000Z'
};

check('all three attribution fields are absent, not null', () => {
  const out = redactAnswer(row);
  for (const f of ANON_FIELDS) {
    assert.ok(!(f in out), `'${f}' is still present as ${JSON.stringify(out[f])}`);
  }
});
check('the answer itself survives', () =>
  assert.strictEqual(redactAnswer(row).answer, 'a splendid answer'));
check('non-attribution fields survive', () => {
  const out = redactAnswer(row);
  assert.strictEqual(out.answerType, 'text');
  assert.strictEqual(out.submittedAt, '2026-01-01T00:00:00.000Z');
});
check('the input is not mutated', () => {
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

check('length is unchanged', () =>
  assert.strictEqual(redactAnswers(many).length, 4));
check('order is unchanged', () =>
  assert.deepStrictEqual(redactAnswers(many).map(a => a.answer),
    ['answer 0', 'answer 1', 'answer 2', 'answer 3']));
check('an empty round redacts to an empty array', () =>
  assert.deepStrictEqual(redactAnswers([]), []));
check('a non-array is treated as empty rather than thrown', () =>
  assert.deepStrictEqual(redactAnswers(undefined), []));

console.log('\n5. the two copies have not drifted');

check('game/anonymity.js and websocket/anonymity.js are byte-identical', () => {
  const a = fs.readFileSync(GAME_COPY, 'utf8');
  const b = fs.readFileSync(WS_COPY, 'utf8');
  assert.strictEqual(a, b,
    'the copies have diverged — a gate that disagrees with itself across two ' +
    'Lambda directories is a leak no single-file test can see');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymity-contract.js
```

Expected: `Error: Cannot find module '.../lambda-functions/game/anonymity.js'`.

- [ ] **Step 3: Write the module**

Create `lambda-functions/game/anonymity.js`:

```js
/**
 * Whether this round's answers may carry their authors, and how to strip them.
 *
 * WHY THIS IS NOT AN ACCESS-CONTROL CHECK. `role` is a client-supplied query
 * parameter (get-answers.js:11), not derived from auth. A player can ask for
 * role=host. So "show names to the host, hide them from players" is not
 * something this system can enforce, and a guarantee the API cannot keep is a
 * label on a leak. Anonymity here has exactly one meaning: the server does not
 * send the names, to anybody, until the host reveals. There is deliberately no
 * host branch in this file.
 *
 * DEFAULT ON, including for games that predate the feature. A game created
 * before HostPreferences carried this flag has no opinion recorded, and the
 * owner's requirement is that the safe state is the default. So only an
 * explicit `false` turns it off.
 *
 * THIS FILE EXISTS TWICE — lambda-functions/game/ and lambda-functions/websocket/.
 * Lambda CodeUri is per-directory, there are no layers, and build.sh copies no
 * shared code, so cross-directory require() is impossible; broadcastToGame is
 * already duplicated four times for the same reason. tests/anonymity-contract.js
 * asserts the two copies are byte-identical. EDIT BOTH.
 */

/** The three fields that carry authorship in answer payloads. */
const ANON_FIELDS = ['playerId', 'playerName', 'name'];

/**
 * @param {object} metadata the GAME#id / METADATA item
 * @param {object} round    the round record carrying AuthorsRevealed
 * @returns {boolean} true when attribution must be withheld
 */
function isHidden(metadata, round) {
  const prefs = (metadata && metadata.HostPreferences) || {};
  const anonymous = prefs.anonymousUntilReveal !== false; // default ON
  const revealed = !!(round && round.AuthorsRevealed);
  return anonymous && !revealed;
}

/**
 * Strip authorship from one answer row.
 *
 * Omits rather than nulls: a client that forgets to handle anonymity renders
 * nothing instead of the string "null", and the redaction shows up in a payload
 * diff. Returns a new object; callers pass rows they do not own.
 */
function redactAnswer(answer) {
  const out = { ...(answer || {}) };
  for (const field of ANON_FIELDS) delete out[field];
  return out;
}

/**
 * Strip authorship from a list, preserving order and length EXACTLY.
 *
 * The ballot is positional — submit-vote stores {"0": 1, "1": 2} and
 * get-results tallies vote index against answers[index]. Reordering or
 * filtering here would land votes on the wrong answers with no error at all.
 */
function redactAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map(redactAnswer);
}

module.exports = { isHidden, redactAnswer, redactAnswers, ANON_FIELDS };
```

- [ ] **Step 4: Create the second copy**

```bash
cp lambda-functions/game/anonymity.js lambda-functions/websocket/anonymity.js
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node tests/anonymity-contract.js
```

Expected: `18 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/game/anonymity.js lambda-functions/websocket/anonymity.js tests/anonymity-contract.js
git commit -m "feat(anonymity): the redaction gate, in both lambda directories

isHidden() defaults to ON — including for games created before the flag
existed, which have no HostPreferences at all. Only an explicit false
turns it off.

No host branch, deliberately: role is a client-supplied query parameter,
so a payload emitted to a caller claiming role=host is emitted to anyone.

The file exists twice because Lambda CodeUri is per-directory with no
layers and no shared-code build; broadcastToGame is already duplicated
four times for the same reason. The test asserts the copies are
byte-identical so they cannot drift."
```

---

### Task 2: `anonymousUntilReveal` survives a create round-trip

`create-game.js` warns in its own comment that adding a create-payload field takes three edits, and that `triviaTimer` was sent by the frontend for months and silently discarded by missing them. This task exists because that failure is the likely one.

**Files:**
- Modify: `lambda-functions/websocket/create-game.js:9`, and the `createGame({...})` call
- Modify: `lambda-functions/websocket/schema-compliant-manager.js` — METADATA item
- Test: `tests/anonymity-contract.js` (append a section)

**Interfaces:**
- Consumes: `isHidden` from Task 1.
- Produces: `GAME#{id} / METADATA` carries `HostPreferences.anonymousUntilReveal` (boolean).

- [ ] **Step 1: Write the failing test**

Append to `tests/anonymity-contract.js`, immediately before the final `console.log` summary. This runs the **real** `createGame` against a stubbed DynamoDB, because the bug this guards against is a field dropped in transit, which a unit test of either end would miss.

```js
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
check('omitting the flag persists anonymous ON', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer' });
  assert.ok(md, 'no METADATA item was written at all');
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
check('explicit false persists as false', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: false });
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, false);
});
check('explicit true persists as true', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: true });
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
check('the existing shuffle preference is not disturbed', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', randomizeQuestions: false });
  assert.strictEqual(md.HostPreferences?.randomizeQuestions, false);
  assert.strictEqual(md.HostPreferences?.anonymousUntilReveal, true);
});
check('the persisted flag drives the gate', async () => {
  const md = await createWith({ eventTitle: 'T', gameType: 'call-and-answer', anonymousUntilReveal: false });
  assert.strictEqual(isHidden(md, {}), false);
});
```

**Note on the harness:** the existing `check()` is synchronous. Because these assertions are `async`, convert `check` to await its callback and make the whole file's tail an async IIFE, matching `tests/vote-state-broadcast.js`. Change the definition to:

```js
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
```

and `await` every `check(...)` call, wrapping sections 1–6 and the summary in `(async () => { ... })()`.

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymity-contract.js
```

Expected: the five new checks FAIL — `HostPreferences` is `undefined` because nothing writes it.

- [ ] **Step 3: Edit one — destructure the field**

In `lambda-functions/websocket/create-game.js`, line 9, add `anonymousUntilReveal` to the destructure:

```js
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId } = JSON.parse(event.body || '{}');
```

- [ ] **Step 4: Edit two — pass it through `hostPreferences`**

In the same file, in the `createGame(gameId, { ... })` argument, extend `hostPreferences`:

```js
      hostPreferences: {
        randomizeQuestions: randomizeQuestions !== false, // Default to true if not specified
        // Default ON, per the owner: a host who never touches setup still gets
        // an anonymous round. Only an explicit false opts out.
        anonymousUntilReveal: anonymousUntilReveal !== false
      },
```

- [ ] **Step 5: Edit three — persist it on METADATA**

In `lambda-functions/websocket/schema-compliant-manager.js`, in the METADATA `Item`, add immediately after `ScoringConfig`:

```js
        // The host's setup choices. Read by the anonymity gate on every answer
        // payload; `randomizeQuestions` is read at :264 for question selection.
        // This is the third of the three edits create-game.js warns about —
        // destructure, createGame() argument, and here. Miss this one and the
        // field is accepted by the API and silently discarded, which is what
        // happened to triviaTimer.
        HostPreferences: {
          randomizeQuestions: gameData.hostPreferences?.randomizeQuestions !== false,
          anonymousUntilReveal: gameData.hostPreferences?.anonymousUntilReveal !== false
        },
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node tests/anonymity-contract.js
```

Expected: `23 passed, 0 failed`.

- [ ] **Step 7: Run the full backend suite**

```bash
for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```

Expected: 19 suites, 658 passed, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/websocket/create-game.js lambda-functions/websocket/schema-compliant-manager.js tests/anonymity-contract.js
git commit -m "feat(anonymity): persist anonymousUntilReveal, default on

All three edits create-game.js warns about: the destructure, the
createGame() argument, and the METADATA item. Missing any one of them
accepts the field at the API and silently discards it, which is exactly
what happened to triviaTimer for months.

The test asserts on the PERSISTED item rather than the response body,
because a field dropped in transit is invisible from either end alone."
```

---

### Task 3: Redact `GET /games/{id}/answers`

**Files:**
- Modify: `lambda-functions/game/get-answers.js:76-82` and the host/player branches
- Test: `tests/anonymous-round-flow.js` (create)

**Interfaces:**
- Consumes: `isHidden`, `redactAnswers` from Task 1.
- Produces: the answers payload omits `playerName` and `name` while `hidden`.

- [ ] **Step 1: Write the failing test**

Create `tests/anonymous-round-flow.js` with the same stub preamble as `tests/vote-state-broadcast.js` (copy the block from `const path = require('path')` through `process.env.WEBSOCKET_API_ENDPOINT = ...`, plus `seedGame`/`put`/`check` helpers), then:

```js
const { handler: getAnswers } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));

/** A call-and-answer game mid-ASK with two answers in. */
function seedAnonymousRound(gameId, { anonymous = true, revealed = false } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'T',
        HostPreferences: { randomizeQuestions: true, anonymousUntilReveal: anonymous } });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: revealed });
  for (const n of ['Ada', 'Grace']) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${n}`,
          PlayerName: n, Answer: `${n}'s answer`, SubmittedAt: '2026-01-01T00:00:00.000Z' });
  }
}

const askAnswers = (gameId, role) => getAnswers({
  pathParameters: { gameId },
  queryStringParameters: { role, questionId: '001' }
});

console.log('\n1. GET /answers while hidden');

seedAnonymousRound('3001');
const asHost = JSON.parse((await askAnswers('3001', 'host')).body);
const asPlayer = JSON.parse((await askAnswers('3001', 'player')).body);

check('the host payload carries no playerName', () =>
  assert.ok(asHost.answers.every(a => !('playerName' in a)),
    `leaked: ${JSON.stringify(asHost.answers[0])}`));
check('the host payload carries no name', () =>
  assert.ok(asHost.answers.every(a => !('name' in a))));
// role is client-supplied, so "host" is not a trust boundary. Both branches
// must redact identically or the feature is a label on a leak.
check('role=host and role=player return identical attribution', () =>
  assert.deepStrictEqual(
    asHost.answers.map(a => Object.keys(a).sort()),
    asPlayer.answers.map(a => Object.keys(a).sort())));
check('the answers themselves survive, in order', () =>
  assert.deepStrictEqual(asHost.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));
check('the count is unchanged', () =>
  assert.strictEqual(asHost.answerCount, 2));

console.log('\n2. GET /answers once revealed');

seedAnonymousRound('3002', { revealed: true });
const revealed = JSON.parse((await askAnswers('3002', 'host')).body);
check('revealed rounds carry playerName again', () =>
  assert.strictEqual(revealed.answers[0].playerName, 'Ada'));

console.log('\n3. GET /answers with anonymity turned off');

seedAnonymousRound('3003', { anonymous: false });
const plain = JSON.parse((await askAnswers('3003', 'host')).body);
check('opting out carries playerName from the start', () =>
  assert.strictEqual(plain.answers[0].playerName, 'Ada'));

console.log('\n4. a game with no HostPreferences at all');

seedAnonymousRound('3004');
delete store.get(key('GAME#3004', 'METADATA')).HostPreferences;
const legacy = JSON.parse((await askAnswers('3004', 'host')).body);
// Games created before this feature must be anonymous, not accidentally open.
check('a pre-feature game defaults to hidden', () =>
  assert.ok(!('playerName' in legacy.answers[0])));
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymous-round-flow.js
```

Expected: the redaction checks FAIL — `playerName` is present on every row.

- [ ] **Step 3: Implement the redaction**

In `lambda-functions/game/get-answers.js`, add near the top with the other requires:

```js
const { isHidden, redactAnswers } = require('./anonymity');
```

Load the metadata and round record alongside the existing answers query, then redact. Replace the `baseAnswers` construction (currently at `:76-82`) with:

```js
    // Base answer information
    const fullAnswers = answers.map(answer => ({
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      answerType: answer.AnswerType || 'text',
      submittedAt: answer.SubmittedAt
    }));

    // Anonymity is decided here, once, for both role branches below.
    //
    // There is deliberately no host exemption: `role` arrives as a query
    // parameter (see :11), so a payload we would emit to role=host we would
    // emit to anybody who typed it. The only implementable guarantee is that
    // the names are not in the response at all.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${targetQuestionId}` }
      }))
    ]);

    const hidden = isHidden(metaRes.Item, roundRes.Item);
    // Order is preserved by redactAnswers and must stay that way: the ballot is
    // positional and get-results tallies vote index against answers[index].
    const baseAnswers = hidden ? redactAnswers(fullAnswers) : fullAnswers;
```

Ensure `GetCommand` is in the `@aws-sdk/lib-dynamodb` import list at the top of the file; add it if absent.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/anonymous-round-flow.js
```

Expected: all checks in sections 1–4 pass.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/game/get-answers.js tests/anonymous-round-flow.js
git commit -m "feat(anonymity): redact attribution from GET /games/{id}/answers

Both role branches redact identically. role is a client-supplied query
parameter, so a host-only branch would be a label on a leak rather than
a guarantee.

Order is preserved: the ballot is positional and get-results tallies
vote index against answers[index]."
```

---

### Task 4: Redact `POST /games/{id}/start-vote`

The payload that opens the vote — the one that most directly causes the bias this feature exists to remove.

**Files:**
- Modify: `lambda-functions/websocket/start-vote.js:73-78`
- Test: `tests/anonymous-round-flow.js` (append section 5)

**Interfaces:**
- Consumes: `isHidden`, `redactAnswers` from Task 1 (the `websocket/` copy).
- Produces: the start-vote response omits `playerId`, `playerName`, `name` while hidden. `votingStarted` is unchanged — it already carries no attribution.

- [ ] **Step 1: Write the failing test**

Append to `tests/anonymous-round-flow.js`:

```js
const { handler: startVote } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));

console.log('\n5. POST /start-vote while hidden');

seedAnonymousRound('3005');
const voteRes = await startVote({ pathParameters: { gameId: '3005' }, body: JSON.stringify({ questionNumber: 1 }) });
const votePayload = JSON.parse(voteRes.body);

check('start-vote still returns 200', () =>
  assert.strictEqual(voteRes.statusCode, 200));
check('the ballot carries all the answers', () =>
  assert.strictEqual(votePayload.answers.length, 2));
check('no playerId — the label that named the answer', () =>
  assert.ok(votePayload.answers.every(a => !('playerId' in a)),
    `leaked: ${JSON.stringify(votePayload.answers[0])}`));
check('no playerName and no name', () =>
  assert.ok(votePayload.answers.every(a => !('playerName' in a) && !('name' in a))));
check('answer order is untouched — the ballot runs on it', () =>
  assert.deepStrictEqual(votePayload.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));

// Regression guard for the fix in d9e58aae — this must not be lost.
check('votingStarted still carries newState', () =>
  assert.strictEqual(sent[0]?.message?.newState, 'VOTE#001'));
check('votingStarted carries no attribution and never did', () => {
  const frame = sent[0].message;
  assert.ok(!('playerName' in frame) && !('answers' in frame),
    'the broadcast has grown an attribution field');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymous-round-flow.js
```

Expected: the three redaction checks FAIL.

- [ ] **Step 3: Implement**

In `lambda-functions/websocket/start-vote.js`, add to the requires:

```js
const { isHidden, redactAnswers } = require('./anonymity');
```

After the answers query and before the return, load metadata and the round, then redact the mapped rows:

```js
    // Anonymity gate. The answers travel over HTTP, which is where the
    // redaction belongs — the votingStarted broadcast below carries no
    // attribution and never has.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionNumber}` }
      }))
    ]);
    const hidden = isHidden(metaRes.Item, roundRes.Item);

    const ballot = answers.map(answer => ({
      playerId: answer.PlayerName,
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      submittedAt: answer.SubmittedAt
    }));
```

Add `GetCommand` to the `@aws-sdk/lib-dynamodb` require, and change the response body's `answers` to:

```js
        answers: hidden ? redactAnswers(ballot) : ballot
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/anonymous-round-flow.js
```

- [ ] **Step 5: Run the full backend suite**

```bash
for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```

Expected: 0 failed. `tests/vote-state-broadcast.js` must still pass — it asserts the `newState` fix from `d9e58aae`.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/websocket/start-vote.js tests/anonymous-round-flow.js
git commit -m "feat(anonymity): redact attribution from the vote ballot

playerId was set from answer.PlayerName, so the ballot's own label named
the author. The identifier the vote actually runs on is the array index,
which carries no attribution, so this is a redaction and nothing more.

votingStarted is unchanged — it already carried no names."
```

---

### Task 5: Redact the `playerAnswered` WebSocket notification

**The leak that would survive a purely HTTP redaction.** `message.js` pushes `{ messageType, gameId, playerName, ...messageData }` to the host connection, and for an `ANSWER#` message `messageData` carries the answer text. Without this task the feature looks anonymous and is not.

**Files:**
- Modify: `lambda-functions/websocket/message.js:566-582`
- Test: `tests/anonymous-round-flow.js` (append section 6)

**Interfaces:**
- Consumes: `isHidden` from Task 1.
- Produces: while hidden, `playerAnswered` carries `gameId`, `questionNumber`, `questionId`, `timestamp` and an `answersReceived` count — no `playerName`, no answer body.

- [ ] **Step 1: Write the failing test**

Append to `tests/anonymous-round-flow.js`:

```js
console.log('\n6. the playerAnswered socket frame');

// This is the leak a purely HTTP redaction would leave behind: the host's
// socket receives a live author-to-answer mapping in real time, before any
// endpoint is called.
const { handler: wsMessage } = require(path.join(REPO, 'lambda-functions/websocket/message.js'));

seedAnonymousRound('3006');
put({ PK: 'GAME#3006', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

await wsMessage({
  requestContext: { connectionId: 'player-conn-1', domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    action: 'message', gameId: '3006', playerName: 'Ada',
    messageType: 'ANSWER#001', messageData: { answer: 'a splendid answer' }
  })
});

const answered = sent.map(s => s.message).find(m => m.type === 'playerAnswered' || m.messageType === 'ANSWER#001');

check('a playerAnswered frame was still sent', () =>
  assert.ok(answered, 'the host was told nothing at all — progress would stall'));
check('the frame names nobody', () =>
  assert.ok(!('playerName' in answered),
    `leaked author over the socket: ${JSON.stringify(answered)}`));
check('the frame carries no answer text', () =>
  assert.ok(!('answer' in answered),
    `leaked answer body over the socket: ${JSON.stringify(answered)}`));
check('the frame still identifies the round', () =>
  assert.strictEqual(String(answered.questionNumber), '001'));

console.log('\n7. playerVoted is NOT anonymised');

seedAnonymousRound('3007');
put({ PK: 'GAME#3007', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];
await wsMessage({
  requestContext: { connectionId: 'player-conn-2', domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    action: 'message', gameId: '3007', playerName: 'Ada',
    messageType: 'VOTE#001', messageData: { votes: { 0: 1 } }
  })
});
const voted = sent.map(s => s.message).find(m => m.type === 'playerVoted');
// §5.6.6: this feature is about who WROTE an answer, not who voted for it.
check('playerVoted keeps its playerName', () =>
  assert.strictEqual(voted?.playerName, 'Ada'));
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymous-round-flow.js
```

Expected: `the frame names nobody` and `the frame carries no answer text` FAIL.

- [ ] **Step 3: Implement**

In `lambda-functions/websocket/message.js`, add to the requires:

```js
const { isHidden } = require('./anonymity');
```

Replace the notification construction at `:566-582`. The current code spreads `messageData` unconditionally into a payload that already carries `playerName`:

```js
    if (hostConnection) {
      // Send specific notification types based on message type
      let notificationType = 'playerMessage';
      let notificationData = {
        messageType,
        gameId,
        playerName,
        timestamp: new Date().toISOString(),
        ...messageData
      };

      if (messageType.startsWith('ANSWER#')) {
        notificationType = 'playerAnswered';
        const questionNumber = messageType.replace('ANSWER#', '');
        notificationData.questionNumber = questionNumber;
        notificationData.questionId = questionNumber; // For backward compatibility

        // ANONYMITY. This frame is the one leak a purely HTTP redaction would
        // leave behind: it hands the host's socket a live author-to-answer
        // mapping the moment an answer lands, before any endpoint is called.
        // Under §5.6.2 the host is inside "nobody", so while hidden we announce
        // only THAT an answer arrived and which round it belongs to.
        //
        // The host still needs the count to know whether it can move on, and
        // the count is not attribution — see §5.6.2's split between "who has
        // not acted" and "who wrote which answer".
        const [metaRes, roundRes] = await Promise.all([
          db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
          })),
          db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `ROUND#${questionNumber}` }
          }))
        ]);

        if (isHidden(metaRes.Item, roundRes.Item)) {
          notificationData = {
            messageType,
            gameId,
            questionNumber,
            questionId: questionNumber,
            timestamp: new Date().toISOString()
          };
        }
      } else if (messageType.startsWith('VOTE#')) {
```

Leave the `VOTE#` branch exactly as it is — `playerVoted` keeps its name by design.

Ensure `GetCommand` is imported from `@aws-sdk/lib-dynamodb` in this file.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node tests/anonymous-round-flow.js
```

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/websocket/message.js tests/anonymous-round-flow.js
git commit -m "fix(anonymity): the playerAnswered socket frame leaked author and answer

message.js pushed { messageType, gameId, playerName, ...messageData } to
the host connection, and for an ANSWER# message messageData carries the
answer text. That is a live author-to-answer mapping delivered in real
time, before any endpoint is called — redacting only the HTTP payloads
would have shipped a feature that looks anonymous and is not.

playerVoted keeps its playerName: this feature is about who wrote an
answer, not who voted for it."
```

---

### Task 6: `POST /games/{id}/reveal-authors`

**Files:**
- Create: `lambda-functions/game/reveal-authors.js`
- Modify: `template-clean.yaml`
- Test: `tests/anonymous-round-flow.js` (append section 8)

**Interfaces:**
- Consumes: `redactAnswers` is *not* used here — this endpoint is the one that un-redacts.
- Produces: sets `ROUND#nnn.AuthorsRevealed = true`, broadcasts `authorsRevealed`, returns the attributed rows. Idempotent.

- [ ] **Step 1: Write the failing test**

Append to `tests/anonymous-round-flow.js`:

```js
console.log('\n8. POST /reveal-authors');

const { handler: revealAuthors } = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js'));

seedAnonymousRound('3008');
put({ PK: 'GAME#3008', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
put({ PK: 'GAME#3008', SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER' });
sent = [];

const rev = await revealAuthors({
  pathParameters: { gameId: '3008' },
  body: JSON.stringify({ questionNumber: 1 })
});
const revBody = JSON.parse(rev.body);

check('responds 200', () =>
  assert.strictEqual(rev.statusCode, 200, rev.body));
check('persists AuthorsRevealed on the round', () =>
  assert.strictEqual(store.get(key('GAME#3008', 'ROUND#001')).AuthorsRevealed, true));
check('returns the rows with attribution joined back on', () =>
  assert.deepStrictEqual(revBody.answers.map(a => a.playerName), ['Ada', 'Grace']));
check('order is still the ballot order', () =>
  assert.deepStrictEqual(revBody.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));
check('announces to every connection, host included', () =>
  assert.deepStrictEqual(sent.map(s => s.connectionId).sort(), ['host-1', 'player-1']));
check('the frame is an authorsRevealed carrying the round', () => {
  const f = sent[0].message;
  assert.strictEqual(f.type, 'authorsRevealed');
  assert.strictEqual(f.gameId, '3008');
  assert.strictEqual(String(f.questionNumber), '001');
});

// A host double-tapping in front of a room must not error.
sent = [];
const again = await revealAuthors({
  pathParameters: { gameId: '3008' }, body: JSON.stringify({ questionNumber: 1 })
});
check('is idempotent — a second reveal still returns 200', () =>
  assert.strictEqual(again.statusCode, 200));
check('is idempotent — still revealed', () =>
  assert.strictEqual(store.get(key('GAME#3008', 'ROUND#001')).AuthorsRevealed, true));

// After reveal, the ordinary answers endpoint carries names again.
const afterReveal = JSON.parse((await askAnswers('3008', 'player')).body);
check('GET /answers now carries attribution', () =>
  assert.strictEqual(afterReveal.answers[0].playerName, 'Ada'));

console.log('\n9. reveal on a round with no answers');

seedAnonymousRound('3009');
for (const n of ['Ada', 'Grace']) store.delete(key('GAME#3009', `QUESTION#001#ANSWER#${n}`));
const empty = await revealAuthors({
  pathParameters: { gameId: '3009' }, body: JSON.stringify({ questionNumber: 1 })
});
check('an empty round still reveals and returns 200', () =>
  assert.strictEqual(empty.statusCode, 200));
check('an empty round returns an empty list', () =>
  assert.deepStrictEqual(JSON.parse(empty.body).answers, []));
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymous-round-flow.js
```

Expected: `Cannot find module '.../reveal-authors.js'`.

- [ ] **Step 3: Write the handler**

Create `lambda-functions/game/reveal-authors.js`:

```js
/**
 * End the anonymity of one round.
 *
 * The reveal is the primary action of RESULTS, not an automatic consequence of
 * arriving there (§5.6.4) — so this is an endpoint the host calls, and the beat
 * order is RESULTS (anonymous) -> RESULTS (revealed) -> What we heard -> Next.
 * A host cannot forget to reveal, because revealing is the only way forward.
 *
 * PER ROUND, NOT PER GAME. A host may reveal round 3 and end the session before
 * round 4, and round 4 must stay anonymous forever in the report.
 *
 * IDEMPOTENT. The host is standing in front of a room; a double-tap must not
 * produce an error, and revealing something already revealed is a no-op that
 * still returns the rows.
 *
 * This does not un-send anything. `‹ Hide again` on the stage is display-only —
 * the payload has already been delivered. Do not describe it as a security
 * control.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const broadcastToGame = async (gameId, message) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' }
    }));
    await Promise.all((res.Items || []).map(async (conn) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: conn.ConnectionId,
          Data: JSON.stringify(message)
        }));
      } catch (err) {
        // A dead projector must not stop the room being told.
        console.error(`❌ reveal broadcast failed for ${conn.ConnectionId}:`, err.message);
      }
    }));
  } catch (err) {
    console.error('❌ reveal broadcast error:', err);
  }
};

exports.handler = async (event) => {
  const { gameId } = event.pathParameters || {};
  const { questionNumber } = JSON.parse(event.body || '{}');

  if (!gameId || questionNumber === undefined || questionNumber === null) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'gameId and questionNumber are required' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  const padded = String(questionNumber).padStart(3, '0');
  const now = new Date().toISOString();

  try {
    // Idempotent by construction: an unconditional SET to true.
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
      UpdateExpression: 'SET #revealed = :true, #updatedAt = :now, #qn = :qn',
      ExpressionAttributeNames: {
        '#revealed': 'AuthorsRevealed', '#updatedAt': 'UpdatedAt', '#qn': 'QuestionNumber'
      },
      ExpressionAttributeValues: { ':true': true, ':now': now, ':qn': padded }
    }));

    const answersRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`, ':sk': `QUESTION#${padded}#ANSWER#`
      }
    }));

    // Same order as the ballot — this is the query the ballot was built from.
    const answers = (answersRes.Items || []).map(a => ({
      playerId: a.PlayerName,
      playerName: a.PlayerName,
      name: a.PlayerName,
      answer: a.Answer,
      submittedAt: a.SubmittedAt
    }));

    await broadcastToGame(gameId, {
      type: 'authorsRevealed',
      gameId,
      questionNumber: padded,
      timestamp: now
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'OK', gameId, questionNumber: padded, answers }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Reveal authors error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reveal authors' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
```

- [ ] **Step 4: Add the route**

In `template-clean.yaml`, immediately after the `StartVoteFunction` block, add:

```yaml
  RevealAuthorsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-reveal-authors'
      CodeUri: lambda-functions/game/
      Handler: reveal-authors.handler
      Events:
        RevealAuthors:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /games/{gameId}/reveal-authors
            Method: post
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        - Statement:
          - Effect: Allow
            Action:
              - execute-api:ManageConnections
            Resource: !Sub 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/*/*'
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 5: Validate the template**

```bash
sam validate --lint -t template-clean.yaml
```

Expected: valid.

- [ ] **Step 6: Run the tests**

```bash
node tests/anonymous-round-flow.js
for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```

Expected: 0 failed.

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/game/reveal-authors.js template-clean.yaml tests/anonymous-round-flow.js
git commit -m "feat(anonymity): POST /games/{id}/reveal-authors

Per round, not per game — a host may reveal round 3 and end the session
before round 4, and round 4 stays anonymous in the report forever.

Idempotent: the host is in front of a room and a double-tap must not
error."
```

---

### Task 7: The Field Notes template must not name an unrevealed author

`get-ai-summary.js:1175-1176` names and quotes the top contributor verbatim, in code, via a deterministic template — not via the model. The beat is ordered after the reveal, but a host may press Next Round without ever revealing.

**Files:**
- Modify: `lambda-functions/game/get-ai-summary.js:1175-1176` and the prompt construction
- Test: `tests/anonymous-round-flow.js` (append section 10)

**Interfaces:**
- Consumes: `isHidden` from Task 1 (the `game/` copy).
- Produces: while hidden, the summary text names nobody and the model prompt is built from redacted rows.

- [ ] **Step 1: Write the failing test**

Append to `tests/anonymous-round-flow.js`:

```js
console.log('\n10. Field Notes on an unrevealed round');

// Not hypothetical and not the model: get-ai-summary builds this string in code.
const { buildFallbackSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

const top = { playerName: 'Ada', answer: 'a splendid answer', score: 5, votes: 3 };

check('while hidden, the summary names nobody', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'What should we stop doing?', hidden: true
  });
  assert.ok(!text.includes('Ada'), `named an unrevealed author: ${text}`);
});
check('while hidden, it still reports the most-supported answer', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'Q', hidden: true
  });
  assert.ok(/most[- ]supported|earned the most support/i.test(text), text);
});
check('once revealed, it names the author as before', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'Q', hidden: false
  });
  assert.ok(text.includes("Ada's answer"), text);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/anonymous-round-flow.js
```

Expected: `buildFallbackSummary is not a function` — it is currently inline.

- [ ] **Step 3: Extract and gate the template**

In `lambda-functions/game/get-ai-summary.js`, extract the block around `:1170-1180` into an exported function, adding the `hidden` branch:

```js
/**
 * The deterministic fallback summary.
 *
 * Exported so the anonymity branch can be tested without invoking Bedrock. This
 * template — not the model — is what named and quoted the top contributor on
 * every single round before anonymity existed.
 *
 * `hidden` must fall back to an unattributed form. The Field Notes beat is
 * ordered after the reveal, so in the normal flow attribution is already
 * public by the time this renders — but a host may press Next Round without
 * ever revealing, and the promise made to the room has to survive that.
 */
function buildFallbackSummary({ totalParticipants, votesCast, top, gameType, question, hidden }) {
  const isTrivia = gameType === 'trivia';
  const qText = typeof question === 'string' ? question
    : (question && (question.title || question.Title || question.questionDetail || question.Detail)) || '';
  const parts = [`${totalParticipants} ${totalParticipants === 1 ? 'response was' : 'responses were'} submitted${qText ? ` on "${qText}"` : ''}.`];
  if (votesCast > 0) parts.push(`${votesCast} vote${votesCast === 1 ? '' : 's'} cast.`);

  if (top && top.answer) {
    const support = `earned the most support (${top.score} point${top.score === 1 ? '' : 's'}${top.votes ? `: ${top.votes}` : ''})`;
    if (hidden) {
      // No name, and no verbatim quote either — on a small round a distinctive
      // phrase identifies its author as surely as the name would.
      parts.push(`The most-supported response ${support}.`);
    } else if (top.playerName) {
      parts.push(`${top.playerName}'s answer${isTrivia ? '' : `, "${top.answer}",`} ${support}.`);
    }
  } else if (totalParticipants > 0) {
    parts.push('The group shared a range of perspectives.');
  }
  return parts.join(' ');
}

module.exports.buildFallbackSummary = buildFallbackSummary;
```

Replace the original inline block with a call to it, passing `hidden` computed from `isHidden(metadata, round)`. Add the require:

```js
const { isHidden, redactAnswers } = require('./anonymity');
```

Then, where the model prompt is assembled from the answer rows, pass redacted rows while hidden so the model cannot attribute either:

```js
    // The model must not be given what the template is not allowed to print.
    const promptAnswers = hidden ? redactAnswers(answerRows) : answerRows;
```

- [ ] **Step 4: Run the tests**

```bash
node tests/anonymous-round-flow.js
for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```

Expected: 0 failed. `tests/ai-response-parsing.js` and `tests/ai-prompt-resolution.js` must still pass.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/game/get-ai-summary.js tests/anonymous-round-flow.js
git commit -m "fix(anonymity): Field Notes named the top author from a code template

Not the model — get-ai-summary built the string itself and named and
quoted the top contributor verbatim on every round. While hidden it now
falls back to an unattributed form, and the model prompt is built from
redacted rows so the model cannot attribute either.

The beat is ordered after the reveal, but a host may press Next Round
without ever revealing and the promise has to survive that."
```

---

### Task 8: Voting closing reveals the round, and the gate only binds voting formats

> **Rewritten 2026-08-09 by owner decision.** The original Task 8 made the report
> withhold attribution for any round the host never revealed. That is no longer the
> rule. The promise is *until voting closes* — the exact words already in the
> room-facing sentence — so closing the vote discharges it, and the report attributes
> every round. Two defects surface at the same time and belong here because they are
> the same decision: the gate currently fires for trivia and wavelength, which never
> opted into anonymity, and nothing flips `AuthorsRevealed` on its own.

Two changes, one test section.

**A. `isHidden` must only bind formats that hold a vote.** The flag defaults ON for any
game with no recorded preference, and every game created before this feature has no
`HostPreferences` at all — so today a legacy **trivia** game has its answers redacted
during ASK, which breaks the host's view of who answered what, and a legacy
**wavelength** game is redacted for a format that never attributes on stage anyway.
`hostRunsVotePhase()` in `src/src/config/hostControls.js` already computes the set
(`trivia` and `wavelength` skip the vote); `isHidden` must agree with it.

**B. Entering `RESULTS#nnn` sets `AuthorsRevealed = true`.** `enterResultsState` in
`get-results.js:118` is the single choke point for that transition — its own comment
records that the same update used to be pasted into two branches and missing from two
others, which is exactly why it was consolidated. Flipping the flag there means it
cannot be forgotten on the wavelength or zero-vote exits either.

**Consequences, so nobody re-adds them later:**
- `create-report.js` needs **no** change. The report attributes every round. Do not
  gate it, do not touch those four line numbers.
- `get-results.js` needs **no** response redaction. It *is* the vote-close handler, so
  by the time it assembles a response the round is revealed by definition.
- `POST /reveal-authors` (Task 6) stays exactly as built. It is now a manual override
  for a host who wants names back before closing the vote, not the only path.

**Files:**
- Modify: `lambda-functions/game/anonymity.js` **and** `lambda-functions/websocket/anonymity.js` — must stay byte-identical; edit both, or the drift test in `tests/anonymity-contract.js` fails
- Modify: `lambda-functions/game/get-results.js` — `enterResultsState`
- Test: `tests/anonymity-contract.js` (append a section), `tests/anonymous-round-flow.js` (append a section)

**Interfaces:**
- Consumes: `isHidden` from Task 1; `normalizeGameType` from `lambda-functions/game/game-types.js` (for the agreement test only — see the note in Step 3).
- Produces: `isHidden(metadata, round)` returns `false` for trivia and wavelength regardless of flag or reveal state; `ROUND#nnn.AuthorsRevealed === true` after the round enters `RESULTS#nnn`.

- [ ] **Step 1: Write the failing tests — the format gate**

Append a new section to `tests/anonymity-contract.js`, immediately before the final summary. **Every `check(...)` in this file is async — `await` every call you add.** The existing fixtures (`on`, `off`, `bare`) carry no `GameType`, and must keep behaving exactly as they do today: an absent type normalises to `call-and-answer`, which votes, so those tests stay green.

```js
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
```

- [ ] **Step 2: Write the failing test — voting closing reveals the round**

Append to `tests/anonymous-round-flow.js` as the **next sequential section number**. Read the end of the file first and continue the numbering — do not assume a number; earlier tasks have already appended sections and a collision makes the output unreadable.

Two hazards, both of which have already cost this project time:
- `check` is async. **`await` every call.** A bare call exits before its assertion resolves and vanishes from the pass count with no failure signal.
- `seedAnonymousRound` seeds no `CONNECTION#` rows. `enterResultsState` broadcasts, so `put()` your own connection inside your own section if you assert on `sent` — otherwise the assertion passes vacuously against an empty array. Do not modify the shared helper.

```js
console.log('\nN. voting closing reveals the round');

const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

seedAnonymousRound('3011');
put({ PK: 'GAME#3011', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
put({ PK: 'GAME#3011', SK: 'QUESTION#001#VOTE#Grace', PlayerName: 'Grace', Votes: { 0: 1 } });
put({ PK: 'GAME#3011', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

await getResults({ body: JSON.stringify({ gameId: '3011', questionNumber: 1 }) });

// The promise is "until voting closes", not "until the host presses a button".
// Closing the vote is what discharges it.
await check('entering RESULTS sets AuthorsRevealed on the round', () =>
  assert.strictEqual(store.get(key('GAME#3011', 'ROUND#001')).AuthorsRevealed, true));
await check('the round is no longer hidden once results are in', () =>
  assert.strictEqual(
    isHidden(store.get(key('GAME#3011', 'METADATA')), store.get(key('GAME#3011', 'ROUND#001'))),
    false));

// And the ordinary answers endpoint carries names again, with no host action.
const afterVoteClose = JSON.parse((await askAnswers('3011', 'player')).body);
await check('GET /answers carries attribution once voting has closed', () =>
  assert.strictEqual(afterVoteClose.answers[0].playerName, 'Ada'));

console.log('\nN+1. the round record is written even on the exits that used to skip it');

// enterResultsState's own comment records that the state write used to be
// missing from the wavelength and zero-vote exits. The reveal must not inherit
// that hole: a round with no votes still closes.
seedAnonymousRound('3013');
put({ PK: 'GAME#3013', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
put({ PK: 'GAME#3013', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

await getResults({ body: JSON.stringify({ gameId: '3013', questionNumber: 1 }) });

await check('a round that closed with zero votes is still revealed', () =>
  assert.strictEqual(store.get(key('GAME#3013', 'ROUND#001'))?.AuthorsRevealed, true));
```

- [ ] **Step 3: Run them and watch them fail**

```bash
node tests/anonymity-contract.js
node tests/anonymous-round-flow.js
```

Expected: the format-gate checks fail (trivia and wavelength are currently hidden), and the reveal checks fail (`AuthorsRevealed` is `undefined` because nothing writes it).

**Verify the failures are real.** A test that cannot fail proves nothing — this plan has already shipped one vacuous assertion. If a new check passes before you have written any implementation, find out why before continuing.

- [ ] **Step 4: Add the format gate to `isHidden` — in BOTH copies**

In `lambda-functions/game/anonymity.js`, add the skip-set and extend `isHidden`. Then `cp` it over `lambda-functions/websocket/anonymity.js`; the two must stay byte-identical or `tests/anonymity-contract.js` fails.

```js
/**
 * Formats whose round never opens a vote.
 *
 * INLINED ON PURPOSE. The canonical vocabulary lives in game-types.js, and the
 * host's runtime answer lives in src/src/config/hostControls.js
 * (`hostRunsVotePhase`) — but this file must stay byte-identical across
 * lambda-functions/game/ and lambda-functions/websocket/, and game-types.js
 * exists only in the former. A require() that resolves in one bundle and not
 * the other is worse than a duplicated four-element set.
 * tests/anonymity-contract.js asserts this set still agrees with game-types.js
 * for every spelling the table can hold, aliases included.
 */
const TYPES_THAT_SKIP_VOTE = new Set(['trivia', 'wavelength', 'quiz']);

function skipsVote(gameType) {
  return TYPES_THAT_SKIP_VOTE.has(String(gameType || '').trim().toLowerCase());
}
```

and in `isHidden`, before the flag is read:

```js
  // Anonymity binds only the formats that hold a vote. Trivia's response is a
  // letter, so there is nothing authored to attribute — and redacting it breaks
  // the host's view of who answered what. Wavelength never attributes on stage.
  //
  // This check is not cosmetic. The flag defaults ON, and every game created
  // before this feature has no HostPreferences at all, so without it every
  // legacy trivia and wavelength game is silently redacted.
  if (skipsVote(metadata && metadata.GameType)) return false;
```

- [ ] **Step 5: Reveal the round when it enters RESULTS**

In `lambda-functions/game/get-results.js`, inside `enterResultsState` (`:118`), write `AuthorsRevealed` on the round record alongside the state update. Put it *before* `broadcastResultsReady`, so nothing is announced to the room ahead of the record it describes.

```js
  // VOTING HAS CLOSED, SO THE PROMISE IS DISCHARGED. The room was told "nobody
  // sees who wrote what — the host included — until voting closes", and this is
  // that moment. Attribution returns everywhere from here: results, Field Notes,
  // standings, the report and the archive export.
  //
  // It lives in this function rather than at the call sites for the reason the
  // comment above records — the state write used to be pasted into two branches
  // and missing from the wavelength and zero-vote exits, so a round could close
  // without it. The reveal must not inherit that hole.
  //
  // Unconditional SET, so it is idempotent: a host who resolves the same round
  // twice does not error, and POST /reveal-authors having run first is a no-op.
  await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionId}` },
    UpdateExpression: 'SET #revealed = :true, #qn = :qn, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#revealed': 'AuthorsRevealed', '#qn': 'QuestionNumber', '#updatedAt': 'UpdatedAt'
    },
    ExpressionAttributeValues: {
      ':true': true, ':qn': paddedQuestionId, ':updatedAt': new Date().toISOString()
    }
  }));
```

**Do not** add response redaction to `get-results.js`, and **do not** touch `create-report.js`. Both are deliberate: this handler is the vote-close event itself, so by the time it assembles a response the round is revealed by definition, and the report attributes every round.

- [ ] **Step 6: Run the tests**

```bash
node tests/anonymity-contract.js
node tests/anonymous-round-flow.js
for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```

Expected: 0 failed, and the total rises by the number of checks you added. `tests/report-payload-flow.js`, `tests/results-state-broadcast.js` and `tests/trivia-*.js` must still pass — the format gate changes trivia's behaviour back to what those suites expect, so a failure there is a signal, not noise.

Aggregate with that `grep`, **never** `tail -1` — some suites print a trailing line and `tail -1` silently drops them.

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/game/anonymity.js lambda-functions/websocket/anonymity.js lambda-functions/game/get-results.js tests/anonymity-contract.js tests/anonymous-round-flow.js
git commit -m "feat(anonymity): voting closing reveals the round

The promise is the one already written into the room-facing sentence —
until voting CLOSES, not until the host presses a button. enterResultsState
is the single choke point for that transition, and its own comment records
that the state write used to be missing from the wavelength and zero-vote
exits; putting the reveal there means it cannot inherit that hole.

The gate now binds only formats that hold a vote. The flag defaults ON and
every game created before this feature has no HostPreferences at all, so
without a format check every legacy trivia game had its answers redacted
during ASK — which breaks the host's view of who answered what — and every
legacy wavelength game was redacted for a format that never attributes.

The report is deliberately untouched: it attributes every round."
```

---

### Task 9: The setup control

**Files:**
- Modify: `src/src/GameHostPage.jsx` — the game-creation form, and the create POST body
- Test: `src/src/__tests__/anonymitySetup.test.js` (create)

**Interfaces:**
- Consumes: `hostRunsVotePhase` from `src/src/config/hostControls.js`.
- Produces: state `anonymousResponses` (boolean, initial `true`); the create POST body carries `anonymousUntilReveal`.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/anonymitySetup.test.js`:

```js
/**
 * The setup control's *decisions*, tested as pure logic.
 *
 * Rendering GameHostPage in jsdom currently fails on the auth provider (see the
 * five stale suites in the handoff), so this asserts the two rules that matter
 * and that a component test would otherwise re-derive: which game types offer
 * the option at all, and what the create payload carries.
 */
import { hostRunsVotePhase } from '../config/hostControls';
import { anonymityApplies, createPayloadFor } from '../config/anonymity';

describe('which formats offer anonymous responses', () => {
  // Not a new taxonomy — exactly the set that holds a vote.
  test.each(['call-and-answer', 'poll', 'survey'])('%s offers it', (type) => {
    expect(anonymityApplies(type)).toBe(true);
  });

  // An option that cannot do anything is a question a host should not be asked,
  // so these hide it rather than showing it disabled.
  test.each(['trivia', 'wavelength'])('%s hides it', (type) => {
    expect(anonymityApplies(type)).toBe(false);
  });

  test('it tracks hostRunsVotePhase rather than a second list', () => {
    for (const t of ['call-and-answer', 'poll', 'survey', 'trivia', 'wavelength']) {
      expect(anonymityApplies(t)).toBe(hostRunsVotePhase(t));
    }
  });
});

describe('the create payload', () => {
  test('defaults to anonymous when the host never touches setup', () => {
    expect(createPayloadFor({ gameType: 'call-and-answer' }).anonymousUntilReveal).toBe(true);
  });

  test('carries an explicit opt-out', () => {
    expect(createPayloadFor({ gameType: 'call-and-answer', anonymousResponses: false })
      .anonymousUntilReveal).toBe(false);
  });

  // The backend defaults ON for any value that is not exactly false, so a
  // non-voting type must send `false` explicitly rather than omitting the key —
  // otherwise a trivia game is silently "anonymous" with nothing to anonymise.
  test('a non-voting type sends false explicitly, not undefined', () => {
    const payload = createPayloadFor({ gameType: 'trivia' });
    expect(payload.anonymousUntilReveal).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/anonymitySetup.test.js
```

Expected: `Cannot find module '../config/anonymity'`.

- [ ] **Step 3: Create the config module**

Create `src/src/config/anonymity.js`:

```js
/**
 * Which sessions offer anonymous responses, and what setup sends.
 *
 * Kept out of GameHostPage because these are two decisions worth reading on
 * their own, and because that file is 5000 lines.
 */
import { hostRunsVotePhase } from './hostControls';

/**
 * Anonymity applies exactly to the formats that hold a vote — call-and-answer,
 * poll, survey. That is not a new taxonomy: hostRunsVotePhase already computes
 * this set, and deriving from it means the two cannot drift.
 *
 * Trivia's response is a letter, so there is nothing authored to attribute;
 * wavelength never attributes on the stage. For those the option is hidden
 * rather than shown-and-disabled, because an option that cannot do anything is
 * a question a host should not be asked.
 */
export function anonymityApplies(gameType) {
  return hostRunsVotePhase(gameType);
}

/**
 * The anonymity part of the create payload.
 *
 * Sends `false` EXPLICITLY for non-voting types rather than omitting the key.
 * The backend gate defaults ON for anything that is not exactly `false`, so an
 * omitted key would mark a trivia game anonymous with nothing to anonymise —
 * harmless today, confusing in a payload diff, and a trap if trivia ever gains
 * a free-text round.
 */
export function createPayloadFor({ gameType, anonymousResponses } = {}) {
  if (!anonymityApplies(gameType)) return { anonymousUntilReveal: false };
  return { anonymousUntilReveal: anonymousResponses !== false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src && npx jest __tests__/anonymitySetup.test.js
```

Expected: all pass.

- [ ] **Step 5: Wire it into the form and the POST**

In `src/src/GameHostPage.jsx`, add state beside the existing shuffle option:

```jsx
  const [anonymousResponses, setAnonymousResponses] = useState(true);
```

In the game-setup form, in a **Responses** section beside the shuffle control, render only when `anonymityApplies(currentGameType)`:

```jsx
{anonymityApplies(currentGameType) && (
  <div className="setup-section">
    <h3>Responses</h3>
    <label className="setup-toggle">
      <input
        type="checkbox"
        checked={anonymousResponses}
        onChange={(e) => setAnonymousResponses(e.target.checked)}
      />
      <span className="setup-toggle-label">Anonymous responses</span>
    </label>
    {/* Default ON, so this copy has to make an ALREADY-ACTIVE guarantee legible
        to a host who never touches it. The second clause is the surprising one,
        so it is stated rather than implied. */}
    <p className="setup-help">
      Until you reveal them, nobody sees who wrote which answer — not the room,
      not you. The room votes on the answers, not on the people.
    </p>
    <p className="setup-help setup-help--muted">
      {anonymousResponses
        ? 'This hides names, not identities. In a small group, people may still recognise each other’s answers.'
        : 'Every answer is labelled with its author from the moment voting opens.'}
    </p>
  </div>
)}
```

In the `POST /games` body, spread the payload:

```js
        ...createPayloadFor({ gameType: currentGameType, anonymousResponses }),
```

Add the import:

```js
import { anonymityApplies, createPayloadFor } from './config/anonymity';
```

- [ ] **Step 6: Verify the build and the frontend baseline**

```bash
cd src && npm run build && npx jest __tests__/
```

Expected: build compiles with the 2 pre-existing size warnings. Jest: 5 failed suites / 30 failed / **243 passed** (the new suite adds passes, no new failures).

- [ ] **Step 7: Commit**

```bash
git add src/src/config/anonymity.js src/src/__tests__/anonymitySetup.test.js src/src/GameHostPage.jsx
git commit -m "feat(anonymity): the setup control, default on

Offered only for formats that hold a vote, derived from hostRunsVotePhase
so the two cannot drift. Trivia and wavelength hide it rather than showing
it disabled: an option that cannot do anything is a question a host should
not be asked.

Non-voting types send false explicitly rather than omitting the key, since
the backend defaults ON for anything that is not exactly false."
```

---

### Task 10: The host screen renders a redacted round and drives the reveal

**Files:**
- Modify: `src/src/GameHostPage.jsx` — VOTE and RESULTS rendering, the reveal action, the `authorsRevealed` handler
- Test: `src/src/__tests__/anonymitySetup.test.js` (append)

**Interfaces:**
- Consumes: `createPayloadFor`, `anonymityApplies` from Task 9; `POST /games/{id}/reveal-authors` from Task 6.
- Produces: `displayLabelFor(answer, index)` → `"Response 1"` while redacted, `playerName` once attributed.

- [ ] **Step 1: Write the failing test**

Append to `src/src/__tests__/anonymitySetup.test.js`:

```js
import { displayLabelFor, isRedacted } from '../config/anonymity';

describe('how an answer is labelled', () => {
  const anon = { answer: 'a splendid answer' };
  const named = { playerName: 'Ada', answer: 'a splendid answer' };

  test('a redacted row is labelled by position, 1-based', () => {
    expect(displayLabelFor(anon, 0)).toBe('Response 1');
    expect(displayLabelFor(anon, 2)).toBe('Response 3');
  });

  test('an attributed row is labelled by name', () => {
    expect(displayLabelFor(named, 0)).toBe('Ada');
  });

  // Omit-not-null is the backend contract; this is the client half of it.
  test('the absence of playerName is what marks a row redacted', () => {
    expect(isRedacted(anon)).toBe(true);
    expect(isRedacted(named)).toBe(false);
  });

  test('a literal null never renders as the string "null"', () => {
    expect(displayLabelFor({ playerName: null, answer: 'x' }, 0)).toBe('Response 1');
  });

  test('an empty-string name is treated as redacted, not as a blank label', () => {
    expect(displayLabelFor({ playerName: '', answer: 'x' }, 1)).toBe('Response 2');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/anonymitySetup.test.js
```

- [ ] **Step 3: Add the label helpers**

Append to `src/src/config/anonymity.js`:

```js
/**
 * A row is redacted when it has no usable author, which is the client half of
 * the backend's omit-don't-null rule. Treats null and '' as redacted too, so a
 * partial payload can never render an empty label or the string "null".
 */
export function isRedacted(answer) {
  return !(answer && typeof answer.playerName === 'string' && answer.playerName.length > 0);
}

/**
 * What to print above an answer. `Response N` is 1-based because it is read
 * aloud in a room — "look at response three", not "response two".
 */
export function displayLabelFor(answer, index) {
  return isRedacted(answer) ? `Response ${index + 1}` : answer.playerName;
}
```

- [ ] **Step 4: Use them, and add the reveal action**

In `src/src/GameHostPage.jsx`, replace every place the VOTE and RESULTS views print `answer.player` / `answer.playerName` with `displayLabelFor(answer, index)`.

Add the reveal handler.

> **Amended 2026-08-09 with Task 8.** `AuthorsRevealed` now flips automatically when
> the round enters RESULTS, so by the time the host is looking at this screen the
> payload already carries names and `authorsRevealed` restores as `true`. The on-stage
> reveal is therefore a **display** step: hold the names back for a beat, then show
> them. Keep `handleRevealAuthors` anyway — it is the override for a host who wants
> names back *before* closing the vote, and it is what makes the button correct on a
> round reopened or resolved out of order. Call it only when `authorsRevealed` is
> still false; otherwise just flip the local display state.

```js
  // Display step, plus an override. AuthorsRevealed flips when voting closes
  // (get-results.js:enterResultsState), so this endpoint is only load-bearing
  // when the host reveals BEFORE closing the vote. Calling it when the round is
  // already revealed is a harmless no-op — the endpoint is idempotent.
  const handleRevealAuthors = async () => {
    try {
      const res = await fetch(`${API_BASE}games/${gameId}/reveal-authors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber: lessonNumber })
      });
      if (!res.ok) {
        console.error('❌ HOST: reveal failed:', res.status);
        return;
      }
      const data = await res.json();
      setAnswers(data.answers || []);
      setAuthorsRevealed(true);
    } catch (e) {
      console.error('❌ HOST: reveal error', e);
    }
  };
```

Add `const [authorsRevealed, setAuthorsRevealed] = useState(false);`, reset it to `false` wherever `lessonNumber` advances, and restore it in `restoreGameState` from the round record.

Register the broadcast handler beside the others in the WebSocket effect, and add its `offMessage` in the cleanup:

```js
    webSocketClient.onMessage('authorsRevealed', (data) => {
      console.log('🔌 Authors revealed notification:', data);
      // Re-sync rather than patching state, exactly like questionStarted and
      // gameStateChanged. The attributed rows come back from the API.
      restoreGameState();
    });
```

- [ ] **Step 5: Hide the standings until the reveal**

Spec §5.6.4, and it is the subtle leak: for call-and-answer, points come from votes cast on your *own* answer, so a leaderboard that updates while the answers are still anonymous is **attribution by arithmetic** — watch whose score jumps by 180 and you have found the author of the 180-point answer. Task 8 stops the server sending `playerName`; this stops the client showing the delta that identifies them anyway.

In the RESULTS view, wrap the standings / leaderboard / per-player score block:

```jsx
{/* Attribution by arithmetic: points come from votes on your own answer, so a
    score jumping 180 identifies the author of the 180-point answer as surely
    as a name would. Standings return, already updated, at the reveal — which
    also gives that beat something visible to deliver. */}
{(!anonymityApplies(currentGameType) || authorsRevealed) && (
  <StandingsBlock players={players} />
)}
```

Add the matching assertion to `src/src/__tests__/anonymitySetup.test.js`:

```js
import { standingsVisible } from '../config/anonymity';

describe('standings before the reveal', () => {
  test('hidden while an anonymous round is unrevealed', () => {
    expect(standingsVisible({ gameType: 'call-and-answer', authorsRevealed: false })).toBe(false);
  });
  test('shown once revealed', () => {
    expect(standingsVisible({ gameType: 'call-and-answer', authorsRevealed: true })).toBe(true);
  });
  test('always shown for a format with no anonymity', () => {
    expect(standingsVisible({ gameType: 'trivia', authorsRevealed: false })).toBe(true);
  });
});
```

and the helper to `src/src/config/anonymity.js`:

```js
/**
 * Whether standings may be shown. See §5.6.4: a live leaderboard during an
 * anonymous round is attribution by arithmetic, so it waits for the reveal.
 */
export function standingsVisible({ gameType, authorsRevealed } = {}) {
  return !anonymityApplies(gameType) || authorsRevealed === true;
}
```

- [ ] **Step 6: Add `‹ Hide again`**

Spec §5.6.4. Display-only, for the host who reveals a beat early. It does **not** un-send anything — the payload has already been delivered — so it must not be presented as a security control and the button must not say "hide from the room".

```jsx
{authorsRevealed && (
  <button className="ghost-step-back" onClick={() => setAuthorsRevealed(false)}>
    ‹ Hide again
  </button>
)}
```

Local state only. Do not call `reveal-authors` with a `false` — `AuthorsRevealed` is the durable record of what the room was shown, and the report reads it.

- [ ] **Step 7: Verify**

```bash
cd src && npx jest __tests__/anonymitySetup.test.js && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/src/config/anonymity.js src/src/__tests__/anonymitySetup.test.js src/src/GameHostPage.jsx
git commit -m "feat(anonymity): host renders redacted rounds and drives the reveal

Response N is 1-based because it is read aloud in a room. null and empty
string are treated as redacted so a partial payload can never render the
string 'null' or a blank label.

authorsRevealed re-syncs rather than patching state, like questionStarted
and gameStateChanged already do."
```

---

### Task 11: The player's voting screen

**Files:**
- Modify: `src/src/PlayerPage.jsx` — the voting list
- Test: `src/src/__tests__/anonymitySetup.test.js` (append)

**Interfaces:**
- Consumes: `displayLabelFor`, `isRedacted` from Task 10.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `src/src/__tests__/anonymitySetup.test.js`:

```js
import { ownAnswerIndex } from '../config/anonymity';

describe('a player finding their own answer in an anonymous ballot', () => {
  // A player sees their own answer attributed to themselves. Correct, and not
  // a leak (§5.6.7 item 6) — but the payload is redacted, so the only way to
  // find it is to match the text they submitted.
  const ballot = [{ answer: 'first' }, { answer: 'mine' }, { answer: 'third' }];

  test('matches on the submitted text', () => {
    expect(ownAnswerIndex(ballot, 'mine')).toBe(1);
  });

  test('returns -1 when the player has not answered', () => {
    expect(ownAnswerIndex(ballot, 'not submitted')).toBe(-1);
  });

  test('tolerates surrounding whitespace', () => {
    expect(ownAnswerIndex(ballot, '  mine  ')).toBe(1);
  });

  test('returns -1 for an empty submission rather than matching row 0', () => {
    expect(ownAnswerIndex(ballot, '')).toBe(-1);
    expect(ownAnswerIndex(ballot, null)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/anonymitySetup.test.js
```

- [ ] **Step 3: Implement**

Append to `src/src/config/anonymity.js`:

```js
/**
 * Which ballot row is this player's own.
 *
 * A player seeing their own answer marked is correct and not a leak (§5.6.7).
 * But the ballot is redacted, so the only handle is the text they submitted.
 * Returns -1 when there is no match, including for an empty submission — which
 * must never match row 0.
 */
export function ownAnswerIndex(ballot, ownAnswerText) {
  const needle = String(ownAnswerText ?? '').trim();
  if (!needle) return -1;
  return (ballot || []).findIndex(
    (row) => String(row?.answer ?? '').trim() === needle
  );
}
```

In `src/src/PlayerPage.jsx`, label each ballot row with `displayLabelFor(answer, index)` and mark the row at `ownAnswerIndex(...)` as "Yours".

- [ ] **Step 4: Verify the full baseline**

```bash
cd src && npx jest __tests__/ && npm run build
cd .. && for t in tests/*.js; do node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
sam validate --lint -t template-clean.yaml
```

Expected: frontend 5 failed suites (the stale ones) / 243+ passed; backend 20 suites, 0 failed; template valid.

- [ ] **Step 5: Commit**

```bash
git add src/src/config/anonymity.js src/src/__tests__/anonymitySetup.test.js src/src/PlayerPage.jsx
git commit -m "feat(anonymity): the player's anonymous ballot

A player seeing their own answer marked is correct and not a leak, but
the ballot is redacted so the only handle is the text they submitted.
An empty submission returns -1 rather than matching row 0."
```

---

## Manual verification before handing back

The automated suites cover the contract. These three cannot be asserted and must be walked through on `engagedev` after the user deploys:

1. **Create a call-and-answer game without touching setup.** Confirm the answers, ballot and pre-reveal results carry no names anywhere, including in the browser's network panel — not just on screen.
2. **Watch the host's WebSocket frames while a player answers.** `playerAnswered` must carry a round number and no author and no answer text. This is the leak that survives an on-screen check.
3. **Reveal, then end the session and open the report.** Round attribution appears. Then run a second round, skip the reveal, end, and confirm that round is unattributed in the report and the archive export.

## Out of scope, recorded

- **R1** — stable `answerId` (spec §5.6.5a). Positional ordering is stable only because the answer sort key ends in the author's name. Independent of this work; do not bundle.
- **R2** — `reopen-round` (spec §5.3). No endpoint un-scores a round.
- The host-stage redesign (plans 2–5). This plan changes only what the existing UI renders, not how it is laid out.
