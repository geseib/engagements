/**
 * HOW MANY ANSWERS THE ONE-SCREEN STAGE PUTS ON A PAGE, under the room
 * content rule of 18 Oct 2026 (docs/design/room-content-v2 frames 4 and 5;
 * config/roomContent.js).
 *
 *   VOTING   every answer whole, numbered, at the secondary step. When the
 *            round's answers pass `overviewFits` for the profile — the same
 *            test the room's window uses — they all go on one page; else a
 *            page holds ROOM_VOTE_PAGE of them (two columns of two on Room)
 *            and the Pager walks the rest. The fitter still has the last word
 *            on size; this only decides how many it is asked to fit.
 *   RESULTS  the room's pick in full plus the runners-up with their text:
 *            ROOM_RESULTS_PAGE rows (frame 5 draws the pick and three), the
 *            rest "and N more answers" and reachable through the Pager.
 *   else     config/stagePaging.js, unchanged.
 *
 * Pure, no React: GameHostPage's render and its auto-mode step both read it,
 * so the two can never cut the list differently.
 */
import { pageSizeFor } from '../../config/stagePaging';
import { overviewFits } from '../../config/roomContent';
import { answerText } from '../../config/stageAnswers';

export const ROOM_VOTE_PAGE = Object.freeze({ room: 4, tv: 2, call: 4, table: 4 });
export const ROOM_RESULTS_PAGE = Object.freeze({ room: 4, tv: 3, call: 4, table: 5 });

const per = (table, profile) => table[String(profile || '').toLowerCase()] || table.room;

/** The texts of a round's answers, as overviewFits reads them. */
export const answerTexts = (answers) => (Array.isArray(answers) ? answers : [])
  .map((a) => answerText(a && typeof a === 'object' ? a.answer : a));

export function stagePageSizeFor(phase, profile, answers = []) {
  if (phase === 'VOTE') {
    const texts = answerTexts(answers);
    return overviewFits(texts, profile) ? Math.max(1, texts.length) : per(ROOM_VOTE_PAGE, profile);
  }
  if (phase === 'RESULTS') return per(ROOM_RESULTS_PAGE, profile);
  return pageSizeFor(profile);
}

export default stagePageSizeFor;
