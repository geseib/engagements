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
 *  ANSWERING       LEAD the title (hero when short); the     same, + the generic
 *                  lesson under it (support, secondary,     instruction as a line that
 *                  never dropped); "Your turn": the         may give way
 *                  question's own instruction, or the
 *                  question pulled from the front of the
 *                  lesson (support, never dropped); a
 *                  generic instruction left off; category
 *                  eyebrow; count (owner, 18 Oct 2026,
 *                  docs/design/room-content-v2)
 *  QUESTION_FOCUS  as ANSWERING, no count                   as ANSWERING, no count
 *  VOTING          LEAD every answer, whole and numbered    same
 *                  (all at once when overviewFits, else
 *                  one at a time); the title as the
 *                  reminder; no tally; count
 *  VOTE_RESPONSE   LEAD the one answer the host put up;     same
 *                  the title in the top line; count
 *  RESULTS         LEAD the pick in full, runners-up with   same
 *                  their text, the bar the fill behind
 *                  each, relative to the pick; no counts
 *                  where names are hidden; the title as
 *                  the reminder; the talk line (support,
 *                  first to give way); counts
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
 *  BUILD_ASK       LEAD the prompt and the option titles;   + the ask's detail
 *  (live, voting)  each option's detail (support, first to
 *                  give way); paged when they outgrow the
 *                  screen; no tally while open; Claude's
 *                  status (support, essential); count
 *  BUILD_RESULTS   as BUILD_ASK, the tally rising inside    same
 *                  the options, the room's best reason on
 *                  the pick (owner, 18 Oct 2026)
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
 *  BUILD_SENT      LEAD what Claude was told (or only that  same
 *                  the host sent something); the room's
 *                  pick it came from support; Claude
 *                  essential under it (owner, 23 Oct 2026)
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
  'BUILD_RUN', 'BUILD_HISTORY', 'BUILD_BUILD', 'BUILD_SHOWING', 'BUILD_SENT',
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
 * THE QUESTION INSIDE A LESSON (owner, 18 Oct 2026). Many lesson sets open
 * Detail_lesson with the question itself ("Describe how you apply thresholds
 * in your work…") and follow it with the lesson. When a question has no
 * instruction of its own, that first sentence goes in the "Your turn" band and
 * the rest stays the lesson. Only a sentence that is plainly a question counts
 * (it ends in "?" or opens with an asking verb), and never when it would leave
 * no lesson behind; otherwise the lesson shows whole and there is no band.
 */
const ASKING = /^(describe|share|how|what|why|when|where|which|who|tell|explain|name|give|think|reflect|consider|identify|recall|imagine|pick|choose|list)\b/i;

export function splitLessonQuestion(story) {
  const text = str(story);
  const m = /^(.{12,260}?[.?!])\s+(\S[\s\S]*)$/.exec(text);
  if (!m) return { question: '', lesson: text };
  const first = m[1].trim();
  const rest = m[2].trim();
  const asks = /\?$/.test(first) || ASKING.test(first);
  if (!asks || rest.length < 40) return { question: '', lesson: text };
  return { question: first, lesson: rest };
}

/** An ALL-CAPS title reads slowly at hero size: shown in title case on room screens. */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
export function roomTitle(title) {
  const t = str(title);
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return t;
  return t.toLowerCase().split(/(\s+)/).map((w, i) => (
    (i > 0 && SMALL.has(w)) || !/[a-z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  )).join('');
}

/**
 * A question's words for roomContentFor, from the question record and the task
 * as the caller resolved it (config/instructions.js resolveInstruction). The
 * stage (GameHostPage) and the wall (presentModel) both build their data here,
 * so the same question gives the same content on both. Whitelisted: the
 * question's Workie-only Background never passes.
 *
 * `task` is what goes in "Your turn" when `taskOwn` is true: the question's own
 * instruction, else the question pulled from the front of the lesson. A
 * set's or a type's default instruction stays `task` with `taskOwn` false, and
 * the minimal profiles leave it off (the top line already says where to answer).
 */
export function questionRoomData(question, {
  task = '', sessionTitle = '', roundLabel = '', cue = '',
} = {}) {
  const q = question || {};
  const own = taskIsOwn(q);
  let story = str(q.detail || q.questionDetail);
  let turn = own ? str(task) : '';
  if (!own && story) {
    const split = splitLessonQuestion(story);
    if (split.question) { turn = split.question; story = split.lesson; }
  }
  return {
    title: roomTitle(q.title || q.question),
    task: turn || str(task),
    taskOwn: Boolean(turn),
    story,
    category: str(q.category),
    sessionTitle: str(sessionTitle),
    roundLabel: str(roundLabel),
    cue: str(cue),
  };
}

/**
 * VOTING OPENS ON ALL THE ANSWERS WHEN THEY FIT (owner, 18 Oct 2026, replacing
 * 13 Oct's "Response 1 is on the wall from the start of voting"), else on
 * answer 1. One deterministic test, shared by the wall (which draws the
 * overview) and its keys (presentKeys: forward from the overview is answer 1),
 * so the two never disagree about what the room is looking at.
 */
export const OVERVIEW_FIT = Object.freeze({
  room: { max: 6, each: 200, total: 900 },
  tv: { max: 4, each: 170, total: 600 },
  call: { max: 6, each: 240, total: 1100 },
  table: { max: 6, each: 220, total: 1000 },
});
export function overviewFits(answers, profile) {
  const fit = OVERVIEW_FIT[profile] || OVERVIEW_FIT[DEFAULT_PROFILE] || OVERVIEW_FIT.room;
  const list = (Array.isArray(answers) ? answers : []).map((a) => str(typeof a === 'string' ? a : a && (a.text || a.answer || a.response)));
  if (list.length === 0 || list.length > fit.max) return false;
  if (list.some((t) => t.length > fit.each)) return false;
  return list.reduce((n, t) => n + t.length, 0) <= fit.total;
}

/**
 * THE HOST'S WAY INTO THE DISCUSSION ON RESULTS (owner, 18 Oct 2026). Never
 * asks who wrote anything: in a round where names are hidden, that is asking
 * someone to give themselves away. Workie's own discussion topic takes its
 * place when there is one.
 */
export const TALK_LINE = 'What do the top two have in common, and what would it take for the second to win?';

/** A lead that is a list (every answer, the ranked ideas) is drawn at secondary: many items, each read whole. */
export const LIST_LEADS = Object.freeze(['answers', 'ideas']);

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
 * ANSWERING and QUESTION_FOCUS: THE TITLE AND THE LESSON LEAD (owner, 18 Oct
 * 2026: "the instructions is the optional one. the title often is nice to have
 * big too"; docs/design/room-content-v2). They are what changes from round to
 * round and what the room reads, so the title is the lead (hero when short)
 * and the lesson sits under it at the secondary step, never dropped. The
 * question to answer is one "Your turn" band (`task` with `taskOwn`), never
 * dropped. A generic instruction is left off Room, TV and Table, where the top
 * line already says where to answer; Call keeps it as a line that may give way.
 * With no title the lesson leads; with neither, the task.
 *
 * History: 17 Oct the task led and the lesson was dropped; 18 Oct morning the
 * lesson led with the task under it (39bd137c). Both drew the generic words
 * largest somewhere.
 */
function questionUp(p, moment, verbose, d) {
  const task = str(d.task);
  const title = str(d.title);
  const story = str(d.story);
  const own = Boolean(d.taskOwn) && task;
  const leadKey = title ? 'title' : story ? 'story' : 'task';
  p.part('category', str(d.category) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.category));
  if (title) p.part('title', ROLE.LEAD, leadSize(title), title);
  else p.part('title', ROLE.DROPPED);
  if (story) {
    if (leadKey === 'story') p.part('story', ROLE.LEAD, leadSize(story), story);
    else p.part('story', ROLE.SUPPORT, 'secondary', story, { keep: true });
  } else {
    p.part('story', ROLE.DROPPED);
  }
  if (task) {
    const repeats = norm(task) === norm(story) || norm(task) === norm(title);
    if (leadKey === 'task') p.part('task', ROLE.LEAD, leadSize(task), task);
    else if (repeats) p.part('task', ROLE.DROPPED);
    else if (own) p.part('task', ROLE.SUPPORT, 'secondary', task, { keep: true });
    else p.part('task', verbose ? ROLE.SUPPORT : ROLE.DROPPED, 'body', task, { drop: true });
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
      // The answers being weighed lead, whole (owner, 18 Oct 2026: "nice to
      // see a bar chart results but not at the expense of seeing what was
      // voted on"); the title stays as the reminder. No tally while voting.
      p.part('title', str(d.title) ? ROLE.SUPPORT : ROLE.DROPPED, 'primary', str(d.title), { keep: true });
      p.part('task', ROLE.DROPPED);
      p.part('answers', ROLE.LEAD, 'secondary');
      p.part('cue', str(d.cue) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.cue));
      p.part('count', ROLE.COUNT, 'meta');
      return 'answers';
    case 'VOTE_RESPONSE':
      p.part('title', str(d.title) ? ROLE.KICKER : ROLE.DROPPED, 'meta', str(d.title));
      p.part('cue', ROLE.DROPPED);
      p.part('task', ROLE.DROPPED);
      p.part('response', ROLE.LEAD, 'primary');
      p.part('count', ROLE.COUNT, 'meta');
      return 'response';
    case 'RESULTS':
      // The pick in full, the runners-up with their text, the bar the fill
      // behind each, relative to the pick. No counts or percentages where
      // names are hidden (16 Oct: a number beside an answer is attribution by
      // arithmetic). The talk line may give way first.
      p.part('title', str(d.title) ? ROLE.SUPPORT : ROLE.DROPPED, 'primary', str(d.title), { keep: true });
      p.part('task', ROLE.DROPPED);
      p.part('ideas', ROLE.LEAD, 'secondary');
      p.part('talk', ROLE.SUPPORT, 'body', str(d.talk) || TALK_LINE, { drop: true });
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
      // What the room weighs shows on every profile (owner, 18 Oct 2026,
      // replacing 17 Oct's Call-only detail and reasons): each option's title
      // and its detail, and on the result the room's best reason. No tally
      // while the ask is open; it rises inside the options once it closes.
      p.part('detail', verbose && str(d.detail) ? ROLE.SUPPORT : ROLE.DROPPED, 'body', str(d.detail), { drop: true });
      p.part('options', ROLE.LEAD, 'secondary', optionsOf(d.options, true));
      const anyDetail = (Array.isArray(d.options) ? d.options : []).some((o) => str(o && o.detail));
      p.part('optionDetail', anyDetail ? ROLE.SUPPORT : ROLE.DROPPED, 'body', undefined, { drop: true });
      p.part('tally', moment === 'BUILD_RESULTS' ? ROLE.SUPPORT : ROLE.DROPPED, 'secondary');
      const whys = moment === 'BUILD_RESULTS' && whysOf(d.whys).length;
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
    case 'BUILD_SENT': {
      const sent = d.sent && typeof d.sent === 'object' ? d.sent : {};
      p.part('sent', ROLE.LEAD, 'primary', str(sent.text));
      p.part('pick', str(sent.pick) ? ROLE.SUPPORT : ROLE.DROPPED, 'body', str(sent.pick), { keep: true });
      claudePart(ROLE.SUPPORT);
      return 'sent';
    }
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
