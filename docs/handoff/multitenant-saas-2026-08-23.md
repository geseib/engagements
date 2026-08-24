# Handoff — Engage as a multi-tenant SaaS

**Branch:** `dev`, live as **`d5d0c4d9`**. Read §0 first — it carries the rules
that are easy to break again, what is still open, and the test data left behind.

**Still unbuilt, and named in §7:** the public library and its moderation
pipeline (mockups 05, 06, 07, 11), Stripe, the access-log WRITER — the Data &
privacy page renders the log but nothing writes rows to it yet — the
break-glass grant, and org export/delete.

---

## 0. WHERE THIS STANDS — read this first

**Live on `dev` as `d5d0c4d9`.** Test and prod have seen none of it.

Baselines at the last push: backend **98 node suites**, frontend **186 suites /
4612 tests**, lint 0 errors / 11 known `exhaustive-deps` warnings, clean build
with the 2 known size warnings, `tests/template-validates.js` 2 passed.

Four QA agents drove the live deployment on 2026-08-24. **The partition scheme
held; the handlers on top of it did not.** Everything in §0c came from that.

### The rules that are easy to break again

1. **Adding a request header is a TEMPLATE change.** `X-Engage-Org` was not on
   the API's `AllowHeaders`, so every browser request was blocked with a
   *network error* while the API looked healthy and the Lambda logs were empty.
   `tests/cors-allows-sent-headers.js` guards it.
2. **Every section gate in `AdminPage.jsx` reads `resolvedTab`, never
   `activeTab`.** Mixing them mounts two screens at once and nothing catches it
   — both are strings in scope. `__tests__/adminOneSection.test.jsx` counts.
3. **`admins` is the PLATFORM group, not "may use the admin screens".**
   Customers are `hosts`; an org role is a DynamoDB fact on `GET /orgs` as
   `yourRole`. Gating anything host-facing on `admins` locks out every customer.
4. **Writing Engage's library needs the staff group AND platform mode**
   (`isPlatformAdmin && !callerOrgId`). "No active org" is only reachable
   because the `~platform` sentinel travels in the header — `pickActiveOrg`
   otherwise falls back to `defaultOrgId` and nobody is ever org-less.
5. **Session routes must call `tenant.callerMayDriveSession`.** Only
   `get-games-list` used the org partitions; everything else read `orgId` off
   the row and never compared it.
6. **A bare `fetch` can hide as a VALUE.** `requestNextQuestion({ fetchFn: fetch })`
   evaded the Phase 0 sweep entirely — grepping the line for `fetch(` finds
   `requestNextQuestion(`. `__tests__/closedRoutesUseAuthFetch.test.js` scans
   for both shapes. (The mirror is already recorded: `authFetch` has a capital
   F, so `/fetch\(/` matches nothing.)
7. **jsdom has no layout engine, so check the CAUSE.** A class named in markup
   and never declared in CSS renders invisibly — `Modal` applies the caller's
   class and nothing else, so a missing `.corg-scrim` was a dialog nobody could
   see with four green tests.
   `__tests__/scopedClassesDeclared.test.js` checks every scoped class exists.

### Fixture traps that cost real time

- **Org ids in fixtures must be `org_` + 22 base58**, or `isOrgId` refuses them
  and assertions pass for the wrong reason.
- **`tests/helpers/tenant-crypto-stub.js` has two incompatible modes.**
  `mintOrg` generates a RANDOM key; `installTestKeyLoader` derives one from the
  orgId. `plainRow` only matches the second. Mixing them fails as *"Unsupported
  state or unable to authenticate data"*, which reads like a crypto bug.
- **A borrowed harness may declare a command it does not implement.**
  `BatchWriteCommand` was in one stub's class list with no `case`, so every
  batched Put silently did nothing and the handler reported success.
- **`waitFor`'s default 1000ms is a race, not a limit**, for anything behind
  `pollGenerationJob` — `POLL_INTERVAL_MS` is 2000ms of real time. Green on
  every developer machine, red on a loaded CI container.

### Still open, in the order worth taking

From the session agent's live run, none fixed:

1. **Sessions built from an org's own set are silently unplayable.** The client
   never sends `questionSetScope`, so it defaults to platform and the game gets
   no category state; `next-question` then 400s.
2. **`GET /games/{id}?role=host` needs no auth at all** — plain curl returns the
   private briefing. `role=host` is an unverified query param.
3. **`GET /games/{id}/state` is public and leaks `correctAnswer` mid-round.**
4. **Nothing is ever billed.** `recordBillableSession` is exported from four
   copies of `usage.js` and imported by none; zero `LEDGER#` rows exist. The
   free-plan cap therefore cannot fire either.
5. **No way to end a session.** `ENDED` is only written when the question pool
   runs dry (`next-question.js`), so a 6-round session on a 100-question set
   sits in `RESULTS#006` for ever and the report screen is unreachable.
6. **Re-closing a round re-awards points**, and re-closing an OLDER round
   rewinds the session.

Unbuilt from the original plan: the public library and its moderation pipeline,
Stripe, the access-log WRITER (the Data & privacy page renders a log nothing
writes to), the break-glass grant, org export/delete.

### Test data left on dev

QA orgs from the agents — `QA Meridian Delivery`, `QA Halcyon Institute`,
`QA Session Co`, two `QA Sets` orgs — plus sessions 9000 / 6386 / 7986 / 2833 /
7397 / 2083. And one org literally named **`t1u_bo`**: an auto-provisioned
personal space that was handed off and left behind, the artifact of the
zero-org bug in §0c. None of it is load-bearing; deleting it is safe.

---

## 0c. THE SECOND DAY — what the live agents found, 2026-08-24

Ranked by consequence. Each is fixed and has a test that was watched failing.

**Sessions were not isolated at all.** Exactly one route used the org
partitions, which is why it was invisible: a rival's LIST is correctly empty.
Every other session route read `orgId` off the row and never compared it to the
caller. Driven live — a host in another org, holding only a four-digit code,
read a session's private briefing, wrote its results, ADVANCED A LIVE ROOM,
renamed it and started it, and the rival's title was written back encrypted
under the victim's key. The real boundary was "any `hosts` account plus one of
9,000 ids".

**"Delete all sessions" deleted every organisation's.** `clear-all-games`
Scanned the whole table and matched `/^ORG#.+#GAMES$/`, under a list that IS
org-scoped, behind a dialog reading "Delete all 3 sessions". It now Queries the
caller's own index and refuses outright without one. The existing test REQUIRED
the cross-tenant wipe; its assertion is inverted.

**The console was staff-only.** `/admin` sat behind `requireAdmin`. Three of the
four consoles `sectionsFor` computes had never been seen by anybody they were
computed for. Every test mounts `AdminPage` DIRECTLY, so nothing exercised the
router in front of it.

**Nobody could create a team.** `setCreatingOrg` has one caller — the switcher's
menu — and the switcher collapses to an inert label when you have one
organisation, which every new account does. There was no route to the paid
product. The mockup agrees with the old code and is wrong: it was never asked
what happens to Create.

**An approved account could end up with nowhere.** `ensurePersonalOrg` returned
the moment PROFILE named a home, never checking it still existed or still held
the caller. Accept-into-a-personal-space → flip to team → hand over → leave →
leave again produced `{orgs: []}` for ever. Every step answered 200.

**Engage's library was writable from inside any org** — the owner hit this:
renaming a set while acting as a host in TeamG changed what every organisation
reads. See rule 4 above.

**An invitation had no end.** No email was ever sent, the token was returned by
the API and shown to nobody, and `POST /invites/{token}/accept` had never once
been invoked on any tier. Now: sign in with the address you were invited at and
accept from the landing screen, found through an `INVITEE#{email}` pointer row
written beside the invitation. Invitations that predate the pointer are repaired
when an admin opens Members.

**Smaller, all real:** the Create-organisation dialog had no scrim and opened
invisibly; the last Engage admin could be demoted, disabled or deleted, locking
the platform console shut with no way back through the product; a failed "Copy
to my organisation" rendered a green tick announced as `role="status"`; Public
library was in every nav with no renderer; the invitations prompt was a second
flex child and took half the new-session screen.

---

## 0a. THE ONE THAT MATTERED — CORS, 2026-08-24

**`X-Engage-Org` was not on the API's `AllowHeaders`, and that is a total outage
that no test outside a browser can see.**

`authFetch` attaches the header to every authenticated request. A custom header
makes the request non-simple, so the browser sends a CORS preflight. API Gateway
answers that preflight **204 — a success — with no `access-control-allow-*`
headers at all**, because the requested header is not on the list. The browser
then blocks the real request and reports a **network error** to the page.

Everything that is not a browser says the system is fine:

- the API is healthy and returns 401/200 to `curl` exactly as expected;
- the Lambda logs are **empty**, because the request never arrives;
- every smoke check in this repo passed.

And it is intermittent in the worst way: until an organisation has been stored
`authFetch` sends no org header, so the first page load works and everything
after it does not. It presents as "the admin menu is broken", not as "nothing
works". It was reported as the AI Builder's *"fill in the rest"* giving a
network error — that was simply the first call made after the org was stored.

Reproduce it in one command, and note the control:

```bash
curl -s -D - -o /dev/null -X OPTIONS "$API/admin/ai-draft-builder-form" \
  -H 'Origin: https://engage.dev.seibtribe.us' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization,x-engage-org'
```

No `access-control-*` in the response = blocked. Drop `x-engage-org` from that
last header and they all come back.

`tests/cors-allows-sent-headers.js` reads the headers `authFetch` actually sends
out of the source and the list the template allows, and fails when they drift.
It also found **nine handlers** building their own `Access-Control-Allow-Headers`
that allowed `Authorization` and not the org header — a preflight passing and
the real response then being rejected.

**The rule: adding a header to a request is a template change.** They live in
different languages in different files and nothing connects them but that test.

---

## 0b. TWO SCREENS AT ONCE

The console has two ideas of which section is open:

| | |
|---|---|
| `activeTab` | what the person ASKED for — the URL, or the click |
| `resolvedTab` | what they can be SHOWN, after falling back when the asked-for section is not in this account's nav |

The four tenancy panels were written against `resolvedTab`; the six older
sections were left on `activeTab`. When the two disagree **both branches are
true and both panels mount** — the head reads "Organisations" while Question
sets renders underneath it, because it comes first in the file.

The disagreement is the NORMAL state for Engage staff: `activeTab` starts at the
constant `questionsets`, and platform mode has no such section, so they differ
from the first paint.

Nothing can catch this — both are strings in scope and the result is a working
program that draws two screens. `__tests__/adminOneSection.test.jsx` mounts the
page and counts. **Every section gate reads `resolvedTab`.** The single
exception is the billing FETCH guard, which is declared above the line that
computes it and would be a temporal-dead-zone error; it is a fetch, not a
render, so the cost of being wrong there is one wasted request.

---

## 0. THE SECOND PASS — what dev showed, 2026-08-23

The first deploy was reviewed on dev and four things came back. They had one
root cause between them: **the console could not tell an Engage admin from an
org admin**, so it tried to be both consoles at once and was neither.

### Platform is a MODE now, and this has been wrong twice

`config/consoleSections.js` carries the full reasoning; the short version is
that both previous attempts failed in opposite directions.

1. **Selected by the ABSENCE of an active organisation.** Right in spirit,
   unreachable in practice — every approved account is given a personal org, so
   staff always had one and the platform console could not be opened at all.
2. **Bolted on ADDITIVELY**, beside the org's own sections. Reachable, and it
   reintroduced exactly the mixing the split exists to end: Moderation rendered
   beside the operator's own question sets with nothing on screen saying which
   hat was on.

Now it is an explicit choice in the switcher — **Act as · Engage** — and it is
exclusive. `mode: PLATFORM_MODE` gives the platform console and nothing else;
anything else gives the active organisation and no platform links. The mode is
a VIEW and the `admins` group is the PERMISSION: asking for the mode without
the group returns no sections, and every platform route re-checks the group.

The sentinel is `~platform`, deliberately not a possible org id, and
`authFetch` sends `X-Engage-Org` **only** for a value matching `org_` + base58.

### Two bugs that were invisible to every pure-module test

Both lived in the wiring between `consoleSections` and the page, which is why
the module had full coverage and the console was still wrong.

| | |
|---|---|
| `activeOrg.role` | `GET /orgs` answers with **`yourRole`**. orgRole arrived undefined for everybody, so every team OWNER was rendered the member nav — losing Plan & usage and Data & privacy while still being the person who pays. Reported as "missing most of the menu items". |
| `<OrgSwitcher orgs onSwitch>` | The component's props are **`organisations`** and **`onSelect`**. It received an empty list, took its "nothing to name" branch and rendered **nothing** — there was no switcher on dev at all. React says nothing about a prop that is simply not there. |

`src/src/__tests__/adminOrgWiring.test.jsx` exists for exactly this class: it
mounts the page and looks. Note its first test had to be rewritten to use a
HOST rather than staff — with `platform` true the chip renders from that branch
regardless, so the assertion passed against the shipped bug until the caller
changed.

### The super admin exists

`GET /platform/orgs` and `POST /platform/orgs/{orgId}/status`, in
`lambda-functions/admin/orgs/platform-orgs.js`, behind
`components/PlatformOrgsPanel.jsx`.

- **`admins` alone, never `['hosts','admins']`.** The one place in this API
  where those two must not be interchangeable — these routes administer other
  people's tenants.
- **A personal space cannot be suspended.** It is an account deletion with a
  friendlier name; the lever for a person is their Cognito account.
- **Status writes BOTH rows** — METADATA, which every guard reads, and the
  index row, which the screen reads.
- **`PlatformOrgsFunction` carries no `kms:Decrypt`,** and that absence is part
  of the guarantee. `tests/kms-grants-match-code.js` derives the grant set from
  the require graph and fails if this function ever pulls `tenant-crypto` in.
- The mockup's per-row **Request access** is NOT built: the break-glass grant it
  belongs to does not exist, and a button leading to a safeguard that is not
  there is worse than no button.

### Copying, which was the missing middle step

Every org could already READ the platform and public libraries and could not
change them, so the only honest answer to "can I adapt this?" was no.

`POST /question-sets/{setId}/copy` duplicates every row into the org's own
partition, **encrypting the questions on the way in** — the source is plaintext
because platform content has no tenant, the destination has one, and a copy
that stayed plaintext would sit outside the guarantee its owner was given. It
records `sourceSetId`/`sourceScope` for provenance and links to nothing: an
Engage admin editing the platform set must never change a customer's copy.

The table now reads the `canManage` the server has been projecting all along,
instead of drawing Edit and Delete on every row and letting the click 403. Rows
are badged **Engage** or **Public** so the refusal has an explanation on screen.

### Smaller, and real

- **The report button** is a header control beside Help. It was `position:fixed`
  at `z-index: 20000` with no way to ask for anything else — so it floated over
  every screen, including the panels that were already slotting it into their
  own footers and having that placement ignored. `placement="floating"` still
  exists for a surface with no chrome.
- **A space is named after a person.** The first org this product provisioned
  was called `Google_113956208956782440356`: `callerName` falls back to the
  Cognito username, which for a federated identity is the provider's opaque id.
  Repaired lazily on `GET /orgs`, on both rows, conditioned so a space somebody
  has since renamed is never undone.
- **The URL canonicaliser** now uses the per-person landing section. It named a
  constant, so in platform mode it wrote `?section=orgs` for a URL that already
  WAS the landing screen — the two-URLs-one-screen defect it exists to prevent.

### One loose end, stated rather than hidden

**Where does an Engage admin edit the platform library?** Today: from their own
personal space, where `canManageSet` grants it and the row is badged Engage. It
works and it is legible, but it is conceptually muddy — Engage's own content is
being managed from a personal org rather than from the platform console. The
clean answer is a "Shared library" section in platform mode, which does not
weaken isolation at all because platform content has no tenant. Not built.

### Two tests were corrected, not silenced

`consoleSections`' *"an Engage operator inside an organisation reaches BOTH"*
required the additive console this removes, and `orgSwitcher`'s *"the platform
chip is inert"* required the chip that left staff with no door. Both now assert
the opposite and carry the reversal in their comments.

Two fixture lessons worth carrying: org ids in fixtures must be **`org_` + 22
base58** or they fail `isOrgId` and assertions pass for the wrong reason; and
`tests/helpers/tenant-crypto-stub.js` has two modes — `mintOrg` (random key) and
`installTestKeyLoader` (derived key). `plainRow` only matches the second, and
mixing them fails as "Unsupported state or unable to authenticate data", which
reads like a crypto bug.

---

## 1. What this is

Engage was a single-tenant product wearing a multi-user coat. Every host could see, pick
and run every question set in the environment, because sets lived in one global partition
(`PK = 'SETS'`) that every list endpoint read unfiltered. Sessions had no owner at all.

This turns it into a SaaS: organisations own their content, a personal space is provisioned
for every account, content is encrypted per tenant, usage is metered, and Engage staff can
no longer open a customer's content without a logged, expiring grant.

## 2. The decisions, and why

**Three scopes, and the first one is today's keys unchanged.**

| Scope | Metadata | Content | Manages | Reads |
|---|---|---|---|---|
| PLATFORM | `SETS` | `SET#{id}[#v{n}]` | Engage staff | everyone |
| ORG | `ORG#{org}#SETS` | `ORG#{org}#SET#{id}[#v{n}]` | that org | that org |
| PUBLIC | `PUBLIC#SETS` | `PUBLIC#SET#{id}` | nobody (it is a copy) | everyone |

The owner's decision that all existing content is central and available to everyone is what
collapses the migration to **nothing**. No rows move, nothing is copied, there is no cutover
and nothing to roll back. `AIPROMPTS` is untouched entirely. `tests/tenant-keys.js` §1 pins
the four platform key shapes so that if they ever change, a migration exists that did not.

It also fixed a latent data-loss bug for free: `setId` is a slug of the title
(`upload-questions.js:298`), so two orgs both naming a set "Team Retro" would have clobbered
each other in the single global partition. Scoped, they cannot meet.

**A set reference is now a PAIR.** `setId` alone no longer names one partition, so a game
pins `QuestionSetScope` beside `QuestionSetId` and `QuestionSetVersion`.

**Everyone has a personal organisation.** There is no "belongs to no org" state after
approval — that state was one every handler had to remember to consider, and every place
that forgot was a bug. `type` is NOT derived from member count: an org somebody deliberately
creates is `team` from birth, `personal` means the auto-provisioned home (which cannot be
left or deleted). Provisioning is lazy, on `GET /orgs`, because the post-confirmation trigger
fires *before* an admin approves anyone into `hosts` and would mint an org for every
abandoned signup.

**Personal is free for 5 sessions and 5 sets, then must upgrade.** Team meters overage at
25¢ and is never gated. **The gate lands on session CREATION, never on a running session** —
the one moment a hard cap would fire is when somebody is standing in front of a room.
`tests/plan-gating.js` §3 drives a real session end to end past the limit and includes a
source scan asserting no participant-journey handler even mentions the allowance functions.

**Encryption is per-org envelope, one CMK.** A per-org key at $1/month against a $5/month
subscription is 20% of revenue before anyone runs a session. The key policy has an explicit
**Deny** on `Decrypt`/`GenerateDataKey` unless an `orgId` encryption context is supplied —
which beats even the root principal, because an explicit Deny always wins. That is the
mechanism behind the privacy page's *"we cannot do it quietly"*: there is no decrypt that
does not name a tenant, so CloudTrail's `encryptionContext.orgId` **is** a per-tenant read
log. A blanket "let me read the table" is not expressible.

A consequence worth knowing: **S3 SSE-KMS cannot use this key** — S3 supplies its own
object-ARN context and would be denied. The report PDF is therefore encrypted in the
application before the put, with `game/download-report.js` as the decrypting reader.

## 3. What is DONE

- **Phase 0 — the open doors.** Ten routes closed, both halves each (template `Auth:` *and*
  `requiredGroupsForRoute`). Session creation, every host control, and the question-set
  routes were public.
- **Tenancy.** `tenant.js` (triplicated), scoped sets, scoped sessions, org CRUD and
  invites, membership resolution in the authorizer.
- **Encryption.** Module, boundary, wiring across ~20 handlers, KMS key and policy, IAM on
  32 functions derived from the require graph.
- **Metering.** Ledger, stream consumer (the table's stream had been enabled with no
  consumer since day one), nightly reconciler, `projectInvoice`.
- **Mockups.** Twelve screens in `docs/design/tenancy-redesign/` with `RATIONALE.md`,
  `index.html` and `audit.js`.

**Baselines:** backend **89 suites / 3073 assertions**, frontend **152 / 3741**, lint 0
errors / 11 warnings, build clean with the 2 known size warnings.

## 4. What is NOT done

- **Console screens.** Org switcher, Team, Billing and Privacy were in flight at handoff.
  **Library, share-for-review, moderation queue and the platform Organisations screen are
  drawn but not built** (mockups 05, 06, 07, 10, 11).
- **The moderation pipeline.** No Bedrock Guardrail resource, no publish flow. Phase 3.
- **Stripe.** Metering only. Phase 4.
- **The access log has no writer.** `08-privacy.html` renders it from props; the
  `ORG#{org}/ACCESS#…` rows and the break-glass grant flow do not exist yet.
- **`GET /orgs/{orgId}` export and delete** are drawn, not built.
- **The archive.** Still six unauthenticated routes including DELETE on a table shared by
  all three tiers. Out of scope by the owner's correction — it is a house tool, and writing
  to it is already `admins`-only — but `export-to-archive.js` takes an arbitrary
  `selectedItems` list, so it must learn to refuse anything carrying an `orgId`.

## 4b. One open question I deliberately did NOT settle alone

**An authenticated host with no organisation can still create an orphan session** —
`create-game.js` stamps no `orgId`, writes no org index row, and the session is then listed
by nobody. It is not an isolation hole (an orphan belongs to no one and appears in no one's
list) but it is a confusing one: the host runs a session and cannot find it afterwards.

It is *reachable* only in a narrow window, because a personal org is provisioned lazily on
`GET /orgs` — so a host who reaches "Create engagement" without the console having called
that endpoint has no org yet. The fix I applied is to **bootstrap `GET /orgs` once at
sign-in**, which closes the window at the cause.

The alternative — refusing an orgless create outright — is arguably more honest and is a
one-line change (`tenant.requireOrg`), but it turns a race into a lockout and it reds three
suites whose fixtures create sessions with no authorizer context (`persona-controls`,
`anonymity-contract`, and parts of `update-game`). I did not make that call with the owner
away. **Decide it deliberately; do not let it drift.**

## 5. Landmines found the hard way

Each of these cost real time and none was visible in a diff.

1. **`authFetch` has a capital F.** A source scanner written as `/fetch\(/` matches nothing
   in `authFetch(` and silently checks an empty set.
2. **`deepStrictEqual(groups, ['hosts','admins'])` cannot tell "named explicitly" from
   "fell through to the trailing default".** Deleting the clause a test claimed to pin left
   it green. Check the source, not just the answer.
3. **An invite token is 32 base58 characters travelling in the URL**, and the authorizer's
   generic public rule is `path.includes('join') || 'vote' || 'answer'`. A token spelling one
   of those made its own accept route public. Same family: a set slugged `lessonsandanswers`.
4. **Adding a header to an HTTP API `identitySource` can 401 every request that omits it.**
   `tests/authorizer-identity-source.js` pins the pair: caching off → the header must NOT be
   there; caching on → it must, or one org's decision is served to another.
5. **A row with `orgId` but no `scope` read as PLATFORM** — i.e. public. `setScopeOf` now
   fails closed to `org`.
6. **Encrypting `Answer` while `ProcessedWords` and the RESULTS row quoted it back** in the
   clear protected nothing. Both closed.
7. **The KMS IAM set must come from the require graph, not a list.** By hand: 20 functions.
   Transitively: 32 — the AI generators reach `upload-questions` five requires deep. The
   failure is a production-only 500, because every local test stubs KMS.
8. **`toggle-question-set.js` was a bare upsert** with no existence check and no ownership
   guard; `promote-set-version` and `delete-set-version` had no guard at all.
9. **A test asserting a magic count encodes today's topology.** "GenerateDataKey appears
   exactly twice" went red within the hour when a second org-creating path legitimately
   gained it.
10. **`process.exit()` immediately after `console.error` truncates the output.** A suite
    exiting 2 with no message cost half an hour; the harness writes to fd 2 directly now.

## 6. How to deploy and what to check

```bash
cd src && npm run lint && npx jest && npm run build     # must be clean
# backend aggregate — see docs/handoff/2026-08-11-session-handoff.md for the loop
git push origin dev                                      # a branch push IS the deploy
```

A **branch push to `dev` deploys** (CLAUDE.md; tag pushes 403 from the session container).
AWS CLI work needs `aws sso login --profile adminaccess` first — there are no live
credentials in the session container.

**First-run checks that actually prove something:**
1. Two orgs, two hosts. Host B cannot list, fetch, edit, delete or run host A's set —
   checked against the **API**, not the UI. A hidden button is not a permission.
2. A platform admin listing that org's sets sees ciphertext.
3. Every org can read the platform library — that is the owner's explicit requirement and
   the thing most likely to be broken by an over-tight scope check.
4. Run a session end to end: exactly one `LEDGER#…#SESSION#…` row, and re-joining does not
   bill again.
5. A personal org at 5 sessions is refused a sixth with a **402** and an upgrade payload —
   and a session already running finishes normally.
6. Join as an anonymous participant with the network tab open: **no response may contain any
   set other than the one this game is playing.** This is the check that would have caught
   the original catalogue download.

## 7. If you change one thing, know this

The isolation is **structural** — an org's rows are in an org's partition, so a cross-tenant
read is not "filtered out", it is not expressible. Every key is built in `tenant.js` and
`tests/no-global-partition-literals.js` fails the build if a `'SETS'` or `'GAMES'` literal
appears anywhere else. Do not reintroduce one, and do not "filter by orgId in application
code" — that is the version of this that fails silently.
