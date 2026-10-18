/**
 * CLAUDE'S STATUS ON EVERY SCREEN THE ROOM SEES (owner, 17 Oct 2026: "I do
 * like that Claude's status and activity is kept current on the build room
 * stage (whichever screen shown to the room)").
 *
 * One line, from the one rule (buildScreens.js claudeState, through
 * roomContentData.claudeWords): the headline ("Claude is building", "Claude is
 * ready", "Claude has paused", or Claude's own doing line), its duration, the
 * helper line, and in a run the current step. config/roomContent.js makes it
 * essential on every Build Room moment and profile: it carries no data-drop,
 * reads at the body step or larger, and sits under an open ask, never in place
 * of its prompt and options. Between asks the Stage's IdleStage draws the same
 * status as the lead instead, so this line is not drawn there.
 */
import React from 'react';
import { roleOf, textOf } from '../../config/roomContent';
import { W } from '../words';

/*
 * SENT TO CLAUDE, AS A BAND (docs/design/room-content-v2 frame 8, owner 18 Oct
 * 2026). While the Stage keeps a decided ask's result up (buildScreens
 * sentStageAsk: exactly as long as the I9 Sent to Claude state), this one
 * status line is drawn as the band under the options: "Sent to Claude", the
 * direction the host sent word for word (`sent`), and whether Claude has picked
 * it up. It is the same element, not a second Sent to Claude: when Claude says
 * what it is doing, the state ends and the Stage moves on to the work row.
 */
export default function ClaudeStatus({ rc, className = '', sent = '' }) {
  const c = textOf(rc, 'claude');
  if (!c || !c.headline) return null;
  const step = textOf(rc, 'step');
  if (sent && c.key === 'sent') {
    return (
      <div
        className={`brm-roomclaude brm-sentband${className ? ` ${className}` : ''}`}
        data-claude-status="sent"
        data-rc-part="claude"
        data-rc={roleOf(rc, 'claude')}
        role="status"
        aria-label={W.claudeNow}
      >
        <span className="brm-roomclaude-h brm-sentband-k">{c.headline}</span>
        <span className="brm-sentband-t">{sent}</span>
        {c.line ? <span className="brm-roomclaude-m">{c.line}</span> : null}
      </div>
    );
  }
  return (
    <div
      className={`brm-roomclaude${className ? ` ${className}` : ''}`}
      data-claude-status={c.key || ''}
      data-rc-part="claude"
      data-rc={roleOf(rc, 'claude')}
      role="status"
      aria-label={W.claudeNow}
    >
      <span className={`brm-sdot brm-sdot--${c.key || 'none'}`} aria-hidden="true" />
      <span className="brm-roomclaude-h">{c.headline}</span>
      {c.dur ? <span className="brm-roomclaude-m">{W.forDur(c.dur)}</span> : null}
      {c.helperLine ? <span className="brm-roomclaude-m">{c.helperLine}</span> : null}
      {/* The activity: Claude's last post, "Done: …", or the helper beside a doing line. */}
      {c.line && c.line !== c.helperLine ? <span className="brm-roomclaude-m">{c.line}</span> : null}
      {step && step.text ? <span className="brm-roomclaude-m">{W.claudeStep(step.k, step.text)}</span> : null}
    </div>
  );
}
