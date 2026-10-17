/**
 * THE WORKFLOW STRIP (session flow v3, RECOMMENDATIONS §4.6; owner, 14 Oct:
 * "i as a host know where i am and what is expected of me").
 *
 *   ✓ Setup › [ Round 2 of 6  ✓ Answer  ✓ Vote  (What we heard · page 2 of 6)  Ask · 3 ready ] › Finish
 *   YOUR PART NOW  Read with the room. Next page turns the page.
 *
 * Pure data, read from the step roundStep already decided, so the laptop's
 * strip and the Remote's dots cannot disagree with the button bar: "Your part
 * now" is built around the primary's own label. The strip adds no buttons and
 * no second way to act; pressing a step only explains it or opens a private
 * view of it (owner, 14 Oct: looking only).
 *
 * Never on the wall or on a participant's phone, laptop or tablet.
 */
import RW from './roundWords';
import { hostRunsVotePhase } from './hostControls';
import { normaliseContext, stepFor } from './roundStep';

/** Which step is live in each moment. */
const LIVE_STEP = Object.freeze({
  LOBBY: 'setup',
  ANSWERING: 'answer',
  VOTING: 'vote',
  VOTE_RESPONSES: 'vote',
  RESULTS: 'heard',
  RESPONSES: 'heard',
  READ: 'heard',
  FEEDBACK: 'heard',
  COMPOSE: 'ask',
  ROOM_QUESTION: 'ask',
  ROOM_RESULTS: 'ask',
  ENDED: 'finish',
});

/** The steps in order: Setup, the round's loop, Finish. */
export function stepIdsFor(gameType) {
  return hostRunsVotePhase(gameType)
    ? ['setup', 'answer', 'vote', 'heard', 'ask', 'finish']
    : ['setup', 'answer', 'heard', 'ask', 'finish'];
}

export const LOOP_STEPS = Object.freeze(['answer', 'vote', 'heard', 'ask']);

const LABEL = {
  setup: RW.stepSetup,
  answer: RW.stepAnswer,
  vote: RW.stepVote,
  heard: RW.whatWeHeard,
  ask: RW.stepAsk,
  finish: RW.stepFinish,
};

/** The step's own name, for the "Viewing …" bar. */
export const stepLabel = (id) => LABEL[id] || '';

const lower = (text) => String(text || '').toLowerCase();

/** The live step's sub-state: "page 2 of 6", "results", "3 ready". */
function subFor(id, moment, ctx) {
  const responses = ctx.responses || {};
  const notes = ctx.notes || {};
  if (id === 'vote' && moment === 'VOTE_RESPONSES') {
    return lower(RW.responseOf((responses.index || 0) + 1, responses.total || 1));
  }
  if (id === 'heard') {
    if (moment === 'RESULTS') return lower(RW.stepResults);
    if (moment === 'RESPONSES') return lower(RW.responseOf((responses.index || 0) + 1, responses.total || 1));
    if (moment === 'FEEDBACK') return lower(RW.stepFeedback);
    if (moment === 'READ') {
      if (notes.ready === false) return lower(RW.workieWriting);
      return (notes.pages || 1) > 1 ? lower(RW.pageOf((notes.page || 0) + 1, notes.pages)) : '';
    }
  }
  if (id === 'ask') {
    // ROOM_QUESTION: no sub-state; the step's own LIVE mark says it (external
    // review, 15 Oct: "Ask · live · Live" said it twice).
    if (moment === 'ROOM_RESULTS') return lower(RW.stepResults);
  }
  return '';
}

/** Which "Your part now" line a moment reads. */
function partKey(moment, step, ctx = {}) {
  // Picking applies to Ideas only (review of test a76fda95, issue #34 P3):
  // a Choose or a Rate result has nothing to pick.
  if (moment === 'ROOM_RESULTS') {
    return ctx.roomAsk && ctx.roomAsk.kind === 'ideas' ? 'ROOM_RESULTS' : 'ROOM_RESULTS_ANSWER';
  }
  if (moment === 'READ') {
    if (step.primary.id === 'show-read') return 'READ_WAIT';
    if (step.primary.id === 'notes-page') return 'READ_PAGE';
    if (step.primary.id === 'ask-room') return 'READ_ASK';
    return 'READ_LAST';
  }
  return moment;
}

/**
 * The strip for one moment.
 *
 * @param step  roundStep's result for the moment ({ moment, primary, … })
 * @param ctx   the snapshot roundStep read (normalised or not): gameType,
 *              roundNoun, roundNumber/state, totalRounds, notes, focus,
 *              asksReady
 * @returns {{ live, round, steps, part, action } | null}
 *   `steps`: [{ id, label, state: 'done'|'live'|'todo', optional, sub, explain }]
 *   `part`:  "Your part now" as { before, action, after }, or null
 */
export function workflowStrip(step, rawCtx = {}) {
  const ctx = normaliseContext(rawCtx);
  const moment = step && step.moment;
  const live = LIVE_STEP[moment];
  if (!live) return null;

  const ids = stepIdsFor(ctx.gameType);
  const liveAt = ids.indexOf(live);
  const ended = moment === 'ENDED';
  const asksReady = Number(ctx.asksReady) || 0;

  const steps = ids.map((id, i) => {
    let state;
    if (ended) state = id === 'finish' ? 'live' : 'done';
    else if (i === liveAt) state = 'live';
    // Ask is optional: a round that moved past the read without asking leaves
    // it unticked, never "done".
    else if (i < liveAt) state = id === 'ask' ? 'todo' : 'done';
    else state = 'todo';
    // Before round 1 the loop has not run, so nothing in it is done.
    if (moment === 'LOBBY' && id !== 'setup') state = 'todo';

    let sub = state === 'live' ? subFor(id, moment, ctx) : '';
    if (id === 'ask' && state !== 'live' && asksReady > 0 && live === 'heard') sub = RW.readyCount(asksReady);
    return {
      id,
      label: LABEL[id],
      state,
      optional: id === 'ask',
      loop: LOOP_STEPS.includes(id),
      sub,
      explain: RW.stepExplain[id],
    };
  });

  const n = Number(ctx.roundNumber) > 0 ? Number(ctx.roundNumber) : null;
  const round = n ? { n, of: Number(ctx.totalRounds) > 0 ? Number(ctx.totalRounds) : null } : null;
  if (round) round.label = RW.stripRound(ctx.roundNoun, round.n, round.of);

  // The line is written around the main button's own label, so the two can
  // never disagree (a disabled primary still names what it will do).
  const words = RW.yourPart[partKey(moment, step, ctx)];
  let part = null;
  if (words) {
    const MARK = '\u0000';
    const text = words(MARK);
    if (text.includes(MARK)) {
      const [before, after] = text.split(MARK);
      part = { before, action: (step.primary && step.primary.label) || '', after };
    } else {
      part = { before: text, action: '', after: '' };
    }
  }

  return { live, round, steps, part, roundNoun: ctx.roundNoun };
}

/** Where the room is, for the "Viewing …" bar: "Round 2, What we heard". */
export function liveWhere(strip) {
  if (!strip) return '';
  const liveStep = strip.steps.find((st) => st.state === 'live');
  const name = liveStep ? [liveStep.label, liveStep.sub].filter(Boolean).join(', ') : '';
  if (strip.live === 'setup' || strip.live === 'finish' || !strip.round) return name;
  const roundWords = RW.stripRound(strip.roundNoun, strip.round.n);
  return RW.viewingWhere(`${roundWords.charAt(0).toLowerCase()}${roundWords.slice(1)}`, name);
}

/** The strip straight from a snapshot, for a reader holding one. */
export function stripFor(snapshot) {
  return workflowStrip(stepFor(snapshot), snapshot);
}

export default workflowStrip;
