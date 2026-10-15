/**
 * ONE MOMENT, ONE DECISION FUNCTION (docs/design/simplify-round/PRINCIPLES.md
 * R1, R2; docs/design/two-surface/PLAN.md Phase 1, tasks 1.2-1.3).
 *
 * "What moment is this round in, and what is the one next step?" is answered
 * here, once, as pure data. The host page's dock (config/hostControls.js
 * `hostControlsFor`) and the Host Remote (config/hostRemote.js
 * `snapshotFromHostState`) are thin readers: each turns what it holds into
 * the same normalised snapshot, and both get the same primary, secondary,
 * status and "next on the screen" line back. __tests__/roundStepParity.test.js
 * holds them equal.
 *
 * Labels come only from config/roundWords.js (R6).
 *
 * Surveys keep their own branch in hostControls.js: a survey has no rounds, and
 * its moments (COLLECTING, CLOSED) are not round moments. Here a survey state
 * reads as OTHER.
 *
 * The snapshot, normalised:
 *   { gameType, state, stageBeat, notes: { page, pages, ready },
 *     focus: { focus, index, part, parts, phase }, progress: { received, total, allIn },
 *     playerCount, answerCount, roundNoun, hasQuestionSet, goalLine }
 */
import RW from './roundWords';
import { hostRunsVotePhase } from './hostControls';
import { statusTone } from '../utils/statusTone';

/**
 * The closed set (R2). ROOM_QUESTION and ROOM_RESULTS are Ask the room
 * (docs/design/followup-icons): the `ask` beat, a question live and then its
 * results; the snapshot's `roomAsk` ({ status, answered, total }) tells them
 * apart. COMPOSE is named and unused. FEEDBACK is RESULTS' feedback beat.
 */
export const MOMENTS = Object.freeze([
  'LOBBY', 'ANSWERING', 'VOTING', 'VOTE_RESPONSES', 'RESULTS', 'RESPONSES', 'READ', 'FEEDBACK',
  'COMPOSE', 'ROOM_QUESTION', 'ROOM_RESULTS', 'ENDED', 'OTHER', 'UNKNOWN',
]);

/**
 * What lives behind Session, not on the round's path (R7). Listed by id so a
 * surface can assert none of them is drawn in the round view.
 */
export const MORE_IDS = Object.freeze([
  'players', 'questions', 'rounds', 'categories', 'join-code', 'scoreboard',
  'big-screen', 'team', 'end', 'back-to-menu',
]);

/** The intents the host page dispatches on. Values match HOST_INTENTS. */
const I = {
  START: 'start', FINISH: 'finish', REVEAL: 'reveal', NEXT: 'next', SKIP: 'skip',
  FIELD_NOTES: 'field-notes', FEEDBACK: 'feedback', PAGE: 'notes-page',
  REPORT: 'report', LEAVE: 'leave', WAIT: 'wait',
  SHOW_RESPONSE: 'show-response', NEXT_RESPONSE: 'next-response',
  NEXT_PART: 'next-part', STOP_SHOWING: 'stop-showing',
  CLOSE_ASK: 'close-ask', CANCEL_ASK: 'cancel-ask',
  // Session flow v3 §4.3: opens the Ask the room composer. It sends nothing.
  ASK_ROOM: 'ask-room',
};

const ROUND_STATE = /^(ASK|VOTE|RESULTS?)#(\d+)$/i;

const intOr = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
};

/**
 * Is this focus an answer on the wall at RESULTS? A focus stamped in another
 * phase (VOTE) is the server's to drop and the client's to ignore: VOTE's
 * index is a voting-order position, RESULTS' is a tally position (D5).
 */
function answerFocusAtResults(focus) {
  if (!focus || focus.focus !== 'answer') return false;
  if (focus.phase && focus.phase !== 'RESULTS') return false;
  const idx = Number(focus.index);
  return Number.isInteger(idx) && idx >= 0 && focus.index !== null && focus.index !== '';
}

/** The moment, from server facts. Unknown input is UNKNOWN, never LOBBY (R2). */
export function momentOf(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'UNKNOWN';
  const state = typeof snapshot.state === 'string' ? snapshot.state.trim() : '';
  if (!state) return 'UNKNOWN';
  if (state === 'CREATED' || state === 'STARTED') return 'LOBBY';
  if (state === 'ENDED') return 'ENDED';
  if (state.startsWith('SURVEY#')) return 'OTHER';

  const m = ROUND_STATE.exec(state);
  if (!m) return 'UNKNOWN';
  const kind = m[1].toUpperCase();
  if (kind === 'ASK') return 'ANSWERING';
  if (kind === 'VOTE') {
    // RESPONSES DURING VOTING (owner, 2026-10-13): a focus the server stamped
    // VOTE is a response on the wall in voting order, names hidden. An
    // unstamped one is a legacy RESULTS focus and is not this.
    const f = snapshot.focus;
    const idx = f && Number(f.index);
    if (f && f.focus === 'answer' && f.phase === 'VOTE' && Number.isInteger(idx) && idx >= 0 && f.index !== null) {
      return 'VOTE_RESPONSES';
    }
    return 'VOTING';
  }

  if (snapshot.stageBeat === 'field-notes') return 'READ';
  // A QUESTION FOR THE ROOM (the `ask` beat): live until its results are shown.
  if (snapshot.stageBeat === 'ask') {
    return snapshot.roomAsk && snapshot.roomAsk.status === 'closed' ? 'ROOM_RESULTS' : 'ROOM_QUESTION';
  }
  if (snapshot.stageBeat === 'feedback') return 'FEEDBACK';
  return answerFocusAtResults(snapshot.focus) ? 'RESPONSES' : 'RESULTS';
}

const control = (id, label, intent, icon, extra = {}) => ({
  id, label, intent, icon, disabled: false, hint: '', ...extra,
});

/** How many are still to act, or null when the count is not known. */
function stillToAct(progress) {
  if (!progress) return null;
  const total = Number(progress.total);
  const received = Number(progress.received);
  if (!Number.isFinite(total) || !Number.isFinite(received) || total <= 0) return null;
  if (progress.allIn || received >= total) return 0;
  return total - received;
}

/**
 * "Start round 3" (owner, 14 Oct), when the round on screen is known; the
 * plain "Next round" only when it is not. Read from the state alone, so the
 * laptop and the Remote, which know different totals, always agree.
 */
function startNext(ctx) {
  const n = ctx.roundNumber;
  return n ? RW.startRound(ctx.roundNoun, n + 1) : RW.nextRound(ctx.roundNoun);
}

/** The round number in a round state ("ASK#003" -> 3), or null. */
export function roundNumberOf(state) {
  const m = ROUND_STATE.exec(typeof state === 'string' ? state.trim() : '');
  return m ? Number(m[2]) : null;
}

function primaryFor(moment, ctx) {
  const noun = ctx.roundNoun;
  const runsVote = hostRunsVotePhase(ctx.gameType);
  const waiting = stillToAct(ctx.progress);

  switch (moment) {
    case 'LOBBY': {
      let hint = '';
      if (!ctx.hasQuestionSet) hint = RW.chooseSetFirst;
      else if (ctx.playerCount === 0) hint = RW.someoneMustJoin;
      return control('start', RW.startFirst(noun), I.START, 'PlayCircle', { disabled: !!hint, hint });
    }
    case 'ANSWERING': {
      const none = ctx.answerCount === 0;
      const base = runsVote
        ? control('open-vote', RW.startVoting, I.FINISH, 'ListChecks')
        : control('reveal-from-ask', RW.showResults, I.FINISH, 'ChartBar');
      if (none) return { ...base, disabled: true, hint: RW.nobodyAnswered };
      if (waiting > 0) {
        base.arm = { text: runsVote ? RW.armVote(waiting) : RW.armResults(waiting, 'answering') };
      }
      return base;
    }
    case 'VOTING': {
      const base = control('reveal', RW.showResults, I.REVEAL, 'ChartBar');
      if (waiting > 0) base.arm = { text: RW.armResults(waiting, 'voting') };
      return base;
    }
    case 'RESULTS':
      return control('field-notes', RW.whatWeHeard, I.FIELD_NOTES, 'Sparkle');
    case 'VOTE_RESPONSES':
      // VOTING SHOWS THE RESPONSES (owner, 2026-10-13: "when going to vote, we
      // should automatically get the response screens up ... the host can
      // cycle through the response"). The one main step stays Show results;
      // cycling is the secondary, so the host never hunts for a button.
      return primaryFor('VOTING', ctx);
    case 'RESPONSES': {
      const { index, part, parts, total } = ctx.responses;
      if (parts > 1 && part < parts - 1) {
        return control('next-part', RW.nextPart, I.NEXT_PART, 'ArrowRight', { index, part: part + 1, parts });
      }
      if (index < total - 1) {
        return control('next-response', RW.nextResponse, I.NEXT_RESPONSE, 'ArrowRight', { index: index + 1, part: 0 });
      }
      return control('field-notes', RW.whatWeHeard, I.FIELD_NOTES, 'Sparkle');
    }
    case 'READ': {
      const { page, pages, ready } = ctx.notes;
      // THE READ NEVER SKIPS BY ACCIDENT (CHANGES step 1). Before Workie has
      // written, the primary is the read itself, greyed, so Space or a
      // clicker cannot carry the room past it. Leaving without it is the
      // separately aimed secondary.
      if (ready === false) {
        return control('show-read', RW.showTheRead, I.WAIT, 'Sparkle', { disabled: true, hint: RW.workieWriting });
      }
      if (pages > 1 && page < pages - 1) return control('notes-page', RW.nextPage, I.PAGE, 'ArrowRight');
      // THE READ ENDS ON A REAL STOP (session flow v3 §4.3): with Workie's
      // questions unsent, the last page's main step is Ask the room, which
      // opens the composer and sends nothing, so a clicker or Space never
      // carries the room past them.
      if (ctx.asksEnabled && ctx.asksReady > 0) return control('ask-room', RW.askTheRoom, I.ASK_ROOM, 'ChatsCircle');
      return control('next', startNext(ctx), I.NEXT, 'ArrowRight');
    }
    case 'FEEDBACK':
      return control('next', startNext(ctx), I.NEXT, 'ArrowRight');
    case 'ROOM_QUESTION': {
      // The same two-press rule as a vote: the room is still answering.
      const ask = ctx.roomAsk || {};
      const left = stillToAct({ received: ask.answered, total: ask.total });
      const show = control('close-ask', RW.showResults, I.CLOSE_ASK, 'ChartBar');
      if (left > 0) show.arm = { text: RW.armResults(left, 'answering') };
      return show;
    }
    case 'ROOM_RESULTS':
      return control('next', startNext(ctx), I.NEXT, 'ArrowRight');
    case 'ENDED':
      return control('report', RW.openReport, I.REPORT, 'FileText');
    default:
      return control('wait', RW.waitingForSession, I.WAIT, 'HourglassMedium', { disabled: true });
  }
}

function secondaryFor(moment, ctx, primary) {
  const noun = ctx.roundNoun;
  switch (moment) {
    case 'LOBBY':
    case 'ENDED':
      return control('leave', RW.backToMenu, I.LEAVE, 'House');
    case 'VOTING':
    case 'VOTE_RESPONSES': {
      // THE RESPONSES ARE ON THE WALL FROM THE START OF VOTING (owner,
      // 2026-10-13): VOTING shows Response 1 with no focus set, so its index is
      // 0. Next response steps on and wraps from the last to the first; a long
      // response steps by part first. Skip while there is nothing to show.
      if (!(ctx.answerCount > 0)) {
        return control('skip', RW.skipRound(noun), I.SKIP, 'SkipForward', { arm: { text: RW.armSkip(noun) } });
      }
      const { index, part, parts } = moment === 'VOTING' ? { index: 0, part: 0, parts: 1 } : ctx.responses;
      if (parts > 1 && part < parts - 1) {
        return control('next-part', RW.nextPart, I.NEXT_PART, 'ArrowRight', { index, part: part + 1, parts });
      }
      if (ctx.answerCount < 2) return null;
      return control('next-response', RW.nextResponse, I.NEXT_RESPONSE, 'ArrowRight', { index: (index + 1) % ctx.answerCount, part: 0 });
    }
    case 'ANSWERING':
      // Skip always asks twice on the Remote: `action: 'skip'` bypasses
      // next-question's "already asking" guard, so two in flight consume two
      // questions. The host page keeps its own handling (Phase 3 moves Skip
      // behind Session, R7).
      return control('skip', RW.skipRound(noun), I.SKIP, 'SkipForward', { arm: { text: RW.armSkip(noun) } });
    case 'RESULTS':
      return ctx.answerCount > 0
        ? control('show-response', RW.showResponse(1, ctx.answerCount), I.SHOW_RESPONSE, 'ArrowsOut', { index: 0, part: 0 })
        : null;
    case 'RESPONSES':
      return control('stop-showing', RW.stopShowing, I.STOP_SHOWING, 'X');
    case 'READ': {
      // The last page with nothing unsent: Ask the room is the second door
      // (it replaces Request feedback, whose Comments live in the composer
      // now). Where the feature is off for the tier, Request feedback stays.
      if (primary.id === 'next') {
        return ctx.asksEnabled
          ? control('ask-room', RW.askTheRoom, I.ASK_ROOM, 'ChatsCircle')
          : control('request-feedback', RW.requestFeedback, I.FEEDBACK, 'ChatCircleText');
      }
      // The last page with questions unsent: one press, the host has seen the stop.
      if (primary.id === 'ask-room') return control('next', startNext(ctx), I.NEXT, 'SkipForward');
      // Mid-read, or before it is written: leaving past Workie's unsent
      // questions takes a second press, said in place on the button
      // (owner, 15 Oct: "make sure it is obvious what is happening").
      const next = control('next', startNext(ctx), I.NEXT, 'SkipForward');
      if (ctx.asksEnabled && ctx.asksReady > 0) {
        next.arm = { text: RW.armUnasked(ctx.asksReady), confirmLabel: RW.anyway(next.label), inPlace: true };
      }
      return next;
    }
    case 'FEEDBACK':
      return control('close-feedback', RW.backToRead, I.FIELD_NOTES, 'ArrowLeft');
    case 'ROOM_QUESTION':
      return control('cancel-ask', RW.cancelQuestion, I.CANCEL_ASK, 'X');
    case 'ROOM_RESULTS':
      // Opens the composer again, with the suggestions still unsent (§4.3).
      // Where the composer is not offered, back to the read as before.
      return ctx.asksEnabled
        ? control('ask-another', RW.askAnother, I.ASK_ROOM, 'ChatsCircle')
        : control('ask-another', RW.askAnother, I.FIELD_NOTES, 'ArrowLeft');
    default:
      return null;
  }
}

function statusFor(moment, ctx) {
  const { progress, playerCount } = ctx;
  const counted = (verb) => {
    const total = Number(progress && progress.total);
    const received = Number(progress && progress.received) || 0;
    if (!Number.isFinite(total) || total <= 0) return { text: RW.waitingToJoin, tone: 'pending' };
    const done = received >= total;
    return { text: verb(received, total), tone: done ? 'success' : 'pending' };
  };
  const toned = (text) => ({ text, tone: statusTone(text) });
  // The vote count leads and keeps its tone; which response is up follows.
  const withVote = (vote, which) => (vote.text && vote.text !== RW.waitingToJoin
    ? { text: `${vote.text} · ${which}`, tone: vote.tone }
    : toned(which));

  switch (moment) {
    case 'LOBBY':
      if (!ctx.hasQuestionSet) return { text: RW.pickSet, tone: 'error' };
      if (playerCount === 0) return { text: RW.waitingToJoin, tone: 'pending' };
      if (!Number.isFinite(playerCount)) return { text: '', tone: '' };
      return toned(RW.ready(playerCount));
    case 'ANSWERING':
      return counted(RW.answered);
    case 'VOTING': {
      // Response 1 is on the wall from the start of voting.
      const vote = counted(RW.voted);
      if (!(ctx.answerCount > 0)) return vote;
      return withVote(vote, RW.showingResponse(1, ctx.answerCount));
    }
    case 'RESULTS':
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.resultsOnScreen);
    case 'VOTE_RESPONSES': {
      const { index, part, parts, total } = ctx.responses;
      const which = parts > 1
        ? `${RW.showingResponse(index + 1, total)} · ${RW.partOf(part + 1, parts)}`
        : RW.showingResponse(index + 1, total);
      return withVote(counted(RW.voted), which);
    }
    case 'RESPONSES': {
      const { index, part, parts, total } = ctx.responses;
      const text = parts > 1
        ? `${RW.showingResponse(index + 1, total)} · ${RW.partOf(part + 1, parts)}`
        : RW.showingResponse(index + 1, total);
      return toned(text);
    }
    case 'READ': {
      const { page, pages, ready } = ctx.notes;
      if (ready === false) return { text: RW.workieWriting, tone: 'pending' };
      // "Reading page 3 of 4 · 3 asks ready" (the mockup's dock line).
      const asks = ctx.asksReady > 0 ? ` · ${RW.asksReady(ctx.asksReady)}` : '';
      if (pages > 1 && page === pages - 1 && asks) return toned(`${RW.lastPage}${asks}`);
      if (pages > 1) return toned(`${RW.readingPage(page + 1, pages)}${asks}`);
      if (asks && !ctx.goalLine) return toned(`${RW.readOnScreen}${asks}`);
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.readOnScreen);
    }
    case 'FEEDBACK':
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.feedbackOpen);
    case 'ROOM_QUESTION': {
      const ask = ctx.roomAsk || {};
      const total = Number(ask.total);
      if (!Number.isFinite(total) || total <= 0) return { text: RW.waitingToJoin, tone: 'pending' };
      const answered = Number(ask.answered) || 0;
      return { text: RW.answered(answered, total), tone: answered >= total ? 'success' : 'pending' };
    }
    case 'ROOM_RESULTS':
      return toned(RW.resultsOnScreen);
    case 'ENDED':
      return toned(RW.allPlayed);
    default:
      return { text: RW.waitingForSession, tone: 'pending' };
  }
}

function nextFor(moment, ctx, primary) {
  const L = RW.nextLine;
  switch (moment) {
    case 'ANSWERING': return hostRunsVotePhase(ctx.gameType) ? L.ANSWERING : L.ANSWERING_NO_VOTE;
    case 'VOTE_RESPONSES':
      return L.VOTING;
    case 'RESPONSES':
      if (primary.id === 'next-part') return L.RESPONSES_PART;
      if (primary.id === 'next-response') return L.RESPONSES_NEXT;
      return L.RESULTS;
    case 'READ':
      if (primary.id === 'show-read') return L.READ_WAIT;
      if (primary.id === 'notes-page') return L.READ_PAGE;
      if (primary.id === 'ask-room') return L.READ_ASK;
      return L.READ_LAST;
    case 'OTHER': return L.UNKNOWN;
    default: return L[moment] || L.UNKNOWN;
  }
}

/** Fill the defaults every reader relies on, so the rules never see undefined. */
export function normaliseContext(ctx = {}) {
  const noun = String(ctx.roundNoun || 'Round').trim() || 'Round';
  const answerCount = Number.isFinite(Number(ctx.answerCount)) && ctx.answerCount !== null
    ? Math.max(0, Number(ctx.answerCount)) : null;
  const playerCount = ctx.playerCount === null || ctx.playerCount === undefined
    ? null : Number(ctx.playerCount);
  const notes = ctx.notes || {};
  const pages = Math.max(1, intOr(notes.pages, 1));
  const page = Math.min(Math.max(0, intOr(notes.page, 0)), pages - 1);
  const focus = ctx.focus || {};
  const parts = Math.max(1, intOr(focus.parts, 1));
  const total = Math.max(1, answerCount || 0, intOr(focus.index, 0) + 1);
  const totalRounds = Number(ctx.totalRounds) > 0 ? Number(ctx.totalRounds) : null;
  return {
    ...ctx,
    roundNoun: noun,
    // A reader that carries `roundNumber` is believed, null included (the
    // host page's state is a template, so it never implies round 1);
    // otherwise the number comes from the state ("ASK#003").
    roundNumber: Object.prototype.hasOwnProperty.call(ctx, 'roundNumber')
      ? (Number(ctx.roundNumber) > 0 ? Number(ctx.roundNumber) : null)
      : roundNumberOf(ctx.state),
    totalRounds,
    answerCount,
    playerCount,
    hasQuestionSet: ctx.hasQuestionSet !== false,
    goalLine: ctx.goalLine || '',
    notes: { page, pages, ready: notes.ready === false ? false : notes.ready },
    responses: {
      index: Math.max(0, intOr(focus.index, 0)),
      part: Math.min(Math.max(0, intOr(focus.part, 0)), parts - 1),
      parts,
      total,
    },
  };
}

/**
 * The step for a moment: `{ moment, primary, secondary, status, next, more }`.
 * Exactly one primary, always; at most one secondary (R3).
 */
export function roundStep(moment, rawCtx) {
  const resolved = MOMENTS.includes(moment) ? moment : 'UNKNOWN';
  const ctx = normaliseContext(rawCtx);
  const primary = primaryFor(resolved, ctx);
  const secondary = secondaryFor(resolved, ctx, primary);
  return {
    moment: resolved,
    primary,
    secondary,
    status: statusFor(resolved, ctx),
    next: nextFor(resolved, ctx, primary),
    more: MORE_IDS,
  };
}

/** The whole question in one call, for a reader holding a snapshot. */
export function stepFor(snapshot) {
  return roundStep(momentOf(snapshot), snapshot);
}

export default roundStep;
