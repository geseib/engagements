import React from 'react';
import { render, screen, within } from '@testing-library/react';
import HowItWorksPage from '../marketing/HowItWorksPage';
import UseCasesPage from '../marketing/UseCasesPage';
import { HOW_STEPS } from '../marketing/content/howItWorks';
import { USE_CASES } from '../marketing/content/useCases';
import { CLIPS } from '../marketing/content/clips';

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
