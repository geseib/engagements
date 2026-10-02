# Build Room prototype

`index.html` is a static storyboard (inline CSS, no script) for the feature specified in
`PLAN.md`. Serve it with `python3 -m http.server 8124 --directory docs/design` and open
`/build-room/`. Content: a room building a volunteer sign-up site for a food bank.

## Frames

1. **1A New Build Room**: title + goal, "review Claude's questions first" on by default.
   **1B The room**: Connect Claude Code panel (key shown once, copyable `curl … && claude mcp add engage …`),
   setup steps, four prompt cards (Kick off, Ask the room for ideas, Show A/B mockups, Wrap up), host ask buttons, empty timeline.
2. **Claude proposes**: terminal running `/engage:ab-mockups` and `mcp__engage__ask_room_to_choose`, beside the
   host's review card (edit question, context, options; Open to the room / Discard).
3. **Live Choose on the wall**: big A/B letters matching "Choice A/B" badges on localhost mockup thumbnails, live bars,
   14 of 18, join code + QR, "Claude Code connected · active 6s ago", timeline column.
4. **Phones**: pick A/B with optional why; Ideas suggest (up to 3, anonymous); approval vote "pick up to 3".
5. **Decide**: results + reasons, editable "Direction for Claude" prefilled with the winner, fold-in chips,
   "+ what the room said", Send to Claude toggle and button.
6. **Claude is building**: idle wall with latest decision, progress/showing ticker, host-only ideas inbox.
7. **Report** (paper theme): goal, What we built (summary, built, next steps, links), decisions with results and
   the host's direction, timeline, ideas, participants.
- **Present mode** table: which controls hide and why.

## Key interaction decisions

- **Letters are the shared handle.** Engage assigns A/B/C; Claude stamps the same letter on its mockups; the wall and
  phones use it. Renaming an option never changes its letter.
- **Review gate by default.** Claude's asks arrive as *proposed* (dashed amber) and the room never sees them unreviewed.
  `wait_for_room` keeps polling, so a slow review costs nothing.
- **The vote advises; the direction decides.** The direction is an editable sentence prefilled with the winner;
  suggestions and verbal input fold in as text. Send to Claude can be switched off to record without telling Claude.
- **The key is shown once** and only inside the command; minting again revokes the old key. Present mode hides it.
- **Ideas any time** from phones, triaged by the host (send, add to Ideas ask, dismiss) in a host-only inbox.
- **Between asks the wall shows Claude acting on the room's decision**, which is the payoff for voting.
- **Type**: host controls on the 12/13/15/19/24/30px ladder; the wall on a larger stage ladder; report on paper tokens.
