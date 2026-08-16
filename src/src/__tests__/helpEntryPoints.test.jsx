/**
 * CAN THE AUDIENCE ACTUALLY REACH THE DOCUMENTATION WRITTEN FOR THEM?
 *
 * Before this change the answer was: admins yes, everyone else no. `HelpButton`
 * was imported in exactly one file, `AdminPage.jsx`, while the help system's
 * contents advertised four player guides and five host guides. A whole audience
 * had a documentation set and no door.
 *
 * The two mounts are asserted on the surfaces they were added to, not by
 * grepping for the import — a component can be imported and never rendered, and
 * that is precisely the failure being fixed.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { PlayerShell } from '../PlayerPage';

describe('§1 the player has a way in', () => {
  /*
    IN THE BAR, NOT THE DOCK. The dock is omitted entirely when there is
    nothing to do — and "that name is taken" is one of those dock-less screens,
    which is also the single most likely moment for a player to want help. A
    control that lives in the dock would be missing exactly then.
  */
  test('the shell renders a help control even with no dock', () => {
    render(<PlayerShell phase="REST" ctx="Round 1" who="Ada" dock={null} />);
    expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument();
  });

  test('it opens the player guides', () => {
    render(<PlayerShell phase="ASK" ctx="Round 1" who="Ada" />);
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    expect(screen.getByRole('heading', { level: 1, name: /For players/i })).toBeInTheDocument();
  });

  test('the player guides it opens are the four written for them', () => {
    render(<PlayerShell phase="ASK" ctx="Round 1" who="Ada" />);
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    ['Getting started', 'Joining a session', 'Playing', 'Scoring'].forEach((title) => {
      expect(screen.getByRole('button', { name: new RegExp(title, 'i') })).toBeInTheDocument();
    });
  });

  test('the help control is inside the player surface scope, not beside it', () => {
    // A dialog rendered as a sibling of `.plr` inherits the document's light
    // theme and resolves none of the --plr-* tokens — the bug the shell's own
    // `after` prop exists to avoid. The button must be within the scope so the
    // modal it opens is too.
    const { container } = render(<PlayerShell phase="ASK" ctx="Round 1" who="Ada" />);
    const scope = container.querySelector('.plr');
    expect(within(scope).getByRole('button', { name: /help/i })).toBeInTheDocument();
  });
});

describe('§2 the host has a way in', () => {
  const panelProps = {
    gameId: '1234',
    gameType: 'call-and-answer',
    players: [],
    categories: [],
    questions: [],
    rounds: [],
    playUrl: 'https://example.test/play/1234',
    remoteUrl: 'https://example.test/remote/1234',
  };

  /*
    REACHABLE WITHOUT OPENING ANYTHING, which is the whole of this fix.

    The first version put this control in the Settings tab under a "Session"
    heading — fourth tab, fifth block down — and the owner's report was "i dont
    see the help anywhere". These tests deliberately do NOT click a tab first:
    the previous ones did, which is why they stayed green while the control was
    effectively unreachable.
  */
  test('the host guides are on screen the moment the panel opens', () => {
    render(<SessionSetupPanel {...panelProps} />);
    expect(screen.getByRole('button', { name: /Host guides/i })).toBeInTheDocument();
  });

  test('it lives in the header, beside Close, not inside a tab panel', () => {
    // The header is the one region on screen whichever tab is selected. A
    // control in a tabpanel is a control most hosts never see.
    const { container } = render(<SessionSetupPanel {...panelProps} />);
    const header = container.querySelector('.setup-panel__header');
    expect(within(header).getByRole('button', { name: /Host guides/i })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /Close setup/i })).toBeInTheDocument();
  });

  test('it stays reachable on every tab', () => {
    render(<SessionSetupPanel {...panelProps} />);
    for (const tab of ['Players', 'Questions', 'Rounds', 'Settings']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('button', { name: /Host guides/i })).toBeInTheDocument();
    }
  });

  test('it opens the host role index', () => {
    render(<SessionSetupPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Host guides/i }));
    expect(screen.getByRole('heading', { level: 1, name: /For hosts/i })).toBeInTheDocument();
  });

  /*
    "Show how this works on the stage" is a DIFFERENT control and both are
    wanted: that one puts an explanation on the PROJECTOR for the room to read.
    This one opens documentation on the host's own screen. Moving the guides out
    of Settings must not have taken the explainer with them.
  */
  test('the on-stage explainer is still in Settings, and is a different thing', () => {
    render(<SessionSetupPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: /Show how this works on the stage/i }))
      .toBeInTheDocument();
    // Exactly one help control on the surface — the move was a move, not a copy.
    expect(screen.getAllByRole('button', { name: /Host guides/i })).toHaveLength(1);
  });
});

describe('§3 neither control is painted in a colour the palette does not have', () => {
  /*
    `.help-button` ships `background: #3b82f6` with a blue drop shadow — a
    colour in no Warm Summit palette, dusk or paper. Unretinted it reads as a
    browser affordance left on the surface rather than part of the product.
    Both host surfaces re-tint it rather than forking the component.

    Read as text: jsdom loads no stylesheet and resolves no custom property, so
    this is the same technique playerSurfacePalette.test.js uses throughout.
  */
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('the player re-tints it, at a specificity that does not depend on bundle order', () => {
    const css = strip(read('components', 'PlayerSurface.css'));
    expect(css).toMatch(/\.plr\s+\.help-button\.plr-helpbtn\s*\{/);
    expect(css).not.toMatch(/#3b82f6/i);
  });

  test('the player target is 44px, which the base component is not', () => {
    // `.help-button-small` is 32px. Audit A4 is "every target is 44x44", and
    // the player surface is the phone — the one place that is not negotiable.
    const css = strip(read('components', 'PlayerSurface.css'));
    const rule = css.slice(css.indexOf('.plr .help-button.plr-helpbtn {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/width:\s*44px/);
    expect(body).toMatch(/height:\s*44px/);
  });

  test('the host panel re-tints it too, and exempts it from the blanket repaint', () => {
    const css = strip(read('styles.css'));
    expect(css).toMatch(/\.setup-panel\s+\.help-button\.setup-panel__help\s*\{/);
    // Without the exemption the blanket `.setup-panel button:not(...)` rule
    // makes it a full-size panel button in a header sized for a 34px icon.
    expect(css).toMatch(/\.setup-panel button:not\([^{]*\.setup-panel__help/);
  });
});
