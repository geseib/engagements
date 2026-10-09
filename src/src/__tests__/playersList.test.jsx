/**
 * THE SHARED PLAYERS LIST (components/stage/PlayersList.jsx).
 *
 * Extracted from SessionSetupPanel's Players tab for the Build Room's Session
 * panel. Two promises: the other engagements' tab behaves exactly as before
 * (rosterHostActions / sessionSetupPanel stay green, and the first section
 * here pins the rendered shape), and the new surface gets what the Build Room
 * needs — the asker on top, Lock again, Not now, a right-hand column of its
 * own, and search and filters once a room passes twelve.
 *
 * No geometry: jsdom resolves no layout. What is testable is order, names,
 * handlers and the absence of controls whose handler was not given.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import PlayersList from '../components/stage/PlayersList';
import { rosterRows, departedRows } from '../config/setupPanel';

const rows = (list) => rosterRows({ players: list });
const names = () => screen.getAllByTestId('roster-name').map((n) => n.textContent);
const rowFor = (name) => screen.getAllByTestId('roster-row').find(
  (r) => within(r).getByTestId('roster-name').textContent === name
);

const many = (n) => Array.from({ length: n }, (_, i) => ({
  name: `P${String(i).padStart(2, '0')}`, score: n - i,
}));

describe('as the other engagements use it', () => {
  test('a row is rank, name, the caller\'s column, then Unlock name and Remove', () => {
    render(
      <PlayersList
        rows={rows([{ name: 'Ada', score: 3 }])}
        searchAfter={Infinity}
        renderExtra={(p) => <span data-testid="roster-score">{`${p.score} pts`}</span>}
      />
    );
    const row = rowFor('Ada');
    expect(row.querySelector('.setup-roster__rank').textContent).toBe('1');
    expect(within(row).getByTestId('roster-score').textContent).toBe('3 pts');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Unlock name', 'Remove']);
    expect(screen.getByRole('heading', { name: '1 player' })).toBeInTheDocument();
  });

  test('no handler, no button: Lock again and Not now only exist when wired', () => {
    render(
      <PlayersList
        rows={rows([{ name: 'Ada', score: 1, handover: { open: true, requested: true } }])}
        searchAfter={Infinity}
      />
    );
    expect(screen.queryByRole('button', { name: 'Lock again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  test('a room over twelve gets no search box when the caller keeps it off', () => {
    render(<PlayersList rows={rows(many(20))} searchAfter={Infinity} />);
    expect(screen.queryByTestId('players-find')).toBeNull();
    expect(screen.getAllByTestId('roster-row')).toHaveLength(20);
  });

  test('Unlock name and Let them take it both go to onGrant with whether somebody asked', () => {
    const onGrant = jest.fn();
    render(
      <PlayersList
        rows={rows([
          { name: 'Ada', score: 2 },
          { name: 'Joe', score: 1, handover: { requested: true } },
        ])}
        onGrant={onGrant}
      />
    );
    fireEvent.click(within(rowFor('Ada')).getByRole('button', { name: 'Unlock name' }));
    fireEvent.click(within(rowFor('Joe')).getByRole('button', { name: 'Let them take it' }));
    expect(onGrant.mock.calls).toEqual([['Ada', false], ['Joe', true]]);
  });

  test('Remove and Bring back call out with the name; the removed list stays separate', () => {
    const onRemove = jest.fn();
    const onRestore = jest.fn();
    render(
      <PlayersList
        rows={rows([{ name: 'Ada', score: 2 }])}
        departed={departedRows([{ playerName: 'Kit', totalScore: 5 }])}
        onRemove={onRemove}
        onRestore={onRestore}
        renderExtra={(p, gone) => <span>{`${p.score} pts${gone ? ' gone' : ''}`}</span>}
      />
    );
    fireEvent.click(within(rowFor('Ada')).getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('Ada');
    const gone = screen.getByTestId('departed-row');
    expect(within(gone).getByTestId('departed-name').textContent).toBe('Kit');
    expect(gone.textContent).toContain('5 pts gone');
    fireEvent.click(within(gone).getByRole('button', { name: 'Bring back' }));
    expect(onRestore).toHaveBeenCalledWith('Kit');
    expect(screen.getByTestId('departed-heading').textContent).toBe('1 removed from the room');
  });

  test('says so when nobody has joined, and still lists the removed', () => {
    render(<PlayersList rows={[]} departed={departedRows([{ playerName: 'Kit' }])} />);
    expect(screen.getByText('Nobody has joined yet.')).toBeInTheDocument();
    expect(screen.getAllByTestId('departed-row')).toHaveLength(1);
  });
});

describe('Lock again and Not now', () => {
  test('Lock again appears on an unlocked name and calls onLock', () => {
    const onLock = jest.fn();
    render(
      <PlayersList
        rows={rows([{ name: 'Lena', handover: { open: true } }, { name: 'Amir' }])}
        onLock={onLock}
      />
    );
    expect(within(rowFor('Amir')).queryByRole('button', { name: 'Lock again' })).toBeNull();
    const lena = rowFor('Lena');
    expect(within(lena).getByTestId('handover-flag').textContent).toBe('unlocked for one handover');
    fireEvent.click(within(lena).getByRole('button', { name: 'Lock again' }));
    expect(onLock).toHaveBeenCalledWith('Lena');
  });

  test('Not now appears next to Let them take it, only while somebody is asking', () => {
    const onRefuse = jest.fn();
    render(
      <PlayersList
        rows={rows([{ name: 'Joe', handover: { requested: true } }, { name: 'Amir' }])}
        onRefuse={onRefuse}
      />
    );
    expect(within(rowFor('Amir')).queryByRole('button', { name: 'Not now' })).toBeNull();
    const joe = rowFor('Joe');
    expect(within(joe).getByTestId('handover-flag').textContent).toBe('asking to take this name');
    fireEvent.click(within(joe).getByRole('button', { name: 'Not now' }));
    expect(onRefuse).toHaveBeenCalledWith('Joe');
  });

  test('onUnlock, when given, is the open unlock; the asker still goes to onGrant', () => {
    const onUnlock = jest.fn();
    const onGrant = jest.fn();
    render(
      <PlayersList
        rows={rows([{ name: 'Amir' }, { name: 'Joe', handover: { requested: true } }])}
        onUnlock={onUnlock}
        onGrant={onGrant}
      />
    );
    fireEvent.click(within(rowFor('Amir')).getByRole('button', { name: 'Unlock name' }));
    fireEvent.click(within(rowFor('Joe')).getByRole('button', { name: 'Let them take it' }));
    expect(onUnlock).toHaveBeenCalledWith('Amir');
    expect(onGrant).toHaveBeenCalledWith('Joe', true);
  });
});

describe('the Build Room shape', () => {
  test('sorted by name, with the asker on top and outside the order', () => {
    render(
      <PlayersList
        rows={rows([
          { name: 'Zed' }, { name: 'Amir' },
          { name: 'Joe', handover: { requested: true } },
        ])}
        sortBy="name"
        askingFirst
        showRank={false}
      />
    );
    expect(screen.getByTestId('asking-heading').textContent).toBe('Asking to take a name');
    const asking = within(screen.getByTestId('asking-list'));
    expect(asking.getAllByTestId('roster-name').map((n) => n.textContent)).toEqual(['Joe']);
    // Everyone is still counted in the room; the asker is not listed twice.
    expect(names()).toEqual(['Joe', 'Amir', 'Zed']);
    expect(screen.getByRole('heading', { name: '3 players' })).toBeInTheDocument();
    expect(document.querySelector('.setup-roster__rank')).toBeNull();
  });

  test('a badge and a second line stack under the name; the name cell stays the name', () => {
    render(
      <PlayersList
        rows={rows([{ name: 'Priya' }])}
        renderBadge={() => <span data-testid="badge">Builder</span>}
        renderMeta={(p, gone) => `${gone ? 'Removed' : 'Here'} · 2 ideas`}
      />
    );
    const row = rowFor('Priya');
    expect(within(row).getByTestId('roster-name').textContent).toBe('Priya');
    expect(within(row).getByTestId('badge').textContent).toBe('Builder');
    expect(row.textContent).toContain('Here · 2 ideas');
  });

  test('count label and summary line are the caller\'s words', () => {
    render(
      <PlayersList
        rows={rows([{ name: 'A' }, { name: 'B' }])}
        countLabel={(n) => `${n} in the room`}
        summary="1 here · 1 away"
        searchAfter={Infinity}
      />
    );
    expect(screen.getByRole('heading', { name: '2 in the room' })).toBeInTheDocument();
    expect(screen.getByText('1 here · 1 away')).toBeInTheDocument();
  });
});

describe('a long room', () => {
  const filters = [
    { id: 'low', label: 'Low', test: (r) => r.score <= 5 },
  ];

  test('twelve people get no search; thirteen do', () => {
    const { rerender } = render(<PlayersList rows={rows(many(12))} />);
    expect(screen.queryByTestId('players-find')).toBeNull();
    rerender(<PlayersList rows={rows(many(13))} />);
    expect(screen.getByTestId('players-find')).toBeInTheDocument();
  });

  test('searching narrows by name, case-insensitively, and says when nobody matches', () => {
    render(<PlayersList rows={rows(many(20))} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'p1' } });
    expect(names()).toEqual(['P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('players-nomatch')).toBeInTheDocument();
    expect(screen.queryAllByTestId('roster-row')).toHaveLength(0);
  });

  test('filters carry a count, press to narrow, and All puts everyone back', () => {
    render(<PlayersList rows={rows(many(20))} filters={filters} />);
    expect(screen.getByRole('button', { name: 'All 20' })).toHaveAttribute('aria-pressed', 'true');
    const low = screen.getByRole('button', { name: 'Low 5' });
    fireEvent.click(low);
    expect(low).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('roster-row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'All 20' }));
    expect(screen.getAllByTestId('roster-row')).toHaveLength(20);
  });

  test('the heading still counts the whole room while a search narrows the list', () => {
    render(<PlayersList rows={rows(many(20))} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'P05' } });
    expect(screen.getByRole('heading', { name: '20 players' })).toBeInTheDocument();
    expect(names()).toEqual(['P05']);
  });
});
