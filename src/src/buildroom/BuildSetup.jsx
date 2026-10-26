/**
 * BEFORE THE ROOM STARTS (docs/design/build-room-simplify PLAN item 10,
 * smaller; mockup frame 1, proposed; owner, 26 Oct 2026: "go, build phase 1
 * on dev"). One card with three rows, in the place of How a Build Room works
 * and Where will the room watch?:
 *
 *   1 Connect Claude Code   done only once Claude Code has called in, never
 *                           when a key is minted (host review F2)
 *   2 The room joins        the join code; done once someone has joined
 *   3 The room watches      one screen without asking; Use two screens is a
 *                           visible row (owner, 19 Oct: "a very difficult
 *                           experience finding the 2 screen capability")
 *
 * Each row turns green as it happens (owner, 23 Oct: "turn step 3 green and
 * indicate hey, you are done and connected"). There is no gate and no
 * "Practise without Claude": a send without Claude already says Queued for
 * Claude and is delivered when Claude calls in, so the card says the opening
 * can start now. Connect is the card's orange while it leads (`connectLeads`:
 * no ask yet); once all three rows are done the card folds to one line.
 *
 * The one-screen Host screen and the two-screen console draw the same card.
 */
import React from 'react';
import Icon from '../components/Icon';
import { W, loopLead } from './words';

function Row({ done, n, title, line, children, capability }) {
  return (
    <li className={`brm-setup-row${done ? ' is-done' : ''}`} data-capability={capability}>
      <span className="brm-setup-tick" aria-hidden="true">{done ? <Icon name="Check" size={14} /> : n}</span>
      <span className="brm-setup-t">
        <b>{title}</b>
        <span>{line}</span>
      </span>
      {children && <span className="brm-setup-act">{children}</span>}
      <span className="brm-sr">{done ? 'Done' : 'To do'}</span>
    </li>
  );
}

/**
 * `s`: { connected, folder, connectLeads, joined, code, codesUp, two, windowOpen,
 *        onConnect, onCodes, onTwo }
 *
 * On two screens the room's window is opened from Room's window ↗ at the top,
 * where its state is: the row says so rather than adding a second door.
 */
export default function BuildSetup({ s }) {
  const screenDone = !s.two || s.windowOpen;
  const allDone = s.connected && s.joined > 0 && screenDone;
  if (allDone) {
    return (
      <p className="brm-setupdone" data-testid="brm-setupdone">
        <span className="brm-setup-tick is-small" aria-hidden="true"><Icon name="Check" size={12} /></span>
        {W.setupDone(s.joined, s.two)}
      </p>
    );
  }
  let screenLine = W.setupScreenOneHint;
  if (s.two) screenLine = s.windowOpen ? W.setupScreenTwoOpen : W.setupScreenTwoClosed;
  return (
    <section className="brm-panel brm-setup" aria-labelledby="brm-setup-h">
      <h2 className="brm-h5" id="brm-setup-h">{W.setupHead}</h2>
      <ol className="brm-setup-rows">
        <Row done={s.connected} n={1} title={W.connectClaude} line={s.connected ? W.setupConnected(s.folder) : W.setupConnectHint} capability="claude-status">
          {!s.connected && (
            <button type="button" className={`brm-btn${s.connectLeads ? ' brm-btn--primary' : ''}`} onClick={s.onConnect}>
              <Icon name="Lock" size={16} /> {W.setupConnectBtn}
            </button>
          )}
        </Row>
        <Row done={s.joined > 0} n={2} title={W.setupJoin} line={W.setupJoined(s.joined, s.code)}>
          <button type="button" className="brm-btn brm-btn--sm" aria-pressed={s.codesUp} onClick={s.onCodes}>
            {s.codesUp ? W.hideCode : W.setupShowCode}
          </button>
        </Row>
        <Row done={screenDone} n={3} title={s.two ? W.setupScreenTwo : W.setupScreenOne} line={screenLine} capability="screens">
          {!s.two && <button type="button" className="brm-btn brm-btn--sm brm-btn--link" onClick={s.onTwo}>{W.useTwoScreens}</button>}
        </Row>
      </ol>
      {!s.connected && <p className="brm-hint">{W.setupStartNow} {loopLead()}</p>}
    </section>
  );
}
