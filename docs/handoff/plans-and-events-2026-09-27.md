# Handoff — Three plans, paid events, approval for new teams, leaving a plan (27 Sep 2026)

Read `CLAUDE.md` first; its deploy rules at the top are binding.

## What the owner asked for

> "i dont see how to create an event in test … when requesting plans. there is the free tier and the
> standard tier for individuals (should not be team plan) and there is create an organization and thats
> where you should also get approval with assuming in the future a pay per usage billing capacity. i think
> the host should be able to create events as well, if they are on a pay plan … all events cost money (for
> now this is just calcuated and not actually billed."

> "also you should be able to leave plan. when doing so they will be given a list of their team or
> individual sets and be told how many they have to delete to get down to 5 free. they can before deleting
> also click a make public button (but they will be told they will not be deleted until they are accepted
> into public (a copy) or they come back and uncheck make public"

Answers the owner gave to the open questions: a new team is **usable on Free while it waits**; prices
**keep today's numbers** (Standard = the old Team terms, Organisation = pure pay per use, $2 an event);
leaving takes effect **only once the kept sets are ≤ 5**; leaving is **self-serve**.

## The plans (`lambda-functions/{admin/shared,game,websocket}/pricing.js`, three byte copies)

| | stored `plan` | base | included | past it | events |
|---|---|---|---|---|---|
| Free | `free` / absent | $0 | 5 sessions, 5 sets | refused (capped) | none |
| Standard (a person's space) | `standard` | $5/mo | 5 + 5 | $0.25 each | $2.00 each |
| Organisation (a team) | `team` | $0 | nothing | $0.25 every session and set | $2.00 each |

`upgradePlanFor(org)` offers Standard to a personal space and the Organisation plan to a team; every
refusal (`upgradeRequired`), the plan-limit notice, Plan & usage, the Events page and the request dialog
name that plan. All money is simulated.

## Events

- `EVENTS_ENABLED` is `!If [IsProd, 'off', 'on']` — dev and test on, prod off.
- `create-event.js` refuses Free only; any member (host or admin) of a paid space may create one.
- An event is billed **once, when it first goes live** (`events/run.js` → `usage.recordBillableEvent`,
  ledger `LEDGER#<period>#EVENT#<code>`, counter `eventsRun`). Its sessions are covered by it
  (`session-count.js` writes no SESSION row for an `EventRef`). A preview never bills.

## New teams need approval

`create-org.js` files an Organisation-plan request (`kind: 'new-organisation'`) for every team it makes;
Engage approves it in Plan requests. Until then the team is on Free. `plan-requests.js` refuses a crossed
request (a person's space asking for `team`, a team asking for `standard`).

## Leaving a plan (merged from wip/leave-plan)

- `GET/POST /orgs/{orgId}/plan/leave` and `POST /orgs/{orgId}/plan/leave/hold` on `PlanRequestsFunction`
  (`orgs/leave-plan.js`). Owner or admin. Leave is refused (409) until kept sets ≤ the free allowance.
- **Make public** holds a set (`publicHold` on its metadata row, `shared/public-hold.js`): held sets do not
  count (`countSets` filters them). It publishes at once if the set's review passed (then the private set
  is deleted), otherwise it waits for the check or Moderation; approval publishes and deletes, a decline
  releases the hold with the reviewer's note. Unticking releases it.
- `LeavePlanDialog.jsx`: the sentence ("You have 7 sets. The free plan keeps 5 — delete 2, or make some
  public."), Delete confirmed in the row, Make public per row, Leave disabled until it fits.
- A month is billed on the plan the org has when the bill is read or closed, so leaving on the 20th
  projects the month at Free. If the month should bill on the plan it started on, that is `invoices.js`.

## Also fixed on the way

- The host stage could stick at "Nobody has answered yet" beside a meter at 2/2 when phones answered
  while the host was still loading the round (the reset made the in-flight refetch stale). Both resets now
  refetch (`__tests__/hostEarlyAnswers.test.js`).
- Plan & usage no longer draws an old approval ("You are on the Organisation plan") after leaving, and
  names the limit actually reached.

## Verified

Backend 268/268, frontend 407 suites / 9750 tests, lint 0 errors / 10 warnings, build. End to end in
Chromium on the local stack: the event day (14), a typed poll with a feedback round (7), a survey in an
event (9), and leaving the Organisation plan (4) — a team created through `POST /orgs` (its request in
Engage's queue), approved through the platform route, seven sets, delete one, make one public, leave.

## Still open

- The editor's question preview does not draw poll kinds; the Names setting for polls is not built.
- A check or Moderation entry cannot be withdrawn, so unticking Make public keeps the set but a copy may
  still publish (the dialog says so and where to unpublish it).
- Events stay off on prod until the owner asks.
