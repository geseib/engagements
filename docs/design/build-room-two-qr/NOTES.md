# Build Room: two codes in Settings

Owner, 2026-10-11: "I think the settings for build room should have two QR codes, large enough
for the room to see: the Join QR and the Demo QR link."

Mockups: `index.html` in this folder (`#s1` the projector view, `#s2` the Stage card, `#s3` the
Stage with the demo gone). Builds on `../build-room-share-demo/` and `../build-room-sidebar/`.
Design only; no product code changed.

## What is there today

| Where | Today |
|---|---|
| `src/src/buildroom/BuildSessionPanel.jsx:359-392` | The room group: the join code as a number (`brm-code`), its address and count, **Copy join link**, **Show the QR on the wall** (`onShowQr`), then the inline `SharePanel` when `demoRunnable(room)` (`:371`), then the room-meter switch. No code you can scan. |
| `src/src/buildroom/BuildWifiShare.jsx:70-79` | `Address`: the demo's QR at **72px** (`size={72}`; `BuildRoom.css:999`). |
| `src/src/buildroom/BuildWifiShare.jsx:87-186` | `SharePanel`; `inline` (Settings) drops the X, Not now and the orange (`:96`, `primary = ''`). |
| `src/src/buildroom/BuildWifiShare.jsx:245-264` | `WallBuildQr`: the Stage's demo-only card, code `min(60vh, 40vw)` (`BuildRoom.css:1021`). |
| `src/src/buildroom/BuildWifiShare.jsx:267-279` | `BuildScreenQr`: the Build screen card, 96px. |
| `src/src/buildroom/BuildRoomPage.jsx:2314-2326` | `QrZoom`, the "Join QR code" modal: `min(70vh, 80vw)` (`BuildRoom.css:381-383`). Opened from Settings (`:1242`, `:1260`) and the header join button (`:2083`). |
| `src/src/buildroom/BuildRoom.css:1439-1442` | The Session panel is `min(560px, 100vw)`; full width under 480px with 14px padding (`:1494-1498`). |

## The options

- **A. Both codes in Settings.** The room group leads with two tiles side by side: Join always;
  the demo when shared. Not shared, the demo's slot says what to do: **Share demo** when
  `demoRunnable`, **No demo yet** when there are only screenshots (no Share demo, per the
  2026-10-11 rule). Each tile: the code, a short address, one line. Big enough for the host to
  test with a phone and for the front rows when the laptop is on the projector (about 3 m). Not
  for the back of a room: the panel is 560px.
- **B. One move: both codes on the Stage.** Settings keeps today's rows and gains **Show both on
  the Stage**, which puts a two-code card on the Stage (Join left, demo right) on the Room ladder.
  Readable across the room (about 6 m), but Settings still has nothing to scan, which is what was
  asked.
- **C. Both (recommended).** A's two tiles, and the group's one orange button puts them on the
  Stage as B's card.

## Recommendation: C

The panel and the Stage do different jobs. The panel is where the host checks the codes work
(scan the demo from their own phone before telling the room); the Stage is where the room reads
them. A alone can't reach the back of a room; B alone doesn't put the codes in Settings. C also
retires the 72px demo code and the inline `SharePanel`: the demo tile does that panel's job in
every state (Share demo, Starting, live with the count, quiet, failed), from the same
`wifiState`, so it can't disagree with the header chip.

One orange button per state, the move that matters most:

| Demo tile | Orange |
|---|---|
| No demo yet | Show on the Stage |
| Not shared | Share demo |
| Starting / waiting | Show on the Stage |
| Live | Show both on the Stage |
| Quiet (live 2 min, nobody opened it) | Stop sharing |
| Failed | Try again |

Stage card: when the demo stops or fails, its half leaves the wall and the card is Join alone,
never an empty slot. Quiet does not change the Stage (the host may be testing right then; the
warning is the host's). The meter column steps aside while the card shows, so the join code
appears twice on the Stage (rail and card), not three times. Clicking either code enlarges it alone
(`QrZoom`) for a long room.

## Sizes

Both links are QR version 4 at level M (the app's setting): 33 modules, 41 with the quiet zone
(join 44 characters, demo with its key 60). The images in `img/` are real codes made with the
app's `qrcode.react`. A remote link of about 81 characters is version 5, 45 modules.

Projected: a 90-inch 16:10 image of a 1440px-wide screen, about 1.35 mm per CSS px. Range: a
phone reads a code from about ten times its width.

| Where | Code | Projected | Range |
|---|---|---|---|
| Settings, laptop width | 232px (two tiles in 516px) | ~31 cm | ~3 m, front rows; the host's own test |
| Stage card, two codes | 430px | ~58 cm | ~6 m |
| One code enlarged (`QrZoom`) | min(70vh, 80vw), 630px at 900 tall | ~85 cm | ~8 m |
| Settings on a 375px phone | 168px (tiles drop their frame) | n/a | phone to phone, 15 to 30 cm |
| **Floor, any width** | **160px** | | |

**Why 160px:** 160 / 41 modules is 3.9 CSS px a module, so at least 7.8 device px on a 2x laptop
and 11.7 on a 3x phone: every module renders crisp and a phone held next to it reads it. A remote
link (45 modules) is still 3.6. Below 330px of panel (2 x 160 + gap) the codes **stack** rather
than shrink; stacked, each is capped at 260px. Measured in the mockup: 231px at laptop and 660px
widths, 167px in the 375 frame, 260px stacked when the page itself is 375 wide; no sideways scroll
at 660 or 375; exactly one orange in each of the 13 frames.

## What code would change

- `src/src/buildroom/BuildSessionPanel.jsx` (`:359-392`): the room group renders a new
  `RoomCodes` (two tiles, then the multi-app list when `lan.map.length > 1`, then one Stage
  button) in place of the code row, the Copy / Show QR row and the inline `SharePanel`. Ended:
  Join tile only, no actions.
- `src/src/buildroom/BuildWifiShare.jsx`: new `DemoTile` (state from `wifiState`, gated on
  `demoRunnable`; reuses `CopyLink`, `shownAddress`, `wifiLink`); takes `{ link, reach }` so a
  remote link later only supplies a different reach line. New `WallCodes` (the Stage card, one or
  two columns, click a code to enlarge it). `SharePanel`'s `inline` mode and `WallBuildQr` can go
  if open question 3 is yes.
- `src/src/buildroom/BuildRoomPage.jsx`: one state for "codes on the Stage" replacing `qrOpen`
  (`:1242`, `:1260`) and the `onWifiWall` path; `QrZoom` (`:2314`) stays for the header join
  button and for enlarging one code. Hide the meter column while the card shows.
- `src/src/buildroom/BuildRoom.css`: `.brm-sp-codes` grid with `container-type: inline-size` on
  `.brm-sp-body`, the two container rules (drop the tile frame under 420px, stack under 330px), the
  tile and the dashed slot; `.brm-wallcodes` (430px codes, Room ladder `--brm-st-*`). Remove
  `.brm-sp .brm-wifipanel--inline` (`:1483-1485`) and `.brm-wifipanel-qr` if unused.
- `src/src/buildroom/words.js`: new `codesJoin` "Join", `codesAnyNetwork` "any network",
  `codesDemo` "Demo", `codesSameWifi` "same Wi-Fi only", `noDemoYet` "No demo yet",
  `noDemoBody` "When Claude runs the app, you can share it here.", `noDemoRoom` "The room sees
  Claude's screenshots.", `notShared` "Not shared", `demoSlotStarting` "The code appears here
  when the laptop is reachable.", `openedOfHere` `(n, here) => \`${n} of ${here} opened it\``,
  `noneOpened` "None opened yet", `showOnStage1` "Show on the Stage", `showBothOnStage` "Show
  both on the Stage", `hideCodes` "Hide the codes", `stageJoinEyebrow` "Join the room",
  `stageJoinHead` "Scan to join". Reused: `shareDemo`, `onlyThisLaptop`, `shareWho`,
  `shareNotAll`, `wifiQuietHead/Body`, `wifiTest`, `wifiFailsForRoom`, `stopSharing`,
  `keepSharing`, `tryAgain`, `stageDemoLive`, `stageDemoHead`, `stageSameWifi`, `stageOpened`,
  `hideCode`. "Show the QR on the wall" (a JSX literal today) is retired.
- Tests: `tests/build-room-copy.js` picks up the words; a CSS-text test (no geometry in jsdom)
  pins the 160px floor and the 330px stack rule in `BuildRoom.css`; the Session panel's existing
  tests move from `SharePanel inline` to `DemoTile`.

No change to the plugin, the gateway or `build-lan.js`.

## Open questions

1. **Show "No demo yet" at all?** It teaches where the demo will appear but adds a second thing
   before there is anything to share. Alternative: Join alone, wider, until `demoRunnable`.
2. **One orange in Settings.** The shipped inline Share demo has none on purpose, and the
   Session panel mockup kept Players free of it. These frames give the room group one. Agreed?
3. **One Stage card for codes.** Should the share chip's "Show on the Stage" also open the
   two-code card and retire the demo-only `WallBuildQr`? These frames assume yes.
4. **The header join button** keeps opening the single big Join QR. Or the two-code card while
   the demo is live?
5. **Quiet on the Stage.** Keep the demo code up while nobody has opened it (as drawn), or take it
   down after 2 minutes?
6. **Remote link, later.** With both a Wi-Fi and a remote link, show the remote one (it reaches
   everyone) and list the Wi-Fi one under it?
