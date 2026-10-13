/**
 * TopLine (components/ui/TopLine.jsx, PLAN §3 unit L7): the markup contract.
 * The look is uiTopLinePalette.test.js; this drives the props.
 *
 *   - left and right render in their own spans, in that order;
 *   - a missing side is not rendered at all (no empty span to space against);
 *   - <b> inside a side is kept (it carries the --text emphasis);
 *   - className is passed through; other props land on the root;
 *   - the gallery fixture renders on dusk.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TopLine from '../components/ui/TopLine';
import TopLineFixture from '../components/ui/fixtures/TopLine';

test('left then right, each in its own span, inside .ui-top-line', () => {
  const { container } = render(<TopLine left={<><b>Offsite</b> · Round 5</>} right="Answering" />);
  const root = container.firstChild;
  expect(root.className).toBe('ui-top-line');
  const spans = root.children;
  expect(spans.length).toBe(2);
  expect(spans[0].className).toBe('ui-top-line-left');
  expect(spans[0].textContent).toBe('Offsite · Round 5');
  expect(spans[0].querySelector('b').textContent).toBe('Offsite');
  expect(spans[1].className).toBe('ui-top-line-right');
  expect(spans[1].textContent).toBe('Answering');
});

test.each([
  [{ right: 'Answering' }, ['ui-top-line-right']],
  [{ left: 'Offsite' }, ['ui-top-line-left']],
  [{ left: null, right: false }, []],
  [{ left: '', right: 0 }, ['ui-top-line-right']],
])('only the sides given render: %p', (props, classes) => {
  const { container } = render(<TopLine {...props} />);
  expect([...container.firstChild.children].map((c) => c.className)).toEqual(classes);
});

test('className and other props land on the root', () => {
  render(<TopLine data-testid="tl" className="present-top" aria-label="Where we are" left="Offsite" />);
  const el = screen.getByTestId('tl');
  expect(el.className).toBe('ui-top-line present-top');
  expect(el.getAttribute('aria-label')).toBe('Where we are');
});

test('the gallery fixture renders three lines on dusk', () => {
  const { container } = render(<TopLineFixture />);
  expect(container.querySelectorAll('[data-theme="dark"] .ui-top-line').length).toBe(3);
});
