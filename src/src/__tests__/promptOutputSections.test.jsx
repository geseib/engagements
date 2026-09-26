/**
 * OUTPUT SECTIONS GET A FIELD IN THE EDITOR — components/PromptOutputSectionsField.jsx
 * and its wiring in AIPromptManager.jsx.
 *
 * The owner met "discussionQuestions and nextSteps will come back empty on
 * every round" in the editor, on a prompt whose sections were The Winning
 * Title · The Reveal · Keep Playing. The finding said to name a section so it
 * matches — and the editor had no field for sections at all: it passed the
 * SAVED `outputSections` to the checks and never sent any back, so the one
 * finding that is fixed in Output sections could not be fixed anywhere.
 * Spec: docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * rejects: the checks reading the saved sections instead of the ones on
 *          screen; a save that drops or rewrites sections nobody touched; no
 *          way back to the default shape; more than eight headings offered;
 *          a broken heading saving.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';

const ART_SECTIONS = [
  { heading: 'The Winning Title', guidance: 'Name the title the room voted for.' },
  { heading: 'The Reveal', guidance: 'The real title, and one fact.' },
  { heading: 'Keep Playing', guidance: 'One line into the next round.' },
];

const promptWith = (over = {}) => ({
  promptId: 'art1',
  name: 'Art & Creative Titles',
  gameType: 'call-and-answer',
  category: 'art-titles',
  status: 'active',
  isDefault: false,
  promptType: 'analysis',
  promptContent: {
    instructions: 'You are Workie.\n\n**The titles:**\n{responsesText}',
    outputFormat: '## The Winning Title\nSay which won.',
    ...over,
  },
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function serve(prompt) {
  const writes = [];
  authFetch.mockImplementation(async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT' || init.method === 'POST') {
      writes.push({ url, method: init.method, body: JSON.parse(init.body) });
      return reply(200, { promptId: 'art1', status: 'updated' });
    }
    return reply(200, { prompts: [prompt] });
  });
  return writes;
}

async function openEditor(prompt) {
  const writes = serve(prompt);
  render(<AIPromptManager />);
  fireEvent.click(await screen.findByTitle('Edit this prompt'));
  await screen.findByTestId('prompt-input-textarea');
  return writes;
}

const field = () => screen.getByTestId('prompt-sections');
const headingInputs = () => within(field()).queryAllByRole('textbox', { name: /^Heading \d/ });

beforeEach(() => authFetch.mockReset());

describe('the field shows what the prompt declares', () => {
  test('each declared heading and its guidance, in order', async () => {
    await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    expect(headingInputs().map((i) => i.value)).toEqual(['The Winning Title', 'The Reveal', 'Keep Playing']);
    expect(within(field()).getByRole('textbox', { name: 'Guidance for heading 2' })).toHaveValue('The real title, and one fact.');
  });

  test('with none declared, it says the default three run, and offers to write your own from them', async () => {
    await openEditor(promptWith());
    expect(headingInputs()).toHaveLength(0);
    expect(field()).toHaveTextContent(/Summary · Discussion Questions · Next Steps/);
    fireEvent.click(within(field()).getByRole('button', { name: /Write your own headings/ }));
    expect(headingInputs().map((i) => i.value)).toEqual(['Summary', 'Discussion Questions', 'Next Steps']);
  });
});

describe('the checks read the sections on screen', () => {
  test("renaming a heading so it matches clears the owner's finding, as it is typed", async () => {
    await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    const finding = () => screen.queryByTestId('ppf-finding-structured-fields-empty');
    const title = () => finding().querySelector('strong').textContent;
    expect(title()).toBe('discussionQuestions and nextSteps will come back empty on every round.');

    fireEvent.change(headingInputs()[2], { target: { value: 'Next steps' } });
    expect(title()).toBe('discussionQuestions will come back empty on every round.');

    fireEvent.click(within(field()).getByRole('button', { name: /Add a heading/ }));
    fireEvent.change(headingInputs()[3], { target: { value: 'Discussion topics' } });
    expect(finding()).toBeNull();
  });

  test('a heading the parser would refuse blocks the save, and says why', async () => {
    await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    fireEvent.change(headingInputs()[0], { target: { value: '## The Winning Title' } });
    expect(screen.getByTestId('ppf-finding-output-shape-discarded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});

describe('what a save sends', () => {
  test('the edited sections', async () => {
    const writes = await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    fireEvent.change(headingInputs()[2], { target: { value: 'Next steps' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].body.outputSections).toEqual([
      ART_SECTIONS[0], ART_SECTIONS[1], { heading: 'Next steps', guidance: 'One line into the next round.' },
    ]);
  });

  test('an untouched save leaves the sections alone — it sends none', async () => {
    const writes = await openEditor(promptWith());
    fireEvent.change(screen.getByTestId('prompt-output-textarea'), { target: { value: '## Summary\nThree sentences.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(writes.length).toBe(1));
    expect('outputSections' in writes[0].body).toBe(false);
  });

  test('"Use the default headings" clears the declaration', async () => {
    const writes = await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    fireEvent.click(within(field()).getByRole('button', { name: /Use the default headings/ }));
    expect(headingInputs()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].body.outputSections).toBeNull();
  });

  test('removing a heading removes exactly that one', async () => {
    await openEditor(promptWith({ outputSections: ART_SECTIONS }));
    fireEvent.click(within(field()).getByRole('button', { name: 'Remove heading 2' }));
    expect(headingInputs().map((i) => i.value)).toEqual(['The Winning Title', 'Keep Playing']);
  });

  test('eight is the most the engine accepts, so the ninth is not offered', async () => {
    await openEditor(promptWith({
      outputSections: Array.from({ length: 8 }, (_, i) => ({ heading: `Part ${i + 1}`, guidance: '' })),
    }));
    expect(within(field()).getByRole('button', { name: /Add a heading/ })).toBeDisabled();
  });
});
