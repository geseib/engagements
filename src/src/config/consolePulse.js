/**
 * THE ROOM TILE (owner, 5 Nov 2026, cut 5: "one room tile with who is left";
 * docs/design/host-attention PLAN §4.2). It replaced the pulse's three tiles
 * (the room, the time, "since this round opened"; session-start D3). One tile
 * under Your part now on the two-screen console:
 *
 *   ANSWERING   9/15 answered + bar · open 1:51
 *               Waiting on Hannah, Ravi, Grace · away: Tom   (names at six or fewer)
 *               6 still writing                            (more than six)
 *   VOTING      6/15 voted + bar · open 0:42, with "✓ 15/15 answered" beside
 *   ROOM'S Q.   1/15 answered, with the round's two counts beside
 *   AFTER       15/15 answered · 12/15 voted   (the round's record, no clock)
 *   LOBBY       6 here
 *
 * Joiners since the round opened ("+1 joined · Bob") only when there are some.
 * The time: "open 1:51" from a SERVER stamp where the page has one; with a
 * timer, "0:47 left of 2:00", the ring and +1 min; never a clock after the
 * round (the "Took 10:30:37" of 4 Nov came from this tab's own memory).
 * Trivia adds "Correct so far" as one line, host-only.
 *
 * The counts come from config/roomProgress.js (roomProgressFor), the one
 * source; Your part now and the content under the question say no count
 * while a step collects (withoutRoomCount below, AskStage `showCount`).
 */
import { timeLeft, clock as timerClock, TIMER_WORDS } from './roundTimer';
import { liveStepOf, progressWords, recordWords, waitingWords, PROGRESS_WORDS } from './roomProgress';

export const PULSE_WORDS = Object.freeze({
  answered: 'Answered',
  voted: 'Voted',
  thisRound: 'This round',
  people: 'People',
  time: 'Time',
  since: 'Since this round opened',
  // Trivia's tile 3 (experience plan §3.2a, 2g): host-only, never on the wall.
  correct: 'Correct so far',
  correctOf: (n) => `of ${n}`,
  onlyYou: 'only you see this',
  everyoneIn: 'Everyone\'s in',
  stillWriting: 'still writing',
  // A trivia or a choice poll: nobody writes, they pick (dev QA 2 Nov).
  stillAnswering: 'still answering',
  stillVoting: 'still voting',
  nobodyYet: 'Nobody here yet',
  here: 'here',
  answeredLower: 'answered',
  votedLower: 'voted',
  open: 'Open',
  took: 'Took',
  noLimit: 'No limit set',
  answeringTook: 'Answering took',
  votingTook: 'Voting took',
  notOpen: 'Not open yet',
  opensWithRound: 'Starts with round 1',
  noRoundYet: 'No round yet',
  noOneNew: 'No one new',
  joined: (n) => `+${n} joined`,
  inTheRoom: 'in the room',
  roundClosed: 'Round closed',
  theRoom: 'The room',
  theRoomsQuestion: 'The room\'s question',
  openLower: 'open',
});

/**
 * ARE THIS ROUND'S ANSWERS OPTIONS? Trivia always; a poll unless it is an open
 * (text) question. A poll row with no `kind` reads as a choice when it has two
 * or more options, otherwise as open (the survey contract's pollFieldsOf).
 * Dev QA 2 Nov: Trivia and Poll said "still writing" for a tap on an option.
 */
export function answersAreChoices(gameType, question = null) {
  if (gameType === 'trivia') return true;
  if (gameType !== 'poll') return false;
  const q = question || {};
  const options = q.options || q.Options;
  const kind = q.kind || q.Kind || (Array.isArray(options) && options.length >= 2 ? 'choice' : 'text');
  return kind !== 'text';
}

/** Which column of D3's table a console moment reads from. */
const PHASE = Object.freeze({
  LOBBY: 'lobby',
  ANSWERING: 'answer',
  VOTING: 'vote',
  VOTE_RESPONSES: 'vote',
  RESULTS: 'after',
  RESPONSES: 'after',
  READ: 'after',
  FEEDBACK: 'after',
  ROOM_QUESTION: 'ask',
  ROOM_RESULTS: 'after',
  ENDED: 'after',
});

export function pulsePhase(moment) {
  return PHASE[moment] || 'lobby';
}

/** "1:24", "12:05", "1:02:09". Never negative. */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Epoch ms of an ISO string, a number, or null. */
export function msOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** The people who joined after the round opened, in the order they came. */
export function arrivalsSince(players, openedAt) {
  const since = msOf(openedAt);
  if (since === null) return [];
  return (players || [])
    .map((p) => ({ name: p && (p.name || p.playerName), at: msOf(p && p.joinedAt) }))
    .filter((p) => p.name && p.at !== null && p.at > since)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.name);
}

const COLLECTING_PHASES = new Set(['answer', 'vote', 'ask']);

/**
 * The counts with no names (a caller that has only numbers): the same shape
 * roomProgressFor returns, every list empty and `known` false.
 */
export function progressFromCounts({ moment, players = 0, answered = 0, voted = 0, noVote = false, choice = false } = {}) {
  const phase = pulsePhase(moment);
  const n = Math.max(0, Number(players) || 0);
  const step = (id, verb, done, closed, still) => {
    const d = Math.max(0, Number(done) || 0);
    const of = Math.max(n, d);
    return { id, verb, done: d, of, all: of > 0 && d >= of, closed, known: false, waiting: [], away: [], after: [], still };
  };
  const steps = [];
  if (phase !== 'lobby') steps.push(step('answer', PROGRESS_WORDS.answered, answered, phase !== 'answer', choice ? PROGRESS_WORDS.still.answering : PROGRESS_WORDS.still.writing));
  if (!noVote && phase !== 'lobby' && phase !== 'answer') steps.push(step('vote', PROGRESS_WORDS.voted, voted, phase !== 'vote', PROGRESS_WORDS.still.voting));
  const live = phase === 'answer' || phase === 'vote' ? phase : null;
  return { live, steps, byName: {}, here: n };
}

/**
 * The tile's facts: { phase, room, time, joined }.
 *   room  { eyebrow, value, of, verb, bar, everyoneIn, nudge, nudgeTitle, steps, record }
 *   time  { value, sub, state: 'none'|'running'|'extended'|'up', ring } or null
 *   joined  "+1 joined · Bob", or ''
 */
export function pulseFor({
  moment, progress = null, players = 0, answered = 0, voted = 0, everyoneIn = null,
  openedAt = null, voteAt = null, askAt = null, now = Date.now(),
  arrivals = [],
  // The round timer (config/roundTimer.js): the timer of the phase that is
  // on, or null with No limit. `now` is the SERVER's time then.
  timer = null,
  // Under reduced motion the ring moves in steps (D3: 10 s), not every second.
  ringStepMs = 0,
  // A format with no vote (Trivia, Poll; 2g): no vote count, ever.
  noVote = false,
  // The answers are options (answersAreChoices): "still answering", not "still writing".
  choice = false,
} = {}) {
  const phase = pulsePhase(moment);
  const prog = progress || progressFromCounts({ moment, players, answered, voted, noVote, choice });
  const here = Number.isFinite(Number(prog.here)) ? Number(prog.here) : Math.max(0, Number(players) || 0);

  // THE ROOM
  let room;
  const live = COLLECTING_PHASES.has(phase) ? liveStepOf(prog) : null;
  if (live) {
    const all = everyoneIn === null || everyoneIn === undefined ? live.all : Boolean(everyoneIn);
    const nudge = all && live.of > 0 ? { text: PULSE_WORDS.everyoneIn, title: '' } : waitingWords(live);
    // This round's earlier steps, small: "✓ 15/15 answered".
    const earlier = prog.steps.filter((s) => s.id !== live.id && s.closed && s.id !== 'ask')
      .filter((s) => !(s.id === 'vote' && s.done === 0))
      .map((s) => `${s.all ? '✓ ' : ''}${progressWords(s)}`);
    room = {
      eyebrow: live.id === 'ask' ? PULSE_WORDS.theRoomsQuestion : PULSE_WORDS.theRoom,
      value: String(live.done),
      of: `/${live.of}`,
      verb: live.verb,
      bar: live.of > 0 ? Math.min(1, live.done / live.of) : 0,
      everyoneIn: all && live.of > 0,
      nudge: nudge.text,
      nudgeTitle: nudge.title,
      steps: earlier.join(' · '),
      record: '',
    };
  } else if (phase === 'after' || phase === 'ask') {
    room = {
      eyebrow: PULSE_WORDS.thisRound, value: '', of: '', verb: '', bar: null, everyoneIn: false,
      nudge: '', nudgeTitle: '', steps: '', record: recordWords(prog),
    };
  } else {
    room = {
      eyebrow: PULSE_WORDS.people, value: String(here), of: '', verb: PULSE_WORDS.here, bar: null, everyoneIn: false,
      nudge: here === 0 ? PULSE_WORDS.nobodyYet : '', nudgeTitle: '', steps: '', record: '',
    };
  }

  // THE TIME: only while a step collects, and only from a stamp the page was given.
  let time = null;
  if (live) {
    const from = msOf(live.id === 'vote' ? voteAt : live.id === 'ask' ? askAt : openedAt);
    time = from !== null
      ? { value: `${PULSE_WORDS.openLower} ${formatClock(now - from)}`, sub: '', state: 'none', ring: null }
      : null;
    const tl = timer ? timeLeft(timer, now) : null;
    if (tl && live.id !== 'ask') {
      const given = timerClock(tl.givenMs);
      const step = Number(ringStepMs) > 0 ? Number(ringStepMs) : 0;
      const ringNow = step ? Math.floor(Number(now) / step) * step : now;
      const ringTl = timeLeft(timer, ringNow) || tl;
      const added = Math.round(tl.extendedMs / 60000);
      time = tl.up
        ? { value: TIMER_WORDS.timesUp, sub: TIMER_WORDS.overOf(timerClock(tl.overMs), given), state: 'up', ring: 0 }
        : {
          value: timerClock(tl.leftMs),
          sub: TIMER_WORDS.leftOf(given) + (added > 0 ? ` · ${TIMER_WORDS.added(added)}` : ''),
          state: added > 0 ? 'extended' : 'running',
          ring: ringTl.fraction,
        };
    }
  }

  // JOINERS SINCE THE ROUND OPENED, only when there are some.
  const names = phase === 'lobby' ? [] : (arrivals || []).filter(Boolean);
  const joined = names.length ? PROGRESS_WORDS.joined(names) : '';

  return { phase, room, time, joined };
}

/*
  ONE FACT, ONCE (D3: "The count leaves the People header and the status
  line"; engage-design hard rule 5). roundStep's status leads with the room's
  count ("3 of 4 answered", "All 4 voted") and ends with the late count; on the
  console the room tile says the count for every step that collects (the
  room's question included, cut 5), and the Needs-you line and the rail's
  Late & not reviewed carry the late count, so the card's status keeps only
  what is left (which response is up, the read's page). The dock and the
  Remote keep roundStep's line as it is.
*/
const COUNT_LEAD = /^(?:All \d+ (?:answered|voted)|\d+ of \d+ (?:answered|voted))(?: · |$)/;

export function withoutRoomCount(status, moment) {
  if (!status || !status.text) return status;
  const phase = pulsePhase(moment);
  let text = status.text;
  let changed = false;
  // The late count is always the last part (roundStep withLate); at the end it is the whole line.
  if (status.late && status.late.line) {
    const at = text.indexOf(status.late.line);
    if (at >= 0) { text = text.slice(0, at).replace(/ · $/, ''); changed = true; }
  }
  if (COLLECTING_PHASES.has(phase) && COUNT_LEAD.test(text)) {
    text = text.replace(COUNT_LEAD, '');
    changed = true;
  }
  if (!changed) return status;
  const { late, ...rest } = status; // eslint-disable-line no-unused-vars
  return { ...rest, text, tone: text ? status.tone : '' };
}
