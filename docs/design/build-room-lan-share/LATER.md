# Build Room: ideas set aside for later

Gathered 2026-10-07 while designing [the Wi-Fi share](PLAN.md). None of this is approved or built.
Each one needs its own design and the owner's answers before work starts.

## Reaching people who are not on the host's Wi-Fi

The Wi-Fi share fails in two cases: a remote participant (Zoom), and a network that keeps devices
apart (hotel, conference and corporate guest Wi-Fi often do). Three ways out, discussed 2026-10-07.

| Way | Live? | Local backends (DuckDB, an API server) | Exposure | Cost |
|---|---|---|---|---|
| **Tunnel** (`cloudflared tunnel --url http://localhost:<port>`, free, no account) | Yes, edits show at once | **Work**: the tunnel reaches the laptop, so everything on it runs as in the room | Anyone on the internet with the link reaches the laptop while it is up | cloudflared installed once per laptop; a new address each session |
| **Hosted preview per decision** (GitHub Pages, Vercel or similar) | No, a snapshot per deploy, a minute or two behind | **Hard**: only what builds to static files, or what the host has set up to run there | Nothing on the laptop is reachable | A deploy account and setup per room |
| **Engage hosts the preview** (the plugin uploads the built files to Engage, served per room to people who joined) | No, a snapshot per decision | **Hard**, as above | Nothing on the laptop is reachable | Storage; must be served from a separate domain (e.g. `builds.seibtribe.us`), never Engage's own, or the room's code would run beside the host's sign-in tokens |

Owner, 2026-10-07: the tunnel is the interesting one *because* it keeps local backends working;
Pages and Vercel make those "super challenging". Before choosing it, the owner called it a
security issue, so any design must answer that first. Starting points:

- **Share a hardened door, not the dev server.** A dev server serves more than the app: Vite had
  several 2025 bugs where a crafted request read files outside the project (the `/@fs/`
  path-traversal reports), and it serves source maps and the hot-reload channel. The Wi-Fi
  gateway's lock (a random key and a cookie) could front the tunnel too, so the public address
  alone opens nothing.
- **Short-lived:** the tunnel lives only while the host's switch is on, and ends at wrap-up.
- **Cloudflare Access** (needs a Cloudflare account) could put a sign-in in front of the tunnel
  instead of the key.

A tunnel is https, so it would also let the wall **frame the live build**, which an https page
cannot do with `http://localhost` or `http://192.168.*`.

**The repo link.** The owner's first fallback was to push to the remote at every commit and always
show that link. It is worth keeping alongside whichever of the above wins: it is the record of what
was built and lets people take it home. But it shows code, not the app, so it does not replace a
way to open the build.

## https on the Wi-Fi

The Wi-Fi share is plain http, so someone capturing traffic on the same network could read the key.
That is acceptable on the owner's own network for a concept test, not at a conference. A
certificate for a LAN address needs either a local CA on every phone (impractical) or a real
domain pointed at the private address with a certificate obtained by DNS challenge. Both are
real work. https would also let the wall frame the build.

## Making the backend work behind the gateway

The gateway forwards whole ports and never rewrites response bodies, so a page that calls
`http://localhost:<other port>` directly breaks on a phone. Today Claude is told to proxy `/api`
through the dev server. Later: the gateway could map known backend ports and rewrite those
absolute URLs, or Claude could scaffold every Build Room project with a single-origin layout.

## The other three pieces the owner named, 2026-10-07

### The contribution record (next, likely)

Owner: "they are not competing per se but we do keep track of each person contributions. this show
how much ideas are being listened to how much encouragement of different voices, and all
participating."

Settles the parked People / scores step (`docs/design/build-room-host-redesign/scores.html`):
counts, with no points and no ranking, plus:
- **Listened to:** of each person's ideas, how many led to a vote, a decision or something built.
  This needs the History link `RelatesTo` (idea → vote → decision → screenshot), which is also
  still to build.
- **Different voices:** how many different people's ideas shaped the decisions.
- **Everyone taking part:** who has not spoken yet, so the host can invite them in.

Open: host's eyes only, the wall, the report, or all three.

### Several rooms from one starter (B)

Owner: "it will have to operate as multiple build rooms all starting from the same setup, meaning
if a need to break people into different room at an event i would randomly assign people (or
manually assign them to different rooms that all have the same starter (i.e. build a site that
teaches kid how AI works)."

### Teams in phases (C)

Owner: "close to the idea ... they key is that 1 person on each team will need claude code and
that person will need to be given the host like entitlements for that room."

The room together for the opening, teams take pieces of the build, then back together for the
reveal.

**B and C share one building block:** a room made from a template, optionally linked to a parent.
B is sibling rooms from one starter; C is child rooms under a parent, each with a team lead who
runs Claude Code and holds host-like rights for that child room. Design them together, once.

## Where the plugin is installed

Today `--install-plugin` installs Engage for the whole user (`~/.claude`), so its tools load in
every Claude Code session on the laptop, including unrelated projects. Proposed 2026-10-07, not
yet answered by the owner:
- keep the marketplace registered once per laptop, at user level;
- **enable the plugin per project with local scope** (`.claude/settings.local.json`, not
  committed) in the `~/build-room/<name>` folder the Connect command creates.

That keeps other projects clean, never commits a path on the host's laptop into the room's repo,
and gives a crew builder or team lead the same one-paste setup. Not project scope: that writes
`.claude/settings.json` into the repo, pointing at a marketplace that exists only on the host's
machine. **Check first** that `claude plugin install --scope local` behaves this way on the
current Claude Code.

## Push and teamwork (next spec after talking points) — owner rulings 2026-10-08/09

- **Push rule:** every commit is pushed straight away to `build-room/<code>` on origin, never to main; the host screen shows "Pushed" or "N not pushed"; wrap-up opens a pull request into main for the host to merge. The plugin's `commit` tool stops being "never pushes".
- **Lasting artifacts live in the repo and the report**, never in DynamoDB (every DynamoDB row carries the session ttl).
- **Crew work is a pull request.** Early look → PR (`share_pr`) → host review card → **Try it** → merge / ask for changes / put it to the room.
- **Try it:** the host's Claude checks the builder's branch out into a separate worktree (`.engage/try/<builder>-<task>`), runs it on its own port, and shares it over the Wi-Fi gateway as "<Name>'s version" beside the main build. The host's own folder never switches, so nothing is committed or stashed for it. Needs the Run crew code switch On; Off means screenshots and review only. Closing a try stops its server and removes the worktree; session end closes all.
- **If an in-place switch is ever unavoidable:** checkpoint commit first (pushed per the push rule), never a stash.
- **Talking points in a crew:** every builder's Claude may post points, tagged by builder; Research and Ideas requests go to the host's Claude only.
- **Crew parity (owner 2026-10-09):** the crew gets the same help as the host: their Claude proposes probing questions, options and mockups and shows them. A builder's room question lands on the host's screen to approve, tagged "Priya asks"; the builder's Claude gets the results as the host's does. (Builders' Research/Ideas buttons are in the talking-points spec.)
