/**
 * THE PULSE (docs/design/session-start/README.md D3; experience plan §3.2a,
 * Phase 2 step 2c): three tiles under the Needs-you line, one fact each, in the
 * same place in every phase.
 *
 *   1 · the room   Answered 9 of 12 + bar → Everyone's in (Voted during voting;
 *                  "This round" with both counts once the round has closed)
 *   2 · time       with a timer (2f, config/roundTimer.js): "0:47 left of
 *                  2:00" with a draining ring, +1 min; amber "Time's up ·
 *                  0:18 over 2:00" at zero, counting over. With no limit:
 *                  "Open 1:24", elapsed since the round opened
 *                  (currentQuestion.startedAt, else when this page saw the
 *                  phase change); voting from when voting opened
 *   3 · since      +N joined since this round opened, with the names; the late
 *                  count, a link to the Needs-you item that reviews them
 *
 * Pure: the component ticks the clock and passes `now`. The count lives here
 * and nowhere else on the console (engage-design hard rule 5: the People header
 * says "N here", and the Your-part-now status drops the count, withoutRoomCount).
 */
import LW from './lateWords';
import { timeLeft, clock as timerClock, TIMER_WORDS } from './roundTimer';

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
  ROOM_QUESTION: 'after',
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

/**
 * The three tiles' facts. Every tile is always there (same positions in every
 * phase); only its words change.
 */
export function pulseFor({
  moment, players = 0, answered = 0, voted = 0, everyoneIn = null,
  openedAt = null, voteAt = null, resultsAt = null, now = Date.now(),
  arrivals = [], late = 0,
  // The round timer (config/roundTimer.js): during answering or voting, the
  // timer of the phase that is on; after the round, the last phase's, for
  // "2:00 given". null with No limit. `now` is the SERVER's time then.
  timer = null,
  // Under reduced motion the ring moves in steps (D3: 10 s), not every second.
  ringStepMs = 0,
  // A format with no vote (Trivia, Poll; 2g): after the round, "N here", never "0 voted".
  noVote = false,
  // The answers are options (answersAreChoices): "still answering", not "still writing".
  choice = false,
} = {}) {
  const phase = pulsePhase(moment);
  const n = Math.max(0, Number(players) || 0);
  const a = Math.max(0, Number(answered) || 0);
  const v = Math.max(0, Number(voted) || 0);
  const opened = msOf(openedAt);
  const vote = msOf(voteAt);
  const results = msOf(resultsAt);

  // 1 · THE ROOM
  let room;
  if (phase === 'answer' || phase === 'vote') {
    const done = phase === 'answer' ? a : v;
    const all = everyoneIn === null ? n > 0 && done >= n : Boolean(everyoneIn);
    room = {
      eyebrow: phase === 'answer' ? PULSE_WORDS.answered : PULSE_WORDS.voted,
      value: String(done),
      of: `of ${n}`,
      bar: n > 0 ? Math.min(1, done / n) : 0,
      everyoneIn: all,
      sub: n === 0 ? PULSE_WORDS.nobodyYet
        : all ? PULSE_WORDS.everyoneIn
          : `${Math.max(0, n - done)} ${phase === 'answer' ? (choice ? PULSE_WORDS.stillAnswering : PULSE_WORDS.stillWriting) : PULSE_WORDS.stillVoting}`,
    };
  } else if (phase === 'after') {
    room = { eyebrow: PULSE_WORDS.thisRound, value: String(a), of: PULSE_WORDS.answeredLower, bar: null, everyoneIn: false, sub: noVote ? `${n} ${PULSE_WORDS.here}` : `${v} ${PULSE_WORDS.votedLower}` };
  } else {
    room = { eyebrow: PULSE_WORDS.people, value: String(n), of: PULSE_WORDS.here, bar: null, everyoneIn: false, sub: n === 0 ? PULSE_WORDS.nobodyYet : PULSE_WORDS.inTheRoom };
  }

  // 2 · TIME (no limit yet: elapsed)
  let time;
  if (phase === 'answer') {
    time = { eyebrow: PULSE_WORDS.time, value: opened !== null ? `${PULSE_WORDS.open} ${formatClock(now - opened)}` : PULSE_WORDS.open, sub: PULSE_WORDS.noLimit };
  } else if (phase === 'vote') {
    const from = vote !== null ? vote : opened;
    time = {
      eyebrow: PULSE_WORDS.time,
      value: from !== null ? `${PULSE_WORDS.open} ${formatClock(now - from)}` : PULSE_WORDS.open,
      sub: vote !== null && opened !== null && vote > opened ? `${PULSE_WORDS.answeringTook} ${formatClock(vote - opened)}` : PULSE_WORDS.noLimit,
    };
  } else if (phase === 'after') {
    const end = vote !== null ? vote : results;
    const took = opened !== null && end !== null && end > opened ? end - opened : null;
    time = {
      eyebrow: PULSE_WORDS.time,
      value: took !== null ? `${PULSE_WORDS.took} ${formatClock(took)}` : PULSE_WORDS.roundClosed,
      sub: vote !== null && results !== null && results > vote ? `${PULSE_WORDS.votingTook} ${formatClock(results - vote)}` : '',
    };
  } else {
    time = { eyebrow: PULSE_WORDS.time, value: PULSE_WORDS.notOpen, sub: PULSE_WORDS.opensWithRound };
  }
  time.state = 'none';
  time.ring = null;
  const tl = timer ? timeLeft(timer, now) : null;
  if (tl && (phase === 'answer' || phase === 'vote')) {
    const given = timerClock(tl.givenMs);
    const step = Number(ringStepMs) > 0 ? Number(ringStepMs) : 0;
    const ringNow = step ? Math.floor(Number(now) / step) * step : now;
    const ringTl = timeLeft(timer, ringNow) || tl;
    const added = Math.round(tl.extendedMs / 60000);
    if (tl.up) {
      time = { eyebrow: PULSE_WORDS.time, value: TIMER_WORDS.timesUp, sub: TIMER_WORDS.overOf(timerClock(tl.overMs), given), state: 'up', ring: 0 };
    } else {
      time = {
        eyebrow: PULSE_WORDS.time,
        value: timerClock(tl.leftMs),
        sub: TIMER_WORDS.leftOf(given) + (added > 0 ? ` · ${TIMER_WORDS.added(added)}` : ''),
        state: added > 0 ? 'extended' : 'running',
        ring: ringTl.fraction,
      };
    }
  } else if (tl && phase === 'after') {
    const rest = time.sub ? ` · ${time.sub.charAt(0).toLowerCase()}${time.sub.slice(1)}` : '';
    time = { ...time, sub: `${TIMER_WORDS.given(timerClock(tl.givenMs))}${rest}` };
  }

  // 3 · SINCE THIS ROUND OPENED
  const names = phase === 'lobby' ? [] : (arrivals || []).filter(Boolean);
  const lateN = Math.max(0, Number(late) || 0);
  const since = {
    eyebrow: PULSE_WORDS.since,
    value: phase === 'lobby' ? PULSE_WORDS.noRoundYet : (names.length ? PULSE_WORDS.joined(names.length) : PULSE_WORDS.noOneNew),
    names,
    sub: names.join(', '),
    late: lateN > 0 ? { count: lateN, text: LW.statusCount(lateN, false) } : null,
  };

  return { phase, room, time, since };
}

/*
  ONE FACT, ONCE (D3: "The count leaves the People header and the status
  line"; engage-design hard rule 5). roundStep's status leads with the room's
  count ("3 of 4 answered", "All 4 voted") and ends with the late count; on the
  console the pulse says both (tile 1 and tile 3, whose late line opens the
  Needs-you item's review), so the card's status keeps only what is left
  (which response is up, the read's page). The dock and the Remote keep
  roundStep's line as it is.
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
  if ((phase === 'answer' || phase === 'vote') && COUNT_LEAD.test(text)) {
    text = text.replace(COUNT_LEAD, '');
    changed = true;
  }
  if (!changed) return status;
  const { late, ...rest } = status; // eslint-disable-line no-unused-vars
  return { ...rest, text, tone: text ? status.tone : '' };
}
