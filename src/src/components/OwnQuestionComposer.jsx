import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from './ui/Button';
import Icon from './Icon';
import { ownQuestionWords as OQ } from '../config/consoleWords';
import './OwnQuestionComposer.css';

/** The field limits, the server's (round-question.js LIMITS). */
export const OWN_LIMITS = Object.freeze({ title: 200, detail: 400, note: 400 });

/** Where it goes, in the radiogroup's order. */
const PLACES = ['next', 'later', 'now'];

/**
 * The commit button's words: they name the choice (README D4).
 *   next → "Put it next"; later → "Put it after round N"; now → "Ask it now";
 *   editing → "Save the question".
 */
export function commitLabel({ mode = 'add', place = 'next', anchorRound = null } = {}) {
  if (mode === 'edit') return OQ.save;
  if (place === 'now') return OQ.askNow;
  if (place === 'later' && anchorRound) return OQ.putAfter(anchorRound);
  return OQ.putNext;
}

/** Is there anything typed that closing would lose? */
export const composerDirty = (fields, initial = {}) => ['title', 'detail', 'note']
  .some((k) => String(fields[k] || '').trim() !== String(initial[k] || '').trim());

/**
 * WRITE A QUESTION — the impromptu ask's composer (docs/design/impromptu-ask,
 * frames 1, 2 and 5; README D2–D4, D8; reviews R2–R4, R7, A-2–A-7).
 *
 * ONE COMPOSER, THREE DOORS: the Session menu's Rounds (an inline second step,
 * never a modal over the sheet), the console rail's Round queue (opens that
 * same step), and the phone Remote's Rounds tab (a full-height sheet,
 * `variant="touch"`). Presentational: the page sends the op.
 *
 *   - Fields: the question (required, ≤200), a line for the room (≤400), and a
 *     note for Workie only (≤400) whose "never shown" line is its description.
 *   - Where it goes: a radiogroup — Next (default), Later (after a round you
 *     pick), Now (between rounds only; otherwise aria-disabled with its reason,
 *     still focusable). Arrow keys move between them. Not drawn when editing.
 *   - The commit names the choice. On the laptop it is a strong plain button
 *     with a check, never orange: Your part now keeps the one orange move (R2).
 *     On the phone the sheet covers the screen, so its commit is the orange.
 *   - X, Cancel, ← Running order and Escape all go through ONE requestClose,
 *     which asks first when something is typed (engage-design hard rule 2).
 *     The ask is inline in the composer, never a second dialog.
 */
export default function OwnQuestionComposer({
  variant = 'panel',
  mode = 'add',
  initial = null,
  /* Now is offered only between rounds (F2). `nowReason` is said when it is not. */
  canNow = false,
  nowReason = OQ.nowWaits,
  /* Before round 1 Now starts the session's first round. */
  lobby = false,
  /* The rounds Later can follow: [{ key, round, title, through }] in order. */
  laterOptions = [],
  /* The round number the question would take if it went next (the preview). */
  nextRound = null,
  backLabel = OQ.back,
  busy = false,
  error = '',
  onSubmit = () => {},
  onClose = () => {},
}) {
  const uid = useId();
  const ids = {
    title: `${uid}-q`, line: `${uid}-l`, note: `${uid}-n`, never: `${uid}-never`, where: `${uid}-where`,
    reason: `${uid}-reason`, head: `${uid}-head`,
  };
  const base = useMemo(() => ({ title: '', detail: '', note: '', ...(initial || {}) }), [initial]);
  const [fields, setFields] = useState(base);
  const [place, setPlace] = useState('next');
  const [anchorKey, setAnchorKey] = useState(laterOptions.length ? laterOptions[0].key : '');
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef(null);
  const radioRefs = useRef({});

  // Focus lands in the question (reviews F-1: one click and type).
  useEffect(() => { if (titleRef.current) titleRef.current.focus(); }, []);

  const anchor = laterOptions.find((o) => o.key === anchorKey) || null;
  const title = fields.title.trim();
  const tooLong = fields.title.length > OWN_LIMITS.title
    || fields.detail.length > OWN_LIMITS.detail || fields.note.length > OWN_LIMITS.note;
  const laterReady = place !== 'later' || Boolean(anchor);
  const canCommit = Boolean(title) && !tooLong && laterReady && !busy && (place !== 'now' || canNow);
  const reason = !title ? OQ.needsWords
    : (tooLong ? OQ.tooLong(OWN_LIMITS.title) : (!laterReady ? OQ.noLater : ''));
  const dirty = composerDirty(fields, base);

  const requestClose = () => {
    if (busy) return;
    if (dirty && !confirming) { setConfirming(true); return; }
    onClose();
  };

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  const choose = (p) => {
    if (p === 'now' && !canNow) return;
    setPlace(p);
  };

  // The radiogroup's arrow keys (A-2): move and choose; a disabled Now is
  // skipped for choosing but stays reachable by Tab with its reason read out.
  const onRadioKey = (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const at = PLACES.indexOf(place);
    let next = at;
    for (let i = 0; i < PLACES.length; i += 1) {
      next = (next + keys[e.key] + PLACES.length) % PLACES.length;
      if (PLACES[next] !== 'now' || canNow) break;
    }
    setPlace(PLACES[next]);
    const el = radioRefs.current[PLACES[next]];
    if (el) el.focus();
  };

  const submit = (e) => {
    if (e) e.preventDefault();
    if (!canCommit) return;
    onSubmit({
      title,
      detail: fields.detail.trim(),
      note: fields.note.trim(),
      place: mode === 'edit' ? null : place,
      anchorKey: place === 'later' && anchor ? anchor.key : null,
      anchorRound: place === 'later' && anchor ? anchor.round : null,
      through: place === 'later' && anchor ? (anchor.through || []) : null,
    });
  };

  const touch = variant === 'touch';
  const label = commitLabel({ mode, place, anchorRound: anchor && anchor.round });
  const placeLine = {
    next: OQ.nextLine,
    later: OQ.laterLine,
    now: canNow ? (lobby ? OQ.nowLineLobby : OQ.nowLine) : nowReason,
  };

  return (
    <form
      className={`oq oq--${touch ? 'touch' : 'panel'}`}
      data-testid="own-composer"
      aria-labelledby={ids.head}
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); requestClose(); } }}
    >
      <div className="oq-head">
        <button type="button" className="oq-back" onClick={requestClose} data-testid="own-back">
          <Icon name="CaretLeft" weight="bold" size={14} color="currentColor" />
          {backLabel}
        </button>
        <h3 className="oq-title" id={ids.head}>{mode === 'edit' ? OQ.editTitle : OQ.title}</h3>
        <button type="button" className="oq-x" onClick={requestClose} aria-label={`${OQ.cancel}: ${OQ.title}`} data-testid="own-x">
          <Icon name="X" weight="bold" size={16} color="currentColor" />
        </button>
      </div>

      <div className="oq-body">
        <div className="oq-field">
          <div className="oq-label-row">
            <label className="oq-label" htmlFor={ids.title}>{OQ.question}</label>
            <span className={`oq-count${fields.title.length > OWN_LIMITS.title ? ' is-over' : ''}`} aria-live="polite">
              {OQ.counter(fields.title.length, OWN_LIMITS.title)}
            </span>
          </div>
          <textarea
            ref={titleRef}
            id={ids.title}
            className="oq-input oq-input--q"
            rows={touch ? 3 : 2}
            value={fields.title}
            onChange={set('title')}
            data-testid="own-title"
            aria-required="true"
          />
        </div>

        <div className="oq-field">
          <label className="oq-label" htmlFor={ids.line}>{OQ.line} <span className="oq-opt">{OQ.optional}</span></label>
          <input id={ids.line} className="oq-input" value={fields.detail} onChange={set('detail')} placeholder={OQ.linePlaceholder} data-testid="own-line" />
        </div>

        <div className="oq-field">
          <label className="oq-label" htmlFor={ids.note}>{OQ.note} <span className="oq-opt">{OQ.optional}</span></label>
          <input id={ids.note} className="oq-input" value={fields.note} onChange={set('note')} placeholder={OQ.notePlaceholder} aria-describedby={ids.never} data-testid="own-note" />
          <p className="oq-never" id={ids.never}>
            <Icon name="Lock" weight="bold" size={12} color="currentColor" />
            {OQ.neverShown}
          </p>
        </div>

        <p className="oq-runs"><b>{OQ.runsLike}</b> {OQ.runsLikeRest}</p>

        {mode === 'add' ? (
          <div className="oq-where">
            <p className="oq-label" id={ids.where}>{OQ.where}</p>
            <div className="oq-places" role="radiogroup" aria-labelledby={ids.where} onKeyDown={onRadioKey}>
              {PLACES.map((p) => {
                const off = p === 'now' && !canNow;
                const lineId = `${uid}-${p}-line`;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    ref={(el) => { radioRefs.current[p] = el; }}
                    aria-checked={place === p}
                    aria-disabled={off ? 'true' : undefined}
                    aria-describedby={lineId}
                    tabIndex={place === p || off ? 0 : -1}
                    className={`oq-place${place === p ? ' is-on' : ''}${off ? ' is-off' : ''}`}
                    onClick={() => choose(p)}
                    data-testid={`own-place-${p}`}
                  >
                    <span className="oq-place-k">{OQ[p]}</span>
                    <span className="oq-place-l" id={lineId}>{placeLine[p]}</span>
                  </button>
                );
              })}
            </div>
            {place === 'later' ? (
              laterOptions.length ? (
                <label className="oq-after">
                  <span className="oq-after-k">{OQ.after}</span>
                  <select className="oq-select" value={anchorKey} onChange={(e) => setAnchorKey(e.target.value)} data-testid="own-anchor">
                    {laterOptions.map((o) => (
                      <option key={o.key} value={o.key}>{`round ${o.round}${o.title ? ` · ${o.title}` : ''}`}</option>
                    ))}
                  </select>
                </label>
              ) : <p className="oq-hint">{OQ.noLater}</p>
            ) : null}
          </div>
        ) : null}

        {title ? (
          <div className="oq-preview" aria-label={OQ.preview}>
            <p className="oq-preview-k">{OQ.preview}</p>
            <div className="oq-preview-card">
              {nextRound ? <p className="oq-preview-n">{OQ.roundN(place === 'later' && anchor ? anchor.round + 1 : nextRound)}</p> : null}
              <p className="oq-preview-t">{title}</p>
              {fields.detail.trim() ? <p className="oq-preview-d">{fields.detail.trim()}</p> : null}
            </div>
          </div>
        ) : null}

        {confirming ? (
          <div className="oq-confirm" role="alert" data-testid="own-confirm">
            <p className="oq-confirm-t"><b>{OQ.discardTitle}</b> {OQ.discardBody}</p>
            <div className="oq-confirm-acts">
              <Button variant="secondary" size={touch ? 44 : 36} onClick={() => setConfirming(false)}>{OQ.keepWriting}</Button>
              <Button variant="danger" size={touch ? 44 : 36} onClick={onClose} data-testid="own-discard">{OQ.discard}</Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="oq-error" role="alert">{error}</p> : null}
      </div>

      <div className="oq-foot">
        <Button variant="secondary" size={touch ? 56 : 44} onClick={requestClose} data-testid="own-cancel">{OQ.cancel}</Button>
        <span className="oq-foot-gap" />
        {!canCommit && reason ? <span className="oq-reason" id={ids.reason}>{reason}</span> : null}
        <Button
          type="submit"
          variant={touch ? 'primary' : 'secondary'}
          size={touch ? 56 : 44}
          className={touch ? 'oq-commit' : 'oq-commit oq-commit--strong'}
          disabled={!canCommit}
          aria-describedby={!canCommit && reason ? ids.reason : undefined}
          data-testid="own-commit"
        >
          {touch ? null : <Icon name="Check" weight="bold" size={16} color="currentColor" />}
          {label}
        </Button>
      </div>
    </form>
  );
}
