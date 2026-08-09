# The end-of-session screen — review and recommendation

**Date:** 2026-08-09
**Under review:** `docs/design/host-redesign/10-ended.html`, against the shipped ENDED block at `src/src/GameHostPage.jsx:4509-4519` and the data that actually exists behind it.
**Related:** `docs/design/host-redesign/CRITIQUE.md`; `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` §6.12 (`:910-922`), §5.2 (`:464-492`), §4.3 (`:397`), §7 (`:951-975`); `docs/superpowers/specs/2026-08-09-async-ai-builders-design.md`.
**Status:** recommendation. Nothing here is implemented.

---

## 0. The one-paragraph version

The mockup is right about the *shape* — lead with the conclusion, make the scoreboard a footnote — and wrong about almost every fact it puts inside that shape. Its hero sentence is fiction that no code produces; its "100%" is the same structural lie the backend already tells at `lambda-functions/game/get-ai-summary.js:1599`; and its podium is not a podium. What the owner is asking for is three things, and only one of them needs a model: a **participation sentence** (pure arithmetic, ships today, currently absent or false everywhere it appears), a **top three** (arithmetic, exists in rows, mis-sorted in the report), and an **AI session summary** (new prompt, new record, new worker — but the delivery mechanism it needs already shipped twice). Wavelength gets none of the podium and needs a different answer entirely, given below.

---

## 1. What ENDED shows, per game type

### 1.1 The parts that do not vary

Everything outside `.content` stays as the mockup draws it and as the spec rules it:

- Rail: `COMPLETE` chip, event title, round/player context, `Session 4821 · closed` — `10-ended.html:768`. The join line is gone at ENDED, correctly (§6.12, `:914`).
- Phase bar `data-phase="done"` — the doubled striped amber band, `10-ended.html:203-204`.
- Dock: status sentence, ghost **Keep on screen**, primary **Open Session Report** — `10-ended.html:772`, wired at `src/src/config/hostControls.js:177-185`.

The content region carries, in this order, for every game type:

1. **Kicker** — one line, `--t-meta`.
2. **Headline** — the AI session summary, `--t-hero`, hard-clamped (§3.4 below). Falls back to the shipped factual hero.
3. **Participation line** — `--t-body`, immediately under the headline, in the content flow. **Not inside a `data-drop` group** — see §4.6.
4. **The bottom third** — a podium, or wavelength's replacement.

### 1.2 Trivia — `phases: ['ASK','RESULTS']` (`src/src/config/gameTypes.js:31`)

- **Kicker:** `How the room did`.
- **Headline:** an AI sentence about *what the room knew and did not*, not about a person. ("The room was sure about pricing mechanics and split three ways on packaging.")
- **Podium:** real, three cards, 1st / 2nd / 3rd by cumulative score. The score exists and is trustworthy: `lambda-functions/game/get-results.js:709-758` writes `PK=GAME#{id}, SK=PLAYER#{name}#SCORE` per trivia round with an `afterRound` guard against double-scoring (`:727-731`), and `lambda-functions/game/get-players.js:236-250` reads it back.
- **Do not read the podium from the report as it stands.** `create-report.js:590` sorts `playerPerformance` by `gamesWon`, and `gamesWon` is derived from `result.Winners` (`create-report.js:523-527`) — which is written **only** in the vote-tally branch at `get-results.js:546`. Trivia never writes it. Every trivia player has `gamesWon: 0`, so the report's ordering is whatever DynamoDB returned. `totalScore` on the same object (`:557`) is correct; the sort key is not. Sort by `totalScore`.
- §6.12 says trivia "may lead with the champion" (`:918`). It should not, now that the headline slot belongs to the summary. The champion is card 1 of the podium and is stated once.

### 1.3 Call & Answer, Poll, Survey — all three run `['ASK','VOTE','RESULTS']` (`gameTypes.js:19, :42, :70`)

- **Kicker:** `What the room decided` (call-and-answer), `Where the room landed` (poll), `What the room reported` (survey).
- **Headline:** the decision or the through-line.
- **Podium:** three cards, **labelled by what the number is**, not "champion". These points are vote points others gave you (`get-results.js:465-517`), so the honest label is **Most backed**, then 2nd and 3rd. A "champion" framing on a strategy session is the exact complaint §6.12 records from the consultancy partner (`:916`).
- **Survey is flagged, not settled.** `gameTypes.js:64-69` records that survey runs a vote phase only because nothing excludes it, and calls that possibly unintended. If survey ever stops voting, it stops having scores, and it must then take the wavelength treatment in §1.4 rather than showing an empty podium. Build the podium as a capability gated on "does this session have score records", not on the game-type string.
- **The anonymity gate is load-bearing and the mockup has no state for it.** `src/src/config/anonymity.js:171-173` — `standingsVisible()` returns false while a round is anonymous and unrevealed, on the stated ground that a score beside a response "is attribution by arithmetic". §5.6.7 of the spec explicitly contemplates a host who never reveals. A session-end podium is a score table for the whole session; if any round was never revealed, the podium attributes those rounds retroactively. **Recommendation:** show the podium only when every round that contributed points has been revealed. Otherwise show the participation line and the headline alone, with one `--t-meta` line: *"Standings are in the session report."* That is a §7.10-compliant reduction — it has a named recovery.

### 1.4 Wavelength — no podium, and the replacement

**The podium must not exist here, and the code agrees with the owner.** Wavelength writes no `Winners` (the array is written only at `get-results.js:546` and `lambda-functions/websocket/message.js:265`, both gated on a `VOTE#` state that wavelength never enters — `gameTypes.js:53-57`, `message.js:225-228`). It writes no score record: `handleWavelengthResults` spans `get-results.js:858-1030` and touches neither. `get-results.js:952-960` builds a `teamScoring` map in which every player's `roundScore` is the same number and `totalScore` is hardcoded `0` with the comment "Will be calculated elsewhere" — nothing calculates it. The host page zeroes it again at `src/src/GameHostPage.jsx:2303` (`points: 0, // No points in wavelength`). The only `PLAYER#{name}#SCORE` row a wavelength player ever holds is the zero written at join (`lambda-functions/game/join-game.js:148-162`). A podium here would have to invent its own numbers.

**What goes there instead: the room's shared vocabulary — the words everyone said.**

- **Kicker:** `Where the room was already agreed`.
- **The band itself:** the terms the whole room said, ranked, using the `.terms` flow already designed for `08-results-wavelength` and specified at §6.10 (`:878-889`) — descending frequency, five size buckets from `--t-hero` down to `--t-meta`, no term below the floor, count as a superscript, one amber accent on the top term. It is deterministic, it states its own reduction, and it is the right read at 25 feet. Reuse it; do not invent a second treatment for the same data.
- **Two tiers, visually distinct, as the owner described.**
  - **Unison** — said by *every* player present for that round. Full weight, `--text`, top term amber.
  - **Near-miss** — said by more than one but not all. Dimmer (`--muted`), one bucket smaller. Not hidden: the owner is explicit that near-misses still show.
- **The single figure that replaces the podium's score:** `**11 words the whole room shared**` at `--t-primary`. That is the team's result, and it is the one number a wavelength session actually produces.
- **Participation line unchanged** — it is people-based (§2) and works identically here.

**Four things must change in the data before this is honest:**

1. **"Common" currently means "two people said it", not "everyone".** `get-results.js:938-941` selects `count > 1`. The owner's rule is `count === playersPresent`. Both tiers are needed; the existing threshold becomes the *near-miss* tier and a new `count === playerCount` tier becomes unison.
2. **`connectionScore` is not a percentage of anything a person would guess.** `get-results.js:949` — `commonWords.length / totalUniqueWords`. It is a ratio of *words* to *words*, not of people to people, and it drops as the room gets more creative. Do not project it. Retire it or redefine it as `unisonWords / distinctWords` and label it in words, never as a bare percent.
3. **Matching is exact-string after `trim().toLowerCase()`, in four duplicated places** — `message.js:449-453` (write-time, also the 10-word cap and 50-char cap), `get-results.js:926-932`, `get-ai-summary.js:1899-1953`, and again client-side in `src/src/components/WavelengthWordCloud.jsx:16-31`. There is **no clustering, stemming, or synonymy anywhere** in the repo. `database` / `databases` / `dbs` / `DBMS` are four distinct terms today, so "everyone said it" will essentially never fire. The conservative AI clustering the owner wants is genuinely new work — and it belongs in the **same Bedrock call as the session summary** (§3), because the model needs the words anyway and one call is cheaper than two. Cluster labels must be a returned mapping the server applies, not free text the model writes, so the counts stay arithmetic.
4. **Nothing aggregates wavelength across rounds.** Every computation is scoped to one padded question id (`get-results.js:902-909`, `get-ai-summary.js:783-791`), and `create-report.js` contains zero wavelength-aware code — reports treat wavelength answers as generic answer rows. A *session-wide* shared vocabulary therefore needs a new roll-up. **If that is not built, the honest fallback is the final round's unison band, labelled as such** ("Round 8 · Pricing power"), not a silent session-wide claim.

Two live defects in the wavelength AI path, worth fixing before any of this is wired: `get-ai-summary.js:864-866` references `commonWords` in `exports.handler` where it is not declared (the declaration is inside `generateAISummary` at `:1546`), which throws on any wavelength game reaching that branch; and `get-ai-summary.js:1872-1873` reads `storedResults.playerAnswers` while `get-results.js:966` writes the array as `answers`, so the stored-results branch yields an empty word list on real data.

The wavelength ENDED screen also loses nothing by having no podium, because the host currently sees no per-player wavelength information at all: `GameHostPage.jsx:2295-2307` discards `wordAnalysis`, `teamScore`, `connectionScore` and `teamScoring` from the server response, and `:4358-4369` renders only the d3 cloud plus a `"N contributed words"` caption (`WavelengthWordCloud.jsx:185-206`).

---

## 2. Participation, defined precisely

### 2.1 What exists today is not a participation rate

`get-ai-summary.js:1249` — `const totalParticipants = answers.length;`
`get-ai-summary.js:1599` — `` const participationRate = `${Math.round((answers.length / totalParticipants) * 100)}% answered, ...` ``

Numerator and denominator are the same expression. It is `100%` by construction, always, on every round, in every game type. `votingParticipation` at `:1511` divides `activeParticipants` (which is `votes.length`, or `answers.length` when there are no votes — `:1505`) by the same `answers.length`, so for trivia and wavelength it is also pinned at 100%, and for voted rounds it is votes-per-*answer*, which is not a rate of people either.

This is not inert. Both values are interpolated into the live prompt — `{votingParticipation}` at `get-ai-summary.js:282`, emitted at `:2046` and `:2059`. **The model is being told the room's participation was 100% on every round it has ever summarised**, and hosts read those summaries aloud. Fix or delete these before anything about participation reaches a wall.

### 2.2 The definition

The owner's sentence — *"100% means all X players provided input"* — is people-based, and people-based is also the only definition this system can compute honestly. Adopt it literally.

> **Numerator** — the number of **distinct people who submitted at least one answer at any point in the session**.
> **Denominator** — the number of **distinct people who joined the session**.

**Numerator, concretely.** Distinct `{name}` across every `SK = QUESTION#{nnn}#ANSWER#{name}` row under `PK = GAME#{id}`. The name is always present in the sort key — `message.js:354-365` writes it there unconditionally — so this is computable even for anonymous rounds, where redaction happens at read time, not write time. **It must therefore be computed server-side and returned as a count only.** The names must never cross the wire to the stage: §7.15 (`:970`).

**Denominator, concretely.** The deduplicated `PLAYER#{name}` rows, excluding `#SCORE` and `#STATE` — i.e. exactly the `uniquePlayers` set built at `create-report.js:495-513`.

**Do not use `gameStats.totalPlayers`.** `create-report.js:102` assigns `players = playersQuery.Items`, which is the raw `begins_with(SK, 'PLAYER#')` query at `:48-55` — it contains `PLAYER#{name}`, `PLAYER#{name}#SCORE` and `PLAYER#{name}#STATE` rows together. `create-report.js:115` then sets `totalPlayers: players.length`. **The report's player count is inflated roughly threefold**, and the correct set is computed forty lines later and never fed back. This is the denominator anyone would naively reach for, and it is wrong. Fix it regardless of this screen.

### 2.3 What counts as "input"

**Submitting an answer.** One `ANSWER#` row in one round is enough.

- **Trivia:** selecting an option is an answer row — it counts.
- **Wavelength:** an answer row with at least one non-empty word counts. `message.js:449-453` already drops empties; `src/src/PlayerPage.jsx:1131-1133` refuses to submit at zero words. A player who submits 1 word counts the same as one who submits 10 — participation measures whether someone spoke, not how much.
- **Voting does not count as input.** A person who voted but never answered did not contribute anything to be voted on. If voting participation is wanted it is a second, separately labelled number, and it belongs in the report, not on the wall. (Rendering both invites §7.4.)
- **Being present does not count.** That is what makes the figure informative rather than tautological.

### 2.4 Late joiners and early leavers — why this definition needs no eligibility window

The system records `JoinedAt` (`join-game.js`, surfaced at `get-players.js:143`) and **has no leave signal at all** — `isConnected` (`get-players.js:144`) is a socket state, not an attendance record, and a phone that sleeps is indistinguishable from a person who walked out. Any definition shaped as *"answers ÷ rounds you were eligible for"* therefore has an uncomputable denominator, and any attempt to approximate it will punish the people §5.2 of the spec already went out of its way to protect (`:487` — *"our clinical staff answer late because they are with patients"*).

The people-based definition sidesteps this entirely:

- **Joins at round 5, answers 5–8** → counted as took part. Correct, and no eligibility window was needed.
- **Answers rounds 1–3, then leaves** → counted as took part. Correct: they did provide input.
- **Joins, never answers** → counted against. Correct: that is precisely what "provided input" excludes, and it is the whole informational content of the number.
- **Rejoins under a different name** → inflates the denominator by one and depresses the figure. This is a real, known distortion (`get-players.js:61-75` deduplicates by name, so a new name is a new person). It is small, it is not silently wrong in a dangerous direction, and it should be recorded rather than engineered around.

### 2.5 What the screen says, in words

**Full room:** `All 40 people took part` — in `--success-text`, `--t-body`.
**Short:** `34 of 40 people took part` — `--text`.

Rules on the copy:

- **Never a bare percentage.** "100%" with no denominator is exactly the shape of the lie at `get-ai-summary.js:1599`, and a room cannot audit it. If a percent is wanted, it goes second and small: `34 of 40 people took part · 85%`.
- **"People", not "players".** A strategy offsite does not have players. The rail already says "players" (`10-ended.html:768`); pick one word across the screen.
- **One statement only.** The rail's `40 players` and any participation denominator are the same fact — §7.4 (`:955`). Either the rail drops the player count at ENDED, or the participation line borrows it: `All 40 took part`. Recommend the latter; the rail keeps the count, the content states the verdict.
- **Zero case:** if nobody answered anything, say `Nobody took part` and drop the podium and the summary. §7.9 (`:962`) — an empty state must not lie.
- **Round depth belongs in the report, not on the wall.** The report already computes a per-player figure — `create-report.js:561-562`, `playerAnswers.length / gameStats.totalQuestions` — which is a legitimate second number once its denominator is fixed. Keep it there.

---

## 3. The AI session summary

### 3.1 What it should say

**One sentence. Optionally a second, shorter one.**

- **Line 1 (the headline, `--t-hero`):** the conclusion — what the room decided, or what it turned out to believe. Present tense, the room's own vocabulary, **≤ 90 characters**, hard budget. No AI vocabulary, no product vocabulary, no model nickname (§7.16, `:975`; §6.11's ruling that "Workie" does not go on a client's wall, `:893`).
- **Line 2 (`--t-body`, ≤ 52ch, optional):** the "so what" — what follows from it. The mockup's `Eight rounds · forty people · the two highest-backed moves cost nothing and start this week` (`10-ended.html:770`) is the right register for this line, minus the counts.
- **No names.** Ever. §7.15, and because a session may contain unrevealed rounds (`anonymity.js:171-173`).
- **No numbers the screen also states.** The participation figure and the round count are arithmetic and are printed from arithmetic. If the model states them too they will eventually disagree, and the room will believe the bigger type.

### 3.2 What the prompt needs

Session-level, assembled once. Per owner ruling 1, this is a new session-wide generation, not a stitch — the round summaries may be *context*, but the instruction must be to reach a conclusion, not to concatenate.

- **Session frame:** event title, round noun (`create-report.js:584`), game type(s), question-set title, and the set's `aiContextInstruction` / `customInstruction` (`create-report.js:604-611`) — this is the client's own framing and is the single biggest lever on whether the sentence sounds like the room.
- **Per round, the outcome only:**
  - voted rounds — the top three answer texts with their vote points, authors redacted;
  - trivia — the question, the correct answer, percent correct, and the most-chosen wrong option;
  - wavelength — the unison and near-miss terms with counts.
- **The stored round summaries** at `SK = QUESTION#{nnn}#AISummary` (`get-ai-summary.js:1067-1069`), which `create-report.js:111` and `:449-459` already read — as secondary context.
- **Redaction is not optional and is already solved.** `create-report.js:98-100` has `roundIsHidden`; `get-ai-summary.js` already substitutes `AUTHOR_PLACEHOLDER` (`:1240-1245`). Reuse both. A model that receives names will use them.
- **The participation counts**, supplied so the model cannot invent a contradicting figure — with an explicit instruction not to restate them.
- **For wavelength, the raw word lists**, so the same call can return the clustering mapping (§1.4).

**Storage:** one new record, `PK = GAME#{id}`, `SK = SESSIONSUMMARY`, mirroring the round record's fields and 30-day TTL (`get-ai-summary.js:1067-1087`). It must be a *record*, not a report field — the ENDED screen must never call `POST /games/{id}/report` to render itself (see §3.5).

### 3.3 How long it takes

- The round path uses **Haiku 4.5** (`get-ai-summary.js:2187-2192`) on a 512MB / 300s function (`template-clean.yaml:704-705`).
- The admin builders use **Sonnet 4-6 with a Haiku fallback** (`lambda-functions/admin/shared/structured-generation.js:30-31`) on 900s / 1024MB functions (`template-clean.yaml:931-933`), and budget throughput at **45 output tokens/second** (`lambda-functions/admin/shared/generation-handler.js:39`).

A session summary is a **large input, small output** — eight rounds of context in, roughly 120 tokens out. Expect **3–8 seconds on Haiku**, **8–20 seconds on Sonnet**, plus cold start. Add the wavelength clustering and the input grows again.

**That is inside 30 seconds on a good day, which is exactly why it must not be done inline.** The async-AI-builders spec records the failure mode precisely (`docs/superpowers/specs/2026-08-09-async-ai-builders-design.md:8-20`): `RestApi` is an `AWS::Serverless::HttpApi` with a hard, non-configurable 30-second integration timeout, and a generation that loses that race returns a non-JSON 503 while the Lambda is still working. A screen that is correct at p50 and shows a gateway error at p95, in front of a room, at the last moment of a four-hour session, is not shippable.

### 3.4 The reveal-timing problem, and the mechanism to use

**Do not use the `AIJOBS` polling job.** That pattern exists for a specific reason stated in its own source: admin builders have no `gameId` and no socket (`lambda-functions/admin/shared/generation-jobs.js:21-25`). The host stage has both.

**Use the mechanism `get-ai-summary.js` already ships**, which is the same self-invoke with a better delivery:

- HTTP `GET` returns `404 {status:'not_ready'}` on a cache miss (`get-ai-summary.js:600-611`) or `202 {status:'generating'}` after firing the worker (`:628-632`).
- The worker is a **fire-and-forget self-invoke** — `InvokeCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: { __workerMode: true, ... } })` at `:613-627`.
- On completion it persists and **broadcasts over WebSocket** — `broadcastToGame(gameId, { type: 'aiSummaryReady', gameId, questionId })` at `:1101-1106`; failures broadcast `aiSummaryError` and rethrow so Lambda's Event retries apply against an idempotent Put (`:1143-1156`).
- Client handlers are already registered — `GameHostPage.jsx:1034-1058`.

### 3.5 When to trigger it

**At the moment the game ends, not when the screen asks.**

`lambda-functions/game/next-question.js:630-673` is the only writer of `State = 'ENDED'` (the update is at `:636-650`) and it already broadcasts the end (`:652-659`). Its own log line at `:661` reads *"final report should be generated"* — the hole is already marked. Add, immediately before the broadcast, an `InvocationType: 'Event'` self-invoke of the session-summary worker. It is fire-and-forget, so it delays the state flip by one API call, and the worker broadcasts `sessionSummaryReady` when it lands.

**Optionally, pre-warm one beat earlier.** The host typically talks for 30–120 seconds over the final RESULTS screen before advancing. Category counts are decremented after each round (`get-results.js`, `decrementCategoryCount`), so "no questions remain" is knowable at the final RESULTS, not only at the ENDED transition. Speculatively firing there buys most of the latency back. Keep the ENDED trigger as the guaranteed path regardless; the Put is idempotent.

**Never trigger it from the ENDED render.** The report endpoint is the wrong shape for this screen and always was: `POST /games/{gameId}/report` (`template-clean.yaml:631-644`) inherits the Globals `Timeout: 30` (`template-clean.yaml:70-76`) — no per-function override — and it is host-initiated, fired only from `GameHostPage.jsx:2772-2777` behind the dock primary (`hostControls.js:177-185`) or a row button in the reports modal (`GameHostPage.jsx:3182-3187`). It also has **no Bedrock policy at all** (`template-clean.yaml:643-645` grants `DynamoDBCrudPolicy` only), so putting generation there is an IAM change as well as a latency bet.

### 3.6 What the screen does while it waits

**No spinner.** §6.11 settles this: *"A spinner on a projector is dead air"* (`:908`), and its empty case is the model to copy.

1. ENDED renders **instantly** with what is already true: kicker, participation line, podium. These need no model and no network round trip beyond what the page already has.
2. The headline slot renders the shipped factual hero — `8 rounds played` (`GameHostPage.jsx:4512-4514`) — at its final size, so **the box is already the right height and nothing reflows** when the summary lands.
3. The dock status carries the wait, exactly as §6.11 does: `Writing the summary…` in place of `All 8 rounds played`.
4. On `sessionSummaryReady`, the headline cross-fades to the summary sentence. **A cross-fade, not the phase wipe** — the wipe's meaning is "look at your phone now" (§6.14) and spending it here blunts it.
5. **Hard timeout at 20 seconds.** After that the factual hero is final and the dock status returns to normal. The headline changes **at most once**, ever. A headline that changes twice in front of a room is worse than one that never changes.

---

## 4. What the mockup gets wrong

CRITIQUE.md's remaining ENDED findings are the podium-name truncation (§N6.5, `CRITIQUE.md:461`) — since fixed by making `.pod .nm` wrap (`10-ended.html:399-402`), but that fix was measured against **two** cards and needs re-measuring at three. Its earlier findings about the duplicated champion (`:196`) and the lingering join line (`:197`) are both resolved. What follows is new.

**4.1 The hero is fiction, and it is the reason this screen shipped without a summary.**
`10-ended.html:770` — `Hold price. Fix the story before the discount.` Nothing in the system produces that sentence. The implementer already noticed: `GameHostPage.jsx:4505-4508` records that *"the mockup's hero is a decided conclusion, which nothing in the game state can supply yet"* and substitutes the factual hero. A mockup that renders an unbuilt capability as a finished fact hands the implementer a choice between shipping a lie and shipping less, and the honest choice was made. The mockup should have drawn the fallback state beside the ideal one.

**4.2 "Rounds captured · All eight · 100%" is a second structural lie, in the podium slot the owner wants for people.**
`10-ended.html:770`. You only count rounds that happened, so this figure can only ever read 100% — the identical defect as `get-ai-summary.js:1599`, reproduced in the design layer. It also restates the rail's `8 rounds` (`:768`) — §7.4 — and it answers a question nobody in the room has. Delete it; the slot is the podium's.

**4.3 The podium is not a podium.**
Two stat cards, one of which is 4.2. The owner wants top three; the mockup shows one person and one non-fact. Restoring 1st is now correct rather than a §7.4 violation *because the champion is no longer the hero* — the duplication §6.12 removed (`:914`) only existed while the hero named a person. The spec sentence at §6.12 needs updating to say so, or the next implementer will delete card 1 again on the spec's authority.

**4.4 "Most-backed contributor · Aleksandra Wiśniewska · 1,240" cannot be sourced as drawn, in two independent ways.**
First, the report sorts by `gamesWon` (`create-report.js:590`) and `Winners` is never written for trivia or wavelength (`get-results.js:546` is the vote branch only). Second, on a session with unrevealed anonymous rounds, naming the top scorer is attribution by arithmetic for every one of them — the exact rule `anonymity.js:171-173` encodes. The mockup has no state for either case.

**4.5 The amber budget is now wrong and the spec is the thing that is wrong, not the drawing.**
§4.3 (`:397`) allocates ENDED's single amber to *the champion*. With the conclusion in the hero slot, the amber must move to the conclusion and the podium must be neutral — otherwise the screen has two accents and the eye goes to the leaderboard, which is precisely the outcome §6.12 exists to prevent.

**4.6 The participation figure is inside the first thing sacrificed.**
`10-ended.html:770` — `<div class="podium" data-drop="1" data-drop-note="Scoreboard">`. Dropping the scoreboard first is right (§6.12, `:917`). But the mockup put its participation figure *inside* that group, so under pressure the screen loses the one number the owner asked for and keeps the sentence. Participation belongs in the content flow, above the podium, undroppable.

**4.7 The headline has no content budget, and the fitter will pay for it out of the podium.**
`.hero` is clamped to five lines only in the terminal `[data-clamped]` state (`10-ended.html:262`). An unbounded model sentence at `--t-hero` drives the scale search to its floor and squeezes everything below it. §6.11 already ruled on this shape (`:908`): the length instruction to the model is *"a preference, not a guarantee"*, and the view clamps regardless. Enforce **both** — a hard character cap server-side before the record is written, and a view clamp.

**4.8 "Keep on screen" can strand a screen that is about to mutate.**
`10-ended.html:772`. It is the one sanctioned hiding of the primary control (§6.12, `:920`). With an async headline, a host who presses it at t+4s gets a screen that changes under a room with no way to react. Disable it until the summary has landed or timed out.

**4.9 Two statements of the room's size in one viewport.**
`8 rounds / 40 players` in the rail (`:768`) and `Eight rounds · forty people` in the detail line (`:770`). §7.4.

---

## 5. The minimum honest version

Ordered by truth delivered per unit of work. Each tier stands alone and is worth projecting.

### Tier 0 — corrections that must land before any figure goes on a wall (no new features)

1. **Delete or fix `participationRate` and `votingParticipation`** — `get-ai-summary.js:1511`, `:1599`. They are interpolated into the live prompt at `:282` / `:2046` / `:2059`, so today the model is told every round had 100% participation, and hosts read those summaries out loud. This is the single highest-value fix in this document and it is a deletion.
2. **Fix `gameStats.totalPlayers`** — `create-report.js:115` counts `PLAYER#`, `#SCORE` and `#STATE` rows together (`:102`, query at `:48-55`). Use the `uniquePlayers` set already built at `:512`.
3. **Sort `playerPerformance` by `totalScore`, not `gamesWon`** — `create-report.js:590`.

None of these change a pixel. All three are prerequisites for anything below.

### Tier 1 — the honest ENDED screen, with no model involved at all

Replace `GameHostPage.jsx:4509-4519` with:

- kicker `Session complete`;
- the existing factual hero (`8 rounds played`);
- **the participation sentence** per §2.5 — one new server-computed count, pure arithmetic over rows that already exist;
- **the top three** for scored sessions, gated on `standingsVisible`; **the unison band** for wavelength, or the final round's if no session roll-up exists; nothing at all where neither is available.

**If only one thing ever ships, ship the participation sentence.** It is the only claim on that screen that is currently either absent or false, it needs no model, no new endpoint and no new record, and it is the number the owner actually asked for.

### Tier 2 — the AI session summary

The new `SESSIONSUMMARY` record, the prompt of §3.2, the worker fired from `next-question.js:630-673` on the `get-ai-summary.js:613-632 / 1101-1106` pattern, and the reveal behaviour of §3.6. The headline slot is already the right height from Tier 1, so this is additive and cannot regress the screen: if generation never lands, Tier 1 is what the room sees.

### Tier 3 — wavelength's shared vocabulary

The unison / near-miss split (`get-results.js:938-941`), conservative clustering folded into the Tier 2 model call, and the cross-round roll-up that `create-report.js` currently has no concept of. Largest and last, because until Tier 2 exists there is no call to fold the clustering into.

**What is explicitly not worth building:** a session-wide "voting participation" number, a `connectionScore` on the wall, a full roster, and any percentage without its denominator beside it.
