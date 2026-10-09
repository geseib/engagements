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

# Task 2: vote from points, highlight, run list, Stage (server), as built

All routes under `/games/{id}/build/`. Host = the signed-in host; Claude = the host's Claude (agent key). Builders get 403 on all of these.

## Vote
- `POST points/vote` (host) `{ids (2-8), prompt?, detail?, maxPicks?}` -> 201 `{ask}`. A live Choose ask, made current. Options `{label,title,detail,url,pointId}` (pointId only in host/agent views, never on phones); ask view has `fromPoints:[ids]`. maxPicks 1-5, default 3, capped at the option count; anything else is 400. 400 for <2 or >8 ids, 404 unknown/removed, 409 point not open (new/shown/queued) or waiting in a running list. Points become `voting` (outcome "in a vote"), with `PromotedTo`/`PriorStatus`. Discarding the ask restores them; re-ask and revote keep pointId/FromPoints.

## Forward (the highlight result)
- `POST asks/{askId}` `{action:'forward', pointIds, then:'send'|'run'|'later-rest'}` (host; Claude 403). The ask must come from points (409) and be `results` or `decided` (409 "Close the vote first"). pointIds must be in the vote (400) and be `voting` or `queued` (409; so a second forward of the same points is 409).
  - `send` -> 200 `{ask, sent:[ids]}`: ONE Do-now direction, points `sent`, outcome "voted N, sent to Claude".
  - `run` -> 200 `{ask, run}`: starts the list in the given order (see Run). 409 if one is running.
  - `later-rest` -> 200 `{ask, saved:[ids], highlighted:[ids]}`: points in the vote not in pointIds (still voting/queued) go to Later as held directions (`later`, "voted N, saved for later"); pointIds become `queued` ("voted N, highlighted"); the step stays open, so send/run can follow. pointIds may be empty here.
- Point rows get `VoteCount`; every later outcome is prefixed "voted N, ".

## Run (row `BUILD#RUN`, sealed field `Items`, ttl, one at a time)
- `POST run` (host) `{pointIds (1-8, in order)}` -> 201 `{run}`. Points must be new/shown/queued. 409 "Finish or stop the current list first" while one has status running. Item 1 goes to Claude at once; its point is `sent` ("run item 1"); the rest `queued` ("queued, run item k"). Direction text: `Run list, item k of n: <point text, detail, sources>`; the inbox item has `runItem: k` (key present only for run items).
- `POST run/next` (host) `{force?, from?}` -> 200 `{run}`. Sends the first pending item. 409 `{error:"Claude hasn't finished k. Send j anyway?", needsConfirm:true, cur, next}` unless `force:true` while the current item is not done. `from` (optional) = the Cur the screen saw; a mismatch is 409 "The list has moved on". 409 when nothing is pending.
- `POST run/skip` (host) -> the first pending item (the one Next would send) is skipped to Later; the one after becomes next. `POST run/stop` (host) -> every pending item to Later, status `stopped`.
- `POST run/done` (host's Claude only; host 403) `{runItem, note?}` -> 200 `{run}`; repeat is 200 with `already:true`; 400 out of range, 409 if not sent or skipped. The point outcome becomes "run item k, done". When nothing is pending or doing, status becomes `finished`.
- Writes are conditional on `Ver` (create: not running), retried 3 times after a lost race, so two presses send once.
- runView: `{status: running|finished|stopped, cur, total, startedAt, finishedAt, items:[{k,text,kind,site,state: pending|doing|done|skipped, by? (builder tag)}]}`. Host/agent also get per item `pointId, sentAt, doneAt, note`, and `claudeDone`, `next`, `ver`.

## Show / hide
- `show` sets one point `shown` (any other shown goes back to `new`). `hide` -> 200 `{point, ideasAbout:N, ideaIds:[...]}`: the room's still-`new` ideas sent while it was up. Phone ideas sent while a point is shown carry `AboutPoint`; the host's idea view has `aboutPoint` (null otherwise). The vote from those ideas is the existing `asks-from-ideas`.
- A point waiting in a running list refuses show/later/send/remove, `points/send`, and vote (409 "That point is waiting in the list Claude is working through; skip it there").

## Views
- `hostView` (host and Claude): `run` (host shape) and `shownPoint`.
- Phones (`build-play state`) and anything Stage-facing: `shownPoint: {id, kind, text, site, from}` (`from` = 'claude' or a builder's name; site = host name of the first source; no detail, no sources list) and `run` (room shape: no point ids, no notes). No `points` key. Never a participant name.
- Outcomes: every move sets the point's `Outcome` (voted N, sent to Claude, run item k, run item k, done, highlighted, saved for later, skipped to Later, removed); the Claude/builder `points.digest` reports it.
- `GET build/state` as the host's Claude: `you: {role:'host-claude', name}` where name = the session's HostName as the host screen shows it (empty string if none). A builder's state: `you: {role:'builder', name}` (already so).

## Task 2 fix round 1 (supersedes the lines above where they differ)
- runId: the run view (host/agent) has `runId`; run-item direction rows and inbox items carry `runId` with `runItem`. `run/done {runItem, runId?, note?}`: a runId that is not the current list's is 409 "That list has ended" (a missing runId is accepted). Stop (and starting a new list) cancels run-item rows Claude has not yet heard (marked delivered + Cancelled, conditional), so they never arrive; an unheard `doing` item at stop becomes `skipped` and its point goes to Later. Done after stop is still accepted for items that were `doing`.
- Forward `send`/`run`: voted points not taken forward return to PriorStatus (`new` or `queued`) with outcome "voted N, not taken forward" (`later-rest` unchanged: they go to Later).
- Re-ask and the wheel's tie revote: kept points get `PromotedTo` = the new ask and stay `voting`; points whose option was dropped (or lost the tie) return with "voted N, not taken forward". Forward on an ask that has `RevotedAs` is 409 "This vote was asked again". Discarding the re-ask restores its points.
- Forward is allowed only at `results`, or `decided` when the decision was not sent to Claude (else 409).
- `POST run/reorder` (host) `{order:[pointIds of every pending item, once each], ver}`: `ver` required (the view's `ver`); mismatch 409 "The list changed; look again"; wrong set 400. Only pending items move; their points' outcomes renumber ("queued, run item k").
- `POST run` needs 2+ points (400 otherwise), 8 at most; forward `run` too. The vote uses up to 8 option slots (letters A-H) where the ideas vote still takes 6.
- `later` on a shown point appends "Ideas from the room about it:" with one "- idea" line each (up to 8, no names) to the Later direction.
- `shownPoint` is `{kind, text, site, from}` (no id) everywhere; phones get `run` only while it is `running` (else null); the host still sees finished/stopped.
- Plugin 1.13.1: `post_update` with `runItem` (minimum 1) sends `run/done {runItem, runId (remembered from the item), note (the update text, 200 chars)}`.

## Task 5 server changes (fix round 1)
- `asks/{id}` `forward` with `then: 'send'` or `'run'` now settles the vote in the same request: the ask becomes `decided` (`DecidedAt`, `ClosedAt` if missing), `Decision {direction: 'Moved forward: <option texts>', chosen: <option labels of pointIds>, sendToAgent: false, method: 'vote', as: 'do-now'}`, one `decision` log entry with `forAgent: false` (the only `forAgent` entry is still the send or run item itself), then the queued next ask opens. `later-rest` leaves the ask at `results`. The page makes no second `decide` call.
- `run/next {force?, from?, runId?}`, `run/skip {from?, runId?}`, `run/stop {runId?}`, `run/reorder {order, ver, runId?}`: a `runId` that is not the current list's is 409 "That list has ended". `run/skip` with `from` not equal to the list's `cur` is 409 "The list has moved on; look again" (as `next`).
- The room-safe (phone) `run` no longer carries `by` on items; the host view still does.
- `GET build-play/state` for a builder carries `myPoints {items: [{id, kind, text, status, outcome, createdAt}], requests: [requestView]}`: only their own Claude's points and their own requests (none for a phone that is not a builder). Sealed at rest in a team room, plain to the builder.
