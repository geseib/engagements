/**
 * THE SURVEY WALKTHROUGH'S KEYS, AS ARITHMETIC. No fetch, no React.
 *
 * Task 8 of the 2026-09-26 feature sweep: "walk the room through survey
 * results, one question at a time, full size." docs/design/survey-redesign/
 * s-02-choice.html..s-06-themes.html draw the dock: "Previous" and "SPACE
 * Next result", plus ← and → in the mockups' own key-hint vocabulary, and Esc
 * to leave (the brief's own words — the mockups do not print an Esc hint,
 * the way `08-done.html`'s dock never prints one for the escape hatch every
 * other full-screen host surface already carries).
 *
 * This mirrors config/scoreboard.js's `scoreboardKeyIntent` on purpose: pure,
 * testable, and read by the ONE listener the presenter component itself
 * arms while it is mounted — see SurveyWalkthrough.jsx's header for why that
 * listener needs no separate open/close hook the way the scoreboard's does
 * (the scoreboard toggles over a stage that stays mounted; the presenter
 * REPLACES the stage, so mounting IS opening and unmounting IS closing).
 *
 * REPEAT IS GUARDED FOR NEXT/PREVIOUS, NOT FOR CLOSE — the same asymmetry
 * HostActionBar's own advance key carries ("every advance here is a
 * deliberate act... none of them is something you do twice by holding a
 * button down") and scoreboardKeyIntent carries for 's'/'v' but not for its
 * own Escape/Space close. A repeated Escape is idempotent; a repeated Space
 * is not — held a beat too long it must not walk the host past three
 * questions instead of one.
 */

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target) {
  if (!target) return false;
  if (target.tagName && TYPING_TAGS.has(target.tagName)) return true;
  return Boolean(target.isContentEditable);
}

/**
 * @returns {'next'|'previous'|'close'|null}
 */
export function surveyWalkthroughKeyIntent(event) {
  if (!event) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;

  const k = event.key;
  if (k === 'ArrowRight' || k === ' ' || k === 'Spacebar') return event.repeat ? null : 'next';
  if (k === 'ArrowLeft') return event.repeat ? null : 'previous';
  if (k === 'Escape') return 'close';
  return null;
}

export default surveyWalkthroughKeyIntent;
