/**
 * A TALK'S SLIDES ON THE STAGE AND ON THE PHONE — components/event/
 * EventStage.jsx (the deck screen), SlideCanvas.jsx, useSlides.js, and the
 * talk screen of EventAttendeePage.jsx.
 *
 * The owner, 27 Sep 2026: "can the presentation show pdf presentation with
 * arrow key forward/backward through the pages?"
 *
 * pdf.js is mocked (utils/pdfDeck): jsdom has no canvas and no worker. What
 * is pinned is what the screens ask of it — which slide is drawn, into what
 * box — and what they do with the keys, the buttons, the server's page and
 * the poll. The box is stubbed (jsdom lays nothing out); that the slide fits
 * a real screen is the CSS contract in presentationSlidesPalette.test.js.
 *
 * rejects: a reload that starts the slides again at 1; ← → or a clicker's
 * PageUp/PageDown that do not turn the slide; → still taking the dock's step
 * (and moving the whole room) while slides are up; Space taken away from the
 * dock; a turn past the last slide or before the first; a burst of turns
 * written once per key rather than once; keys dead after the ‹ › buttons were
 * clicked; another screen's turn never followed; a phone that fetches the
 * deck unasked, or does not follow the stage's slide once it shows it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EventStage from '../components/event/EventStage';
import EventAttendeePage from '../components/event/EventAttendeePage';

jest.mock('../utils/eventsApi', () => ({
  getEvent: jest.fn(),
  runEvent: jest.fn(),
  readDeck: jest.fn(),
  turnPage: jest.fn(),
}));
jest.mock('../utils/attendeeApi', () => {
  const actual = jest.requireActual('../utils/attendeeApi');
  return {
    ...actual, getAgenda: jest.fn(), getNow: jest.fn(), whoAmI: jest.fn(), getDeck: jest.fn(),
  };
});
jest.mock('../utils/pdfDeck', () => ({
  openPdfAt: jest.fn(),
  drawPage: jest.fn(() => Promise.resolve(true)),
  countPages: jest.fn(),
  isCancelled: () => false,
}));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));
jest.mock('../hooks/useStageFit', () => () => {});
jest.mock('../PlayerPage', () => function PlayerPageStub() { return <div data-testid="player" />; });

const api = require('../utils/eventsApi');
const attendee = require('../utils/attendeeApi');
const pdf = require('../utils/pdfDeck');

const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
  endsAt: '10:05', state: 'SCHEDULED', liveItemId: '', attendeeCount: 12, rev: 'r0',
};
const DECK = { id: '0123456789abcdef', name: 'FY26 review.pdf', pages: 12, bytes: 3400000 };
const item = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', ledBy: '', minutes: 15,
  at: `9:${n}0`, until: `9:${n}5`, state: 'planned', ...extra,
});
const TALK = item(2, 'presentation', 'FY26 in review', { ledBy: 'Dana Whitfield', deck: DECK, deckPage: 5 });
const DAY = [item(1, 'trivia', 'Warm-up'), TALK, item(3, 'call-and-answer', 'What slows us down?')];
const view = (talk = TALK, event = {}) => ({ event: { ...EVENT, ...event }, items: [DAY[0], talk, DAY[2]] });
const DOC = { numPages: 12, destroy: jest.fn() };

/** jsdom measures nothing: give the slide's box a size, by class. */
function stubBox(className, width, height) {
  const w = jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function cw() {
    return this.classList && this.classList.contains(className) ? width : 0;
  });
  const hgt = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function ch() {
    return this.classList && this.classList.contains(className) ? height : 0;
  });
  return () => { w.mockRestore(); hgt.mockRestore(); };
}
const drawnPages = () => pdf.drawPage.mock.calls.map((c) => c[1]);
const lastDrawn = () => drawnPages()[drawnPages().length - 1];
const at = () => document.querySelector('.ag-deck-at').textContent;
const key = (k, target = window) => fireEvent.keyDown(target, { key: k });

let restore = () => {};
beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, '', `/host/event/${CODE}?focus=${TALK.itemId}`);
  api.readDeck.mockResolvedValue({ deck: { id: DECK.id, url: 'https://media.test/decks/x.pdf', pages: 12, page: 5 } });
  api.turnPage.mockImplementation(async (code, itemId, page) => ({ itemId, page }));
  pdf.openPdfAt.mockResolvedValue(DOC);
  restore = stubBox('ag-deck-slide', 900, 506);
});
afterEach(() => restore());

describe('the stage', () => {
  test('a reload on a talk with slides lands on its kept slide, drawn to the stage\'s box', async () => {
    api.getEvent.mockResolvedValue(view());
    render(<EventStage code={CODE} />);

    expect(await screen.findByText('Slide 5 of 12')).toBeInTheDocument();
    await waitFor(() => expect(pdf.drawPage).toHaveBeenCalled());
    const [doc, page, canvas, box] = pdf.drawPage.mock.calls[0];
    expect([doc, page, box]).toEqual([DOC, 5, { width: 900, height: 506 }]);
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('aria-label', 'FY26 in review, Slide 5 of 12');
    // The PDF came through the signed read, once.
    expect(api.readDeck).toHaveBeenCalledWith(CODE, TALK.itemId);
    expect(pdf.openPdfAt).toHaveBeenCalledWith('https://media.test/decks/x.pdf');
    // The slide IS the screen: no "Coming up" list, no join card over it.
    expect(screen.queryByText('Coming up')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.getByRole('heading', { name: 'FY26 in review' })).toBeInTheDocument();
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Preview — the phones are not here yet')).toBeInTheDocument();
  });

  test('→ and PageDown go forward, ← and PageUp go back, and a burst is kept once', async () => {
    api.getEvent.mockResolvedValue(view());
    render(<EventStage code={CODE} />);
    await screen.findByText('Slide 5 of 12');

    key('ArrowRight');
    expect(at()).toBe('Slide 6 of 12');
    key('PageDown');
    expect(at()).toBe('Slide 7 of 12');
    key('ArrowLeft');
    expect(at()).toBe('Slide 6 of 12');
    key('PageUp');
    key('PageDown');
    key('PageDown');
    expect(at()).toBe('Slide 7 of 12');
    await waitFor(() => expect(lastDrawn()).toBe(7));

    await waitFor(() => expect(api.turnPage).toHaveBeenCalledTimes(1));
    expect(api.turnPage).toHaveBeenCalledWith(CODE, TALK.itemId, 7);
    // Turning a slide is not a step of the day: nothing went live.
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('Space is still the dock\'s step; → is not while slides are up', async () => {
    api.getEvent.mockResolvedValue(view());
    api.runEvent.mockResolvedValue(view({ ...TALK, state: 'live' }, { state: 'LIVE', liveItemId: TALK.itemId }));
    render(<EventStage code={CODE} />);
    await screen.findByText('Slide 5 of 12');

    key('ArrowRight');
    expect(api.runEvent).not.toHaveBeenCalled();
    key(' ');
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', TALK.itemId));
    expect(await screen.findByText('Now presenting')).toBeInTheDocument();
    expect(at()).toBe('Slide 6 of 12');
  });

  test('the first and the last slide hold, and their buttons say so', async () => {
    api.getEvent.mockResolvedValue(view({ ...TALK, deckPage: 12 }));
    render(<EventStage code={CODE} />);
    await screen.findByText('Slide 12 of 12');
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
    key('ArrowRight');
    key('PageDown');
    expect(at()).toBe('Slide 12 of 12');
    for (let i = 0; i < 14; i += 1) key('ArrowLeft');
    expect(at()).toBe('Slide 1 of 12');
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    await waitFor(() => expect(api.turnPage).toHaveBeenCalledWith(CODE, TALK.itemId, 1));
    expect(api.turnPage.mock.calls.every(([, , page]) => page >= 1 && page <= 12)).toBe(true);
  });

  test('‹ › turn the slide, and the keys still work with focus on them (a clicker sends keys to what has focus)', async () => {
    api.getEvent.mockResolvedValue(view());
    render(<EventStage code={CODE} />);
    await screen.findByText('Slide 5 of 12');

    const next = screen.getByRole('button', { name: 'Next slide' });
    fireEvent.click(next);
    expect(at()).toBe('Slide 6 of 12');
    next.focus();
    key('PageDown', next);
    expect(at()).toBe('Slide 7 of 12');
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(at()).toBe('Slide 6 of 12');
  });

  test('another screen\'s turn arrives with the poll and is followed', async () => {
    jest.useFakeTimers();
    try {
      api.getEvent.mockResolvedValue(view());
      render(<EventStage code={CODE} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(at()).toBe('Slide 5 of 12');

      api.getEvent.mockResolvedValue(view({ ...TALK, deckPage: 9 }));
      await act(async () => { jest.advanceTimersByTime(10000); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(at()).toBe('Slide 9 of 12');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a turn made here is not undone by a poll that left before it was kept', async () => {
    jest.useFakeTimers();
    try {
      api.getEvent.mockResolvedValue(view());
      render(<EventStage code={CODE} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(9800); });
      key('ArrowRight');
      key('ArrowRight');
      // The poll leaves (at 10 s) before the turn is kept, and is slow to answer.
      let answer;
      api.getEvent.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(api.getEvent).toHaveBeenCalledTimes(2);
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(api.turnPage).toHaveBeenCalledWith(CODE, TALK.itemId, 7);
      // It comes back after the turn was kept, with the page from before it.
      await act(async () => { answer(view({ ...TALK, deckPage: 5 })); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(at()).toBe('Slide 7 of 12');
      // The next poll has the kept page, and nothing moves.
      api.getEvent.mockResolvedValue(view({ ...TALK, deckPage: 7 }));
      await act(async () => { jest.advanceTimersByTime(10000); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(at()).toBe('Slide 7 of 12');
    } finally {
      jest.useRealTimers();
    }
  });

  test('slides that cannot be loaded say so, with a way to try again', async () => {
    api.getEvent.mockResolvedValue(view());
    pdf.openPdfAt.mockRejectedValueOnce(new Error('HTTP 403'));
    render(<EventStage code={CODE} />);
    expect(await screen.findByText('The slides could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(pdf.drawPage).toHaveBeenCalled());
    expect(api.readDeck).toHaveBeenCalledTimes(2);
  });

  test('a presentation with no slides keeps its title card, and → is the dock\'s step again', async () => {
    const bare = { ...TALK, deck: undefined, deckPage: undefined };
    api.getEvent.mockResolvedValue(view(bare));
    api.runEvent.mockResolvedValue(view({ ...bare, state: 'live' }, { state: 'LIVE', liveItemId: bare.itemId }));
    render(<EventStage code={CODE} />);
    expect(await screen.findByText('Coming up')).toBeInTheDocument();
    expect(screen.queryByTestId('slides')).toBeNull();
    expect(api.readDeck).not.toHaveBeenCalled();
    key('ArrowRight');
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', bare.itemId));
  });
});

describe('the phone, following the talk', () => {
  const live = { ...TALK, state: 'live', deck: undefined, deckPage: undefined, slides: 12 };
  const agenda = { event: { ...EVENT, state: 'LIVE', liveItemId: live.itemId }, items: [DAY[0], live, DAY[2]] };
  const nowAt = (page) => ({
    code: CODE, state: 'LIVE', liveItemId: live.itemId, rev: 'r0',
    live: { itemId: live.itemId, type: 'presentation', state: 'live', slides: { page, pages: 12 } },
  });

  beforeEach(() => {
    restore();
    restore = stubBox('evp-deck-slide', 360, 225);
    window.localStorage.setItem(`engage.event.${CODE}`, JSON.stringify({ token: 'tok', name: 'Priya Raman' }));
    attendee.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    attendee.getAgenda.mockResolvedValue(agenda);
    attendee.getDeck.mockResolvedValue({ id: DECK.id, url: 'https://media.test/decks/x.pdf', pages: 12, page: 3 });
  });

  test('says which slide the stage is on, and shows it only when asked, then follows each turn', async () => {
    jest.useFakeTimers();
    try {
      attendee.getNow.mockResolvedValue(nowAt(3));
      render(<EventAttendeePage code={CODE} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(await screen.findByText('FY26 in review')).toBeInTheDocument();
      expect(screen.getByText('12 slides')).toBeInTheDocument();

      await act(async () => { jest.advanceTimersByTime(4100); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('Slide 3 of 12')).toBeInTheDocument();
      // Nothing fetched before the attendee asks: a deck can be 50 MB.
      expect(attendee.getDeck).not.toHaveBeenCalled();
      expect(pdf.openPdfAt).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Show the slides here' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(attendee.getDeck).toHaveBeenCalledWith(CODE, live.itemId);
      expect(pdf.openPdfAt).toHaveBeenCalledWith('https://media.test/decks/x.pdf');
      expect(lastDrawn()).toBe(3);
      expect(pdf.drawPage.mock.calls[0][3]).toEqual({ width: 360, height: 225 });

      attendee.getNow.mockResolvedValue(nowAt(4));
      await act(async () => { jest.advanceTimersByTime(4100); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('Slide 4 of 12')).toBeInTheDocument();
      expect(lastDrawn()).toBe(4);
      expect(attendee.getDeck).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Hide the slides' }));
      expect(document.querySelector('.evp-deck-frame')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a talk with no slides offers none', async () => {
    attendee.getNow.mockResolvedValue({ ...nowAt(1), live: { itemId: live.itemId, type: 'presentation', state: 'live' } });
    attendee.getAgenda.mockResolvedValue({ ...agenda, items: [DAY[0], { ...live, slides: undefined }, DAY[2]] });
    render(<EventAttendeePage code={CODE} />);
    expect(await screen.findByText('FY26 in review')).toBeInTheDocument();
    expect(screen.queryByTestId('talk-slides')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the slides here' })).toBeNull();
  });
});
