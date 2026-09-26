/**
 * THE SESSION PANEL FROM THE HOST'S KEYBOARD — sessionPanelKeyLive,
 * useSessionPanelKey, and GameHostPage.jsx's wiring, read as source.
 *
 * Owner report, 26 Sep 2026: "the '\' does close the session menu on the host
 * screen but will not open it." `\` (and Escape) have always closed the panel
 * — SessionSetupPanel.jsx's own document listener, mounted only while it is
 * rendered. Nothing opened it. This suite covers the open half end to end:
 * the pure overlay predicate, the hook, and the page's call site — the same
 * three layers `scoreboardHostKeys.test.jsx` covers for S/V, which this file
 * is modeled on.
 *
 * GameHostPage cannot easily be exercised for this (an AuthProvider and a
 * live socket), so behaviour is proven with a small harness that reproduces
 * the page's real arrangement — the hook plus the real `SessionSetupPanel` —
 * and the WIRING (did the page actually pass the right terms) is read from
 * its comment-stripped source, the same technique hostOverlays.test.js and
 * scoreboardHostKeys.test.jsx both use.
 */
import React, { useState } from 'react';
import fs from 'fs';
import path from 'path';
import { render, act, fireEvent, screen } from '@testing-library/react';
import useSessionPanelKey from '../components/stage/useSessionPanelKey';
import { sessionPanelKeyLive } from '../utils/hostOverlays';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { HOST_ROLE } from '../config/help/host';

// `document.body`, not `window`: SessionSetupPanel's own close listener is on
// `document`, and a real keypress bubbles target -> document -> window, so
// only a target inside the document reaches both listeners the way a real
// press would. Firing directly on `window` (as this file used to) never
// reaches a `document` listener at all — window has no children to bubble
// down through — which is a test artifact, not anything true of a browser.
const press = (k, opts = {}) => act(() => { fireEvent.keyDown(opts.target || document.body, { key: k, ...opts }); });

describe('sessionPanelKeyLive — when the session panel\'s open key (\\) may fire', () => {
  test('live with nothing open', () => {
    expect(sessionPanelKeyLive({})).toBe(true);
    expect(sessionPanelKeyLive()).toBe(true);
  });

  test('off while the panel itself is already open — closing is a different listener\'s job', () => {
    expect(sessionPanelKeyLive({ setupPanelOpen: true })).toBe(false);
  });

  test('off under every overlay the scoreboard keys also yield to', () => {
    for (const flag of ['showConfirmModal', 'showExpandedQR', 'showReportsModal',
      'isLoadingData', 'spotlightOpen', 'pastRoundOpen']) {
      expect(sessionPanelKeyLive({ [flag]: true })).toBe(false);
    }
    expect(sessionPanelKeyLive({ qrMode: 'pinned' })).toBe(false);
    expect(sessionPanelKeyLive({ qrMode: 'preview' })).toBe(true);
  });

  test('an expanded question does NOT hold it back — a deliberate difference from scoreboardKeysLive', () => {
    // rejects: passing `shortcutsSuppressed` straight through unmodified,
    // which would fold this term back in.
    expect(sessionPanelKeyLive({ lessonExpanded: true })).toBe(true);
  });

  test('an open scoreboard does not hold it back either — the panel is a side surface reachable mid-board', () => {
    expect(sessionPanelKeyLive({ scoreboardOpen: true })).toBe(true);
  });
});

describe('useSessionPanelKey + the real SessionSetupPanel', () => {
  function Host({ enabledExtra = true }) {
    const [setupPanelOpen, setSetupPanelOpen] = useState(false);
    const sessionPanelKeyOn = sessionPanelKeyLive({ setupPanelOpen });
    useSessionPanelKey({
      enabled: sessionPanelKeyOn && enabledExtra,
      onOpen: () => setSetupPanelOpen(true),
    });
    return (
      <div>
        <output data-testid="panel">{setupPanelOpen ? 'open' : 'closed'}</output>
        {setupPanelOpen && <SessionSetupPanel onClose={() => setSetupPanelOpen(false)} />}
      </div>
    );
  }

  const state = (utils) => utils.getByTestId('panel').textContent;

  test('\\ on the stage opens the Session panel', () => {
    const utils = render(<Host />);
    expect(state(utils)).toBe('closed');
    press('\\');
    expect(state(utils)).toBe('open');
  });

  test('a second \\ closes it, and it stays closed — no double fire', () => {
    const utils = render(<Host />);
    press('\\');
    expect(state(utils)).toBe('open');
    press('\\');
    expect(state(utils)).toBe('closed');
    // A third press reopens exactly once — proof the first close did not
    // leave a stray listener behind that would race the reopen.
    press('\\');
    expect(state(utils)).toBe('open');
  });

  test('Escape closes it too, through the panel\'s own listener, once open', () => {
    const utils = render(<Host />);
    press('\\');
    expect(state(utils)).toBe('open');
    press('Escape');
    expect(state(utils)).toBe('closed');
  });

  test('\\ does nothing while the survey walk-through is open (or any surface replacing the stage)', () => {
    const utils = render(<Host enabledExtra={false} />);
    press('\\');
    expect(state(utils)).toBe('closed');
  });

  test('nothing while typing in a field outside the panel', () => {
    function HostWithField() {
      const [setupPanelOpen, setSetupPanelOpen] = useState(false);
      useSessionPanelKey({
        enabled: sessionPanelKeyLive({ setupPanelOpen }),
        onOpen: () => setSetupPanelOpen(true),
      });
      return (
        <div>
          <output data-testid="panel">{setupPanelOpen ? 'open' : 'closed'}</output>
          <input data-testid="field" />
        </div>
      );
    }
    const utils = render(<HostWithField />);
    press('\\', { target: utils.getByTestId('field') });
    expect(state(utils)).toBe('closed');
  });
});

describe('the key is written down where the host looks for it', () => {
  test('the host guide lists \\', () => {
    const items = JSON.stringify(HOST_ROLE);
    expect(items).toContain('"keys":"\\\\","text":"Open and close the session panel."');
  });
});

/* ---------------------------------------------------------------- source */

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const PAGE = code(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));

describe('GameHostPage wires it', () => {
  test('imports and calls the hook', () => {
    expect(PAGE).toMatch(/import useSessionPanelKey from '\.\/components\/stage\/useSessionPanelKey';/);
    expect(PAGE).toMatch(/useSessionPanelKey\(\{([\s\S]*?)\}\);/);
  });

  test('it is mounted above the early returns, alongside the scoreboard keys', () => {
    // rejects: moving the call below `if (showQuickstartMenu) { return ... }`
    // or any other early return — a hook below a conditional return breaks
    // React's hook order.
    const scoreboardAt = PAGE.indexOf('useScoreboardKeys({');
    const sessionAt = PAGE.indexOf('useSessionPanelKey({');
    const firstReturnAt = PAGE.indexOf('if (showQuickstartMenu)');
    expect(scoreboardAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(scoreboardAt);
    expect(firstReturnAt).toBeGreaterThan(sessionAt);
  });

  test('enabled is built from sessionPanelKeyLive, with the same terms scoreboardKeysOn carries', () => {
    const live = /const sessionPanelKeyOn = sessionPanelKeyLive\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(live).not.toBeNull();
    for (const term of ['setupPanelOpen', 'showConfirmModal', 'showExpandedQR', 'showReportsModal',
      'isLoadingData', 'qrMode', 'spotlightOpen', 'pastRoundOpen']) {
      expect(live[1]).toMatch(new RegExp(`\\b${term}\\b`));
    }

    const hook = /useSessionPanelKey\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(hook).not.toBeNull();
    expect(hook[1]).toMatch(/enabled:\s*sessionPanelKeyOn\b/);
    for (const term of ['showQuickstartMenu', 'showWelcomeScreen', 'showNewGameDialog',
      'showReport', 'showSurveyResults', 'showSurveyWalkthrough', 'editTarget', 'gameId']) {
      expect(hook[1]).toMatch(new RegExp(`\\b${term}\\b`));
    }
  });

  test('onOpen sets the panel open, the same state the dock\'s SESSION button toggles', () => {
    const hook = /useSessionPanelKey\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(hook[1]).toMatch(/onOpen:\s*\(\)\s*=>\s*setSetupPanelOpen\(true\)/);
  });
});
