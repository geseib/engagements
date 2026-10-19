/**
 * THE BUILD ROOM'S LAPTOP ON TWO SCREENS, AS DATA (parity PLAN §2 B8;
 * docs/design/build-room-console/ views 1a-1e and 4; docs/design/
 * build-room-consider/ frame 1, approved by the owner on 19 Oct 2026: "yes
 * build consider and the console as drawn").
 *
 * The console is Call & Answer's (components/console/HostConsole): the top
 * line, the strip under it, four rail slots on the left, "Your part now" at
 * the top of the centre with the main button in it, the moment's work under
 * it, and the Build Room's folds in a side column. This file decides, for one
 * moment, what each of those says. BuildConsole.jsx draws it; the page wires
 * the panels it already had into it.
 *
 * The five answers (PLAN §2.9b): (a) on the result the second button is Spin
 * the wheel (buildControls' `decideInline`); (b) with no main move the slot is
 * held and says so; (c) the strip stays between asks, dimmed, with a plain
 * label on its left; (d) four slots left, folds right; (e) People ticks who has
 * answered, by name, while the room answers or votes, never what they chose.
 *
 * Pure: no React, no fetch.
 */
import { askPathStep, runOf, runDoneCount, whatsNextMoves } from './buildScreens';
import { KIND_LABEL, askNumber } from './screens/common';

/** The console's own words (sentence case, plain; the rest are words.js's). */
export const BCW = Object.freeze({
  noMainMove: 'No main move now',
  noMainMoveHint: 'Between asks there is no single next move. What\'s next below has the likely ones.',
  waiting: 'Waiting for you',
  newSinceLooked: (n) => (n === 1 ? '1 new since you looked' : `${n} new since you looked`),
  markAllSeen: 'Mark all seen',
  people: 'People',
  later: 'Later',
  pointsInside: 'Points inside',
  session: 'Session',
  openInMain: 'Open the queue in the main area',
  openLaterInMain: 'Open Later and Points in the main area',
  backToNow: 'Back to the moment',
  queueInMain: 'Waiting for you, in the main area',
  laterInMain: 'Later and Points, in the main area',
  inMainNote: 'Open in the main area.',
  allPlayers: 'All players',
  away: 'Away',
  builders: 'Builders',
  builder: 'Builder',
  answered: 'answered',
  voted: 'voted',
  suggested: 'suggested',
  notYet: 'not yet',
  nobodyHere: 'Nobody has joined yet.',
  claudeConnected: 'Claude connected',
  claudeOffline: 'Claude not connected',
  connectClaude: 'Connect Claude',
  pluginLatest: 'Claude\'s plugin',
  pluginOld: 'Claude\'s plugin is out of date: update it',
  crew: 'Crew',
  lookHere: 'Look here, privately:',
  build: 'Build',
  history: 'History',
  sessionPanel: 'Session panel',
  screens: 'Screens',
  players: 'Players',
  settings: 'Settings',
  backToOpening: 'Back to the opening',
  wrapUp: 'Wrap up',
  report: 'Report',
  endSession: 'End session',
  now: 'Now',
  lastDecided: (n, what) => `Last decided, ask ${n}: ${what}.`,
  nothingDecided: 'Nothing decided yet.',
  shotsSoFar: (n) => (n === 1 ? '1 screenshot so far.' : `${n} screenshots so far.`),
  forYou: 'For you · note for Claude',
  claudeAsked: 'Claude asked this.',
  askAnswerForRoom: 'Answer for the room',
  boardHintCollect: 'The room sees these options and the count, no names.',
  boardHintSettle: 'Click another option to pick it. The board on the wall has no controls, so the pick happens here.',
  sendIsMain: 'Send is the main button in Your part now. Your draft is kept per ask.',
  pointKicker: 'Talk it over · a point from Claude',
  pointKickerResearch: 'Talk it over · a point from Claude\'s research',
  ideasOnThis: 'Ideas on this, as they land',
  noIdeasOnThis: 'No ideas on it yet.',
  ideasJoinWaiting: 'Each idea joins Waiting for you. Taking the point down offers to put them to a vote.',
  theSource: 'For you · the source',
  sourceNever: 'The room sees the point, never the source line.',
  claudeNow: 'Claude now',
});

// ── The moment ──────────────────────────────────────────────────────────────

const OPEN = ['live', 'voting'];

/**
 * Which of the console's moments this is. The mockup's five (between, ask,
 * results, run, point) plus the ones the Host screen already had (the
 * opening, the crew board, the codes card, ended).
 */
export function consoleMoment(room, current, { crewOn = false, codesUp = false } = {}) {
  if (!room) return 'between';
  if (room.state === 'ENDED') return 'ended';
  if (codesUp) return 'codes';
  if (crewOn) return 'crew';
  if (current) return current.status === 'results' ? 'settle' : 'collect';
  if (room.opening && room.opening.phase === 'opening') return 'opening';
  if (room.shownPoint) return 'point';
  const run = runOf(room);
  if (run && run.status === 'running') return 'run';
  return 'between';
}

// ── The strip (answer (c)) ─────────────────────────────────────────────────

const EXPLAIN = Object.freeze({
  setup: 'The opening: the room frames the build before Claude starts.',
  ask: 'The ask is up: the question the room answers.',
  collect: 'The room answers on their phones; the count is on the wall.',
  settle: 'The results: go with the room\'s choice, pick another, or spin the wheel.',
  send: 'The direction goes to Claude, as Do now, Keep in mind or Ask Claude.',
  finish: 'Wrap up: what was built, and the report.',
});

/** What the strip's left end says with no ask open. */
export function idleLabel(moment, room) {
  const run = runOf(room);
  if (moment === 'run' && run) return `The run list · ${runDoneCount(run)} of ${run.total || (run.items || []).length} done`;
  if (moment === 'point') return 'A talking point';
  if (moment === 'opening') return 'The opening';
  if (moment === 'crew') return 'The crew board';
  if (moment === 'codes') return 'The codes are up';
  if (moment === 'ended') return 'Ended';
  return 'Between asks';
}

/**
 * The Build Room's ask path in the shared strip's shape (config/workflowStrip
 * `steps`: { id, label, state: 'done'|'live'|'todo', loop, explain }):
 * Opening › [Ask n · kind: Ask, Collect, Settle, Send to Claude] › Wrap up.
 * `idle` is true when nothing in the loop is live: the console dims it.
 */
export function consoleStrip(room, current, { pickId = null, answering = false, moment = null } = {}) {
  const m = moment || consoleMoment(room, current);
  const opening = Boolean(room && room.opening && room.opening.phase === 'opening');
  const ended = Boolean(room && room.state === 'ENDED');
  const wrapped = Boolean(room && room.outcome);
  let at = -1; // index in the loop of the live step
  if (current) {
    const step = askPathStep(current, { pickId, answering });
    at = { collect: 1, settle: 2, send: 3 }[step];
    if (at === undefined) at = 1;
  }
  const loopIds = ['ask', 'collect', 'settle', 'send'];
  const loopLabels = { ask: 'Ask', collect: current && current.status === 'voting' ? 'Vote' : 'Collect', settle: 'Settle', send: 'Send to Claude' };
  const loop = loopIds.map((id, i) => ({
    id, label: loopLabels[id], loop: true, explain: EXPLAIN[id],
    state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'live' : 'todo',
  }));
  const steps = [
    { id: 'setup', label: 'Opening', explain: EXPLAIN.setup, state: opening ? 'live' : 'done' },
    ...loop,
    { id: 'finish', label: 'Wrap up', explain: EXPLAIN.finish, state: ended ? 'done' : wrapped ? 'live' : 'todo' },
  ];
  const round = current
    ? { label: `Ask ${askNumber(current.askId)} · ${KIND_LABEL[current.kind] || 'Ask'}` }
    : { label: idleLabel(m, room) };
  return { strip: { steps, round }, idle: !current };
}

// ── "Your part now" (answer (b)) ───────────────────────────────────────────

const part = (before, action = '', after = '') => ({ before, action, after });

/**
 * The card's sentence for the moment, with the main button's own label as
 * its action (so the sentence and the button never disagree), or the
 * moment's plain line when there is no main move.
 */
export function consolePart(moment, controls, room, current, { answering = false } = {}) {
  const p = controls && controls.primary;
  if (moment === 'ended') return part('The session has ended. The report and the wrap-up are in Session.');
  if (moment === 'codes' && p) return part('', p.label, ' once the room has joined.');
  if (moment === 'crew') return part('The crew board is up. Open an early look, or go back to the room\'s asks.');
  if (moment === 'opening') return part('Frame the build with the room: the brief, then Start building.');
  if (answering && p) return part('Say what the room decided, then ', p.label, '.');
  if (moment === 'collect' && p) {
    if (current && current.status === 'voting') return part('', p.label, ' when the votes stop.');
    if (current && current.kind === 'suggest') return part('', p.label, ' when the ideas slow.');
    return part('', p.label, ' when answers stop.');
  }
  if (moment === 'settle' && p) {
    if (p.action === 'to-claude') return part('Check the words, then ', p.label, '.');
    if (p.action === 'wheel' || p.action === 'spin') return part('', p.label, ', or pick one on the board.');
    if (p.action === 'noop') return part('The wheel is turning.');
    if (p.action === 'reopen') return part('Nobody rated yet: ', p.label, '.');
    if (String(p.action).startsWith('points-')) return part('Highlight what moves forward, then ', p.label, '.');
    return part('', p.label, '.');
  }
  if (moment === 'run' && p) {
    if (p.action === 'run-stop') return part('The last item is Claude\'s. ', p.label, ' when it is done.');
    return part('When Claude finishes the item, ', p.label, '.');
  }
  if (moment === 'point' && p) return part('The room talks it over. Then ', p.label, '.');
  if (p) return part('', p.label, '.');
  // No main move: the likely one, in words, never as a button (answer (b)).
  const moves = room ? whatsNextMoves(room) : [];
  const first = moves.find((x) => !['ask-room', 'tell'].includes(x.key));
  return first ? part(`${first.title}, or tell Claude what is next.`) : part('Tell Claude what is next, or ask the room.');
}

/** What the wall shows next, under the card's sentence, or ''. */
export function nextOnWall(moment, current) {
  if (moment === 'collect') return current && current.kind === 'suggest' && current.status === 'live' ? 'Next on the wall: the vote' : 'Next on the wall: the results';
  if (moment === 'settle') return 'The wall shows the results';
  if (moment === 'run') return 'The wall shows the run list';
  if (moment === 'point') return 'The wall shows the point';
  return '';
}

// ── The rail (answer (d)) ───────────────────────────────────────────────────

/** The four slots, in order: C&A's rail with the Build Room's sections. */
export const RAIL_SLOTS = Object.freeze(['waiting', 'people', 'later', 'session']);

/** The slot that opens by itself for the moment. The host's own choice holds until the moment changes. */
export function railOpenFor(moment) {
  if (moment === 'collect' || moment === 'settle') return 'people';
  if (moment === 'run') return 'later';
  if (moment === 'ended') return 'session';
  return 'waiting';
}

// ── People (answer (e)) ────────────────────────────────────────────────────

/**
 * Who is in the room, and while the room answers or votes, who has: names
 * only (the laptop is private), never what anyone chose. `answeredBy` is the
 * host's read of the open ask (build-store.js askView, host only).
 */
export function peopleRows(room, current) {
  const names = ((room && room.players) || []).map((p) => (typeof p === 'string' ? p : (p && (p.name || p.playerName)) || '')).filter(Boolean);
  const builders = new Set((((room && room.crew && room.crew.enabled && room.crew.builders) || [])).filter((b) => !b.closed).map((b) => b.name));
  const open = Boolean(current && OPEN.includes(current.status));
  const done = new Set(open ? (current.answeredBy || []) : []);
  const verb = !open ? '' : current.status === 'voting' ? BCW.voted : current.kind === 'suggest' ? BCW.suggested : BCW.answered;
  const rows = names.map((name) => ({
    name,
    builder: builders.has(name),
    state: !open ? 'here' : done.has(name) ? 'answered' : 'not-yet',
  }));
  const n = rows.filter((r) => r.state === 'answered').length;
  const here = (room && room.playerCount) || names.length;
  const summary = open ? `${n} of ${here} ${verb}` : `${here} here`;
  return { rows, summary, verb, open };
}

// ── The side column's Now card ─────────────────────────────────────────────

/** "Last decided, ask 2: a week calendar." and the screenshots so far. */
export function nowCard(room) {
  const decided = ((room && room.asks) || []).filter((a) => a.status === 'decided')
    .sort((a, b) => String(a.decidedAt || '').localeCompare(String(b.decidedAt || '')));
  const last = decided[decided.length - 1] || null;
  let line = BCW.nothingDecided;
  if (last) {
    const d = String((last.decision && last.decision.direction) || last.prompt || '').trim();
    const short = d.length > 90 ? `${d.slice(0, 90).trimEnd()}…` : d.replace(/[.!?]+$/, '');
    line = BCW.lastDecided(askNumber(last.askId), short);
  }
  return { line, shots: BCW.shotsSoFar(((room && room.images) || []).length) };
}
