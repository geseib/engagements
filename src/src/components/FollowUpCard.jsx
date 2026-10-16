import React, { useEffect, useState } from 'react';
import RatingInput from './survey/RatingInput';
import ChoiceInput from './survey/ChoiceInput';
import TextInput from './survey/TextInput';
import FW, { KINDS } from '../config/followUpWords';
import './FollowUpCard.css';

/**
 * A QUESTION FOR THE ROOM, ON A PHONE, LAPTOP OR TABLET (docs/design/followup-icons
 * mockup §3, PLAN C2). The host sent it from Workie's read. Drawn with the
 * survey's own inputs, as a typed poll is: Choose with ChoiceInput (one pick),
 * Rate with RatingInput (1-5, the fixed ends), Ideas with TextInput (280).
 * The answer can be changed until the host shows the results; then the room's
 * answer, in counts, as the wall shows it.
 *
 *   ask      the public read's ask (followup-play/live)
 *   yours    this person's answer, or null
 *   onSend   (value) => Promise<{ ok, error, body }>
 *
 * LATE (session flow v3 §4.4): an answer that reaches the server after "Show
 * results" or after the round moved on is kept, but not counted; the reply
 * carries `late: true` and the card says so, even once it turns to the
 * room's answer.
 *
 * A DRAFT IS NEVER LOST (§4.4: "The answer box stays open while the player is
 * typing. If the round closes first, Send still works."). While something is
 * typed or picked and not sent, a closed ask keeps its form and Send. The
 * parent keeps the card on screen after the round moves on, from the draft
 * this card reports:
 *   draft         an unsent value to start from (a remount after the room moved)
 *   keptLate      this person's answer was already kept late
 *   onDraft       (value|null) => void, the unsent value, or null when there is none
 *   onDone        after a late send, a "Done" button that lets the card go
 *
 * Someone who already answered on time (`yours`) has no draft to keep: once
 * the ask closes, the room's answer shows as before (a change is refused).
 */
export function surveyQuestionOf(ask) {
  if (!ask) return null;
  if (ask.kind === 'rate') return { qid: `fu-${ask.askId}`, kind: 'rating', scale: '1-5', lowLabel: 'Disagree', highLabel: 'Agree' };
  if (ask.kind === 'ideas') return { qid: `fu-${ask.askId}`, kind: 'text', maxLength: 280 };
  return { qid: `fu-${ask.askId}`, kind: 'choice', options: ask.options || [], allowMultiple: false, allowOther: false, maxPicks: 1 };
}

export function answered(ask, value) {
  if (!ask || value === null || value === undefined) return false;
  if (ask.kind === 'rate') return Number.isInteger(value) && value >= 1 && value <= 5;
  if (ask.kind === 'ideas') return typeof value === 'string' && value.trim().length > 0;
  return Array.isArray(value) && value.length === 1 && Number.isInteger(value[0]);
}

const has = (v) => v !== null && v !== undefined;

export default function FollowUpCard({ ask, yours = null, onSend, draft = null, keptLate = false, onDraft, onDone }) {
  const [value, setValue] = useState(has(yours) ? yours : draft);
  const [sent, setSent] = useState(has(yours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [late, setLate] = useState(Boolean(keptLate));
  useEffect(() => { setLate(Boolean(keptLate)); }, [ask && ask.askId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setValue(has(yours) ? yours : draft);
    setSent(has(yours));
  }, [ask && ask.askId, yours]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsent = !sent && !has(yours) && answered(ask, value) ? value : null;
  useEffect(() => {
    if (onDraft) onDraft(unsent);
  }, [JSON.stringify(unsent)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ask) return null;
  const kind = KINDS[ask.kind] || KINDS.ideas;
  // Per ask: a held card and the round's own card can be on the page together.
  const formId = `fu-form-${ask.askId}`;
  const words = ask.kind === 'rate' ? `“${ask.statement}”` : ask.question;
  // A closed ask with an unsent draft keeps its form: Send is kept late.
  const closed = ask.status === 'closed' && unsent === null;

  const send = async (e) => {
    if (e) e.preventDefault();
    if (!answered(ask, value) || busy) return;
    setBusy(true);
    setError('');
    const r = await onSend(ask.kind === 'ideas' ? value.trim() : value);
    setBusy(false);
    if (r && r.ok) {
      setSent(true);
      if (r.body && r.body.late) setLate(true);
    }
    else setError((r && r.error) || 'That did not send. Try again.');
  };

  if (closed) {
    const t = ask.tally || { n: 0 };
    return (
      <section className="fu-card is-closed" aria-label={FW.theRoomsAnswer}>
        <p className="fu-kicker">{FW.theRoomsAnswer}</p>
        <h2 className="fu-q">{words}</h2>
        {ask.kind === 'choice' && (
          <ol className="fu-results">
            {(ask.options || []).map((o, i) => (
              <li key={i}><span>{`${String.fromCharCode(65 + i)} · ${o}`}</span><b>{(t.counts && t.counts[i]) || 0}</b></li>
            ))}
          </ol>
        )}
        {ask.kind === 'rate' && (
          <p className="fu-mean"><b>{t.mean === null || t.mean === undefined ? '–' : t.mean.toFixed(1)}</b> {FW.averageOf5}</p>
        )}
        {ask.kind === 'ideas' && (ask.picked || []).length > 0 && (
          <ul className="fu-ideas">{ask.picked.map((p, i) => <li key={i}>{p}</li>)}</ul>
        )}
        <p className="fu-foot">{ask.kind === 'ideas' ? FW.ideasCount(t.n || 0, (ask.picked || []).length) : FW.answered(t.n || 0)}</p>
        {late && <p className="fu-sent" role="status">{FW.keptLate}</p>}
        {late && onDone && <button type="button" className="plr-btn plr-btn--ghost" onClick={onDone}>{FW.done}</button>}
      </section>
    );
  }

  const question = surveyQuestionOf(ask);
  const Input = ask.kind === 'rate' ? RatingInput : ask.kind === 'ideas' ? TextInput : ChoiceInput;
  return (
    <section className="fu-card" aria-label={FW.questionForRoom}>
      <p className="fu-kicker">{`${FW.questionForRoom} · ${kind.label}`}</p>
      <h2 className="fu-q">{words}</h2>
      <form id={formId} onSubmit={send}>
        <Input
          question={question}
          value={value}
          onChange={(v) => { setValue(v); if (!late) setSent(false); }}
          onBlur={() => {}}
        />
      </form>
      {sent && <p className="fu-sent" role="status">{late ? FW.keptLate : FW.sent}</p>}
      {error && <p className="fu-error" role="alert">{error}</p>}
      {late && onDone ? (
        <button type="button" className="plr-btn plr-btn--ghost" onClick={onDone}>{FW.done}</button>
      ) : (
        <button type="submit" form={formId} className="plr-btn" disabled={busy || sent || !answered(ask, value)}>
          {busy ? FW.sending : FW.send}
        </button>
      )}
    </section>
  );
}

/**
 * THE HELD CARD (session flow v3 §4.4): a question for the room still holding
 * the player's draft, or just kept late, after the room moved on. Compact, and
 * drawn ABOVE the new round's own screen, never in place of it.
 *
 *   held     { ask, draft, late } from utils/useHeldFollowUp.js
 *   onLeave  let it go ("Leave it" with a draft, "Done" once kept late)
 */
export function HeldFollowUp({ held, onSend, onDraft, onLeave }) {
  if (!held || !held.ask) return null;
  return (
    <section className="fu-held" aria-label={FW.questionForRoom}>
      {!held.late && <p className="fu-held-note" role="note">{FW.roomMovedOn}</p>}
      <FollowUpCard
        ask={held.ask}
        draft={held.draft}
        keptLate={held.late}
        onSend={onSend}
        onDraft={onDraft}
        onDone={onLeave}
      />
      {!held.late && (
        <button type="button" className="plr-btn plr-btn--ghost" onClick={onLeave}>{FW.leaveDraft}</button>
      )}
    </section>
  );
}
