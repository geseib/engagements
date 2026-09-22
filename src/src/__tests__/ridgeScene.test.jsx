import React from 'react';
import { render } from '@testing-library/react';
import RidgeScene, { pointOnRoute } from '../marketing/components/RidgeScene';
import { prefersReducedMotion } from '../marketing/useScrollProgress';

const fs = require('fs');
const path = require('path');
const SRC = ['RidgeScene.jsx', 'RidgeScene.css']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'marketing', 'components', f), 'utf8')).join('\n');

test('the banned parallax class does not come back under a new file', () => {
  expect(SRC).not.toMatch(/parallax/i);
  const { container } = render(<RidgeScene progress={0.5} />);
  expect(container.querySelector('[class*="parallax"]')).toBeNull();
});

test('no art is loaded from anywhere — the old hero hot-linked a paid library', () => {
  expect(SRC).not.toMatch(/https?:\/\//);
  expect(SRC).not.toMatch(/\.(webp|png|jpe?g)/i);
});

test('it is decoration, and says so', () => {
  const { container } = render(<RidgeScene progress={0} />);
  expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
});

test('the climber starts at base camp and ends on the summit', () => {
  expect(pointOnRoute(0)).toEqual({ x: 92, y: 418 });
  expect(pointOnRoute(1)).toEqual({ x: 600, y: 216 });
  const mid = pointOnRoute(0.5);
  expect(mid.y).toBeLessThan(418);
  expect(mid.y).toBeGreaterThan(216);
  expect(pointOnRoute(7)).toEqual(pointOnRoute(1));   // clamped
  expect(pointOnRoute(-1)).toEqual(pointOnRoute(0));
  expect(pointOnRoute(NaN)).toEqual(pointOnRoute(0));
});

test('the climber only ever goes up as progress increases', () => {
  let prevY = pointOnRoute(0).y;
  for (let p = 0.05; p <= 1.0001; p += 0.05) {
    const { y } = pointOnRoute(p);
    expect(y).toBeLessThanOrEqual(prevY);
    prevY = y;
  }
});

test('the climber moves at roughly even speed along the route', () => {
  const steps = [];
  for (let p = 0; p <= 1.0001; p += 0.1) steps.push(pointOnRoute(p));
  const dists = [];
  for (let i = 1; i < steps.length; i += 1) {
    dists.push(Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y));
  }
  const maxD = Math.max(...dists);
  const minD = Math.min(...dists);
  expect((maxD - minD) / maxD).toBeLessThan(0.35);
});

test('deeper layers move further', () => {
  const { container } = render(<RidgeScene progress={1} />);
  const shift = (name) => Number(container.querySelector(name).style.getPropertyValue('--mk-drift').replace('px', ''));
  expect(Math.abs(shift('.mk-ridge-front'))).toBeGreaterThan(Math.abs(shift('.mk-ridge-mid')));
  expect(Math.abs(shift('.mk-ridge-mid'))).toBeGreaterThan(Math.abs(shift('.mk-ridge-back')));
});

test('the glow renders at exactly the mockup opacity at every scroll position', () => {
  const { container: atStart } = render(<RidgeScene progress={0} />);
  expect(atStart.querySelector('.mk-ridge-glow').style.opacity).toBe('');
  const { container: atEnd } = render(<RidgeScene progress={1} />);
  expect(atEnd.querySelector('.mk-ridge-glow').style.opacity).toBe('');
});

test('reduced motion is read without a matchMedia to read it from', () => {
  // jsdom has no matchMedia; the hook must not throw there
  expect(prefersReducedMotion()).toBe(false);
});

/* ------------------------------------------------ refresh 2026-09-22 §1 change 4
 * The route draws itself with scroll, 8% ahead of the climber, and the flag
 * lights once the reader reaches the report (progress > 0.86). */
import { routeDashOffset } from '../marketing/components/RidgeScene';

test('the route is drawn just ahead of the climber: undrawn fraction = 1 - min(1, p + 0.08)', () => {
  expect(routeDashOffset(0)).toBeCloseTo(0.92, 3);
  expect(routeDashOffset(0.5)).toBeCloseTo(0.42, 3);
  expect(routeDashOffset(0.92)).toBe(0);
  expect(routeDashOffset(1)).toBe(0);
  expect(routeDashOffset(7)).toBe(0);
  expect(routeDashOffset(-1)).toBeCloseTo(0.92, 3);
  expect(routeDashOffset(NaN)).toBeCloseTo(0.92, 3);
});

test('the path is normalised to a unit length and carries the offset inline, so the CSS dasharray of 1 reads as a fraction', () => {
  const { container } = render(<RidgeScene progress={0.25} />);
  const route = container.querySelector('.mk-ridge-route');
  expect(route).toHaveAttribute('pathLength', '1');
  expect(Number(route.style.strokeDashoffset)).toBeCloseTo(0.67, 3);
});

test('the flag is dim until the reader reaches the report, then lit', () => {
  const mid = (p) => render(<RidgeScene progress={p} />).container.querySelector('.mk-ridge-mid');
  expect(mid(0)).toHaveAttribute('data-summit', '0');
  expect(mid(0.86)).toHaveAttribute('data-summit', '0');
  expect(mid(0.9)).toHaveAttribute('data-summit', '1');
  expect(mid(1)).toHaveAttribute('data-summit', '1');
});
