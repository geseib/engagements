/**
 * THE ONE-SCREEN CHROME COMES BACK ON ANY MOVE, AND NEVER LIES OVER THE CODE.
 *
 * // rejects: dev QA 5 Nov — "on one screen the auto-hiding host chrome sits
 * // over the join code, and only Space or moving the mouse to the top bar
 * // brings the controls back."
 *
 * Investigated (see the commit): the hook listens for mousemove on the whole
 * document, so a move anywhere already brings the chrome back; and the three
 * chrome rows are grid rows above the rail, faded by opacity only, so they
 * cannot lie over the rail's code. Both halves are pinned here so neither
 * can regress: a move over the room's content and over the rail's join code
 * shows the chrome; no chrome row is taken out of the grid's flow.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, act, fireEvent } from '@testing-library/react';
import Stage from '../components/stage/Stage';
import { CHROME_IDLE_MS } from '../hooks/useChromeAutoHide';

const stageCss = fs.readFileSync(path.join(__dirname, '..', 'styles', 'stage.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function frame() {
  return (
    <Stage
      profile="room"
      phase="LOBBY"
      autoHide
      top={<div className="hc-top"><button type="button">Main menu</button></div>}
      now={<div className="dock dock--part"><button type="button">Start round 1</button></div>}
      rail={<div className="rail"><div className="rail-join"><code data-testid="rail-code">4821</code></div></div>}
    >
      <div className="content"><div className="joinblock"><div className="code" data-testid="lobby-code">4821</div></div></div>
    </Stage>
  );
}

const state = (c) => c.querySelector('.stage').getAttribute('data-chrome');
const idle = () => act(() => { jest.advanceTimersByTime(CHROME_IDLE_MS + 10); });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); document.body.innerHTML = ''; });

test.each([
  ['the room\'s content (the lobby code)', 'lobby-code'],
  ['the rail\'s join code', 'rail-code'],
])('a mouse move over %s brings the chrome back, not only the top bar', (_label, id) => {
  const { container, getByTestId } = render(frame());
  idle();
  expect(state(container)).toBe('hidden');
  act(() => { fireEvent.mouseMove(getByTestId(id), { screenX: 300, screenY: 400, clientX: 300, clientY: 400 }); });
  expect(state(container)).toBe('shown');
});

test('the chrome rows come before the rail in the stage, in their own grid rows', () => {
  const { container } = render(frame());
  const kids = Array.from(container.querySelector('.stage').children).map((el) => el.className.split(' ')[0]);
  expect(kids.indexOf('stage-top')).toBeLessThan(kids.indexOf('rail'));
  expect(kids.indexOf('stage-now')).toBeLessThan(kids.indexOf('rail'));
  expect(stageCss).toMatch(/grid-template-areas:"top" "now" "needs" "rail"/);
});

test('no chrome row is taken out of the flow, so none can lie over the rail\'s code', () => {
  for (const sel of ['.stage-top', '.stage-now', '.stage-needs']) {
    const rules = [...stageCss.matchAll(new RegExp(`(^|[},])\\s*${sel.replace('.', '\\.')}\\{([^}]*)\\}`, 'g'))].map((m) => m[2]);
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((r) => {
      expect(r).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
      expect(r).not.toMatch(/(^|;)\s*(top|bottom|transform|margin-bottom)\s*:\s*-/);
    });
  }
  // Hidden is opacity and pointer events only: the band keeps its height.
  const hidden = stageCss.match(/\.stage\[data-chrome="hidden"\] \.fn-controls\{([^}]*)\}/);
  expect(hidden[1]).toMatch(/opacity:0/);
  expect(hidden[1]).not.toMatch(/display|visibility|height/);
});
