# Build Room remote share: the demo for people who are not in the room

Date: 2026-10-16. Status: written for the owner's review, not yet built.
Design: `docs/design/build-room-remote-share/index.html` (R1 to R4, revised the same day
after the owner's answers). Read the mockup first; this document says what the mockup
cannot. It extends the Share demo (`docs/design/build-room-share-demo/`) and the Wi-Fi
share (`docs/design/build-room-lan-share/PLAN.md`) and changes neither when remote is off.

## 1. Why

Today, Open the demo works only for people on the host's Wi-Fi. Anyone who joined from a
link (on Zoom, at home, on mobile data) gets screenshots. Remote share lets them open the
running build too, through the same button, without the host doing anything but turning
one switch.

This is a **trial**: the owner wants to feel whether the experience is worth it before
paying for anything more durable (owner, 16 Oct: "let's do quick tunnel just to get a feel
of the experience is worth it").

**Success:** with remote on, a person who joined from home presses Open the demo and the
host's running build opens, with nothing to set up on their side; nobody who is not in
the session can open it, even with an address in hand; and the host can see who opened it.

## 2. What the owner decided (16 Oct)

| Question | Decision |
|---|---|
| How remote people get in | From a link, like everyone else; **Open the demo** on their participant screen, as on Wi-Fi. |
| Where the host turns it on | One extra switch inside the existing **Share demo** panel. **Off by default** every session. |
| What it exposes | **Exactly what the Wi-Fi share exposes**, nothing more. |
| What the build is | Always a web page, even a document. Claude is told so at the start. |
| Which route a device takes | While remote is live, **everyone's** button goes the remote way, people in the room too. Guessing from public addresses was rejected: wrong on company networks. |
| Keys | **One key per person**, not one per room. It may be used on more than one device: **allow it and show it** ("Sam · 2 devices"). It **moves with the person** when they move devices. |
| Tunnel | Cloudflare's **free quick tunnel**, for the trial. Cloudflare sees the traffic. |
| Installing `cloudflared` | **The plugin downloads it itself** on first use. |

## 3. What people see

The mockup is the reference. In short:

- **Host, R1.** Under the Wi-Fi address in the Share demo panel: a switch, "Also open it to
  people who are not here". Its small print says that everyone, the room too, then goes
  through Cloudflare, and that each person's button carries their own key. It never says
  "tunnel".
- **Host, R2.** Remote live: one count ("14 opened it · 22 joined"), and under it **who
  opened it, by name, with devices**. More than one device on a person is marked, with
  **Remove** beside it, which is the existing remove-player (it ends the person's key with
  them). Long lists collapse to "and N more". There is no here/remote split.
- **Host, R3.** Starting ("the first time, this laptop downloads Cloudflare's tunnel
  tool"), and failed, in plain words. **The Wi-Fi share keeps working whatever happens to
  remote.**
- **Participant, R4.** (a) remote live: the same Open the demo button, no "Same Wi-Fi
  only" line. (b) remote off: exactly today. (c) remote starting: today's Wi-Fi button,
  plus "Not here? Opening soon." (d) after pressing it with remote on, "Didn't open?" says
  the host may have stopped sharing or the app is restarting, never the Wi-Fi advice.

The Stage's QR code (Show on the Stage) stays the Wi-Fi room link. It is for people in the
room; remote people never need it.

## 4. How it works

```
 phone/laptop anywhere                                   host's laptop
 ─────────────────────                                   ─────────────────────────────────────
 Open the demo ──https──▶ random.trycloudflare.com ──▶ cloudflared ──▶ remote gateway 127.0.0.1:49xx
   (link carries ?k=<this person's key>)                              │ checks the person's key
                                                                      ▼
                                                        the app Claude showed (localhost:5173)
```

### 4.1 The plugin (`src/public/engage-mcp.mjs`)

Everything the Wi-Fi share does stays. Remote adds, beside it:

1. **One remote gateway per session** (owner, 16 Oct, after the spike), listening on
   **127.0.0.1 only**. It forwards to **the newest address Claude showed**, the one Open the
   demo opens (the last of `lanTargets`). When Claude shows a new one, the gateway switches
   where it forwards; the tunnel stays as it is. A remote person with an older version open
   gets the new one on reload. It reuses the Wi-Fi gateway's proxy (`openGateway`:
   Host/Origin rewriting, websocket upgrades, redirect rewriting, the locked page) with a
   different key check, and the same folder check (F4): remote reaches a subset of what the
   Wi-Fi share would. It does not depend on a Wi-Fi address, so a laptop on a wired network
   can share remotely.
2. **One `cloudflared` per session**:
   `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>`, a child process of
   the plugin. Its public address (`https://<random>.trycloudflare.com`) is read from its
   stderr (`SPIKE.md`). **It is opened when remote turns on and closed when it turns off or
   the session ends, and never reopened in between without need:** Cloudflare limits how
   fast quick tunnels are created (the spike met a 429 after 13 in ~85 s on a shared
   network). A pid file in `~/.engage/` lets the next plugin start kill one left behind by a
   crash.
   **Ready means reachable.** The printed address is not usable for another 7 to 12 s, and a
   phone that asks too early can remember "no such name". So the plugin reports remote as
   live only once Cloudflare's public DNS (DNS over https) has the name and one request
   through the tunnel answers. It never asks the laptop's own resolver first. About 15 to
   20 s from switch-on to live.
   **A 429** is its own failure, in plain words ("Cloudflare is not giving out new remote
   links from this network right now. Try again in a few minutes."), retried no faster than
   once a minute.
3. **The key check is per person.** Engage sends the plugin, on every round, the
   **SHA-256 hashes** of the live keys with the person each belongs to. Only hashes ever
   reach the laptop. A request with `?k=` whose hash is in the set gets a cookie and a
   redirect, exactly as on Wi-Fi. A device cookie (random, set at the same moment) lets the
   gateway count **devices per person**: everything arrives from `cloudflared` at
   127.0.0.1, so the socket address the Wi-Fi count uses means nothing here.
4. **A key minted moments ago** may not be in the set yet (rounds are 4 seconds apart).
   On an unknown `?k=` the gateway asks Engage once, straight away. To keep that from
   becoming a way to hammer Engage: at most one such check per second, and a wrong key is
   remembered as wrong for the rest of the session.
5. **Dev-server paths a remote request never gets:** `/@fs/`, `/@id/` and `*.map`. (The
   first threat-model draft spoke of the gateway's "method allowlist"; there is none. The
   Wi-Fi gateway passes every method, and the remote one does the same: the app decides.)
6. **The round's report grows** by: `remote: { status, address, target, error,
   devices: { <player>: <count> } }` (`address` the tunnel's origin, `target` the local
   address it forwards to now). The answer grows by `remoteWanted` and `remoteKeys`, **only while remote is wanted**: absent means not wanted, so the answer is byte-for-byte today's when remote is off.
7. **Fail closed, as on Wi-Fi:** no answer from Engage for 30 seconds, the switch off, or
   the session ended closes the remote gateway and kills `cloudflared`.

### 4.2 Getting `cloudflared`

The first time remote is switched on, if `~/.engage/bin/cloudflared-<version>` is not
there, the plugin:

- downloads **one pinned version** for this platform (macOS arm64/x64, Linux x64/arm64,
  Windows x64) from Cloudflare's GitHub releases;
- checks its **SHA-256 against a value written into the plugin**, and refuses to run
  anything that does not match;
- unpacks it (macOS ships a `.tgz`) and makes it executable.

No admin rights, no Homebrew. The panel shows "Starting…" during the download. If it
fails, R3's failure line, with the reason. Updating the pinned version is a plugin
release.

### 4.3 Engage's backend (`lambda-functions/game/build-lan.js`, `build-room.js`)

- **The switch** is a field on the existing `BUILD#LAN` row: `RemoteWanted`, plus the
  plugin's remote report beside the Wi-Fi one. The host's route that turns the Wi-Fi share
  on and off (`POST …/share`, `hostShare`) takes `remote: true|false` too. Turning sharing off turns both off.
- **Keys** live one per person, on a new row `BUILD#RKEY#<player>`: the key's hash, the
  `ClientId` it was minted for, and when. Only the hash is stored.
- **A phone gets its key** from a new phone route, `POST /build-play/remote-key`, checked
  like every phone route (`{playerName, clientId}` against the `PLAYER#` row). Every call
  mints a fresh key and replaces the person's row, which ends their previous key (the
  server holds hashes only, so it cannot hand an old key back). The phone keeps its link
  and calls the route only **when its screen first shows the remote button** without a
  saved link, not when it is pressed, so the button stays a plain link (browsers block a
  new tab opened after a wait).
- **Which keys are live:** a key counts only while its person's `PLAYER#` row exists, is
  not removed, and has the same `ClientId` the key was minted for. So:
  - **removing a person** ends their key;
  - **moving devices** through the existing handover (the host unlocks the name, the new
    device claims it, `join-game.js` `classifyRejoin`) changes `ClientId`, which ends the
    old key; the new device mints a fresh one the first time its button shows.
  - A person who pastes their own link into a second device is **allowed**: it is one key,
    and the host sees two devices on it.
- **The views.** The public view (`lanPublicView`) never carries a remote link or key.
  It carries only `remote: 'live' | 'starting' | 'off'`; the phone asks for its own link
  with the route above. When remote is live, the Wi-Fi link is left out of the public view
  for everyone (everyone takes the remote route); while remote is starting or has failed,
  it is kept. The host view gains the remote status and error, and the per-person device
  counts with names.

### 4.4 The participant screen (`src/src/buildroom/BuildPlayer.jsx`, `OpenDemo`)

`OpenDemo` gains the remote case: when the view says `remote: 'live'` it fetches the
person's link once (and again if a handover gives this device a new identity) and shows
the button. The words are in `words.js`; the Wi-Fi words do not change.

### 4.5 What Claude is told

At the start of a Build Room session, in both standing instruction blocks: the build is always
a web page, even a document, served from the project folder on one local address. (This was
assumed to be there already; it was not, and was added in Task 6, 17 Oct.) And in
room_status while the host wants remote (`SHARING REMOTELY`, beside `SHARING ON WI-FI`):

- **Share a built copy, not the development server**, where the project has one
  (`vite build` then `vite preview`, or the equivalent). A dev server loads a page as a
  hundred or more separate files; through a quick tunnel that hits Cloudflare's limit of
  200 requests at once as soon as a room presses the button together.
- **Do not use server-sent events** for live updates; use websockets or polling. Quick
  tunnels do not carry server-sent events.

## 5. Threat model

The owner's rule is the test: remote reaches the same thing the Wi-Fi share reaches, and
nothing more. Each row says what remote changes against the Wi-Fi share as built
(plugin 1.18.0).

| Risk | Wi-Fi share today | With remote | Answer |
|---|---|---|---|
| A stranger finds the address | Only devices on the same Wi-Fi can try. | Anyone on the internet can reach it while it is up. | The address alone opens nothing: the locked page. Random, new each session, never shown or copied. |
| A person passes their link on | One room key; works for anyone on the Wi-Fi. | Works for anyone, anywhere. | Per-person key. The host sees the extra device by name and can Remove the person, which ends the key at the next round (4 s). Accepted by the owner. |
| More of the laptop than the app | Only ports Claude showed, only from this project's folder (F4). | Only the newest of those, same check. | The tunnel reaches a 127.0.0.1 gateway, never the dev server or any other port. |
| The dev server's own holes (Vite `/@fs/`, source maps) | Reachable by key holders on the Wi-Fi. | By key holders anywhere. | Still only key holders; those paths refused on the remote gateway; a built copy is shared. |
| Guessing keys | One fixed key, checked locally. | An unknown key triggers a check with Engage. | 128-bit keys; one check per second at most; wrong keys remembered. |
| Keys on the laptop | The room key is in memory. | | Only hashes reach the laptop. |
| A local program reaches the remote gateway | | Anything on the laptop can connect to 127.0.0.1. | It still needs a key. Headers that claim a client address (`CF-Connecting-IP`) are never used to decide anything. |
| Snooping on the network | Plain http on the Wi-Fi. | https to Cloudflare. | Better than today. |
| A third party sees the traffic | None. | Cloudflare carries all of it, for the room too, while remote is on. | Accepted by the owner for the trial; said in the switch's small print. |
| The downloaded program is tampered with | Nothing downloaded. | A program from the internet runs on the host's laptop. | One pinned version, from Cloudflare's GitHub releases, SHA-256 checked before it ever runs. |
| It stays open by accident | Fails closed after 30 s without Engage; ends with the session. | Same, plus a separate process. | `cloudflared` is the plugin's child, killed with the gateway; a pid file catches one orphaned by a crash. Off by default every session. |

## 6. Known gaps of the trial (the quick tunnel)

These are Cloudflare's documented limits for quick tunnels, not faults to fix in this
piece. If they spoil the trial, the remedy is §8, not code here.

- **200 requests in progress at once**; more get "too many requests". The built copy (§4.5)
  is the mitigation. A room pressing the button together on a heavy page can still hit it.
- **No server-sent events.**
- **No uptime promise; a new address every session.** A tunnel that drops mid-session
  shows as R3's failure, and phones fall back to the Wi-Fi link.
- **Some company firewalls block `*.trycloudflare.com`.** A remote person behind one gets
  a dead tab, and while remote is on, so would anyone in the room on such a network.
- **Creating tunnels is rate-limited** (the spike, 16 Oct: 429 after 13 in ~85 s on airplane
  Wi-Fi; 17 in 3.5 min were fine at home). Probably per public address, so a room sharing
  one could meet it. One tunnel per session, never reopened without need, keeps this rare.
- **15 to 20 s from switch-on to live**, most of it waiting for Cloudflare's DNS.
- **History links stay Wi-Fi links.** The History tab's older "Claude is showing" links carry the Wi-Fi room key, as before remote existed. Only Open the demo goes the remote way; a remote person who taps an old History link gets a dead tab. One tunnel only ever reaches the newest thing anyway.

## 7. Testing

Backend (standalone node scripts, as the repo's other suites):
- key minting: per person, idempotent for the same `clientId`, new after a handover, gone
  after removal; only hashes stored and sent;
- the views: the public view never carries a remote link or key; the Wi-Fi link is left
  out while remote is live and kept while starting or failed;
- the report and answer shapes; `remoteWanted` off when sharing is off.

Plugin (the existing gateway tests, extended):
- the remote gateway binds 127.0.0.1 only; refuses a missing or unknown key with the locked
  page, for pages and websocket upgrades alike; refuses `/@fs/`, `/@id/`, `*.map`;
- an unknown key triggers at most one Engage check per second, and a wrong key is not
  checked twice;
- devices are counted by cookie, not by socket address;
- the download refuses a file whose hash does not match, and nothing runs;
- switch off, session end and 30 s without Engage each close the gateways and kill
  `cloudflared` (a fake `cloudflared` in tests; no network).

Frontend: `OpenDemo`'s four states (R4 a to d) and the host panel's names-and-devices list.

By hand, on dev then test: a phone on mobile data opens the demo; a pasted link shows as a
second device; Remove ends it; a handover gives the new device a working button and the
old one the locked page; switching remote off closes the address within one round.

## 8. Not in this piece

- **The owner's own Cloudflare account** (a named tunnel per session under the owner's
  domain, created by Engage's backend). It removes §6's limits and the firewall problem.
  The plugin starts the tunnel in one function so that change stays behind it; nothing on
  screen changes.
- An address the host can copy and send. Remote reaches people only through their own
  button.
- Any change to the Wi-Fi share itself.
