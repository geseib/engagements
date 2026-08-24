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
 * line, a total or a price. Even `$0.25` is `formatCents(TEAM_PLAN.perSession)`.
 *
 * IT IS IMPORTED AS A DEFAULT AND DESTRUCTURED, not as named imports. The file
 * is CommonJS (`module.exports = { ... }`) because a Lambda requires it, and
 * webpack does not reliably see named exports through an object-literal
 * `module.exports`. `import pricing from` gets `module.exports` itself under
 * both webpack's ESM-to-CJS interop and babel-jest's, which is the one form
 * that works in the bundle AND in the test run.
 */
import pricing from '../../../lambda-functions/game/pricing';

const {
  TEAM_PLAN, planFor, projectInvoice, allowanceState, formatCents,
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
export default function BillingPanel({
  planId = 'personal',
  usage = {},
  period = {},
  passedAllowanceOn = '',
  history = [],
  refusal = null,
  error = '',
  onUpgrade,
  onBillingHistory,
  onInvoice,
  theme = 'dark',
  className = '',
}) {
  const plan = planFor({ plan: planId });
  const metered = plan.metersOverage === true;

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

  const teamPrice = formatCents(TEAM_PLAN.base);
  const teamOverage = formatCents(TEAM_PLAN.perSession);
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
    : ['Your own space', 'free', period.label].filter(Boolean).join(' · ');

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
    limitLead = `You are holding all ${state.setsIncluded} question sets a personal space includes.`;
  }

  return (
    <div className={`bill${className ? ` ${className}` : ''}`} data-theme={theme} data-plan={plan.id}>
      <div className="bill-head">
        <div>
          <h1 className="bill-title">Plan &amp; usage</h1>
          <p className="bill-sub">{sub}</p>
        </div>
        <div className="bill-head-actions">
          {metered ? (
            <button type="button" className="bill-btn" onClick={onBillingHistory}>
              Billing history
            </button>
          ) : (
            <button type="button" className="bill-btn bill-btn--primary" onClick={onUpgrade}>
              Create a team
            </button>
          )}
        </div>
      </div>

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
                : 'A space of your own is free. These are its limits.'}
            </p>
          </div>
          <div className="bill-panel-body">
            <UsageMeter rows={meterRows} theme={theme} />

            {metered && state.sessionsUsed > state.sessionsIncluded ? (
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

            {metered && state.sessionsUsed <= state.sessionsIncluded ? (
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
                    ? ' The next set you store needs a Team, '
                    : ' Your next session needs a Team, '}
                  {`which is ${teamPrice} a month and includes ${TEAM_PLAN.includedSessions} sessions `}
                  {`and ${TEAM_PLAN.includedSets} sets — then ${teamOverage} each beyond, with nothing `}
                  ever cut off mid-session.
                </p>
                {/* Two exits, side by side. A limit with exactly one exit reads
                    as a toll gate — and waiting really is an exit here, because
                    the allowance is per period. */}
                <div className="bill-exits">
                  <button
                    type="button"
                    className="bill-btn bill-btn--sm bill-btn--primary"
                    onClick={onUpgrade}
                  >
                    Create a team
                  </button>
                  {period.resetsOn ? (
                    <span className="bill-wait">{`or wait until ${period.resetsOn}`}</span>
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
            <div className="bill-panel-head"><h2 id="bill-team-h">What a team adds</h2></div>
            <div className="bill-panel-body">
              <dl className="bill-kv">
                <dt>People</dt>
                <dd>Invite colleagues. They can run your sets and build their own.</dd>
                <dt>More of everything</dt>
                <dd>
                  {`${TEAM_PLAN.includedSessions} sessions and ${TEAM_PLAN.includedSets} sets `}
                  {`included, then ${teamOverage} each. Nothing is ever blocked once you are paying.`}
                </dd>
                <dt>Your work comes with you</dt>
                <dd>
                  {`The ${state.setsUsed} sets you already have stay yours. `}
                  Nothing is copied, moved or shared until you say so.
                </dd>
              </dl>
              <p className="bill-note bill-note--after">
                {`${teamPrice} a month. Cancel whenever — your sets and reports stay, and export `}
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
