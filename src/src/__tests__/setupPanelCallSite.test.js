/**
 * The wiring between the panel and the page that mounts it.
 *
 * `SessionSetupPanel` is tested by rendering it and `config/setupPanel.js` by
 * calling it. Between them sits `GameHostPage`, a 5,000-line file that cannot
 * be mounted in jsdom at all — and that gap is exactly where a change ships as
 * dead code. An entire OAuth return-path fix did, with twelve green tests on
 * the module and nothing on its only call site.
 *
 * So these are source assertions, deliberately, and they run against
 * COMMENT-STRIPPED source: a previous agent's test passed on a comment.
 */
import fs from 'fs';
import path from 'path';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')        // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
const dock = stripComments(fs.readFileSync(src('components', 'stage', 'Dock.jsx'), 'utf8'));
const bar = stripComments(fs.readFileSync(src('components', 'HostActionBar.jsx'), 'utf8'));
const welcome = stripComments(fs.readFileSync(src('components', 'WelcomeScreen.jsx'), 'utf8'));

describe('the page actually mounts the panel', () => {
  test('it imports and renders <SessionSetupPanel>', () => {
    // rejects: the whole extraction shipping as dead code — a new component
    // file that nothing renders, with the old panels still on screen. The
    // trailing \s and the gating condition are both load-bearing: `/<Session
    // SetupPanel/` alone still matched after the element was renamed to
    // <SessionSetupPanelX> and the condition replaced with `false`.
    expect(host).toMatch(/import\s+SessionSetupPanel\s+from\s+'\.\/components\/stage\/SessionSetupPanel'/);
    expect(host).toMatch(/\{setupPanelOpen && \(\s*<SessionSetupPanel\s/);
  });

  test('closing the panel goes through closeAllSidePanels', () => {
    // rejects: an onClose that only flips the flag. Half the panel is
    // round-scoped, and closeAllSidePanels is what also drops the browser's
    // rows — the wiring that stopped `browsingQuestions` leaking across opens.
    expect(host).toMatch(/onClose=\{closeAllSidePanels\}/);
  });

  test('the dock\'s SETUP button opens it, and nothing else does', () => {
    // rejects: leaving `onSetup` pointed at the deleted qr-sidebar state — a
    // repoint that is one identifier wide and silent if missed.
    expect(host).toMatch(/onSetup=\{\(\) => setSetupPanelOpen/);
    expect(host).not.toMatch(/setQrSidebarVisible/);
  });

  test('it is a SIBLING of <Stage>, not a child', () => {
    // rejects: mounting it inside the measured subtree, where useStageFit
    // would re-enter on every open and a tab list of unknown length would
    // drive the scale search to its floor.
    const stageClose = host.indexOf('</Stage>');
    const panel = host.indexOf('<SessionSetupPanel');
    expect(stageClose).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(stageClose);
  });
});

describe('the four surfaces it replaced are gone, not hidden', () => {
  test('neither edge tab nor either side panel survives', () => {
    // rejects: adding the panel alongside the old ones, which is how a screen
    // ends up with two ways to do the same thing and one of them stale.
    for (const gone of ['instructions-sidebar', 'instructions-tab',
      'qr-sidebar', 'qr-tab', 'question-browser-modal']) {
      expect(host).not.toContain(gone);
    }
  });

  test('the how-to-play document is gone, and only its entry point remains', () => {
    // It rendered for THREE OF FIVE game types — a wavelength or survey host
    // opened it and saw a heading, nothing, and a Sign Out button. The four
    // lines belong on the stage, where the players they address can read them.
    expect(host).not.toMatch(/Read the Content:/);
    expect(host).not.toMatch(/Vote for Best Responses:/);
    expect(host).toMatch(/onShowHowToPlay=/);
  });

  test('no email address is rendered anywhere on the host page', () => {
    // rejects: either of the two panel identity blocks, which rendered the
    // signed-in name, email and Administrator badge — twice, in two panels
    // the room can watch. THE EMAIL IS THE BINDING PART: a third block
    // survives on the pre-game welcome screen, which is not a room-facing
    // surface and prints a name and an admin badge but no address.
    //
    // That block now lives in components/WelcomeScreen.jsx rather than inline
    // in this file, so the count is taken across BOTH — otherwise the
    // extraction alone would satisfy an assertion that meant to say "exactly
    // one, and it is the pre-game one".
    expect(host).not.toMatch(/attributes\?\.email/);
    expect(welcome).not.toMatch(/attributes\?\.email/);
    const adminBadges = (host + welcome).match(/Administrator/g) || [];
    expect(adminBadges).toHaveLength(1);
    // ...and the screen carrying it is mounted before the stage, i.e. it is
    // the pre-game door and not a panel a room can watch.
    expect(host.indexOf('<WelcomeScreen')).toBeGreaterThan(-1);
    expect(host.indexOf('<WelcomeScreen')).toBeLessThan(host.indexOf('<Stage'));
  });

  test('the z-index: 999999 scrim is gone', () => {
    // It was the highest z-index in the codebase by three orders of magnitude,
    // and it covered the dock — audit A6.
    expect(host).not.toMatch(/999999/);
  });

  test('the dead state the panels owned is gone with them', () => {
    // rejects: leaving `questionSetTabVisible` behind — declared, set, cleared
    // by closeAllSidePanels, and read by nothing.
    for (const dead of ['questionSetTabVisible', 'instructionsVisible',
      'showQuestionBrowser', 'setSelectedCategory']) {
      expect(host).not.toMatch(new RegExp(`\\b${dead}\\b`));
    }
  });

  test('the useWebSocket === false polling branch is gone', () => {
    // `useWebSocket` is hardcoded true, so the branch was an unreachable
    // second answer to "is the room connected?" sitting beside the real one.
    expect(host).not.toMatch(/HTTP Polling Mode/);
  });
});

describe('the debug tracers that ran in live sessions', () => {
  test('nothing logs on every render of the host page', () => {
    // rejects: the `🎨 RENDER:` line, which fired on EVERY render — including
    // every WebSocket frame, in front of a room.
    expect(host).not.toMatch(/RENDER: showQuestionBrowser/);
    expect(host).not.toMatch(/🎨/);
  });

  test('opening the browser no longer schedules a setTimeout purely to log', () => {
    // rejects: the five-line trace plus a 100ms timer whose entire body was a
    // console.log.
    expect(host).not.toMatch(/State check after timeout/);
    expect(host).not.toMatch(/MODAL STATE CHANGE/);
    expect(host).not.toMatch(/Modal should be VISIBLE/);
    expect(host).not.toMatch(/GameHostPage component mounted/);
  });
});

describe('the orphaned close handler is wired, not deleted', () => {
  test('closeAllSidePanels calls closeQuestionBrowser', () => {
    // rejects: the shipped state, where the modal's Close button called
    // setShowQuestionBrowser(false) directly and left browsingQuestions and
    // selectedCategory populated — so the next open rendered the previous
    // set's rows until the fetch landed.
    expect(host).toMatch(/const closeAllSidePanels = \(\) => \{[\s\S]{0,200}closeQuestionBrowser\(\)/);
  });

  test('opening the panel actually fetches the questions', () => {
    // rejects: the state this shipped in for one commit — the fetch existed,
    // the panel rendered, and NOTHING CALLED IT, so the Questions tab showed
    // its empty state forever. The magnifier used to be the only caller and it
    // was deleted with the category rows it sat in.
    expect(host).toMatch(/if \(setupPanelOpen\) fetchQuestionsForBrowsing\(\);/);
    expect(host).toMatch(/\}, \[setupPanelOpen\]\)/);
  });

  test('the browser fetches the WHOLE set, not one category', () => {
    // rejects: the per-category fetch behind the magnifier, which is what made
    // it impossible for a host to see the whole set at once.
    expect(host).toMatch(/const fetchQuestionsForBrowsing = async \(\) =>/);
    expect(host).not.toMatch(/questions\?category=/);
  });
});

describe('the SPACE guard is wired at both ends', () => {
  test('HostActionBar checks the panel by event target', () => {
    // rejects: deleting the guard, or moving it above the isTypingTarget check
    // where it would be unreachable for the search box.
    expect(bar).toMatch(/event\.target\?\.closest\?\.\('\.setup-panel'\)/);
  });

  test('the class it looks for is the class the panel renders', () => {
    // rejects: renaming one end. The guard is a string match against a class
    // name — split them and it fails open, silently, with both files' own
    // tests still green.
    //
    // The className is a template now (the Questions tab adds
    // `setup-panel--wide`), so this matches the BASE class at the head of the
    // expression. It must stay the head: `setup-panel--wide` alone would not
    // satisfy `.closest('.setup-panel')`, and losing the base class is exactly
    // the silent failure this test exists to catch. The rendered counterpart
    // is in sessionSetupPanel.test.jsx, which asserts the element is really
    // reachable by that selector on every tab.
    const panel = fs.readFileSync(src('components', 'stage', 'SessionSetupPanel.jsx'), 'utf8');
    expect(panel).toMatch(/className=(?:"setup-panel"|\{`setup-panel[^`]*`\})/);
  });
});

describe('the dock control names the panel it opens', () => {
  test('it reads SESSION, sits last, and is not called Console', () => {
    // rejects: reverting to SETUP (a one-time, pre-session act — this panel is
    // where the host looks mid-round), re-adding the ellipsis, moving the
    // control back to the head of the dock away from the panel's edge, and
    // printing the proper noun user testing killed.
    expect(dock).toMatch(/SESSION/);
    expect(dock).not.toMatch(/>SETUP</);
    expect(dock).not.toContain('⋯');
    expect(dock).not.toMatch(/Console/i);

    const body = dock.slice(dock.indexOf('<footer'));
    expect(body.indexOf('dock-more')).toBeGreaterThan(body.indexOf('{children}'));
  });
});

describe('nothing on the host screen says "Console"', () => {
  test('the proper noun user testing killed stays dead', () => {
    const panel = stripComments(
      fs.readFileSync(src('components', 'stage', 'SessionSetupPanel.jsx'), 'utf8')
    );
    // Only JSX text and string literals matter; the identifier does not appear
    // at all, so a plain search is honest here.
    expect(panel.toLowerCase()).not.toContain('console');
  });
});
