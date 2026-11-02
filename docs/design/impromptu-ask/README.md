# Your own question, queued (the "impromptu ask")

*2 Nov 2026. Design only: mockups in `index.html`, rendered as `1-*.png` by `node shoot.js`;
desk reviews in `reviews.md`. No application code has changed.*

> Owner, 2 Nov 2026, verbatim: *"Host in call and answer can create a improptu ask and queue it up"*

## 1. The problem

A Call & Answer session runs on its question set. The host can reorder the set (the running
order), switch categories off, pick any set question with **Ask next** or **Ask now**, and,
after a round's read, send a quick follow-up with **Ask the room**. What they cannot do is put
**a question of their own** in front of the room as a round. A facilitator who hears the
room's answers and thinks "the real question is X" has two choices today. They can ask it aloud,
which leaves no answers, no vote, no read and no report. Or they can squeeze it into a
follow-up ask after the read, which gets no vote and no read and lives inside another round.

## 2. What "impromptu ask, queue it up" means here

Three readings were weighed:

| | A. A round of your own | B. A queued quick ask | C. Both, one composer with a "when" |
|---|---|---|---|
| What | The host writes a C&A question mid-session; it joins the running order (next, or after round N, or now) and runs as a full round: answer, vote, results, Workie's read. | The host writes a follow-up-style ask (Ideas / Choose / Rate) now, and it is held to send after the next read. | One composer; a choice between "a full round" and "a quick ask after the read". |
| Already possible? | **No.** Every round is a set row (`QUESTION#nnn#REF` points into the set partition, `next-question.js:1201-1235`). | **Mostly.** Ask the room's composer already has a blank "write your own" ask after any read (`AskComposer.jsx:13-27`, origin `host`, `followup-kinds.js:70`). Only the *holding* is missing. | Half of it exists. |
| Fits "queue it up" | Exactly: "queue" is the running order the owner asked for before (`question-queue.js:5-8`, `QueueList.jsx:8-11` quote him). | Loosely: a single held ask is not a queue. | Yes, at the price of a choice before every question. |
| Fits "in call and answer" | The C&A round is the format's unit. | It is a C&A feature too, but a smaller one. | — |

**Decision D1: build A.** The words "queue it up" name the running order, and the missing
capability is A. B's only new part is "hold until after the read", and the read is a minute
away whenever the host would want that. **Fork F1** below keeps B available for later.

## 3. Decisions (each drawn in `index.html`)

| # | Decision | Why |
|---|---|---|
| D1 | A host-written question becomes a **normal C&A round** in the running order. | §2. |
| D2 | **One place:** the composer is a step inside the Session menu → **Rounds** → **Running order** (frames 1–2). The rail's Round queue gets a quiet **Write a question** link that opens that same step, as **Rounds and questions** already does (`ConsoleRail.jsx:83`). The phone Remote's **Rounds** tab (`hostRemote.js:666`) opens the same fields in a full-height sheet. Setup's **First up** shows it. | Experience plan §3.2: no new surface, nothing in the top bar, the dock or Your part now. The Session menu is a sheet, so the composer is an inline second step, not a modal opened from it (engage-design: never a modal inside a modal). |
| D3 | **Fields:** *The question* (required, ≤200), *A line for the room* (optional, ≤400, shown under it like a set question's Detail), *For Workie only* (optional, ≤400, private). **No type picker**: the composer says "It runs like every round". | A C&A round is open answer → vote. Ideas / Choose / Rate are the follow-up's kinds, and the follow-up already covers them. |
| D4 | **Where it goes:** **Next** (default; the queue's existing `first` op), **Later** (after a round you pick; a new positional op), **Now** (only between rounds, i.e. lobby, results, read, feedback; while answering or voting is open it is greyed out and says "Answers are still coming in"). The commit button names the choice: *Put it next / Put it after round 5 / Ask it now*. | The owner's own rule for these verbs: "ask next in most people's mind means put it at the top of the queue, not run it now" (`QueueList.jsx:38-48`). Now mid-answer would cut a room's round with one press. |
| D5 | **In the queue:** a **Yours** mark (pen icon and the word, never colour alone) everywhere a running order is drawn: Rounds section, rail, First up, the Remote, Rounds so far, the report. Row actions: **Edit**, earlier and later, **Remove** (arms in place, no second dialog). No **Disable** (nothing in the set to disable). Your part now names it: "Next round asks your question: '…'". A status line confirms with **Undo**. | `up-next.js:1-10` already tags `queued` and `auto` "to distinguish"; Yours is the third source. |
| D6 | **It runs as a set round.** Same steps, timers, anonymity setting, reveal, scoring. On the phone and the room's window it looks like any round: "Round 4", the question, the line, the box. **No category** (it has none) and **no "from the host" label**. The task line is a fixed *"Answer in a sentence or two."*, **not** the set's `customInstruction`. | `resolveTask` (`task-instruction.js:52`) would otherwise put the set's lesson task ("How could you adapt this lesson…", `task-instruction.js:30`) under a question that has no lesson. |
| D7 | **Workie's read:** the session's own Workie and voice as for any round; `{questionTitle}` = the question, `{questionDetail}` = the line for the room, or *"None. The host wrote this question during the session; there is no lesson text behind it."*; `{task}` = the fixed task; the host's private note goes in as the question's **Background**, which the read already treats as "never shown to players" (`get-ai-summary.js:928`, `withholdBackground`). | No new prompt and no new template variable. The C&A template already says "Any framing the question author added: {questionDetail}" (`sets/prompt-callandanswer-workie-advisor.json`), and the host is now the author. |
| D8 | **Privacy on one screen:** the composer never draws on the room's screen unasked. **Write a question** on a one-screen laptop opens a host-only choice: **Open on my phone** (Remote connected) or **Connect your phone**, or **Write it here: the room will see you type** (frame 5). Queued titles stay behind the existing `PrivateReveal` (`SessionSetupPanel.jsx:885-890`). Once the round runs it is public like any round; the private note never is. | Experience plan principle 3, decision 2. |
| D9 | **Report:** the round is marked **Yours**, with a source line: "Written by the host during the session, 10:42 · put next after round 3", what Workie had ("No set material…"), and the host's note labelled as theirs (frame 6). | A reader months later must not take an improvised round for a planned one. |
| D10 | **Scoring and billing: unchanged rules.** It is a round, so votes score as in any C&A round, and an answer to it counts toward the session's "second answered question" (`websocket/session-count.js:1-12`). It costs one Workie read like any round. | Treating it differently would make the scoreboard and the plan count disagree with what the room experienced. |

## 4. Forks, with a recommendation

- **F1. A queued quick ask (reading B).** *Recommended: not in this build.* Ask the room's blank
  composer covers it after any read. If hosts ask for it, add a fourth "Where it goes" option on
  the follow-up composer ("after the next read"), stored as a `host`-origin entry beside
  `FOLLOWUP#nnn#SUGGESTED` and offered pre-picked when the read lands. It is never auto-sent,
  keeping the follow-up rule that the host presses Send.
- **F2. "Now" mid-answer.** *Recommended: no.* Offer Now only between rounds. The alternative,
  Now ending the open round the way **Ask now** does for set questions, is one press away from
  costing the room its answers.
- **F3. Can the host edit after it starts?** *Recommended: no.* Once the round's REF exists the row
  drops Edit and reads "Already asked. It's round 4" (the server refuses `edit-own` too), as
  follow-up options freeze once answered. Typos
  are cheaper than a question that changes under people's answers.
- **F4. Save back to the set.** *Recommended: phase 2, after the session only.* **Keep this
  question…** on the report and the Rounds so far row. It writes a **new version** of the set
  through the existing importer (`admin/upload-questions.js:294`, versions with a note: "Added 2
  questions from session 7924") when the caller manages the set, otherwise a new org set "Questions
  from Q4 planning retro". **Never mid-session**: a live session is pinned to its set version
  and its queue is refused wholesale if versions differ (`next-question.js:228-242`).
  Platform and public sets are never written to.
- **F5. The private note in the report.** *Recommended: in the host's report, labelled; left
  out of anything sent to participants; an "Include my notes" switch on the PDF, default on.*
  The alternative is never storing it beyond the read.
- **F6. Mark it to the room?** *Recommended: no label.* The participant sees nothing different
  (owner's brief). A facilitator who wants to say "my own question" says it aloud. The other
  option is the eyebrow "Round 4 · From the host".
- **F7. How many?** *Recommended: no own cap; the queue's 24 (`queue-order.js:56`).* Twenty-four
  own questions is a set, and the empty Setup suggests building one.
- **F8. Before the session starts.** *Recommended: yes, same composer from Setup.* "What do you
  need from today?" as round 1 is common. It is the same op, and First up shows it.

## 5. Backend and data needs

### Where questions and rounds live today

- **A round** is `GAME#<id> / QUESTION#nnn#REF` pointing into the set: `SourceQuestionId`,
  `SetId`, `SetScope`, `SetOrgId`, `SetVersion`, with the session's `ttl`
  (`lambda-functions/game/next-question.js:1201-1235`). STATE then becomes `ASK#nnn`
  (`:1240-1262`).
- **The question itself** is only in the set partition, read through the REF by seven readers:
  `get-question.js:90-125`, `get-game-state.js:304-330`, `get-results.js:453` and `:1532`,
  `get-ai-summary.js:1399-1420`, `create-report.js:662-700`, `poll-round.js:35`, and
  `platform-metrics.js:590-605` (bucketing by set). `up-next.js:98` collects REF ids as "asked".
- **The running order** is `GAME#<id> / QUEUE` holding `Queue` (canonical keys), `Version`,
  `SetVersion` (`question-queue.js:96`). The handler replays an **operation**, never an array
  (`question-queue.js:1-40`). The ops are a closed set, `QUEUE_OPS = ['add','remove','earlier','later','first']`
  (`queue-order.js:64`), and the cap is `QUEUE_MAX = 24` (`:56`). The arithmetic is mirrored in
  `src/src/config/questionQueue.js`, and `tests/question-queue-order.js` holds the two equal.
- **The drain**: `drainQueuedQuestion` (`next-question.js:213-330`) serves the head before the
  automatic walk, checks the set version (`:228-242`), skips asked entries (`:249-255`) and reads
  each candidate from the set (`:257-262`). A queued pick is `isSpecific`, so the cursor and
  AvailMask writes are skipped (`:1040-1057`, `:1277`, `:1293`). `decrementCategoryCount` still
  runs (`:1329`).
- **The preview**: `question-plan.js:163-211` (`planAhead`) consumes the queue first through
  `resolveQueued`, and `up-next.js` tags each row `queued` or `auto`.
- **Ask now** for set questions: `GameHostPage.jsx:5005-5010` sends `select_specific` /
  `skip_to_specific` to `next-question` (`next-question.js:931-1012`).
- **Sealing**: `ENCRYPTED_FIELDS.question` already covers `Title`, `Detail`, `Background`,
  `CustomInstructions` (`tenant-crypto.js:243-254`), in all three copies.

### What changes

1. **One row per own question**: `GAME#<id> / OWNQ#<ownId>` with `Title`, `Detail`,
   `Background` (the note for Workie), `CustomInstructions` (the fixed task), `CreatedAt`,
   `CreatedBy` (sub), `Status` (`queued | asked | removed`), `AskedRound`, and the session's `ttl`
   (as the QUEUE row: the session's lifetime, `question-queue.js:43-50`). Sealed with the
   existing `question` entity under the session's org. No new entity and no `tenant-crypto` change.
2. **Queue keys**: an own question is queued as `own:<ownId>`. `canonical()` leaves it alone (it
   strips only `QUESTION#`). Both copies of the queue arithmetic learn it in one change, with the
   fixture table extended.
3. **Ops**: add `add-own` (writes the OWNQ row and inserts the key in one transaction, at
   `first`, at an index, or at the tail) and `edit-own` (refused once `Status` is `asked`), and a
   positional `after` op (`{op:'after', questionKey, anchorKey}`), all through the same
   `POST /games/{id}/queue` (`template-clean.yaml:1062-1080`, Cognito, `callerMayDriveSession`).
   `remove` of an `own:` key also marks the row `removed`. **No new Lambda and no new route**
   (the stack is near its resource limit). `QUEUE_OPS` stays a closed enum, extended in both copies.
4. **Drain**: in `drainQueuedQuestion`, an `own:` key reads `GAME#<id>/OWNQ#<ownId>` instead of
   the set. It needs no category and no `locateCategory`, and the `SetVersion` refusal does not
   apply to it: an own question is not tied to a set version. Only set keys keep that check,
   so a replaced set still parks set entries without dropping the host's own. The served
   question is `isSpecific: true`, and **`decrementCategoryCount` is skipped** for it (`:1329`).
5. **The REF**: `SourceQuestionId: 'OWNQ#<ownId>'`, `Source: 'host'`, no `SetId` / scope /
   version. **One shared resolver**, `round-question.js`
   `readRoundQuestion(db, table, gameId, ref)`, returns the decrypted set row or OWNQ row. The
   seven readers above switch to it in one change. A test fails if any file reads
   `SourceQuestionId` from a REF without going through it (`tests/round-question-readers.js`).
   `platform-metrics.js` buckets `Source: 'host'` rounds as "own questions", not a set.
6. **Ask it now**: `next-question` accepts `{ action: 'select_own', ownId }`, refused unless
   STATE is `CREATED`, `RESULTS#nnn` or `ENDED`-of-round (D4/F2). It serves the OWNQ row and drops
   the key from the queue if present.
7. **Preview**: `planAhead`'s `resolveQueued` answers `own:` keys from the OWNQ rows (`up-next.js`
   reads them with the queue) and tags them `source: 'own'`. `QueueList` draws **Yours** for
   it.
8. **Workie**: in `get-ai-summary.js:1399-1490`, an own round builds `question` from the OWNQ row
   (`Title`, `Detail` or the "None…" line, `Background`, the fixed task). Everything else (the
   Workie, persona, scoring, angles) is the session's own, unchanged.
9. **Report**: `create-report.js` marks the round `own: true` with `createdAt` and the slot it
   was placed in (`placedAfter`, from the queue op), and `RoundReport.jsx` / `GameReport.jsx`
   print the Yours mark and source line (frame 6). Saved reports carry it inside the sealed body,
   as now.
10. **Words**: `config/roundWords.js` / a new `ownQuestionWords` block in `consoleWords.js`:
    *Write a question, The question, A line for the room, For Workie only, Never shown to the
    room, It runs like every round, Where it goes, Next, Later, Now, Put it next, Put it after
    round N, Ask it now, Yours, Your question is next, Already asked*. The help guides
    (`config/help/host-running.js:405-432` "Choosing what to ask next" and
    `host-two-screens.js:314`) gain a paragraph and the three rows. `helpContent.test.js` must
    hold.

## 6. Risks

1. **Seven readers, one missed.** A reader that still goes straight to the set partition shows
   "Source question not found" on every phone (`get-question.js:127-137`). Mitigation: the shared
   resolver and a guard test that no file reads `REF.SourceQuestionId` directly. Drive one own
   round end to end on dev (phone, window, results, read, report, PDF) before test.
2. **A typed mistake goes public.** The host types fast in front of a room. Mitigation: the
   phone preview under the fields, Edit until it runs, and Remove with Undo.
3. **One screen leaks the question.** Mitigation: D8, the choice sheet first, and the
   one-screen privacy guard from the experience plan's Phase 0 extended to the composer.
4. **Workie over-reaches without lesson text.** With no story, the read may invent context.
   Mitigation: the explicit "None. The host wrote this…" line. Measure three own rounds on dev.
5. **Round totals drift.** "Round 3 of 12" becomes 13 when an own question is queued (frame 3),
   and the strip's total must read the plan, not the set count. Removing it brings it back.
6. **Two host surfaces at once.** The phone polls `/state` every 2 s. `add-own` replays as an op,
   so a stale Remote cannot erase a laptop's edit (`question-queue.js:10-28`). An edit to an OWNQ
   row uses a conditional on its own `UpdatedAt`.
7. **Spoilers.** Queued own titles are unasked questions. They stay host-only, like the queue
   (`template-clean.yaml:1066-1070`).
8. **Billing perception.** A host who adds an own question to a one-round rehearsal makes it
   count (two answered questions). This is correct by the owner's rule, and help says so in one
   line.

## 7. Test plan

**Backend** (`node tests/<file>.js`, exit code):
- `tests/question-queue-order.js`: fixtures for `own:` keys, `add-own` at first, index and
  tail; `after`; duplicate own ids refused; the 24 cap holds; both copies agree.
- `tests/own-question-flow.js` (paged in-memory table): add-own → drain serves it → the REF
  carries `Source: 'host'` → the OWNQ row is `asked` → edit refused; remove marks it `removed`;
  a stale-set queue still serves own entries and parks set entries; `decrementCategoryCount`
  is not called; category masks are untouched.
- `tests/round-question-readers.js`: the guard (no direct `SourceQuestionId` reads), and each of
  the seven readers returns the own question for an own REF and the set question for a set REF.
- `tests/own-question-sealing.js`: an org session's OWNQ row is sealed (`question` entity); an
  orgless one stays plaintext; the public question read never carries `Background`.
- `tests/ai-summary-own.js`: the prompt carries the question, the "None…" detail, the fixed
  task and the note as withheld Background; it never carries the set's `customInstruction`.
- `tests/question-queue-race.js` extended: a laptop add-own racing a Remote reorder; both land.
- `tests/session-count*.js`: an answer to an own round counts like any round.
- Ask it now: refused in `ASK#`/`VOTE#`, accepted in `RESULTS#` and `CREATED`.

**Frontend** (`cd src && npm test && npm run lint && npm run build`):
- `OwnQuestionComposer` render: commit disabled until the question has words, with the reason;
  the commit label follows Next / Later / Now; Now disabled mid-answer with its line; one
  `requestClose()` for X, Cancel, ← Running order and Escape, confirming when typed.
- `QueueList`: an `own` row shows **Yours** (text present), Edit / earlier / later / Remove, no
  Disable; Remove arms in place.
- Your part now words: "Next round asks your question" when the head is own.
- One screen: **Write a question** opens the choice sheet, never the fields; with the Remote
  connected the first option is **Open on my phone**.
- Phone (participant): an own round renders like a set round, with no category, no host label
  and the fixed task line.
- Report: Yours mark and source line; the note labelled as the host's.
- A palette test for the new `.yours` mark (`*Palette.test.js`), composited: `#C9B6FF` on its
  16% violet wash measures 6.19:1 over `--surface`, 5.13:1 over `--surface-2` and 7.44:1 over
  `--bg`; on paper `#5B3FB0` on `#EFEAFB` measures 6.41:1. All clear 4.5:1. The mark is violet
  because amber means "needs you" and blue means "live step"; a fourth meaning needed its own
  hue, and the word *Yours* carries it without colour.

**On dev, by hand**: two screens and one screen; the laptop plus the Remote racing; an own
round through all four beats, with the report and PDF built; Workie's read checked for
invented context on three own rounds.

## 8. The smallest version that proves value

Two-screen console and Remote; Next and Later; Edit and Remove; the drain, the REF source and
the shared resolver; Workie's read with the "None…" line; the report's Yours mark. Then Now,
one-screen polish and F8 (Setup). F4 (keep the question) and F1 (queued quick ask) wait for a
real session.
