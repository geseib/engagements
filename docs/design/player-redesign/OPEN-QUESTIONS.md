# Open questions for the owner

Ten, in the order they would change the design. Each says what I assumed, so the design is
usable while they are unanswered.

---

**1. Is there such a thing as a participant with no shared screen?**
Every WATCH state in this deck ends with a look-up cue — *"the full cloud is on the main
screen"* — and for a remote or hybrid participant that sentence points at nothing. There is no
signal anywhere in the payload for "this person cannot see the stage", and no way to infer one.
*Assumed:* everyone can see a shared screen; the cue degrades to a harmless sentence.
*If not:* the WATCH states need a compact room-summary variant, which is a real amount of new
design and would partly undo §2.2. This is the single biggest unknown in the document.

**2. Should a player be able to rank their own response?**
Nothing excludes it today, and `requiredRanks = Math.min(3, answers.length)` counts your own —
so in a room of three you *must* rank yourself to submit. The design marks your row and leaves
it rankable, because changing it changes the game.
*If self-voting should be blocked:* the required-ranks arithmetic has to drop to
`min(3, answers.length - 1)` or the submit becomes unreachable in small rooms.

**3. Does a poll have a score?**
Poll and survey currently fall into the call-and-answer results branch, so a poll shows
"+0 points" and a competitive ranking for a format that `config/gameTypes.js` describes as
"no right answer, distribution is the result". `10-ask-poll` and the results states assume a
poll *is* still scored by votes, because that is what the code does.
*If a poll should not be scored:* its RESULTS screen loses three of its four rows and needs a
different personal payoff — probably "where your response sat relative to the room", which is a
new design.

**4. Should the player see a countdown when the host arms one?**
§2.4 says yes, in ACT only, at label size, never disabling the submit. It is the one place I
have designed ahead of the host spec's own feature rather than behind it, and it is easy to cut.

**5. What is the retention promise on a name?**
The join screen says a name is used "for the scoreboard and to get you back in", and a name is
written to `localStorage` per game. Nothing says how long it is kept, and `CLAUDE.md` records a
90-day/7-day TTL on the table. If there is a stated retention period, the join screen is the
right place for it and I have not written it because I would be inventing it.

**6. Can a player leave, or change their name?**
There is no exit from the player screen and no way to correct a typo in a name that is about to
appear on a projector for an hour. The design does not add one, because "leave" has no server
semantics today (is the player removed? do their answers vanish?).

**7. Should participants be able to get a session summary?**
The current "Download Report" button hits `admin/reports/{gameId}` and usually 404s; `20-ended`
cuts it and says the host will share a link if they publish one. If participants *should* get
something, it needs a participant-scoped endpoint, not the admin one.

**8. What does the room actually do between rounds?**
`19-between-rounds` assumes the discussion is the point and makes the phone as boring as
possible. If hosts in practice use that gap for something the phone should support — submitting
a follow-up, reacting, queueing a question — that is a state I have designed *against* rather
than for.

**9. Is `Response N` the right noun for every format?**
`config/anonymity.js` fixes it at `Response N` and the host reads it aloud, so the design does
not vary it. But an artwork round's ballot rows are titles, and a poll's are positions.
"Title 4" would read better on `09-ask-artwork`'s ballot — and it would break the one thing the
host says out loud, so I did not do it. Worth a decision rather than an accident.

**10. How much of this is a shared component library with the host?**
The bar, the phase colours, the flags, the rank buttons and the anonymity copy now exist twice
in two design systems with the same tokens and slightly different rules (§10.2). Two of the
divergences are deliberate and defended; the rest will drift. If there is appetite, the copy
strings in particular — the anonymity sentence and its qualifier — should live in
`config/anonymity.js` next to `displayLabelFor`, so the room and the phone cannot come to say
different things about the same guarantee.
