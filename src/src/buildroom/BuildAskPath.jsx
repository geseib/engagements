/**
 * THE CURRENT ASK, AS FOUR STEPS (owner, 2026-10-07: "there is a lot of
 * scrolling and its unclear what to do ... always moving the focus to where
 * they likely should be going next"; docs/design/build-room-host-flow H2-H4).
 *
 *   1 Ask        done once it is live; opens to Edit wording and Discard
 *   2 Collect    the room answers; Show results (or Open voting)
 *   3 Settle     Send B to Claude in one press, or spin, vote again, or pick
 *   4 Change before sending   the direction and the kind, the cursor in it
 *
 * A done step folds to one line (askPathSummaries), the open step has one
 * primary move marked `data-next-primary`, and the steps still to come are
 * greyed and do nothing. Which step is open is askPathStep's rule alone.
 * Focus follows the step (useNextFocus); Space on the Host screen presses the
 * primary (BuildRoom's key handler).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  askPathStep, askPathSummaries, winnerOf, decisionChoices, settleMove, settleWords, decideBody, claudeKindLabel, defaultKind,
} from './buildScreens';
import { useNextFocus } from './useNextFocus';
import { W } from './words';
import ActionRow from './BuildActionRow';
import { AskStage, WheelPanel, DecidePanel, KIND_LABEL } from './BuildRoomPage';

const ORDER = ['ask', 'collect', 'settle', 'send'];

/** What the room is doing while it answers, and what it did once it has. */
function collectTitle(ask, done) {
  if (ask.status === 'voting') return done ? 'The room voted' : 'The room is voting';
  if (ask.kind === 'suggest') return done ? 'The room suggested' : 'The room is suggesting';
  if (ask.kind === 'rating') return done ? 'The room rated' : 'The room is rating';
  return done ? 'The room chose' : 'The room is choosing';
}

/** "B leads, 7 to 4", "A tie: A and B", or nothing yet. */
function settleLine(ask) {
  const tied = (ask.results && ask.results.tied) || [];
  if (tied.length >= 2 && ask.kind === 'choice') return `A tie: ${tied.join(' and ')}`;
  if (tied.length >= 2) return 'A tie';
  const win = winnerOf({ ...ask, wheel: null });
  if (!win) return '';
  const choices = decisionChoices(ask);
  const w = choices.find((c) => c.id === win);
  const next = Math.max(0, ...choices.filter((c) => c.id !== win).map((c) => c.count));
  return w && w.label ? `${w.label} leads, ${w.count} to ${next}` : 'The top idea leads';
}

/**
 * What Settle folded to. askPathSummaries words a Choose ask by its letters;
 * an idea has no letter and its id means nothing to the host, so an Ideas ask
 * is worded here by what the idea says, counted by its votes.
 */
export function settleSummary(ask, pickId, summaries) {
  if (ask.kind !== 'suggest') return summaries.settle;
  const choices = decisionChoices(ask);
  const said = (id) => {
    const c = choices.find((x) => x.id === id);
    const t = c ? c.text : '';
    return `"${t.length > 40 ? `${t.slice(0, 40).trimEnd()}…` : t}"`;
  };
  const landed = ask.wheel && ask.wheel.landed;
  if (landed) return !pickId || pickId === landed ? `The wheel picked ${said(landed)}` : `Going with ${said(pickId)}, your pick instead of the wheel's ${said(landed)}`;
  if (!pickId) return '';
  const leader = winnerOf({ ...ask, wheel: null });
  if (!leader) return `Going with ${said(pickId)}, your pick`;
  if (leader !== pickId) return `Going with ${said(pickId)}, your pick instead of ${said(leader)}`;
  const votes = (choices.find((c) => c.id === pickId) || { count: 0 }).count;
  const next = Math.max(0, ...choices.filter((c) => c.id !== pickId).map((c) => c.count));
  return `Going with ${said(pickId)}, the room's choice, ${votes} to ${next}`;
}

/** As the Stage dock: never on a rating, and an Ideas ask needs two ideas first. */
const canSpinInstead = (ask) => ask.kind !== 'rating'
  && (ask.kind !== 'suggest' || ask.status !== 'live' || (ask.answerCount || 0) >= 2);

const ratingAvg = (ask) => {
  const r = ask.results && ask.results.rating;
  return r && r.avg !== null && r.avg !== undefined ? r.avg : null;
};

export function Step({ n, state, title, summary, open, onToggle, children }) {
  const head = (
    <>
      <span className="brm-path-n" aria-hidden="true">{n}</span>
      <span className="brm-path-t">{title}</span>
      {summary && <span className="brm-path-s">{summary}</span>}
    </>
  );
  return (
    <li className={`brm-path-step is-${state}${open ? ' is-open' : ''}`}>
      {state === 'done' && onToggle
        ? <button type="button" className="brm-path-head" aria-expanded={open} onClick={onToggle}>{head}</button>
        : <div className="brm-path-head">{head}</div>}
      {children && (state === 'now' || open) && <div className="brm-path-body">{children}</div>}
    </li>
  );
}

/** The Ask step, opened: the wording, Edit wording and Discard. */
function AskWording({ ask, busy, run, api }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const save = async () => {
    const ok = await run(() => api.askAction(ask.askId, { action: 'edit', prompt, detail }));
    if (ok !== undefined) setEditing(false);
  };
  if (editing) {
    return (
      <div className="brm-path-edit">
        <label className="brm-field"><span className="brm-lbl">Question</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
        <label className="brm-field"><span className="brm-lbl">Context</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></label>
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { setEditing(false); setPrompt(ask.prompt); setDetail(ask.detail || ''); }}>Cancel</button>
          <button type="button" className="brm-btn brm-push" disabled={busy || !prompt.trim()} onClick={save}>Save wording</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {ask.detail && <p className="brm-detail">{ask.detail}</p>}
      <div className="brm-path-row">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setEditing(true)}>Edit wording</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => run(() => api.askAction(ask.askId, { action: 'discard' }))}>Discard</button>
      </div>
    </>
  );
}


/**
 * `draft` / `onDraft` (Review Focus 2): BuildRoom keeps what the host typed in
 * Change before sending for each ask, so another ask opening does not lose it.
 * A draft is used only for the same pick (or the same spoken answer) it was
 * written for.
 */
export function AskPath({ ask, room, busy, ended, run, api, pickId = null, onPick, answering = false, setAnswering, onSent, draft = null, onDraft, quiet = false }) {
  const ref = useRef(null);
  // A dialog over the Host holds the one orange; this step's main move is outline until it closes.
  const hot = quiet ? '' : ' brm-btn--primary';
  const [opened, setOpened] = useState(null); // a done step opened by a click
  const [said, setSaid] = useState(''); // a confirmation, in the row's hint slot
  useEffect(() => {
    if (!said) return undefined;
    const t = setTimeout(() => setSaid(''), 4000);
    return () => clearTimeout(t);
  }, [said]);
  const sending = useRef(false); // one send at a time, however fast the presses
  const step = askPathStep(ask, { pickId, answering });
  const sums = askPathSummaries(ask, { pickId, playerCount: room.playerCount });
  const at = ORDER.indexOf(step);
  const stateOf = (name) => {
    const i = ORDER.indexOf(name);
    return i < at ? 'done' : i === at ? 'now' : 'next';
  };
  const act = (action, confirmation = '') => async () => {
    const out = await run(() => api.askAction(ask.askId, { action }));
    if (out !== undefined && confirmation) setSaid(confirmation);
    return out;
  };
  const tied = (ask.results && ask.results.tied) || [];
  const wheel = ask.wheel && !ask.revotedAs ? ask.wheel : null;
  // WHERE IT LANDED IS HELD BACK until the wheel stops: the move is not offered
  // (or focused, or pressed by Space) while the projector is still turning, or
  // the result is given away. A wheel already still when this mounts is settled.
  const lastSpin = wheel && wheel.spins && wheel.spins.length ? wheel.spins[wheel.spins.length - 1].spinId : null;
  const [settledSpin, setSettledSpin] = useState(lastSpin);
  const turning = Boolean(wheel && wheel.landed && lastSpin && lastSpin !== settledSpin);
  const win = ask.kind === 'rating' ? null : winnerOf({ ...ask, wheel: null });
  const avg = ask.kind === 'rating' ? ratingAvg(ask) : null;
  // The settle move, so a spin or a tie moves the focus as a new step does.
  let mode = '';
  if (step === 'settle') mode = wheel ? (wheel.landed ? `landed:${wheel.spins.length}` : 'wheel') : ask.kind === 'rating' ? 'rating' : win ? 'winner' : 'none';
  useNextFocus(ref, `${ask.askId}:${step}:${mode}`);

  const toggle = (name) => () => setOpened((o) => (o === name ? null : name));
  const host = !ended;
  const board = <AskStage ask={ask} host busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={host ? onPick : null} pathMode />;
  const then = (names) => <p className="brm-then">{W.nextSteps(names)}</p>;

  // ── 2 Collect ──
  let collectBody = null;
  if (stateOf('collect') === 'now') {
    const ideasOpen = ask.status === 'live' && ask.kind === 'suggest';
    collectBody = (
      <>
        {board}
        {then(['3 Settle', '4 Send to Claude'])}
        {host && (
          <ActionRow space={!said} hint={said || W.spaceTo(ideasOpen ? 'open voting' : 'show results')}>
            {ideasOpen && <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={act('close', W.resultsUp)}>Close without a vote</button>}
            <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => setAnswering(true)}>Answer for the room</button>
            {/* The wheel instead of a vote (owner, 2026-10-06): close it and let chance pick. */}
            {canSpinInstead(ask) && (
              <button type="button" className="brm-btn" disabled={busy} title="Close it and let the wheel pick from every option" onClick={act('wheel')}>{W.spin}</button>
            )}
            {ideasOpen
              ? <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy} onClick={act('vote', W.votingOpen)}>{W.openVoting}</button>
              : <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy} onClick={act('close', W.resultsUp)}>{W.showResults}</button>}
          </ActionRow>
        )}
      </>
    );
  } else if (host && ask.status === 'results') {
    collectBody = (
      <div className="brm-path-row">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={act('reopen')}>Reopen</button>
        <span className="brm-hint">Opens it to the room again.</span>
      </div>
    );
  }

  // ── 3 Settle ──
  // ONE PRESS SENDS (owner, 2026-10-08, F3): the room's pick, its sentence, the
  // question's own kind. The line under the board says what goes first.
  // A direction the host already edited for this very pick is what goes (and says it will).
  const move = !wheel || wheel.landed ? settleMove(ask, draft) : null;
  const kind = move ? move.kind : defaultKind(ask);
  const held = kind === 'later'; // a set that says Later: the press saves it, nothing goes to Claude
  const kindName = claudeKindLabel(kind);
  const sendLabel = settleWords(ask, kind).label;
  const spaceWords = W.spaceTo(held ? 'save for later' : `send, as ${kindName}`);
  const sendWinner = async () => {
    if (!move || sending.current) return undefined;
    sending.current = true;
    try {
      const out = await run(() => api.askAction(ask.askId, decideBody(ask, { direction: move.direction, chosen: move.chosen, as: kind })));
      if (out !== undefined && onSent) onSent({ as: kind, send: true, direction: move.direction });
      return out;
    } finally { sending.current = false; }
  };
  let settleBody = null;
  if (stateOf('settle') === 'now') {
    let row = null;
    const change = (id) => <button type="button" className="brm-btn" disabled={busy || turning} onClick={() => onPick(id, { confirmed: true })}>{W.change}</button>;
    if (host && wheel && wheel.landed) {
      // Where it landed is the room's way on (H3); Spin again is the row's.
      row = (
        <ActionRow space={!said} hint={turning ? '' : said || spaceWords}>
          <button type="button" className="brm-btn" disabled={busy || turning} onClick={act('spin')}>{W.spinAgain}</button>
          {change(wheel.landed)}
          <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy || turning || !move || !move.direction} onClick={sendWinner}>
            {turning ? 'The wheel is turning…' : sendLabel}
          </button>
        </ActionRow>
      );
    } else if (host && !wheel && !ask.revotedAs) {
      if (ask.kind === 'rating') {
        row = avg !== null
          ? (
            <ActionRow space={!said} hint={said || spaceWords}>
              {change(String(avg))}
              <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy || !move} onClick={sendWinner}>{sendLabel}</button>
            </ActionRow>
          )
          : (
            <ActionRow hint="Nobody has rated it yet.">
              <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy} onClick={act('reopen')}>Reopen</button>
            </ActionRow>
          );
      } else if (win) {
        row = (
          <ActionRow space={!said} hint={said || spaceWords}>
            <button type="button" className="brm-btn" disabled={busy} onClick={act('wheel')}>{W.spin}</button>
            {change(win)}
            <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy || !move || !move.direction} onClick={sendWinner}>{sendLabel}</button>
          </ActionRow>
        );
      } else {
        row = (
          <ActionRow space={!said} hint={said || W.spaceTo('spin the wheel')}>
            {tied.length >= 2 && <button type="button" className="brm-btn" disabled={busy} onClick={act('revote', W.votingAgain)}>{W.voteAgain}</button>}
            <button type="button" className={`brm-btn${hot}`} data-next-primary disabled={busy} onClick={act('wheel')}>{W.spin}</button>
          </ActionRow>
        );
      }
    }
    const note = ask.claudeNote || '';
    const told = host && move && move.direction && !turning
      ? <p className="brm-hint brm-told">{held ? W.toldLater(move.direction, note) : W.told(kind, kindName, move.direction, note)}</p> : null;
    settleBody = (
      <>
        {board}
        {host && (wheel || ask.revotedAs) && <WheelPanel ask={ask} busy={busy} run={run} api={api} primary={!quiet && !(wheel && wheel.landed)} spinInRow={Boolean(wheel && wheel.landed)} onSettled={setSettledSpin} />}
        {told}
        {host && !wheel && ask.kind !== 'rating' && (
          <p className="brm-hint">
            {win ? 'Click another option to pick it instead; you will be asked first.'
              : tied.length >= 2 ? 'Spin the wheel, ask the room to vote again, or click an option to pick it.'
                : 'Let chance pick, or click an option to pick it yourself.'}
          </p>
        )}
        {then(['4 Change before sending'])}
        {row}
      </>
    );
  } else if (stateOf('settle') === 'done' && host && !answering) {
    // Opened again: the board to pick another, and the wheel to spin again.
    settleBody = (
      <>
        {board}
        {/* The wheel to spin again, or with none yet: spin it, or vote again on a tie. */}
        {ask.kind !== 'rating' && <WheelPanel ask={ask} busy={busy} run={run} api={api} />}
        {ask.kind !== 'rating' && <p className="brm-hint">Click another option to pick it instead; you will be asked first.</p>}
      </>
    );
  }

  // ── 4 Change before sending ──
  let sendBody = null;
  if (stateOf('send') === 'now' && host) {
    const sent = (out) => onSent && onSent(out);
    const forThis = draft && draft.spoken === answering && (answering || draft.pickId === pickId) ? draft : null;
    const keep = onDraft ? (d) => onDraft({ ...d, pickId: answering ? null : pickId, spoken: answering }) : undefined;
    sendBody = answering
      ? <DecidePanel ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} spoken onCancel={() => setAnswering(false)} next onSent={sent} draft={forThis} onDraft={keep} />
      : <DecidePanel key={`wheel:${wheel ? wheel.spins.length : 0}`} ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} pickId={ask.kind === 'rating' ? null : pickId} next onSent={sent} draft={forThis} onDraft={keep} />;
  }

  let settleTitle = 'Settle';
  if (stateOf('settle') === 'done') {
    if (answering) settleTitle = 'You answer for the room';
    else if (ask.kind === 'rating') settleTitle = `Going with the average, ${avg !== null ? avg : pickId} out of 5`;
    else settleTitle = settleSummary(ask, pickId, sums) || 'Settled';
  }
  const shown = (name) => stateOf(name) !== 'next';

  return (
    <ol className="brm-path" aria-label="This ask" ref={ref}>
      <Step n={1} state="done" title={`Ask: ${ask.prompt}`} summary={`${sums.ask} · ${KIND_LABEL[ask.kind] || 'Ask'}`}
        open={opened === 'ask'} onToggle={host ? toggle('ask') : null}>
        {host && <AskWording key={ask.prompt} ask={ask} busy={busy} run={run} api={api} />}
      </Step>
      {shown('collect') && (
        <Step n={2} state={stateOf('collect')} title={collectTitle(ask, stateOf('collect') === 'done' && !answering)} summary={sums.collect}
          open={opened === 'collect'} onToggle={collectBody ? toggle('collect') : null}>
          {collectBody}
        </Step>
      )}
      {shown('settle') && (
        <Step n={3} state={stateOf('settle')} title={settleTitle} summary={stateOf('settle') === 'now' ? settleLine(ask) : ''}
          open={opened === 'settle'} onToggle={settleBody ? toggle('settle') : null}>
          {settleBody}
        </Step>
      )}
      {shown('send') && (
        <Step n={4} state={stateOf('send')} title={answering ? W.sendPlain : W.change}>
          {sendBody}
        </Step>
      )}
    </ol>
  );
}

export default AskPath;
