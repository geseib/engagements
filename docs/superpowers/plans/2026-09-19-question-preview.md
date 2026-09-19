# Question preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the set editor's Questions tab gains a **[Table] [Preview]** switch; Preview shows the working copy as a searchable list beside the card the live stage renders, at the Table profile, on the stage's dusk ground — the same component, so the two cannot drift.

**Architecture:** the stage's inline ASK and trivia-RESULTS markup moves out of `GameHostPage.jsx` into `components/QuestionCard.jsx` as a pure refactor (identical DOM, proved against a frozen copy of the old markup). `styles/stage.css` lets the Table ladder apply to one element (`.stage-ladder-table`) so the preview never touches `:root`. A pure module turns an editor row into the shape the stage receives. `components/QuestionPreview.jsx` composes the list and the card; `QuestionsPanel.jsx` mounts it behind the switch.

**Tech Stack:** React 18 (classic JSX runtime), webpack + style-loader, jest + jsdom + Testing Library, plain CSS scoped per the engage-design skill.

**Spec:** `docs/superpowers/specs/2026-09-19-question-preview-design.md` — read it in full first. Its §2 decisions are settled by the owner and are not reopened here; its §6 lists what must not change.

## How this plan was proved before it was written

Every code block below is code that ran. All four tasks were built, in order, in a scratch copy of HEAD `29a055a7` (`git archive`, with `node_modules` linked read-only), and after each task the whole frontend suite, the linter and the build were run:

| after | frontend suites / tests | lint | build |
|---|---|---|---|
| baseline (re-run 2026-09-19) | 222 / 5226 | 0 errors, 10 warnings | exit 0, 2 size warnings |
| Task 1 | 224 / 5267 | 0 errors, 10 warnings | exit 0, 2 size warnings |
| Task 2 | 227 / 5302 | 0 errors, 10 warnings | exit 0, 2 size warnings |
| Task 3 | 229 / 5367 | 0 errors, 10 warnings | exit 0, 2 size warnings |
| Task 4 | 230 / 5377 | 0 errors, 10 warnings | exit 0, 2 size warnings |

Backend baseline: 147 suites, 0 failed. No backend file changes in this plan; the backend suites that read changed frontend files were checked (Verified facts, F15). Each new test was also run against a deliberately broken implementation (a swapped class order, a dropped attribute, a removed `stopPropagation`, an unstaged row, a missing reset) and went red — the RED counts quoted in the steps are real output. Line numbers are HEAD `29a055a7`'s; if one has drifted, match on the quoted text.

## Verified facts — the spec's verify-not-assume items, and what else the code said

- **F1 · §3.2, the derived properties.** The card's rules (`styles/stage.css:486-600`, `:724`) read `--t-primary`, `--t-secondary`, `--t-body`, `--measure`, `--floor`, `--hair`, `--rule`, `--radius`, `--text`, `--muted`, `--primary`, `--success`, `--success-text`, `--font-display`. The derived ones — `--t-*` and `--measure` — are declared on **`body`** as `var(--L-*)` / `var(--measure-base)` (`stage.css:94-96`), **not** in the bare `:root` block at `stage.css:828-835`, which holds only literals (`--rule`, `--hair`, `--success-text`). Resolved at `body` against the bare root's Room ladder (`stage.css:43`), they would reach a `.stage-ladder-table` wrapper at Room size. Two more gaps: `--hair` varies by profile (`:root.d-call{--hair:2px}`, `stage.css:75`), and `.stage-art` is **not** unscoped as §3.2 says — its only rule is `.content .stage-art` (`stage.css:724`). A prototype of Task 2's contract test reported exactly these six problems against today's file.
- **F2 · §3.4, the instruction's spelling.** `resolveInstruction` reads only `q.customInstructions || q.CustomInstructions` (`config/instructions.js:44`); `toRow` writes the singular `customInstruction` (`utils/questionRows.js:107`); the wire carries the plural (`lambda-functions/game/get-question.js:234`). The trap is real: `resolveInstruction(toRow(p), setLine, type)` returns the **set's** line for a question that has its own.
- **F3 · §3.4, two more shapes that do not line up.** `correctAnswer`: the editor stores `"OptionX"` (`components/QuestionsPanel.jsx:1464`); a RESULTS fetch rewrites it to the option's text (`get-question.js:249-268`). `isCorrectTriviaOption` compares slot ids against **positional** letters (`GameHostPage.jsx:88-107`), so on a question whose filled slots are not contiguous (A, C, D) a raw `"OptionC"` marks two options. `image`: an unsaved upload is a bare file name (`components/QuestionImageField.jsx:14-24`); the importer keys it to `sets/<setId>/<file>` on Save (`lambda-functions/admin/upload-questions.js:81-93`); the stage uses the raw value as `src`. Title, detail and the options do line up (`admin/get-question-set-questions.js:109-139` against `get-question.js:221-245`).
- **F4 · §4.4, engagement type → game type.** The host's chain: `GameSetupDialog` lists a set under the pill P only when `set.engagementType === P` (`components/GameSetupDialog.jsx:196`) and submits `gameType: P` (`:278`) → `config/createGame.js:51` → `websocket/create-game.js:197` stores `gameType || 'call-and-answer'` → `game/get-game.js:80` → `GameHostPage.jsx:2148`, `:4739` restore `|| 'call-and-answer'`; `game/get-question-sets.js:115` serves a missing type as `'call-and-answer'`. So: identity for call-and-answer, trivia, poll and wavelength; no type → call-and-answer. `normalizeGameType` (`config/gameTypes.js:95-101`) agrees on every set the host can play, and `QuestionsPanel` already computes `engagementType = normalizeGameType(questionSet?.engagementType)` (`QuestionsPanel.jsx:156`). That value is passed on as `gameType`; Task 2 pins it for every format.
- **F5 · §4.3, does `browserRow` accept a `toRow` row?** For display, yes: `title`, `detail`, `category` and `difficulty` read correctly. For identity, no: `browserRow` reads `id` / `Id` / `questionId` (`config/setupPanel.js:159`), a `toRow` row carries only `uid` and `sk` (`utils/questionRows.js:90-101`), and `sk` is `''` for every added or copied row (`:151`, `:175`). Every editor row would come back `id: undefined`. The thin adapter is `browserRow({ ...row, id: row.uid })`.
- **F6 · §3.1's premise.** `HostQuestionSetsDialog` — and the editor through it — mounts only inside early returns: the Welcome screen (`GameHostPage.jsx:4758-4787`, the mount at `:4784`) and `GameSetupDialog` (create `:4907`, edit `:4821`; the dialog mounts it at `GameSetupDialog.jsx:311`), all of which return before `<Stage>` at `GameHostPage.jsx:5457`. Today the editor is never over a live stage. The §3.1 requirement stays as defence in depth, and test 7 still pins it.
- **F7 · two existing tests read the markup that moves.** `__tests__/stageShell.test.jsx:769-803` ("chrome is sacrificed before content, in every state") scans only `GameHostPage.jsx` with a floor of 6 `data-drop` groups; exactly 6 exist today, and moving ASK's two into the card fails it (`Expected: >= 6, Received: 4`). `__tests__/wavelengthConvergence.test.jsx:404-406` regex-scans `GameHostPage.jsx` for the wavelength detail gate. Task 1 re-points both at the card; neither is loosened.
- **F8 · the editor is paper on both mounts.** `AdminPage.jsx:1636` renders it with `contentTheme` `'light'`; the host shelf's editor sits inside `.qsets.qsets--onlight` (`HostQuestionSetsDialog.jsx:397`, frame at `:932`). `.qs-editor .qs-panel` paints `var(--surface-2, #F1EDE4)` (`styles.css:10294-10300`), and the host shelf restates `--surface-2: #F1EDE4` (`QuestionSetsPanel.css:762-765`).
- **F9 · what an ancestor re-points.** `.qsets--onlight` sets `--text`, `--muted`, `--bg` and `--primary: #9A5B18` (`QuestionSetsPanel.css:675-693`); `.qsets--onlight .qs-editor` sets `--success: #1C7350` (`:762-765`); `[data-theme="dark"]` (`styles.css:69-75`) restores only `--bg`, `--surface`, `--surface-2`, `--text` and `--muted` — and its `--muted` is `#9BA8BE`, not the stage's lifted `#B6C2D4` (`stage.css:851`).
- **F10 · cascade order.** `index.jsx:3-5` imports `App` before `styles.css` and `stage.css`, and style-loader injects in evaluation order (`webpack.config.js:40-41`): every component stylesheet precedes both and loses an equal-specificity tie. `stage.css` is loaded on every route (`index.jsx:5`; `App.jsx` imports every page statically).
- **F11 · keys.** The stage's pager pages on a bare ↑/↓ heard by a `window` listener unless the target is a typing element (`config/stagePaging.js:564-574`); `anyOverlayOpen` does not include the set dialog (`GameHostPage.jsx:5018-5023`).
- **F12 · QuestionsPanel.** `rows` keeps tombstones as `removed: true` (`QuestionsPanel.jsx:397-401`); `startEdit` clones the row keeping its `uid` (`:361`) and `commitEdit` writes it back by `uid` (`:387-392`); `preview` (`:210`) is the CSV replace diff; the set-level instruction the panel knows is `questionSet?.customInstruction` (`:457`), the saved value. `QuestionSetEditor` mounts it with `questionSet={currentSet}`, where `currentSet` is simply its `questionSet` prop (`QuestionSetEditor.jsx:913`, `:1581-1590`).
- **F13 · toolchain.** ESLint runs three rules: `react-hooks/rules-of-hooks` (error), `react-hooks/exhaustive-deps` (warn), `no-undef` (error) (`src/.eslintrc.js`). An `eslint-disable` comment naming a rule from a plugin this config does not load is itself reported as an error. Babel uses the classic JSX runtime (`src/babel.config.js`), so every JSX file, tests included, imports React. Every `.js`/`.jsx` under `src/src/__tests__` runs as a suite (`src/jest.config.js:12-15`).
- **F14 · baselines**, re-run on 2026-09-19 at `29a055a7`: frontend 222 suites / 5226 tests; backend 147 suites / 0 failed; lint 0 errors / 10 warnings; build exit 0 with its two asset-size warnings.
- **F15 · backend suites that read changed frontend files.** `tests/games-list-authorization.js:285` and `tests/session-control-routes-authorization.js:248` read `GameHostPage.jsx` only for its `${API_BASE}games` call sites, which this plan does not touch; `tests/question-queue-order.js:44` reads `setupPanel.js` and passed 126/0 against Task 2's version.

## Decisions made while planning (none reopens §2)

- **D1 · Reveal is the RESULTS option block alone.** In Reveal the card renders `<QuestionCard phase="REVEAL">` — the options, the correct one marked, the rest dimmed — and no heading, because §4.2 defines REVEAL as the `div.opts` block and names the preview as the caller that omits `answers`, and the stage's RESULTS draws no heading. The §1 sketch draws the question above the revealed options; in this build the list's highlighted row and the `3 / 30` position carry that orientation. If the owner wants the heading kept in Reveal, that is a change to the preview's composition, not to the card.
  **Reversed at the branch's final review.** D1 was this plan's call, not the owner's, and it departed from the approved spec: the §1 sketch is drawn in Reveal (the tick and the reveal note appear only there) and has the question above the options. With Reveal sticky, every question you moved to showed four answers and nothing saying what was asked. The heading alone would not have been enough either. The trivia generator writes the title as "a label for the question, not the question itself" and the question as asked into `questionDetail` (`lambda-functions/admin/ai-generate-trivia.js:81-82`, `:121-122`). So in Reveal the preview's card now draws the question in ASK's own lines (heading, picture, full prompt) above the revealed options. It leaves out the how-to-answer line, because in Reveal the answering is over. The change goes through the card after all, contrary to the last sentence above: an opt-in `withQuestion` prop that the stage never passes. The question lines stay one block shared with ASK, which a preview-side copy would not have been. The stage's two call sites and the frozen DOM oracles are unchanged. `questionCardDom.test.jsx` builds the new composition from those oracles and holds the stage to never passing the prop, and `questionPreview.test.jsx` holds the order in Reveal, including after moving.
- **D2 · Shaping lives in the preview, not in `resolveInstruction`.** `config/questionPreview.js:stagedQuestion` maps the per-question instruction to the wire's spelling, keys the image as Save will, and applies the RESULTS rewrite of `correctAnswer`. `resolveInstruction` is unchanged, so no host or player path moves. The preview still passes `resolveInstruction(…)` (§4.2), with the staged row.
- **D3 · `QuestionPreview` takes a fifth prop, `setId`.** The image key needs it.
- **D4 · The set-level instruction is the saved one** — `questionSet.customInstruction`, the value the host reads at play time (`get-question.js:219`) and the one the panel already treats as the set's (`QuestionsPanel.jsx:457`). §2.1's "unsaved edits included" is about the rows; an unsaved change in the Details panel's Custom Instructions field shows after that panel's own Save Changes.
  **Reversed after the branch's review.** The owner's decision is that the preview shows unsaved edits, and a Details edit is one. The live value was already at hand: `QuestionSetEditor` keeps the field as its `instructions` state and passes it to `QuestionsPanel` as `detailsInstruction`, which hands it to the preview. A cleared field is a real value, and the card then shows the format's default line. With no Details panel beside it, the panel falls back to the saved instruction. `questionsPanelPreview.test.jsx` drives the real editor.
- **D5 · The note's label is the spec's literal: "Reveal — shown only after the round".** The editor's field reads "Reveal (shown only after the round)" (`QuestionsPanel.jsx:1564`): the same words, different punctuation.
- **D6 · Two existing tests are re-pointed, not weakened (spec §6).** The stageShell drop-ladder scan reads `GameHostPage.jsx` and `QuestionCard.jsx` (floor 6 and every assertion unchanged). The wavelength detail-gate test asserts the gate in `QuestionCard.jsx`, the stage's `gameType={currentGameType}` hand-off, and a render. `setupPanel.test.js` is not edited; `matchDetail` gets its own file.
- **D7 · Preview hides only the table's own "Filter by category" select** (it would filter a table nobody can see). The dirty bar, Add, Pull, Save/Discard, Download and Replace stay: they act on the working copy, which is the thing being previewed.
  **Extended after the branch's review:** Preview also hides "Save N selected as a new set…". It acts on the table's checkboxes, which Preview does not show. The selection is kept, and the button returns with the table.
- **D8 · The [Preview] segment says why it is disabled** — while loading, after a load error, and (§4.4's case) for a set with no questions.
- **D9 · Chips appear only when the set uses more than one category**; a single chip would filter nothing.
- **D10 · ↑/↓ stop at the preview's root** (`preventDefault` + `stopPropagation`), so no `window` listener — the stage's pager — ever hears one. This is §3.1's hazard applied to keys.
- **D11 · Selection is keyed by the editor row's `uid`**, the one key that survives an edit and exists for unsaved rows.
- **D12 · `QuestionViewSwitch` is exported from `QuestionPreview.jsx`** and styled in `QuestionPreview.css` under `.qprev-switch`, because it renders in the toolbar, outside the preview's root.

## Global Constraints

- **Where.** `WORKTREE = /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview`, `BRANCH = working/question-preview`. Absolute paths only. Never read, edit, commit in or `cd` into another checkout — `…/worktrees/goofy-matsumoto-6f1713` and `…/worktrees/scorecard-tally` are both in use. Never push, never create tags, never switch branches, never touch dev/test/prod/main. Commits stay local on BRANCH.
- **Frontend tests:** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npm test` (plain jest). **Never `npx react-scripts`**: this is a webpack app, and that harness reports about 19 false failures. One file: `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/<file>`.
- **Backend tests:** every `tests/*.js` (skip `*.spec.js`, which are Playwright) is a standalone node script. Judge by **exit code**, never by grepping output, and assert the suite **count**, because a crashed suite prints nothing:
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && total=0; failed=0; for f in tests/*.js; do case "$f" in *.spec.js) continue;; esac; total=$((total+1)); node "$f" > /dev/null 2>&1 || { failed=$((failed+1)); echo "FAIL ${f}"; }; done; echo "suites=${total} failed=${failed}"
  ```
  Expected: `suites=147 failed=0`.
- **Lint:** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npm run lint` — 0 errors; the baseline has 10 warnings and this plan adds none. **Build:** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npm run build` — exit 0 with the two known asset-size warnings.
- **Never run `npm install`, anywhere.** `node_modules` are symlinks into the main checkout; an install prunes the shared tree and breaks every worktree.
- **zsh.** Brace a variable before a colon (`"${b}:x"`, never `"$b:x"`); `PIPESTATUS` does not exist.
- **File names.** A test file whose name contains "token" is invisible to git (`.gitignore` has an unanchored `*token*`). The palette test is `QuestionPreviewPalette.test.js`.
- **The twin guard.** `tests/no-retired-twin-references.js` scans every **tracked** file — code, comments, plans and test names — for the old deploy-rule phrasings listed at its lines 168-175. Never write any of them; say "changes nothing". It reads `git ls-files`, so `git add` new files before the final backend run.
- **Design.** Invoke the **engage-design** skill (Skill tool) before writing any stylesheet or component markup under `src/src/` — every task in this plan does. Its rules this plan leans on: selectors rooted at the scope class, colour as tokens outside the token block, the 12/13/15/19 ladder with nothing under 12px, `title=` on truncating text, one `Modal` and never a modal inside a modal, no control that does nothing, and no geometric assertions in jest.
- **Spec §6 holds throughout.** `browserRow` stays an allow-list and `setupPanel.test.js` passes unedited; the in-session search stays titles-only; the stage's ASK and trivia RESULTS DOM is unchanged; no existing test is weakened or deleted.
- **JSX and tests.** Every JSX file imports React (classic runtime). Anything `.js`/`.jsx` under `src/src/__tests__` runs as a suite, so put no helper modules there. Add no `eslint-disable` comment naming a rule from a plugin this config does not load.
- **Watch every new test fail before making it pass**, and paste the literal failure in the task report.
- **Commits.** One commit per coherent step. The message is a plain sentence saying what now behaves differently, then a blank line, then exactly:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/src/config/questionCard.js` (new) | 1 | The card's own data: option slots, lettering, the correct-answer test, the share arithmetic. Shared by stage and preview. |
| `src/src/components/QuestionCard.jsx` (new) | 1 | The card: ASK and REVEAL fragments, the stage's exact DOM. |
| `src/src/GameHostPage.jsx` | 1 | Renders `<QuestionCard>` for ASK and trivia RESULTS; its inline copies are deleted. |
| `src/src/__tests__/questionCard.test.js` (new) | 1 | The data module, including every correct-answer spelling. |
| `src/src/__tests__/questionCardDom.test.jsx` (new) | 1 | The card against a frozen copy of the old markup; the stage's call sites. |
| `src/src/__tests__/stageShell.test.jsx`, `wavelengthConvergence.test.jsx` | 1 | Re-pointed at the card (D6). |
| `src/src/styles/stage.css` | 2 | The Table ladder, the `--t-*` derivation and the art rule also match `.stage-ladder-table`. |
| `src/src/config/setupPanel.js` | 2 | `filterBrowserRows` gains opt-in `matchDetail`. |
| `src/src/config/questionPreview.js` (new) | 2, 3 | What the preview computes: `stagedQuestion` (2); the list's rows, categories and stepping (3). |
| `src/src/__tests__/stageLadderScope.test.js` (new) | 2 | The ladder scope, followed through every `var()` chain. |
| `src/src/__tests__/setupPanelMatchDetail.test.js` (new) | 2 | `matchDetail`, on and off. |
| `src/src/__tests__/questionPreviewParity.test.jsx` (new) | 2 | An editor row renders as the wire question does; the type mapping. |
| `src/src/components/QuestionPreview.jsx` (new) | 3 | The two panes, plus `QuestionViewSwitch`. |
| `src/src/components/QuestionPreview.css` (new) | 3 | Scope `.qprev` / `.qprev-switch`. |
| `src/src/__tests__/questionPreview.test.jsx` (new) | 3 | Behaviour, the untouched root, the list's data. |
| `src/src/__tests__/QuestionPreviewPalette.test.js` (new) | 3 | Contrast on both surfaces; the scope's rules. |
| `src/src/components/QuestionsPanel.jsx` | 4 | `viewMode`, the switch in the toolbar, the mount. |
| `src/src/__tests__/questionsPanelPreview.test.jsx` (new) | 4 | The switch and the preview inside the real panel. |

---

### Task 1: One card for the stage and the preview — a pure refactor

The stage's ASK markup and its trivia RESULTS option block move out of `GameHostPage.jsx` into `QuestionCard`, with identical DOM. Nothing on the stage changes. This is the task the rest of the plan stands on.

**Files:**
- Create: `src/src/config/questionCard.js`, `src/src/components/QuestionCard.jsx`
- Create: `src/src/__tests__/questionCard.test.js`, `src/src/__tests__/questionCardDom.test.jsx`
- Modify: `src/src/GameHostPage.jsx` — the import (after `:14`), the two helpers (`:77-107`), the numbering comment (`:5611`), the ASK block (`:5660-5717`), the trivia RESULTS branch (`:5842-5861`)
- Modify: `src/src/__tests__/stageShell.test.jsx` (`:774`), `src/src/__tests__/wavelengthConvergence.test.jsx` (`:24`, `:401-406`)

**Interfaces:**
- Produces, from `config/questionCard.js`: `TRIVIA_OPTION_KEYS: string[]`; `isCorrectTriviaOption(question, key, letter): boolean` (moved verbatim); `triviaOptions(question): Array<{ key, letter, text }>` (filled slots only, lettered by position); `optionShare(answers, letter): number` (a whole percent; 0, never NaN, for no answers).
- Produces, from `components/QuestionCard.jsx`, the default export `QuestionCard({ phase = 'ASK', question = null, gameType, instruction = '', answers, onExpand })`. It renders fragments, never a wrapper. `phase="REVEAL"` renders `null` unless `gameType === 'trivia'`; `.fill` and `.pct` render only when `Array.isArray(answers)`; the heading carries `data-expandable`, `title` and `onClick` only when `onExpand` is a function; ASK with no question renders nothing; REVEAL with no question renders the stage's empty `div.opts`.

- [ ] **Step 1: Invoke the engage-design skill.**
- [ ] **Step 2: Write the failing tests.** `src/src/__tests__/questionCard.test.js`:

```js
/**
 * The question card's decisions, as data (config/questionCard.js).
 *
 * `isCorrectTriviaOption` and `TRIVIA_OPTION_KEYS` lived inside GameHostPage.jsx,
 * which cannot mount in jsdom, so nothing tested them. They moved out verbatim
 * when the card was extracted (spec 2026-09-19 §4.1); these pin the behaviour
 * from the new home so the move cannot have changed it.
 */
import {
  TRIVIA_OPTION_KEYS, isCorrectTriviaOption, triviaOptions, optionShare,
} from '../config/questionCard';

const QUESTION = {
  optionA: 'A 5% list increase held through renewal',
  optionB: 'Seat-based to usage-based billing',
  optionC: 'A premium support tier',
  optionD: 'Discounting the entry plan',
};
/** Which of A–D come back correct for this recorded answer. */
const correctSlots = (correctAnswer) => ['A', 'B', 'C', 'D']
  .filter((letter) => isCorrectTriviaOption({ ...QUESTION, correctAnswer }, `option${letter}`, letter));

describe('isCorrectTriviaOption — every way a set records the answer', () => {
  test.each([
    ['the slot id', 'OptionB'],
    ['the bare letter', 'B'],
    ['the option\'s own text', QUESTION.optionB],
    ['an array of the slot id', ['OptionB']],
    ['an array of the bare letter', ['B']],
    ['an array of the text', [QUESTION.optionB]],
  ])('%s marks B and only B', (_label, correctAnswer) => {
    expect(correctSlots(correctAnswer)).toEqual(['B']);
  });

  test('an array naming two options marks both', () => {
    expect(correctSlots(['OptionA', QUESTION.optionD])).toEqual(['A', 'D']);
  });

  test('no recorded answer marks nothing, and no question marks nothing', () => {
    expect(correctSlots('')).toEqual([]);
    expect(correctSlots(undefined)).toEqual([]);
    expect(correctSlots([null, ''])).toEqual([]);
    expect(isCorrectTriviaOption(null, 'optionA', 'A')).toBe(false);
  });
});

describe('triviaOptions — the options as the stage letters them', () => {
  test('the slots are A to F, in that order', () => {
    expect(TRIVIA_OPTION_KEYS).toEqual(['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']);
  });

  test('filled slots only, lettered by position among the filled ones', () => {
    // rejects: lettering by slot. The stage has always drawn A, C and D as
    // A, B and C — the room's phones answer in those letters.
    expect(triviaOptions({ optionA: 'one', optionC: 'three', optionD: 'four' })).toEqual([
      { key: 'optionA', letter: 'A', text: 'one' },
      { key: 'optionC', letter: 'B', text: 'three' },
      { key: 'optionD', letter: 'C', text: 'four' },
    ]);
  });

  test('no question, no options', () => {
    expect(triviaOptions(null)).toEqual([]);
    expect(triviaOptions(undefined)).toEqual([]);
  });
});

describe('optionShare — the RESULTS arithmetic', () => {
  const answers = [{ answer: 'B' }, { answer: 'B' }, { answer: 'A' }];

  test('a whole percent of the room', () => {
    expect(optionShare(answers, 'B')).toBe(67);
    expect(optionShare(answers, 'A')).toBe(33);
    expect(optionShare(answers, 'C')).toBe(0);
  });

  test('nobody answered is 0, never NaN', () => {
    expect(optionShare([], 'A')).toBe(0);
    expect(optionShare(undefined, 'A')).toBe(0);
  });
});
```

`src/src/__tests__/questionCardDom.test.jsx`. The two oracles are the inline markup exactly as it stands at `29a055a7`. They are frozen: never edit one to match the component.

```jsx
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent } from '@testing-library/react';
import QuestionCard from '../components/QuestionCard';
import { isCorrectTriviaOption } from '../config/questionCard';

/**
 * THE CARD RENDERS THE STAGE'S DOM — proved against the markup it replaced.
 *
 * GameHostPage.jsx cannot mount in jsdom, so "the stage renders the same DOM
 * before and after" cannot be asserted by rendering the stage. It is asserted
 * here instead: the two oracles below are the inline markup exactly as it stood
 * at 29a055a7 (GameHostPage.jsx 5672-5715 for ASK, 5843-5861 for trivia
 * RESULTS), with only their free variables turned into props. innerHTML
 * equality is attribute-for-attribute and order-for-order.
 *
 * THE ORACLES ARE FROZEN. Never "update one to match" the component — a
 * difference IS the finding. If the stage's markup is changed on purpose, change
 * QuestionCard and retire the matching case here with a note saying why.
 */
const KEYS_AT_29A055A7 = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

function OracleAsk({ currentQuestion, currentGameType, instructionText, expandQuestion }) {
  return (
    <>
      <h1
        className="q"
        data-expandable="1"
        title="Show the full question"
        onClick={expandQuestion}
      >
        {currentQuestion.title || currentQuestion.question}
      </h1>
      {currentQuestion.image && (
        <img
          className="stage-art"
          src={currentQuestion.image}
          alt={currentQuestion.title || 'Artwork'}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {currentGameType !== 'wavelength'
        && (currentQuestion.questionDetail || currentQuestion.detail) && (
        <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
          {currentQuestion.questionDetail || currentQuestion.detail}
        </p>
      )}
      {currentGameType === 'trivia' && (
        <div className="opts">
          {KEYS_AT_29A055A7
            .filter((key) => currentQuestion[key])
            .map((key, index) => (
              <div key={key} className="opt">
                <span className="ltr">{String.fromCharCode(65 + index)}</span>
                <span className="txt">{currentQuestion[key]}</span>
              </div>
            ))}
        </div>
      )}
      <p className="qdetail" data-drop="3" data-drop-note="How to answer">
        {instructionText}
      </p>
    </>
  );
}

function OracleTriviaResults({ currentQuestion, answers }) {
  return (
    <div className="opts">
      {KEYS_AT_29A055A7
        .filter((key) => currentQuestion?.[key])
        .map((key, index) => {
          const letter = String.fromCharCode(65 + index);
          const isCorrect = isCorrectTriviaOption(currentQuestion, key, letter);
          const picked = answers.filter((a) => a.answer === letter).length;
          const pct = answers.length
            ? Math.round((picked / answers.length) * 100) : 0;
          return (
            <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
              <span className="fill" style={{ width: `${pct}%` }} />
              <span className="ltr">{letter}</span>
              <span className="txt">{currentQuestion[key]}</span>
              <span className="pct">{`${pct}%`}</span>
            </div>
          );
        })}
    </div>
  );
}

const html = (element) => render(element).container.innerHTML;

const TRIVIA = {
  id: 'q-7',
  title: 'Which killer was caught by a parking ticket?',
  questionDetail: 'New York, 1977.',
  optionA: 'Ted Bundy',
  optionB: 'David Berkowitz',
  optionC: 'John Wayne Gacy',
  optionD: 'Richard Ramirez',
  correctAnswer: 'David Berkowitz',
};
const ART = {
  id: 'a-2', title: 'THE COMPANY STEPS OUT', detail: 'Oil on canvas.', image: '/assets/art/x.jpg',
};
const HOW = 'Select the best answer:';

describe('ASK — the card is the markup the stage rendered inline', () => {
  test.each([
    ['trivia', TRIVIA, 'trivia'],
    ['a question with an image', ART, 'call-and-answer'],
    ['wavelength, whose stored detail never renders', { ...ART, image: '' }, 'wavelength'],
    ['a question with no detail at all', { id: 'x', title: 'Bare' }, 'poll'],
    ['a question carrying only the wire\'s legacy `question` field', { id: 'y', question: 'Legacy' }, 'call-and-answer'],
  ])('%s, with the stage\'s expand handler', (_label, question, gameType) => {
    const onExpand = () => {};
    expect(html(<QuestionCard phase="ASK" question={question} gameType={gameType} instruction={HOW} onExpand={onExpand} />))
      .toBe(html(<OracleAsk currentQuestion={question} currentGameType={gameType} instructionText={HOW} expandQuestion={onExpand} />));
  });

  test('without a handler, the heading carries none of the expand affordance and nothing else changes', () => {
    // rejects: a heading that shows the zoom cursor and "Show the full
    // question" and then does nothing when pressed — a dead control.
    const card = render(<QuestionCard phase="ASK" question={TRIVIA} gameType="trivia" instruction={HOW} />).container;
    const h1 = card.querySelector('h1.q');
    expect(h1.hasAttribute('data-expandable')).toBe(false);
    expect(h1.hasAttribute('title')).toBe(false);

    const oracle = render(<OracleAsk currentQuestion={TRIVIA} currentGameType="trivia" instructionText={HOW} expandQuestion={() => {}} />).container;
    const oracleH1 = oracle.querySelector('h1.q');
    oracleH1.removeAttribute('data-expandable');
    oracleH1.removeAttribute('title');
    expect(card.innerHTML).toBe(oracle.innerHTML);
  });

  test('the heading calls the handler it was given', () => {
    const onExpand = jest.fn();
    const { container } = render(<QuestionCard phase="ASK" question={TRIVIA} gameType="trivia" instruction={HOW} onExpand={onExpand} />);
    fireEvent.click(container.querySelector('h1.q'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  test('a broken image hides itself, as the stage\'s does', () => {
    const { container } = render(<QuestionCard phase="ASK" question={ART} gameType="call-and-answer" instruction={HOW} />);
    const img = container.querySelector('img.stage-art');
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
  });

  test('no question, no card', () => {
    // The stage guards with `currentQuestion &&`; the card must not throw if a
    // caller forgets to.
    expect(html(<QuestionCard phase="ASK" question={null} gameType="trivia" instruction={HOW} />)).toBe('');
  });
});

describe('REVEAL — the trivia RESULTS option treatment', () => {
  const answers = [{ answer: 'B' }, { answer: 'B' }, { answer: 'A' }, { answer: 'C' }];

  test('with the room\'s answers, every option carries its bar and its share', () => {
    expect(html(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" answers={answers} />))
      .toBe(html(<OracleTriviaResults currentQuestion={TRIVIA} answers={answers} />));
  });

  test('with an empty answer list, 0% is drawn — on the stage 0% is true', () => {
    const { container } = render(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" answers={[]} />);
    expect(container.innerHTML).toBe(html(<OracleTriviaResults currentQuestion={TRIVIA} answers={[]} />));
    expect([...container.querySelectorAll('.pct')].map((n) => n.textContent)).toEqual(['0%', '0%', '0%', '0%']);
  });

  test('with no question, the stage\'s empty options block — as the inline markup drew it', () => {
    expect(html(<QuestionCard phase="REVEAL" question={null} gameType="trivia" answers={[]} />))
      .toBe(html(<OracleTriviaResults currentQuestion={null} answers={[]} />));
  });

  test('without answers, neither the bar nor the figure renders', () => {
    // rejects: a 0% bar in the preview, which would claim nobody chose it.
    const { container } = render(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" />);
    expect(container.querySelector('.fill')).toBeNull();
    expect(container.querySelector('.pct')).toBeNull();
    const rows = [...container.querySelectorAll('.opt')];
    expect(rows.map((r) => r.className)).toEqual(['opt dim', 'opt correct', 'opt dim', 'opt dim']);
    expect(rows.map((r) => [...r.children].map((c) => c.className))).toEqual(
      rows.map(() => ['ltr', 'txt'])
    );
  });

  test('only trivia has anything to reveal', () => {
    for (const gameType of ['call-and-answer', 'poll', 'wavelength', 'survey']) {
      expect(html(<QuestionCard phase="REVEAL" question={TRIVIA} gameType={gameType} />)).toBe('');
    }
  });
});

describe('the stage really renders it', () => {
  /*
   * Read from the source, because GameHostPage cannot mount in jsdom. Without
   * this, re-inlining the markup "just for one tweak" would fork the stage from
   * the preview silently — every test above would still pass.
   */
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const cards = source.match(/<QuestionCard\b[^>]*\/>/g) || [];

  test('it imports the card and renders it twice: ASK and trivia RESULTS', () => {
    expect(source).toMatch(/import QuestionCard from '\.\/components\/QuestionCard';/);
    expect(cards).toHaveLength(2);
  });

  test('ASK hands over the expand handler and the host\'s instruction', () => {
    const ask = cards.find((c) => /phase="ASK"/.test(c));
    expect(ask).toMatch(/onExpand=\{expandQuestion\}/);
    expect(ask).toMatch(/instruction=\{getHostInstructionText\(currentQuestionOf\(questions, currentQuestionId\)\)\}/);
    expect(ask).toMatch(/gameType=\{currentGameType\}/);
  });

  test('RESULTS hands over the room\'s answers — without them the shares vanish', () => {
    // rejects: dropping `answers` at the call site. The card would then render
    // the PREVIEW's treatment on the projector: no bars, no percentages.
    const reveal = cards.find((c) => /phase="REVEAL"/.test(c));
    expect(reveal).toMatch(/answers=\{answers\}/);
  });

  test('none of the card\'s markup survives inline', () => {
    expect(source).not.toMatch(/className="opts?"/);
    expect(source).not.toMatch(/className=\{`opt\b/);
    expect(source).not.toMatch(/TRIVIA_OPTION_KEYS|isCorrectTriviaOption/);
    expect(source).not.toMatch(/data-drop-note="(Full prompt|How to answer)"/);
  });
});
```

- [ ] **Step 3: Run them and paste the failure.**
  `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/questionCard`
  Expected: both suites fail with `Cannot find module '../config/questionCard'` / `'../components/QuestionCard'`.
- [ ] **Step 4: Create the data module**, `src/src/config/questionCard.js`:

```js
/**
 * THE QUESTION CARD, AS DATA — what the card computes before anything renders.
 *
 * The card is rendered by two surfaces: the live stage (GameHostPage.jsx, ASK
 * and trivia RESULTS) and the set editor's preview (components/QuestionPreview.jsx).
 * GameHostPage cannot mount in jsdom — it dies on the auth provider
 * (components/stage/Pager.jsx's header) — so every decision the card makes
 * lives here, where a test can reach it without mounting anything.
 *
 * NOTHING HERE MAY CHANGE WHAT THE STAGE SHOWS. `TRIVIA_OPTION_KEYS` and
 * `isCorrectTriviaOption` moved here verbatim from GameHostPage.jsx (lines
 * 77-107 at 29a055a7); `triviaOptions` and `optionShare` are the two inline
 * expressions its ASK and RESULTS markup computed, lifted unchanged.
 */

/** Trivia answer slots, in display order. */
export const TRIVIA_OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

/**
 * Is this option slot the correct answer?
 *
 * Question sets in the wild record `correctAnswer` four different ways —
 * "OptionA", "A", the option's own text, or an array of any of those — so the
 * comparison has to try all of them. Lifted verbatim out of the RESULTS render
 * when that moved onto the stage; the logic is unchanged.
 */
export function isCorrectTriviaOption(question, key, letter) {
  if (!question) return false;
  const optionId = `Option${letter}`;
  const candidates = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : [question.correctAnswer];

  for (const correct of candidates) {
    if (!correct) continue;
    if (correct === optionId || correct === letter || correct === question[key]) return true;
    if (typeof correct === 'string' && correct.startsWith('Option')) {
      const correctLetter = correct.replace('Option', '');
      if (`option${correctLetter}` === key || correctLetter === letter) return true;
    }
    if (typeof correct === 'string' && correct.length === 1 && /[A-F]/.test(correct)) {
      if (`option${correct}` === key || correct === letter) return true;
    }
  }
  return false;
}

/**
 * The options a trivia question actually carries, lettered as the stage
 * letters them: FILLED slots only, lettered by position among the filled ones.
 * A question with optionA, optionB and optionD shows A, B, C — exactly what
 * `.filter((key) => question[key]).map((key, index) => 65 + index)` did inline.
 */
export function triviaOptions(question) {
  if (!question) return [];
  return TRIVIA_OPTION_KEYS
    .filter((key) => question[key])
    .map((key, index) => ({ key, letter: String.fromCharCode(65 + index), text: question[key] }));
}

/**
 * The share of the room that picked `letter`, as a whole percent — the RESULTS
 * arithmetic, unchanged. 0, never NaN, when nobody answered.
 */
export function optionShare(answers, letter) {
  const list = Array.isArray(answers) ? answers : [];
  const picked = list.filter((a) => a.answer === letter).length;
  return list.length ? Math.round((picked / list.length) * 100) : 0;
}
```

- [ ] **Step 5: Create the card**, `src/src/components/QuestionCard.jsx`. The two comments moved in from `GameHostPage.jsx` carry no `data-drop="N"` text in a `//` comment: the stageShell scan strips block comments only.

```jsx
import React from 'react';
import { triviaOptions, isCorrectTriviaOption, optionShare } from '../config/questionCard';

/**
 * THE QUESTION AS THE ROOM SEES IT — one component, two callers.
 *
 * The live stage renders it for ASK and for trivia RESULTS (GameHostPage.jsx);
 * the set editor's preview renders it for ASK and Reveal
 * (components/QuestionPreview.jsx). It used to be inline markup in
 * GameHostPage, which no test can mount, so a preview built beside it would
 * have been a second copy that drifted on its first edit. One component makes
 * that drift structurally impossible (spec 2026-09-19 §2.3).
 *
 * IT RENDERS FRAGMENTS, NOT A BOX. The stage places these elements directly
 * inside `.content > .fitbox`, which the fitter measures and scales; a wrapper
 * here would change the DOM the fitter walks. The preview supplies its own box.
 *
 * THE STAGE'S DOM IS THE CONTRACT: same elements, classes, attributes and
 * order as the inline markup it replaced, pinned against a frozen copy of that
 * markup in __tests__/questionCardDom.test.jsx.
 *
 *   phase="ASK"     h1.q, img.stage-art, the full-prompt line (never for
 *                   wavelength), the trivia options, the how-to-answer line.
 *   phase="REVEAL"  trivia only: the options, correct one marked, the rest
 *                   dimmed. With `answers` (the stage) every option also
 *                   carries its share — 0% included, because on the stage 0%
 *                   is true. Without `answers` (the preview) neither the bar
 *                   nor the figure renders: there were no votes, and a 0% bar
 *                   would claim nobody chose it.
 *
 * `instruction` IS A PROP. The stage passes getHostInstructionText(…) and the
 * preview resolveInstruction(…); the card never decides what the room is told.
 */
export default function QuestionCard({
  phase = 'ASK',
  question = null,
  gameType,
  instruction = '',
  answers,
  onExpand,
}) {
  if (phase === 'REVEAL') {
    if (gameType !== 'trivia') return null;
    const tallied = Array.isArray(answers);
    return (
      <div className="opts">
        {triviaOptions(question).map(({ key, letter, text }) => {
          const isCorrect = isCorrectTriviaOption(question, key, letter);
          const pct = tallied ? optionShare(answers, letter) : 0;
          return (
            <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
              {tallied && <span className="fill" style={{ width: `${pct}%` }} />}
              <span className="ltr">{letter}</span>
              <span className="txt">{text}</span>
              {tallied && <span className="pct">{`${pct}%`}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  if (!question) return null;

  /* THE RECOVERY FOR A DROPPED PROMPT, and only where there is one.
     The full prompt below is the LAST thing the fitter sacrifices on a dense
     ASK, after both host controls and the how-to-answer line — but it can
     still go. Click-to-expand is how the host gets it back. Mouse-only on
     purpose: giving the heading a tabIndex would put SPACE — the advance
     shortcut — on a focusable element that also opens a modal.
     GATED ON THE HANDLER. The preview passes none, and a heading that zooms
     the cursor and does nothing on click is a dead control. */
  const expand = typeof onExpand === 'function'
    ? { 'data-expandable': '1', title: 'Show the full question', onClick: onExpand }
    : {};
  const detail = question.questionDetail || question.detail;

  return (
    <>
      <h1 className="q" {...expand}>
        {question.title || question.question}
      </h1>
      {question.image && (
        <img
          className="stage-art"
          src={question.image}
          alt={question.title || 'Artwork'}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {/* WAVELENGTH SHOWS THE TERM AND NOTHING ABOUT IT. The owner, off the AI
          Jargon set: "we dont want to give them ideas of the meaning, we are
          looking to them to share their meaning." A stored detail sentence IS
          a definition, so for wavelength this line never renders — whatever
          the set carries. */}
      {gameType !== 'wavelength' && detail && (
        <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
          {detail}
        </p>
      )}
      {gameType === 'trivia' && (
        <div className="opts">
          {triviaOptions(question).map(({ key, letter, text }) => (
            <div key={key} className="opt">
              <span className="ltr">{letter}</span>
              <span className="txt">{text}</span>
            </div>
          ))}
        </div>
      )}
      <p className="qdetail" data-drop="3" data-drop-note="How to answer">
        {instruction}
      </p>
    </>
  );
}
```

- [ ] **Step 6: Run the card tests.** Same command as Step 3. Expected: `Tests: 4 failed, 27 passed, 31 total` — the four in "the stage really renders it", because `GameHostPage.jsx` still draws its own markup.
- [ ] **Step 7: Move the stage onto the card.** Apply this to `src/src/GameHostPage.jsx`: add the import, delete the two helpers (a pointer comment replaces them), replace the ASK block and the trivia RESULTS branch, and extend the numbering comment. `GameHostPage` imports neither helper afterwards, because nothing left in it uses them.

```diff
--- a/src/src/GameHostPage.jsx
+++ b/src/src/GameHostPage.jsx
@@ -12,6 +12,7 @@
 import WelcomeScreen from './components/WelcomeScreen';
 import HostQuestionSetsDialog from './components/HostQuestionSetsDialog';
 import WavelengthConvergence from './components/stage/WavelengthConvergence';
+import QuestionCard from './components/QuestionCard';
 import Icon from './components/Icon';
 import Modal from './components/Modal';
 import SetImageBadge from './components/SetImageBadge';
@@ -74,37 +75,9 @@
  */
 const STAGE_GROW = { LOBBY: '1.5', ASK: '1.35', ENDED: '1.5' };
 
-/** Trivia answer slots, in display order. */
-const TRIVIA_OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];
-
-/**
- * Is this option slot the correct answer?
- *
- * Question sets in the wild record `correctAnswer` four different ways —
- * "OptionA", "A", the option's own text, or an array of any of those — so the
- * comparison has to try all of them. Lifted verbatim out of the RESULTS render
- * when that moved onto the stage; the logic is unchanged.
- */
-function isCorrectTriviaOption(question, key, letter) {
-  if (!question) return false;
-  const optionId = `Option${letter}`;
-  const candidates = Array.isArray(question.correctAnswer)
-    ? question.correctAnswer
-    : [question.correctAnswer];
-
-  for (const correct of candidates) {
-    if (!correct) continue;
-    if (correct === optionId || correct === letter || correct === question[key]) return true;
-    if (typeof correct === 'string' && correct.startsWith('Option')) {
-      const correctLetter = correct.replace('Option', '');
-      if (`option${correctLetter}` === key || correctLetter === letter) return true;
-    }
-    if (typeof correct === 'string' && correct.length === 1 && /[A-F]/.test(correct)) {
-      if (`option${correct}` === key || correct === letter) return true;
-    }
-  }
-  return false;
-}
+/* The trivia option slots and the correct-answer test that used to live here
+   are in config/questionCard.js now, beside the card that reads them
+   (components/QuestionCard.jsx). */
 
 function GameHostPage() {
   // 🎯 AUTHENTICATION
@@ -5608,7 +5581,8 @@
             group carrying a data-drop-note (content announces its own loss)
             may never sort before a group without one (chrome goes silently).
 
-            Numbering per state, in this file:
+            Numbering per state, in this file and in components/QuestionCard.jsx,
+            which renders ASK's two content lines:
               1  fn-controls                  host-only controls
                  (`early-reveal` was the other 1 and is retired — the author
                   reveal is a session setting in the sidebar now, and a control
@@ -5657,63 +5631,18 @@
               </>
             )}
 
+            {/* THE QUESTION — components/QuestionCard.jsx, the card the set
+                editor's preview renders too, so the two cannot drift. Its
+                header carries the click-to-expand recovery and the wavelength
+                rule that used to be written here. */}
             {hostPhase === 'ASK' && currentQuestion && (
-              <>
-                {/* THE RECOVERY FOR A DROPPED PROMPT.
-                    The full prompt below is data-drop="4" — the LAST thing the
-                    fitter sacrifices on a dense ASK, after both host controls
-                    and the how-to-answer line at "3" — but it can still go.
-                    Click-to-expand is how the host gets it back, and without it
-                    a dense round loses the prompt from both the room's screen
-                    and the host's with no way to read it again. Mouse-only on
-                    purpose: giving the heading a
-                    tabIndex would put SPACE — the advance shortcut — on a
-                    focusable element that also opens a modal. */}
-                <h1
-                  className="q"
-                  data-expandable="1"
-                  title="Show the full question"
-                  onClick={expandQuestion}
-                >
-                  {currentQuestion.title || currentQuestion.question}
-                </h1>
-                {currentQuestion.image && (
-                  <img
-                    className="stage-art"
-                    src={currentQuestion.image}
-                    alt={currentQuestion.title || 'Artwork'}
-                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
-                  />
-                )}
-                {/* WAVELENGTH SHOWS THE TERM AND NOTHING ABOUT IT. The owner,
-                    off the AI Jargon set: "we dont want to give them ideas of
-                    the meaning, we are looking to them to share their meaning."
-                    A stored detail sentence IS a definition, so for wavelength
-                    this line never renders — whatever the set carries. The
-                    subject is the headline above; the how-to-answer line below
-                    is the only other thing the room needs. */}
-                {currentGameType !== 'wavelength'
-                  && (currentQuestion.questionDetail || currentQuestion.detail) && (
-                  <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
-                    {currentQuestion.questionDetail || currentQuestion.detail}
-                  </p>
-                )}
-                {currentGameType === 'trivia' && (
-                  <div className="opts">
-                    {TRIVIA_OPTION_KEYS
-                      .filter((key) => currentQuestion[key])
-                      .map((key, index) => (
-                        <div key={key} className="opt">
-                          <span className="ltr">{String.fromCharCode(65 + index)}</span>
-                          <span className="txt">{currentQuestion[key]}</span>
-                        </div>
-                      ))}
-                  </div>
-                )}
-                <p className="qdetail" data-drop="3" data-drop-note="How to answer">
-                  {getHostInstructionText(currentQuestionOf(questions, currentQuestionId))}
-                </p>
-              </>
+              <QuestionCard
+                phase="ASK"
+                question={currentQuestion}
+                gameType={currentGameType}
+                instruction={getHostInstructionText(currentQuestionOf(questions, currentQuestionId))}
+                onExpand={expandQuestion}
+              />
             )}
 
             {hostPhase === 'VOTE' && (
@@ -5840,25 +5769,15 @@
                 {currentGameType !== 'trivia' && answers.length === 0 ? (
                   <p className="qdetail">No responses came in for this one.</p>
                 ) : currentGameType === 'trivia' ? (
-                  <div className="opts">
-                    {TRIVIA_OPTION_KEYS
-                      .filter((key) => currentQuestion?.[key])
-                      .map((key, index) => {
-                        const letter = String.fromCharCode(65 + index);
-                        const isCorrect = isCorrectTriviaOption(currentQuestion, key, letter);
-                        const picked = answers.filter((a) => a.answer === letter).length;
-                        const pct = answers.length
-                          ? Math.round((picked / answers.length) * 100) : 0;
-                        return (
-                          <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
-                            <span className="fill" style={{ width: `${pct}%` }} />
-                            <span className="ltr">{letter}</span>
-                            <span className="txt">{currentQuestion[key]}</span>
-                            <span className="pct">{`${pct}%`}</span>
-                          </div>
-                        );
-                      })}
-                  </div>
+                  /* The same card as ASK, in its RESULTS treatment: the correct
+                     row marked and every row's share of the room. `answers` is
+                     what draws the shares — the preview passes none. */
+                  <QuestionCard
+                    phase="REVEAL"
+                    question={currentQuestion}
+                    gameType={currentGameType}
+                    answers={answers}
+                  />
                 ) : currentGameType === 'wavelength' ? (
                   /* The ranked .terms flow the mockup drew, carrying the
                      convergence spec's semantics: landed words (on EVERY
```

- [ ] **Step 8: Run the card tests and the two neighbours that read this markup.**
  `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/questionCard src/__tests__/stageShell src/__tests__/wavelengthConvergence`
  Expected: the card suites pass (31/31). Two existing tests now fail, **and they should**: stageShell's "chrome is sacrificed before content, in every state" (`Expected: >= 6`, `Received: 4`), because ASK's two content lines left the file it scans; and wavelengthConvergence's "the host stage detail line is gated off wavelength", because the gate left the file it scans. Paste both failures.
- [ ] **Step 9: Re-point those two tests at the card — not weaker (D6).** stageShell keeps its floor of 6 and every assertion; only its scan reads both files:

```diff
--- a/src/src/__tests__/stageShell.test.jsx
+++ b/src/src/__tests__/stageShell.test.jsx
@@ -771,7 +771,13 @@
     // above the markup — including the numbers it used to have — and a scan
     // that counted those would report the file's own explanation of the bug as
     // the bug.
-    const markup = source.replace(/\/\*[\s\S]*?\*\//g, '');
+    //
+    // TWO FILES, ONE STAGE. ASK's two content lines ("Full prompt" and "How to
+    // answer") are rendered by components/QuestionCard.jsx, the card the set
+    // editor's preview shares. Scanning GameHostPage alone would drop ASK out
+    // of "every state" — and fail the floor below — so the scan reads both.
+    const card = readFileSync(join(__dirname, '..', 'components', 'QuestionCard.jsx'), 'utf8');
+    const markup = `${source}\n${card}`.replace(/\/\*[\s\S]*?\*\//g, '');
     // Each match runs from `data-drop="N"` to the end of that JSX tag, so the
     // note is found only when it is on the SAME element.
     const groups = [];
```

The wavelength test now holds both halves of the rule — the gate in the card, and the stage handing the card its type — and adds a render, which the old regex could not prove:

```diff
--- a/src/src/__tests__/wavelengthConvergence.test.jsx
+++ b/src/src/__tests__/wavelengthConvergence.test.jsx
@@ -22,6 +22,7 @@
 import fs from 'fs';
 import path from 'path';
 import WavelengthConvergence from '../components/stage/WavelengthConvergence';
+import QuestionCard from '../components/QuestionCard';
 import {
   normalizeWavelengthAnalysis,
   wavelengthHeadline,
@@ -399,10 +400,27 @@
   // whatever the set carries. Source-scanned because neither page mounts in
   // jsdom (auth provider), following this file's call-sites pattern.
   const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
+  const card = stripComments(fs.readFileSync(src('components', 'QuestionCard.jsx'), 'utf8'));
   const player = stripComments(fs.readFileSync(src('PlayerPage.jsx'), 'utf8'));
 
   test('the host stage detail line is gated off wavelength', () => {
-    expect(host).toMatch(/currentGameType !== 'wavelength'\s*&&\s*\(currentQuestion\.questionDetail/);
+    // The stage's ASK markup is components/QuestionCard.jsx now — the card the
+    // set editor's preview shares — so the gate lives there, and the stage
+    // hands the card its own game type. Both halves are needed; both are held.
+    expect(card).toMatch(/gameType !== 'wavelength'\s*&&\s*detail/);
+    expect(host).toMatch(/<QuestionCard\b[^>]*phase="ASK"[^>]*gameType=\{currentGameType\}/);
+    // And rendered, which a source scan cannot prove: a subject carrying a
+    // stored definition shows the subject and the how-to-answer line, only.
+    const { container } = render(
+      <QuestionCard
+        phase="ASK"
+        question={{ title: 'Latency', detail: 'The delay before a transfer begins.' }}
+        gameType="wavelength"
+        instruction="Enter up to 10 words that come to mind for this subject:"
+      />
+    );
+    expect(container.textContent).not.toMatch(/delay before a transfer/);
+    expect(container.querySelector('[data-drop="4"]')).toBeNull();
   });
 
   test('no screen renders the retired topic field', () => {
```

- [ ] **Step 10: Run the neighbours.**
  `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/questionCard src/__tests__/stageShell src/__tests__/wavelengthConvergence src/__tests__/remoteFocusPanel src/__tests__/roomMeterWaiting`
  Expected: all pass. Optional, and worth doing: in the card, swap the REVEAL class order to `${…} opt` and delete `data-drop-note="Full prompt"`, watch six oracle cases go red, then restore both.
- [ ] **Step 11: The gate.** Frontend `npm test` → 224 suites pass; `npm run lint` → 0 errors, 10 warnings; `npm run build` → exit 0. `git add` the four new files, then run the backend loop → `suites=147 failed=0`.
- [ ] **Step 12: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/config/questionCard.js src/src/components/QuestionCard.jsx src/src/GameHostPage.jsx src/src/__tests__/questionCard.test.js src/src/__tests__/questionCardDom.test.jsx src/src/__tests__/stageShell.test.jsx src/src/__tests__/wavelengthConvergence.test.jsx && git commit -F - <<'EOF'
  The stage draws its question from one card component the set editor can share, with the same DOM it drew inline

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 2: The seams the preview reads through — the Table ladder on one element, detail search, and an editor row in the wire's shape

Three independent seams, three commits. None changes what the stage renders.

**Files:**
- Modify: `src/src/styles/stage.css` (`:78-86` Table ladder, `:88-97` `body`, `:720-724` `.stage-art`)
- Modify: `src/src/config/setupPanel.js` (`:227-237`, `filterBrowserRows`)
- Create: `src/src/config/questionPreview.js` (`stagedQuestion` only; Task 3 adds to it)
- Create: `src/src/__tests__/stageLadderScope.test.js`, `src/src/__tests__/setupPanelMatchDetail.test.js`, `src/src/__tests__/questionPreviewParity.test.jsx`

**Interfaces:**
- Consumes: `QuestionCard` from Task 1 (the parity test renders it).
- Produces: the CSS class `stage-ladder-table`, which puts the Table ladder, its `--t-*`/`--measure` derivation, `--hair: 1px` and the art cap on that element's subtree. `filterBrowserRows(rows, { search, category, unaskedOnly, enabledOnly, matchDetail = false })`, where `matchDetail: true` also matches `row.detail`. `stagedQuestion(row, { setId })` returns a copy of the editor row with `customInstructions` (from `customInstruction`), `image` keyed as the importer keys it, and `correctAnswer` rewritten as RESULTS delivers it; `null` for no row.

- [ ] **Step 1: Invoke the engage-design skill** (this task edits a stylesheet).

**2a — the ladder scope**

- [ ] **Step 2: Write the failing contract test**, `src/src/__tests__/stageLadderScope.test.js`. It finds the card's rules by class, follows every `var()` they read through its chain, and requires each derived property to be re-derived on the scope and each profile-varying one to be pinned by the Table rule (F1):

```js
/**
 * THE TABLE LADDER REACHES THE PREVIEW'S CARD — and nothing else does.
 *
 * The set editor's preview draws the stage's own card at the Table profile, and
 * it must do that without touching :root, which carries the live stage's
 * profile class (components/stage/Stage.jsx). So styles/stage.css declares the
 * Table ladder on a scope class as well — `:root.d-table, .stage-ladder-table`
 * — and the card inherits it (spec 2026-09-19 §3.2).
 *
 * THE TRAP THIS FILE EXISTS FOR. A custom property declared ABOVE the wrapper
 * whose value is itself var() — `--t-primary: var(--L-primary)` on `body` — is
 * resolved once, up there, against :root's Room ladder, and the wrapper
 * inherits that resolved Room value. Redeclaring --L-* on the wrapper changes
 * nothing for it. That is how the retired --k scalar rendered four profiles
 * identically. So every custom property the card's rules read is followed
 * through its var() chain, and each one must either be re-derived on the scope
 * or be a literal that no profile varies.
 *
 * Read as text, because jsdom loads no stylesheet and resolves no custom
 * property. Green means the scope is wired, not that a browser draws it well.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule as { selectors, body }; @media bodies flattened, @keyframes skipped. */
function rulesOf(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).split(';').pop().trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(head)) out.push(...rulesOf(body));
    else if (!head.startsWith('@')) {
      out.push({ selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body });
    }
    i = j;
  }
  return out;
}

const declarations = (body) => [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)]
  .map((m) => ({ name: m[1], value: m[2].trim() }));
const has = (rule, selector) => rule.selectors.includes(selector);

const STAGE_RULES = rulesOf(strip(read('styles', 'stage.css')));
const ALL_RULES = [...rulesOf(strip(read('styles.css'))), ...STAGE_RULES];

/* The card's DOM: h1.q, img.stage-art, p.qdetail, div.opts > div.opt >
   span.ltr/.txt/.fill/.pct, with .correct / .dim — components/QuestionCard.jsx.
   A rule is the card's when one of its selectors uses only these classes. */
const CARD_CLASSES = new Set(['q', 'qdetail', 'opts', 'list', 'opt', 'ltr', 'txt', 'fill', 'pct',
  'correct', 'dim', 'hero-row', 'stage-art', 'stage-ladder-table']);
const ELEMENT_CLASSES = new Set(['q', 'qdetail', 'opts', 'opt', 'ltr', 'txt', 'fill', 'pct', 'stage-art']);
const classesOf = (selector) => [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
const isCardSelector = (selector) => {
  if (/:root|(^|\s)(body|html)\b/.test(selector)) return false;
  const classes = classesOf(selector);
  return classes.length > 0
    && classes.every((c) => CARD_CLASSES.has(c))
    && classes.some((c) => ELEMENT_CLASSES.has(c));
};

const CARD_RULES = STAGE_RULES.filter((r) => r.selectors.some(isCardSelector));
const declsOf = (name) => ALL_RULES.flatMap((r) => declarations(r.body)
  .filter((d) => d.name === name).map((d) => ({ ...d, rule: r })));

/** Every custom property the card reads, followed through its var() chains. */
const READ = (() => {
  const seen = new Set(CARD_RULES.flatMap((r) => [...r.body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])));
  const queue = [...seen];
  while (queue.length) {
    const name = queue.pop();
    for (const d of declsOf(name)) {
      for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
      }
    }
  }
  return seen;
})();

/** Declared on something the wrapper inherits from: the root, html, body, a theme. */
const isAboveTheWrapper = (rule) => rule.selectors.some(
  (s) => /^:root\b/.test(s) || s === 'body' || s === 'html' || /^\[data-theme=/.test(s),
);
const TABLE = STAGE_RULES.find((r) => has(r, ':root.d-table'));
const OTHER_PROFILES = STAGE_RULES.filter((r) => [':root.d-room', ':root.d-tv', ':root.d-call'].some((p) => has(r, p)));

describe('the Table ladder, on the root and on the preview\'s scope', () => {
  test('one declaration, two selectors', () => {
    // rejects: a second copy of the Table ladder under a new class — two
    // declarations of the same ten values, one of which will drift.
    expect(TABLE).toBeDefined();
    expect(TABLE.selectors).toEqual([':root.d-table', '.stage-ladder-table']);
  });

  test('the premise: the card reads the ladder, so the checks below are not vacuous', () => {
    for (const name of ['--t-primary', '--t-secondary', '--t-body', '--measure', '--floor',
      '--hair', '--L-primary', '--L-secondary', '--L-body', '--measure-base']) {
      expect(READ.has(name)).toBe(true);
    }
  });

  test('every derived property the card reads is re-derived on the scope', () => {
    // rejects: widening only the ladder. --t-* and --measure are declared on
    // body as var(--L-*) and would reach the card at Room size.
    const stale = [...READ].filter((name) => {
      const decls = declsOf(name);
      const derivedAbove = decls.some((d) => isAboveTheWrapper(d.rule) && d.value.includes('var('));
      const onScope = decls.some((d) => has(d.rule, '.stage-ladder-table'));
      return derivedAbove && !onScope;
    });
    expect(stale).toEqual([]);
  });

  test('nothing a profile varies can leak into the scope from the root', () => {
    // rejects: leaving --hair out. `:root.d-call` sets it to 2px, and a Call
    // root would hand the preview's card Call's borders.
    const pinned = new Set(declarations(TABLE.body).map((d) => d.name));
    const leaks = [...READ].filter((name) => OTHER_PROFILES
      .some((r) => declarations(r.body).some((d) => d.name === name)) && !pinned.has(name));
    expect(leaks).toEqual([]);
  });

  test('the stage keeps its own derivation on body, beside the scope', () => {
    const derivation = STAGE_RULES.find((r) => has(r, 'body') && has(r, '.stage-ladder-table'));
    expect(derivation).toBeDefined();
    expect(declarations(derivation.body).map((d) => d.name).sort())
      .toEqual(['--measure', '--t-body', '--t-hero', '--t-meta', '--t-primary', '--t-secondary']);
  });

  test('the artwork rule reaches the card outside .content as well as inside it', () => {
    // `.content .stage-art` caps the picture at 44vh; the preview has no
    // .content and would draw a raster at its natural size.
    expect(STAGE_RULES.some((r) => has(r, '.content .stage-art') && has(r, '.stage-ladder-table .stage-art')))
      .toBe(true);
  });
});
```

- [ ] **Step 3: Run it.** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/stageLadderScope`
  Expected: `Tests: 5 failed, 1 passed, 6 total` — only the premise passes.
- [ ] **Step 4: Widen the three rules** in `src/src/styles/stage.css`: one declaration, two selectors each. The `body` rule keeps its paint and loses only the derivation, which moves to `body, .stage-ladder-table` — the same declarations, so the stage computes the same values.

```diff
--- a/src/src/styles/stage.css
+++ b/src/src/styles/stage.css
@@ -75,7 +75,14 @@
   --hair:2px;                         /* 1px rules do not survive a video codec */
   --dock-h:calc(9vh + 4vh);
 }
-:root.d-table{
+/* TABLE, ON THE ROOT OR ON ONE ELEMENT. `.stage-ladder-table` is the set
+   editor's question preview (components/QuestionPreview.jsx): the preview must
+   draw the card at the Table profile WITHOUT touching :root, which carries the
+   live stage's profile. One declaration, two selectors — nothing to keep in
+   sync. `--hair` is restated at the value :root already gives Table, so a Call
+   root's 2px cannot reach the preview through inheritance; on the stage it
+   changes nothing. Pinned by __tests__/stageLadderScope.test.js. */
+:root.d-table, .stage-ladder-table{
   --L-hero:      clamp(44px, 6.2vh, 64px);
   --L-primary:   clamp(32px, 4.0vh, 44px);
   --L-secondary: clamp(22px, 2.6vh, 30px);
@@ -83,6 +90,7 @@
   --L-meta:      clamp(16px, 1.5vh, 19px);
   --floor:16px; --measure-base:30ch; --bar-h:5px; --fit-min:.55;
   --dock-h:calc(8vh + 3.5vh);
+  --hair:1px;
 }
 
 body{
@@ -90,7 +98,15 @@
   font-family:var(--font-ui);
   -webkit-font-smoothing:antialiased;
   font-variant-numeric:tabular-nums;
-  /* Chrome tokens read the profile ladder directly. Only .content re-scales. */
+}
+/* Chrome tokens read the profile ladder directly. Only .content re-scales.
+   DERIVED ON THE PREVIEW'S SCOPE TOO, NOT ONLY ON body. A custom property
+   holding var() is resolved where it is declared and inherited as that
+   resolved value — so --t-* computed at body against :root's Room ladder would
+   reach the preview's card as Room sizes, whatever `.stage-ladder-table`
+   redeclared above. That is exactly how the retired --k scalar drew all four
+   profiles identically. */
+body, .stage-ladder-table{
   --t-hero:var(--L-hero); --t-primary:var(--L-primary);
   --t-secondary:var(--L-secondary); --t-body:var(--L-body); --t-meta:var(--L-meta);
   --measure:var(--measure-base);
@@ -720,8 +736,8 @@
 /* Artwork rounds carry a real image rather than the mockup's .artwork
    placeholder gradient. Capped in vh so a tall image cannot push the question
    off a fixed-height stage — the fitter can shrink type, but it cannot shrink
-   a raster. */
-.content .stage-art{display:block;margin:0 auto;max-width:100%;max-height:44vh;
+   a raster. The preview's card has no .content, so its scope is named too. */
+.content .stage-art, .stage-ladder-table .stage-art{display:block;margin:0 auto;max-width:100%;max-height:44vh;
   object-fit:contain;border-radius:var(--radius);border:var(--hair) solid var(--rule)}
 
 /* The dock's primary action is HostActionBar's own button — Dock wraps it
```

- [ ] **Step 5: Run it.** Expected: 6/6. Then `npx jest src/__tests__/stageShell src/__tests__/stageCompletion src/__tests__/wavelengthConvergence src/__tests__/playerSurfacePalette` → all pass (the suites that read `stage.css`).
- [ ] **Step 6: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/styles/stage.css src/src/__tests__/stageLadderScope.test.js && git commit -F - <<'EOF'
  The Table ladder can be applied to one element without touching the page's root

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

**2b — detail search, opt-in**

- [ ] **Step 7: Write the failing test** in its own file, so `setupPanel.test.js` stays unedited — `src/src/__tests__/setupPanelMatchDetail.test.js`:

```js
/**
 * `filterBrowserRows` — searching the detail as well, when asked to.
 *
 * Its own file, deliberately: setupPanel.test.js stays unedited (spec
 * 2026-09-19 §6), and every case in it still describes the in-session browser.
 * The set editor's preview is the one caller that passes `matchDetail: true`.
 */
import { filterBrowserRows, browserRow } from '../config/setupPanel';

const rows = [
  { id: '1', title: 'Which killer was caught by a parking ticket?', detail: 'New York, 1977.', category: 'History' },
  { id: '2', title: 'The Green River case', detail: 'Solved by a parking-lot survey in 2001.', category: 'Method' },
  { id: '3', title: 'Who was dubbed the Night Stalker?', detail: '', category: 'History' },
];
const ids = (list) => list.map((r) => r.id);

describe('matchDetail', () => {
  test('when true, a phrase from the detail finds the question', () => {
    expect(ids(filterBrowserRows(rows, { search: 'new york', matchDetail: true }))).toEqual(['1']);
  });

  test('when true, the title still matches, and a question matching both appears once', () => {
    expect(ids(filterBrowserRows(rows, { search: 'parking', matchDetail: true }))).toEqual(['1', '2']);
  });

  test('when false, the detail is not searched', () => {
    // rejects: widening the stage's own search. Its box says "Search titles…".
    expect(ids(filterBrowserRows(rows, { search: 'new york', matchDetail: false }))).toEqual([]);
    expect(ids(filterBrowserRows(rows, { search: 'parking', matchDetail: false }))).toEqual(['1']);
  });

  test('off by default, so the in-session browser searches titles only', () => {
    expect(ids(filterBrowserRows(rows, { search: 'new york' }))).toEqual([]);
    expect(ids(filterBrowserRows(rows, { search: 'solved' }))).toEqual([]);
  });

  test('it composes with the category chip', () => {
    expect(ids(filterBrowserRows(rows, { search: 'parking', category: 'Method', matchDetail: true })))
      .toEqual(['2']);
  });

  test('a row with no detail at all does not throw', () => {
    expect(ids(filterBrowserRows([{ id: 'x', title: 'Bare' }], { search: 'zzz', matchDetail: true })))
      .toEqual([]);
  });

  test('it searches what browserRow projects, which is what both lists render', () => {
    const row = browserRow({ id: 'q', title: 'A title', questionDetail: 'A body sentence' });
    expect(ids(filterBrowserRows([row], { search: 'body sentence', matchDetail: true }))).toEqual(['q']);
  });
});
```

- [ ] **Step 8: Run it.** Expected: `Tests: 4 failed, 3 passed, 7 total` — the "false" and "default" cases already pass, and must go on passing.
- [ ] **Step 9: Add `matchDetail`** to `src/src/config/setupPanel.js`:

```diff
--- a/src/src/config/setupPanel.js
+++ b/src/src/config/setupPanel.js
@@ -223,13 +223,25 @@
  *
  * It composes with the rest rather than replacing them, so "enabled and
  * unasked" is the natural way to answer "what can I actually ask next".
+ */
+/*
+ * `matchDetail` IS OPT-IN, AND OFF IS THE STAGE'S BEHAVIOUR.
+ *
+ * The set editor's preview (components/QuestionPreview.jsx) searches a set its
+ * author wrote, so a phrase from the body of a question is a fair way in, and
+ * it passes `matchDetail: true`. The in-session browser does not: its search
+ * box says "Search titles…", and a hit on text the box never promised to look
+ * in would read as a bug in front of the room. Defaulting to false keeps that
+ * placeholder true without the stage having to say anything.
  */
 export function filterBrowserRows(rows = [], {
-  search = '', category = '', unaskedOnly = false, enabledOnly = false,
+  search = '', category = '', unaskedOnly = false, enabledOnly = false, matchDetail = false,
 } = {}) {
   const needle = search.trim().toLowerCase();
   return rows.filter((row) => {
-    if (needle && !(row.title || '').toLowerCase().includes(needle)) return false;
+    if (needle
+      && !(row.title || '').toLowerCase().includes(needle)
+      && !(matchDetail && (row.detail || '').toLowerCase().includes(needle))) return false;
     if (category && row.category !== category) return false;
     if (unaskedOnly && row.used) return false;
     if (enabledOnly && row.disabled) return false;
```

- [ ] **Step 10: Run** `npx jest src/__tests__/setupPanelMatchDetail src/__tests__/setupPanel.test src/__tests__/sessionSetupPanel src/__tests__/setupPanelCallSite` → all pass, `setupPanel.test.js` untouched.
- [ ] **Step 11: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/config/setupPanel.js src/src/__tests__/setupPanelMatchDetail.test.js && git commit -F - <<'EOF'
  The question browser's search can also look in a question's detail when its caller asks, and the in-session browser still searches titles only

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

**2c — an editor row, in the wire's shape**

- [ ] **Step 12: Write the failing parity test**, `src/src/__tests__/questionPreviewParity.test.jsx`. One stored item, seen through both of its real projections, must render the same card (F2, F3). The type mapping (F4) is pinned here too:

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import QuestionCard from '../components/QuestionCard';
import { stagedQuestion } from '../config/questionPreview';
import { resolveInstruction } from '../config/instructions';
import { normalizeGameType, PICKER_GAME_TYPES } from '../config/gameTypes';
import { toRow } from '../utils/questionRows';

/**
 * TWO ROW SHAPES, ONE CARD — the preview shows what the room will see.
 *
 * The stage is handed a question by game/get-question.js; the set editor holds
 * the same question as a utils/questionRows.js:toRow row, read from
 * admin/get-question-set-questions.js. One stored item, seen through both, must
 * render the same card. The fixtures below are that one item and its two
 * projections, written out by hand from the handlers (line numbers cited) —
 * jsdom cannot run a Lambda, and tests/question-set-roundtrip.js already owns
 * the handler-level round trip.
 */
const SET_ID = 'true-crime';

/** The stored row, as admin/upload-questions.js writes it. */
const STORED = {
  SK: 'QUESTION#c001#003',
  Title: 'Which killer was caught by a parking ticket?',
  Detail: 'New York, 1977.',
  Category: 'History',
  CustomInstructions: 'Pick the name, not the nickname.',
  Image: `sets/${SET_ID}/son-of-sam.jpg`,
  optionA: 'Ted Bundy',
  optionB: 'David Berkowitz',
  optionC: 'John Wayne Gacy',
  optionD: 'Richard Ramirez',
  correctAnswer: 'OptionB',
  difficulty: 'easy',
  AnswerDetails: 'Stopped for parking beside a hydrant.',
};

/** get-question-set-questions.js:109-139 — what the editor loads. */
const EDITOR_PAYLOAD = {
  id: 'c001#003',
  title: STORED.Title,
  questionDetail: STORED.Detail,
  category: STORED.Category,
  image: STORED.Image,
  optionA: STORED.optionA,
  optionB: STORED.optionB,
  optionC: STORED.optionC,
  optionD: STORED.optionD,
  correctAnswer: STORED.correctAnswer,
  answerDetails: STORED.AnswerDetails,
  difficulty: STORED.difficulty,
  customInstructions: STORED.CustomInstructions,
};

/** get-question.js:221-268 — what the host is handed at RESULTS. */
const WIRE = {
  title: STORED.Title,
  questionDetail: STORED.Detail,
  detail: STORED.Detail,
  category: STORED.Category,
  image: STORED.Image,
  customInstructions: STORED.CustomInstructions,
  optionA: STORED.optionA,
  optionB: STORED.optionB,
  optionC: STORED.optionC,
  optionD: STORED.optionD,
  optionE: '',
  optionF: '',
  correctAnswer: STORED.optionB,       // "OptionB" rewritten to its text
};

const SET_LINE = 'Answer for your table, not yourself.';
const html = (element) => render(element).container.innerHTML;
const row = () => toRow(EDITOR_PAYLOAD);

describe('the how-to-answer line', () => {
  test('the premise: an editor row spells its own instruction differently from the wire', () => {
    // If this ever fails, toRow changed its spelling and the mapping below may
    // have become unnecessary — or wrong. It is what makes the next test bite.
    expect(row().customInstruction).toBe(STORED.CustomInstructions);
    expect(row().customInstructions).toBeUndefined();
    expect(resolveInstruction(row(), SET_LINE, 'trivia')).toBe(SET_LINE);
  });

  test('a staged row and the wire question produce the same line', () => {
    // rejects: handing the raw editor row to resolveInstruction, which shows the
    // SET's line for a question that has its own (spec §3.4).
    const staged = stagedQuestion(row(), { setId: SET_ID });
    expect(resolveInstruction(staged, SET_LINE, 'trivia')).toBe(resolveInstruction(WIRE, SET_LINE, 'trivia'));
    expect(resolveInstruction(staged, SET_LINE, 'trivia')).toBe(STORED.CustomInstructions);
  });

  test('a row with no instruction of its own still falls to the set, as the wire does', () => {
    const bare = stagedQuestion(toRow({ ...EDITOR_PAYLOAD, customInstructions: '' }), { setId: SET_ID });
    const wire = { ...WIRE, customInstructions: '' };
    expect(resolveInstruction(bare, SET_LINE, 'trivia')).toBe(resolveInstruction(wire, SET_LINE, 'trivia'));
    expect(resolveInstruction(bare, SET_LINE, 'trivia')).toBe(SET_LINE);
  });
});

describe('the card itself', () => {
  test('ASK: the staged row renders exactly what the wire question renders', () => {
    const staged = stagedQuestion(row(), { setId: SET_ID });
    const line = resolveInstruction(WIRE, SET_LINE, 'trivia');
    expect(html(<QuestionCard phase="ASK" question={staged} gameType="trivia" instruction={line} />))
      .toBe(html(<QuestionCard phase="ASK" question={WIRE} gameType="trivia" instruction={line} />));
  });

  test('REVEAL: the same option is marked correct', () => {
    const staged = stagedQuestion(row(), { setId: SET_ID });
    expect(html(<QuestionCard phase="REVEAL" question={staged} gameType="trivia" />))
      .toBe(html(<QuestionCard phase="REVEAL" question={WIRE} gameType="trivia" />));
  });

  test('REVEAL on a question whose filled slots are not contiguous marks one option, not two', () => {
    // A, C and D filled; C correct. On screen those read A, B, C — so the
    // option in slot D is LETTERED C, and the raw "OptionC" matches it too.
    const gappy = { ...EDITOR_PAYLOAD, optionB: '', correctAnswer: 'OptionC' };
    const wire = { ...WIRE, optionB: '', correctAnswer: STORED.optionC };
    const correctIn = (question) => [...render(
      <QuestionCard phase="REVEAL" question={question} gameType="trivia" />
    ).container.querySelectorAll('.opt.correct .txt')].map((n) => n.textContent);

    // The premise, so this cannot pass vacuously: unstaged, two rows light up.
    expect(correctIn(toRow(gappy))).toEqual([STORED.optionC, STORED.optionD]);
    // rejects: previewing a Reveal the room will never see.
    expect(correctIn(stagedQuestion(toRow(gappy), { setId: SET_ID }))).toEqual(correctIn(wire));
    expect(correctIn(wire)).toEqual([STORED.optionC]);
  });
});

describe('the picture', () => {
  const imageOf = (image) => stagedQuestion(toRow({ ...EDITOR_PAYLOAD, image }), { setId: SET_ID }).image;

  test.each([
    ['an upload not yet saved is keyed to this set', 'son-of-sam.jpg', `sets/${SET_ID}/son-of-sam.jpg`],
    ['a key already in this set is left alone', `sets/${SET_ID}/son-of-sam.jpg`, `sets/${SET_ID}/son-of-sam.jpg`],
    ['a key copied from another set is re-keyed, as Save will', 'sets/other/son-of-sam.jpg', `sets/${SET_ID}/son-of-sam.jpg`],
    ['a web address is kept verbatim', 'https://upload.wikimedia.org/x.jpg', 'https://upload.wikimedia.org/x.jpg'],
    ['a file shipped with the app is kept verbatim', '/assets/art/x.jpg', '/assets/art/x.jpg'],
    ['no picture stays no picture', '', ''],
  ])('%s', (_label, value, expected) => {
    // Mirrors lambda-functions/admin/upload-questions.js:81-93 (toMediaKey).
    expect(imageOf(value)).toBe(expected);
  });
});

describe('the game type a set previews as is the one the host plays it as', () => {
  /*
   * The host's chain: GameSetupDialog lists a set under the pill P only when
   * `set.engagementType === P` (GameSetupDialog.jsx:196) and submits
   * `gameType: P` (:278); create-game.js:197 stores `gameType || 'call-and-answer'`;
   * the host restores `gameData.gameType || 'call-and-answer'`
   * (GameHostPage.jsx:2148, :4739). game/get-question-sets.js:115 serves a set
   * with no type as 'call-and-answer'. QuestionsPanel already maps the set's type
   * through normalizeGameType (QuestionsPanel.jsx:156) and hands that on.
   */
  test.each(PICKER_GAME_TYPES.map((t) => t.id))('a %s set previews as that same type', (id) => {
    expect(normalizeGameType(id)).toBe(id);
  });

  test('a set with no type previews as call-and-answer, which is how the host plays it', () => {
    expect(normalizeGameType(undefined)).toBe('call-and-answer');
    expect(normalizeGameType('')).toBe('call-and-answer');
    expect(normalizeGameType(null)).toBe('call-and-answer');
  });
});
```

- [ ] **Step 13: Run it.** Expected: the suite fails with `Cannot find module '../config/questionPreview'`.
- [ ] **Step 14: Create `src/src/config/questionPreview.js`** with `stagedQuestion`. The importer's `toMediaKey` and the RESULTS rewrite are mirrored exactly, with their sources cited:

```js
/**
 * THE SET EDITOR'S PREVIEW, AS DATA — how an editor row becomes what the card
 * is given. The card is components/QuestionCard.jsx (the stage renders it
 * too); the surface is components/QuestionPreview.jsx.
 *
 * Pure, so every rule here is reachable from a test without mounting anything.
 * Spec: docs/superpowers/specs/2026-09-19-question-preview-design.md.
 */

/**
 * The importer's `toMediaKey` (lambda-functions/admin/upload-questions.js:81-93),
 * mirrored: what an image value will be once the set is saved.
 */
function storedImage(rawImage, setId) {
  const image = String(rawImage ?? '').trim();
  if (!image || !setId) return image;
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('/')) return image;
  const prefix = `sets/${setId}/`;
  if (image.startsWith(prefix)) return image;
  return `${prefix}${image.split('/').pop()}`;
}

/** game/get-question.js:249-268's RESULTS rewrite of one stored answer, mirrored. */
function revealedAnswer(answer, row) {
  if (typeof answer !== 'string' || !answer.startsWith('Option')) return answer;
  const optionLetter = answer.replace('Option', '').toLowerCase();
  return row[`option${optionLetter.toUpperCase()}`] || answer;
}

/**
 * AN EDITOR ROW, SPELLED THE WAY THE STAGE RECEIVES A QUESTION.
 *
 * The card reads the wire's field names (game/get-question.js:221-268). The
 * editor holds utils/questionRows.js:toRow rows, and three of the fields the
 * card depends on are spelled or shaped differently there:
 *
 *   customInstructions  toRow keeps the per-question instruction as the
 *                       SINGULAR `customInstruction` (questionRows.js:107), and
 *                       resolveInstruction reads only the plural
 *                       (config/instructions.js:44) — so unmapped, a
 *                       question's own instruction silently loses to the set's.
 *   image               an upload not yet saved is a bare file name
 *                       (QuestionImageField.jsx:14-24); the importer keys it to
 *                       sets/<setId>/<file> on Save. Keyed here, so the preview
 *                       shows the file the room will get — and shows nothing
 *                       for a key copied from another set, as the room will.
 *   correctAnswer       the editor keeps "OptionC" (QuestionsPanel.jsx:1464);
 *                       at RESULTS the wire carries optionC's own TEXT.
 *                       isCorrectTriviaOption compares slot ids against the
 *                       POSITIONAL letter, so on a question whose filled slots
 *                       are not contiguous (A, C, D) "OptionC" also matches the
 *                       option lettered C on screen. The text never can.
 *
 * Everything else the card reads — title, detail, the six options — lines up
 * already (spec §3.4) and passes through untouched.
 */
export function stagedQuestion(row, { setId = '' } = {}) {
  if (!row) return null;
  const { correctAnswer } = row;
  return {
    ...row,
    customInstructions: row.customInstruction || '',
    image: storedImage(row.image, setId),
    correctAnswer: Array.isArray(correctAnswer)
      ? correctAnswer.map((a) => revealedAnswer(a, row))
      : revealedAnswer(correctAnswer || '', row),
  };
}
```

- [ ] **Step 15: Run it.** Expected: 17/17, including the two premise tests (a raw editor row shows the set's line; a raw `"OptionC"` lights two options).
- [ ] **Step 16: The gate.** Frontend `npm test` → 227 suites pass; lint 0 errors / 10 warnings; build exit 0; `git add` the new files, then the backend loop → `suites=147 failed=0`.
- [ ] **Step 17: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/config/questionPreview.js src/src/__tests__/questionPreviewParity.test.jsx && git commit -F - <<'EOF'
  An editor row can be shown on the card exactly as the stage would receive it: its own instruction, its saved picture and the answer RESULTS marks

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 3: The preview — two panes, the stage's card, and nothing on the root

**Files:**
- Modify: `src/src/config/questionPreview.js` (add an import and the list's helpers)
- Create: `src/src/components/QuestionPreview.jsx`, `src/src/components/QuestionPreview.css`
- Create: `src/src/__tests__/questionPreview.test.jsx`, `src/src/__tests__/QuestionPreviewPalette.test.js`

**Interfaces:**
- Consumes: `QuestionCard` (Task 1); `stage-ladder-table`, `filterBrowserRows({ matchDetail: true })` and `stagedQuestion` (Task 2); `resolveInstruction` from `config/instructions.js`; `Icon`.
- Produces, from `config/questionPreview.js`: `previewRows(rows)` → `browserRow`-shaped rows, one per non-removed row, with `id` = the row's `uid`; `previewCategories(listRows)` → the categories in first-appearance order; `stepSelection(ids, currentId, delta)` → the next id, wrapping (`null` for an empty list; an unknown id steps from the top).
- Produces, from `components/QuestionPreview.jsx`: the default export `QuestionPreview({ rows = [], gameType = 'call-and-answer', setInstruction = '', setId = '', onEditQuestion })`, and the named export `QuestionViewSwitch({ mode = 'table', onChange, previewBlocked = '' })`, where `previewBlocked` is the disabled Preview button's `title`, or `''` when it can be pressed.
- DOM hooks later tests use: `data-testid="question-preview"` (root), `"preview-screen"`, `"preview-count"`, `"preview-position"`, `"preview-note"`; groups named "How the questions are shown", "What the card shows" and "Category"; the listbox "Questions"; the button "Edit this question".

- [ ] **Step 1: Invoke the engage-design skill.**
- [ ] **Step 2: Write the failing tests.** `src/src/__tests__/questionPreview.test.jsx` covers §7.7 and §7.9, plus D10 and the list's data:

```jsx
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionPreview, { QuestionViewSwitch } from '../components/QuestionPreview';
import { previewRows, previewCategories, stepSelection } from '../config/questionPreview';
import { toRow } from '../utils/questionRows';

/**
 * THE PREVIEW — the list's mechanics, the card, and the one rule about :root.
 *
 * Rendered for real; nothing is mocked. jsdom has no layout engine, so nothing
 * here asserts a size or a position (spec 2026-09-19 §7).
 */
const SET_ID = 'true-crime';
const trivia = (id, fields) => toRow({
  id, optionA: 'Ted Bundy', optionB: 'David Berkowitz', optionC: 'John Wayne Gacy', optionD: 'Richard Ramirez',
  correctAnswer: 'OptionB', difficulty: 'easy', ...fields,
});
const makeRows = () => [
  trivia('c001#001', {
    title: 'Which killer was caught by a parking ticket?', questionDetail: 'New York, 1977.',
    category: 'History', answerDetails: 'Stopped for parking beside a hydrant.',
  }),
  trivia('c002#001', {
    title: 'The Green River case', questionDetail: 'Solved by DNA in 2001.',
    category: 'Method', difficulty: 'hard', correctAnswer: 'OptionC',
  }),
  trivia('c001#002', {
    title: 'Who was dubbed the Night Stalker?', questionDetail: '',
    category: 'History', difficulty: 'medium', correctAnswer: 'OptionD',
    customInstructions: 'Pick the name, not the nickname.',
  }),
];

const renderPreview = (props = {}) => render(
  <QuestionPreview rows={makeRows()} gameType="trivia" setInstruction="Answer for your table." setId={SET_ID} {...props} />
);
const listbox = () => screen.getByRole('listbox', { name: 'Questions' });
const options = () => within(listbox()).getAllByRole('option');
const cardTitle = () => screen.getByTestId('preview-screen').querySelector('h1.q')?.textContent;

describe('the list — the in-session browser\'s mechanics', () => {
  test('every live question, with a count line', () => {
    renderPreview();
    expect(options()).toHaveLength(3);
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 3 of 3');
  });

  test('a removed row is not listed — it will not exist once the set is saved', () => {
    const rows = makeRows();
    rows[1] = { ...rows[1], removed: true };
    renderPreview({ rows });
    expect(listbox().textContent).not.toContain('Green River');
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 2 of 2');
  });

  test('a row is its title on one line, whole on hover, and "Category · difficulty"', () => {
    renderPreview();
    const first = options()[0];
    // rejects: a truncation with no recovery, which is a deletion.
    expect(first.querySelector('.qprev-row-title')).toHaveAttribute('title', 'Which killer was caught by a parking ticket?');
    expect(first.querySelector('.qprev-row-meta')).toHaveTextContent('History · easy');
  });

  test('no row carries an answer — the answer appears only in the card, in Reveal', () => {
    renderPreview();
    const list = listbox().textContent;
    for (const option of ['Ted Bundy', 'David Berkowitz', 'John Wayne Gacy', 'Richard Ramirez', 'hydrant']) {
      expect(list).not.toContain(option);
    }
  });

  test('search matches the title', () => {
    renderPreview();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'green river' } });
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('The Green River case')]);
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 3');
  });

  test('search matches the detail too, and says so', () => {
    renderPreview();
    const box = screen.getByRole('searchbox');
    expect(box).toHaveAttribute('placeholder', 'Search titles and details…');
    fireEvent.change(box, { target: { value: 'dna' } });
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent('The Green River case');
  });

  test('category chips narrow the list, and pressing the lit one returns to All', () => {
    renderPreview();
    const chips = within(screen.getByRole('group', { name: 'Category' }));
    fireEvent.click(chips.getByRole('button', { name: 'History' }));
    expect(options()).toHaveLength(2);
    expect(chips.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chips.getByRole('button', { name: 'History' }));
    expect(options()).toHaveLength(3);
    expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('no chips when there is only one category — a filter that filters nothing is not offered', () => {
    renderPreview({ rows: makeRows().map((r) => ({ ...r, category: 'History' })) });
    expect(screen.queryByRole('group', { name: 'Category' })).toBeNull();
  });
});

describe('selection', () => {
  test('the first visible question is selected to begin with', () => {
    renderPreview();
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
    expect(screen.getByTestId('preview-position')).toHaveTextContent('1 / 3');
  });

  test('clicking a row shows it in the card', () => {
    renderPreview();
    fireEvent.click(options()[2]);
    expect(options()[2]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(screen.getByTestId('preview-position')).toHaveTextContent('3 / 3');
  });

  test('↓ and ↑ step through the visible rows and wrap at both ends', () => {
    renderPreview();
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('The Green River case');
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');   // wrapped
    fireEvent.keyDown(listbox(), { key: 'ArrowUp' });
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');               // wrapped back
  });

  test('↓ steps through the FILTERED rows, not the whole set', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
  });

  test('↑ and ↓ belong to the search box while you are typing in it', () => {
    renderPreview();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
  });

  test('a handled ↑/↓ never reaches a window listener — the stage pages on those keys', () => {
    // rejects: letting the key bubble. config/stagePaging.js pageIntentFor turns
    // a bare ↓ into a page turn on the projector.
    const heard = jest.fn();
    window.addEventListener('keydown', heard);
    try {
      renderPreview();
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
      expect(cardTitle()).toBe('The Green River case');
      expect(heard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  test('a selection filtered out moves to the first visible row, and stays there', () => {
    renderPreview();
    fireEvent.click(options()[1]);                                   // Green River (Method)
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    // rejects: snapping back to Green River when the filter clears.
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
  });

  test('an unsaved edit shows the moment the working copy changes', () => {
    const rows = makeRows();
    const { rerender } = render(<QuestionPreview rows={rows} gameType="trivia" setId={SET_ID} />);
    fireEvent.click(options()[1]);
    const edited = rows.map((r, i) => (i === 1 ? { ...r, title: 'The Green River case, reopened', edited: true } : r));
    rerender(<QuestionPreview rows={edited} gameType="trivia" setId={SET_ID} />);
    // Same uid, so the selection holds and the card shows the new words.
    expect(cardTitle()).toBe('The Green River case, reopened');
  });
});

describe('the card', () => {
  test('it is the stage\'s card on a Table-ladder dusk screen, inside a paper preview', () => {
    renderPreview();
    const pane = screen.getByTestId('preview-screen');
    expect(pane).toHaveClass('qprev-screen', 'stage-ladder-table');
    expect(pane).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('question-preview')).toHaveAttribute('data-theme', 'light');
    // The ASK DOM: heading, full prompt, options, how-to-answer.
    expect(pane.querySelector('h1.q')).not.toBeNull();
    expect(pane.querySelector('p.qdetail[data-drop="4"]')).toHaveTextContent('New York, 1977.');
    expect(pane.querySelectorAll('.opts .opt')).toHaveLength(4);
  });

  test('no expand affordance — the preview has nothing to expand into', () => {
    renderPreview();
    const h1 = screen.getByTestId('preview-screen').querySelector('h1.q');
    expect(h1.hasAttribute('data-expandable')).toBe(false);
    expect(h1.hasAttribute('title')).toBe(false);
  });

  test('the how-to-answer line is the question\'s own, then the set\'s', () => {
    // rejects: the §3.4 trap, in place — an editor row's own instruction losing
    // to the set's because toRow spells it singular.
    renderPreview();
    const howTo = () => screen.getByTestId('preview-screen').querySelector('p.qdetail[data-drop="3"]').textContent;
    expect(howTo()).toBe('Answer for your table.');
    fireEvent.click(options()[2]);
    expect(howTo()).toBe('Pick the name, not the nickname.');
  });

  test('an unsaved upload shows as the file the room will get', () => {
    const rows = makeRows();
    rows[0] = { ...rows[0], image: 'son-of-sam.jpg' };
    renderPreview({ rows });
    expect(screen.getByTestId('preview-screen').querySelector('img.stage-art'))
      .toHaveAttribute('src', `sets/${SET_ID}/son-of-sam.jpg`);
  });
});

describe('ASK and Reveal', () => {
  const phaseGroup = () => screen.queryByRole('group', { name: 'What the card shows' });

  test('only trivia has anything to reveal, so only trivia gets the toggle', () => {
    const { unmount } = renderPreview();
    expect(phaseGroup()).not.toBeNull();
    expect(within(phaseGroup()).getByRole('button', { name: 'ASK' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    for (const gameType of ['call-and-answer', 'poll', 'wavelength']) {
      const view = renderPreview({ gameType });
      expect(phaseGroup()).toBeNull();
      view.unmount();
    }
  });

  test('Reveal is the RESULTS option treatment, with no bar and no share', () => {
    renderPreview();
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const pane = screen.getByTestId('preview-screen');
    expect([...pane.querySelectorAll('.opt.correct .txt')].map((n) => n.textContent)).toEqual(['David Berkowitz']);
    expect(pane.querySelectorAll('.opt.dim')).toHaveLength(3);
    expect(pane.querySelector('.fill')).toBeNull();
    expect(pane.querySelector('.pct')).toBeNull();
  });

  test('the toggle sticks: every question you move to shows its answer', () => {
    renderPreview();
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(within(phaseGroup()).getByRole('button', { name: 'Reveal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preview-screen').querySelector('.opt.correct .txt'))
      .toHaveTextContent('John Wayne Gacy');
  });

  test('the reveal text sits below the screen, marked as not on it — only in Reveal, only when present', () => {
    renderPreview();
    expect(screen.queryByTestId('preview-note')).toBeNull();                 // ASK
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const note = screen.getByTestId('preview-note');
    expect(note).toHaveTextContent('Reveal — shown only after the round');
    expect(note).toHaveTextContent('Stopped for parking beside a hydrant.');
    expect(screen.getByTestId('preview-screen')).not.toContainElement(note);
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });                      // no answerDetails
    expect(screen.queryByTestId('preview-note')).toBeNull();
  });
});

describe('the two empty states, which are different situations', () => {
  test('a set with no questions says there is nothing to preview', () => {
    renderPreview({ rows: [] });
    expect(screen.getByText(/This set has no questions yet, so there is nothing to preview/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('a set whose every row is removed is the same situation', () => {
    renderPreview({ rows: makeRows().map((r) => ({ ...r, removed: true })) });
    expect(screen.getByText(/nothing to preview/)).toBeInTheDocument();
  });

  test('nothing matching the search says so, offers the way out, and the screen says nothing is selected', () => {
    renderPreview();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No questions match “zzz”.')).toBeInTheDocument();
    expect(screen.getByTestId('preview-screen')).toHaveTextContent('Nothing is selected.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(options()).toHaveLength(3);
  });
});

describe('Edit', () => {
  test('it hands the Questions tab the whole selected row', () => {
    const rows = makeRows();
    const onEditQuestion = jest.fn();
    render(<QuestionPreview rows={rows} gameType="trivia" setId={SET_ID} onEditQuestion={onEditQuestion} />);
    fireEvent.click(options()[1]);
    fireEvent.click(screen.getByRole('button', { name: /edit this question/i }));
    expect(onEditQuestion).toHaveBeenCalledWith(rows[1]);
  });

  test('without a handler there is no Edit — never a dead control', () => {
    renderPreview();
    expect(screen.queryByRole('button', { name: /edit this question/i })).toBeNull();
  });
});

describe('the root is never touched', () => {
  test('mounting, using and unmounting the preview leaves document.documentElement exactly as it was', () => {
    // rejects: re-profiling the projector. The live stage keeps its display
    // profile on the root (components/stage/Stage.jsx) — spec §3.1.
    const root = document.documentElement;
    const before = root.className;
    root.className = 'd-room';
    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    try {
      const { unmount } = renderPreview();
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
      fireEvent.click(within(screen.getByRole('group', { name: 'What the card shows' })).getByRole('button', { name: 'Reveal' }));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'green' } });
      unmount();
      records.push(...observer.takeRecords());
      expect(records).toEqual([]);
      expect(root.className).toBe('d-room');
      expect(root.classList.contains('d-table')).toBe(false);
    } finally {
      observer.disconnect();
      root.className = before;
    }
  });
});

describe('the view switch', () => {
  test('Table and Preview, one pressed', () => {
    const onChange = jest.fn();
    render(<QuestionViewSwitch mode="table" onChange={onChange} />);
    const group = within(screen.getByRole('group', { name: 'How the questions are shown' }));
    expect(group.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(group.getByRole('button', { name: 'Preview' }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  test('Preview, blocked, is disabled and says why on its own title', () => {
    render(<QuestionViewSwitch mode="table" onChange={() => {}} previewBlocked="This set has no questions yet, so there is nothing to preview." />);
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('title', 'This set has no questions yet, so there is nothing to preview.');
  });
});

describe('the list, as data (config/questionPreview.js)', () => {
  test('previewRows: keyed by uid, tombstones dropped, and no answer in any value', () => {
    const rows = makeRows();
    rows[2] = { ...rows[2], removed: true };
    const list = previewRows(rows);
    expect(list.map((r) => r.id)).toEqual([rows[0].uid, rows[1].uid]);
    const values = list.flatMap((r) => Object.values(r));
    for (const answer of ['Ted Bundy', 'David Berkowitz', 'John Wayne Gacy', 'Richard Ramirez', 'OptionB',
      'Stopped for parking beside a hydrant.']) {
      expect(values).not.toContain(answer);
    }
  });

  test('previewRows: a row added this session has an id too', () => {
    // rejects: browserRow on the raw row — a toRow row has no `id`, and its sk
    // is empty until it is saved.
    const added = toRow({ title: 'Brand new', category: 'History' }, { origin: 'new' });
    expect(added.sk).toBe('');
    expect(previewRows([added])[0].id).toBe(added.uid);
  });

  test('previewCategories: the categories in use, in the order they first appear', () => {
    expect(previewCategories(previewRows(makeRows()))).toEqual(['History', 'Method']);
  });

  test('stepSelection: steps, wraps, and starts from the top when lost', () => {
    expect(stepSelection(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(stepSelection(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(stepSelection(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(stepSelection(['a', 'b', 'c'], 'zz', 1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });
});
```

`src/src/__tests__/QuestionPreviewPalette.test.js` (§7.10). Every value is read from `styles.css`, `stage.css` or `QuestionPreview.css`, and every pairing is composited up its real stack:

```js
/**
 * THE COLOUR PAIRINGS THE QUESTION PREVIEW INTRODUCES — `.qprev`.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * TWO SURFACES IN ONE COMPONENT. The list and its controls are paper, on the
 * set editor's #F1EDE4 panel (both mounts: AdminPage renders the editor with
 * contentTheme 'light', the host shelf restates the same value inside
 * `.qsets--onlight .qs-editor`). The screen is the stage's dusk, drawn by
 * styles/stage.css's own card rules. Each is measured on its real stack.
 *
 * THE CHECKS ARE LIFTED, NOT REWRITTEN — `lin`, `lum`, `ratio`, `alphaOver` and
 * `bgOf` are copied out of docs/design/admin-redesign/audit.html's <script>,
 * as questionSetsPalette.test.js copied them. NOTHING IS TYPED TWICE: every
 * colour below is read out of styles.css, stage.css or QuestionPreview.css.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the
 * palette clears AA on paper; it cannot prove how a browser draws it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = read('styles.css');
const STAGE_CSS = read('styles', 'stage.css');
const QPREV_CSS = read('components', 'QuestionPreview.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

/* ---- values, READ rather than retyped ------------------------------------ */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** The declaration block that opens with `head` — first match, comments stripped. */
function blockOf(css, head) {
  const text = strip(css);
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`no "${head}" block`);
  return text.slice(start, text.indexOf('}', start));
}
/** The first `head` block that declares `name` — stage.css opens `.stage{` twice. */
function blockDeclaring(css, head, name) {
  const text = strip(css);
  let at = text.indexOf(head);
  while (at >= 0) {
    const body = text.slice(at, text.indexOf('}', at));
    if (new RegExp(`${name}\\s*:`).test(body)) return body;
    at = text.indexOf(head, at + head.length);
  }
  throw new Error(`no "${head}" block declares ${name}`);
}
function hexIn(block, name) {
  const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not a hex in that block`);
  return m[1].toUpperCase();
}
function rgbaIn(block, name) {
  const m = block.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} is not an rgba in that block`);
  return m[1];
}

const PAPER = blockOf(GLOBAL_CSS, '[data-theme="light"] {');
const DUSK = blockOf(GLOBAL_CSS, '[data-theme="dark"] {');
const ROOT = blockOf(GLOBAL_CSS, ':root {');
const STAGE = blockDeclaring(STAGE_CSS, '.stage{', '--muted');
const STAGE_ROOT = blockDeclaring(STAGE_CSS, ':root{', '--success-text');
const SCOPE = blockOf(QPREV_CSS, '.qprev,\n.qprev-switch {');
const SCREEN = blockOf(QPREV_CSS, '.qprev .qprev-screen {');

const P = {
  panel: hexIn(PAPER, '--surface-2'),   // the editor's .qs-panel ground
  surface: hexIn(PAPER, '--surface'),
  text: hexIn(PAPER, '--text'),
  muted: hexIn(PAPER, '--muted'),
  accent: hexIn(SCOPE, '--qprev-accent'),
  rowSel: rgbaIn(SCOPE, '--qprev-row-sel'),
  rowHover: rgbaIn(SCOPE, '--qprev-row-hover'),
};
const S = {
  bg: hexIn(DUSK, '--bg'),
  text: hexIn(DUSK, '--text'),
  muted: hexIn(SCREEN, '--muted'),
  primary: hexIn(SCREEN, '--primary'),
  success: hexIn(SCREEN, '--success'),
  successText: hexIn(STAGE_ROOT, '--success-text'),
};

/** A stage.css rule's `background`, by exact selector. */
function stageLayer(selector) {
  const text = strip(STAGE_CSS);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no stage.css rule for "${selector}"`);
  const bg = m[2].match(/background:\s*(rgba\([^)]*\))/);
  if (!bg) throw new Error(`"${selector}" paints no rgba background`);
  return bg[1];
}

function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));
const AA = 4.5;

const PANEL = [P.panel];
const LIST = [P.panel, P.surface];
const SCREEN_GROUND = [P.panel, S.bg];
const OPTION = [...SCREEN_GROUND, stageLayer('.opt')];

describe('the list and its controls, on the editor\'s paper panel', () => {
  test('the premise: the editor panel really is the paper --surface-2 on both mounts', () => {
    // rejects: measuring against a ground the editor does not paint.
    expect(GLOBAL_CSS).toMatch(/\.qs-editor \.qs-panel \{[^}]*background:\s*var\(--surface-2/);
    const hostShelf = blockOf(read('components', 'QuestionSetsPanel.css'), '.qsets--onlight .qs-editor {');
    expect(hexIn(hostShelf, '--surface-2')).toBe(P.panel);
  });

  test.each([
    ['--text on the list (titles, the search box)', P.text, LIST],
    ['--muted on the list (meta line, "Showing N of M", placeholder)', P.muted, LIST],
    ['the accent on the list ("Clear search")', P.accent, LIST],
    ['--text on the selected row', P.text, [...LIST, P.rowSel]],
    ['--muted on the selected row', P.muted, [...LIST, P.rowSel]],
    ['the accent on a pressed chip', P.accent, [...LIST, P.rowSel]],
    ['--text on a hovered row', P.text, [...LIST, P.rowHover]],
    ['--muted on a hovered row', P.muted, [...LIST, P.rowHover]],
    ['--muted on the panel (the position, the note\'s label)', P.muted, PANEL],
    ['--text on the panel (the reveal note)', P.text, PANEL],
    ['--text on a control (ASK, Reveal, Table, Preview, Edit)', P.text, [...PANEL, P.surface]],
    // The segmented groups paint --surface; the pressed segment's tint sits on
    // it. rejects: a transparent group — the tint over the #F1EDE4 panel drops
    // the accent under AA, which is what the first cut of this sheet did.
    ['the accent on a pressed segment', P.accent, [...PANEL, P.surface, P.rowSel]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the screen: the stage\'s own card on the stage\'s own ground', () => {
  test('the screen restates exactly the stage\'s tokens, nothing near them', () => {
    // rejects: a "close enough" dusk. The card must look like the projector.
    expect(S.muted).toBe(hexIn(STAGE, '--muted'));
    expect(S.primary).toBe(hexIn(ROOT, '--primary'));
    expect(S.success).toBe(hexIn(ROOT, '--success'));
    // and data-theme="dark" supplies the stage's ground and text as they are
    expect(S.bg).toBe(hexIn(STAGE, '--bg'));
    expect(S.text).toBe(hexIn(STAGE, '--text'));
  });

  test('the question and its prompt', () => {
    expect(on(S.text, SCREEN_GROUND)).toBeGreaterThanOrEqual(AA);
    // .qdetail is --text at opacity .82: the colour that reaches the eye is the
    // text composited over its ground.
    const opacity = Number(strip(STAGE_CSS).match(/\.qdetail\{[^}]*opacity:\s*([\d.]+)/)[1]);
    const ground = composited(SCREEN_GROUND);
    expect(ratio(alphaOver(parseHex(S.text), ground, opacity), ground)).toBeGreaterThanOrEqual(AA);
  });

  test('every option state the preview can draw', () => {
    expect(on(S.text, OPTION)).toBeGreaterThanOrEqual(AA);                                // .opt .txt
    expect(on(S.primary, [...OPTION, stageLayer('.opt .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.successText, [...OPTION, stageLayer('.opt.correct .ltr')])).toBeGreaterThanOrEqual(AA);
    expect(on(S.muted, OPTION)).toBeGreaterThanOrEqual(AA);                               // .opt.dim .txt
    expect(on(S.muted, [...OPTION, stageLayer('.opt.dim .ltr')])).toBeGreaterThanOrEqual(AA);
  });

  test('"Nothing is selected" on the screen', () => {
    expect(on(S.muted, SCREEN_GROUND)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the sheet itself', () => {
  const CSS = strip(QPREV_CSS);
  const outsideTokens = CSS
    .replace(/\.qprev,\s*\.qprev-switch\s*\{[^}]*\}/, '')
    .replace(/\.qprev \.qprev-screen\s*\{[^}]*\}/, '');

  test('no hex and no rgba outside the two token blocks', () => {
    expect(outsideTokens.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).toEqual([]);
    expect(outsideTokens.match(/rgba?\(/g) || []).toEqual([]);
  });

  test('--danger never carries text here', () => {
    expect(CSS.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });

  test('every custom property the sheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, STAGE_CSS, QPREV_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...QPREV_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });

  test('every selector is rooted at the scope', () => {
    const roots = new Set();
    for (const block of CSS.replace(/@media[^{]*\{/g, '').split('}')) {
      const head = block.split('{')[0];
      if (!head.trim()) continue;
      for (const selector of head.split(',')) {
        const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) roots.add(m[1]);
      }
    }
    expect([...roots].filter((name) => !name.startsWith('qprev'))).toEqual([]);
  });

  test('styles.css and stage.css declare nothing in this scope', () => {
    for (const css of [GLOBAL_CSS, STAGE_CSS]) {
      expect(strip(css).match(/\.qprev[\w-]*/g) || []).toEqual([]);
    }
  });

  test('the card is never restyled here — it stays exactly the stage', () => {
    // rejects: "fixing" the card for the preview, which forks it from the room.
    const cardClasses = ['q', 'qdetail', 'opts', 'opt', 'ltr', 'txt', 'fill', 'pct', 'stage-art',
      'correct', 'dim', 'stage-ladder-table'];
    const offenders = [...CSS.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => cardClasses.includes(c));
    expect(offenders).toEqual([]);
  });

  test('the ladder is the admin one, and nothing is below the 12px floor', () => {
    for (const [step, px] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19]]) {
      expect(QPREV_CSS).toMatch(new RegExp(`--qprev-t-${step}:\\s*${px}px`));
    }
    const sizes = [
      ...[...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])),
      ...[...CSS.matchAll(/font:\s*\d+\s+(\d+)px/g)].map((m) => Number(m[1])),
    ];
    expect(sizes.filter((px) => px < 12)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them.** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/questionPreview.test src/__tests__/QuestionPreviewPalette`
  Expected: `Cannot find module '../components/QuestionPreview'`, and `ENOENT` for `components/QuestionPreview.css`.
- [ ] **Step 4: Add the list's helpers to `src/src/config/questionPreview.js`.** Make this the file's first line, followed by a blank line:
  ```js
  import { browserRow } from './setupPanel';
  ```
  and append:

```js

/**
 * The list's rows: the in-session browser's own projection (config/setupPanel.js
 * `browserRow`, an allow-list that carries no option and no answer), keyed by
 * the editor row's `uid`.
 *
 * browserRow reads identity from `id` / `Id` / `questionId`, and a toRow row has
 * none of them — only `uid`, and a stored `sk` that is empty for every question
 * added or copied in this session (questionRows.js:151, 175). Handed in raw,
 * every row comes back `id: undefined`. The uid is the key that survives an
 * edit: startEdit clones the row and commitEdit writes it back under the same
 * uid (QuestionsPanel.jsx:361, 387-392).
 *
 * Tombstones are dropped: a removed row will not exist once the set is saved.
 */
export function previewRows(rows = []) {
  return rows
    .filter((row) => row && !row.removed)
    .map((row) => browserRow({ ...row, id: row.uid }));
}

/** The categories the rows actually use, in the order they first appear. */
export function previewCategories(listRows = []) {
  const seen = [];
  for (const row of listRows) {
    if (row.category && !seen.includes(row.category)) seen.push(row.category);
  }
  return seen;
}

/**
 * The id `delta` steps from `currentId` through `ids`, wrapping at both ends.
 * An id that is not in the list steps from the top. `null` when there is
 * nothing to step through.
 */
export function stepSelection(ids = [], currentId = null, delta = 1) {
  if (!ids.length) return null;
  const at = ids.indexOf(currentId);
  if (at < 0) return ids[0];
  return ids[(at + delta + ids.length) % ids.length];
}
```

- [ ] **Step 5: Create `src/src/components/QuestionPreview.jsx`:**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import QuestionCard from './QuestionCard';
import { filterBrowserRows } from '../config/setupPanel';
import { resolveInstruction } from '../config/instructions';
import {
  stagedQuestion, previewRows, previewCategories, stepSelection,
} from '../config/questionPreview';
import './QuestionPreview.css';

/** Input types a person types into — ↑/↓ belong to the field there, not the list. */
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return TEXT_ENTRY_TYPES.has(String(target.type || 'text').toLowerCase());
}

const optionDomId = (id) => `qprev-opt-${id}`;

/**
 * [Table] [Preview] — the Questions tab's two views of one working copy.
 *
 * Its own root and theme, because it sits in the Questions panel's toolbar
 * OUTSIDE the preview: the panel is paper on both mounts (the admin console
 * renders the editor with contentTheme 'light', AdminPage.jsx:1636; the host
 * shelf inside `.qsets--onlight`), and the token block it reads is declared on
 * `.qprev-switch` as well as `.qprev`.
 *
 * `previewBlocked` is the reason Preview cannot be pressed, or '' when it can.
 * A disabled control says why on its own title — never a dead button.
 */
export function QuestionViewSwitch({ mode = 'table', onChange, previewBlocked = '' }) {
  return (
    <div className="qprev-switch" data-theme="light" role="group" aria-label="How the questions are shown">
      <button
        type="button"
        className="qprev-seg-btn"
        aria-pressed={mode === 'table'}
        onClick={() => onChange && onChange('table')}
      >
        Table
      </button>
      <button
        type="button"
        className="qprev-seg-btn"
        aria-pressed={mode === 'preview'}
        disabled={Boolean(previewBlocked)}
        title={previewBlocked || undefined}
        onClick={() => onChange && onChange('preview')}
      >
        Preview
      </button>
    </div>
  );
}

/**
 * THE PREVIEW — browse a set and see each question as the room will.
 *
 * Spec: docs/superpowers/specs/2026-09-19-question-preview-design.md. Two panes:
 * the in-session browser's mechanics on the left (search, category chips,
 * "Showing N of M", click a row), and on the right the card the live stage
 * renders — components/QuestionCard.jsx, the same component — at the Table
 * profile on the stage's dusk ground.
 *
 * IT NEVER TOUCHES document.documentElement. The stage keeps its display
 * profile there (components/stage/Stage.jsx), and a preview that re-classed the
 * root would re-profile a projector. The Table ladder reaches the card through
 * the `.stage-ladder-table` class on the screen pane instead (styles/stage.css).
 *
 * IT READS THE WORKING COPY, NOT THE SERVER. `rows` is the Questions panel's
 * array, tombstones and unsaved edits included; a removed row is not listed,
 * and an edit made in the question dialog shows here the moment Done is pressed.
 *
 * ↑ / ↓ STOP HERE. They are handled on this root and never reach a window
 * listener — the stage's pager pages on a bare ↑/↓ (config/stagePaging.js
 * `pageIntentFor`), and a preview key must never turn a page on a projector.
 * They step through the VISIBLE rows, wrap at the ends, and belong to the field
 * instead whenever focus is in something the person types into.
 */
export default function QuestionPreview({
  rows = [],
  gameType = 'call-and-answer',
  setInstruction = '',
  setId = '',
  onEditQuestion,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // STICKY: flip to Reveal once and every question you move to shows its answer.
  const [phase, setPhase] = useState('ASK');

  const listRows = useMemo(() => previewRows(rows), [rows]);
  const categories = useMemo(() => previewCategories(listRows), [listRows]);
  // A chip whose last question was edited into another category filters
  // nothing that exists; it stops being a filter rather than emptying the list.
  const activeCategory = categories.includes(category) ? category : '';
  const visible = useMemo(
    () => filterBrowserRows(listRows, { search, category: activeCategory, matchDetail: true }),
    [listRows, search, activeCategory],
  );
  const selected = visible.find((r) => r.id === selectedId) || visible[0] || null;

  // A selection that is filtered out MOVES to the first visible row — it does
  // not wait there to snap back when the filter clears.
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const selectedRow = selected ? rows.find((r) => r.uid === selected.id) || null : null;
  const staged = selectedRow ? stagedQuestion(selectedRow, { setId }) : null;
  const reveal = gameType === 'trivia' && phase === 'REVEAL';

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (isTextEntry(event.target)) return;
    const next = stepSelection(visible.map((r) => r.id), selected ? selected.id : null,
      event.key === 'ArrowDown' ? 1 : -1);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(next);
    const el = document.getElementById(optionDomId(next));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  };

  if (listRows.length === 0) {
    return (
      <div className="qprev qprev--empty" data-theme="light" data-testid="question-preview">
        <p className="qprev-empty">This set has no questions yet, so there is nothing to preview.</p>
      </div>
    );
  }

  /* The root's keydown is a delegate for the list's keys, not a control of its
     own: the listbox inside is the focusable element, and the chips, the toggle
     and Edit keep ↑/↓ working when focus has moved onto them. */
  return (
    <div className="qprev" data-theme="light" data-testid="question-preview" onKeyDown={onKeyDown}>
      <div className="qprev-list">
        <input
          type="search"
          className="qprev-search"
          placeholder="Search titles and details…"
          aria-label="Search titles and details"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {categories.length > 1 && (
          <div className="qprev-chips" role="group" aria-label="Category">
            <button
              type="button"
              className="qprev-chip"
              aria-pressed={activeCategory === ''}
              onClick={() => setCategory('')}
            >
              All
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                className="qprev-chip"
                aria-pressed={activeCategory === name}
                onClick={() => setCategory(activeCategory === name ? '' : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <p className="qprev-count" data-testid="preview-count">
          {`Showing ${visible.length} of ${listRows.length}`}
        </p>
        {visible.length === 0 ? (
          <div className="qprev-nomatch">
            <p>
              {`No questions match “${search.trim()}”${activeCategory ? ` in ${activeCategory}` : ''}.`}
            </p>
            <button type="button" className="qprev-link" onClick={() => setSearch('')}>
              Clear search
            </button>
          </div>
        ) : (
          <ul
            className="qprev-rows"
            role="listbox"
            aria-label="Questions"
            tabIndex={0}
            aria-activedescendant={selected ? optionDomId(selected.id) : undefined}
          >
            {visible.map((r) => {
              const title = r.title || 'Untitled question';
              return (
                <li
                  key={r.id}
                  id={optionDomId(r.id)}
                  role="option"
                  aria-selected={Boolean(selected && selected.id === r.id)}
                  className="qprev-row"
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="qprev-row-title" title={title}>{title}</span>
                  <span className="qprev-row-meta">
                    {[r.category || 'No category', r.difficulty].filter(Boolean).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="qprev-detail">
        <div className="qprev-bar">
          {gameType === 'trivia' && (
            <div className="qprev-seg" role="group" aria-label="What the card shows">
              <button
                type="button"
                className="qprev-seg-btn"
                aria-pressed={!reveal}
                onClick={() => setPhase('ASK')}
              >
                ASK
              </button>
              <button
                type="button"
                className="qprev-seg-btn"
                aria-pressed={reveal}
                onClick={() => setPhase('REVEAL')}
              >
                Reveal
              </button>
            </div>
          )}
          {selected && (
            <span className="qprev-pos" data-testid="preview-position">
              {`${visible.indexOf(selected) + 1} / ${visible.length}`}
            </span>
          )}
          {selectedRow && typeof onEditQuestion === 'function' && (
            <button type="button" className="qprev-btn qprev-edit" onClick={() => onEditQuestion(selectedRow)}>
              <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit this question
            </button>
          )}
        </div>

        {/* THE SCREEN. Dusk and the Table ladder on this pane alone, so the card
            looks like the stage inside a paper editor. Nothing in here is
            restyled by this component's stylesheet: the card's rules are
            stage.css's, untouched (QuestionPreviewPalette.test.js holds that). */}
        <div className="qprev-screen stage-ladder-table" data-theme="dark" data-testid="preview-screen">
          {staged ? (
            <div className="qprev-card">
              <QuestionCard
                phase={reveal ? 'REVEAL' : 'ASK'}
                question={staged}
                gameType={gameType}
                instruction={resolveInstruction(staged, setInstruction, gameType)}
              />
            </div>
          ) : (
            <p className="qprev-screen-empty">Nothing is selected.</p>
          )}
        </div>

        {/* NOT ON THE SCREEN, AND SAID SO. The stage's RESULTS never shows the
            reveal text — it reaches players only in the round report — so it
            sits below and outside the screen, under the editor's own words. */}
        {reveal && selectedRow && selectedRow.answerDetails && (
          <p className="qprev-note" data-testid="preview-note">
            <b>Reveal — shown only after the round</b>
            {selectedRow.answerDetails}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/src/components/QuestionPreview.css`.** Its header's figures are the palette test's own measurements. The first cut of this sheet left the segmented group transparent, and the palette test caught the pressed segment's accent at under 4.5:1 on the panel — hence `background: var(--surface)` on `.qprev-seg, .qprev-switch`.

```css
/* ==========================================================================
   THE QUESTION PREVIEW — components/QuestionPreview.jsx
   ==========================================================================
   Spec: docs/superpowers/specs/2026-09-19-question-preview-design.md. The
   Questions tab's Preview mode: the set as a searchable list on the left, and
   on the right the card the live stage renders (components/QuestionCard.jsx).

   THE LIST AND ITS CONTROLS ARE PAPER, because the editor around them is paper
   on both mounts — the admin console renders it with contentTheme 'light'
   (AdminPage.jsx:1636) and the host shelf inside `.qsets--onlight` — so the
   roots declare data-theme="light" rather than inheriting whichever of the two
   they landed in. The ladder is the admin one: 12 floor / 13 label / 15 body /
   19 head (docs/design/admin-redesign/RATIONALE.md §3). --primary is not used
   on paper: #F6A94C is 1.96:1 as text on white. The accent is the deep amber
   the host shelf already settled on.

   THE SCREEN IS THE STAGE, AND THIS SHEET DOES NOT STYLE IT. `.qprev-screen`
   carries data-theme="dark" and `.stage-ladder-table`, and every rule inside it
   is styles/stage.css's own, at the Table profile. This sheet adds the ground,
   the box, the typography the stage's body would have given it, and the three
   colour tokens data-theme="dark" does not restore (see the block below).

   Measured in QuestionPreviewPalette.test.js, composited up the real stack
   (the editor's #F1EDE4 panel, then these layers), AA is 4.5:
     list    --text on white 14.6 · --muted on white 6.2 · accent on white 5.4
             the selected row or a pressed control: --text 12.7 · --muted 5.4 ·
             accent 4.7 · --muted straight on the panel 5.3
     screen  the question 15.0 · its prompt at .82 opacity 10.3 · option text
             13.2 · a dimmed option (--muted) 8.5 · an option letter (--primary)
             6.0 · the correct letter (--success-text) 6.3
   ========================================================================== */

.qprev,
.qprev-switch {
  --qprev-t-floor: 12px;
  --qprev-t-label: 13px;
  --qprev-t-body: 15px;
  --qprev-t-head: 19px;

  --qprev-accent: #9A5B18;
  --qprev-rule: #E4DFD6;
  --qprev-rule-strong: #D2CBBE;
  --qprev-row-hover: rgba(30, 35, 45, .04);
  --qprev-row-sel: rgba(154, 91, 24, .10);
}

/* THE SCREEN'S TOKENS — what the stage sets and an ancestor here can take away.
   data-theme="dark" restores --bg, --surface and --text; it does not restore:
     --muted    the stage's lifted #B6C2D4 (stage.css `.stage`), not dusk's
                #9BA8BE. The dimmed options in Reveal are drawn in it.
     --primary  the host shelf re-points it to #9A5B18 (`.qsets--onlight`).
                Every option letter is drawn in it.
     --success  the host shelf re-points it to #1C7350
                (`.qsets--onlight .qs-editor`). The correct option's border is.
   TWO CLASSES DEEP ON PURPOSE: styles.css's [data-theme="dark"] loads AFTER this
   sheet (index.jsx imports App before styles.css), so one class would lose. */
.qprev .qprev-screen {
  --muted: #B6C2D4;
  --primary: #F6A94C;
  --success: #4FB286;
}

/* -- layout ---------------------------------------------------------------- */
.qprev {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  margin-top: 12px;
  color: var(--text);
  font: 400 var(--qprev-t-body)/1.45 var(--font-ui);
}
.qprev--empty { display: block; }
@media (max-width: 760px) {
  .qprev { grid-template-columns: minmax(0, 1fr); }
}

/* -- the list -------------------------------------------------------------- */
.qprev-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  background: var(--surface);
  border: 1px solid var(--qprev-rule);
  border-radius: 10px;
}
.qprev-search {
  width: 100%;
  font: 400 var(--qprev-t-body)/1.3 var(--font-ui);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--qprev-rule-strong);
  border-radius: 8px;
  padding: 7px 10px;
}
.qprev-search::placeholder { color: var(--muted); }
.qprev-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.qprev-chip {
  font: 600 var(--qprev-t-floor)/1 var(--font-ui);
  color: var(--text);
  background: transparent;
  border: 1px solid var(--qprev-rule-strong);
  border-radius: 999px;
  padding: 5px 10px;
  min-height: 24px;
  cursor: pointer;
}
.qprev-chip[aria-pressed="true"] {
  color: var(--qprev-accent);
  border-color: var(--qprev-accent);
  background: var(--qprev-row-sel);
}
.qprev-count { margin: 0; font-size: var(--qprev-t-label); color: var(--muted); }
.qprev-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  min-height: 0;
  max-height: 60vh;
  overflow-y: auto;
  border-top: 1px solid var(--qprev-rule);
}
.qprev-row {
  display: block;
  min-width: 0;
  padding: 6px 8px;
  border-bottom: 1px solid var(--qprev-rule);
  cursor: pointer;
}
.qprev-row:hover { background: var(--qprev-row-hover); }
.qprev-row[aria-selected="true"] {
  background: var(--qprev-row-sel);
  box-shadow: inset 3px 0 0 var(--qprev-accent);
}
/* One text node with min-width:0, or text-overflow is inert and the title is
   silently cut. `title=` on the span carries the full string. */
.qprev-row-title,
.qprev-row-meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qprev-row-title { font-size: var(--qprev-t-body); font-weight: 600; color: var(--text); }
.qprev-row-meta { margin-top: 2px; font-size: var(--qprev-t-floor); color: var(--muted); }
.qprev-empty { margin: 0; color: var(--muted); }
.qprev-nomatch { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.qprev-nomatch p { margin: 0; color: var(--muted); }
.qprev-link {
  font: 600 var(--qprev-t-label)/1.2 var(--font-ui);
  color: var(--qprev-accent);
  background: none;
  border: 0;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;
}

/* -- the controls beside the screen, and the toolbar's switch --------------- */
.qprev-detail { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.qprev-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.qprev-pos { font-size: var(--qprev-t-label); color: var(--muted); font-variant-numeric: tabular-nums; }
.qprev-seg,
.qprev-switch {
  display: inline-flex;
  background: var(--surface);
  border: 1px solid var(--qprev-rule-strong);
  border-radius: 8px;
  overflow: hidden;
}
/* Right-aligned in the Questions panel's wrapping toolbar by margin, never by
   justify-content: flex-end, which overflows toward the start when it wraps. */
.qprev-switch { margin-left: auto; }
.qprev-seg-btn {
  font: 600 var(--qprev-t-label)/1 var(--font-ui);
  color: var(--text);
  background: transparent;
  border: 0;
  padding: 8px 12px;
  min-height: 30px;
  cursor: pointer;
}
.qprev-seg-btn + .qprev-seg-btn { border-left: 1px solid var(--qprev-rule-strong); }
/* The pressed segment's tint composites over the group's white, not over the
   editor's #F1EDE4 panel: on the panel the accent measured under AA. */
.qprev-seg-btn[aria-pressed="true"] { color: var(--qprev-accent); background: var(--qprev-row-sel); }
.qprev-seg-btn:disabled { color: var(--muted); cursor: not-allowed; }
.qprev-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 600 var(--qprev-t-label)/1 var(--font-ui);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--qprev-rule-strong);
  border-radius: 8px;
  padding: 8px 12px;
  min-height: 30px;
  cursor: pointer;
}
.qprev-edit { margin-left: auto; }
.qprev-chip:focus-visible,
.qprev-seg-btn:focus-visible,
.qprev-btn:focus-visible,
.qprev-link:focus-visible,
.qprev-search:focus-visible,
.qprev-rows:focus-visible { outline: 2px solid var(--qprev-accent); outline-offset: 2px; }

/* -- the screen ------------------------------------------------------------ */
/* The ground and the box. The inheritable typography is restated because the
   editor around this pane is not the stage's body: stage.css's `body` gives the
   card Inter, antialiasing and tabular figures, and styles.css's `body` its
   1.6 line height. */
.qprev-screen {
  min-width: 0;
  padding: 24px 28px;
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font: 400 16px/1.6 var(--font-ui);
  letter-spacing: normal;
  text-align: start;
  text-transform: none;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
/* .fitbox's gap (stage.css), without .fitbox: this pane runs no fitter. */
.qprev-card { display: flex; flex-direction: column; gap: calc(1.5vh + 4px); min-width: 0; }
.qprev-screen-empty { margin: 0; font-size: var(--qprev-t-body); color: var(--muted); }

/* -- off the screen, and marked so ----------------------------------------- */
.qprev-note { margin: 0; color: var(--text); line-height: 1.5; }
.qprev-note b { display: block; font-size: var(--qprev-t-label); font-weight: 700; color: var(--muted); }
```

- [ ] **Step 7: Run them.** Expected: `questionPreview.test.jsx` 36/36; `QuestionPreviewPalette.test.js` 24/24. Optional: delete `event.stopPropagation();` and watch "a handled ↑/↓ never reaches a window listener" fail; pass `selectedRow` instead of `staged` to the card and watch the instruction and picture tests fail. Then restore both.
- [ ] **Step 8: The gate.** Frontend `npm test` → 229 suites pass; lint 0 errors / 10 warnings (the one `useEffect` lists all its dependencies); build exit 0; `git add` the new files, then the backend loop → `suites=147 failed=0`.
- [ ] **Step 9: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/config/questionPreview.js src/src/components/QuestionPreview.jsx src/src/components/QuestionPreview.css src/src/__tests__/questionPreview.test.jsx src/src/__tests__/QuestionPreviewPalette.test.js && git commit -F - <<'EOF'
  A set's questions can be previewed on the stage's own card, one at a time, with search, category chips and the answer on demand

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

---

### Task 4: The Questions tab's [Table] [Preview]

**Files:**
- Modify: `src/src/components/QuestionsPanel.jsx` — the import (`:7`), the state (before `:209`), the reset effect (`:261-268`), `previewBlocked`/`previewing` (before `:866`), the toolbar (`:931-944`), the list area (`:951-960`)
- Create: `src/src/__tests__/questionsPanelPreview.test.jsx`

**Interfaces:**
- Consumes: `QuestionPreview` and `QuestionViewSwitch` (Task 3). The panel passes `rows` (the working copy, tombstones included), `gameType={engagementType}` (already `normalizeGameType(questionSet?.engagementType)`, F4), `setInstruction={questionSet?.customInstruction || ''}` (D4), `setId`, and `onEditQuestion={startEdit}` — the existing question dialog, no new container.
- Produces: `viewMode: 'table' | 'preview'` local state, reset to `'table'` whenever a different set opens.

- [ ] **Step 1: Invoke the engage-design skill.**
- [ ] **Step 2: Write the failing test**, `src/src/__tests__/questionsPanelPreview.test.jsx`, using the `authFetch`-only mocking recipe of `questionSetEditorQuestions.test.jsx`. Its option queries are scoped to the listbox, because the table's `<select>` options also have the role "option":

```jsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * THE QUESTIONS TAB'S [Table] [Preview] — the preview mounted where the owner
 * asked for it (spec 2026-09-19 §2.1, §4.5): inside the set editor, reading the
 * working copy, unsaved edits included.
 *
 * `authFetch` is the only mock — the recipe questionSetEditorQuestions.test.jsx
 * uses — so the real panel loads, edits and renders.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'true-crime',
  name: 'True Crime',
  engagementType: 'trivia',
  customInstruction: 'Answer for your table.',
  canManage: true,
};

const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'History', title: 'Which killer was caught by a parking ticket?',
      questionDetail: 'New York, 1977.', optionA: 'Ted Bundy', optionB: 'David Berkowitz',
      optionC: 'John Wayne Gacy', optionD: 'Richard Ramirez', correctAnswer: 'OptionB', difficulty: 'easy',
    },
    {
      id: 'c002#001', Category: 'Method', title: 'The Green River case',
      questionDetail: 'Solved by DNA in 2001.', optionA: 'Gary Ridgway', optionB: 'Ted Bundy',
      correctAnswer: 'OptionA', difficulty: 'hard',
      customInstructions: 'Name the man, not the river.',
    },
  ],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

function mockApi(payload = QUESTIONS) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, payload);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderPanel = (props = {}) => render(
  <QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} {...props} />
);
const views = () => within(screen.getByRole('group', { name: 'How the questions are shown' }));
const card = () => screen.getByTestId('preview-screen');
async function ready() {
  await screen.findByText('Which killer was caught by a parking ticket?');
}

describe('the switch', () => {
  test('Table is today\'s tab, unchanged, and it is where the tab opens', async () => {
    mockApi();
    renderPanel();
    await ready();
    expect(views().getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('question-0')).toBeInTheDocument();
    expect(screen.queryByTestId('question-preview')).toBeNull();
  });

  test('Preview replaces the table with the two panes', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('question-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('question-0')).toBeNull();
    expect(card().querySelector('h1.q')).toHaveTextContent('Which killer was caught by a parking ticket?');
    expect(views().getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Preview is disabled, and says why, when the set has no questions', async () => {
    mockApi({ setId: SET.id, questions: [] });
    renderPanel();
    await screen.findByText(/This set has no questions yet/);
    const preview = views().getByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('title', 'This set has no questions yet, so there is nothing to preview.');
  });

  test('the table\'s category select is not offered in Preview, which has its own chips', async () => {
    mockApi();
    renderPanel();
    await ready();
    expect(screen.getByText(/Filter by category/)).toBeInTheDocument();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.queryByText(/Filter by category/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument();
  });

  test('opening a different set starts it in Table', async () => {
    mockApi();
    const { rerender } = renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    rerender(<QuestionsPanel questionSet={{ ...SET, id: 'other-set' }} availableSets={[SET]}
      plannedVersion={2} onChanged={jest.fn()} onDirtyChange={jest.fn()} />);
    await ready();
    expect(views().getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('question-preview')).toBeNull();
  });
});

describe('the preview reads the working copy', () => {
  test('a removed question is not previewed', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(within(screen.getByTestId('question-1')).getByRole('button', { name: /remove/i }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 1');
    expect(screen.getByRole('listbox', { name: 'Questions' })).not.toHaveTextContent('Green River');
  });

  test('Edit opens the existing question dialog, and after Done the preview shows the edit', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: /edit this question/i }));
    const dialog = screen.getByRole('dialog', { name: /edit question/i });
    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Caught by a parking ticket' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit question/i })).toBeNull());
    // Still in Preview, on the same question, showing the unsaved words.
    expect(screen.getByTestId('question-preview')).toBeInTheDocument();
    expect(card().querySelector('h1.q')).toHaveTextContent('Caught by a parking ticket');
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
  });

  test('the card plays the set as the host would: trivia, with Reveal', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const phase = within(screen.getByRole('group', { name: 'What the card shows' }));
    fireEvent.click(phase.getByRole('button', { name: 'Reveal' }));
    expect(card().querySelector('.opt.correct .txt')).toHaveTextContent('David Berkowitz');
  });

  test('a call-and-answer set has nothing to reveal', async () => {
    mockApi();
    renderPanel({ questionSet: { ...SET, engagementType: 'call-and-answer' } });
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('group', { name: 'What the card shows' })).toBeNull();
  });

  test('the how-to-answer line is the question\'s own, else the set\'s', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const howTo = () => card().querySelector('p.qdetail[data-drop="3"]').textContent;
    expect(howTo()).toBe('Answer for your table.');
    // Scoped to the list: the table's <select> options are role="option" too.
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option')[1]);
    expect(howTo()).toBe('Name the man, not the river.');
  });
});
```

- [ ] **Step 3: Run it.** `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npx jest src/__tests__/questionsPanelPreview`
  Expected: `Tests: 10 failed, 10 total`, each with `Unable to find an accessible element with the role "group" and name "How the questions are shown"`.
- [ ] **Step 4: Wire it** into `src/src/components/QuestionsPanel.jsx`:

```diff
--- a/src/src/components/QuestionsPanel.jsx
+++ b/src/src/components/QuestionsPanel.jsx
@@ -5,6 +5,7 @@
 import QuestionPullDialog from './QuestionPullDialog';
 import CategoryPicker from './CategoryPicker';
 import QuestionImageField from './QuestionImageField';
+import QuestionPreview, { QuestionViewSwitch } from './QuestionPreview';
 import { authFetch } from '../auth/authFetch';
 import { normalizeGameType } from '../config/gameTypes';
 import { ROUND_KIND_IDS, ROUND_KINDS, roundKindApplies } from '../config/roundKinds';
@@ -204,6 +205,12 @@
   // { mode: 'fork' | 'subset', title, rows }
   const [newSetDialog, setNewSetDialog] = useState(null);
   const [confirmDiscard, setConfirmDiscard] = useState(false);
+
+  /* ---------------------------------------------------------------- view -- */
+  // TABLE OR PREVIEW — how the working copy is shown, never what it holds.
+  // Named `viewMode`, not anything with "preview" in it: `preview` below is the
+  // replace-from-a-CSV diff, a different thing that happens to share the word.
+  const [viewMode, setViewMode] = useState('table');
 
   /* ------------------------------------------------------------- replace -- */
   const [replaceFile, setReplaceFile] = useState(null);
@@ -264,6 +271,7 @@
     closeForm();
     setStatus({ text: '', tone: '' });
     setCategoryFilter('');
+    setViewMode('table');
     load();
   }, [setId, load, closeForm]);
 
@@ -863,6 +871,14 @@
 
   /* -------------------------------------------------------------- render --- */
 
+  // Why Preview cannot be pressed right now, or '' when it can. The switch
+  // prints it as the disabled button's title — a control that says why.
+  const previewBlocked = loadState === 'loading' ? 'The questions are still loading.'
+    : loadState === 'error' ? 'The questions could not be loaded, so there is nothing to preview.'
+      : summary.questionCount === 0 ? 'This set has no questions yet, so there is nothing to preview.'
+        : '';
+  const previewing = viewMode === 'preview' && !previewBlocked;
+
   const kindLabel = (id) => ROUND_KINDS[id]?.label || id;
   const showKind = roundKindApplies(engagementType);
   const saveLabel = canManage
@@ -928,7 +944,9 @@
             Save {selected.length} selected as a new set…
           </button>
         )}
-        {categories.length > 1 && (
+        {/* The table's own filter. Preview has chips of its own, and a select
+            that filters a table nobody can see is a control that does nothing. */}
+        {categories.length > 1 && !previewing && (
           <label className="qs-filter">
             Filter by category:{' '}
             <select
@@ -941,6 +959,11 @@
             </select>
           </label>
         )}
+        <QuestionViewSwitch
+          mode={previewing ? 'preview' : 'table'}
+          onChange={setViewMode}
+          previewBlocked={previewBlocked}
+        />
       </div>
 
       {loadState === 'loading' && <p className="qs-empty">Loading questions…</p>}
@@ -948,7 +971,21 @@
         <StatusMessage message={`${loadError} Nothing has been changed.`} tone="error" />
       )}
 
-      {loadState === 'ready' && visibleRows.length === 0 && (
+      {/* PREVIEW REPLACES THE TABLE, and nothing else on this panel. The dirty
+          bar, Add, Pull, Save and the CSV controls stay where they are: they act
+          on the working copy, which is the thing being previewed. Edit opens the
+          same question dialog the table's Edit does — no second container. */}
+      {previewing && (
+        <QuestionPreview
+          rows={rows}
+          gameType={engagementType}
+          setInstruction={questionSet?.customInstruction || ''}
+          setId={setId}
+          onEditQuestion={startEdit}
+        />
+      )}
+
+      {loadState === 'ready' && !previewing && visibleRows.length === 0 && (
         <p className="qs-empty">
           {rows.length
             ? 'No questions in that category.'
@@ -956,7 +993,7 @@
         </p>
       )}
 
-      {loadState === 'ready' && visibleRows.length > 0 && (
+      {loadState === 'ready' && !previewing && visibleRows.length > 0 && (
         <ol className="qs-question-list">
           {visibleRows.map((row) => {
             const rowIndex = rows.indexOf(row);
```

- [ ] **Step 5: Run it, then every suite that mounts the panel or the editor.**
  `npx jest src/__tests__/questionsPanelPreview src/__tests__/questionSetEditorQuestions src/__tests__/questionSetEditor src/__tests__/questionAddModal src/__tests__/questionSetProvenance src/__tests__/hostQuestionSets src/__tests__/editorCopyOnSave src/__tests__/categoryPicker src/__tests__/questionSetDetailsAi src/__tests__/setEditorShare src/__tests__/hostWorkieSettings src/__tests__/workieSettings`
  Expected: all pass; the new file 10/10. Optional: delete `setViewMode('table');` from the reset effect and watch "opening a different set starts it in Table" fail; drop `&& !previewing` from the select's guard and watch its test fail. Then restore both.
- [ ] **Step 6: The gate.** Frontend `npm test` → 230 suites pass; lint 0 errors / 10 warnings; build exit 0; `git add` the new file, then the backend loop → `suites=147 failed=0`.
- [ ] **Step 7: Commit.**
  ```bash
  cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview && git add src/src/components/QuestionsPanel.jsx src/src/__tests__/questionsPanelPreview.test.jsx && git commit -F - <<'EOF'
  The set editor's Questions tab can switch from its table to a preview of every question as the room will see it, unsaved edits included

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  EOF
  ```

---

## The final gate (spec §8)

After Task 4, from a clean `git status`:

- Frontend: `cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/question-preview/src && npm test` → **230 suites** pass (5377 tests in the scratch run; a different count is fine only if no suite fails and none went missing).
- Backend: the loop in Global Constraints → **`suites=147 failed=0`**.
- `npm run lint` → **0 errors**, 10 warnings. `npm run build` → **exit 0**, two asset-size warnings.
- The spec's §7, mapped: 1 `questionCardDom` · 2 `questionCardDom` "the stage really renders it" · 3 `questionCard` · 4 `questionPreviewParity` "the how-to-answer line" · 5 `questionPreviewParity` "the game type…" · 6 `setupPanelMatchDetail` with `setupPanel.test.js` unedited · 7 `questionPreview` "the root is never touched" · 8 `stageLadderScope` · 9 `questionPreview` + `questionsPanelPreview` · 10 `QuestionPreviewPalette`.

## Not in this plan

- **The spec's out-of-scope list (§5):** the public library's Preview button (a known, separate bug), a sets-table row action, the host pre-session surface, an "unsaved change" tag on rows, poll/survey vote states, the fitter, the append-to-a-set route.
- **A latent stage defect, found while tracing F3 and left alone deliberately** — this plan is a pure refactor of the stage. `isCorrectTriviaOption` compares slot ids against positional letters, so a question whose filled slots are not contiguous, restored mid-RESULTS through `get-game-state.js:295` (which carries the raw `"OptionC"`), would mark two options correct on the projector. The normal RESULTS path is safe: `get-question.js` sends the option's text. The preview is safe too, through `stagedQuestion`. The fix belongs to the stage and wants its own change and test.
- **The heading in Reveal (D1)** — an owner's call if the §1 sketch was meant literally. *Since built as the §1 sketch draws it, after the final review; see D1.*
