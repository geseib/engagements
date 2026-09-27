import React from 'react';
import UsageMeter from './UsageMeter';
import './BillingPanel.css';
/**
 * ONE INVOICE, ONE IMPLEMENTATION.
 *
 * `lambda-functions/game/pricing.js` is dependency-free ON PURPOSE so that the
 * console can import the same arithmetic the API bills from. Two
 * implementations of one invoice will disagree eventually, and the one the
 * customer believes is the one on this screen — so nothing here re-computes a
 * line, a total or a price. Even `$0.25` is `formatCents(STANDARD_PLAN.perSession)`.
 *
 * IT IS IMPORTED AS A DEFAULT AND DESTRUCTURED, not as named imports. The file
 * is CommonJS (`module.exports = { ... }`) because a Lambda requires it, and
 * webpack does not reliably see named exports through an object-literal
 * `module.exports`. `import pricing from` gets `module.exports` itself under
 * both webpack's ESM-to-CJS interop and babel-jest's, which is the one form
 * that works in the bundle AND in the test run.
 */
import pricing from '../../../lambda-functions/game/pricing';
import { PlanRequestStrip } from './PlanRequestDialog';
import AdjustmentsLedger, { AdjustedBill } from './AdjustmentsLedger';

const {
  planFor, upgradePlanFor, projectInvoice, allowanceState, formatCents,
} = pricing;

/**
 * PLAN & USAGE — the whole surface, in both of its states.
 *
 * Specification: docs/design/tenancy-redesign/04-billing.html (a paid Team over
 * its included sessions) and 12-personal-limit.html (a free personal space at
 * its limit, with the upgrade path AND the wait-it-out alternative — a limit
 * with exactly one exit reads as a toll gate).
 *
 * PURE PROPS AND CALLBACKS. `AdminPage` cannot be mounted in jsdom — `useAuth`
 * hard-throws outside its provider — so this component fetches nothing, reads
 * no context and owns no auth. It is handed a usage record and calls back.
 *
 * @param {string}   planId   'team' | 'personal' | anything else. Handed to
 *                            `planFor`, which treats ANYTHING unrecognised as
 *                            personal — including absent. Defaulting the other
 *                            way would show unlimited metered usage to a row
 *                            with a typo in it.
 * @param {object}   usage    { sessionsRun, setsCurrent, setsPeak } from
 *                            GET /orgs/{orgId}/usage.
 * @param {object}   period   { label, daysLeft, resetsOn } — the period as
 *                            words. The server owns the dates; this screen does
 *                            not do calendar arithmetic.
 * @param {string}   passedAllowanceOn  e.g. '12 August'. Optional; the warn box
 *                            names the day only when the server knows it.
 * @param {object[]} history  [{ key, period, sessions, setsHeld, chargedCents }]
 * @param {object}   refusal  OPTIONAL. A 402 the caller just took, either as
 *                            the raw body (`{ code: 'upgrade_required', limit,
 *                            upgrade }`) or as `parseUpgradeRequired()` returns
 *                            it from src/src/utils/upgradeRequired.js, which
 *                            normalises `kind` up to the top level. BOTH SHAPES
 *                            ARE READ, because the panel is handed whichever
 *                            one the call site happened to have.
 *
 *                            It arrives as a PROP rather than through an import
 *                            because this panel does no fetching: the refusal
 *                            belongs to the request that was refused, which
 *                            happened somewhere else. When it is present the
 *                            warn box names the thing that was actually
 *                            refused, instead of leaving the reader to infer it
 *                            from two meters.
 */
/** `2026-10-01` → "1 October"; a label that is already words passes through. */
export function formatResetsOn(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return String(value || '');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export default function BillingPanel({
  planId = 'personal',
  /** 'personal' | 'team' — decides the plan offered: Standard to a person's
   *  own space, the Organisation plan to a team (27 Sep 2026). */
  orgType = '',
  usage = {},
  period = {},
  passedAllowanceOn = '',
  history = [],
  refusal = null,
  error = '',
  onUpgrade,
  /**
   * BILLING STEP 2 — the plan request (docs/design/tenancy-redesign/13, 14).
   * `planRequest` is the latest request row for this organisation, or null;
   * `onRequestPlan` opens the dialog; `onWithdrawRequest` withdraws the open
   * one. All three optional: the personal space and the host's plain screen
   * pass none and see neither the strip nor the button.
   */
  planRequest = null,
  onRequestPlan,
  onWithdrawRequest,
  requestBusy = false,
  /**
   * BILLING STEP 3 (mockup 19): `adjusted` is GET /usage's bill with the
   * ledger applied; `adjustments` is GET /orgs/{id}/adjustments. Both
   * optional — the host's plain screen and the tests pass neither.
   */
  adjusted = null,
  adjustments = null,
  onBillingHistory,
  onInvoice,
  theme = 'dark',
  className = '',
}) {
  const plan = planFor({ plan: planId });
  const metered = plan.metersOverage === true;
  // Pay per use (the Organisation plan): nothing included, so there is no
  // allowance to draw a meter against — the counts and the arithmetic say it.
  const payPerUse = metered && plan.includedSessions === 0 && plan.includedSets === 0;
  const upgrade = upgradePlanFor({ type: orgType });
  const isTeam = orgType === 'team';
  const eventsRun = Math.max(0, Math.trunc(Number(usage && usage.eventsRun) || 0));

  /* The invoice bills the PEAK number of sets held; the gate reads what is held
     RIGHT NOW. Two numbers, two jobs — conflating them either over-bills or
     refuses somebody with empty shelves. pricing.js takes both, from the two
     fields the usage record carries. */
  const invoice = projectInvoice(plan, usage);
  const state = allowanceState(plan, usage);

  const meterRows = [
    {
      key: 'sessions',
      label: 'Sessions run',
      used: state.sessionsUsed,
      included: state.sessionsIncluded,
    },
    {
      key: 'sets',
      label: 'Question sets stored',
      used: state.setsUsed,
      included: state.setsIncluded,
    },
  ];

  /* The offered plan's terms, in one sentence and from pricing.js alone. */
  const upgradeTerms = upgrade.base > 0
    ? `${formatCents(upgrade.base)} a month and includes ${upgrade.includedSessions} sessions `
      + `and ${upgrade.includedSets} sets — then ${formatCents(upgrade.perSession)} each beyond, and `
      + `${formatCents(upgrade.perEvent)} an event`
    : `no monthly fee — ${formatCents(upgrade.perSession)} a session or a stored set as you use them, `
      + `and ${formatCents(upgrade.perEvent)} an event`;
  const requestLabel = `Request the ${upgrade.name}`;
  /* `parseUpgradeRequired` lifts kind to the top level; the raw 402 body keeps
     it under `limit`. Read both rather than making the call site convert. */
  const refusedKind = (refusal && (refusal.kind || (refusal.limit && refusal.limit.kind))) || '';

  /* ------------------------------------------------------------ the head -- */

  const sub = metered
    ? [
      plan.name,
      period.label ? `billing period ${period.label}` : '',
      Number.isFinite(Number(period.daysLeft)) ? `${Number(period.daysLeft)} days left` : '',
    ].filter(Boolean).join(' · ')
    : [isTeam ? 'A team' : 'Your own space',
      isTeam ? 'free until Engage approves the Organisation plan' : 'free',
      period.label].filter(Boolean).join(' · ');

  /* ------------------------------------------ the sentence about the limit --
     Written out rather than assembled from `state.reason`, because the API's
     reason is the sentence a REFUSAL quotes and this is the sentence a person
     reads before they hit one. Both name the same numbers; only one of them has
     to survive being pasted into a support thread. */
  let limitLead = '';
  if (state.mustUpgradeForSession && state.mustUpgradeForSet) {
    limitLead = `You have used all ${state.sessionsIncluded} sessions and are holding all `
      + `${state.setsIncluded} question sets this month.`;
  } else if (state.mustUpgradeForSession) {
    limitLead = `You have used all ${state.sessionsIncluded} sessions this month.`;
  } else if (state.mustUpgradeForSet) {
    limitLead = `You are holding all ${state.setsIncluded} question sets the free plan includes.`;
  }

  return (
    <div className={`bill${className ? ` ${className}` : ''}`} data-theme={theme} data-plan={plan.id}>
      <div className="bill-head">
        <div>
          <h1 className="bill-title">Plan &amp; usage</h1>
          <p className="bill-sub">{sub}</p>
        </div>
        <div className="bill-head-actions">
          {/* Free months have invoices too (mockup 21), so history is offered
              to everyone the console knows how to open it for. */}
          {!metered && onBillingHistory && (
            <button type="button" className="bill-btn" onClick={onBillingHistory}>Billing history</button>
          )}
          {metered ? (
            <button type="button" className="bill-btn" onClick={onBillingHistory}>
              Billing history
            </button>
          ) : onRequestPlan && (!planRequest || planRequest.status !== 'requested') ? (
            <button type="button" className="bill-btn bill-btn--primary" onClick={onRequestPlan} data-testid="bill-request-plan">
              {requestLabel}
            </button>
          ) : onUpgrade ? (
            <button type="button" className="bill-btn bill-btn--primary" onClick={onUpgrade}>
              Create a team
            </button>
          ) : null}
        </div>
      </div>

      {/* The request's state, above the meters — mockup 14. Shown for a free
          org with any request on record; a metered org sees only an approval
          (the others would be history it has already acted on). */}
      {planRequest && (!metered || planRequest.status === 'approved') && (
        <PlanRequestStrip
          request={planRequest}
          onWithdraw={onWithdrawRequest}
          onRequestAgain={onRequestPlan}
          busy={requestBusy}
        />
      )}

      {error ? (
        <p className="bill-notebox bill-notebox--bad" role="alert">
          <b>This period could not be loaded.</b> {error}
        </p>
      ) : null}

      <div className="bill-grid">
        <section className="bill-panel" aria-labelledby="bill-usage-h">
          <div className="bill-panel-head">
            <h2 id="bill-usage-h">{metered ? 'This period' : 'This month'}</h2>
            <p className="bill-note">
              {metered
                ? 'Updated as sessions run. Nothing here is a forecast.'
                : (isTeam ? 'Free until the Organisation plan is approved. These are its limits.' : 'A space of your own is free. These are its limits.')}
            </p>
          </div>
          <div className="bill-panel-body">
            {payPerUse ? (
              <dl className="bill-kv" data-testid="bill-per-use">
                <dt>Sessions run</dt><dd>{state.sessionsUsed}</dd>
                <dt>Question sets stored</dt><dd>{state.setsUsed}</dd>
                <dt>Events run</dt><dd>{eventsRun}</dd>
              </dl>
            ) : (
              <UsageMeter rows={meterRows} theme={theme} />
            )}
            {!payPerUse && plan.allowsEvents ? (
              <p className="bill-note bill-note--after" data-testid="bill-events-run">
                {`Events run this period: ${eventsRun}, at ${formatCents(plan.perEvent)} each — counted when an event first goes live.`}
              </p>
            ) : null}

            {/* WHAT "SESSIONS RUN" COUNTS — the owner's rule, 2026-09-23, stated
                where the number is (websocket/session-count.js). */}
            <p className="bill-note bill-note--after" data-testid="bill-session-rule">
              A session counts once two of its questions have been answered. Creating,
              starting, joining and a rehearsal are free.{' '}
              <a href="/help/host-plan">How sessions are counted</a>
            </p>

            {payPerUse ? (
              <p className="bill-notebox bill-notebox--top">
                <b>Pay per use, and nothing is ever blocked.</b>
                {` Every session and every stored set is ${formatCents(plan.perSession)}, and every event `}
                {`${formatCents(plan.perEvent)}. There is no monthly fee and no allowance to run out of.`}
              </p>
            ) : null}

            {metered && !payPerUse && state.sessionsUsed > state.sessionsIncluded ? (
              <p className="bill-notebox bill-notebox--warn bill-notebox--top">
                <b>
                  {`You passed the included ${state.sessionsIncluded} sessions`}
                  {passedAllowanceOn ? ` on ${passedAllowanceOn}` : ''}.
                </b>
                {` Every session since has added ${formatCents(plan.perSession)}. Nothing stopped, `}
                and nothing will — we do not block a session you are about to run in front of
                a room.
              </p>
            ) : null}

            {metered && !payPerUse && state.sessionsUsed <= state.sessionsIncluded ? (
              <p className="bill-notebox bill-notebox--top">
                <b>Nothing here is ever blocked.</b>
                {` Past the included allowance a session or a stored set is ${formatCents(plan.perSession)}`}
                , charged and stated in advance. It is never enforced, and never in the middle
                of a session.
              </p>
            ) : null}

            {!metered && state.mustUpgrade ? (
              <div className="bill-notebox bill-notebox--warn bill-notebox--top">
                <p style={{ margin: 0 }}>
                  <b>{limitLead}</b>
                  {refusedKind === 'sets'
                    ? ` The next set you store needs the ${upgrade.name}, `
                    : ` Your next session needs the ${upgrade.name}, `}
                  {`which is ${upgradeTerms}, with nothing ever cut off mid-session.`}
                </p>
                {/* Two exits, side by side. A limit with exactly one exit reads
                    as a toll gate — and waiting really is an exit here, because
                    the allowance is per period. */}
                <div className="bill-exits">
                  {onRequestPlan && (!planRequest || planRequest.status !== 'requested') ? (
                    <button type="button" className="bill-btn bill-btn--sm bill-btn--primary" onClick={onRequestPlan}>
                      {requestLabel}
                    </button>
                  ) : onUpgrade ? (
                    <button
                      type="button"
                      className="bill-btn bill-btn--sm bill-btn--primary"
                      onClick={onUpgrade}
                    >
                      Create a team
                    </button>
                  ) : null}
                  {period.resetsOn ? (
                    <span className="bill-wait">{`${onUpgrade ? 'or wait' : 'Wait'} until ${formatResetsOn(period.resetsOn)}`}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!metered && !state.mustUpgrade ? (
              <p className="bill-notebox bill-notebox--top">
                <b>Nothing is ever blocked mid-session.</b> A limit only ever stops you
                starting a new one, and the allowance starts again next period.
              </p>
            ) : null}
          </div>
        </section>

        {metered ? (
          <section className="bill-panel" aria-labelledby="bill-cost-h">
            <div className="bill-panel-head"><h2 id="bill-cost-h">What this period costs</h2></div>
            <div className="bill-panel-body">
              <div className="bill-total">
                {/* The ONE display number this panel is allowed. */}
                <span className="bill-bignum" data-total={invoice.totalDisplay}>
                  <span className="bill-cur">$</span>
                  {invoice.totalDisplay.replace(/^\$/, '')}
                </span>
                <span className="bill-sofar">so far</span>
              </div>

              {/* SHOW THE ARITHMETIC. Every line, its quantity and its amount
                  come from projectInvoice — the same call the API bills from. */}
              <table className="bill-calc">
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.key}>
                      <td>
                        {line.label}
                        <span className="bill-why">{line.detail}</span>
                      </td>
                      <td>{line.amountDisplay}</td>
                    </tr>
                  ))}
                  <tr className="bill-calc-total">
                    <td>Total if the period ended today</td>
                    <td>{invoice.totalDisplay}</td>
                  </tr>
                </tbody>
              </table>

              {/* THE BILL WITH THE LEDGER APPLIED — the same arithmetic the
                  invoice is written from, every step named. Shown under the
                  list arithmetic only when something actually changes it. */}
              {adjusted && (adjusted.discounts.length > 0 || adjusted.credits.length > 0) && (
                <div className="bill-adjusted" data-testid="bill-adjusted">
                  <h3 className="bill-h3">With your adjustments</h3>
                  <AdjustedBill adjusted={adjusted} audience="org" />
                </div>
              )}

              <p className="bill-note bill-note--after">
                Storage is charged on the <b>highest</b> number of sets you held at once this
                period, not the number at the end. A set you created and deleted still counted.
                <b> Sets from the Engage library and the public library are free</b> — you can
                use as many as you like and none of them count here.
              </p>
            </div>
          </section>
        ) : (
          <section className="bill-panel" aria-labelledby="bill-team-h">
            <div className="bill-panel-head"><h2 id="bill-team-h">{`What the ${upgrade.name} adds`}</h2></div>
            <div className="bill-panel-body">
              <dl className="bill-kv">
                <dt>Events</dt>
                <dd>
                  {`A whole agenda behind one code, run by any host here — ${formatCents(upgrade.perEvent)} an event, `}
                  counted when it first goes live.
                </dd>
                {isTeam ? (
                  <>
                    <dt>Pay per use</dt>
                    <dd>
                      {`No monthly fee. ${formatCents(upgrade.perSession)} a session and a stored set, as you use them. `}
                      Nothing is ever blocked once Engage has approved it.
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>More of everything</dt>
                    <dd>
                      {`${upgrade.includedSessions} sessions and ${upgrade.includedSets} sets `}
                      {`included, then ${formatCents(upgrade.perSession)} each. Nothing is ever blocked once you are paying.`}
                    </dd>
                  </>
                )}
                <dt>Your work comes with you</dt>
                <dd>
                  {`The ${state.setsUsed} sets you already have stay yours. `}
                  Nothing is copied, moved or shared until you say so.
                </dd>
              </dl>
              <p className="bill-note bill-note--after">
                {upgrade.base > 0
                  ? `${formatCents(upgrade.base)} a month. Leave whenever — your sets and reports stay, and export `
                  : 'No monthly fee. Leave whenever — your sets and reports stay, and export '}
                needs no conversation.
              </p>
            </div>
          </section>
        )}
      </div>

      {history.length ? (
        <>
          <h3 className="bill-secttl">Recent periods</h3>
          <table className="bill-tbl">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Period</th>
                <th style={{ width: '16%' }}>Sessions</th>
                <th style={{ width: '16%' }}>Sets held</th>
                <th style={{ width: '16%' }}>Charged</th>
                <th style={{ width: '30%' }} aria-label="Invoice" />
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.key || row.period}>
                  <td>{row.period}</td>
                  <td className="bill-num">{row.sessions}</td>
                  <td className="bill-num">{row.setsHeld}</td>
                  <td className="bill-num">{formatCents(row.chargedCents)}</td>
                  <td>
                    <div className="bill-rowacts">
                      <button
                        type="button"
                        className="bill-btn bill-btn--sm bill-btn--ghost"
                        onClick={onInvoice ? () => onInvoice(row) : undefined}
                      >
                        Invoice
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {/* Said unprompted, at the foot, on the free screen: somebody who has just
          hit a wall assumes the worst, and the worst here would be a room
          watching a session stop. */}
      {adjustments && adjustments.length > 0 && (
        <section className="bill-panel" aria-labelledby="bill-adj-h" data-testid="bill-adjustments">
          <div className="bill-panel-head">
            <h2 id="bill-adj-h">Adjustments on your account</h2>
            <p className="bill-panel-sub">Granted by Engage, or redeemed by you. Nothing here can be changed from this screen.</p>
          </div>
          <div className="bill-panel-body">
            <AdjustmentsLedger adjustments={adjustments} audience="org" />
          </div>
        </section>
      )}

      {!metered ? (
        <p className="bill-notebox bill-notebox--foot">
          <b>The session you are running right now is not affected.</b> A limit only ever stops
          you STARTING one. Nothing interrupts a room that is already in front of you — joining,
          answering, voting and results keep working to the end, every time.
        </p>
      ) : null}
    </div>
  );
}
