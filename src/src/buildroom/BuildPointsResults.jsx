/**
 * RESULTS OF A VOTE MADE FROM POINTS (talking points T6): "Move forward".
 *
 * The room's picks are shown most votes first. The top three are highlighted
 * (a tie at the cut highlights every tied row); a click on a row highlights or
 * clears it. Highlight is green with a filled box, so it never reads as the
 * blue tick of the Points list. Then three moves, the main one right-most:
 *
 *   Save the rest for later   the rows not highlighted go to Later in one press;
 *                             the step stays open for the other two
 *   Work through in turn      the run list (T7), item 1 sent at once; needs 2
 *   Send these N to Claude    one direction, Do now
 *
 * The highlight is the page's state (BuildRoom), so the Stage dock reads the
 * same rows and presses the same three moves.
 *
 * Every row's words came from Claude or a builder's Claude: text only.
 */
import React, { useRef } from 'react';
import Icon from '../components/Icon';
import ActionRow from './BuildActionRow';
import { Step } from './BuildAskPath';
import { W } from './words';
import { useNextFocus } from './useNextFocus';
import {
  pointVoteRows, rowIsLive, highlightOf, tiedAtCut, sendHighlighted, runRunning, askPathSummaries,
} from './buildScreens';

export default function BuildPointsResults({
  ask, room, override, onToggle, busy, ended, said = '', onMove, quiet = false,
}) {
  const ref = useRef(null);
  const rows = pointVoteRows(ask, room);
  const live = rows.filter(rowIsLive);
  const on = new Set(highlightOf(ask, room, override));
  const n = on.size;
  const rest = live.filter((r) => !on.has(r.label)).length;
  const tied = Array.isArray(override) ? [] : tiedAtCut(rows);
  const picks = rows.reduce((sum, r) => sum + r.count, 0);
  const voted = (ask.results && ask.results.total) || 0;
  const listBusy = runRunning(room);
  useNextFocus(ref, `points:${ask.askId}:${live.length ? 'move' : 'done'}`);
  const sums = askPathSummaries(ask, { playerCount: room.playerCount });
  const askNo = Number(ask.askId) || ask.askId;

  return (
    <ol className="brm-path brm-path--points" aria-label="This ask" ref={ref}>
      <Step n={1} state="done" title={`Ask: ${ask.prompt}`} summary={sums.ask} />
      <Step n={2} state="done" title={W.roomVotedPicks(voted, Math.max(Number(room.playerCount) || 0, voted), picks)} summary="" />
      <Step n={3} state="now" title={W.moveForward} summary={live.length ? W.nHighlighted(n) : ''}>
        <ul className="brm-hrows" aria-label={`${W.moveForward}, ask ${askNo}`}>
          {rows.map((r) => {
            const isLive = rowIsLive(r);
            const lit = isLive && on.has(r.label);
            return (
              <li key={r.label}>
                <button
                  type="button"
                  className={`brm-hrow${lit ? ' is-on' : ''}${isLive ? '' : ' is-off'}`}
                  aria-pressed={lit}
                  aria-label={W.highlightRow(r.text)}
                  disabled={busy || ended || !isLive}
                  onClick={() => onToggle(r.label)}
                >
                  <span className="brm-hbox" aria-hidden="true">{lit && <Icon name="Check" size={14} />}</span>
                  <span className="brm-hl" aria-hidden="true">{r.label}</span>
                  <span className="brm-hrow-t">{r.text}</span>
                  {!isLive && r.point && <span className="brm-pnote">{r.point.outcome ? r.point.outcome.replace(/^voted \d+, /, '').replace(/^./, (c) => c.toUpperCase()) : ''}</span>}
                  <b className="brm-hrow-n" aria-label={W.votesCount(r.count)}>{r.count}</b>
                </button>
              </li>
            );
          })}
        </ul>
        {live.length > 0 && (
          <p className="brm-hint">
            {tied.length ? W.highlightTie(tied.map((r) => r.label), tied[0].count) : n ? W.highlightNote : W.highlightNone}
          </p>
        )}
        {!ended && (live.length > 0 ? (
          <ActionRow space={!said && n > 0} hint={said || (n > 0 ? W.spaceTo('send') : '')}>
            <button type="button" className="brm-btn" disabled={busy || rest < 1} onClick={() => onMove('later-rest')}>{W.saveRest}</button>
            <button
              type="button" className="brm-btn" disabled={busy || n < 2 || listBusy}
              title={listBusy ? W.runRefused : n < 2 ? W.workNeedsTwo : undefined}
              onClick={() => onMove('run')}
            >
              {W.workInTurn}
            </button>
            <button type="button" className={`brm-btn${quiet ? '' : ' brm-btn--primary'}`} data-next-primary disabled={busy || n < 1} onClick={() => onMove('send')}>{sendHighlighted(n)}</button>
          </ActionRow>
        ) : (
          <ActionRow hint={W.movedForwardDone}>
            <button type="button" className={`brm-btn${quiet ? '' : ' brm-btn--primary'}`} data-next-primary disabled={busy} onClick={() => onMove('close')}>{W.closeThisVote}</button>
          </ActionRow>
        ))}
      </Step>
    </ol>
  );
}
