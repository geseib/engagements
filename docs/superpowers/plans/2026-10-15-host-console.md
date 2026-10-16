# Host Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On two screens, the host's laptop shows a private console (top bar, the loop, a collapsible rail, the host's work for the step, a one-line footer) in place of the wall-style stage; one screen is unchanged.

**Architecture:** `GameHostPage.jsx` keeps every hook, fetch and handler. When two screens are on, the type is a round type and the session is not an event item, it renders `<HostConsole>` instead of `<Stage>`, passing data and callbacks only. The console is small, pure-prop components: a shell, a top bar, a rail, a footer, and one panel per moment family. Two pure modules decide which rail section opens (`consoleRail.js`) and what the room's window status is (`presentStatus.js`). One small backend change lets the Present window report full screen and visibility.

**Tech Stack:** React 18 (CRA, Jest + React Testing Library), plain CSS with the repo's tokens, AWS Lambda (Node) with DynamoDB; backend tests are standalone `node tests/<file>.js` scripts judged by exit code.

**Spec:** `docs/superpowers/specs/2026-10-15-host-console-design.md`. Design: `docs/design/host-console/index.html`, the **Full** version (the owner's choice), with the wall preview replaced by the room's-window status.

## Global Constraints

- Two screens only, round types only (`call-and-answer`, `trivia`, `poll`, `wavelength`), never an event item (`eventCode`) and never a survey: those keep `<Stage>`.
- Laptop type ladder only: 12 / 13 / 15 / 19 / 24 px (`engage-design` §2). Nothing below 12px. Never the stage's `--L-*` or `--t-*` sizes.
- Colour is tokens only (`var(--text)`, `var(--muted)`, `var(--surface)`, `var(--surface-2)`, `var(--info)`, `var(--success)`, `var(--accent)`, `var(--accent-text)`, `rgb(var(--x-rgb) / a)`). `src/src/__tests__/skinLiteralsPalette.test.js` fails a new stylesheet with a colour literal or a `--primary` read.
- Every scope class starts `hc-` (host console). No bare `.btn`, `.card`, `.modal`.
- Words: plain English, sentence case, "phone, laptop or tablet", never "phone" alone. Round-step labels come only from `config/roundWords.js` (`RW`); the console never types "Start voting", "Show results" and so on itself (`roundStepParity.test.js` greps for literals).
- Never state one fact twice in a view: a count appears in the footer status and in the People header only.
- Names: never beside an answer while the round hides names (`navigatorLabel` / `authorsHiddenNow`); the host's answers route already redacts authors on a hidden round.
- `/state` (public) must never carry a question's Background (`tests/present-public-reads.js` §1). Host notes travel on `/host-state` only.
- Keys unchanged: Space, →, ←, the clicker, the in-place second press (`HostActionBar`).
- Gates before every push: every `node tests/*.js` (skip `tests/verify-question-set-ui.spec.js`; clear `.aws-sam` first), `cd src && CI=true npx jest`, `npm run lint` (0 errors), `npm run build`. A push to `dev` is the deploy; never also push a deploy tag.

## Review Focus

1. **A round that hides names:** the Answering, Voting and Results panels show "Response N", never a name, until the round reveals authors. Test in Task 6.
2. **The Present window closed without a goodbye:** its row lingers up to 2 hours; the status must not say "on, full screen" for a window that stopped reporting. `presentStatus` treats a viewer whose `StatusAt` is older than 90 seconds as "not open". Test in Task 2 and Task 3.
3. **A player socket sending `PRESENT_STATUS`:** must change nothing (only a viewer row may be written, and only its own). Test in Task 3.
4. **The host closing the rail section the moment opened:** it stays closed until the moment changes, then the new moment's section opens. Test in Task 5.
5. **A long response or a long read:** the main area scrolls on its own; the footer and the main button never move off screen at 1366×768. Pinned by the CSS contract test in Task 5 (`.hc-main{overflow:auto}`, footer outside the scroller) and checked in the walk (Task 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/src/config/consoleRail.js` (new) | `consoleRailFor(moment)`, `CONSOLE_SECTIONS`, header summaries |
| `src/src/config/presentStatus.js` (new) | `presentStatusFrom(detail, now)` → `{ state, label, tone }` |
| `src/src/config/consoleWords.js` (new) | every console string that is not a round-step label |
| `lambda-functions/websocket/message.js` (modify) | `PRESENT_STATUS` frame from a viewer: write its own row |
| `lambda-functions/game/room-counts.js` (modify) | `presentingDetail(db, table, gameId)` |
| `lambda-functions/game/get-game-state.js` (modify) | host door: `presentDetail`, `hostNotes.background` |
| `src/src/present/usePresentation.js` (modify) | send `PRESENT_STATUS` on connect, `fullscreenchange`, `visibilitychange` |
| `src/src/components/AskComposer.jsx` (modify) | split into `AskComposerBody` (exported) + dialog shell |
| `src/src/components/console/HostConsole.jsx` + `.css` (new) | the grid, picks the panel |
| `src/src/components/console/ConsoleTop.jsx` (new) | line 1 |
| `src/src/components/console/ConsoleRail.jsx` (new) | the four sections |
| `src/src/components/console/ConsoleFooter.jsx` (new) | status, Your part now, HostActionBar |
| `src/src/components/console/panels/ResponsesPanel.jsx` (new) | Answering, Voting, Results, Between (a list of responses) |
| `src/src/components/console/panels/ReadPanel.jsx` (new) | Workie's read + inline composer |
| `src/src/components/console/panels/SimplePanels.jsx` (new) | Lobby, RoomQuestion, Feedback, Ended |
| `src/src/GameHostPage.jsx` (modify) | render `HostConsole` on two screens; map props |
| tests as named per task |

---

### Task 1: Console words and the rail rule

**Files:**
- Create: `src/src/config/consoleWords.js`
- Create: `src/src/config/consoleRail.js`
- Test: `src/src/__tests__/consoleRail.test.js`

**Interfaces:**
- Produces: `CW` (default export of consoleWords), `CONSOLE_SECTIONS: ['queue','people','late','tools']`, `consoleRailFor(moment: string): 'queue'|'people'|'late'|'tools'|null`, `peopleSummary({ moment, players, answered, voted }): string`.

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/consoleRail.test.js
import { consoleRailFor, CONSOLE_SECTIONS, peopleSummary } from '../config/consoleRail';
import CW from '../config/consoleWords';

describe('which rail section opens by itself (spec §3.3)', () => {
  test.each([
    ['LOBBY', 'queue'], ['ANSWERING', 'people'], ['VOTING', 'people'], ['VOTE_RESPONSES', 'people'],
    ['RESULTS', 'people'], ['RESPONSES', 'people'], ['READ', 'late'], ['FEEDBACK', 'late'],
    ['ROOM_QUESTION', 'people'], ['ROOM_RESULTS', 'queue'], ['ENDED', 'queue'],
  ])('%s opens %s', (moment, section) => {
    expect(consoleRailFor(moment)).toBe(section);
  });
  test('an unknown moment opens nothing', () => {
    expect(consoleRailFor('UNKNOWN')).toBeNull();
  });
  test('the four sections, in order', () => {
    expect(CONSOLE_SECTIONS).toEqual(['queue', 'people', 'late', 'tools']);
  });
});

describe('the People header says the one count for the moment', () => {
  test('answering, voting, otherwise who is here', () => {
    expect(peopleSummary({ moment: 'ANSWERING', players: 4, answered: 3, voted: 0 })).toBe('3 of 4 answered');
    expect(peopleSummary({ moment: 'VOTING', players: 4, answered: 4, voted: 2 })).toBe('2 of 4 voted');
    expect(peopleSummary({ moment: 'READ', players: 4, answered: 4, voted: 4 })).toBe('4 here');
    expect(peopleSummary({ moment: 'LOBBY', players: 1, answered: 0, voted: 0 })).toBe('1 here');
  });
});

describe('words', () => {
  test('sentence case and the device phrase', () => {
    for (const [k, v] of Object.entries(CW)) {
      if (typeof v !== 'string') continue;
      expect([k, /^[A-Z0-9]/.test(v)]).toEqual([k, true]);
      expect([k, /!/.test(v)]).toEqual([k, false]);
      if (/phone/.test(v)) expect([k, v]).toEqual([k, expect.stringMatching(/phone, laptop or tablet/)]);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/consoleRail.test.js`
Expected: FAIL, "Cannot find module '../config/consoleRail'".

- [ ] **Step 3: Write the two modules**

```js
// src/src/config/consoleWords.js
/**
 * THE HOST CONSOLE'S WORDS (docs/superpowers/specs/2026-10-15-host-console-design.md).
 * Round-step labels stay in roundWords.js; these are the console's own.
 * Sentence case, plain, "phone, laptop or tablet".
 */
const CW = Object.freeze({
  queue: 'Round queue',
  people: 'People',
  late: 'Late & not reviewed',
  tools: 'Session tools',
  allRounds: 'Rounds and questions',
  allPlayers: 'All players',
  reviewLate: 'Review them',
  questions: 'Questions',
  rounds: 'Rounds',
  settings: 'Settings',
  connected: 'Connected',
  offline: 'Offline',
  join: 'Join',
  roomsWindow: 'Room\'s window',
  done: 'done',
  now: 'now',
  next: 'next',
  answered: 'answered',
  voted: 'voted',
  stillWriting: 'still writing',
  notYet: 'not yet',
  respondingTitle: 'Responses as they land',
  namesHidden: 'Names hidden',
  forYou: 'For you',
  theTask: 'The task',
  onTheWall: 'On the wall now',
  pressToWall: 'Press a response to put it on the wall.',
  theBallot: 'The ballot, in the order the room sees it',
  votes: 'Votes',
  resultsTitle: 'The results',
  readTitle: 'Workie\'s read',
  readOnWall: 'The wall shows this page',
  upNext: 'Up next',
  noLate: 'Nothing is waiting.',
  reportSoFar: 'The report so far',
  joinedSoFar: 'Joined so far',
  nobodyYet: 'Nobody has joined yet.',
  commentsTitle: 'Comments as they land',
  noComments: 'No comments yet.',
  waitingForResponses: 'No responses yet.',
});

export default CW;
```

```js
// src/src/config/consoleRail.js
/**
 * THE CONSOLE'S RAIL (spec §3.3): four collapsible sections; the one that
 * matters for the moment opens by itself. Pure, so the host's own open/close
 * choice can hold until the moment changes (ConsoleRail keeps that state).
 */
export const CONSOLE_SECTIONS = Object.freeze(['queue', 'people', 'late', 'tools']);

const OPENS = Object.freeze({
  LOBBY: 'queue',
  ANSWERING: 'people',
  VOTING: 'people',
  VOTE_RESPONSES: 'people',
  RESULTS: 'people',
  RESPONSES: 'people',
  READ: 'late',
  FEEDBACK: 'late',
  ROOM_QUESTION: 'people',
  ROOM_RESULTS: 'queue',
  ENDED: 'queue',
});

export function consoleRailFor(moment) {
  return OPENS[moment] || null;
}

/** The People header: the one count for the moment. */
export function peopleSummary({ moment, players = 0, answered = 0, voted = 0 } = {}) {
  if (moment === 'ANSWERING') return `${answered} of ${players} answered`;
  if (moment === 'VOTING' || moment === 'VOTE_RESPONSES') return `${voted} of ${players} voted`;
  return `${players} here`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd src && CI=true npx jest src/__tests__/consoleRail.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/config/consoleWords.js src/src/config/consoleRail.js src/src/__tests__/consoleRail.test.js
git commit -m "Host console: its words and the rail rule (which section opens for each moment)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The room's-window status rule

**Files:**
- Create: `src/src/config/presentStatus.js`
- Test: `src/src/__tests__/presentStatus.test.js`

**Interfaces:**
- Consumes: the host-state field `presentDetail` from Task 3: `{ open: boolean, fullscreen: boolean|null, visible: boolean|null, statusAt: ISO string|null } | null`.
- Produces: `presentStatusFrom(detail, nowMs = Date.now()) → { state: 'on'|'windowed'|'hidden'|'closed', label: string, tone: 'success'|'warn'|'muted', hint: string }`, `STALE_MS = 90000`.

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/presentStatus.test.js
import { presentStatusFrom, STALE_MS } from '../config/presentStatus';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

test('connected, visible and full screen: on', () => {
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'on', label: 'Room\'s window: on, full screen', tone: 'success' });
});
test('connected, visible, not full screen: windowed, with the F hint', () => {
  expect(presentStatusFrom({ open: true, fullscreen: false, visible: true, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'windowed', label: 'Room\'s window: open, not full screen', tone: 'warn', hint: 'Press F on that window' });
});
test('connected but hidden or minimised: hidden', () => {
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: false, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'hidden', tone: 'warn' });
});
test('no viewer, or one that stopped reporting 90 seconds ago, is not open (Review Focus 2)', () => {
  expect(presentStatusFrom(null, NOW).state).toBe('closed');
  expect(presentStatusFrom({ open: false }, NOW).state).toBe('closed');
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(STALE_MS + 1000) }, NOW).state).toBe('closed');
  expect(presentStatusFrom(null, NOW)).toMatchObject({ label: 'Room\'s window: not open', tone: 'muted' });
});
test('an older Present page that never reports its state still counts as open, windowed', () => {
  expect(presentStatusFrom({ open: true, fullscreen: null, visible: null, statusAt: null }, NOW).state).toBe('windowed');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/presentStatus.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

```js
// src/src/config/presentStatus.js
/**
 * IS THE ROOM'S WINDOW REALLY UP? (spec §3.1; owner, 15 Oct: "does it really
 * know that it is up?"). What the app can know: a Present window is connected
 * to this session, whether it is full screen, and whether its tab is visible.
 * It cannot know the projector is on, so it never claims to.
 *
 * A viewer that has not reported for STALE_MS is treated as gone: its row can
 * outlive a closed tab by up to two hours (connect.js ttl).
 */
export const STALE_MS = 90 * 1000;

const STATES = {
  on: { label: 'Room\'s window: on, full screen', tone: 'success', hint: 'Connected, visible and full screen' },
  windowed: { label: 'Room\'s window: open, not full screen', tone: 'warn', hint: 'Press F on that window' },
  hidden: { label: 'Room\'s window: hidden', tone: 'warn', hint: 'The room\'s window is hidden or minimised' },
  closed: { label: 'Room\'s window: not open', tone: 'muted', hint: 'Open it, then drag it onto the projector' },
};

export function presentStatusFrom(detail, nowMs = Date.now()) {
  const make = (state) => ({ state, ...STATES[state] });
  if (!detail || !detail.open) return make('closed');
  const at = Date.parse(detail.statusAt || '');
  if (Number.isFinite(at) && nowMs - at > STALE_MS) return make('closed');
  if (detail.visible === false) return make('hidden');
  if (detail.fullscreen === true) return make('on');
  return make('windowed');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd src && CI=true npx jest src/__tests__/presentStatus.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/config/presentStatus.js src/src/__tests__/presentStatus.test.js
git commit -m "Host console: the room's-window status rule (on / not full screen / hidden / not open)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Present window reports its state; the host door carries it and the host notes

**Files:**
- Modify: `lambda-functions/websocket/message.js` (the handler, before the host-frame gate: a `PRESENT_STATUS` branch)
- Modify: `lambda-functions/game/room-counts.js` (add `presentingDetail`)
- Modify: `lambda-functions/game/get-game-state.js` (host door only: `presentDetail`, `hostNotes`)
- Test: `tests/present-status.js` (new), and run `tests/present-public-reads.js`, `tests/get-game-host-state.js`

**Interfaces:**
- Consumes: the viewer row written by `websocket/connect.js`: `{ PK: 'GAME#<id>', SK: 'CONNECTION#<connectionId>', Viewer: 'present', ViewerId }`.
- Produces: viewer row fields `Fullscreen: boolean`, `Visible: boolean`, `StatusAt: ISO`; host frame `{ type: 'presentChanged', gameId }`; `/host-state` fields `presentDetail: { open, fullscreen, visible, statusAt } | null` and `hostNotes: { background: string } | null`. `/state` (public) carries neither.

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// tests/present-status.js
/**
 * THE ROOM'S WINDOW REPORTS ITS STATE (host console spec §4.2).
 * A Present viewer's PRESENT_STATUS writes Fullscreen/Visible/StatusAt onto
 * its OWN connection row only; a player socket sending it changes nothing;
 * /host-state carries presentDetail and hostNotes; /state carries neither.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}
const table = createTable();
const sent = []; const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const { presentingDetail } = require(path.join(REPO, 'lambda-functions/game/room-counts.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); pass += 1; console.log(`  ok   - ${label}`); } catch (e) { fail += 1; console.log(`  FAIL - ${label}\n         ${e.message}`); } }
const put = (i) => table.store.set(table.keyOf(i.PK, i.SK), i);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const GAME = '6601'; const PK = `GAME#${GAME}`;
const VIEW = 'view-1'; const PHONE = 'phone-1'; const HOST = 'host-1';

function seed() {
  table.store.clear(); frames.length = 0;
  put({ PK, SK: 'METADATA', GameType: 'call-and-answer', Started: true });
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
  put({ PK, SK: `CONNECTION#${VIEW}`, ConnectionId: VIEW, ConnectionType: 'PLAYER', Viewer: 'present', ViewerId: 'abcdefgh1', GameId: GAME });
  put({ PK, SK: `CONNECTION#${PHONE}`, ConnectionId: PHONE, ConnectionType: 'PLAYER', PlayerName: 'Ada', GameId: GAME });
  put({ PK, SK: `CONNECTION#${HOST}`, ConnectionId: HOST, ConnectionType: 'HOST', GameId: GAME });
}
const frame = (connectionId, body) => wsMessage({
  requestContext: { connectionId, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({ messageType: 'PRESENT_STATUS', gameId: GAME, ...body }),
});

(async () => {
  console.log('\npresent-status\n');
  await check('a viewer reports full screen and visible onto its own row, and the host is told', async () => {
    seed();
    await frame(VIEW, { fullscreen: true, visible: true });
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Fullscreen, true);
    assert.strictEqual(row.Visible, true);
    assert.ok(row.StatusAt);
    assert.ok(frames.some((f) => f.connectionId === HOST && f.message.type === 'presentChanged'));
  });
  await check('a player socket sending PRESENT_STATUS changes nothing (Review Focus 3)', async () => {
    seed();
    await frame(PHONE, { fullscreen: true, visible: true });
    assert.strictEqual(get(PK, `CONNECTION#${PHONE}`).Fullscreen, undefined);
    assert.strictEqual(get(PK, `CONNECTION#${VIEW}`).Fullscreen, undefined);
  });
  await check('non-boolean values are not written', async () => {
    seed();
    await frame(VIEW, { fullscreen: 'yes', visible: 1 });
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Fullscreen, undefined);
    assert.strictEqual(row.Visible, undefined);
  });
  await check('room-counts exports presentingDetail (its behaviour is tested through the host door, Step 6)', async () => {
    assert.strictEqual(typeof presentingDetail, 'function');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

`presentingDetail`'s behaviour (open:false with no viewer; the latest viewer's booleans) is tested through the host door in `tests/get-game-host-state.js` (Step 6), where the table stub already serves `room-counts.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `rm -rf .aws-sam && node tests/present-status.js`
Expected: FAIL on the first check (no row change, no `presentChanged` frame), exit 1.

- [ ] **Step 3: Handle the frame in `message.js`**

In `exports.handler`, after the `PING` branch and the `messageType`/`gameId` presence check, before the host-frame gate, add:

```js
    // THE ROOM'S WINDOW REPORTS ITS STATE (host console spec §4.2). Only a
    // Present viewer's own row is written, and only with real booleans; a
    // player socket sending this changes nothing.
    if (messageType === 'PRESENT_STATUS') {
      await recordPresentStatus(gameId, connectionId, body);
      return { statusCode: 200, body: 'ok' };
    }
```

and, beside `keepLateAnswer`, the function:

```js
async function recordPresentStatus(gameId, connectionId, body) {
  const key = { PK: `GAME#${gameId}`, SK: `CONNECTION#${connectionId}` };
  const row = await db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: key, ProjectionExpression: 'Viewer' }));
  if (!row.Item || row.Item.Viewer !== 'present') return;
  const sets = []; const values = { ':at': new Date().toISOString() };
  if (typeof body.fullscreen === 'boolean') { sets.push('Fullscreen = :fs'); values[':fs'] = body.fullscreen; }
  if (typeof body.visible === 'boolean') { sets.push('Visible = :vi'); values[':vi'] = body.visible; }
  sets.push('StatusAt = :at');
  await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME, Key: key,
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeValues: values,
  }));
  const hosts = await getHostConnections(gameId);
  await Promise.all(hosts.map((c) => sendToConnection(c.ConnectionId, { type: 'presentChanged', gameId })));
}
```

- [ ] **Step 4: Add `presentingDetail` to `room-counts.js`**

```js
/**
 * The room's window as the host console reports it (host console spec §4.2):
 * the most recently reporting Present viewer's Fullscreen/Visible/StatusAt.
 */
async function presentingDetail(db, tableName, gameId) {
  const { items } = await queryAll(db, tableName, gameId, 'CONNECTION#', {
    FilterExpression: 'Viewer = :viewer',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':viewer': 'present' },
  });
  if (!items.length) return { open: false, fullscreen: null, visible: null, statusAt: null };
  const latest = items.slice().sort((a, b) => String(b.StatusAt || b.ConnectedAt || '').localeCompare(String(a.StatusAt || a.ConnectedAt || '')))[0];
  return {
    open: true,
    fullscreen: typeof latest.Fullscreen === 'boolean' ? latest.Fullscreen : null,
    visible: typeof latest.Visible === 'boolean' ? latest.Visible : null,
    statusAt: latest.StatusAt || null,
  };
}
```

Add it to `module.exports`. Check `queryAll`'s signature at the top of `room-counts.js` first: it returns `{ items, count }` and accepts the extra params as its fifth argument, as `presentingCount` uses it.

- [ ] **Step 5: The host door carries it, and the host notes**

In `get-game-state.js`, where the host door sets `response.presenting = await presentingCount(...)` (around line 587), add after it, inside the same host-door branch:

```js
      try {
        response.presentDetail = await presentingDetail(db, process.env.TABLE_NAME, gameId);
      } catch (detailError) {
        console.error('present detail failed (reporting none):', detailError);
        response.presentDetail = null;
      }
```

and import `presentingDetail` with `presentingCount`. Where `currentQuestionData` is built from `questionItem` (around line 345), keep it unchanged, and on the host door only add:

```js
      // The host's own notes for the question (host console spec §3.4): the
      // set's Background, on the host door only. /state never carries it
      // (tests/present-public-reads.js §1).
      response.hostNotes = currentQuestionHostNotes || null;
```

where `currentQuestionHostNotes` is set beside `currentQuestionData`:

```js
            currentQuestionHostNotes = questionItem.Background ? { background: String(questionItem.Background) } : null;
```

declared with `let currentQuestionHostNotes = null;` next to `let currentQuestionData`. `questionItem` is already decrypted there; `Background` is in the `question` encryption list.

- [ ] **Step 6: Extend `tests/get-game-host-state.js`**

Add, in that file's style, a check that the host door response has `presentDetail` with `open:false` when no viewer row exists, `open:true, fullscreen:true` after seeding a viewer row with `Fullscreen: true, Visible: true, StatusAt`, and `hostNotes.background` when the question row has `Background`. Add to `tests/present-public-reads.js` §2 a check that `plain.body.presentDetail === undefined && plain.body.hostNotes === undefined`.

- [ ] **Step 7: Run the backend tests**

Run: `rm -rf .aws-sam && for t in present-status get-game-host-state present-public-reads late-answers; do node tests/$t.js > /dev/null 2>&1; echo "$t $?"; done`
Expected: each prints `0`.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/websocket/message.js lambda-functions/game/room-counts.js lambda-functions/game/get-game-state.js tests/present-status.js tests/get-game-host-state.js tests/present-public-reads.js
git commit -m "Host console: the room's window reports full screen and visibility; the host door carries it and the host notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Present page sends its state

**Files:**
- Modify: `src/src/present/usePresentation.js` (the effect that connects at ~line 188)
- Test: `src/src/__tests__/presentReportsStatus.test.js`

**Interfaces:**
- Consumes: `webSocketClient.sendCleanMessage(messageType, data) → boolean`, `fullscreenElement()` from `src/src/utils/fullscreen.js`.
- Produces: frames `PRESENT_STATUS { fullscreen: boolean, visible: boolean }` on connect, on `fullscreenchange`/`webkitfullscreenchange`, on `visibilitychange`, and every 60 s (so `StatusAt` stays fresh for the 90 s stale rule).

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/presentReportsStatus.test.js
import fs from 'fs';
import path from 'path';
import { presentStatusPayload } from '../present/usePresentation';

test('the payload is two booleans', () => {
  expect(presentStatusPayload({ fullscreen: true, hidden: false })).toEqual({ fullscreen: true, visible: true });
  expect(presentStatusPayload({ fullscreen: false, hidden: true })).toEqual({ fullscreen: false, visible: false });
});

test('the page reports on connect, on full screen and visibility changes, and every minute', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'present', 'usePresentation.js'), 'utf8');
  expect(src).toMatch(/sendCleanMessage\('PRESENT_STATUS'/);
  expect(src).toMatch(/'fullscreenchange'/);
  expect(src).toMatch(/'visibilitychange'/);
  expect(src).toMatch(/setInterval\(report, 60 \* 1000\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/presentReportsStatus.test.js`
Expected: FAIL, `presentStatusPayload` is not exported.

- [ ] **Step 3: Implement**

At module level in `usePresentation.js`:

```js
import { fullscreenElement } from '../utils/fullscreen';

/** What the room's window tells the host console (host console spec §4.2). */
export function presentStatusPayload({ fullscreen, hidden }) {
  return { fullscreen: Boolean(fullscreen), visible: !hidden };
}
```

In the effect that calls `webSocketClient.connect(gameId, null, false, { viewerId })`, after the `FOLLOW_FRAMES` registration:

```js
    const report = () => {
      webSocketClient.sendCleanMessage('PRESENT_STATUS', presentStatusPayload({
        fullscreen: Boolean(fullscreenElement()),
        hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      }));
    };
    const onChange = () => report();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('visibilitychange', onChange);
    webSocketClient.onConnected?.(report);
    const tick = setInterval(report, 60 * 1000);
```

and in that effect's cleanup:

```js
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      document.removeEventListener('visibilitychange', onChange);
      clearInterval(tick);
```

If `WebSocketClient` has no `onConnected` hook, call `report()` inside the existing `onReconnected` callback as well and once after a 1 s `setTimeout` from connect (clear it in cleanup). Check `src/src/WebSocketClient.js` for the hook name before choosing.

- [ ] **Step 4: Run it to verify it passes, and the existing Present suites**

Run: `cd src && CI=true npx jest src/__tests__/presentReportsStatus.test.js src/__tests__/present`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/present/usePresentation.js src/src/__tests__/presentReportsStatus.test.js
git commit -m "Host console: the room's window reports full screen and visibility over its socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The console shell: top, rail, footer

**Files:**
- Create: `src/src/components/console/HostConsole.jsx`, `HostConsole.css`, `ConsoleTop.jsx`, `ConsoleRail.jsx`, `ConsoleFooter.jsx`
- Test: `src/src/__tests__/hostConsoleShell.test.jsx`, `src/src/__tests__/hostConsolePalette.test.js`

**Interfaces:**
- Consumes: `consoleRailFor`, `peopleSummary`, `CW` (Task 1); `presentStatusFrom` (Task 2); `WorkflowStrip` (existing, `src/src/components/stage/WorkflowStrip.jsx`, props `strip, mode, viewing, onView, viewingWhere, onBack, places`); `HostActionBar` (existing, props `controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey`).
- Produces:
  - `<HostConsole top={TopProps} strip={StripProps} rail={RailProps} footer={FooterProps} moment={string}>{panel}</HostConsole>`
  - `TopProps = { title, code, onJoin, presentHref, presentDetail, onOpenPresent }`
  - `StripProps` = the `WorkflowStrip` props, rendered with `places={null}` and the "Your part now" line suppressed (`hidePart`)
  - `RailProps = { moment, rounds: [{n, title, state:'done'|'now'|'next'|'later'}], people: [{name, state:'answered'|'voted'|'writing'|'not-yet'|'here'}], counts: {players, answered, voted}, late: [{id, label, meta}], connected: boolean, onOpenSection: (tab) => void }`
  - `FooterProps = { status: {text, tone}, part: {before, action, after}|null, controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey }`

- [ ] **Step 1: Add `hidePart` to WorkflowStrip**

In `src/src/components/stage/WorkflowStrip.jsx` add a `hidePart = false` prop and change the part condition to `{!slim && !viewing && !hidePart && strip.part ? (`. Add to `src/src/__tests__/workflowStripView.test.jsx`:

```js
test('the console hides Your part now in the strip (it lives in the footer)', () => {
  render(<WorkflowStrip strip={read} mode="full" onView={() => {}} hidePart />);
  expect(screen.queryByText('Your part now')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write the failing shell test**

```js
// src/src/__tests__/hostConsoleShell.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HostConsole from '../components/console/HostConsole';
import { stripFor } from '../config/workflowStrip';

const strip = stripFor({ gameType: 'call-and-answer', roundNoun: 'Round', state: 'ASK#002', totalRounds: 6, progress: { received: 3, total: 4 } });
const controls = {
  primary: { id: 'open-vote', label: 'Start voting', intent: 'finish', icon: 'ListChecks' },
  secondary: { id: 'skip', label: 'Skip this round', intent: 'skip', icon: 'SkipForward' },
  status: { text: '3 of 4 answered', tone: 'pending' },
};
const props = (over = {}) => ({
  moment: 'ANSWERING',
  top: { title: 'Relay expansion', code: '7924', onJoin: jest.fn(), presentHref: '/present?gameId=7924', presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() } },
  strip: { strip, mode: 'full', onView: jest.fn() },
  rail: {
    moment: 'ANSWERING',
    rounds: [{ n: 1, title: 'Churchill', state: 'done' }, { n: 2, title: 'Meiji', state: 'now' }],
    people: [{ name: 'Ada', state: 'answered' }, { name: 'Omar', state: 'writing' }],
    counts: { players: 4, answered: 3, voted: 0 },
    late: [], connected: true, onOpenSection: jest.fn(),
  },
  footer: { status: controls.status, part: strip.part, controls, onAction: jest.fn(), shortcutsEnabled: false },
  ...over,
});

test('top: name, join code, room\'s window and its status', () => {
  render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(screen.getByText('Relay expansion')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Join 7924/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Room's window/ })).toHaveAttribute('href', '/present?gameId=7924');
  expect(screen.getByText("Room's window: on, full screen")).toBeInTheDocument();
});

test('the loop is there without Your part now; the footer carries it with the buttons', () => {
  const { container } = render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(container.querySelector('.hc-loop .wfs-part')).toBeNull();
  expect(container.querySelector('.hc-foot').textContent).toMatch(/Your part now/);
  expect(screen.getByRole('button', { name: /Start voting/ })).toBeInTheDocument();
});

test('the rail opens the moment\'s section; the host\'s choice holds until the moment changes (Review Focus 4)', () => {
  const { rerender, container } = render(<HostConsole {...props()}><div /></HostConsole>);
  const open = () => [...container.querySelectorAll('.hc-rail details')].filter((d) => d.open).map((d) => d.dataset.section);
  expect(open()).toEqual(['people']);
  fireEvent.click(container.querySelector('.hc-rail details[data-section="people"] summary'));
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props()}><div /></HostConsole>);
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props({ moment: 'READ', rail: { ...props().rail, moment: 'READ' } })}><div /></HostConsole>);
  expect(open()).toEqual(['late']);
});

test('People says the one count; a section\'s link opens the session menu at its tab', () => {
  const p = props();
  const { container } = render(<HostConsole {...p}><div /></HostConsole>);
  expect(container.querySelector('[data-section="people"] summary').textContent).toMatch('3 of 4 answered');
  fireEvent.click(screen.getByRole('button', { name: 'All players' }));
  expect(p.rail.onOpenSection).toHaveBeenCalledWith('players');
});

test('the panel is drawn in the main area', () => {
  render(<HostConsole {...props()}><div data-testid="panel">panel</div></HostConsole>);
  expect(screen.getByTestId('panel').closest('.hc-main')).not.toBeNull();
});
```

- [ ] **Step 3: Write the palette/contract test**

```js
// src/src/__tests__/hostConsolePalette.test.js
import fs from 'fs';
import path from 'path';
const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'console', 'HostConsole.css'), 'utf8');

test('every selector is scoped hc-', () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|})\s*([^{@}]+)\{/g) || [];
  for (const s of selectors) {
    const sel = s.replace(/^}?\s*/, '').replace(/\{$/, '').trim();
    for (const part of sel.split(',')) expect([part.trim(), /\.hc-/.test(part)]).toEqual([part.trim(), true]);
  }
});
test('the laptop ladder only: no size below 12px, none above 24px', () => {
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) {
    const n = Number(m[1]);
    expect(n >= 12 && n <= 24).toBe(true);
  }
  expect(css).not.toMatch(/var\(--(L|t)-/);
});
test('the main area scrolls; the footer is outside it (Review Focus 5)', () => {
  expect(css).toMatch(/\.hc-main\s*\{[^}]*overflow:\s*auto/);
  expect(css).toMatch(/grid-template-areas:\s*"top top"\s*"loop loop"\s*"rail main"\s*"foot foot"/);
});
test('no colour literal', () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleShell.test.jsx src/__tests__/hostConsolePalette.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 5: Write the components**

```jsx
// src/src/components/console/ConsoleTop.jsx
import React from 'react';
import CW from '../../config/consoleWords';
import { presentStatusFrom } from '../../config/presentStatus';

export default function ConsoleTop({ title, code, onJoin, presentHref, presentDetail }) {
  const status = presentStatusFrom(presentDetail);
  return (
    <header className="hc-top">
      <span className="hc-brand">Engagements</span>
      <span className="hc-name">{title}</span>
      <span className="hc-spacer" />
      {code ? (
        <button type="button" className="hc-code" onClick={onJoin} aria-label={`${CW.join} ${code}. Show the join code on the wall`}>
          {CW.join} <b>{code}</b>
        </button>
      ) : null}
      {presentHref ? <a className="hc-btn" href={presentHref} target="_blank" rel="noopener noreferrer">{`${CW.roomsWindow} ↗`}</a> : null}
      {status.state === 'closed' && presentHref ? (
        <a className={`hc-winstat is-${status.tone}`} href={presentHref} target="_blank" rel="noopener noreferrer" title={status.hint}>
          <span className="hc-dot" aria-hidden="true" />{status.label}
        </a>
      ) : (
        <span className={`hc-winstat is-${status.tone}`} title={status.hint} role="status">
          <span className="hc-dot" aria-hidden="true" />{status.label}
        </span>
      )}
    </header>
  );
}
```

```jsx
// src/src/components/console/ConsoleRail.jsx
import React, { useEffect, useState } from 'react';
import CW from '../../config/consoleWords';
import { consoleRailFor, peopleSummary } from '../../config/consoleRail';

const MARK = { answered: '✓', voted: '✓', here: '✓', writing: '…', 'not-yet': '…' };
const META = { answered: CW.answered, voted: CW.voted, writing: CW.stillWriting, 'not-yet': CW.notYet, here: '' };

function Section({ id, title, summary, alert = false, open, onToggle, children, link, onLink }) {
  return (
    <details className="hc-sec" data-section={id} open={open}>
      <summary onClick={(e) => { e.preventDefault(); onToggle(id); }}>
        {title}<span className={`hc-count${alert ? ' is-alert' : ''}`}>{summary}</span>
      </summary>
      {children}
      {link ? <button type="button" className="hc-link" onClick={onLink}>{link}</button> : null}
    </details>
  );
}

export default function ConsoleRail({ moment, rounds = [], people = [], counts = {}, late = [], connected = true, onOpenSection }) {
  const [open, setOpen] = useState(consoleRailFor(moment));
  useEffect(() => { setOpen(consoleRailFor(moment)); }, [moment]);
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));
  const nowRound = rounds.find((r) => r.state === 'now');
  return (
    <aside className="hc-rail" aria-label="Session">
      <Section id="queue" title={CW.queue} summary={nowRound ? `${nowRound.n} of ${rounds.length}` : ''} open={open === 'queue'} onToggle={toggle} link={CW.allRounds} onLink={() => onOpenSection('history')}>
        <ul className="hc-list">
          {rounds.map((r) => (
            <li key={r.n} className={r.state === 'now' ? 'is-now' : ''}>
              <span className="hc-n">{r.n}</span>
              <span>{r.title}{r.state !== 'later' ? <span className="hc-meta">{` · ${CW[r.state]}`}</span> : null}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="people" title={CW.people} summary={peopleSummary({ moment, ...counts })} open={open === 'people'} onToggle={toggle} link={CW.allPlayers} onLink={() => onOpenSection('players')}>
        <ul className="hc-list">
          {people.map((p) => (
            <li key={p.name}>
              <span className={MARK[p.state] === '✓' ? 'hc-tick' : 'hc-wait'}>{MARK[p.state]}</span>
              <span>{p.name}{META[p.state] ? <span className="hc-meta">{` · ${META[p.state]}`}</span> : null}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="late" title={CW.late} summary={String(late.length)} alert={late.length > 0} open={open === 'late'} onToggle={toggle} link={late.length ? CW.reviewLate : null} onLink={() => onOpenSection('history')}>
        {late.length ? (
          <ul className="hc-list">{late.map((l) => <li key={l.id}><span className="hc-tick">•</span><span>{l.label}<span className="hc-meta">{l.meta ? ` · ${l.meta}` : ''}</span></span></li>)}</ul>
        ) : <p className="hc-empty">{CW.noLate}</p>}
      </Section>
      <Section id="tools" title={CW.tools} summary={connected ? `● ${CW.connected}` : CW.offline} open={open === 'tools'} onToggle={toggle}>
        <ul className="hc-list">
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('questions')}>{CW.questions}</button></li>
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('history')}>{CW.rounds}</button></li>
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('settings')}>{CW.settings}</button></li>
        </ul>
      </Section>
    </aside>
  );
}
```

```jsx
// src/src/components/console/ConsoleFooter.jsx
import React from 'react';
import RW from '../../config/roundWords';
import HostActionBar from '../HostActionBar';

export default function ConsoleFooter({ status, part, controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey }) {
  return (
    <footer className="hc-foot">
      <div className="hc-status"><b>{status && status.text}</b></div>
      {part ? (
        <p className="hc-part">
          <span className="hc-part-k">{RW.yourPartLabel}</span>
          {part.before}{part.action ? <b className="hc-action">{part.action}</b> : null}{part.after}
        </p>
      ) : null}
      <div className="hc-acts">
        <HostActionBar
          controls={{ ...controls, status: { text: '', tone: '' } }}
          onAction={onAction}
          shortcutsEnabled={shortcutsEnabled}
          interceptAdvance={interceptAdvance}
          onBackKey={onBackKey}
        />
      </div>
    </footer>
  );
}
```

```jsx
// src/src/components/console/HostConsole.jsx
import React from 'react';
import ConsoleTop from './ConsoleTop';
import ConsoleRail from './ConsoleRail';
import ConsoleFooter from './ConsoleFooter';
import WorkflowStrip from '../stage/WorkflowStrip';
import './HostConsole.css';

/**
 * THE HOST CONSOLE (docs/superpowers/specs/2026-10-15-host-console-design.md):
 * the laptop's private screen on two screens. Data and callbacks only; the
 * page owns the session. The panel for the moment is the child.
 */
export default function HostConsole({ top, strip, rail, footer, children }) {
  return (
    <div className="hc" data-theme="dark">
      <ConsoleTop {...top} />
      <div className="hc-loop">{strip && strip.strip ? <WorkflowStrip {...strip} places={null} hidePart /> : null}</div>
      <ConsoleRail {...rail} />
      <main className="hc-main">{children}</main>
      <ConsoleFooter {...footer} />
    </div>
  );
}
```

```css
/* src/src/components/console/HostConsole.css
   THE HOST CONSOLE (host console spec). Two screens only; private laptop chrome.
   Laptop ladder 12 / 13 / 15 / 19 / 24px; dusk tokens; scope hc-. */
.hc { position: fixed; inset: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; grid-template-columns: 260px minmax(0, 1fr); grid-template-areas: "top top" "loop loop" "rail main" "foot foot"; background: var(--bg); color: var(--text); font-size: 15px; }
.hc-top { grid-area: top; display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-bottom: 1px solid rgb(var(--glow-rgb) / .12); }
.hc-brand { font-weight: 800; }
.hc-name { color: var(--muted); font-size: 13px; }
.hc-spacer { margin-left: auto; }
.hc-code, .hc-btn { font: inherit; font-size: 13px; font-weight: 700; color: var(--text); background: transparent; border: 1px solid rgb(var(--glow-rgb) / .22); border-radius: 8px; padding: 5px 12px; cursor: pointer; text-decoration: none; }
.hc-code b { color: var(--accent-text); letter-spacing: .06em; margin-left: 4px; }
.hc-winstat { font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 12px; border: 1px solid rgb(var(--glow-rgb) / .22); color: var(--text); text-decoration: none; }
.hc-winstat.is-success { border-color: var(--success); background: rgb(var(--success-rgb) / .14); }
.hc-winstat.is-warn { border-color: var(--warn); background: rgb(var(--warn-rgb) / .14); }
.hc-winstat.is-muted { color: var(--muted); }
.hc-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.hc-winstat.is-success .hc-dot { background: var(--success); }
.hc-winstat.is-warn .hc-dot { background: var(--warn); }
.hc-loop { grid-area: loop; border-bottom: 1px solid rgb(var(--glow-rgb) / .12); }
.hc-loop .wfs { border-bottom: 0; }
.hc-rail { grid-area: rail; border-right: 1px solid rgb(var(--glow-rgb) / .12); overflow: auto; padding: 8px 0; }
.hc-sec { border-bottom: 1px solid rgb(var(--glow-rgb) / .12); }
.hc-sec summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13px; font-weight: 700; }
.hc-sec summary::-webkit-details-marker { display: none; }
.hc-count { margin-left: auto; font-size: 12px; color: var(--muted); font-weight: 600; }
.hc-count.is-alert { color: var(--accent-text); }
.hc-list { list-style: none; margin: 0; padding: 0 14px 10px; display: grid; gap: 6px; font-size: 13px; }
.hc-list li { display: flex; gap: 8px; align-items: baseline; }
.hc-n { width: 20px; height: 20px; border-radius: 6px; background: var(--surface-2); display: inline-grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
.hc-list li.is-now .hc-n { background: var(--info); color: var(--bg); }
.hc-meta { color: var(--muted); font-size: 12px; }
.hc-tick { color: var(--success-text); font-weight: 800; }
.hc-wait { color: var(--muted); }
.hc-empty { margin: 0; padding: 0 14px 10px; font-size: 13px; color: var(--muted); }
.hc-link { font: inherit; font-size: 12px; font-weight: 700; color: var(--info); background: transparent; border: 0; padding: 0 14px 10px; cursor: pointer; text-align: left; }
.hc-list .hc-link { padding: 0; font-size: 13px; }
.hc-main { grid-area: main; overflow: auto; padding: 16px 20px; display: grid; gap: 14px; align-content: start; }
.hc-foot { grid-area: foot; display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-top: 1px solid rgb(var(--glow-rgb) / .12); background: var(--surface); }
.hc-status { font-size: 15px; }
.hc-part { margin: 0; font-size: 13px; color: var(--muted); max-width: 52ch; }
.hc-part-k { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-right: .6em; }
.hc-action { color: var(--accent-text); }
.hc-acts { margin-left: auto; }
.hc-acts .host-action-bar__status { display: none; }
```

Check `--success-rgb`, `--warn-rgb`, `--glow-rgb`, `--success-text` exist in `src/src/styles/roles.css` (they do as of 15 Oct); `--warn` and `--info` too.

- [ ] **Step 6: Run the tests to verify they pass, and the skin ratchet**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleShell.test.jsx src/__tests__/hostConsolePalette.test.js src/__tests__/workflowStripView.test.jsx src/__tests__/skinLiteralsPalette.test.js`
Expected: PASS. If the palette test's selector parser trips on `::-webkit-details-marker`, keep the rule (it is scoped by `.hc-sec`) and widen the parser to accept pseudo-elements.

- [ ] **Step 7: Commit**

```bash
git add src/src/components/console src/src/components/stage/WorkflowStrip.jsx src/src/__tests__/hostConsoleShell.test.jsx src/src/__tests__/hostConsolePalette.test.js src/src/__tests__/workflowStripView.test.jsx
git commit -m "Host console: the shell (top with the room's-window status, the loop, the rail, the footer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The responses panel (answering, voting, results, between rounds)

**Files:**
- Create: `src/src/components/console/panels/ResponsesPanel.jsx`
- Modify: `src/src/components/console/HostConsole.css` (panel rules, scoped `.hc-`)
- Test: `src/src/__tests__/hostConsoleResponses.test.jsx`

**Interfaces:**
- Consumes: `navigatorLabel(answer, index, { phase, authorsHidden })` from `src/src/config/navigatorOrder.js`; `CW`.
- Produces: `<ResponsesPanel kicker title task notes responses={[{answer, playerName?, name?, points?, isNew?}]} phase="ASK"|"VOTE"|"RESULTS"|"BETWEEN" authorsHidden onWallIndex onPutOnWall={(index) => void} stillWriting={number} side={ReactNode|null} upNext={{title, task}|null} />`

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/hostConsoleResponses.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ResponsesPanel from '../components/console/panels/ResponsesPanel';

const R = [
  { answer: 'Weekly status meetings', playerName: 'Ada' },
  { answer: 'The paper sign-off sheet', playerName: 'Ben' },
  { answer: 'The Friday phone round-up', playerName: 'Cleo', isNew: true },
];

test('answering: the task, responses newest first, names hidden, still writing (Review Focus 1)', () => {
  render(<ResponsesPanel kicker="Round 2 · Answering" title="Meiji" task="Which process must go?" phase="ASK" responses={R} authorsHidden stillWriting={1} />);
  expect(screen.getByText('Which process must go?')).toBeInTheDocument();
  const items = screen.getAllByTestId('hc-resp').map((n) => n.textContent);
  expect(items[0]).toMatch('The Friday phone round-up');
  expect(items.join(' ')).not.toMatch(/Ada|Ben|Cleo/);
  expect(screen.getByText(/1 still writing/)).toBeInTheDocument();
});

test('voting: the room\'s order, Response N always, the one on the wall marked, a press puts one up', () => {
  const onPutOnWall = jest.fn();
  render(<ResponsesPanel kicker="Round 2 · Voting" title="The ballot" phase="VOTE" responses={R} authorsHidden={false} onWallIndex={2} onPutOnWall={onPutOnWall} />);
  const items = screen.getAllByTestId('hc-resp');
  expect(items[0].textContent).toMatch('Response 1');
  expect(items.map((n) => n.textContent).join(' ')).not.toMatch(/Ada|Ben|Cleo/);
  expect(items[2]).toHaveClass('is-onwall');
  fireEvent.click(items[1]);
  expect(onPutOnWall).toHaveBeenCalledWith(1);
});

test('results on a named round show names', () => {
  render(<ResponsesPanel kicker="Round 2 · Results" title="Results" phase="RESULTS" responses={R} authorsHidden={false} />);
  expect(screen.getAllByTestId('hc-resp')[0].textContent).toMatch('Ada');
});

test('no responses yet says so', () => {
  render(<ResponsesPanel kicker="k" title="t" phase="ASK" responses={[]} authorsHidden />);
  expect(screen.getByText('No responses yet.')).toBeInTheDocument();
});

test('between rounds shows Up next', () => {
  render(<ResponsesPanel kicker="k" title="t" phase="BETWEEN" responses={[]} upNext={{ title: 'Fleming', task: 'What accident is worth a second look?' }} />);
  expect(screen.getByText('Fleming')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleResponses.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the panel**

```jsx
// src/src/components/console/panels/ResponsesPanel.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import { navigatorLabel } from '../../../config/navigatorOrder';

/**
 * The responses, as the host works with them (host console spec §3.4):
 * answering (newest first, names hidden while hidden), voting (the room's
 * order, always "Response N"), results, and between rounds (with Up next).
 * Pressing a response puts it on the wall when onPutOnWall is given.
 */
export default function ResponsesPanel({
  kicker, title, task = '', notes = '', phase, responses = [], authorsHidden = true,
  onWallIndex = null, onPutOnWall = null, stillWriting = 0, side = null, upNext = null,
}) {
  const ordered = phase === 'ASK'
    ? responses.map((r, i) => ({ r, i })).reverse()
    : responses.map((r, i) => ({ r, i }));
  const labelPhase = phase === 'VOTE' ? 'VOTE' : phase === 'RESULTS' ? 'RESULTS' : 'ASK';
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{kicker}</p>
      <h2 className="hc-h">{title}</h2>
      {task ? <div className="hc-task"><span className="hc-task-k">{CW.theTask}</span>{task}</div> : null}
      <div className={`hc-cols${side ? '' : ' is-one'}`}>
        <div className="hc-resps">
          {ordered.length === 0 ? <p className="hc-muted">{CW.waitingForResponses}</p> : null}
          {ordered.map(({ r, i }) => {
            const label = navigatorLabel(r, i, { phase: labelPhase, authorsHidden: phase === 'VOTE' ? true : authorsHidden });
            const onWall = onWallIndex === i;
            const Tag = onPutOnWall ? 'button' : 'div';
            return (
              <Tag
                key={i}
                type={onPutOnWall ? 'button' : undefined}
                data-testid="hc-resp"
                className={`hc-resp${onWall ? ' is-onwall' : ''}${r.isNew ? ' is-new' : ''}`}
                onClick={onPutOnWall ? () => onPutOnWall(i) : undefined}
              >
                <small>{label}{onWall ? ` · ${CW.onTheWall}` : ''}</small>
                {r.answer}
              </Tag>
            );
          })}
          {stillWriting > 0 ? <p className="hc-muted">{`${stillWriting} ${CW.stillWriting}`}</p> : null}
          {onPutOnWall ? <p className="hc-muted">{CW.pressToWall}</p> : null}
          {upNext ? <div className="hc-card"><h3 className="hc-card-h">{CW.upNext}</h3><p className="hc-strong">{upNext.title}</p><p className="hc-muted">{upNext.task}</p></div> : null}
        </div>
        {side}
      </div>
    </section>
  );
}
```

Panel CSS appended to `HostConsole.css`:

```css
.hc-panel { display: grid; gap: 12px; }
.hc-kicker { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.hc-h { margin: 0; font-size: 24px; line-height: 1.2; }
.hc-task { border-left: 3px solid var(--accent); padding: 6px 10px; background: var(--surface); border-radius: 0 8px 8px 0; }
.hc-task-k { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.hc-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.hc-cols.is-one { grid-template-columns: minmax(0, 1fr); }
.hc-resps { display: grid; gap: 8px; }
.hc-resp { display: block; width: 100%; text-align: left; font: inherit; color: var(--text); background: var(--surface); border: 1px solid rgb(var(--glow-rgb) / .12); border-radius: 10px; padding: 8px 12px; }
button.hc-resp { cursor: pointer; }
.hc-resp small { display: block; font-size: 12px; color: var(--muted); }
.hc-resp.is-new { border-color: var(--success); }
.hc-resp.is-onwall { border-color: var(--info); box-shadow: 0 0 0 1px var(--info); }
.hc-card { background: var(--surface); border: 1px solid rgb(var(--glow-rgb) / .12); border-radius: 10px; padding: 10px 12px; }
.hc-card-h { margin: 0 0 6px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.hc-muted { margin: 0; font-size: 13px; color: var(--muted); }
.hc-strong { margin: 0 0 4px; font-weight: 700; }
```

The host's notes reach the panel as `side` (Task 8 builds the "For you" card).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleResponses.test.jsx src/__tests__/hostConsolePalette.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/console/panels/ResponsesPanel.jsx src/src/components/console/HostConsole.css src/src/__tests__/hostConsoleResponses.test.jsx
git commit -m "Host console: the responses panel (answering, voting, results, between rounds)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The composer body, inline; the read panel; the simple panels

**Files:**
- Modify: `src/src/components/AskComposer.jsx` (extract `AskComposerBody`)
- Create: `src/src/components/console/panels/ReadPanel.jsx`, `src/src/components/console/panels/SimplePanels.jsx`
- Test: `src/src/__tests__/hostConsoleRead.test.jsx`; run `src/src/__tests__/askTheRoom.test.jsx`

**Interfaces:**
- Produces:
  - `AskComposerBody(props)`: the same props as `AskComposer` minus the dialog-only ones (`sheet`, `theme`), rendering the form and a footer with Cancel and Send; `AskComposer` renders `<Modal>` around `<AskComposerBody>`.
  - `<ReadPanel kicker markdown page pages askAddon afterRead composer={ReactNode|null} />`: draws the read with `MarkdownRenderer` and the composer in the right column when given.
  - `SimplePanels`: `LobbyPanel({ code, joined:[name], firstTask, chooser:ReactNode|null })`, `RoomQuestionPanel({ children })` (wraps `AskStage`), `FeedbackPanel({ comments:[{commentId,text,anchorLabel,featured}], onFeature })`, `EndedPanel({ onOpenReport })`.

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/hostConsoleRead.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskComposerBody } from '../components/AskComposer';
import ReadPanel from '../components/console/panels/ReadPanel';
import { LobbyPanel, FeedbackPanel, EndedPanel } from '../components/console/panels/SimplePanels';

test('the composer body renders without a dialog, and sends', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true });
  const onClose = jest.fn();
  render(<AskComposerBody suggestions={[]} onSend={onSend} onClose={onClose} />);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'The question the room sees' }), { target: { value: 'Who first?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to the room' }));
  await screen.findByRole('button', { name: 'Send to the room' });
  expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ideas', question: 'Who first?' }));
});

test('the read panel draws the read, and the composer beside it when open', () => {
  render(<ReadPanel kicker="Round 2 · What we heard · page 1 of 2" markdown={'## Discussion topics\n- Who would miss it?'} composer={<div data-testid="composer" />} />);
  expect(screen.getByText('Who would miss it?')).toBeInTheDocument();
  expect(screen.getByTestId('composer').closest('.hc-cols')).not.toBeNull();
});

test('lobby: the code, who has joined, or nobody yet', () => {
  const { rerender } = render(<LobbyPanel code="7924" joined={['Ada', 'Ben']} firstTask="Which process must go?" />);
  expect(screen.getByText('7924')).toBeInTheDocument();
  expect(screen.getByText('Ada')).toBeInTheDocument();
  rerender(<LobbyPanel code="7924" joined={[]} />);
  expect(screen.getByText('Nobody has joined yet.')).toBeInTheDocument();
});

test('feedback: comments as they land, pressable to the wall', () => {
  const onFeature = jest.fn();
  render(<FeedbackPanel comments={[{ commentId: 'c1', text: 'Fair', anchorLabel: 'Workie\'s read', featured: false }]} onFeature={onFeature} />);
  fireEvent.click(screen.getByRole('button', { name: /Fair/ }));
  expect(onFeature).toHaveBeenCalledWith('c1');
});

test('ended: open the report', () => {
  const onOpenReport = jest.fn();
  render(<EndedPanel onOpenReport={onOpenReport} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open session report' }));
  expect(onOpenReport).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleRead.test.jsx`
Expected: FAIL (`AskComposerBody` not exported, modules not found).

- [ ] **Step 3: Split `AskComposer`**

In `src/src/components/AskComposer.jsx`, move everything inside `<div className="askp-root">…</div>` and its state into `export function AskComposerBody({ suggestions, startIndex, readLines, onSend, onComments, onClose, blocked, oneScreen })`, which returns:

```jsx
    <div className="askp askc askc--inline">
      <div className="askp-root">{/* header (title + ×), body, footer exactly as today */}</div>
    </div>
```

and make the default export:

```jsx
export default function AskComposer({ sheet = false, theme = 'dark', onClose, ...rest }) {
  return (
    <Modal
      overlayClassName={`ui-scrim${sheet ? ' askc-scrim--sheet' : ''}`}
      contentClassName={`ui-dialog askp askc${sheet ? ' askc--sheet' : ''}`}
      onClose={onClose}
      closeOnEscape={() => true}
      labelledBy="askc-title"
      theme={theme}
    >
      <AskComposerBody {...rest} onClose={onClose} />
    </Modal>
  );
}
```

Keep the busy-blocks-close behaviour: `AskComposerBody` owns `busy`; pass it up with an `onBusyChange` prop the dialog uses for `closeOnEscape={() => !busy}` (`const [busy, setBusy] = useState(false)` in `AskComposer`). The inline body drops the outer `askp askc` classes when rendered by `AskComposer` (pass `inline={false}`); `askc--inline` CSS in `AskPreview.css`: `.askc.askc--inline { width: 100%; border: 1px solid var(--rule-strong); border-radius: 12px; background: var(--surface); }`.

- [ ] **Step 4: Write `ReadPanel` and `SimplePanels`**

```jsx
// src/src/components/console/panels/ReadPanel.jsx
import React from 'react';
import MarkdownRenderer from '../../MarkdownRenderer';
import CW from '../../../config/consoleWords';

export default function ReadPanel({ kicker, markdown, askAddon = null, afterRead = null, composer = null }) {
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{kicker}</p>
      <div className={`hc-cols${composer ? ' is-read' : ' is-one'}`}>
        <div className="hc-card">
          <h3 className="hc-card-h">{`${CW.readTitle} · ${CW.readOnWall}`}</h3>
          <MarkdownRenderer content={markdown || ''} className="hc-md" listItemAddon={askAddon} />
          {afterRead}
        </div>
        {composer}
      </div>
    </section>
  );
}
```

```jsx
// src/src/components/console/panels/SimplePanels.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import RW from '../../../config/roundWords';

export function LobbyPanel({ code, joined = [], firstTask = '', chooser = null }) {
  if (chooser) return <section className="hc-panel">{chooser}</section>;
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.joinedSoFar}</p>
      <p className="hc-code-big">{code}</p>
      {joined.length ? <ul className="hc-list hc-list--flat">{joined.map((n) => <li key={n}>{n}</li>)}</ul> : <p className="hc-muted">{CW.nobodyYet}</p>}
      {firstTask ? <div className="hc-task"><span className="hc-task-k">{CW.theTask}</span>{firstTask}</div> : null}
    </section>
  );
}

export function RoomQuestionPanel({ children }) {
  return <section className="hc-panel">{children}</section>;
}

export function FeedbackPanel({ comments = [], onFeature }) {
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.commentsTitle}</p>
      {comments.length === 0 ? <p className="hc-muted">{CW.noComments}</p> : null}
      <div className="hc-resps">
        {comments.map((c) => (
          <button key={c.commentId} type="button" className={`hc-resp${c.featured ? ' is-onwall' : ''}`} onClick={() => onFeature(c.commentId)}>
            <small>{c.anchorLabel}{c.featured ? ` · ${CW.onTheWall}` : ''}</small>
            {c.text}
          </button>
        ))}
      </div>
    </section>
  );
}

export function EndedPanel({ onOpenReport }) {
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.reportSoFar}</p>
      <button type="button" className="hc-btn" onClick={onOpenReport}>{RW.openReport}</button>
    </section>
  );
}
```

Append to `HostConsole.css`:

```css
.hc-cols.is-read { grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); }
.hc-code-big { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: .08em; color: var(--accent-text); }
.hc-list--flat { padding: 0; }
.hc-md { font-size: 15px; }
```

- [ ] **Step 5: Run the tests**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleRead.test.jsx src/__tests__/askTheRoom.test.jsx src/__tests__/hostConsolePalette.test.js`
Expected: PASS. `askTheRoom.test.jsx` must stay green: the dialog behaves as before.

- [ ] **Step 6: Commit**

```bash
git add src/src/components/AskComposer.jsx src/src/components/AskPreview.css src/src/components/console/panels src/src/components/console/HostConsole.css src/src/__tests__/hostConsoleRead.test.jsx
git commit -m "Host console: the composer body inline, the read panel and the simple panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the console into the host page

**Files:**
- Modify: `src/src/GameHostPage.jsx`
- Test: `src/src/__tests__/hostConsoleWiring.test.js`

**Interfaces:**
- Consumes: everything above; page state `answers`, `players`, `playersWhoAnswered`, `playersWhoVoted`, `currentQuestion` (from `questions[0]`), `spotlightIndex`, `openSpotlight(idx)`, `currentAIInsights`, `stagePageIndex`, `roundComments`, `handleFeatureComment(commentId)`, `rounds`, `lessonNumber`, `roundOf`, `presenting`, `setQrMode`, `roundAsks`, `askComposer`/`setAskComposer`, `sendRoomAsk`, `requestFeedbackRound`, `pickRoomIdea`, `workflow`, `viewing`, `viewStep`, `dockControls`, `runHostAction`, `hostControls.step.moment`, `anonymousUntilReveal`, `authorsRevealed`, `openSetupAt(tab)`, `wsConnected`, `twoSurfaces`, `eventCode`, `currentGameType`.
- Produces: state `presentDetail`, `hostNotes` (set from the existing `/host-state` read, ~line 1110: `setPresentDetail(data.presentDetail || null); setHostNotes(data.hostNotes || null);`), a `presentChanged` socket handler that re-reads host-state, and `const useConsole = twoSurfaces && !eventCode && ['call-and-answer','trivia','poll','wavelength'].includes(normalizeGameType(currentGameType));`.

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/hostConsoleWiring.test.js
import fs from 'fs';
import path from 'path';
const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

test('the console renders only on two screens, round types, outside an event', () => {
  expect(page).toMatch(/const useConsole = twoSurfaces && !eventCode && \['call-and-answer', 'trivia', 'poll', 'wavelength'\]\.includes\(normalizeGameType\(currentGameType\)\)/);
  expect(page).toMatch(/useConsole \? \(\s*<HostConsole/);
});
test('the host-state read keeps the window status and the host notes', () => {
  expect(page).toMatch(/setPresentDetail\(data\.presentDetail \|\| null\)/);
  expect(page).toMatch(/setHostNotes\(data\.hostNotes \|\| null\)/);
  expect(page).toMatch(/onMessage\('presentChanged'/);
});
test('in the console the composer is inline, not the dialog', () => {
  expect(page).toMatch(/<AskComposerBody/);
});
test('one screen still renders the stage', () => {
  expect(page).toMatch(/<Stage\b/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleWiring.test.js`
Expected: FAIL.

- [ ] **Step 3: Add the state and the reads**

Beside `const [presenting, setPresenting] = useState(0);`:

```js
  // The room's window and the host's notes, from the host door (host console spec §4.2).
  const [presentDetail, setPresentDetail] = useState(null);
  const [hostNotes, setHostNotes] = useState(null);
```

In the `/host-state` read (the effect with `setPresenting(Number(data.presenting) || 0);` ~line 1110), add after it:

```js
        setPresentDetail(data.presentDetail || null);
        setHostNotes(data.hostNotes || null);
```

Extract that read into `const readHostState = useCallback(async () => { … }, [gameId]);` if needed so the socket handler can call it, and register, with the other `webSocketClient.onMessage` handlers:

```js
    webSocketClient.onMessage('presentChanged', () => { readHostStateRef.current(); });
```

(keep a ref, `readHostStateRef.current = readHostState`, as the page does for other handlers registered once), and `offMessage('presentChanged')` in that effect's cleanup.

- [ ] **Step 4: Build the console's props and render it**

Just before the page's main `return (` that renders `<Stage>` (~line 7570), add:

```js
  const useConsole = twoSurfaces && !eventCode && ['call-and-answer', 'trivia', 'poll', 'wavelength'].includes(normalizeGameType(currentGameType));
  const consoleMoment = hostControls.step ? hostControls.step.moment : 'UNKNOWN';
  const consolePeople = players.map((p) => {
    const name = p.name || p.playerName;
    let state = 'here';
    if (consoleMoment === 'ANSWERING') state = playersWhoAnswered.includes(name) ? 'answered' : 'writing';
    else if (consoleMoment === 'VOTING' || consoleMoment === 'VOTE_RESPONSES') state = playersWhoVoted.includes(name) ? 'voted' : 'not-yet';
    return { name, state };
  });
  const consoleRounds = (rounds || []).map((r, i) => ({ n: i + 1, title: r.title || r.questionTitle || '', state: 'done' }))
    .concat(lessonNumber > 0 && currentQuestion ? [{ n: lessonNumber, title: currentQuestion.title || '', state: 'now' }] : []);
  const consoleComposer = askComposer ? (
    <AskComposerBody
      suggestions={(roundAsks.suggestions || []).map((ask, index) => ({ index, ask, section: ask && ask.anchor ? ask.anchor.section : '', point: ask && ask.anchor ? ask.anchor.point : null, sent: !roundAsks.unsent.some((u) => u.index === index) }))}
      startIndex={askComposer.startIndex}
      readLines={readLinesOf(currentAIInsights && currentAIInsights.markdownResponse)}
      onSend={sendRoomAsk}
      onComments={roundAsks.enabled ? requestFeedbackRound : null}
      onClose={() => setAskComposer(null)}
      blocked={Boolean(roundAsks.live)}
    />
  ) : null;
  const authorsHiddenNowForConsole = anonymousUntilReveal !== false && !authorsRevealed;
  const consolePanel = (() => {
    if (viewStep) return <StepView step={viewStep} facts={{ title: eventTitle, twoScreens: true, presenting, playerCount: players.length, answered: answeredCount, voted: playersWhoVoted.length, roundsPlayed: hostPhase === 'ASK' ? Math.max(0, lessonNumber - 1) : lessonNumber }} onAllSettings={() => openSetupAt('settings')} />;
    if (showRoomScreen) return <LobbyPanel chooser={<RoomScreenChooser current={roomScreenChoice} presentHref={gameId ? presentHref(gameId) : ''} onChoose={chooseRoomScreen} onClose={roomScreenChoice ? () => setRoomScreenOpen(false) : null} />} />;
    const task = currentQuestion ? resolveInstruction(currentQuestion, currentQuestion.setCustomInstruction, currentGameType) : '';
    const notesCard = hostNotes && hostNotes.background
      ? <div className="hc-card"><h3 className="hc-card-h">{CW.forYou}</h3><p className="hc-muted">{hostNotes.background}</p></div>
      : null;
    const kicker = (label) => `${workflow && workflow.round ? workflow.round.label : ''} · ${label}`;
    switch (consoleMoment) {
      case 'LOBBY': return <LobbyPanel code={eventCode || gameId} joined={players.map((p) => p.name || p.playerName)} firstTask={task} />;
      case 'ANSWERING': return <ResponsesPanel kicker={kicker('Answering')} title={currentQuestion?.title || ''} task={task} phase="ASK" responses={answers} authorsHidden={authorsHiddenNowForConsole} stillWriting={Math.max(0, players.length - answeredCount)} side={notesCard} />;
      case 'VOTING':
      case 'VOTE_RESPONSES': return <ResponsesPanel kicker={kicker('Voting')} title={CW.theBallot} phase="VOTE" responses={answers} authorsHidden onWallIndex={spotlightIndex === null ? 0 : spotlightIndex} onPutOnWall={openSpotlight} />;
      case 'RESULTS':
      case 'RESPONSES': return <ResponsesPanel kicker={kicker('Results')} title={CW.resultsTitle} phase="RESULTS" responses={answers} authorsHidden={authorsHiddenNowForConsole} onWallIndex={spotlightIndex} onPutOnWall={openSpotlight} />;
      case 'READ': return <ReadPanel kicker={kicker(`What we heard · ${RW.pageOf(stagePageIndex + 1, notesSyncPages)}`)} markdown={currentAIInsights && currentAIInsights.markdownResponse} askAddon={askAddon} afterRead={askAfter} composer={consoleComposer} />;
      case 'FEEDBACK': return <FeedbackPanel comments={roundComments} onFeature={handleFeatureComment} />;
      case 'ROOM_QUESTION':
      case 'ROOM_RESULTS': return <RoomQuestionPanel><AskStage ask={roundAsks.shown} total={players.length} onPick={pickRoomIdea} /></RoomQuestionPanel>;
      case 'ENDED': return <EndedPanel onOpenReport={() => runHostAction({ intent: HOST_INTENTS.REPORT })} />;
      default: return null;
    }
  })();
```

`notesSyncPages` is the page count the page already computes (~line 6090, `prosePageSlice(…).pages`); check `RW.pageOf` exists in `roundWords.js` and add `pageOf: (n, of) => \`page ${n} of ${of}\`` if it does not.

Wrap the page's main return so that, when `useConsole`, it renders the console instead of `<div className="main-layout"><Stage …>…</Stage></div>`, keeping every sibling after `</Stage>` (the Session panel, dialogs, the composer dialog for one screen):

```jsx
    {useConsole ? (
      <HostConsole
        moment={consoleMoment}
        top={{ title: eventTitle, code: eventCode || gameId, onJoin: () => setQrMode('pinned'), presentHref: gameId ? presentHref(gameId) : '', presentDetail }}
        strip={workflow ? { strip: workflow, mode: 'full', viewing, onView: stripOnView, viewingWhere: liveWhere(workflow), onBack: () => { setViewingStep(null); setAskComposer(null); } } : null}
        rail={{ moment: consoleMoment, rounds: consoleRounds, people: consolePeople, counts: { players: players.length, answered: answeredCount, voted: playersWhoVoted.length }, late: [], connected: wsConnected, onOpenSection: openSetupAt }}
        footer={{ status: hostControls.status, part: workflow ? workflow.part : null, controls: dockControls, onAction: runHostAction, shortcutsEnabled: !anyOverlayOpen, interceptAdvance: consoleInterceptAdvance, onBackKey: consoleOnBackKey }}
      >
        {consolePanel}
      </HostConsole>
    ) : (
      <div className="main-layout">{/* the existing <Stage …> … </Stage> unchanged */}</div>
    )}
```

Lift the existing `onView` arrow (currently inline in the `<WorkflowStrip>` props) into `const stripOnView = (id) => { … }` and use it in both places. Lift the dock's `interceptAdvance` and `onBackKey` arrows into `consoleInterceptAdvance` / `consoleOnBackKey` and use them in both places. In the console, the composer is inline, so the one-screen dialog mount after `</Stage>` must render only when `!useConsole`: change it to `{askComposer && !useConsole && ( <AskComposer … /> )}`.

Imports to add: `HostConsole`, `ResponsesPanel`, `ReadPanel`, `{ LobbyPanel, RoomQuestionPanel, FeedbackPanel, EndedPanel }`, `{ AskComposerBody }` (with the default `AskComposer`), `CW` from `./config/consoleWords`, `resolveInstruction` from `./config/instructions` (if not already imported).

- [ ] **Step 5: Run the wiring test and the page's suites**

Run: `cd src && CI=true npx jest src/__tests__/hostConsoleWiring.test.js src/__tests__/stageShell src/__tests__/workflowStrip src/__tests__/hostSessionEnded src/__tests__/roundStepParity`
Expected: PASS. The page's mounted suites run with two screens off by default in jsdom (`window.ENV` is unset), so they keep exercising `<Stage>`.

- [ ] **Step 6: Full gates**

Run (from the repo root):
```bash
rm -rf .aws-sam; f=0; for t in tests/*.js; do [[ $t == *verify-question-set-ui.spec.js ]] && continue; node "$t" >/dev/null 2>&1 || { f=$((f+1)); echo FAIL $t; }; done; echo backend_fail=$f
cd src && CI=true npx jest 2>&1 | grep -E "^Tests:|^Test Suites:|^FAIL"; npm run lint 2>&1 | grep -E "✖"; npm run build 2>&1 | grep -E "compiled|Failed"
```
Expected: `backend_fail=0`, every suite passed, lint 0 errors, build compiled.

- [ ] **Step 7: Commit and push to dev**

```bash
git add src/src/GameHostPage.jsx src/src/__tests__/hostConsoleWiring.test.js
git commit -m "Host console: the host page renders it on two screens (round types, outside events); one screen keeps the stage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git fetch -q origin && git merge-base --is-ancestor origin/dev HEAD && git push -q origin HEAD:refs/heads/dev && git push -q origin HEAD
```

---

### Task 9: Walk it on dev

**Files:** none (fixes found here go in their own commits with tests).

- [ ] **Step 1:** Wait for the dev pipeline (`AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 1`), or poll the bundle for the string `Room's window: not open`.
- [ ] **Step 2:** In the browser pane, signed in on `https://engage.dev.seibtribe.us/host`, Quick start a Call & Answer set with two screens on (`localStorage engage.surfaces = two`). Join three test players with the scratchpad bot (`node bot.js join <code> <name>`), answer and vote with it.
- [ ] **Step 3:** At 1366×768 and 1440×900, for each moment (lobby, answering, voting, results, the read with Ask open, a question live and closed, feedback, ended), measure: the footer's main button inside the viewport (`getBoundingClientRect().bottom <= innerHeight`), no page-level horizontal scroll, the rail section that opened, the names hidden in voting.
- [ ] **Step 4:** The window status through its states: no Present window (not open), open `/present` in another tab (open, not full screen), make it full screen (on), hide its tab (hidden), close it (not open within 90 s).
- [ ] **Step 5:** One screen unchanged: switch `engage.surfaces` to `classic`, reload, confirm the stage and the slim strip, then switch back.
- [ ] **Step 6:** Report the walk to the owner with the commit, and, if green, promote to test with "Ready for review" and a `reviewable/<date>-<sha>` tag (merge `origin/dev` into `origin/test` in a scratch worktree; never fast-forward test).
