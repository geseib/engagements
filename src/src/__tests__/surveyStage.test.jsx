/**
 * THE WALL WHILE A SURVEY COLLECTS — s-01-collecting and s-07-whos-left.
 *
 * A survey is self-paced: nobody is looking up, so the wall's job is the way
 * IN (the join block and QR stay up) and a sense of pace — finished of joined,
 * and answered per question. Never names, unless the host asks, and only in
 * the two Names values that record any (docs/design/survey-redesign/
 * RATIONALE.md §3 "Names stop at the console").
 *
 * GameHostPage cannot be mounted in jsdom (it dies on the auth provider), so
 * the pieces it composes are mounted here — SurveyCollecting, RoomMeter, Rail —
 * fed by the same pure helpers the page calls, and the page's wiring is held
 * by source assertions at the bottom. jsdom has no layout engine: nothing here
 * asserts a width, and the bars' fills are never measured.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, within, waitFor, act, renderHook } from '@testing-library/react';
import SurveyCollecting, { SurveyClosed } from '../components/stage/SurveyCollecting';
import RoomMeter from '../components/stage/RoomMeter';
import Rail from '../components/stage/Rail';
import useSurveyProgress, {
  surveyRoomCounts, surveyMeterRows, surveyWaiting, stillGoingNames, surveyWallSubtitle,
} from '../hooks/useSurveyProgress';
import {
  closeSurvey, warnSurvey, endSurvey, fetchSurveyProgress, fetchSurveyPeople,
} from '../utils/surveyHostClient';
import { NAMES_MODES, namesMode } from '../config/surveyNames';

jest.mock('qrcode.react', () => {
  const mockReact = require('react');
  return { QRCodeSVG: ({ value }) => mockReact.createElement('svg', { 'data-qr': value }) };
});

const API = 'https://api.test/dev/';
const JOINED = 42;
/** The mockup's own numbers (_src/stage.py): 8 questions, answered so far. */
const PER = [36, 35, 34, 31, 30, 27, 24, 21];
const PROGRESS = {
  gameId: '4821',
  started: 36,
  finished: 21,
  perQuestion: PER.map((answered, i) => ({ qid: `c001#00${i + 1}`, answered })),
  at: '2026-09-23T14:12:00Z',
};
const PEOPLE = [
  { name: 'Priya Raghavan', status: 'finished' },
  { name: 'Tomás Ortega', status: 'partway' },
  { name: 'Aleksandra Wiśniewska', status: 'not-started' },
  { name: 'Sam Lee', status: 'finished' },
];

const noop = () => {};
const handlers = { onPreview: noop, onPreviewEnd: noop, onPin: noop };

function meterFor({ names, mode = null, people = PEOPLE, progress = PROGRESS } = {}) {
  const counts = surveyRoomCounts({ progress, joined: JOINED });
  return (
    <RoomMeter
      phase="COLLECTING"
      heading="Finished"
      body={<>{counts.finished}<small>{` / ${counts.joined}`}</small></>}
      rows={surveyMeterRows({ progress, joined: JOINED })}
      waiting={surveyWaiting({ names, people, stillGoing: JOINED - counts.finished, mode, ...handlers })}
    />
  );
}

/* ------------------------------------------------------------ the content */

describe('the collecting stage keeps the way in', () => {
  const draw = (names = 'anonymous') => render(
    <SurveyCollecting
      questionCount={8}
      names={names}
      playUrl="https://engage.seibtribe.us/player?gameId=4821"
      joinUrl="engage.seibtribe.us/play"
      code="4821"
    />,
  );

  test('the join block and its QR stay up', () => {
    const { container } = draw();
    const block = container.querySelector('.joinblock');
    expect(block).not.toBeNull();
    expect(block.querySelector('.qr svg')).toHaveAttribute('data-qr', 'https://engage.seibtribe.us/player?gameId=4821');
    expect(within(block).getByText('engage.seibtribe.us/play')).toBeInTheDocument();
    expect(within(block).getByText('4821')).toBeInTheDocument();
  });

  test('the title and the subtitle — the Names value\'s own wall line', () => {
    for (const mode of NAMES_MODES) {
      const { container, unmount } = draw(mode.id);
      expect(container.querySelector('.stitle')).toHaveTextContent(/\S/);
      const sub = container.querySelector('.ssub');
      expect(sub).toHaveTextContent('Eight quick questions on your phone.');
      expect(sub).toHaveTextContent(mode.wallLine);
      unmount();
    }
  });

  /*
    THE HEADLINE IS THE SESSION'S OWN NAME. It defaulted to the mockup's
    sample sentence, "Tell us how today went", and the page passed nothing —
    so every survey on every wall asked the room how today went, whatever it
    was about. Now the page hands in the session's name; with none, a neutral
    instruction.
  */
  test('the headline is the title it is given — the session\'s own name', () => {
    const { container } = render(
      <SurveyCollecting questionCount={8} names="anonymous" playUrl="u" joinUrl="j" code="4821" title="Q3 All-Hands feedback" />,
    );
    expect(container.querySelector('.stitle')).toHaveTextContent('Q3 All-Hands feedback');
    expect(container.textContent).not.toMatch(/Tell us how today went/);
  });

  test.each([['absent', undefined], ['empty', ''], ['blank', '   '], ['null', null]])(
    'with the title %s, a neutral line — never the mockup\'s sample sentence',
    (_l, title) => {
      const { container } = render(
        <SurveyCollecting questionCount={8} names="anonymous" playUrl="u" joinUrl="j" code="4821" title={title} />,
      );
      expect(container.querySelector('.stitle')).toHaveTextContent('Answer on your phone');
      expect(container.textContent).not.toMatch(/Tell us how today went/);
    },
  );

  test('the subtitle helper counts in words the room reads aloud', () => {
    expect(surveyWallSubtitle({ questionCount: 1, names: 'anonymous' }))
      .toBe(`One quick question on your phone. ${namesMode('anonymous').wallLine}`);
    expect(surveyWallSubtitle({ questionCount: 24, names: 'named' }))
      .toBe(`24 quick questions on your phone. ${namesMode('named').wallLine}`);
    // Count not known yet: the promise still goes up, alone.
    expect(surveyWallSubtitle({ questionCount: 0, names: 'finished' })).toBe(namesMode('finished').wallLine);
  });

  test('the closed stage says it is closed and what came in — counts only', () => {
    render(<SurveyClosed n={36} finished={21} />);
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
    expect(screen.getByText(/36 people answered/)).toBeInTheDocument();
    expect(screen.getByText(/21 finished/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- the meter */

describe('the meter: finished of joined, and a row per question', () => {
  test('"Finished", the one fraction, and eight rows', () => {
    const { container } = render(meterFor({ names: 'anonymous' }));
    expect(screen.getByRole('heading', { name: 'Finished' })).toBeInTheDocument();
    expect(container.querySelector('.count')).toHaveTextContent('21 / 42');
    const rows = container.querySelectorAll('.sprog .r');
    expect(rows).toHaveLength(PER.length);
    expect(rows[0]).toHaveTextContent('Q1');
    expect(rows[0]).toHaveTextContent('36 / 42');
    expect(rows[7]).toHaveTextContent('Q8');
    expect(rows[7]).toHaveTextContent('21 / 42');
  });

  test('no second bar under the fraction — the meter dropped .bar2 on purpose', () => {
    const { container } = render(meterFor({ names: 'anonymous' }));
    expect(container.querySelector('.bar2')).toBeNull();
  });

  test('the counts behind the dock line', () => {
    expect(surveyRoomCounts({ progress: PROGRESS, joined: JOINED }))
      .toEqual({ joined: 42, started: 36, finished: 21, partway: 15, notStarted: 6 });
    // More respondents than people in the room (a rejoin, a second browser)
    // never prints a negative.
    expect(surveyRoomCounts({ progress: { ...PROGRESS, started: 50 }, joined: 42 }).notStarted).toBe(0);
    expect(surveyRoomCounts({ progress: null, joined: 42 })).toBeNull();
  });

  test('a row is marked full only when everyone in the room has answered it', () => {
    const rows = surveyMeterRows({ progress: { ...PROGRESS, perQuestion: [{ qid: 'a', answered: 42 }, { qid: 'b', answered: 3 }] }, joined: 42 });
    expect(rows.map((r) => r.full)).toEqual([true, false]);
    expect(surveyMeterRows({ progress: PROGRESS, joined: 0 }).every((r) => !r.full)).toBe(true);
  });
});

/* ------------------------------------------------------------------ names */

describe('names on the wall — only on request, only in the two recorded modes', () => {
  test('Anonymous offers no names at all', () => {
    expect(surveyWaiting({ names: 'anonymous', people: PEOPLE, stillGoing: 21, ...handlers })).toBeNull();
    const { container } = render(meterFor({ names: 'anonymous', mode: 'pinned' }));
    // No reveal control, no list, no name anywhere.
    expect(container.querySelector('.count')).not.toHaveAttribute('role', 'button');
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
    for (const p of PEOPLE) expect(screen.queryByText(p.name)).toBeNull();
  });

  test('Who finished: nothing until the host reveals', () => {
    const { container } = render(meterFor({ names: 'finished', mode: null }));
    expect(container.querySelector('.count')).toHaveAttribute('role', 'button');
    for (const p of PEOPLE) expect(screen.queryByText(p.name)).toBeNull();
  });

  test('Who finished, revealed: the ones still going, under "Still going", as a waiting list', () => {
    const { container } = render(meterFor({ names: 'finished', mode: 'pinned' }));
    const list = container.querySelector('[data-waiting-list]');
    expect(list).toHaveAttribute('data-list-kind', 'waiting');
    expect(within(list).getByRole('heading', { name: 'Still going' })).toBeInTheDocument();
    expect(within(list).getByText('Tomás Ortega')).toBeInTheDocument();
    expect(within(list).getByText('Aleksandra Wiśniewska')).toBeInTheDocument();
    // The finished are not on the wall — that would be a league table.
    expect(screen.queryByText('Priya Raghavan')).toBeNull();
    expect(screen.queryByText('Sam Lee')).toBeNull();
  });

  test('Named behaves the same on the wall: a status, never an answer', () => {
    const { container } = render(meterFor({ names: 'named', mode: 'pinned' }));
    expect(container.querySelector('[data-list-kind="waiting"]')).not.toBeNull();
  });

  test('never a name beside an answer, or beside a per-question count', () => {
    const { container } = render(meterFor({ names: 'named', mode: 'pinned' }));
    // The rows give way to the list while it is up — two lists in one column
    // is the reflow the meter refuses, and a name beside "Q3 34 / 42" would
    // read as that person's answer.
    expect(container.querySelector('.sprog')).toBeNull();
    for (const p of PEOPLE) {
      for (const node of screen.queryAllByText(p.name)) {
        expect(node.closest('[data-list-kind="waiting"]')).not.toBeNull();
        expect(node.textContent).toBe(p.name);
      }
    }
  });

  test('the reveal is offered before the names are fetched, and says it is loading', () => {
    const waiting = surveyWaiting({ names: 'finished', people: null, stillGoing: 21, loading: true, mode: 'pinned', ...handlers });
    expect(waiting.count).toBe(21);
    const { container } = render(
      <RoomMeter phase="COLLECTING" heading="Finished" body="21" waiting={waiting} />,
    );
    expect(container.querySelector('.count')).toHaveAttribute('role', 'button');
    expect(container.querySelector('[data-waiting-list]')).toHaveTextContent(/loading/i);
  });

  /*
    A FAILED /people IS SAID, NOT WAITED ON FOREVER. `loading` was "people is
    not a list yet", so a /survey/people that failed left "Loading names…" on
    the wall for the rest of the survey. Now the failure is a short line; the
    count and the fraction stay, and the next reveal (or the next progress
    frame while it is up) asks again.
  */
  test('names that failed to load say so, and the counts stay', () => {
    const waiting = surveyWaiting({
      names: 'finished', people: null, stillGoing: 21, loading: false,
      error: 'The names could not be loaded.', mode: 'pinned', ...handlers,
    });
    expect(waiting.loading).toBe(false);
    expect(waiting.error).toBe('The names could not be loaded.');
    const { container } = render(
      <RoomMeter phase="COLLECTING" heading="Finished" body={<>21<small> / 42</small></>} waiting={waiting} />,
    );
    const list = container.querySelector('[data-waiting-list]');
    expect(list).toHaveTextContent('The names could not be loaded.');
    expect(list).not.toHaveTextContent(/Loading names/);
    expect(container.querySelector('.count')).toHaveTextContent('21 / 42');
  });

  test('nobody still going: nothing to reveal', () => {
    expect(surveyWaiting({ names: 'finished', people: PEOPLE, stillGoing: 0, ...handlers })).toBeNull();
    expect(stillGoingNames(PEOPLE)).toEqual(['Tomás Ortega', 'Aleksandra Wiśniewska']);
    expect(stillGoingNames(null)).toEqual([]);
  });
});

describe('the rail names the phase', () => {
  test('COLLECTING reads "Answering", CLOSED reads "Closed"', () => {
    const { rerender, container } = render(<Rail phase="COLLECTING" title="Q3 All-Hands" />);
    expect(container.querySelector('.chip')).toHaveTextContent('Answering');
    rerender(<Rail phase="CLOSED" title="Q3 All-Hands" />);
    expect(container.querySelector('.chip')).toHaveTextContent('Closed');
  });

  test('a survey\'s context line says how many questions, not which round', () => {
    const { container } = render(<Rail phase="COLLECTING" title="Q3" context={{ category: 'Survey', detail: '8 questions' }} />);
    expect(container.querySelector('.rail-ctx')).toHaveTextContent('Survey/8 questions');
  });
});

/* --------------------------------------------------------- the requests */

describe('the requests the host sends', () => {
  const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const call = (fetchFn, i = 0) => ({ url: fetchFn.mock.calls[i][0], init: fetchFn.mock.calls[i][1] || {} });

  test('close, warning and end are POSTs to the survey routes', async () => {
    const fetchFn = jest.fn(async () => okJson({ n: 36, finished: 21, perQuestion: [], closedAt: '2026-09-23T14:22:00Z' }));
    const closed = await closeSurvey({ fetchFn, apiBase: API, gameId: '4821' });
    // closedAt is the close's own stamp — the host orders later frames by it.
    expect(closed).toMatchObject({ ok: true, n: 36, finished: 21, closedAt: '2026-09-23T14:22:00Z' });
    expect(call(fetchFn)).toMatchObject({ url: `${API}games/4821/survey/close`, init: { method: 'POST' } });

    fetchFn.mockResolvedValueOnce(okJson({ warnedAt: '2026-09-23T14:20:00Z' }));
    expect(await warnSurvey({ fetchFn, apiBase: API, gameId: '4821' })).toMatchObject({ ok: true, warnedAt: '2026-09-23T14:20:00Z' });
    expect(call(fetchFn, 1)).toMatchObject({ url: `${API}games/4821/survey/warning`, init: { method: 'POST' } });

    fetchFn.mockResolvedValueOnce(okJson({ state: 'ENDED' }));
    expect(await endSurvey({ fetchFn, apiBase: API, gameId: '4821' })).toMatchObject({ ok: true, state: 'ENDED' });
    expect(call(fetchFn, 2)).toMatchObject({ url: `${API}games/4821/survey/end`, init: { method: 'POST' } });
  });

  test('progress and people are GETs', async () => {
    const fetchFn = jest.fn(async () => okJson(PROGRESS));
    expect(await fetchSurveyProgress({ fetchFn, apiBase: API, gameId: '4821' })).toMatchObject({ ok: true, progress: PROGRESS });
    expect(call(fetchFn)).toMatchObject({ url: `${API}games/4821/survey/progress`, init: { method: 'GET' } });

    fetchFn.mockResolvedValueOnce(okJson({ people: PEOPLE }));
    expect(await fetchSurveyPeople({ fetchFn, apiBase: API, gameId: '4821' })).toMatchObject({ ok: true, people: PEOPLE });
    expect(call(fetchFn, 1)).toMatchObject({ url: `${API}games/4821/survey/people`, init: { method: 'GET' } });
  });

  test('nothing throws: a refusal comes back as a sentence', async () => {
    const refused = jest.fn(async () => okJson({ error: 'The survey is not open.' }, 409));
    expect(await closeSurvey({ fetchFn: refused, apiBase: API, gameId: '4821' }))
      .toMatchObject({ ok: false, status: 409, error: 'The survey is not open.' });
    const offline = jest.fn(async () => { throw new Error('offline'); });
    expect(await fetchSurveyProgress({ fetchFn: offline, apiBase: API, gameId: '4821' }))
      .toMatchObject({ ok: false, error: 'offline' });
    // /people answers 409 in Anonymous: no names, and no error to show.
    const anon = jest.fn(async () => okJson({ error: 'Anonymous' }, 409));
    expect(await fetchSurveyPeople({ fetchFn: anon, apiBase: API, gameId: '4821' }))
      .toMatchObject({ ok: true, people: [] });
  });
});

describe('useSurveyProgress', () => {
  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

  test('reads /progress when it becomes active, and a frame replaces the counts', async () => {
    const fetchFn = jest.fn(async () => okJson(PROGRESS));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'anonymous', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).toEqual(PROGRESS));
    expect(fetchFn.mock.calls[0][0]).toBe(`${API}games/4821/survey/progress`);

    act(() => result.current.applyProgress({ ...PROGRESS, finished: 22, at: '2026-09-23T14:13:00Z' }));
    expect(result.current.progress.finished).toBe(22);
    // A frame for another session is ignored.
    act(() => result.current.applyProgress({ ...PROGRESS, gameId: '9999', finished: 1 }));
    expect(result.current.progress.finished).toBe(22);
  });

  test('an older frame never overwrites a newer one', async () => {
    const fetchFn = jest.fn(async () => okJson(PROGRESS));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'anonymous', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    act(() => result.current.applyProgress({ ...PROGRESS, finished: 30, at: '2026-09-23T14:20:00Z' }));
    act(() => result.current.applyProgress({ ...PROGRESS, finished: 25, at: '2026-09-23T14:15:00Z' }));
    expect(result.current.progress.finished).toBe(30);
  });

  test('Anonymous never asks for people', async () => {
    const fetchFn = jest.fn(async () => okJson(PROGRESS));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'anonymous', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    await act(async () => { await result.current.loadPeople(); });
    expect(fetchFn.mock.calls.map((c) => c[0])).not.toContain(`${API}games/4821/survey/people`);
    expect(result.current.people).toBeNull();
  });

  test('Who finished asks for people on reveal', async () => {
    const fetchFn = jest.fn(async (url) => okJson(url.endsWith('/people') ? { people: PEOPLE } : PROGRESS));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'finished', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    expect(result.current.people).toBeNull();
    await act(async () => { await result.current.loadPeople(); });
    expect(result.current.people).toEqual(PEOPLE);
  });

  /*
    THE HOST'S OWN CLOSE FREEZES THE COUNTS AGAINST LATER NEWS. The close
    response carries `closedAt`, and closeSurvey dropped it — so markClosed
    kept the last frame's `at`, and a progress frame from BEFORE the close
    that arrived AFTER the POST passed the "older than what is on screen"
    check and overwrote the frozen counts. Now closedAt is the ordering stamp.
  */
  test('after the host\'s close, a progress frame from before it cannot overwrite the frozen counts', async () => {
    const fetchFn = jest.fn(async () => okJson(PROGRESS));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'anonymous', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    act(() => result.current.markClosed({
      n: 38, finished: 30, perQuestion: PROGRESS.perQuestion, closedAt: '2026-09-23T14:22:00Z',
    }));
    // Sent at 14:21:59, delivered after the POST came back.
    act(() => result.current.applyProgress({ ...PROGRESS, started: 37, finished: 29, at: '2026-09-23T14:21:59Z' }));
    expect(result.current.progress).toMatchObject({ started: 38, finished: 30, at: '2026-09-23T14:22:00Z' });
  });

  test('a /people that fails ends the loading, says so, and leaves the counts alone', async () => {
    const fetchFn = jest.fn(async (url) => (url.endsWith('/people')
      ? { ok: false, status: 500, json: async () => ({ error: 'Failed to handle the survey request' }) }
      : okJson(PROGRESS)));
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'finished', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    await act(async () => { await result.current.loadPeople(); });
    expect(result.current.peopleLoading).toBe(false);
    expect(result.current.people).toBeNull();
    expect(result.current.peopleError).toMatch(/\S/);
    expect(result.current.progress).toEqual(PROGRESS);
    const waiting = surveyWaiting({
      names: 'finished', people: result.current.people, stillGoing: 21,
      loading: result.current.peopleLoading, error: result.current.peopleError, mode: 'pinned', ...handlers,
    });
    expect(waiting.loading).toBe(false);
  });

  test('a later /people that lands clears the failure', async () => {
    let fail = true;
    const fetchFn = jest.fn(async (url) => {
      if (!url.endsWith('/people')) return okJson(PROGRESS);
      return fail ? { ok: false, status: 503, json: async () => ({}) } : okJson({ people: PEOPLE });
    });
    const { result } = renderHook(() => useSurveyProgress({
      gameId: '4821', active: true, names: 'finished', fetchFn, apiBase: API,
    }));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    await act(async () => { await result.current.loadPeople(); });
    expect(result.current.peopleError).toBeTruthy();
    fail = false;
    await act(async () => { await result.current.loadPeople(); });
    expect(result.current.peopleError).toBeNull();
    expect(result.current.people).toEqual(PEOPLE);
  });

  test('nothing is fetched while inactive', () => {
    const fetchFn = jest.fn();
    renderHook(() => useSurveyProgress({ gameId: '4821', active: false, names: 'anonymous', fetchFn, apiBase: API }));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------- the wiring */

describe('GameHostPage composes it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');

  test('the collecting content is SurveyCollecting, and the closed one SurveyClosed', () => {
    expect(code).toMatch(/import SurveyCollecting, \{ SurveyClosed \} from '\.\/components\/stage\/SurveyCollecting'/);
    expect(code).toMatch(/hostPhase === 'COLLECTING' && \(\s*<SurveyCollecting/);
    expect(code).toMatch(/<SurveyClosed/);
  });

  test('both phases have a ceiling and a bar colour', () => {
    expect(code).toMatch(/const STAGE_GROW = \{[^}]*COLLECTING:/);
    expect(code).toMatch(/const STAGE_GROW = \{[^}]*CLOSED:/);
    expect(code).toMatch(/const BAR_PHASE = \{[\s\S]*?COLLECTING: 'ask'[\s\S]*?\};/);
    expect(code).toMatch(/const BAR_PHASE = \{[\s\S]*?CLOSED: '[a-z]+'[\s\S]*?\};/);
  });

  test('the meter is fed the per-question rows', () => {
    expect(code).toMatch(/rows=\{meter\.rows\}/);
    expect(code).toMatch(/heading: 'Finished'/);
  });

  test('names come from surveyWaiting, which fetches on reveal', () => {
    expect(code).toMatch(/surveyWaiting\(\{/);
    expect(code).toMatch(/loadPeople\(\)/);
  });

  test('it listens for surveyProgress and surveyClosed, and lets go of both', () => {
    for (const type of ['surveyProgress', 'surveyClosed']) {
      expect(code).toContain(`webSocketClient.onMessage('${type}'`);
      expect(code).toContain(`webSocketClient.offMessage('${type}'`);
    }
    expect(code).toContain("webSocketClient.onMessage('gameEnded'");
  });

  test('the progress handler reads the hook through a ref, not a stale closure', () => {
    const start = code.indexOf("webSocketClient.onMessage('surveyProgress'");
    const body = code.slice(start, code.indexOf('});', start));
    expect(body).toMatch(/surveyRef\.current/);
  });

  test('the collecting wall is headed with the session\'s own name', () => {
    expect(code).toMatch(/<SurveyCollecting[\s\S]*?title=\{eventTitle\}/);
  });

  test('the host\'s close hands its closedAt to the freeze', () => {
    const start = code.indexOf('const closeSurveyNow');
    const body = code.slice(start, code.indexOf('\n  };', start));
    expect(body).toMatch(/markClosed\(\{[^}]*closedAt: result\.closedAt/);
  });

  test('a failed /people reaches the meter', () => {
    expect(code).toMatch(/surveyWaiting\(\{[\s\S]*?error: survey\.peopleError/);
  });

  /*
    A LATE surveyClosed CANNOT MOVE THE HOST BACK FROM ENDED. The handler set
    SURVEY#CLOSED unconditionally, so a frame delivered after the host (or
    another of their devices) had ended the session put the stage back on
    "Survey closed" with End the session as the primary — for a session that
    no longer exists to end. It now goes through forwardOnly, the phone's own
    rank order, as does the host's own POST resolving late.
  */
  test('surveyClosed, and the host\'s own close, never move the stage backwards', () => {
    const start = code.indexOf("webSocketClient.onMessage('surveyClosed'");
    // To the handler's own close — the markClosed({…}) inside it has one too.
    const handler = code.slice(start, code.indexOf('\n    });', start));
    expect(handler).toMatch(/markClosed\(/);
    expect(handler).not.toMatch(/setGameState\('SURVEY#CLOSED'\)/);
    expect(handler).toMatch(/setGameState\(\(\w+\) => forwardOnly\(\w+, SURVEY_CLOSED\)\)/);
    const close = code.slice(code.indexOf('const closeSurveyNow'), code.indexOf('\n  };', code.indexOf('const closeSurveyNow')));
    expect(close).not.toMatch(/setGameState\('SURVEY#CLOSED'\)/);
    expect(close).toMatch(/forwardOnly\(/);
  });

  test('the host calls go through surveyHostClient with authFetch', () => {
    expect(code).toMatch(/from '\.\/utils\/surveyHostClient'/);
    for (const fn of ['closeSurvey', 'warnSurvey', 'endSurvey']) {
      expect(code).toMatch(new RegExp(`${fn}\\(\\{ fetchFn: authFetch`));
    }
  });
});
