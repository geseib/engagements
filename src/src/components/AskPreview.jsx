import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import './ui/Dialog.css';
import './ui/Button.css';
import './AskPreview.css';
import FW, { KINDS, KIND_ORDER, RATE_ENDS } from '../config/followUpWords';

/**
 * ASK THE ROOM: THE PREVIEW (docs/design/followup-icons mockup §2, PLAN B3).
 *
 * Opened from an icon beside a point of Workie's read. Shows exactly what the
 * phones will show, and what it would settle for the host ("For you"). The
 * host can switch the kind or edit the words; nothing reaches the room until
 * Send. One requestClose() for the X, Cancel and Escape.
 *
 * Props:
 *   entry    { index, ask, section, point }  — a suggestion and where it sits
 *   onSend   (body) => Promise<{ ok, error }> — body is the send route's
 *   onClose  () => void
 *   blocked  a question is already live: Send waits, and says why
 *   theme    'dark' | 'light' (the surface's own)
 */
const LIMITS = { question: 200, statement: 300, option: 120 };

function startingWords(ask) {
  const options = Array.isArray(ask.options) && ask.options.length
    ? ask.options.map((o) => ({ text: o.text || '', answer: Number.isInteger(o.answer) ? o.answer : null, reworded: (o.marks || []).includes('reworded') }))
    : [{ text: '', answer: null }, { text: '', answer: null }];
  return { question: ask.question || '', statement: ask.statement || '', options };
}

/** The send body, or the reason it cannot be sent yet. */
export function askBody(kind, words, entry) {
  const q = words.question.replace(/\s+/g, ' ').trim();
  const st = words.statement.replace(/\s+/g, ' ').trim();
  const base = {
    kind,
    fromAnswers: Array.isArray(entry.ask.answers) ? entry.ask.answers : [],
    suggestionIndex: Number.isInteger(entry.index) ? entry.index : undefined,
  };
  if (kind === 'rate') {
    if (!st) return { error: 'Write the statement the room will rate' };
    return { body: { ...base, statement: st } };
  }
  if (!q) return { error: 'Write the question' };
  if (kind === 'ideas') return { body: { ...base, question: q } };
  const options = words.options
    .map((o) => ({ text: o.text.replace(/\s+/g, ' ').trim(), answer: o.answer }))
    .filter((o) => o.text);
  if (options.length < 2) return { error: 'A pick-one question needs at least 2 options' };
  if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) return { error: 'Two options say the same thing' };
  return { body: { ...base, question: q, options } };
}

export default function AskPreview({ entry, onSend, onClose, blocked = false, theme = 'dark' }) {
  const ask = entry.ask || {};
  const [kind, setKind] = useState(KIND_ORDER.includes(ask.type) ? ask.type : 'ideas');
  const [words, setWords] = useState(() => startingWords(ask));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const built = useMemo(() => askBody(kind, words, entry), [kind, words, entry]);
  const requestClose = () => { if (!busy) onClose(); };

  // Switching kind keeps the words: a statement becomes the question and back.
  const switchTo = (next) => {
    if (next === kind) return;
    setWords((w) => ({
      ...w,
      question: w.question || (next !== 'rate' ? w.statement : ''),
      statement: w.statement || (next === 'rate' ? w.question : ''),
    }));
    setKind(next);
    setError('');
  };

  const send = async () => {
    if (!built.body || busy || blocked) return;
    setBusy(true);
    setError('');
    const r = await onSend(built.body);
    setBusy(false);
    if (r && r.ok) onClose();
    else setError((r && r.error) || 'That did not send. Try again.');
  };

  const setOption = (i, text) => setWords((w) => ({
    ...w, options: w.options.map((o, j) => (j === i ? { text, answer: null, reworded: false } : o)),
  }));

  const where = entry.section ? FW.fromPoint(entry.section, entry.point) : FW.afterTheRead;
  const headline = kind === 'rate' ? `“${words.statement}”` : words.question;
  const titleId = `askp-title-${entry.index}`;

  return (
    <Modal
      overlayClassName="ui-scrim"
      contentClassName="ui-dialog askp"
      onClose={requestClose}
      closeOnEscape={() => !busy}
      labelledBy={titleId}
      theme={theme}
    >
      <div className="askp-root">
        <header className="ui-dialog-head">
          <div className="ui-dialog-titles">
            <p className="askp-kicker">
              <Icon name={KINDS[kind].icon} size={16} />
              {`${KINDS[kind].label} · ${where}`}
            </p>
            <h2 id={titleId} className="ui-dialog-title askp-title">{headline || ' '}</h2>
          </div>
          <button type="button" className="ui-dialog-x" aria-label={FW.close} onClick={requestClose} disabled={busy}>×</button>
        </header>

        <div className="ui-dialog-body">
          <div className="askp-kinds" role="radiogroup" aria-label="Kind of question">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                className={`askp-kind${k === kind ? ' is-on' : ''}`}
                onClick={() => switchTo(k)}
              >
                <Icon name={KINDS[k].icon} size={16} />
                {KINDS[k].label}
              </button>
            ))}
          </div>

          <p className="askp-label">{FW.whatPhonesShow}</p>
          <div className="askp-phone">
            {editing ? (
              kind === 'rate' ? (
                <textarea
                  className="askp-input"
                  rows={2}
                  maxLength={LIMITS.statement}
                  aria-label={FW.statementPlaceholder}
                  placeholder={FW.statementPlaceholder}
                  value={words.statement}
                  onChange={(e) => setWords((w) => ({ ...w, statement: e.target.value }))}
                />
              ) : (
                <textarea
                  className="askp-input"
                  rows={2}
                  maxLength={LIMITS.question}
                  aria-label={FW.questionPlaceholder}
                  placeholder={FW.questionPlaceholder}
                  value={words.question}
                  onChange={(e) => setWords((w) => ({ ...w, question: e.target.value }))}
                />
              )
            ) : (
              <p className="askp-phone-q">{headline}</p>
            )}

            {kind === 'choice' && (
              <ol className="askp-options">
                {words.options.map((o, i) => (
                  <li key={i} className="askp-option">
                    <span className="askp-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                    {editing ? (
                      <input
                        className="askp-input"
                        maxLength={LIMITS.option}
                        aria-label={FW.optionPlaceholder(i)}
                        placeholder={FW.optionPlaceholder(i)}
                        value={o.text}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                    ) : (
                      <span className="askp-option-text">{o.text}</span>
                    )}
                    {!editing && o.reworded ? <span className="askp-chip">{FW.reworded}</span> : null}
                  </li>
                ))}
                {editing && words.options.length < 4 && (
                  <li>
                    <button type="button" className="askp-add" onClick={() => setWords((w) => ({ ...w, options: [...w.options, { text: '', answer: null }] }))}>
                      {FW.addOption}
                    </button>
                  </li>
                )}
              </ol>
            )}

            {kind === 'rate' && (
              <div className="askp-scale">
                <div className="askp-scale-row" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((n) => <span key={n} className="askp-scale-n">{n}</span>)}
                </div>
                <div className="askp-scale-ends"><span>{RATE_ENDS.low}</span><span>{RATE_ENDS.high}</span></div>
              </div>
            )}

            {kind === 'ideas' && <div className="askp-idea" aria-hidden="true">{FW.ideaPlaceholder}</div>}
          </div>

          {(ask.why || (ask.answers && ask.answers.length)) ? (
            <p className="askp-why">
              <b>{FW.forYou}</b>
              {ask.why ? ` ${ask.why}` : ''}
              {ask.answers && ask.answers.length ? ` ${FW.fromAnswers(ask.answers)}` : ''}
            </p>
          ) : null}

          {(error || (blocked && FW.finishFirst) || (!built.body && editing && built.error)) ? (
            <p className="askp-error" role="alert">{error || (blocked ? FW.finishFirst : built.error)}</p>
          ) : null}
        </div>

        <footer className="ui-dialog-foot">
          <button type="button" className="ui-btn ui-btn--quiet askp-edit" onClick={() => setEditing((e) => !e)} disabled={busy}>
            {editing ? FW.doneEditing : FW.edit}
          </button>
          <button type="button" className="ui-btn ui-btn--quiet" onClick={requestClose} disabled={busy}>{FW.cancel}</button>
          <button type="button" className="ui-btn ui-btn--action" onClick={send} disabled={busy || blocked || !built.body}>
            {busy ? FW.sending : FW.sendToRoom}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
