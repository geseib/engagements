# Deleting an organisation, and deleting an account completely: the plan

**Status: PLAN ONLY. Nothing here is built.** Issue #40, part 3. Deletion touches
data retention, billing records and legal obligations, so the owner decides the
open questions in §8 before any of it is written. Suspend and Reinstate are built
and enforced (2026-11-03, `lambda-functions/auth/standing.js`). Deletion assumes
them: **only a suspended thing can be deleted.**

---

## 1. What exists today

| | Organisation | Account |
|---|---|---|
| Suspend | `POST /platform/orgs/{orgId}/status` `suspended`, with a reason. Enforced at the authorizer for every member acting for it, and at the participant routes for its sessions. | Accounts → **Suspend…**: `PROFILE.suspended`, plus the Cognito account switched off. Groups are kept. |
| Reinstate | Same route, `active`. Takes effect on the next request. | Accounts → **Reinstate**: Cognito back on, flag cleared, groups as they were. |
| Delete | **None.** No route, no handler, no button. | The bin: `AdminDeleteUser`, which removes **only the Cognito login**. The personal space, sessions, sets, reports, memberships and invitations are all left behind. |

## 2. What data belongs to an organisation

Everything is in one DynamoDB table, plus three S3 buckets and the Cognito pool.
The key shapes come from `lambda-functions/*/tenant.js` and the handlers that
write them.

### 2.1 Partitions the organisation owns outright

| Partition (PK) | What is in it | Writer |
|---|---|---|
| `ORG#<org>` | `METADATA` (name, plan, status, the wrapped **data key**), `MEMBER#<sub>` rows, `ADJ#…` billing adjustments, `LEDGER#<period>#…` plan changes, `USAGE#<yyyy-mm>` counters, `CODEUSE#…` | create-org, members, adjustments, leave-plan, usage |
| `ORG#<org>#SETS`, `ORG#<org>#SET#<id>[#v<n>]` | question set metadata and versions | upload-questions, set-version |
| `ORG#<org>#SETSTATS` | per-set play counts (numbers only) | set stats |
| `ORG#<org>#AIPROMPTS` | the team's Workie prompts | create-ai-prompt |
| `ORG#<org>#GENDRAFTS`, `ORG#<org>#GENDRAFT#<id>` | AI generation drafts | generation-drafts |
| `ORG#<org>#GAMES` | the session index | create-game |
| `ORG#<org>#EVENTS` | the event index | events |
| `ORG#<org>#REPORTS` | saved report index rows (`REPORT#<game>#<savedAt>`) | save-report, report-sweep |
| `ORG#<org>#AUDIT` | the organisation's audit log (365-day `ttl`) | audit-log.js |

### 2.2 Rows elsewhere that point at the organisation

| Partition | Row | What it is |
|---|---|---|
| `GAME#<code>` | every row of each session the org owns (METADATA `orgId`, STATE, players, answers, votes, rounds, comments, Build Room `BUILD#…`, session keys `BUILD#KEY#…`) | the sessions themselves |
| `GAMES` | `GAME#<code>` reservation | the four-digit code registry |
| `EVENT#<code>` | the event and its items and attendees | events |
| `USER#<sub>` | `ORG#<org>` reverse membership, one per member | the switcher |
| `ORGS` | `ORG#<org>` index row, `PLANREQ#…` plan requests | the staff lists |
| `INVITE#…` / invitee pointers | open invitations into the org | invites |
| `PLATFORM#AUDIT` | the staff copy of each staff action on the org | audit-log.js |
| `PUBLIC#SETS`, `PUBLIC#SET#…` | **copies** the org published to the public library | publish flow |
| `MODERATION` | the org's sets waiting for moderation | moderation |

### 2.3 Outside DynamoDB

| Where | What |
|---|---|
| `ReportsBucket` | saved PDFs and report JSON, keyed by the index rows above. `retention=standard` objects 90 days, `permanent/` 365 days. |
| `MediaBucket` | set images under `sets/<setId>/`, presentation decks under `decks/<org>/…`, Build Room artefacts under `builds/<gameId>/…` |
| KMS | the org's **data key** is a blob on `ORG#<org>/METADATA`, wrapped by the one stack CMK. Deleting the METADATA row is what makes every encrypted field the org ever wrote unreadable. |
| GitHub | issue reports filed from its sessions are public issues. Out of reach; they say so on the form. |

### 2.4 An account

| Where | What |
|---|---|
| Cognito | the login, its groups, any Google link |
| `USER#<sub>` | `PROFILE`, `ORG#<org>` reverse memberships, `USER#<sub>#NOTIFY` notifications, `USER#<sub>#AUDIT` holding log |
| its **personal space** | a whole organisation (§2.1, §2.2), `type: personal` |
| team organisations | its `MEMBER#<sub>` row in each, and `createdBy` on sessions, sets and events it made there |

## 3. What deletion removes, and what it keeps

**Recommended rule:** delete everything that is *content* and *identity*; keep the
minimum *record* needed for billing and for showing who did what, stripped of
content and with the identity reduced to an id.

| Data | Org deletion | Account deletion |
|---|---|---|
| Sets, prompts, drafts, sessions, events, reports (rows **and** S3 objects) | **Remove** | Remove from the personal space. In a team, **keep** (the team owns it); `createdBy` stays as an id with no name. |
| Members, reverse memberships, invitations | Remove | Remove the account's own |
| The data key on METADATA | **Remove last** (crypto-shredding: anything missed is unreadable) | Removed with the personal space |
| `ORG#<org>` METADATA | Replace with a **tombstone**: `status: 'deleted'`, deletedAt, deletedBy, the name's hash, no data key | Same for the personal space |
| Billing: `ADJ#`, `LEDGER#`, `USAGE#`, `PLANREQ#` | **Keep** for N years (decision §8.2), moved under the tombstone | Same, for the personal space |
| Audit log | **Keep until its own 365-day `ttl`** (decision §8.3); add one `org.delete` entry | Keep; add `user.delete` |
| Public library copies | **Decision §8.4**: withdraw them, or keep them anonymised | Not applicable |
| Cognito | Groups untouched (the people are not deleted) | **Delete the login** (last step) |

## 4. Grace period (soft delete)

Recommended: **Delete marks it; the sweep removes it 30 days later.**

1. **Delete…** requires the organisation or account to be **Suspended already**
   (issue #40: "Delete, after suspension"), so nobody is using it.
2. It writes `deletionRequestedAt`, `deletionRequestedBy`, `deleteAfter`
   (`now + 30d`) on METADATA (or PROFILE), and audits `org.delete-requested`.
3. During the grace period it stays suspended and shows **Scheduled for deletion
   on <date>** on its row, with **Cancel deletion** (back to Suspended) beside
   **Reinstate**.
4. The existing 3-hourly schedule (`UsageReconcileFunction`, the same ride
   report-sweep takes) picks up rows past `deleteAfter` and runs §6. **No new
   Lambda or schedule:** the stack is near its 500-resource limit.

The alternative, deleting at once, is simpler and irreversible. Recommend the grace
period. A wrong delete cannot be undone, and the cost of the grace period is one
attribute and one sweep branch.

## 5. Who may do it, and how they confirm

| Who | Organisation | Account |
|---|---|---|
| Engage staff (`admins`) | Yes, from Organisations, **with a written reason** (as Suspend). | Yes, from Accounts, with a reason. |
| The team's owner | **Decision §8.5.** Recommend yes, for their own team only, from Data & privacy, after a hand-over check. | Their **own** account, from Data & privacy (recommend, later phase). |
| Anyone else | No | No |

Guards, each with a test:

- not the **last Engage admin**, and **not yourself** (manage-users.js already has
  both for the Cognito step; deletion reuses them);
- **no live session**: refuse while any `ORG#<org>#GAMES` session is started and
  not ended, or an event is running. Say which, and offer End;
- a **team with other members** cannot be deleted by its owner while those members
  exist. Remove them or hand the team over first. Staff may delete it, and each
  member is notified (`notifications.js`);
- an account that **owns a team with other members** must hand over ownership
  first (the hand-over control does not exist yet: #43, `TeamPanel.jsx:275`);
- a **personal space** is deleted only with its account, never on its own.

Confirmation: a **preview** dialog lists the counts that will go (sets, sessions,
events, reports and S3 objects, members, invitations, prompts, drafts), then asks
the person to **type the organisation's name** (or the account's email). This is
one of the two type-to-confirm dialogs the design system allows (RATIONALE §8).

## 6. How it runs

One handler branch on existing functions: `platform-orgs.js` for the request and
`report-sweep`'s schedule for the purge. Work is **idempotent and resumable**:

1. Write `deletion: { phase, cursor }` on the tombstone before each phase.
2. Phases, in order, each re-runnable:
   1. cancel invitations; end nothing (the live-session guard ran already);
   2. for each session in `ORG#<org>#GAMES`: delete its `GAME#<code>` partition
      (Query + BatchWrite, paged), its `GAMES` reservation, its `builds/<code>/`
      S3 objects;
   3. events (`EVENT#<code>` partitions, `decks/<org>/` objects);
   4. reports: index rows and their S3 objects;
   5. sets and versions, `SETSTATS`, `AIPROMPTS`, `GENDRAFTS`, `sets/<setId>/`
      media; withdraw or anonymise the public copies (§8.4); clear `MODERATION`;
   6. members: each `MEMBER#` row and its `USER#<sub>/ORG#<org>` reverse row;
   7. move billing rows under the tombstone (or leave them, keyed by org id);
   8. **last:** remove the data key and the name from METADATA, so it becomes the
      tombstone; update the `ORGS` index row to `deleted`.
3. Each phase audits its counts. A failure leaves the phase and cursor in place and
   the next sweep resumes from there. The staff row shows **Deleting… (phase n of 8)**.

For an **account**: personal space through the steps above → its memberships and
notifications → `PROFILE` reduced to a tombstone → `AdminDeleteUser` last. If
Cognito fails, the sweep retries, and the account is already suspended and disabled.

## 7. Tests (to write with the build)

- a guard test for each §5 guard (last admin, self, live session, team with
  members, owner of a shared team, personal space alone);
- **a test that deletion removes every prefix tenant.js can build for an org**:
  enumerate `scopePrefix`/`setsMetadataPk`/`promptsMetadataPk`/`setStatsPk`/
  `gamesIndexPk`/`eventsIndexPk`/`reportsIndexPk`/`draftsIndexPk`, seed one row
  in each, delete, assert none survive except the tombstone and the kept billing
  and audit rows. It fails when someone adds a new `ORG#<org>#X` partition without
  teaching deletion about it;
- S3: every key under the org's report index, `sets/<id>/`, `decks/<org>/`,
  `builds/<code>/` is deleted;
- resumability: fail each phase once, re-run, and get the same end state;
- idempotence: running a finished deletion again is a no-op;
- the grace period: Cancel restores Suspended; nothing is purged before
  `deleteAfter`;
- the authorizer refuses a `deleted` org like a suspended one (extend
  `standing.js` `orgRowSuspended` to treat `deleted` as closed);
- crypto-shredding: after phase 8 a leftover encrypted row cannot be decrypted.

## 8. Decisions the owner must make

1. **Grace period:** 30 days soft delete (recommended), another length, or immediate.
2. **Billing retention:** how long `ADJ#`/`LEDGER#`/`USAGE#`/`PLANREQ#` rows are kept
   after deletion. Billing is simulated today, but once it is real this is a legal
   question (commonly 6–7 years for financial records). Recommend keeping them
   under the tombstone with no `ttl` until this is answered.
3. **Audit log:** keep to its existing 365-day expiry (recommended), keep longer,
   or delete with the org. The staff copy (`PLATFORM#AUDIT`) records who deleted it.
4. **Published public-library sets:** withdraw them with the org (recommended:
   simplest, and the author has gone), or keep them with the author anonymised.
5. **Owner self-service:** may a team owner delete their own team (and a person their
   own account) from Data & privacy, or is deletion staff-only at first?
   Recommend staff-only for phase 1, self-service in phase 2. The Privacy page
   promises delete and export (#43), so phase 2 is owed.
6. **Content in teams after account deletion:** keep sessions and sets the person
   made in a team, with authorship reduced to an id (recommended), or remove them.
7. **Export before delete:** offer a download of the org's reports and sets first?
   Data & privacy's **Export everything** is not wired yet (#43).
8. **Notification:** email the owner and members when deletion is requested and
   when it completes? There is in-app notification today; email is not wired.

## 9. Runbook (for when it is built)

**Delete an organisation**
1. Organisations → the team's row → **Suspend…** with a reason (if not already).
2. End any live session or event it has. The Delete dialog lists them.
3. **Delete…** → read the preview → type the team's name → **Delete**. The row shows
   *Scheduled for deletion on <date>*.
4. To undo before that date: **Cancel deletion**, then **Reinstate** if wanted.
5. After the date, the sweep runs. The row shows *Deleting…* and then *Deleted*,
   and **Activity…** lists every phase with its counts.
6. If a row stays on *Deleting…* across two sweeps, read the `report-sweep` logs
   for `deletion phase` errors. The work resumes on its own once the cause is fixed.

**Delete an account completely**
1. Accounts → **Suspend…** (if not already).
2. If it owns a team with other members, hand the team over first.
3. **Delete…** → preview (the personal space's contents and memberships) → type the
   email → **Delete**. The same grace period, cancel and sweep apply.

**Never** delete rows by hand in the console for a customer. Use the flow, so the
audit, tombstone and billing rows stay consistent.

## Recommendation

Build in two phases. **Phase 1:** staff-only, suspend first, a 30-day grace period,
the §6 purge on the existing schedule, a tombstone that keeps billing and audit,
crypto-shredding last, and the prefix-coverage test as the safety net. **Phase 2:**
owner self-service from Data & privacy, with Export first. The work cannot start
until §8.1–8.4 are decided.
