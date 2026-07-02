# Authentication & Authorization

How auth works in Engage2 after the UserPoolV2 migration (completed 2026-07).

## The one-diagram version

```
                                 ┌─────────────────────────────────────────┐
                                 │  Cognito UserPoolV2 (${stack}-users)    │
 Host/Admin browser              │  domain: ${stack}-auth-v2               │
 ───────────────►  Login  ─────► │  groups: admins > hosts > pending       │
   email/password or             │  trigger: PostConfirmation → pending    │
   "Continue with Google"        └──────────────┬──────────────────────────┘
                                                │ ID token (JWT)
                                                ▼
        fetch()            ┌──────────────────────────────────────────┐
 Player ─────────────────► │  HTTP API (RestApi)                      │
 (no account, no token)    │                                          │
                           │  /games/*  (player + host game flow)     │
                           │     └─ PUBLIC — no authorizer            │
                           │  /admin/create-github-issue (feedback)   │
                           │     └─ PUBLIC — player IssueFab uses it  │
                           │  /admin/*  (everything else, 29 routes)  │
                           │     └─ CognitoAuthorizer (Lambda)        │
                           │        validates JWT ┼ checks groups     │
                           └──────────────────────────────────────────┘
```

## How an admin logs in

1. Visit a protected route (`/host`, `/admin`, `/builder`) → `ProtectedRoute`
   (src/src/App.jsx) redirects unauthenticated users to the login form.
2. Sign in either way:
   - **Email/password** — `AuthContext.signIn()` via amazon-cognito-identity-js
     against the pool in `window.USER_POOL_ID` (set by `config.js`).
   - **Google** — `LoginForm.handleGoogleSignIn()` redirects to the Cognito
     hosted domain (`${stack}-auth-v2`) with `identity_provider=Google`;
     `OAuthCallback.jsx` stores the returned tokens in the same
     localStorage format the Cognito SDK expects.
3. `AuthContext` exposes the session; `getAuthToken()` returns the **ID token**.
4. Admin/builder screens call `/admin/*` APIs through `authFetch()`
   (src/src/auth/authFetch.js), which attaches `Authorization: Bearer <idToken>`.

## The three groups

| Group | Precedence | Grants |
|---|---|---|
| `admins` | 1 | Everything: question-set management, AI generation, user management, clear-all-games |
| `hosts` | 2 | Create/run games; may call `/admin/clear-game/{gameId}` (game reset from the host screen) |
| `pending` | 3 | Nothing — new signups land here (PostConfirmation trigger) until an admin promotes them via User Management |

## Where enforcement happens

- **`lambda-functions/auth/authorizer.js`** — HTTP API Lambda authorizer
  (payload format 2.0, simple responses). Validates the JWT signature against
  the pool's JWKS, checks issuer/audience, rejects `custom:status = disabled`,
  fetches the caller's groups, and applies route rules
  (`requiredGroupsForRoute`): `admin/clear-game*` → hosts|admins, other
  `admin*` → admins.
- **Route opt-in** — the authorizer is attached per-route in
  `template-clean.yaml` (`Auth: Authorizer: CognitoAuthorizer` on each admin
  event). There is deliberately **no DefaultAuthorizer**: player and host
  game-flow routes (`/games/*`, `/question-sets*`) are public.
- **Frontend** — `ProtectedRoute` gates pages (UX only, not security);
  `authFetch` supplies tokens for the protected APIs.

### Currently public by design (follow-ups)

- **All `/games/*` routes** — players are anonymous by design; the host UI
  also calls these without tokens today. Protecting host game-management
  routes (create/start/next-question…) means routing those fetches through
  `authFetch` first — planned as the next auth increment.
- **`/admin/create-github-issue`** — player feedback (IssueFab on the player
  page) posts here anonymously. Follow-up: move it under `/feedback`.
- **WebSocket API** — `$connect` has `AuthorizationType: NONE` for players
  and hosts alike.

## Configuration flow

`src/public/config.js` is **regenerated at deploy time** from CloudFormation
outputs (`UserPoolId`, `UserPoolClientId`, `UserPoolDomain`):

- dev: `scripts/deploy-frontend-eng.sh`
- test/prod CI: `buildspec-test.yml` / `buildspec-prod.yml`

The committed copy holds dev defaults for local work only. `AuthContext` and
`authFetch` lazily read `window.USER_POOL_ID` / `window.USER_POOL_CLIENT_ID`
at call time so `config.js` load order doesn't matter.

## Post-confirmation trigger

New signups are put in `pending` (plus `custom:status`/`custom:role` and a
DynamoDB `USER#` profile) by `lambda-functions/auth/post-confirmation.js`.
The pool→lambda trigger wiring cannot live in the template (circular
dependency), so:

- the **invoke permission** is in the template (`PostConfirmationLambdaPermission`),
- the **trigger attachment** is done post-deploy by
  `scripts/setup-post-confirmation.sh <stack>` (idempotent — safe to re-run
  after any deploy; already attached on engdev).

## Rollback: the old user pool

The original pool (`us-east-1_bKTK5F5Jm`, client `5brt6hub6e2gmi7hmuuidfi3nc`)
had an immutable email attribute that broke Google OAuth ("Attribute cannot
be updated"). It is **kept alive for rollback only** and is not referenced by
any primary flow. Its IDs are quarantined in the `LEGACY_POOL` block in
`src/src/auth/OAuthCallback.jsx`. To roll back: point `config.js` values at
the old pool and restore the old Google redirect URI. Remove `LEGACY_POOL`
when the old pool is deleted.

---
*Supersedes `docs/AUTHENTICATION_RECOVERY.md` (2025-08-14).*
