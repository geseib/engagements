# Console Overview and scope tabs: implementation plan

**Goal:** build SPEC.md §7 as ruled by the owner on 2026-10-11: an Overview section first
in every scope, a row of scope tabs replacing the organisation chip, the two backend
routes, and accounts created from a team invitation that have no personal space.

**Spec:** `SPEC.md` and the rendered `index.html` (commit cf478533) in this folder. The
mockups are the design; where this plan and a mockup differ, the mockup wins unless a
deviation is named in `docs/handoff/console-overview-2026-10-11.md`.

## Global constraints

- Laptop ladder 12 / 13 / 15 / 19 / 24 / 30, rows 36px, nothing under 12px.
- One orange (`--primary`) element per screen: the next action. Classes: people blue,
  stuck red (`--danger` as a border only), info grey.
- Plain words, no emoji. Phone, laptop and tablet all named where screens are named.
- Below 760px: Overview and the scope sheet work; other sections say they need a laptop
  or tablet. No horizontal scroll at 1280, ~660 and 375px.
- No new Lambda. Route permission resources are fine. Pipeline jest is Node 18.
- Every staff or team action that changes an account writes `recordAudit` FIRST and is
  refused when the entry cannot be written.

## Backend

1. **Invite-only accounts** (`admin/orgs/accept-invite.js`, `shared/personal-org.js`).
   Accepting while not yet approved (no `hosts`/`admins` group) and with no personal space
   stamps PROFILE `joinedByInvite = <orgId>` (if_not_exists) and the MEMBER row
   `joinedByInvite: true, awaitingHostApproval: true`. `ensurePersonalOrg` skips such an
   account while it belongs to at least one organisation (reason `invite-only`); with none
   left it provisions as before, so nobody approved is left with nowhere. A new
   `{ force: true }` option creates the space on request.
   Quiet later route: `POST /orgs` with `{ "personal": true }` (create-org.js, no template
   change) calls `ensurePersonalOrg(event, { force: true })`.
   Tests: `tests/invite-only-accounts.js`.
2. **Team approval** (`admin/orgs/approve-member.js`, mounted on the existing
   `UserManagementFunction` as `POST /orgs/{orgId}/members/{sub}/approve`, routed BEFORE
   `requireAdmin` with its own `authorizeOrg(…, 'admin')`). The member must carry
   `joinedByInvite` + `awaitingHostApproval`; the account must be enabled and in `pending`
   (found by `ListUsers` filter `sub = "…"`). Audit first into the team's log, then
   pending -> hosts, then the flag is cleared. Staff `changeUserState` clears the flag on
   every membership when an account leaves `pending`. `list-members.js` adds
   `canHost`, `awaitingHostApproval`, `joinedByInvite`. Tests: `tests/team-approve-hosting.js`.
3. **`GET /me/attention`** on the existing `OrgsListFunction` (list-my-orgs.js dispatches
   to `orgs/my-attention.js`). Counts only, people + stuck classes, per org the caller
   belongs to, plus `~platform` for staff and `invites` for the caller's own address.
   Template: one new route event, `USER_POOL_ID` env and `cognito-idp:ListUsersInGroup`
   on that function. Tests: `tests/me-attention.js`.

## Frontend

4. `config/consoleSections.js`: `SECTION.overview` first in personal, team and platform.
   `config/overviewAlerts.js` (pure): box builders and ordering (people, stuck, info;
   oldest first), the tab-count arithmetic, the overflow split for the tabs.
5. `components/ScopeTabs.jsx/.css` (`.scp`): Personal, teams A to Z, + New team, rule,
   Engage; counts; `N more` menu (OrgSwitcher's keyboard code); below 760px one button
   and a bottom sheet. Width-driven overflow measured with a ResizeObserver in the
   browser, a pure `splitTabs(n visible)` underneath for tests.
6. `components/OverviewPanel.jsx/.css` (`.ovw`): Needs you boxes (expand in place, rows
   with existing inline actions, foot link to the section), then four tiles.
7. `AdminShell`: a `scopeBar` slot spanning both columns; a layout below 760px with
   Sections in the top bar; `narrowNote` for sections not built for phones.
8. `AdminPage`: wiring, the Plan requests badge fetched on entering platform mode, an
   Accounts badge, the acting-as banner on Overview in platform mode, seen marker for the
   audit box when Data & privacy opens.
9. Tests: `overviewAlerts.test.js`, `overviewPanel.test.jsx`, `scopeTabs.test.jsx`,
   `overviewPalette.test.js`, `consoleSections.test.js` additions, wiring tests updated.

## Review focus

- An invite-only account that is removed from its only team: must get a personal space
  on the next console load, not a blank console.
- A team owner approving somebody Engage rejected (disabled): refused, flag cleared.
- A member of team A approving an invitee of team B by changing the URL: refused.
- `/me/attention` for a member: no counts for members or invitations of the team.
- Eight teams at 660px with the active one alphabetically last: still visible.
