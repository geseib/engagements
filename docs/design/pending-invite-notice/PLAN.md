# Pending team invite: a notice that is not lost

Owner, 2026-10-10, from a reviewer: the invite showed only near the top of the
dashboard and was lost while the person made their first Build Room. Wanted: "a
persistent notice for a pending team invite".

Mockup: `index.html` (serve `docs/design`, open `pending-invite-notice/`).
Design only. Nothing in `src/` or `lambda-functions/` has changed.

## What the code does today (verified)

| Fact | Where |
|---|---|
| `<PendingInvites />` is mounted only on the dashboard, above the split. | `src/src/components/WelcomeScreen.jsx:184` |
| It loads `GET /invites` once on mount. If that fails it draws nothing, and it draws nothing when the list is empty. | `components/PendingInvites.jsx:39-49, 70` |
| Accept: `POST /invites/{token}/accept`, then `onAccepted` or `window.location.reload()`. | `PendingInvites.jsx:53-69` |
| The row is amber, with a filled amber Accept. On the dashboard that makes a second orange next to "Create engagement" ("THE ONE AMBER THING ON THE PAGE", `WelcomeScreen.jsx:201`). | `PendingInvites.css` `.pinv-row`, `.pinv-btn` |
| `"${days} days left"` prints **"1 days left"** on the last day (`daysUntilExpiry` rounds up). | `PendingInvites.jsx:92`, `org-guards.js:263-267` |
| Invites last 14 days. Expired ones are left out of the list when it is read. | `org-guards.js:231, 411-414` |
| **Accepting changes no Cognito group.** It writes MEMBER + reverse rows, deletes both invite rows, sets `defaultOrgId` if it is unset, and flips a personal org to a team. | `admin/orgs/accept-invite.js` |
| Only platform `admins` move an account from `pending` to `hosts`. | `admin/manage-users.js`, `admin/shared/require-admin.js` |
| **`GET /invites` and the accept route allow `['hosts','admins']` only**, so on either waiting screen both answer 403. | `lambda-functions/auth/authorizer.js:450-453` |
| There are two waiting screens. Accounts in the `pending` group get `auth/PendingApproval.jsx`. The App.jsx "Access Pending" block is only for a signed-in account with no `pending`, `hosts` or `admins` group. | `App.jsx:121-124, 160-175` |
| No decline route exists. Only the team's admin can revoke. | `admin/orgs/revoke-invite.js` |
| SESSION already has a dot for "plugin out of date", amber, shown on the Host screen only. | `BuildRoomPage.jsx:1736`, `BuildRoom.css:1378` |

**So accepting is not the way past "pending" today.** The person joins the
team and still cannot host until platform staff approve them. Under the
current authorizer they cannot see the invite at all while they wait.

## Frames

| Id | Frame |
|---|---|
| P1 | The waiting screen (`PendingApproval`) with the invite row placed under the approval status, at laptop width and at 375px. A second line says what Accept does. |
| R1 | Build Room Host screen, **option A**: a 42px bar under the header, on the Host screen only. **Recommended.** |
| R2 | **Option B**: a blue dot on SESSION, with the invite at the top of the Session panel (Host screen only). |
| R3 | Option A at 660px and 375px, plus option B's panel at 375px, all at true size. |
| R4 | New Build Room (`BuildCreate`) with the row above the form card. This is where the reviewer lost the invite. |
| D1 | The dashboard today (two oranges, "1 days left") next to the same layout with the change. |
| S1 | States: waiting, last day, Joining…, joined, gone after decline or expiry, errors. |

Every row and popover was measured in the browser at 660px and 375px: none
overflows its frame.

**Never shown on the Stage, Build or History screens**, since the room sees them.
That covers the bar, the dot and the panel line, even when the host opens
Session over Build or History. Also never shown on player phones or the
host's phone remote.

### A or B: recommend A

The complaint was that the invite got lost. A dot is the easiest thing to stop
seeing, and the component's own header says the same about a card that is
always there. A costs one line on the Host screen, for at most 14 days, and
leaves when the person answers. B would put a second meaning on SESSION's dot,
which today means only "plugin out of date". Neither is orange. The Host
screen's one orange stays the focused ask's button.

## Strings

Reused as they are:
- `{orgName}` + ` invited you to join as a ` + `host` | `team admin`
- ` · {invitedByEmail}` · ` · expires today` · ` · {n} days left`
- `Accept` · `Joining…`
- `Could not accept that invitation.` · `The server answered {status}.`
- Server messages, shown word for word: `That invitation has expired. Ask for a new one.` (410) ·
  `That invitation was sent to a different email address.` (403) ·
  `That invitation is no longer available.` (404) ·
  `That invitation was just used. Refresh and try again.` (409) ·
  `That invitation is not valid. Ask for a new one.` (409)

New:
- ` · 1 day left` (fixes "1 days left")
- `Decline`
- `You joined {orgName}.` (Build Room, New Build Room and the pending page. The dashboard reloads instead, as it does today.)
- `OK` (closes a row that cannot be retried, after a 404 or 410 or a 403 for a different address)
- Pending page only: `Accepting adds you to the team. Hosting still needs approval.`
  If the owner rules that Accept approves the account: `Accepting lets you host.`
- Option B only: the panel heading `Invitation`, and the dot's screen-reader text `A team invited you`

No tooltips.

## Data

- `GET /invites` returns `{ invites: [{ token, orgId, orgName, role, invitedByEmail, invitedAt, expiresAt, daysUntilExpiry }] }`, soonest to expire first (`list-my-invites.js`).
- `POST /invites/{token}/accept` returns `{ orgId, org, membership, accepted }`.
- **Proposed** `POST /invites/{token}/decline`: same guards as accept (token shape, caller's verified email), deletes the org row and the `INVITEE#` pointer, and returns 200 if they are already gone.
- Client side: hide a row once `expiresAt` has passed (the Build Room already ticks `now`), and load the list again when the person comes back to the tab. A room can stay open for hours.

## Files that would change

- `src/src/components/PendingInvites.jsx`: Decline, "1 day left", a `variant="bar"`, hide at `expiresAt`, load again on focus, drop Accept after a 404/410/403 and show OK, and the joined line.
- `src/src/components/PendingInvites.css`: blue instead of amber, a neutral Accept, the bar shape.
- `src/src/__tests__/pendingInvitesPalette.test.js`: new ratios (`--secondary` #7CA7E6 on `--bg` ≈ 7.1:1). The `--bg`-on-`--primary` Accept ratio goes away. Also `pendingInvites.test.jsx`.
- `src/src/buildroom/BuildRoomPage.jsx`: mount under `RoomHeader` when `screen === 'host'` (A), and in `BuildCreate` above the form. For B, also `BuildSessionPanel.jsx` and the dot. Strings go in `buildroom/words.js`.
- `src/src/auth/PendingApproval.jsx`, plus the App.jsx "Access Pending" block: mount the row.
- `lambda-functions/auth/authorizer.js`: let `pending` reach `invites` and `invites/{token}/accept`, if question 1 is yes.
- New `lambda-functions/admin/orgs/decline-invite.js`, plus its route in `template-clean.yaml`, if question 3 is yes.
- `WelcomeScreen.jsx`: no change. It picks up the component's new look.

## Open questions for the owner

1. Should a person still waiting for approval see and accept invites? That needs the authorizer change above.
2. Should accepting approve the account (`pending` to `hosts`)? If yes, any team owner or admin can in effect approve hosts on the platform.
3. Should we add Decline? If so, does the team's admin see "Declined", or does the invite simply go?
4. A or B in the Build Room? Recommended: A.
