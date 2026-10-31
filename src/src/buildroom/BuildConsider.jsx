/**
 * CONSIDER, AND THE "SENT TO CLAUDE" MARKS (docs/design/build-room-consider,
 * frames 2-5; owner, 19 Oct 2026: "when voting is done, as answers come in, or
 * when their is an ask and ideas come in have the ability to consider an item
 * where you get a choice to queue up to the room, or send to claude at any
 * time. this does not remove the normal process flow").
 *
 * ConsiderContext   what the host's page hands every list: the marks
 *                   (sentMarks), open(item) for the panel, openHistory(entryId)
 * ItemTools         a row's mark and its Consider button
 * SentMark          a tick and "Sent to Claude", "…, reworded", "…, for later", or
 *                   "Queued for the room"; a sent mark opens History at its entry
 * ConsiderPanel     the one panel, two doors: Queue for the room (the room's
 *                   words; yes/no, feedback, or add to a vote) and Send to Claude
 *                   (editable words, a Why Claude reads and History keeps, Now or
 *                   Later). Esc or X closes it; what was typed is kept for next time.
 *
 * Nothing here names anyone: the panel quotes the room's words, never who said them.
 */
import React, { createContext, useContext, useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { W } from './words';
import { MARK_WORDS } from './sentMarks';
import { SendExtras, useMirror } from './BuildSendOptions';

export const ConsiderContext = createContext(null);

const WHY_MAX = 500;
const askNo = (askId) => Number(askId) || askId;

/** One mark. With `onOpen` and an entry a sent mark is a button that opens History there. */
export function SentMark({ mark, onOpen = null }) {
  if (!mark) return null;
  // Queued for Claude while Claude Code has never called in (QA walk on test, 31 Oct 2026): no tick, nothing went.
  const words = mark.claudeQueued ? W.queuedHeadline : MARK_WORDS[mark.mark];
  if (!words) return null;
  const cls = `brm-mark brm-mark--${mark.claudeQueued ? 'queued' : mark.mark}`;
  const tick = mark.mark !== 'queued' && !mark.claudeQueued ? <Icon name="Check" size={12} aria-hidden="true" /> : null;
  if (onOpen && mark.entryId && mark.mark !== 'queued') {
    return (
      <button type="button" className={`${cls} brm-mark--link`} title={W.markOpens} onClick={(e) => { e.stopPropagation(); onOpen(mark.entryId); }}>
        {tick}{words}
      </button>
    );
  }
  return <span className={cls}>{tick}{words}</span>;
}

/** The mark alone, for a list that offers no Consider (Asks, Decided). */
export function ItemMark({ itemKey }) {
  const c = useContext(ConsiderContext);
  if (!c) return null;
  return <SentMark mark={c.marks.get(itemKey)} onOpen={c.openHistory} />;
}

/**
 * A row's tools: its mark, and Consider while the session runs. `item`:
 * `{ key, words, askId?, type, ideaId? }`. Renders nothing outside the host's page.
 */
export function ItemTools({ item, consider = true }) {
  const c = useContext(ConsiderContext);
  if (!c || !item || !item.key) return null;
  const mark = c.marks.get(item.key);
  return (
    <span className="brm-itools">
      <SentMark mark={mark} onOpen={c.openHistory} />
      {consider && !c.ended && (
        <button type="button" className="brm-btn brm-btn--sm brm-consider" aria-label={`${W.consider}: ${item.words}`} onClick={(e) => { e.stopPropagation(); c.open(item); }}>
          {W.consider}
        </button>
      )}
    </span>
  );
}

const ROUNDS = Object.freeze([
  { key: 'yesno', label: W.considerYesNo, note: W.considerAskNote },
  { key: 'feedback', label: W.considerFeedback, note: W.considerAskNote },
  { key: 'vote', label: W.considerToVote, note: W.considerVoteNote },
]);

/** What a fresh panel starts with: the room's words, Send to Claude. */
export const freshDraft = (item) => ({ door: 'claude', text: item.words || '', why: '', round: 'yesno', question: '', hide: false });

/**
 * The panel. `draft`/`setDraft` live with the page, so Esc loses nothing.
 * `canIdeas`: an Ideas ask is open, so an idea can join it (the card's own door, here too).
 */
export function ConsiderPanel({ item, draft, setDraft, api, run, busy, canIdeas = false, onClose, onDone = () => {} }) {
  const d = draft || freshDraft(item);
  const set = (patch) => setDraft({ ...d, ...patch });
  const [error, setError] = useState('');
  const mirror = useMirror();
  const changed = d.text.trim() !== String(item.words || '').trim();
  const rounds = item.type === 'idea' && canIdeas ? [...ROUNDS, { key: 'ideas', label: W.considerToIdeas, note: W.considerIdeasNote }] : ROUNDS;
  const round = rounds.find((r) => r.key === d.round) || rounds[0];
  const asksQuestion = round.key === 'yesno' || round.key === 'feedback';

  const go = async (call) => {
    setError('');
    const out = await run(call);
    if (out === undefined) { setError(W.notSent); return; }
    mirror.done();
    onDone();
    onClose();
  };
  const send = (later) => go(() => api.consider({
    item: item.key, go: later ? 'later' : 'send', text: d.text.trim(), ...(d.why.trim() ? { why: d.why.trim() } : {}),
    ...(d.hide ? { hideFromRoom: true } : {}),
  }));
  const queue = () => go(() => (round.key === 'ideas'
    ? api.ideaAction(item.ideaId, 'suggest')
    : api.consider({ item: item.key, go: 'queue', round: round.key, ...(asksQuestion && d.question.trim() ? { prompt: d.question.trim() } : {}) })));

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--consider" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-consider-q">
      <div className="brm-pa-head">
        <div>
          <div className="brm-pa-eb">{W.considerEyebrow(item.askId ? askNo(item.askId) : null)}</div>
          <h2 className="brm-pa-q brm-consider-q" id="brm-consider-q">{`“${item.words}”`}</h2>
        </div>
        <button type="button" className="brm-x" onClick={onClose} aria-label="Close this window"><Icon name="X" size={16} /></button>
      </div>
      <div className="brm-consider-doors" role="radiogroup" aria-label={W.consider}>
        <button type="button" role="radio" aria-checked={d.door === 'room'} className={`brm-cdoor${d.door === 'room' ? ' is-on' : ''}`} onClick={() => set({ door: 'room' })}>
          <b>{W.considerQueue}</b>
          <span>{W.considerQueueHint}</span>
        </button>
        <button type="button" role="radio" aria-checked={d.door === 'claude'} className={`brm-cdoor${d.door === 'claude' ? ' is-on' : ''}`} onClick={() => set({ door: 'claude' })}>
          <b>{W.considerSend}</b>
          <span>{W.considerSendHint}</span>
        </button>
      </div>

      {d.door === 'claude' ? (
        <>
          <label className="brm-field">
            <span className="brm-lbl">{W.considerWords}</span>
            <textarea className="brm-input brm-ta brm-ta--sm" value={d.text} maxLength={2000} onChange={(e) => { set({ text: e.target.value }); mirror.draft(e.target.value); }} />
          </label>
          <label className="brm-field">
            <span className="brm-lbl">{W.considerWhy}</span>
            <input className="brm-input" value={d.why} maxLength={WHY_MAX} onChange={(e) => set({ why: e.target.value })} />
          </label>
          {changed && <p className="brm-hint" data-testid="brm-consider-changed">{W.considerChanged}</p>}
          <SendExtras hide={Boolean(d.hide)} setHide={(v) => set({ hide: v })} disabled={busy} />
        </>
      ) : (
        <>
          <div className="brm-field">
            <span className="brm-lbl">{W.considerRound}</span>
            <div className="brm-seg" role="radiogroup" aria-label={W.considerRound}>
              {rounds.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={round.key === r.key} className={`brm-segbtn${round.key === r.key ? ' is-on' : ''}`} onClick={() => set({ round: r.key })}>{r.label}</button>
              ))}
            </div>
            <span className="brm-hint">{round.note}</span>
          </div>
          {asksQuestion && (
            <label className="brm-field">
              <span className="brm-lbl">{W.considerQuestion}</span>
              <input className="brm-input" value={d.question} maxLength={300} placeholder={round.key === 'yesno' ? W.considerYesNoQ : W.considerFeedbackQ} onChange={(e) => set({ question: e.target.value })} />
            </label>
          )}
        </>
      )}
      {error && <p className="brm-alert" role="alert">{error}</p>}
      <div className="brm-sd-foot">
        {d.door === 'claude' ? (
          <>
            <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !d.text.trim()} onClick={() => send(false)}>
              <Icon name="PaperPlaneTilt" size={16} /> {W.sendNow}
            </button>
            <button type="button" className="brm-btn" disabled={busy || !d.text.trim()} onClick={() => send(true)}>{W.later}</button>
          </>
        ) : (
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy} onClick={queue}>{W.considerQueue}</button>
        )}
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Close</button>
        <span className="brm-hint brm-push">{W.considerEsc}</span>
      </div>
    </Modal>
  );
}
