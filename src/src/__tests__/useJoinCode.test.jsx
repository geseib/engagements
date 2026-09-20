import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import useJoinCode, { codeFromUrl, CODE_LENGTH } from '../hooks/useJoinCode';
import { navigateTo } from '../auth/navigate';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

function Probe() {
  const j = useJoinCode();
  return (
    <form onSubmit={j.handleSubmit}>
      <input aria-label="code" value={j.code} onChange={j.handleChange} onPaste={j.handlePaste} />
      <p data-testid="note">{j.note}</p>
      <p data-testid="missing">{j.missing || ''}</p>
      <button type="submit" disabled={!j.canSubmit}>go</button>
    </form>
  );
}
const field = () => screen.getByLabelText('code');
const respond = (status) => global.fetch.mockResolvedValueOnce({ status, ok: status < 300, json: async () => ({}) });

beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); window.API_BASE = 'https://api.example/'; });

test('the code length is four', () => expect(CODE_LENGTH).toBe(4));

test('codeFromUrl reads both shapes this app produces', () => {
  expect(codeFromUrl('https://x/play?gameId=4821')).toBe('4821');
  expect(codeFromUrl('https://x/play/4821')).toBe('4821');
  expect(codeFromUrl('https://x/play?gameId=48210')).toBeNull();
});

test('noise is removed, and submit unlocks only at four digits', () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '48-2' } });
  expect(field()).toHaveValue('482');
  expect(screen.getByRole('button')).toBeDisabled();
  fireEvent.change(field(), { target: { value: '48 21' } });
  expect(screen.getByRole('button')).toBeEnabled();
});

test('more than four pasted digits is refused and keeps what was there', () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '12' } });
  fireEvent.paste(field(), { clipboardData: { getData: () => '123456' } });
  expect(field()).toHaveValue('12');
  expect(screen.getByTestId('note')).toHaveTextContent('That is 6 digits');
});

test('404 stays put and names the code', async () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '4821' } });
  respond(404);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByTestId('missing')).toHaveTextContent('4821'));
  expect(navigateTo).not.toHaveBeenCalled();
});

test('200, 500 and a network failure all navigate', async () => {
  for (const arrange of [() => respond(200), () => respond(500), () => global.fetch.mockRejectedValueOnce(new Error('x'))]) {
    navigateTo.mockClear();
    const { unmount } = render(<Probe />);
    fireEvent.change(field(), { target: { value: '4821' } });
    arrange();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
    unmount();
  }
});
