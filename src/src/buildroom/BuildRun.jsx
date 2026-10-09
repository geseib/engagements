/**
 * THE RUN LIST (talking points T7): Work through in turn. Claude takes the
 * highlighted items one at a time: it builds one, commits it, reports it done,
 * and waits. The host sends the next.
 *
 *   RunPanel     the Host's Now column: the list, Claude's one-line note under
 *                a done item, and the row Stop · Skip k · Next: k · "…"
 *   RunConfirm   Next pressed before Claude reported done: "Claude hasn't
 *                finished 2. Send 3 anyway?"
 *   RunStage     the same list on the Stage, the current item lit
 *
 * ONE ORANGE: Next is the main button of the row while it leads (no ask, no
 * opening, no dialog). Space presses it only once Claude has reported the
 * item done, so a stray key never sends the next item over unfinished work
 * (`data-next-primary` is on the button only then; useNextFocus moves the
 * focus to it when Claude reports).
 *
 * Reorder: the grip on a pending item drags it, or takes ArrowUp and
 * ArrowDown. The call carries the list's `ver`, so a list that changed under
 * the host is refused rather than scrambled.
 *
 * Every word of an item came from Claude or a builder's Claude: text only.
 */
import React, { useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import ActionRow from './BuildActionRow';
import { W } from './words';
import { useNextFocus } from './useNextFocus';
import { runNextItem, runCurrentItem } from './buildScreens';

const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

const stateWord = (it, run) => {
  if (it.state === 'done') return `${W.runStateDone}${it.doneAt ? ` ${clockOf(it.doneAt)}` : ''}`;
  if (it.state === 'doing') return W.runStateOn;
  if (it.state === 'skipped') return W.runStateSkipped;
  return run.next === it.k ? W.runStateNext : '';
};

function Item({ it, run, reorder, pendingCount, onMove, dragging, setDragging, onDropOn }) {
  const pending = it.state === 'pending';
  return (
    <li
      className={`brm-runitem is-${it.state}${run.next === it.k && run.status === 'running' ? ' is-next' : ''}${dragging === it.pointId ? ' is-drag' : ''}`}
      data-state={it.state}
      draggable={reorder && pending ? true : undefined}
      onDragStart={reorder && pending ? () => setDragging(it.pointId) : undefined}
      onDragOver={reorder && pending ? (e) => e.preventDefault() : undefined}
      onDrop={reorder && pending ? (e) => { e.preventDefault(); onDropOn(it.pointId); } : undefined}
      onDragEnd={reorder && pending ? () => setDragging(null) : undefined}
    >
      <span className="brm-runn" aria-hidden="true">{it.state === 'done' ? <Icon name="Check" size={14} /> : it.k}</span>
      <span className="brm-runt">
        <span className="brm-runtext">{it.text}</span>
        {it.state === 'done' && it.note ? <span className="brm-runnote">{W.claudeSaid(it.note)}</span> : null}
      </span>
      <span className="brm-runs">{stateWord(it, run)}</span>
      {reorder && pending && pendingCount > 1 && (
        <button
          type="button" className="brm-grip" data-grip={it.pointId}
          aria-label={`${W.moveItemUp(it.text)}. ${W.moveItemDown(it.text)}.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); onMove(it.pointId, -1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onMove(it.pointId, 1); }
          }}
        >
          <Icon name="DotsSixVertical" size={16} />
        </button>
      )}
    </li>
  );
}

export function RunConfirm({ run, busy, onWait, onSend }) {
  const cur = runCurrentItem(run);
  const next = runNextItem(run);
  if (!cur || !next) return null;
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onWait} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-runconfirm-title">
      <div className="brm-dh">
        <div>
          <p className="brm-hint">{W.workingThrough}</p>
          <h2 className="brm-h" id="brm-runconfirm-title">{W.confirmEarly(cur.k, next.k)}</h2>
        </div>
        <button type="button" className="brm-x" aria-label={W.close} onClick={onWait}><Icon name="X" size={16} /></button>
      </div>
      <p>{W.confirmEarlyBody(cur.text, cur.k, next.k)}</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={onWait}>{W.waitForClaude}</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy} onClick={onSend}>{W.sendAnyway(next.k)}</button>
      </div>
    </Modal>
  );
}

export function RunPanel({
  run, busy, ended, leads, confirming = false, onNext, onSkip, onStop, onReorder, onHide,
}) {
  const ref = useRef(null);
  const running = run.status === 'running';
  const next = runNextItem(run);
  const pend = run.items.filter((x) => x.state === 'pending');
  const orange = Boolean(leads && running && next && !confirming);
  const done = Boolean(run.claudeDone);
  // The key and the focus belong to Next only once Claude has reported.
  const keyed = orange && done;
  useNextFocus(ref, `run:${run.runId}:${run.cur}:${run.status}:${done ? 'done' : 'busy'}`);
  const [dragging, setDragging] = useState(null);
  const focusGrip = useRef(null);
  useEffect(() => {
    if (!focusGrip.current) return;
    const el = ref.current && ref.current.querySelector(`[data-grip="${focusGrip.current}"]`);
    focusGrip.current = null;
    if (el) el.focus();
  });
  const send = (order) => onReorder(order, run.ver);
  const moveBy = (pointId, delta) => {
    const ids = pend.map((x) => x.pointId);
    const i = ids.indexOf(pointId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    focusGrip.current = pointId;
    send(ids);
  };
  const dropOn = (targetId) => {
    const ids = pend.map((x) => x.pointId);
    const from = ids.indexOf(dragging);
    const to = ids.indexOf(targetId);
    setDragging(null);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    send(ids);
  };
  const started = run.items.filter((x) => x.state !== 'pending').length;
  const doneN = run.items.filter((x) => x.state === 'done').length;
  const skipped = run.items.filter((x) => x.state === 'skipped').length;
  const reorder = running && !ended;
  let say = '';
  if (running) {
    if (done) say = keyed && next ? `${W.claudeFinishedItem(run.cur)} \u00b7 ${W.spaceSend(next.k)}` : W.claudeFinishedItem(run.cur);
    else say = next ? W.claudeIsOnItem(run.cur) : W.claudeLastItem(run.cur);
  }

  return (
    <section className="brm-panel brm-runpanel" aria-label={W.runLabel} ref={ref}>
      <h2 className="brm-h5">
        {W.workingThrough}
        <span className="brm-hint"> {'·'} {running ? (done ? W.runDoneOf(doneN, run.total) : W.runStarted(started, run.total)) : run.status === 'finished' ? W.listFinished(run.total) : W.listStopped(doneN, run.total)}</span>
      </h2>
      <ol className="brm-runlist" aria-label={W.runLabel}>
        {run.items.map((it) => (
          <Item
            key={it.pointId || it.k} it={it} run={run} reorder={reorder} pendingCount={pend.length}
            onMove={moveBy} dragging={dragging} setDragging={setDragging} onDropOn={dropOn}
          />
        ))}
      </ol>
      {reorder && pend.length > 1 && <p className="brm-hint">{W.reorderNote}</p>}
      {!running && (
        <div className="brm-row brm-gap">
          <span className="brm-hint">{skipped > 0 ? W.listStopped(doneN, run.total) : ''}</span>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onHide}>{W.hideList}</button>
        </div>
      )}
      {running && !ended && (
        <ActionRow space={keyed} hint={say}>
          <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={onStop}>{W.stop}</button>
          {next && <button type="button" className="brm-btn" disabled={busy} onClick={() => onSkip(next)}>{W.skipItem(next.k)}</button>}
          {next && (
            <button
              type="button" className={`brm-btn${orange ? ' brm-btn--primary' : ''}`}
              data-next-primary={keyed ? true : undefined}
              disabled={busy} onClick={onNext}
            >
              {W.nextItem(next.k, next.text)}
            </button>
          )}
        </ActionRow>
      )}
    </section>
  );
}

/** The list on the Stage: the room's picks, the current one lit. No names, no notes. */
export function RunStage({ run }) {
  const cur = runCurrentItem(run);
  return (
    <section className="brm-stage brm-runstage" aria-label={W.workingThrough}>
      <span className="brm-eyebrow"><b>{W.workingThrough}</b> {'\u00b7'} {W.roomChose(run.total)}</span>
      <ol className="brm-runlist brm-runlist--stage">
        {run.items.map((it) => (
          <li key={it.k} className={`brm-runitem is-${it.state}${run.cur === it.k && it.state === 'doing' ? ' is-lit' : ''}`} data-state={it.state} aria-current={run.cur === it.k && it.state === 'doing' ? 'step' : undefined}>
            <span className="brm-runn" aria-hidden="true">{it.state === 'done' ? <Icon name="Check" size={20} /> : it.k}</span>
            <span className="brm-runt"><span className="brm-runtext">{it.text}</span></span>
          </li>
        ))}
      </ol>
      {cur && <p className="brm-runsince">{W.claudeIsOnOf(cur.k, run.total)}</p>}
    </section>
  );
}
