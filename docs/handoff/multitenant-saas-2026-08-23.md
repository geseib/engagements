# Handoff — Engage as a multi-tenant SaaS

**Branch:** `working/engagements-multitenant-saas-832f3f`
**Status:** backend complete and green; console partly built; **not yet deployed**.
**Read first:** `~/.claude/plans/make-sure-you-get-magical-book.md` (the approved plan) and
`docs/design/tenancy-redesign/RATIONALE.md`. **Open the mockups in a browser** — they are
the design, and reading the HTML is not the same as seeing them render.

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
