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
 *     the names go.
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
import { prosePageSlice, proseBudgetFor } from '../config/stagePaging';
import { partText } from './presentFit';

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
  return order.map((row, i) => {
    const named = !hidden && row.playerName;
    return {
      n: i + 1,
      label: named ? String(row.playerName) : `Response ${i + 1}`,
      text: String(row.answer || ''),
      first: firstWords(row.answer),
      // A score beside a response is attribution by arithmetic: it goes where the names go.
      points: hidden ? null : int(row.points),
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

/** The join address, code and room count: the lobby's, and the mid-session join code's. */
function joinFacts(snapshot, reads, code) {
  const origin = reads.origin || (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  return {
    code,
    joinUrl: `${origin}/play?gameId=${encodeURIComponent(code)}`,
    joinHost: `${String(origin).replace(/^https?:\/\//, '')}/play`,
    joined: int(snapshot.roomCounts && snapshot.roomCounts.joined),
  };
}

export function presentModel(snapshot, reads = {}) {
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

  // A VOTE-stamped answer focus is the voting navigator (D5); any other phase's
  // stamp on it is the server's to drop and ours to ignore.
  if (/^VOTE#/.test(state) && focus.focus === 'answer' && (focus.phase === 'VOTE')) {
    const rows = voteRows(reads.answers);
    if (rows.length) {
      return { moment: 'VOTE_RESPONSE', ...common, title: String(q.title || ''), ...navigatorOf(rows, focus, { vote: true }) };
    }
  }
  // THE JOIN CODE, put up mid-session from any host surface (owner, 2026-10-13).
  if (focus.focus === 'join' && /^(ASK|VOTE|RESULTS)#/.test(state)) {
    return { moment: 'JOIN', ...common, ...joinFacts(snapshot, reads, common.gameId) };
  }
  if (focus.focus === 'question' && /^(ASK|VOTE|RESULTS)#/.test(state)) {
    return { moment: 'QUESTION_FOCUS', ...common, category: q.category || '', title: String(q.title || ''), task: String(q.detail || q.questionDetail || '') };
  }

  const moment = momentOf({ state: snapshot.state, stageBeat: snapshot.stageBeat, focus });

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
        task: String(q.detail || q.questionDetail || ''),
        counts: countsOf(snapshot, 'answered'),
      };
    case 'VOTING': {
      const answered = int(snapshot.roomCounts && snapshot.roomCounts.answered);
      return {
        moment,
        ...common,
        title: String(q.title || ''),
        lead: RW.answersOnDevices(answered),
        counts: countsOf(snapshot, 'voted'),
      };
    }
    case 'RESULTS': {
      const rows = tallyRows(snapshot, reads.results);
      const show = rows.length > TALLY_WHOLE ? TALLY_TOP : rows.length;
      const max = rows.reduce((m, r) => Math.max(m, r.points || 0), 0) || 1;
      return {
        moment,
        ...common,
        title: String(q.title || ''),
        loading: !reads.results,
        rows: rows.slice(0, show).map((r) => ({ ...r, share: r.points === null ? null : (r.points || 0) / max })),
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
      return { moment, ...common, title: String(q.title || ''), line: RW.feedbackOpen };
    case 'ENDED':
      return { moment, ...common };
    case 'OTHER':
      return { moment, ...common };
    default:
      return { moment: 'WAITING', ...common };
  }
}

export default presentModel;
