# Handoff: the Call & Answer session flow, version 3 (2026-10-14)

Read this first, then `docs/tests_and_reviews/oct13-14 review/RECOMMENDATIONS.md` (the spec),
then open `engagements-proposed-ux-v3.html` in that folder (the design). Build from the
rendered mockup, not from prose alone.

## 1. Where things stand

| | Commit | What it carries |
|---|---|---|
| **dev** | `376e7ab0` | Everything below, including the no-votes fix |
| **test** | `0e1e764e` | Everything below except the no-votes fix (`376e7ab0`) |
| **prod** | not promoted | Halted at the owner's gate; do not start it for this work |
| branch | `working/build-room-host-redesign` | This worktree: `.claude/worktrees/affectionate-bouman-48e07a` |

Shipped and walked end to end on dev on 13-14 Oct:

- **Voting shows the responses** from the start (wall: "Vote on your phone, laptop or tablet"); Next response wraps; Auto cycles until everyone has voted.
- **Feedback round**: the wall shows the round's title and "Provide feedback on the round from your phone, laptop or tablet"; the featured comment appears on the wall; "Said in the room" notes on the laptop meter and the Remote (`POST /games/{id}/comments/host`).
- **Ask the room** (docs/design/followup-icons, PLAN.md): Ideas / Choose / Rate icons beside the points of Workie's read on the host's screens (two-screen mode only today), the preview dialog, the `ask` beat (ROOM_QUESTION / ROOM_RESULTS), the wall, the phone card, and both reports. Behind `FOLLOWUP_ASKS_ENABLED`: **on for dev and test, off for prod** (`buildspec-test.yml` since `d1f46ce9`).
- **A round nobody voted on** still shows its responses at 0 points (`376e7ab0`; dev only so far).

Memory notes: `engage2-ask-the-room.md`, `engage2-two-surface-handoff.md`, `engage2-site-skins.md`.

## 2. What the owner asked for (the decisions)

From the external review of session 7924 on test, and the owner's own changes (13-14 Oct).
`RECOMMENDATIONS.md` §4 designs each; the v3 mockup draws them.

1. **One "Ask the room" composer, two ways in.** A Workie icon opens it filled in and editable; "Ask the room" in the dock opens it blank (or with a suggestion picked). Same screen. The report records Workie's words against what was sent.
2. **The round's workflow on the host's screens at all times** (owner reversed v2): a slim strip, Setup › Round loop (Answer · Vote · What we heard · Ask) › Finish, the live step lit, "Your part now" naming the main button. The owner's revised spec makes the steps clickable **for looking only**: a private "Viewing …" view with "Back to the room"; every action stays in the one button bar. Never on the wall or participants' devices.
3. **Setup: "Where will the room watch?"** with the one-screen / two-screen drawings and "Help me pick" (three plain questions, one recommendation).
4. **Earlier rounds for everyone.** Participants (phone: one column; tablet/laptop: three) and the host's Rounds menu see the whole round: task, own response, every response in vote order, Workie's read, questions for the room and results, all feedback.
5. **Comments name their target** (the question, a response, Workie's read, another comment). The report prints "[Jake commented on Maria's response]: …" ("Response 3" where the round hid names).
6. **Late answers, ideas and comments are kept**, never dropped, labelled **"Reviewed with the room" / "Reviewed by the host" / "Not reviewed"**.
7. **Report settings**: "Include items not reviewed" (on by default; when off, the report says how many it left out) and "Names on feedback" (names by default; host can make feedback anonymous). A participant can tick **"Send anonymously"** on any comment.
8. Plus the trust fixes, the real task on the wall, and the report's full record of each question (RECOMMENDATIONS §1).

## 3. Before building: the owner must answer

- **Approve v3** before it goes back to the external reviewers (`engagements-proposed-ux-v3.pdf`, 18 pages). The sample content (round titles, options, ideas, times) is invented.
- **The 13 open questions** in RECOMMENDATIONS §7 (also the last section of the v3 page), each with a recommended answer. Phase 1 below needs none of them; ask before the phase that depends on one.
- **One conflict to confirm**: steps in the workflow strip are clickable (the owner's spec) but only for looking, not acting (the recommendation). The v3 mockup draws that compromise.

## 4. Build order (RECOMMENDATIONS §6)

1. **Trust fixes (S)** — own answer restored after a reload (`get-answers.js` getOwnAnswer); strip markdown in comment excerpts (`excerptOf`); the team's task on the wall in ANSWERING/VOTING and in the report.
2. **Orientation (M)** — workflow strip (laptop), dots (Remote), slim one-screen strip; setup chooser with Help me pick; live vs viewed state with the "Viewing" bar; "Start round N".
3. **One composer, both modes (M)** — `AskComposer` (blank and filled-in), step-rule changes (with the parity test), one-screen support, "Comments" as a fourth kind replacing Request feedback, the ask row's `Suggested` / `Edits` / `AnchorText` / `RoomSize`.
4. **The report's full record of each question (S).**
5. **Late items kept and labelled (M-L)** — `message.js` late row and server receipt, late ask answers, `Reviewed: 'room' | 'host' | null`, the host's late list, the report's "Arrived late".
6. **Earlier rounds and comment targets (L)** — public round-review read, relaxed comment gate, `Target`, "Send anonymously", the two report settings, the views on every device, the report lines.
7. **Look-ahead extras** and 8. **polish** (S each).

## 5. Small open bugs (found 14 Oct, not fixed)

- **One-screen laptop goes blank when a question is sent from the Remote**: `useRoundAsks` is only active under two surfaces (`GameHostPage.jsx`, `active: Boolean(twoSurfaces && …)`), so the ASKING stage has no data. Phase 3 (one-screen support) fixes it; it is a one-line fix if needed sooner.
- **The two-screen dock wraps** its Session button to a second row at about 1100px.
- **The wall numbers tied responses 1, 2, 3** when nobody voted (should show no ranks at 0 points).

## 6. How to work (the rules that bit this session)

- **Gates before any push**: `node tests/<file>.js` for every backend suite (judge by exit code and count; `tests/verify-question-set-ui.spec.js` is a Playwright spec that always fails as a plain script), `cd src && CI=true npx jest`, `npm run build`. Clear `.aws-sam` first. zsh does not word-split `$var` — use `"$@"` or arrays in loops.
- **Deploy**: a push to `dev` (or `test`) is the deploy; never tag and push together. **test is merged into, never fast-forwarded** (`git checkout -B promote-test origin/test && git merge origin/dev`). Prod only after test, and it halts at the owner's gate. Watch pipelines with `AWS_PROFILE=adminaccess`.
- **Two screens** are on by default only on dev; on test, add `?surfaces=two` once per browser. Ask the room icons need it.
- **Walk every change in the browser pane** on dev (laptop, Remote at 390px, `/present`, a phone), and measure dialogs at ~660px and 375px. Test players: join with `POST /games/{id}/players`, answer over the websocket (`ANSWER#n`), vote with `POST /games/{id}/votes` (votes are 1-based display positions).
- **A `/present` tab left open across a deploy** keeps the old bundle until reloaded.
- **Copy**: plain English; always "phone, laptop or tablet", never just "phone".
- Every round-step label lives in `config/roundWords.js`; the laptop and the Remote read the same `roundStep.js`, held equal by the parity tests.
