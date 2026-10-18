/**
 * THE ROOM'S WINDOW OPENS ON THE OTHER DISPLAY (two-surface PLAN 3.9).
 * rejects: waiting for the screen list before opening (the popup would be
 * blocked once the click's activation runs out); placing on the display the
 * laptop page is on; taking a modified click or a one-display laptop away from
 * the plain link; a refused permission leaving no window; the first click on a
 * placed window also taking the join code down.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import {
  pickRoomScreen, placedHref, openRoomWindow, onRoomWindowClick, willPlace, ROOM_WINDOW_NAME,
} from '../present/roomWindow';
import RoomWindowLink from '../components/stage/RoomWindowLink';
import { useClickToFill, FillCue, FILL_CUE } from '../PresentPage';
import { act } from '@testing-library/react';

const laptop = { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 875, isInternal: true };
const projector = { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080, isInternal: false };
const tv = { availLeft: -1280, availTop: 0, availWidth: 1280, availHeight: 720, isInternal: false };

function fakeWindow({ extended = true, api = true, details, deny = false, blocked = false } = {}) {
  const popup = { moveTo: jest.fn(), resizeTo: jest.fn(), focus: jest.fn(), opener: 'x' };
  const order = [];
  const win = {
    screen: { isExtended: extended },
    open: jest.fn(() => { order.push('open'); return blocked ? null : popup; }),
  };
  if (api) {
    win.getScreenDetails = jest.fn(() => {
      order.push('details');
      return deny ? Promise.reject(new Error('denied')) : Promise.resolve(details || { currentScreen: laptop, screens: [laptop, projector] });
    });
  }
  return { win, popup, order };
}

const click = (over = {}) => ({ button: 0, preventDefault: jest.fn(), defaultPrevented: false, ...over });

describe('which display', () => {
  test('never the one this page is on; external before built-in; then the largest', () => {
    expect(pickRoomScreen({ currentScreen: laptop, screens: [laptop, projector] })).toEqual({ left: 1440, top: 0, width: 1920, height: 1080 });
    expect(pickRoomScreen({ currentScreen: laptop, screens: [laptop, tv, projector] }).width).toBe(1920);
    // The host page dragged onto the projector: the room gets the other external one, not the laptop.
    expect(pickRoomScreen({ currentScreen: projector, screens: [laptop, projector, tv] }).left).toBe(-1280);
    expect(pickRoomScreen({ currentScreen: projector, screens: [laptop, projector] }).left).toBe(0);
    expect(pickRoomScreen({ currentScreen: laptop, screens: [laptop] })).toBeNull();
    expect(pickRoomScreen(null)).toBeNull();
  });
  test('placed=1 is added once', () => {
    expect(placedHref('/present?gameId=1057')).toBe('/present?gameId=1057&placed=1');
    expect(placedHref('/present?gameId=1057&placed=1')).toBe('/present?gameId=1057&placed=1');
  });
});

describe('opening', () => {
  test('opens first, inside the click, then moves and fills the other display', async () => {
    const { win, popup, order } = fakeWindow();
    const { placed } = openRoomWindow('/present?gameId=1', win);
    expect(order).toEqual(['open']); // nothing awaited before the popup
    expect(win.open).toHaveBeenCalledWith('/present?gameId=1&placed=1', ROOM_WINDOW_NAME, expect.stringContaining('popup'));
    await expect(placed).resolves.toBe(true);
    expect(popup.moveTo).toHaveBeenCalledWith(1440, 0);
    expect(popup.resizeTo).toHaveBeenCalledWith(1920, 1080);
    expect(popup.opener).toBeNull();
  });
  test('permission refused: the window stays open where it opened', async () => {
    const { win, popup } = fakeWindow({ deny: true });
    const { window: w, placed } = openRoomWindow('/present?gameId=1', win);
    expect(w).toBe(popup);
    await expect(placed).resolves.toBe(false);
    expect(popup.moveTo).not.toHaveBeenCalled();
  });
});

describe('the click', () => {
  test('a plain click on a two-display Chrome is taken over', () => {
    const { win } = fakeWindow();
    const e = click();
    expect(onRoomWindowClick(e, '/present?gameId=1', win)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });
  test('the plain link is left alone everywhere else', () => {
    for (const [opts, ev] of [
      [{ extended: false }, click()],
      [{ api: false }, click()],
      [{}, click({ metaKey: true })],
      [{}, click({ button: 1 })],
      [{ blocked: true }, click()],
    ]) {
      const { win } = fakeWindow(opts);
      const e = ev;
      expect(onRoomWindowClick(e, '/present?gameId=1', win)).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
  });
  test('willPlace needs both the API and a second display', () => {
    expect(willPlace(fakeWindow().win)).toBe(true);
    expect(willPlace(fakeWindow({ extended: false }).win)).toBe(false);
    expect(willPlace(fakeWindow({ api: false }).win)).toBe(false);
  });
  test('the shared link is still a real link to the room\'s window', () => {
    const { getByRole } = render(<RoomWindowLink href="/present?gameId=1" className="x">Open</RoomWindowLink>);
    const a = getByRole('link', { name: 'Open' });
    expect(a.getAttribute('href')).toBe('/present?gameId=1');
    expect(a.getAttribute('target')).toBe('_blank');
  });
});

describe('one click fills the screen on a placed window', () => {
  function Harness({ on, onDocClick }) {
    useClickToFill(on);
    React.useEffect(() => {
      document.addEventListener('click', onDocClick);
      return () => document.removeEventListener('click', onDocClick);
    }, [onDocClick]);
    return <div>wall</div>;
  }
  let request;
  beforeEach(() => {
    request = jest.fn(() => Promise.resolve());
    document.documentElement.requestFullscreen = request;
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
  });
  afterEach(() => { delete document.documentElement.requestFullscreen; });

  test('placed: the first click goes full screen and nothing else sees it', () => {
    const onDocClick = jest.fn();
    const { getByText } = render(<Harness on onDocClick={onDocClick} />);
    fireEvent.click(getByText('wall'));
    expect(request).toHaveBeenCalled();
    expect(onDocClick).not.toHaveBeenCalled();
  });
  test('not placed: clicks are untouched', () => {
    const onDocClick = jest.fn();
    const { getByText } = render(<Harness on={false} onDocClick={onDocClick} />);
    fireEvent.click(getByText('wall'));
    expect(request).not.toHaveBeenCalled();
    expect(onDocClick).toHaveBeenCalled();
  });
});

/* THE CUE (owner, 18 Oct 2026: nothing said one click fills the screen).
   rejects: no cue on a placed window; a cue that stays once it is full
   screen; a cue on a window opened the ordinary way. */
describe('the one-click cue', () => {
  beforeEach(() => {
    document.documentElement.requestFullscreen = jest.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
  });
  afterEach(() => { delete document.documentElement.requestFullscreen; });

  test('placed and not full screen: the cue shows, then goes once it is full screen', () => {
    const { queryByText } = render(<FillCue placed />);
    expect(queryByText(FILL_CUE)).not.toBeNull();
    // rejects: the cue drawn with a light page's tokens (white on the wall).
    expect(queryByText(FILL_CUE).getAttribute('data-theme')).toBe('dark');
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true, writable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(queryByText(FILL_CUE)).toBeNull();
  });

  test('a window opened the ordinary way shows no cue', () => {
    const { queryByText } = render(<FillCue placed={false} />);
    expect(queryByText(FILL_CUE)).toBeNull();
  });
});
