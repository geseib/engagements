/**
 * WHERE A COLLECTING SURVEY'S ROOM IS — the host stage's one source for it.
 *
 * Two inputs, one state. `GET /games/{id}/survey/progress` on arrival (and on
 * a reload), and the `surveyProgress` broadcast afterwards; both carry the
 * same payload, `{gameId, started, finished, perQuestion:[{qid, answered}],
 * at}` (docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2), so whichever
 * lands last wins — unless it is OLDER than what is on screen, which is the
 * race a reconnect produces: the GET is answered after a newer frame arrived.
 *
 * Names are fetched separately and only ON REVEAL (`loadPeople`), and never in
 * Anonymous, where the server records none (`/survey/people` answers 409).
 * Holding a roster the wall is not showing is holding nothing useful, and the
 * host's privacy promise is easier to keep when the names are not in memory.
 *
 * The pure helpers below are what the page, the dock and the tests share, so
 * "15 partway" is computed once. GameHostPage cannot be mounted in jsdom; these
 * can be called.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { namesMode } from '../config/surveyNames';
import { fetchSurveyPeople, fetchSurveyProgress } from '../utils/surveyHostClient';

const count = (v) => Math.max(0, Math.round(Number(v) || 0));

/**
 * The dock's three numbers: finished · partway · not started.
 *
 * `started` counts answer ROWS (respondents), `joined` counts people in the
 * room; they are different facts and can disagree — a rejoin or a second
 * browser in Anonymous mints a second respondent — so "not started" is floored
 * at zero rather than printed negative.
 *
 * @returns null until the first read, so a caller can say "no counts yet"
 *          instead of "0 finished".
 */
export function surveyRoomCounts({ progress, joined } = {}) {
  if (!progress) return null;
  const room = count(joined);
  const started = count(progress.started);
  const finished = count(progress.finished);
  return {
    joined: room,
    started,
    finished,
    partway: Math.max(0, started - finished),
    notStarted: Math.max(0, room - started),
  };
}

/**
 * One row per question, in the order the server lists them (the set's own
 * order — a survey is never shuffled). `share` is the bar's width in percent
 * of the ROOM, the denominator the row prints ("34 / 42"); `full` is every
 * person in the room, and never true of an empty room.
 */
export function surveyMeterRows({ progress, joined } = {}) {
  const per = progress && Array.isArray(progress.perQuestion) ? progress.perQuestion : [];
  const room = count(joined);
  return per.map((q, i) => {
    const answered = count(q && q.answered);
    return {
      qid: (q && q.qid) || String(i),
      label: `Q${i + 1}`,
      answered,
      of: room,
      share: room > 0 ? Math.min(100, Math.round((answered * 100) / room)) : 0,
      full: room > 0 && answered >= room,
    };
  });
}

/** The people still going — partway or not started. Never the finished. */
export function stillGoingNames(people) {
  return (Array.isArray(people) ? people : [])
    .filter((p) => p && typeof p.name === 'string' && p.name && p.status !== 'finished')
    .map((p) => p.name);
}

/**
 * The RoomMeter `waiting` prop for a collecting survey, or null.
 *
 * NULL IN ANONYMOUS, and null when nobody is still going: RoomMeter renders
 * the plain count unless it is handed a list and handlers, so an Anonymous
 * survey offers no reveal at all rather than a control that opens nothing.
 * (RATIONALE.md §3, "Names stop at the console" — the one exception is this
 * list of people still going, in the two modes that record names, on request.)
 *
 * The reveal is offered BEFORE the names are fetched — the count of people
 * still going is known from /progress, the names are not until the host asks
 * — so `count` carries the number and `loading` says the list is on its way.
 *
 * `error` is a /people that FAILED. `loading` used to be "people is not a list
 * yet", so a failure left "Loading names…" on the wall for good; now a failed
 * read with no list stops loading and carries the line to say instead. The
 * count stays, and the next reveal (or progress frame while it is up) asks
 * again.
 */
export function surveyWaiting({
  names, people = null, stillGoing = 0, loading = false, error = null, mode = null,
  onPreview, onPreviewEnd, onPin,
} = {}) {
  if (namesMode(names).id === 'anonymous') return null;
  if (!(Number(stillGoing) > 0)) return null;
  const listed = Array.isArray(people);
  const failed = Boolean(error) && !listed && !loading;
  return {
    names: stillGoingNames(people),
    count: count(stillGoing),
    loading: failed ? false : (Boolean(loading) || !listed),
    error: failed ? String(error) : null,
    mode,
    onPreview,
    onPreviewEnd,
    onPin,
  };
}

const NUMBER_WORDS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen', 'Twenty',
];

/**
 * The collecting stage's subtitle: how long it is, then the Names promise —
 * s-01's "Eight quick questions on your phone. Anonymous — the host sees
 * totals and words, never names." The promise is `wallLine`, never retyped
 * (config/surveyNames.js). A count the room reads aloud is a word up to
 * twenty; past that, digits read faster.
 */
export function surveyWallSubtitle({ questionCount, names } = {}) {
  const promise = namesMode(names).wallLine;
  const n = count(questionCount);
  if (n === 0) return promise;
  const word = NUMBER_WORDS[n] || String(n);
  const length = n === 1
    ? `${word} quick question on your phone.`
    : `${word} quick questions on your phone.`;
  return `${length} ${promise}`;
}

/**
 * @param gameId   the session on stage
 * @param active   read /progress now (COLLECTING, CLOSED, ENDED of a survey)
 * @param names    the session's Names value — gates `loadPeople`
 * @param fetchFn  the host page's `authFetch`: every route here is Cognito
 * @param apiBase  API_BASE
 */
export default function useSurveyProgress({
  gameId, active = false, names = 'anonymous', fetchFn, apiBase,
} = {}) {
  const [progress, setProgress] = useState(null);
  const [people, setPeople] = useState(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState(null);

  // Read through refs so the returned callbacks are STABLE: the host page's
  // socket handlers are registered once per game (effect deps [gameId,
  // useWebSocket]) and would otherwise call a callback frozen at that render.
  const gameRef = useRef(gameId);
  gameRef.current = gameId;
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const namesRef = useRef(names);
  namesRef.current = names;
  const apiRef = useRef(apiBase);
  apiRef.current = apiBase;

  // A new session starts from nothing: last session's counts on this one's
  // wall would be a lie about a room that has not answered yet.
  useEffect(() => {
    setProgress(null);
    setPeople(null);
    setPeopleLoading(false);
    setPeopleError(null);
  }, [gameId]);

  /** A `surveyProgress` frame, or a /progress body. Ignores other sessions and older news. */
  const applyProgress = useCallback((frame) => {
    if (!frame || typeof frame !== 'object') return;
    if (frame.gameId && String(frame.gameId) !== String(gameRef.current)) return;
    setProgress((prev) => {
      if (prev && prev.at && frame.at && String(frame.at) < String(prev.at)) return prev;
      return {
        ...(prev || {}),
        ...frame,
        perQuestion: Array.isArray(frame.perQuestion) ? frame.perQuestion : (prev?.perQuestion || []),
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    const id = gameRef.current;
    if (!id) return;
    const result = await fetchSurveyProgress({ fetchFn: fetchRef.current, apiBase: apiRef.current, gameId: id });
    if (gameRef.current !== id || !result.ok || !result.progress) return;
    applyProgress({ ...result.progress, gameId: result.progress.gameId || id });
  }, [applyProgress]);

  useEffect(() => {
    if (active && gameId) refresh();
  }, [active, gameId, refresh]);

  /**
   * On reveal, and on each frame while the list is up. Never in Anonymous.
   * A failure is kept as `peopleError` (the list already held, if any, stays),
   * so the wall can say the names did not load instead of loading forever.
   */
  const loadPeople = useCallback(async () => {
    if (namesMode(namesRef.current).id === 'anonymous') return;
    const id = gameRef.current;
    if (!id) return;
    setPeopleLoading(true);
    const result = await fetchSurveyPeople({ fetchFn: fetchRef.current, apiBase: apiRef.current, gameId: id });
    if (gameRef.current !== id) return;
    setPeopleLoading(false);
    if (result.ok) {
      setPeople(result.people);
      setPeopleError(null);
    } else {
      setPeopleError('The names could not be loaded.');
    }
  }, []);

  /**
   * The close landed — from the host's own POST (which carries perQuestion)
   * or from the `surveyClosed` frame (which carries n and finished only).
   * Both carry `closedAt`, and it becomes the ordering stamp: the counts
   * freeze here, and a late progress frame from before the close is older
   * than `closedAt` and is ignored by applyProgress.
   */
  const markClosed = useCallback(({ n, finished, perQuestion, closedAt } = {}) => {
    setProgress((prev) => ({
      ...(prev || {}),
      gameId: gameRef.current,
      started: n != null ? n : prev?.started,
      finished: finished != null ? finished : prev?.finished,
      perQuestion: Array.isArray(perQuestion) && perQuestion.length ? perQuestion : (prev?.perQuestion || []),
      at: closedAt || prev?.at || null,
    }));
  }, []);

  return {
    progress, people, peopleLoading, peopleError, refresh, loadPeople, applyProgress, markClosed,
  };
}
