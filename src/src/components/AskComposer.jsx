import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import './ui/Dialog.css';
import './ui/Button.css';
import './AskPreview.css';
import FW, {
  KINDS, COMPOSER_KINDS, COMMENTS_KIND, KIND_LINES, PRIVACY_LINES,
  RATE_PAIRS, DEFAULT_ENDS, ENDS_MAX, ENDS_WORDS as EW, scaleLabel,
} from '../config/followUpWords';

/**
 * ASK THE ROOM: ONE COMPOSER, TWO WAYS IN (session flow v3 §4.1; the v3
 * mockup's "6 The composer" and "Direction 1").
 *
 * A Workie icon beside a point opens it with that suggestion picked; "Ask the
 * room" in the dock opens it with Workie's suggestions listed and, when
 * exactly one is unsent, that one picked; otherwise blank. Same dialog on the
 * laptop; on the Remote the same content fills a full-height sheet (`sheet`).
 *
 * The words are editable from the start (no Edit step). When they came from
 * Workie, an "Edited" chip appears once anything differs, with "Back to
 * Workie's words". Comments (owner, 15 Oct, Q7) opens the feedback round
 * instead of sending an ask. "Words from the read" (owner, 15 Oct, Q6: "make
 * it easy to grab text blocks from workie") lists the read's lines; a click
 * fills the question, or adds the next option to a Choose question.
 *
 * Props:
 *   suggestions  [{ index, ask, section, point, sent }] — Workie's, in order
 *   startIndex   the suggestion to start from, or null for blank
 *   readLines    [string] — the read's points and paragraphs, plain text
 *   onSend       (body) => Promise<{ ok, error }> — the send route's body
 *   onComments   () => Promise<{ ok, error }> | null — opens the feedback round
 *   onClose      () => void
 *   blocked      a question is already live: Send waits, and says why
 *   oneScreen    the laptop is the wall: Workie's reasons fold away
 *   sheet        the Remote's full-height sheet (dialog only)
 *   theme        the dialog's theme (dialog only)
 */
const LIMITS = { question: 200, statement: 300, option: 120 };
const MAX_OPTIONS = 4;
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function startingWords(ask) {
  const a = ask || {};
  const options = Array.isArray(a.options) && a.options.length
    ? a.options.map((o) => ({ text: o.text || '', answer: Number.isInteger(o.answer) ? o.answer : null, reworded: (o.marks || []).includes('reworded') }))
    : [{ text: '', answer: null }, { text: '', answer: null }];
  return { question: a.question || '', statement: a.statement || '', options };
}

/*
  THE SCALE'S TWO ENDS (owner, 16 Oct; docs/design/settings-consolidation,
  tab 2). `ends` is `{ pair }` (an index into RATE_PAIRS) or
  `{ pair: 'custom', low, high }`. Either box picks a pair, so picking an end
  sets the other; Custom takes both, 1 to 24 characters each.
*/
export const DEFAULT_ENDS_CHOICE = Object.freeze({ pair: 0 });

/** The ends a choice means, `{low, high}`, or null while a custom end is blank. */
export function endsFrom(choice) {
  const c = choice || DEFAULT_ENDS_CHOICE;
  if (c.pair === 'custom') {
    const low = flat(c.low);
    const high = flat(c.high);
    return low && high && low.length <= ENDS_MAX && high.length <= ENDS_MAX ? { low, high } : null;
  }
  return RATE_PAIRS[c.pair] || DEFAULT_ENDS;
}

const kindOf = (ask) => (ask && ['ideas', 'choice', 'rate'].includes(ask.type) ? ask.type : 'ideas');

/** The send body, or the reason it cannot be sent yet. `entry` may be null (blank). */
export function askBody(kind, words, entry, endsChoice = DEFAULT_ENDS_CHOICE) {
  const q = flat(words.question);
  const st = flat(words.statement);
  const ask = entry && entry.ask ? entry.ask : {};
  const base = {
    kind,
    fromAnswers: Array.isArray(ask.answers) ? ask.answers : [],
    suggestionIndex: entry && Number.isInteger(entry.index) ? entry.index : undefined,
  };
  if (kind === 'rate') {
    if (!st) return { error: 'Write the statement the room will rate' };
    const ends = endsFrom(endsChoice);
    if (!ends) return { error: EW.needBoth };
    // The default pair adds nothing: the server reads an absent `ends` as it.
    const isDefault = ends.low === DEFAULT_ENDS.low && ends.high === DEFAULT_ENDS.high;
    return { body: { ...base, statement: st, ...(isDefault ? {} : { ends: { low: ends.low, high: ends.high } }) } };
  }
  if (!q) return { error: 'Write the question' };
  if (kind === 'ideas') return { body: { ...base, question: q } };
  const options = words.options
    .map((o) => ({ text: flat(o.text), answer: o.answer }))
    .filter((o) => o.text);
  if (options.length < 2) return { error: 'A pick-one question needs at least 2 options' };
  if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) return { error: 'Two options say the same thing' };
  return { body: { ...base, question: q, options } };
}

/** Have the words moved away from Workie's? (kind, question/statement, options) */
export function editedFrom(entry, kind, words) {
  if (!entry || !entry.ask) return false;
  const w0 = startingWords(entry.ask);
  if (kind !== kindOf(entry.ask)) return true;
  if (kind === 'rate') return flat(words.statement) !== flat(w0.statement);
  if (flat(words.question) !== flat(w0.question)) return true;
  if (kind !== 'choice') return false;
  const a = words.options.map((o) => flat(o.text)).filter(Boolean);
  const b = w0.options.map((o) => flat(o.text)).filter(Boolean);
  return a.length !== b.length || a.some((t, i) => t !== b[i]);
}

const kindMeta = (k) => (k === 'comments' ? COMMENTS_KIND : KINDS[k]);

/**
 * The composer itself, without a dialog around it. The host console draws it
 * inline beside Workie's read (`inline`, the default, wraps it in its own
 * `askp askc askc--inline` box); `AskComposer` below draws it in a dialog and
 * passes `inline={false}`, since the dialog's content box already carries
 * those classes. It owns `busy`, and reports it through `onBusyChange` so the
 * dialog can refuse Escape and the scrim while a send is in flight.
 */
export function AskComposerBody({
  suggestions = [], startIndex = null, readLines = [], onSend, onComments = null, onClose,
  blocked = false, oneScreen = false, inline = true, onBusyChange = null,
}) {
  const byIndex = (i) => suggestions.find((s) => s.index === i) || null;
  const first = startIndex === null || startIndex === undefined ? null : byIndex(startIndex);
  const [entry, setEntry] = useState(first);
  const [kind, setKind] = useState(first ? kindOf(first.ask) : 'ideas');
  const [words, setWords] = useState(() => startingWords(first && first.ask));
  const [endsChoice, setEndsChoice] = useState(DEFAULT_ENDS_CHOICE);
  const [busy, setBusyState] = useState(false);
  const setBusy = (b) => { setBusyState(b); if (onBusyChange) onBusyChange(b); };
  const [error, setError] = useState('');

  const kinds = onComments ? COMPOSER_KINDS : COMPOSER_KINDS.filter((k) => k !== 'comments');
  const comments = kind === 'comments';
  const built = useMemo(() => (comments ? { body: {} } : askBody(kind, words, entry, endsChoice)), [comments, kind, words, entry, endsChoice]);
  const shownEnds = endsFrom(endsChoice) || {
    low: flat(endsChoice.low) || DEFAULT_ENDS.low, high: flat(endsChoice.high) || DEFAULT_ENDS.high,
  };
  /** Either box: a pair index, or 'custom' (keeping the words the pair had, to edit). */
  const pickEnds = (value) => {
    setError('');
    if (value === 'custom') {
      setEndsChoice((c) => (c.pair === 'custom' ? c : { pair: 'custom', low: '', high: '' }));
      return;
    }
    setEndsChoice({ pair: Number(value) });
  };
  const edited = !comments && editedFrom(entry, kind, words);
  const requestClose = () => { if (!busy) onClose(); };

  const pick = (s) => {
    setEntry(s);
    setKind(s ? kindOf(s.ask) : 'ideas');
    setWords(startingWords(s && s.ask));
    setEndsChoice(DEFAULT_ENDS_CHOICE);
    setError('');
  };

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

  const setOption = (i, text) => setWords((w) => ({
    ...w, options: w.options.map((o, j) => (j === i ? { text, answer: null, reworded: false } : o)),
  }));

  /** A line of the read: the question (or statement), or the next option of a Choose. */
  const takeLine = (line) => {
    const text = flat(line).slice(0, kind === 'rate' ? LIMITS.statement : LIMITS.question);
    setError('');
    if (kind === 'rate') { setWords((w) => ({ ...w, statement: text })); return; }
    if (kind === 'choice' && flat(words.question)) {
      setWords((w) => {
        const opt = text.slice(0, LIMITS.option);
        const at = w.options.findIndex((o) => !flat(o.text));
        if (at >= 0) return { ...w, options: w.options.map((o, j) => (j === at ? { text: opt, answer: null } : o)) };
        if (w.options.length < MAX_OPTIONS) return { ...w, options: [...w.options, { text: opt, answer: null }] };
        return w;
      });
      return;
    }
    setWords((w) => ({ ...w, question: text }));
  };

  const send = async () => {
    if (busy || (!comments && (blocked || !built.body))) return;
    setBusy(true);
    setError('');
    const r = comments ? await onComments() : await onSend(built.body);
    setBusy(false);
    if (r && r.ok) onClose();
    else setError((r && r.error) || 'That did not send. Try again.');
  };

  const ask = (entry && entry.ask) || {};
  const headline = kind === 'rate' ? (words.statement ? `“${words.statement}”` : '') : words.question;
  const titleId = 'askc-title';
  const sendDisabled = busy || (!comments && (blocked || !built.body));
  const lines = (readLines || []).map(flat).filter((l) => l.length > 3);

  const root = (
      <div className="askp-root">
        <header className="ui-dialog-head">
          <div className="ui-dialog-titles">
            <h2 id={titleId} className="ui-dialog-title">{FW.askTheRoom}</h2>
          </div>
          <button type="button" className="ui-dialog-x" aria-label={FW.close} onClick={requestClose} disabled={busy}>×</button>
        </header>

        <div className="ui-dialog-body askc-body">
          {suggestions.length ? (
            <section className="askc-sec" aria-label={FW.workieSuggests}>
              <p className="askp-label">{FW.workieSuggests}</p>
              <div className="askc-cards">
                {suggestions.map((s) => {
                  const k = kindOf(s.ask);
                  const on = entry && entry.index === s.index;
                  return (
                    <button
                      key={s.index}
                      type="button"
                      className={`askc-card${on ? ' is-on' : ''}${s.sent ? ' is-sent' : ''}`}
                      aria-pressed={Boolean(on)}
                      onClick={() => pick(s)}
                    >
                      <span className="askc-card-k"><Icon name={KINDS[k].icon} size={14} />{KINDS[k].label}{s.sent ? ` · ${FW.sentAlready}` : ''}</span>
                      <span className="askc-card-q">{k === 'rate' ? s.ask.statement : s.ask.question}</span>
                      {s.section ? <span className="askc-card-from">{FW.fromPoint(s.section, s.point)}</span> : null}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`askc-card askc-card--blank${entry ? '' : ' is-on'}`}
                  aria-pressed={!entry}
                  onClick={() => pick(null)}
                >
                  <span className="askc-card-q">{FW.startFromBlank}</span>
                </button>
              </div>
            </section>
          ) : null}

          <section className="askc-sec">
            <p className="askp-label">{FW.kind}</p>
            <div className="askc-kinds" role="radiogroup" aria-label={FW.kind}>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={k === kind}
                  className={`askc-kind${k === kind ? ' is-on' : ''}`}
                  onClick={() => switchTo(k)}
                >
                  <span className="askc-kind-k"><Icon name={kindMeta(k).icon} size={16} />{kindMeta(k).label}</span>
                  <span className="askc-kind-line">{KIND_LINES[k]}</span>
                </button>
              ))}
            </div>
          </section>

          {comments ? (
            <p className="askc-note">{FW.commentsBody}</p>
          ) : (
            <section className="askc-sec">
              <div className="askc-wordshead">
                <p className="askp-label">{kind === 'rate' ? FW.statement : FW.question}</p>
                {edited ? (
                  <span className="askc-edited">
                    <span className="askp-chip">{FW.edited}</span>
                    <button type="button" className="askc-link" onClick={() => pick(entry)}>{FW.backToWorkie}</button>
                  </span>
                ) : null}
              </div>
              {kind === 'rate' ? (
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
              )}
              {kind === 'rate' && (
                <div className="askc-ends">
                  <div className="askc-ends-row">
                    <label className="askc-end">
                      <span className="askp-label">{EW.lowMeans}</span>
                      <select className="askp-input askc-end-select" value={String(endsChoice.pair)} onChange={(e) => pickEnds(e.target.value)}>
                        {RATE_PAIRS.map((p, i) => <option key={p.low} value={String(i)}>{p.low}</option>)}
                        <option value="custom">{EW.custom}</option>
                      </select>
                    </label>
                    <span className="askc-ends-to" aria-hidden="true">{EW.to}</span>
                    <label className="askc-end">
                      <span className="askp-label">{EW.highMeans}</span>
                      <select className="askp-input askc-end-select" value={String(endsChoice.pair)} onChange={(e) => pickEnds(e.target.value)}>
                        {RATE_PAIRS.map((p, i) => <option key={p.high} value={String(i)}>{p.high}</option>)}
                        <option value="custom">{EW.custom}</option>
                      </select>
                    </label>
                  </div>
                  {endsChoice.pair === 'custom' ? (
                    <div className="askc-ends-row">
                      <input
                        className="askp-input askc-end"
                        maxLength={ENDS_MAX}
                        aria-label={EW.lowCustom}
                        placeholder={EW.lowCustom}
                        value={endsChoice.low}
                        onChange={(e) => { const v = e.target.value; setEndsChoice((c) => ({ ...c, low: v })); }}
                      />
                      <span className="askc-ends-to" aria-hidden="true">{EW.to}</span>
                      <input
                        className="askp-input askc-end"
                        maxLength={ENDS_MAX}
                        aria-label={EW.highCustom}
                        placeholder={EW.highCustom}
                        value={endsChoice.high}
                        onChange={(e) => { const v = e.target.value; setEndsChoice((c) => ({ ...c, high: v })); }}
                      />
                    </div>
                  ) : null}
                  <p className="askc-ends-hint">{EW.hint}</p>
                </div>
              )}
              {kind === 'choice' && (
                <ol className="askp-options">
                  {words.options.map((o, i) => (
                    <li key={i} className="askp-option">
                      <span className="askp-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                      <input
                        className="askp-input"
                        maxLength={LIMITS.option}
                        aria-label={FW.optionPlaceholder(i)}
                        placeholder={FW.optionPlaceholder(i)}
                        value={o.text}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                      {o.reworded ? <span className="askp-chip">{FW.reworded}</span> : null}
                    </li>
                  ))}
                  {words.options.length < MAX_OPTIONS && (
                    <li>
                      <button type="button" className="askp-add" onClick={() => setWords((w) => ({ ...w, options: [...w.options, { text: '', answer: null }] }))}>
                        {FW.addOption}
                      </button>
                    </li>
                  )}
                </ol>
              )}
            </section>
          )}

          {!comments && lines.length ? (
            <details className="askc-read">
              <summary>{FW.fromTheRead}</summary>
              <p className="askc-read-hint">{FW.fromTheReadHint(kind === 'choice' && Boolean(flat(words.question)))}</p>
              <ul className="askc-read-list">
                {lines.map((line, i) => (
                  <li key={i}>
                    <button type="button" className="askc-line" aria-label={FW.takeLineLabel(line)} onClick={() => takeLine(line)}>{line}</button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {!comments && entry && (ask.why || (ask.answers && ask.answers.length)) ? (
            oneScreen ? (
              <details className="askc-why">
                <summary>{FW.whyWorkie}</summary>
                <p className="askp-why">{ask.why}{ask.answers && ask.answers.length ? ` ${FW.fromAnswers(ask.answers)}` : ''}</p>
              </details>
            ) : (
              <p className="askp-why">
                <b>{FW.forYou}</b>
                {ask.why ? ` ${ask.why}` : ''}
                {ask.answers && ask.answers.length ? ` ${FW.fromAnswers(ask.answers)}` : ''}
              </p>
            )
          ) : null}

          <p className="askc-privacy">{PRIVACY_LINES[kind]}</p>

          {!comments ? (
            <section className="askc-sec">
              <p className="askp-label">{FW.whatRoomSees}</p>
              <div className="askp-phone askc-phone">
                <p className="askp-phone-q">{headline || ' '}</p>
                {kind === 'choice' && (
                  <ol className="askp-options">
                    {words.options.filter((o) => flat(o.text)).map((o, i) => (
                      <li key={i} className="askp-option">
                        <span className="askp-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                        <span className="askp-option-text">{o.text}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {kind === 'rate' && (
                  <div className="askp-scale">
                    <div className="askp-scale-row" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((n) => <span key={n} className="askp-scale-n">{n}</span>)}
                    </div>
                    <div className="askp-scale-ends"><span>{scaleLabel(shownEnds, 1)}</span><span>{scaleLabel(shownEnds, 5)}</span></div>
                  </div>
                )}
                {kind === 'ideas' && <div className="askp-idea" aria-hidden="true">{FW.ideaPlaceholder}</div>}
              </div>
            </section>
          ) : null}

          {(error || (blocked && !comments) || (!comments && !built.body && built.error && (flat(words.question) || flat(words.statement)))) ? (
            <p className="askp-error" role="alert">{error || (blocked && !comments ? FW.finishFirst : built.error)}</p>
          ) : null}
        </div>

        <footer className="ui-dialog-foot">
          <button type="button" className="ui-btn ui-btn--quiet" onClick={requestClose} disabled={busy}>{FW.cancel}</button>
          <button type="button" className="ui-btn ui-btn--action" onClick={send} disabled={sendDisabled}>
            {busy ? FW.sending : (comments ? FW.commentsSend : FW.sendToRoom)}
          </button>
        </footer>
      </div>
  );
  return inline ? <div className="askp askc askc--inline">{root}</div> : root;
}

/** The composer in a dialog (one screen, and the Remote's full-height `sheet`). */
export default function AskComposer({ sheet = false, theme = 'dark', onClose, ...rest }) {
  const [busy, setBusy] = useState(false);
  const requestClose = () => { if (!busy) onClose(); };
  return (
    <Modal
      overlayClassName={`ui-scrim${sheet ? ' askc-scrim--sheet' : ''}`}
      contentClassName={`ui-dialog askp askc${sheet ? ' askc--sheet' : ''}`}
      onClose={requestClose}
      closeOnEscape={() => !busy}
      labelledBy="askc-title"
      theme={theme}
    >
      <AskComposerBody {...rest} onClose={onClose} inline={false} onBusyChange={setBusy} />
    </Modal>
  );
}
