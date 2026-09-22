# Billing experience — audit and fake-billing proposal (2026-09-22)

**Summary (10 lines)**

1. Two plans exist in code: `PERSONAL_PLAN` (free, capped at 5 sessions / 5 stored sets) and `TEAM_PLAN` ($5.00 + $0.25 overage, never refused) — `lambda-functions/admin/shared/pricing.js:47-94`.
2. The org row's `plan` string decides which one applies; anything but `'team'` is personal (`pricing.js:105-108`). Every org is created with `plan: 'free'` (`orgs/create-org.js:65`, `orgs/shared/personal-org.js:343`) and **no route exists to change it afterwards**.
3. The only "upgrade" control in the product is a "Create a team" button (`BillingPanel.jsx:150,216`) that opens `CreateOrgDialog`, which creates *another free org* — it does not upgrade anything.
4. The 402 refusal is well-shaped (`pricing.js:313-344`) and a parser exists (`src/src/utils/upgradeRequired.js`), but **no call site uses it**: a host hitting the session cap sees `alert('Failed to create game: …')` (`GameHostPage.jsx:4314`); a set upload cap shows "Upload failed: …" (`AdminPage.jsx:1091,1183,1292`).
5. `get-usage.js` hard-codes `TEAM_PLAN` for the projection and history (`get-usage.js:104,109-116,66`), so a free org's history rows claim "$5.00 charged".
6. No invoice rows exist; "Invoice" and "Billing history" buttons are unwired (`BillingPanel.jsx:146,328`; `AdminPage.jsx:2030-2037` passes neither handler).
7. Platform admins (`admins` Cognito group, `tenant.js:396`) can only list orgs and set status (`orgs/platform-orgs.js:164-167`); they cannot see or set a plan, grant credits or discounts.
8. Proposal: a plan-change request queue + an org billing **ledger** (credits, rate overrides, discount codes, time-boxed offers) + simulated **invoice rows** closed monthly by the existing reconciler, all under `ORG#<org>` / `ORGS` partitions via `tenant.js`.
9. Every on-screen number resolves to a ledger row ID the reader can open; the invoice carries a fixed banner: "This is a simulation. No card was charged."
10. Four PR-sized steps, each shippable; Stripe later replaces exactly one seam (`settleInvoice`), nothing else.

---

## STATUS (kept current)

| Step | State |
|---|---|
| 1. Honest foundations | Shipped to dev `2ab57fdb` (2026-09-22) |
| 2. Plan requests | **Shipped to dev 2026-09-22.** `lambda-functions/admin/orgs/plan-requests.js` (five routes, one handler), `components/PlanRequestDialog.jsx` (dialog + the four-state strip on Plan & usage), `components/PlanRequestsPanel.jsx` (the platform section `planrequests` with a waiting-count badge, and the decide dialog), `components/PlanRequests.css` (`.preq`). Tests: `tests/plan-request-flow.js`, `src/__tests__/planRequests.test.jsx`, `planRequestsPalette.test.js`. Mockups 13–15. A code named on a request is carried and shown, not priced — that is step 3. |
| 3. Adjustments and codes | **Shipped to dev 2026-09-22.** `shared/pricing-adjust.js` (pure; copied to `game/`; the order of application), `orgs/adjustments.js` (grant/list/revoke, codes create/list/retire, `redeemCodeItems` used by plan-request approval in the same transaction — a declined request burns no use), `get-usage.js` returns `adjusted`. Frontend: `AdjustmentsLedger.jsx` (one list for both sides + the bill in miniature), `OrgBillingDrawer.jsx` (drawer, grant, revoke), `DiscountCodesPanel.jsx` (section `discountcodes`), Plan & usage shows the adjusted bill and the ledger. Tests: `tests/pricing-adjust.js`, `tests/adjustments-ledger.js`, `src/__tests__/adjustments.test.jsx`, `adjustmentsLedgerPalette.test.js`. Mockups 16–19. |
| 4. Simulated invoices | Not started |

## PART 1 — Audit

### 1.1 Plans and arithmetic (`lambda-functions/admin/shared/pricing.js`, duplicated byte-for-byte at `lambda-functions/websocket/pricing.js` and `lambda-functions/game/pricing.js`; `tests/pricing.js` pins the copies)

- `TEAM_PLAN` (`:47-60`): `base: 500`, `includedSessions: 5`, `includedSets: 5`, `perSession: 25`, `perSet: 25`, `metersOverage: true`.
- `PERSONAL_PLAN` (`:84-94`): `base: 0`, same 5/5 allowances, per-unit 0, `metersOverage: false` — "the flag that makes a refusal possible".
- `planFor(org)` (`:105-108`): `org.plan === 'team'` → TEAM, else PERSONAL ("ANYTHING UNRECOGNISED IS PERSONAL, INCLUDING ABSENT").
- `projectInvoice(plan, usage)` (`:183-214`): three lines — base, sets (billed on `usage.setsPeak`), sessions (on `sessionsRun`) — integer cents, `totalCents`, `totalDisplay`. The peak rule is stated at `:173-181` and printed on screen (`BillingPanel.jsx:268-273`).
- `allowanceState(plan, usage)` (`:242-288`): gates on `setsCurrent` (not peak), returns `mustUpgradeForSession/Set`, `reason` sentence, `null` for "unlimited" on metered plans.
- `upgradeRequired(kind, state)` (`:313-344`) with `UPGRADE_REQUIRED_STATUS = 402` (`:299`): body `{ error, code:'upgrade_required', upgradeRequired:true, limit:{kind,planId,used,included}, upgrade:{planId,name,priceCents,priceDisplay,includedSessions,includedSets,overageCents,overageDisplay} }`.

### 1.2 The meter (`lambda-functions/admin/shared/usage.js`)

- Rows: `ORG#<org> / USAGE#<yyyy-mm>` (derived counters) and `ORG#<org> / LEDGER#<yyyy-mm>#SESSION#<gameId>` (authority) — `:11-19`, `:130-133`. No `ttl` on either (`:46-60`).
- `readAllowance(orgId)` (`:388-437`): Get `ORG#<org>/METADATA`, Get usage, `allowanceState(planFor(orgRow), usage)`. **Fails open** on any read error or missing METADATA (`:397-421`).
- `usage-reconcile.js` runs daily at 00:05 UTC (`template-clean.yaml:1669-1671`) and recounts current + previous period — this is the natural place to close an invoice.

### 1.3 Where gates fire

- Sets: `admin/upload-questions.js:823-831` — only inside `!isReplace`; returns 402 with `upgradeRequired('sets', allowance)`. Message: "This organisation cannot store another question set yet. A personal organisation includes 5 stored question sets, and 5 are stored. Upgrade to the Team plan ($5.00 a month) to keep going."
- Sessions: `websocket/create-game.js:162-171` — 402 on creating a session only. Same sentence shape with "cannot start another session yet".
- `admin/copy-question-set.js`: no gate (grep finds no `readAllowance`). Copy-on-save from the editor goes through `upload-questions`, and `get-question-sets.js:277-283` ships `setAllowance` so `QuestionSetEditor.jsx:780,1321-1332` can warn "You have no room for a copy … or upgrade your plan" — with no upgrade link.

### 1.4 What the console shows (`get-usage.js`, `BillingPanel.jsx`, `TeamPanel.jsx`)

- `GET /orgs/{orgId}/usage` (`template-clean.yaml:1606`, member-only `get-usage.js:95-97`) returns `plan` (**always TEAM_PLAN**, `:104,109-116`), `period` bounds, `usage`, `allowances`, `overage`, `lines`, `totalIfPeriodEndedToday*`, `storageRule:'peak'`, `history` (each row priced with `TEAM_PLAN`, `:66`).
- `BillingPanel.jsx` recomputes locally with `planFor({plan: planId})` (`:81`), so the screen's plan is right even though the API's `plan` block is wrong. Free view: meters, limit warn box with "Create a team" + "or wait until …" (`:197-224`; `period.resetsOn` is never supplied by the API, so the wait text never renders), "What a team adds" panel. Team view: "What this period costs" table, "Billing history" button (`:146`, `onBillingHistory` undefined), "Invoice" per history row (`:328`, `onInvoice` undefined).
- Mount: `AdminPage.jsx:2029-2037` — `planId={activeOrg.plan || …}`, `onUpgrade={() => setCreatingOrg(true)}`.
- Section visibility: Billing appears for a personal space and for org `owner`/`admin` only (`config/consoleSections.js:318,338`). `TeamPanel.jsx:711-718` tells hosts "the plan … belong[s] to its admins".

### 1.5 The org model (`lambda-functions/admin/orgs/*`)

- `METADATA` row: `orgId, dataKeyCiphertext, name, slug, type ('team'|'personal'), plan ('free'|'team'), seats, status, createdAt, createdBy` (`create-org.js:105-121`). Mirrored `ORGS / ORG#<id>` index row carries `plan` (`:150-160`). `publicOrg()` exposes `plan` (`org-guards.js:546`).
- `create-org.js:53,65-67` accepts `body.plan` in `['free','team']` — **a customer could POST `plan:'team'` and self-grant metering with no payment**; the dialog never sends it (`CreateOrgDialog.jsx:56` sends `{name}` only).
- Org roles: `owner|admin|member` (`tenant.js:71`); `authorizeOrg(event, orgId, minRole)` (`org-guards.js:~482`). Platform staff: Cognito group `admins` via `tenant.isPlatformAdmin` (`tenant.js:396`), checked by `requirePlatformAdmin` (`platform-orgs.js:47-52`).
- Plan-change routes: **none**. Platform: `GET /platform/orgs`, `POST /platform/orgs/{orgId}/status` (`template-clean.yaml:1036,1044`; `platform-orgs.js:164-167`). `PlatformOrgsPanel.jsx:170` renders the plan as read-only text.

### 1.6 What the mockups promised (`docs/design/tenancy-redesign/`)

- `04-billing.html`: Team plan header with period and days left; "Billing history" button; two meters with the included notch; "$8.75 so far" + four-line arithmetic; the peak-storage sentence; "Recent periods" table with an **Invoice** button per row. No discounts, credits or plan change drawn.
- `12-personal-limit.html`: free space at 5/5; "Create a team" as the upgrade + "or wait until 1 September"; "What a team adds"; "$5 a month. Cancel whenever".
- `09-first-run.html`: "Your own space is free … Inviting anyone makes it a Team: $5 a month" — invites do **not** flip the plan in code (`invite-member.js` has no plan logic).
- `10-platform-orgs.html`: staff table with Plan and "This period $8.75" columns; "an account and billing view". `PlatformOrgsPanel.jsx` implements status only.
- `RATIONALE.md` §3: "Nothing is ever blocked" (limit lands on create), "the invoice is shown as arithmetic", storage measured at peak.

### 1.7 How the 402 surfaces today

- `src/src/utils/upgradeRequired.js` exports `isUpgradeRequired/parseUpgradeRequired/readUpgradeRequired`; only `BillingPanel.jsx` (via the `refusal` prop) and tests import it. `AdminPage.jsx` never passes `refusal`.
- Host: `GameHostPage.jsx:4312-4315` → `alert('Failed to create game: ' + errorData.error)`. The API sentence does say "Upgrade to the Team plan ($5.00 a month)", but there is nothing to click.
- Admin upload: `AdminPage.jsx:1091,1183,1292` → notice "Upload failed: …".
- The only "upgrade" button is "Create a team" → `CreateOrgDialog` → `POST /orgs` with `plan:'free'`.

### 1.8 Gap list: "a team wants to get past free" today, step by step

1. Owner hits 5 sessions; `create-game` returns 402; host sees a browser `alert` (`GameHostPage.jsx:4314`). No link to Billing.
2. Owner opens Plan & usage; the free view says "Create a team" (`BillingPanel.jsx:150`). Clicking it creates a **second, free** org (`create-org.js:65`) — the original org stays capped and the new one is also capped.
3. There is no request, no queue, no route, no field a platform admin can flip: `platform-orgs.js` sets `status` only. The only way to make an org Team is a hand edit of two DynamoDB rows (`METADATA` and `ORGS/ORG#…`), or the unguarded `plan:'team'` body on `POST /orgs`.
4. After a hand edit, `readAllowance` stops refusing (`pricing.js:255-256`) and `projectInvoice` bills $5 + overage — but nothing records the change, nothing invoices, and history rows already claimed Team pricing for free months (`get-usage.js:66`).
5. "Billing history" and "Invoice" do nothing (`BillingPanel.jsx:146,328`); no invoice document exists anywhere.
6. Nothing in the system can express a credit, a special rate, a code or a free month.

---

## PART 2 — Proposal: a simulated billing system

Design principle: build it exactly as a real one, with **settlement** replaced by a labelled simulation. All money is integer cents (`pricing.js:11-23`). All rows live under `tenant.orgPk(org)` or `tenant.ORGS_INDEX_PK`; nothing writes a bare `'SETS'`/`'GAMES'` literal (`tests/no-global-partition-literals.js`).

### 2.1 Plan change requests

**State machine** (one row per request; terminal states are never edited):

`requested` → `approved` | `declined` | `withdrawn` (by owner). `approved` additionally writes `plan:'team'` to both org rows and a `LEDGER` entry of kind `PLAN_CHANGE`. A later `downgrade` request follows the same machine with `toPlan:'free'` (approval takes effect at period end — see 2.3).

**Rows**

```
ORG#<org>   / PLANREQ#<isoTs>#<reqId>        the request (RecordType 'PLANREQ')
              { orgId, reqId, fromPlan, toPlan, status, note (owner's), decisionNote,
                requestedBy, requestedAt, decidedBy, decidedAt, discountCode? }
ORGS        / PLANREQ#<status>#<isoTs>#<org>  platform queue pointer (mirrors 'ORGS/ORG#' pattern
              create-org.js:150); moved (delete+put in one TransactWrite) on decision
```

**Routes** (all under `CognitoAuthorizer`; add to `template-clean.yaml` beside `/orgs/{orgId}/usage` at `:1606`)

| Route | Who | Handler |
|---|---|---|
| `POST /orgs/{orgId}/plan-requests` `{toPlan, note, code?}` | org `owner` (via `authorizeOrg(...,'owner')`) | `orgs/plan-request.js` — refuses if an open request exists (409) or `toPlan === current plan` |
| `GET /orgs/{orgId}/plan-requests` | org `admin`+ | same file — list, newest first |
| `DELETE /orgs/{orgId}/plan-requests/{reqId}` | org `owner`, only while `requested` | same file → `withdrawn` |
| `GET /platform/plan-requests?status=requested` | `isPlatformAdmin` | `orgs/platform-plan-requests.js` |
| `POST /platform/plan-requests/{org}/{reqId}/decide` `{decision:'approved'\|'declined', note}` | `isPlatformAdmin` | same file; `note` required (mirrors the "reason is a required field" rule on `10-platform-orgs.html`) |

Remove `body.plan` from `POST /orgs` (`create-org.js:53-67`): a plan is granted, not chosen. Also fix `get-usage.js:104-116` to use `planFor(orgRow)`.

**Screens**

- Owner (Plan & usage, free state): replace "Create a team" with **"Request the Team plan"** opening `PlanRequestDialog` (Modal; X + "Not now" at the bottom; not opened from inside any other dialog). Fields: optional note, optional discount code (validated live via 2.2). After submit the panel shows a status strip: "Requested 22 Sep · waiting for Engage" with **Withdraw**. Outcome strip on decision: "Approved by Engage on 23 Sep — 'welcome aboard'" or "Declined — reason". Keep "or wait until {resetsOn}" and make `get-usage.js` return `period.resetsOn` (first of next month) so it finally renders.
- Host (`GameHostPage.jsx:4312`): replace the `alert` with a `readUpgradeRequired`-driven notice containing "Open Plan & usage" (`/admin?section=billing`). Admin upload paths (`AdminPage.jsx:1091,1183,1292`) do the same via `parseUpgradeRequired`, passing the result as `refusal` to `BillingPanel`.
- Platform (`PlatformOrgsPanel.jsx`): a **Plan requests** count badge on the Organisations section, a queue table (org, from→to, note, code, age), and a `DecideRequestDialog` (decision radio + required note + X + Cancel). New stylesheet `PlanRequests.css` scoped under `.preq`.

### 2.2 Adjustments as ledger entries on the org

All adjustments are append-only rows, never edits to `plan` or to `TEAM_PLAN`:

```
ORG#<org> / ADJ#<isoTs>#<adjId>   RecordType 'ADJUSTMENT'
  kind:      'CREDIT_CENTS' | 'CREDIT_UNITS' | 'RATE_OVERRIDE' | 'CODE_REDEMPTION' | 'OFFER'
  amountCents?      (CREDIT_CENTS; positive = in the org's favour)
  units?            { sessions?: n, sets?: n }         (CREDIT_UNITS — extra included allowance)
  rate?             { baseCents?, perSessionCents?, perSetCents? }  (RATE_OVERRIDE)
  percentOff? | fixedOffCents?                          (CODE_REDEMPTION, OFFER)
  validFrom, validTo (period ids 'yyyy-mm'; OFFER: "X months" = validFrom..validFrom+X-1)
  remainingCents?   (CREDIT_CENTS carries forward until spent; each invoice writes a
                     LEDGER 'CREDIT_APPLIED' row and the invoice references it)
  source: { type:'platform_admin'|'code'|'offer', by: sub, code?: 'WELCOME30' }
  note (required, human), createdAt, revokedAt?, revokedBy?, revokeNote?
```

Discount codes are platform rows: `ORGS / CODE#<CODE>` `{ code, percentOff|fixedOffCents, validFrom, validTo, maxUses, uses, months?, createdBy, note }`. Redeeming (`POST /orgs/{orgId}/codes/redeem`, owner) is a TransactWrite: condition `uses < maxUses` + `ADD uses 1` on the code row, plus one `ADJ` row of kind `CODE_REDEMPTION` on the org. One redemption per code per org (SK includes the code in a conditional pointer `ORG#<org>/CODEUSE#<CODE>`).

Routes: `POST/GET /platform/orgs/{orgId}/adjustments` and `POST .../adjustments/{adjId}/revoke` (platform admin, note required); `GET /orgs/{orgId}/adjustments` (org admin+); `POST/GET /platform/codes` (platform admin).

**Application order** (in a new pure module `pricing-adjust.js`, duplicated like `pricing.js`, frontend-importable): list price via `projectInvoice(effectivePlan, usage)` where `effectivePlan = TEAM_PLAN` merged with any active `RATE_OVERRIDE` and `CREDIT_UNITS` added to `included*` → percent discounts (largest single, no stacking; state the rule on screen) → fixed discounts → dollar credits (never below $0.00; remainder carried). Output: `{ listCents, lines, discounts:[{adjId, label, amountCents}], creditsApplied:[…], totalCents, savingsPercent }`.

### 2.3 The simulated invoice

**Row**: `ORG#<org> / INVOICE#<yyyy-mm>` RecordType `INVOICE`, `status: 'open' | 'closed'`, `simulated: true`, and the full computed document (plan snapshot, usage snapshot, lines, discounts with `adjId`s, credits with `adjId`s, `listCents`, `totalCents`, `savingsPercent`, `closedAt`, `closedBy:'reconciler'`). An `ORGS / INVOICE#<yyyy-mm>#<org>` pointer lets staff list a month.

**When**: `usage-reconcile.js` already runs daily and reconciles the previous period (`template-clean.yaml:1671`). Add: for every org, if `INVOICE#<prevPeriod>` is absent, compute and write it `closed` (conditional put — idempotent like the rest of that file). The live projection stays `GET /orgs/{orgId}/usage`, extended with the same `discounts/credits/list/total` block for "if the period ended today". `GET /orgs/{orgId}/invoices` and `GET /orgs/{orgId}/invoices/{period}` (org admin+) read the rows.

**Screen**: `InvoicePanel.jsx` (+ `InvoicePanel.css`, scope `.inv`), reached from "Invoice" on the history row and from "Billing history" (a list of closed invoices, newest first). Layout: header with org, period, invoice number `SIM-<org>-<yyyy-mm>`; a **banner at the top and repeated above the total**:

> **This is a simulation. No card was charged.** You would have been charged **$3.50** — a **30% discount** from the list price of **$5.00** (code WELCOME30, applied 22 Sep by Engage).

Then: list lines (from `projectInvoice`), one row per discount/credit with its source and a link to the ledger row, subtotal, total, and "How this was calculated" (the application order in words). Free-plan invoices are written too, at $0.00, so history is complete and `get-usage.js:66` stops inventing $5.00 for free months.

### 2.4 Transparency rule and screens

**Rule**: every currency amount and every allowance number rendered in the console must carry a `data-source` that names a row (`USAGE#…`, `LEDGER#…`, `ADJ#…`, `CODE#…`, `INVOICE#…`, or `plan:team` for list prices), and clicking it opens `LedgerRowDialog` showing the raw row (keys redacted to `orgId`, values as stored, who/when/note). Enforced by a jest test that walks `InvoicePanel` and `BillingPanel` output for `$` strings without `data-source`.

Screens: **Billing history** (invoices list), **Invoice** (2.3), **Adjustments** tab on Plan & usage for org admins (read-only list of `ADJ` rows with status active/expired/revoked), and on the platform side an **Org billing** drawer from `PlatformOrgsPanel` (plan, open request, adjustments with revoke, codes redeemed, invoices). Session ledger rows (`LEDGER#…#SESSION#<gameId>`) are listed under the Sessions line so "15 over" is fifteen named sessions.

### 2.5 What future Stripe replaces, and what stays

Stays Stripe-independent: plan requests, `ADJ` ledger, code rows, `INVOICE` rows, `pricing.js`/`pricing-adjust.js`, all screens.

The one seam: `settleInvoice(invoiceRow)` inside `usage-reconcile.js`'s close step. Today it sets `settlement: { kind:'simulated', chargedCents: 0, wouldHaveChargedCents: totalCents }`. With Stripe it would create a PaymentIntent for `totalCents` and write `settlement: { kind:'stripe', paymentIntentId, chargedCents }`. The approval step in 2.1 gains a precondition (a payment method on file) but its state machine does not change. Nothing else references a processor. The banner text keys off `settlement.kind`.

### 2.6 Sequence (each PR shippable)

**PR 1 — Honest foundations.** `get-usage.js` uses `planFor(orgRow)` and returns `period.resetsOn`; remove `body.plan` from `create-org.js`; wire `readUpgradeRequired` into `GameHostPage.jsx:4312` and the three `AdminPage` upload paths; pass `refusal` to `BillingPanel`; "Create a team" copy becomes "Request the Team plan" (disabled until PR 2, with a "coming" note is not acceptable — instead keep the button hidden until PR 2). Tests: `tests/get-usage-plan.js` (free org projects $0.00 history), `tests/create-org-no-plan.js` (`plan:'team'` in body → 400), jest `hostUpgradeNotice.test.jsx`, extend `billingPanel.test.jsx` for `resetsOn`.

**PR 2 — Plan requests.** Rows, five routes, `PlanRequestDialog`, owner status strip, platform queue + `DecideRequestDialog`, `PlanRequests.css` + `planRequestsPalette.test.js`. Tests: `tests/plan-request-flow.js` (state machine, 409 on duplicate, owner-only, staff-only decide, approval writes both org rows and a `PLAN_CHANGE` ledger row, no bare partition literal — extend `no-global-partition-literals.js` allowlist scanning), jest for both dialogs (X and bottom exit present, never opened from another modal), `platformOrgsPanel.test.jsx` badge.

**PR 3 — Adjustments and codes.** `pricing-adjust.js` (pure, triplicated, drift-pinned in `tests/pricing.js` style), `ADJ`/`CODE` rows and routes, platform Org billing drawer, org Adjustments tab, code field on the request dialog. Tests: `tests/pricing-adjust.js` (order of application, no-stacking, credit carry-forward, integer cents under a junk sweep, $0 floor), `tests/discount-codes.js` (max uses race via conditional, one-per-org, validity window), jest palette test for the drawer stylesheet.

**PR 4 — Invoices and transparency.** `INVOICE` rows closed by `usage-reconcile.js`, invoice routes, `InvoicePanel` with banner, Billing history list, `LedgerRowDialog`, `data-source` rule test. Tests: `tests/invoice-close.js` (idempotent close, previous period only, free org → $0.00 row, `settlement.kind === 'simulated'`, `wouldHaveChargedCents` equals projected total), jest `invoicePanel.test.jsx` (banner text present in both places, every `$` has `data-source`), `invoicePanelPalette.test.js`.

Repo rules honoured throughout: one stylesheet per screen under a scope class (`.preq`, `.inv`, `.obill`), mockup first — add `docs/design/tenancy-redesign/13-plan-request.html`, `14-invoice.html`, `15-platform-billing.html` before PR 2/4 code, built with the shared shell like `04-billing.html`; palette tests follow `billingPanelPalette.test.js`; dialogs use `components/Modal.jsx` with an X and a bottom exit; the request dialog is launched from the panel, never from another dialog.

### 2.7 Open questions for the owner (recommended answers)

1. Should a declined request be re-requestable immediately? — **Yes**, with the previous decision note shown; declines are conversations, not bans.
2. Do percent discounts stack with dollar credits? — **Percent first, then credits, never stacking two percents**; print the order on the invoice.
3. Does a downgrade to free take effect immediately or at period end? — **Period end**; sets above the free allowance are kept but new creation is gated, matching `upload-questions.js:823`.
4. Should invites auto-request Team (as `09-first-run.html` implies "Inviting anyone makes it a Team")? — **No auto-flip**; show a one-line prompt on the Members screen that opens the request dialog.
5. Who can redeem a code — owner only, or admins too? — **Owner only**, same as requesting the plan; admins can see it.
6. Should the invoice number be visibly marked simulated (`SIM-…`)? — **Yes**, and keep the prefix until a real settlement exists so no simulated document is ever mistaken for a receipt.
