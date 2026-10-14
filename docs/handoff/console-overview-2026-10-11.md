# Handoff: console Overview, scope tabs, team approval, invite-only accounts (2026-10-11)

Branch `working/build-room-host-redesign`. Nothing pushed, tagged or deployed.
Design: `docs/design/admin-landing/` (index.html, SPEC.md, PLAN.md). Owner's rulings on
SPEC §9 are recorded in PLAN.md and below.

## Commits

| Commit | What |
|---|---|
| `8171313c` | PLAN.md |
| `f958de69` | Backend: invite-only accounts, team approval route, `GET /me/attention`, template |
| `e2c23c45` | Frontend: Overview, scope tabs, shell slot and narrow layout, AdminPage wiring, badges |
| `b01fac35` | Members screen: "cannot host yet" and Approve hosting |

(`92a2921e` between them is another session's Call & Answer work in the same worktree.)

## What each scope's Overview shows

Alerts first ("Needs you" / "Needs Engage"), people then stuck then info, oldest first; each
box opens in place, rows carry only actions that already exist, the foot links to the
section that owns the action. Then four tiles. One orange per screen
(`config/overviewAlerts.js` `orangeTarget`). Nothing waiting: "Nothing needs you." and no
orange.

| Scope | Boxes | Tiles |
|---|---|---|
| Personal | Team invitation (Accept); Sent back by the check (Open the set); Free plan x of 5 (info at 4, stuck at 5; See plans opens the plan dialog); Your plan request (Withdraw); Reports deleted soon (Download) | Sessions x of 5 with meter, Participants, Questions asked, Question sets x of 5 (`/stats` + `/usage`) |
| Team owner/admin | Awaiting approval (Approve); Invitation running out (Copy link, Revoke with confirm); Sent back; usage (capped plans only); plan request; Engage staff opened your content (Read the log; clears once Data & privacy is opened, per browser); Reports deleted soon | Sessions counted, Participants, Questions asked, This month so far |
| Team member | Sent back; Reports deleted soon | Question sets in the team library, Members; "Monthly numbers are shown to the team's owners and admins." |
| Engage | Accounts awaiting approval (Approve as host, Reject with the existing confirm); Plan requests (Decide opens the existing `DecideRequestDialog`); Sets waiting in Moderation (Review links to Moderation); Claude 5.5 chosen but not connected (Engage settings) | Accounts (n pending), Organisations, Sessions counted this month, Question sets (`/platform/observability`) |

Team invitations show on Personal, or on every team when the account has no personal space.

## The tabs

`components/ScopeTabs.jsx` replaces the org chip in the console (the host screen keeps
`ActiveOrgSwitcher`, ruling 9). Personal, teams A to Z, rule, Engage (staff). Count pill when
> 0, never orange; role on the active team tab only; active = `--secondary` underline.
Overflow measured in the browser: as many teams as fit (each up to 280px), then "N more"
with the sum of hidden counts; the active team always keeps a tab; Engage never folds. When
even one team will not fit, "+ New team" leaves the row (it is in the More menu). At 480px
and below: one button (name, role, "n elsewhere") opening a bottom sheet. Choosing a scope
sets the active org and loads `/admin` (its Overview); the reload is kept. "+ Personal space"
appears only for an invite-only account with no space.

Tab numbers: other scopes from `GET /me/attention`; the open scope uses its own Overview's
total once loaded. Only people and stuck count (info boxes do not); see deviations.

## Routes

| Route | Function | Auth |
|---|---|---|
| `GET /me/attention` | existing `OrgsListFunction` (list-my-orgs.js dispatches to `orgs/my-attention.js`) | any signed-in caller; counts only for orgs they belong to; members get only sets sent back; `~platform` only for the `admins` group |
| `POST /orgs/{orgId}/members/{sub}/approve` | existing `UserManagementFunction` (`orgs/approve-member.js`), routed BEFORE its staff gate | `authorizeOrg(…, 'admin')`; the MEMBER row must carry `joinedByInvite` + `awaitingHostApproval`; account read live from Cognito must be enabled and pending; `recordAudit` into the team's log FIRST (503 and nothing changed if it fails) |
| `POST /orgs` with `{ "personal": true }` | existing create-org | approved account; idempotent `ensurePersonalOrg(…, { force: true })` |

**Template:** two new HttpApi events (`MyAttention`, `ApproveTeamMember`), so two new
`AWS::Lambda::Permission` resources; no new function. `OrgsListFunction` gains env
`USER_POOL_ID` and `cognito-idp:ListUsersInGroup` on the pool. `tests/template-validates.js`
and `tests/kms-grants-match-code.js` pass.

## The invite-only account path

- `accept-invite.js`: a caller NOT in `hosts`/`admins` who accepts gets MEMBER
  `joinedByInvite: true, awaitingHostApproval: true`; if PROFILE has no `personalOrgId`,
  PROFILE gets `joinedByInvite = if_not_exists(…, orgId)`. Approved accounts: unchanged.
  (It reads groups/profile itself rather than importing personal-org.js, which would put
  tenant-crypto and a KMS grant on that function.)
- `shared/personal-org.js` `ensurePersonalOrg`: with the stamp and no personal space, it
  provisions nothing (`reason: 'invite-only'`) **while the account belongs to at least one
  org**; removed from every team, it provisions as before (no approved account is left with
  nowhere). `{ force: true }` creates one on request.
- `list-my-orgs.js` returns `canCreatePersonal` (true only for `invite-only`).
- Approval: team owner/admin (route above) or Engage (`manage-users.js`, which now also
  clears `awaitingHostApproval` on every membership when an account leaves `pending`).
- `list-members.js` (via `publicMember`) now returns `joinedByInvite`, `awaitingHostApproval`,
  `canHost`. Members screen shows "cannot host yet" and "Approve hosting".

Risks: (1) an EXISTING pending account (signed up, never approved) that accepts an
invitation now becomes invite-only — that is what "arrives through a team invite" reads as,
but say so if not; it can still make a space later. (2) `canHost` is the stored flag, not a
live Cognito read; members who joined before today read `canHost: true` even if pending.
(3) after a team approves, the invitee's token still says `pending` until it refreshes
(the same as a staff approval today). (4) the approve route sits ahead of
`requireAdmin` in manage-users.js; it matches one exact path shape and carries its own gate,
and `tests/invite-only-accounts.js` checks the gate still guards the other routes.

## Measurements (browser, a harness mounting AdminShell + ScopeTabs + OverviewPanel)

No horizontal scroll anywhere: `document.scrollWidth == innerWidth` and the work body's
`scrollWidth == clientWidth` in every case; nothing outside the viewport; smallest text 12px.

| Width | Team owner (box open) | 8 teams + Engage | Engage (box open) | Personal |
|---|---|---|---|---|
| 1280 | 1280/1280, row 1280/1280, 1 orange, buttons 32px | Personal, Acorn, Bayview, Harbour, 5 more, Engage | same 4 + 5 more | Personal, Northwind |
| 900 | — | Personal, Harbour, 7 more, Engage; 900/900 | — | — |
| 660 | 660/660 (Sections ▾, no rail) | 660/660 (before the + New team fix: row 760/660) | 660/660 | 660/660 |
| 375 | 375/375, button + "3 elsewhere", row buttons 40px | sheet 375 wide, 11 items at 48px | 375/375 | 375/375 |

Below 760px a non-Overview section shows "This screen needs a laptop or tablet." with a way
back; the Sections panel opens over the work area with 40px items.

Contrast (`__tests__/overviewPalette.test.js`, composited): text on box 12.53:1, muted on box
6.06:1, `--bg` on the orange button 8.86:1, links 5.91:1, Reject 5.84:1, scope row muted
6.74:1, + New team on the row 5.98:1, menu text 11.9:1.

## Tests

Backend: 316 suites, 0 failed (exit codes, parallel, `.aws-sam` cleared). New:
`tests/me-attention.js` (11, paged table at 2 rows), `tests/invite-only-accounts.js` (19).
Frontend: 483 suites, 11844 tests, all passing; lint 0 errors (11 warnings, none in these files); build exit 0 with its two size warnings. New: `overviewAlerts`, `overviewPanel`,
`scopeTabs`, `overviewPalette`, `adminOverviewWiring`; `teamPanel` +3. Updated for the new
landing section: consoleSections, consoleModes, adminDeepLink, adminOneSection, adminShare,
adminCopyRebind, adminOrgWiring, consolePersonas, AdminPage.

## Deviations from the mockups and SPEC

- Tab counts are people + stuck only; the mockup's F1 "3" counted the 4-of-5 usage box.
  The server cannot know the per-browser "since you last looked" marker, so counting info
  would make tabs and pages disagree. The heading "n things" still counts every box.
- No "Not yet" (with a note the person reads) on Awaiting approval: ruling 8 limits inline
  actions to ones that exist; there is no note channel to a pending person yet.
- Team member tiles are Question sets and Members (the mockup's "Sessions kept" has no read
  a member is allowed).
- Reports deleted soon shows every report in the scope (rows carry no "saved by"); its foot
  links to Reports on the host screen, the only Reports place.
- Moderation Review links to the Moderation section (its dialog is not exported).
- Claude 5.5 is not counted in `/me/attention` (the org-list function cannot see the
  Anthropic connection); it shows on the Engage Overview.
- The tile is the Overview's own `.ovw-tile`, drawn as `.pobs-tile`, not `UsageStatsPanel`'s
  `Tile` (whose rules are scoped to `.ust`).

## For the owner to decide or check

1. Should an existing, never-approved account that accepts an invitation become invite-only?
2. Is "Not yet" with a note still wanted on Awaiting approval (needs a message channel)?
3. The acting-as banner is kept and now covers the Overview (ruling 11, one release).
4. Look at it on dev once deployed: the measurements above are from a harness with fixed
   data, not a signed-in console.

## Owner rulings, 2026-10-11 (after the build)

- **Paid teams only approve hosting.** `org-guards.canApproveHosting(org)`: a team (never a personal space) whose stored plan is not `free`. Every team starts Free and reaches a paid plan only through an approved plan request, so a host cannot make a Free team and grant hosting to whoever they invite. Enforced in `approve-member.js` (403, nothing written); `list-members.js` returns `canApproveHosting` so the Members button and the Overview follow it; `my-attention.js` does not count a Free team's waiting invitees. On a Free team the Overview shows the same people as information, "Waiting for Engage", linked to Plan & usage. Tests: `invite-only-accounts.js`, `me-attention.js`, `overviewAlerts.test.js`, `teamPanel.test.jsx`.
- **Existing never-approved accounts become invite-only** when they accept an invitation (no personal space while they belong to a team), as built.
