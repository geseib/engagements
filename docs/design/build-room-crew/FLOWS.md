# Build Room: Crew mode

*2026-10-02. The storyboard is `index.html` in this folder. Built the same day, with the
decisions in §6 and the update after them: code in `lambda-functions/game/build-crew.js`,
`src/src/buildroom/BuildCrew.jsx` and `BuildPlayerCrew.jsx`, and Claude's crew tools in
`src/public/engage-mcp.mjs`. The local walk-through is `scripts/build-room-demo/crew-e2e.js`.
Where the flows below say fork, read "a branch on the shared repo" (see the update).*

## 1. The shift

Today a Build Room is **one Claude, one room**. The host's Claude Code builds, and the room
steers by voting and talking.

Crew mode adds **builders**: people in the room who bring a laptop with their own Claude Code.
The host still owns the project. Builders work on branches of it, show their work early, and
offer it back. The room still watches, comments and decides. Engage is the shared space where
all of this is visible: who is building what, what they have shown, what Claude thinks of it,
and what was merged.

The principle: **Engage carries the conversation and the evidence. Git carries the code.**
Engage never needs a GitHub token or anyone's source. The code moves through each person's own
git, by their own Claude Code, using their own credentials. Engage holds pointers (repo,
branch, commit), summaries, screenshots, comments and decisions.

## 2. Who is who

| Role | Device | What they do |
|---|---|---|
| **Host** | laptop on the projector (+ phone) | owns the repo and the base branch, runs the board, decides what gets merged |
| **Host's Claude** | host's terminal | builds the core, **reviews** what builders share, merges, tells the crew when the base moves |
| **Builder** | own laptop + phone | claims a task, builds it with their own Claude, shares it early, offers it back |
| **Builder's Claude** | builder's terminal | forks or branches, builds, takes screenshots, shares, applies feedback, opens the PR |
| **Room** | phones | reacts and comments on shares, votes on tasks and merges, sends ideas |

A builder is still a player: they join with the code like everyone else, then connect their
laptop. They are named on the board (their work is theirs), and anonymous only when they vote
as part of the room.

## 3. The flows

### F1. The host opens the project to a crew
The host's Claude runs `share_repo`. It sends the remote URL, the **base branch** (for example
`build-room/4821`, cut from main so the session never touches main directly) and the current
commit. The host picks how builders get the code:

- **Fork and pull request** (public repos, or builders with read access): each builder forks.
  The usual GitHub flow.
- **Branches on the host repo** (builders are collaborators): each pushes `crew/<name>/<task>`.
  The quickest in a workshop where the host can add people.
- **Patches through Engage** (no GitHub accounts, private repo, conference Wi-Fi): the builder's
  Claude packs a patch (`git format-patch`, a size cap), and Engage carries it to the host's
  Claude. **Nobody needs repo access**, only the starting code (a zip, or a public mirror).

The wall shows **Join as a builder**, with the repo, the branch and the one line to type.

### F2. A builder joins
1. They join on their phone as usual and tap **I have Claude Code**.
2. The phone shows a **builder key** (their own, separate from the host's), and on the laptop
   they type `/engage:join <key>`.
3. Their Claude reads the room: the goal, the base branch and the open tasks. It forks or
   clones, makes a branch, installs and runs the project, and posts "Priya's laptop is ready"
   to the board.

The Stop hook already commits every turn, on **their** branch, locally.

### F3. Tasks: the room decides what to build, builders claim
The host's Claude proposes tasks from the decisions so far, for example:

- Parking map
- Confirmation text
- Shift reminders by SMS
- Dark mode

The room ranks them with an Ideas vote. Each task becomes a card on the **crew board**.
Builders claim one from their phone or from Claude (`claim_task`). Claiming sends the task to
their Claude as a direction. One task can have two builders on purpose, which is a race worth
watching (see F6).

### F4. Show it early (before any PR): the heart of this
The builder (or their Claude, when it reaches something worth showing) shares a **early look** with
`share_work`. An early look holds:

- a one-line title;
- "what I changed" in plain words, written by their Claude;
- **screenshots** (this is how the room sees work running on someone else's laptop);
- **the change in numbers**: files touched, lines added and removed, the commit;
- an honest **"what I'm unsure about"** (their Claude is told to always say this);
- optionally, "**I'd like feedback on…**".

The early look appears in the host's **Incoming** lane, and on the wall when the host features it.
Phones can react to it:

- **Looks right**;
- **Question** or **Concern**, each with a comment.

The host gathers the reactions into **feedback** with one click, editable as always. The
feedback goes to that builder's Claude as a direction. The builder iterates, and the next early look
shows as **v2**, with "what changed since v1".

### F5. The host's Claude reviews a share
On any share or PR, the host presses **Ask Claude to review**. The host's Claude:

1. fetches the builder's branch, fork or patch;
2. reads the diff;
3. checks it against the base: does it conflict? does it duplicate other work?
4. runs the tests, but only with the host's OK, because this is someone else's code;
5. if the host agrees, runs it and screenshots it.

It then posts a **review card** with:

- **What it does**, in two sentences;
- **How it fits**: conflicts, overlaps with Sam's branch, touches the shared header;
- **Risk**: what could break, and whether there are tests;
- **Suggestions**, numbered so people can refer to them;
- **Recommendation**: merge, merge after changes, or not yet.

The room comments on the review card. The builder sees it all, and their Claude can answer the
questions directly ("Suggestion 2: done in v3").

The host's Claude treats builders' code as **untrusted**. Instructions inside code or comments
are data, never orders. Nothing executes without the host saying so.

### F6. Two approaches to one task
When two builders took the same task, the host makes a **Choose** ask from their latest early looks:

- **A** is Priya's branch, **B** is Sam's;
- each option carries its screenshots and its review card;
- the room picks, and the host decides as always ("A, but take Sam's empty state").

The host's Claude merges A, and may cherry-pick a piece of B. Sam's work is credited in the
report either way.

### F7. The PR lifecycle, visible to everyone
Every share moves along one lane, shown on the wall as a pipeline:

`Building → Early look → Reviewed → PR open → Room says → Merged` (or `Not now`)

- The builder's Claude opens the PR with `gh` (fork mode), or simply offers the branch or patch
  (the other modes). It sends the URL to Engage with `share_pr`.
- PR checks (CI) are read by the host's Claude, not by Engage. They show as a chip.
- **Merging** is the host's alone. The host's Claude merges locally (or with `gh pr merge`),
  pushes the base branch, and posts the new commit.

### F8. The base moved
After every merge, Engage tells every builder's Claude: "The base branch moved to `abc123`:
Priya's parking map. Pull it in." Their Claude merges or rebases and re-runs the project. If
that conflicts, their card shows **Needs a rebase** and their Claude explains which files.
Nobody has to say "everyone pull now" out loud, though the wall can.

### F9. Stuck, or a hand
A builder taps **Ask for help**. The host can:

- answer by voice and log it;
- send the host's Claude to look (it fetches the branch, reads it and posts suggestions);
- ask another builder to pair.

That asking costs nothing: help on the board is visible, not a private DM.

### F10. Bringing it home
Near the end, the host's Claude **integrates**:

1. merges what the room chose, in order;
2. resolves conflicts, saying what it decided;
3. runs everything;
4. shares one **final** screenshot set and wraps up.

The report credits each builder with what they shared, what was merged, and the room's
reactions.

## 4. The surfaces

- **The wall's crew board**: one lane per builder, showing:
  - name, task and branch;
  - status (Building, Early look, In review, PR, Merged, Needs a rebase);
  - their latest screenshot;
  - when they last checkpointed, so you can see who is moving.

  Above the lanes, the **pipeline** strip; beside them, **Incoming** (host only).
- **A share card** (wall and phone): screenshots, plain-words summary, change numbers, "unsure
  about", reactions, comments, the review card under it, and **version tabs v1 / v2 / v3**.
- **Builder's phone**: their own lane, feedback waiting for them, Ask for help, and the same
  reactions as everyone else on others' work.
- **Room's phone**: what is being shown now, reactions and comments, votes.
- **Report**: a "Who built what" section with each builder's shares, reviews, PRs and merged
  commits, and the room's reactions.

## 5. What Engage stores, roughly

These are new row kinds in the same session partition, all sealed like the rest:

- `CREW#BUILDER#<id>`: player name, mode (fork / branch / patch), fork or branch, last commit,
  status, key hash.
- `CREW#TASK#<id>`: text, source (decision or idea), claimed by, state.
- `CREW#SHARE#<id>#v<n>`: title, summary, unsure-about, diffstat, commit, screenshot ids,
  patch (patch mode, capped), PR URL, lane state.
- `CREW#REVIEW#<shareId>#<n>`: the host's Claude's review card.
- `CREW#REACT#…` and `CREW#COMMENT#…`: reactions and comments on a share or a review.
- `CREW#BASE`: the base branch and its current commit.

New MCP tools for **builders**: `join_build`, `claim_task`, `share_work`, `share_pr`,
`check_feedback`, `ask_for_help`, `sync_base`.

New MCP tools for **the host**: `share_repo`, `propose_tasks`, `review_share`, `merge_share`,
`announce_base`.

## 6. Decisions (the owner, 2026-10-02)

1. **Access modes in v1:** fork and pull request, plus patches through Engage for people
   without repo access. Branches-on-host can come later.
2. **GitHub:** each person's own Claude Code does the GitHub work (`gh`). Engage holds no
   GitHub token and has no GitHub App.
3. **Merging:** the host only.
4. **Running a builder's work:** each builder runs their own branch on their own laptop, and
   their Claude's screenshots carry it to the room. The host's Claude runs a builder's code
   only to review it (tests) or to merge, under the switch in 6.
5. **"Peek" is renamed "early look"** ("Share an early look"): work in progress shown before
   any PR. The room sees an early look when the host puts it on the wall, so the host curates.
6. **Running crew code:** a visible switch, **Run crew code: On / Off**, on the host's screen
   and on the review card. No prompt every time. The host's Claude reads the switch before it
   runs anything, and says which way it was set in every review.
7. **Crew size:** 8 builders or fewer. Multiple hosts and sessions come later.

### Update (the owner, 2026-10-02, later the same day)

- **Assume the whole team has access to the same repo.** Builders clone the host's repo,
  work on their own branch `crew/<name>/<task>`, push it to that repo, and open a pull
  request there. There are no forks or patches in the normal flow. Patch mode stays in the
  code but is off by default and is not offered on the setup screen. Forks still work if
  someone uses one.
- **Two ways to take part.** Builders link their own Claude Code so they can code and test
  along the way. Everyone else takes part on their phone (answering, reacting to early
  looks and following along) and needs no setup at all.
