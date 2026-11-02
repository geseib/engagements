import React from 'react';
import Button from '../ui/Button';
import { NEEDS_LEVELS, NEEDS_WORDS, kindSummary } from '../../config/needsYou';
import './NeedsYou.css';

/**
 * THE NEEDS-YOU LINE WHERE THE ROOM CAN SEE IT (experience plan §3.3, the
 * "Needs-you line" row; Phase 2 step 2h). The one-screen stage's laptop is the
 * room's screen, so this is the private laptop's line (NeedsYouLine.jsx) made
 * public-safe, in the same place and at the same height:
 *
 *   - calm: the same muted line, "Nothing needs you now.", or for Soon items
 *     the count by kind in the same muted words ("1 late answer to review");
 *   - something waiting (Now): an amber edge but no amber wash, the count by
 *     kind ("1 name request"), and one outlined Open.
 *
 * NEVER A NAME, AND NEVER Let them / Not now on the room's screen: the words
 * come from config/needsYou.js kindSummary(), which counts by kind and reads
 * no item's text, and the only button opens the top bar's sheet
 * (OneScreenNeedsBell), which starts "The room can see this screen" and shows
 * one item only after "Show on this screen".
 *
 * "· on your phone" only while the host's Remote is connected
 * (`remoteConnected`, PLAN §3.3); with none it says the count and Open.
 */
export default function PublicNeedsLine({ needs, onOpen = null, remoteConnected = false }) {
  const items = (needs && needs.items) || [];
  const now = items.some((i) => i.level === NEEDS_LEVELS.NOW);
  const level = now ? 'is-waiting' : 'is-calm';
  return (
    <section
      className={`ny ny-line ny-line--public ${level}`}
      aria-label={NEEDS_WORDS.title}
      data-testid="needs-line"
      data-public=""
      data-level={now ? NEEDS_LEVELS.NOW : (items.length ? NEEDS_LEVELS.SOON : 'calm')}
    >
      <div className="ny-line-text" aria-live="polite" data-testid="needs-line-text">
        <span className="ny-line-main">{kindSummary(needs, { remoteConnected })}</span>
      </div>
      {items.length && typeof onOpen === 'function' ? (
        <Button size="sm" variant="quiet" onClick={onOpen} data-testid="needs-line-open">{NEEDS_WORDS.open}</Button>
      ) : null}
    </section>
  );
}
