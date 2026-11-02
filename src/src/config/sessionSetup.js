/**
 * SETUP IS THE LOBBY (docs/design/session-start D1, F1, F5, F6, F7, F8;
 * experience plan Phase 2 step 2b; owner, 1 Nov 2026: "this should be the start
 * of the session making these screen adjustments and offering the QR code").
 *
 * Start opens Setup, in both modes, and Setup is the lobby. Three steps, each
 * folding to one line once done:
 *
 *   1  Where the room watches   the chooser (RoomScreenChooser), asked whenever
 *                               this browser has not chosen, on every tier
 *   2  Put the room's screen up two screens: the room's window, as a checklist
 *                               of what the app can verify (open, full screen);
 *                               one screen: a check that the room can read it
 *   3  The room joins           the join code goes up only now, with the count,
 *                               who just arrived, and what round 1 is
 *
 * "Your part now" leads every step with its one main button, and moves with
 * the step (QA, 1 Nov: after choosing two screens it still said "Choose where
 * the room watches"). Pure: the page passes what it knows, this says where the
 * host is and what to say.
 */
import { presentStatusFrom } from './presentStatus';

/** Step ids, in order. */
export const SETUP_STEPS = Object.freeze(['where', 'screen', 'joins']);

/** Who counts as "just arrived": joined in the last minute. */
export const RECENT_MS = 60 * 1000;

export const SETUP_WORDS = Object.freeze({
  label: 'Setup',
  // Step headings: open, then folded to one line once done.
  whereOpen: 'Where will the room watch?',
  whereDone: 'Where the room watches',
  twoScreens: 'Two screens',
  oneScreen: 'One screen',
  windowOpen: 'Put the room\'s window up',
  windowDone: 'Room\'s window',
  checkOpen: 'Check the room can read this screen',
  checkDone: 'The room\'s screen',
  checked: 'Checked',
  joins: 'The room joins',
  change: 'Change',
  after: (n) => `after step ${n}`,
  // What step 3 says before it opens, by mode.
  codeHereTwo: 'the join code goes up on the room\'s window',
  codeHereOne: 'the join code fills this screen',
  codeHere: 'the join code goes up here',
  // Step states, for a screen reader (reviews L5: the step names carry their state).
  stateDone: 'done',
  stateNow: 'now',
  stateLater: 'later',
  stepOf: (n, state) => `Step ${n}, ${state}`,
  // Step 2 on two screens: what the app can verify, never "it is on".
  checkOpenItem: 'Open',
  checkFullItem: 'Full screen',
  notOpenYet: 'not open yet',
  openElsewhere: 'opened',
  fillHint: 'one click on the room\'s window, or press F',
  hiddenHint: 'the room\'s window is hidden or minimised',
  draggedHere: 'Opened on this screen?',
  dragHint: 'Drag it onto the room\'s screen, then click it once.',
  blocked: 'Your browser stopped the room\'s window opening with Start. Open it here.',
  // Step 2 on one screen.
  roomSeesThis: 'The room sees this screen from now on.',
  remoteK: 'Keep Workie\'s notes private:',
  remoteText: (addr, code) => `open ${addr} on your phone, sign in and enter ${code}. Your phone is then the Remote: the private notes, the late list and the main button.`,
  useTwoInstead: 'Prefer to keep this laptop private?',
  useTwo: 'Use two screens',
  // Step 3.
  inTheRoom: 'in the room',
  nobodyYet: 'Nobody yet. The join code is up.',
  justArrived: (n) => `${n} in the last minute:`,
  firstUp: 'First up',
  runningOrder: 'Running order',
  // The preview column.
  previewK: 'What the room sees',
  previewKBefore: 'What the room will see',
  nothingYet: 'Nothing yet. The join code goes up at step 3.',
  previewOpens: 'The room\'s window opens on the join screen, so the code is up the moment the room can see it.',
  previewWholeScreen: 'This whole screen',
  previewWholeLine: 'Setup now; the join code at step 3; then every round.',
  lateJoin: 'Late arrivals can always come in: Join on the top bar puts the code back up mid-round.',
  inRoom: (n) => `${n} in the room`,
  // Mid-session (Setup pressed in the strip): looking, never acting on the room.
  midNote: 'The room keeps going while you look. Changes here move only this laptop and the room\'s window.',
  // Your part now, per step. `action` is the orange words; `after` follows.
  part: Object.freeze({
    where: { action: 'Choose where the room watches.', after: ' The join code goes up once the room\'s screen is ready.' },
    window: { action: 'Open the room\'s window', after: ' and move it onto the room\'s screen.', status: 'It opens on your other display, and one click on it fills that display.' },
    check: { action: 'Check the room can read this screen,', after: ' then put the join code up.', status: 'From the back of the room, can you read this line?' },
    fill: { action: 'Click the room\'s window once', after: ' to fill the room\'s screen. People can already join.' },
    ready: { after: ' when the room is in.', statusTwo: 'The join code is on the room\'s window.' },
  }),
  // The main buttons Setup owns (round 1 is roundStep's own Start).
  openWindow: 'Open the room\'s window ↗',
  showCode: 'Show the join code',
  afterSetup: (start) => `${start} · after setup`,
});

/** True when the app can see the room's window up (any state but closed). */
function windowUp(detail, nowMs) {
  return presentStatusFrom(detail, nowMs).state !== 'closed';
}

/**
 * Which step is open: 'where', 'screen' or 'joins'.
 *   choice     the page's choice: 'two' | 'classic' | null (never chosen)
 *   choosing   the host pressed Change on step 1
 *   detail     the room's window (presentDetail), on two screens
 *   checked    one screen: the host said the room can read it
 */
export function setupStepFor({ choice = null, choosing = false, detail = null, checked = false, nowMs = Date.now() } = {}) {
  if (choice !== 'two' && choice !== 'classic') return 'where';
  if (choosing) return 'where';
  if (choice === 'two') return windowUp(detail, nowMs) ? 'joins' : 'screen';
  return checked ? 'joins' : 'screen';
}

/** The step's number, 1-3. */
export const stepNumber = (id) => SETUP_STEPS.indexOf(id) + 1;

/**
 * "Your part now" for Setup's step, in the console's shape
 * ({ before, action, after }, plus the status line under it).
 * `startLabel` is the main button's own label at step 3 (roundStep's
 * "Start round 1"), so the line and the button never disagree.
 */
export function setupPartFor(step, { choice = null, detail = null, startLabel = '', nowMs = Date.now() } = {}) {
  const P = SETUP_WORDS.part;
  if (step === 'where') return { part: { before: '', ...pick(P.where) }, status: '' };
  if (step === 'screen') {
    const w = choice === 'two' ? P.window : P.check;
    return { part: { before: '', ...pick(w) }, status: w.status };
  }
  // The room joins. On two screens a window that is up but not full screen
  // still needs the one click the page cannot do for the host (A8).
  if (choice === 'two') {
    const s = presentStatusFrom(detail, nowMs).state;
    if (s === 'windowed' || s === 'hidden') {
      return { part: { before: '', ...pick(P.fill) }, status: '' };
    }
  }
  return {
    part: { before: '', action: startLabel, after: P.ready.after },
    status: choice === 'two' ? P.ready.statusTwo : '',
  };
}
const pick = ({ action, after }) => ({ action, after });

/**
 * The people who joined in the last minute, oldest first (the names step 3
 * says in text). A player row carries `joinedAt` (ISO or ms).
 */
export function recentArrivals(players, nowMs = Date.now(), windowMs = RECENT_MS) {
  const ms = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(n) ? n : null;
  };
  return (players || [])
    .map((p) => ({ name: p && (p.name || p.playerName), at: ms(p && (p.joinedAt || p.JoinedAt)) }))
    .filter((p) => p.name && p.at !== null && nowMs - p.at <= windowMs && p.at <= nowMs + 5000)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.name);
}

/**
 * The checklist for two screens' step 2: what the app can verify about the
 * room's window, from its reported state. Each item is done, waiting or not
 * yet, with the hint beside it.
 */
export function windowChecklist(detail, nowMs = Date.now()) {
  const W = SETUP_WORDS;
  const s = presentStatusFrom(detail, nowMs).state;
  const open = s !== 'closed';
  return [
    { id: 'open', label: W.checkOpenItem, state: open ? 'done' : 'todo', hint: open ? W.openElsewhere : W.notOpenYet },
    {
      id: 'full',
      label: W.checkFullItem,
      state: s === 'on' ? 'done' : (open ? 'wait' : 'todo'),
      hint: s === 'on' ? '' : (s === 'hidden' ? W.hiddenHint : W.fillHint),
    },
  ];
}
