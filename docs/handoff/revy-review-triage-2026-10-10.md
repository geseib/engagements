# Revy review — triage against the code (2026-10-10)

Source: the owner's reviewer ran room 6521 on **test at 324fd05d, plugin 1.14.0**
(`~/Downloads/Revy-experience-review.md`). Each finding was checked against the
branch head (dev 5411038e). Paths are under `src/src/buildroom/` unless named.

| # | Finding | State now | Where the fix goes |
|---|---|---|---|
| 1 | Ideas ask: header "3 of 3", body "0 answered" | **Still present.** Header counts responses (`askPill`, buildScreens.js:168; server `answerCount`, build-store.js:604); the body counts votes (`askPathSummaries`, buildScreens.js:901-905, `results.total` = votes for a suggest ask). | buildScreens.js:903-904: suggest asks count responses as "ideas", plus "· N voted" once voting starts. |
| 2 | "Claude is building" before Claude connects | **Still present.** Phone: hard-coded fallback BuildPlayer.jsx:1244. Host: `claudeBase` (buildScreens.js:270-303) says building on any log under 90 s before checking `agent.listening`; the chip tooltip is a separate rule (BuildRoomPage.jsx:1477-1481). | Phone uses `claudeState`/`agentConnected`; `claudeBase` checks listening first; tooltip derives from the same state key. |
| 3 | Setup not discoverable before a room exists; plugin version not shown | **Still present** on the marketing page (`marketing/BuildRoomPage.jsx:94`, one line). Connect window already says Node 18+. Server knows `plugin.running/latest` (build-store.js:853) but only "out of date" is shown. | A "Before you start" section (mockup first); show running/latest in the Connect window's install step. |
| 4 | Tooltip says "More" | **Fixed** in the copy pass b532cf01 (`chipNever`, words.js:270). Leftover: BuildOpening.jsx:203 "Back to the opening (in More)" — check the menu is still called More. | — |
| 5 | Report: "No ideas were sent" beside 6 suggestions | **Still present.** BuildReport.jsx:257/414-429 reads only the ideas inbox; ask suggestions live under Decisions. Same component makes the PDF. | Rename to "Unprompted ideas" / "No unprompted ideas were sent", as the reviewer suggests. |
| 6 | "Claude has wrapped up" after the host saved it | **Still present.** BuildRoomPage.jsx:1058-1060 always shows `W.wrappedUp`; `room.outcome.by` already says who. | Branch on `outcome.by`; host wording "Wrap-up saved. Check the report, then end the session." |
| 7 | Vote allowed 3 picks | **Not a bug**: the host can step to 1. The default is 3 with 4+ points (`defaultPicks`, buildScreens.js:1113). | Owner call: default to 1? |
| 8 | Pending invite only on the dashboard | **Still present.** `<PendingInvites />` only in WelcomeScreen.jsx:184; absent from the Access Pending page (App.jsx:160-175) and the Build Room. | Add it to Access Pending; a persistent notice on the Build Room host screen (mockup first). |
| 9 | Wi-Fi share stayed off; demo seen only as screenshots, then a localhost link on the host's Mac | **Gaps still present.** The offer exists (`shouldOfferWifi`, wifiShare.js:33-38) but shows only on the Stage, only once (Not now is final), and never when only screenshots exist. Players with sharing off see nothing (BuildPlayer.jsx:1130). The Build screen's "Open the build" uses the raw localhost link (BuildRoomPage.jsx:2080). | Owner's direction (2026-10-10): nudge when the first build is ready — "Let everyone try it. Share this demo with people on your Wi-Fi." — a clear **Share demo** button that says who can reach it; keep it opt-in; show whether people can actually open it; a fallback for anyone off the Wi-Fi. Mockup first. |
| — | Chrome extension "another panel open" | Tooling, not Engagements. No change. | — |

## Proposed order

1. Words and counts, no new UI: 1, 2, 5, 6 (and 4's leftover). One commit each, tests first.
2. Mockups for the new UI: 9 (Share demo), 3 (Before you start + version), 8 (invite notice). Owner picks, then build.
3. 7 is the owner's call.
