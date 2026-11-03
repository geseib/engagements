/**
 * WHAT START WILL DO (docs/design/session-start D2, F5; experience plan 2b).
 * A returning host's Start on the session list says which way the room will
 * watch, from the choice this browser stored (config/roomScreen.js), and
 * "Start · two screens" opens the room's window in the same click. With no
 * stored choice it is plain Start, and Setup asks (F6).
 *
 * Only Call & Answer: the round type the room's window and Setup cover
 * (config/surfaces.js TWO_SURFACE_TYPES; a Build Room row goes to /build).
 */
import { isBuildSession } from '../buildroom/buildHostApi';

/** 'two' | 'one' | null for a session row and the stored choice. */
export function startModeFor(session, stored) {
  if (!session || isBuildSession(session)) return null;
  const type = session.gameType || session.engagementType || 'call-and-answer';
  if (type !== 'call-and-answer') return null;
  if (stored === 'two') return 'two';
  if (stored === 'classic') return 'one';
  return null;
}

export const START_WORDS = Object.freeze({
  label: (mode) => (mode === 'two' ? 'Start · two screens' : mode === 'one' ? 'Start · one screen' : 'Start'),
  now: (mode) => (mode === 'two' ? 'Start it now · two screens' : mode === 'one' ? 'Start it now · one screen' : 'Start it now'),
  hint: (mode, title) => (mode === 'two'
    ? `Start "${title}": opens the room's window on your other display, and people can join`
    : mode === 'one'
      ? `Start "${title}" on this screen: Setup checks the room can read it, then people can join`
      : `Start "${title}": Setup asks where the room watches, then people can join`),
  likeLast: (stored) => (stored === 'two' ? 'Two screens, like last time.' : 'One screen, like last time.'),
  likeLastLine: (stored) => (stored === 'two'
    ? 'Start opens the room\'s window on your other display.'
    : 'Start opens Setup on this screen. Change it in Setup.'),
  oneThisTime: 'One screen this time',
});
