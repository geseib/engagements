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

test('reduced motion is read without a matchMedia to read it from', () => {
  // jsdom has no matchMedia; the hook must not throw there
  expect(prefersReducedMotion()).toBe(false);
});
