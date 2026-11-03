/**
 * SENT TO CLAUDE, LEADING THE STAGE (owner, 23 Oct 2026: "the room's window
 * keeps showing the last question with 'Claude is building', and nobody can
 * see what Claude was actually told").
 *
 * From the moment the host sends until the next ask opens (buildScreens
 * sentCard), the Stage leads with what Claude was told: the words, and the
 * room's pick they came from ("The room chose B · Calm photo"). A send the
 * host kept from the room says only "The host sent Claude a direction". The
 * host's why never shows. Claude's one status sits under it, and while Claude
 * works, the work row (I10), as the quiet Stage has them.
 *
 * TYPING (the room's window only, two screens, the host's toggle): the same
 * place shows "The host is writing to Claude…" with the draft and a caret
 * until the host sends (buildroom/typingMirror.js).
 *
 * Drawn the same on the host's one screen and on the room's window: nothing
 * here is pressable.
 */
import React from 'react';
import { W } from '../words';
import { claudeState, clockOf, workView } from '../buildScreens';
import ClaudeStatus from './ClaudeStatus';
import { WorkRow } from './StageIdle';

export default function SentStage({ room, now, card = null, typing = '', rc }) {
  const st = claudeState(room, now);
  const work = st.key === 'building' ? workView(room, now) : null;
  if (typing) {
    return (
      <section className="brm-stage brm-sentstage is-typing" aria-label={W.hostWriting} data-testid="brm-typing">
        <span className="brm-eyebrow"><b>{W.hostWriting}</b></span>
        <p className="brm-q brm-sentq" aria-live="off">{typing}<span className="brm-caret" aria-hidden="true" /></p>
        <ClaudeStatus rc={rc} under />
      </section>
    );
  }
  if (!card) return null;
  const at = clockOf(card.at);
  return (
    <section className={`brm-stage brm-sentstage${card.hidden ? ' is-hidden' : ''}`} aria-label={card.head} data-testid="brm-sentcard">
      <span className="brm-eyebrow"><b>{card.head}</b>{at ? ` · ${at}` : ''}</span>
      <h2 className="brm-q brm-sentq">{card.hidden || card.plain ? card.text : `“${card.text}”`}</h2>
      {card.pick && <p className="brm-sentpick">{card.pick}</p>}
      <ClaudeStatus rc={rc} under />
      {work && <WorkRow work={work} />}
    </section>
  );
}
