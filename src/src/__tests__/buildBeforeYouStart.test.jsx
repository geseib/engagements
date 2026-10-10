/**
 * BEFORE YOU START (docs/design/build-room-before-you-start, owner 2026-10-10).
 *
 * 1. The public Build Room page carries a "Before you start" section: what the
 *    host's laptop needs, the steps in words, and what it writes on the laptop.
 *    NO install command (it is in a room's Connect window, signed in) and no
 *    time estimate. Every path follows the site's tier.
 * 2. Connect Claude Code, step 1, shows the plugin's version from room.plugin
 *    in three states: not yet known, up to date (command folded), out of date
 *    (Copy is the one orange).
 * 3. The New Build Room page says what the laptop needs, with a link.
 * 4. The empty room's first "How a Build Room works" step names the install.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import MarketingBuildRoomPage from '../marketing/BuildRoomPage';
import { BuildCreate, ConnectPanel, HOW_IT_WORKS } from '../buildroom/BuildRoomPage';
import { W } from '../buildroom/words';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    isConnected: jest.fn(() => false),
    ensureConnected: jest.fn(),
  },
}));

afterEach(() => { window.ENV = 'test'; });

const section = () => document.getElementById('before-you-start');

describe('the public page: Before you start', () => {
  test('replaces "What you need" with the section the create page links to', () => {
    render(<MarketingBuildRoomPage />);
    const s = section();
    expect(s).not.toBeNull();
    expect(within(s).getByText('Before you start')).toBeInTheDocument();
    expect(within(s).getByRole('heading', { name: "Set up the host's laptop once." })).toBeInTheDocument();
    expect(screen.queryByText('What you need', { selector: '.mk-kicker' })).toBeNull();
  });

  test('lists what the laptop needs', () => {
    render(<MarketingBuildRoomPage />);
    const needs = [...section().querySelectorAll('.mk-bys-need b')].map((n) => n.textContent);
    expect(needs).toEqual([
      'Claude Code, installed and signed in',
      'Node 18 or later',
      'Git',
      'A terminal on that laptop',
    ]);
  });

  test('the steps are words: no install command, and it says where the command is', () => {
    render(<MarketingBuildRoomPage />);
    const s = section();
    const titles = [...s.querySelectorAll('.mk-bys-steps h4')].map((n) => n.textContent);
    expect(titles).toEqual(['Create a room', 'Install the Engage plugin', 'Paste the start command']);
    expect(s.textContent).not.toMatch(/curl|--install-plugin|mkdir -p/);
    expect(s.querySelector('pre')).toBeNull();
    expect(s.textContent).toMatch(/Connect Claude Code window once you.re signed in/);
    expect(within(s).getByRole('link', { name: 'Read the file first' })).toHaveAttribute('href', '/engage-mcp.mjs');
  });

  test('no time estimate', () => {
    render(<MarketingBuildRoomPage />);
    expect(section().textContent).not.toMatch(/minute/i);
  });

  test.each([
    ['production', '~/.engage/claude-plugin/', '~/.engage/config.json', '/engage:kickoff'],
    ['development', '~/.engage/claude-plugin-dev/', '~/.engage/config-dev.json', '/engage-dev:kickoff'],
    ['test', '~/.engage/claude-plugin-test/', '~/.engage/config-test.json', '/engage-test:kickoff'],
  ])('what it changes on the laptop follows the site (%s)', (env, plugin, config, kickoff) => {
    window.ENV = env;
    render(<MarketingBuildRoomPage />);
    const paths = [...section().querySelectorAll('.mk-bys-chg dt')].map((n) => n.textContent);
    expect(paths).toEqual([
      '~/.engage-mcp.mjs', plugin, config, "Claude Code's plugin list",
      '~/build-room/<name>/', '<name>/.engage/', '<name>/.claude/settings.local.json',
    ]);
    expect(section().textContent).toContain(kickoff);
    expect(section().textContent).toMatch(/Nothing else\./);
  });

  test('the marketing page does not pull in the host bundle', () => {
    const src = fs.readFileSync(path.join(__dirname, '../marketing/BuildRoomPage.jsx'), 'utf8');
    expect(src).not.toMatch(/buildHostApi|buildroom\/BuildRoomPage/);
  });

  test('arriving at #before-you-start scrolls the section into view', () => {
    const spy = jest.fn();
    const proto = window.HTMLElement.prototype;
    const before = proto.scrollIntoView;
    proto.scrollIntoView = spy;
    window.history.replaceState(null, '', '/build-room#before-you-start');
    try {
      render(<MarketingBuildRoomPage />);
      expect(spy).toHaveBeenCalled();
    } finally {
      proto.scrollIntoView = before;
      window.history.replaceState(null, '', '/');
    }
  });
});

describe('Connect Claude Code, step 1: the plugin version', () => {
  const panel = (room, props = {}) => render(
    <ConnectPanel
      room={{ settings: {}, title: 'Food bank', ...room }}
      gameId="4821"
      api={{ mintKey: jest.fn(), revokeKey: jest.fn(), saveSettings: jest.fn() }}
      run={(fn) => fn()}
      busy={false}
      onClose={() => {}}
      {...props}
    />,
  );
  const step1 = () => document.querySelector('[data-step="install"]');
  const primaries = () => document.querySelectorAll('.brm-modal .brm-btn--primary');

  test('not yet known: the latest only, the command shown, Mint stays the one orange', () => {
    panel({ agent: {}, plugin: { running: '', latest: '1.16.0', outdated: false } });
    const s = step1();
    expect(s.querySelector('.brm-step-title').textContent).toBe(W.pluginCheckTitle);
    const ver = within(s).getByTestId('brm-ver');
    expect(ver.textContent).toBe(`${W.pluginLatest} 1.16.0${W.pluginUnknown}`);
    expect(within(s).getByTestId('brm-install')).toBeInTheDocument();
    expect(s.querySelector('details')).toBeNull();
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0].textContent).toMatch(/Mint a key/);
  });

  test('up to date: a green tick, the version, the command folded, no orange', () => {
    panel({ agent: { lastSeenAt: new Date().toISOString() }, plugin: { running: '1.16.0', latest: '1.16.0', outdated: false } });
    const s = step1();
    expect(s.className).toContain('is-done');
    expect(within(s).getByTestId('brm-ver').textContent).toBe(`${W.pluginRunning} 1.16.0${W.pluginCurrent}`);
    const fold = s.querySelector('details');
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary').textContent).toBe(W.installElsewhere);
    expect(within(fold).getByTestId('brm-install')).toBeInTheDocument();
    expect(primaries()).toHaveLength(0);
  });

  test('out of date: the title changes, both versions show, Copy is the one orange', () => {
    panel({ agent: { lastSeenAt: new Date().toISOString() }, plugin: { running: '1.15.0', latest: '1.16.0', outdated: true } });
    const s = step1();
    expect(s.className).toContain('is-old');
    expect(s.querySelector('.brm-step-title').textContent).toBe(W.pluginUpdateTitle);
    const ver = within(s).getByTestId('brm-ver');
    expect(ver.textContent).toBe(`${W.pluginRunning} 1.15.0·${W.pluginLatest} 1.16.0`);
    expect(ver.querySelector('.brm-ver-old').textContent).toBe('1.15.0');
    expect(primaries()).toHaveLength(1);
    expect(s.contains(primaries()[0])).toBe(true);
    expect(primaries()[0].textContent).toMatch(/Copy/);
    expect(within(s).getByText(W.pluginRerun)).toBeInTheDocument();
  });

  test('out of date without a version: "older than" the latest', () => {
    panel({ agent: { lastSeenAt: new Date().toISOString() }, plugin: { running: '', latest: '1.16.0', outdated: true } });
    expect(within(step1()).getByTestId('brm-ver').textContent).toBe(`${W.pluginRunning} ${W.pluginOlder('1.16.0')}`);
  });

  test('opened from Update: focus lands on the orange Copy', () => {
    panel({ agent: { lastSeenAt: new Date().toISOString() }, plugin: { running: '1.15.0', latest: '1.16.0', outdated: true } }, { atInstall: true });
    expect(document.activeElement).toBe(primaries()[0]);
  });

  test('the command is the tier\'s own', () => {
    window.ENV = 'development';
    panel({ agent: {}, plugin: { running: '', latest: '1.16.0', outdated: false } });
    expect(within(step1()).getByTestId('brm-install').textContent).toMatch(/--tier dev$/);
  });
});

describe('the New Build Room page and the empty room', () => {
  test('one line says what the laptop needs, linking to Before you start', () => {
    render(<BuildCreate navigate={jest.fn()} />);
    expect(document.querySelector('.brm-needline').textContent).toContain(W.needLine);
    expect(screen.getByRole('link', { name: W.beforeYouStart })).toHaveAttribute('href', '/build-room#before-you-start');
  });

  test('step 1 of How a Build Room works names the install', () => {
    expect(HOW_IT_WORKS[0]).toBe('Connect Claude Code: install the plugin, then paste one command.');
  });
});
