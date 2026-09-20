/**
 * Fix round 2: a non-numeric `headingLevel` (e.g. a typo'd prop) rendered
 * `<hnan>`, a tag no browser or test can reason about. SampleReport now
 * falls back to its documented default (h3) for anything that is not an
 * integer.
 */
import React from 'react';
import { render } from '@testing-library/react';
import SampleReport from '../marketing/components/SampleReport';

function titleTagName(container) {
  return container.querySelector('.mk-report-title').tagName;
}

test('headingLevel="x" renders the default h3 title, never an "nan" tag', () => {
  const { container } = render(<SampleReport headingLevel="x" />);
  expect(titleTagName(container)).toBe('H3');
  expect(container.querySelector('*[class]').closest('article').innerHTML.toLowerCase()).not.toMatch(/<hnan/);
});

test('headingLevel={undefined} renders the default h3 title, never an "nan" tag', () => {
  const { container } = render(<SampleReport headingLevel={undefined} />);
  expect(titleTagName(container)).toBe('H3');
  expect(container.querySelector('*[class]').closest('article').innerHTML.toLowerCase()).not.toMatch(/<hnan/);
});

test('a valid numeric headingLevel still clamps into range as before', () => {
  const { container: low } = render(<SampleReport headingLevel={0} />);
  expect(titleTagName(low)).toBe('H2');
  const { container: high } = render(<SampleReport headingLevel={99} />);
  expect(titleTagName(high)).toBe('H5');
});
