# Build Room, Crew mode: storyboard

Static mockups for `FLOWS.md` in this folder. Nothing is built. Open `index.html` in a
browser; it is one self-contained file (inline CSS, no script). The CSS opens with the
`../build-room/index.html` block copied verbatim, so both storyboards read as one system.

The story continues from the solo Build Room: Eastside Food Bank volunteer sign-up, join
code 4821, host George, builders Priya, Sam and Ana, base branch `build-room/4821`.

## Frames

| # | Flow | What it shows |
|---|---|---|
| 1A, 1B | F1 | Host's "Open to a crew" panel (repo, base, three access modes with tradeoffs); the wall's "Join as a builder" strip |
| 2 | F2 | Priya's phone ("I have Claude Code", builder key) beside her terminal forking, branching, running, posting "ready" |
| 3 | F3 | Task board ranked by the room, claimed by builders; Parking map is a race; Sam's claim phone |
| 4 | §4 | The wall's crew board: pipeline strip with counts, one lane per builder, host-only Incoming |
| 5A, 5B | F4 | A featured peek on the wall; a room phone reacting; Priya's phone with feedback and v1/v2 tabs; her Claude taking the feedback |
| 6 | F5 | George's terminal running the review (untrusted code, asks before running); the review card and its comments |
| 7 | F6 | Choose ask: A = Priya's branch, B = Sam's, each with screenshots and a one-line review |
| 8A, 8B | F7, F8 | Share lifecycle and the host-only Merge; wall toast "Base moved", Sam's lane "Needs a rebase", his Claude's explanation |
| 9 | F9 | Ana's Ask for help, and George's three ways to answer |
| 10 | F10 | Report (paper): "Who built what" per builder, and the base branch's version history |
| ? | §6 | The six open decisions as cards, recommendation marked |

## Interaction decisions drawn here

- **Builders are named; the room stays anonymous.** Lanes, reviews and the report credit people; reactions and comments on the wall do not.
- **A builder key lives on the builder's phone** and can share and read feedback, never merge. Keys never appear on the wall.
- **Two builders on one task is a race, not an error.** It ends as a normal Choose ask with branches as options.
- **Peeks reach the room only when the host features them**; they land in the host's Incoming lane first.
- **Feedback is a direction.** The host gathers reactions into one editable sentence that goes to the builder's Claude.
- **Builder code is untrusted.** The host's Claude reads freely, runs nothing without the host's yes, skips install scripts, and reports instructions found in code as data.
- **Suggestions are numbered** so the room and the builder's Claude can answer "3: done in v3".
- **Merge is the host's button alone.** CI is read by the host's Claude and shown as a chip; Engage never talks to GitHub.
- **The base moving is announced to every builder's Claude**, which syncs on its own; a conflict shows as "Needs a rebase" with a plain-words reason.
- **Losing a race is still credited** in the report (Sam's empty state was merged on top of Priya's map).
