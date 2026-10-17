/**
 * THE WALL'S RESULTS ALWAYS FIT (walk of dev 26af5fc8, session 5051, F1).
 * Five long ideas at 1280x720 on Room measured 992px of content in a 571px
 * main and --fit stayed 1: the fitter never re-ran when the rows arrived (its
 * key held no row text), and past the floor it had no lever for the tally.
 * Now, in order: shrink to the profile's floor; then clamp each idea to two
 * lines; then show fewer rows ("and N more ideas"). Never the top row, never
 * the heading.
 *
 * jsdom has no layout, so the main's height is modelled from what is shown:
 * rows still visible, at three or two lines, scaled by --fit.
 * rejects: a refit that never happens; the top row hidden; a "more" line that
 * does not count the rows the fitter took down.
 */
import { fitCanvas } from '../present/PresentStage';
import { presentFitKey } from '../PresentPage';

function canvasWith(rows, { box = 571, lineH = 60, more = 0 } = {}) {
  const div = document.createElement('div');
  div.innerHTML = `<div class="present-main"><p class="present-task">t</p><div class="present-tally is-ideas">${
    Array.from({ length: rows }, (_, i) => `<div class="present-trow" data-row="${i}"></div>`).join('')
  }</div><p class="present-more" data-more="${more}"${more ? '' : ' hidden'}>${more ? `and ${more} more ideas` : ''}</p></div>`;
  const main = div.querySelector('.present-main');
  const tally = div.querySelector('.present-tally');
  const height = () => {
    const fit = Number(div.style.getPropertyValue('--fit') || 1);
    const lines = tally.dataset.clamp === '2' ? 2 : 3;
    const shown = [...div.querySelectorAll('.present-trow')].filter((r) => !r.hidden).length;
    return Math.round(shown * lines * lineH * fit + 40);
  };
  Object.defineProperty(main, 'scrollHeight', { get: height });
  div.dataset.box = String(box);
  Object.defineProperty(main, 'clientHeight', { get: () => Number(div.dataset.box) });
  return div;
}

test('shrinking to the floor is enough: no clamp, every row', () => {
  const div = canvasWith(3, { box: 571 }); // 3*3*60=540+40 > 571 at 1, fits at ~.9
  expect(fitCanvas(div, 'room')).toBe('ok');
  expect(Number(div.style.getPropertyValue('--fit'))).toBeLessThan(1);
  expect(div.querySelector('.present-tally').dataset.clamp).toBeUndefined();
  expect([...div.querySelectorAll('.present-trow')].every((r) => !r.hidden)).toBe(true);
});

test('past the floor: ideas clamp to two lines before any row goes', () => {
  const div = canvasWith(5, { box: 571 }); // 5*3*60*.55+40=535 fits at the floor on Room… use TV's .78
  expect(fitCanvas(div, 'tv')).toBe('ok');
  expect(div.style.getPropertyValue('--fit')).toBe('0.78');
  expect(div.querySelector('.present-tally').dataset.clamp).toBe('2'); // 5*2*60*.78+40=508
  expect([...div.querySelectorAll('.present-trow')].every((r) => !r.hidden)).toBe(true);
});

test('still too tall: rows go from the bottom, never the top, and the more line counts them', () => {
  const div = canvasWith(6, { box: 400, more: 1 });
  expect(fitCanvas(div, 'tv')).toBe('ok');
  const rows = [...div.querySelectorAll('.present-trow')];
  expect(rows[0].hidden).toBe(false);
  const hidden = rows.filter((r) => r.hidden).length;
  expect(hidden).toBeGreaterThan(0);
  expect(rows.slice(-hidden).every((r) => r.hidden)).toBe(true);
  const more = div.querySelector('.present-more');
  expect(more.hidden).toBe(false);
  expect(more.textContent).toBe(`and ${1 + hidden} more ideas`);
});

test('a refit starts clean: rows back, no clamp, the more line as the model gave it', () => {
  const div = canvasWith(6, { box: 400, more: 0 });
  fitCanvas(div, 'tv');
  div.dataset.box = '5000';
  expect(fitCanvas(div, 'tv')).toBe('ok');
  expect([...div.querySelectorAll('.present-trow')].every((r) => !r.hidden)).toBe(true);
  expect(div.querySelector('.present-tally').dataset.clamp).toBeUndefined();
  expect(div.querySelector('.present-more').hidden).toBe(true);
});

test('the fit key changes when the rows arrive, so the fitter runs again', () => {
  const loading = presentFitKey({ moment: 'RESULTS', title: 'T', rows: [], more: 0 });
  const landed = presentFitKey({ moment: 'RESULTS', title: 'T', rows: [{ idea: 'A long idea' }], more: 0 });
  expect(landed).not.toBe(loading);
});
