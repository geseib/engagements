# Question Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every generated Call & Answer and Trivia question a hidden `Background` note, and give its set an honest Workie note built from the admin's brief. The Workie reads both, plus the host's event details, and never invents facts. The host sees on the phone remote which context the Workie had.

**Architecture:**
- **A new question attribute, `Background`.** It is stored, encrypted, published and passed through CSV exactly like the Reveal (`AnswerDetails`), and it never reaches a player or live payload.
- **The generators fill it.**
  - Call & Answer: `structured-generation.js` and `ai-generate-scenarios.js`.
  - Trivia: `ai-generate-trivia.js`.
  - Both use one shared truth rule.
- **The builders write the set's `aiContextInstruction` deterministically** from the admin's brief (`workieSetNote.js`).
- **`get-ai-summary.js`** adds Background to the context block that every prompt already receives. It appends one honesty rule and records yes/no `ContextUsed` flags.
- **The flags are shown** on the phone remote and in the session report, never on the host page.

**Tech Stack:** Node 18 Lambdas (CommonJS), DynamoDB single table, Bedrock Claude via tool use, React (CRA/webpack) frontend, plain `node tests/<file>.js` backend tests, Jest + Testing Library frontend tests.

**Spec:** `docs/superpowers/specs/2026-09-25-question-background-design.md` (read it first; this plan argues from it).

## Global Constraints

- The stored attribute is **`Background`** (capital B). The CSV header is **`Background`**, the editor row key is **`background`**, the template variable is **`{background}`**, and the summary flag object is **`ContextUsed`** on the row and **`contextUsed`** in API responses.
- **`BACKGROUND_MAX = 600`** characters. Trivia generation asks for 400 at most; Call & Answer generation asks for 2-4 sentences and 600 at most.
- **Truth rule**, verbatim, in both generator prompts:
  "Write only what you are certain is true. No statistics, dates, names or quotations unless they are widely established and you are sure of them. Nothing about the audience's organisation, people or events. When you are not certain of a fact, give an angle or a question instead."
- **Honesty rule**, verbatim, appended to every summary prompt:
  "Facts come from the material above, from what the room said, or from general knowledge you are certain of. Never invent numbers, names, quotations, or anything about this organisation or event. When something you would like is missing, work with what you have and do not mention that it is missing."
- **Context-block label**, verbatim:
  `BACKGROUND ON THIS QUESTION (from the set's author, not something the room said): `
- **Set-note fixed line**, verbatim:
  "Each question carries Background notes from the set's author. Draw facts from those notes and from what the room says."
- **Editor label and hint:** "Background for Workie" and "Facts and context Workie may use. Never shown to players."
- **Hint format:** `Workie had:` then these five items in this order, separated by ` · `:
  `question notes`, `set note`, `event details`, `host instructions`, `briefing`.
  Each item is followed by ` ✓` or ` —`.
- **Never logged.** Background text never goes to any `console.*`. Log lengths only, via `shapeForLog` in `get-ai-summary.js`.
- **Never served live.** Background never appears in `get-question.js`, `get-game-state.js`, `next-question.js` responses or any websocket frame.
- **Three identical copies.** `tenant-crypto.js` (admin/shared, game, websocket) and `template-variables.js` (admin/shared, game, `src/src/config/templateVariables.js`) must stay byte-identical. The existing tests `tests/tenant-crypto.js` and `tests/template-variable-catalogue.js` pin this.
- **Tests.** Backend tests are plain `node tests/<file>.js`, judged by exit code, and each arms `tests/helpers/finish-guard.js`.
  - Backend baseline: exactly one failing file, `tests/verify-question-set-ui.spec.js`.
  - Frontend, from `src/`: `CI=true npx jest`, `npm run lint` (0 errors), `npm run build` (exit 0).
  - Never `npm install` in a worktree.
  - Clear `.aws-sam` before the backend loop.
  - Stage new files before the final backend run (the phrase guard scans tracked files).
- **Deploy.** Follow CLAUDE.md: a fast-forward push of the branch head to `dev`, only after every suite is green. Never tags and branch together, and never test or prod from this plan.

## Review Focus

1. **A Background with a comma, a double quote and a line break** must survive CSV export and re-import byte for byte. Pinned by the fixture in Task 2.
2. **A Background longer than 600 characters** is cut at a sentence end, not mid-word, whether it comes from a CSV or a model. Pinned in Task 1 (the unit) and Task 2 (the import).
3. **A question row carrying lowercase `background`** (hand-built or legacy) is still read by the summary. Pinned in Task 5.
4. **A prompt that names `{background}` itself**, or places `{contextSections}`, gets the text exactly once. Pinned in Task 5.
5. **A summary written before this change has no `ContextUsed`.** The remote and report show no hint rather than a row of dashes. Pinned in Task 6.

---

### Task 1: The Background attribute: rule module, encryption, published fields, never served live

**Files:**
- Create: `lambda-functions/admin/shared/question-background.js`
- Modify: `lambda-functions/admin/shared/tenant-crypto.js`, `lambda-functions/game/tenant-crypto.js` and `lambda-functions/websocket/tenant-crypto.js` (in each, `ENCRYPTED_FIELDS.question`, the line after `'AnswerDetails',`)
- Modify: `lambda-functions/admin/shared/publishable.js` (`QUESTION_FIELDS`)
- Test: `tests/question-background.js` (new)

**Interfaces:**
- Produces:
  - `require('./shared/question-background')` gives `{ BACKGROUND_MAX: 600, clampBackground(value: any): string, BACKGROUND_TRUTH_RULE: string }`.
  - `ENCRYPTED_FIELDS.question` includes `'Background'`.
  - `QUESTION_FIELDS` includes `'Background'`.

- [ ] **Step 1: Write the failing test** `tests/question-background.js`

```js
/**
 * A QUESTION'S BACKGROUND — stored like the Reveal, never served like the question.
 * Spec: docs/superpowers/specs/2026-09-25-question-background-design.md §1.
 * rejects: an unclamped or mid-word-cut Background; a Background left in the clear on an
 *          org set or missing from the published surface; a Background reaching any
 *          player or live payload (get-question, get-game-state, next-question, websocket).
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  say('\n1. clampBackground');
  const { BACKGROUND_MAX, clampBackground, BACKGROUND_TRUTH_RULE } =
    require(path.join(REPO, 'lambda-functions/admin/shared/question-background.js'));
  await check('the limit is 600', () => assert.strictEqual(BACKGROUND_MAX, 600));
  await check('short text is only trimmed', () =>
    assert.strictEqual(clampBackground('  Git records every change.  '), 'Git records every change.'));
  await check('a line break inside is kept', () =>
    assert.strictEqual(clampBackground('One.\nTwo.'), 'One.\nTwo.'));
  await check('non-strings become empty', () => {
    for (const v of [undefined, null, 42, {}, []]) assert.strictEqual(clampBackground(v), '');
  });
  await check('over the limit it cuts at the last sentence end that fits', () => {
    const s = 'A'.repeat(300) + '. ' + 'B'.repeat(250) + '. ' + 'C'.repeat(200) + '.';
    const out = clampBackground(s);
    assert.ok(out.length <= 600, `length ${out.length}`);
    assert.ok(out.endsWith('B'.repeat(250) + '.'), `cut in the wrong place: …${out.slice(-20)}`);
  });
  await check('with no sentence end it cuts at a word, never mid-word', () => {
    const s = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const out = clampBackground(s);
    assert.ok(out.length <= 600);
    assert.ok(s.startsWith(out) && (s[out.length] === ' '), `cut mid-word: …${out.slice(-12)}`);
  });
  await check('the truth rule is the spec\'s text', () => assert.strictEqual(BACKGROUND_TRUTH_RULE,
    'Write only what you are certain is true. No statistics, dates, names or quotations unless they are '
    + 'widely established and you are sure of them. Nothing about the audience\'s organisation, people or '
    + 'events. When you are not certain of a fact, give an angle or a question instead.'));

  say('\n2. stored like the Reveal');
  for (const pkg of ['admin/shared', 'game', 'websocket']) {
    await check(`${pkg}/tenant-crypto.js encrypts Background on a question row`, () => {
      const { ENCRYPTED_FIELDS } = require(path.join(REPO, 'lambda-functions', pkg, 'tenant-crypto.js'));
      assert.ok(ENCRYPTED_FIELDS.question.includes('Background'));
    });
  }
  await check('Background is on the published surface (checked, hashed, copied)', () => {
    const { QUESTION_FIELDS, questionText } = require(path.join(REPO, 'lambda-functions/admin/shared/publishable.js'));
    assert.ok(QUESTION_FIELDS.includes('Background'));
    assert.ok(questionText({ Title: 't', Background: 'zqbackground-sentinel' }).includes('zqbackground-sentinel'));
  });

  say('\n3. never served live');
  await require('./helpers/question-background-live-check')(check);

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
```

- Create `tests/helpers/question-background-live-check.js`. It is the section-3 harness: a copy of the setup in `tests/round-ref-lives-with-session.js` (the KMS stub, `createTable`/`installStubs`, `createGame`, `nextQuestion`, `getQuestion`, `getGameState`, `createdSession`, `press`). The fixture stores `Background: 'zqbackground-sentinel'` and `AnswerDetails: 'zqreveal-sentinel'` on each `QUESTION#c001#nnn` row.
- It exports `async (check) => { … }`, which:
  1. opens round one with `press(gameId)`;
  2. calls `getQuestion` with `role=player` and `role=host`, and `getGameState`;
  3. runs these checks, each on `JSON.stringify` of the response it names:

```js
    await check('next-question\'s response carries no Background', () =>
      assert.ok(!JSON.stringify(openRes).includes('zqbackground-sentinel')));
    for (const role of ['player', 'host']) {
      await check(`get-question role=${role} carries no Background`, async () => {
        const res = await getQuestion({ pathParameters: { gameId }, queryStringParameters: { role } });
        assert.strictEqual(res.statusCode, 200, res.body);
        assert.ok(!res.body.includes('zqbackground-sentinel'), res.body);
      });
    }
    await check('get-game-state carries no Background', async () => {
      const res = await getGameState({ pathParameters: { gameId } });
      assert.ok(!res.body.includes('zqbackground-sentinel'), res.body.slice(0, 400));
    });
    await check('no websocket frame carries Background', () =>
      assert.ok(!JSON.stringify(sent).includes('zqbackground-sentinel')));
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/question-background.js; echo EXIT=$?`
Expected: `CRASH … Cannot find module …question-background.js`, EXIT=1.

- [ ] **Step 3: Create `lambda-functions/admin/shared/question-background.js`**

```js
/**
 * A QUESTION'S BACKGROUND — the material its author left for Workie.
 *
 * docs/superpowers/specs/2026-09-25-question-background-design.md. Stored on the
 * question row as `Background`: encrypted for an org set (ENCRYPTED_FIELDS.question),
 * published and copied with the set (publishable.js QUESTION_FIELDS), carried by NO
 * player or live payload, and read only by game/get-ai-summary.js. It is not the
 * Reveal (`AnswerDetails`): the reveal is what the room is told at results; this is
 * what Workie may draw on while it reads the room.
 */
const BACKGROUND_MAX = 600;

/**
 * Trim to BACKGROUND_MAX at the last sentence end that fits, else the last word
 * boundary. One rule for every way in — generator output and CSV import — so a
 * note never ends mid-word and never differs by the door it came through.
 */
function clampBackground(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= BACKGROUND_MAX) return text;
  const head = text.slice(0, BACKGROUND_MAX + 1);
  let cut = -1;
  for (const m of head.matchAll(/[.!?](?=\s)/g)) {
    if (m.index < BACKGROUND_MAX) cut = m.index + 1;
  }
  if (cut > 0) return text.slice(0, cut);
  const word = head.lastIndexOf(' ', BACKGROUND_MAX);
  return (word > 0 ? text.slice(0, word) : text.slice(0, BACKGROUND_MAX)).trim();
}

/** Said identically to both generators, so the two cannot drift apart. */
const BACKGROUND_TRUTH_RULE = [
  'Write only what you are certain is true. No statistics, dates, names or quotations unless they are',
  'widely established and you are sure of them. Nothing about the audience\'s organisation, people or',
  'events. When you are not certain of a fact, give an angle or a question instead.',
].join(' ');

module.exports = { BACKGROUND_MAX, clampBackground, BACKGROUND_TRUTH_RULE };
```

- [ ] **Step 4: Add `'Background',` to `ENCRYPTED_FIELDS.question`** in all three `tenant-crypto.js` copies, on the line after `'AnswerDetails',`. Apply the identical edit so `tests/tenant-crypto.js` still finds the copies byte-identical.

- [ ] **Step 5: Add `'Background'` to `QUESTION_FIELDS`** in `publishable.js`, directly after `'AnswerDetails'`:

```js
const QUESTION_FIELDS = Object.freeze([
  'Title', 'Detail', 'AnswerDetails', 'Background', 'CustomInstructions',
```

Then edit its doc comment from "Question fields a room can see" to "Question fields a room can see, plus Background, which only Workie reads but which is published and checked like the rest". An absent field adds nothing to `questionText` or the hash, so no existing set's hash moves.

- [ ] **Step 6: Run and watch it pass**

Run: `node tests/question-background.js; echo EXIT=$?` and `node tests/tenant-crypto.js; echo EXIT=$?`
Expected: all PASS, both EXIT=0. The live-payload checks pass without code changes, because every live payload is an explicit projection. That is the point of pinning them.

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/admin/shared/question-background.js lambda-functions/*/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js lambda-functions/admin/shared/publishable.js tests/question-background.js tests/helpers/question-background-live-check.js
git commit -m "Background: a hidden per-question note for Workie, stored like the Reveal and never served live"
```

---

### Task 2: Background travels through CSV import, export, the editor's rows and Add Questions

**Files:**
- Modify: `lambda-functions/admin/upload-questions.js`:
  - column map, around `:430-455`;
  - cell read, around `:655-670`;
  - `baseQuestion`, around `:703-761`;
  - `questionItem` write, around `:1117-1131`.
- Modify: `lambda-functions/admin/download-question-set.js` (optional columns, around `:200-215`)
- Modify: `src/src/utils/questionRows.js`: the row model (around `:195`) and `rowsToCsv` (around `:500-515`)
- Modify: `src/src/utils/addQuestions.js` (`HEADER_TO_FIELD`, around `:82`)
- Test: `tests/question-set-roundtrip.js` (add a fixture and a section)

**Interfaces:**
- Consumes: `clampBackground` from Task 1.
- Produces:
  - Question rows carry `Background` when non-empty.
  - Editor rows carry `background` (string, default `''`).
  - `rowsToCsv` and `download-question-set.js` emit an optional `Background` column directly after the optional `AnswerDetails` column.

- [ ] **Step 1: Add the failing fixture and section** to `tests/question-set-roundtrip.js`.

Put the fixture after `ART_CSV`:

```js
/**
 * Call-and-answer carrying Background (question-background spec §1). The second row's
 * note holds a comma, a double quote and a line break — the three things a CSV writer
 * gets wrong — and the third row has none, so the column is optional per row.
 */
const BACKGROUND_CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,AnswerDetails,Background,Tags',
  '"Delivery",1,"WHAT SLOWS A RELEASE","","Engineering","Name one thing.","",'
    + '"Version control records every change so a team can see who changed what.","release"',
  '"Delivery",2,"WHEN DO WE BRANCH","","Engineering","Name one thing.","",'
    + '"Trunk-based teams merge daily; others keep ""release"" branches.\nBoth work.","branching"',
  '"Delivery",3,"WHO REVIEWS CODE","","Engineering","Name one thing.","","","review"',
].join('\n');
```

Then add this section after the art-title section:

```js
  // ==== call-and-answer, carrying Background =================================
  say('\n  -- call-and-answer (Background) --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Background', 'call-and-answer', BACKGROUND_CSV);
    // rejects: an importer that never writes Background (the vacuous pass).
    check('the seeded set carries Background on the rows that have one', () =>
      assert.deepStrictEqual(t.before.map((r) => r.Background || ''), [
        'Version control records every change so a team can see who changed what.',
        'Trunk-based teams merge daily; others keep "release" branches.\nBoth work.',
        '',
      ]));
    // rejects: the exporter dropping the column — the WrongAnswer* defect on a new column.
    check('the exported header names Background after AnswerDetails', () => {
      const cols = t.header.split(',');
      assert.ok(cols.includes('Background'), t.header);
    });
    check('every question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    // rejects: the console editor serialising differently from the exporter.
    check('the console serialises Background byte-identically to download-question-set.js', async () => {
      const res = await getQuestions({ ...adminContext(), pathParameters: { setId: t.setId }, queryStringParameters: {} });
      const rows = editableRows(JSON.parse(res.body));
      assert.strictEqual(rowsToCsv(rows, 'call-and-answer'), t.csv);
    });
  }

  // ==== an over-long Background is clamped on import ========================
  say('\n  -- Background longer than 600 characters --');
  resetDb();
  {
    const long = 'Sentence one is here. '.repeat(40).trim();   // ~880 characters
    const csv = [
      'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Background,Tags',
      `"Delivery",1,"A LONG NOTE","","Engineering","Name one thing.","${long}","long"`,
    ].join('\n');
    const t = await roundTrip('Roundtrip Long Background', 'call-and-answer', csv);
    check('it is stored at 600 characters or fewer, ending on a sentence', () => {
      const bg = t.before[0].Background;
      assert.ok(bg.length <= 600 && bg.endsWith('here.'), `${bg.length}: …${bg.slice(-15)}`);
    });
  }
```

Use `getQuestions`, `editableRows` and `rowsToCsv` as the existing console section does, around `:600-651`. If `getQuestions` needs the org context there, copy that section's call exactly.

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/question-set-roundtrip.js; echo EXIT=$?`
Expected: FAIL on "carries Background" (every value is `''`), and EXIT=1.

- [ ] **Step 3: Import.** In `upload-questions.js`:
  - add `const { clampBackground } = require('./shared/question-background');` next to the other `./shared` requires;
  - add `let backgroundIndex = getColumnIndex('Background');` beside `answerDetailsIndex`;
  - add `const background = clampBackground(cell(values, backgroundIndex));` beside `answerDetails`;
  - after the `if (finalAnswerDetails) { baseQuestion.AnswerDetails = … }` block, add:

```js
          // BACKGROUND — the author's material for Workie (question-background spec
          // §1). Same property as the reveal: no player or host payload carries it.
          // Clamped here, on the way in, by the one rule every door uses.
          if (background) {
            baseQuestion.Background = background;
          }
```

  - in `questionItem`, after the `AnswerDetails` spread, add:

```js
        ...(question.Background ? { Background: question.Background } : {}),
```

Do **not** add a loose `includes(...)` fallback for this header. Only the exact `Background` name is claimed, so no other column can be read as it.

- [ ] **Step 4: Export.** In `download-question-set.js`, beside `carriesAnswerDetails`:

```js
      const carriesBackground = questions.some(q => String(q.Background || q.background || '').trim());
```

Put `+ (carriesBackground ? ',Background' : '')` directly after the `AnswerDetails` part of `optionalHeader`. Put `+ (carriesBackground ? `,"${esc(q.Background || q.background)}"` : '')` directly after the `AnswerDetails` cell. Do the same in every branch that builds `optionalHeader` and `optionalCells`, including the survey branch if it reuses them.

- [ ] **Step 5: Editor rows.** In `src/src/utils/questionRows.js`, add to the row model after `answerDetails`:

```js
    background: text(pick(q, 'Background', 'background')),
```

In `rowsToCsv`, add `const carriesBackground = carries('background');`. Put `+ (carriesBackground ? ',Background' : '')` right after the AnswerDetails header part, and `+ (carriesBackground ? `,${quoted(r.background)}` : '')` right after the AnswerDetails cell part. Add `background: ''` wherever `blankRow` sets `answerDetails: ''`.

- [ ] **Step 6: Add Questions.** In `src/src/utils/addQuestions.js` `HEADER_TO_FIELD`, after `answerdetails: 'AnswerDetails',`:

```js
  background: 'Background',
```

- [ ] **Step 7: Run and watch it pass**

Run: `node tests/question-set-roundtrip.js; echo EXIT=$?`, then `cd src && CI=true npx jest questionRows addQuestions; cd ..`
Expected: all PASS, EXIT=0.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/admin/upload-questions.js lambda-functions/admin/download-question-set.js src/src/utils/questionRows.js src/src/utils/addQuestions.js tests/question-set-roundtrip.js
git commit -m "Background survives CSV import, export, the console editor and Add Questions"
```

---

### Task 3: The Call & Answer and Trivia generators write Background

**Files:**
- Modify: `lambda-functions/admin/shared/structured-generation.js` (`lengthGuidance`, `buildItemsTool`)
- Modify: `lambda-functions/admin/ai-generate-scenarios.js` (`normalizeItem`, around `:256-270`)
- Modify: `lambda-functions/admin/ai-generate-trivia.js` (`buildTool`, `buildPrompt`, `normalizeItem`)
- Modify: `lambda-functions/admin/shared/generated-set.js` (`scenariosToCsv`, `triviaToCsv`)
- Modify: `src/src/utils/generatedSetUpload.js` (`scenariosToCsv`, `triviaToCsv`)
- Modify: `src/src/components/TriviaAIBuilder.jsx` (`generateTriviaCSV`)
- Modify: `src/src/components/AIScenarioBuilder.jsx` (`generateCSVContent`, around `:837`)
- Test: `tests/question-background-generators.js` (new); a new case in `tests/generated-set-creation.js`

**Interfaces:**
- Consumes: `clampBackground` and `BACKGROUND_TRUTH_RULE` (Task 1). Import reads a `Background` CSV column (Task 2).
- Produces:
  - Generated items carry `background: string`.
  - Every CSV builder emits a `Background` column (call-and-answer and trivia only).

- [ ] **Step 1: Write the failing test** `tests/question-background-generators.js`

```js
/**
 * THE GENERATORS WRITE BACKGROUND — question-background spec §2.
 * rejects: a generator that does not ask for background, asks without the truth rule,
 *          asks a wavelength round for one (the players supply the meaning), keeps an
 *          unclamped note, or builds a CSV that drops it.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const { BACKGROUND_TRUTH_RULE } = require(path.join(REPO, 'lambda-functions/admin/shared/question-background.js'));
const sg = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));
const { scenariosToCsv, triviaToCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/generated-set.js'));

(async () => {
  say('\n1. Call & Answer');
  const caTool = sg.buildItemsTool('call-and-answer');
  const caItem = caTool.input_schema.properties.items.items;
  await check('the tool asks for background, required', () => {
    assert.ok(caItem.properties.background, 'no background property');
    assert.ok(caItem.required.includes('background'));
  });
  await check('the length guidance carries the truth rule', () =>
    assert.ok(sg.lengthGuidance('call-and-answer').includes(BACKGROUND_TRUTH_RULE)));
  await check('wavelength is never asked for one', () => {
    const wItem = sg.buildItemsTool('wavelength').input_schema.properties.items.items;
    assert.ok(!wItem.properties.background && !wItem.required.includes('background'));
    assert.ok(!sg.lengthGuidance('wavelength').includes('background'));
  });

  say('\n2. Trivia');
  const config = { numChoices: 4, numCorrect: 1, topic: 'version control', difficulty: 'medium', categories: 2 };
  const tItem = trivia.buildTool(config).input_schema.properties.items.items;
  await check('the tool asks for background, required, apart from answerDetails', () => {
    assert.ok(tItem.properties.background && tItem.properties.answerDetails);
    assert.ok(tItem.required.includes('background'));
  });
  await check('the prompt carries the truth rule', () =>
    assert.ok(trivia.buildPrompt({ config, count: 5, alreadyUsedTitles: [] }).includes(BACKGROUND_TRUTH_RULE)));
  await check('normalizeItem keeps a clamped background', () => {
    const item = trivia.normalizeItem({ title: 'T', questionDetail: 'Q', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'OptionA', answerDetails: 'why',
      background: 'x '.repeat(500), difficulty: 'easy', tags: [] }, config);
    assert.ok(item.background.length > 0 && item.background.length <= 600);
  });

  say('\n3. The CSV the worker imports');
  await check('scenariosToCsv writes a Background column', () => {
    const csv = scenariosToCsv([{ title: 'T', category: 'C', detail: 'D', customInstructions: 'I',
      tags: ['a'], background: 'zqbg-scenario' }]);
    assert.ok(csv.split('\n')[0].split(',').includes('Background'), csv.split('\n')[0]);
    assert.ok(csv.includes('zqbg-scenario'));
  });
  await check('triviaToCsv writes a Background column', () => {
    const csv = triviaToCsv([{ title: 'T', category: 'C', questionDetail: 'Q', answerDetails: 'A',
      optionA: 'a', optionB: 'b', correctAnswer: 'OptionA', difficulty: 'easy', tags: [], background: 'zqbg-trivia' }]);
    assert.ok(csv.split('\n')[0].split(',').includes('Background'));
    assert.ok(csv.includes('zqbg-trivia'));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
```

The scenario `normalizeItem` in `ai-generate-scenarios.js` is not exported today. Export it (`module.exports.normalizeItem = normalizeItem` alongside the existing exports) and add:

```js
  await check('the scenario normalizeItem keeps a clamped background, and none for wavelength', () => {
    const { normalizeItem } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'));
    const raw = { title: 'T', category: 'C', detail: 'D', customInstructions: 'I', tags: [], background: 'y '.repeat(500) };
    assert.ok(normalizeItem(raw, 'call-and-answer').background.length <= 600);
    assert.strictEqual(normalizeItem(raw, 'wavelength').background, '');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/question-background-generators.js; echo EXIT=$?`
Expected: FAIL on every "asks for background" and "writes a Background column" check, EXIT=1.

- [ ] **Step 3: Call & Answer schema and guidance.** In `structured-generation.js`, add `const { BACKGROUND_TRUTH_RULE } = require('./question-background');` at the top.

In `buildItemsTool`, compute `const withBackground = engagementType === 'call-and-answer';` and add this to the item `properties`:

```js
              ...(withBackground ? {
                background: {
                  type: 'string',
                  description: '2-4 sentences, 600 characters maximum. Material the summariser may draw on '
                    + 'when reading the room\'s answers: context, one well-established fact, a useful angle, '
                    + 'or a follow-up that pushes the room further. Never shown to players.',
                },
              } : {}),
```

Make `required` equal `['title', 'category', 'detail', 'customInstructions', 'tags', ...(withBackground ? ['background'] : [])]`.

In `lengthGuidance`, add these lines to the non-wavelength return, before `'Write only what the content needs; …'`:

```js
    '- background: 2-4 sentences, 600 characters maximum, never shown to players.',
    `  ${BACKGROUND_TRUTH_RULE}`,
```

Only call-and-answer reaches this return with a background. If any other type shares it, gate these two lines on `engagementType === 'call-and-answer'` too.

- [ ] **Step 4: Scenario normalisation.** In `ai-generate-scenarios.js` `normalizeItem`, add `const { clampBackground } = require('./shared/question-background');` at the top, and this to the returned item:

```js
    background: engagementType === 'call-and-answer' ? clampBackground(raw?.background) : '',
```

- [ ] **Step 5: Trivia.** In `ai-generate-trivia.js`:
  - require `{ clampBackground, BACKGROUND_TRUTH_RULE }` from `./shared/question-background`;
  - add to `buildTool` properties:

```js
              background: { type: 'string', description: 'The story around the answer that makes good '
                + 'commentary, 1-3 sentences, 400 characters maximum. Not why it is correct — that is '
                + 'answerDetails. Never shown to players.' },
```

  - add `'background'` to `required`;
  - in `buildPrompt`'s LENGTH LIMITS list, after the `answerDetails` line, add
    `'- background: 1-3 sentences, 400 characters maximum. ' + BACKGROUND_TRUTH_RULE,`;
  - in `normalizeItem`, add `background: clampBackground(raw?.background),`.

- [ ] **Step 6: The CSV builders.** In `generated-set.js`:

`scenariosToCsv` becomes:

```js
  const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags,Background';
  …
        tagsToCsvCell(scenario.tags),
        scenario.background || '',
```

`triviaToCsv` appends `,Background` to its header string and `trivia.background || ''` as the last cell.

Make the identical change in `src/src/utils/generatedSetUpload.js` (both functions), in `TriviaAIBuilder.jsx` `generateTriviaCSV`, and in `AIScenarioBuilder.jsx` `generateCSVContent`. Each gets the header's trailing `,Background` and the row's trailing background cell. Each file says it "mirrors" the others, so keep them column-for-column the same.

- [ ] **Step 7: End to end through the worker.** Add a case to `tests/generated-set-creation.js`, next to the "poll payload names the set" test:

```js
  await test('a generated question keeps its background on the stored row', async () => {
    // rejects: any hop between the model's tool call and the stored row dropping it.
    reset();
    const items = scenarioItems(2, 'bg').map((it, i) => ({ ...it, background: `zqbg-${i} Git records every change.` }));
    bedrockHandler = () => toolResponse(items);
    const { job } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.ok(job.createdSet, `no set was created: ${job.setCreationError}`);
    const questionRows = [...ddb.values()].filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.ok(questionRows.length === 2, `expected 2 question rows, saw ${questionRows.length}`);
    for (const r of questionRows) assert.ok(r.Background, `a row has no Background: ${r.SK}`);
  });
```

If the fixture's set is org-owned, `r.Background` is an envelope object. That is truthy, which is all this asserts.

- [ ] **Step 8: Run and watch it pass**

Run:

```bash
node tests/question-background-generators.js; echo EXIT=$?
node tests/generated-set-creation.js; echo EXIT=$?
node tests/generation-worker-fail-closed.js; echo EXIT=$?
cd src && CI=true npx jest generatedSetUpload TriviaAIBuilder AIScenarioBuilder; cd ..
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add lambda-functions/admin/shared/structured-generation.js lambda-functions/admin/ai-generate-scenarios.js lambda-functions/admin/ai-generate-trivia.js lambda-functions/admin/shared/generated-set.js src/src/utils/generatedSetUpload.js src/src/components/TriviaAIBuilder.jsx src/src/components/AIScenarioBuilder.jsx tests/question-background-generators.js tests/generated-set-creation.js
git commit -m "The Call & Answer and Trivia generators write a Background for every question"
```

---

### Task 4: The set's Workie note is built from the admin's own brief

**Files:**
- Create: `src/src/utils/workieSetNote.js`
- Modify: `src/src/components/AIScenarioBuilder.jsx` (`generateAIContextInstructions`, around `:992-1003`)
- Modify: `src/src/components/TriviaAIBuilder.jsx` (`buildSetMetadata.aiContextInstructions`, around `:336`)
- Test: `src/src/__tests__/workieSetNote.test.js` (new)

**Interfaces:**
- Produces: `buildWorkieSetNote({ subject, audience, difficulty, brief }: strings) => string`, at most `SET_NOTE_MAX = 1000` characters, always ending with the fixed line.

- [ ] **Step 1: Write the failing test** `src/src/__tests__/workieSetNote.test.js`

```js
import { buildWorkieSetNote, SET_NOTE_MAX, SET_NOTE_FIXED_LINE } from '../utils/workieSetNote';

describe('buildWorkieSetNote — the set note is the admin\'s brief, never invented', () => {
  test('carries subject, audience, difficulty and the brief verbatim, then the fixed line', () => {
    const note = buildWorkieSetNote({
      subject: 'Version control', audience: 'the platform team', difficulty: 'medium',
      brief: 'We move from SVN to Git in January.',
    });
    expect(note).toContain('Version control');
    expect(note).toContain('the platform team');
    expect(note).toContain('medium');
    expect(note).toContain('We move from SVN to Git in January.');
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('the fixed line is the spec\'s text', () => {
    expect(SET_NOTE_FIXED_LINE).toBe('Each question carries Background notes from the set\'s author. '
      + 'Draw facts from those notes and from what the room says.');
  });

  test('empty parts leave no empty labels behind', () => {
    const note = buildWorkieSetNote({ subject: 'Trivia night', audience: '', difficulty: '', brief: '' });
    expect(note).not.toMatch(/Audience:\s*(\.|$)/m);
    expect(note).not.toMatch(/brief:\s*(\.|$)/im);
  });

  test('a long brief is trimmed so the whole note fits, and the fixed line survives', () => {
    const note = buildWorkieSetNote({ subject: 'S', audience: 'A', difficulty: 'easy', brief: 'x'.repeat(5000) });
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('no boilerplate the admin never wrote', () => {
    const note = buildWorkieSetNote({ subject: 'S', audience: '', difficulty: '', brief: '' });
    expect(note).not.toMatch(/professional development|encourage learning|constructive feedback/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src && CI=true npx jest workieSetNote; cd ..`
Expected: FAIL, "Cannot find module '../utils/workieSetNote'".

- [ ] **Step 3: Create `src/src/utils/workieSetNote.js`**

```js
/**
 * THE SET'S NOTE TO WORKIE, BUILT FROM WHAT THE ADMIN TYPED — nothing else.
 *
 * question-background spec §2. The builders used to write boilerplate here
 * ("…Provide constructive feedback and encourage specific, detailed responses")
 * and throw away the free-text brief, so Workie was told nothing true about the set.
 * No model writes this: every word is the admin's, or the one fixed line below.
 */
export const SET_NOTE_MAX = 1000;
export const SET_NOTE_FIXED_LINE = 'Each question carries Background notes from the set\'s author. '
  + 'Draw facts from those notes and from what the room says.';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function buildWorkieSetNote({ subject, audience, difficulty, brief } = {}) {
  const parts = [];
  if (clean(subject)) parts.push(`This set is about ${clean(subject)}.`);
  if (clean(audience)) parts.push(`Audience: ${clean(audience)}.`);
  if (clean(difficulty)) parts.push(`Level: ${clean(difficulty)}.`);
  const head = parts.join(' ');
  const room = SET_NOTE_MAX - SET_NOTE_FIXED_LINE.length - head.length - 20;
  let text = clean(brief);
  if (text.length > room) text = `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  const briefLine = text ? `The author's brief: ${text}` : '';
  return [head, briefLine, SET_NOTE_FIXED_LINE].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Use it in both builders.**

In `AIScenarioBuilder.jsx`, replace the body of `generateAIContextInstructions` with:

```js
  const generateAIContextInstructions = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    return buildWorkieSetNote({
      subject: selectedType?.title || '',
      audience: scenarioConfig.audience,
      difficulty: scenarioConfig.difficulty,
      brief: scenarioConfig.context,
    });
  };
```

Add `import { buildWorkieSetNote } from '../utils/workieSetNote';`.

In `TriviaAIBuilder.jsx` `buildSetMetadata`, replace the `aiContextInstructions` line with:

```js
    aiContextInstructions: buildWorkieSetNote({
      subject: `${triviaConfig.topic} trivia`,
      audience: triviaConfig.audience,
      difficulty: triviaConfig.difficulty,
      brief: triviaConfig.customPrompt,
    }),
```

Add the same import.

- [ ] **Step 5: Run and watch it pass**

Run: `cd src && CI=true npx jest workieSetNote TriviaAIBuilder AIScenarioBuilder; cd ..`
Expected: PASS. If an existing builder test pinned the old boilerplate sentence, update it to expect `buildWorkieSetNote`'s output. That is the intended change.

- [ ] **Step 6: Commit**

```bash
git add src/src/utils/workieSetNote.js src/src/__tests__/workieSetNote.test.js src/src/components/AIScenarioBuilder.jsx src/src/components/TriviaAIBuilder.jsx
git commit -m "The set's Workie note is the admin's own brief, not boilerplate"
```

---

### Task 5: Workie reads Background, obeys one honesty rule, and records what context it had

**Files:**
- Modify: `lambda-functions/game/personas.js` (`buildContextBlock`, exports)
- Modify: `lambda-functions/game/get-ai-summary.js`:
  - question normalisation, around `:955-970`;
  - `contextSections`, around `:1826-1839`;
  - `templateVars`, around `:2575`;
  - the context block, around `:2685-2697`;
  - the prompt tail, before the briefing layer, around `:2824`;
  - the result, around `:2926-2944`;
  - `dbItem`, around `:1425`;
  - both `responseData` objects, around `:754` and `:1463`.
- Modify: the three `template-variables.js` copies (a new `background` entry)
- Test: `tests/question-background-workie.js` (new)

**Interfaces:**
- Consumes: question rows carrying `Background` (Tasks 1-3).
- Produces:
  - `personas.js` exports `backgroundLine(text) => string` (the labelled line, or `''`) and `HONESTY_RULE: string`.
  - `buildContextBlock({ eventDetails, hostInstructions, questionSetContext, questionBackground })`.
  - Summary rows carry `ContextUsed: { background, setNote, eventDetails, hostInstructions, briefing }` (booleans).
  - `GET /games/{id}/ai-summary` returns `contextUsed` (that object, or `null` for a row without it).

- [ ] **Step 1: Write the failing test** `tests/question-background-workie.js`.

Copy the harness from `tests/ai-summary-session-brief.js` lines 38-240 verbatim: the stubs, the KMS, the `store`/`put`/`key` helpers, `runWorker(gameId)` returning `{ res, prompt, stored }`, and the org-session seeding. Change the seeded question row: add `Background: 'zqbg Version control records every change.'` to the `QUESTION#…` row. It goes through the same `encryptItem(orgId, 'question', …)` the harness already uses, so it is an envelope at rest. Then add these checks:

```js
const { HONESTY_RULE, backgroundLine } = require(path.join(REPO, 'lambda-functions/game/personas.js'));
const LABEL = 'BACKGROUND ON THIS QUESTION (from the set\'s author, not something the room said): ';

// 1. an org round whose question has a Background, run under captureLogs() (copied from
//    tests/ai-summary-prompt-name-not-logged.js) so section 6 can read its console output
const { out: withBg, logs: withBgLogs } = await captureLogs(() => runWorker('7101'));
await check('the decrypted Background reaches the prompt, labelled', () =>
  assert.ok(withBg.prompt.includes(LABEL + 'zqbg Version control records every change.'), withBg.prompt));
await check('it appears exactly once', () =>
  assert.strictEqual(withBg.prompt.split('zqbg Version control').length - 1, 1));
await check('the honesty rule is in the prompt, after the template and the host\'s additions', () => {
  assert.ok(withBg.prompt.includes(HONESTY_RULE));
  assert.ok(withBg.prompt.lastIndexOf(HONESTY_RULE) > withBg.prompt.lastIndexOf(LABEL));
});
await check('the honesty rule is the spec\'s text', () => assert.strictEqual(HONESTY_RULE,
  'Facts come from the material above, from what the room said, or from general knowledge you are certain '
  + 'of. Never invent numbers, names, quotations, or anything about this organisation or event. When something '
  + 'you would like is missing, work with what you have and do not mention that it is missing.'));
await check('ContextUsed is stored, flags only', () => {
  const cu = withBg.stored.ContextUsed;
  assert.deepStrictEqual(Object.keys(cu).sort(), ['background', 'briefing', 'eventDetails', 'hostInstructions', 'setNote']);
  assert.strictEqual(cu.background, true);
  for (const v of Object.values(cu)) assert.strictEqual(typeof v, 'boolean');
});

// 2. the same round with no Background: seed game '7102' with the harness's own seeding
//    function, leaving Background off the question row, then `const noBg = await runWorker('7102');`
await check('no Background, no label, and the flag says so', () => {
  assert.ok(!noBg.prompt.includes(LABEL));
  assert.strictEqual(noBg.stored.ContextUsed.background, false);
  assert.ok(noBg.prompt.includes(HONESTY_RULE), 'the honesty rule is on every prompt');
});

// 3. lowercase `background` on a hand-built row is still read (Review Focus 3):
//    seed game '7103' on a PLATFORM set whose question row is put plain with
//    `background: 'zqbg-lower'`, then `const lower = await runWorker('7103');`
await check('a lowercase background attribute is read too', () =>
  assert.ok(lower.prompt.includes(LABEL + 'zqbg-lower')));

// 4. a prompt that places {background} itself gets it once, where it put it (Review Focus 4):
//    seed game '7104' like 7101 but attach an org AIPROMPT row whose `instructions` half
//    contains `Background: {background}` (row shape: seedOrgWorkie in
//    tests/ai-summary-prompt-name-not-logged.js), then `const placed = await runWorker('7104');`
await check('{background} in the template: once, and not repeated in the block', () => {
  assert.strictEqual(placed.prompt.split('zqbg Version control').length - 1, 1);
  assert.ok(!placed.prompt.includes(LABEL));
});

// 5. the public GET returns the flags
await check('GET ai-summary returns contextUsed', async () => {
  const res = await getAiSummary({ pathParameters: { gameId: '7101' }, queryStringParameters: { questionId: '001' } });
  assert.strictEqual(JSON.parse(res.body).contextUsed.background, true);
});
await check('a summary row written before ContextUsed existed returns contextUsed: null', async () => {
  delete store.get(key('GAME#7101', 'QUESTION#001#AISummary')).ContextUsed;
  const res = await getAiSummary({ pathParameters: { gameId: '7101' }, queryStringParameters: { questionId: '001' } });
  assert.strictEqual(JSON.parse(res.body).contextUsed, null);
});

// 6. the text is never logged (withBgLogs was captured in section 1)
await check('Background text never reaches console output', () =>
  assert.ok(!withBgLogs.includes('zqbg Version control')));
```

To seed variant 4, give the seeded AIPROMPT row an `instructions` half containing `Background: {background}`. The seeding helpers in `tests/ai-summary-prompt-name-not-logged.js` (`seedOrgWorkie`) show the row shape. For variant 3, `put` a plain (platform) question row with `background: 'zqbg-lower'` and no encryption.

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/question-background-workie.js; echo EXIT=$?`
Expected: FAIL. `HONESTY_RULE` is undefined, there is no label in the prompt, and `ContextUsed` is undefined. EXIT=1.

- [ ] **Step 3: `personas.js`.** Add above `buildContextBlock`:

```js
/** The one label Background travels under, in the injected block and in {contextSections}. */
const BACKGROUND_LABEL = 'BACKGROUND ON THIS QUESTION (from the set\'s author, not something the room said): ';
const backgroundLine = (text) => {
  const t = typeof text === 'string' ? text.trim() : '';
  return t ? `${BACKGROUND_LABEL}${t}` : '';
};

/**
 * ONE HONESTY RULE, ON EVERY PROMPT (question-background spec §3). Appended by
 * get-ai-summary.js after the host's additions and before the briefing, so it is
 * among the last words the model reads whatever the template says.
 */
const HONESTY_RULE = 'Facts come from the material above, from what the room said, or from general knowledge '
  + 'you are certain of. Never invent numbers, names, quotations, or anything about this organisation or event. '
  + 'When something you would like is missing, work with what you have and do not mention that it is missing.';
```

Give `buildContextBlock` a fourth parameter `questionBackground`, and push its line after the set author's:

```js
  const bg = backgroundLine(questionBackground);
  if (bg) lines.push(bg);
```

Add `backgroundLine` and `HONESTY_RULE` to `module.exports`.

- [ ] **Step 4: `get-ai-summary.js`.**
  1. Import `backgroundLine` and `HONESTY_RULE` from `./personas`.
  2. In the normalisation block after `question.answerDetails = …`:

```js
      // BACKGROUND (question-background spec §3). Either spelling; a string only —
      // an envelope that failed to open is not material, it is nothing.
      const rawBackground = question.background ?? question.Background;
      question.background = typeof rawBackground === 'string' ? rawBackground.trim() : '';
```

  3. In `generateAISummary`, after the existing `contextSections` pushes, keep the array as it is. After `templateBody` is set (around `:2655`), add:

```js
  const background = (question && question.background) || '';
  const templateNamesBackground = templateBody.includes('{background}');
  if (background && !templateNamesBackground) {
    templateVars.contextSections = '\nCONTEXT INFORMATION:\n'
      + contextSections.concat(backgroundLine(background)).join('\n') + '\n';
  }
```

  4. In `templateVars`, after `reveal`, add `background: (question && question.background) || '',`.
  5. In the `buildContextBlock({...})` call, add `questionBackground: templateNamesBackground ? '' : background,`.
  6. After the unresolved-variables warning and **before** `const briefingLayer = …`, add `prompt += `\n\n${HONESTY_RULE}`;`.
  7. After `briefingLayer` exists, build the flags:

```js
  const contextUsed = {
    background: Boolean(background),
    setNote: Boolean(String(questionSetAiContext || '').trim()),
    eventDetails: Boolean(String(eventDetails || '').trim()),
    hostInstructions: Boolean(String(gameAiContext || '').trim()),
    briefing: Boolean(briefingLayer),
  };
```

  Add `contextUsed` to the returned `result` object.
  8. In `dbItem`, after the `BriefingUsed` spread, add `...(summaryData.contextUsed ? { ContextUsed: summaryData.contextUsed } : {}),`. The flags are plaintext booleans, like `PersonaSource`. Do not add them to `ENCRYPTED_FIELDS.aiSummary`.
  9. In both `responseData` objects, add:
     - cached: `contextUsed: existingSummary.Item.ContextUsed || null,`
     - fresh: `contextUsed: summaryData.contextUsed || null,`
  10. In the `🔍 RAW QUESTION DATA` log line, add `background ${shapeForLog(question.background || question.Background)}`. That logs the shape only, never the text.

- [ ] **Step 5: The catalogue.** In all three `template-variables.js` copies, add directly after the `reveal` entry:

```js
  {
    // question-background spec §3. Read at RESULTS only; carried by no player payload.
    name: 'background',
    description: 'Background the question\'s author wrote for Workie: context, facts and angles to draw on. '
      + 'Never shown to players. Empty when the author left it blank.',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'Version control records every change to a codebase, so a team can see who changed what and undo it.',
  },
```

- [ ] **Step 6: Run and watch it pass**

Run:

```bash
node tests/question-background-workie.js; echo EXIT=$?
node tests/template-variable-catalogue.js; echo EXIT=$?
node tests/persona-controls.js; echo EXIT=$?
node tests/ai-summary-session-brief.js; echo EXIT=$?
node tests/briefing.js; echo EXIT=$?
cd src && CI=true npx jest templateVariables promptPreflight; cd ..
```

Expected: all EXIT=0. If `persona-controls.js` pins `buildContextBlock`'s exact output for three fields, it still passes: the fourth line appears only when a background is given.

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/game/personas.js lambda-functions/game/get-ai-summary.js lambda-functions/game/template-variables.js lambda-functions/admin/shared/template-variables.js src/src/config/templateVariables.js tests/question-background-workie.js
git commit -m "Workie reads each question's Background, obeys one honesty rule, and records what context it had"
```

---

### Task 6: The host sees what Workie had, on the phone remote and in the session report, never on the host page

**Files:**
- Create: `src/src/components/WorkieContextHint.jsx` (+ a few rules in `src/src/HostRemote.css` and the report's stylesheet; use existing tokens only, per the `engage-design` skill)
- Modify: `src/src/HostRemote.jsx` (under the `hr-notes-foot` paragraph, around `:921`)
- Modify: `lambda-functions/game/create-report.js` (around `:691`)
- Modify: `src/src/components/RoundReport.jsx` (beside the `briefingUsed` line, around `:381`)
- Test: `src/src/__tests__/workieContextHint.test.jsx` (new); a case in `src/src/__tests__/roundReport.test.jsx`

**Interfaces:**
- Consumes: `contextUsed` from the summary GET (Task 5), and `briefingUsed`/`contextUsed` on report rounds.
- Produces: `<WorkieContextHint contextUsed={obj|null} />`. It renders `null` when `contextUsed` is falsy.

- [ ] **Step 1: Write the failing test** `src/src/__tests__/workieContextHint.test.jsx`

```jsx
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import WorkieContextHint from '../components/WorkieContextHint';

const ALL = { background: true, setNote: true, eventDetails: false, hostInstructions: false, briefing: false };

test('lists the five kinds of context in the spec\'s order, ticked or dashed', () => {
  render(<WorkieContextHint contextUsed={ALL} />);
  expect(screen.getByTestId('workie-context-hint').textContent).toBe(
    'Workie had: question notes ✓ · set note ✓ · event details — · host instructions — · briefing —');
});

test('renders nothing for a summary written before the flags existed', () => {
  const { container } = render(<WorkieContextHint contextUsed={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('never mounted on the host page or its sidebar — both are surfaces the room can watch', () => {
  for (const rel of ['../GameHostPage.jsx', '../components/stage/SessionSetupPanel.jsx']) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect(src).not.toMatch(/WorkieContextHint/);
  }
});

test('mounted on the phone remote', () => {
  const src = fs.readFileSync(path.join(__dirname, '../HostRemote.jsx'), 'utf8');
  expect(src).toMatch(/<WorkieContextHint\s+contextUsed=\{aiSummary\?\.contextUsed/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src && CI=true npx jest workieContextHint; cd ..`
Expected: FAIL, "Cannot find module '../components/WorkieContextHint'".

- [ ] **Step 3: Create `src/src/components/WorkieContextHint.jsx`**

```jsx
/**
 * WHAT WORKIE HAD — a quiet line for the host alone (question-background spec §4).
 *
 * Flags only, never the content. Mounted on the phone remote and in the session
 * report; NEVER on the host page or its sidebar, which the room may be watching.
 * A summary written before the flags existed carries none, and gets no line rather
 * than a row of dashes that would read as "Workie had nothing".
 */
const ITEMS = [
  ['background', 'question notes'],
  ['setNote', 'set note'],
  ['eventDetails', 'event details'],
  ['hostInstructions', 'host instructions'],
  ['briefing', 'briefing'],
];

export default function WorkieContextHint({ contextUsed }) {
  if (!contextUsed || typeof contextUsed !== 'object') return null;
  const text = ITEMS.map(([key, label]) => `${label} ${contextUsed[key] ? '✓' : '—'}`).join(' · ');
  return (
    <p className="workie-context-hint" data-testid="workie-context-hint">{`Workie had: ${text}`}</p>
  );
}
```

- [ ] **Step 4: Mount it on the remote.** In `HostRemote.jsx`, import it and add this directly after the `hr-notes-foot` paragraph inside the ready branch:

```jsx
                    <WorkieContextHint contextUsed={aiSummary?.contextUsed || null} />
```

Add a rule to `HostRemote.css` using the notes' muted text token (the same one `.hr-notes-foot` uses), for example:

```css
.hr-notes .workie-context-hint { margin-top: 8px; font-size: 13px; color: var(--hr-muted, inherit); }
```

Match whatever variable `.hr-notes-foot` already uses; do not invent a colour.

- [ ] **Step 5: The session report.** In `create-report.js`, beside `briefingUsed: questionAISummary.BriefingUsed === true,`, add:

```js
          contextUsed: questionAISummary.ContextUsed || null,
```

In `RoundReport.jsx`, import the component and render `<WorkieContextHint contextUsed={summary.contextUsed || null} />` next to the existing `summary.briefingUsed` line. Add to `roundReport.test.jsx`, which already has the `aRound()` helper:

```jsx
test('a round shows what Workie had', () => {
  const contextUsed = { background: true, setNote: false, eventDetails: true, hostInstructions: false, briefing: false };
  render(<RoundReport round={aRound({ aiSummary: { ...aRound().aiSummary, contextUsed } })} />);
  expect(screen.getByTestId('workie-context-hint').textContent)
    .toBe('Workie had: question notes ✓ · set note — · event details ✓ · host instructions — · briefing —');
});

test('a round summarised before the flags existed shows no hint', () => {
  render(<RoundReport round={aRound()} />);
  expect(screen.queryByTestId('workie-context-hint')).toBeNull();
});
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd src && CI=true npx jest workieContextHint roundReport hostRemote; cd ..` and `node tests/create-report*.js 2>/dev/null; true` (run whichever create-report tests exist: `ls tests | grep -i report`).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/components/WorkieContextHint.jsx src/src/HostRemote.jsx src/src/HostRemote.css src/src/components/RoundReport.jsx lambda-functions/game/create-report.js src/src/__tests__/workieContextHint.test.jsx src/src/__tests__/roundReport.test.jsx
git commit -m "The host sees what Workie had, on the remote and in the report, never on the stage"
```

---

### Task 7: Admins can read and edit Background; outside authors are told about it

**Files:**
- Modify: `src/src/components/QuestionsPanel.jsx` (the form group beside "Reveal", around `:2100-2105`)
- Modify: `src/src/config/aiAuthoringPrompt.js` (the column guidance, around `:37-38` and `:95`)
- Test: `src/src/__tests__/questionsPanelBackground.test.jsx` (new)

**Interfaces:**
- Consumes: the editor row's `background` key (Task 2).

- [ ] **Step 1: Write the failing test**

Use the recipe from `src/src/__tests__/questionsPanelPreview.test.jsx`: `authFetch` is the only mock.

```jsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = { id: 'release-talk', name: 'Release Talk', engagementType: 'call-and-answer', canManage: true };
const QUESTIONS = {
  setId: SET.id,
  questions: [{ id: 'c001#001', Category: 'Delivery', title: 'WHAT SLOWS A RELEASE', Background: 'Git records every change.' }],
};
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
  authFetch.mockImplementation(async (url, options = {}) => {
    if ((options.method || 'GET').toUpperCase() === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    throw new Error(`Unhandled request: ${url}`);
  });
});

test('the editor shows and edits Background, labelled as never shown to players', async () => {
  render(<QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('question-0')).toBeInTheDocument());
  fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /edit/i }));
  const field = screen.getByLabelText('Background for Workie');
  expect(field.value).toBe('Git records every change.');
  expect(field).toHaveAttribute('maxLength', '600');
  expect(screen.getByText('Facts and context Workie may use. Never shown to players.')).toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'Trunk-based teams merge daily.' } });
  expect(screen.getByLabelText('Background for Workie').value).toBe('Trunk-based teams merge daily.');
});

test('the outside-author guide names the Background column and the certainty rule', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../config/aiAuthoringPrompt.js'), 'utf8');
  expect(src).toMatch(/Background/);
  expect(src).toMatch(/certain/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src && CI=true npx jest questionsPanelBackground; cd ..`
Expected: FAIL, "Unable to find a label with the text of: Background for Workie".

- [ ] **Step 3: The field.** In `QuestionsPanel.jsx`, add this full-width group directly after the `qs-form-grid` holding "Reveal" and "Tags":

```jsx
      {/* BACKGROUND — the author's material for Workie (question-background spec §1).
          Full width: it runs to 600 characters. Never shown to players. */}
      <div className="form-group">
        <label htmlFor={id('background')}>Background for Workie</label>
        <textarea
          id={id('background')}
          className="form-input"
          rows={3}
          maxLength={600}
          value={draft.background || ''}
          onChange={set('background')}
          aria-describedby={id('background-hint')}
        />
        <p id={id('background-hint')} className="form-hint">Facts and context Workie may use. Never shown to players.</p>
      </div>
```

Use the hint class this panel already uses for field help. Search `QuestionsPanel.jsx` for the existing hint element and match it. If `set(...)` expects an input event, a textarea works the same way.

- [ ] **Step 4: The outside-author guide.** In `aiAuthoringPrompt.js`, add `Background` to each column header list that has `AnswerDetails`, and to the Call & Answer header. Next to the existing "only things you are certain of" sentence, add:

```js
  '- Background (optional, every type): 2-4 sentences Workie may draw on — context, a well-established fact, '
  + 'an angle. Never shown to players. Only what you are certain of; no statistics, names or quotations you '
  + 'cannot stand behind.',
```

Keep the file's existing string style.

- [ ] **Step 5: Run and watch it pass**

Run: `cd src && CI=true npx jest questionsPanel aiAuthoringPrompt; cd ..`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/components/QuestionsPanel.jsx src/src/config/aiAuthoringPrompt.js src/src/__tests__/questionsPanelBackground.test.jsx
git commit -m "Admins edit Background in the set editor; outside authors are told the rule"
```

---

### Task 8: Verify everything, deploy dev, and prove it on dev

**Files:** none new, unless a fix is needed.

- [ ] **Step 1: Full backend loop**

```bash
rm -rf .aws-sam; git add -A; n=0; for f in tests/*.js; do n=$((n+1)); node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo "files: $n"
```

Expected: exactly one `FAIL tests/verify-question-set-ui.spec.js`, plus the file count, which is the previous count plus the new test files.

- [ ] **Step 2: Frontend.** Run `cd src && CI=true npx jest && npm run lint && npm run build; cd ..`
Expected: jest all green; lint 0 errors (warnings no more than before, 10); build exit 0.

- [ ] **Step 3: Deploy dev.** Check that `git merge-base --is-ancestor origin/dev HEAD` succeeds. If `origin/dev` moved, rebase and re-run Steps 1-2. Then run `git push origin HEAD:refs/heads/dev` and watch the pipeline:

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 1
```

Wait for `Succeeded`, which takes about 26 minutes.

- [ ] **Step 4: Acceptance on dev** (spec §5, at https://engage.dev.seibtribe.us, signed in as an Engage admin in the browser pane; the owner signs in, never Claude). Checks 1–2 need the owner, since they ask a person to set up or play a live session.
  1. Generate one Call & Answer set, with a brief in the context box, and one Trivia set. Open each in the set editor. Every question has a Background, and the set's Workie note contains the brief and the fixed line.
  2. Host a session of each with Event details filled in. Play one round with at least two responses (a second browser tab joins as a player). The summary reflects the notes and event details. The phone remote shows `Workie had: question notes ✓ · set note ✓ · event details ✓ …`.
  3. Host once more with no Event details. The stage says nothing about missing details, and the remote shows `event details —`.
  4. Read every generated Background. Report anything that looks invented: a statistic, a name or a quotation. If any are found, tighten `BACKGROUND_TRUTH_RULE` in a follow-up. Do not hand-edit the notes.

- [ ] **Step 5: Report.** Name the commit and the tier deployed. Give what each acceptance step showed, with screenshots where they help. List anything invented that step 4 found.
