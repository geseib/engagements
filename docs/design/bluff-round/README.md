# Bluff round — a twist on Call & Answer

Owner, 2026-11: *"the person who has been given the real answer (randomly chosen)
still has to type it in and should add color to their answer so its in their
voice. and then everyone votes on it. you get 2x vote points if your answer is
not true."*

It fits any Call & Answer set whose questions have a real answer the room does
not know: Famous Art Titles (the painting's real title), What Is This Thing?
(what the patent drawing really is).

## Turning it on

| Level | Where | Field |
|---|---|---|
| Set | Set editor → Details, "Bluff round" checkbox; upload body `bluffRound: true` | `bluffRound: true` on the SETS row |
| Session | Create engagement → "Bluff round: one player secretly gets the real answer" | `METADATA.HostPreferences.bluffRound` |

The session toggle defaults from the set and the host can flip it either way.
Call & Answer only; every other type stores `false`. A create payload that
says nothing about it takes the set's value (`schema-compliant-manager.js`).

## Which questions can be bluffed

`realAnswerOf(question)` in `game/bluff-round.js`:

1. a `RealAnswer` field (CSV column `RealAnswer`, round-trips through download);
2. otherwise `AnswerDetails` that starts `Real title:` or `Real answer:` — the
   text after the label, up to the next `Trivia:`/`Story:`-style label.

`AnswerDetails` stays the story Workie tells afterwards. A question with no real
answer plays as a normal round. A host-written question never bluffs.

## The round

**ASK opens** (`next-question.js`, `openBluffRound`): if the session has bluff on
and the question has a real answer, the server picks one player at random from
the players who are joined, not removed, hold a client id, and have a live
socket. Never the host (a host has no PLAYER row). Last round's holder is left
out when anyone else is eligible. Fewer than 3 eligible players → the round
plays normally and the host is told (`bluff.skipped = 'too-few-players'`).

The pick is stored as `GAME#<id> / BLUFF#<nnn>`: `{ Status, HolderName, Reason,
Players }`. Its SK is outside `QUESTION#` and `PLAYER#` on purpose, so no
existing prefix query (answers, votes, roster, report) can pick it up.

**What each payload carries**

| Payload | Bluff fields |
|---|---|
| `GET /question` (any caller) | `bluff: { active, skipped?, minPlayers }` — never a name, never the answer |
| `GET /question?playerName=X&clientId=Y` | the above, plus `bluff.yours = { realAnswer, prompt }` **only** when X is the holder and Y is the client id on X's PLAYER row (the same proof `get-answers.js` accepts) |
| `GET /state` (`currentQuestionData.bluff`) | public status only |
| WebSocket frames | nothing new — `questionStarted` carries no question content |
| `get-results` at RESULTS | `bluff: { realAnswer, holderName, realBallot, ... }` — the reveal |

The holder's phone shows the real answer with *"Put it in your own words, so
it sounds like you."* The stage and the remote say "Bluff round: one player has
the real answer" and never who. `tests/bluff-round-privacy.js` proves the answer
and the holder's name are in no other payload before RESULTS.

**VOTE** looks the same, with two rules for a bluff round only:

- **One pick, "Which one is real?"** A ranked three-pick ballot would let every
  voter cover the real answer in a small room, so only the first-place pick
  counts and the phone asks for one.
- **No vote for your own answer.** In a normal round players may vote for
  themselves (owner, earlier). In a bluff round that would game the 2× points,
  so `submit-vote.js` refuses a ballot that names the voter's own answer
  (`code: OWN_ANSWER`) and the phone leaves it off the ballot.

**RESULTS** (`get-results.js`, `scoreBluff`):

| Vote for | Points |
|---|---|
| a made-up answer | 2 to its author |
| the real answer | 1 to the truth-holder **and** 1 to the voter who spotted it |

Points go into the existing `PLAYER#<name>#SCORE` rows, paid once per round
like any other. The round's winners are the bluffers who fooled the most
people. If the holder never answered, every pick is a bluff pick.

The reveal (`bluff` on the results reply and on `QUESTION#nnn#RESULTS` as
`Bluff`, sealed with the other `results` fields) says which answer was real,
who held it, who fooled the most, and who spotted it. Closing the round
reveals authors anyway (`AuthorsRevealed`), so naming the holder here is in
step with anonymity.

**Workie** (`get-ai-summary.js`) gets a BLUFF ROUND block after the template:
the real answer, its story (`AnswerDetails`), the holder and what they typed,
who fooled whom and the points. `{bluffRound}` places it in a template that
wants it elsewhere. The author tally Workie is checked against is the bluff
points, not the ranked points.

## After the dev walkthrough (2026-11-07)

- **The room's window (`/present`)** says "Bluff round: one player has the real
  answer" while the room answers and votes, and at results shows the real
  answer and its number on the ballot. Its tally names nobody and shows no
  points in a bluff round (an answer's points are not a player's), labels the
  real one "The real answer" and the top made-up one "Fooled the most", and
  drops the "Talk about it" line. The one-screen stage does the same.
- **The host's console on two screens** shows the same line under the room
  tile, and its results list gives each name the points that PLAYER scored
  (get-results `bluff.points`, spotting included).
- **The phone's "This round"** is the player's own bluff points, not their
  answer's.
- **`School` is withheld until RESULTS** in `get-question` and `/state`, for
  every caller: on these sets it is the artist and date, or the inventor and
  year, enough to look the real answer up. No live screen drew it.
- A one-pick ballot says "Your pick", "Send my vote", "Your vote is in.";
  "Your title is in." only where the round noun asks for a title; the Advanced
  line says "bluff round on".

## Deferred

- The per-question editor has no RealAnswer field yet; "Real answer: …" at the
  start of the reveal works there today, and the CSV column works on import.
- The set upload dialog has no checkbox; the editor's Details does it.
