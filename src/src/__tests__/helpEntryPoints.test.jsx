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

  const openSettings = () => {
    render(<SessionSetupPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
  };

  test('the Settings tab offers the host guides', () => {
    openSettings();
    expect(screen.getByRole('button', { name: /Host guides/i })).toBeInTheDocument();
  });

  test('it opens the host role index', () => {
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: /Host guides/i }));
    expect(screen.getByRole('heading', { level: 1, name: /For hosts/i })).toBeInTheDocument();
  });

  /*
    "Show how this works on the stage" is a DIFFERENT control and both are
    wanted: that one puts an explanation on the projector for the room to read.
    This one opens documentation on the host's own screen. A change that
    replaced either with the other would pass a looser assertion than this.
  */
  test('it does not replace the on-stage explainer, which is a different thing', () => {
    openSettings();
    expect(screen.getByRole('button', { name: /Show how this works on the stage/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Host guides/i })).toBeInTheDocument();
  });
});
