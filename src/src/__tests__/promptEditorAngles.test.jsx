/**
 * ROUND ANGLES IN THE WORKIE EDITOR — components/RoundAnglesField.jsx and its
 * wiring in components/AIPromptManager.jsx.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * Each Call & Answer round, the lambda picks one angle for Workie to talk
 * about (the question, the race, the event, a fact) from a house mix. A
 * Workie may carry its own `angleWeights`; a box left empty uses the house
 * weight, 0 turns an angle off, and "Use the house mix" clears the override.
 *
 * THE SAVE MUST NEVER WIPE WHAT IT DID NOT LOAD. `null` on an update means
 * "back to the house mix", so an editor that sent `null` for a Workie whose
 * weights it never showed would silently erase them. Untouched, the editor
 * sends back exactly what it loaded, and nothing at all when there was none.
 *
 * One mocked module — `../auth/authFetch` — as in promptEditorHalves.test.jsx.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';
import RoundAnglesField from '../components/RoundAnglesField';
import { ROUND_ANGLES } from '../config/roundAngles';

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ prompts: [] }) });
});

const box = (key) => document.querySelector(`input[data-angle="${key}"]`);

describe('RoundAnglesField', () => {
  test('four boxes for a Call & Answer Workie, each showing its house weight', () => {
    render(<RoundAnglesField gameType="call-and-answer" value={undefined} onChange={() => {}} />);
    for (const a of ROUND_ANGLES) {
      expect(box(a.key)).toBeInTheDocument();
      expect(box(a.key).placeholder).toBe(String(a.house));
      expect(box(a.key).value).toBe('');
    }
  });

  test('nothing for a game type that draws no angles', () => {
    const { container } = render(<RoundAnglesField gameType="trivia" value={undefined} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a typed weight becomes an override of just that angle', () => {
    const onChange = jest.fn();
    render(<RoundAnglesField gameType="call-and-answer" value={undefined} onChange={onChange} />);
    fireEvent.change(box('race'), { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith({ race: 60 });
  });

  test('0 turns an angle off rather than meaning empty', () => {
    const onChange = jest.fn();
    render(<RoundAnglesField gameType="call-and-answer" value={{ race: 60 }} onChange={onChange} />);
    fireEvent.change(box('fact'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ race: 60, fact: 0 });
  });

  test('emptying the last box goes back to the house mix', () => {
    const onChange = jest.fn();
    render(<RoundAnglesField gameType="call-and-answer" value={{ race: 60 }} onChange={onChange} />);
    fireEvent.change(box('race'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test('a fraction or a number over 100 is not taken', () => {
    const onChange = jest.fn();
    render(<RoundAnglesField gameType="call-and-answer" value={undefined} onChange={onChange} />);
    fireEvent.change(box('race'), { target: { value: '1.5' } });
    fireEvent.change(box('race'), { target: { value: '101' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('"Use the house mix" clears the override, and is off when there is none', () => {
    const onChange = jest.fn();
    const { rerender } = render(<RoundAnglesField gameType="call-and-answer" value={{ race: 60 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /use the house mix/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    rerender(<RoundAnglesField gameType="call-and-answer" value={undefined} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /use the house mix/i })).toBeDisabled();
  });
});

async function openExisting(extra) {
  authFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      prompts: [{
        promptId: 'p1', name: 'Advisor Read', gameType: 'call-and-answer', status: 'active',
        promptContent: { instructions: 'Given {responsesText}', outputFormat: '## Summary', ...extra },
      }],
    }),
  });
  render(<AIPromptManager />);
  fireEvent.click(await screen.findByTitle('Edit this prompt'));
  await screen.findByText('Edit AI Prompt');
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
}

async function savedBody() {
  fireEvent.click(screen.getByText('Save Changes'));
  let body;
  await waitFor(() => {
    const put = authFetch.mock.calls.find((c) => c[1] && c[1].method === 'PUT');
    expect(put).toBeTruthy();
    body = JSON.parse(put[1].body);
  });
  return body;
}

describe('the editor', () => {
  test('shows the Workie\'s own weights', async () => {
    await openExisting({ angleWeights: { race: 70, fact: 0 } });
    expect(box('race').value).toBe('70');
    expect(box('fact').value).toBe('0');
    expect(box('question').value).toBe('');
  });

  test('an untouched save sends back exactly the weights it loaded', async () => {
    await openExisting({ angleWeights: { race: 70 } });
    expect((await savedBody()).angleWeights).toEqual({ race: 70 });
  });

  test('an untouched save of a Workie with none sends no angleWeights at all', async () => {
    await openExisting({});
    expect('angleWeights' in (await savedBody())).toBe(false);
  });

  test('a changed weight is saved', async () => {
    await openExisting({});
    fireEvent.change(box('race'), { target: { value: '0' } });
    expect((await savedBody()).angleWeights).toEqual({ race: 0 });
  });

  test('"Use the house mix" saves null, which clears the override', async () => {
    await openExisting({ angleWeights: { race: 70 } });
    fireEvent.click(screen.getByRole('button', { name: /use the house mix/i }));
    expect((await savedBody()).angleWeights).toBeNull();
  });
});
