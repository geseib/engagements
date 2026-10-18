/**
 * WHAT THE WALL SHOWS, FROM SERVER FACTS ONLY (two-surface PLAN 2.4).
 *
 * `presentModel(snapshot, reads)` turns the public `/state?view=room` body plus
 * the public reads of the moment (`/answers?view=room` during VOTE,
 * get-results at RESULTS, `/ai-summary` on the read) into one plain object the
 * moments draw. The Presentation holds no state of its own beyond the last
 * snapshot, so a reload lands on the same moment.
 *
 * Moments: WAITING, NOT_FOUND, LOBBY, ANSWERING, VOTING, VOTE_RESPONSE,
 * RESULTS, RESPONSES, READ, READ_WAIT, FEEDBACK, QUESTION_FOCUS, ENDED, OTHER.
 * The scoreboard is not a moment: it sits over whichever one is on.
 *
 * Names (R9 and the owner's ruling of 2026-10-12):
 *   - ANSWERING and VOTING carry counts only.
 *   - VOTE_RESPONSE never carries a name, points, rank or vote count, whatever
 *     the input holds: rows are rebuilt from the answer text alone.
 *   - RESULTS and RESPONSES name an author only when the round's authors are
 *     shown (config/anonymity.js authorsHiddenNow), and the points go wherever
 *     the names go. RESULTS leads with the idea (owner, 16 Oct 2026): the
 *     name and points are a small credit under it, and the share bar (backing
 *     relative to the top idea, never a score) shows in every round.
 *
 * Words come from config/roundWords.js. Read pages are sliced exactly as the
 * host page slices them (config/stagePaging.js prosePageSlice, the session's
 * profile budget), so "Page 2 of 4" is the same page on the laptop and the wall.
 */
import RW from '../config/roundWords';
import { momentOf } from '../config/roundStep';
import { tallyOrder } from '../config/navigatorOrder';
import { authorsHiddenNow } from '../config/anonymity';
import { PROFILES, DEFAULT_PROFILE } from '../config/displayProfile';
import { resolveInstruction } from '../config/instructions';
import { roomContentFor, questionRoomData } from '../config/roomContent';

/*
  THE TEAM'S TASK, the line the room is answering (session 7924, finding #4).
  The wall used to show only `detail`, which is the round's background story,
  and the instruction the room was asked to answer never reached it. `task` is
  now the instruction, resolved as the phone resolves it; `story` is the
  background, the line the stage may drop for space.
*/
const taskOf = (q, snapshot) => resolveInstruction(q, q.setCustomInstruction, snapshot.gameType);
const storyOf = (q) => String(q.detail || q.questionDetail || '');
/**
 * THE LINE THAT SAYS WHAT THE RESPONSES ANSWER, while the room votes on or
 * reads them (owner, 18 Oct 2026: the room must see the lesson, not only what
 * to do). The lesson as "The question"; the task only when there is no lesson.
 */
const contextOf = (q, snapshot) => {
  const lesson = storyOf(q).trim();
  return lesson
    ? { task: lesson, taskLabel: RW.theQuestionLabel }
    : { task: taskOf(q, snapshot), taskLabel: RW.theTaskLabel };
};
import { prosePageSlice, proseBudgetFor } from '../config/stagePaging';
import { partText } from './presentFit';
import { wallCreditFor } from '../config/comments';

/** The results tally shows five; up to six fit whole (NOTES §5). */
export const TALLY_TOP = 5;
export const TALLY_WHOLE = 6;

const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

const firstWords = (text, n = 12) => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ') + (words.length > n ? '…' : '');
};

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function roundNounOf(snapshot) {
  const q = snapshot.currentQuestionData || {};
  return String(q.setRoundNoun || '').trim() || 'Round';
}

function roundLabelOf(snapshot, n) {
  const round = n === undefined ? int(snapshot.currentQuestion) : n;
  return round > 0 ? `${capital(roundNounOf(snapshot))} ${round}` : '';
}

function profileOf(snapshot) {
  return PROFILES.includes(snapshot.stageProfile) ? snapshot.stageProfile : DEFAULT_PROFILE;
}

function countsOf(snapshot, which) {
  const rc = snapshot.roomCounts || {};
  const of = Math.max(0, int(rc.joined));
  const done = Math.max(0, int(rc[which]));
  const line = which === 'voted' ? RW.voted(done, of) : RW.answered(done, of);
  return { done, of, line };
}

/** The tally rows, named or not, each with its own text. */
function tallyRows(snapshot, results) {
  const hidden = authorsHiddenNow({
    gameType: snapshot.gameType,
    anonymousUntilReveal: true,
    authorsRevealed: snapshot.authorsRevealed,
  });
  const order = tallyOrder(results && results.voteTallies, []);
  // The share bar is the room's backing relative to the top idea: a proportion,
  // never a score, so it stays in a round whose names (and points) are hidden.
  const top = order.reduce((m, r) => Math.max(m, int(r.points)), 0);
  return order.map((row, i) => {
    const named = !hidden && row.playerName;
    const points = hidden ? null : int(row.points);
    return {
      n: i + 1,
      label: named ? String(row.playerName) : `Response ${i + 1}`,
      text: String(row.answer || ''),
      // RESULTS, IDEAS FIRST (owner, 16 Oct 2026): the idea is the headline, in full.
      idea: String(row.answer || ''),
      first: firstWords(row.answer),
      // A score beside a response is attribution by arithmetic: it goes where the names go.
      points,
      credit: points === null ? null : RW.backedCredit(points, named ? String(row.playerName) : ''),
      share: top > 0 ? int(row.points) / top : 0,
      top: i === 0 && top > 0,
      named: Boolean(named),
    };
  });
}

/** Voting-order rows from the answer text alone: nothing else survives. */
function voteRows(answers) {
  return (Array.isArray(answers) ? answers : []).map((row, i) => ({
    n: i + 1,
    label: `Response ${i + 1}`,
    text: String((row && row.answer) || ''),
    first: firstWords(row && row.answer, 7),
  }));
}

function navigatorOf(rows, focus, { vote }) {
  const total = rows.length;
  const index = Math.min(Math.max(0, total - 1), Math.max(0, int(focus.index)));
  const row = rows[index] || { n: index + 1, label: `Response ${index + 1}`, text: '' };
  const parts = Math.max(1, int(focus.parts, 1));
  const part = Math.min(parts - 1, Math.max(0, int(focus.part)));
  const neighbours = rows.map((r) => ({
    n: r.n,
    word: vote || !r.named ? r.first : r.label,
  }));
  let meta;
  if (vote) meta = 'name hidden';
  else if (row.points === null || row.points === undefined) meta = 'name hidden';
  else meta = `${row.points} vote points`;
  return {
    index,
    total,
    focused: { n: row.n, label: vote ? RW.responseNameHidden(row.n) : row.label, meta: vote ? null : meta },
    text: parts > 1 ? partText(row.text, part, parts) : row.text,
    part,
    parts,
    neighbours,
    position: RW.responseOf(index + 1, total),
  };
}

/**
 * The comment the host has put up, newest first: its words and its credit,
 * exactly as the laptop's FeedbackWall gives them. A note the host typed for
 * the room is credited to the room, never a person.
 */
function featuredOf(comments) {
  const up = (Array.isArray(comments) ? comments : [])
    .filter((c) => c && c.featured)
    .sort((a, b) => String(b.featuredAt || '').localeCompare(String(a.featuredAt || '')))[0];
  if (!up) return null;
  const credit = wallCreditFor(up);
  const who = up.fromHost ? '' : String(up.playerName || '').trim();
  return {
    text: String(up.text || ''),
    who,
    credit: up.fromHost ? 'Said in the room' : (who ? credit : `${credit.charAt(0).toUpperCase()}${credit.slice(1)}`),
  };
}

/** The room's view of a question: the public read's fields, nothing more. */
function askFacts(ask) {
  const tally = ask.tally || null;
  return {
    kind: ['ideas', 'choice', 'rate'].includes(ask.kind) ? ask.kind : 'ideas',
    status: ask.status,
    question: String(ask.question || ''),
    statement: String(ask.statement || ''),
    // The scale's two ends (owner, 16 Oct): the ask's own, or null for the default.
    ends: ask.ends && typeof ask.ends.low === 'string' && typeof ask.ends.high === 'string'
      ? { low: String(ask.ends.low), high: String(ask.ends.high) } : null,
    options: Array.isArray(ask.options) ? ask.options.map(String) : [],
    tally: tally ? {
      n: int(tally.n),
      counts: Array.isArray(tally.counts) ? tally.counts.map((c) => int(c)) : [],
      mean: typeof tally.mean === 'number' ? tally.mean : null,
    } : null,
    picked: Array.isArray(ask.picked) ? ask.picked.map(String) : [],
  };
}

/** The join address, code and room count: the lobby's, and the mid-session join code's. */
function joinFacts(snapshot, reads, code) {
  const origin = reads.origin || (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  return {
    code,
    joinUrl: `${origin}/play?gameId=${encodeURIComponent(code)}`,
    joinHost: `${String(origin).replace(/^https?:\/\//, '')}/play`,
    joined: int(snapshot.roomCounts && snapshot.roomCounts.joined),
    // The host's Event Details, under the title (owner, 18 Oct 2026).
    details: typeof reads.details === 'string' ? reads.details : '',
  };
}

function momentModel(snapshot, reads = {}) {
  if (!snapshot || typeof snapshot !== 'object') return { moment: 'WAITING', profile: DEFAULT_PROFILE };
  if (snapshot.notFound) return { moment: 'NOT_FOUND', profile: DEFAULT_PROFILE };

  const profile = profileOf(snapshot);
  const sessionTitle = String((snapshot.gameMetadata && snapshot.gameMetadata.title) || '');
  const focus = snapshot.stageFocus || {};
  const sb = snapshot.scoreboard && snapshot.scoreboard.open ? { ...snapshot.scoreboard } : null;
  const common = {
    profile,
    sessionTitle,
    roundLabel: roundLabelOf(snapshot),
    scoreboard: sb,
    gameId: String(snapshot.gameId || ''),
  };
  const q = snapshot.currentQuestionData || {};
  const state = String(snapshot.state || '');

  // VOTING SHOWS THE RESPONSES (owner, 2026-10-13: "when going to vote, we
  // should automatically get the response screens up. but it should say Vote
  // on your device"). Response 1 is up from the start; a VOTE-stamped answer
  // focus moves it on. The join code and the question still take the wall when
  // a host puts them up.
  const votingFocus = focus.focus === 'answer' && focus.phase === 'VOTE' ? focus : { index: 0, part: 0, parts: 1 };
  if (/^VOTE#/.test(state) && focus.focus !== 'join' && focus.focus !== 'question') {
    const rows = voteRows(reads.answers);
    if (rows.length) {
      return {
        moment: 'VOTE_RESPONSE',
        ...common,
        title: String(q.title || ''),
        ...contextOf(q, snapshot),
        ...navigatorOf(rows, votingFocus, { vote: true }),
        counts: countsOf(snapshot, 'voted'),
      };
    }
  }
  // THE JOIN CODE, put up mid-session from any host surface (owner, 2026-10-13).
  if (focus.focus === 'join' && /^(ASK|VOTE|RESULTS)#/.test(state)) {
    return { moment: 'JOIN', ...common, ...joinFacts(snapshot, reads, common.gameId) };
  }
  if (focus.focus === 'question' && /^(ASK|VOTE|RESULTS)#/.test(state)) {
    return { moment: 'QUESTION_FOCUS', ...common, category: q.category || '', title: String(q.title || ''), task: taskOf(q, snapshot), story: storyOf(q) };
  }

  const liveAsk = reads.ask || null;
  const moment = momentOf({
    state: snapshot.state, stageBeat: snapshot.stageBeat, focus, roomAsk: liveAsk ? { status: liveAsk.status } : null,
  });

  switch (moment) {
    case 'LOBBY':
      return {
        moment,
        ...common,
        ...joinFacts(snapshot, reads, common.gameId),
        nextLabel: roundLabelOf(snapshot, Math.max(1, int(snapshot.currentQuestion) + 1)),
      };
    case 'ANSWERING':
      return {
        moment,
        ...common,
        category: q.category || '',
        title: String(q.title || ''),
        task: taskOf(q, snapshot),
        story: storyOf(q),
        counts: countsOf(snapshot, 'answered'),
      };
    case 'VOTING': {
      const answered = int(snapshot.roomCounts && snapshot.roomCounts.answered);
      return {
        moment,
        ...common,
        title: String(q.title || ''),
        ...contextOf(q, snapshot),
        lead: RW.answersOnDevices(answered),
        counts: countsOf(snapshot, 'voted'),
      };
    }
    case 'RESULTS': {
      const rows = tallyRows(snapshot, reads.results);
      const show = rows.length > TALLY_WHOLE ? TALLY_TOP : rows.length;
      return {
        moment,
        ...common,
        title: String(q.title || ''),
        heading: RW.whatTheRoomBacked,
        ...contextOf(q, snapshot),
        loading: !reads.results,
        rows: rows.slice(0, show),
        more: rows.length - show,
        total: rows.length,
        voted: int(snapshot.roomCounts && snapshot.roomCounts.voted),
      };
    }
    case 'RESPONSES': {
      const rows = tallyRows(snapshot, reads.results);
      if (!rows.length) return { moment: 'RESULTS', ...common, title: String(q.title || ''), loading: true, rows: [], more: 0, total: 0, voted: 0 };
      return { moment, ...common, title: String(q.title || ''), ...navigatorOf(rows, focus, { vote: false }) };
    }
    case 'READ': {
      const md = reads.summary && (reads.summary.markdownResponse || reads.summary.summaryText || reads.summary.summary);
      if (!md) return { moment: 'READ_WAIT', ...common, line: RW.workieWriting };
      const notes = snapshot.stageNotes || {};
      const slice = prosePageSlice(md, int(notes.page), proseBudgetFor(profile));
      return {
        moment,
        ...common,
        content: slice.content,
        section: slice.section,
        page: slice.page,
        pages: slice.pages,
        isTopics: /discussion/i.test(slice.section || ''),
        position: RW.pageOf(slice.page + 1, slice.pages),
      };
    }
    case 'FEEDBACK':
      return { moment, ...common, title: String(q.title || ''), line: RW.feedbackOpen, featured: featuredOf(reads.comments) };
    case 'ROOM_QUESTION':
    case 'ROOM_RESULTS':
      // A QUESTION FOR THE ROOM (docs/design/followup-icons): the words, then
      // counts, never a name; Ideas only as the host picks them.
      if (!liveAsk) return { moment: 'READ_WAIT', ...common };
      return { moment, ...common, ask: askFacts(liveAsk), counts: countsOf(snapshot, 'answered'), answered: int(liveAsk.answered) };
    case 'ENDED':
      return { moment, ...common };
    case 'OTHER':
      return { moment, ...common };
    default:
      return { moment: 'WAITING', ...common };
  }
}

/*
  WHAT THE ROOM SEES, AND HOW LARGE (owner, 17 Oct 2026; config/roomContent.js).
  Every model carries `room`: the parts of its moment the wall shows and their
  emphasis, from the one function the one-screen stage reads too. The question's
  words go through questionRoomData, as GameHostPage's do.
*/
const ROOM_MOMENT = { JOIN: 'LOBBY', READ_WAIT: 'READ' };

export function presentModel(snapshot, reads = {}) {
  const model = momentModel(snapshot, reads);
  if (!snapshot || typeof snapshot !== 'object' || snapshot.notFound) return model;
  const q = snapshot.currentQuestionData || {};
  const cue = model.moment === 'VOTING' ? model.lead : RW.voteOnDevice;
  const room = roomContentFor(ROOM_MOMENT[model.moment] || model.moment, model.profile, questionRoomData(q, {
    task: taskOf(q, snapshot),
    sessionTitle: model.sessionTitle,
    roundLabel: model.roundLabel,
    cue,
  }));
  return { ...model, room };
}

export default presentModel;
