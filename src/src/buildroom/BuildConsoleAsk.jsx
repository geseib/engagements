/**
 * THE ASK IN THE CONSOLE'S MAIN AREA (parity PLAN B8; docs/design/
 * build-room-console views 1b and 1c). On one screen the Host screen walks an
 * ask as four steps (BuildAskPath); on two screens the laptop is private and
 * wide, so the same ask is one panel: the question, the board, and beside it
 * what the host works with in this moment.
 *
 *   collecting  the board (a pick asks first, and closes the vote), the note
 *               for Claude, and the ask's quieter moves: Edit wording,
 *               Discard, Answer for the room, Close without a vote
 *   settle      the board, pressable (the wall's has no controls, so the
 *               pick happens here), the wheel when there is one, and the
 *               decide panel drawn open: Claude gets it as, the direction,
 *               the note, Save for later, Record only. Send is the main
 *               button in "Your part now" (`sendRef`), so there is one Send.
 *   answering   the decide panel in its spoken form, with Cancel
 *
 * Every press is the Host screen's own: the same AskStage, WheelPanel,
 * DecidePanel and AskWording, the same api calls. Drafts are kept per ask by
 * the page, as on one screen.
 */
import React from 'react';
import { AskStage } from './screens/AskStage';
import { WheelPanel, DecidePanel } from './BuildRoomPage';
import { AskWording } from './BuildAskPath';
import { askPathStep } from './buildScreens';
import { KIND_LABEL, askNumber } from './screens/common';
import { W } from './words';
import { BCW } from './buildConsole';

const STEP_WORD = { collect: 'Collect', settle: 'Settle', send: 'Settle' };

export default function BuildConsoleAsk({
  ask, room, busy, ended, run, api, pickId = null, onPick, answering = false, setAnswering, onSent, draft = null, onDraft, sendRef, onWheelSettled = null,
}) {
  const host = !ended;
  const step = askPathStep(ask, { pickId, answering });
  const open = ['live', 'voting'].includes(ask.status);
  const settle = ask.status === 'results';
  const wheel = ask.wheel && !ask.revotedAs ? ask.wheel : null;
  const tied = (ask.results && ask.results.tied) || [];
  const act = (action) => () => run(() => api.askAction(ask.askId, { action }));
  const stepWord = ask.status === 'voting' ? 'Vote' : STEP_WORD[step] || 'Collect';
  // At results a click on another option is the pick, made here (no confirm: nothing closes).
  const boardPick = !host ? null : settle ? (id) => onPick(id, { confirmed: true }) : (id) => onPick(id);
  const forThis = draft && draft.spoken === answering && (answering || draft.pickId === pickId) ? draft : null;
  const keep = onDraft ? (d) => onDraft({ ...d, pickId: answering ? null : pickId, spoken: answering }) : undefined;
  const note = String(ask.claudeNote || '').trim();

  let side = null;
  if (host && answering) {
    side = (
      <DecidePanel
        key={`spoken:${ask.askId}`} ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount}
        spoken onCancel={() => setAnswering(false)} onSent={onSent} draft={forThis} onDraft={keep} sendRef={sendRef}
      />
    );
  } else if (host && settle) {
    side = (
      <>
        <DecidePanel
          key={`decide:${ask.askId}:${wheel ? (wheel.spins || []).length : 0}`} ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount}
          pickId={ask.kind === 'rating' ? null : pickId} onSent={onSent} draft={forThis} onDraft={keep} sendRef={sendRef}
        />
        <p className="hc-muted">{BCW.sendIsMain}</p>
      </>
    );
  }
  // While the room answers the board takes the width; the note for Claude sits above it.
  const noteCard = note && !side ? (
    <div className="hc-card bc-note">
      <p className="hc-card-h">{BCW.forYou}</p>
      <p className="hc-muted">{ask.source === 'agent' ? `${BCW.claudeAsked} ` : ''}&ldquo;{note}&rdquo;</p>
    </div>
  ) : null;

  return (
    <section className="hc-panel bc-ask" aria-label="This ask" data-capability="ask-path">
      <p className="hc-kicker">{`Ask ${askNumber(ask.askId)} · ${KIND_LABEL[ask.kind] || 'Ask'} · ${stepWord}`}</p>
      <h2 className="hc-h">{ask.prompt}</h2>
      {noteCard}
      <div className={`hc-cols bc-askcols${side ? '' : ' is-one'}`}>
        <div className="bc-board" data-capability={host ? 'board-pick' : undefined}>
          {ask.detail && !(host && open) ? <p className="hc-muted bc-detail">{ask.detail}</p> : null}
          <AskStage ask={ask} host busy={busy} ended={ended} run={run} api={api} pickId={pickId} onPick={boardPick} pathMode />
          {host && settle && (wheel || ask.revotedAs) && (
            <WheelPanel ask={ask} busy={busy} run={run} api={api} spinInRow onSettled={onWheelSettled} />
          )}
          <p className="hc-muted">{settle ? BCW.boardHintSettle : BCW.boardHintCollect}</p>
          {host && (
            <div className="bc-askrow" role="group" aria-label="More for this ask">
              {open && <AskWording key={ask.prompt} ask={ask} busy={busy} run={run} api={api} />}
              {!answering && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => setAnswering(true)}>{BCW.askAnswerForRoom}</button>}
              {open && ask.status === 'live' && ask.kind === 'suggest' && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={act('close')}>Close without a vote</button>
              )}
              {settle && tied.length >= 2 && !wheel && !ask.revotedAs && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={act('revote')}>{W.voteAgain}</button>
              )}
              {settle && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={act('reopen')}>Reopen</button>}
            </div>
          )}
        </div>
        {side ? <div className="bc-askside">{side}</div> : null}
      </div>
    </section>
  );
}
