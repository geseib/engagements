import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinCodeEntry from '../components/JoinCodeEntry';
import { navigateTo } from '../auth/navigate';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const field = () => screen.getByLabelText(/session code/i);

beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); window.API_BASE = 'https://api.example/'; });

test('it does not steal focus from a marketing page', () => {
  // rejects: copying RootPage's autoFocus, which on the home page would scroll
  // a reader to the field and raise a phone keyboard over the headline
  render(<JoinCodeEntry />);
  expect(field()).not.toHaveFocus();
});

test('a valid code joins', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('an unknown code says so inline, as an alert', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 404, ok: false, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is running under 4821');
  expect(navigateTo).not.toHaveBeenCalled();
});

test('every class is in the jce namespace', () => {
  const { container } = render(<JoinCodeEntry />);
  const names = [...container.querySelectorAll('[class]')].flatMap((el) => [...el.classList]);
  expect(names.filter((n) => !n.startsWith('jce'))).toEqual([]);
});

// Ruling 5: typing "48" renders the digits in the first two cells and marks
// the third cell as next -- DOM facts (text + class), not geometry.
test('typing partial digits fills cells left to right and marks the next one', () => {
  const { container } = render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '48' } });
  const cells = container.querySelectorAll('.jce-cell');
  expect(cells).toHaveLength(4);
  expect(cells[0]).toHaveTextContent('4');
  expect(cells[1]).toHaveTextContent('8');
  expect(cells[2]).toHaveTextContent('');
  expect(cells[2].classList.contains('jce-next')).toBe(true);
  expect(cells[3].classList.contains('jce-next')).toBe(false);
});
