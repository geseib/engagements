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
 *   onSend   (value) => Promise<{ ok, error }>
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

export default function FollowUpCard({ ask, yours = null, onSend }) {
  const [value, setValue] = useState(yours);
  const [sent, setSent] = useState(yours !== null && yours !== undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setValue(yours);
    setSent(yours !== null && yours !== undefined);
  }, [ask && ask.askId, yours]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ask) return null;
  const kind = KINDS[ask.kind] || KINDS.ideas;
  const words = ask.kind === 'rate' ? `“${ask.statement}”` : ask.question;
  const closed = ask.status === 'closed';

  const send = async (e) => {
    if (e) e.preventDefault();
    if (!answered(ask, value) || busy) return;
    setBusy(true);
    setError('');
    const r = await onSend(ask.kind === 'ideas' ? value.trim() : value);
    setBusy(false);
    if (r && r.ok) setSent(true);
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
      </section>
    );
  }

  const question = surveyQuestionOf(ask);
  const Input = ask.kind === 'rate' ? RatingInput : ask.kind === 'ideas' ? TextInput : ChoiceInput;
  return (
    <section className="fu-card" aria-label={FW.questionForRoom}>
      <p className="fu-kicker">{`${FW.questionForRoom} · ${kind.label}`}</p>
      <h2 className="fu-q">{words}</h2>
      <form id="fu-form" onSubmit={send}>
        <Input
          question={question}
          value={value}
          onChange={(v) => { setValue(v); setSent(false); }}
          onBlur={() => {}}
        />
      </form>
      {sent && <p className="fu-sent" role="status">{FW.sent}</p>}
      {error && <p className="fu-error" role="alert">{error}</p>}
      <button type="submit" form="fu-form" className="plr-btn" disabled={busy || sent || !answered(ask, value)}>
        {busy ? FW.sending : FW.send}
      </button>
    </section>
  );
}
