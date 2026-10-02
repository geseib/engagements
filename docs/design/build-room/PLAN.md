# Build Room: build with Claude Code, together

*Plan, contract and task list. Written 2026-10-02. The prototype is `index.html` in this
folder. Open it in a browser (`python3 -m http.server 8124 --directory docs/design`).*

## 1. The idea in one paragraph

A host is in front of a room with their laptop on the projector and **their own Claude Code**
running in a terminal. Claude builds something real: a site, a tool, a feature. Some
decisions the host simply makes. Others belong to the room. When Claude reaches one of those,
it **asks the room through Engage**:

- **Ideas** is Call & Answer: everyone suggests, everyone votes, the best suggestion wins.
- **Choose** is a poll: Choice A / B / C. Claude often puts mockups on screen labelled to
  match.
- **Rate** is a 1–5 pulse, for example "how close is this to what we want?".

The host shapes every result before it reaches Claude. They edit the winning text, merge
ideas, and add what people said out loud. Then they press **Send to Claude**. Claude picks up
the direction on its next tool call and keeps building. Everything is written to a
**timeline**: Claude's progress posts, decisions, verbal notes and ideas from the room. When
the session wraps, the **report** tells the story of what was decided and what Claude built.

## 2. Who is in the room, and what each one sees

| Who | Surface | What they do |
|---|---|---|
| **Host** | `/build?gameId=NNNN` on the laptop. The same page works on a phone as a remote. | Connects Claude, reviews Claude's questions, runs each ask (open, voting, close), edits and decides, logs verbal input, triages ideas, wraps up |
| **The wall** | The same page in **Present** mode, which hides host-only controls | The current ask, big. Choice letters match the mockups. Live counts, a "Claude is building…" ticker, the timeline |
| **The room** | Phones, through the normal join flow (`/play`) | Suggest, vote, pick A/B, rate, add a "why", send an idea at any time, watch the build feed |
| **Claude Code** | A local MCP server (`engage-mcp.mjs`), registered once with a session key | Asks the room, waits for decisions, posts progress, picks up directions, wraps up |

The mockups Claude shows are **not** served by Engage. They are whatever Claude runs locally,
for example `localhost:5173/a`, and the host flips to them on the projector. Engage's job is to
make the letters line up: when Claude creates a *Choose* ask, Engage assigns **A, B, C…** and
returns them with a ready-made badge snippet. Claude stamps "Choice A" onto each mockup. If an
option has a public URL, phones get an "Open preview" link.

## 3. The loop

```
Claude ──ask_room_to_choose──▶ Engage: ask #3 "Which header?" A/B  (status: proposed)
Host reviews / edits ─────────▶ Open to the room                    (live)
Phones pick A or B + why ─────▶ live bars on the wall
Host: Close ──────────────────▶ results
Host edits the direction: "B, but keep A's logo; room said 'bigger CTA'"
Host: Send to Claude ─────────▶ decided  + timeline entry + direction queued
Claude (wait_for_room returns) ─▶ builds B with the edits ─▶ post_update "Header B in place"
```

Directions also flow without an ask. The host types "the room says the colours are too dark"
and ticks *Send to Claude*. Every agent call returns the pending directions **inline** (marked
delivered when returned), so Claude hears the room on its very next tool call. Nobody has to
remember to tell it.

## 4. Architecture decision

**A new engagement type, `build`, with its own handler, rows and pages.** It reuses the
platform underneath it: join codes, players, `startSession`, WebSocket notify→refetch,
tenancy encryption and plan limits.

The alternative was rejected: injecting ad-hoc rounds into the existing round machinery. Every
round today is a `QUESTION#nnn#REF` pointing into a question set, and about ten readers
re-resolve it (get-question, get-game-state, message.js, get-results, get-answers, poll-round,
create-report, get-ai-summary…). A session is also locked to one `GameType`, so C&A and poll
cannot mix. An ad-hoc mixed round would have to touch every one of them, and every round
regression would land on live C&A and poll sessions.

`build` is deliberately **not** added to `GAME_TYPES` / `GAME_TYPE_IDS`. Those lists drive the
question-set pickers, AI generation and filters, and a Build Room has no question set. The
handful of places that open a session check `gameType === 'build'` explicitly.

## 5. Data model (GAME#<id> partition)

| SK | What | Encrypted (org sessions) |
|---|---|---|
| `METADATA` | normal session row. `GameType:'build'`, `Title`, `Details` = the goal | as today |
| `BUILD#STATE` | `CurrentAskId`, `AskSeq`, `Settings{reviewAgentAsks}`, `AgentSeenAt`, `AgentName`, `Outcome`, `Rev` | `Outcome` |
| `BUILD#ASK#<nnn>` | `Kind` suggest\|choice\|rating, `Prompt`, `Detail`, `Options[{label,title,detail,url}]`, `Scale`, `MaxPicks`, `Status`, `Source` agent\|host, timestamps, `Decision{direction,chosen,note}` | `Prompt`,`Detail`,`Options`,`Decision` |
| `BUILD#RESP#<nnn>#<id>` | a suggestion: `Text`, `PlayerName`, `Source` player\|host, `Hidden` | `Text` |
| `BUILD#ANS#<nnn>#<player>` | a pick or rating: `Choice[]`, `Rating`, `Why` | `Why` |
| `BUILD#VOTE#<nnn>#<player>` | `RespIds[]` (approval, up to `MaxPicks`, default 3) | — |
| `BUILD#LOG#<ts>#<id>` | timeline: `Kind`, `Text`, `Detail`, `Link`, `By` agent\|host\|room\|system, `AskId`, `ForAgent`, `DeliveredAt` | `Text`,`Detail`,`Link` |
| `BUILD#IDEA#<ts>#<id>` | an idea from a phone: `PlayerName`, `Text`, `Status` new\|promoted\|dismissed | `Text` |
| `BUILD#KEY#<sha256>` | agent key: `KeyId`, `Label`, `MintedBy`, `CreatedAt`, `RevokedAt`, `LastUsedAt` | — |

Every row carries the session's `ttl` (copied from METADATA, falling back to start + 7 days).
A whole room is one `Query begins_with(SK,'BUILD#')`, and every view is computed in memory by
pure functions in `build-store.js`. A session runs to hundreds of rows, not millions.

**Statuses:** `proposed → live → (voting, suggest only) → results → decided`, plus
`discarded`. Opening an ask closes any other live or voting ask to `results`, so there is only
ever one current ask.

**Log kinds:** `progress`, `milestone`, `showing` (Claude put something on screen), `decision`,
`direction`, `verbal` (what the room said out loud), `idea` (promoted), `note` (host-only,
never shown to the room or Claude), `ask` (system: an ask was opened or closed), `outcome`.

## 6. API contract

The handler is `lambda-functions/game/build-room.js` with the pure logic in
`lambda-functions/game/build-store.js`. Both are served by one function, `BuildRoomFunction`,
on four routes.

### 6.1 Host + agent: `/games/{gameId}/build/{proxy+}` (GET, POST, CognitoAuthorizer)

The **host** is a Cognito user who passes `callerMayDriveSession` with a real identity. The
**agent** is `Authorization: Bearer eng_<gameId>_<secret>`. The authorizer recognises the
`eng_` prefix, accepts it **only** on `games/{gameId}/build/…` when the key's game matches the
path, looks up `BUILD#KEY#<sha256(key)>`, and refuses a revoked key. The context it passes is
`{agent:'build', agentGameId, agentKeyId, orgId, orgIds, groups:''}`. Revoking takes effect on
the next call, because authorizer caching is off.

| Method + path | Who | Body / query | Returns |
|---|---|---|---|
| `GET state` | host, agent | — | `HostState` |
| `POST asks` | host, agent | `{kind, prompt, detail?, options?:[{title,detail?,url?}], lowLabel?, highLabel?, maxPicks?, draft?}` | `{ask}`. An agent ask is `proposed` when `reviewAgentAsks` is on (default), otherwise `live`. A host ask is `live` unless `draft` is set |
| `GET asks/{askId}` | host, agent | — | `{ask}` with results |
| `POST asks/{askId}` | host | `{action:'edit'\|'open'\|'vote'\|'close'\|'decide'\|'reopen'\|'discard', prompt?, detail?, options?, direction?, chosen?, note?, sendToAgent?=true}` | `{ask}` |
| `POST asks/{askId}/responses` | host | `{text}`: add what the room said out loud as a suggestion | `{ask}` |
| `POST asks/{askId}/responses/{respId}` | host | `{action:'hide'\|'show'\|'edit', text?}` | `{ask}` |
| `POST log` | host, agent | `{kind, text, detail?, link?, forAgent?}`. Agent kinds: progress, milestone, showing. Host kinds: verbal, note, milestone, progress | `{entry}` |
| `POST log/{logId}` | host | `{action:'edit'\|'delete', text?, detail?}` | `{entry}` |
| `POST directions` | host | `{text}` | `{entry}`. A `direction` log entry, queued for Claude |
| `POST ideas/{ideaId}` | host | `{action:'direct'\|'suggest'\|'dismiss'\|'restore'}`. `direct` sends it to Claude; `suggest` adds it to the current Ideas ask | `{idea}` |
| `POST outcome` | host, agent | `{summary, built?:[str], links?:[{label,url}], nextSteps?:[str]}` | `{outcome}` |
| `POST settings` | host | `{reviewAgentAsks?, agentName?}` | `{settings}` |
| `POST keys` | host | `{label?}` | `{key, keyId}`. The key is shown **once**. One live key per session: minting revokes the previous one |
| `POST keys/{keyId}/revoke` | host | — | `{ok}` |

**Every agent response also carries `inbox: [{id, text, from, askId, createdAt}]`.** These are
the directions not yet delivered, and they are marked delivered as they are returned. Every
agent call also stamps `AgentSeenAt`, which drives the wall's "Claude Code connected" chip
(active in the last 2 minutes).

Every write bumps `Rev` and broadcasts `{type:'buildChanged', gameId, rev}` to every
connection in the session. Clients refetch.

### 6.2 Players: `/games/{gameId}/build-play/{proxy+}` (GET, POST, public)

Identity is `{playerName, clientId}`, checked against `PLAYER#<name>` (`ClientId` must match
when the row has one).

| Method + path | Body / query | Returns |
|---|---|---|
| `GET state?playerName=&clientId=` | — | `PublicState` |
| `POST respond` | `{playerName, clientId, askId, text}` (suggest, up to 3 each), or `{…, choice:['A'], why?}` (choice), or `{…, rating:1-5, why?}` (rating) | `{ok, mine}` |
| `POST vote` | `{playerName, clientId, askId, respIds:[…≤maxPicks]}` (may not include own suggestions) | `{ok, mine}` |
| `POST idea` | `{playerName, clientId, text}` | `{ok}` |

### 6.3 Shapes

```js
HostState = {
  gameId, title, goal, state,              // state: STATE.State (CREATED / STARTED / ENDED)
  players: [name], playerCount,
  settings: { reviewAgentAsks },
  agent: { connected, lastSeenAt, name, key: { keyId, label, createdAt, lastUsedAt } | null },
  currentAskId,                            // '003' or null
  asks: [Ask],                             // oldest first, discarded included (flagged)
  log: [LogEntry],                         // oldest first
  ideas: [Idea],
  outcome: Outcome | null,
  rev,
}
Ask = {
  askId, kind, prompt, detail, status, source,
  options: [{ label:'A', title, detail, url }],   // choice
  scale: { min:1, max:5, lowLabel, highLabel },   // rating
  maxPicks,
  createdAt, openedAt, votingAt, closedAt, decidedAt,
  responses: [{ respId, text, playerName, source, hidden, createdAt, votes }],  // suggest
  results: {
    total,                                        // respondents (choice/rating) | voters (suggest)
    options: [{ label, title, count, pct, voters:[name] }],   // choice
    rating: { avg, count, dist:[n1..n5] },                    // rating
    ranked: [{ respId, text, votes, playerName }],            // suggest, visible only
    whys: [{ label|rating, text, playerName }],
  },
  decision: { direction, chosen:[label|respId], note, decidedAt, deliveredAt } | null,
}
LogEntry = { logId, kind, text, detail, link, by, askId, forAgent, deliveredAt, createdAt, editedAt }
Idea = { ideaId, text, playerName, status, createdAt }
Outcome = { summary, built:[str], links:[{label,url}], nextSteps:[str], by, updatedAt }
PublicState = HostState minus: names on responses and whys, hidden responses, `note` entries,
  ideas (except the player's own), settings, key, decision.note.
  Results appear only at results/decided. Suggestions appear (anonymous, no counts) from voting.
  Plus mine: { responses:[{respId,text}], vote:[respId], answer:{choice,rating,why} } for the current ask.
```

## 7. The MCP server: `src/public/engage-mcp.mjs`

This is one file with zero dependencies, so Node 18 or later is enough (it uses the built-in
`fetch`). It speaks MCP JSON-RPC over stdio. The site serves it, so the host downloads it from
the session page:

```bash
curl -fsSL https://engage.dev.seibtribe.us/engage-mcp.mjs -o ~/.engage-mcp.mjs
claude mcp add engage --env ENGAGE_API=<api base> --env ENGAGE_KEY=eng_1234_… -- node ~/.engage-mcp.mjs
```

The page renders this command with the real API base and the freshly minted key.

**Tools**: these appear in Claude Code as `mcp__engage__*`.

| Tool | Does |
|---|---|
| `room_status` | Goal, players, the current ask, recent decisions, pending directions |
| `ask_room_for_ideas` | `{question, context?}`: a Call & Answer suggest ask |
| `ask_room_to_choose` | `{question, context?, options:[{title, description?, url?}], maxPicks?}`. Returns the labels plus a badge HTML/CSS snippet to stamp onto each mockup |
| `ask_room_to_rate` | `{question, context?, lowLabel?, highLabel?}` |
| `wait_for_room` | `{askId, maxWaitSeconds?=300}`. Polls every 3s until the host **decides** (or discards), then returns the direction, the results and the room's notes. If it times out, it says so and Claude may call it again |
| `get_results` | `{askId}`. Non-blocking |
| `post_update` | `{text, kind?: progress\|milestone\|showing, detail?, link?}` |
| `check_directions` | Returns pending directions (they also ride along on every call) |
| `wrap_up` | `{summary, built[], links[], nextSteps[]}` |

**Prompts**: these appear as slash commands in Claude Code. They are `kickoff` (read the room,
plan out loud, post the plan), `ideas` (ask the room for ideas about a topic), `ab-mockups`
(build N variants, label them Choice A/B/…, ask the room), and `wrap-up`.

**Server `instructions`**: Claude Code reads these. They set the collaboration contract:
- ask the room at real decision points, not every step;
- keep questions short and readable on a projector;
- label every visual variant with the exact letter Engage returned;
- post a short progress update after each meaningful change;
- treat the host's direction as final;
- act on directions that arrive in `inbox`;
- call `wrap_up` at the end.

## 8. Experience details that matter

- **Host edits everything.** The host can edit any ask's wording and options before opening
  it, and the wording at any time; options are frozen once anyone has answered. They can hide
  a suggestion, add one the room said out loud, edit the direction before sending, and edit or
  delete any timeline entry. They can also edit the outcome Claude wrote at wrap-up.
- **Review gate.** By default Claude's questions arrive as *proposed* and the room never sees
  them unreviewed. The host can switch this off and let Claude open asks itself.
- **Present mode** hides every host-only control, the ideas inbox and host notes, so the
  laptop can be on the projector the whole time.
- **The "Claude is building" ticker** keeps the room engaged between asks: the latest progress
  and showing posts, the latest decision, and "Claude has been working for 4 min".
- **Ideas any time.** A phone can always send an idea. The host triages: send to Claude, add
  to the current Ideas ask, or dismiss.
- **The report** (`/build?gameId=…&view=report`) has the goal and outcome (what was built,
  links, next steps), every decision with its full results and the host's direction, the
  complete timeline, ideas from the room, and who took part. It prints cleanly
  (`window.print()`), and the browser's "Save as PDF" produces the file.

## 9. Security notes

- The agent key is a 32-byte random secret. Only its sha256 is stored. It is scoped by
  construction to one session's `build/*` routes, it is revocable, and it dies with the
  session's ttl.
- The agent cannot drive any other route. That means no ending the session, no reading
  answers outside Build, and no other session.
- Player writes go through the same identity check the rest of the player API uses.
- Org sessions encrypt all prose at rest under the session's org (`ENCRYPTED_FIELDS`).
- Anything Claude posts is untrusted text. It is rendered as plain text and never as HTML.
  Links render only for `http(s):`.

## 10. Tasks

1. Plan, contract and prototype (this folder).
2. Backend:
   - `build-store.js` (pure, ttl, ids, views, tallies) and `build-room.js` (routing, auth,
     rows, broadcast);
   - `ENCRYPTED_FIELDS` entries in all three copies of tenant-crypto;
   - the template function and its four routes;
   - the authorizer: the `eng_` agent-key branch and an explicit host rule;
   - tests.
3. MCP server `src/public/engage-mcp.mjs`, plus a test that drives it over stdio against a
   fake API.
4. Frontend:
   - host page `/build` (create → room → present → report);
   - player view in PlayerPage;
   - an entry point on the host welcome screen;
   - build sessions route to `/build` from the sessions list and from `GameHostPage ?gameId`;
   - tests.
5. Verify: backend scripts against the baseline, the frontend suite, lint and build.
6. Deploy to dev (branch push). Smoke the live API. Then test.

## 11. Later (deliberately not in v1)

- A Bedrock "recap" draft of the outcome. In v1 Claude writes the wrap-up itself, which it can
  do better, since it knows what it built.
- Screenshots pushed by Claude into Engage, which would need an upload path and S3.
- The phone remote (`/remote`) getting a Build panel. In v1 the host opens `/build` on the
  phone, since the page is responsive.
- Folding the build timeline into the standard `GameReport` and saved-report index.

## 12. As built (2026-10-02)

- One timeline entry is both the record and the message. A decision, something the room
  said, or an idea the host passes on carries `ForAgent`. Claude receives it once through
  `inbox` (`build-store.js` `inboxText`), and the host sees "Waiting for Claude" or "Claude
  has it" on the entry. A plain host direction is a `direction` entry.
- Phones and the wall (Present mode) see the room's timeline. That excludes host notes,
  system bookkeeping and direction entries, and it strips the detail from decisions and
  ideas (the host's note, the idea's author).
- The frontend is in `src/src/buildroom/`, because `.gitignore` swallows any folder named
  `build/`.
- Local end-to-end demo with no AWS: `scripts/build-room-demo/`. It runs the real
  handler, the real MCP server and a real browser.

## 13. Screenshots, the plugin and version control (2026-10-02, second round)

- **When Claude is done, the room knows it.**
  - The stage turns into **What we built**: the summary, the build list, next steps and an
    **Open the demo** button.
  - **What next?** sits under the stage at all times. **Tell Claude** sends a direction, and
    **Ask the room** offers Ideas, Choose and Rate.
  - Claude keeps listening with `wait_for_direction`, and the chip reads "Claude is listening
    for you".
- **Local links are buttons for the host.** Each running mockup gets **Open A** / **Open B**,
  and Claude's "showing" posts and wrap-up links work the same way. Local addresses work
  because Claude runs on the host's laptop. Phones never see them, because a phone cannot
  open them.
- **Screenshots.** `share_image` sends a PNG, JPEG or WebP (up to 3 MB).
  - The handler checks the image by its bytes and stores it privately under `builds/<game>/`
    in the media bucket. An org session's image is sealed with the org's key. The bucket
    expires these objects after 30 days.
  - Images are read only through `/build/images/{id}` (host) or `/build-play/images/{id}`
    (a phone, through its seat). They are never public URLs.
  - A mockup tied to an option (`askId` + `label`) shows on that option on the wall and on
    every phone. A `final` image shows on What we built and in the report. Everything else
    appears under "Screenshots along the way".
- **The plugin.** `node engage-mcp.mjs --install-plugin --api <api>` writes a local marketplace
  to `~/.engage/claude-plugin` and installs it with the `claude` CLI. The plugin bundles:
  - this server;
  - the `/engage:connect <key>` command, plus kickoff, ideas, ab-mockups, continue and
    wrap-up as `/engage:*` commands;
  - a **Stop hook** that commits at the end of every turn.

  `connect` saves the key in the project's `.engage/session.json`, which is git-ignored and
  readable only by its owner. A new session therefore needs only `/engage:connect`. Validated
  against Claude Code 2.1.287 with `claude plugin validate`, and its MCP server reports
  Connected.
- **Version control.**
  - The `checkpoint` tool and the Stop hook commit in the project. They first make it a git
    repository if it is not one, with a default `.gitignore`, and they never push.
  - The hook acts **only** in a project connected to a Build Room. It never touches any other
    folder, and it never fails the turn.
  - Each commit lands on the timeline as a `checkpoint`, and the report has a **Version
    history** listing each commit and what changed.
