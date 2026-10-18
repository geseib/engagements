/**
 * WHAT THE ROOM SEES, AND HOW LARGE (owner, 17 Oct 2026; parity PLAN §2d,
 * host standards §6).
 *
 *   "the experience for 1 and 2 screen destination and the default option
 *    needs to share only the most relevant info to the room. For example the
 *    call and answer when asked a question or given a lesson the most
 *    important thing is the lesson [and] the instructions. But anything on the
 *    screen worth having needs to be large type and readable. This can be more
 *    verbose on zoom screen the projector but always keep it to just what is
 *    needed."
 *
 * ONE RULE, EVERY ROOM SCREEN. The one-screen stage (GameHostPage via
 * components/QuestionCard), the two-screen room's window (present/presentModel
 * → PresentMoments) and the Build Room's projected Stage, Build and History
 * (buildroom/screens/*, which the Build Room's window draws too) all ask this
 * function which parts of a moment show and with what emphasis. No screen
 * decides it alone.
 *
 * ROLES. Every part of a moment is one of:
 *   lead     what the room needs now: the profile's hero step when short
 *            (≤ HERO_MAX characters), else its primary step. Never dropped.
 *   support  shown, at the secondary or body step (never the meta step);
 *            when listed in `dropOrder` the fitter may give it up, cheapest
 *            first, after the type has reached the profile's floor.
 *   kicker   a small orienting line at the meta step (the title above a task).
 *   count    how many have answered: the meta step, always shown.
 *   dropped  not on this profile at all.
 * `essential` lists the parts no fitter may drop (the lead, counts, and in a
 * Build Room Claude's status, owner 17 Oct: "I do like that Claude's status and
 * activity is kept current on the build room stage (whichever screen shown to
 * the room)").
 *
 * PROFILES. Call (a Zoom/video share, read on people's own screens) is the
 * one VERBOSE profile: it may carry the title as a heading, the category, the
 * lesson, an ask's detail and the room's reasons. Room (a projector across a
 * room), TV and Table carry only what is needed.
 *
 * NEVER A NAME. The output is built from a whitelist of fields; a name, a
 * player list or the question's Workie-only Background handed in by a caller
 * never reaches it.
 *
 * THE DECISIONS (the same table is in docs/design/parity/PLAN.md §2d):
 *
 *  Moment          Room / TV / Table (minimal)              Call (verbose)
 *  --------------  ---------------------------------------  ------------------------------
 *  LOBBY           LEAD join (address, code, QR); session   same
 *                  title kicker; count
 *  ANSWERING       LEAD the lesson (the task when there is  category kicker; title as a
 *                  none); the task as support at the        heading (support); LEAD the
 *                  secondary step, never dropped; title as  lesson; the task (support,
 *                  a kicker (not when it repeats the        never dropped); count
 *                  lead); category dropped; count           (owner, 18 Oct 2026)
 *  QUESTION_FOCUS  as ANSWERING, no count                   as ANSWERING, no count
 *  VOTING          LEAD the cue (vote on your phone); the   title heading; the task; LEAD
 *                  task as support; title dropped; count    the cue; count
 *  VOTE_RESPONSE   LEAD the response; the cue kicker; the   same, the task kept
 *                  task (support, first to give way); count
 *  RESULTS         LEAD the ideas; the task (support,       title kicker; LEAD the ideas;
 *                  first to give way); counts               the task kept; counts
 *  RESPONSES       LEAD the response                        same
 *  READ            LEAD Workie's page, paged                same
 *  FEEDBACK        LEAD the ask or the comment put up; the  same
 *                  round title as the reminder (kicker)
 *  ROOM_QUESTION   LEAD the question and its options; the   same
 *                  kind kicker; count
 *  ROOM_RESULTS    LEAD the tally; the question support     same
 *  ENDED           LEAD thanks; session title kicker        same
 *  top line        the round only (session title in LOBBY   session title and round
 *                  and ENDED)
 *  BUILD_ASK       LEAD the prompt and the option titles    + the ask's detail and each
 *  (live, voting)  (secondary or larger, paged when they    option's detail (support,
 *                  outgrow the screen); Claude's status     first to give way)
 *                  (support, essential); count
 *  BUILD_RESULTS   as BUILD_ASK, with the tally             + the room's reasons
 *  BUILD_WHEEL     LEAD the prompt and the wheel; Claude    + the detail
 *  BUILD_IDLE      LEAD Claude's status (headline, the      same
 *                  doing line and its duration, the helper
 *                  line); the newest picture and the last
 *                  decision as support
 *  BUILD_POINT     LEAD the talking point; its source and   same
 *                  the talk prompt support; Claude essential
 *  BUILD_RUN       LEAD the run list and its current step   same
 *                  (essential); Claude essential
 *  BUILD_HISTORY   LEAD the story, newest that fit, "and N  same
 *                  earlier"; decided so far support; Claude
 *                  essential
 *  BUILD_BUILD     LEAD the newest screenshot; the link     same
 *                  support; Claude essential
 *  BUILD_SHOWING   LEAD what the host put up (the codes,    same
 *                  the crew board, the brief); Claude
 *                  essential
 *
 *  Claude's status (every BUILD_ moment, every profile, one screen and the
 *  room's window, Stage, Build and History): the headline ("Claude is
 *  building / is ready / has paused"), the doing line with its duration, the
 *  helper line, and in a run the current step. Essential: never dropped,
 *  drawn at the body step or larger, and never the lead while an ask is open.
 */
import { PROFILES, DEFAULT_PROFILE } from './displayProfile';

export const ROLE = Object.freeze({
  LEAD: 'lead', SUPPORT: 'support', KICKER: 'kicker', COUNT: 'count', DROPPED: 'dropped',
});

/** A lead this short reads at the hero step; longer, at primary. */
export const HERO_MAX = 60;

export const CA_MOMENTS = Object.freeze([
  'LOBBY', 'ANSWERING', 'QUESTION_FOCUS', 'VOTING', 'VOTE_RESPONSE', 'RESULTS',
  'RESPONSES', 'READ', 'FEEDBACK', 'ROOM_QUESTION', 'ROOM_RESULTS', 'ENDED',
]);
export const BUILD_MOMENTS = Object.freeze([
  'BUILD_ASK', 'BUILD_RESULTS', 'BUILD_WHEEL', 'BUILD_IDLE', 'BUILD_POINT',
  'BUILD_RUN', 'BUILD_HISTORY', 'BUILD_BUILD', 'BUILD_SHOWING',
]);

export const VERBOSE_PROFILES = Object.freeze(['call']);
export const MINIMAL_PROFILES = Object.freeze(PROFILES.filter((p) => !VERBOSE_PROFILES.includes(p)));

export const isVerbose = (profile) => VERBOSE_PROFILES.includes(profile);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Is the task the question's own instruction (rather than the set's or the type's default)? */
export function taskIsOwn(question) {
  const q = question || {};
  return Boolean(str(q.customInstructions || q.CustomInstructions));
}

/**
 * A question's words for roomContentFor, from the question record and the task
 * as the caller resolved it (config/instructions.js resolveInstruction). The
 * stage (GameHostPage) and the wall (presentModel) both build their data here,
 * so the same question gives the same content on both. Whitelisted: the
 * question's Workie-only Background never passes.
 */
export function questionRoomData(question, {
  task = '', sessionTitle = '', roundLabel = '', cue = '',
} = {}) {
  const q = question || {};
  return {
    title: str(q.title || q.question),
    task: str(task),
    taskOwn: taskIsOwn(q),
    story: str(q.detail || q.questionDetail),
    category: str(q.category),
    sessionTitle: str(sessionTitle),
    roundLabel: str(roundLabel),
    cue: str(cue),
  };
}

export const leadSize = (text) => (str(text).length <= HERO_MAX ? 'hero' : 'primary');

/** Claude's one status, whitelisted: the words, never a name. */
function claudeOf(c) {
  const x = c || {};
  return {
    key: str(x.key),
    headline: str(x.headline),
    line: str(x.line),
    dur: str(x.dur),
    helperLine: str(x.helperLine),
  };
}

function optionsOf(list, withDetail) {
  return (Array.isArray(list) ? list : []).map((o) => {
    const out = { label: str(o && o.label), title: str(o && (o.title || o.text)) };
    if (withDetail && str(o && o.detail)) out.detail = str(o.detail);
    return out;
  });
}

function whysOf(list) {
  return (Array.isArray(list) ? list : []).map((w) => ({ label: str(w && w.label), text: str(w && w.text) }));
}

/** A small builder: parts in render order. */
function plan() {
  const parts = {};
  const order = [];
  const dropOrder = [];
  const essential = [];
  const api = {
    part(key, role, size, text, { drop = false, keep = false } = {}) {
      parts[key] = { role, size: role === ROLE.DROPPED ? null : size };
      if (text !== undefined && role !== ROLE.DROPPED) parts[key].text = text;
      order.push(key);
      if (role !== ROLE.DROPPED && drop) dropOrder.push(key);
      if (role !== ROLE.DROPPED && (keep || role === ROLE.LEAD || role === ROLE.COUNT)) essential.push(key);
      return api;
    },
    out(moment, profile, lead) {
      return {
        moment, profile, verbose: isVerbose(profile), lead, parts, order, dropOrder, essential,
      };
    },
  };
  return api;
}

function topLine(p, moment, verbose, d) {
  const always = moment === 'LOBBY' || moment === 'ENDED';
  p.part('sessionTitle', str(d.sessionTitle) && (verbose || always) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.sessionTitle));
  p.part('roundLabel', str(d.roundLabel) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.roundLabel));
}

/**
 * ANSWERING and QUESTION_FOCUS: THE LESSON LEADS (owner, 18 Oct 2026: "for the
 * rounds for the answer phase neither the host nor the room sees the actual
 * lesson instead we tell them what to do"). The lesson is the question the
 * room is answering; the task says how to answer it, at the secondary step
 * under it and never dropped. With no lesson the task leads; with neither, the
 * title. Until 18 Oct the task led and a question with its own instruction
 * dropped the lesson on Room, TV and Table, so the room was told how to answer
 * a question it was never shown.
 */
function questionUp(p, moment, verbose, d) {
  const task = str(d.task);
  const title = str(d.title);
  const story = str(d.story);
  const leadKey = story ? 'story' : task ? 'task' : 'title';
  const leadText = leadKey === 'story' ? story : task;
  const repeats = title && leadText && norm(title) === norm(leadText);
  p.part('category', verbose && str(d.category) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.category));
  if (leadKey === 'title') {
    p.part('title', ROLE.LEAD, leadSize(title), title);
  } else if (!title || repeats) {
    p.part('title', ROLE.DROPPED);
  } else {
    p.part('title', verbose ? ROLE.SUPPORT : ROLE.KICKER, verbose ? 'secondary' : 'meta', title);
  }
  if (story) p.part('story', ROLE.LEAD, leadSize(story), story);
  if (task) {
    const sameAsStory = story && norm(story) === norm(task);
    if (leadKey === 'task') p.part('task', ROLE.LEAD, leadSize(task), task);
    else p.part('task', sameAsStory ? ROLE.DROPPED : ROLE.SUPPORT, 'secondary', task, { keep: true });
  }
  if (moment === 'ANSWERING') p.part('count', ROLE.COUNT, 'meta');
  return leadKey;
}

function ca(p, moment, verbose, d) {
  const task = str(d.task);
  switch (moment) {
    case 'LOBBY':
      p.part('join', ROLE.LEAD, 'hero');
      p.part('count', ROLE.COUNT, 'meta');
      return 'join';
    case 'ANSWERING':
    case 'QUESTION_FOCUS':
      return questionUp(p, moment, verbose, d);
    case 'VOTING':
      p.part('title', verbose && str(d.title) ? ROLE.SUPPORT : ROLE.DROPPED, 'secondary', str(d.title));
      p.part('task', task ? ROLE.SUPPORT : ROLE.DROPPED, 'body', task, { drop: !verbose });
      p.part('cue', ROLE.LEAD, 'primary', str(d.cue));
      p.part('count', ROLE.COUNT, 'meta');
      return 'cue';
    case 'VOTE_RESPONSE':
      p.part('cue', ROLE.KICKER, 'meta', str(d.cue));
      p.part('task', task ? ROLE.SUPPORT : ROLE.DROPPED, 'body', task, { drop: !verbose });
      p.part('response', ROLE.LEAD, 'primary');
      p.part('count', ROLE.COUNT, 'meta');
      return 'response';
    case 'RESULTS':
      p.part('title', verbose && str(d.title) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.title));
      p.part('task', task ? ROLE.SUPPORT : ROLE.DROPPED, 'body', task, { drop: !verbose });
      p.part('ideas', ROLE.LEAD, 'primary');
      p.part('count', ROLE.COUNT, 'meta');
      return 'ideas';
    case 'RESPONSES':
      p.part('response', ROLE.LEAD, 'primary');
      return 'response';
    case 'READ':
      p.part('page', ROLE.LEAD, 'primary');
      return 'page';
    case 'FEEDBACK':
      p.part('title', str(d.title) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.title));
      p.part('ask', ROLE.LEAD, 'primary');
      return 'ask';
    case 'ROOM_QUESTION':
      p.part('kind', ROLE.KICKER, 'meta');
      p.part('question', ROLE.LEAD, 'primary');
      p.part('options', ROLE.LEAD, 'secondary');
      p.part('count', ROLE.COUNT, 'meta');
      return 'question';
    case 'ROOM_RESULTS':
      p.part('question', ROLE.SUPPORT, 'secondary');
      p.part('tally', ROLE.LEAD, 'primary');
      p.part('count', ROLE.COUNT, 'meta');
      return 'tally';
    case 'ENDED':
      p.part('thanks', ROLE.LEAD, 'primary');
      return 'thanks';
    default:
      p.part('quiet', ROLE.LEAD, 'primary');
      return 'quiet';
  }
}

function build(p, moment, verbose, d) {
  const claude = claudeOf(d.claude);
  const claudePart = (role) => p.part('claude', role, role === ROLE.LEAD ? 'primary' : 'body', claude, { keep: true });
  switch (moment) {
    case 'BUILD_ASK':
    case 'BUILD_RESULTS':
    case 'BUILD_WHEEL': {
      const prompt = str(d.prompt);
      p.part('kind', ROLE.KICKER, 'meta');
      p.part('prompt', ROLE.LEAD, 'primary', prompt);
      p.part('detail', verbose && str(d.detail) ? ROLE.SUPPORT : ROLE.DROPPED, 'body', str(d.detail), { drop: true });
      p.part('options', ROLE.LEAD, 'secondary', optionsOf(d.options, verbose));
      const anyDetail = (Array.isArray(d.options) ? d.options : []).some((o) => str(o && o.detail));
      p.part('optionDetail', verbose && anyDetail ? ROLE.SUPPORT : ROLE.DROPPED, 'body', undefined, { drop: true });
      const whys = moment === 'BUILD_RESULTS' && verbose && whysOf(d.whys).length;
      p.part('whys', whys ? ROLE.SUPPORT : ROLE.DROPPED, 'body', whys ? whysOf(d.whys) : undefined, { drop: true });
      claudePart(ROLE.SUPPORT);
      p.part('count', ROLE.COUNT, 'meta');
      return 'prompt';
    }
    case 'BUILD_IDLE':
      claudePart(ROLE.LEAD);
      p.part('picture', ROLE.SUPPORT, 'body');
      p.part('decided', ROLE.SUPPORT, 'body');
      return 'claude';
    case 'BUILD_POINT':
      p.part('point', ROLE.LEAD, 'primary');
      p.part('source', ROLE.SUPPORT, 'body');
      claudePart(ROLE.SUPPORT);
      return 'point';
    case 'BUILD_RUN': {
      p.part('run', ROLE.LEAD, 'primary');
      const step = d.step && typeof d.step === 'object' ? { k: d.step.k, text: str(d.step.text) } : null;
      p.part('step', step ? ROLE.SUPPORT : ROLE.DROPPED, 'body', step || undefined, { keep: true });
      claudePart(ROLE.SUPPORT);
      return 'run';
    }
    case 'BUILD_HISTORY':
      p.part('story', ROLE.LEAD, 'primary');
      p.part('decided', ROLE.SUPPORT, 'body');
      claudePart(ROLE.SUPPORT);
      return 'story';
    case 'BUILD_SHOWING':
      p.part('shown', ROLE.LEAD, 'primary');
      claudePart(ROLE.SUPPORT);
      return 'shown';
    case 'BUILD_BUILD':
    default:
      p.part('picture', ROLE.LEAD, 'primary');
      p.part('link', ROLE.SUPPORT, 'body');
      claudePart(ROLE.SUPPORT);
      return 'picture';
  }
}

/**
 * @param moment   one of CA_MOMENTS or BUILD_MOMENTS (anything else is a quiet lead)
 * @param profile  room | tv | call | table (anything else is Room)
 * @param data     the moment's words: { title, task, taskOwn, story, category,
 *                 sessionTitle, roundLabel, cue } for Call & Answer;
 *                 { prompt, detail, options, whys, claude, step } for a Build Room
 */
export function roomContentFor(moment, profile, data = {}) {
  const prof = PROFILES.includes(profile) ? profile : DEFAULT_PROFILE;
  const verbose = isVerbose(prof);
  const d = data || {};
  const p = plan();
  let lead;
  if (BUILD_MOMENTS.includes(moment)) {
    lead = build(p, moment, verbose, d);
  } else {
    topLine(p, moment, verbose, d);
    lead = ca(p, moment, verbose, d);
  }
  return p.out(moment, prof, lead);
}

export const roleOf = (rc, key) => (rc && rc.parts[key] ? rc.parts[key].role : ROLE.DROPPED);
export const shows = (rc, key) => roleOf(rc, key) !== ROLE.DROPPED;
export const sizeOf = (rc, key) => (rc && rc.parts[key] ? rc.parts[key].size : null);
export const textOf = (rc, key) => (rc && rc.parts[key] ? rc.parts[key].text : undefined);

/** May the fitter give this part up for space? */
export const mayDrop = (rc, key) => Boolean(rc) && rc.dropOrder.includes(key);

/** The fitter's data-drop number for a part: 1 for the first to go, upward. */
export const dropRank = (rc, key) => (mayDrop(rc, key) ? rc.dropOrder.indexOf(key) + 1 : null);

export default roomContentFor;
