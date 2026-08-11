# `GET /games` is public — plan

**Date:** 2026-08-11
**Status:** investigation complete, awaiting owner's ruling. **No code changed.**
**Code audited at:** `6a4ead84` on `dev`.

**The finding.** `GET /games` (`template-clean.yaml:819-825` → `lambda-functions/game/get-games-list.js`) carries no authorizer. Anyone who knows the API base URL gets every session title, every host's name and every four-digit join code in that environment, in one request, with no credential.

**The conclusion, up front.** Nothing on the participant path calls it. Two callers exist in the entire repository, both behind `ProtectedRoute`, both with a signed-in user in hand. This is closeable, and the fix is one `Auth:` block, one word in `GameHostPage.jsx`, and one branch in the authorizer that is easy to miss and would leave the door open if missed.

---

## 1. What the endpoint returns

`get-games-list.js:12-19` runs a single unbounded `Query` of the `GAMES` partition — every game in the table, no pagination, no filter — and maps nine fields (`:21-31`):

| Field | Source | Sensitivity |
|---|---|---|
| `gameId` | `SK` minus `GAME#` | **This is the join code.** Four digits. It is the only thing a participant types |
| `title` | `Title` | **Sensitive.** Free text the host wrote: "Q3 Leadership Offsite", client names, topics |
| `hostName` | `HostName` | **Sensitive.** A named individual |
| `gameType` | `GameType` | Low |
| `questionSetId` | `QuestionSetId` | Low — but names internal content sets |
| `createdAt` / `lastPlayedAt` | | Low on its own; a usage-pattern signal in aggregate |
| `started` | `Started` | **Operationally sensitive** — flags which sessions are joinable *right now* |
| `visibility` | `Visibility` | **Operationally sensitive** — flags which sessions have no access code |
| `count` | computed | Discloses total sessions ever run |

Two things it does **not** return, and both matter:

- **`AccessCode` is not in the payload.** The `GAMES` index row does carry it (`lambda-functions/websocket/schema-compliant-manager.js:44-63` writes `AccessCode: gameData.accessCode || null` onto the row), and the mapper simply never reads it. That is luck, not design — a future field addition to the mapper would ship the private-game password to the world. Worth a comment in the handler whatever option is chosen.
- **No player names, no answers, no scores.** The list is a directory, not a transcript.

There is no TTL/state filter, so games that ended weeks ago are listed until the DynamoDB TTL reaps them (CLAUDE.md: 90 days from creation).

---

## 2. Who calls it — exhaustively

Two runtime callers. Both were found independently by two separate sweeps of `src/src`, `lambda-functions`, `scripts/`, `tests/`, `cicd/`, `archive-server/` and the root `test-*.js` files.

| # | Call site | Method of calling | Auth header today | Surface |
|---|---|---|---|---|
| 1 | `src/src/GameHostPage.jsx:2906` — `const res = await fetch(\`${API_BASE}games\`)` inside `fetchGamesList` (`:2904`) | bare `fetch` | **none** | Host page. Behind `ProtectedRoute` (`App.jsx:262-266`) |
| 2 | `src/src/components/SessionsPanel.jsx:68` — `await authFetch(adminApiUrl('games'))` | `authFetch` | **Bearer ID token** | Admin console, "Sessions" tab (`AdminPage.jsx:10`, `:1547`) |

Caller 1 is reached three ways, all host-initiated modals:
- `GameHostPage.jsx:2648` — `handleViewGameHistory()`, the switch-game / continue-game dialog rendered at `:3156-3200`
- `GameHostPage.jsx:2916` — `handleViewReports()`
- `GameHostPage.jsx:2805` — a refresh immediately after creating a game

Caller 2 is the one added in `6a4ead84`'s wave (Wave D of `docs/superpowers/plans/2026-08-10-admin-console.md:99`). It already sends a token; it needs no change.

**Nothing on the player path calls it.** Stated definitively:

- `PlayerPage.jsx` has zero occurrences of a bare `` `${API_BASE}games` ``. Its API surface is: `POST /games/{id}/players` (`:232`, `:1044`, `:1122`), `GET /games/{id}?role=player` (`:325`), `GET /games/{id}/state` (`:666`, `:751`, `:764`, `:1013`, `:1289`), `GET /games/{id}/players` (`:556`, `:907`), `GET /games/{id}/answers` (`:588`, `:774`), `GET /games/{id}/question` (`:609`, `:800`), `POST /games/get-results` (`:814`), `POST /games/{id}/votes` (`:1306`), `GET /question-sets` (`:25`).
- `components/RootPage.jsx` makes exactly **one** request in the whole file, at `:110`, and it is `GET /games/{code}`.
- `components/QuickstartMenu.jsx:77` calls **`POST /games`** — a different route (`template-clean.yaml:220-221`), a different function (`CreateGameFunction`). Confirmed: it is not a caller of the list. It is also a host surface, imported only by `GameHostPage.jsx:7`.

Non-runtime references: `src/src/__tests__/sessionsPanel.test.jsx:121` asserts the admin call's URL; `tests/debug-form-submit.spec.js:20` is a Playwright network *listener* matching `includes('games')`, not a request.

Dead code found in passing: `src/components/forms/CreateGameForm.jsx:241` posts to `/games`, but it lives outside `src/src` and the webpack entry is `src/src/index.jsx` (`src/webpack.config.js:16`). It is not in the bundle.

---

## 3. Blast radius of adding `CognitoAuthorizer`

**Exactly one caller breaks: `GameHostPage.jsx:2906`.** It has a signed-in user available — the file already imports `authFetch` at `:41` and uses it at `:387`, `:625`, `:2389`, `:2573`, `:2735`. The failure mode today would be `fetchGamesList` catching, logging, and firing `alert('Failed to load games list. Please try again.')` (`:2909-2911`), with the Game History and Reports modals opening empty.

`SessionsPanel.jsx:68` does not break.

**But there is a second, less obvious break — a hole rather than a break.** Attaching the authorizer is *not* sufficient. `lambda-functions/auth/authorizer.js:96-117` decides required groups by route, and its public branch is:

```js
  if (path.includes('join') || path.includes('answer') || path.includes('vote') ||
      (method === 'GET' && path.includes('games'))) {
    return [];
  }
```

`GET /games` matches `method === 'GET' && path.includes('games')` → **no groups required**. So the authorizer would authenticate the caller and wave through *any* account in the pool — including one still sitting in `pending`, unapproved. That is precisely the failure `6a4ead84` was written to fix on `/admin/users/*`, and the reasoning is recorded in `lambda-functions/admin/shared/require-admin.js:19-24`: *an authorizer proves you are someone; it does not prove you are someone allowed to do this.*

Adding `Auth:` without amending `requiredGroupsForRoute` would take the session directory from "public to the internet" to "public to anyone who can complete a signup form". That is an improvement, but not the fix the owner is asking for, and it would read as done.

---

## 4. The neighbouring routes — the full picture

There is no `DefaultAuthorizer`; the template says so and says why (`template-clean.yaml:359-363`). Every route is public unless it opts in.

| Route | Line | Auth | Who needs it |
|---|---|---|---|
| `POST /games` (create) | 220-221 | **public** | host only in practice — see §7 |
| `POST /games/{id}/start-question` | 240-241 | public | host |
| `POST /games/{id}/start-vote` | 265-266 | public | host |
| `POST /games/{id}/reveal-authors` | 290-298 | **AUTH** | host |
| `POST /games/{id}/stage-beat` | 324-332 | **AUTH** | host |
| `GET /games/{id}` | 467-468 | public | **participant** (root-page code check, session brief) |
| `POST /games/{id}/start` | 489-490 | public | host |
| `POST /games/{id}/next-question` | 516-517 | public | host |
| `POST /games/{id}/toggle-category` | 538-539 | public | host |
| `PUT /games/{id}/persona` | 563-564 | public | host |
| `GET /games/{id}/question` | 585-586 | public | **participant** |
| `GET /games/{id}/answers` | 608-609 | public | **participant** (redacted server-side while anonymous — `get-answers.js:102-105`) |
| `POST /games/get-results` | 642-647 | public | **participant** — the READ |
| `POST /games/{id}/close-round` | 657-664 | **AUTH** | host — the TRANSITION |
| `POST`/`GET /games/{id}/report`, `save-report` | 680, 700, 721 | public | host |
| `GET /games/{id}/ai-summary` | 782-783 | public | host surfaces (`GameHostPage.jsx:703`, `HostRemote.jsx:235`) |
| `GET /games/{id}/players` | 805-806 | public | **participant** (own rank) |
| **`GET /games`** | **824-825** | **public** | **nobody unauthenticated** |
| `GET /games/{id}/state` (+`/{playerId}`) | 846, 852 | public | **participant** |
| `POST /games/{id}/players` (join) | 901-902 | public | **participant — the join** |
| `POST` / `GET /games/{id}/votes` | 932, 957 | public | **participant** |
| `/admin/*` | throughout | **AUTH** | admin (exception: `/admin/create-github-issue`, 1335, public for the player-page feedback FAB) |

**The pattern already in the codebase, stated.** The template writes it out at `template-clean.yaml:636-664`, on one handler with two routes:

> *"THE READ. Public, and it has to be: PlayerPage calls this with a plain fetch the moment the room enters RESULTS, so an authorizer here would break every player client."* … *"THE TRANSITION. Host only. Same handler, second route — HTTP API authorizers are per-route and not optional, so 'public to read, authenticated to write' cannot be expressed on one route."*

The same reasoning is repeated verbatim for `/reveal-authors` (`:292-296`) and `/stage-beat` (`:326-330`), and each cites the identical threat: *a participant knows the four-digit game id*, so a public route is a button any phone in the room can press.

**Read that pattern precisely, because it is easy to misapply here.** The rule is *not* "reads are public, writes are authorized". It is **"what a participant's client actually calls is public; what only a host's client calls is authorized."** `/close-round` is authorized because no player calls it. `GET /games` is a read — and no player calls it either. It sits on the authorized side of the project's own line. The route is the exception to the pattern, not an instance of it.

A second precedent, for the payload-shaping option: `get-answers.js:102-105` keeps a public route public and **redacts the payload** based on server-side state (`isHidden` → `redactAnswers`), which is what `docs/superpowers/plans/2026-08-09-anonymous-responses.md` §Task 3 shipped. So "reduce what a public route says" is an established move in this codebase — it is just not the right one here, because the reduction would go to zero fields.

---

## 5. What a participant genuinely needs unauthenticated

The whole participant journey, with evidence:

1. **The code check.** `RootPage.jsx:104-119`:
   ```js
   const response = await fetch(`${window.API_BASE}games/${code}`);
   if (response && response.status === 404) { setMissing(code); setChecking(false); return; }
   ```
   then `navigateTo('/play?gameId=' + code)`. The contract is written at `RootPage.jsx:89-101`: 404 → say so and stay; 200 → navigate; anything else → navigate anyway. **This depends on `GET /games/{gameId}` returning a clean 404** (`get-game.js:29-35`), and it is verified live — `docs/handoff/RESUME.md:11` records the post-deploy check.
2. **The join.** `POST /games/{gameId}/players` — `PlayerPage.jsx:232`, `:1044`, `:1122`, body `{playerName, accessCode}`, only header `Content-Type`.
3. **Play.** `/state`, `/players`, `/answers`, `/question`, `/votes`, `get-results`, `GET /question-sets`. Answers themselves go over the WebSocket (`PlayerPage.jsx:1200`), which carries no token at all (`WebSocketClient.js:46`).

None of that touches `GET /games`. **A participant arrives already knowing the one code they need** — from a QR, a slide, or someone saying it out loud. A directory of *other people's* sessions is, by construction, not something a participant needs.

Only a host or admin needs the list: to resume a session they ran (`handleViewGameHistory`), to pull a report (`handleViewReports`), or to administer sessions (`SessionsPanel`).

---

## 6. Enumerability — does `GET /games` make it worse?

`docs/design/entry-redesign/OPEN-QUESTIONS.md` #6 records the accepted risk:

> *"Four-digit codes are enumerable. Is that accepted? Ten thousand possibilities and no rate limit on `POST /games/{id}/players` means a concurrent session can be found by brute force in seconds."*

Confirmed: `template-clean.yaml` contains **no** `Throttl*`, `RouteSettings`, `DefaultRouteSettings` or WAF configuration anywhere. There is no rate limit on anything.

**Yes, `GET /games` makes it materially worse, in three distinct ways.**

1. **It removes the guessing entirely.** #6's threat model is a brute-force search of a 10,000-key space that leaves 10,000 log lines. `GET /games` is one unauthenticated request that returns the answer key. The difference between "discoverable" and "published" is the whole of the risk here.
2. **It adds targeting the brute force never had.** Guessing gives you a number. The list gives you `title`, `hostName`, `started` and `visibility` — so an attacker picks the session by *name and host*, and filters to the ones that are live and have no access code. That is a capability enumeration does not confer at any cost.
3. **It anchors a chain that defeats the private-game control.** `get-game.js:72-79` returns `accessCode: gameMetadata.Item.AccessCode` when the request carries `?role=host` — and `role` is an unauthenticated query parameter. So:

   `GET /games` → every `gameId` → `GET /games/{id}?role=host` → the `AccessCode` → `POST /games/{id}/players` with a valid code for a **private** session (`join-game.js:53-90` is the only gate, and it compares against exactly that value).

   The `?role=host` leak is a **separate, pre-existing defect** and closing `GET /games` does not fix it — an attacker can still walk 4-digit ids. But `GET /games` is what turns that walk into a targeted, silent, single-shot attack. **It should be raised as its own item.** `PlayerPage.jsx:311-313` already carries a comment noting that the host variant returns the access code, which is why the player page passes `role=player` — the awareness exists, the fix does not.

Note also that the list is the *only* place session count and history are disclosed; brute force reveals only concurrently-live games, while the list reveals 90 days of them.

---

## 7. The options

### Option A — authorize `GET /games`, and close the group hole *(recommended)*

Attach `CognitoAuthorizer` to the route and require `hosts`/`admins` in the authorizer's route table. Change `GameHostPage.jsx:2906` from `fetch` to `authFetch`.

**For:** it is the smallest change that actually closes the disclosure; it needs no new route, no new handler, no payload contract to maintain in two shapes; it matches how `/close-round`, `/reveal-authors` and `/stage-beat` were already handled, so the template stays internally consistent; the one caller that breaks is a one-word fix with a token already in hand.
**Against:** it depends on the authorizer's group table being amended in the same change — the part that is easy to forget, and forgetting it fails open to any `pending` account. Mitigated by a unit test on `requiredGroupsForRoute`, which has none today.
**Cost:** ~6 lines of YAML, 4 lines of JS, 2 tests.

### Option B — keep it public, shrink the payload; add an authorized full variant

Return only non-sensitive fields publicly (drop `title`, `hostName`, `visibility`, `lastPlayedAt`), and add an authorized route returning everything.

**For:** it is the established move for anonymity on `/answers` (`get-answers.js:102-105`), and it would preserve any public caller discovered later.
**Against:** **there is no public caller to preserve** — §2 establishes that with two independent sweeps. And the reduction goes to zero: strip the sensitive fields and what remains is `gameId` + `started`, which is *precisely* the enumeration handout from §6.1 — a published list of live, joinable codes. It is the single worst field pair to leave public. Meanwhile the codebase now carries two payload shapes for one resource forever. It costs more than A and closes less.
**Verdict:** reject. Kept here because it is the obvious-looking answer and the reason it fails is not obvious.

### Option C — a separate `/admin/games` route, leaving `GET /games` alone

Add `GET /admin/games` behind the authorizer; point both callers at it.

**For:** `/admin/*` already carries the authorizer by convention, so the auth wiring is the boring path; SessionsPanel is conceptually admin.
**Against:** **it fixes nothing on its own.** The disclosure is `GET /games` being public; adding a second route does not close the first. Option C is only a fix if it is *also* Option A — either delete `GET /games` (breaking the host page anyway, so no saving) or authorize it (Option A, plus a redundant route). It also mislabels the resource: the host's switch-game dialog is not an admin surface, and hosts are not in `admins` (`authorizer.js:99-104`), so `/admin/games` under the current group rules would deny every host.
**Verdict:** reject, unless the owner wants the admin console decoupled from host routes for reasons beyond this issue.

---

## 8. The recommended change, exactly

### 8.1 `template-clean.yaml` — the route

At `template-clean.yaml:819-825`, inside `GetGamesListFunction`:

```yaml
      Events:
        GetGamesListEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /games
            Method: GET
            # HOST/ADMIN ONLY, and it is the odd one out among the GET /games/*
            # routes below, so the reason is written here.
            #
            # Everything else a participant's client calls names ONE game — the
            # one whose four-digit code they were given. This route names them
            # ALL: every title, every host's name and every join code in the
            # environment, in one unauthenticated request. Nothing on the player
            # path calls it (PlayerPage.jsx and RootPage.jsx make no such
            # request); the only callers are the host's switch-game dialog
            # (GameHostPage.jsx:2906) and the admin Sessions tab
            # (SessionsPanel.jsx:68), and both have a signed-in user.
            #
            # Public, it also cancelled the one protection four-digit codes had:
            # OPEN-QUESTIONS #6 accepted enumerability on the grounds that an
            # attacker must guess. This handed over the list.
            #
            # The group check is NOT here — an HTTP API authorizer proves you
            # are someone, not that you are allowed. See authorizer.js's
            # requiredGroupsForRoute, which must name this route explicitly.
            Auth:
              Authorizer: CognitoAuthorizer
```

### 8.2 `lambda-functions/auth/authorizer.js` — the group rule

**This is the load-bearing half.** In `requiredGroupsForRoute` (`:96-117`), insert *before* the public branch at `:110-114` — immediately after the `admin` block at `:105`:

```js
  // The games LIST, not a game. GET /games returns every session's title, host
  // name and join code, and the generic "GET + games is public" rule below
  // would let ANY account in the pool read it — including one still sitting in
  // `pending`, unapproved. Same failure require-admin.js:19-24 documents for
  // /admin/users/*: authentication doing the work of authorisation.
  // Matched exactly, so /games/{id} and every /games/{id}/* stays public.
  if (method === 'GET' && path === 'games') {
    return ['hosts', 'admins'];
  }
```

`path` is `routeKey`'s path with the leading slash stripped (`:147-148`), so the literal is `'games'`. The exact match is deliberate: `path.startsWith('games')` would silently authorize `GET /games/{gameId}` and break every participant.

### 8.3 `src/src/GameHostPage.jsx` — the one caller that breaks

At `:2904-2912`, `fetch` → `authFetch` (already imported at `:41`), and make the failure legible rather than a generic alert:

```js
  const fetchGamesList = async () => {
    // authFetch, not fetch — GET /games carries the Cognito authorizer, like
    // /close-round and /reveal-authors. This page is behind ProtectedRoute, so
    // a token always exists here; authFetch sends the request unauthenticated
    // when signed out (authFetch.js:32-34), which is why the 401 is handled.
    try {
      const res = await authFetch(`${API_BASE}games`);
      if (res.status === 401 || res.status === 403) {
        alert('Your session has expired. Please sign in again to see your sessions.');
        setGamesList([]);
        return;
      }
      const data = await res.json();
      setGamesList(data.games || []);
    } catch (error) {
      console.error('Error fetching games list:', error);
      alert('Failed to load games list. Please try again.');
    }
  };
```

### 8.4 A comment in the handler

`get-games-list.js:21-31` — note that `AccessCode` is present on the `GAMES` row (`schema-compliant-manager.js:63`) and is deliberately not mapped, so nobody adds it while "completing" the projection.

### 8.5 No change needed

`SessionsPanel.jsx:68` already sends the token. `sessionsPanel.test.jsx:121` already asserts it.

---

## 9. What breaks, and how each break is caught

| Break | Symptom | Caught by |
|---|---|---|
| Host's Game History / Reports modals 401 | Modals open empty, alert fires | **New source-shape test** (below) + manual §10.2 |
| Authorizer group hole left open | Silent — a `pending` account reads the list and nothing looks wrong | **New unit test on `requiredGroupsForRoute`** — the only thing that catches this |
| Exact-match typo (`startsWith` instead of `===`) | **Every participant's session brief 401s** — total outage of the join flow | Same unit test, asserting `GET /games/{gameId}` still returns `[]` |
| Admin Sessions tab | none expected | `sessionsPanel.test.jsx:121`, existing |

**Test 1 — the authorizer route table.** `requiredGroupsForRoute` is exported (`authorizer.js:178`) and has **no test today**. Add `tests/authorizer-route-groups.js` (or a Jest file, matching whichever runner the owner prefers — `tests/*.js` are plain node scripts, `src/src/__tests__` is Jest):

```js
// The list is host/admin.
assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games'), ['hosts', 'admins']);
// A single game is NOT. This is the assertion that stops a startsWith()
// from taking the participant join flow down with it.
assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}'), []);
assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}/state'), []);
assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}/players'), []);
assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}/answers'), []);
```

**Test 2 — the host call site.** `GameHostPage.jsx` is ~5,000 lines and cannot be mounted in jsdom; the codebase already solves this with comment-stripped source assertions in `src/src/__tests__/gameSetupCallSite.test.js:13-27`. Follow that file exactly:

```js
// rejects: the template gaining an authorizer while the host page still
// sends a bare fetch — a 401 that only shows up when a host opens the modal.
test('fetchGamesList sends a token', () => {
  expect(host).toMatch(/await\s+authFetch\(`\$\{API_BASE\}games`\)/);
  expect(host).not.toMatch(/await\s+fetch\(`\$\{API_BASE\}games`\)/);
});
```

Note the second assertion must not catch the two `POST /games` creates at `GameHostPage.jsx:2783` and `QuickstartMenu.jsx:77` — those are `fetch(\`${API_BASE}games\`, {` with a second argument, so the regex above (closing paren immediately after the template literal) distinguishes them. Verify that when writing it.

---

## 10. Verification

### 10.1 Against the deployed API — the three cases

```bash
API=https://<api-id>.execute-api.us-east-1.amazonaws.com/dev

# 1. No token → must be 401. (Precedent: docs/handoff/RESUME.md:11 records
#    POST /games/{id}/stage-beat returning 401 for exactly this reason, where a
#    nonexistent route returns 404 — so 401, not 404, proves the route exists
#    and is guarded.)
curl -s -o /dev/null -w '%{http_code}\n' "$API/games"

# 2. Host token → 200 with the list.
curl -s -H "Authorization: Bearer $HOST_ID_TOKEN" "$API/games" | head -c 300

# 3. A `pending` account's token → 403. THIS is the test for §8.2. If it
#    returns 200, the YAML shipped and the authorizer branch did not.
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $PENDING_ID_TOKEN" "$API/games"
```

### 10.2 The participant flow must not regress — run this every time

```bash
# The root page's code check depends on this exact 404 body.
curl -s -o /dev/null -w '%{http_code}\n' "$API/games/0000"      # → 404
curl -s "$API/games/0000"                                       # → {"error":"Game not found"}
# A real, live game, unauthenticated, as RootPage.jsx:110 calls it:
curl -s -o /dev/null -w '%{http_code}\n' "$API/games/$LIVE_ID"  # → 200
# And the join itself:
curl -s -X POST "$API/games/$LIVE_ID/players" \
  -H 'Content-Type: application/json' -d '{"playerName":"Verify"}'   # → 200
```

Then, in a browser with **no session**: open `/`, type a live code, confirm it navigates to `/play?gameId=…`, enter a name, join, answer a round. That is the regression that must not happen, and it is not something curl fully covers.

### 10.3 The host flow

Signed in as a host: open Game History and Reports. Both must populate. Then sign out, sign back in, repeat — the token refresh path through `authFetch.js:12-24` is where an expired session would surface.

---

## 11. Shipping — and the ordering that matters

**Dev/test/prod are independent, and the change can be proved in dev before it goes near prod.** Deployment is branch-based (`buildspec-dev.yml` / `-test` / `-prod`, one pipeline each): merging to `test` and `prod` are separate, later, deliberate acts. Nothing here is a data migration or a schema change, so there is no cross-environment coupling.

**But do not ship it as one commit.** `buildspec-dev.yml:36-58` deploys the backend (`sam deploy`, `:49`) and only *then* builds and uploads the frontend (`:51-58`). So a single commit creates a window — and, because browsers cache the host bundle, a window that outlives the build — in which the API requires a token and the host page is still sending none. A host mid-session who opens Game History sees an empty modal and an alert.

**Two commits, in this order:**

1. **Frontend first.** `GameHostPage.jsx:2906` `fetch` → `authFetch`, plus its test. On a route that is still public, an extra `Authorization` header is simply ignored — this is a no-op in production behaviour and can sit deployed for as long as the owner likes. Deploy, confirm Game History still works.
2. **Backend second.** The `Auth:` block, the authorizer branch and its test. Now every client in the wild is already sending a token.

This makes the window zero and each step independently revertible.

**Deployment is the owner's** (CLAUDE.md, and `docs/handoff/` records the pipeline as the only route to any environment). This plan proposes; it does not deploy.

---

## 12. Adjacent findings — raise separately, do not fold in

Four things surfaced during this investigation that are outside the stated scope. Each is its own decision.

1. **`GET /games/{id}?role=host` returns the private-game `AccessCode` to anyone** (`get-game.js:72-79`; `role` is an unauthenticated query param at `:11`). Combined with a 4-digit id space and no rate limiting, this defeats the only control private sessions have (`join-game.js:56-90`). Closing `GET /games` removes the free directory but not this. **This is the most serious of the four.**

2. **`require-admin.js` may be reading claims that never arrive on this API.** `callerGroups` (`require-admin.js:46-48`) reads `event.requestContext.authorizer.jwt.claims` or `.claims`. But this API uses a **custom Lambda authorizer** with `EnableSimpleResponses: true` and payload 2.0 (`template-clean.yaml:366-369`), whose context surfaces at `event.requestContext.authorizer.lambda` — as `authorizer.js:158` states in its own comment, with groups as a **comma-joined string** at `:163`. If that is right, `requireAdmin` reads `[]` and, being fail-closed by design, **denies every real admin** on `/admin/users/*`. It shipped in `6a4ead84`, one commit ago. Worth ten minutes with the deployed API before anything else in this document.

3. **`POST /games` (create) is public** (`template-clean.yaml:220-221`), while `authorizer.js:107-109` would require `['hosts','admins']` if the authorizer were attached. Anyone can create sessions in any environment. Same shape of problem as this one, and the fix is the same three-part move — but it has *three* callers and one of them (`QuickstartMenu.jsx:105`) also calls `POST /games/{id}/start` unauthenticated, so it is a larger change than it looks.

4. **`PlayerPage.jsx:1354` calls `GET /admin/reports/{gameId}` with a bare `fetch`** from the unauthenticated player page. No such route exists in `template-clean.yaml`, so this is presumably a dead button returning 404 — but it should be confirmed dead rather than assumed.

---

## 13. Owner's decision

- [ ] **Option A** as specified in §8 — recommended
- [ ] Option B (public, reduced payload) — see §7 for why this is worse than it looks
- [ ] Option C (`/admin/games`) — only meaningful *in addition to* A
- [ ] Leave as is

And separately, on §12: **is #1 (`?role=host` leaks the access code) in scope for this piece of work, or its own?** The two share a threat model and the argument for fixing them together is strong.
