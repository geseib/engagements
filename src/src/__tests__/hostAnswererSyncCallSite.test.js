/**
 * THE NAMES MUST CATCH UP WITH THE COUNT ON A HIDDEN ROUND.
 *
 * The defect, stated once: `/state` carries `answerProgress.answererIds` — the
 * authoritative participation list, and deliberately public (get-answers.js:216
 * — "who has not acted yet is a different fact from who wrote what"). The host
 * read it ONLY inside `restoreGameState`, which runs on mount, reconnect or
 * refocus. Nothing called it when an answer landed. On an attributed round that
 * did not matter, because the `playerAnswered` frame carries the name. On a
 * HIDDEN round message.js strips the name, so the unconditional /answers
 * refetch moved the COUNT (redacted rows are still rows) and nothing moved the
 * NAMES — after which `waitingRoster`'s freshness guard correctly refused to
 * print a list it knew was stale, and the reveal went dark for the round.
 *
 * The fix is one refresh on that branch. These tests hold the four things that
 * make it a fix rather than a new problem: it happens on hidden rounds ONLY,
 * it coalesces rather than firing per frame, it does not drag the whole
 * restore along with it, and its timer does not outlive the page.
 *
 * SOURCE ASSERTIONS, for the standing reason: GameHostPage cannot be mounted in
 * jsdom (it dies on the auth provider — six precedents), and this is wiring
 * inside a socket handler rather than a rule that can be extracted whole. The
 * pure half IS extracted and tested: `answererIdsFrom` in
 * hostAnswerProgress.test.js. COMMENTS ARE STRIPPED FIRST — block and
 * line — because a source assertion that matches its own explanatory comment is
 * this repo's best-documented way of proving nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** The body of the `playerAnswered` handler, comments already gone. */
const answeredHandler = (() => {
  const at = code.indexOf("webSocketClient.onMessage('playerAnswered'");
  const end = code.indexOf("webSocketClient.onMessage('playerVoted'", at);
  return code.slice(at, end);
})();

describe('the comment-stripping this file depends on', () => {
  test('it actually removes both comment forms', () => {
    // Not ceremony. Every assertion below is a claim about CODE, and the
    // stripper is the only thing making them that. `markup.replace(block)`
    // alone leaves `// ...` lines behind, and this file's subject matter is
    // heavily commented — the phrase "scheduleAnswererSync" appears in three
    // comments before it appears in a statement.
    //
    // rejects: a stripper that misses line comments, which would let every
    // test here pass against a page that only TALKS about the refresh.
    expect(source).toMatch(/^\s*\/\/ /m);
    expect(code).not.toMatch(/^[ \t]*\/\//m);
    expect(code).not.toMatch(/\/\*/);
    // ...and it must not have eaten the code with it.
    expect(code).toMatch(/const scheduleAnswererSync = \(\) => \{/);
  });
});

describe('the hidden branch asks the server who has answered', () => {
  test('the redacted frame schedules a participation refresh', () => {
    // rejects: the shipped state before this change — an `else` that logged
    // and stopped, leaving the names frozen until the host touched the tab.
    expect(answeredHandler).toMatch(/\} else \{[\s\S]*?scheduleAnswererSync\(\);[\s\S]*?\}/);
  });

  test('the ATTRIBUTED branch fires no request — it already has the name', () => {
    // rejects: hoisting the refresh out of the else and calling it on every
    // frame. The named path appends locally and is instant; a /state call
    // there would be one request per answer for no information at all — and
    // it is the shortest "simplification" available to anyone who reads two
    // branches and sees one call in them.
    //
    // Asserted as a POSITION, not an absence from a slice: hoisting the call
    // ABOVE the `if` leaves both branch bodies clean, so a slice-based check
    // goes green against exactly the mutation it was written for.
    const calls = answeredHandler.match(/scheduleAnswererSync\(\)/g) || [];
    expect(calls).toHaveLength(1);
    expect(answeredHandler.indexOf('scheduleAnswererSync()'))
      .toBeGreaterThan(answeredHandler.indexOf('} else {'));

    const branch = answeredHandler.slice(
      answeredHandler.indexOf('if (markAnswered) {'),
      answeredHandler.indexOf('} else {')
    );
    expect(branch).toMatch(/setPlayersWhoAnswered/);
    expect(branch).not.toMatch(/fetch\(/);
  });

  test('it does not re-sync the whole game to fetch a list of names', () => {
    // rejects: `restoreGameState()` on this branch, which is the obvious
    // one-word fix and is wrong twice over: it rewrites `currentQuestionId`,
    // a dependency of the effect that resets `resultsBeat` (RESUME.md records
    // that effect as fragile on purpose and already responsible for one live
    // defect), and it costs four requests where one answers the question.
    expect(answeredHandler).not.toMatch(/restoreGameState/);
  });
});

describe('the refresh reads the one field it needs, from the payload that has it', () => {
  const refresh = (() => {
    const at = code.indexOf('const refreshAnswerersFromState');
    return code.slice(at, code.indexOf('const ANSWERER_SYNC_MS', at));
  })();

  test('it requests host data, or answerProgress is not in the reply at all', () => {
    // rejects: `${API_BASE}games/${id}/state` with no flag. get-game-state.js
    // assembles answerProgress only under includeHostData=true, so the plain
    // route returns 200 with nothing to read and this fails silently — the
    // exact failure mode being fixed, reintroduced by a shorter URL.
    expect(refresh).toMatch(/state\?includeHostData=true/);
  });

  test('it goes through answererIdsFrom rather than reading the array raw', () => {
    // rejects: `data.answerProgress?.answererIds || []` inline, which cannot
    // distinguish "the round moved to VOTE" from "nobody has answered" and so
    // blanks the list on the first refresh that races a phase change. The
    // distinction is tested in hostAnswerProgress.test.js and is only worth
    // anything if the page uses it.
    expect(refresh).toMatch(/answererIdsFrom\(stateData\)/);
    expect(refresh).toMatch(/if \(!ids\) return;/);
    expect(refresh).toMatch(/setPlayersWhoAnswered\(ids\)/);
    expect(refresh).not.toMatch(/\.answererIds/);
  });

  test('a reply for a game the host has left is discarded', () => {
    // rejects: dropping the guard. Every await is a chance for the host to
    // have switched games; a late reply would write the old session's
    // answerers over the new one's roster. restoreGameState guards for the
    // same reason and against the same ref.
    expect(refresh).toMatch(/activeGameIdRef\.current !== forGameId/);
  });
});

describe('a burst of answers costs one request', () => {
  const scheduler = (() => {
    const at = code.indexOf('const scheduleAnswererSync');
    return code.slice(at, code.indexOf('\n  };', at));
  })();

  test('COALESCED: a pending refresh absorbs every frame that arrives before it fires', () => {
    // Ten people answering at once must not fire ten /state calls. The early
    // return when a timer is already pending IS the coalescing: the first
    // frame schedules, the rest are absorbed by the refresh already booked.
    //
    // rejects: a bare `setTimeout` per frame (ten frames, ten calls).
    expect(scheduler).toMatch(/if \(answererSyncRef\.current\) return;/);
    expect(scheduler).toMatch(/answererSyncRef\.current = setTimeout\(/);
    // The slot is released when it fires, or one refresh is all there is.
    expect(scheduler).toMatch(/answererSyncRef\.current = null;/);
  });

  test('NOT a resetting debounce, which would starve exactly this room', () => {
    // The other way to write this is clearTimeout-then-setTimeout on every
    // frame. It looks equivalent and is not: a room answering steadily every
    // 300ms pushes the refresh back forever and the names never arrive —
    // which is the defect being fixed, wearing a timer.
    //
    // rejects: that implementation. The scheduler must not cancel a pending
    // refresh; only the unmount cleanup may.
    expect(scheduler).not.toMatch(/clearTimeout/);
  });

  test('the window is a named constant, not a number buried in a call', () => {
    // rejects: `setTimeout(fn, 400)`. The worst-case request rate for a
    // 40-person room is a property of this one number; it should be movable
    // by the person who watches a rehearsal, in one place, with the reasoning
    // beside it.
    expect(code).toMatch(/const ANSWERER_SYNC_MS = \d+;/);
    expect(scheduler).toMatch(/\}, ANSWERER_SYNC_MS\);/);
  });

  test('the timer does not outlive the page', () => {
    // rejects: no cleanup. A pending timer fires into an unmounted component
    // after the host leaves the stage — a fetch and a setState nobody sees,
    // announced only as a console warning.
    const at = code.indexOf('const answererSyncRef');
    expect(at).toBeGreaterThan(-1);
    const declaration = code.slice(at, at + 400);
    expect(declaration).toMatch(/useEffect\(\(\) => \(\) => \{[\s\S]*?clearTimeout\(answererSyncRef\.current\)/);
    expect(declaration).toMatch(/\}, \[\]\);/);
  });
});
