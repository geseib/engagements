/**
 * THE STAGE REFITS WHEN THE DOCK CHANGES HEIGHT (walk of dev 92f8b24d, 16 Oct
 * 2026). The dock is an auto grid row; Dock.jsx's useCrowded wraps it after
 * the fitter has run, so on TV at 1366x768 the results were left at --fit 1
 * with 86px over. useStageFit now watches the dock and runs again.
 * rejects: no refit when the dock grows; a refit on the first, unchanged
 * observation; an observer left behind on unmount.
 */
import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import useStageFit from '../hooks/useStageFit';

let observers = [];
class FakeRO {
  constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
  observe(el) { this.el = el; }
  disconnect() { this.disconnected = true; }
}

function Harness() {
  const ref = useRef(null);
  useStageFit(ref, []);
  return (
    <div ref={ref}>
      <div className="content" />
      <div className="dock" />
    </div>
  );
}

beforeEach(() => { observers = []; global.ResizeObserver = FakeRO; });
afterEach(() => { delete global.ResizeObserver; });

test('a dock that changes height makes the fitter run again', () => {
  const { container, unmount } = render(<Harness />);
  const dock = container.querySelector('.dock');
  const content = container.querySelector('.content');
  expect(observers).toHaveLength(1);
  expect(observers[0].el).toBe(dock);
  let h = 100;
  dock.getBoundingClientRect = () => ({ height: h, top: 0, bottom: h, left: 0, right: 0, width: 0 });
  observers[0].cb([]); // first observation: the height it started at
  content.style.setProperty('--fit', 'stale');
  observers[0].cb([]); // same height: no refit
  expect(content.style.getPropertyValue('--fit')).toBe('stale');
  h = 160;
  observers[0].cb([]); // the dock took a second line
  expect(content.style.getPropertyValue('--fit')).not.toBe('stale');
  unmount();
  expect(observers[0].disconnected).toBe(true);
});
