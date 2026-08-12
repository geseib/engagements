import React from 'react';
import Icon from './Icon';

/**
 * THE THREE TIERS, DRAWN AS THREE DIFFERENT THINGS.
 *
 * The report comes from `utils/promptPreflight.js`, owned elsewhere:
 *
 *   preflightPrompt({ instructions, outputFormat, outputSections, template,
 *                     gameType, isDefault, targetModel })
 *     => { blocking: Finding[], silent: Finding[], advisory: Finding[], stats }
 *   Finding = { code, title, detail, evidence, fix }
 *
 * WHY SILENT IS DRAWN LOUDER THAN BLOCKING, which looks wrong and is not.
 * A blocking finding announces itself: the save does not happen, and the person
 * is standing right there. A silent finding saves, runs, produces a summary,
 * and the summary is wrong — and the first reader is a room, out loud, off a
 * projector. Every defect this product has shipped into a live prompt is in
 * that tier: a participation figure that was 100% by construction, a consensus
 * label computed from a comparison that could not vary, a rule that rendered as
 * "If 11 is 0". None of them failed. That is the whole problem.
 *
 * So the silent tier is expanded by default, carries its evidence and its fix
 * on the face of the panel, and never uses the word "warning". Advisory is the
 * tier that gets to be small.
 *
 * The panel is also honest about NOT having run. A missing preflight module
 * draws a stated absence, not a green tick and not nothing — "the checks did
 * not run" is a different sentence from "there is nothing wrong", and the
 * second one is the lie this repo keeps writing.
 */

const TIERS = [
  {
    key: 'blocking',
    className: 'ppf-tier--blocking',
    heading: 'Stops the save',
    lede: 'Nothing has been written. Fix these and the Save button comes back.',
    icon: 'Warning',
  },
  {
    key: 'silent',
    className: 'ppf-tier--silent',
    heading: 'Saves fine. Misbehaves quietly.',
    lede:
      'These do not fail. The prompt saves, the summary generates, and what the room hears is '
      + 'wrong or missing — with nothing in the logs and no error anywhere.',
    icon: 'Warning',
  },
  {
    key: 'advisory',
    className: 'ppf-tier--advisory',
    heading: 'Worth knowing',
    lede: 'Nothing breaks. Read them once.',
    icon: 'Lightbulb',
  },
];

/** The one question the save button asks. Exported so the call site can too. */
export function blocksSave(report) {
  return !!(report && Array.isArray(report.blocking) && report.blocking.length > 0);
}

export function findingCounts(report) {
  const count = (key) => (report && Array.isArray(report[key]) ? report[key].length : 0);
  return { blocking: count('blocking'), silent: count('silent'), advisory: count('advisory') };
}

function Finding({ finding, expanded }) {
  return (
    <li className="ppf-finding" data-testid={`ppf-finding-${finding.code}`}>
      <p className="ppf-finding-title">
        <strong>{finding.title}</strong>
        {finding.code && <span className="ppf-code">{finding.code}</span>}
      </p>
      {finding.detail && <p className="ppf-finding-detail">{finding.detail}</p>}
      {expanded && finding.evidence && (
        <pre className="ppf-evidence">{finding.evidence}</pre>
      )}
      {expanded && finding.fix && (
        <p className="ppf-fix">
          <span className="ppf-fix-label">Fix</span> {finding.fix}
        </p>
      )}
    </li>
  );
}

export default function PromptPreflightPanel({ report, unavailable = false, unavailableReason }) {
  if (unavailable || !report) {
    return (
      <section className="ppf ppf-tier ppf-tier--absent" data-testid="prompt-preflight-absent">
        <h5>
          <Icon name="Warning" weight="fill" size={16} color="currentColor" /> The checks did not run
        </h5>
        <p>
          {unavailableReason
            || 'utils/promptPreflight.js is not installed in this build, so nothing has been checked. '
              + 'This is not the same as nothing being wrong.'}
        </p>
      </section>
    );
  }

  const counts = findingCounts(report);
  const total = counts.blocking + counts.silent + counts.advisory;

  return (
    <div className="ppf" data-testid="prompt-preflight-panel">
      {total === 0 && (
        <section className="ppf-tier ppf-tier--clean">
          <h5>Nothing found</h5>
          <p>
            Every check ran against the prompt as it stands. Read the assembled preview anyway
            &mdash; the preflight cannot tell you whether a rule still means what you wrote.
          </p>
        </section>
      )}

      {TIERS.map((tier) => {
        const findings = Array.isArray(report[tier.key]) ? report[tier.key] : [];
        if (findings.length === 0) return null;
        // Blocking and silent carry their evidence and fix on the face of the
        // panel. Advisory does not: it is the only tier allowed to be small.
        const expanded = tier.key !== 'advisory';
        return (
          <section
            key={tier.key}
            className={`ppf-tier ${tier.className}`}
            data-testid={`ppf-tier-${tier.key}`}
          >
            <h5>
              <Icon name={tier.icon} weight="fill" size={16} color="currentColor" />{' '}
              {tier.heading}{' '}
              <span className="ppf-count">
                {findings.length}
              </span>
            </h5>
            <p className="ppf-lede">{tier.lede}</p>
            <ul className="ppf-findings">
              {findings.map((finding, i) => (
                <Finding key={finding.code || i} finding={finding} expanded={expanded} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
