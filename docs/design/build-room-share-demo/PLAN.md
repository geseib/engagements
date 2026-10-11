# Build Room: Share demo

## Owner decisions, 2026-10-11 (these override 2026-10-10 where they differ)

1. **The nudge takes the orange.** While the Host screen nudge shows, its Share demo is the
   screen's one orange and What's next turns outline. An ask, the opening, the starter question,
   ticked points or a running list still hold the orange over it. Space never presses Share demo:
   sharing the laptop is always a click.
2. **The chip's own popover stays** (it reverses 2026-10-09's "controls only in Settings").
3. **Share demo only when there is a demo to run.** Claude must have shown an app running on the
   laptop (a local link, an option's link, the wrap-up's link). A screenshot alone is just a
   picture: no nudge, no chip, no Share demo on Build or in Settings, and phones get no
   "not shared" line, only the screenshots. One rule, `demoRunnable` in `wifiShare.js`, which
   matches `lanTargets` in `build-lan.js`. A remote link (planned, see
   `../build-room-lan-share/LATER.md`) will be a second way to be runnable.

## Owner decisions, 2026-10-10 (these override the mockup and the text below where they differ)

1. **The nudge appears in both places.** Option A, the Host screen's Now column (D1 A), AND
   option B, a popover hanging from the header Share demo chip on Build and History (D1 B). On
   the Stage it is one grey line in the HOST alert list, never an orange. "Not now" folds it into
   the chip; Share demo stays reachable from the chip, the Build screen and Settings (D3) without
   asking again.
2. **Wording.** "Demo" when shared on the Wi-Fi ("Share demo", "Open the demo", "Stop sharing");
   "build" for the host's own laptop link ("Open the build", "Only this laptop can open it.").
   So the header and Build screen keep "Open the build"; "Open on this laptop" is not used.
3. **No participant "Ask to try it" button.** So no `lan.asks`, and no count on the chip.
4. **Out of scope:** telling Claude to post its local link when only screenshots exist, and any
   per-device "didn't open" tag that needs a plugin change. No change to `engage-mcp.mjs`.
   Participant (c) is therefore shown on this device after it pressed Open the demo, not
   detected by the gateway.
5. **Opt-in.** Nothing shares without the host pressing Share demo.


Owner, 2026-10-10, after a reviewer's session: Wi-Fi sharing stayed off all session. The room saw
only screenshots, and the demo was opened in the end from a localhost link on the host's Mac.
Direction: nudge when the first build is ready ("Let everyone try it. Share this demo with people
on your Wi-Fi."), add a clear **Share demo** button, say who can reach it, keep it **opt-in**
(it exposes this laptop's server to the network), show whether people can actually open it, and
give anyone off that Wi-Fi a fallback.

Mockups: `index.html` in this folder (open with `#s1` … `#s9` for one frame alone). It builds on
`../build-room-lan-share/` (the gateway, shipped dev `57fece1e`) and `../build-room-host-alert/`
(the HOST · N list).

## What is wrong today (code, 2026-10-10)

| Where | Today | Problem |
|---|---|---|
| `wifiShare.js` `shouldOfferWifi` | Offers only if Claude posted a loopback link or an option url | Never offers when Claude has shown only screenshots |
| `BuildWifiShare.jsx` `WifiOffer` | One card on the Host screen's Now column; "Not now" sets `offerDismissed` | Missed if the host is on Stage or Build; after Not now nothing says where sharing lives (the chip reads "Wi-Fi · Off") |
| `BuildRoomPage.jsx` `BuildScreen` | `OpenLink` to `latestBuild(room).link` | Shows the raw localhost link with no word on who can open it |
| `BuildPlayer.jsx` ~1130 | Open the build only when `view.lan.open` | Sharing off: nothing at all, no reason, no fallback |

## Frames

| # | Frame | Size |
|---|---|---|
| D1 A | Nudge at the top of the Host screen's Now column | 1440 |
| D1 B | Nudge as a popover from the header **Share demo** chip, on Host, Build or History; on the Stage, one grey line in the HOST list (**recommended**) | 1440 |
| D2 | Sharing on: green chip "Shared · 11 opened", panel with count against the room, address and QR, Copy, Stop sharing, Show on the Stage | 1440 |
| D2 quiet | Live 2 min, nobody opened it: red chip, what to try, Stop sharing becomes primary; strip of all six chip states | 1440 |
| D3 | After Not now: chip stays as "Share demo" (with a grey count when people ask); Build screen carries "Only this laptop can open it.", Open on this laptop, Share demo | 1440 |
| D4 | Stage while shared and shown: big QR, three short lines, count | 1440 |
| D5 a/b/c | Phone (375): Open the demo; not shared (line, Ask to try it, screenshots); shared but out of reach (Didn't open?) | 375 |
| D5 laptop | Participant laptop, out of reach on a VPN | 1100 |
| D6 | Build screen while shared: Open the build uses the shared address; QR card with count | 1440 |
| Fit | Nudge and panel at 660 and 375: `width: min(420px, 100vw - 32px)`, `useKeepOnScreen` | 660, 375 |

One amber element per frame: Share demo (D1, D3), Show on the Stage (D2), Stop sharing (D2 quiet),
Hide the code (D4), Open the demo (D5a), Open the build (D6). D5b and D5c have none.

## A or B: where the nudge goes

- **A, the Now column.** Quiet, sits beside the work. But it is only seen on the Host screen; a
  host presenting from the Stage or Build (the reviewer's case) never sees it.
- **B, a popover from the header chip (recommended).** It appears on whichever host screen is
  open, and on the Stage as one grey line in the HOST list rather than a pop-up on the wall.
  Not now folds it back into the chip it came from, so the host learns where Share demo lives.
  It is the same element in both states, which is what makes "not final" obvious without asking
  again.

## Words

Reused from `words.js`: `wifiQuietHead`, `wifiQuietBody`, `wifiTest`, `wifiFailsForRoom`,
`wifiSameAdvice`, `sameWifiOnly`, `openBuild`.

New (exact strings):

| Key | String |
|---|---|
| `shareNudgeHead` | `Let everyone try it.` |
| `shareNudgeBody` | `Share this demo with people on your Wi-Fi.` |
| `shareWho` | `People on this Wi-Fi can open this laptop's app. No one else can.` |
| `shareDemo` | `Share demo` (button and the chip's off label) |
| `notNow` | `Not now` |
| `shareStarting` | `Starting…` |
| `shareOn` | `(n) => \`Shared · ${n} opened\`` |
| `shareQuiet` | `Shared · none opened yet` |
| `shareFailed` | `Didn't start` |
| `shareLiveHead` | `Demo shared on this Wi-Fi` |
| `shareOpenedOf` | `(n, here) => \`${n} opened it · ${here} here\`` |
| `shareNotAll` | `(n, here) => \`Not ${n} of ${here}? Some people may be on mobile data or a VPN. They still see screenshots.\`` |
| `stopSharing` | `Stop sharing` |
| `keepSharing` | `Keep sharing` |
| `showOnStage` | `Show on the Stage` |
| `openOnLaptop` | `Open on this laptop` (header and Build screen when not shared) |
| `onThisLaptopOnly` | `On this laptop only` (address bar) |
| `onlyThisLaptop` | `Only this laptop can open it.` |
| `anyoneOnWifi` | `Anyone on this Wi-Fi` (address bar while shared) |
| `demoReadyLine` | `The demo is ready to share` (HOST list, option B) |
| `stageDemoHead` | `Try the demo yourself` |
| `stageDemoScan` | `Scan the code, or press Open the demo.` |
| `stageSameWifi` | `Same Wi-Fi as this laptop.` |
| `stageOpened` | `(n) => \`${n} have opened it\`` |
| `hideCode` | `Hide the code` |
| `openDemo` | `Open the demo` |
| `demoNotShared` | `The demo runs on the host's laptop. Screenshots are below.` |
| `askToTry` / `askedToTry` | `Ask to try it` / `Asked. The host sees it.` |
| `demoDidntOpen` | `Didn't open?` |
| `demoMaybeOff` | `You may be on mobile data or another Wi-Fi.` (laptop: `You may be on a VPN or another Wi-Fi.`) |
| `tryAgain` | `Try again` |

Retire `wifiOffer` and `wifiSay` (replaced by `shareNudgeBody` / `shareWho`). No tooltips are
needed: every state says what it means in its own label.

## Data each state reads

From `lanHostView` (`lambda-functions/game/build-lan.js`) and `wifiState` (`wifiShare.js`):

| State | Reads |
|---|---|
| Offer | `shouldOfferDemo(room)`: a local link **or any agent screenshot** in `room.log` / asks; `!lan.wanted`; `!lan.offerDismissed` |
| After Not now | `lan.offerDismissed` (unchanged meaning: no more nudge; the chip and Build screen still offer it) |
| Room asking | **new** `lan.asks`: count of distinct players who pressed Ask to try it; cleared when sharing goes live |
| Starting, waiting, failed | `wifiState(lan, now)` as today; `lan.error` |
| Live | `lan.status === 'live'`, `lan.open`, `room.playerCount`, `wifiLink(room)` |
| Nobody can reach it | live, `open === 0`, `now - liveSince >= QUIET_AFTER_MS` (today's `quiet`) |
| Participant a | `view.lan.open` (today) |
| Participant b | **new** `view.lan = { state: 'off' }` when not live but Claude has shown something (today it is `null`, indistinguishable from "nothing yet") |
| Participant c | **new** `view.lan.reached`: the gateway saw this player's tag; false 20 s after the player pressed Open the demo |

## Code changes (short)

- `src/src/buildroom/wifiShare.js`: `shouldOfferDemo` counts screenshots too; chip labels move to
  the new words.
- `src/src/buildroom/BuildWifiShare.jsx`: `WifiChip` reads "Share demo" when off (with the
  `lan.asks` count); `DemoNudge` replaces `WifiOffer` as a popover from the chip (option B);
  `WifiPanel` gains the count against the room, Stop sharing, and Stop as primary when quiet;
  `WallBuildQr` takes the Stage words and count.
- `src/src/buildroom/BuildRoomPage.jsx`: mount the nudge in `HeaderTools` instead of the Now
  column; `LiveBuildButton` and `BuildScreen` say "Open on this laptop" / "On this laptop only"
  when not shared, and add Share demo to the Build screen; the HOST list (host-alert) gains
  "The demo is ready to share".
- `src/src/buildroom/BuildPlayer.jsx`: the (b) and (c) blocks above the screenshot; Ask to try it.
- `src/src/buildroom/words.js`: the strings above; `tests/build-room-copy.js` picks them up.
- `lambda-functions/game/build-lan.js`, `build-room.js`: `lanPublicView` returns `{ state: 'off' }`;
  `POST build/share { ask: true }` from a player (nameless, one per player); `asks` in
  `lanHostView`; the open link carries a per-player tag and the plugin's report lists the tags
  seen, giving `reached`.
- `src/public/engage-mcp.mjs`: report seen tags; when the host wants sharing and Claude has shown
  only screenshots, room_status asks Claude to post the app's local link. Bump `VERSION` and
  `tests/engage-plugin-version.js`.

## Open questions for the owner

1. "Demo" or "build"? These frames say "demo" for everything shared and keep "Open the build" for
   the host's own link. Rename `openBuild` everywhere instead?
2. Keep **Ask to try it**? It gives people off the share a voice, and it is the only thing that
   brings the chip forward after Not now. Or is that the nagging you ruled out?
3. Screenshots only, no link: Share demo would also tell Claude to post the app's local link.
   Agreed?
4. Participant (c) needs the per-player tag (a plugin bump). Without it, show a plain
   "Didn't open?" line under the button at all times.
