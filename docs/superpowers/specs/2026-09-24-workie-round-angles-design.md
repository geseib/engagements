# Workie round angles — design

**Date:** 2026-09-24 · **Status:** approved in conversation by the owner, to build and put on dev
**Scope:** Call & Answer read-backs (`lambda-functions/game/get-ai-summary.js`). The mechanism is
game-type neutral; other game types keep today's behaviour until they are given a house mix.

## Why

A Call & Answer round already carries far more than Workie ever uses: how many people took part,
the event's own information (the host's session details, the question set's AI context, the
briefing), and the race — who leads overall against who won this round. The default Workie reads
none of the race and never *decides* to talk about the event, so every read-back is the same kind
of read-back.

The owner's words: the prompt should be able to draw on participant counts, event data and the
standings — "who is in first-3rd place vs who got first place this round, can make an interesting
comment about catch up or close race" — and "it should be random though: sometimes it could
comment about the event, the ranks, other times just focused on the question or task at hand",
with the choice made by "a bit of programmatic prompt manipulation by the app/lambda before the
prompt is sent".

## Success

- A room hears different kinds of commentary across a session instead of one template.
- A race read-back states the standings correctly — numbers copied, never recomputed by the model.
- An event read-back ties the round to what the event is for, in the event's own words.
- A fact read-back brings one well-known fact tied to the topic.
- None of it costs the discussion questions or next steps: the rubric scores from the 2026-09-24
  Workie rewrite (questions tied to a specific answer, a real disagreement handed back, owned
  week-sized next steps, no invented facts about the room) hold.

## The angles

One angle per round, chosen by the lambda.

| Angle | Offered when | What the angle block asks for | House weight |
|---|---|---|---|
| `question` | always | Stay on the question and the answers: no scoreboard, no event talk | 40 |
| `race` | the round is not anonymous-and-unrevealed; round 2 or later; at least 2 players with a score | The top three overall against who won this round, written into the block. Say whether it is a runaway, a close race, a lead change or a comeback, and state the gap exactly as given | 25 |
| `event` | the host's event details, the set's AI context or the briefing is non-empty | Quote the host's own event words (never the briefing), and make the first discussion question ask which answer does the most for that purpose | 20 |
| `fact` | always | Open the first discussion question with one piece of real, *named* history (an event, invention, person, company or origin story) tied to an answer, under the same general-knowledge rule the Historian's required addition carries | 15 |

- **Unavailable angles** drop out and the draw is over what remains, by weight.
- **No repeats:** `race`, `event` and `fact` never run two rounds in a row. `question` may.
- **Final round lean:** when the session is on its last round and `race` is available, its weight
  doubles.
- **Turnout** (how many answered, how many voted, how many joined the session — the worker cannot see
  who is still in the room) is given to the model on every angle, so any angle may mention it.
- **Voice and angle are independent.** A persona's required addition still applies — the Historian
  can call a close race.

## Mechanics

### `lambda-functions/game/round-angles.js` (new, pure)

- `HOUSE_ANGLE_WEIGHTS` — `{ question: 40, race: 25, event: 20, fact: 15 }`.
- `availableAngles({ hidden, roundNumber, standings, eventText })` → the angle names this round can
  support.
- `pickAngle({ available, weights, lastAngle, isFinalRound, rng })` → one angle name. `rng` is
  injected (defaults to `Math.random`) so tests are deterministic. Weights of unavailable angles
  are ignored; a weight of 0 removes an angle; if every remaining weight is 0 the answer is
  `question`.
- `buildAngleDirective(angle, data)` → the block, or `''` for nothing to say. The race block
  carries the numbers it quotes: the top three with their points, this round's winner(s) with the
  points they earned this round, and the gap between first and second.

### Placement in the prompt

`FORMAT contract → angle block → voice's required addition → host's additions → briefing`.
After the contract because that is the position the model measurably obeys (games 1935 and 4567,
and the persona measurements of 2026-09-24); before the host's additions so the host keeps the last
word before the briefing. The per-round opening move stays inside the contract: it says how to
start; the angle says what to talk about.

### The race data

Standings come from the `PLAYER#<name>#SCORE` rows the worker already reads. `get-results.js`
updates them when the round enters RESULTS and stamps `afterRound`. A player who scored this round
but whose row does not yet carry this round's `afterRound` has this round's vote points added by
the worker, so the block always describes the standings *after* this round. Players who scored 0
this round are unaffected either way. Anonymous-and-unrevealed rounds (`hidden`) never offer the
race, the same rule that already withholds the leaderboard from the prompt.

### The final round (best effort)

The session has no stored round count; `next-question.js` walks each active category's cursor.
The worker treats a round as final when every `CATEGORY#<id>#ACTIVE` row has `ActiveIndex >=
QuestionCount`. If those rows cannot be read, there is no lean.

### Memory across rounds

The chosen angle is stored as `Angle` on the round's `QUESTION#<n>#AISummary` row, in plaintext
beside `PersonaName`/`PersonaId`/`PersonaSource` — it is vocabulary, not content. The next round
reads the previous round's row to apply the no-repeat rule. A missing row means no previous angle.
A Redo draws again.

### Visibility

- The debug info (`?debug=true`) carries `angle` and `anglesAvailable`.
- One log line names the chosen angle and the available set. Standings, names and points are never
  logged.

## The Workie override

- Optional field on a Workie: `angleWeights: { question, race, event, fact }`, each a whole number
  0–100. Absent means the house mix. Unknown keys are refused.
- Validated by a new `normalizeAngleWeights` in `prompt-shape.js` — both copies
  (`lambda-functions/admin/shared/` and `lambda-functions/game/`), kept identical as they already
  must be.
- Accepted by `create-ai-prompt.js` and `update-ai-prompt.js` into the row and the S3 body. Stored
  plaintext: a setting, not prose, and never pushed into a FilterExpression.
- The Workie editor in `AIPromptManager.jsx` gets a "Round angles" section: four number fields and
  a "Use the house mix" reset that clears the field.

## Measured (2026-09-24, Haiku 4.5, the draft-5 default Workie, the real worker)

| Angle | First wording | Result | Shipped wording | Result |
|---|---|---|---|---|
| race | numbers written into the block | 4/4, every figure exact | same | — |
| question | stay off the scoreboard | 3/3 | same | — |
| event | "tie the answers to what the session is for" | 1/4 | the host's words quoted + the first discussion question named as the place | 4/4 |
| fact | "one well-known fact" | 0/4 — truisms ("status updates are a classic meeting tax") | *named* history + the first discussion question as the place | 3/4 |

What did not help, each tried on its own: a "malformed / confirm before you reply" self-check (now on every
block anyway), moving the block after the host's additions, and a one-line nudge at the top of the prompt —
which also produced an invented history ("the Paxlovirus team at the Rockefeller Institute, 1938").
Content and a named place are what the model keeps, which is why the race worked first.

The fact angle carries the accuracy cost the owner accepted for the Historian: roughly one detail in four is
wrong (*Rework* dated 2013, not 2010; Moore's law dated 1971).

## Out of scope

- Other game types' house mixes (trivia has a race too; wavelength has none). The module takes a
  mix per game type so they can be added later.
- Angles authored as free text in the admin screen.
- Persisting which angle a Redo replaced.

## Testing

Test-first, in the repo's style (plain node scripts under `tests/`, jest under `src/src/__tests__`):

- **The draw:** availability for each angle; weights respected over many seeded draws; no repeats;
  the final-round lean; zero weights; everything-zero falls back to `question`.
- **The blocks:** each angle's text; the race block's numbers are exactly the computed standings.
- **The worker's prompt:** the angle block is present and sits after the contract and before the
  voice's and host's additions; no race on a hidden round; stale standings corrected;
  `Angle` written plaintext on the summary row; the previous round's angle read back.
- **The Workie field:** validation in both `prompt-shape.js` copies; create and update accept it;
  the editor round-trips it.
- **With the model:** force each angle through the evaluation harness used for the 2026-09-24
  Workie rewrite. Race rounds must talk about the race with correct numbers, event rounds about
  the event, fact rounds bring a fact — without lowering the discussion and next-step scores.
