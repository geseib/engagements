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
 * The closed set (R2). COMPOSE, ROOM_QUESTION and ROOM_RESULTS belong to Ask
 * the room (Phase 5) and are named now so the set does not change shape later;
 * `momentOf` does not produce them yet. FEEDBACK is the existing third beat of
 * RESULTS (a feedback round), kept until Ask the room replaces it.
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
    case 'VOTE_RESPONSES': {
      // Step the room through the responses in voting order; after the last,
      // the step is what VOTING's was: Show results, armed while people vote.
      const { index, part, parts, total } = ctx.responses;
      if (parts > 1 && part < parts - 1) {
        return control('next-part', RW.nextPart, I.NEXT_PART, 'ArrowRight', { index, part: part + 1, parts });
      }
      if (index < total - 1) {
        return control('next-response', RW.nextResponse, I.NEXT_RESPONSE, 'ArrowRight', { index: index + 1, part: 0 });
      }
      return primaryFor('VOTING', ctx);
    }
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
      return control('next', RW.nextRound(noun), I.NEXT, 'ArrowRight');
    }
    case 'FEEDBACK':
      return control('next', RW.nextRound(noun), I.NEXT, 'ArrowRight');
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
      // THE RESPONSES, DURING VOTING (owner, 2026-10-13): shown like results,
      // names hidden, in the voting order every ballot shows. Skip stays the
      // secondary while there is nothing to show.
      if (ctx.answerCount > 0) {
        return control('show-response', RW.showResponse(1, ctx.answerCount), I.SHOW_RESPONSE, 'ArrowsOut', { index: 0, part: 0 });
      }
      return control('skip', RW.skipRound(noun), I.SKIP, 'SkipForward', { arm: { text: RW.armSkip(noun) } });
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
    case 'VOTE_RESPONSES':
      return control('stop-showing', RW.stopShowing, I.STOP_SHOWING, 'X');
    case 'READ':
      // Mid-read (or before it is written) the way past the rest is the plain
      // Next round; on the last page the slot holds Request feedback.
      if (primary.id === 'next') return control('request-feedback', RW.requestFeedback, I.FEEDBACK, 'ChatCircleText');
      return control('next', RW.nextRound(noun), I.NEXT, 'SkipForward');
    case 'FEEDBACK':
      return control('close-feedback', RW.backToRead, I.FIELD_NOTES, 'ArrowLeft');
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

  switch (moment) {
    case 'LOBBY':
      if (!ctx.hasQuestionSet) return { text: RW.pickSet, tone: 'error' };
      if (playerCount === 0) return { text: RW.waitingToJoin, tone: 'pending' };
      if (!Number.isFinite(playerCount)) return { text: '', tone: '' };
      return toned(RW.ready(playerCount));
    case 'ANSWERING':
      return counted(RW.answered);
    case 'VOTING':
      return counted(RW.voted);
    case 'RESULTS':
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.resultsOnScreen);
    case 'VOTE_RESPONSES': {
      const { index, part, parts, total } = ctx.responses;
      const which = parts > 1
        ? `${RW.showingResponse(index + 1, total)} · ${RW.partOf(part + 1, parts)}`
        : RW.showingResponse(index + 1, total);
      const vote = counted(RW.voted);
      return toned(vote.text && vote.text !== RW.waitingToJoin ? `${which} · ${vote.text}` : which);
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
      if (pages > 1) return toned(RW.readingPage(page + 1, pages));
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.readOnScreen);
    }
    case 'FEEDBACK':
      return ctx.goalLine ? { text: ctx.goalLine, tone: 'notice' } : toned(RW.feedbackOpen);
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
      if (primary.id === 'next-part') return L.RESPONSES_PART;
      if (primary.id === 'next-response') return L.RESPONSES_NEXT;
      return L.VOTING;
    case 'RESPONSES':
      if (primary.id === 'next-part') return L.RESPONSES_PART;
      if (primary.id === 'next-response') return L.RESPONSES_NEXT;
      return L.RESULTS;
    case 'READ':
      if (primary.id === 'show-read') return L.READ_WAIT;
      if (primary.id === 'notes-page') return L.READ_PAGE;
      return L.READ_LAST;
    case 'OTHER': return L.UNKNOWN;
    default: return L[moment] || L.UNKNOWN;
  }
}

/** Fill the defaults every reader relies on, so the rules never see undefined. */
function normaliseContext(ctx = {}) {
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
  return {
    ...ctx,
    roundNoun: noun,
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
