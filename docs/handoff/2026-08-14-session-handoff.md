# Handoff — 2026-08-14

Read this first, then `RESUME.md` for the standing landmines and the deploy runbook.
`RESUME.md`'s **Landmines** and **Deployment** sections still apply and are not repeated here.

`dev` is at **`e8c167d1`**, deployed and **Succeeded**.
`test` is at **`733997f3`**, deployed and **Succeeded**.
Prod is untouched.

---

## ⚠️ THE BASELINE IN EVERY EARLIER HANDOFF IS NOW OBSOLETE

`RESUME.md` and `2026-08-11-session-handoff.md` both tell you to expect
**"5 failed suites / 31 failed"** on the frontend and to treat that as acceptable.

**That is no longer true and must not be carried forward.** As of `94bb4f32`:

| Suite | Command | Expected |
|---|---|---|
| Frontend | `cd src && npm test` | **111 suites, 2537 passed, 0 failed** |
| Lint | `cd src && npm run lint` | **0 errors**, 13 `exhaustive-deps` warnings |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Backend | recipe in the 2026-08-11 handoff | all `tests/*.js` pass (`*.spec.js` need an uninstalled Playwright dep — ignore them) |

**Any failure is now a real failure.** There is no standing red to explain away.

### The pipeline now gates on this

Every buildspec (`dev`, `test`, `prod`) runs **lint → test → build**. Before `94bb4f32` the
pipeline ran `npm ci` and `npm run build` and *nothing else* — no lint, no tests, ever.

Consequence for the next session: **if a push seems not to land, check the pipeline before
assuming a cache problem.** A red suite now blocks the deploy instead of shipping past it.
Confirmed working in CodeBuild on Node 18 — the log for `94bb4f32` shows
`Test Suites: 111 passed, 111 total` and *then* `Building...`.

---

## The headline: three product-down bugs in two days, one shared cause

All three blanked a live screen. All three shipped through a green build. The cause was the
same every time and is now fixed at the root.

| Bug | Commit | What it was |
|---|---|---|
| Four dead controls | `6f4ccfdd` | `setAuthorsHiddenOnStage` ×2, `setNewGameSetId`, `setBigScreenMode` — calls to setters whose state a refactor had deleted. Next Question, Show Results, **Switch game** and the remote's big-screen key all ran, threw, and changed nothing. |
| Blank host page, every route | `8a827cec` | A `useEffect` dependency array naming `lessonNumber`, declared 90 lines below it. `ReferenceError` during render. |
| Blank page on Quick Start | `17efd267` | `const [spotlightIndex] = useState(null)` sitting **below five early returns**. React counted a different number of hooks across the transition — error #310. |

**Why none of them were caught:** there was no ESLint in this project at all, and the largest
file in the product had never been mounted by a test.

### `GameHostPage` was never unmountable

Its suite failed on `useAuth must be used within an AuthProvider`. **One mock.** That single
unmocked provider is the entire origin of the claim — repeated through this repo, in code
comments, and in my own commit messages this week — that the component "cannot be rendered in
jsdom". That claim is what justified testing a 5,000-line file by reading it as text while three
blank-page bugs shipped past.

It is mounted now (`2dce4f58`, `94bb4f32`). Do not reintroduce the claim.

### The lesson that generalises

Each bespoke source-scanning test written after a bug caught **that** bug and never the next one:

- `undeclaredSetters.test.js` catches `setFoo(` with no binding — blind to hook ordering.
- `hookDepOrder.test.js` catches a dep array naming a later const — blind to early returns.
- A third scan was needed for hooks below early returns.

ESLint's `rules-of-hooks` would have caught the second and third at write time, and reports
**zero remaining violations** across the frontend. Prefer the linter and a mounted test over a
fourth hand-rolled scan.

---

## What landed (13 commits, `4b3b7277..e8c167d1`)

### Owner-reported bugs, all diagnosed to root cause

- **`6f4ccfdd`** — the four dead controls above. Also fixed the **results regression**: names and
  the podium never returned at RESULTS on an anonymous call-and-answer session, because three
  call sites asked `anonymityActive` (true for the whole session) instead of honouring the
  reveal. `authorsHiddenNow()` is that predicate, named once; `standingsVisible` is now its
  literal negation.
- **`65dfddf1`** — a tab switch un-answered and un-voted players. Three faults: both checks read
  `/state` with no player identity (so the server answered on its *host* branch); `checkPlayerVote`
  returned a confident `false` from three exits that had learned nothing; and the ballot-clearing
  guard compared a `gameState` frozen at join time, so it fired on **every** resync. A fourth
  surfaced in testing: a voter returning to the tab saw a **blank** voting screen.
- **`91f28f1f`** — "Unasked only" did nothing. The filter was one correct line; `row.used` was
  false for every question in the product because the two sides carry different id spaces
  (`c005#001` vs `QUESTION#c005#001`). Plus the Enabled-only filter and Asked/Off tags.
- **`d4e1c9d8`** — the Rounds tab said "No rounds yet" after a completed round. `roundsFrom` read
  `detailedQuestions` off the top of the response; `POST /report` wraps it in `report`.

### Features

- **`aa9afaab`** — the generation worker now writes the draft set itself, so leaving the screen
  is safe. **Note:** it creates a set on a *partial* run too, and a retry reuses the title whose
  slug is taken, so the second run's set creation is refused and the panel says to rename.
  Deliberately visible rather than silently auto-suffixing. Worth the owner's opinion.
- **`6881dc2b`** — AI helper that fills the builder form from a description, with per-field
  locks enforced in three places (tool schema, worker before write, client on the way in).
  **The 0.5 retention threshold is a guess** — the suite stubs Bedrock, so nothing has measured
  it against real output. One exported constant.
- **`bbce4d32`** — click an answer to read it full-size; step through with arrows or a clicker.
- **`410ec35d`** — Rounds tab listing every round played, with a dialog showing the question,
  the responses, the AI summary, and a Regenerate button. **No new backend** — `POST /report`
  already assembled all of it.

### Infrastructure

- **`94bb4f32`** — ESLint + the pipeline gate + the five never-running suites, described above.
- **`e8c167d1`** — a preflight rule blocking a summary prompt that never receives the responses
  (see the next section).

---

## The AI prompt investigation — DIAGNOSED, one fix applied, a design decision OPEN

The owner reported: *"im doing the Amazon Leadership principals call and answer in game 8107 and
the AI response is having trouble. maybe its the AI prompt that needs fixing."*

### What was actually wrong

The stored summaries read, verbatim:

> *"I'm ready to facilitate this leadership principles review as Jeff Bezos and Andy Jassy.
> However, I notice you haven't provided the **[Summary of the core idea/response being
> analyzed]** yet."*

**Rounds 1 and 2 both had real answers and votes.** The worker logged `Found 1 answers, 1 votes`
and the text `'Here is a simple test'`. Round 2's summary quotes the literal placeholder back.

The prompt `msmeskd1fd359hfjlj5` — pinned by the set `amazonleadershipprinciplesinterviews` —
**contains no variable carrying the responses.** Its only variables are `{questionTitle}` and
`{questionDetail}`. So Bedrock got a persona, a question, a layout telling it to critique "the
response", and no response.

**What made it look finished:** `[Summary of the core idea/response being analyzed]`. Square
brackets read like a placeholder and are **prose**. Only `{braced}` names are substituted.

> **I initially misread this.** A first attempt at round 2 logged `Found 0 answers` and I
> reported the zero-answer case as part of the cause. It was not — that attempt correctly bailed
> and exited in 112ms. The answers were never the problem.

### Applied: `e8c167d1`

A blocking preflight rule, `no-answer-variable`. Verified against the **real artifact** pulled
from `s3://engagedev-ai-prompts/prompts/call-and-answer/msmeskd1fd359hfjlj5/v1.json`, not a
fixture.

> **My first version of the rule was too broad** — it treated a missing `promptType` as
> "analysis" and lit up ten shipped defaults in `default-ai-prompts.json`, which are question-
> *generation* prompts with no responses to receive. It now fires on explicit
> `promptType: 'analysis'` only.

### NOT applied: the prompt itself

The prompt body lives in **two stores** — the S3 JSON above *and* an `outputFormat` copy on the
DynamoDB row `AIPROMPTS / AIPROMPT#msmeskd1fd359hfjlj5`. The editor writes both and bumps
`version`/`updatedAt` together. Hand-writing them risks a desync. Left for the owner.

### The design conversation, and where it stopped

The owner corrected an important point:

> *"i think the goal was to summarize the idea of the repsonse not print the actual response…
> the [ ] items were intended to be answers"*

**They are right, and my first advice — put `{responsesText}` in the output format — was wrong.**
That would print the raw responses. The correct model is the one the owner proposed:

```
You are a helpful consultant. here is what was said
{questioninfo}
{top3responses}
{gamescore}
OUTPUT
**RADIO SHOW REVIEW**
[Summary of what was asked and the responses using the question info and top3 responses]
```

**Data goes in the instructions half; `[ ]` directions stay in the output half.**

**This works today.** Substitution runs over the whole assembled prompt
(`get-ai-summary.js:2205`):

```js
templateBody = instructions + '\n\n' + outputFormat
prompt = `VOICE:\n${persona.voice}\n\n${templateBody}\n\n${buildOutputContract(promptData)}`
for (const [key, value] of Object.entries(templateVars)) prompt = prompt.replace(regex, value)
```

So variables in `instructions` substitute fine. No engine change is needed for the owner's model.

**`{top3responses}` already exists** as **`{topVotedAnswers}`** — "Top 3 most-voted responses
with their vote detail".

The corrected prompt, ready to paste into the editor's **General instructions**:

```
HERE IS WHAT WAS ASKED AND SAID:
Question:  {questionTitle}
Detail:    {questionDetail}
Responses: {topVotedAnswers}
Standing:  {cumulativeScores}
```

…leaving the Output Format exactly as written, brackets included.

### OPEN — the owner asked for an editor redesign and I have NOT started it

> *"how can we fix the ai prompt editor so you can select what gets sent to the AI. i really like
> the 'what the model is handed' but i think the Category, Scenario are not really helpful… I
> think it would be great to really rethink the builder top part. so the admin has lots of
> control and flexibility, but its easy to create great prompts for the sessions. I also think
> only the relevant variable for a game type are needed"*

What I proposed and what is genuinely blocking:

1. **Two labelled halves** — *WHAT THE AI IS GIVEN* (variables, with a picker) and *WHAT THE AI
   WRITES* (the `[ ]` shape) — replacing "General instructions / Output format", which does not
   convey that the first is where data goes.
2. **`{questionInfo}` composite** — does not exist; the owner would write two variables.
3. **Game-type filtering is blocked on a metadata audit.** There are **67 variables in
   `config/templateVariables.js` and only 12 carry a `call-and-answer` tag.** The rest have
   patchy or missing `gameTypes`. Filtering cannot be built on the catalogue as it stands. This
   is the unglamorous majority of the work.
4. Keep "what the model is handed"; drop Category and Scenario from it.

**Two questions were put to the owner and NOT answered:**

- **Scope** — the whole rework plus the metadata audit, or the fast path first (`{questionInfo}`,
  fix the game-type tags, add a variable picker to the existing layout)?
- **Should the editor state the `{}` vs `[]` convention explicitly**, so the mistake that broke
  this prompt is hard to repeat?

---

## Open — reported by the owner, NOT started

1. **The Rounds summary does not print the actual response.** Likely another field-name mismatch
   between `create-report`'s `rankedAnswers` and what `PastRound` renders. *Check the handler,
   not the client* — see Landmines.
2. **Paging through responses and through multiple pages of AI output.** `AnswerSpotlight` exists
   on the results stage but is **not** wired into the past-round dialog, and the AI summary there
   does not page at all.
3. **Not readable in a conference room.** Owner: *"While i like the crisp design i dont think this
   is readable close up (i.e. not readable in a conf room)"*. **Unanswered question:** is this the
   past-round dialog specifically, or the results stage too? They have separate type scales, and
   "readable at 15 feet" is a different target from "readable on a laptop".
4. **The Cognito console error** — `Failed to get user session: Cannot retrieve a new session.
   Please authenticate.` Appears on first load. Unrelated to the render crashes; never chased.
   Ask whether it comes with an actual sign-out or is only console noise from the session probe.

## Open — from the standing backlog

- **#18 Restyle the AI scenario builder / Prompts admin screen.** The owner asked twice whether
  this was done. **It was not.** What shipped was the scrim reachability fix (`4b3b7277`) and the
  builder-form AI helper. The restyle is untouched.
- **#19** Review a generated set and have AI revise its questions (owner flagged this last).
- **#10** Cap hosts at 5 question sets, server-side. **#11** Whether hosts get AI assist at all.
- **#16** Flaky `tests/host-connection-dedup.js` — 6 failures in 60 runs; the fixture reads the
  clock at `:167`. Has passed on every recent full run.
- **#5** Category names are case-sensitive, so `Strategy` and `strategy` consume two of the 24
  bit positions. **#8** Two raw `.modal-overlay` divs in `QuestionsPanel` bypass the Modal
  primitive. **#9** `aiBatchClient` turns a 403 into a misleading "your session may have expired".
- **#4** Modal recon follow-ups.

---

## Landmines this session added or proved

**1. A fixture written from the client is worth very little — copy fixtures from handlers.**
This caused the Rounds tab bug directly: the test fixture was `{ detailedQuestions }`, invented
to match my reading of the client, while the server sends `{ report: { detailedQuestions } }`.
Client and fixture agreed with each other and both disagreed with the server — the one
arrangement a unit test structurally cannot detect. **Ten mutations died against that module**,
every one a mutation of code the fixture already agreed with.

**2. An empty result and a broken reader render the same screen.** "No rounds yet" is
indistinguishable from a misread envelope. Where an empty state is legitimate, a test must assert
the *populated* case against the real payload shape.

**3. Two id spaces for one question.** `admin/get-question-set-questions.js:75` publishes
`item.SK.replace('QUESTION#', '')` → `c005#001`. `game/get-question.js:124` returns
`sourceQuestionId` → `QUESTION#c005#001`. Both are correct in their own file; both are on the
wire. `questionKey()` in `config/setupPanel.js` normalises. Do not "fix" either end.

**4. A dependency array is not a function body.** A body may safely reference a `const` declared
below it; a dep array is an argument evaluated during render and cannot. Moving a block "up for
readability" is exactly how this ships.

**5. A hook below an early return only breaks on the transition.** Every screen looks fine on its
own. Test the crossings, not the steady states.

**6. Square brackets in a prompt are prose.** Only `{braced}` names are substituted. This is not
obvious from the editor and it silently produced a summary addressed to the prompt's author.

**7. `WebSocketClient.isConnected()` returns `null`, not `false`,** when there is no socket.
Every caller uses it in a condition so nothing is broken, but it is written as a predicate and
does not return one. Recorded, deliberately not changed.

**8. My own polling scripts lied twice.** One reported a deploy "Succeeded" by matching the
newest *finished* row rather than the revision pushed; another mutation landed in a doc-comment
and reported a false all-clear. **Filter on the revision, and strip comments before counting.**

---

## Two files deleted

`src/src/components/ArchiveManager.jsx` and `ArchiveSearch.jsx`. Their source contains literal
`\"` and `\n` escapes and cannot be parsed by anything; nothing imported either, so neither had
ever reached the bundle. They were blocking the lint pass.

---

## Credentials

Three sets of AWS session credentials were pasted into the session transcript. The owner reviewed
this and closed it: *"All those have expired."* At the time of closing the most recent set was
still live as `AWSReservedSSO_PowerUserAccess`; SSO credentials lapse on their own. The local
copy was deleted from the session scratchpad. Recorded so the record is accurate, not to reopen
the decision.
