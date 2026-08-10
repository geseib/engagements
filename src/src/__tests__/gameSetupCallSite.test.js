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
    expect(host).toMatch(/import \{ createGameBody \} from '\.\/config\/createGame'/);
    expect(host).toMatch(/JSON\.stringify\(createGameBody\(/);
  });

  // rejects: the stale-closure read surviving the extraction. leaveCurrentGame()
  // clears activeCategoryIds before this line runs; it works today only because
  // the closure predates the reset.
  test('no longer reads activeCategoryIds out of the pre-reset closure', () => {
    expect(host).not.toMatch(/Array\.from\(activeCategoryIds\)/);
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
