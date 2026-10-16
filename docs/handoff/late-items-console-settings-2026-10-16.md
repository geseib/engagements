# Handoff, 16 Oct 2026: late items, console batch, Settings and Rate ends

Moved to a cloud session mid-work. The owner's instruction: **finish all of it, then push to test ONCE so the testers test everything together** (with RELEASE_NOTES.md, in-app help and README updated first — CLAUDE.md "Before every push to test").

## State
- Branch `working/build-room-host-redesign`. dev = `26af5fc8` (late items + console batch, walked). Not yet on dev: `b632392a` (Settings), `ae198fd6` (Rate ends), and the WIP commit after them (results fit, see below).
- test = `a87202cf` (host console + release notes; tag `reviewable/2026-10-16-a87202cf`).

## Remaining work, in order
1. **Finish the WIP results-fit commit** (agent was stopped mid-work; its last note: "Now measure all 3 profiles at both sizes, with 130 and 260 characters"). Requirements:
   - F1 MUST: the room's window results (present/PresentMoments.jsx PresentTally) must fit. Walk found 5 ideas of ~120 chars at 1280x720 d-room: `.present-main` content 992px in 571px, `--fit` stayed 1, top/bottom rows cut. Prefer: fitter shrinks to floor → clamp ideas to 2 lines → fewer rows ("and N more ideas"). Never cut the top row or the heading. Measure d-room/d-tv/d-table at 1280x720 and 1920x1080 with 6 ideas of 130 chars.
   - F2: arm words when the count is zero: "Nobody has voted yet. Press again to show results." / "Nobody has answered yet. Press again to start voting." (roundWords.js; parity tests).
   - F3: one-screen stage RESULTS page with 6 long ideas at Room/TV/Table must not overflow (stagePaging / useStageFit).
   - Run full gates; the WIP may not pass them yet.
2. **Settings fixes** (review of b632392a/ae198fd6): S1 IMPORTANT the remote box's email must only show when the room's window is up (`privateScreen: twoSurfaces && presenting > 0`), test switching to two screens from the projected panel; S2 ScreensGroup `useId()` instead of `id="scr-size"`; S3 fix stale comments (AskComposer pickEnds "Custom keeps the words" — code clears them; AskPreview.css "wrap to one column" — no media query); S5 `pickSignedInOrg` return null rather than `list[0]`; S7 hoist `kinds.endsOf(ask)` in followups.js phoneWire.
3. **Push to dev, walk on dev** (1366x768 and 1440x900; dialogs at ~660px and 375px): results fit on the wall at all three profiles, one-screen results, Settings groups and the screen switch from Setup, remote sign-in words, Rate ends (composer pair menus, Custom, phone/wall/report show them), the zero-count arm words.
4. **RELEASE_NOTES.md** new top entry covering everything since test a87202cf: late items (phase 5: late answers to a question for the room, comments after the round with Close comments, review labels, the host's late list, report "Arrived late", "Include items not reviewed", Redo includes late answers), results ideas-first, question on the wall, Scoreboard button, read marking, press-twice confirms replacing three light dialogs, Settings regroup + screen mode from Setup + who may sign in, Rate ends, the per-session id secret (privacy fix for Ideas ids). Help (host.js, player.js) and README updated to match. `tests/release-notes.js` checks the shape.
5. **Merge dev into test** (test is MERGED into, never fast-forwarded; use a scratch worktree), push, tag `reviewable/<date>-<sha8>` (never `test-v*`). Commit message ends "Ready for review".

## Rulings made on the owner's behalf (tell the owner)
- Ruling: Close comments rides POST /late/review {kind:'comments',how:'close'} — no third route (stack near resource limit) — cost if wrong: one route later
- Ruling: a late round answer has no wall view today, so no 'Show on the wall' for it — cost if wrong: host can only Mark reviewed
- Ruling: T1 a held follow-up card renders ABOVE the new round's content, never instead of it — cost if wrong: layout only
- Ruling: Close comments may be pressed only once the session has ENDED (Q4: 'end it sooner' than 24 h) — cost if wrong: host cannot close mid-session
- Ruling: ROUND rows from before ResultsShownAt refuse late comments on rounds shown pre-deploy — sessions spanning the deploy only — cost if wrong: a few refused late comments on dev/test
- Ruling: ref/idea ids become HMAC(sha256) keyed by a per-session random secret stored on METADATA (IdSecret, created if_not_exists, never sent to a client) — no new infra/SSM; fixes the existing Ideas id leak too — cost if wrong: Picked entries from live sessions at deploy time stop matching
- Ruling: T4 'Show on the wall' only for items whose round is the round on the wall (results/feedback beat); earlier-round wall views wait for Phase 6 (earlier rounds) — cost if wrong: host can only Mark reviewed for older items until Phase 6
- Ruling: IncludeNotReviewed rides POST /late/review {kind:'report', how:'include'|'leave-out'} (no new route) — cost if wrong: one route later
- Ruling: share bar stays in hid-names rounds — no numbers, and the order already shows rank — cost if wrong: hide the bar when names hidden
- Ruling: one scoreboard close control on the console: the People button stays, the "Take it down" card goes (owner simplicity-first) — cost if wrong: re-add the card
- Ruling: "Proceed to voting?" modal becomes the in-place second press (roundStep arm, like Start round N mid-read) on every surface that shows it — cost if wrong: hosts used to the dialog see a changed confirm
- Ruling: remote sign-in words keep the owner's 'any host or admin of <Team>' (server: any team member whose account is an approved host/admin); email shown only on two screens (projected one screen shows the name) — cost if wrong: wording tweak

## Deferred minors (not blocking test)
- Task 1: minor (deferred): sessions ended before EndedAt existed fall back to UpdatedAt
- Task 2: minor (deferred): survey comments get no after-end window (surveys out of scope)
- Task 3: minor (deferred): GET /late reads whole QUESTION# prefix per refetch; freezeTally does an extra METADATA write per close
- Task 4: minor (deferred): server stamps 'shown' even if the wall moved on mid-request; rail buttons not disabled in flight
- Task 5: minor (deferred): staff model-picker Redo does not send redo; §4.5 scope line naming both report settings not built

## Tooling
- `docs/handoff/tools/dev-bot.js`: dev test players. `node dev-bot.js join <game> <name>`, `answer <game> <name> <round> <text>`, `vote <game> <name> <round> 0,1,2`, `comment <game> <name> <round> <text>`, `ask <game> <name> <round> '<askId>|<value>'`. Ask ids: GET <dev-api>/games/<id>/followup-play/live?playerName=..&clientId=bot-<name>-cid.
- AWS SSO for the owner's profile had expired; poll the dev bundle (main.*.js) for a new string instead of the pipeline.
