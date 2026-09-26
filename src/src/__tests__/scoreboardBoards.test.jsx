/**
 * THE SCOREBOARD ON THE STAGE — components/stage/scoreboard/.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §1, §2, §3; the looks
 * are docs/design/scoreboard-2026-09-25/. Three layers, three sections:
 *
 *   1. the engines (the mockups' motion, ported): each look draws the rows,
 *      the ties, the movement and a wrapped name, and reduced motion paints
 *      the final state at once;
 *   2. Scoreboard.jsx: the fetch, the page size per profile, the auto-flip
 *      (fake timers) ending held on page 1, ← / → stepping, the phone's page
 *      step, and a live look switch that stays on the page;
 *   3. nothing of the board escapes into the markup unescaped — names are text.
 *
 * No geometric assertions: jsdom has no layout engine, so every fit falls to
 * its floor here. The CSS contract is read as text in scoreboardPalette.test.js
 * and stageMotion.test.js.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import Scoreboard from '../components/stage/scoreboard/Scoreboard';
import { createDepartureEngine, wrapName } from '../components/stage/scoreboard/departureEngine';
import { createOlympicEngine, laneCode } from '../components/stage/scoreboard/olympicEngine';
import { createToteEngine, lampBits } from '../components/stage/scoreboard/toteEngine';
import { boardRows } from '../config/scoreboard';
import { fitScale } from '../components/stage/scoreboard/fitScale';

/* The mockups' fourteen, after round 6 (standings.js computes these). */
const PLAYERS = [
  ['Priya', 81, 1, 1, 66], ['Marcus', 78, 2, -1, 70], ['Oluwaseun Adebayo-Richardson', 72, 3, 0, 60],
  ['Hannah', 66, 4, 2, 52], ['Tomás', 66, 4, 1, 58], ['Keiko', 63, 6, -2, 59], ['Dev', 59, 7, 2, 47],
  ['Sofia', 55, 8, -1, 50], ['Liam', 52, 9, -1, 48], ['Aisha', 51, 10, 1, 41], ['Grace', 44, 11, -1, 44],
  ['Ben', 39, 12, 0, 30], ['Inès', 14, 13, 'new', null], ['Kofi', 11, 14, 'new', null],
].map(([playerName, totalScore, rank, movement, previousScore]) => ({
  playerId: playerName, playerName, totalScore, rank, movement, previousScore,
}));
const ROWS = boardRows(PLAYERS);

const immediate = (fn) => { fn(); return 0; };

describe('1. the engines', () => {
  let host;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { host.remove(); });

  describe('A · departure', () => {
    test('a long name breaks at its hyphen onto a continuation line, never an ellipsis', () => {
      expect(wrapName('Oluwaseun Adebayo-Richardson', 12)).toEqual(['OLUWASEUN', 'ADEBAYO-', 'RICHARDSON']);
      // What the mockup draws at full width: a word that fits a line stays whole.
      expect(wrapName('Oluwaseun Adebayo-Richardson', 24)).toEqual(['OLUWASEUN', 'ADEBAYO-RICHARDSON']);
    });

    test('flaps to the page: places with ties, names, points and movement', () => {
      const engine = createDepartureEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10));
      const lines = engine.text();
      expect(lines[0]).toMatch(/^ 1PRIYA\s+81▲1 $/);
      expect(lines.find((l) => l.includes('HANNAH'))).toMatch(/^=4HANNAH\s+66▲2 $/);
      expect(lines.find((l) => l.includes('KEIKO'))).toMatch(/▼2 $/);
      expect(lines.find((l) => l.includes('OLUWASEUN'))).toMatch(/^ 3OLUWASEUN\s+72– {2}$/);
    });

    test('a continuation line has blank place and points flaps', () => {
      const engine = createDepartureEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10));
      const lines = engine.text();
      const i = lines.findIndex((l) => l.includes('OLUWASEUN'));
      expect(lines[i + 1].trim()).toMatch(/^ADEBAYO-/);
      expect(lines[i + 1].slice(0, 2)).toBe('  ');
    });

    test('NEW on the second page', () => {
      const engine = createDepartureEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(10));
      expect(engine.text().find((l) => l.includes('INÈS'))).toMatch(/NEW$/);
    });

    test('the grid is the same shape on every page (lines = the most any page needs)', () => {
      const engine = createDepartureEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10));
      const a = engine.text().length;
      engine.show(ROWS.slice(10));
      expect(engine.text().length).toBe(a);
      expect(a).toBeGreaterThanOrEqual(10);
    });

    test('with motion, the board wakes blank and the flaps land after the wave', () => {
      jest.useFakeTimers();
      try {
        const engine = createDepartureEngine(host, { random: () => 0.5 });
        engine.loadField(ROWS, 10);
        expect(engine.text().every((l) => !l.trim())).toBe(true);
        const ms = engine.show(ROWS.slice(0, 10));
        expect(ms).toBeGreaterThan(0);
        expect(engine.text()[0].trim()).toBe('');
        act(() => { jest.advanceTimersByTime(ms + 10); });
        expect(engine.text()[0]).toMatch(/PRIYA/);
      } finally { jest.useRealTimers(); }
    });

    test('one flap per character as a reader sees it — emoji and flags included', () => {
      // `split('')` cut an astral symbol into two broken halves, one per flap.
      expect(wrapName('🦊 Fox', 12)).toEqual(['🦊 FOX']);
      const engine = createDepartureEngine(host, { reduced: () => true });
      const rows = boardRows([
        { playerName: '🦊 Fox', totalScore: 9, rank: 1, movement: 0 },
        { playerName: 'Ana 🇬🇧', totalScore: 8, rank: 2, movement: 0 },
      ]);
      engine.loadField(rows, 10);
      engine.show(rows);
      const cells = engine.cells();
      const fox = cells.find((line) => line.includes('F'));
      expect(fox.slice(2, 7)).toEqual(['🦊', ' ', 'F', 'O', 'X']);
      const ana = cells.find((line) => line.includes('A'));
      expect(ana.slice(2, 7)).toEqual(['A', 'N', 'A', ' ', '🇬🇧']);
      // Nothing half a character anywhere on the board: no lone surrogate in any
      // flap. Spelled as a regex, not `String.prototype.isWellFormed()`, which
      // only exists from Node 20 — the pipeline's CodeBuild runs `npm test` on
      // Node 18, where that call threw and failed the dev deploy of d36fbdc1.
      const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      for (const line of cells) for (const ch of line) expect(LONE_SURROGATE.test(ch)).toBe(false);
    });

    test('names are text, never markup', () => {
      const engine = createDepartureEngine(host, { reduced: () => true });
      const evil = boardRows([{ playerName: '<img src=x onerror=alert(1)>', totalScore: 5, rank: 1, movement: 'new' }]);
      engine.loadField(evil, 10);
      engine.show(evil);
      expect(host.querySelector('img')).toBeNull();
    });
  });

  describe('B · olympic', () => {
    test('the code is the first three letters as typed', () => {
      expect(laneCode('Oluwaseun')).toBe('OLU');
      expect(laneCode('Tomás')).toBe('TOM');
      expect(laneCode('Inès')).toBe('INE');
    });

    test('lanes: medal blocks for 1-3, the leader\'s lane, ties, movement', () => {
      const engine = createOlympicEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10));
      const lanes = [...host.querySelectorAll('.sb-orow')];
      expect(lanes).toHaveLength(10);
      expect(lanes[0].classList.contains('sb-lead')).toBe(true);
      expect(lanes[0].querySelector('.sb-rk').className).toMatch(/sb-m1/);
      expect(lanes[2].querySelector('.sb-rk').className).toMatch(/sb-m3/);
      expect(lanes[3].querySelector('.sb-rk').textContent).toBe('=4');
      expect(lanes[3].querySelector('.sb-mv').textContent).toBe('▲2');
      expect(lanes[5].querySelector('.sb-mv').className).toMatch(/sb-dn/);
      expect(lanes[2].querySelector('.sb-onm').textContent).toBe('Oluwaseun Adebayo-Richardson');
    });

    test('with motion, the old list clears before the new one posts', () => {
      jest.useFakeTimers();
      try {
        const engine = createOlympicEngine(host);
        engine.loadField(ROWS, 10);
        engine.show(ROWS.slice(0, 10));
        act(() => { jest.advanceTimersByTime(1); });
        expect(host.querySelectorAll('.sb-orow.sb-post')).toHaveLength(10);
        engine.show(ROWS.slice(10));
        expect(host.querySelectorAll('.sb-orow.sb-clear')).toHaveLength(10);
        act(() => { jest.advanceTimersByTime(1000); });
        expect([...host.querySelectorAll('.sb-onm')].map((n) => n.textContent)).toEqual(['Grace', 'Ben', 'Inès', 'Kofi']);
      } finally { jest.useRealTimers(); }
    });
  });

  describe('C · tote', () => {
    test('lamps are a 5x7 font; = marks a tie', () => {
      expect(lampBits('=4', 2)[0]).toBe('00000000001111100000111110000000000');
      expect(lampBits('7', 2)[0]).toBe('0'.repeat(35));
    });

    test('rows carry the figures, the name and the movement', () => {
      const engine = createToteEngine(host, { reduced: () => true });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10), { afterRound: 6 });
      const rows = [...host.querySelectorAll('.sb-trow')];
      expect(rows).toHaveLength(10);
      expect(rows[3].querySelector('.sb-lamps').dataset.figure).toBe('=4');
      expect(rows[0].querySelectorAll('.sb-lamps')[1].dataset.figure).toBe('81');
      expect(rows[3].querySelector('.sb-mvk').textContent).toBe('▲2');
    });

    test('the first visit replays: the order after round 5, then the field rides', () => {
      jest.useFakeTimers();
      try {
        const rounds = [];
        const engine = createToteEngine(host, { onRound: (n) => rounds.push(n), random: () => 0 });
        engine.loadField(ROWS, 10);
        expect(engine.hasHistory()).toBe(true);
        const ms = engine.show(ROWS.slice(0, 10), { replay: true, page: 0, afterRound: 6 });
        act(() => { jest.advanceTimersByTime(1); });
        expect(rounds).toEqual([5]);
        // Marcus led after round 5, on 70.
        const first = host.querySelector('.sb-trow');
        expect(first.querySelector('.sb-tnm').textContent).toBe('Marcus');
        expect(first.querySelectorAll('.sb-lamps')[1].dataset.figure).toBe('70');
        expect(first.classList.contains('sb-pre')).toBe(true);
        act(() => { jest.advanceTimersByTime(ms); });
        expect(rounds).toEqual([5, 6]);
        const settled = [...host.querySelectorAll('.sb-trow')];
        expect(settled[0].querySelector('.sb-tnm').textContent).toBe('Priya');
        expect(settled[0].querySelectorAll('.sb-lamps')[1].dataset.figure).toBe('81');
        expect(settled.every((r) => r.classList.contains('sb-lit'))).toBe(true);
        expect(host.querySelector('.sb-ghost')).toBeNull();
      } finally { jest.useRealTimers(); }
    });

    test('reduced motion goes straight to the result — no replay', () => {
      const rounds = [];
      const engine = createToteEngine(host, { reduced: () => true, onRound: (n) => rounds.push(n) });
      engine.loadField(ROWS, 10);
      engine.show(ROWS.slice(0, 10), { replay: true, page: 0, afterRound: 6 });
      expect(rounds).toEqual([6]);
      expect(host.querySelector('.sb-tnm').textContent).toBe('Priya');
    });
  });
});

describe('1b. the type fits the TALLEST page, not the first', () => {
  test('fitScale takes the smallest scale any page needs', () => {
    // Each page fits at or below its own scale; page 2 carries the long name.
    const needs = { a: 1, b: 0.84, c: 0.96 };
    let current = null;
    let f = 1;
    const out = fitScale(['a', 'b', 'c'], {
      setFit: (v) => { f = v; },
      paint: (page) => { current = page; },
      overflows: () => f > needs[current] + 1e-9,
    });
    expect(out).toBeCloseTo(0.84, 2);
  });

  test('...and never below its floor', () => {
    const out = fitScale(['a'], { setFit() {}, paint() {}, overflows: () => true });
    expect(out).toBeCloseTo(0.5, 2);
  });

  /*
    jsdom has no layout, so the lists are given one: 16px a line times the
    scale, a long name taking three lines, in a 100px window. Page 1 (five
    short names) fits at full size; page 2 (four short, one long) needs about
    0.9. Fitted to page 1 alone, page 2 would clip its last row.
  */
  const LONG = 'Oluwaseun Adebayo-Richardson the Third';
  const rowsFor = (names) => boardRows(names.map((n, i) => ({
    playerId: n, playerName: n, totalScore: 50 - i, rank: i + 1, movement: 0, previousScore: 40,
  })));
  const FIELD = rowsFor(['Ann', 'Bea', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', LONG, 'Hal', 'Ivy']);

  function giveLayout(host, list, win, nameSel) {
    const fit = () => Number(host.style.getPropertyValue('--fit') || 1);
    const lines = () => [...list.querySelectorAll(nameSel)]
      .reduce((n, el) => n + (el.textContent.length > 20 ? 3 : 1), 0);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => lines() * 16 * fit() });
    Object.defineProperty(win, 'clientHeight', { configurable: true, get: () => 100 });
    return () => list.scrollHeight <= win.clientHeight + 1;
  }

  let host;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { host.remove(); });

  test('B · olympic: page 2 with the long name keeps every row', () => {
    const engine = createOlympicEngine(host, { reduced: () => true });
    const list = host.querySelector('.sb-olb-rows');
    const fits = giveLayout(host, list, list, '.sb-onm');
    engine.loadField(FIELD, 5);
    expect(Number(host.style.getPropertyValue('--fit'))).toBeLessThan(1);
    engine.show(FIELD.slice(5, 10));
    expect(host.querySelectorAll('.sb-orow')).toHaveLength(5);
    expect(fits()).toBe(true);
  });

  test('C · tote: page 2 with the long name keeps every row', () => {
    const engine = createToteEngine(host, { reduced: () => true });
    const fits = giveLayout(host, host.querySelector('.sb-tote-rows'), host.querySelector('.sb-tote-win'), '.sb-tnm');
    engine.loadField(FIELD, 5);
    expect(Number(host.style.getPropertyValue('--fit'))).toBeLessThan(1);
    engine.show(FIELD.slice(5, 10), { afterRound: 3 });
    expect(host.querySelectorAll('.sb-trow')).toHaveLength(5);
    expect(fits()).toBe(true);
  });
});

/* ---------------------------------------------------------------- 2 */

function mockRoster(players = PLAYERS, afterRound = 6) {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ players, afterRound }) }));
}

async function mount(props = {}) {
  let utils;
  await act(async () => {
    utils = render(
      <div className="stage">
        <Scoreboard
          gameId="6060"
          apiBase="https://api.test/"
          title="Q3 Leadership Offsite"
          profile="room"
          board={{ open: true, style: 'olympic', page: 0, openedAt: '2026-09-25T18:50:00.000Z' }}
          {...props}
        />
      </div>,
    );
  });
  // let the fetch settle
  await act(async () => { await Promise.resolve(); });
  return utils;
}

const board = () => document.querySelector('[data-scoreboard]');
const names = () => [...document.querySelectorAll('.sb-onm')].map((n) => n.textContent);

describe('2. Scoreboard', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    mockRoster();
  });
  afterEach(() => { jest.useRealTimers(); delete global.fetch; });

  test('fetches the public roster for this session', async () => {
    await mount();
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/games/6060/players');
  });

  test('the rail: Standings, the title, after round N, and the range', async () => {
    await mount();
    const rail = document.querySelector('.sb-rail');
    expect(rail.textContent).toMatch(/Standings/);
    expect(rail.textContent).toMatch(/Q3 Leadership Offsite/);
    expect(rail.textContent).toMatch(/After round 6/);
    expect(rail.querySelector('.sb-page').textContent).toBe('1–10of 14');
    expect(board().getAttribute('aria-label')).toBe('Standings after round 6');
  });

  test('Room shows ten places a page; TV and Call five; Table ten', async () => {
    await mount();
    expect(names()).toHaveLength(10);
    for (const [profile, n] of [['tv', 5], ['call', 5], ['table', 10]]) {
      document.body.innerHTML = '';
      // eslint-disable-next-line no-await-in-loop
      await mount({ profile });
      expect(names()).toHaveLength(n);
    }
  });

  test('a screen reader hears each row in full', async () => {
    await mount();
    const items = [...document.querySelectorAll('.sb-vh li')].map((li) => li.textContent);
    expect(items[0]).toBe('1 Priya, 81 points, up 1');
    expect(items[3]).toBe('=4 Hannah, 66 points, up 2');
  });

  test('auto-flips through every page, returns to page 1 and holds', async () => {
    jest.useFakeTimers();
    await mount();
    expect(board().dataset.page).toBe('0');
    expect(board().dataset.auto).toBe('on');
    await act(async () => { jest.advanceTimersByTime(8500); });
    expect(board().dataset.page).toBe('1');
    expect(names()).toEqual(['Grace', 'Ben', 'Inès', 'Kofi']);
    await act(async () => { jest.advanceTimersByTime(8500); });
    expect(board().dataset.page).toBe('0');
    expect(board().dataset.auto).toBe('held');
    await act(async () => { jest.advanceTimersByTime(60000); });
    expect(board().dataset.page).toBe('0');
    expect(names()[0]).toBe('Priya');
  });

  test('→ and ← step, and stepping cancels the auto-flip', async () => {
    jest.useFakeTimers();
    await mount();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(board().dataset.page).toBe('1');
    expect(board().dataset.auto).toBe('held');
    await act(async () => { jest.advanceTimersByTime(60000); });
    expect(board().dataset.page).toBe('1');
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
    expect(board().dataset.page).toBe('0');
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
    expect(board().dataset.page).toBe('1');
  });

  test('the arrows are not the board\'s while its keys are off (the session menu is open)', async () => {
    await mount({ keysEnabled: false });
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(board().dataset.page).toBe('0');
  });

  test('the phone\'s Next page arrives as a step', async () => {
    const utils = await mount();
    const next = { open: true, style: 'olympic', page: 1, openedAt: '2026-09-25T18:50:00.000Z' };
    await act(async () => {
      utils.rerender(
        <div className="stage"><Scoreboard gameId="6060" apiBase="https://api.test/" profile="room" board={next} /></div>,
      );
    });
    expect(board().dataset.page).toBe('1');
    expect(board().dataset.auto).toBe('held');
  });

  test('the server confirming an optimistic open is the same opening, not a restart', async () => {
    const utils = await mount({ board: { open: true, style: 'olympic', page: 0, openedAt: null } });
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    await act(async () => {
      utils.rerender(
        <div className="stage">
          <Scoreboard gameId="6060" apiBase="https://api.test/" profile="room"
            board={{ open: true, style: 'olympic', page: 0, openedAt: '2026-09-25T18:50:00.000Z' }} />
        </div>,
      );
    });
    expect(board().dataset.page).toBe('1');
  });

  test('a new opening starts again on page 1 with the auto-flip armed', async () => {
    const utils = await mount();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(board().dataset.auto).toBe('held');
    await act(async () => {
      utils.rerender(
        <div className="stage">
          <Scoreboard gameId="6060" apiBase="https://api.test/" profile="room"
            board={{ open: true, style: 'olympic', page: 0, openedAt: '2026-09-25T19:10:00.000Z' }} />
        </div>,
      );
    });
    expect(board().dataset.page).toBe('0');
    expect(board().dataset.auto).toBe('on');
  });

  test('a look switch applies live, on the same page', async () => {
    const utils = await mount();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    const tote = { open: true, style: 'tote', page: 0, openedAt: '2026-09-25T18:50:00.000Z' };
    await act(async () => {
      utils.rerender(
        <div className="stage"><Scoreboard gameId="6060" apiBase="https://api.test/" profile="room" board={tote} /></div>,
      );
    });
    expect(board().dataset.style).toBe('tote');
    expect(board().className).toMatch(/sb--tote/);
    expect(board().dataset.page).toBe('1');
    expect([...document.querySelectorAll('.sb-tnm')].map((n) => n.textContent)).toEqual(['Grace', 'Ben', 'Inès', 'Kofi']);
  });

  test('each look renders from the same rows', async () => {
    for (const style of ['departure', 'olympic', 'tote']) {
      document.body.innerHTML = '';
      // eslint-disable-next-line no-await-in-loop
      await mount({ board: { open: true, style, page: 0, openedAt: 't' } });
      expect(document.querySelector(`[data-look="${style}"]`)).not.toBeNull();
    }
  });

  test('a failed fetch says so rather than drawing an empty board', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await mount();
    expect(board().textContent).toMatch(/did not load/);
  });

  test('a round scored while the board is up lands on it (refreshKey refetches)', async () => {
    const utils = await mount({ refreshKey: 'RESULTS#006' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      utils.rerender(
        <div className="stage">
          <Scoreboard gameId="6060" apiBase="https://api.test/" profile="room" refreshKey="RESULTS#007"
            board={{ open: true, style: 'olympic', page: 0, openedAt: '2026-09-25T18:50:00.000Z' }} />
        </div>,
      );
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
