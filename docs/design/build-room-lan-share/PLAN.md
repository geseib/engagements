# Build Room: let the room open the build on this Wi-Fi

Owner, 2026-10-07:

> "Another great piece of experience that is missing is that the participants dont have access to
> the localhost dev server. so when things are demo'ed now they are only on local host. what would
> it look like to run that on the local network interface so if everyone was on the same Wifi it
> would work"
>
> "to me LAN doesnt have the same issue. in that at least im in a limited exposure to just people
> on my network. ... for now lets do local lan so. we test the concept."

Status: **built and pushed to dev at `57fece1e` (2026-10-07)**, plugin 1.11.0. The real-network check (section 5) is waiting for the owner. Build plan: `docs/superpowers/plans/2026-10-07-build-room-wifi-share.md`. Owner, 2026-10-07: only ending the session closes the gateway; wrap-up leaves it on. Ideas set aside for later are in [LATER.md](LATER.md).

This is the first of four pieces the owner named on 2026-10-07. The other three are also in LATER.md:
the contribution record, several rooms from one starter, and teams in phases.

## The problem, measured in the code (2026-10-07)

| Area | Today | The problem |
|---|---|---|
| Where the app runs | Claude starts the project's dev server on the host's laptop, on `localhost`. | Only the laptop can open it. |
| What participants are given | `isLocalUrl` / `publicUrl` in `lambda-functions/game/build-store.js` drop every `localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*` and `.local` link before a participant's device sees it: the `showing` link, a variant's url, the wrap-up demo link. | The people building it never get to touch it. They judge it from a screenshot or the projector. |
| The wall's Build screen | The newest screenshot and "Open the build" for the laptop. | An https page cannot frame `http://localhost` (measured in Chromium 152, 2026-10-05), so there is no live view. |

## The decisions

1. **The Wi-Fi first.** The fallbacks (a tunnel, a hosted preview) are deferred to LATER.md.
2. **Share the running app, not a static build.** A project with a local backend (DuckDB, an API
   server) has to keep working.
3. **A gateway in the plugin, not `--host 0.0.0.0`.** The app stays on `localhost`; the plugin puts
   one locked door on the Wi-Fi in front of it, and the host has an off switch.
4. **Off by default. The host turns it on.**

## 1. How it works end to end

1. Claude starts the app on `localhost` as today and shows it the usual way (a `showing` update, or
   a variant's `url`). The plugin's `checkLocalLink` already checks that the link is this
   project's server.
2. The host turns on **Share on this Wi-Fi** from the Build Room screen. The first time Claude
   shows a running app, the Now card offers it once.
3. Engage tells the plugin. The plugin starts the gateway on the laptop's Wi-Fi address, makes a
   key, and reports the links back.
4. The gateway forwards to the app Claude is showing. Hot reload and websockets pass through, so
   participants' screens update as Claude edits.
5. Participants get **Open the build** (a new tab) on whatever they brought: a laptop, tablet or phone, with "Works on the same Wi-Fi as the host" under it.
   The wall can show a QR code. It cannot embed the app (https cannot frame http).
6. The host sees whether it works: the gateway counts the devices that opened it, and Engage shows
   "9 open". None after two minutes suggests the Wi-Fi keeps devices apart.
7. Off means off. The host's switch, wrap-up, and the session ending all close the ports.

## 2. The plugin (`src/public/engage-mcp.mjs`, to 1.11.0)

**Where it runs.** Inside the plugin's MCP server process, which Claude Code keeps running for the
whole session. It starts and dies with Claude. It uses Node's built-in `http` and `net` only, so
the install gains no new dependencies.

**One gateway port per local address.** The first local address Claude shows (say
`http://localhost:5173`) gets the Wi-Fi port 4900; the next distinct one (`localhost:5174`) gets
4901, and so on, up to 4 ports. If a port is taken, the next free one is used. Paths are kept, so
`/a` and `/b` on one server need no extra port. The mapping lasts for the session.

**Which address.** The laptop's Wi-Fi interface: the first non-internal private IPv4 address,
`en0` first on macOS. The gateway binds that address only, never `0.0.0.0`, and never forwards
to anything but `localhost` / `127.0.0.1` on a port Claude has shown and `checkLocalLink` did not
warn about.

**The lock.**
- The key is 128 random bits (`crypto.randomBytes(16)`, base64url, about 22 characters). It is
  not the room's join code, which is short and on the wall.
- A new key every time sharing is turned on. Turning it off and on again locks out every device
  that had the old one.
- A request carrying `?k=<key>` gets a cookie (`engage_lan`, `HttpOnly`, `SameSite=Lax`,
  `Path=/`) and a redirect to the same address without `k`. Cookies are shared across ports
  on one host, so one unlock covers every gateway port.
- A request with neither the key nor the cookie gets a plain 403 page: "Open this from the Build
  Room on your phone, laptop or tablet." Nothing from the app is served.
- The gateway strips its own cookie and the `k` parameter before forwarding.

**Forwarding.**
- `Host` and `Origin` are rewritten to `localhost:<app port>`, so the app sees a local request.
  Recent Vite versions refuse unknown hosts ("Blocked request. This host is not allowed"), and
  this avoids that.
- `Location` headers that point at `localhost:<app port>` are rewritten back to the gateway's
  address.
- Websocket upgrades are piped both ways (`net` sockets), so Vite's hot reload works.
- Response bodies are never rewritten. A page that hard-codes `http://localhost:<other port>` will
  break on a participant's device; Claude is told how to avoid that (below).

**Talking to Engage.** Each 4-second round of the existing activity pump (`pumpActivity`, which
today posts only when there is activity) also reports the share state, and reads back whether the
host wants it on:
- The plugin sends `{ status, map: { "http://localhost:5173": "http://192.168.1.20:4900" },
  key, open, error }`, where `open` is the number of distinct cookies seen in the last 5 minutes.
- The answer carries `{ wanted: true|false }`.
- When nothing has changed, a round still sends a small "no change" report, so the switch is
  noticed even when Claude is quiet. While sharing is wanted or live this is every 4 seconds;
  while it is off, every 15 seconds. So turning it on takes up to 15 seconds to reach the plugin
  (the chip reads "Starting…" meanwhile), and turning it off up to 4.

**What Claude is told** (room_status, the instructions, the `engage:build-room` skill):
- "Sharing on Wi-Fi is ON: the room opens your app through Engage's gateway. Route backend calls
  through your dev server (`/api` proxied to the backend) instead of calling another port from
  the page, or that part will not work on anyone else's device. People use laptops,
  tablets and phones, so make it work at every width."
- Start servers on `localhost` as before. Never use `--host 0.0.0.0` for the room; the gateway
  does that job.

**The macOS firewall.** The first time, macOS may ask "Do you want the application node to accept
incoming network connections?" The Connect panel's checklist gains one line: "If your Mac asks
whether node may accept incoming connections, click Allow. That is how the room's phones, laptops and tablets on this Wi-Fi reach
the build."

## 3. The server (`lambda-functions/game/build-room.js`, `build-store.js`)

**State.** `BUILD#STATE` gains one field, `Share`:

| Field | Meaning |
|---|---|
| `Wanted` | The host's switch. |
| `Status` | `off`, `starting`, `live`, `failed`. |
| `Map` | Local address to Wi-Fi address, as the plugin reported it. |
| `Key` | The current key. |
| `Open` | Devices seen in the last 5 minutes (distinct cookies). |
| `Error` | The plugin's last error, in plain words ("No Wi-Fi address on this laptop"). |
| `ReportedAt` | When the plugin last reported. |
| `FirstOfferedAt` | When the Now card offered it, so it is offered once. |

`Share` is sealed in team rooms (`tenant-crypto`, the same as `BriefDraft`); all three
`tenant-crypto.js` copies stay byte-identical. `Key` never appears in a log entry.

**Routes.** No new Lambda (the stack is near its resource ceiling).
- `POST build/share { on }`: the host's switch, Cognito plus `callerMayDriveSession`. It refuses
  when the room is ended or wrapped up.
- The plugin's report rides on its existing agent call (`POST build/activity`), and the answer
  carries `wanted`. That route still never hands over Claude's inbox.

**Participants' views.** One change, in `publicUrl` and `publicOutcome`. When `Share.Status` is `live` and
`ReportedAt` is under 30 seconds old, a local link whose origin is in `Map` is **translated** to its
Wi-Fi address with `?k=<key>` added. Every other case is exactly today's behaviour: the link is
dropped. This covers the `showing` link, a variant's url and the wrap-up demo link with no other
change.

**Off is immediate on the server.** When the host turns it off, participants stop being given links in
the very next view. The plugin closes the ports within a round. A plugin that stops reporting for
30 seconds counts as off for participants too.

**Ended or wrapped up** sets `Wanted` false.

## 4. The screens

Mockups first, in `docs/design/build-room-lan-share/`, for the owner to see before any code.

**Host screen (`BuildRoomPage.jsx`)**
- A **Wi-Fi chip** in the header beside the connection chip: **Off**, **Starting…**,
  **On · 9 open**, **Didn't start** (with the reason).
- Clicking it opens a small panel: the switch, the link, **Show the QR on the wall**, and one
  line: "Anyone on this Wi-Fi with the link can open the app Claude is running. Turn it off at any
  time."
- **The offer, once:** the first time Claude shows a running app (a `showing` entry or a variant
  url that is local), the Now card asks "Let the room open it themselves?" with the switch.
  Dismissed, it is not offered again.
- **None open yet:** on, live, and 0 open after 2 minutes, the chip reads "On · none open yet" and
  the panel says "This Wi-Fi may keep devices apart. Check everyone is on the same network as this
  laptop."
- **The Build screen:** as today, plus the Wi-Fi QR while sharing is live.

**The wall (Stage).** "Open the build yourself" (on your phone, laptop or tablet) with a big QR, shown when the host presses Show the
QR on the wall, reusing the join-QR modal's sizing. No embedded frame.

**Participants (`BuildPlayer.jsx`, on laptops, tablets and phones)**

Owner, 2026-10-07: "one thing we dont want to assume is phones only. participants will have laptops,
tablets and phones." Every line of copy says what it means for all three, and the real-network test
uses all three. A laptop on a work VPN often cannot reach a private address, so the "none open yet"
advice names it.

- **Now tab:** **Open the build** whenever sharing is live. It opens the newest app Claude showed,
  in a new tab, with "Works on the same Wi-Fi as the host" under it.
- Everywhere else (ticker links, a variant's Open A, the wrap-up demo link) needs no new UI: the
  server now hands participants a working link.
- **Looks good / Needs a change** already sits on the newest preview; people can now try it first.

## 5. Testing

**The gateway** (`tests/build-room-lan-gateway.js`, a node script like the others, armed with
`tests/helpers/finish-guard.js`). A real local server behind a real gateway:
- no key and no cookie: 403, and the app never sees the request;
- the key becomes a cookie, and the redirect drops `k`;
- the cookie works on a second gateway port;
- `Host` and `Origin` arrive as `localhost:<port>` (the test server refuses any other host, as Vite
  does);
- a `Location` header is rewritten to the gateway address;
- a websocket echoes through;
- the gateway refuses to forward to a port Claude never showed;
- turned off, the port refuses connections;
- turned on again, the old key is refused.

**The server** (`tests/build-room.js`):
- `publicUrl` translates only while live and fresh, and drops the link exactly as today otherwise;
- off takes effect in the next participant view;
- a stale report (over 30 seconds) counts as off;
- ended and wrapped-up rooms force it off and refuse `on`;
- `Share` is sealed in a team room, and the key is not in any log entry.

**The screens** (`buildRoomPage.test.jsx`, `buildPlayer.test.jsx`, `buildScreens.test.js`): the
chip's states, the one-time offer, "none open yet" after 2 minutes, the participant's button only while
live.

**The plugin.** Bump `VERSION` and the pin in `tests/engage-plugin-version.js`. Extend
`tests/engage-mcp.js` for the report-and-switch round and the room_status line.

**On a real network, before calling it done.** The owner's laptop plus a second laptop, a tablet and a phone on the same
Wi-Fi, a Vite app Claude builds in a room on dev:
- each opens it from the button, and the tablet and phone from the wall QR too;
- an edit by Claude reaches all three by hot reload;
- a second variant on another port opens from its Open B;
- turned off, every next load fails and the button is gone.

Then one try on a guest network, to see "none open yet".

**The gates:** 286 backend suites, 444 frontend suites, lint at 0 errors (10 warnings), `npm run
build`, `node tests/build-room-copy.js`.

## Out of scope here

- Reaching anyone who is not on the host's Wi-Fi (a tunnel, a hosted preview): LATER.md.
- https on the Wi-Fi, and so a live frame on the wall: LATER.md.
- Crew builders' own laptops: their apps stay on their machines; they share through screenshots as
  today.
