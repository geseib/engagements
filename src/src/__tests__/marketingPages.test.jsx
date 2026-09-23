import React from 'react';
import { render, screen, within } from '@testing-library/react';
import HowItWorksPage from '../marketing/HowItWorksPage';
import UseCasesPage from '../marketing/UseCasesPage';
import ReportsPage from '../marketing/ReportsPage';
import { HOW_STEPS } from '../marketing/content/howItWorks';
import { USE_CASES } from '../marketing/content/useCases';
import { CLIPS } from '../marketing/content/clips';
import { REPORT_CALLOUTS, REPORT_SHARING } from '../marketing/content/reports';

/** Every string leaf of a content export, so a test can assert presence
 * without retyping the copy it is checking. */
function stringLeaves(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

test('the tour is six steps, in the order a session actually runs', () => {
  // The mockup's own <h3> text per step (02-how-it-works.html), not the
  // brief's shorthand ['Create','Join',...] — see task-9-report.md ruling 1.
  expect(HOW_STEPS.map((s) => s.title)).toEqual([
    'Create a session from a set',
    'Everyone joins by QR or code',
    'Ask',
    'Vote',
    'Results',
    'The report',
  ]);
  expect(HOW_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('every step points at a clip slot that exists', () => {
  for (const step of HOW_STEPS) expect(CLIPS[step.slot]).toBeDefined();
});

test('the tour tells the truth about trivia: it has no vote', () => {
  // config/gameTypes.js: GAME_TYPES.trivia.phases is ['ASK','RESULTS']. The
  // mockup's own sentence (step 4) says so directly.
  render(<HowItWorksPage />);
  expect(screen.getByText(/trivia does not have this phase/i)).toBeInTheDocument();
});

test('the tour renders one h1 and six numbered steps', () => {
  render(<HowItWorksPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('mk-step'))).toHaveLength(6);
});

test("headings descend without a skip: h1, then every step's own h2", () => {
  render(<HowItWorksPage />);
  const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }
});

test('four use cases, each naming the kind of set it runs on and ending at a door', () => {
  expect(USE_CASES).toHaveLength(4);
  render(<UseCasesPage />);
  for (const c of USE_CASES) {
    const heading = screen.getByRole('heading', { name: c.title });
    const article = heading.closest('article');
    expect(within(article).getByText(c.setType.kind, { selector: 'b' })).toBeInTheDocument();
  }
  expect(screen.getAllByRole('link', { name: /create a host account/i }).length).toBeGreaterThanOrEqual(2);
});

test('each use case is an article labelled by its own heading', () => {
  render(<UseCasesPage />);
  for (const c of USE_CASES) {
    const heading = screen.getByRole('heading', { name: c.title });
    const article = heading.closest('article');
    expect(article).not.toBeNull();
    expect(article).toHaveAttribute('aria-labelledby', heading.id);
  }
});

test('one h1 on the use-cases page, headings descend without a skip', () => {
  render(<UseCasesPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }
});

test('six callouts, numbered to match the pins on the sample sheet', () => {
  expect(REPORT_CALLOUTS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
  const { container } = render(<ReportsPage />);
  const pins = container.querySelectorAll('.mk-report .mk-pin');
  expect(pins).toHaveLength(6);
  expect([...pins].map((p) => p.textContent)).toEqual(REPORT_CALLOUTS.map((c) => String(c.n)));
});

test('the sheet is labelled as a sample, because it is one', () => {
  render(<ReportsPage />);
  expect(screen.getByRole('article', { name: /sample session report/i })).toBeInTheDocument();
  expect(screen.getByText(/sample from an invented session/i)).toBeInTheDocument();
});

test('export and sharing say only what exists: PDF, print, a saved link', () => {
  // Adapted from the brief's /temporary or permanent/i to the mockup's own
  // wording per ruling 4 — same intent: PDF is mentioned, and the retention
  // choice is too. It said "kept permanently" until 2026-09-23; nothing is:
  // the longer choice is a year (template-clean.yaml DeleteOldReports).
  render(<ReportsPage />);
  // getByText(/PDF/) is ambiguous since fix round 2: the sheet's inert
  // "Export PDF" footer label also matches "PDF", alongside this export
  // card's own heading. getAllByText avoids the "found multiple" failure.
  expect(screen.getAllByText(/PDF/).length).toBeGreaterThan(0);
  expect(screen.getByText(/kept for 90 days or a year/i)).toBeInTheDocument();
  // rejects: promising "permanently" again.
  expect(screen.queryByText(/permanent/i)).toBeNull();
});

test('every callout and sharing string from the content module is on the page', () => {
  render(<ReportsPage />);
  for (const str of [...stringLeaves(REPORT_CALLOUTS), ...stringLeaves(REPORT_SHARING)]) {
    expect(screen.getAllByText(str, { exact: false }).length).toBeGreaterThan(0);
  }
});

test('exactly one light-paper surface on the reports page', () => {
  const { container } = render(<ReportsPage />);
  expect(container.querySelectorAll('[data-theme="light"]')).toHaveLength(1);
});

test('the word favourite/favorite never appears in the reports content', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'content', 'reports.js'), 'utf8');
  expect(/favou?rite/i.test(src)).toBe(false);
});

test('one h1 on the reports page, headings descend without a skip', () => {
  render(<ReportsPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }
});

test('the sample sheet precedes the callout list in the document (reading/tab order matches the visual layout)', () => {
  // Fix round 1: an earlier version put the callout <ol> first in the DOM
  // and used CSS `order` to draw the sheet back on the left, which made
  // reading/tab order diverge from what is seen (WCAG 1.3.2 / 2.4.3).
  // compareDocumentPosition is a DOM-order question, not a geometry one —
  // jsdom models it correctly.
  const { container } = render(<ReportsPage />);
  const sheet = container.querySelector('.mk-report');
  const list = container.querySelector('.mk-callouts');
  expect(sheet).not.toBeNull();
  expect(list).not.toBeNull();
  // eslint-disable-next-line no-bitwise
  expect(sheet.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('ReportsPage.css declares no order: outside a @media block', () => {
  // Fix round 1: `order` was used only to fake the sheet/callouts visual
  // layout back after a DOM-order swap. That swap is gone; this guards
  // against it (or anything like it) coming back silently. A breakpoint's
  // own `order` (none exist here, but the mockup could add one) is fine —
  // only a top-level declaration, which by construction exists purely to
  // override normal document flow, is a violation.
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'ReportsPage.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // strip comments first

  /** Depth of @media nesting at each character offset in `css`. */
  function mediaDepthAt(text) {
    const depthAtOffset = new Array(text.length).fill(0);
    let depth = 0;
    const mediaStartDepths = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '{') {
        depth += 1;
        if (/@media[^{]*$/.test(text.slice(Math.max(0, i - 60), i))) mediaStartDepths.push(depth);
      } else if (text[i] === '}') {
        if (mediaStartDepths[mediaStartDepths.length - 1] === depth) mediaStartDepths.pop();
        depth -= 1;
      }
      depthAtOffset[i] = mediaStartDepths.length;
    }
    return depthAtOffset;
  }

  const depthAtOffset = mediaDepthAt(css);
  const topLevelOrderDecls = [...css.matchAll(/\border\s*:/g)].filter((m) => depthAtOffset[m.index] === 0);
  expect(topLevelOrderDecls).toEqual([]);
});

/* ------------------------------------------------------- fix round 2: the
 * sheet's "Export PDF" / "Copy shareable link" looked like live buttons but
 * did nothing — SampleReport now renders them as inert, aria-hidden spans,
 * and its `footerLinks` prop is gone entirely. */
test('the sample sheet on /reports has no live links or buttons of its own', () => {
  render(<ReportsPage />);
  const article = screen.getByRole('article', { name: /sample session report/i });
  expect(within(article).queryAllByRole('link')).toHaveLength(0);
  expect(within(article).queryAllByRole('button')).toHaveLength(0);
  expect(within(article).getByText('Export PDF')).toHaveAttribute('aria-hidden', 'true');
  expect(within(article).getByText('Copy shareable link')).toHaveAttribute('aria-hidden', 'true');
});

test('/reports has no link to itself, except the nav item that marks it current', () => {
  render(<ReportsPage />);
  const selfLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/reports');
  expect(selfLinks).toHaveLength(1);
  expect(selfLinks[0]).toHaveAttribute('aria-current', 'page');
});
