import React from 'react';
import Icon from './Icon';
import { warningsMayBeIncomplete } from '../utils/generationJob';
import './GenerationJobPanel.css';

/**
 * The generation job, on screen — running, failed, or failed with partials.
 *
 * Drawn from docs/design/admin-redesign/09-ai-job-running.html and
 * 10-ai-job-failed.html, and from RATIONALE.md §6.2-6.5. What it replaces in
 * all four AI builders is a CSS spinner and one line of text, with the failure
 * branch reachable only when zero items came back.
 *
 * PURE PROPS. No useAuth, no authFetch, no fetch — so it renders in jsdom, which
 * AdminPage.jsx cannot (see docs/handoff/RESUME.md, Landmines). Its test
 * contains zero jest.mock calls.
 *
 * Four things this panel is careful about, each of them a fact about the
 * backend rather than a style choice:
 *
 *  1. THE BRANCH IS `outcome`, NEVER `items.length`. A failed job carries the
 *     work it managed — `failJob` writes items and status:'error' in one
 *     UpdateCommand — so "has items" and "succeeded" are different questions.
 *     See utils/generationJob.js.
 *
 *  2. THE PROGRESS IS GENUINELY INDETERMINATE. `updateJobProgress` fires once
 *     per completed model call (generation-handler.js:178-184) and one call
 *     fits 17-67 items, so a request at or below that produces exactly ONE
 *     update, at the end. The fraction is real and jumps; the sweep is there
 *     for liveness; the sentence says why. A smoothly filling bar would be
 *     inventing motion that does not exist.
 *
 *  3. THERE IS NO CANCEL BUTTON, and the panel says why. No cancel route exists
 *     in template-clean.yaml, and the worker never re-reads the job row between
 *     passes — it checks only getRemainingTimeInMillis() — so even a flag
 *     written by a new endpoint would be invisible to it. A Cancel button would
 *     stop you watching while the model calls and their cost continued.
 *
 *  4. THE WARNING LIST MAY BE SHORT. `failJob` does not write `warnings`, so a
 *     failed job shows only what the last successful progress write persisted.
 *     The copy says so rather than implying completeness.
 */
export default function GenerationJobPanel({
  job,
  noun = 'items',
  jobId = null,
  /**
   * Does THIS builder's worker create the question set itself?
   *
   * Default false, and the default is the honest one. The whole-set generators
   * (scenarios, trivia, polls) create an inactive draft set before the job goes
   * terminal, so "Close — this keeps running" now produces something to come
   * back to. The survey builder's worker creates nothing — survey is not a
   * playable type and upload-questions.js refuses it — so it must not be handed
   * this promise. A panel that says "and it makes the set for you" over a
   * builder that does not is the exact defect this whole change repairs, in a
   * new coat.
   */
  createsSet = false,
  // The client's own running commentary — POST retries, "reconnecting…" — which
  // is not on the wire and has no `phase` to carry it.
  statusLine = '',
  transportError = null,
  onKeepRunning,
  onReconnect,
  onReview,
  onRetryRemaining,
  onDiscard,
  onBackToConfig,
}) {
  // Lost contact / timed out. There is no job to read, and — unlike a 404 —
  // the worker is probably still going, so this must not say it stopped.
  if (transportError) {
    return (
      <section className="gjp gjp-lost">
        <h3 className="gjp-title">
          <Icon name="WarningOctagon" weight="fill" size={18} color="var(--gjp-danger)" />{' '}
          Lost contact with the job
        </h3>
        <p className="gjp-errmsg">{transportError}</p>
        <p className="gjp-note">
          This window stopped being able to read the job. That is not the same as the job
          stopping: it runs as a server-side worker with its own fifteen-minute budget and
          nothing here can reach it. Its id is kept in this browser, so reopening this builder
          picks it back up for as long as the job record lives — three days.
        </p>
        <div className="gjp-acts">
          {onReconnect && (
            <button type="button" className="btn-primary" onClick={onReconnect}>
              <Icon name="ArrowsClockwise" weight="bold" size={16} color="currentColor" /> Try to reconnect
            </button>
          )}
          {onBackToConfig && (
            <button type="button" className="btn-secondary" onClick={onBackToConfig}>
              <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to configuration
            </button>
          )}
        </div>
      </section>
    );
  }

  const {
    outcome, phase, items, completed, requested, warnings, error, shortfall,
    createdSet, setCreationError,
  } = job;

  if (outcome === 'running') {
    return (
      <section className="gjp gjp-running">
        <div className="gjp-head">
          <span className="gjp-bignum">
            {completed}
            {requested > 0 && <span className="gjp-of">&thinsp;/&thinsp;{requested}</span>}
          </span>
          <div className="gjp-headtext">
            <p className="gjp-phase">{phase || statusLine || 'Starting generation…'}</p>
            <p className="gjp-sub">
              {jobId && <>Job <span className="gjp-mono">{jobId}</span> &middot; </>}
              runs on the server
            </p>
          </div>
        </div>

        {/* The fill is the real fraction and it JUMPS. The sweep is the only
            part that moves continuously, and it deliberately carries no
            information — see the note underneath, which says exactly that. */}
        <div
          className="gjp-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={requested || undefined}
          aria-valuenow={requested ? completed : undefined}
          aria-label={`Generated ${completed}${requested ? ` of ${requested}` : ''}`}
        >
          <i className="gjp-fill" style={{ width: requested > 0 ? `${Math.min(100, Math.round((completed / requested) * 100))}%` : '0%' }} />
          <i className="gjp-sweep" aria-hidden="true" />
        </div>

        <p className="gjp-note">
          <b>Progress arrives one pass at a time, not one {singular(noun)} at a time.</b>{' '}
          The worker writes its count after each model call, so this jumps and then sits
          still. That is the shape of the work — a smoothly filling bar would be inventing
          motion that is not there.
        </p>

        {items.length > 0 && (
          <div className="gjp-landed">
            <h4 className="gjp-h4">{capitalize(noun)} written so far</h4>
            <ul className="gjp-landedlist">
              {items.slice(-5).reverse().map((item, i) => (
                <li key={`${items.length - i}`}>
                  <span className="gjp-n">{items.length - i}</span>
                  <span className="gjp-q">{titleOf(item)}</span>
                </li>
              ))}
              {items.length > 5 && (
                <li className="gjp-dim">
                  <span className="gjp-n">&middot;&middot;&middot;</span>
                  <span className="gjp-q">{items.length - 5} earlier</span>
                </li>
              )}
            </ul>
          </div>
        )}

        <h4 className="gjp-h4">If you leave</h4>
        <div className="gjp-acts">
          {onKeepRunning && (
            <button type="button" className="btn-primary" onClick={onKeepRunning}>
              Close &mdash; this keeps running
            </button>
          )}
        </div>
        <ul className="gjp-leave">
          <li>
            <Icon name="Check" weight="bold" size={16} color="var(--gjp-ok)" />
            <span>
              The job keeps running. It is a server-side worker; this window is only watching it.
            </span>
          </li>
          <li>
            <Icon name="Check" weight="bold" size={16} color="var(--gjp-ok)" />
            <span>
              The job id is kept in this browser, so a reload or a closed tab picks it back up.
              The job record stays readable for three days.
            </span>
          </li>
          {/* The promise this panel used to be unable to make. Rendered only
              when the builder's worker really does create the set — see the
              `createsSet` prop. */}
          {createsSet && (
            <li>
              <Icon name="Check" weight="bold" size={16} color="var(--gjp-ok)" />
              <span>
                <b>The set gets made without you.</b> When the last pass finishes the worker
                writes these {noun} into a new question set of its own &mdash; yours, marked as
                AI-written, and switched off until you review it. Leaving now still leaves you
                a draft.
              </span>
            </li>
          )}
          <li className="gjp-no">
            <Icon name="X" weight="bold" size={16} color="var(--gjp-danger)" />
            <span>
              <b>It cannot be stopped.</b> There is no cancel endpoint, and the worker never
              re-reads its own job record between passes, so a Cancel button would only stop
              you watching &mdash; the model calls and their cost would continue. This screen
              refuses to draw a button that does not do what it says.
            </span>
          </li>
        </ul>
      </section>
    );
  }

  const kept = items.length;

  return (
    <section className={`gjp gjp-${outcome}`}>
      <h3 className="gjp-title">
        <Icon name="Warning" weight="fill" size={18} color="var(--gjp-danger)" />{' '}
        {outcome === 'partial'
          ? `Generation stopped at ${kept}${requested > 0 ? ` of ${requested}` : ''}`
          : `Generation produced no ${noun}`}
      </h3>

      <p className="gjp-badbox">
        {outcome === 'partial' ? (
          <>
            {/* THE SET EXISTS OR IT DOES NOT, and the two say different things.
                A partial run still creates its draft — that is the whole point
                of moving creation to the worker, since a run that dies while
                nobody is watching is exactly the case a person left for. When
                no set was made (the survey builder, or a creation that failed)
                the original wording stands: there is no set. */}
            {createdSet ? (
              <>
                <b>This is a partial result, and it was saved anyway.</b> {kept}{' '}
                {kept === 1 ? singular(noun) : noun} {kept === 1 ? 'was' : 'were'} written into
                the draft set &ldquo;{createdSet.setName}&rdquo;
                {shortfall > 0 && <> &mdash; the remaining {shortfall} {shortfall === 1 ? 'was' : 'were'} never produced</>}.
                The draft is switched off until you review it, so a short set plays nowhere.
              </>
            ) : (
              <>
                <b>This is a partial result, not a finished set.</b> {kept}{' '}
                {kept === 1 ? singular(noun) : noun} {kept === 1 ? 'was' : 'were'} written and kept
                {shortfall > 0 && <> &mdash; the remaining {shortfall} {shortfall === 1 ? 'was' : 'were'} never produced</>}.
              </>
            )}
          </>
        ) : (
          <>
            <b>Nothing was produced.</b> The job reached the end without writing a single{' '}
            {singular(noun)}, so there is nothing to review or keep.
          </>
        )}
      </p>

      {/* The worker tried to make the set and could not. Said plainly, because
          the manual path below is the only way out of it and the operator has
          to know why they are being asked to take it. */}
      {setCreationError && !createdSet && (
        <p className="gjp-errmsg">
          The set could not be created for you: {setCreationError}
        </p>
      )}

      {error && (
        <>
          <p className="gjp-errmsg">{error}</p>
          <p className="gjp-fine">
            That string is the whole error the API returns &mdash; there is no code and no
            retryable flag, so this screen can offer a retry but cannot promise it will work.
          </p>
        </>
      )}

      <h4 className="gjp-h4">
        {warnings.length > 0 ? 'Warnings from the passes that did run' : 'Warnings'}
      </h4>
      {warnings.length > 0 ? (
        <ul className="gjp-warnlist">
          {warnings.map((warning, i) => (
            <li key={i}>
              <Icon name="Warning" weight="bold" size={16} color="var(--gjp-warn)" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gjp-fine">None were recorded.</p>
      )}
      {warningsMayBeIncomplete(job) && (
        <p className="gjp-fine">
          A failure does not record warnings of its own, so this list holds only what the
          passes that finished had already reported. If the run died in its first pass there
          are none, and that is not evidence that nothing went wrong.
        </p>
      )}

      <h4 className="gjp-h4">
        {outcome === 'partial'
          ? `What do you want to do with the ${kept}?`
          : 'What next?'}
      </h4>
      <div className="gjp-acts">
        {outcome === 'partial' && onReview && (
          <button type="button" className="btn-primary" onClick={onReview}>
            {/* "and make a set" is a promise about what the button does. When
                the worker already made one it is a false promise, and the
                honest label is the one that only claims to show you them. */}
            {createdSet ? `Review the ${kept} that were saved` : `Review the ${kept} and make a set`}
          </button>
        )}
        {onRetryRemaining && (
          <button
            type="button"
            className={outcome === 'partial' ? 'btn-secondary' : 'btn-primary'}
            onClick={() => onRetryRemaining(shortfall > 0 ? shortfall : requested)}
          >
            <Icon name="ArrowCounterClockwise" weight="bold" size={16} color="currentColor" />{' '}
            {shortfall > 0 ? `Try again for the remaining ${shortfall}` : 'Try again'}
          </button>
        )}
        {/* NO DISCARD ONCE THE SET EXISTS. "Discard all 41" would clear this
            screen and leave the draft sitting in the library — a button that
            does the opposite of what it says. Deleting the set is a thing you
            do to the set, from the library, where the confirmation dialog knows
            what it is deleting. The fine print below says so. */}
        {outcome === 'partial' && onDiscard && !createdSet && (
          <button type="button" className="btn-danger" onClick={onDiscard}>
            Discard all {kept}
          </button>
        )}
        {outcome !== 'partial' && onBackToConfig && (
          <button type="button" className="btn-secondary" onClick={onBackToConfig}>
            <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to configuration
          </button>
        )}
      </div>
      {outcome === 'partial' && shortfall > 0 && (
        <p className="gjp-fine">
          Trying again starts a <b>second job</b> with the same settings and a count of{' '}
          {shortfall}. It cannot resume this one &mdash; the job record is terminal, there is
          no resume, and pretending otherwise would produce duplicates.
          {createdSet && (
            <> A second job also needs a different title: the draft already holds this one,
              and a set is refused rather than overwritten when its name is taken.</>
          )}
        </p>
      )}
      {outcome === 'partial' && createdSet && (
        <p className="gjp-fine">
          Nothing on this screen can unmake the draft. If you do not want it, delete{' '}
          &ldquo;{createdSet.setName}&rdquo; from the question set list.
        </p>
      )}
    </section>
  );
}

/** "questions" → "question". Only ever used on the builders' own nouns. */
function singular(noun) {
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Generated items name themselves differently per builder. */
function titleOf(item) {
  if (!item || typeof item !== 'object') return String(item ?? '');
  return item.title || item.question || item.name || '(untitled)';
}
