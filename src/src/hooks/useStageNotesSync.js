/**
 * WORKIE'S PAGE, KEPT IN STEP WITH THE SERVER — the host page's half
 * (docs/design/two-surface/PLAN.md 1.14; remote-parity/NOTES.md §2).
 *
 * The page of the read is a server fact on ROUND# (stage-beat.js,
 * stage-notes.js). The host page keeps its own index for drawing (the
 * beat-keyed `stagePage`), and this hook ties the two together:
 *
 *   - when the page or its count changes here (a key, the dock, Auto, the
 *     pips), it posts the ABSOLUTE page and this page's own count — the count
 *     is what lets the Remote step relative to the stored page;
 *   - `applyFrame` takes a `stageBeatChanged` frame carrying a newer `rev`
 *     and turns the page to it, recording it as already in step so it is
 *     never published back (the publishFocus no-loop rule);
 *   - `hydrate` does the same for get-game-state's `stageNotes` on a reload.
 *
 * Nothing is published off the read, or before the read has arrived (the
 * count would be a guess). `post(body)` is the caller's: it resolves to the
 * server's reply (with `rev`) or null, and never throws.
 *
 * @param {object} p
 * @param {string} p.gameId
 * @param {number|null} p.round   the round on screen (a number)
 * @param {boolean} p.onRead      the room is on What we heard
 * @param {boolean} p.ready       Workie's read has arrived, so `pages` is real
 * @param {number} p.page         this page's index, 0-based
 * @param {number} p.pages        this page's count
 * @param {(index:number, round:number)=>void} p.turnTo
 * @param {(body:object)=>Promise<object|null>} p.post
 */
import { useCallback, useEffect, useRef } from 'react';

const roundNumber = (value) => {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export default function useStageNotesSync({
  gameId, round, onRead, ready, page, pages, turnTo, post,
}) {
  /** What the server and this page last agreed: { round, page, pages }. */
  const syncedRef = useRef(null);
  /** The newest rev this page has seen, from a frame, a reply or a reload. */
  const revRef = useRef(null);
  const turnToRef = useRef(turnTo);
  const postRef = useRef(post);
  turnToRef.current = turnTo;
  postRef.current = post;
  const roundRef = useRef(round);
  roundRef.current = round;

  // A new round is a new document: nothing about the last one's page applies.
  // A reload that hydrated this very round before the page knew its round
  // number keeps what it read.
  useEffect(() => {
    if (syncedRef.current && roundNumber(syncedRef.current.round) === roundNumber(round)) return;
    syncedRef.current = null;
    revRef.current = null;
  }, [round, gameId]);

  useEffect(() => {
    if (!gameId || !onRead || !ready || roundNumber(round) === null) return;
    if (!Number.isInteger(page) || !Number.isInteger(pages) || pages < 1) return;
    const last = syncedRef.current;
    if (last && roundNumber(last.round) === roundNumber(round) && last.page === page && last.pages === pages) return;
    syncedRef.current = { round, page, pages };
    Promise.resolve(postRef.current({ notesPage: page, notesPages: pages, questionNumber: roundNumber(round) }))
      .then((reply) => {
        if (reply && Number.isInteger(reply.rev) && (revRef.current === null || reply.rev > revRef.current)) {
          revRef.current = reply.rev;
        }
      })
      .catch(() => {});
  }, [gameId, onRead, ready, round, page, pages]);

  /** Take the server's page as already in step, and draw it. */
  const adopt = useCallback((notesPage, notesPages, rev, forRound) => {
    const r = forRound === undefined ? roundRef.current : forRound;
    const prior = syncedRef.current;
    syncedRef.current = {
      round: r,
      page: notesPage,
      pages: Number.isInteger(notesPages) ? notesPages : (prior && prior.pages),
    };
    if (Number.isInteger(rev)) revRef.current = rev;
    // The round travels with the page: on a reload the page's own round state
    // may not have caught up yet, and the page index is keyed by round.
    turnToRef.current(notesPage, roundNumber(r));
  }, []);

  /** A `stageBeatChanged` frame. Returns true when it turned the page. */
  const applyFrame = useCallback((frame) => {
    if (!frame || frame.beat !== 'field-notes' || !Number.isInteger(frame.notesPage)) return false;
    if (roundNumber(frame.questionNumber) !== roundNumber(roundRef.current)) return false;
    if (Number.isInteger(frame.rev) && revRef.current !== null && frame.rev <= revRef.current) return false;
    adopt(frame.notesPage, frame.notesPages, frame.rev);
    return true;
  }, [adopt]);

  /** get-game-state's `stageNotes`, on a reload. `forRound` when the round state is not set yet. */
  const hydrate = useCallback((stageNotes, forRound) => {
    if (!stageNotes || !Number.isInteger(stageNotes.page) || !Number.isInteger(stageNotes.pages)) return false;
    adopt(stageNotes.page, stageNotes.pages, stageNotes.rev, forRound);
    return true;
  }, [adopt]);

  return { applyFrame, hydrate };
}
