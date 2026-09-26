/**
 * The wiring between the two ends that CAN be tested.
 *
 * `GameSetupDialog` is tested by rendering it and `createGameBody` by calling
 * it. Between them sits `handleStartNewGame`, in a 5,000-line file that cannot
 * be mounted in jsdom at all. That gap is exactly where a fix ships as dead
 * code — an entire OAuth return-path change did, with twelve green tests on the
 * module and nothing on its only call site.
 *
 * So these are source assertions, deliberately, and they run against
 * COMMENT-STRIPPED source: a previous agent's test passed on a comment.
 */
import fs from 'fs';
import path from 'path';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment and string literal's comment-lookalikes removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')       // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
const quickstart = stripComments(fs.readFileSync(src('components', 'QuickstartMenu.jsx'), 'utf8'));

describe('GameHostPage actually uses the extracted dialog', () => {
  // rejects: the whole extraction shipping as dead code — a new component file
  // that nothing renders, with the old inline form still on screen.
  test('renders <GameSetupDialog>, and imports it', () => {
    expect(host).toMatch(/import\s+GameSetupDialog\s+from\s+'\.\/components\/GameSetupDialog'/);
    expect(host).toMatch(/<GameSetupDialog/);
  });

  // rejects: leaving the 230-line inline form behind alongside the component.
  // Each string below is the dialog's alone — the live-game voice picker also
  // says "Adapt to the session", so that one is matched with its suffix.
  test('no longer carries the dialog\'s own form markup', () => {
    expect(host).not.toMatch(/Randomize Question Order/);
    expect(host).not.toMatch(/Adapt to the session \(recommended\)/);
    expect(host).not.toMatch(/nobody sees who wrote which answer/);
    expect(host).not.toMatch(/Select a question set/);
  });
});

describe('the create call is built from the payload the dialog raised', () => {
  // rejects: rebuilding the body inline in handleStartNewGame — which is
  // precisely how a field like triviaTimer gets added and never noticed.
  test('handleStartNewGame takes the form and passes it to createGameBody', () => {
    expect(host).toMatch(/const handleStartNewGame = async \((\w+)\)/);
    expect(host).toMatch(/import \{ createGameBody[^}]*\} from '\.\/config\/createGame'/);
    expect(host).toMatch(/JSON\.stringify\(createGameBody\(/);
  });

  // rejects: the stale-closure read surviving the extraction. leaveCurrentGame()
  // clears activeCategoryIds before this line runs; it works today only because
  // the closure predates the reset.
  test('no longer reads activeCategoryIds out of the pre-reset closure', () => {
    expect(host).not.toMatch(/Array\.from\(activeCategoryIds\)/);
  });
});

describe('the edit flow is wired, not just built', () => {
  // rejects: the gap this file exists for — a finished edit dialog and a
  // finished PUT handler with nothing joining them, shipped as dead code the
  // way the OAuth return-path change was.
  test('the history panel\'s Edit is wired to a handler that fetches the host prefill', () => {
    expect(host).toMatch(/onEdit=\{editGameFromHistory\}/);
  });

  /*
    THE PREFILL COMES FROM THE HOST'S DOOR, `GET /games/{id}/host-details`,
    which carries the Cognito authorizer (get-game.js asks
    callerMayDriveSession). The public `?role=host` branch no longer returns
    aiContext or the briefing: `role` is a query parameter anyone can type
    (tests/get-game-host-details.js).
  */
  // rejects: the read going back to `?role=host`, where both fields are now
  // absent — the dialog would open with them blank, and Save sends what the
  // dialog holds, so an edit would erase them. And rejects reaching the door
  // with bare fetch, which is a 401: no Authorization header.
  test('the prefill is read on the host-details route, with authFetch', () => {
    const start = host.indexOf('const editGameFromHistory = async');
    expect(start).toBeGreaterThan(-1);
    const body = host.slice(start, host.indexOf('\n  };', start));
    expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{selectedGameId\}\/host-details`\)/);
    expect(body).not.toMatch(/role=host/);
  });

  test('the dialog is mounted in edit mode from the fetched values', () => {
    expect(host).toMatch(/mode="edit"/);
    expect(host).toMatch(/initialValues=\{editTarget\.values\}/);
  });

  // rejects: rebuilding the PUT body inline in GameHostPage — precisely how a
  // field drifts off the tested wire shape and is silently ignored by the
  // backend's whitelist.
  test('saving sends updateGameBody, and nothing hand-rolled', () => {
    expect(host).toMatch(/import \{ createGameBody, updateGameBody \} from '\.\/config\/createGame'/);
    expect(host).toMatch(/JSON\.stringify\(updateGameBody\(/);
  });
});

describe('the trivia timer is gone, not hidden', () => {
  // rejects: deleting the control but leaving the state and the send, which
  // would keep shipping a field create-game.js:9 has always discarded.
  test('GameHostPage names it nowhere', () => {
    expect(host).not.toMatch(/triviaTimer/i);
  });

  test('Quickstart sends it no longer', () => {
    expect(quickstart).not.toMatch(/triviaTimer/i);
  });
});

/**
 * THE SCOPE REACHES THE CALL SITE.
 *
 * `createGameBody` sending `questionSetScope` and `GameSetupDialog` raising
 * `setScope` are both unit-tested. Between them sits `handleStartNewGame`, in a
 * file jsdom cannot mount — which is exactly the gap this suite exists for, and
 * exactly where a scope fix would ship as dead code: green on both ends, and the
 * page still calling `fetchCategories(setId)` with no library named.
 */
describe('the host page carries the set\'s scope, not just its id', () => {
  // rejects: the page handling the dialog's callback with one parameter, which
  // silently drops the scope the picker just went to the trouble of raising.
  test('handleSetupSetChange takes a scope and passes it to both reads', () => {
    const fn = host.match(/const handleSetupSetChange = \(([^)]*)\) => \{([\s\S]*?)\n  \};/);
    expect(fn).not.toBeNull();
    const [, params, body] = fn;
    expect(params).toMatch(/scope/);
    expect(body).toMatch(/fetchCategories\([^)]*scope/);
    expect(body).toMatch(/fetchQuestionSetInstruction\([^)]*scope/);
  });

  // rejects: the categories read going back to a bare URL, which sends
  // get-categories.js back to searching the readable scopes for the right set.
  test('the categories read names the library in the query string', () => {
    expect(host).toMatch(/question-sets\/\$\{setId\}\/categories\$\{scopeQuery\}/);
    expect(host).toMatch(/scope=\$\{encodeURIComponent\(scope\)\}/);
  });

  // rejects: matching a set out of the list by id alone, which returns
  // whichever library happens to come first in the response.
  test('the instruction read matches on the pair', () => {
    expect(host).toMatch(/set\.scope \|\| DEFAULT_SCOPE\) === scope/);
  });

  /*
    A session plays ONE partition for its whole life. Restoring the host screen
    has to read the scope the session PINNED, which is why get-game-state.js
    returns `questionSetScope` beside the id.
  */
  // rejects: a reload resolving a restored session's categories by search.
  test('a restored session reloads from the scope it pinned', () => {
    expect(host).toMatch(/gameStateData\.gameMetadata\.questionSetScope/);
    expect(host).toMatch(/fetchCategories\(restoredSetId, true, restoredSetScope\)/);
  });

  // rejects: auto-selection dropping the scope off a row that carries one.
  test('auto-selecting the first set keeps its scope', () => {
    expect(host).toMatch(/activeSets\[0\]\.scope \|\| DEFAULT_SCOPE/);
  });

  // rejects: the create call reaching createGameBody without the scope on the
  // form — the body would then send `platform` for every org set.
  test('the create form carries setScope through to the body', () => {
    expect(host).toMatch(/fetchQuestionSetInstruction\(form\.setId, form\.setScope\)/);
  });
});

/**
 * A SURVEY IS CREATED AND OPENED IN ONE PRESS (IMPLEMENTATION-phase-2.md §5
 * risk 5). The dialog's button says "Open the survey", so the create call is
 * followed by POST /start and the host lands on the collecting stage — the
 * QuickstartMenu precedent. Every other type still goes create → history →
 * Start, because a lobby that fills before the first round is their design;
 * a survey has no lobby worth waiting in (s-01-collecting draws none).
 */
describe('a survey create opens the survey, with no history modal in between', () => {
  const bodyOf = (name) => {
    const start = host.indexOf(`const ${name} = async`);
    expect(start).toBeGreaterThan(-1);
    return host.slice(start, host.indexOf('\n  };', start));
  };

  test('handleStartNewGame sends a survey down its own path', () => {
    const body = bodyOf('handleStartNewGame');
    const branch = body.match(/if \(isSurveyType\(form\.gameType\)\) \{([\s\S]*?)\} else \{([\s\S]*?)\n {8}\}/);
    expect(branch).not.toBeNull();
    const [, surveyPath, otherPath] = branch;
    expect(surveyPath).toMatch(/openNewSurvey\(newGameId, form\)/);
    // rejects: the survey path falling through to the history modal.
    expect(surveyPath).not.toMatch(/setShowReportsModal\(true\)/);
    expect(otherPath).toMatch(/setShowReportsModal\(true\)/);
  });

  test('opening posts /start through the one start helper, then goes to the stage', () => {
    const open = bodyOf('openNewSurvey');
    const starts = open.indexOf('startSession(');
    expect(starts).toBeGreaterThan(-1);
    // The history modal is only the fallback for a start that failed.
    const fallback = open.indexOf('setShowReportsModal(true)');
    expect(fallback === -1 || fallback > starts).toBe(true);
    // startSession resolves {ok, error} (the refusal in the server's words,
    // utils/startRefusal.js), so success is `opened.ok`, not a bare boolean.
    expect(open).toMatch(/if \(opened\.ok\) return;/);

    const start = bodyOf('startSession');
    expect(start).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{\w+\}\/start`/);
    expect(start).toMatch(/method: 'POST'/);
    expect(start).toMatch(/switchToGame\(/);
  });

  test('history\'s own Start still uses the same helper — one caller of /start', () => {
    expect(bodyOf('startGameFromHistory')).toMatch(/startSession\(/);
    expect((host.match(/\/start`/g) || []).length).toBe(1);
  });
});
