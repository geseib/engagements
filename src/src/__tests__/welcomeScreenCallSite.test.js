/**
 * The wiring between the extracted welcome screen and the page that mounts it.
 *
 * `WelcomeScreen` is tested by rendering it. Between it and the running app
 * sits `GameHostPage`, a 5,000-line file that cannot be mounted in jsdom at
 * all — and that gap is exactly where an extraction ships as dead code: a new
 * component file that nothing renders, with the old markup still on screen.
 *
 * So these are source assertions, deliberately, and they run against
 * COMMENT-STRIPPED source: a previous agent's test in this repo passed on a
 * comment.
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
const styles = stripComments(fs.readFileSync(src('styles.css'), 'utf8'));

describe('the page actually mounts the extracted screen', () => {
  test('it imports and renders <WelcomeScreen>, behind the same flag', () => {
    // rejects: the extraction shipping as dead code. The trailing \s and the
    // gate are both load-bearing — `/<WelcomeScreen/` alone still matches
    // after a rename to <WelcomeScreenX>, and without the gate the screen
    // could be rendered unconditionally over a live session.
    expect(host).toMatch(/import\s+WelcomeScreen\s+from\s+'\.\/components\/WelcomeScreen'/);
    expect(host).toMatch(/if \(showWelcomeScreen\) \{[\s\S]{0,120}<WelcomeScreen\s/);
  });

  test('every capability the old screen had is wired to a handler', () => {
    // rejects: dropping one of the five on the way through the rewrite — the
    // component renders all five controls whether or not the page passes
    // anything, so an unpassed prop is silent at both ends.
    expect(host).toMatch(/onQuickStart=\{\(\) => setShowQuickstartMenu\(true\)\}/);
    expect(host).toMatch(/onCreateEngagement=\{handleWelcomeNewGame\}/);
    expect(host).toMatch(/onViewHistory=\{handleViewGameHistory\}/);
    expect(host).toMatch(/onSignOut=\{handleSignOut\}/);
    expect(host).toMatch(/onContinue=\{handleContinueGame\}/);
    expect(host).toMatch(/onContinueGameIdChange=\{setContinueGameId\}/);
  });

  test('the question-sets door opens the dialog that already exists', () => {
    // rejects: three separate ways this feature ships broken and silent.
    //
    //   - a handler with no dialog behind it. The component renders the button
    //     whether or not anything is passed, so an unwired prop is a control
    //     that does nothing and says nothing.
    //   - a second copy of the shelf. `HostQuestionSetsDialog` is the surface
    //     the create screen already opens; a new one here would be two lists of
    //     the same sets diverging.
    //   - the dialog nested INSIDE <WelcomeScreen>. `.wel-page` is fixed, full
    //     bleed and carries `data-theme="dark"`, so a white `.qsets--onlight`
    //     card inside it inherits the dusk tokens its own scope is there to
    //     override.
    expect(host).toMatch(/import\s+HostQuestionSetsDialog\s+from\s+'\.\/components\/HostQuestionSetsDialog'/);
    expect(host).toMatch(/onQuestionSets=\{\(\) => setShowHostSets\(true\)\}/);
    expect(host).toMatch(/showHostSets && \(\s*<HostQuestionSetsDialog/);

    // A SIBLING, NOT A CHILD — asserted by position: the mount is after the
    // screen's own closing tag, not between it and one.
    const welcome = host.indexOf('<WelcomeScreen');
    const dialog = host.indexOf('<HostQuestionSetsDialog onClose');
    expect(dialog).toBeGreaterThan(welcome);
    expect(host.slice(welcome, dialog)).toContain('/>');
  });

  test('it renders before <Stage>, where the one identity block belongs', () => {
    // rejects: moving the screen below the stage, which is the ordering
    // setupPanelCallSite.test.js reads to prove the surviving name-and-badge
    // block is the pre-game one and not a room-facing panel.
    const welcome = host.indexOf('<WelcomeScreen');
    const stage = host.indexOf('<Stage');
    expect(welcome).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(-1);
    expect(welcome).toBeLessThan(stage);
  });
});

describe('the old screen is gone, not hidden behind the new one', () => {
  test('none of its markup survives in the page', () => {
    // rejects: leaving the cream card and its stacked buttons in place
    // alongside the component — which is how a screen ends up with two ways to
    // start a session and one of them stale.
    for (const gone of ['welcome-card', 'welcome-content', 'welcome-options',
      'welcome-btn', 'welcome-title', 'continue-game-section', 'continue-game-form',
      'welcome-user-info', 'game-id-input']) {
      expect(host).not.toContain(gone);
    }
  });

  test('the inline style objects that dressed it are gone too', () => {
    // rejects: the hardcoded #f8f9fa / #dee2e6 / #007bff identity box, which
    // is three colours from no palette at all sitting in the middle of a
    // tokenised design system.
    expect(host).not.toMatch(/#f8f9fa/i);
    expect(host).not.toMatch(/#dee2e6/i);
    expect(host).not.toMatch(/#007bff/i);
  });

  test('the amber-page stylesheet goes with the markup', () => {
    // rejects: both a revert to `background: var(--primary)` on the whole page
    // — --primary is the ONE hero accent and a screen that floods it has
    // nothing left to accent with — and simply orphaning 90 lines of CSS that
    // no element can ever match again.
    expect(styles).not.toMatch(/\.welcome-screen\s*\{/);
    expect(styles).not.toMatch(/\.welcome-card\s*\{/);
    expect(styles).not.toMatch(/\.continue-game-section\s*\{/);
  });
});
