/**
 * THE CONSOLE RAIL, AS DESIGNED (docs/design/console-rail; owner, 3 Nov 2026,
 * "Looks good", every fork at its recommendation).
 *
 * Behaviour only; the stylesheet's contract is consoleRailPalette.test.js.
 * NO GEOMETRIC ASSERTIONS (jsdom has no layout engine).
 *
 * // rejects: a closed People header repeating tile 1's count ("5/6 answered").
 * // rejects: Everyone's in in orange, the needs-you colour.
 * // rejects: a repeating flash; a second alarm in the rail.
 * // rejects: People forced open with a header that did nothing (ConsoleRail.jsx:81,114).
 * // rejects: Late lit amber for a Soon item.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import ConsoleRail from '../components/console/ConsoleRail';
import ConsolePulse from '../components/console/ConsolePulse';
import NeedsYouLine from '../components/needs/NeedsYouLine';
import {
  railSummaries, waitingClause, consolePeopleFor, personFactsFor, RAIL_NAMES_MAX, scoresLive,
} from '../config/consoleRail';
import { needsYou } from '../config/needsYou';
import { ARRIVE_MS } from '../hooks/useArrival';

const SIX = ['Priya Raman', 'Marcus Webb', 'Ana Lucía Ortega', 'Sam Okafor', 'Jordan Lee', 'Lee Chen'];
const players = SIX.map((name, i) => ({ name, score: [30, 20, 20, 10, 10, 0][i] }));
const ROUNDS = [
  { n: 1, title: 'Where do we lose customers?', state: 'done' },
  { n: 2, title: 'One bet for next year', state: 'now' },
  { n: 3, title: 'Pricing for the EU launch', state: 'next', own: true },
  { n: 4, title: 'What should we stop doing?', state: 'later' },
];
const sec = (id) => document.querySelector(`.hc-rail [data-section="${id}"]`);
const head = (id) => sec(id).querySelector('summary');
const headText = (id) => head(id).querySelector('.hc-count').textContent;

const answering = (answeredNames, extra = {}) => consolePeopleFor({
  moment: 'ANSWERING', players, answeredNames, answeredCount: answeredNames.length, gameType: 'call-and-answer',
  facts: personFactsFor({ gameType: 'call-and-answer', players }), ...extra,
});

const renderRail = (props = {}) => render(
  <ConsoleRail moment="ANSWERING" rounds={ROUNDS} total={21} people={answering(SIX.filter((n) => n !== 'Marcus Webb'))} counts={{ players: 6 }} {...props} />,
);

describe('every header, open and closed, per phase (README D1, frame 7)', () => {
  const sum = (moment, people, open = {}, extra = {}) => railSummaries({
    moment, open, players: 6, people, rounds: ROUNDS, total: 21, late: 0, ...extra,
  });
  const marcusOut = answering(SIX.filter((n) => n !== 'Marcus Webb'));

  test('answering: People says "6 here", open or closed; who is still out is the room tile\'s (cut 5)', () => {
    expect(sum('ANSWERING', marcusOut, { people: true }).people).toMatchObject({ text: '6 here', strong: '' });
    const closed = sum('ANSWERING', marcusOut).people;
    // rejects: "waiting on Marcus" here as well as on the room tile (one fact, once).
    expect(closed).toMatchObject({ text: '6 here', strong: '' });
    expect(`${closed.text} ${closed.strong}`).not.toMatch(/5\s*(\/|of)\s*6|answered|waiting/);
  });
  test('the queue: open "2 of 21"; closed adds the next round; lobby counts and names the first; ended says done', () => {
    expect(sum('ANSWERING', marcusOut, { queue: true }).queue.text).toBe('2 of 21');
    expect(sum('ANSWERING', marcusOut).queue.text).toBe('2 of 21 · next: Pricing for the EU launch');
    const lobby = ROUNDS.filter((r) => r.state !== 'done' && r.state !== 'now');
    expect(sum('LOBBY', [], {}, { rounds: lobby }).queue.text).toBe('21 rounds · first: Pricing for the EU launch');
    expect(sum('LOBBY', [], { queue: true }, { rounds: lobby }).queue.text).toBe('21 rounds');
    const done = [1, 2, 3].map((n) => ({ n, title: `R${n}`, state: 'done' }));
    expect(sum('ENDED', [], {}, { rounds: done, total: 3 }).queue.text).toBe('3 of 3 · done');
  });
  test('everyone in: the waiting clause simply leaves', () => {
    expect(sum('ANSWERING', answering(SIX)).people).toMatchObject({ text: '6 here', strong: '' });
  });
  test('voting: "4 here", and the people still out sorted first (cut 6)', () => {
    const four = [{ name: 'Ana Lucía Ortega' }, { name: 'Jordan Lee' }, { name: 'Lee Chen' }, { name: 'Sam Okafor' }];
    const voting = consolePeopleFor({ moment: 'VOTING', players: four, votedNames: ['Jordan Lee'], votedCount: 1 });
    const h = railSummaries({ moment: 'VOTING', players: 4, people: voting });
    expect(h.people).toMatchObject({ text: '4 here', strong: '' });
    expect(voting.map((p) => p.name)).toEqual(['Ana Lucía Ortega', 'Lee Chen', 'Sam Okafor', 'Jordan Lee']);
  });
  test('results, scored: closed adds the leader; open does not; ended says who took part', () => {
    const results = consolePeopleFor({ moment: 'RESULTS', players, facts: personFactsFor({ gameType: 'trivia', players }) });
    expect(sum('RESULTS', results).people).toMatchObject({ text: '6 here', strong: 'top: Priya, 30' });
    expect(sum('RESULTS', results, { people: true }).people.strong).toBe('');
    expect(sum('ENDED', results).people).toMatchObject({ text: '6 took part', strong: 'top: Priya, 30' });
  });
  test('a poll has no leader: no score exists', () => {
    const poll = consolePeopleFor({ moment: 'RESULTS', players, facts: personFactsFor({ gameType: 'poll', players }) });
    expect(sum('RESULTS', poll).people.strong).toBe('');
  });
  test('late: "2 to review" at Soon with a dot; empty is "none", never "0"', () => {
    expect(sum('ANSWERING', marcusOut, {}, { late: 2 }).late).toMatchObject({ strong: '2 to review', dot: true, level: 'soon' });
    expect(sum('ANSWERING', marcusOut).late).toMatchObject({ text: 'none', level: 'calm' });
  });
  test('rendered: the closed headers read as frame 2', () => {
    renderRail({ lateCount: 2 });
    fireEvent.click(head('people'));
    expect(sec('people').open).toBe(false);
    expect(headText('people')).toBe('6 here');
    expect(headText('queue')).toBe('2 of 21 · next: Pricing for the EU launch');
    expect(headText('late')).toBe('2 to review');
    fireEvent.click(head('queue'));
    expect(headText('queue')).toBe('2 of 21');
  });
});

describe('waiting on: names, and the large-room switch (README D7, review H2)', () => {
  test('one or two in full, three to twelve as two names +N', () => {
    expect(waitingClause(['Marcus Webb'])).toBe('waiting on Marcus');
    expect(waitingClause(['Marcus Webb', 'Ana Lucía Ortega'])).toBe('waiting on Marcus, Ana');
    expect(waitingClause(['Marcus Webb', 'Ana Lucía Ortega', 'Lee Chen'])).toBe('waiting on Marcus, Ana +1');
    const twelve = Array.from({ length: RAIL_NAMES_MAX }, (_, i) => `P${i}`);
    expect(waitingClause(twelve)).toBe('waiting on P0, P1 +10');
  });
  test('past twelve still out: the count, not names', () => {
    expect(waitingClause(Array.from({ length: 13 }, (_, i) => `P${i}`))).toBe('waiting on 13');
    expect(waitingClause(Array.from({ length: 14 }, (_, i) => `P${i}`))).toBe('waiting on 14');
  });
  test('nobody out, or names that lag the count: nothing rather than something wrong', () => {
    expect(waitingClause([])).toBe('');
    expect(waitingClause(null)).toBe('');
    const lag = consolePeopleFor({
      moment: 'ANSWERING', players, answeredNames: ['Priya Raman'], answeredCount: 3,
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: false,
    });
    expect(railSummaries({ moment: 'ANSWERING', players: 6, people: lag }).people.strong).toBe('');
  });
  test('closed while the room answers, the header is "6 here": the names are the room tile\'s now (cut 5)', () => {
    renderRail({ people: answering(['Priya Raman', 'Sam Okafor', 'Jordan Lee']) });
    fireEvent.click(head('people'));
    expect(headText('people')).toBe('6 here');
    expect(head('people').getAttribute('aria-label')).toBe('People, 6 here');
    expect(head('people').getAttribute('title')).toBeNull();
  });
});

describe('Everyone\'s in: the tile, success green, once (README D5, fork 2)', () => {
  test('tile 1 carries is-in; the rail\'s People header goes quiet', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" players={6} answered={6} everyoneIn now={0} />);
    expect(container.querySelector('[data-tile="room"]').className).toMatch(/\bis-in\b/);
    render(<ConsoleRail moment="ANSWERING" people={answering(SIX)} counts={{ players: 6 }} />);
    fireEvent.click(head('people'));
    expect(headText('people')).toBe('6 here');
  });
  test('the stylesheet: success edge, a 10% success wash, one 600ms settle, never the accent', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'console', 'ConsolePulse.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.cpulse \.cpulse-room\.is-in \{([^}]*)\}/)[1];
    expect(rule).toMatch(/border-color:\s*var\(--success\)/);
    expect(rule).toMatch(/rgb\(var\(--success-rgb\) \/ \.10\)/);
    expect(rule).toMatch(/animation:\s*cpulse-settle 600ms ease-out 1 both/);
    expect(rule).not.toMatch(/--accent|--warn/);
  });
});

/* The page in miniature: the line and the rail read one needs list. */
function Both({ roster }) {
  const needs = needsYou({ players: roster });
  return (
    <>
      <NeedsYouLine needs={needs} onAct={() => {}} />
      <ConsoleRail
        moment="ANSWERING"
        people={roster.map((p) => ({ name: p.name, state: 'here' }))}
        counts={{ players: roster.length }}
        asking={needs.items.filter((i) => i.kind === 'name-request' || i.kind === 'name-open')}
      />
    </>
  );
}
const ASKED = new Date().toISOString();
const calm = [{ name: 'Priya', handover: {} }, { name: 'Sam', handover: {} }, { name: 'Ana', handover: {} }];
const samAsks = calm.map((p) => (p.name === 'Sam' ? { ...p, handover: { requested: true, requestedAt: ASKED } } : p));
const anaToo = samAsks.map((p) => (p.name === 'Ana' ? { ...p, handover: { requested: true, requestedAt: ASKED } } : p));
const line = () => screen.getByTestId('needs-line');

describe('the alert: one fade, both places together (README D4, fork 3)', () => {
  afterEach(() => jest.useRealTimers());

  test('a new request fades the line and the rail\'s mark in, in the same commit; then held, never repeated', () => {
    jest.useFakeTimers();
    const { rerender } = render(<Both roster={calm} />);
    expect(line().hasAttribute('data-arrived')).toBe(false);
    rerender(<Both roster={samAsks} />);
    // Together: the line and People's lifted asker (People opened itself).
    expect(line().hasAttribute('data-arrived')).toBe(true);
    expect(screen.getByTestId('people-needs').hasAttribute('data-arrived')).toBe(true);
    // Once: after the fade the attribute goes, and a re-render with the same item does not bring it back.
    act(() => { jest.advanceTimersByTime(ARRIVE_MS + 200); });
    expect(line().hasAttribute('data-arrived')).toBe(false);
    rerender(<Both roster={samAsks} />);
    expect(line().hasAttribute('data-arrived')).toBe(false);
    expect(line().className).toMatch(/is-now/);
  });

  test('closed People: the header lights with the same paint as the line, with the name', () => {
    jest.useFakeTimers();
    const { rerender } = render(<Both roster={calm} />);
    rerender(<Both roster={samAsks} />);
    act(() => { jest.advanceTimersByTime(ARRIVE_MS + 200); });
    fireEvent.click(head('people'));
    expect(sec('people').open).toBe(false);
    expect(head('people').getAttribute('data-level')).toBe('now');
    expect(line().getAttribute('data-level')).toBe('now');
    expect(headText('people')).toBe('Sam needs you · 3 here');
    expect(head('people').querySelector('.hc-dot')).not.toBeNull();
    // No buttons and no live region of its own: the line has both (review A5).
    expect(within(head('people')).queryByRole('button')).toBeNull();
    expect(head('people').querySelector('[aria-live]')).toBeNull();
  });

  test('a reload with the request already there draws it lit, without a fade', () => {
    render(<Both roster={samAsks} />);
    expect(line().className).toMatch(/is-now/);
    expect(line().hasAttribute('data-arrived')).toBe(false);
  });

  test('two, then three or more, askers in the closed header', () => {
    render(<ConsoleRail moment="READ" people={[]} counts={{ players: 3 }} asking={needsYou({ players: anaToo }).items} />);
    fireEvent.click(head('people'));
    expect(headText('people')).toBe('Sam, Ana need you · 3 here');
  });
});

describe('People opens once on a request, and can be closed (README D3, fork 4)', () => {
  function Rail({ roster, moment = 'READ' }) {
    return <ConsoleRail moment={moment} people={[]} counts={{ players: 3 }} lateCount={1} asking={needsYou({ players: roster }).items} />;
  }
  test('opens on arrival; the host closes it; the same request does not reopen it; a new one does', () => {
    const { rerender } = render(<Rail roster={calm} />);
    expect(sec('late').open).toBe(true);
    expect(sec('people').open).toBe(false);
    rerender(<Rail roster={samAsks} />);
    expect(sec('people').open).toBe(true);
    fireEvent.click(head('people'));
    expect(sec('people').open).toBe(false);
    rerender(<Rail roster={samAsks} />);
    expect(sec('people').open).toBe(false);
    rerender(<Rail roster={anaToo} />);
    expect(sec('people').open).toBe(true);
  });
  test('every header press works, whoever is asking (no dead control)', () => {
    render(<Rail roster={samAsks} />);
    ['people', 'queue', 'late'].forEach((id) => {
      const before = sec(id).open;
      fireEvent.click(head(id));
      expect([id, sec(id).open]).toEqual([id, !before]);
      if (sec(id).open) fireEvent.click(head(id));
    });
  });
});

describe('scores: muted while answering or voting, bright at Results; none for the unscored formats (D6, fork 5)', () => {
  const facts = (gameType) => personFactsFor({ gameType, players });
  const fact = () => [...document.querySelectorAll('.hc-people .prow-fact')];
  test.each(['call-and-answer', 'trivia'])('%s: muted mid-round, live at Results', (gameType) => {
    const { unmount } = render(<ConsoleRail moment="ANSWERING" people={consolePeopleFor({ moment: 'ANSWERING', players, answeredNames: [], answeredCount: 0, facts: facts(gameType) })} counts={{ players: 6 }} />);
    expect(fact().map((f) => f.textContent)).toEqual(['30', '20', '20', '10', '10', '0']);
    expect(fact().every((f) => !f.classList.contains('is-live'))).toBe(true);
    unmount();
    render(<ConsoleRail moment="RESULTS" people={consolePeopleFor({ moment: 'RESULTS', players, facts: facts(gameType) })} counts={{ players: 6 }} />);
    expect(fact().every((f) => f.classList.contains('is-live'))).toBe(true);
  });
  test('voting is muted too', () => {
    expect(scoresLive('VOTING')).toBe(false);
    expect(scoresLive('VOTE_RESPONSES')).toBe(false);
    expect(scoresLive('RESULTS')).toBe(true);
    expect(scoresLive('ENDED')).toBe(true);
  });
  test.each(['poll', 'wavelength', 'survey'])('%s: no score at all', (gameType) => {
    render(<ConsoleRail moment="RESULTS" people={consolePeopleFor({ moment: 'RESULTS', players, facts: facts(gameType) })} counts={{ players: 6 }} />);
    expect(screen.queryByTestId('person-fact')).toBeNull();
    expect(fact().map((f) => f.textContent)).toEqual(['', '', '', '', '', '']);
  });
  test('before the first scored round: "–", muted, not a column of zeros (review H5)', () => {
    render(<ConsoleRail moment="RESULTS" people={consolePeopleFor({ moment: 'RESULTS', players, facts: facts('trivia') })} counts={{ players: 6 }} scoreboard={{ show: true, enabled: false, reason: 'x', open: false, onToggle: () => {} }} />);
    expect(fact().map((f) => f.textContent)).toEqual(['–', '–', '–', '–', '–', '–']);
    expect(fact().some((f) => f.classList.contains('is-live'))).toBe(false);
  });
});

describe('per-person status: a ✓ / … glyph with the word as its label (D7, fork 6)', () => {
  test('answering: ✓ answered, … still writing, as images with names', () => {
    renderRail();
    const rows = [...document.querySelectorAll('.hc-people .prow')];
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.classList.contains('prow--rail'))).toBe(true);
    const marcus = rows.find((r) => r.textContent.includes('Marcus'));
    expect(within(marcus).getByRole('img', { name: 'still writing' })).toHaveTextContent('…');
    expect(within(marcus).getByRole('img', { name: 'still writing' })).toHaveAttribute('title', 'still writing');
    const priya = rows.find((r) => r.textContent.includes('Priya'));
    expect(within(priya).getByRole('img', { name: 'answered' })).toHaveTextContent('✓');
    // The word is the label only: it is not printed beside the name.
    expect(priya.querySelector('.prow-name').textContent).toBe('Priya Raman');
  });
  test('voting: ✓ voted / … not yet; a choice round reads "still answering"', () => {
    render(<ConsoleRail moment="VOTING" people={consolePeopleFor({ moment: 'VOTING', players, votedNames: ['Lee Chen'], votedCount: 1 })} counts={{ players: 6 }} />);
    expect(screen.getAllByRole('img', { name: 'voted' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'not yet' })).toHaveLength(5);
  });
  test('names that lag the count: every name, "—" not known yet', () => {
    render(<ConsoleRail moment="ANSWERING" people={consolePeopleFor({ moment: 'ANSWERING', players, answeredNames: [], answeredCount: 2, gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: false })} counts={{ players: 6 }} />);
    expect(screen.getAllByRole('img', { name: 'not known yet' }).map((g) => g.textContent)).toEqual(Array(6).fill('—'));
  });
  test('the rail draws the shared PersonRow, with its ⋯ when the page passes the moves', () => {
    const onPersonRemove = jest.fn();
    renderRail({ onPersonMove: () => {}, onPersonRemove });
    fireEvent.click(screen.getByRole('button', { name: 'More for Marcus Webb' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from session' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Press again to remove' }));
    expect(onPersonRemove).toHaveBeenCalledWith('Marcus Webb');
  });
});

describe('carets (README D2)', () => {
  test('every header has a decorative caret first; <details> carries the state', () => {
    renderRail({ lateCount: 1 });
    ['queue', 'people', 'late'].forEach((id) => {
      const caret = head(id).firstElementChild;
      expect(caret.className).toBe('hc-caret');
      expect(caret.getAttribute('aria-hidden')).toBe('true');
      expect(caret.querySelector('svg')).not.toBeNull();
    });
    expect(sec('people').open).toBe(true);
    expect(sec('queue').open).toBe(false);
  });
});

describe('Late is a Soon dot, never amber (fork 7)', () => {
  test('a dot and "2 to review", no alert class, no Now level', () => {
    renderRail({ lateCount: 2 });
    expect(head('late').getAttribute('data-level')).toBe('soon');
    expect(head('late').querySelector('.hc-dot')).not.toBeNull();
    expect(head('late').querySelector('.hc-count').className).not.toMatch(/is-alert/);
    expect(head('late').querySelector('b')).toHaveTextContent('2 to review');
  });
  test('nothing waiting: the section is not drawn at all (cut 6: a header that says "none")', () => {
    renderRail({ lateCount: 0 });
    expect(sec('late')).toBeNull();
    expect(sec('people')).not.toBeNull();
  });
});

describe('kept as it was', () => {
  test('the impromptu round keeps its Yours mark and the round numbers', () => {
    renderRail();
    fireEvent.click(head('queue'));
    const items = [...sec('queue').querySelectorAll('.hc-list li')];
    expect(items.map((li) => li.querySelector('.hc-n').textContent)).toEqual(['1', '2', '3', '4']);
    expect(items[2].querySelector('.hc-yours')).not.toBeNull();
  });
  test('a latecomer\'s "from item N" joins the name', () => {
    render(<ConsoleRail moment="LOBBY" people={consolePeopleFor({ moment: 'LOBBY', players: [{ name: 'Omar' }], from: { Omar: 'from item 2' } })} counts={{ players: 1 }} />);
    expect(document.querySelector('.hc-people .prow-name').textContent).toBe('Omar · from item 2');
  });
  test('the host\'s own choice holds until the moment changes', () => {
    function Host() {
      const [moment, setMoment] = useState('ANSWERING');
      return (
        <>
          <button type="button" onClick={() => setMoment('READ')}>read</button>
          <ConsoleRail moment={moment} people={[]} counts={{ players: 0 }} lateCount={1} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(head('people'));
    expect(sec('people').open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'read' }));
    expect(sec('late').open).toBe(true);
  });
});
