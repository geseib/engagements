import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';
import './ModerationPanel.css';

/**
 * MODERATION — docs/design/tenancy-redesign/11-moderation.html.
 *
 * The queue is the pointer partition (spec §3.2): a row per set the check
 * would not decide on its own, oldest first. Review opens the snapshot in a
 * full-height Modal with the uncertain questions first — the reviewer's job is
 * the handful the check could not decide, not a re-read of the set — and the
 * two decisions of Stage 2, Approve and Reject. "Approve with a content notice"
 * arrives with the notice vocabulary (Stage 4, spec §7); dismiss / take down /
 * keep-with-a-notice arrive with reports (Stage 3, spec §6.2).
 *
 * A row a staff RE-CHECK raised is the one exception, and it is not reviewed
 * here at all: the library already serves that exact version, so its answers are
 * its score card (which can take it down) and "Leave it serving", which clears
 * the row and changes nothing else.
 *
 * Two reviewers cannot both decide: the server's transition is conditional,
 * and a lost race reads "Already decided by <name>" here and refreshes.
 */
const BAND_WORD = { HIGH: 'flagged', MEDIUM: 'uncertain', LOW: 'low', NONE: '' };
const bandWord = (band) => BAND_WORD[String(band || '').toUpperCase()] || String(band || '').toLowerCase();
const skUrl = (sk) => adminApiUrl(`admin/moderation/${encodeURIComponent(sk)}`);

/*
  RULING R21 — A 409 IS NOT ALWAYS SOMEBODY ELSE'S DECISION.

  The server answers 409 in two quite different situations and the dialog used
  to render both as the same dead end: "Already decided by <name>", both
  buttons gone, nothing to do but Close.

  One of them is a real race, and a dead end is the right answer. The other is
  Ruling R9's RESUME: a decision that moved the REVIEW row and then crashed
  before it finished, which the server will happily complete if the SAME
  decision is sent again — and `body.status` says which one it wants. Hiding
  the button that would finish it left the only route back through a refresh
  and a second click on a row that no longer looked like it needed one.

  So a 409 carrying `passed` or `flagged` keeps exactly the matching button,
  and says what it will do. A 409 with any other status stays the dead end it
  was.
*/
/*
  THE FIVE FIELDS A `'(set)'` FINDING CAN BE ABOUT.

  `shared/publishable.js` SET_FIELDS, in reading order, with the words a person
  uses for them rather than the row's own keys. The check judges exactly these
  five and `moderation-get.js` projects exactly these five, so a set-level
  finding always names something in this list — and until now the dialog showed
  the verdict on them and none of the text. The name and the description at
  least appear in the heading and the sub-line; the other three were nowhere on
  the screen at all, which left a reviewer deciding about prose they could not
  read.
*/
const SET_PROSE = [
  ['name', 'Name'],
  ['description', 'Description'],
  ['customInstruction', 'Custom instruction'],
  ['aiContextInstruction', 'AI context'],
  ['roundKindBrief', 'Round brief'],
];

const RESUME = {
  passed: { decision: 'approve', past: 'Approved', button: 'Approve' },
  flagged: { decision: 'reject', past: 'Rejected', button: 'Reject' },
};
const resumeSentence = (status, reviewer) => {
  const words = RESUME[status];
  return `${words.past}${reviewer ? ` by ${reviewer}` : ''}, but that decision did not finish — ${words.button} again to complete it.`;
};

function ReviewDialog({ sk, onClose, onDecided }) {
  const [state, setState] = useState('loading');   // loading | ready | error
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);      // the 409/404 sentence
  const [resume, setResume] = useState(null);        // 'approve' | 'reject' — R21
  /*
    requestClose is the DELIBERATE exit — the X and the bottom Close both call
    it, gated only on `busy` (a decision in flight can't be interrupted by a
    stray click; see decide()'s finally, which always clears it). A deliberate
    click discards an unsaved note on purpose, same as clicking Reject/Approve
    would have.

    Escape and a backdrop click are the ACCIDENTAL exits, below on the Modal —
    gated on `busy` AND on an unsaved note (`!note.trim()`), so a note the
    reviewer is mid-typing survives a stray Escape press or an off-card click.
    This is the design contract's "gated on unsaved work, not disabled".
  */
  const requestClose = () => { if (!busy) onClose(); };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch(skUrl(sk));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that entry (${res.status}).`); setState('error'); return; }
        setItem(body); setState('ready');
      } catch (e) { if (live) { setError(`Could not open that entry: ${e.message}`); setState('error'); } }
    })();
    return () => { live = false; };
  }, [sk]);

  const decide = async (decision) => {
    setBusy(true); setVerdict(null); setResume(null); setError(null);
    try {
      const res = await authFetch(adminApiUrl('admin/moderation/decide'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk, decision, note: note.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      /*
        R21: a 404 here means the QUEUE ROW is gone — the loser of a real race
        between two reviewers, since the winner's decision deletes it last.
        That is the same outcome as a 409 and was being rendered as a generic
        "The decision was not recorded (404)" beside two still-live buttons
        that could only ever produce the same 404 again. It is a verdict, and
        the list behind the dialog refreshes so the row goes.
      */
      if (res.status === 404) {
        setVerdict(body.error || 'Already decided — the item is no longer waiting.');
        onDecided({ refreshOnly: true });
        return;
      }
      if (res.status === 409) {
        // R21: `passed`/`flagged` is a crashed decision waiting to be resumed,
        // not a race that has been lost — keep the button that finishes it.
        const resumable = RESUME[body.status] ? body.status : null;
        setVerdict(resumable ? resumeSentence(resumable, body.reviewer) : (body.error || 'Already decided.'));
        setResume(resumable ? RESUME[resumable].decision : null);
        onDecided({ refreshOnly: true });
        return;
      }
      if (!res.ok) { setError(body.error || `The decision was not recorded (${res.status}).`); return; }
      onDecided(body);
    } catch (e) {
      setError(`The decision was not recorded: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const title = (item && item.snapshot && item.snapshot.meta.name) || (item && item.pointer && item.pointer.title) || 'Review';
  const questions = (item && item.snapshot && item.snapshot.questions) || [];
  const uncertain = questions.filter((q) => q.findings.length).length;
  return (
    <Modal overlayClassName="modq modq-scrim" contentClassName="modq-card modq-card--tall" labelledBy="modq-title" onClose={requestClose} closeOnBackdrop={() => !busy && !note.trim()} closeOnEscape={() => !busy && !note.trim()}>
      <header className="modq-head">
        <h2 id="modq-title">{title}</h2>
        {/* aria-label reads "Close review" rather than the bare "Close" the rest
            of the app's X buttons use: the footer exit below is also literally
            labelled "Close" (Stage 2's copy, not "Cancel"), and two buttons in
            one dialog sharing one accessible name is not two exits — it is one
            exit a screen reader or getByRole('button', { name }) cannot pick
            between. See task-9-report.md for how this was found. */}
        <button type="button" className="modq-x" onClick={requestClose} aria-label="Close review" title="Close review" disabled={busy}>×</button>
      </header>
      <div className="modq-body">
        {state === 'loading' && <p className="modq-fine">Opening…</p>}
        {state === 'error' && <StatusMessage message={error} tone="error" className="modq-alert" />}
        {state === 'ready' && item && (
          <>
            <p className="modq-dlg-sub">
              {item.pointer.orgName} · {gameTypeLabel(item.snapshot ? item.snapshot.meta.engagementType : item.pointer.gameType)} · {questions.length || item.pointer.questionCount || 0} questions · v{item.pointer.version} · {whyLabel(item.pointer)}
            </p>
            {!item.snapshot && (
              <StatusMessage message="The snapshot is gone, so there is nothing to approve — ask the organisation to submit it again. Reject still records a note." tone="error" className="modq-alert" />
            )}
            {item.setFindings.length > 0 && (
              <p className="modq-note"><strong>The set's own text:</strong> {item.setFindings.map((f) => `${bandWord(f.band)} for ${String(f.category || '').toLowerCase()}`).join('; ')}.</p>
            )}
            {/*
              The text that verdict is ABOUT. Only beside a set-level finding —
              a set the check had nothing to say about does not need its own
              prose recited back — and only when there is a snapshot, which is
              the thing that was judged; without one the banner above already
              says there is nothing to approve. Empty fields are skipped rather
              than printed blank, so the one that matters is not buried in four
              empty rows. Values WRAP rather than truncate: unlike the queue
              row's cells these are the reviewer's actual evidence, and a `title`
              is a hover, which is not evidence on a tablet.
            */}
            {item.setFindings.length > 0 && item.snapshot && (
              <dl className="modq-prose">
                {SET_PROSE.filter(([field]) => item.snapshot.meta[field]).map(([field, label]) => (
                  <React.Fragment key={field}>
                    <dt>{label}</dt>
                    <dd>{item.snapshot.meta[field]}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            <h3 className="modq-h">{uncertain ? `${uncertain} question${uncertain === 1 ? '' : 's'} the check could not decide` : 'Every question'}</h3>
            <ul className="modq-list">
              {questions.map((q) => (
                <li key={q.questionId} className={`modq-q${q.findings.length ? ' modq-q--uncertain' : ''}`} data-testid="modq-question">
                  <div className="modq-q-head">
                    <strong>{q.title || q.questionId}</strong>
                    <span className="modq-chip">{q.category}</span>
                    {/*
                      The chip's visible text is the raw band (high/medium/low),
                      not bandWord()'s translation — a reviewer deciding
                      Approve/Reject needs the actual severity the check
                      assigned, not "uncertain" for every non-clear band. The
                      CSS colour is still driven by bandWord() below: only
                      .modq-chip--flagged and .modq-chip--uncertain are styled
                      (a LOW band falls through to the base chip style, which
                      is intentional — low findings are context, not a flag).
                    */}
                    {q.findings.map((f, i) => (
                      <span key={i} className={`modq-chip modq-chip--${bandWord(f.band) || 'none'}`}>{String(f.band || '').toLowerCase()} · {String(f.category || '').toLowerCase()}</span>
                    ))}
                  </div>
                  <p className="modq-q-text">{q.text}</p>
                  {q.findings.map((f, i) => f.explanation && <p key={`e${i}`} className="modq-why">{f.explanation}</p>)}
                </li>
              ))}
            </ul>
            <label className="modq-label" htmlFor="modq-note">Note to the organisation (they read it on reject)</label>
            <textarea id="modq-note" className="modq-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {verdict && <p className="modq-note" role="status">{verdict}</p>}
            {error && <StatusMessage message={error} tone="error" className="modq-alert" />}
          </>
        )}
      </div>
      <footer className="modq-foot">
        <button type="button" className="modq-btn" onClick={requestClose} disabled={busy}>Close</button>
        {/*
          R21: undecided → both. A resumable 409 → ONLY the one the server is
          waiting for; offering the other would send a decision it refuses as
          somebody else's call and put a second dead end on top of the first.
          Any other verdict → neither, which is the dead end that is correct.
        */}
        {state === 'ready' && (!verdict || resume === 'reject') && (
          <button type="button" className="modq-btn modq-btn--danger" onClick={() => decide('reject')} disabled={busy}>Reject</button>
        )}
        {/* Stage 4: "Approve with a content notice" opens the picker inline here. */}
        {state === 'ready' && (!verdict || resume === 'approve') && (
          <button type="button" className="modq-btn modq-btn--primary" onClick={() => decide('approve')} disabled={busy || !item || !item.snapshot}>Approve</button>
        )}
      </footer>
    </Modal>
  );
}

/**
 * `onQueueChanged(count)` — the nav badge's only honest source.
 *
 * AdminPage fetches the count ONCE, when staff switch into platform mode, so
 * the badge could sit on "3" through an entire afternoon of deciding: every
 * decision here reloads this list and nothing told the nav. Called after every
 * successful load, including the first, so the badge agrees with the table
 * beside it rather than with whatever was true when the section opened.
 * Optional, like every other callback into this panel.
 */
export default function ModerationPanel({ onOpenScoreCard, onQueueChanged }) {
  const [queue, setQueue] = useState({ items: [], count: 0, oldestWaitingSince: null });
  const [state, setState] = useState('loading');   // loading | ready | outage
  const [outage, setOutage] = useState('');
  const [open, setOpen] = useState(null);           // the sk under review
  const [leaving, setLeaving] = useState('');       // the sk being left serving
  const [rowError, setRowError] = useState('');     // one row's action failed; the list is still good
  const now = Date.now();
  /*
    Held in a ref, not read straight out of the closure, so `load` keeps an
    empty dependency list. A caller that passes an inline arrow would otherwise
    hand this component a new `onQueueChanged` on every render — a new `load`,
    a re-fired effect, a setState, another render: a fetch loop that only shows
    up at the one call site nobody wrote the test for.
  */
  const queueChanged = useRef(onQueueChanged);
  useEffect(() => { queueChanged.current = onQueueChanged; }, [onQueueChanged]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(adminApiUrl('admin/moderation'));
      const body = await res.json().catch(() => ({}));
      /*
        Always framed as "Could not read the queue" — never the server's raw
        error verbatim. The decide endpoint's failures (below, and in
        ReviewDialog) DO show body.error verbatim, because interfaces §Copy
        says so explicitly for the 409 case ("a 409 renders its error") and
        that text is already about a specific set's decision. A queue-load
        failure has no such framing of its own — passing an unrelated
        `{ error: 'boom' }` straight through would say something true but
        useless ("boom") instead of naming what actually failed. So the detail
        is appended to the fixed lede rather than replacing it.
      */
      if (!res.ok) { setOutage(body.error ? `Could not read the queue: ${body.error}` : `Could not read the queue (${res.status}).`); setState('outage'); return; }
      const count = body.count || 0;
      setQueue({ items: body.items || [], count, oldestWaitingSince: body.oldestWaitingSince || null });
      setState('ready');
      // Only on a SUCCESSFUL read: an outage means the count is unknown, and
      // reporting 0 there would clear the badge on a failure to look.
      if (queueChanged.current) queueChanged.current(count);
    } catch (e) { setOutage(`Could not read the queue: ${e.message}`); setState('outage'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /*
    "LEAVE IT SERVING" — the answer to a row a staff re-check raised, from the
    worklist rather than from the score card.

    Such a row is not a publish request: the library is already serving that
    exact version, so Review is not offered on it and the decide route refuses
    both its decisions. Its answers are Take down, on the score card, and this —
    which deletes the queue entry and changes nothing else. Without it the only
    way to clear the row was to take down content a person had already approved,
    so the row (and the nav badge it feeds) aged for ever.

    No dialog: nothing is destroyed and a later re-check raises the row again. A
    failure is reported on its own line and NOT through `outage`, which switches
    the table off — the list is still perfectly good, and hiding it would take
    away every other row over one row's refusal. The list is reloaded either way:
    a 404 here means somebody else has already answered it.
  */
  const leaveServing = async (sk) => {
    setLeaving(sk); setRowError('');
    try {
      const res = await authFetch(adminApiUrl('admin/moderation/decide'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk, decision: 'leave' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setRowError(body.error ? `It could not be cleared from the queue: ${body.error}` : `It could not be cleared from the queue (${res.status}).`);
    } catch (e) {
      setRowError(`It could not be cleared from the queue: ${e.message}`);
    } finally {
      setLeaving('');
      await load();
    }
  };

  return (
    <section className="modq" data-theme="dark">
      <div className="modq-lede">
        {state === 'ready' && queue.count > 0 && <p className="modq-headline">{queueHeadline(queue.count, queue.oldestWaitingSince, now)}</p>}
        <p className="modq-fine">The check escalates rather than guessing. These are the ones it flagged as uncertain, not the ones it rejected.</p>
      </div>
      {state === 'outage' && <div className="modq-outage" role="alert"><Icon name="WarningCircle" weight="fill" size={16} color="var(--danger-text)" /> {outage}</div>}
      {rowError && <div className="modq-outage" role="alert" data-testid="modq-rowerror"><Icon name="WarningCircle" weight="fill" size={16} color="var(--danger-text)" /> {rowError}</div>}
      {state === 'ready' && queue.count === 0 && <p className="modq-empty">Nothing is waiting — the check decided everything on its own.</p>}
      {state === 'ready' && queue.count > 0 && (
        <table className="modq-tbl">
          <thead>
            <tr><th className="modq-col-set">Set</th><th className="modq-col-org">Organisation</th><th className="modq-col-why">Why it escalated</th><th className="modq-col-wait">Waiting</th><th className="modq-col-act" /></tr>
          </thead>
          <tbody>
            {queue.items.map((item) => {
              // Every truncating cell (.modq-nm, .modq-why-cell, and this
              // sub-line) carries its full text as `title` — the row is the
              // one place in the console where three separate strings on one
              // line can all be clipped by table-layout: fixed at once.
              const subLine = `${gameTypeLabel(item.gameType)} · ${item.questionCount || 0} questions · v${item.version}`;
              /*
                ONE OF ENGAGE'S OWN SETS. Its row is keyed `PLATFORM#<setId>`
                and carries `recheck: false` and no `publicSetId`, so without
                this branch it fell through to Review — whose Approve and
                Reject the decide route refuses outright, while `leave`, the
                one decision it accepts for this shape, was never drawn. The
                row could then be cleared by nobody and aged for ever, here and
                in the nav badge.
              */
              const house = item.scope === 'platform';
              return (
                <tr key={item.sk} className="modq-row">
                  <td>
                    <span className="modq-nm" title={item.title}>{item.title || item.setId}</span>
                    <span className="modq-sub" title={subLine}>{subLine}</span>
                  </td>
                  {/*
                    WHOSE SET IT IS. A PLATFORM row has no organisation at all —
                    `moderation-list.js` sends `scope` precisely because a blank
                    orgId cannot tell that apart from a listing's row, whose
                    organisation is behind the public entry — so naming Engage
                    is the honest cell. Everything else keeps the name, or the
                    id when the org row could not be read.
                  */}
                  <td>
                    <span className="modq-nm" data-testid="modq-org" title={house ? "Engage's own shared library" : item.orgName}>
                      {house ? 'Engage' : (item.orgName || item.orgId)}
                    </span>
                  </td>
                  <td><span className="modq-why-cell" title={whyLabel(item)}>{whyLabel(item)}</span></td>
                  <td className="modq-wait">{waitedLabel(item.waitingSince, now)}</td>
                  <td>
                    {/*
                      A ROW A RE-CHECK RAISED IS NOT DECIDED HERE. The library is
                      already serving that exact version, so Approve would
                      publish it a second time and Reject would stamp its author
                      for a check nobody told them about — the decide route
                      refuses both (lambda-functions/admin/moderation-decide.js).
                      A button whose only outcome is a refusal is not an action,
                      so the row offers the two that are: its score card, which
                      shows what held it and can take it down, and — here, because
                      it is the whole answer for most of them — leaving it
                      serving, which clears the row and changes nothing else.
                    */}
                    <div className="modq-rowact">
                      {onOpenScoreCard && item.publicSetId && (
                        <button type="button" className={`modq-btn modq-btn--sm${item.recheck ? ' modq-btn--primary' : ''}`} onClick={() => onOpenScoreCard(item.publicSetId)}>Score card</button>
                      )}
                      {item.recheck || house ? (
                        <button type="button" className="modq-btn modq-btn--sm" onClick={() => leaveServing(item.sk)} disabled={leaving === item.sk}>
                          {leaving === item.sk ? 'Leaving it…' : 'Leave it serving'}
                        </button>
                      ) : (
                        <button type="button" className="modq-btn modq-btn--sm modq-btn--primary" onClick={() => setOpen(item.sk)}>Review</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && (
        <ReviewDialog sk={open} onClose={() => setOpen(null)} onDecided={(r) => { if (!(r && r.refreshOnly)) setOpen(null); load(); }} />
      )}
    </section>
  );
}
