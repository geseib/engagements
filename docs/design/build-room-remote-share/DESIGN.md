# Build Room: share the demo outside this Wi-Fi

> **Superseded (17 Oct 2026).** This was written by a parallel task without knowing that the
> owner had already approved a remote share design on 16 Oct in another session. The design
> that is being built is `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md`,
> with its plan in `docs/superpowers/plans/2026-10-16-build-room-remote-share.md` and the spike
> and mockups in this folder (`SPIKE.md`, `index.html`). Keep this file only as a second
> reading of the threats; where the two differ, the approved design wins.


Status: **design only, for the owner's approval. Nothing here is built.** Written 2026-10-17
against `working/parity-plan` at `1e6e7539` (plugin 1.19.0). It assumes the parallel S3 work
(plugin 1.20.0: `.engage/share.json` roles, a port block per session, `X-Engage-Session`,
`.engage/share-status.json`, `docs/design/parity/PLAN.md:482`) lands first.

Where it comes from: [LATER.md](../build-room-lan-share/LATER.md), "Reaching people who are not on
the host's Wi-Fi" (lines 6-36). Owner, 2026-10-07: the tunnel is the interesting way out *because*
local backends keep working, but it is a security issue, and a design must answer that first. So
security comes first here, before any screen.

## The decisions this design proposes

1. **A tunnel, but only to a new, stricter door in the plugin.** `cloudflared` (a Cloudflare quick
   tunnel, free, no account) reaches a second gateway mode, the **outside door**, never the dev
   server. The Wi-Fi gateway stays as it is.
2. **Joining the room is the lock.** Engage hands each joined person their own short-lived link
   (a signed ticket), never the room-wide key. No ticket ever goes on the Stage, into a QR or into
   Copy, which are what a Zoom screen share and a Zoom chat leak.
3. **Short life, demo only, capped.** Off by default; the host turns it on with its own consent
   line; it ends after 2 hours unless the host keeps it, at End always, and within 30 seconds of
   Engage or the plugin going quiet. Only the server marked `demo` is shared outside.
4. **No new template resources.** Everything rides on `build/{proxy+}` and the `BUILD#LAN` row.
5. **Never download a program.** If `cloudflared` is missing, the host is told how to install it.

## 1. Security first

### What a public address changes

| | The Wi-Fi share today | Outside this Wi-Fi |
|---|---|---|
| Who can reach the door | Devices on the same network (`engage-mcp.mjs:2683` binds the Wi-Fi IPv4 only) | Anyone on the internet who has the address |
| What protects it | One room-wide key, `?k=` then cookie `engage_lan` (`engage-mcp.mjs:2609-2621`) | Proposed: a ticket per person, a cookie per device, the key never leaves Engage and the plugin |
| Who is handed the key today | Every joined player's view (`build-store.js:1544-1545`, `build-room.js:2823-2830`), the host's view (`build-store.js:1519`), the Stage QR (`BuildWifiShare.jsx:393-395`), Copy (`BuildWifiShare.jsx:54-66, 349`), a builder's Claude through its view of the log (`build-room.js:1863-1866`) | Proposed: joined players only, each their own; never the Stage, Copy, Claude or a builder's Claude |
| Transport | Plain http on the Wi-Fi (LATER.md:38-44) | https from the browser to Cloudflare; Cloudflare to the laptop over cloudflared's own encrypted connection |
| Who else sees the traffic | Anyone capturing on that Wi-Fi | **Cloudflare**, which ends TLS and sees every request and response in clear |

The one-line threat model: **while the switch is on, everyone who can join the room can use the
demo's server on the host's laptop, from anywhere, as far as the outside door lets them.** The
design's job is to make "as far as the door lets them" small, short and visible.

### The threats, one by one

| # | Threat | How the design answers it | What is left |
|---|---|---|---|
| T1 | **Scanning.** Bots find the address and probe it. | The address is random (`<words>.trycloudflare.com`). Without a ticket or cookie every request gets a bland 404 page with no app content and no "Engage" in it (today's locked page names Engage, `engage-mcp.mjs:2586-2590`). The door answers only `Host: <its own tunnel name>`. 403s and 404s are rate-limited so a scanner cannot load the laptop. | The address will be found: passive DNS sees lookups. It must never be the lock, and it is not. |
| T2 | **The link leaks through Zoom.** The host shares their screen (Stage, panel) or pastes a link in the chat; the meeting is recorded. | No secret is ever on a screen: the Stage's demo code becomes a join link (`/play?gameId=…&then=demo`), the panel shows the address without the ticket (it already hides the key, `BuildWifiShare.jsx:51-52`), and Copy copies the join link, not a ticket. A person's ticket lasts 10 minutes and opens at most 3 devices. | Anyone who sees the join code can join and get their own ticket. That is the same door as the rest of the room (ideas, votes), and the host sees them by name (T10). Whether that is enough is **Q1**. |
| T3 | **One leaked ticket shared on.** A participant pastes their own link into a chat. | The ticket expires in 10 minutes and opens 3 devices. Each device's cookie names its person, so the host sees "Priya · 3 devices". Removing a person from the room revokes their tickets and cookies within a round. | Up to 3 devices for up to 10 minutes per leak, until the host notices. |
| T4 | **The key in a URL.** `?k=` sits in browser history, proxy logs, Referer headers. | The room-wide key never leaves the plugin and Engage. The ticket in the first URL is swapped for a cookie by a redirect that drops it (as `?k=` is today, `engage-mcp.mjs:2609-2616`). Every response from the door carries `Referrer-Policy: same-origin`, so the app's calls to font or CDN hosts do not carry the tunnel address. | The ticket is in that device's history for its 10 minutes, and Cloudflare sees it. |
| T5 | **Dev-server bugs.** Vite's 2025 `/@fs/` path-traversal reports (crafted queries such as `?raw??` or `?import&raw??` read files outside the project), source maps, `/__open-in-editor` (opens files in the host's editor), other dev middleware. | The outside door sits in front, as the Wi-Fi gateway does, so the dev server is never on the internet itself. It refuses outright: any path under `/@fs/`; any path segment starting with `.` (`.env`, `.git`, `.engage`); `/__open-in-editor`, `/__inspect`, `/__vite_ping` style editor and inspector endpoints; a query containing `raw`, `inline` or `url` together with `??` or a second `?`. Pages open only inside the linked folders (the S1 scopes, `engage-mcp.mjs:2542-2549`, `build-lan.js:99-116`), and a folder listing is never shown (`engage-mcp.mjs:2641-2650`). Claude is told to keep its dev server up to date. | **The scopes are a browser rule, not a wall.** A sub-resource is allowed from anywhere on the server when its `Referer` is a linked page (`engage-mcp.mjs:2542-2549`), and `Sec-Fetch-Dest` decides what counts as a page (`engage-mcp.mjs:2528-2529`). A ticket holder with curl can forge both and ask the dev server for any path the block list misses. The block list closes the known holes; an unknown dev-server bug is reachable by ticket holders. |
| T6 | **Websockets and hot reload.** The upgrade path skips the scope check (`engage-mcp.mjs:2667-2680`), and the gateway rewrites `Origin` to `localhost` (`engage-mcp.mjs:2595`), which switches off any origin check the dev server has (Vite added one in 2025 for exactly this). | The outside door checks before it rewrites: an `Origin` that is not the tunnel's own (or, for the framed Stage, the tier's Engage site) is refused, for pages, calls and upgrades alike. Upgrades need the device cookie, which is `SameSite=Lax`, so another site cannot ride it. At most 4 open upgrades per device. | A ticket holder can talk to the dev server's hot-reload channel. On Vite it pushes updates and accepts a few client messages; nothing in it reads files today. |
| T7 | **Cookies on a shared https host.** Every quick tunnel is a sibling under `trycloudflare.com`; a sibling page could set or toss cookies for the parent domain. | The cookie is `__Host-engage_share` (`Secure`, `Path=/`, no `Domain`), so no sibling can set or overwrite it, whatever the Public Suffix List says about `trycloudflare.com` (to check at build time). It is a session cookie, bound to the key: a new key each time sharing is turned on locks out every old device, as on the Wi-Fi (`engage-mcp.mjs:2737`). | If `trycloudflare.com` is not on the Public Suffix List, a sibling can stuff large cookies onto the parent domain and make requests fail (a nuisance, not a breach). |
| T8 | **Cloudflare's cache serves the app without the lock.** Cloudflare's edge may cache static file types by default when the origin allows it. A static server sends no `Cache-Control`. | Every response from the outside door is rewritten to `Cache-Control: private, no-store`, and locked or not-found pages too. | None known, if Cloudflare honours `private` and `no-store` as documented (check on the real-network test with a second, ticketless device). |
| T9 | **The laptop's other local services.** A tunnel could be pointed at something else; the dev server can proxy to a backend. | cloudflared is pointed only at the outside door, which listens on a Unix socket in the plugin's own folder (mode 0700), not on a port, so no other process and no web page in the host's browser can reach it, and an orphaned cloudflared points at a socket that is gone. The door forwards only to the `demo` server, only once it is confirmed to run in this project's folder (`engage-mcp.mjs:2717-2727`), only to `localhost` / `127.*` / `::1` (`engage-mcp.mjs:2518-2519`). It never rewrites `Location` to a port other than the target's (`engage-mcp.mjs:2634`). | **Whatever the dev server proxies to is on the internet too.** That is the point (local backends keep working) and the risk: a backend Claude wrote (DuckDB queries, file reads, a URL fetcher) is reachable by ticket holders. Claude is told, while shared outside, never to add an endpoint that reads a path, fetches a URL or runs a command a user supplies. |
| T10 | **Not knowing who is in.** | Each device's cookie carries its person, so the door reports which people opened it, and the host's panel lists them by name. Removing a person revokes them. | The host has to look. |
| T11 | **Abuse of the laptop and the call.** One person hammers the door; many remote viewers saturate the host's upload while the host is on Zoom. | Caps on the door: 50 devices, 3 per person, 64 requests in flight, 10 MB per request body, a per-device rate (a burst of 600, then 50 a second: a Vite dev page loads hundreds of modules). Cloudflare's own quick-tunnel limit (200 requests in flight, per its docs) sits behind that. | A busy room can still slow the host's video. The panel says so (Words: `remoteSlow`). |
| T12 | **A door left open.** The plugin crashes, Claude Code is closed, the laptop sleeps, Engage is unreachable. | The door closes when Engage has not answered for 30 seconds (as today, `engage-mcp.mjs:2785-2789`) and when the session file is gone (`engage-mcp.mjs:2765-2768`). cloudflared is a child of the plugin, killed on exit; its pid is written to `.engage/tunnel.json`, and the next start kills a leftover one after checking its command line. With the Unix socket gone, a leftover cloudflared can only answer 502. Engage stops handing out links when the plugin's report is over 30 seconds old (`build-lan.js:155-161, 169-170`). | A hard-killed plugin leaves a cloudflared process answering 502 until the next start or reboot. |
| T13 | **Cloudflare as a party, and its reputation.** Quick tunnels are for testing and development, with no uptime promise; `trycloudflare.com` is used by malware, so some company networks and filters block it or warn. | Accept for the concept test. The panel's "Didn't open?" advice names it. A named tunnel on the owner's own domain (option 2) is the way out if this becomes a product feature. | Some participants on company laptops will not get in. They still have the screenshots. **Q10.** |
| T14 | **The door's own code is a bug surface** inside the process that holds the Engage key (`.engage/session.json`). | The door never serves a file itself, never writes to stdout (the MCP stream, `engage-mcp.mjs:2504`), and never logs a ticket, a cookie or the key. | As for the Wi-Fi gateway. |
| T15 | **Claude posts the tunnel address itself.** | Claude is never told the outside address (Claude's view already has no key, `build-store.js:1519`), only that sharing outside is on. A `trycloudflare.com` link Claude posts anyway is dropped from the room's views like a local link. | None. |

### What is never reachable from outside

- Any server but the one marked `demo` (S3's `.engage/share.json`), and only once confirmed as this
  project's.
- The dev server's `/@fs/`, dotfiles and editor or inspector endpoints, and any folder listing.
- Any page outside the linked folders.
- The outside door from this laptop's own browser or other local processes (Unix socket).
- Anything at all, without a ticket or cookie, or after End, after expiry, or 30 seconds after
  Engage or the plugin goes quiet.

### Honest residual risk, in one paragraph

While it is on, people who joined the room can use the demo and whatever backend the dev server
proxies to, from anywhere, and a deliberate one with curl can reach any path of the dev server
that the block list does not refuse. Cloudflare sees all of it. The protections are that the
window is short, the people are named and removable, the dev server's known holes are closed, and
nothing else on the laptop is in reach. For a demo of a room's build in a workshop, this design
judges that acceptable; for a build with real data or secrets in it, the switch should stay off.
The consent line says so.

## 2. Options compared

| | **A. Quick tunnel to the outside door** (recommended) | **B. Named tunnel + Cloudflare Access** | **C. Hosted snapshot per decision** (GitHub Pages, Vercel) | **D. Engage hosts a snapshot** on a separate domain |
|---|---|---|---|---|
| Live (edits show at once) | Yes, hot reload through the tunnel | Yes | No: a deploy per decision, a minute or two behind | No: an upload per decision |
| Local backends (DuckDB, an API) | Work | Work | Hard: only what builds to static files | Hard, as C |
| Laptop exposed | The demo, to ticket holders, while on | The demo, only after a Cloudflare sign-in at the edge: scanners never reach the laptop | Nothing | Nothing |
| Who sees traffic | Cloudflare | Cloudflare | The host | Engage |
| Host setup | Install `cloudflared` once | A Cloudflare account and zone, or Engage minting tunnels with a Cloudflare API secret, and a DNS zone on Cloudflare (e.g. `demo.seibtribe.us`) | An account and a project per room | None |
| Participant setup | None | Sign in at Cloudflare (an emailed code) per person: real friction in a one-hour session | None | None |
| Reach | Some company networks block `trycloudflare.com` | Better: the owner's own domain | Good | Good |
| Engage server and template | No template resources. Lambda code only | No new resources if the secret is an SSM parameter made by hand, but the build function's role needs a policy change, and a DNS move | None | A bucket, a CloudFront distribution, a certificate, a bucket policy and a DNS record (about 5 resources, against a stack at about 440 of 500, `docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md:41`), or a separate stack; plus upload storage |
| New risk | T1-T15 above | As A, minus T1-T3 for anyone who cannot sign in | Host's account tokens on the laptop | **Engage hosts arbitrary code a room wrote on a public domain**: phishing and malware abuse puts the domain's reputation at risk; must never be Engage's own domain (LATER.md:15) |
| Effort | About 4 days, plus the real-network check | 1-2 weeks, plus Cloudflare account work | Per host, outside Engage | About a week |

**Recommendation: A now.** It is the only one that keeps local backends and live edits with no
account for anyone, and every risk it adds has an answer above or is named. **B is the upgrade
path** if an organisation asks for a sign-in in front of the demo (Q4); the outside door and the
tickets carry over unchanged, B only adds the edge sign-in. **C and D are not worth building for
this**: they lose the two things the owner chose the tunnel for. The repo link (LATER.md:33-36)
stays as the record people take home.

## 3. The flow and the words

### End to end

1. Claude runs the demo on `localhost` as today. The Wi-Fi share may be on, off, or quiet.
2. The host opens the Share demo panel (the chip, `BuildWifiShare.jsx:202-233`, or Settings'
   Demo tile, `BuildWifiShare.jsx:306-369`) and presses **Share outside this Wi-Fi**. It is off by
   default and never on unless pressed. The panel also offers it when the Wi-Fi share has gone
   quiet (`QuietWarning`, `BuildWifiShare.jsx:169-179`): guest Wi-Fi is the case it exists for.
3. **Consent, in place.** The first press arms the switch and shows the consent line and the end
   time; the second press turns it on (Build Room's press-twice-in-place standard,
   `docs/design/parity/PLAN.md:488`). Engage records who consented and when, and the log says
   "You shared the demo outside this Wi-Fi until 16:40".
4. Engage tells the plugin on its next round. The plugin finds `cloudflared`, opens the outside
   door on its Unix socket, starts the quick tunnel, reads its address, and **reaches its own door
   through the tunnel** before saying live (a new tunnel name can take a few seconds to resolve,
   and a phone that looks too early can cache "no such name" for minutes).
5. Engage gives each joined person **Open the demo** with their own ticket, under it "Works from
   anywhere." The host's chip reads "Shared outside · 3 opened"; the panel lists who.
6. It ends at the end time (the host can keep it 1 hour more), at **Stop sharing outside**, at
   End, and within 30 seconds of the plugin or Engage going quiet.

### One link or two

While sharing outside is on, **everyone gets the outside link**, in the room too: one link, one
code, one count, and "Didn't open?" has one answer. The Wi-Fi door stays as the host set it. The
cost is that people in the room go out to the internet and back (the host's upload carries them
too). **Q6.**

### What changes where

| Where | Today | Outside this Wi-Fi |
|---|---|---|
| Share panel (`SharePanel`, `BuildWifiShare.jsx:86-166`) | Wi-Fi state, address with QR, Copy, Stop sharing, Show on the Stage | A second section: the switch, the consent line, the end time; while live, "N opened · names", **Test the outside link** (opens the host's own ticket in a new tab), Stop sharing outside. The QR and Copy carry the **join** link, never a ticket |
| Demo tile in Settings (`DemoTile`, `BuildWifiShare.jsx:306-369`; its comment says "a remote link goes to browsers, never here", line 302) | Wi-Fi states only | The same switch and states under the Wi-Fi ones; the code is the join link |
| Stage card (`WallCodes`, `BuildWifiShare.jsx:377-404`) | Join code left, the demo's key link as a QR right (`:393-395`) | Join left; right: "Try the demo yourself" with the code to `/play?gameId=<code>&then=demo` and "Join, then press Open the demo." No ticket on the wall, ever |
| Build screen card (`BuildScreenQr`, `BuildWifiShare.jsx:407-415`; `BuildRoomPage.jsx:2144, 2170`) | The key link as a QR, "Same Wi-Fi only" | The join-then-demo code, "From anywhere · N opened" |
| Host's Open the build (`liveBuildLink`, `BuildRoomPage.jsx:1660-1663`) | The Wi-Fi link while shared | Unchanged: the host's own laptop opens localhost or the Wi-Fi link. Test the outside link is in the panel |
| Phone and laptop (`OpenDemo`, `BuildPlayer.jsx:742-771`) | Open the demo, "Same Wi-Fi only." (`:757-759`) | Open the demo with their own ticket, "Works from anywhere."; Didn't open? says the network may block it |
| Play page | Join | `then=demo`: once joined, open the demo straight away |
| HOST list on the Stage | "The demo is ready to share" | Adds "Sharing outside ends in 5 minutes" with Keep sharing |

### When `cloudflared` is missing

The plugin reports `missing` with the laptop's system. The panel shows, with nothing started:

- macOS: `brew install cloudflared` (with Copy)
- Windows: `winget install --id Cloudflare.cloudflared` (with Copy)
- Linux: a link to Cloudflare's own downloads page

and "Engage never downloads programs to this laptop. Install it, then press Try again." The
plugin looks on `PATH` and in `/opt/homebrew/bin` and `/usr/local/bin` (an MCP server's `PATH` can
be thin), or at `ENGAGE_CLOUDFLARED`. It never runs an installer, `brew` or `curl`.

### Wrap-up, End, and losing the plugin

| Event | What happens |
|---|---|
| Wrap-up | Stays on to its end time, as the Wi-Fi share does (owner, `PLAN.md:13`), so the room can try the reveal. **Q7.** |
| End | Off at once on the server: the next view has no link (`build-room.js:2106` pattern). The plugin closes the door and stops cloudflared within a round |
| End time reached | Off, as End. The log says "Sharing outside ended at 16:40." |
| A person removed | Their tickets and cookies stop working within a round |
| Plugin or Claude Code closed | cloudflared is stopped with it; Engage drops the link 30 seconds after the last report; the chip reads Didn't start with "Claude Code is not answering." |
| Engage unreachable from the laptop | The door closes after 30 seconds |
| Network blocks the tunnel | Failed after 30 seconds with "This network blocks the link out." |
| cloudflared exits by itself | Restarted up to 3 times (a new address each time; the server re-translates links); then failed |

### Status and counts

The plugin reports for the outside door, beside today's Wi-Fi report (`engage-mcp.mjs:2770-2777`):
`{ status, url, open, people: [pid…], error, expiresAt }`. `open` counts distinct device cookies
seen in 5 minutes, not addresses: through the tunnel every request arrives from cloudflared on the
laptop, so today's count by `remoteAddress` (`engage-mcp.mjs:2624, 2669`) would always read 1.

Chip: "Shared outside · 3 opened" while only outside is on; "Shared · 9 opened" with both, and the
panel splits "6 on this Wi-Fi · 3 outside".

### Words (for `src/src/buildroom/words.js`)

In the house style: short plain sentences, what it means for laptops, tablets and phones alike, no
"please", one word per act. None of these is in `RETIRED` (`words.js:535-570`; "Share on this
Wi-Fi" is retired and is not reused).

| Key | String |
|---|---|
| `remoteSwitch` | `Share outside this Wi-Fi` |
| `remoteConsent` | `Anyone who joins this room can open this laptop's app from anywhere while this is on. Each link works for one person. Keep real data out of the demo.` |
| `remoteConfirm` | `Share it outside` (the second press) |
| `remoteEnds` | `(t) => \`Ends at ${t}, or when the session ends.\`` |
| `remoteStarting` | `Opening a link outside this Wi-Fi…` |
| `remoteOn` | `(n) => \`Shared outside · ${n} opened\`` |
| `remoteLiveHead` | `Demo shared outside this Wi-Fi` |
| `remoteWho` | `People who joined this room can open it from anywhere. No one else can.` |
| `remotePeople` | `(names) => \`Opened by ${names}\`` |
| `remoteTest` | `Test the outside link` |
| `remoteStop` | `Stop sharing outside` |
| `remoteEndsSoon` | `Sharing outside ends in 5 minutes.` (with `keepSharing`) |
| `remoteEnded` | `(t) => \`Sharing outside ended at ${t}.\`` |
| `remoteNeedsTool` | `This needs cloudflared on this laptop.` |
| `remoteInstallThen` | `Engage never downloads programs to this laptop. Install it, then press Try again.` |
| `remoteBlocked` | `This network blocks the link out. Try another network, or use screenshots.` |
| `remoteSlow` | `Many people are opening it. Your video call may slow down.` |
| `worksAnywhere` | `Works from anywhere.` (phones, under Open the demo) |
| `demoMaybeBlocked` | `Your network may block it. A work laptop often does.` |
| `stageJoinThenOpen` | `Join, then press Open the demo.` |
| `codesAnywhere` | `from anywhere` (beside `codesDemo`) |
| `buildCardAnywhere` | `(n) => \`From anywhere · ${n === 1 ? '1 has' : \`${n} have\`} opened it\`` |

The door's own pages (served by the plugin, not React):

| Page | Words |
|---|---|
| No ticket or cookie | "Not found." (no app, no brand: T1) |
| Ticket expired | "This link has expired. Go back to the Build Room and press Open the demo." |
| Full | "This demo is full. Ask the host." |
| Removed or sharing stopped | "Sharing has stopped. The screenshots are in the Build Room." |

## 4. Bonus: the Stage frames the live build

An https page cannot frame `http://localhost` or `http://192.168.*` (`PLAN.md:24`), so today the
Stage shows screenshots. An https tunnel can be framed. What it needs:

| Need | How |
|---|---|
| Engage allows the frame | Nothing today: there is no `Content-Security-Policy` or `frame-src` in `template-clean.yaml` or `src/public` (grep, 2026-10-17). If one is added later, `frame-src` must list `https://*.trycloudflare.com` |
| The door allows only Engage to frame it | The outside door sends `Content-Security-Policy: frame-ancestors <this tier's Engage site>` (the plugin knows its tier, and the environment table in `CLAUDE.md` names each site), which overrides any `X-Frame-Options` the app sends. No other site can frame the demo (clickjacking) |
| The cookie inside a frame | Inside Engage's page the door's cookie is third-party: it needs `SameSite=None; Secure; Partitioned` (CHIPS). Browsers that block third-party cookies without honouring `Partitioned` (check Safari at build time) get no cookie: the frame then shows "Open the demo in a new tab" |
| The frame's ticket | A Stage ticket (`pid: stage`), minted only for the host's own view, never shown as a QR |
| The sandbox | `<iframe sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" allow="">`. `allow-same-origin` is safe here because the frame is another site: it keeps the app's own storage working and gives it nothing of Engage's. No `allow-top-navigation`, no `allow-popups`, no `allow-modals`, no camera, microphone or location |

Risks: the room's build runs on the projector laptop's browser (heavy CPU, sound, a page that
looks like a sign-in prompt inside the frame, content Claude pulled from the web). It cannot reach
Engage's sign-in tokens: it is a different site, and sandboxed. A frame showing a failing build is
on the wall in front of everyone; the host needs a one-click "Show screenshots instead".
Recommended for after the real-network check, not in the first release (Q11).

## 5. Build plan

Mockups first, as for every Build Room piece: `docs/design/build-room-remote-share/index.html`
(the panel's switch, consent and live states, the missing-tool state, the Stage card, the phone),
for the owner before any code.

| # | Task | Files | Tests |
|---|---|---|---|
| R1 | **Split the gateway into a door factory**, with no change to the Wi-Fi door: `openGateway(local, port, address)` (`engage-mcp.mjs:2602-2690`) becomes `openDoor(local, { mode, listen, origin })` | `src/public/engage-mcp.mjs` | `tests/engage-lan-gateway.js` passes untouched |
| R2 | **The outside door**: Unix-socket listen (127.0.0.1 port only where sockets are missing); tickets and `__Host-engage_share` device cookies; `Host` and `Origin` checks before the rewrite; `Cache-Control`, `Referrer-Policy`, `frame-ancestors` overrides; the block list; caps; counts by device and person; revocation | `engage-mcp.mjs` | `tests/engage-remote-door.js` (below) |
| R3 | **The tunnel**: find `cloudflared`; spawn `cloudflared tunnel --no-autoupdate --unix-socket <path> --config <empty file of ours>` (so a host's own `~/.cloudflared/config.yml` is never read; check the flags against the current release, and fall back to `--url http://127.0.0.1:<port>`); read the address from its output; reach the door through it before live; restart up to 3 times; kill on exit; `.engage/tunnel.json` and the stale-process sweep; `--protocol http2` when QUIC is blocked | `engage-mcp.mjs` | `tests/engage-remote-door.js` with the fake binary |
| R4 | **Report and answer**: `remote` in the report and the answer (`wanted`, `key`, `expiresAt`, `revoked`); room_status says "SHARING OUTSIDE THIS WI-FI is on" with the rules for Claude (no SSE: quick tunnels do not carry it, per Cloudflare's docs; no endpoint that reads a path, fetches a URL or runs a command a user supplies), never the address | `engage-mcp.mjs` (`lanRound`, `:2762-2791`; room_status near `:553-554`; instructions near `:2387, :3450`) | `tests/engage-mcp.js` |
| R5 | **Server**: `Remote` on `BUILD#LAN` (`Wanted`, `WantedAt`, `ConsentBy`, `ConsentAt`, `ExpiresAt`, `Status`, `Url`, `Key`, `Open`, `People`, `Error`, `ReportedAt`), sealed in team rooms like the rest of the row (`build-room.js:2087`); `normalizeReport` accepts only `https://<label>.trycloudflare.com` (today's filter keeps private `http` only, `build-lan.js:127`); `mintTicket` / `remoteTranslator` beside `lanTranslator` (`build-lan.js:163-178`); `hostShare { remote: true\|false, keep: true }` (`build-room.js:2060-2076`), refused when ended; expiry and End force it off; `publicView` mints a ticket per player (`build-store.js:1543-1545`), never in `builderState` (`build-room.js:1863-1866`) nor for Claude; tunnel links Claude posts are dropped; `LATEST_PLUGIN` to 1.21.0 (`build-store.js:843`) | `lambda-functions/game/build-lan.js`, `build-room.js`, `build-store.js` | `tests/build-lan-remote.js` (new), `tests/build-room.js` |
| R6 | **One ticket format, two copies**: a JSON file of test vectors that both the server and the plugin must reproduce (key, game, person, expiry → ticket; cookie → valid or not) | `tests/fixtures/remote-ticket-vectors.json` | Both suites read it, as `tests/tenant-session-scoping.js` holds `session-ttl.js` copies equal |
| R7 | **Screens**: the words; `wifiShare.js` gains `remoteState`; `SharePanel` and `DemoTile` gain the switch, consent, live, missing and blocked states; `WallCodes` and `BuildScreenQr` carry the join-then-demo code; `OpenDemo` says "Works from anywhere."; the play page honours `then=demo` | `src/src/buildroom/words.js`, `wifiShare.js`, `BuildWifiShare.jsx`, `BuildPlayer.jsx`, `BuildRoomPage.jsx`, `BuildSessionPanel.jsx`, the play page | `src/src/__tests__/wifiShare.test.js`, `buildRoomPage.test.jsx`, `buildPlayer.test.jsx`, `buildScreens.test.js`, `tests/build-room-copy.js`; a test that no QR or Copy on any host or Stage surface ever holds `t=` |
| R8 | **Release**: `RELEASE_NOTES.md`, in-app help for hosts and players (`src/src/config/help/host.js`, `player.js`), `README.md`, before the push to test (CLAUDE.md) | docs, help | `helpContent.test.js`, `tests/release-notes.js` |
| R9 | **The real-network check** (below) | | |

**Plugin version: 1.21.0** (S3 is 1.20.0). Bump `VERSION` (`engage-mcp.mjs:40`), the pin in
`tests/engage-plugin-version.js`, and `LATEST_PLUGIN`, so the update dot asks hosts to update.

**Server and template impact: zero template resources.** The host's switch rides on
`POST build/share` and the plugin's on `POST build/share/report` (`build-room.js:2721, 2726`), both
under `/games/{gameId}/build/{proxy+}` (`template-clean.yaml:4330, 4338`). No new Lambda, route,
table, bucket or parameter.

**Effort**: about 4 days of work (R1-R7), plus the mockups and the real-network check.

### `tests/engage-remote-door.js`, in the style of `tests/engage-lan-gateway.js`

The real plugin over stdio, a fake Engage API and a real app process in a throwaway project
folder, armed with `tests/helpers/finish-guard.js`, as `tests/engage-lan-gateway.js:100-141`
does. **A fake `cloudflared`** (`tests/helpers/fake-cloudflared.js`, a node script with a
`#!/usr/bin/env node` line, found through `ENGAGE_CLOUDFLARED`) records its arguments, prints a
quick-tunnel banner with `https://fake-words-here.trycloudflare.com`, and proxies from a local port
to the door's socket, adding what Cloudflare adds (`Host: fake-words-here.trycloudflare.com`,
`X-Forwarded-Proto: https`, `Cf-Connecting-IP`). Its behaviour is set by `FAKE_CF_MODE`: `ok`,
`no-address` (a blocked network), `die-after:<ms>`, `slow`. The plugin's own reach-through check
is pointed at the fake by `ENGAGE_TUNNEL_RESOLVE`, honoured only with `ENGAGE_ALLOW_LOCAL_API=1`
(the existing developer hatch, `engage-mcp.mjs:123-128`), so a real install cannot be redirected.

Checks:
- off: no cloudflared runs, nothing listens;
- missing cloudflared: status `missing` with the system, and nothing is downloaded or installed
  (the fake `PATH` holds no `brew`, `curl` or `winget`; any spawn of them fails the test);
- on: cloudflared starts with `--no-autoupdate` and our own `--config`, pointed at the socket,
  never at the app's port; the report says live only after the reach-through check;
- the socket is in a 0700 folder, and nothing new listens on a TCP port;
- no ticket and no cookie: a bland 404, no brand, and the app never sees the request;
- a wrong `Host` is refused;
- a ticket becomes a `__Host-engage_share` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`,
  no `Domain`) and the redirect drops `t`;
- an expired ticket, a ticket from another key and a fourth device on one ticket are refused;
- a revoked person's cookie stops working within a round;
- `/@fs/etc/hosts`, `/.env`, `/.git/config`, `/__open-in-editor?file=x` and `/x?import&raw??` are
  refused and never reach the app, with a forged `Referer` and `Sec-Fetch-Dest: script`;
- a foreign `Origin` is refused for a call and an upgrade; the tunnel's own passes;
- every response carries `Cache-Control: private, no-store` and `Referrer-Policy: same-origin`,
  whatever the app sent;
- a websocket echoes through with the cookie and is refused without it; a fifth upgrade from one
  device is refused;
- the count is by device, not by address (every request arrives from the same fake);
- the caps: the 51st device sees "This demo is full."; a body over 10 MB is refused;
- expiry, End and "not wanted" stop cloudflared and remove the socket;
- cloudflared dies: restarted with a new address, reported; after three, failed;
- `no-address`: failed with the blocked-network reason after the timeout;
- lost contact with Engage: the door closes and cloudflared stops;
- a leftover cloudflared from `.engage/tunnel.json` is stopped at start, and a process that is not
  ours with that pid is left alone;
- nothing is written to stdout but the JSON-RPC replies; no ticket, cookie or key in stderr.

`tests/build-lan-remote.js` (server, pure functions): a report's `url` other than
`https://<label>.trycloudflare.com` is dropped; the translator gives a link only while wanted,
live, fresh and before `ExpiresAt`; each player gets their own ticket and it matches the vectors;
the host view, the Stage, Claude's view and a builder's view never hold a ticket; End and expiry
force off and refuse `remote: true`; a removed player is in `revoked`; no ticket or key in a log
entry.

### The real-network check, before calling it done

The owner's laptop on home Wi-Fi with a Vite app and a small local backend behind `/api`, in a dev
room; a phone on mobile data; a laptop on another network over Zoom; a tablet on the same Wi-Fi:
- each opens it from Open the demo; the phone from the Stage's join-then-demo code;
- an edit by Claude reaches all of them by hot reload, and the `/api` call works;
- a ticketless second browser gets "Not found." for the page and for a static file it fetched
  before (the Cloudflare cache check, T8);
- removing the phone's player stops it; Stop sharing outside stops everyone within a round;
- closing Claude Code ends it within 30 seconds;
- one try from a company laptop, to see what a filter does with `trycloudflare.com`.

## 6. Open questions for the owner

| # | Question | Recommended answer | Cost if wrong |
|---|---|---|---|
| Q1 | **Is "joined the room" enough to open the demo from the internet?** The join code is on the Stage, so anyone who sees the screen share or the recording can join and get a ticket | **Yes, for the concept test**, with each person's own ticket, names in the panel, Remove revokes, and the 2-hour end. Later, if needed: the host admits each outside person | Too loose: a stranger who saw the code can use the demo and its backend until the host notices or it ends. Too strict (admit each): a click per person, and remote people wait |
| Q2 | **How long does it stay on?** | **2 hours from turn-on**, Keep sharing adds 1 hour, End always closes it | Too long: a forgotten switch leaves the laptop reachable after the session's real end. Too short: it stops mid-demo |
| Q3 | **A device cap?** | **50 devices, 3 per person** | Too low: a large room is turned away ("This demo is full."). Too high: a leaked link spreads further, and the host's upload suffers |
| Q4 | **Cloudflare Access (a sign-in at the edge) now?** | **Later**, as option B, only if an organisation asks | Skipped when needed: scanners and leaked links reach the laptop's door (they get "Not found.", but it is the laptop answering). Done now: every participant signs in with an emailed code, and the owner sets up a Cloudflare account and DNS zone |
| Q5 | **Who may turn it on?** | **The host only** (whoever may drive the session, as for Share demo today), never Claude and never a builder; on in every room by default, with an organisation switch to forbid it added later | Too open: a co-host exposes the owner's laptop. Too closed: a team room cannot use it at all until the org setting exists |
| Q6 | **One link for everyone while outside is on?** | **Yes**: the room's own people get the outside link too | People in the room depend on the internet and the host's upload. The alternative (two links) confuses "Didn't open?" and the count |
| Q7 | **Does wrap-up leave it on?** | **Yes, to its end time**, as the Wi-Fi share (`PLAN.md:13`): the reveal is when people want to try it | Off at wrap-up: remote people miss the reveal. On: the window is longer |
| Q8 | **What is shared outside: the demo only, or mockups too?** | **The demo only** (the `demo` role from S3). Outside people judge mockups from the screenshots | Mockups too: up to three more servers on the internet, often static folders Claude made for itself (the dev 1215 report, `docs/design/parity/PLAN.md:457-474`) |
| Q9 | **The block list on the outside door.** Also block source maps (`*.map`)? | **Block `/@fs/`, dotfiles and editor or inspector endpoints; allow source maps** (the source goes into the room's repo anyway, and debugging needs them) | Too little: a known dev-server hole reaches the laptop's files. Too much: some apps break outside (a monorepo that loads files through `/@fs/`) |
| Q10 | **Is Cloudflare acceptable as a party,** given it sees all traffic, quick tunnels are for testing with no uptime promise, and some company networks block `trycloudflare.com`? | **Yes for the concept test**; move to a named tunnel on the owner's domain (option B) if it becomes a product feature | A quick tunnel throttled or blocked on the day; a participant's company flags the link |
| Q11 | **The live frame on the Stage (section 4): in this release?** | **No, after the real-network check**, with "Show screenshots instead" | Built first: a frame that fails in Safari or shows a broken build on the wall |
| Q12 | **Does it need the Wi-Fi share on first?** | **No, independent**: guest Wi-Fi, where the Wi-Fi share fails, is the main reason to turn it on | Tied together: the host must turn on something that cannot work before the thing that can |
