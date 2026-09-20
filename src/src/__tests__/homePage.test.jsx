import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HomePage from '../marketing/HomePage';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch.mockReset();
  sessionStorage.clear();
  window.API_BASE = 'https://api.example/';
});

test('one h1, and it is about the reader, not the product', () => {
  render(<HomePage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/team/i);
});

test('the climb is told in order: problem, two modes, material, the room, the report', () => {
  render(<HomePage />);
  const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
  expect(ids).toEqual(['top', 'problem', 'modes', 'material', 'room', 'summit', 'start']);
});

test('a player who types the bare domain can still join from the hero', async () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.change(within(hero).getByLabelText(/session code/i), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(within(hero).getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('the hero register CTA asks for the register form and returns the host to /', () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.click(within(hero).getByRole('link', { name: /create a host account/i }));
  expect(navigateTo).toHaveBeenCalledWith('/auth?mode=register');
  expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
});

// Adapted from the brief: the mockup's mode-copy heading text does not itself
// contain the words "trivia" / "call and answer" (those live in a sibling
// `.mk-mode-tag` badge). HomePage nests that tag inside the h3 so the heading's
// accessible name carries it, keeping the mockup's markup/classes intact while
// giving the heading a name these queries can match.
test('both modes show the room and the phone', () => {
  render(<HomePage />);
  const modes = document.getElementById('modes');
  expect(within(modes).getByRole('heading', { name: /trivia/i })).toBeInTheDocument();
  expect(within(modes).getByRole('heading', { name: /call and answer/i })).toBeInTheDocument();
  expect(within(modes).getAllByRole('img')).toHaveLength(4);
});

test('the report is the one paper surface, and converts theme and markup together', () => {
  render(<HomePage />);
  const paper = document.querySelectorAll('[data-theme="light"]');
  expect(paper).toHaveLength(1);
  expect(document.getElementById('summit')).toContainElement(paper[0]);
  expect(within(paper[0]).getAllByText(/next steps/i).length).toBeGreaterThan(0);
});

// Adapted from the brief: the mockup's own link text for these two links is
// "See how it works" (closing CTA -> /how-it-works) and "See a full report,
// annotated" (below the report -> /reports), not the brief's placeholder
// names. Hrefs are unchanged.
test('the tour and the report page are one click away', () => {
  render(<HomePage />);
  expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '/how-it-works');
  expect(screen.getByRole('link', { name: /see a full report, annotated/i })).toHaveAttribute('href', '/reports');
});
