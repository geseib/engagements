import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { pollGenerationJob } from '../utils/aiBatchClient';
import { interpretCheckJob } from '../utils/checkJob';
import { gameTypeLabel } from '../config/gameTypes';
import { versionChip, STALE_CHECK_MS } from '../utils/shareState';
import { whyLabel } from '../utils/moderationRow';
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
 * (admin/public-library-item.js). So the latest check reads one of five ways:
 *
 *   measured     `tally.scope === 'full'`: a summary line from the numbers,
 *                all five categories with "none" written out, and one table
 *                of everything seen, worst first, saying which rows held it
 *   pre-tally    checked before measuring existed (decision C): it says so,
 *                and shows what it has — the verdict, the check's note, and
 *                what held the set. An approval keeps the row
 *                (set-review.js transitionReview), so every escalation or
 *                appeal staff approved still carries the findings that held
 *                it, and they are listed by their text; the reviewer's note
 *                replaces the check's on the row, so that is read back from
 *                the check's own logged event. No re-check, no backfill.
 *   unfinished   a check that threw before it had measured: the worker keeps
 *                a tally only once measuring has finished, so this row has
 *                none either, and it says the check did not finish rather
 *                than dating it (`didNotFinish`)
 *   running      a re-check in flight, or one that died without writing
 *   unchecked    no review row at all, which is not a verdict to print
 *
 * Whichever it is, the check's reasons — why a person was needed — read one
 * line under the verdict, in the moderation queue's words
 * (utils/moderationRow.js whyLabel), never a second vocabulary.
 *
 * GATING IS NOT THIS CARD'S (decision B): a row that was seen and let through
 * is a near-miss, and nothing here calls it flagged or uncertain. `findings`
 * still carries only what held the set, and every finding is also an
 * observation, so a measured card's table reads `observed` alone; a card
 * checked before measuring reads `findings`, all that check kept.
 *
 * ── AND RUNNING IT AGAIN (2026-09-19) ─────────────────────────────────────
 *
 * Three of the four public sets on dev were checked before measuring existed,
 * so `pre-tally` is what their cards say and there is nothing to backfill from.
 * The only cure is to run the check again, which as Engage is a DIFFERENT
 * request from the organisation's own: `{ recheck: true }` publishes nothing,
 * moves no share stamp and keeps the human decision
 * (lambda-functions/admin/check-question-set.js recheckPublished). `mode`
 * decides whether the control is offered, and defaults to the organisation's
 * reading — a staff-only control must not appear because a caller said nothing.
 * `RecheckDialog` below is where those promises are written down.
 *
 * ── AND ANSWERING WHAT IT FOUND ───────────────────────────────────────────
 *
 * A re-check worse than the decision on record takes nothing down: it puts the
 * listing in the queue for a person, and this card is the only surface that can
 * answer that row — the review dialog's two buttons would publish it a second
 * time or tell its author off. So the card carries BOTH answers: Take down, and
 * "Leave it serving", which clears the queue entry and changes nothing else. The
 * server sends the row as `queued` so the card can say that anybody is waiting
 * at all; without it Take down was the only exit from a worklist row, on content
 * a person had already approved.
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
/**
 * Judged in one of the five? Anything else in `findings` is the check's own —
 * a subject the guardrail could not read, a check its budget stopped, a set
 * with nothing in it — and has no band to show (see `noTallyLine`).
 */
const JUDGED = new Set(CATEGORIES.map(([id]) => id));
const isJudged = (row) => JUDGED.has(String(row.category || '').toUpperCase());
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ');
const categoryWords = (c) => CATEGORY_WORDS[String(c || '').toUpperCase()] || humanise(String(c || '').toLowerCase());
const capitalised = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const itemUrl = (id) => adminApiUrl(`admin/public-library/${encodeURIComponent(id)}`);
/**
 * The check's own route, and NOT under `/admin`: the template mounts it at
 * `/question-sets/{setId}/check`, which is where ShareSetDialog already posts.
 * For a re-check the path segment is the PUBLIC set id — the route reads which
 * organisation, which set and which version off the public row, which is what
 * makes it unable to reach content the library is not already serving
 * (lambda-functions/admin/check-question-set.js recheckPublished).
 */
const checkUrl = (publicSetId) => adminApiUrl(`question-sets/${encodeURIComponent(publicSetId)}/check`);

/*
  A review status in the app's own words (utils/shareState.js), never the raw
  enum: `passed` is "checked" there, `flagged` "needs changes", `escalated`
  and `appealed` "waiting for Engage". A `checking` older than STALE_CHECK_MS
  did not finish — "checking…" for it would be a state that lies. Anything
  else (unreviewed, or a status this card has never heard of) is not a
  verdict, and gets none rather than the version chip's "not shared".
*/
const STATUSES = ['passed', 'flagged', 'escalated', 'appealed', 'checking'];
/**
 * A `checking` older than the stale window did not finish: the lock is free and
 * nothing is running (set-review.js `isUnfinished`, `beginCheck`'s condition).
 * One definition, because the chip and the re-check control have to agree — a
 * card that says "didn't finish" while refusing to run the check again leaves
 * the reader with a dead end.
 */
const unfinishedCheck = (review, nowMs = Date.now()) => review.status === 'checking'
  && Boolean(review.checkedAt)
  && nowMs - Date.parse(review.checkedAt) > STALE_CHECK_MS;
function statusChip(status, checkedAt, nowMs = Date.now()) {
  if (!STATUSES.includes(status)) return null;
  return versionChip({ review: status, unfinished: unfinishedCheck({ status, checkedAt }, nowMs) });
}

/** Did this row hold the set? Only an intervention can (finding-explanations.js `held`). */
const held = (row) => row.intervened !== false;
/**
 * …and only at HIGH, which flags it, or MEDIUM, which sends it to a person. A
 * LOW never held a set. A flag reads as the app says it (shareState.js), the
 * word the timeline and the verdict use for the same outcome, never the raw
 * status.
 */
function heldWords(row) {
  if (!held(row)) return 'no';
  if (bandOf(row) === 'HIGH') return statusChip('flagged').label;
  if (bandOf(row) === 'MEDIUM') return 'sent to a person';
  return 'no';
}
/** Worst band first; within a band, what held before what was let through (finding-explanations.js `rank`). */
const rank = (row) => (BAND_RANK[bandOf(row)] ?? 3) * 2 + (held(row) ? 0 : 1);
/** Stored in question order; the card puts the worst first, stably. */
const worstFirst = (list) => list.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map(({ o }) => o);
/** The worst of some bands, or null when none of them is HIGH, MEDIUM or LOW. */
const worstBand = (bands) => bands
  .map((b) => String(b || '').toUpperCase())
  .filter((b) => BAND_RANK[b] !== undefined)
  .sort((a, b) => BAND_RANK[a] - BAND_RANK[b])[0] || null;
const rowsOf = (list) => (Array.isArray(list) ? list : []).filter((o) => o && typeof o === 'object');
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
 * One row of the category block: the worst band ANYTHING was seen at in the
 * category, and where. The tally counts questions (content-guardrail.js
 * tallyOf) and leaves the set's own text out of every count — it is one
 * subject, not a question — so that text is read from `observed` and named
 * beside the counts. Reading the tally alone, a category seen only in the
 * set's own text read "none", one line above that text's own row sending the
 * set to a person; and one seen lower in a question named the lower band.
 */
function categoryRow(id, tally, observed) {
  const seen = (tally.categories && tally.categories[id]) || {};
  const inQuestions = worstBand([seen.worst]);
  const inSetText = worstBand(observed
    .filter((o) => o.questionId === SET_SUBJECT && String(o.category || '').toUpperCase() === id)
    .map(bandOf));
  const where = [
    inQuestions ? countsWords(seen) : '',
    inSetText ? `the set's own text at ${bandWord(inSetText)}` : '',
  ].filter(Boolean).join(' · ');
  return { worst: worstBand([inQuestions, inSetText]), where };
}

/**
 * Did the check stop before it finished? The worker keeps a tally only once
 * measuring has finished, and a check that throws writes its review from the
 * catch block with `reasons: ['error']` in place of any it had gathered
 * (set-check-worker.js) — nothing else writes 'error'. Every other reason, and
 * every finding outside the five categories, comes from a check that ran to
 * its end, which now always keeps a tally: without one, that check came
 * before measuring existed.
 */
const didNotFinish = (reasons) => reasons.includes('error');

/**
 * Why a review has no tally, and what it kept. A check made before measuring
 * existed kept its verdict and, when anything held the set, that — never what
 * it let through, which that check was never told about. An approval keeps
 * those findings, so this is not "only its verdict" for any set a person
 * decided. A check that did not finish says so instead of dating itself:
 * "before detailed scoring existed" is false of every one that failed since.
 *
 * A finding outside the five categories has no band, so it is said here
 * rather than dressed as a row. The rule is content-guardrail.js tallyOf's
 * for `unread`: one on a question is a question the guardrail could not read,
 * one on the set's own subject that text; TIMEOUT and EMPTY name no subject.
 */
function noTallyLine(findings, unfinished) {
  const own = findings.filter((f) => !isJudged(f));
  const kind = (f) => String(f.category || '').toUpperCase();
  const unread = new Set(own
    .filter((f) => typeof f.questionId === 'string' && f.questionId !== '' && f.questionId !== SET_SUBJECT)
    .map((f) => f.questionId)).size;
  return [
    unfinished
      ? 'This check did not finish — it recorded no detailed scoring.'
      : `Checked before detailed scoring existed — this check recorded only ${findings.length ? 'what held the set, nothing it let through' : 'its verdict'}.`,
    unread ? `${unread} ${unread === 1 ? 'question' : 'questions'} could not be read.` : '',
    own.some((f) => f.questionId === SET_SUBJECT) ? "The set's own text could not be read." : '',
    own.some((f) => kind(f) === 'TIMEOUT') ? 'The check was stopped before it finished.' : '',
    own.some((f) => kind(f) === 'EMPTY') ? 'The set had no questions to check.' : '',
  ].filter(Boolean).join(' ');
}

/**
 * The CHECK's note beside a pre-tally verdict — "30/30 clean", all such a
 * check measured. Beside a tally there is none: that "N/N clean" counts what
 * held the set, not what was seen, and would sit one line from the summary
 * asking to be reconciled with it.
 *
 * It is on the row until a person decides. A decision writes the reviewer's
 * note over it (moderation-decide.js), and the reviewer's words are the
 * decision's, quoted on its own row in the timeline. The check's note is still
 * on the check's own `checked` event (set-check-worker.js), so a decided
 * review reads it from there: the latest check of the version this came from,
 * which is the one the row describes, and only if that check counted. One
 * that crashed logged no counts, and an older check's are not this one's.
 */
function checkNoteOf(review, log, version) {
  if (!review.reviewer) return String(review.note || '').trim();
  const latest = (Array.isArray(log) ? log : [])
    .filter((e) => e && e.event === 'checked' && Number(e.version) === Number(version))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  return latest && Number.isInteger(latest.checked) && Number.isInteger(latest.clean) ? `${latest.clean}/${latest.checked} clean` : '';
}

/**
 * How far the check got with the set's own text, which it judges last
 * (content-guardrail.js tallyOf): `checked`, the guardrail read it;
 * `unread`, the check reached it and the guardrail could not read it — so it
 * is never named as checked, nor clean; `unreached`, the budget stopped the
 * check before it.
 */
function setTextState(tally) {
  if (tally.setTextChecked) return 'checked';
  if (tally.setTextUnread) return 'unread';
  return 'unreached';
}

/**
 * The tally's one line. "Every question clean" is `spotless === questions`,
 * never "no observations": a question the guardrail could not read has none
 * either, and is not clean — it is `unread`.
 *
 * Only a check its budget stopped reached fewer questions than the set holds,
 * and it says "of". The TALLY says which check that was — the set's own text,
 * judged last, `unreached` — never a count beside it: a complete check of a
 * past version would otherwise read as one that skipped questions.
 */
function summaryLine(tally, questionCount, setClean) {
  const n = Number(tally.questions) || 0;
  const spotless = Number(tally.spotless) || 0;
  const unread = Number(tally.unread) || 0;
  const total = Number(questionCount) || 0;
  const setText = setTextState(tally);
  const cutShort = setText === 'unreached';
  const of = cutShort && total > n ? ` of ${total}` : '';
  const parts = [`${n}${of} ${n === 1 && !of ? 'question' : 'questions'}${setText === 'checked' ? " and the set's own text" : ''} checked`];
  if (n > 0 && spotless === n) {
    // "all" is every question AND the set's own text, which the first clause
    // has just named; with only the questions clean, it says only that. A
    // check cut short counts what it reached, never "every question".
    if (cutShort) parts.push(`all ${n} clean in every category`);
    else parts.push(setClean ? 'all clean in every category' : 'every question clean in every category');
  } else {
    parts.push(`${spotless} with nothing in any category`);
  }
  if (unread) parts.push(`${unread} could not be read`);
  if (setText === 'unread') parts.push("the set's own text could not be read");
  if (cutShort) parts.push("the set's own text was not reached");
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
  // The author's words ride the event as `message` (appeal-question-set.js,
  // the only writer of this event); `appealMessage` is the review row's and the
  // queue row's name for them, and no log event has ever carried it.
  appealed: (e) => `Appealed${e.message ? `: “${e.message}”` : ''}`,
  decided: (e) => `${e.decision === 'approve' ? 'Approved' : 'Rejected'}${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  published: (e) => `Published${e.publicVersion ? ` as public v${e.publicVersion}` : ''}`,
  unpublished: () => 'Unpublished by the organisation',
  'taken-down': (e) => `Taken down${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  // Staff looked at what a re-check found and left the listing serving. Its own
  // event, never `decided`: nobody ruled on a version here (moderation-decide.js
  // reads the log for `decided` when it resumes a crashed decision).
  'left-serving': (e) => `Left in the library${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  reported: (e) => `Reported${e.type ? ` — ${e.type}` : ''}`,
  'notice-set': () => 'Content notice set',
  'notice-cleared': () => 'Content notice cleared',
  access: (e) => `Opened by ${(e.who && e.who.name) || 'Engage'}`,
};
const eventWords = (e) => (EVENT_WORDS[e.event] ? EVENT_WORDS[e.event](e) : e.event);

/**
 * Everything the check saw — or, checked before measuring existed, everything
 * that held the set — worst first: each row named by its text, its band, its
 * category in words, why, and whether it held the set. One table for both, so
 * a finding reads the same whichever kind of check kept it.
 */
function SeenTable({ rows }) {
  return (
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
  );
}

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

/**
 * RUNNING THE CHECK AGAIN, AND SAYING WHAT THAT WILL AND WILL NOT DO.
 *
 * The owner, of the public sets they already have: the card shows nothing of
 * what the check measured, because those checks predate the measuring. The cure
 * is to run the check again — and the ORDINARY route publishes, which for a live
 * listing would mint a second public version of identical content, move the
 * author's share stamp off `published`, and replace the review row that records
 * a person's approval. `{ recheck: true }` is a different request, defined by
 * what it must not disturb, so this dialog's copy is those promises: it is the
 * only place a reader is told them before the work happens.
 *
 * It owns the START only. A 202 closes it and the card takes over the job (see
 * `followJob`); a refusal stays here, beside the confirm, live for a retry —
 * `TakedownDialog` above resolves and throws on exactly the same terms (R17).
 */
function RecheckDialog({ name, version, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Nothing is typed here, so both exits are gated on `busy` alone: a request in
  // flight must not be interrupted by a stray Escape or an off-card click.
  const requestClose = () => { if (!busy) onClose(); };
  const handleConfirm = async () => {
    setBusy(true); setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e.message || 'The check could not start.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal overlayClassName="scard scard-scrim" contentClassName="scard-dialog" labelledBy="scard-rc-title" onClose={requestClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy}>
      <header className="scard-head">
        <h2 id="scard-rc-title">Run the check again on “{name}”?</h2>
        <button type="button" className="scard-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="scard-body">
        <p>
          It runs the content check again on the version the public library is serving
          {version ? ` — version ${version}` : ''}, so this card can show what it measured.
        </p>
        <dl className="scard-promises">
          <dt>It changes nothing anyone can see</dt>
          <dd>No new public version, no change to what the library serves, and the organisation's own set goes on reading as shared to them.</dd>
          <dt>It does not undo a decision a person made</dt>
          <dd>The reviewer, the date they decided and their words stay on the record, whatever this check says.</dd>
          <dt>If it comes out worse than it stands</dt>
          <dd>Nothing is taken down. The listing goes to the queue for a person to look at, and the library keeps serving it until one does.</dd>
        </dl>
        <p className="scard-fine">It usually finishes in under a minute. Leaving this card keeps it running; what it measured shows here next time you open it.</p>
        {error && <div className="scard-outage" role="alert">{error}</div>}
      </div>
      <footer className="scard-foot">
        <button type="button" className="scard-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="scard-btn" onClick={handleConfirm} disabled={busy}>{busy ? 'Starting…' : 'Run the check'}</button>
      </footer>
    </Modal>
  );
}

export default function ScoreCard({ publicSetId, mode = 'org', onBack, onTakenDown }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askingRecheck, setAskingRecheck] = useState(false);
  // The re-check's own job while this card is watching it: null when none is.
  const [job, setJob] = useState(null);
  const [recheckError, setRecheckError] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(null);
  // The job outlives the card — closing this place keeps the check running — so
  // every write after an await is guarded rather than cancelled.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const safe = (fn) => { if (mounted.current) fn(); };

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

  /*
    ── RUNNING THE CHECK AGAIN ────────────────────────────────────────────────

    Three steps, and each owns exactly one failure.

    `startRecheck` is the dialog's onConfirm: it THROWS, so a refusal — 403 not
    staff, 404 no entry, 409 the source is gone or a check is already running,
    400 a version that is no longer the published one — is read where it was
    asked for, with the confirm live for a retry. On 202 it closes the dialog and
    hands the job to `followJob` WITHOUT awaiting it: the job takes minutes and
    the dialog must not stand open for them.

    `followJob` polls the way every other check job here is polled and reports
    its own failure on the card, never by unmounting it: a check that did not
    finish leaves the last good one readable, which is the whole reason the
    reader is here.

    `reread` never clears `card` first. The mount effect does, because there is
    nothing to show yet; blanking a card that is already on screen to fetch a
    version of itself is a flash of nothing, and on a failed re-read it would be
    permanent.
  */
  const reread = async () => {
    try {
      const res = await authFetch(itemUrl(publicSetId));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not re-read that set (${res.status}).`);
      safe(() => setCard(body));
    } catch (e) {
      safe(() => setRecheckError((was) => was || `The check finished, but this card could not be re-read: ${e.message}`));
    }
  };

  const followJob = async (jobId) => {
    let finished;
    try {
      finished = await pollGenerationJob(checkUrl(publicSetId), jobId, {
        label: 'Content check',
        onProgress: (j) => safe(() => setJob({ phase: j.phase || '', completed: Number(j.completed) || 0, requested: Number(j.requested) || 0 })),
      });
    } catch (e) {
      // Lost contact, or a job row that expired. The check may well have
      // finished, so the card is re-read anyway — it is one GET, and the row it
      // reads is the answer.
      safe(() => { setJob(null); setRecheckError(`The check could not be followed: ${e.message}`); });
      await reread();
      return;
    }
    const read = interpretCheckJob(finished);
    safe(() => {
      setJob(null);
      if (read.outcome === 'failed') setRecheckError(read.error || 'The check did not finish. Run it again.');
    });
    // Whatever it said, the review row moved: a failed check writes its own
    // verdict from the worker's catch block.
    await reread();
  };

  /*
    ── LEAVING IT SERVING ─────────────────────────────────────────────────────

    A re-check that came out worse than the decision on record puts the listing
    in the moderation queue, because nothing is taken down automatically. Neither
    review-dialog button answers that row, so until now the only control left was
    Take down — the destructive one, on content a person had already approved.
    The likely outcome of exactly the re-checks this card offers is a medium band
    somebody already ruled on, so "the approval stands" is the common answer and
    this is where it is said.

    It clears the queue entry and nothing else. No dialog: there is nothing to
    warn about and nothing to undo — a later re-check raises the row again — so a
    confirmation step would only be ceremony. A refusal is reported here rather
    than by unmounting the card, exactly as the re-check's is.
  */
  const leaveServing = async () => {
    setLeaving(true); setLeaveError(null);
    try {
      const res = await authFetch(adminApiUrl('admin/moderation/decide'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk: card.queued.sk, decision: 'leave' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `It could not be cleared from the queue (${res.status}).`);
      // The card is re-read rather than patched: the queue row is the server's
      // fact, and the same GET is what will say it has gone.
      await reread();
    } catch (e) {
      safe(() => setLeaveError(e.message || 'It could not be cleared from the queue.'));
    } finally {
      safe(() => setLeaving(false));
    }
  };

  const startRecheck = async () => {
    setRecheckError(null);
    let body;
    let res;
    try {
      res = await authFetch(checkUrl(publicSetId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The version is the card's own, and it is a CONFIRMATION, not a choice:
        // the route refuses any version but the one this entry was published
        // from, so a card read before the organisation published a newer version
        // is told so instead of silently checking the new one. `null` is the
        // legacy, unversioned content, and the route accepts it as that.
        body: JSON.stringify({ recheck: true, version: card.sourceVersion }),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      throw new Error(`The check could not start: ${e.message}`);
    }
    if (!res.ok) throw new Error(body.error || `The check could not start (${res.status}).`);
    setAskingRecheck(false);
    setJob({ phase: '', completed: 0, requested: 0 });
    followJob(body.jobId);
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
  const observed = rowsOf(review.observed);
  // What held the set, as findings: all a check before measuring kept. Only
  // those judged in a category have a band to show; the check's own are words.
  const findings = rowsOf(review.findings);
  const heldRows = worstFirst(findings.filter((f) => isJudged(f) && BAND_RANK[bandOf(f)] !== undefined));
  // Clean only if the guardrail READ the set's own text and saw nothing there;
  // text it could not read is `setTextUnread`, never `setTextChecked`.
  const setClean = Boolean(tally && tally.setTextChecked) && !observed.some((o) => o.questionId === SET_SUBJECT);
  const checkNote = card && !tally ? checkNoteOf(review, card.log, card.sourceVersion) : '';
  // Why a person was needed, under any verdict a check reached, in the queue's
  // words — and nothing at all when it needed none, never whyLabel's "Waiting".
  const reasons = Array.isArray(review.reasons) ? review.reasons : [];
  const why = verdict && !running && reasons.length ? whyLabel(review) : '';
  /*
    IS THERE ANYTHING TO RE-CHECK? The route reads the source off the public row,
    so an entry naming no organisation has nothing to run (409 there), and a
    version already being checked is refused on the lock (409 there too) — while
    one this card is watching is already running, here. A `checking` past the
    stale window is none of those: nothing holds that lock, and clearing it is
    what this control is for.
  */
  const inFlight = Boolean(card) && review.status === 'checking' && !unfinishedCheck(review);
  const canRecheck = mode === 'platform' && Boolean(card)
    && Boolean(card.sourceOrgId) && Boolean(card.sourceSetId)
    && !inFlight && !job;
  /*
    IS ANYBODY WAITING ON THIS LISTING, and is it staff's own re-check they are
    waiting on? A row raised by anything else — Stage 3's reports — is answered
    on that thing, not here, and the route refuses it. Not while a re-check of
    this card's own is running either: that check is about to write the row this
    would clear.
  */
  const queued = card && card.queued && card.queued.recheck ? card.queued : null;
  const canLeave = mode === 'platform' && Boolean(queued) && !job && !inFlight;

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
            {/* THE REVERSIBLE NEIGHBOUR, and the reason Take down is no longer
                the only answer to a re-check's queue row. Same size as it: these
                are the two answers to one question, not a control and its
                footnote. Stage 4: the content-notice editor joins them. */}
            {canLeave && (
              <button type="button" className="scard-btn" onClick={leaveServing} disabled={leaving}>
                {leaving ? 'Leaving it…' : 'Leave it serving'}
              </button>
            )}
          </div>
          {/* WHY THERE IS A SECOND BUTTON. Without this the queue row is
              invisible here and "Leave it serving" answers a question the reader
              was never asked. */}
          {canLeave && (
            <p className="scard-fine" data-testid="scard-waiting">
              A re-check came out worse than the decision on record, so this is waiting for a person
              {queued.waitingSince ? ` — since ${day(queued.waitingSince)}` : ''}. Nothing was taken down;
              leaving it serving clears that entry and changes nothing else.
            </p>
          )}
          {leaveError && <div className="scard-outage" data-testid="scard-leave-error" role="alert">{leaveError}</div>}
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
          {/* The control belongs HERE, beside the check it re-runs, rather than
              up with Take down: it is not a decision about the listing, it is a
              question about this section's own subject. */}
          <div className="scard-hrow">
            <h3 className="scard-h">The latest check{review.checkedAt ? ` · ${day(review.checkedAt)}` : ''}</h3>
            {canRecheck && (
              <button type="button" className="scard-btn scard-btn--sm" onClick={() => setAskingRecheck(true)}>Run the check again</button>
            )}
          </div>
          {/* A count only once the job has one to report: before the first poll
              answers there is no denominator, and "0" beside nothing reads as a
              check that has looked at nothing rather than one just started. */}
          {job && (
            <p className="scard-fine" data-testid="scard-recheck-progress" role="status">
              Re-running the check… {job.requested ? `${job.completed} / ${job.requested} · ` : ''}{job.phase || 'Starting'} · leaving this card keeps it running.
            </p>
          )}
          {recheckError && <div className="scard-outage" data-testid="scard-recheck-error" role="alert">{recheckError}</div>}
          {verdict ? (
            <p className="scard-verdict" data-testid="scard-verdict">Verdict: {verdict.label}{checkNote ? ` · “${checkNote}”` : ''}</p>
          ) : <p className="scard-summary">No check is on record for the version this came from.</p>}
          {why ? <p className="scard-fine" data-testid="scard-reasons">Why a person was needed: {why}</p> : null}
          {/* Not fine print: where a tally would stand, this is the answer to
              "why is there nothing else here?" — and, for a set a person
              decided, what held it. */}
          {verdict && !running && !tally && (
            <>
              <p className="scard-summary" data-testid="scard-pretally">{noTallyLine(findings, didNotFinish(reasons))}</p>
              {heldRows.length > 0 && <SeenTable rows={heldRows} />}
            </>
          )}
          {verdict && !running && tally && (
            <>
              <p className="scard-summary" data-testid="scard-summary">{summaryLine(tally, card.questionCount, setClean)}</p>
              <table className="scard-tbl">
                <thead><tr><th className="scard-col-cat">Category</th><th className="scard-col-worst">Worst</th><th className="scard-col-count">Questions</th></tr></thead>
                <tbody>
                  {CATEGORIES.map(([id, words]) => {
                    const { worst, where } = categoryRow(id, tally, observed);
                    return (
                      <tr key={id} className="scard-cat" data-testid="scard-cat">
                        <td>{capitalised(words)}</td>
                        <td>{worst ? <span className={`scard-chip scard-chip--${bandWord(worst)}`}>{bandWord(worst)}</span> : <span className="scard-none">none</span>}</td>
                        <td className="scard-count">{where}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {observed.length > 0 && <SeenTable rows={worstFirst(observed)} />}
            </>
          )}
          {/* Stage 3: reports by type, and each report's note (never the reporter). */}
        </>
      )}
      {asking && card && <TakedownDialog name={card.name || card.publicSetId} onClose={() => setAsking(false)} onConfirm={takeDown} />}
      {askingRecheck && card && (
        <RecheckDialog name={card.name || card.publicSetId} version={card.sourceVersion} onClose={() => setAskingRecheck(false)} onConfirm={startRecheck} />
      )}
    </section>
  );
}
