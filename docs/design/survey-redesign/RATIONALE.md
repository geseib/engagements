# Surveys and polls — rationale

Mockups: `index.html` lists them. Serve with the `all-design-mockups` launch
config (:8124) and open `/survey-redesign/`. Built by `_src/build.py` from the
approved stylesheets, read at build time and never retyped:

| Surface | Base, inlined verbatim | What this set adds |
|---|---|---|
| Console (laptop) | `admin-redesign/_src/shell.css` | `_src/survey-console.css` (`sv-*`) |
| Phone | `player-redesign/build.py` CSS (= shipped `PlayerSurface.css`) | `_src/survey-phone.css` |
| Wall | `refresh-2026-09-22/_src/stage-base.css` + `refresh-stage.css` | `_src/survey-stage.css` |
| Paper report | paper tokens from `styles.css:58-66`, GameReport's type | `_src/survey-paper.css` |

Every page was rendered and looked at in the browser pane: console at 1600×1000,
phones at 390×844, and the wall at 1920×1080 in the Room profile. Four defects
were found that way and fixed before this file was written:

- The admin shell's `.top` class was hijacking the highest histogram column.
- The review table's "changed kind" chip was being cut off.
- The phone buttons fell back to 400 weight. The player mockup writes
  `font:800 … inherit`, which is invalid; the shipped sheet sets
  `font-family: inherit` on its own line.
- The data-model code blocks overflowed their column.

## 1. Where it stands today (22 Sep 2026)

| Piece | State | Evidence |
|---|---|---|
| Survey type | **Missing** | `gameTypes.js:159` marks it unplayable. The importer refuses it (`upload-questions.js:286-300`, not `:146` as the comment says). No session can run one, and no player screen draws one. |
| Survey AI builder | **Partial** | `SurveyAIBuilder.jsx` and `ai-generate-survey.js` (Sonnet 4.6, falling back to Haiku 4.5) generate three kinds: rating, multiple_choice and text_entry. The result can **only be downloaded as JSON**. Two of the three kind checkboxes do nothing, because `:589-591` builds `includeMultiplechoice` where the code expects `includeMultipleChoice`. On the host shelf, "Export JSON and close" downloads nothing (`HostQuestionSetsDialog.jsx:926`). |
| Poll | **Partial** | It plays exactly like Call & Answer: free text, then rank a top three. Its `options[]` and `allowMultiple` are saved (`upload-questions.js:1089-1093`) but no game path reads them. `get-ai-summary.js:2107-2115` reads poll options from `optionA..E`, so for uploaded sets it always gets an empty list. |
| Multiple choice | **Works** (trivia only) | Trivia's A–F choice works end to end: `PlayerPage.jsx:2626-2684`, `ANSWER#` rows, and stage bars with the reveal (`QuestionCard.jsx`, `stage.css:577-647`). |
| Rating, yes/no, ranking, 0–10 score | **Missing** | Absent from every game path. Ranking exists only as Call & Answer's top-three vote. |
| Results back to participants | **Missing** | There is no shared page. The ENDED screen promises a link "if your host publishes a session summary", and nothing can publish one. |
| AI commentary | **Partial** | Workie (a persona plus an approach) summarises rounds of the other game types. There is no survey persona and no survey default prompt; `default-ai-prompts.json` has entries only for call-and-answer and trivia. |

## 2. The model: five kinds, two pacings

**One question model, shared by both types.** It has five kinds:

- **rating**: 1–5, 1–10, stars, or 0–10 as a recommend score
- **choice**: pick one or several, with an optional write-in
- **yesno**: with an optional "Not sure" and an optional "why?"
- **rank**: 3–7 items, where the top N can be enough
- **text**: short or long

The type decides who sets the pace:

- **Survey:** a form people fill in at their own pace. Results come together
  when the host closes it. A **Names** setting decides what is recorded about
  people: Anonymous, Who finished, or Named (§3).
- **Poll:** the same kinds, one question at a time, paced by the host, with each
  result revealed on the wall. **Today's free-text-then-vote poll is retired**
  (owner, 23 Sep), and polls no longer have a vote phase. An existing poll
  question with two or more options reads as multiple choice (they were authored
  with `options[]` all along); one without reads as an open answer. There is no
  data migration: the default is applied when a row is read.

Why not two separate models? The authoring form, the phone inputs, the counting
and the charts would all be written twice. The only real difference is pacing,
and pacing is a property of the session, not of the question.

## 3. Decisions, one per ask

### Selecting question types
- **In the editor:** a Kind chip on every row (icon and word). "Add question" opens
  a menu of five kinds, each described in one sentence (04).
- **In the question form:** a kind switcher. Choice and Rank share a list, so
  switching between them keeps it. Every other switch asks first (05, 06).
- **In the generator:** five multi-select toggles. Each shows a tick as well as
  the fill, never the fill alone (02).

### Creating and adding questions
- **Entry point:** the shipped `NewSetDialog` gains Survey and four ways in (01):
  - your own material (AI)
  - a template (Presentation feedback, Event feedback, Workshop retro, Training
    evaluation, Team pulse)
  - blank
  - a file (CSV with a Kind column, or the survey JSON)
- **Adding to an existing survey:** the Add menu, "Generate more", or "From
  another set". These are the verbs `QuestionsPanel` and `AddQuestionsDialog`
  already have.

### Modifying questions
- **One form.** `QuestionForm` switches its fields by kind instead of by game
  type. The live preview beside it is the real player in an iframe (05).
- **Versioning.** Every save is a new version (`set-version.js`). A session that
  has run keeps the version it pinned, so an edit can never rewrite a result.
  The editor says "run 3 times" so nobody edits without knowing.

### AI: generating questions from input text
- **Three inputs, each in its own field** (02):
  - the material: pasted text, or a PDF/Word file through the existing
    `parse-document.js`
  - the goal: "what do you want to find out?"
  - the kinds to use
  Today the material is lumped into "custom prompt". Here each gets a field
  because they do different jobs in the prompt.
- **How many:** Quick 5, Standard 8 or Thorough 12, capped at 20. The count shows
  the estimated time to answer, because a facilitator weighs length in minutes.
- **The result is a draft survey set, not a download.** It gets the
  `setCreation` path trivia and polls already use. Review happens in the shared
  `GeneratedItemsTable` with a Kind column, and each row can be kept, edited,
  rewritten or switched to another kind (03).

### Names: Anonymous, Who finished, Named (07, 12, 33)
The owner, 23 Sep: *"i would like to collect names. this could be an option:
anon, record just that they completed, attribute."*

**The setting:** one setting, **Names**, with three values:

| Value | What the host gets | What is written |
|---|---|---|
| **Anonymous** (the default) | Totals and the words people write | Answers under a random id the phone makes. No name, no player id. |
| **Who finished** | The above, plus a list of who finished and who stopped partway | The same nameless answers, plus a separate `SURVEY#DONE#<player>` row with the name and a status (started or finished), and no link back to the answers |
| **Named** | Each person's answers, a People tab, and a CSV with names | Answers under the player, with their name |

**The value decides what is written, not what is hidden later.** A promise is
only as strong as what the server holds.

**Where it is chosen:**
- Each set carries a default, which is Anonymous.
- The host can change it when starting the session (07). That dialog reuses
  the Responses card from the shipped setup dialog.
- It is fixed when the survey opens, because each phone has already shown its
  promise on question 1 (12).

**Names stop at the console.** The wall, the featured quote, the shared link,
Workie's prompt and the PDF are built from counts and text, never from names,
whatever the setting.
- The one exception: in Who finished and Named, the host can show the names of
  people *still going* on the wall, to chase stragglers. Those names are never
  shown next to an answer. This is RoomMeter's existing "who's still waiting,
  on demand" behaviour.

### Storing answers (40)
- **Question rows** gain `Kind` plus the fields for that kind. They reuse
  existing field names where they exist: the poll's `options`/`allowMultiple`
  and the generator's `scale.lowLabel`/`highLabel`. For org sets, everything a
  person wrote is encrypted: options, labels and prompts, as well as
  Title/Detail.
- **Answers:** one row per person, `GAME#<id> / SURVEY#RESP#<respondent>`. The
  key depends on the Names setting: a random id from the phone for Anonymous and
  Who finished, the player for Named. The row holds a map of answers, is
  encrypted per org, and lasts 7 days like `ANSWER#` rows.
  A poll keeps today's per-question `ANSWER#` rows, with `AnswerType = kind`.

### Recording answers
- **Autosave.** Each answer is written when it is given, with
  `PUT …/survey/answers`, an idempotent overwrite of one key.
- **Partial answers count.** Someone who stops at question 5 still counts for
  questions 1–4.
- **Resume and edit.** A reload resumes on the same question. With Anonymous and
  Who finished that works on the same phone only; with Named it works from any
  device. Answers stay
  editable until the host closes the survey; "Send" only marks the row complete.

### Visualising results
One chart per kind, the same five on every surface (console, wall, phone, paper),
all counted by one function (`survey-aggregate.js`):

| Kind | Chart |
|---|---|
| Rating | Histogram plus the mean |
| 0–10 recommend score | The 0–6 / 7–8 / 9–10 split plus the score |
| Choice | Trivia's bars, with **"Most picked" in amber** rather than "Correct" in green |
| Yes/no | One split bar, with the "why" answers under it |
| Rank | Average place, with a strip showing where each item was placed |
| Open answer | Workie's themes with counts, plus quotes the host chooses |

Every bar has its number printed next to it; colour never carries a result on
its own.

### Sharing results back
- **What gets shared:** a frozen, read-only snapshot behind a token
  (`SHARES / SHARE#<token>`). The host chooses what goes on it (32).
- **Who can open it, and for how long.** The owner decided on 23 Sep: the
  default is **anyone with the link**, for **2 days from when the survey opened**.
  *"the trigger is opening not creating or viewing."*
  - "Opened" is the start that `start-game.js` already stamps.
  - The host can choose 7, 30 or 90 days instead, counted from the same moment.
    Each is shown as a date, never as a countdown.
  - A host who shares after the window has passed is offered the next window
    still in the future, never a dead link.
- **Three ways to hand it out:**
  - the wall, as a QR code
  - a push to the phones still connected, where the ENDED screen gains
    "See the results"
  - the link itself
- **What never appears:**
  - any chart with fewer than 5 answers
  - any open answer Workie flagged for naming a person, until the host releases it
- **"You" marks** on the shared page come from the phone's own local memory,
  never from the server (11).

### AI commentary from Workie (30, 31)
- **One structured call when the survey closes**, reusing the workie's two
  pickers: Voice (persona) and Approach (prompt). It writes:
  - the lead line
  - a paragraph
  - three next steps
  - a caveat about sample size
  - a one-line note under every chart
  - the themes for open answers
  - which answers name a person
- **Redo** takes a steer. The host can edit the words; an edited read is marked
  as edited in the PDF.
- **On the wall**, it becomes the existing "What we heard" beat.

## 4. What is reused, and from where

| Need | Reused |
|---|---|
| New-set entry | `NewSetDialog.jsx` (container rule, `requestClose`) |
| Set editing, versions | `QuestionSetEditor`, `QuestionsPanel` (`moveRow`, tombstones, save via `replaceSetId`), `set-version.js` |
| AI job + review | `generation-handler.js`, `generation-jobs.js`, `structured-generation.js`, `generated-set.js`, `GenerationJobPanel`, `GeneratedItemsTable`, `FileUploadPrompt` → `parse-document.js` |
| Phone inputs | `.plr-opt` rows, the dock button, the bar, the anon line, the counter; ranking = the vote's tap-in-order slots |
| Wall | Rail, phase band, fitter, dock, the reveal motion; `.opts/.opt/.fill/.pct` (choice), `.cards/.card/.rank` (rank, themes), `blockquote.featured` (quote), join block + QR |
| Featuring a quote | `POST …/comments/{id}/feature`'s verb and broadcast (`799c4ba6`), without the name |
| Workie | `personas.js`, `PromptId`/`PersonaId` resolution (`584c11f6`), the Redo flow, `AISummaryStatus` on the wall |
| Report | `create-report.js` → `GameReport.jsx`, `save-report.js` (S3, encryption, 90/365-day retention) |
| Encryption | `tenant-crypto.js`, applied the way `ANSWER#` rows use it |

## 5. Decided, and still open

**Decided by the owner on 23 Sep 2026:**
- **Names is an option, not a rule:** Anonymous, Who finished or Named (§3).
  Anonymous is the default for new sets; that default is this design's choice,
  not the owner's.
- **The results link defaults to anyone with the link, for 2 days from when the
  survey opened.**
- **Mixed-type sessions are out of this plan.** Stringing surveys,
  presentations, trivia and Call & Answer together under one code, with an
  agenda, locked invitations and a hub of every report, is its own future body
  of work. Its first mockups and notes are in `docs/design/agenda-redesign/`.

- **The free-text poll with a vote is retired.** Polls are the five kinds,
  paced by the host, with no vote phase (§2). Only Call & Answer keeps a vote,
  and so only Call & Answer keeps the "Anonymous responses" toggle.
- **Question content is encrypted for org sets.** That covers options, scale
  labels, yes/no labels, the follow-up prompt and the placeholder, for surveys
  and polls alike.
  - The fields join the `question` list in all three copies of
    `tenant-crypto.js`.
  - Today's plaintext poll options still read, because `decryptValue` passes
    anything that isn't an envelope through unchanged. They are encrypted the
    next time the set is saved. That is the same one-save-at-a-time migration
    the file already uses.

**Still open:** nothing.
