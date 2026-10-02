/**
 * BUILD ROOM SCREENSHOTS — a mockup on its option (host, wall and phone), the
 * finished product under What we built, and all of it in the report.
 *
 * Fixtures come from the real build-store.js views (roomFromRows → publicView /
 * hostView), never hand-shaped, so a change to the server's shape breaks these.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import BuildImage, { ImageLoader } from '../buildroom/BuildImage';
import BuildPlayer from '../buildroom/BuildPlayer';
import BuildReport from '../buildroom/BuildReport';

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();

const CHOICE = {
  SK: 'BUILD#ASK#003', AskId: '003', Kind: 'choice', Prompt: 'Which header?', Detail: '',
  Options: [
    { label: 'A', title: 'Bold banner', detail: '', url: 'http://localhost:5173/a' },
    { label: 'B', title: 'Calm photo', detail: '', url: 'http://localhost:5173/b' },
  ],
  MaxPicks: 1, Status: 'live', Source: 'agent', CreatedAt: NOW,
};
const img = (id, over) => ({ SK: `BUILD#IMG#000000000000${id}#x`, ImageId: id, ContentType: 'image/png', Bytes: 900, Kind: 'mockup', By: 'agent', CreatedAt: NOW, ...over });
const ROWS = [
  { SK: 'BUILD#STATE', Rev: 3, CurrentAskId: '003', Outcome: { summary: 'A sign-up site.', built: ['Form'], links: [], nextSteps: [], by: 'agent', updatedAt: NOW } },
  CHOICE,
  img('aaa', { AskId: '003', Label: 'A', Caption: 'Choice A' }),
  img('fff', { Kind: 'final', Caption: 'The finished page' }),
  img('ppp', { Kind: 'progress', Caption: 'Halfway' }),
];
const CHECK = { SK: 'BUILD#LOG#0000000000009#c1', LogId: '9-c1', Kind: 'checkpoint', Text: 'Header B, as the room chose', Detail: 'commit 3b70a8c · 2 files', By: 'agent', CreatedAt: NOW };
const room = () => S.roomFromRows([...ROWS, CHECK]);

test('BuildImage shows what its surface loader returns, and opens full size in a new tab', async () => {
  render(
    <ImageLoader.Provider value={(id) => Promise.resolve(`blob:test/${id}`)}>
      <BuildImage imageId="aaa" caption="Choice A" />
    </ImageLoader.Provider>,
  );
  const pic = await screen.findByRole('img', { name: 'Choice A' });
  expect(pic).toHaveAttribute('src', 'blob:test/aaa');
  expect(pic.closest('a')).toHaveAttribute('target', '_blank');
  expect(screen.getByText('Choice A').tagName).toBe('FIGCAPTION');
});

test('BuildImage draws nothing when the image cannot be read', async () => {
  const { container } = render(
    <ImageLoader.Provider value={() => Promise.reject(new Error('403'))}>
      <BuildImage imageId="zzz" caption="Gone" />
    </ImageLoader.Provider>,
  );
  await waitFor(() => expect(container.querySelector('figure')).toBeNull());
});

describe('on the phone', () => {
  beforeEach(() => {
    const view = S.publicView({ gameId: GAME, meta: { Title: 'Sign-up', Details: 'Goal' }, sessionState: 'STARTED', room: room(), players: ['Priya'], me: { playerName: 'Priya' }, now: NOW });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => view }));
  });

  test('a mockup sits on its option, read through this phone\'s own seat', async () => {
    render(<BuildPlayer gameId={GAME} playerName="Priya" clientId="cid-1" apiBase={API} rev={0} />);
    const pic = await screen.findByRole('img', { name: 'Choice A: Bold banner' });
    expect(pic.getAttribute('src')).toBe(`${API}games/${GAME}/build-play/images/aaa?playerName=Priya&clientId=cid-1`);
    // The laptop's localhost is not offered to a phone.
    expect(screen.queryByRole('link', { name: /Open preview/ })).toBeNull();
  });
});

describe('in the report', () => {
  const state = () => ({
    ...S.hostView({ gameId: GAME, meta: { Title: 'Sign-up', Details: 'Goal' }, sessionState: 'ENDED', room: room(), players: ['Priya'], now: NOW }),
    asks: S.hostView({ gameId: GAME, meta: {}, sessionState: 'ENDED', room: S.roomFromRows(ROWS.map((r) => (r.SK === CHOICE.SK ? { ...r, Status: 'decided', Decision: { direction: 'Go with A', chosen: ['A'] }, DecidedAt: NOW } : r))), players: [], now: NOW }).asks,
  });
  const loader = (id) => Promise.resolve(`blob:test/${id}`);

  test('the finished product under What we built, mockups on their decision, the rest along the way', async () => {
    render(<ImageLoader.Provider value={loader}><BuildReport state={state()} /></ImageLoader.Provider>);
    const built = screen.getByRole('region', { name: 'What we built' });
    expect(await within(built).findByRole('img', { name: 'The finished page' })).toHaveAttribute('src', 'blob:test/fff');
    const decisions = screen.getByRole('region', { name: 'Decisions' });
    expect(await within(decisions).findByRole('img', { name: 'Choice A: Bold banner' })).toHaveAttribute('src', 'blob:test/aaa');
    const along = screen.getByRole('region', { name: 'Screenshots along the way' });
    expect(await within(along).findAllByRole('img')).toHaveLength(1);
    // Each checkpoint is a row in the version history: its commit and what changed.
    const versions = screen.getByRole('region', { name: 'Version history' });
    expect(within(versions).getByText('3b70a8c')).toBeInTheDocument();
    expect(within(versions).getByText('Header B, as the room chose')).toBeInTheDocument();
    // An image entry on the timeline never prints its id.
    expect(screen.queryByText('aaa')).toBeNull();
  });
});
