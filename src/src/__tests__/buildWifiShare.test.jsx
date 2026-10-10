/**
 * SHARE DEMO (docs/design/build-room-share-demo, D1-D6; owner 2026-10-10).
 * The chip, its panel in each state, the nudge on the Host screen, the Stage
 * card and the Build screen's card. "Demo" is what the Wi-Fi shares; "build"
 * is the host's own laptop link.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WifiChip, SharePanel, ShareDemo, DemoNudge, WallBuildQr, BuildScreenQr, wifiLink } from '../buildroom/BuildWifiShare';

const NOW = '2026-10-07T12:00:00.000Z';
const LINK = 'http://192.168.1.20:4900/?k=KEY';
const LIVE = {
  wanted: true, status: 'live', open: 11, liveSince: '2026-10-07T11:50:00.000Z', offerDismissed: true,
  map: [
    { local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900', link: LINK },
  ],
};
const OFF = { wanted: false, status: 'off', offerDismissed: false, map: [] };
const QUIET = { ...LIVE, open: 0, liveSince: '2026-10-07T11:55:00.000Z' };
const runNow = (fn) => fn();
const panel = (props) => render(
  <SharePanel lan={LIVE} link={LINK} here={18} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onClose={() => {}} onShowWall={() => {}} {...props} />,
);

describe('the chip says what is happening (D2 quiet, the strip of states)', () => {
  test('off reads Share demo; live counts who opened it', () => {
    const { rerender } = render(<WifiChip lan={OFF} now={NOW} onOpen={() => {}} open={false} />);
    expect(screen.getByRole('button', { name: 'Share demo' })).toHaveClass('brm-wifi--off');
    rerender(<WifiChip lan={LIVE} now={NOW} onOpen={() => {}} open={false} />);
    expect(screen.getByRole('button', { name: 'Shared · 11 opened' })).toHaveClass('brm-wifi--on');
    rerender(<WifiChip lan={QUIET} now={NOW} onOpen={() => {}} open={false} />);
    expect(screen.getByRole('button', { name: 'Shared · none opened yet' })).toHaveClass('brm-wifi--quiet');
  });
});

describe('the panel (D1 B, D2, D2 quiet)', () => {
  test('off: the nudge words, Not now and Share demo, Share demo last', () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    const onClose = jest.fn();
    panel({ lan: OFF, link: '', api, onClose, offer: true });
    const d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Let everyone try it.')).toBeInTheDocument();
    expect(within(d).getByText('Share this demo with people on your Wi-Fi.')).toBeInTheDocument();
    expect(within(d).getByText("People on this Wi-Fi can open this laptop's app. No one else can.")).toBeInTheDocument();
    const foot = [...d.querySelectorAll('.brm-wifipanel-foot button')];
    expect(foot.map((b) => b.textContent)).toEqual(['Not now', 'Share demo']);
    expect(foot[1]).toHaveClass('brm-btn--primary');
    expect(d.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    fireEvent.click(foot[1]);
    expect(api.share).toHaveBeenCalledWith({ on: true });
    fireEvent.click(foot[0]);
    expect(api.share).toHaveBeenCalledWith({ dismissOffer: true });
    expect(onClose).toHaveBeenCalled();
  });

  test('off after Not now: the same words; Not now only closes it', () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    const onClose = jest.fn();
    panel({ lan: { ...OFF, offerDismissed: true }, link: '', api, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(api.share).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('live: how many opened it against who is here, the address without its key, Stop sharing and Show on the Stage', () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    const onShowWall = jest.fn();
    panel({ api, onShowWall });
    const d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Demo shared on this Wi-Fi')).toBeInTheDocument();
    expect(d.querySelector('.brm-wifipanel-stat').textContent).toBe('11 opened it · 18 here');
    expect(within(d).getByText('192.168.1.20:4900')).toBeInTheDocument();
    expect(within(d).getByText('People on this Wi-Fi can open it. No one else can.')).toBeInTheDocument();
    expect(within(d).getByText('Not 11 of 18? Some people may be on mobile data or a VPN. They still see screenshots.')).toBeInTheDocument();
    // The key is only in the QR and what Copy copies, never in the words.
    expect(d.querySelector('.brm-wifipanel-u').textContent).not.toMatch(/k=/);
    const foot = [...d.querySelectorAll('.brm-wifipanel-foot button')];
    expect(foot.map((b) => b.textContent)).toEqual(['Stop sharing', 'Show on the Stage']);
    expect(foot[1]).toHaveClass('brm-btn--primary');
    fireEvent.click(foot[1]);
    expect(onShowWall).toHaveBeenCalled();
    fireEvent.click(foot[0]);
    expect(api.share).toHaveBeenCalledWith({ on: false });
  });

  test('live and everyone here opened it: no "Not n of m" line', () => {
    panel({ here: 11 });
    expect(screen.queryByText(/^Not 11 of/)).toBeNull();
  });

  test('nobody can reach it: what to try, the words already in words.js, Stop sharing becomes the primary', () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    panel({ lan: QUIET, api });
    const d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(within(d).getByText('Nobody has opened it in 2 minutes.')).toBeInTheDocument();
    expect(within(d).getByText(/Guest Wi-Fi often blocks this\./)).toBeInTheDocument();
    expect(within(d).getByText('Test it: scan the QR from another device.')).toBeInTheDocument();
    expect(within(d).getByText('Same Wi-Fi; no mobile data, no VPN.')).toBeInTheDocument();
    expect(within(d).getByText('If it fails for you, it fails for the room. Use screenshots.')).toBeInTheDocument();
    const foot = [...d.querySelectorAll('.brm-wifipanel-foot button')];
    expect(foot.map((b) => b.textContent)).toEqual(['Keep sharing', 'Stop sharing']);
    expect(foot[1]).toHaveClass('brm-btn--primary');
    fireEvent.click(foot[1]);
    expect(api.share).toHaveBeenCalledWith({ on: false });
  });

  test("didn't start: the reason, and Try again", () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    panel({ lan: { wanted: true, status: 'failed', error: 'No Wi-Fi address on this laptop.', map: [] }, link: '', api });
    expect(screen.getByText(/No Wi-Fi address on this laptop\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.share).toHaveBeenCalledWith({ on: true });
  });

  test('waiting: Claude Code has not answered, and what to do', () => {
    panel({ lan: { wanted: true, status: 'starting', wantedAt: '2026-10-07T11:59:00.000Z', reportedAt: null, map: [] }, link: '' });
    expect(screen.getByRole('dialog').textContent).toContain('Claude Code has not answered. Update the plugin, then restart it.');
  });

  test('a real X and a bottom exit', () => {
    const onClose = jest.fn();
    panel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('inline (Session, Settings): no X, Share demo starts it, nothing is asked again', () => {
    const api = { share: jest.fn().mockResolvedValue({}) };
    panel({ lan: { ...OFF, offerDismissed: true }, link: '', api, inline: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share demo' }));
    expect(api.share).toHaveBeenCalledWith({ on: true });
  });
});

describe('the chip and its popover', () => {
  test('the chip opens the panel; Escape closes it', () => {
    render(<ShareDemo lan={LIVE} link={LINK} here={18} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onShowWall={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('brm-wifi'));
    expect(screen.getByRole('dialog', { name: 'Share demo' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('the nudge hangs open from the chip; its X folds it back into the chip', () => {
    render(<ShareDemo lan={OFF} link="" here={18} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onShowWall={() => {}} nudge />);
    expect(screen.getByRole('dialog', { name: 'Share demo' })).toBeInTheDocument();
    expect(screen.getByTestId('brm-wifi')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Share demo' })).toBeInTheDocument();
  });
});

test('the nudge on the Host screen (D1 A): the words, the picture, Not now, Share demo last', () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  render(<DemoNudge busy={false} run={runNow} api={api} picture={<img alt="The first board" />} />);
  const card = screen.getByRole('region', { name: 'Share demo' });
  expect(within(card).getByText('Let everyone try it.')).toBeInTheDocument();
  expect(within(card).getByText('Share this demo with people on your Wi-Fi.')).toBeInTheDocument();
  expect(within(card).getByRole('img', { name: 'The first board' })).toBeInTheDocument();
  expect(within(card).getByText("People on this Wi-Fi can open this laptop's app. No one else can.")).toBeInTheDocument();
  const buttons = within(card).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Not now', 'Share demo']);
  expect(buttons[1]).toHaveClass('brm-btn--primary');
  fireEvent.click(buttons[1]);
  expect(api.share).toHaveBeenCalledWith({ on: true });
  fireEvent.click(buttons[0]);
  expect(api.share).toHaveBeenCalledWith({ dismissOffer: true });
});

describe('the Stage while shared (D4)', () => {
  test('the QR, three short lines and the count; no device and no name; Hide the code', () => {
    const onClose = jest.fn();
    render(<WallBuildQr link={LINK} open={11} onClose={onClose} />);
    const d = screen.getByRole('dialog', { name: 'Try the demo yourself' });
    expect(within(d).getByText('The demo is live')).toBeInTheDocument();
    expect(within(d).getByText('Scan the code, or press Open the demo.')).toBeInTheDocument();
    expect(within(d).getByText('Same Wi-Fi as this laptop.')).toBeInTheDocument();
    expect(within(d).getByText('11 have opened it')).toBeInTheDocument();
    expect(within(d).queryByText(/phone|tablet/i)).toBeNull();
    // Every line the room reads is 12 words or fewer.
    [...d.querySelectorAll('h2, p, span')].forEach((el) => expect(el.textContent.trim().split(/\s+/).length).toBeLessThanOrEqual(12));
    const hide = within(d).getByRole('button', { name: 'Hide the code' });
    expect(hide).toHaveClass('brm-btn--primary');
    fireEvent.click(hide);
    fireEvent.click(within(d).getByRole('button', { name: 'Close the QR' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('one person: "1 has opened it"', () => {
    render(<WallBuildQr link={LINK} open={1} onClose={() => {}} />);
    expect(screen.getByText('1 has opened it')).toBeInTheDocument();
  });
});

test('the Build screen card while shared (D6): the QR and the count', () => {
  render(<BuildScreenQr link={LINK} open={11} />);
  expect(screen.getByText('Try the demo yourself')).toBeInTheDocument();
  expect(screen.getByText('Same Wi-Fi only · 11 have opened it')).toBeInTheDocument();
});

test('the QR encodes the address for the newest app Claude showed', () => {
  const two = { ...LIVE, map: [...LIVE.map, { local: 'http://localhost:5174', lan: 'http://192.168.1.20:4901', link: 'http://192.168.1.20:4901/?k=KEY' }] };
  const room = { lan: two, log: [{ by: 'agent', link: 'http://localhost:5173/' }, { by: 'agent', link: 'http://localhost:5174/b' }] };
  expect(wifiLink(room)).toBe('http://192.168.1.20:4901/?k=KEY');
});
