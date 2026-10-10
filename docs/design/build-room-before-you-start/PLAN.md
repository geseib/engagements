# Build Room: before you start — plan

## Owner decisions, 2026-10-10 (these override the mockup where they differ)

1. **No install command on the public page.** It appears only when signed in,
   in the room's Connect window, as today. The public "Before you start"
   section lists what you need (Claude Code signed in, Node 18+, git, a
   terminal on the laptop that runs Claude), the steps in words, and what it
   writes on the laptop, and says the command is in the room's Connect window
   once you are signed in. (Open question 1: answered "no".) Because the
   command now lives in a room, the steps run Create a room → Install the
   plugin → Paste the start command.
2. **No time estimate.** "About five minutes …" was never measured; dropped.
   (Open question 2.)
3. **New Build Room page: option A**, the one line about Node 18+ and git with
   a link to the public section.
4. **Connect window step 1 shows the plugin version** from
   `room.plugin {running, latest, outdated}` in the three drawn states (not yet
   known; up to date with the command folded; out of date with Copy as the one
   orange). The empty room's "How a Build Room works" first step names the
   install, as suggested below. (Open question 5: fold, as drawn.)

Reviewer, 2026-10-10: the public Build Room page names the plugin and gives no
install or connection details; they appear only after a room exists. Owner,
earlier: "clear setup/requirements for Claude Code before starting: Claude
Code, Node 18+, the plugin, where to run the command." Mockup: `index.html`.

## Facts the copy rests on (read from code, 2026-10-10)

| Claim | Source |
|---|---|
| Install command has no key, can be shown before a room exists | `buildHostApi.js:271-283` |
| It downloads `~/.engage-mcp.mjs` from the site | `pluginInstallCommand` |
| It writes the plugin to `~/.engage/claude-plugin/` (`claude-plugin-dev/`, `-test/` off prod): commands, hooks, skill, `.mcp.json` | `engage-mcp.mjs` installPlugin 3297-3300, writePlugin 3255 |
| It writes the site address to `~/.engage/config.json` (`config-dev.json`, `config-test.json`) | `globalFile` :95, installPlugin |
| It adds a local marketplace and installs the plugin in Claude Code (`claude plugin marketplace add`, `claude plugin install`) | installPlugin |
| Same command updates: a different version is rewritten and `claude plugin update` run; output says restart Claude Code | installPlugin |
| Per room: `~/build-room/<name>`, git on main, README.md, DECISIONS.md, .gitignore | `startCommand` :301, startProject :2675 |
| `.engage/` holds the key, git-ignored (`*` in its own .gitignore) | connect :1599-1602 |
| `.claude/settings.local.json` turns this tier's plugin on for the folder, never committed | usePluginHere :2554 |
| Git is required: connect fails "git is not installed on this machine" | startProject |
| Hooks act only in a connected folder: hidden snapshot per turn (never a commit on the branch), one plain line per tool to the room | hooks.json in writePlugin; :2812, :2844 |
| Node 18 or later | `words.js` installNote |
| Version data: `room.plugin = {running, latest, outdated}`; running = last `x-engage-plugin` header; latest = LATEST_PLUGIN 1.16.0; outdated also when Claude called in without a version | `build-store.js:830-860, 1503` |
| Host's "Build Room" entry is on the Welcome screen, `/build` | `WelcomeScreen.jsx:217-222` |

## Frames

1. **Public page, "Before you start"** (1440 and 375). Replaces the "What you
   need" section (`marketing/BuildRoomPage.jsx:84-96`) in place, `id="before-you-start"`.
   What you need (4) · How long · Three steps (install command shown, with
   Copy and "Read the file first" → `/engage-mcp.mjs`) · What it changes on the
   laptop (once / each room) · "Nothing else." The amber kicker is the one
   orange; no orange button inside the section.
2. **Connect window, step 1 with the version** (660 and 375), three states:
   - *Not yet known* (`!agent.lastSeenAt`): "Latest 1.16.0. Claude's version shows here once it connects." Mint stays the primary, as today.
   - *Up to date* (`running && !outdated`): green tick, "Claude's plugin 1.16.0 · The latest." Command folds behind "Install on another laptop". No orange.
   - *Out of date* (`outdated`): title becomes "Update the Engage plugin", "Claude's plugin 1.15.0 · Latest 1.16.0" (or "older than 1.16.0" when running is empty), Copy is the primary and takes focus (`atInstall`).
   The line says "Claude's plugin", not "this laptop": the browser need not be the laptop running Claude.
3. **New Build Room page, A/B.** A: one line under the subtitle, "The laptop
   that runs Claude Code needs Node 18 or later and git." + link "Before you
   start" → `/build-room#before-you-start`. B: as today. **Recommend A.** A full
   checklist was rejected: wrong form, and possibly the wrong device.

## Strings

Reused from `words.js`: `connectIntro`, `installNote`, `macAllow`, `newFolder`,
`makesFolder`, `pluginOutdated` / `pluginUpdate` (Host screen, unchanged).

New, public page (`marketing/BuildRoomPage.jsx`, local constants):
- kicker `Before you start`; title `Set up the host's laptop once.`
- lead `Only the host needs this. Everyone else joins from laptops, tablets and phones with a QR code or session code, and needs no account.`
- `What you need` ·
  `Claude Code, installed and signed in` / `On the laptop that will run the build.` ·
  `Node 18 or later` / `Check with node --version.` ·
  `Git` / `Each room's project is a git repository.` ·
  `A terminal on that laptop` / `The commands are for macOS and Linux.`
- `About five minutes the first time` / `After that, under a minute per room.`
- `Three steps` ·
  `Install the Engage plugin` / `Once per laptop. Run this in a terminal:` / `It downloads one file from this site and adds the plugin to Claude Code. Every room's Connect window shows the same command: run it again to update.` / link `Read the file first` ·
  `Create a room` / `Sign in as a host and choose Build Room. Give it a title; the room can decide what to build.` ·
  `Paste the start command` / `In the room, open Connect Claude Code, mint a key and copy the start command. Paste it into the terminal:` / `It makes the project folder and starts Claude Code in it. Then type /engage:kickoff.`
- `What it changes on the laptop` · `Once, when you install` · `Each room` · the seven path lines as drawn · `Nothing else. The plugin acts only in a folder connected to a room. There it saves a hidden git snapshot after each turn and sends the room one plain line per step Claude takes.`

New, `words.js` (Connect window):
- `pluginLatest: (v) => \`Latest ${v}\``
- `pluginUnknown: "Claude's version shows here once it connects."`
- `pluginRunning: "Claude's plugin"` ; `pluginOlder: (v) => \`older than ${v}\``
- `pluginCurrent: 'The latest.'`
- `pluginUpdateTitle: 'Update the Engage plugin'` (title when outdated; else the existing `Check for the latest Engage plugin`)
- `pluginRerun: 'Run it again, then restart Claude Code in the project folder.'`
- `installElsewhere: 'Install on another laptop'`

New, create page: `needLine: 'The laptop that runs Claude Code needs Node 18 or later and git.'`, link `Before you start`.

Suggested fix to `HOW_IT_WORKS[0]` (empty room strip), not drawn: `Connect Claude Code: install the plugin, then paste one command.` (today it skips the install).

## Files that change

- `src/src/marketing/BuildRoomPage.jsx` + `.css`: the section; command from `pluginInstallCommand({origin, api: apiBase()})`, paths and slash names from `siteTier()` / `pluginSlash` (dev: `claude-plugin-dev`, `config-dev.json`, `/engage-dev:connect`). Import from `buildroom/buildHostApi.js` only if it does not pull the host bundle into the marketing chunk; otherwise move `siteTier`/`pluginName`/`pluginInstallCommand` to a small shared module.
- `src/src/buildroom/BuildRoomPage.jsx` ConnectPanel step 1 (~:3776-3788): version line from `room.plugin` and `agent.lastSeenAt`; title, fold, primary by state. Create page (~:335): need line.
- `src/src/buildroom/BuildRoom.css`: `.brm-ver` (+ `.brm-ver-old` in `--danger-text`, `.brm-ver-ok` success text), `li.is-old .brm-n`.
- `src/src/buildroom/words.js`: strings above.
- No backend change: `room.plugin` already carries both values. Tests: the words/palette contract tests that pin step 1's title and the marketing page's sections.

## Open questions for the owner

1. Show the install command on the public page (drawn), or only name the steps and send people to a room's Connect window?
2. "About five minutes / under a minute per room" is an estimate. Measure, or drop the time line?
3. Windows: the commands use curl, `~` and `mkdir -p`. Say "macOS and Linux" (drawn), add WSL, or test PowerShell?
4. Should the page say how to remove it (`/plugin uninstall`, delete `~/.engage`)? Not drawn; the uninstall path is untested.
5. Up to date: fold the command away (drawn) or keep it shown as today?
