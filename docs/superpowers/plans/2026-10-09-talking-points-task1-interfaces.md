# Task 1 report: Points and requests (server)

## Built
- Row types `BUILD#POINT#<timeKey>`, `BUILD#PREQ#<timeKey>`, and the constant `SK.run = 'BUILD#RUN'` (reserved for Task 2; no run row is written yet). All written through `put()` so they carry `ctx.ttl`.
- Sealing: `buildPoint ['Text','Detail','Sources','About']`, `buildPointReq ['Subject']`, `buildRun ['Items']` in all three `tenant-crypto.js` copies (byte-identical, md5 checked). `entityForSk` maps the new prefixes; `roomFromRows` gives `room.points`, `room.preqs`, `room.run`.
- Pure half in `build-store.js`: `normalizePoint`, `normalizePointsPost`, `normalizePointRequest`, `pointView`, `requestView`, `pointsHostView`, `pointsClaudeView`, `pointDirectionText`, `pointLaterText`, limits and status constants.
- Routes and logic in `build-room.js`: `postPoints`, `createPointRequest`, `pointAction`, `sendPoints`; delivery in `takeInbox`.

## Files
lambda-functions/game/build-store.js, lambda-functions/game/build-room.js, the three tenant-crypto.js, tests/build-points.js (new, 31 checks).

## Interfaces as implemented
Row fields. Point: `PointId, Kind (talk|finding|idea), Text, Detail?, Sources? [{title,url}], About?, BatchId, RequestId?, By ('claude' or builder name), ByRole ('agent'|'builder'), Status, CreatedAt, UpdatedAt?, Outcome? (free label Task 2 may set)`. Status values: new, shown, voting, queued, sent, later, removed. Open (counts to the 40 cap) = new, shown, queued. Request: `ReqId, Kind (research|ideas), Subject, ForBuilder? (absent = the host's Claude), Status (waiting|working|done|failed), Count, CreatedAt, UpdatedAt, DeliveredAt?`. Ownership uses `ByRole`/`ForBuilder`, not the name, so a builder called "claude" is not confused with the host's Claude.

Routes (host path `/games/{id}/build/...`):
- `POST points` (agent via routeHost, builder via routeBuilder). Body `{points:[{kind,text,detail?,sources?,about?}], batchId?, requestId?, done?}`. 201 `{posted:[ids], request?:requestView}`. Host calling it: 403. 400 on: unknown kind, empty or >280 text, finding without source, any non-http(s) source, >3 sources, >8 points, 0 points without `done`, `done` without `requestId` (one bad point refuses the whole post). detail is cut to 1200, about to 200. 409 "Remove or save some first" (body also has `open`, `limit`) when open + incoming > 40, whole post refused. With `requestId`: 404 unknown; 403 if not that Claude's own request (host's Claude vs builder, builder vs builder); 409 if already done/failed; status becomes working (done:true makes it done); `Count` grows. Points are one millisecond apart so Claude's order is kept.
- `POST points/requests` host only `{kind, subject}` (subject <=200, else 400; kind research|ideas) -> 201 `{request}`; 409 when 10 requests for that owner are still waiting/working (stale after 2 h do not count). Agent/builder: 403.
- `POST points/{id}` host only `{action: remove|later|show|hide|send}` -> `{point}`. remove: any non-removed; later: open points only, adds a held direction to the one Later list (text = point text, plus first source url for a finding), status later; show: new/queued -> shown, any other shown point goes back to new; hide: shown -> new (409 otherwise); send: open points only, one do-now direction (kind label, text, detail, `Source: title (url)` lines), status sent. 404 unknown or removed id, 400 bad action, 409 wrong status. `hide` does not yet return `ideasAbout` (Task 2).
- `POST points/send` host only `{ids}` -> `{sent:[ids]}`: ONE do-now direction for all; any unknown id 404, any non-open 409, empty 400; nothing is sent unless all can be.
- Builder screen: `POST /games/{id}/build-play/crew/points/requests` `{playerName, clientId, kind, subject}` -> 201 `{request}`; `ForBuilder` is always the caller (body fields for another builder are ignored); 409 if the player is not a builder or crew mode is off; 403 on a bad clientId.

Delivery: on every agent or builder Claude call, `takeInbox` claims `waiting` requests for that Claude (conditional update, once) and sets them `working`. Inbox item: `{id: requestId, kind, requestId, subject, text, from:'request', as:'do-now', askId:null, shareId:null, createdAt}`. A request made while Claude is away stays `waiting` (chip reads this) and arrives on the next call. Host-only requests never reach a builder's inbox and vice versa.

Views:
- `GET build/state` as host: `points: {items:[pointView], requests:[requestView], open:N}`. items exclude removed. pointView `{id, kind, text, detail, sources, about, batchId, requestId, by, fromBuilder, status, outcome, createdAt}`. requestView `{id, kind, subject, for ('host' or builder name), status, count, createdAt, updatedAt}`.
- Host's Claude (`GET build/state` as agent) and a builder's Claude (builder `GET state`): `points: {digest:[{id,status,outcome}] (own points only), requests:[own requestViews], open:N}`. `outcome` is a plain string ('sent to Claude', 'saved for later', 'removed', 'in a vote', ... or `Outcome` if a row sets it, '' for new). The plugin's talking-points.json update reads this.
- Phones (`build-play state`) and anything Stage-facing: no `points` key at all yet.

## Counts
- tests/build-points.js: 31 passed, 0 failed. tests/build-room.js: 111/0. tests/build-crew.js: 22/0. tests/tenant-crypto.js and tests/tenant-crypto-wiring.js: exit 0.
- Full backend loop (all tests/*.js except verify-question-set-ui.spec.js): `LOOP DONE`, no FAIL lines.
- Frontend untouched (no src/ changes), so no jest run.

## Commit
See `git log -1` on working/build-room-host-redesign ("Build Room: points and Research/Ideas requests (server)").

## Concerns / notes for later tasks
- `show`/`hide` exist but only flip status; no Stage/player view reads them yet (Task 2). `hide` needs the `ideasAbout` count added.
- `BUILD#RUN` sealing entity and SK exist but nothing writes or loads a run yet (`room.run` is the raw row or null).
- Statuses `voting` and `queued` are defined; nothing sets them in Task 1 (`voting` is Task 2's vote, which should also be non-open so it frees the cap, as now).
- Inbox items for requests use `as:'do-now'` so an unmodified plugin shows them as a plain instruction; Task 3 should key on `kind`.
- Stale rule: a request stuck waiting/working for 2 h stops counting against the 10-request cap (there is no host close button for a stuck request yet).
- Point `Outcome` is not set anywhere in Task 1; outcome strings come from status.

## Fix round 1 (review)
Changed interfaces (these supersede the text above):
- `POST build/points`: `batchId`/`requestId` must match `^[A-Za-z0-9_-]{1,60}$` else 400. A source url over 500 chars is a 400 ("A source link is 500 characters at most"), never cut. With a requestId, the request is updated FIRST by one conditional UpdateCommand (`SET #st, UpdatedAt ADD Count`, condition status not done/failed, ttl untouched); a request closed meanwhile gives 409 "That request is already closed" and no point is written. Response `request` is built from the row plus the update (no extra read).
- `POST build/points/requests/{id}` host only `{action:'cancel'}` -> 200 `{request}` with status `failed` (never delivered or answerable afterwards); 404 unknown, 409 already done/failed, 400 other actions.
- Send (`points/{id}` send and `points/send`): the direction is never cut. Over 2000 chars -> Detail lines dropped; still over -> 400 "Too much to send at once; send fewer", points stay unsent. Text, detail and source titles are collapsed to one line each; a builder's point is prefixed `From <name>'s Claude: `.
- Later: a builder's point keeps attribution, Later item `from` = `<name>'s Claude`.
- Request cap: only `working` requests go stale (2 h); `waiting` always counts.
- Inbox items are returned sorted by `createdAt`.
- The agent's `log` in `GET build/state` no longer contains held (Later) entries; the host's still does (`held:true`).

Tests: build-points 41/0 (new checks for I1, I2 incl. overlapping batch+done, M3-M11), build-room 111/0, build-crew 22/0, tenant-crypto and tenant-crypto-wiring exit 0, full backend loop `LOOP DONE` with no FAIL lines.
