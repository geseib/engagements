# Agentic SDLC — call-and-answer set notes

Companion to `sets/agentic-sdlc-call-and-answer.csv`. Six rounds, ASK → VOTE →
RESULTS, no correct answer. Written against
`docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md` §A.

The design constraint that drove every question: a round is only worth playing
if two or three answers are *both* defensible and *incompatible*. If the room
converges in the first thirty seconds, the vote is a formality and the round
told us nothing (H1).

---

## Q1 — What did you hand over, and what did you take back?

**SDLC coverage:** the current boundary — where agent work actually sticks in
day-to-day practice. Warm-up round, answerable purely from last month.

**Expected divergence:**
- *Held:* boilerplate, migrations, test scaffolding, first-pass bug triage,
  work in an unfamiliar language.
- *Reclaimed:* anything requiring a mental model of the surrounding system —
  debugging across service boundaries, changes to code with no tests, anything
  where correcting the third attempt cost more than typing it.
- The real split is between people who report a stable boundary and people who
  report it moving every few weeks. Those two groups disagree about everything
  downstream, so it is useful to surface them in round one.

**Weakest link:** this is the least divergent question in the set. See the
honest assessment at the bottom.

---

## Q2 — If an agent can build it from the ticket, who writes the ticket?

**SDLC coverage:** planning, requirements, specification.

**Expected divergence:** three named positions in the detail, and they are
genuinely mutually exclusive.
1. Specs get *more* rigorous. Ambiguity used to surface as a question in
   standup; it now surfaces as confident wrong code, so precision moves
   upstream and the written spec becomes the artefact that matters.
2. Specs get *cheaper and disposable*. When three implementations cost an
   afternoon, arguing in a doc is the expensive path — you build all three and
   look.
3. The ticket stops existing. The branch is the proposal; the diff is the spec.

Position 1 and position 2 are the interesting fight: same premise, opposite
conclusion. The question asks which way the team is *drifting*, not which is
right, which makes it answerable by anyone who has watched their own backlog
rather than only by whoever owns the process.

---

## Q3 — The machine wrote it and the machine reviewed it. What are you reviewing?

**SDLC coverage:** code review.

**Expected divergence:** the second-agent reviewer genuinely does out-perform a
tired human on null derefs, missing awaits, and off-by-ones. So the human's
remaining job is contested:
- Interfaces and coupling — who else now depends on this shape.
- Blast radius — what happens if this is wrong, independent of whether it is.
- The tests, not the code — would the suite fail if the code were wrong.
- Whether the change should exist at all.
- The dissenting answer: nothing. Human diff review stops and moves to
  production behaviour.

The custom instruction forces the sharp half — *say what you would stop
reading*. Without that clause a third of the room answers "everything, but
faster", which is a non-answer that still collects votes.

---

## Q4 — The agent wrote the code and the tests. What are the tests worth?

**SDLC coverage:** testing and verification.

**Expected divergence:** everyone agrees on the problem (a test derived from an
implementation passes by construction and asserts nothing), which is deliberate
— the divergence is entirely in the fix, and each fix has a different bill:
- Human-authored expectations, agent-authored scaffolding. Costs throughput and
  puts the bottleneck back on people.
- Two agents, one from the spec and one from the implementation, neither seeing
  the other. Costs double the compute and needs a spec good enough to test
  against, which loops back to Q2.
- Mutation testing; a surviving mutant is a missing test. Costs CI time, a lot
  of it, and produces noise on legacy code.
- Treat the suite as regression-only and move verification into staged rollout
  and production signal. Costs you the ability to catch anything before users
  do, and hands the bill to Q5.

The question is designed so that the escalation from Q3 is real: Q3 asks what
you attend to, Q4 asks what you pay.

---

## Q5 — You get paged for a change no human read. What changes on Monday?

**SDLC coverage:** deploy and on-call. The consequence side of everything above.

**Expected divergence:** three positions that on-call engineers hold with some
heat:
- *Policy:* cap agent autonomy at a blast-radius line — data migrations, auth,
  anything with a customer-visible failure mode stays human-authored — and
  defend the line when throughput metrics come for it.
- *Tooling:* make rollback, isolation, and flagging so cheap that understanding
  the code at 2am is genuinely optional. The argument is that this was always
  the right answer and agents only made it urgent.
- *Reframe:* debugging is itself agent work now. The on-call human's job becomes
  judging hypotheses rather than forming them, and you should hire and train
  for that instead of pretending the old model survives.

"Answer from your own rotation" is doing load-bearing work for H4 — it makes
this a practitioner question rather than a policy question. Someone who has
never carried a pager can still answer, but the answers that will win votes are
from people who have.

---

## Q6 — What will you not hand over, and what does keeping it cost?

**SDLC coverage:** what humans are for. Asks for a commitment, not an
observation — the hardest question and deliberately last (H2).

**Expected divergence:**
- Interface and architecture decisions — the choices everything else hardens
  around. Cost: you are the bottleneck on every design, and you will be slower
  than the team that does not do this.
- Deciding what *not* to build. Cost: it looks like obstruction on a dashboard
  that counts merged PRs.
- Production access stays human. Cost: real, measurable, in minutes-to-recovery.
- Mentoring — the junior work that used to make people senior. Cost: pure
  present-tense throughput spent on a payoff five years out, and it is the
  answer most likely to be voted for and least likely to be funded.

The detail explicitly demands the price alongside the thing, because "I will
always own architecture" with no cost attached is a slogan, and slogans win
votes without generating discussion. Naming the cost is what makes two answers
comparable in the vote.

---

## Against the hypothesis

- **H1 (divergence):** Q2–Q6 each name competing positions in the detail
  paragraph without endorsing one. Q1 is the weak case — see below.
- **H2 (escalation):** Q1 is recall, Q2–Q3 are analysis, Q4–Q5 force a cost,
  Q6 forces a commitment with a price attached. Q6 is materially harder than
  Q1 to answer honestly.
- **H3 (no tool answers):** no question can be answered with a product name.
  The closest is Q4, where "mutation testing" is a technique rather than a
  vendor, and Q5's tooling position, which is about a property (cheap rollback)
  and not a purchase.
- **H4 (practitioner-answerable):** every question is framed at the level of
  the person doing the work — "your own rotation", "your team is drifting",
  "what you would stop reading". None requires authority to hold an opinion,
  though Q2 and Q6 will read differently to a tech lead than to a junior, which
  is fine and probably productive.
- **H5 (breadth):** handover baseline, planning, review, testing, deploy and
  on-call, and human role. Code generation is not its own round; it is the
  substrate of Q1. No two questions would attract the same answers — the
  closest pair is Q3/Q4 (both about verification), separated by attention vs.
  cost, and by the fact that Q4's disagreement is entirely in the remedy.
- **H12 (imports clean):** 6 questions, 6 categories, `skippedRowCount: 0`.
  Verified against the real handler; see the report accompanying this set.

## The weakest question, honestly: Q1

Q1 produces *variety* rather than *disagreement*. Ten people naming ten
different tasks spreads the vote, which technically satisfies H1's letter, but
the spread comes from different contexts rather than from an actual
disagreement about what is true. Nobody will be argued out of their answer,
and the RESULTS discussion risks being a list.

Two things partly mitigate it. The "what did you take back" clause introduces
real conflict — one person's reclaimed task is another's most reliable
handover, and that contradiction is visible on the results screen. And a
warm-up round has a second job: getting everyone to type something before the
questions get hard. But if a round has to be cut for time, cut this one, and if
the evaluation finds any round where the room converged or merely listed,
expect it to be this one.

Second-weakest is Q2, for a different reason: position 3 (the ticket stops
existing) is a genuinely held view but a minority one, so the vote may collapse
onto the 1-vs-2 axis. That is still a real split, so the round survives, but it
is narrower than the detail paragraph promises.
