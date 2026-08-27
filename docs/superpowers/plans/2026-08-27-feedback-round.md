# Feedback Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host control on the AI feedback phase opens a feedback round in which every participant holds the round's report on their own device, comments on individual sections of it, and those comments appear in the round report and the session report, labelled as comments.

**Architecture:** A feedback round is a third *beat* of RESULTS (`stage-beat.js`), not a new game state and not a new round kind — so it stays keyed to the round it annotates and needs no new ordinal. Comments are their own rows in the session's DynamoDB partition, anchored to a section by kind + position, carrying their own label and excerpt so they never have to re-resolve an index. `PastRound`'s body is extracted into a shared `RoundReport` renderer so the host's modal and the participant's inline surface are one component in two containers.

**Tech Stack:** Node 22 Lambda (CommonJS, `@aws-sdk/lib-dynamodb`), single-table DynamoDB, SAM (`template-clean.yaml`), React 18 + Jest/RTL, plain-node backend test scripts.

**Spec:** `docs/superpowers/specs/2026-08-27-feedback-round-design.md`

## Global Constraints

- **Every test is watched failing first**, for the reason predicted. If the red is not the predicted red, the test is wrong — fix the test.
- **No assertion may compare a handler's output to another field of the same response.** Expected values are constructed independently.
- Backend tests are standalone: `node tests/<file>.js`. **No jest for the backend.**
- Frontend: `cd src && CI=true npx jest`.
- Baselines that must hold: backend **103 suites / 3265 passed / 0 failed**; frontend **189 suites / 4720 tests**; lint 0 errors + 11 known `exhaustive-deps` warnings; build clean with 2 known size warnings.
- `template-clean.yaml` changes must pass `sam validate --template template-clean.yaml --region us-east-1 --lint`.
- Commit style: plain descriptive sentences, no emoji, no conventional-commit prefix. End every message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do NOT run `npm install`. Never use bare `git stash`.
- `tenant-crypto.js` exists in **three byte-identical copies**; `anonymity.js` in two. Edit all copies or the build fails.
- CSS: one stylesheet per surface, every selector namespaced, colour via tokens only, nothing under the 12px floor, no geometric assertions in tests, palette test named `*Palette*` never `*Token*`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/src/config/comments.js` | **New.** The anchor vocabulary — closed kind set, SK-safe validation, `anchorLabelFor`, `excerptOf`, `MAX_COMMENT`. The single source both surfaces and the tests read. |
| `lambda-functions/game/comments.js` | **New.** `POST`/`GET /games/{gameId}/comments`. Validation, the round+beat gate, encryption, broadcast. |
| `lambda-functions/game/comment-keys.js` | **New.** SK build/parse, kept out of the handler so tests can assert the format without stubbing AWS. |
| `src/src/components/RoundReport.jsx` | **New.** The presentational round artifact extracted from `PastRound` — question, responses, AI summary, and comments under their anchors. |
| `src/src/components/RoundReport.css` | **New.** Comment blocks and the commentable-section affordance only. The report body keeps its existing rules in `styles.css`. |
| `lambda-functions/game/stage-beat.js` | Modify: `BEATS` gains `'feedback'`. |
| `lambda-functions/game/create-report.js` | Modify: comments into `detailedQuestions[i]` and `gameStats.totalComments`. |
| `lambda-functions/{game,websocket,admin/shared}/tenant-crypto.js` | Modify ×3: the `comment` entity. |
| `template-clean.yaml` | Modify: `CommentsFunction` + two routes. |
| `src/src/config/hostControls.js` | Modify: `STAGE_BEATS`, `HOST_PHASES`, `HOST_INTENTS`, the `FIELD_NOTES` secondary, the `FEEDBACK` case. |
| `src/src/config/sessionHistory.js` | Modify: carry `comments` through `roundsFrom`. |
| `src/src/components/PastRound.jsx` | Modify: render `<RoundReport>`. |
| `src/src/PlayerPage.jsx` | Modify: the feedback branch. |
| `src/src/GameHostPage.jsx` | Modify: the beat, the intent, the comment fetch, forwarding to `GameReport`. |
| `src/src/WebSocketClient.js` | Modify: `commentPosted`. |
| `src/src/components/GameReport.jsx` / `.css` | Modify: the comments block, print-safe. |

---

### Task 1: The anchor vocabulary

The closed set both ends validate against, and the helpers that make a comment carry its own context.

**Files:**
- Create: `src/src/config/comments.js`
- Create: `lambda-functions/game/comment-keys.js`
- Test: `src/src/__tests__/commentAnchors.test.js`, `tests/comment-keys.js`

**Interfaces — Produces:**
- `ANCHOR_KINDS = ['summary', 'results', 'response']`
- `MAX_COMMENT = 1000`, `MAX_EXCERPT = 140`
- `isAnchorKind(v) -> boolean`
- `normalizeAnchorRef(kind, ref) -> string` — `''` for summary/results, the decimal position for response; `null` when invalid
- `anchorLabelFor({anchorKind, anchorRef}, {answers, authorLabel}) -> string`
- `excerptOf(text, max = MAX_EXCERPT) -> string`
- Backend `comment-keys.js`: `commentSk({questionNumber, anchorKind, anchorRef, commentId}) -> string`, `commentPrefix({questionNumber, anchorKind, anchorRef}) -> string`, `newCommentId(now, rand) -> string`, `parseCommentSk(sk) -> object|null`

- [ ] **Step 1: Write the failing backend test**

`tests/comment-keys.js`, asserting the SK against an independently built string — never against another call of the same function:

```js
check('an SK is round, kind, ref and id, in that order', () => {
  const sk = commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '2', commentId: 'abc' });
  assert.strictEqual(sk, 'COMMENT#003#response#2#abc');
});
check('summary and results carry an empty ref segment, so the prefix still matches', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '007', anchorKind: 'summary', anchorRef: '', commentId: 'z9' }),
    'COMMENT#007#summary##z9');
});
check('the round prefix selects every anchor in that round and no other round', () => {
  assert.strictEqual(commentPrefix({ questionNumber: '003' }), 'COMMENT#003#');
  assert.ok(!commentSk({ questionNumber: '030', anchorKind: 'summary', anchorRef: '', commentId: 'x' })
    .startsWith(commentPrefix({ questionNumber: '003' })));
});
check('a padded round number is required, so 3 and 003 cannot both exist', () => {
  assert.strictEqual(commentSk({ questionNumber: '3', anchorKind: 'summary', anchorRef: '', commentId: 'x' }), null);
});
check('ids sort by time, so a begins_with returns writing order', () => {
  const a = newCommentId(1000, 'aaaaaa');
  const b = newCommentId(2000, 'bbbbbb');
  assert.ok(a < b);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/comment-keys.js`
Expected: `Cannot find module '.../comment-keys'`.

- [ ] **Step 3: Implement `comment-keys.js`**

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Write the failing frontend test**

`src/src/__tests__/commentAnchors.test.js` — the closed set, ref normalisation, and that `anchorLabelFor` names a response by its **position** and, when attributed, its author:

```js
test('a response anchor is labelled by position, not by rank', () => {
  const answers = [{ rank: 1, playerName: 'Dana' }, { rank: 1, playerName: 'Sam' }];
  expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '1' }, { answers }))
    .toBe('Response 2 — Sam');
});
test('an unattributed response anchor names no one', () => {
  expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '0' }, { answers: [{ rank: 1 }] }))
    .toBe('Response 1');
});
test('an out-of-range ref still yields a readable label', () => {
  expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '9' }, { answers: [] })).toBe('Response 10');
});
```

The tie fixture is the point: both answers have `rank: 1`, so a label derived from rank would say "Response 1" for both.

- [ ] **Step 6: Run it, watch it fail, implement, run it green**

- [ ] **Step 7: Commit**

---

### Task 2: `feedback` becomes the third beat

**Files:**
- Modify: `lambda-functions/game/stage-beat.js` (`BEATS`)
- Modify: `src/src/config/hostControls.js` (`STAGE_BEATS`)
- Test: `tests/feedback-round-beat.js`, extend `src/src/__tests__/hostControls*.test.js`

**Interfaces — Consumes:** nothing. **Produces:** `BEATS` includes `'feedback'`; `STAGE_BEATS` mirrors it.

- [ ] **Step 1: Write the failing test** — that the endpoint accepts the beat, writes it with `UpdateCommand` (a `Put` would un-reveal the round), broadcasts `stageBeatChanged`, still 400s on an unknown beat, and that the frontend mirror agrees. The mirror assertion reads `src/src/config/hostControls.js` as text, the way `tests/round-kind-steering.js:216-232` does.

```js
check('the two lists still agree', () => {
  const mirror = fs.readFileSync(path.join(REPO, 'src/src/config/hostControls.js'), 'utf8');
  const declared = /STAGE_BEATS\s*=\s*\[([^\]]*)\]/.exec(mirror)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual(declared, ['results', 'field-notes', 'feedback']);
});
check('an unknown beat is still refused', async () => {
  const res = await handler(post({ beat: 'chat', questionNumber: 3 }));
  assert.strictEqual(res.statusCode, 400);
});
```

- [ ] **Step 2: Run, watch fail** (`deepStrictEqual` shows the two-element array).
- [ ] **Step 3: Add `'feedback'` to both lists.**
- [ ] **Step 4: Run, watch pass. Run the full backend suite to confirm 3265 holds.**
- [ ] **Step 5: Commit**

---

### Task 3: The comments handler

**Files:**
- Create: `lambda-functions/game/comments.js`
- Test: `tests/round-comments.js`

**Interfaces — Consumes:** `comment-keys.js` from Task 1, `'feedback'` from Task 2.
**Produces:** `POST/GET /games/{gameId}/comments`; comment rows as specified in the design §6.

- [ ] **Step 1: Write the failing test.** Cover, each with an independently constructed expectation:
  - the row's SK, PK and every attribute, built by hand in the test;
  - `ttl` is exactly 30 days — computed in the test as `Math.floor(now/1000) + 2592000`, not read back off the written item;
  - a comment posted to a round the host has left (state `RESULTS#004` while commenting on `003`, or beat `field-notes`) is **refused**;
  - `anchorKind` outside the closed set → 400; `questionNumber` non-numeric → 400; empty or over-long `text` → 400;
  - the text is written as ciphertext when the session has an `orgId`, and `PlayerName` is not;
  - `GET` returns a round's comments in writing order;
  - `GET` runs the payload through `isHidden`, and when it returns true `playerName` is **absent, not null**.
- [ ] **Step 2: Run, watch fail** (module not found).
- [ ] **Step 3: Implement, modelled on `submit-vote.js`** — org lookup by `ProjectionExpression: 'orgId'`, `encryptItem(orgId, 'comment', row)`, the nearest `broadcastToGame` copy.
- [ ] **Step 4: Run, watch pass.**
- [ ] **Step 5: Commit**

---

### Task 4: Encryption for the comment entity

**Files:**
- Modify: `lambda-functions/game/tenant-crypto.js`, `lambda-functions/websocket/tenant-crypto.js`, `lambda-functions/admin/shared/tenant-crypto.js`
- Test: extend `tests/tenant-crypto.js`

- [ ] **Step 1: Write the failing test** — `ENCRYPTED_FIELDS.comment` is `['Text','AnchorExcerpt','AnchorLabel']`; a round-tripped row has ciphertext in those three and plaintext `PlayerName`; the three copies remain byte-identical.
- [ ] **Step 2: Run, watch fail** (`unknown entity "comment"`).
- [ ] **Step 3: Add the entity to all three copies, identically.**
- [ ] **Step 4: Run, watch pass; run `tests/tenant-crypto.js` §8 and `tests/kms-grants-match-code.js`.**
- [ ] **Step 5: Commit**

---

### Task 5: The route

**Files:**
- Modify: `template-clean.yaml`
- Test: `tests/template-validates.js` + `sam validate --lint`

- [ ] **Step 1** Add `CommentsFunction` copying the `SubmitVoteFunction` block verbatim in shape: `CodeUri: lambda-functions/game/`, `TABLE_NAME` + `WEBSOCKET_API_ENDPOINT` env, `kms:Decrypt` on `!GetAtt TenantKey.Arn`, `DynamoDBCrudPolicy`, `execute-api:ManageConnections`, two public `HttpApi` events.
- [ ] **Step 2** Run `node tests/template-validates.js` and `sam validate --template template-clean.yaml --region us-east-1 --lint`. Both must pass.
- [ ] **Step 3** Run `node tests/kms-grants-match-code.js` — the new function's require tree reaches `tenant-crypto.js`, so a missing grant fails the build here rather than in production.
- [ ] **Step 4: Commit**

---

### Task 6: Extract `RoundReport` from `PastRound`

A pure refactor first, with **no behaviour change**, so the regression is provable before any feature lands on it.

**Files:**
- Create: `src/src/components/RoundReport.jsx`
- Modify: `src/src/components/PastRound.jsx`
- Test: `src/src/__tests__/roundReport.test.jsx`; existing `sessionHistory.test.jsx` must stay green untouched

**Interfaces — Produces:**
`RoundReport({ round, spotlight, onSpotlight, onRegenerate, regenerating = false, comments = [], onComment, commentBusy = false })`

What **stays** in `PastRound`: the `<Modal>`, the head with the position label and close, the `spotlight` state and its reset-on-index effect, the document keyboard handler, and the prev/next nav. What **moves**: the three `<section>`s and the `AnswerSpotlight` instance.

- [ ] **Step 1** Run `cd src && CI=true npx jest sessionHistory` and record it green — this is the regression baseline.
- [ ] **Step 2: Write the failing test** for `RoundReport` mounted on its own: the three sections render; no Regenerate button when `onRegenerate` is omitted; sections are inert when `onComment` is omitted.
- [ ] **Step 3** Run, watch fail (module not found).
- [ ] **Step 4** Create `RoundReport.jsx` by moving the sections verbatim, class names unchanged. Make `onRegenerate` optional.
- [ ] **Step 5** Run both suites. `roundReport` green **and** `sessionHistory` still green — if the second moved, the extraction changed the host's DOM and must be corrected, not the test.
- [ ] **Step 6: Commit**

---

### Task 7: Comments in `RoundReport`

**Files:**
- Modify: `src/src/components/RoundReport.jsx`
- Create: `src/src/components/RoundReport.css`
- Test: `src/src/__tests__/roundReport.test.jsx`, `src/src/__tests__/roundReportPalette.test.js`

- [ ] **Step 1: Write the failing tests** — each commentable section exposes a control carrying its anchor; the response control fires the **row's position** on a tie fixture (two `rank: 1` rows, clicking the second yields `anchorRef: '1'`); comments render under their anchor in a block headed "Comments"; a comment with no `playerName` is labelled positionally.
- [ ] **Step 2** Run, watch fail.
- [ ] **Step 3** Implement. Scope class `.rr-c`; tokens only; 12px floor; the affordance is a real `<button>`.
- [ ] **Step 4** Write `roundReportPalette.test.js` per `engage-design` §5, watch it fail on the missing stylesheet, then write `RoundReport.css`.
- [ ] **Step 5** Run both green. **Commit**

---

### Task 8: The player's feedback round

**Files:**
- Modify: `src/src/PlayerPage.jsx`, `src/src/WebSocketClient.js`
- Test: `src/src/__tests__/feedbackRound.test.jsx`

- [ ] **Step 1: Write the failing test** — on `RESULTS#003` with beat `feedback` the player renders the report and a composer; the composer states **"Your name will be shown with this comment."**; submitting posts to `POST /games/{id}/comments` with the anchor; a `commentPosted` frame triggers exactly one refetch for a burst (the debounce).
- [ ] **Step 2** Run, watch fail.
- [ ] **Step 3** Implement. `stageBeatChanged` registers on the legacy `messageHandlers` map; the beat branch sits inside the existing `RESULTS#` arm so ENDED still wins.
- [ ] **Step 4** Run green. **Commit**

---

### Task 9: The host's control and the beat

**Files:**
- Modify: `src/src/config/hostControls.js`, `src/src/GameHostPage.jsx`
- Test: `src/src/__tests__/hostControls*.test.js`, a `*CallSite.test.js` for `GameHostPage`

- [ ] **Step 1: Write the failing tests** — on `FIELD_NOTES` last page the secondary is `Request feedback` with intent `feedback`; while pages remain the secondary is still `Skip the rest` (the new control must not displace it); on `FEEDBACK` the primary is `Next Round` and the secondary returns to the read-back.
- [ ] **Step 2** Run, watch fail. **Step 3** Implement. **Step 4** Run green.
- [ ] **Step 5** Wire `GameHostPage`: `hostPhase` derivation handles the third beat; the intent posts to `stage-beat`; comments are fetched and passed to `PastRound`. Assert the wiring by comment-stripped source read — `GameHostPage` does not mount under jsdom.
- [ ] **Step 6: Commit**

---

### Task 10: Comments in both reports

**Files:**
- Modify: `lambda-functions/game/create-report.js`, `src/src/config/sessionHistory.js`, `src/src/components/GameReport.jsx` + `.css`, `src/src/GameHostPage.jsx`
- Test: `tests/comment-report-integration.js`, `src/src/__tests__/gameReport.test.jsx`, extend `sessionHistory.test.jsx`

- [ ] **Step 1: Write the failing backend test** — fixture comment rows in the table produce `detailedQuestions[i].comments` and `gameStats.totalComments`. **The expected report is built by hand in the test from the fixture rows**, never by re-reading the handler's output. Comments must land on the round named by their SK, verified with two rounds and asymmetric counts so a cross-wire fails.
- [ ] **Step 2** Run, watch fail. **Step 3** Implement in `create-report.js`. **Step 4** Run green.
- [ ] **Step 5: Write the failing frontend tests** — `roundsFrom` carries `comments`; `GameReport` renders a `report-comments` block headed "Comments" with each comment prefixed by its anchor; a call-site assertion that `GameHostPage` forwards `totalComments` into the rebuilt `gameData`.
- [ ] **Step 6** Run, watch fail. **Step 7** Implement. **Step 8** Run green. **Commit**

---

### Task 11: Full verification

- [ ] Backend suite — 3265 + new, 0 failed
- [ ] `cd src && CI=true npx jest` — 4720 + new, 0 failed
- [ ] `npm run lint` — 0 errors, 11 known warnings
- [ ] `npm run build` — clean, 2 known size warnings
- [ ] `sam validate --template template-clean.yaml --region us-east-1 --lint`
- [ ] Serve the design mockups and compare the two new surfaces against `host-redesign/09-field-notes.html` and `player-redesign/08-ask-call-typing.html`
- [ ] Commit

---

## Self-Review

**Spec coverage.** §1 beat → Task 2. §2 host control → Task 9. §3 player surface → Task 8. §4 `RoundReport` extraction → Task 6. §5 anchors → Tasks 1, 7. §6 data model → Tasks 1, 3. §7 TTL → Task 3 step 1. §8 anonymity → Task 3 (redaction) and Task 8 (the notice). §9 encryption → Task 4. §10 API → Tasks 3, 5. §11 reports → Task 10. §13 testing → every task. No gaps.

**Placeholders.** None: every step names its file, its command, and the assertion being made.

**Type consistency.** `anchorKind`/`anchorRef` are the names in the config, the SK builder, the handler, the component props and the report rows. `commentSk`/`commentPrefix`/`newCommentId`/`parseCommentSk` are used under those names in Tasks 1 and 3. `RoundReport`'s prop list in Task 6 is the one Tasks 7 and 8 consume.
