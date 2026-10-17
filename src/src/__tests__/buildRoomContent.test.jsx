/**
 * WHAT A BUILD ROOM'S ROOM SEES (owner, 17 Oct 2026; config/roomContent.js,
 * parity PLAN §2d). The Stage, Build and History are the same components on
 * the host's one screen and on the room's window, so these hold both:
 *
 *   - the ask's prompt and option titles lead; its detail, each option's
 *     detail and the room's reasons only on Call;
 *   - six long options page: ↑ ↓ and "Options 1–3 of 6 · page 1 of 2" on the
 *     host's Stage, the first page and "and 3 more options on your phone" on
 *     the room's window (no button there);
 *   - Claude's status ("kept current … whichever screen shown to the room",
 *     owner 17 Oct) on Stage, Build and History, every profile, never droppable,
 *     and never ahead of an open ask's prompt.
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BuildStageScreen from '../buildroom/screens/BuildStageScreen';
import BuildBuildScreen from '../buildroom/screens/BuildBuildScreen';
import BuildHistoryScreen from '../buildroom/screens/BuildHistoryScreen';
import { AskStage } from '../buildroom/screens/AskStage';
import { wallRoom } from '../present/buildwall/wallRoom';
import { buildRoomContent } from '../buildroom/roomContentData';
import { optionPageSizeFor, OPTION_PAGE_SIZE } from '../config/stagePaging';
import { PROFILES } from '../config/displayProfile';

const F = require('../testing/buildWallFixture');

afterEach(cleanup);

const DOING = { text: 'Adding the parking map', startedAt: new Date(Date.now() - 4 * 60000).toISOString(), lastActiveAt: new Date().toISOString(), helper: 'Checking the links' };

/** A wall room with Claude at work, its current ask given a detail and option details. */
function wall(opts = {}) {
  const body = F.wallBody(opts);
  body.doing = DOING;
  const room = wallRoom(body);
  room.asks = room.asks.map((a) => (a.askId === room.currentAskId
    ? { ...a, detail: 'ASK-DETAIL-77', options: a.options.map((o) => ({ ...o, detail: `OPT-DETAIL-${o.label}` })) }
    : a));
  return room;
}

const now = Date.now();

describe('the ask on the Stage', () => {
  it.each(['room', 'tv', 'table'])('%s: the prompt and option titles only; no detail, no option detail, no reasons', (profile) => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'results' })} now={now} profile={profile} />);
    expect(container.querySelector('.brm-q[data-rc="lead"]').textContent).toBe('Which header should volunteers see first?');
    expect(container.textContent).not.toContain('ASK-DETAIL-77');
    expect(container.textContent).not.toContain('OPT-DETAIL');
    expect(container.querySelector('.brm-whysbox')).toBeNull();
    expect(container.querySelectorAll('.brm-ct').length).toBe(2);
  });

  it('call: the detail, the option details and the reasons too', () => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'results' })} now={now} profile="call" />);
    expect(container.textContent).toContain('ASK-DETAIL-77');
    expect(container.textContent).toContain('OPT-DETAIL-A');
    expect(container.querySelector('.brm-whysbox')).not.toBeNull();
  });

  it.each(PROFILES)('%s, the room\'s window: six long options show the first page and count the rest, with no button', (profile) => {
    const room = wall({ ask: 'live', longAsk: true });
    const { container } = render(<BuildStageScreen room={room} now={now} profile={profile} />);
    const size = optionPageSizeFor(profile, room.asks.find((x) => x.askId === room.currentAskId).options, { height: window.innerHeight });
    expect(size).toBeLessThan(6);
    expect(container.querySelectorAll('.brm-choice').length).toBe(size);
    const more = container.querySelector('[data-more-options]');
    expect(more.getAttribute('data-more-options')).toBe(String(6 - size));
    expect(more.textContent).toBe(`and ${6 - size} more ${6 - size === 1 ? 'option' : 'options'} on your phone`);
    expect(container.querySelectorAll('button, [role="button"]').length).toBe(0);
    expect(container.querySelector('[data-clamped]')).toBeNull();
  });

  it('the measured exceptions: TV under 900px tall shows one, Call at results two', () => {
    const six = Array.from({ length: 6 }, (x, i) => ({ title: `${'long option title '.repeat(8)}${i}` }));
    expect(optionPageSizeFor('tv', six, { height: 720 })).toBe(1);
    expect(optionPageSizeFor('tv', six, { height: 1080 })).toBe(OPTION_PAGE_SIZE.tv);
    expect(optionPageSizeFor('call', six, { results: true })).toBe(2);
    expect(optionPageSizeFor('call', six)).toBe(OPTION_PAGE_SIZE.call);
    expect(optionPageSizeFor('room', six, { height: 720, results: true })).toBe(OPTION_PAGE_SIZE.room);
  });

  it('short options never page', () => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'live' })} now={now} profile="tv" />);
    expect(container.querySelectorAll('.brm-choice').length).toBe(2);
    expect(container.querySelector('[data-more-options]')).toBeNull();
    expect(optionPageSizeFor('tv', [{ title: 'Bold' }, { title: 'Calm' }])).toBe(2);
  });

  it('the host\'s Stage pages them with ↑ ↓ and prints the position', () => {
    const room = wall({ ask: 'live', longAsk: true });
    const current = room.asks.find((a) => a.askId === room.currentAskId);
    const rc = buildRoomContent('BUILD_ASK', 'room', room, current, now);
    const onPage = jest.fn();
    const { container } = render(
      <AskStage ask={current} host={false} busy={false} ended={false} run={() => {}} api={null} rc={rc} paging={{ size: 3, page: 0, onPage, enabled: true }} />,
    );
    expect(container.querySelectorAll('.brm-choice').length).toBe(3);
    expect(container.querySelector('.pager .pgr-label').textContent).toBe('Options 1–3 of 6 · page 1 of 2 · ↑ ↓ to page');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onPage).toHaveBeenCalledWith(1);
    // Space and → are the advance keys; the pager leaves them alone.
    onPage.mockClear();
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onPage).not.toHaveBeenCalled();
  });

  it('page two draws options D to F with their own letters', () => {
    const room = wall({ ask: 'live', longAsk: true });
    const current = room.asks.find((a) => a.askId === room.currentAskId);
    const rc = buildRoomContent('BUILD_ASK', 'room', room, current, now);
    const { container } = render(
      <AskStage ask={current} host={false} busy={false} ended={false} run={() => {}} api={null} rc={rc} paging={{ size: 3, page: 1, onPage: () => {}, enabled: true }} />,
    );
    expect([...container.querySelectorAll('.brm-big')].map((e) => e.textContent)).toEqual(['D', 'E', 'F']);
  });

  it('the host screen\'s path (pathMode) is untouched: every option, its detail', () => {
    const room = wall({ ask: 'live', longAsk: true });
    const current = room.asks.find((a) => a.askId === room.currentAskId);
    const rc = buildRoomContent('BUILD_ASK', 'room', room, current, now);
    const { container } = render(<AskStage ask={current} host busy={false} ended={false} run={() => {}} api={null} pathMode rc={rc} paging={{ size: 3, page: 0 }} />);
    expect(container.querySelectorAll('.brm-choice').length).toBe(6);
    expect(container.textContent).toContain('OPT-DETAIL-A');
  });
});

describe("Claude's status on every screen the room sees (owner, 17 Oct 2026)", () => {
  const status = (container) => container.querySelector('[data-claude-status]');

  it.each(PROFILES)('%s: on the Stage under an open ask, after the prompt and options, never droppable', (profile) => {
    const { container } = render(<BuildStageScreen room={wall({ ask: 'live', longAsk: true })} now={now} profile={profile} />);
    const line = status(container);
    expect(line).not.toBeNull();
    expect(line.textContent).toContain('Claude is adding the parking map');
    expect(line.textContent).toContain('for 4 min');
    expect(line.textContent).toContain('A helper is checking the links');
    expect(line.getAttribute('data-rc')).toBe('support');
    expect(line.closest('[data-drop]')).toBeNull();
    const prompt = container.querySelector('.brm-q[data-rc="lead"]');
    // eslint-disable-next-line no-bitwise
    expect(prompt.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(PROFILES)('%s: on the Stage between asks it IS the lead, drawn once', (profile) => {
    const { container } = render(<BuildStageScreen room={wall()} now={now} profile={profile} />);
    expect(container.querySelector('.brm-stage--idle .brm-q').textContent).toBe('Claude is adding the parking map');
    expect(status(container)).toBeNull();
  });

  it.each(PROFILES)('%s: on the Stage with the wheel, a talking point or the codes up', (profile) => {
    [wall({ ask: 'wheel' })].forEach((room) => {
      const { container, unmount } = render(<BuildStageScreen room={room} now={now} profile={profile} />);
      expect(status(container)).not.toBeNull();
      unmount();
    });
    const { container } = render(<BuildStageScreen room={wall()} now={now} profile={profile} show={{ codesUp: true }} />);
    expect(status(container)).not.toBeNull();
  });

  it.each(PROFILES)('%s: on Build and on History', (profile) => {
    const b = render(<BuildBuildScreen room={wall()} now={now} profile={profile} />);
    expect(status(b.container).textContent).toContain('Claude is adding the parking map');
    b.unmount();
    const h = render(<BuildHistoryScreen room={wall({ history: 3 })} now={now} profile={profile} />);
    expect(status(h.container).textContent).toContain('Claude is adding the parking map');
    expect(status(h.container).closest('[data-drop]')).toBeNull();
  });

  it('the status line is never at the meta step (BuildRoom.css)', () => {
    const css = readFileSync(join(__dirname, '..', 'buildroom', 'BuildRoom.css'), 'utf8');
    const rule = (sel) => {
      const i = css.indexOf(`${sel} {`);
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };
    expect(rule('.brm .brm-roomclaude')).toMatch(/font-size:\s*var\(--brm-st-body\)/);
    expect(rule('.brm .stage .brm-roomclaude')).toMatch(/font-size:\s*var\(--t-body\)/);
    expect(css).not.toMatch(/\.brm-roomclaude[^{]*\{[^}]*--(t|brm-st|L)-meta/);
  });
});
