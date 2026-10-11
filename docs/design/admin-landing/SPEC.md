# Console overview: a landing page per scope, and one row of scope tabs

Owner, 2026-10-11: "In the Admin page there should be an admin landing page with Alerts,
with any actions, and a highlight of major stats looking similar to the observability
screen. 'Awaiting Approvals: 3' in a nice box; clicking it shows the list expanded. Also it
should list at the top all of your teams as tabs or something (think through the best
interface for this). We need to make it easy to manage Individual, teams (might be part of
a few, but likely 1), and then Engage admin."

Mockups: `index.html` (serve `docs/design`, open `admin-landing/`). Frames F1 to F6, the
switcher with 1, 3 and 8 teams, and true-size 660px and 375px frames that print their own
`scrollWidth` on load (all three measured equal to their width: no horizontal scroll).

**Design only. Nothing in `src/` or `lambda-functions/` has changed.**

---

## 1. The decision in one paragraph

Every scope (Personal, each team, Engage) gets a first section called **Overview**. It has
two parts: **Needs you**, a stack of boxes, one per kind of thing waiting, each with a count
and a plain title ("Awaiting approval · 3"), which open in place with the actions beside
each row and a link to the full section; then **this month in numbers**, four tiles drawn as
the Observability tiles are. Above the nav and the work area, a **row of scope tabs**
replaces the organisation chip: Personal, then each team A to Z, then Engage for staff,
each with the number of things waiting there. It is still the only switcher.

## 2. What the console does today (verified)

| Fact | Where |
|---|---|
| The nav is computed per person and scope; platform is an exclusive **mode** chosen in the switcher, value `~platform`. | `src/src/config/consoleSections.js:41-66, 89, 374-394` |
| The first item of the first group is where you land. Today: Question sets (personal, team); Organisations (platform). | `consoleSections.js:376-377, 510-514`; `AdminPage.jsx:1356` |
| The switcher is a chip in the topbar, before the environment chip, with a menu: your organisations, then "Act as · Engage" for staff, then "Create an organisation". | `components/OrgSwitcher.jsx:234-334`; `AdminShell.jsx:169` |
| One organisation and no Create collapses the chip to a label. In practice Create is always passed, so the menu always opens. | `OrgSwitcher.jsx:200-232`; `AdminPage.jsx:1578` |
| Switching writes the active org id and **reloads the page**, so no panel keeps another team's rows. | `AdminPage.jsx:630-640`; `ActiveOrgSwitcher.jsx:84-94` |
| The host screen mounts the same chip without platform mode. | `components/ActiveOrgSwitcher.jsx:22-28, 96-102` |
| Nav items carry a `count` (a size) or a `badge` (decays if nobody looks). | `AdminShell.jsx:115-122` |
| Moderation's count is fetched when staff enter platform mode. | `AdminPage.jsx:507-527` |
| **The Plan requests badge is empty until somebody opens Plan requests**: only `PlanRequestsPanel` sets it, through `onCountChange`. | `AdminPage.jsx:237, 1552-1554, 1976` |
| **Accounts has no badge at all**, though "Registration lands people in pending. Somebody has to move them." | `consoleSections.js:285-295`; `AdminPage.jsx:1530-1558` |
| Question sets carries a badge for sets the check sent back. | `AdminPage.jsx:1541` |
| The console has no layout below 1180px: "Nothing here is designed for a phone". | `components/AdminShell.css:101-113` |
| Observability tiles: label 13, numeral 30, one-line sub, 4 across, 2 across under 1180px. | `components/ObservabilityPanel.jsx:73-110`; `ObservabilityPanel.css:120-159` |
| The Activity page's tiles (sessions counted, questions, participants, kept, sets) and its `Tile` are exported. | `components/UsageStatsPanel.jsx:130-161` |

## 3. Alert inventory, per scope

"Exists" means a shipped route already returns the rows and a shipped screen already offers
the action; the Overview only gathers them. "Derived" means the data exists and the
condition is computed in the browser. **NEW** means it does not exist.

Urgency classes, in this order: **people** (a person or customer is waiting on you),
**stuck** (something of yours cannot go ahead), **info** (for your information). Within a
class, oldest first. The left edge of each box carries the class: blue, red, grey. Orange is
never a class colour; it is kept for the one next action on the screen.

### 3.1 Personal (your own space)

| Box | Class | Source | Actions in the row | State |
|---|---|---|---|---|
| Team invitation · n | people | `GET /invites` (`admin/orgs/list-my-invites.js:56-76`) | **Accept** → `POST /invites/{token}/accept`. No Decline (owner, 2026-10-10, `docs/design/pending-invite-notice/PLAN.md` decision 2) | Exists (`components/PendingInvites.jsx:85`) |
| Sent back by the check · n | stuck | the set list already loaded; `share.status === 'flagged'` (`AdminPage.jsx:1541`) | Open the set (the note is on it) | Derived |
| Free plan: x of 5 sessions used | info, or stuck at 5 of 5 | `GET /orgs/{orgId}/usage` (`admin/get-usage.js:252-264`); Free is a cap of 5 sessions and 5 sets (`admin/shared/pricing.js:106-134`) | See plans → the existing plan request dialog (`PlanRequestDialog.jsx`) | Derived. Show at 4 of 5 and at 5 of 5 |
| Your plan request | info | `GET /orgs/{orgId}/plan-requests` (`plan-requests.js:248`) | Withdraw → `DELETE …/plan-requests/{reqId}`; on a decision, the note Engage wrote | Exists |
| Reports deleted soon · n | info | `GET /reports`, `expiresAt` per row (`game/get-reports.js:97`) | Download → `GET /reports/download` (needs the passkey, held on the row) | Derived. Show within 7 days |

### 3.2 A team, as owner or admin

| Box | Class | Source | Actions | State |
|---|---|---|---|---|
| **Awaiting approval · n** (people who accepted your invitation and cannot host yet) | people | **NEW.** `GET /orgs/{orgId}/members` returns members and invites but not whether a member is still `pending` in Cognito (`list-members.js:59-98`). Only Engage staff move pending to hosts (`admin/manage-users.js:279`, `PLAN.md` of pending-invite-notice). | Approve, Not yet (with a note the person reads) | **NEW, open question 1.** If the owner says no, the box stays as **info**: "Waiting for Engage to approve · n", no actions |
| Invitation running out · n | people | `GET /orgs/{orgId}/members` → `invites[]` with `expiresAt`; `outstandingInvites` (`list-members.js:88-98`) | Copy link; Revoke → `DELETE /orgs/{orgId}/invites/{token}` (`TeamPanel.jsx:862`) | Derived. Show within 2 days of expiry, and expired ones (only an admin can clear them, and they block re-inviting the address) |
| Sent back by the check · n | stuck | as Personal | Open the set | Derived |
| Your plan request | info | as Personal | Withdraw | Exists |
| Engage staff opened your content · n | info | `GET /orgs/{orgId}/audit` (`components/AuditLog.jsx:16-23`), rows whose actor role is platform staff | Read the log | Derived; "since you last looked" is **NEW** (a seen marker; browser storage is enough) |
| Reports deleted soon · n | info | as Personal | Download | Derived |

### 3.3 A team, as member

Only what is the member's own: team invitations are not shown here (they are personal);
**Sent back by the check** for sets they own; **Reports deleted soon** for reports they
saved. Nothing about members, plan or the log: those sections are not in a member's nav
(`consoleSections.js:442-445`), and a box for a place you cannot open is a control that
refuses you.

### 3.4 Engage (staff, platform mode)

| Box | Class | Source | Actions | State |
|---|---|---|---|---|
| Accounts awaiting approval · n | people | `POST /admin/users/list`, rows whose state is `pending` (`UserManagement.jsx:196-226`, `roleOf` at `:61-71`) | **Approve as host** → `PUT /admin/users/{username}/state` `hosts`; **Reject** → `disabled`, after the existing confirm (`UserManagement.jsx:416-451`) | Exists. Also give Accounts a nav badge (new, one line in `AdminPage.jsx`) |
| Plan requests · n | people | `GET /platform/plan-requests?status=requested` (`plan-requests.js:256-277`) | **Decide** → opens the existing decision dialog, which requires a note the customer reads (`PlanRequestsPanel.jsx:151-179`) | Exists. Fetch on entering platform mode so the nav badge is right before the section is opened |
| Sets waiting in Moderation · n | people | `GET /admin/moderation` → `count` (`AdminPage.jsx:519-523`) | **Review** → the existing Moderation dialog. Not Approve from the Overview: a set is judged on its findings (`ModerationPanel.jsx:160-252`) | Exists |
| Claude 5.5 chosen but not connected | stuck | `GET /platform/settings/claude-models` → `anthropic55 && !connected` (`admin/orgs/platform-settings.js:41-53`) | Engage settings | Derived |

Considered and left out, with the reason:

| Candidate | Why not |
|---|---|
| AI generation jobs | There is no list route; each job is polled by id (`/admin/ai-generate-*/{jobId}`). Missing data, and a job belongs to the screen that started it. |
| Build Room plugin out of date | Shown on the Host screen (`BuildRoomPage.jsx`, amber dot on SESSION). It is about a laptop, not a scope. |
| Audit log (platform) | It is a record, not a queue. Linked from Observability's neighbour, not counted. |
| Invoices | Billing is simulated; a closed month is not a thing to do. Plan & usage shows it. |
| Organisation status / discount codes | Nothing in either waits on staff. |

## 4. The switcher: a row of scope tabs

### 4.1 Recommendation

**A row of tabs under the topbar, spanning the nav and the work area, replacing the
organisation chip.** One switcher, as today; it just shows its choices instead of hiding
them.

Why: most people have Personal and one team, and the owner wants every team named at the
top. A tab row names them all and, with a count on each tab, says where something waits
without anyone opening a menu. A segmented control breaks on long team names and more than
three or four choices. A dropdown (today's chip) scales but hides the other places and
what waits in them, and it already carries three jobs (switch, act as Engage, create). Tabs
and chip together would be two controls for "who am I right now", the doubling the tenancy
work removed twice (`consoleSections.js:41-61`). The comparison is drawn in `index.html#why`.

### 4.2 Behaviour

- **Order is fixed:** Personal, then teams A to Z, then a rule and **Engage** (staff only),
  then nothing. A team is always in the same place; tabs never reorder by activity or by
  count.
- **Each tab:** a tile (initials; a round one for Personal, a lock-blue one for Engage),
  the name, the role on the active tab only ("Owner", "Member", "Staff"), and the count of
  boxes-worth of things waiting, when it is more than zero. Neutral pill, never orange.
- **Active tab:** text colour plus a 2px `--secondary` underline. Not amber: amber in the
  nav already means "the section you are in" (`AdminShell.css`, `.adm-nav-item[aria-current]`).
- **Overflow:** as many tabs as fit at full name (a tab may be up to 280px). When they do not
  fit, the last slot becomes **N more ▾** carrying the sum of their counts; it opens a menu
  listing the rest A to Z with role and count. The active team is always one of the visible
  tabs (it takes the last slot before More). Engage never goes into More.
- **+ New team** sits at the right of the teams. It is today's "Create an organisation"
  (`OrgSwitcher.jsx:320-332`) and opens the same `CreateOrgDialog`.
- **Personal only:** one tab plus **+ New team**. The row is not a control with one choice,
  so the RATIONALE §3 worry about ignored controls does not apply.
- **Choosing a tab** sets the active scope exactly as `handleSwitchOrg` does today and
  reloads to that scope's **Overview** (`?section=overview`). The reload stays: it is the
  tenancy guarantee.
- **Keyboard and roles:** it is navigation, not an ARIA tablist (each choice reloads the
  page), so `<nav aria-label="Where you work">` with links and `aria-current="page"` on the
  active one. More is a menu button reusing OrgSwitcher's menu code.
- **Below 760px:** one full-width button naming the current scope and role, with a blue
  chip "n elsewhere" when other scopes have something waiting; it opens a bottom sheet
  listing every scope (OrgSwitcher's list, in a sheet). The left nav goes behind
  **Sections ▾** in the top bar.
- **The host screen** keeps `ActiveOrgSwitcher` (chip, no Engage) for now: its only verb is
  "start an engagement" and it has no room for a row. Open question 9.

At 1280px: Personal plus 3 teams plus Engage fit at full names; with 8 teams, Personal, 3
teams, **4 more**, and Engage (frame "8 teams"). At 660px: Personal, the active team and
**1 more**. At 375px: the button and the sheet.

## 5. Stats per scope

Four tiles, as `.pobs-tile` (label 13, numeral 30, sub 13 truncated with `title=`), headed
with the month and "as of", and a link to the full page. Four, not five: five across at the
work area's width cut every sub line (measured in the mockup before it was cut back).

| Scope | Tiles | Source | State |
|---|---|---|---|
| Personal | Sessions counted (x of 5 on Free, with a meter) · Participants · Questions asked · Question sets (x of 5 on Free) | `GET /orgs/{personalOrgId}/stats` (the caller owns the personal org, so `authorizeOrg(…, 'admin')` admits them, `get-usage.js:121-123`) and `GET /orgs/{orgId}/usage` | Route exists. The personal console has no Activity section today, so this is the first screen that reads it for a personal space |
| Team, owner/admin | Sessions counted (created · started) · Participants · Questions asked · This month so far ($ and plan) | `GET /orgs/{orgId}/stats` (`UsageStatsPanel.jsx:150-161`) and `/usage` | Exists |
| Team, member | Question sets in the team library · Sessions kept | the set list and session list the console already loads | Exists. No monthly numbers: Activity is owners and admins only (owner, 2026-10-11, `consoleSections.js:163-168`); the page says so in one line |
| Engage | Accounts (any status · n pending) · Organisations (teams · personal) · Sessions counted this month · Question sets (Engage · public) | `GET /platform/observability` (`ObservabilityPanel.jsx:83-110`; the month row for sessions) | Exists |

## 6. Layout

- **Order:** Needs you, then the numbers. When nothing waits, one green line, "Nothing needs
  you.", and the tiles rise to meet it. No orange on that screen.
- **A box:** count (30px numeral) · title (15, bold) and one summary line (13, muted) · the
  box's main action · a caret. The whole head toggles. Open, the body lists rows (name,
  then how they came and how long they have waited) with the actions beside them, wrapping
  under the name when narrow (`margin-left:auto` on the action group plus `flex-wrap`, never
  `justify-content:flex-end`, engage-design rule 9). The foot says "Showing 3 of 3" and links
  to the full section. More than five rows: show five and "Showing 5 of 12".
- **One orange per screen:** the next action. Collapsed, it is the top box's main action;
  once a box is open, it is that box's oldest row's main action. Every other action is a
  plain or ghost button. Reject stays the `--danger-text` outline it already is.
- **Destructive actions** keep their existing confirmations (Reject's `window.confirm`; Not
  yet asks for a short note in the row). Nothing new deletes anything.
- **Widths:** the page is `max-width:1000px`. Under 1180px the tiles go two across (as
  Observability does). At 375px the row actions go full width at 40px.
- **Theme and type:** dusk (`contentTheme: 'dark'`), laptop ladder 12/13/15/19/24/30, rows
  at least 36px (alert rows 52px because they carry two lines).

## 7. What code would change

Frontend (`src/src/`):

1. `config/consoleSections.js`: a new `SECTION.overview` (`id: 'overview'`, label
   "Overview", `contentTheme: 'dark'`), first in the personal `space` group, the team `org`
   group and the platform group. `defaultSectionIdFor` then lands there with no other
   change; update the comment at `:376-377` (Organisations is no longer the landing
   section). `AdminPage.jsx:186, 1919` draws the "acting as Engage" banner by section id;
   `overview` exists in every scope, so in platform mode the banner must also show on it
   (add it to that check when `onPlatform`). With the Engage tab always on screen the
   banner may no longer be needed at all: open question 11.
2. `components/OverviewPanel.jsx` + `OverviewPanel.css` (scope `.ovw`): the boxes and the
   tiles. Per scope it composes the routes in §3 and §5. Each box is a small component fed
   by one loader, so a failed read hides one box and says "Could not read …", never blanks
   the page (the Observability partial-alert pattern, `ObservabilityPanel.jsx:289-302`).
   Reuse `Tile` from `UsageStatsPanel.jsx:130`.
3. `components/ScopeTabs.jsx` + `.css` (scope `.scp`): the row, the More menu and the
   narrow-width sheet. Built from `OrgSwitcher.jsx`'s menu code (Escape, focus restore,
   arrow keys); `OrgSwitcher` stays for the host screen.
4. `components/AdminShell.jsx/.css`: a `scopeBar` slot rendered as a grid row under the
   topbar spanning both columns; `orgSwitcher` is no longer passed from the console. A
   layout below 760px (top bar with **Sections ▾**, no rail) for Overview at least.
5. `AdminPage.jsx`: render `OverviewPanel` when `resolvedTab === 'overview'`; pass
   `ScopeTabs` with `handleSwitchOrg`; fetch the plan-request count on entering platform
   mode (not only when the section opens); add an Accounts badge.
6. Tests: `overviewPalette.test.js` (named `*Palette*`, never `*Token*`, `.gitignore:35`),
   `consoleSections.test.js` (Overview first in every scope; member gets no team boxes),
   a ScopeTabs test (order fixed, active tab never in More, Engage never in More, counts
   summed on More), and box-order tests (people before stuck before info, oldest first).

Backend (`lambda-functions/`), only if the owner agrees:

7. `GET /me/attention` (NEW, open question 2): `{ scopes: { "<orgId>": n, "~platform": n } }`
   for the tab counts. It runs the same reads as the boxes, server-side, for each of the
   caller's orgs; staff get the platform count. Without it, tabs other than the open one
   carry no number.
8. Team approval (NEW, open question 1): `list-members.js` adds `canHost: boolean` per
   member (one `AdminListGroupsForUser` each, or a stored stamp); a new
   `POST /orgs/{orgId}/members/{sub}/approve` (owner/admin, the person must be a member who
   joined by this team's invitation, account state `pending`) that moves them to `hosts`
   and writes `recordAudit` first (the delete-and-staff rule, owner 2026-10-04). "Not yet"
   writes a note the person reads on their waiting screen.

## 8. Words

"Overview", "Needs you", "Needs Engage", "Nothing needs you.", "Awaiting approval",
"Invitation running out", "Sent back by the check", "Reports deleted soon", "Engage staff
opened your content", "Accounts awaiting approval", "Plan requests", "Sets waiting in
Moderation", "Claude 5.5 is chosen but not connected", "n more", "+ New team", "n
elsewhere", "Sections". Phone, laptop and tablet are all named where the copy talks about
screens. No emoji.

## 9. Open questions

1. **May a team owner or admin approve hosting for people who joined through their
   invitation?** Today only Engage staff move an account from `pending` to `hosts`; a team
   owner can see that a member cannot host but can do nothing about it. The owner's
   "Awaiting Approvals: 3" box fits a team only if the answer is yes. **Recommended: yes**,
   limited to accounts that accepted this team's invitation, audited, and Engage is told
   (the account still shows in staff's queue as "approved by Northwind Learning" and staff
   can reject). If no, the box becomes information ("Waiting for Engage · 3") with no
   action, and staff's Accounts box shows which team each pending person joined.
2. **One new read for the tab counts.** Counting what waits in every scope needs either a
   request per scope from the browser on every console load (eight teams, eight-plus
   requests) or one route. **Recommended: `GET /me/attention`**, counts only, no rows. Ship
   the Overview first with a count on the open tab only if this has to wait.
3. **Name and position.** **Recommended: "Overview"**, first item and landing section in
   every scope. This moves Organisations to second in the Engage console and Question sets
   to second everywhere else; bookmarks with `?section=` are unaffected.
4. **Alerts first, or numbers first?** Observability puts tiles at the top. **Recommended:
   alerts first**: the page exists so that what waits is the first thing seen; the tiles
   are constant and can sit below. When nothing waits the tiles are on the first screen
   anyway (F6).
5. **Dismissing a box.** **Recommended: no dismiss.** A box goes away when its cause does
   (approved, accepted, expired, withdrawn). The one exception is "Engage staff opened your
   content", which clears once you open the log (a seen marker).
6. **The console on a phone.** Nothing in the console is built for a phone today. The owner
   asks for laptops, tablets and phones. **Recommended:** at 760px and below, build the
   Overview, the scope sheet and the actions in its boxes; other sections show a short
   "This screen needs a laptop or tablet" with a link back to the Overview, until each is
   converted.
7. **Plan requests from the Overview.** The decision requires a note the customer reads.
   **Recommended:** Decide opens the existing dialog (prefilled with the request), rather
   than a second note field inside the box.
8. **Moderation from the Overview.** **Recommended:** Review only. Approve and Reject stay
   in the Moderation dialog, where the findings are.
9. **The host screen's chip.** **Recommended:** leave `ActiveOrgSwitcher` as a chip for
   now; revisit once the console row has been used. The host screen has no Engage mode and
   no room for a row.
10. **Team order.** **Recommended:** A to Z and fixed. Ordering by most recent use or by
    count would move a team every time something changes, and people learn places by
    position.
11. **The "acting as Engage" banner.** It exists because staff forgot which hat they had
    on when the only sign was a chip (`AdminPage.jsx:1910-1924`). With an Engage tab
    always visible and underlined, **recommended:** keep the banner for one release, then
    remove it if nobody is caught out.
