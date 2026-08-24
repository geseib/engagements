# Handoff — Engage as a multi-tenant SaaS

**Branch:** `dev`. First pass `6730ce9a`; **second pass `1e6ff843`** — read §0 first,
it is the one that answers what dev actually showed.
**Status:** deployed to dev 2026-08-23, twice. Test and prod have not seen either.

**Baselines at the second push:** frontend **172 suites / 4104 tests** green · backend
**91 node suites** green · lint 0 errors / 11 known `exhaustive-deps` warnings · build
clean with the 2 known size warnings · `tests/template-validates.js` 2 passed.

**Still unbuilt, and named in §7:** the public library and its moderation
pipeline (mockups 05, 06, 07, 11), Stripe, the access-log WRITER — the Data &
privacy page renders the log but nothing writes rows to it yet — the
break-glass grant, and org export/delete.

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
