/**
 * ONE INVITE, BUILT ONCE, FOR BOTH BUTTONS.
 *
 * There were two, and they were not two versions of one thing — they were two
 * different documents written years apart:
 *
 *   THE SESSION PANEL'S (the one the owner asked to keep) carried the type and
 *   its blurb, the question set, the categories with per-category counts, a
 *   four-step instruction block and a sign-off — and printed only the URL.
 *
 *   THE HISTORY LIST'S was four lines: a heading, the code, a URL and a title.
 *
 * Merging them is not just picking the longer one. Each had something the other
 * lacked, and one of them was broken:
 *
 *   THE HISTORY INVITE'S TITLE WAS ALWAYS WRONG. It read `game.eventTitle`, and
 *   `get-games-list.js:23` returns that field as `title`. `eventTitle` is
 *   undefined on every history row, so every invite ever copied from that list
 *   said "Title: Engagement Session". The row heading two lines away got it
 *   right, which is why nobody noticed.
 *
 *   THE PANEL INVITE DROPPED THE JOIN CODE. It put the URL on the clipboard and
 *   nothing else. Somebody who cannot click a link — reading it off a printout,
 *   or on a locked-down machine — had nothing to type into the four-digit box.
 *
 * Both are carried here.
 *
 * ── THE INVITE TEXT IS MACHINE-READ, WHICH NOTHING WARNED ANYONE ABOUT ──────
 *
 * `RootPage.jsx` scrapes a pasted invite for `gameId=NNNN` so a player can
 * paste the whole blob into the join box and be let in. So the URL is not
 * decoration and must not be reformatted away. `inviteCallSite.test.js` pins
 * the round trip, because the coupling is invisible from either end.
 */
import { gameTypeLabel, gameTypeMeta, resolveGameType } from './gameTypes';

/** What "Now" inserts, verbatim, per the owner's wording. */
export const NOW_LINE = 'Happening now, join us!';

/**
 * HOW LONG A SESSION LASTS, AND WHY IT IS 90 AND NOT ALSO 7.
 *
 * `TTL_CREATION_PHASE` in websocket/schema-compliant-manager.js is 90 days, and
 * it is the ttl written onto the GAMES row, the METADATA row and the STATE row
 * at creation. Nothing moves it afterwards.
 *
 * CLAUDE.md says "90 days (creation), 7 days (active)", which reads as though
 * playing a session shortens it. On the deployed path it does not. The handler
 * that shortens to 7 days is websocket/start-game.js, and NO route points at
 * it — the wired StartGameFunction is `CodeUri: lambda-functions/game/`, whose
 * start-game.js contains no ttl write at all. The 7-day TTLs that do exist land
 * on player, vote and results rows, not on the session.
 *
 * So: a session's deadline is its creation date plus 90 days, full stop.
 */
export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When this session is deleted.
 *
 * Millisecond arithmetic rather than calendar-month addition, deliberately: it
 * has to match `Math.floor(Date.now()/1000) + 90*24*60*60` exactly. Across a
 * daylight-saving boundary that shifts the local wall-clock hour by one, which
 * is correct, because the backend does the same.
 */
export function retentionDeadline(createdAt) {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;
  return new Date(created + RETENTION_DAYS * DAY_MS);
}

/**
 * Is the date the host picked one this session will still exist on?
 *
 * MEASURED FROM CREATION, NOT FROM TODAY — and this is a deliberate departure
 * from the request, which said "warn if >90 days from current date".
 *
 * On the setup panel, for a session made moments ago, the two are the same. In
 * session history they are not, and the difference is exactly the session's
 * age: a 70-day-old session has 20 days left, but `now + 90` would happily
 * accept a date 89 days out — an invitation pointing a room at a session that
 * will have been deleted for 69 days.
 *
 * The dialog shows the deadline alongside the warning so the rule is visible
 * rather than silently different from what was asked for.
 */
export function retentionStatus({ createdAt, at, now = new Date() } = {}) {
  const deadline = retentionDeadline(createdAt);
  if (!deadline) return { verdict: 'unknown', deadline: null, daysLeft: null };

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const daysLeft = Math.floor((deadline.getTime() - nowMs) / DAY_MS);

  // The session is already past its own deadline. DynamoDB's TTL deletion is
  // best-effort and can lag by a couple of days, which is why the row can still
  // be on screen — but nothing may promise that grace.
  if (deadline.getTime() <= nowMs) {
    return { verdict: 'session-expired', deadline, daysLeft };
  }

  if (!at) return { verdict: 'ok', deadline, daysLeft };

  const when = Date.parse(at);
  if (Number.isNaN(when)) return { verdict: 'ok', deadline, daysLeft };

  // A date in the past is a different mistake from a date past the deadline,
  // and conflating them produces a warning that does not describe what is wrong.
  if (when < nowMs) return { verdict: 'past', deadline, daysLeft };
  if (when > deadline.getTime()) return { verdict: 'beyond-deadline', deadline, daysLeft };
  return { verdict: 'ok', deadline, daysLeft };
}

/** A date the room will read, from a `datetime-local` value. */
export function formatWhen(at) {
  const when = Date.parse(at);
  if (Number.isNaN(when)) return '';
  return new Date(when).toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** The deadline, spelled out for a human. */
export function formatDeadline(deadline) {
  if (!deadline) return '';
  return deadline.toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * THE INVITE, and the only place its text exists.
 *
 * `categories: null` means "we could not find out" and OMITS the line;
 * `categories: []` means "none were narrowed" and prints "All categories".
 * They are different facts and the history list genuinely has the first — its
 * rows carry no category data — so collapsing them would put "All categories"
 * on an invite nobody had checked.
 */
export function buildInvite({
  title,
  gameId,
  origin = '',
  gameType,
  setName,
  categories = null,
  when = 'now',
  at = '',
} = {}) {
  const type = resolveGameType(gameType);
  const lines = ['ENGAGEMENT INVITATION', '', title || 'Engagement Session', ''];

  const timing = when === 'scheduled' ? formatWhen(at) : NOW_LINE;
  if (timing) lines.push(timing, '');

  lines.push("You're invited to participate in an interactive engagement session!", '');
  lines.push('DETAILS:');
  if (type) lines.push(`• Type: ${gameTypeLabel(type)} — ${gameTypeMeta(type).blurb}`);
  if (setName) lines.push(`• Question Set: ${setName}`);
  if (categories) {
    const text = categories.length
      ? categories
        .map((c) => (c.questionCount ? `${c.name} (${c.questionCount})` : c.name))
        .join(', ')
      : 'All categories';
    lines.push(`• Categories: ${text}`);
  }

  lines.push('', 'TO JOIN:', 'Click this link or copy it to your browser:');
  lines.push(`${origin}/play?gameId=${gameId}`);
  // The half the panel version dropped. A link is useless on paper.
  lines.push('', `Or go to ${origin}/play and enter session code ${gameId}`);

  lines.push('', 'INSTRUCTIONS:');
  lines.push('1. Click the link above or paste it into your browser');
  lines.push('2. Enter your name when prompted');
  lines.push('3. Wait for the host to begin');
  lines.push('4. Participate by answering questions and voting');
  lines.push('', 'Ready to engage? See you there!');

  return lines.join('\n');
}
