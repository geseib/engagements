/**
 * REMOTE SHARE, the host's side (docs/design/build-room-remote-share R1-R3;
 * owner 2026-10-16). One switch in the Share demo panel, off by default; who
 * opened it remotely, by name, with devices; starting and failed. The words
 * never say "tunnel".
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WifiChip, SharePanel } from '../buildroom/BuildWifiShare';
import {
  remoteState, remotePeople, wifiState, remoteWhere, personWhere,
} from '../buildroom/wifiShare';
import { W } from '../buildroom/words';

const NOW = '2026-10-16T12:00:00.000Z';
const LINK = 'http://192.168.1.20:4900/?k=KEY';
const WIFI = {
  wanted: true, status: 'live', open: 11, liveSince: '2026-10-16T11:50:00.000Z', offerDismissed: true,
  map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900', link: LINK }],
};
const remote = (over) => ({ ...WIFI, remote: { wanted: true, status: 'live', error: '', people: [], ...over } });
const PEOPLE = [
  { name: 'Sam Ortiz', devices: 2 }, { name: 'Priya N.', devices: 1 }, { name: 'Jordan Lee', devices: 1 },
  { name: 'Ana', devices: 1 }, { name: 'Marcus', devices: 1 },
];
const runNow = (fn) => fn();
const panel = (lan, api = { share: jest.fn(), playerRemoved: jest.fn() }) => {
  render(<SharePanel lan={lan} link={LINK} here={22} now={NOW} busy={false} run={runNow} api={api} onClose={() => {}} onShowWall={() => {}} />);
  return { api, d: screen.getByRole('dialog', { name: 'Share demo' }) };
};

describe('remoteState: what the host view says, in four words', () => {
  test('off unless sharing and remote are both wanted; the server\'s status otherwise', () => {
    expect(remoteState(WIFI)).toBe('off');
    expect(remoteState({ ...remote({}), wanted: false })).toBe('off');
    expect(remoteState(remote({ wanted: false }))).toBe('off');
    expect(remoteState(remote({ status: 'starting' }))).toBe('starting');
    expect(remoteState(remote({ status: 'live' }))).toBe('live');
    expect(remoteState(remote({ status: 'failed' }))).toBe('failed');
    expect(remoteState(remote({ status: 'off' }))).toBe('starting');
  });
  test('people only while live', () => {
    expect(remotePeople(remote({ people: PEOPLE }))).toHaveLength(5);
    expect(remotePeople(remote({ status: 'starting', people: PEOPLE }))).toEqual([]);
  });
});

describe('R1: the switch, off by default', () => {
  test('under the address: its words say who it reaches; on posts remote: true', () => {
    const { api, d } = panel({ ...WIFI, remote: { wanted: false, status: 'off', error: '', people: [] } });
    const sw = within(d).getByRole('switch', { name: W.remoteSwitch });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(within(d).getByText(W.remoteOffBody)).toBeInTheDocument();
    expect(within(d).getByText(/through Cloudflare, who can see it/)).toBeInTheDocument();
    fireEvent.click(sw);
    expect(api.share).toHaveBeenCalledWith({ remote: true });
  });
  test('a panel from a server that knows nothing of remote still offers the switch, off', () => {
    const { d } = panel(WIFI);
    expect(within(d).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
  test('Stop sharing still stops both (the server turns remote off with it)', () => {
    const { api, d } = panel(remote({ people: PEOPLE }));
    fireEvent.click(within(d).getByRole('button', { name: W.stopSharing }));
    expect(api.share).toHaveBeenCalledWith({ on: false });
  });
});

describe('R2: remote on, one count, who opened it', () => {
  test('the heading, one count (Wi-Fi plus remote people), and the chip agrees', () => {
    const lan = remote({ people: PEOPLE });
    const { d } = panel(lan);
    expect(within(d).getByRole('heading', { name: W.remoteLiveHead })).toBeInTheDocument();
    expect(within(d).getByText('16 opened it · 22 joined')).toBeInTheDocument();
    expect(within(d).queryByText(/here on Wi-Fi/)).toBeNull();
    render(<WifiChip lan={lan} now={NOW} onOpen={() => {}} open={false} />);
    expect(screen.getByRole('button', { name: 'Shared · 16 opened' })).toBeInTheDocument();
  });
  test('names in the server\'s order, three shown, then "and N more"; more than one device is marked', () => {
    const { d } = panel(remote({ people: PEOPLE }));
    const list = within(d).getByRole('list', { name: 'Who opened it remotely' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Sam Ortiz2 devicesRemove', 'Priya N.1 device', 'Jordan Lee1 device', 'and 2 more']);
    expect(rows[0]).toHaveClass('is-many');
    expect(rows[1]).not.toHaveClass('is-many');
  });
  test('Remove asks once, then takes the person out (which ends their key)', () => {
    const { api, d } = panel(remote({ people: PEOPLE }));
    fireEvent.click(within(d).getByRole('button', { name: 'Remove' }));
    expect(api.playerRemoved).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole('button', { name: 'Remove Sam Ortiz?' }));
    expect(api.playerRemoved).toHaveBeenCalledWith('Sam Ortiz', true);
  });
  test('the switch is on, with the live words; off posts remote: false', () => {
    const { api, d } = panel(remote({ people: PEOPLE }));
    const sw = within(d).getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(within(d).getByText(W.remoteLiveBody)).toBeInTheDocument();
    expect(within(d).getByText(W.remoteLiveSmall)).toBeInTheDocument();
    fireEvent.click(sw);
    expect(api.share).toHaveBeenCalledWith({ remote: false });
  });
  test('a wired laptop (no Wi-Fi share) with remote live: still shared, counted by remote people', () => {
    const lan = { ...remote({ people: PEOPLE.slice(0, 2) }), status: 'failed' };
    expect(wifiState(lan, NOW)).toMatchObject({ state: 'on', open: 2 });
  });
});

describe('R3: starting and failed', () => {
  test('starting: the switch is on and says what is happening', () => {
    const { d } = panel(remote({ status: 'starting' }));
    expect(within(d).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(d).getByRole('status')).toHaveTextContent(/downloads a tool from Cloudflare/);
    expect(within(d).getByRole('heading', { name: W.shareLiveHead })).toBeInTheDocument();
  });
  test('failed: the reason in plain words, and the Wi-Fi share is untouched', () => {
    const error = 'Cloudflare is not giving out new remote links from this network right now. Try again in a few minutes.';
    const { d } = panel(remote({ status: 'failed', error }));
    const row = within(d).getByTestId('brm-remote');
    expect(row).toHaveTextContent(W.remoteFailedHead);
    expect(row).toHaveTextContent(error);
    expect(row).toHaveTextContent(W.remoteWifiFine);
    expect(within(d).getByText('11 opened it · 22 here')).toBeInTheDocument();
  });
});

describe('the words', () => {
  test('nothing on screen says "tunnel"', () => {
    // A function's source carries its template, so its words are checked too.
    const all = Object.values(W).map((v) => String(v)).join('\n');
    expect(all).not.toMatch(/tunnel/i);
  });
});

describe('on this network or elsewhere (plugin 1.24.2; owner 21 Oct: "i cant tell who is connect local vs remote")', () => {
  const NEAR = [
    { name: 'Sam Ortiz', devices: 2, near: 1 }, { name: 'Priya N.', devices: 1, near: 1 }, { name: 'Joe', devices: 1, near: 0 },
  ];
  test('a person is on this network when any of their devices is; null when any person has no hint', () => {
    expect(remoteWhere(NEAR)).toEqual({ near: 2, away: 1 });
    expect(remoteWhere([{ name: 'A', devices: 1, near: null }])).toBeNull();
    expect(remoteWhere([])).toBeNull();
  });
  test('each row says where, in words; mixed devices are counted', () => {
    expect(NEAR.map(personWhere)).toEqual(['1 on this network, 1 elsewhere', 'on this network', 'elsewhere']);
    expect(personWhere({ name: 'A', devices: 1, near: null })).toBe('');
  });
  test('the panel: the counts beside who opened it, each row placed, and what "on this network" means', () => {
    const { d } = panel(remote({ people: NEAR }));
    expect(within(d).getByText(/2 on this network · 1 elsewhere/)).toBeInTheDocument();
    const list = within(d).getByRole('list', { name: 'Who opened it remotely' });
    expect(within(list).getByText('Joe').closest('li')).toHaveTextContent('elsewhere');
    expect(within(list).getByText('Priya N.').closest('li')).toHaveTextContent('on this network');
    expect(within(list).getByText(W.remoteWhereNote)).toBeInTheDocument();
  });
  test('an older plugin (no hint): nothing is said about where anyone is', () => {
    const { d } = panel(remote({ people: PEOPLE }));
    expect(d.textContent).not.toMatch(/on this network|elsewhere/);
  });
});
