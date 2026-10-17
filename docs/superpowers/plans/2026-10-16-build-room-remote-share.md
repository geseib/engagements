# Build Room Remote Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One extra switch in the Share demo panel opens the running build to people who are not on the host's Wi-Fi, through a Cloudflare quick tunnel, behind a key per person. While it is live, everyone's Open the demo goes that way.

**Architecture:** The plugin (`src/public/engage-mcp.mjs`) gains a second kind of gateway, bound to 127.0.0.1, fronted by one `cloudflared` child per shared address, and checking per-person key **hashes** that Engage sends on every round. The backend (`build-lan.js` pure, `build-room.js` handlers) stores the switch and the remote report on the existing `BUILD#LAN` row and one key per person on `BUILD#RKEY#<player>`, live only while that player's row is present, not removed, and on the same `ClientId`. The phone fetches its own link from a new phone route; the public view carries only the remote status.

**Tech Stack:** Node (plugin: one ESM file, no dependencies; backend: Lambda, DynamoDB), React 18 (CRA, Jest + RTL). Backend and plugin tests are standalone `node tests/<file>.js` scripts judged by exit code.

**Spec:** `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md` (owner-approved 16 Oct). Design: `docs/design/build-room-remote-share/index.html`, R1 to R4 as revised the same day.

## Global Constraints

- **Remote off changes nothing.** Every existing Wi-Fi share test passes unchanged: `tests/build-room-lan.js`, `tests/engage-lan-gateway.js`, `src/src/__tests__/buildWifiShare.test.jsx`, `buildPlayer.test.jsx`.
- **The public view never carries a remote address or key.** Only `remote: 'live' | 'starting' | 'off'`. A person's link comes only from their own phone route.
- **Only key hashes reach the laptop.** SHA-256, base64url. The raw key exists in the phone's link and nowhere else after minting; the backend stores the hash only.
- **The remote gateway binds 127.0.0.1 only.** Never the Wi-Fi address, never 0.0.0.0.
- **One tunnel per session** (owner, 16 Oct, after the spike), forwarding to the newest of `lanTargets`, with the Wi-Fi share's folder check (F4). Never reopened without need: quick-tunnel creation is rate-limited (`SPIKE.md`).
- **Fail closed:** switch off, session ended, or 30 s without an Engage answer closes the remote gateway and kills `cloudflared`.
- **No network in tests.** A fake `cloudflared` (a node script printing a `trycloudflare.com` line) and a local download server stand in.
- **Plugin version:** one bump for the whole piece, `1.18.0` → `1.19.0`, made in Task 3 (with `LATEST_PLUGIN` in `build-store.js`) so no commit leaves `tests/engage-plugin-version.js` red. Every later plugin task refreshes its PIN to what the test prints; the version stays 1.19.0 until this piece ships.
- **Words:** plain English, sentence case, "phone, laptop or tablet", never "tunnel" on screen. All new strings in `src/src/buildroom/words.js`.
- **Gates before every push:** every `node tests/*.js` (skip `tests/verify-question-set-ui.spec.js`; clear `.aws-sam` first), `cd src && CI=true npx jest`, `npm run lint` (0 errors), `npm run build`. A push to `dev` is the deploy; never also push a tag.
- **Before the push to `test`:** release notes, in-app help, README (CLAUDE.md, "Before every push to test"). Task 9.

## Review Focus

1. **A key outliving its person:** removal (`RemovedAt`), a handover (new `ClientId`), a deleted player row, and a re-mint each drop the old key from `remoteKeys` at the next report. Tests in Task 2.
2. **The public view leaking:** no `?k=`, no `trycloudflare.com` in `/build-play` state for any status. Test in Task 1.
3. **Unknown-key checks as a lever:** at most one Engage check per second per plugin; a wrong hash never checked twice. Test in Task 4.
4. **Device count by socket:** through the tunnel every socket is 127.0.0.1; devices must be counted by the device cookie. Test in Task 4.
5. **`cloudflared` left running:** off, session end, Engage silent, and plugin exit each kill it; a pid file from a crashed run is cleaned at start. Test in Task 5.
6. **A tampered download:** a file whose SHA-256 differs is deleted and never executed. Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/design/build-room-remote-share/SPIKE.md` (new) | Task 0's findings: output format, tunnel limits, pinned version and hashes |
| `lambda-functions/game/build-lan.js` (modify) | remote status, report shape, key hashing, live keys, views |
| `lambda-functions/game/build-store.js` (modify) | `SK.rkey(name)`, row kind `buildRemoteKey`, `room.rkeys` |
| `lambda-functions/game/build-room.js` (modify) | `hostShare` `remote`, `shareReport` remote block + `remoteKeys`, agent route `share/remote-check`, phone route `remote-key` |
| `src/public/engage-mcp.mjs` (modify) | remote gateway, key check, device count, cloudflared fetch/spawn/kill, Claude's words, `VERSION` 1.19.0 |
| `src/src/buildroom/wifiShare.js` (modify) | `remoteState(lan, now)` |
| `src/src/buildroom/BuildWifiShare.jsx` (modify) | R1 switch, R2 who-opened list, R3 starting/failed |
| `src/src/buildroom/BuildPlayer.jsx` (modify) | `OpenDemo` R4 a–d, fetch own link |
| `src/src/buildroom/words.js` (modify) | new strings |
| `tests/build-room-remote.js` (new) | backend pure + handler |
| `tests/engage-remote-gateway.js` (new) | plugin gateway against a fake Engage, a real app and a fake cloudflared |
| `tests/engage-cloudflared-fetch.js` (new) | download, hash check, lifecycle |
| `src/src/__tests__/buildRemoteShare.test.jsx` (new) | host panel and phone states |
| `src/src/config/help/*.js`, `README.md`, `RELEASE_NOTES.md` | Task 9 |

---

### Task 0: Spike — what a quick tunnel really does (no product code)

The spec leaves three facts unchecked. Settle them before building on them. Done on a laptop or this container if outbound to Cloudflare is allowed; if neither, ask the owner to run the commands and paste the output.

- [x] **Step 1:** Pick the latest `cloudflared` release on GitHub (`cloudflare/cloudflared`). Record the version and the SHA-256 of these assets: `cloudflared-darwin-arm64.tgz`, `cloudflared-darwin-amd64.tgz`, `cloudflared-linux-amd64`, `cloudflared-linux-arm64`, `cloudflared-windows-amd64.exe`. Compute the hashes yourself from the downloaded files; compare with the release's published checksums.
- [x] **Step 2:** Run `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` against a trivial local server. Record the exact line that carries the `https://…trycloudflare.com` address (stdout or stderr, its format), how long until it answers, and what it prints when it fails (no network, Cloudflare refusing).
- [x] **Step 3:** Open **four at once** from one machine, then stop and reopen them three times in a minute. Record whether any is refused or rate-limited.
- [x] **Step 4:** Through one tunnel, check a websocket upgrade works (hot reload depends on it) and confirm that a request carries `CF-Connecting-IP` (only to document it; nothing will trust it).
- [x] **Step 5:** Write `docs/design/build-room-remote-share/SPIKE.md` with all of the above. **Stop and tell the owner** if four tunnels at once are refused, or the address line cannot be parsed reliably; the plan's Task 5 depends on both.
- [x] **Step 6:** Commit: `Build Room remote share: spike findings (cloudflared output, limits, pinned hashes)`.

### Task 1: Backend, pure: remote status, report, keys, views (`build-lan.js`)

**Files:** modify `lambda-functions/game/build-lan.js`; create `tests/build-room-remote.js`.

Interfaces to add and export:

```js
const KEY_HASH_RE = /^[A-Za-z0-9_-]{43}$/;            // SHA-256, base64url, no padding
function hashKey(key) { return crypto.createHash('sha256').update(String(key)).digest('base64url'); }
function mintRemoteKey() { const key = crypto.randomBytes(16).toString('base64url'); return { key, hash: hashKey(key) }; }

/** 'off' | 'starting' | 'live' | 'failed', on the same freshness rule as lanStatus. */
function remoteStatus(row, now)

/** Keys that open the remote gateway now: [{ hash, player }]. */
function liveRemoteKeys(rkeys, players) {
  const byName = new Map(players.map((p) => [p.PlayerName || p.playerName, p]));
  return rkeys.filter((k) => {
    const p = byName.get(k.PlayerName);
    return p && !p.Removed && !p.RemovedAt && (!p.ClientId || p.ClientId === k.ClientId) && KEY_HASH_RE.test(k.Hash);
  }).map((k) => ({ hash: k.Hash, player: k.PlayerName }));
}

/** A person's link: the remote origin for this target plus ?k=<their key>. */
function remoteLink(row, localUrl, key)   // RemoteAddress + localUrl's path/search/hash + ?k=; '' unless live
```

`normalizeReport` accepts an optional `remote: { status, address, target, error, devices }`: `status` in `STATUSES`; `address` an `https://<name>.trycloudflare.com` origin and nothing else (required when live); `target` a loopback URL (`isLoopbackUrl`); `devices` an object of player name → integer 0–50, at most 200 entries. It returns `RemoteStatus`, `RemoteAddress`, `RemoteTarget`, `RemoteError`, `RemoteDevices`.

`lanPublicView(room, now)`: adds `remote: remoteStatus(...)` when `room.lan.RemoteWanted`, and while it is live, `remoteSince` (when this tunnel went live: the phone's cue that a saved link is stale) and `remotePath` (path, search and hash of the newest agent link, as the Wi-Fi `open` picks it; not secret). Never the address, never a key; when that is `'live'`, the Wi-Fi `open` is left out (everyone takes the remote route); while `'starting'` or `'failed'`, it is kept.

`lanHostView`: adds `remote: { wanted, status, error, people: [{ name, devices }] }`, people sorted by devices descending then name.

- [ ] **Step 1: Write the failing tests** in `tests/build-room-remote.js` (pure section): `RemoteLiveSince` set on the report that first says live and kept while live; `hashKey` stable and 43 chars; `mintRemoteKey` unique over 1000 calls; `remoteStatus` for not wanted / wanted and stale / fresh live / fresh failed; `liveRemoteKeys` drops removed, missing, other-`ClientId` and malformed hashes, keeps a player row with no `ClientId`; `normalizeReport` rejects a non-trycloudflare remote origin, an `http:` one, devices out of range; `lanPublicView` never contains `?k=` or `trycloudflare` in its JSON for any remote status, drops Wi-Fi `open` only while remote is live; `lanHostView` people ordering.
- [ ] **Step 2:** Run `node tests/build-room-remote.js`; expect failures.
- [ ] **Step 3:** Implement in `build-lan.js`.
- [ ] **Step 4:** Run it and `node tests/build-room-lan.js`; both pass.
- [ ] **Step 5:** Commit: `Remote share: pure rules for status, keys and views`.

### Task 2: Backend, handlers (`build-store.js`, `build-room.js`)

**Files:** modify `build-store.js` (add `SK.rkey = (name) => \`BUILD#RKEY#${name}\``; row kind `buildRemoteKey` in the classifier near `build-store.js:354`; collect into `room.rkeys` near `:515`), `build-room.js`; create `tests/build-room-remote-routes.js` (the handler, on the harness of `tests/build-crew.js`, which drives `build-room.js` against a fake DynamoDB; the pure suite stays pure). The report's answer carries `remoteWanted`/`remoteKeys` only while remote is wanted, so `tests/build-room.js`'s exact answers stay unchanged. `buildLan`'s sealed fields gain `RemoteAddress`, `RemoteError`, `RemoteDevices` in all three copies of `tenant-crypto.js`.

- [ ] **Step 1: Tests first.**
  - `hostShare({ on: true, remote: true })` sets `RemoteWanted` and clears `RemoteStatus/RemoteAddress/RemoteTarget/RemoteError/RemoteDevices`; `{ on: false }` clears `RemoteWanted` too; `{ remote: false }` alone turns remote off and leaves Wi-Fi on; `remote: true` on an ended session is 409.
  - `shareReport` with a `remote` block stores it; its answer carries `remoteWanted` and `remoteKeys` (hashes only, from `liveRemoteKeys`), and `remoteKeys` is `[]` when remote is not wanted. A second reporter (the 1.18.0 rule) gets `remoteWanted: false`.
  - Agent route `POST share/remote-check { hash }` → `{ ok: true, player }` for a live key, `{ ok: false }` otherwise; host and phone roles get 403.
  - Phone route `POST /build-play/remote-key` → `{ origin, key, since }` (the tunnel's origin, a **freshly minted** key, and `RemoteLiveSince`); the phone builds `origin + remotePath + ?k=key` itself, so a new path from Claude needs no new key; the row (`Hash`, `ClientId`, `PlayerName`, `CreatedAt`; **hash only**, per the spec) is overwritten, so the previous key for that person stops working at the next report; a handover (new `ClientId` on the player row) drops the old hash from `remoteKeys` even before the new device asks; 409 `{ code: 'not-live' }` unless remote status is live. Idempotence lives on the phone, which keeps its link (Task 8), not on the server, which never holds a raw key.
  - Removal needs no new code: `liveRemoteKeys` already drops a player with `RemovedAt` (set by `remove-player.js` and `crewBuilderRemove`). Test both doors.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. Routes: `share/remote-check` next to `share/report` (`build-room.js:2681`, agent only); `remote-key` in `routePlay` (`:2779`), after `me` is resolved. `announce` when `RemoteStatus`, `RemoteAddress`, `RemoteTarget` or the devices change, as `shareReport` already does for the Wi-Fi fields.
- [ ] **Step 4:** Run `node tests/build-room-remote.js`, `node tests/build-room-lan.js`, and the tenancy suites (`tests/no-global-partition-literals.js`, `tests/tenant-session-scoping.js`).
- [ ] **Step 5:** Commit: `Remote share: switch, report, per-person keys, remote-check and remote-key routes`.

### Task 3: Plugin: generalise the gateway's lock (refactor, no behaviour change)

**Files:** modify `src/public/engage-mcp.mjs` (`openGateway`, `hasKey`, around `:2544-2623`).

`openGateway(local, port, address)` becomes `openGateway(local, port, address, lock)` where `lock` is `{ admit(req, url) → { cookie, location } | null, allowed(req) → bool, seen(req) }`. The Wi-Fi share passes today's behaviour as `wifiLock`. Nothing else changes.

- [ ] **Step 1:** Run `node tests/engage-lan-gateway.js`; record it green.
- [ ] **Step 2:** Refactor.
- [ ] **Step 3:** Run it again; still green, unchanged.
- [ ] **Step 4:** Commit: `Plugin: the Wi-Fi gateway's lock as a parameter (no change in behaviour)`.

### Task 4: Plugin: the remote gateway and its lock

**Files:** modify `engage-mcp.mjs`; create `tests/engage-remote-gateway.js` (copy the harness of `tests/engage-lan-gateway.js`: a fake Engage, a real app process in the project folder; set `ENGAGE_CLOUDFLARED` to a fake that prints `https://test-abc.trycloudflare.com` and stays up).

The remote lock:
- `admit`: `?k=` whose `hashKey` is in the current set → set `engage_rk=<key>` and `engage_dev=<random 12 bytes>` (if absent), both `HttpOnly; Secure; SameSite=Lax; Path=/`, 302 to the same URL without `k`.
- unknown `?k=`: if not in the "wrong" set and the last check was ≥ 1 s ago, `POST share/remote-check`; a yes adds it to the set; a no adds it to "wrong". **Within that second, the request waits** for a round that brings the key (up to `ENGAGE_REMOTE_WAIT_MS`, 6 s; at most 200 waiting) instead of meeting the locked page: a room pressing together right after remote goes live is the ordinary case, not an attack. A key still unknown after the wait gets the locked page and is not marked wrong.
- `allowed`: the `engage_rk` cookie's hash is in the set, and the path does not start with `/@fs/` or `/@id/` and does not end in `.map`. Refused requests get the locked page (403), upgrades a 403 line, exactly as Wi-Fi.
- `seen`: `devices[player].add(engage_dev)` with the same 5-minute window as `lan.seen`. The report sends counts per player.
- Neither cookie is forwarded to the app (as `withoutOurCookie` does for `engage_lan`).

- [ ] **Step 1: Tests first.** Binds 127.0.0.1 only (connecting on another local address fails); no key → locked page; a hash in `remoteKeys` → 302 then the app; a key not yet in the set → one check, then admitted; 20 wrong keys in a second → at most one check; the same wrong key twice → no second check; `/@fs/etc/passwd`, `/src/main.js.map` refused with a key; websocket upgrade with and without a key; two devices (two cookie jars) with one key → `devices: { Sam: 2 }` in the next report; the key's hash dropped from `remoteKeys` → the next request with that cookie is refused; the Wi-Fi gateway unaffected throughout.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement: `remote = { gateway, target, keys: Set, wrong: Set, lastCheckAt, devices: Map }`; `syncRemote(wanted, targets, keys)` opens **one** remote gateway on a port from `ENGAGE_REMOTE_PORT` (default 4950) when wanted, and points it at the **last** of `targets` after the same folder check as `syncGateways` (a target that fails it leaves the gateway forwarding nowhere, answering the locked page's "not answering" words, and the error set). A new target changes `remote.target` only: the listening port, and so the tunnel, stays. Called from `lanRound` after `syncGateways`, with `answer.remoteWanted` and `answer.remoteKeys`; the report gains the `remote` block. Tests add: a new target switches forwarding without closing the listener (same port, an open websocket to the old target is closed).
- [ ] **Step 4:** Run the new suite and `tests/engage-lan-gateway.js`.
- [ ] **Step 5:** Commit: `Plugin: the remote gateway, per-person keys, devices per person`.

### Task 5: Plugin: getting and running `cloudflared`

**Files:** modify `engage-mcp.mjs`; create `tests/engage-cloudflared-fetch.js`.

- `CLOUDFLARED = { version, assets: { 'darwin-arm64': { file, sha256 }, … } }` from SPIKE.md.
- `ensureCloudflared()`: `ENGAGE_CLOUDFLARED` (tests) wins; else `~/.engage/bin/cloudflared-<version>[.exe]` if present and its hash matches; else download from `ENGAGE_CLOUDFLARED_BASE` (tests) or `https://github.com/cloudflare/cloudflared/releases/download/<version>/`, follow redirects, write to a temp file, **check SHA-256 before anything else**, then unpack (`tar -xzf` for the macOS `.tgz`), `chmod 0755`, rename into place. A mismatch deletes the file and sets the remote error "Couldn't download Cloudflare's tunnel tool (it did not match the expected file)."
- `startTunnel(port)`: **one per session**. Spawn with `--no-autoupdate --url http://127.0.0.1:<port>`; parse the address from stderr with the regex from SPIKE.md; no address in 30 s → error. Record the pid in `~/.engage/cloudflared.pids`.
- **Ready check before `live`** (SPIKE.md): poll `https://cloudflare-dns.com/dns-query?name=<host>&type=A` (`accept: application/dns-json`) every 2 s until an A record, then one GET through the tunnel to that IP (a pinned `lookup`, never the system resolver) that reaches the gateway (any status the gateway itself gives); 60 s overall → failed "Cloudflare did not finish setting up the remote link." `ENGAGE_DOH_URL` overrides the DNS endpoint in tests.
- **Exit 1 with `status 429`** in stderr → failed with the 429 words (spec §4.1); the next attempt waits at least 60 s, whatever the switch does.
- **Never reopened without need:** only switch-on (after off), a tunnel that exited, or a ready check that failed opens a new one.
- `stopTunnel` on remote off, session end, Engage silent (the existing `LAN_LOST_MS` branch), and on `process.on('exit')`. At plugin start, kill pids from the file that are still `cloudflared` processes, then clear it.
- Status: `starting` from switch-on until every tunnel has its address; `failed` with a plain reason (download failed, address never came, process exited).

- [ ] **Step 1: Tests first** (local HTTP server as the download base and as the DoH endpoint, a fake `cloudflared` script): a 429 exit gives the 429 words and no reopen for 60 s; a target change never respawns the tunnel; `live` is reported only after the DoH answer and the request through; a good file is fetched once and reused; a bad hash is refused, deleted, never run, error set; a fake that never prints an address → `failed` after the timeout (`ENGAGE_TUNNEL_TIMEOUT_MS` short in tests); remote off kills the child; Engage silent past `LAN_LOST_MS` kills it; a stale pid file entry is cleaned at start; plugin exit kills the child.
- [ ] **Step 2:** Run; expect failures. **Step 3:** Implement. **Step 4:** Run all three plugin suites.
- [ ] **Step 5:** Commit: `Plugin: fetch a pinned cloudflared, check it, run one per session, live only when reachable, never leave one behind`.

### Task 6: Plugin: what Claude is told; the version

**Files:** modify `engage-mcp.mjs` (the Wi-Fi share instruction at `:554`, `:2387`, `:3381`); `tests/engage-plugin-version.js`.

- [ ] **Step 1:** Add, where the Wi-Fi sharing instruction is given, the remote lines: when the host opens the demo to people who are not here, show a **built copy** (`vite build` then `vite preview`, or the project's equivalent) rather than the dev server; use websockets or polling, **never server-sent events**. Extend the existing test that asserts the instruction text (find it with `grep -rn "SHARING ON WI-FI" tests`).
- [ ] **Step 2:** (`VERSION` is already 1.19.0, since Task 3.) Run `node tests/engage-plugin-version.js`, set PIN to what it prints.
- [ ] **Step 3:** Run every plugin suite (`tests/engage-*.js`).
- [ ] **Step 4:** Commit: `Plugin 1.19.0: remote share`.

### Task 7: Host panel (R1–R3)

**Files:** modify `wifiShare.js`, `BuildWifiShare.jsx`, `words.js`; create `src/src/__tests__/buildRemoteShare.test.jsx`. Load the `engage-design` skill first; reuse the panel's existing classes and tokens.

- `remoteState(lan, now)` → `'off' | 'starting' | 'live' | 'failed'` from `lan.remote`.
- R1: the switch row under the address (`role="switch"`, `aria-checked`), the words from the mockup, posting `{ remote: true|false }` to the share route.
- R2: when live, header "Demo shared, here and remote"; one count; the people list (name, "· N devices", more than one marked), Remove on a person with more than one device (calls the existing remove-player); more than 3 → "and N more".
- R3: starting and failed lines, the failed reason from `lan.remote.error`.

- [ ] **Step 1:** Tests first: each state renders its words; the switch posts `remote`; the list orders and collapses; Remove calls remove-player with the name; Wi-Fi-only rendering unchanged (existing `buildWifiShare.test.jsx` untouched and green).
- [ ] **Step 2–4:** Run (fail), implement, run `CI=true npx jest buildRemoteShare buildWifiShare buildWords`.
- [ ] **Step 5:** Commit: `Host: the remote switch, who opened it, starting and failed`.

### Task 8: Phone (R4 a–d)

**Files:** modify `BuildPlayer.jsx` (`OpenDemo`, `:742`), `words.js`; extend `buildRemoteShare.test.jsx`.

- When `lan.remote === 'live'`: use the link saved in `localStorage` under `remoteLink_<gameId>_<clientId>` (try/catch around storage); if none, call `POST remote-key` once and save `{ origin, key, since }`. Every call mints a new key and ends the old, so call it only when nothing is saved, the view's `remoteSince` differs from the saved `since` (the tunnel was reopened), or after a handover. The link is `origin + remotePath + ?k=key`, rebuilt as `remotePath` changes. Render the same button with no "Same Wi-Fi only." line; while fetching, the button is not shown (never a dead link).
- `'starting'`: today's Wi-Fi button and line, plus "Not here? Opening soon."
- After pressing with remote live: "Didn't open?", "The host may have stopped sharing, or the app on their laptop is restarting.", Try again. Never `wifiSameAdvice`.
- `'off'` or absent: exactly today.

- [ ] **Step 1:** Tests first, one per state, plus: the link is never rendered from the public view; one fetch for two renders.
- [ ] **Step 2–4:** Run (fail), implement, run `CI=true npx jest buildRemoteShare buildPlayer`.
- [ ] **Step 5:** Commit: `Phone: Open the demo goes the remote way while remote is live`.

### Task 9: Docs, then dev, then test

- [ ] **Step 1:** Full gates (Global Constraints). Fix anything red.
- [ ] **Step 2:** Push to `dev` (the deploy). Name the commit and tier in the reply.
- [ ] **Step 3: Walk on dev with the owner** (Claude cannot run the plugin on the owner's laptop): update the plugin from Connect; share; turn remote on; a phone on mobile data opens the demo; the same link pasted into a second browser shows "2 devices"; Remove ends it within a round; a handover gives the new device a working button and the old one the locked page; remote off closes the address within one round. Note anything off and fix before test.
- [ ] **Step 4:** Release notes entry (date, dev commit, New, Fixed, **What to look at** = the walk above, numbered, **Known gaps** = spec §6); in-app help (`src/src/config/help/*.js`) for hosts and players, `helpContent.test.js` green; README if a newcomer would now be wrong. `node tests/release-notes.js`.
- [ ] **Step 5:** Merge into `test` and push (the deploy). Not prod: prod waits for the owner's look at test.
