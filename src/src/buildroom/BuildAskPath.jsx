/**
 * THE CURRENT ASK, AS FOUR STEPS (owner, 2026-10-07: "there is a lot of
 * scrolling and its unclear what to do ... always moving the focus to where
 * they likely should be going next"; docs/design/build-room-host-flow H2-H4).
 *
 *   1 Ask        done once it is live; opens to Edit wording and Discard
 *   2 Collect    the room answers; Close and show results (or Open voting)
 *   3 Settle     go with the room's choice, spin, vote again, or pick
 *   4 Send       the direction for Claude, the cursor already in it
 *
 * A done step folds to one line (askPathSummaries), the open step has one
 * primary move marked `data-next-primary`, and the steps still to come are
 * greyed and do nothing. Which step is open is askPathStep's rule alone.
 * Focus follows the step (useNextFocus); Space on the Host screen presses the
 * primary (BuildRoom's key handler).
 */
import React, { useRef, useState } from 'react';
import { askPathStep, askPathSummaries, winnerOf, decisionChoices } from './buildScreens';
import { useNextFocus } from './useNextFocus';
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

const ratingAvg = (ask) => {
  const r = ask.results && ask.results.rating;
  return r && r.avg !== null && r.avg !== undefined ? r.avg : null;
};

function Step({ n, state, title, summary, open, onToggle, children }) {
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

const SpaceHint = () => <span className="brm-spacehint" aria-hidden="true"><kbd>Space</kbd></span>;

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
          <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !prompt.trim()} onClick={save}>Save wording</button>
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

export function AskPath({ ask, room, busy, ended, run, api, pickId = null, onPick, answering = false, setAnswering, onSent }) {
  const ref = useRef(null);
  const [opened, setOpened] = useState(null); // a done step opened by a click
  const step = askPathStep(ask, { pickId, answering });
  const sums = askPathSummaries(ask, { pickId, playerCount: room.playerCount });
  const at = ORDER.indexOf(step);
  const stateOf = (name) => {
    const i = ORDER.indexOf(name);
    return i < at ? 'done' : i === at ? 'now' : 'next';
  };
  const act = (action) => run(() => api.askAction(ask.askId, { action }));
  const tied = (ask.results && ask.results.tied) || [];
  const wheel = ask.wheel && !ask.revotedAs ? ask.wheel : null;
  const win = ask.kind === 'rating' ? null : winnerOf({ ...ask, wheel: null });
  const avg = ask.kind === 'rating' ? ratingAvg(ask) : null;
  // The settle move, so a spin or a tie moves the focus as a new step does.
  let mode = '';
  if (step === 'settle') mode = wheel ? 'wheel' : ask.kind === 'rating' ? 'rating' : win ? 'winner' : 'none';
  useNextFocus(ref, `${ask.askId}:${step}:${mode}`);

  const toggle = (name) => () => setOpened((o) => (o === name ? null : name));
  const host = !ended;
  const board = <AskStage ask={ask} host busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={host ? onPick : null} pathMode />;

  // ── 2 Collect ──
  let collectBody = null;
  if (stateOf('collect') === 'now') {
    const ideasOpen = ask.status === 'live' && ask.kind === 'suggest';
    collectBody = (
      <>
        {board}
        {host && (
          <div className="brm-path-row">
            {ideasOpen
              ? <button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => act('vote')}>Open voting</button>
              : <button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => act('close')}>Close and show results</button>}
            <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => setAnswering(true)}>Answer for the room</button>
            {/* The wheel instead of a vote (owner, 2026-10-06): close it and let chance pick. */}
            {ask.kind !== 'rating' && (
              <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} title="Close it and let the wheel pick from every option" onClick={() => act('wheel')}>Spin instead</button>
            )}
            {ideasOpen && <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => act('close')}>Close without a vote</button>}
            <SpaceHint />
          </div>
        )}
      </>
    );
  } else if (host && ask.status === 'results') {
    collectBody = (
      <div className="brm-path-row">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => act('reopen')}>Reopen</button>
        <span className="brm-hint">Opens it to the room again.</span>
      </div>
    );
  }

  // ── 3 Settle ──
  let settleBody = null;
  if (stateOf('settle') === 'now') {
    let moves = null;
    if (host && !wheel && !ask.revotedAs) {
      if (ask.kind === 'rating') {
        moves = avg !== null
          ? <button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => onPick(String(avg), { confirmed: true })}>Go with the average</button>
          : <><span className="brm-hint">Nobody has rated it yet.</span><button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => act('reopen')}>Reopen</button></>;
      } else if (win) {
        const pick = decisionChoices(ask).find((c) => c.id === win);
        moves = (
          <>
            <button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => onPick(win, { confirmed: true })}>
              {pick && pick.label ? `Go with ${pick.label}` : 'Go with the top idea'}
            </button>
            <button type="button" className="brm-btn" disabled={busy} onClick={() => act('wheel')}>Spin the wheel</button>
          </>
        );
      } else {
        moves = (
          <>
            <button type="button" className="brm-btn brm-btn--primary" data-next-primary disabled={busy} onClick={() => act('wheel')}>Spin the wheel</button>
            {tied.length >= 2 && <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => act('revote')}>Vote again</button>}
          </>
        );
      }
    }
    settleBody = (
      <>
        {board}
        {host && (wheel || ask.revotedAs) && <WheelPanel ask={ask} busy={busy} run={run} api={api} primary />}
        {moves && <div className="brm-path-row">{moves}<SpaceHint /></div>}
        {host && !wheel && ask.kind !== 'rating' && (
          <p className="brm-hint">
            {win ? 'Or click another option to pick it instead; you will be asked first.'
              : tied.length >= 2 ? 'Spin the wheel, ask the room to vote again, or click an option to pick it.'
                : 'Let chance pick, or click an option to pick it yourself.'}
          </p>
        )}
      </>
    );
  } else if (stateOf('settle') === 'done' && host && !answering) {
    // Opened again: the board to pick another, and the wheel to spin again.
    settleBody = (
      <>
        {board}
        {wheel && <WheelPanel ask={ask} busy={busy} run={run} api={api} />}
        {ask.kind !== 'rating' && <p className="brm-hint">Click another option to pick it instead; you will be asked first.</p>}
      </>
    );
  }

  // ── 4 Send ──
  let sendBody = null;
  if (stateOf('send') === 'now' && host) {
    const sent = (out) => onSent && onSent(out);
    sendBody = answering
      ? <DecidePanel ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} spoken onCancel={() => setAnswering(false)} next onSent={sent} />
      : <DecidePanel key={`wheel:${wheel ? wheel.spins.length : 0}`} ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} pickId={ask.kind === 'rating' ? null : pickId} next onSent={sent} />;
  }

  let settleTitle = 'Settle: go with the room, spin or pick';
  if (stateOf('settle') === 'now') settleTitle = 'Settle';
  else if (stateOf('settle') === 'done') {
    if (answering) settleTitle = 'You answer for the room';
    else if (ask.kind === 'rating') settleTitle = `Going with the average, ${avg !== null ? avg : pickId} out of 5`;
    else settleTitle = settleSummary(ask, pickId, sums) || 'Settled';
  }

  return (
    <ol className="brm-path" aria-label="This ask" ref={ref}>
      <Step n={1} state="done" title={`Ask: ${ask.prompt}`} summary={`${sums.ask} · ${KIND_LABEL[ask.kind] || 'Ask'}`}
        open={opened === 'ask'} onToggle={host ? toggle('ask') : null}>
        {host && <AskWording key={ask.prompt} ask={ask} busy={busy} run={run} api={api} />}
      </Step>
      <Step n={2} state={stateOf('collect')} title={collectTitle(ask, stateOf('collect') === 'done' && !answering)} summary={sums.collect}
        open={opened === 'collect'} onToggle={collectBody ? toggle('collect') : null}>
        {collectBody}
      </Step>
      <Step n={3} state={stateOf('settle')} title={settleTitle} summary={stateOf('settle') === 'now' ? settleLine(ask) : ''}
        open={opened === 'settle'} onToggle={settleBody ? toggle('settle') : null}>
        {settleBody}
      </Step>
      <Step n={4} state={stateOf('send')} title="Send to Claude">
        {sendBody}
      </Step>
    </ol>
  );
}

export default AskPath;
