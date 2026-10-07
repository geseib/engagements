import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WifiChip, WifiPanel, WifiOffer, WallBuildQr, wifiLink } from '../buildroom/BuildWifiShare';

const NOW = '2026-10-07T12:00:00.000Z';
const LIVE = {
  wanted: true, status: 'live', open: 9, liveSince: '2026-10-07T11:50:00.000Z', offerDismissed: true,
  map: [
    { local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900', link: 'http://192.168.1.20:4900/?k=KEY' },
    { local: 'http://localhost:5174', lan: 'http://192.168.1.20:4901', link: 'http://192.168.1.20:4901/?k=KEY' },
  ],
};
const runNow = (fn) => fn();

test('the chip reads the state and opens the panel', () => {
  const onOpen = jest.fn();
  render(<WifiChip lan={LIVE} now={NOW} onOpen={onOpen} open={false} />);
  const chip = screen.getByRole('button', { name: /Wi-Fi · On · 9 open/ });
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalled();
});

test('the panel lists each address, says who can open it, and turns sharing off', () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  render(<WifiPanel lan={LIVE} now={NOW} busy={false} run={runNow} api={api} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/Anyone on this Wi-Fi with the link can open the app Claude is running/)).toBeInTheDocument();
  expect(screen.getByText('http://192.168.1.20:4900')).toBeInTheDocument();
  expect(screen.getByText('http://192.168.1.20:4901')).toBeInTheDocument();
  expect(screen.getByText(/devices opened it in the last 5 minutes/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: /Share on this Wi-Fi/ }));
  expect(api.share).toHaveBeenCalledWith({ on: false });
});

test('the key is never shown as text, only copied', () => {
  render(<WifiPanel lan={LIVE} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.queryByText(/k=KEY/)).toBeNull();
});

test('none open yet: the panel says the Wi-Fi may keep devices apart, and names the VPN case', () => {
  const quiet = { ...LIVE, open: 0, liveSince: '2026-10-07T11:55:00.000Z' };
  render(<WifiPanel lan={quiet} now={NOW} busy={false} run={runNow} api={{ share: jest.fn() }} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/keep devices apart/)).toBeInTheDocument();
  expect(screen.getByText(/laptops not on a work VPN/)).toBeInTheDocument();
});

test("didn't start: the reason, and Try again", () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  const failed = { wanted: true, status: 'failed', error: 'No Wi-Fi address on this laptop. It may be on a wired network only, or offline.', map: [] };
  render(<WifiPanel lan={failed} now={NOW} busy={false} run={runNow} api={api} onClose={() => {}} onShowWall={() => {}} />);
  expect(screen.getByText(/No Wi-Fi address on this laptop/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(api.share).toHaveBeenCalledWith({ on: true });
});

test('the offer turns it on, or is dismissed for the session', () => {
  const api = { share: jest.fn().mockResolvedValue({}) };
  render(<WifiOffer busy={false} run={runNow} api={api} />);
  expect(screen.getByText('Let the room open it themselves?')).toBeInTheDocument();
  expect(screen.getByText(/on a phone, laptop or tablet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Share on this Wi-Fi' }));
  expect(api.share).toHaveBeenCalledWith({ on: true });
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(api.share).toHaveBeenCalledWith({ dismissOffer: true });
});

test('the wall says laptops, tablets and phones, never phones only', () => {
  render(<WallBuildQr link="http://192.168.1.20:4900/?k=KEY" onClose={() => {}} />);
  expect(screen.getByText('Open the build yourself')).toBeInTheDocument();
  expect(screen.getByText(/On your phone, laptop or tablet/)).toBeInTheDocument();
  expect(screen.queryByText(/on your phone\b(?!, laptop)/i)).toBeNull();
});

test('the QR encodes the address for the newest app Claude showed', () => {
  const room = { lan: LIVE, log: [{ by: 'agent', link: 'http://localhost:5173/' }, { by: 'agent', link: 'http://localhost:5174/b' }] };
  expect(wifiLink(room)).toBe('http://192.168.1.20:4901/?k=KEY');
});

test('the wall QR has a real X and a Close at the bottom', () => {
  const onClose = jest.fn();
  render(<WallBuildQr link="http://192.168.1.20:4900/?k=KEY" onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close the QR' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
