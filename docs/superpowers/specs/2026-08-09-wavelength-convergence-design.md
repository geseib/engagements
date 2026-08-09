# Wavelength: what the room had in common — design specification

**Date:** 2026-08-09
**Status:** proposed
**Scope:** `lambda-functions/websocket/message.js` (answer processing), `lambda-functions/game/get-results.js` (`handleWavelengthResults`), a new clustering worker, `src/src/PlayerPage.jsx` (the ten fields), `src/src/components/WavelengthWordCloud.jsx`, the host's RESULTS and ENDED stages, and the setup screen's guidance copy.
**Source of the rules:** the owner, 2026-08-09, correcting the implemented model. Quoted in §1 because every decision below follows from it.
**Related:** `docs/superpowers/reviews/2026-08-09-ended-screen-review.md` (what a wavelength session shows at the end).

---

## 1. The problem

The owner's correction, verbatim:

> "Wavelength is not about player scores. It's about how many words match across the entire team. A couple of instruction nuances are incorrect. Everyone should enter 10 words. And the word only counts / lights up at the end when everyone said it. It likely needs AI because we need to catch misspellings, and we need to catch semantic similarity — like database and databases and dbs, dbms is really all the same thing. But we can't go too broad, because the objective is to find how many words do we think of in common when a word or phrase is mentioned."

Measured against that, the shipped game is a different game.

| The rule | What ships |
|---|---|
| Everyone enters ten words | Submit is enabled at **one** (`PlayerPage.jsx:1766`). The `/10` counter is decoration; `.slice(0, 10)` in `message.js` is a ceiling, not a floor |
| A word counts when **everyone** said it | `count > 1` — two or more players (`get-results.js:938-941`). `teamScore` is literally the number of words at least two people typed |
| Words land at the end | Nothing is gated on completion; the cloud is sized by raw frequency |
| Catch misspellings and near-synonyms | **Exact string equality** on `trim().toLowerCase()`. `database` and `databases` are two different words. There is no AI anywhere in this path |

There is also a `connectionScore` — common words ÷ unique words (`get-results.js:948`) — which measures neither how many words the room shared nor how many people shared them. It goes.

**What does NOT change:** players have no scores. `teamScoring[].totalScore` is hardcoded `0` (`get-results.js:951-960`) and that is correct, not a defect. A previous investigation flagged its absence as a gap; it was applying the wrong model. Wavelength never writes a `Winners` array and never should.

---

## 2. The mechanic

### The rule

A word **lands** when every person who submitted an answer included it. Landed words are the result: full weight, full colour, and the headline figure counts them.

Everything else the room offered **still shows**, dimmer, carrying the number of people who said it. A round where nothing was unanimous still has something to look at and talk about, which is the point of the round.

### The denominator is people who submitted, not people in the room

Someone who joined and never answered must not be able to zero the result for everybody. Unanimity is computed over the set of submitters, and **the screen always states which set it means** — "all 12 who answered", never a bare "everyone".

### The shortest submission is a ceiling, and the screen must survive it

Ten words are asked for and fewer are accepted (§2.1). The consequence is arithmetic: if one person submits three words, at most three words can be unanimous, no matter what the other eleven people wrote. That is not a bug to engineer around — it is what unanimity means — but it is a way for the headline to collapse to zero in front of a room.

Two mitigations, both required:

1. **Show the strongest tier that is not empty.** If nothing is unanimous, the near-miss tier becomes the headline and is labelled honestly ("no word was on every list — here is what came closest").
2. **Never print a bare percentage.** "11 words the whole room shared" and "said by 11 of 12" are claims a host can defend. "92%" is a claim nobody can interpret.

### 2.1 Ten words asked for, fewer accepted

The player screen asks for ten, shows the count, and lets a short list through. Nobody gets stuck in front of a room because they ran dry at six. Padding with junk costs nothing under a unanimity rule — junk never matches — so there is no incentive to game it.

### 2.2 Group size

The game works at small-team scale and unanimity is why: across forty people, no word survives. The owner's ruling is that **no team-splitting mechanic is built** — the guidance is copy. The setup screen states it when Wavelength is chosen: *works best with groups of ten or less*. That is the whole feature.

---

## 3. Matching — the clustering contract

Exact string equality cannot support the claim the game makes. `database`, `databases`, `dbs` and `DBMS` are one idea and one idea only counts once.

Clustering is **fully automatic** — no host review step, by the owner's decision. That makes the contract below the entire safety mechanism, so it is stated as a contract rather than left to the model's judgement.

### What merges

Case, surrounding punctuation and whitespace. Plurals and inflections. Common misspellings and transpositions. Abbreviations and their expansions of **the same term** (`db` / `dbs` / `DBMS` / `database`). Hyphenation and spacing variants (`data base`, `data-base`).

### What never merges

Terms that are merely related, however closely: `cloud` / `AWS`, `database` / `storage`, `fast` / `performance`. Broader and narrower categories. Antonyms. Two words that a reasonable person in the room would defend as different answers.

### The tie-break, and why it points this way

**When in doubt, do not merge.** A missed merge costs one word off a count. A wrong merge manufactures agreement that did not happen — and manufactured agreement is the one output this game must never produce, because the number is the entire product. The asymmetry is not close, so the prompt states it explicitly rather than relying on temperature.

### The label

The canonical form is the most frequent surface form in the cluster; ties break to the shortest, then alphabetically. Deterministic, so the same submissions always produce the same word on screen.

### The record

Every cluster stores its members on the round's RESULTS item. The screen need not show them — the owner chose no inspection UI — but a dispute in a room is settled by looking afterwards, and a merge nobody can audit is a merge nobody should trust.

### Where it runs

At round close, in a worker. The clustering call is a Bedrock request over up to *players × 10* words and the results route sits under the API Gateway 30-second ceiling.

Use the pattern already shipped in `get-ai-summary.js:474-481, 614-621`: an `InvocationType: 'Event'` self-invoke with `__workerMode`, the HTTP path returning immediately, delivery over the WebSocket. **Not** the `AIJOBS` polling pattern the admin builders use — the host already has a socket, and polling exists there only because the admin pages do not.

The result is written to the round's RESULTS record. A re-read must never re-cluster: the same round asked twice has to give the same answer, or the host who refreshes gets a different result than the room saw.

### When the model fails

Fall back to exact matching — today's behaviour — and **say so on screen**. A degraded claim about agreement that does not announce itself is worse than no claim. One line: "matched on exact wording only".

---

## 4. The reveal is two beats

Closing a wavelength round moves the state to `RESULTS#nnn` immediately, as every other type does. The cloud is not ready yet.

- **Beat one:** the stage acknowledges the round closed and says what it is doing. The host is standing in front of people; a spinner with no sentence is how that silence becomes awkward.
- **Beat two:** the clustered result arrives over the socket and the stage fills in.

The transition must not block on the model, and a model failure resolves to beat two carrying the exact-match fallback (§3) rather than leaving beat one on screen forever. A watchdog is required — the host page already runs one for AI summaries (`aiWatchdogRef`).

---

## 5. What each screen shows

**The player, before submitting:** ten fields, a count, submit enabled below ten. Guidance naming what the round is for — words the *rest of the room* will also think of, not the cleverest word available.

**The player, after submitting:** their own list, and the fact that nothing is revealed until everyone is in. No live counts; a player watching words accumulate would change what they wrote.

**The host, at RESULTS:** the landed words at full weight; everything else dimmer with its count; one figure — *"11 words the whole room shared"* — and the denominator in words. If nothing landed, §2's mitigation applies.

**The host, at ENDED:** no podium — there is no winner and never was. In its place the session's shared vocabulary, with one figure across all rounds. Detail in `docs/superpowers/reviews/2026-08-09-ended-screen-review.md`.

---

## 6. Data changes

1. **`commonWords` means everyone, not two.** `get-results.js:938-941` is the definition of the game and is currently wrong.
2. **`connectionScore` is deleted.** Words ÷ words answers no question anyone asked.
3. **Matching goes through clustering** (§3), so `wordCounts` is keyed by cluster, not by raw string.
4. **Session aggregation is new.** Nothing today combines rounds; the ENDED figure needs it.
5. **Per-player wavelength scoring is removed rather than left at zero.** `teamScoring[].roundScore`/`totalScore` invite exactly the misreading this document exists to correct.

---

## 7. Testing

**Pure and worth writing:** the unanimity rule (landed / near-miss / nothing landed), the denominator (submitters, not the room), the shortest-submission ceiling, the strongest-non-empty-tier selection, and canonical-label determinism including both tie-breaks.

**The clustering contract:** fixture-based, against a stubbed model. Assert the merge pairs (`database`/`databases`/`dbs`/`DBMS`) **and the never-merge pairs** (`cloud`/`AWS`, `database`/`storage`). The never-merge cases are the ones that matter — a clustering test that only proves things merge is a test that passes when the model merges everything.

**Not testable here:** the word cloud's layout. **jsdom has no layout engine**, so every geometric assertion returns zero and passes unconditionally. A human in a browser, at the projected size, with a real round.

**The manual pass starts by proving a word lands only when everyone said it** — run a round where one person deliberately omits a word the rest all wrote, and confirm it does not light up. If that fails, nothing else about the screen is worth assessing.

---

## 8. Out of scope, recorded

- **Team splitting.** Large rooms divide themselves; the product says so and does nothing else (§2.2).
- **Per-player scoring of any kind.** Not a simplification — the game does not have it.
- **Host review of merges.** Explicitly decided against; §3's contract and the stored cluster members are what stand in its place.
