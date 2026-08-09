# Resume prompt

After `/clear`, paste the block below.

---

Read these three files before doing anything else, in this order:

1. `docs/handoff/anonymous-responses-2026-08-09.md` — current state, baselines, landmines, what is deliberately NOT pushed and why
2. `.superpowers/sdd/2026-08-09-anonymous-responses/progress.md` — the SDD ledger: per-task commits, review verdicts, deferred minors
3. `docs/superpowers/plans/2026-08-09-anonymous-responses.md` — the plan being executed

Then continue with `superpowers:subagent-driven-development`, executing that plan from **Task 6's review** onward. Tasks 1–5 are complete and review-clean; Task 6 is implemented (`f1d65470`) but has not passed its review gate. Tasks 7–11 are not started.

Resume the loop exactly as the ledger describes:

- Task 6 needs a review package generated over `8476e704..f1d65470` and a task reviewer dispatched, before Task 7 begins.
- Work on `dev` directly. Do **not** create a worktree — worktrees here branch from `main` and this project's convention is to work on `dev`.
- Do **not** push `dev` until Task 10 lands. The reason is in the handoff's "Do not deploy yet" section and it is not negotiable: Tasks 1–6 redact author names with the flag defaulting ON for every existing game, while the host UI gains no reveal control until Task 10.
- Do **not** deploy anything. `CLAUDE.md` reserves that to the owner.

Three hazards that already cost time this session — they are in the handoff but read them twice:

- **Every `check(...)` in `tests/anonymous-round-flow.js` and `tests/anonymity-contract.js` must be `await`ed.** `check` is async; a bare call exits before the assertion resolves and vanishes from the pass count with no failure signal.
- **`seedAnonymousRound` seeds no `CONNECTION#` rows.** Any test asserting on a broadcast must `put()` its own connection or the assertion passes vacuously against an empty `sent` array.
- **A test that cannot fail proves nothing.** Task 5's padding fix needed a *revealed* round to be outcome-determining; an anonymous round would have passed either way. Verify new tests fail before the fix.

Backend baseline to beat: **20 suites, 690 passed, 0 failed**. Aggregate with `grep -E '^[0-9]+ passed'`, never `tail -1`.

Two things are outstanding on the owner and are not yours to do: approving the staged prod deploy, and running the last two `engagetest` migrations in the documented order.

---

## If you want the UX work instead

Say so, and the resume prompt becomes:

> Read `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` (§8 has the implementation order, §7 has 18 testable negatives) and browse the approved mockups in `docs/design/host-redesign/` full-screen. Then use `superpowers:writing-plans` to write plan 2 — the stage shell: the fixed-height three-row grid, the four density ladders, and the `fit()` hook. Park the anonymous-responses plan where it is; tasks 1–5 are committed and reviewed, Task 6 is unreviewed, and the gate is inert until something calls it.
