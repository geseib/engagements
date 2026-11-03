/**
 * SETTINGS, CONSOLIDATED (owner, 16 Oct 2026; docs/design/settings-consolidation,
 * tab 1). "There doesnt seem to be a way when clicking on the setup button to
 * change screen mode", the Settings tab had nine sections, and the remote's QR
 * said nothing about who must sign in on the phone.
 *
 * Pinned here: the four groups and their order, the Screens group (the same
 * choice the lobby makes, the room's window, the room screen size), the
 * remote's sign-in words for a team and a personal account, and that Setup in
 * the loop offers the same Screens group.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import StepView from '../components/stage/StepView';
import ScreensGroup from '../components/stage/ScreensGroup';
import { remoteSignIn, pickSignedInOrg } from '../config/remoteSignIn';
import { stripFor } from '../config/workflowStrip';

const renderSettings = (props = {}) => render(
  <SessionSetupPanel
    initialTab="screens"
    gameType="call-and-answer"
    gameState="CREATED"
    gameId="4473"
    playUrl="https://engage.example/play?gameId=4473"
    remoteUrl="https://engage.example/remote?gameId=4473"
    profile="room"
    {...props}
  />,
);

const team = { orgId: 'org_A', name: 'Relay Labs', type: 'team' };
const personal = { orgId: 'org_P', name: 'George Seib', type: 'personal' };
const user = { attributes: { name: 'George Seib', email: 'george@example.com' } };

describe('the Session menu, in sections', () => {
  // rejects: dev QA 2 Nov — one Settings tab of four groups plus a Session
  // fold. Since the Session menu redesign (3 Nov 2026) the six sections are
  // the same on every round type, the phone is a group of Screens, and End
  // session is the foot.
  test('Up next, Rounds so far, People, Screens, Joining, How it runs; the old groups live in them', () => {
    const { container } = renderSettings();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Up next', 'Rounds so far', 'People', 'Screens', 'Joining', 'How it runs']);
    const heads = (name) => {
      fireEvent.click(screen.getByRole('tab', { name }));
      return [...container.querySelectorAll('.setup-group h3.setup-h, .setup-group h4.setup-h')].map((h) => h.childNodes[0].textContent);
    };
    expect(heads('Screens')).toEqual(expect.arrayContaining(['Screens', 'Your phone as a remote']));
    expect(heads('Joining')).toEqual(['Players join at']);
    expect(heads('How it runs')).toEqual(['Names', 'Pace']);
    expect(screen.getByTestId('session-menu-foot')).toHaveTextContent('End session…');
    // No folds: each section has one More options instead.
    expect(container.querySelectorAll('details.setup-fold')).toHaveLength(0);
  });

  test('"Display profile" is renamed "Room screen size" and sits with the screens', () => {
    const onProfileChange = jest.fn();
    const { container } = renderSettings({ onProfileChange });
    // Screens · More options since the redesign.
    const more = screen.getByTestId('more-screens-toggle');
    if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
    const screens = container.querySelector('.smenu-pane--screens');
    fireEvent.change(within(screens).getByLabelText('Room screen size'), { target: { value: 'tv' } });
    expect(onProfileChange).toHaveBeenCalledWith('tv');
    expect(container.textContent).not.toMatch(/Display profile/);
  });
});

describe('the Screens group', () => {
  test('on a Call & Answer session it offers one or two screens and calls the lobby\'s chooser', () => {
    const onRoomScreenChange = jest.fn();
    renderSettings({ roomScreen: 'classic', onRoomScreenChange, presentHref: '/present?gameId=4473' });
    const group = screen.getByRole('group', { name: 'Where the room watches' });
    expect(within(group).getByRole('button', { name: 'One screen' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Two screens' }));
    expect(onRoomScreenChange).toHaveBeenCalledWith('two');
  });

  test('on two screens it opens the room\'s window and says whether it is up', () => {
    render(
      <ScreensGroup
        choice="two"
        offerChoice
        onChoose={() => {}}
        presentHref="/present?gameId=4473"
        presentDetail={{ open: true, visible: true, fullscreen: true, ageMs: 1000 }}
        profile="room"
        onProfileChange={() => {}}
      />,
    );
    const open = screen.getByRole('link', { name: /Open ↗/ });
    expect(open).toHaveAttribute('href', '/present?gameId=4473');
    expect(open).toHaveAttribute('target', '_blank');
    // W2 (walk of 18 Oct): the row's label names the window; the status says its state alone.
    expect(screen.getByRole('status')).toHaveTextContent(/^On, full screen$/);
  });

  test('on one screen there is no room\'s window to open', () => {
    render(<ScreensGroup choice="classic" offerChoice onChoose={() => {}} presentHref="/present?gameId=1" profile="room" onProfileChange={() => {}} />);
    expect(screen.queryByRole('link', { name: /Open ↗/ })).toBeNull();
  });

  test('a game type two screens do not cover keeps only the room screen size', () => {
    renderSettings({ gameType: 'survey', roomScreen: 'two' });
    expect(screen.queryByRole('group', { name: 'Where the room watches' })).toBeNull();
    const more = screen.getByTestId('more-screens-toggle');
    if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
    expect(screen.getByLabelText('Room screen size')).toBeInTheDocument();
  });
});

describe('the remote says who may sign in on the phone', () => {
  test('a team session: any host or admin of the team, and who is on this laptop now', () => {
    const { container } = renderSettings({ initialTab: 'remote', remoteWho: remoteSignIn({ org: team, user, privateScreen: true }) });
    const who = container.querySelector('.setup-remote__who');
    expect(who.textContent).toContain('Sign in on the phone as any host or admin of Relay Labs.');
    expect(who.textContent).toContain('On this laptop now: George Seib · Relay Labs');
    expect(container.querySelector('.setup-remote').textContent).not.toMatch(/join/i);
  });

  test('a personal account: only you, by email where the laptop is private', () => {
    const words = remoteSignIn({ org: personal, user, privateScreen: true });
    const { container } = renderSettings({ initialTab: 'remote', remoteWho: words });
    const who = container.querySelector('.setup-remote__who');
    expect(who.textContent).toContain('Sign in on the phone as you (george@example.com). Only your account can drive this session.');
    expect(who.textContent).toContain('On this laptop now: George Seib · Personal');
  });

  test('on one screen the room may be watching, so the email never prints', () => {
    const { container } = renderSettings({ initialTab: 'remote', remoteWho: remoteSignIn({ org: personal, user, privateScreen: false }) });
    expect(container.textContent).not.toContain('@example.com');
    expect(container.querySelector('.setup-remote__who').textContent)
      .toContain('Sign in on the phone as you (George Seib). Only your account can drive this session.');
  });

  test('before the team is known it still says who, without a name', () => {
    expect(remoteSignIn({ org: null, user, privateScreen: true }).text)
      .toBe('Sign in on the phone as a host or admin of this session\'s team.');
  });

  test('the team is the one this browser acts for, else the personal one', () => {
    expect(pickSignedInOrg([personal, team], 'org_A')).toBe(team);
    expect(pickSignedInOrg([personal, team], 'org_gone')).toBe(personal);
    expect(pickSignedInOrg([], 'org_A')).toBeNull();
    // rejects: guessing a team by list order when none is chosen or personal
    expect(pickSignedInOrg([team], 'org_gone')).toBeNull();
  });

  test('the panel re-enters dusk, so its tokens match its navy paint', () => {
    // rejects: the Screens group and the sign-in words in --text = dark ink
    // on the panel's navy, under a light page (walk of dev 92f8b24d).
    const panel = fs.readFileSync(path.join(__dirname, '..', 'components', 'stage', 'SessionSetupPanel.jsx'), 'utf8');
    expect(panel).toMatch(/className=\{`setup-panel( smenu)?\$\{[^}]*\}`\}\s*data-theme="dark"/);
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.setup-panel__tabs \{[^}]*flex-wrap: wrap;/);
  });

  test('two screens is not private until the room\'s window is up', () => {
    // rejects: `privateScreen: twoSurfaces` alone — on two screens chosen with
    // no window open, the room may still be watching the laptop.
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/privateScreen: twoSurfaces && presenting > 0/);
  });
});

describe('Setup in the loop', () => {
  const strip = stripFor({
    gameType: 'call-and-answer', roundNoun: 'Round', hasQuestionSet: true, playerCount: 4,
    state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 1, pages: 6, ready: true }, asksReady: 3, totalRounds: 6,
  });
  const setup = strip.steps.find((s) => s.id === 'setup');

  test('shows the Screens group at the top, so screen mode changes from Setup', () => {
    const onChoose = jest.fn();
    const onAll = jest.fn();
    const { container } = render(
      <StepView
        step={setup}
        facts={{ title: 'Relay expansion', twoScreens: true, presenting: 1, playerCount: 4 }}
        screens={{ choice: 'two', offerChoice: true, onChoose, presentHref: '/present?gameId=1', presentDetail: null, profile: 'room', onProfileChange: () => {} }}
        onAllSettings={onAll}
      />,
    );
    const first = container.querySelector('.wfs-view-card > .scr');
    expect(first).toBeTruthy();
    fireEvent.click(within(first).getByRole('button', { name: 'One screen' }));
    expect(onChoose).toHaveBeenCalledWith('classic');
    fireEvent.click(screen.getByRole('button', { name: 'Session menu' }));
    expect(onAll).toHaveBeenCalled();
  });

  test('the host page hands Setup and the panel the lobby\'s chooser', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/onRoomScreenChange=\{chooseRoomScreen\}/);
    expect(page).toMatch(/screens=\{setupScreens\}/);
    expect(page).toMatch(/onChoose: chooseRoomScreen/);
  });
});

describe('help', () => {
  test('"Running it from your phone" says who may sign in, in the same words', () => {
    // eslint-disable-next-line global-require
    const help = require('../config/help').ROLE_BY_ID.host;
    const text = JSON.stringify(help);
    expect(text).toContain('any host or admin of that team');
    expect(text).toContain('Only your account can drive');
    expect(text).toContain('Your phone as a remote');
  });
});
