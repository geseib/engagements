import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { versionChip, STALE_CHECK_MS } from '../utils/shareState';
import './ScoreCard.css';

/**
 * THE SCORE CARD — spec §10.5. A PLACE in the platform console, the way the
 * set editor is a place in the org console: it holds a timeline and a table,
 * so it is not a modal. Reached from the staff Public library and from a
 * queue row that carries a publicSetId. Reports (Stage 3) and the notice
 * editor (Stage 4) join the seams marked below.
 *
 * ── WHAT THE CHECK MEASURED (2026-09-19) ──────────────────────────────────
 *
 * The owner: the card "doesn't reveal much". A trivia set about serial killers
 * read "Checked — passed" and "The check found nothing to say." Behind that the
 * check was measuring almost nothing it kept: the guardrail answered only for
 * what it INTERVENED on, and the card printed raw ids and a raw status.
 *
 * The review now carries `tally` (per category, counted in questions) and
 * `observed` (every band the check saw, intervened or not), each observation
 * named by its question's TEXT from the published public copy
 * (admin/public-library-item.js). So the latest check reads one of four ways:
 *
 *   measured     `tally.scope === 'full'`: a summary line from the numbers,
 *                all five categories with "none" written out, and one table
 *                of everything seen, worst first, saying which rows held it
 *   pre-tally    checked before measuring existed (decision C): it says so,
 *                and shows what it has — the verdict and the check's note.
 *                No re-check, no backfill.
 *   running      a re-check in flight, or one that never finished
 *   unchecked    no review row at all, which is not a verdict to print
 *
 * GATING IS NOT THIS CARD'S (decision B): a row that was seen and let through
 * is a near-miss, and nothing here calls it flagged or uncertain. `findings`
 * still carries only what held the set; every finding is also an
 * observation, so the table reads `observed` alone.
 */
const SET_SUBJECT = '(set)';
const BAND_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const bandOf = (row) => String((row && row.band) || '').toUpperCase();
// A band is a confidence — high, medium, low — never a verdict word: most rows
// on a public card were seen at a band and let through.
const bandWord = (b) => String(b || '').toLowerCase();
/*
  The five categories a set is judged on (content-guardrail.js SET_CATEGORIES),
  in the words the explanations use (finding-explanations.js CATEGORY_WORDS),
  so a row, its "why" and the category block all say the same thing.
*/
const CATEGORIES = [
  ['VIOLENCE', 'violence or injury'],
  ['SEXUAL', 'sexual content'],
  ['HATE', 'hateful content'],
  ['INSULTS', 'insulting or harassing language'],
  ['MISCONDUCT', 'dangerous or criminal instructions'],
];
const CATEGORY_WORDS = Object.fromEntries(CATEGORIES);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ');
const categoryWords = (c) => CATEGORY_WORDS[String(c || '').toUpperCase()] || humanise(String(c || '').toLowerCase());
const capitalised = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const itemUrl = (id) => adminApiUrl(`admin/public-library/${encodeURIComponent(id)}`);

/*
  A review status in the app's own words (utils/shareState.js), never the raw
  enum: `passed` is "checked" there, `flagged` "needs changes", `escalated`
  and `appealed` "waiting for Engage". A `checking` older than STALE_CHECK_MS
  did not finish — "checking…" for it would be a state that lies. Anything
  else (unreviewed, or a status this card has never heard of) is not a
  verdict, and gets none rather than the version chip's "not shared".
*/
const STATUSES = ['passed', 'flagged', 'escalated', 'appealed', 'checking'];
function statusChip(status, checkedAt, nowMs = Date.now()) {
  if (!STATUSES.includes(status)) return null;
  const unfinished = status === 'checking' && Boolean(checkedAt) && nowMs - Date.parse(checkedAt) > STALE_CHECK_MS;
  return versionChip({ review: status, unfinished });
}

/** Did this row hold the set? Only an intervention can (finding-explanations.js `held`). */
const held = (row) => row.intervened !== false;
/** …and only at HIGH, which flags it, or MEDIUM, which sends it to a person. A LOW never held a set. */
function heldWords(row) {
  if (!held(row)) return 'no';
  if (bandOf(row) === 'HIGH') return 'flagged';
  if (bandOf(row) === 'MEDIUM') return 'sent to a person';
  return 'no';
}
/** Worst band first; within a band, what held before what was let through (finding-explanations.js `rank`). */
const rank = (row) => (BAND_RANK[bandOf(row)] ?? 3) * 2 + (held(row) ? 0 : 1);
/**
 * The "why" where there is no explanation — the set's own subject never has
 * one, nor does a check whose budget ran out. The words are
 * finding-explanations.js `bandSentence`'s, so a sentence the card writes and
 * one the check stored read the same; only the subject changes for the set.
 */
function bandSentence(row) {
  const what = CATEGORY_WORDS[String(row.category || '').toUpperCase()] || 'this category';
  const band = bandOf(row);
  const isSet = row.questionId === SET_SUBJECT;
  if (held(row) && band === 'HIGH') return `The check was confident ${isSet ? "the set's own text" : 'this question'} contains ${what}.`;
  if (held(row) && band === 'MEDIUM') return `The check was unsure (medium confidence) whether ${isSet ? "the set's own text" : 'this question'} contains ${what}, so a person will look.`;
  return `The check noted ${what} at ${band.toLowerCase() || 'low'} confidence and let ${isSet ? "the set's own text" : 'the question'} through.`;
}
/**
 * A row's subject in words. A question is named by its text — title, then
 * detail, on one run the stylesheet clamps at two lines — with the full string
 * on title= (a truncation with no recovery is a deletion); the set's own
 * subject by what it is; an id the public copy does not hold by saying so,
 * with the id kept on title= as the only handle there is.
 */
function subjectOf(row) {
  const text = String(row.text || '').trim();
  if (row.questionId === SET_SUBJECT) return { label: "The set's own text", title: text || "The set's own text", missing: false };
  if (!text) return { label: 'Not in the public copy', title: `The public copy has no question ${row.questionId}.`, missing: true };
  return { label: text.split(/\s*\n\s*/).filter(Boolean).join(' — '), title: text, missing: false };
}
/** "2 at medium · 1 at low" — distinct questions per band, worst first, zeros left out. */
const countsWords = (c) => ['HIGH', 'MEDIUM', 'LOW']
  .map((b) => [b, Number(c[b.toLowerCase()]) || 0])
  .filter(([, n]) => n > 0)
  .map(([b, n]) => `${n} at ${bandWord(b)}`)
  .join(' · ');

/**
 * The tally's one line. "Every question clean" is `spotless === questions`,
 * never "no observations": a question the guardrail could not read has none
 * either, and is not clean — it is `unread`. A check stopped by its budget
 * checked fewer questions than the set holds, and says "of".
 */
function summaryLine(tally, questionCount, setClean) {
  const n = Number(tally.questions) || 0;
  const spotless = Number(tally.spotless) || 0;
  const unread = Number(tally.unread) || 0;
  const total = Number(questionCount) || 0;
  const of = total > n ? ` of ${total}` : '';
  const parts = [`${n}${of} ${n === 1 && !of ? 'question' : 'questions'}${tally.setTextChecked ? " and the set's own text" : ''} checked`];
  if (n > 0 && spotless === n) {
    // "all" is every question AND the set's own text, which the first clause
    // has just named; with only the questions clean, it says only that.
    if (of) parts.push(`all ${n} clean in every category`);
    else parts.push(setClean ? 'all clean in every category' : 'every question clean in every category');
  } else {
    parts.push(`${spotless} with nothing in any category`);
  }
  if (unread) parts.push(`${unread} could not be read`);
  if (!tally.setTextChecked) parts.push("the set's own text was not reached");
  return parts.join(' · ');
}

const EVENT_WORDS = {
  // A pass IS "checked" in the app's words, so it adds nothing to the event's
  // name; any other outcome is said after it.
  checked: (e) => {
    const chip = statusChip(e.outcome);
    return chip && chip.key !== 'passed' ? `Checked — ${chip.label}` : 'Checked';
  },
  escalated: () => 'Sent to a person',
  appealed: (e) => `Appealed${e.appealMessage ? `: “${e.appealMessage}”` : ''}`,
  decided: (e) => `${e.decision === 'approve' ? 'Approved' : 'Rejected'}${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  published: (e) => `Published${e.publicVersion ? ` as public v${e.publicVersion}` : ''}`,
  unpublished: () => 'Unpublished by the organisation',
  'taken-down': (e) => `Taken down${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  reported: (e) => `Reported${e.type ? ` — ${e.type}` : ''}`,
  'notice-set': () => 'Content notice set',
  'notice-cleared': () => 'Content notice cleared',
  access: (e) => `Opened by ${(e.who && e.who.name) || 'Engage'}`,
};
const eventWords = (e) => (EVENT_WORDS[e.event] ? EVENT_WORDS[e.event](e) : e.event);

function TakedownDialog({ name, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /*
    requestClose is the DELIBERATE exit — the X and the bottom Cancel both call
    it, gated only on `busy` (a request in flight can't be interrupted by a
    stray click). A deliberate click discards an unsaved note on purpose, same
    as clicking Take down itself would eventually do.

    Escape and a backdrop click are the ACCIDENTAL exits, on the Modal below —
    gated on `busy` AND on an unsaved note (`!note.trim()`), so a note the
    reviewer is mid-typing survives a stray Escape press or an off-card click.
    This is the design contract's "gated on unsaved work, not disabled" (R16).
  */
  const requestClose = () => { if (!busy) onClose(); };

  // onConfirm (ScoreCard's takeDown) resolves on a successful DELETE — the
  // parent then closes this dialog itself, so there is nothing left to do
  // here — and rejects on failure, so the note and the dialog both survive a
  // failed attempt and the confirm button stays live for a retry.
  // `busy` clears in `finally`, not only in `catch`. On the success path the
  // parent unmounts this dialog so the clear is usually a no-op — but
  // "usually" made this dialog's correctness depend on what its parent does
  // next: an `onConfirm` that resolves WITHOUT closing would leave the confirm
  // button disabled for ever with no way back. React 18 treats a state update
  // on an unmounted component as a no-op, so the ordinary path costs nothing.
  const handleConfirm = async () => {
    setBusy(true); setError(null);
    try {
      await onConfirm(note.trim());
    } catch (e) {
      setError(e.message || 'Could not take it down.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal overlayClassName="scard scard-scrim" contentClassName="scard-dialog" labelledBy="scard-td-title" onClose={requestClose} closeOnBackdrop={() => !busy && !note.trim()} closeOnEscape={() => !busy && !note.trim()}>
      <header className="scard-head">
        <h2 id="scard-td-title">Take down “{name}”?</h2>
        <button type="button" className="scard-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="scard-body">
        <p>It is gone for everyone. The organisation keeps their copy and sees your note — their editor shows it where the check's own findings would.</p>
        <label className="scard-label" htmlFor="scard-td-note">Note to the organisation (required)</label>
        <textarea id="scard-td-note" className="scard-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <div className="scard-outage" role="alert">{error}</div>}
      </div>
      <footer className="scard-foot">
        <button type="button" className="scard-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="scard-btn scard-btn--danger" onClick={handleConfirm} disabled={busy || !note.trim()}>Take down</button>
      </footer>
    </Modal>
  );
}

export default function ScoreCard({ publicSetId, onBack, onTakenDown }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    setCard(null); setError(null);
    (async () => {
      try {
        const res = await authFetch(itemUrl(publicSetId));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that set (${res.status}).`); return; }
        setCard(body);
      } catch (e) { if (live) setError(`Could not open that set: ${e.message}`); }
    })();
    return () => { live = false; };
  }, [publicSetId]);

  // Resolves on success (after closing the dialog itself); THROWS on failure
  // rather than touching page-level `error` — a failed takedown is the
  // dialog's problem to show, beside the note, with the confirm live for a
  // retry, not a reason to unmount the dialog and lose what was typed (R17).
  const takeDown = async (note) => {
    let res;
    try {
      res = await authFetch(itemUrl(publicSetId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
    } catch (e) {
      throw new Error(`Could not take it down: ${e.message}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Could not take it down (${res.status}).`);
    setAsking(false);
    if (onTakenDown) onTakenDown(publicSetId);
  };

  // Read once, here, rather than at each `card.review.*` site: the server is
  // documented to always send `review`, but a defensive `|| {}` costs nothing
  // and means a set that somehow arrives without one renders instead of
  // throwing during render.
  const review = card ? (card.review || {}) : {};
  const identity = card ? [
    `Public v${card.publicVersion || '—'}`,
    card.sourceOrgName ? `by ${card.sourceOrgName}` : '',
    review.reviewer ? `approved by ${review.reviewer}${review.decidedAt ? `, ${day(review.decidedAt)}` : ''}` : (card.publishedAt ? `published ${day(card.publishedAt)}` : ''),
    card.sensitivity && card.sensitivity.length ? `content notice: ${card.sensitivity.map(humanise).join(', ')}` : '',
    // Stage 3: `${reports} reports` joins here.
  ].filter(Boolean).join(' · ') : '';
  const timeline = card ? [...(card.log || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];
  const verdict = statusChip(review.status, review.checkedAt);
  const running = Boolean(verdict) && review.status === 'checking';
  // Only a tally the card understands is a measurement; one without the
  // marker was never measured (decision C), which is not "measured, clean".
  const tally = review.tally && review.tally.scope === 'full' ? review.tally : null;
  const observed = (Array.isArray(review.observed) ? review.observed : []).filter((o) => o && typeof o === 'object');
  // Stored in question order; the card puts the worst first, stably.
  const rows = observed.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map(({ o }) => o);
  const setClean = Boolean(tally && tally.setTextChecked) && !observed.some((o) => o.questionId === SET_SUBJECT);
  /*
    The note beside a pre-tally verdict is the CHECK's ("30/30 clean") — all
    such a check measured. Two notes are not it: a reviewer's, which the
    decision's own row in the timeline already quotes, and any note beside a
    tally, whose "N/N clean" counts what HELD the set, not what was seen, and
    would sit one line from the summary asking to be reconciled with it.
  */
  const checkNote = !tally && !review.reviewer ? String(review.note || '').trim() : '';

  return (
    <section className="scard" data-theme="dark">
      <button type="button" className="scard-back" onClick={onBack}>← Public library</button>
      {error && <div className="scard-outage" role="alert">{error}</div>}
      {card && (
        <>
          <header className="scard-title">
            <h2>{card.name || card.publicSetId}</h2>
            <p className="scard-fine">{gameTypeLabel(card.engagementType)} · {card.questionCount || 0} questions{card.description ? ` · ${card.description}` : ''}</p>
            <p className="scard-identity" data-testid="scard-identity">{identity}</p>
          </header>
          <div className="scard-acts">
            <button type="button" className="scard-btn scard-btn--danger" onClick={() => setAsking(true)}>Take down</button>
            {/* Stage 4: the content-notice editor sits beside Take down. */}
          </div>
          <h3 className="scard-h">Timeline</h3>
          <ol className="scard-timeline">
            {timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} className="scard-event" data-testid="scard-event">
                <span className="scard-when">{when(e.at)}</span>
                <span className="scard-what">{eventWords(e)}{e.version ? ` · v${e.version}` : ''}</span>
                {e.note && <span className="scard-note">“{e.note}”</span>}
              </li>
            ))}
            {!timeline.length && <li className="scard-fine">No events recorded.</li>}
          </ol>
          <h3 className="scard-h">The latest check{review.checkedAt ? ` · ${day(review.checkedAt)}` : ''}</h3>
          {verdict ? (
            <p className="scard-verdict" data-testid="scard-verdict">Verdict: {verdict.label}{checkNote ? ` · “${checkNote}”` : ''}</p>
          ) : <p className="scard-summary">No check is on record for the version this came from.</p>}
          {/* Not fine print: where a tally would stand, this is the answer to
              "why is there nothing else here?" */}
          {verdict && !running && !tally && (
            <p className="scard-summary">Checked before detailed scoring existed — this check recorded only its verdict.</p>
          )}
          {verdict && !running && tally && (
            <>
              <p className="scard-summary" data-testid="scard-summary">{summaryLine(tally, card.questionCount, setClean)}</p>
              <table className="scard-tbl">
                <thead><tr><th className="scard-col-cat">Category</th><th className="scard-col-worst">Worst</th><th className="scard-col-count">Questions</th></tr></thead>
                <tbody>
                  {CATEGORIES.map(([id, words]) => {
                    const seen = (tally.categories && tally.categories[id]) || {};
                    const worst = BAND_RANK[String(seen.worst || '').toUpperCase()] !== undefined ? String(seen.worst).toUpperCase() : null;
                    return (
                      <tr key={id} className="scard-cat" data-testid="scard-cat">
                        <td>{capitalised(words)}</td>
                        <td>{worst ? <span className={`scard-chip scard-chip--${bandWord(worst)}`}>{bandWord(worst)}</span> : <span className="scard-none">none</span>}</td>
                        <td className="scard-count">{worst ? countsWords(seen) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 0 && (
                <table className="scard-tbl">
                  <thead><tr><th className="scard-col-q">Question</th><th className="scard-col-b">Band</th><th className="scard-col-c">Category</th><th className="scard-col-w">Why</th><th className="scard-col-h">Held the set</th></tr></thead>
                  <tbody>
                    {rows.map((o, i) => {
                      const subject = subjectOf(o);
                      const band = bandOf(o);
                      const holds = heldWords(o);
                      return (
                        <tr key={`${o.questionId}|${o.category}|${i}`} className="scard-obs" data-testid="scard-obs">
                          <td><span className={subject.missing ? 'scard-q scard-q--missing' : 'scard-q'} title={subject.title}>{subject.label}</span></td>
                          <td>{BAND_RANK[band] !== undefined && <span className={`scard-chip scard-chip--${bandWord(band)}`}>{bandWord(band)}</span>}</td>
                          <td>{categoryWords(o.category)}</td>
                          <td className="scard-why">{o.explanation || bandSentence(o)}</td>
                          <td className={holds === 'no' ? 'scard-held' : 'scard-held scard-held--yes'}>{holds}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
          {/* Stage 3: reports by type, and each report's note (never the reporter). */}
        </>
      )}
      {asking && card && <TakedownDialog name={card.name || card.publicSetId} onClose={() => setAsking(false)} onConfirm={takeDown} />}
    </section>
  );
}
