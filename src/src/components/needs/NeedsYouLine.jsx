import React, { useEffect, useState } from 'react';
import NeedsActions from './NeedsActions';
import { ACTION_WORDS, NEEDS_LEVELS, NEEDS_WORDS } from '../../config/needsYou';
import useArrival from '../../hooks/useArrival';
import './NeedsYou.css';

/**
 * THE NEEDS-YOU LINE (PLAN §3.2, §4.3), directly under Your part now on a
 * private laptop. ALWAYS THERE, AT ONE HEIGHT: calm ("Nothing needs you
 * now.") when nothing waits, the Soon item in plain words with its quiet
 * button when something can wait, amber with the Now item and its buttons
 * when someone is waiting. Because it never appears or disappears, nothing
 * below it moves (owner review O1).
 *
 * The words change inside a polite live region, so a screen reader hears
 * "Sam wants their name on a new device" without the line stealing focus.
 *
 * `needs` is config/needsYou.js's result; `onAct(item, action)` the page's;
 * `error` a refusal from the last action ("the server's sentence shows on the
 * item", PLAN §4.4), read aloud.
 */
export default function NeedsYouLine({ needs, onAct, busy = false, error = '' }) {
  const top = needs && needs.top;
  const more = needs ? Math.max(0, needs.items.length - 1) : 0;
  const level = top ? (top.level === NEEDS_LEVELS.NOW ? 'is-now' : 'is-soon') : 'is-calm';
  /* AN ARMED "LET THEM" SAYS WHY, IN THE LINE'S OWN TEXT (dev QA 2 Nov): the
     line is one fixed height, so the note takes the item's words while it is
     armed, in the same polite live region, and gives them back after. */
  const [armed, setArmed] = useState(false);
  const topId = top ? top.id : '';
  useEffect(() => { setArmed(false); }, [topId]);
  /* THE ONE MOTION (console-rail README D4; owner fork 3): a NEW Now item
     fades the amber in once, 240ms, in the same commit as the People
     header's mark (both read the same items through useArrival). Never on
     a reload, never repeated, no fade-out; reduced motion skips it. */
  const arrived = useArrival(needs && needs.items ? needs.items.filter((i) => i.level === NEEDS_LEVELS.NOW).map((i) => i.id) : []);
  return (
    <section className={`ny ny-line ${level}`} aria-label={NEEDS_WORDS.title} data-testid="needs-line" data-level={top ? top.level : 'calm'} data-arrived={arrived && level === 'is-now' ? '' : undefined}>
      <div className="ny-line-text" aria-live="polite" data-testid="needs-line-text">
        {top && armed ? (
          <span className="ny-line-main" data-testid="needs-armed-note"><b>{ACTION_WORDS.armedNote(top.name)}</b></span>
        ) : top ? (
          <>
            <span className="ny-line-main">{top.level === NEEDS_LEVELS.NOW ? <b>{top.text}</b> : top.text}</span>
            {top.detail ? <span className="ny-detail">{top.detail}</span> : null}
            {more > 0 ? <span className="ny-more">{`+${more} more in ${NEEDS_WORDS.title}`}</span> : null}
          </>
        ) : (
          <span className="ny-line-main">{NEEDS_WORDS.calm}</span>
        )}
        {error ? <span className="ny-error" role="alert">{error}</span> : null}
      </div>
      {top ? <NeedsActions item={top} onAct={onAct} busy={busy} armed={armed} onArmedChange={setArmed} showNote={false} /> : null}
    </section>
  );
}
