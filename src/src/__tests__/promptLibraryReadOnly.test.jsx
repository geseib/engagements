/**
 * THE PROMPT LIBRARIES, READ-ONLY OUTSIDE ENGAGE MODE.
 *
 * Spec: docs/superpowers/specs/2026-09-24-prompt-admin-engage-mode-design.md.
 *
 * The owner, 2026-09-24: "when using the improve prompt button, also did what
 * appear to be nice work, but it failed when i attempted to save it. I was in
 * User mode. but it turns out when you switch to engage mode you cant even see
 * the prompts from the admin page. so it seems that the workie advisor and ai
 * prompts should be only in the engage mode for now. team admins could view
 * them."
 *
 * So: inside an organisation both libraries are a VIEW — no Create, Edit,
 * Advisor, Retire, Copy to archive, defaults installer or status toggle, and a
 * row opens read-only. The server refuses every write there regardless
 * (admin/shared/prompt-access.js); this is the screen not offering a Save it
 * would refuse. And where a save IS refused, the editor says what the server
 * said instead of "Failed to update prompt".
 *
 * One mocked module — `../auth/authFetch` — as in promptEditorAngles.test.jsx.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';
import AIGenerationPromptEditor from '../components/AIGenerationPromptEditor';

const ENGAGE_ROW = {
  promptId: 'p-engage', name: 'Default Workie', gameType: 'call-and-answer', status: 'active',
  isDefault: true, scope: 'platform',
  promptContent: { instructions: 'Given {responsesText}', outputFormat: '## Summary\nSay what the room decided.' },
};
const TEAM_ROW = {
  promptId: 'p-team', name: 'Northwind Retro', gameType: 'call-and-answer', status: 'active',
  scope: 'org', orgId: 'org_1',
  promptContent: { instructions: 'Read {responsesText}', outputFormat: '## Next steps' },
};

const listOf = (prompts) => ({ ok: true, json: async () => ({ prompts }) });

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue(listOf([ENGAGE_ROW, TEAM_ROW]));
});

async function mountManager(props) {
  render(<AIPromptManager {...props} />);
  await screen.findByText('Default Workie');
}

describe('the Workie library, read-only', () => {
  // rejects: offering a control the server refuses — the owner's own save
  // failed in User mode after the advisor had done its work.
  test('offers no way to change anything', async () => {
    await mountManager({ readOnly: true });
    expect(screen.queryByText('Create New Prompt')).toBeNull();
    expect(screen.queryByText(/Populate Default Prompts/)).toBeNull();
    expect(screen.queryByTitle('Edit this prompt')).toBeNull();
    expect(screen.queryByTitle('Improve this prompt')).toBeNull();
    expect(screen.queryByText('Retire')).toBeNull();
    expect(screen.queryByText('Copy to archive')).toBeNull();
    // The status chip is a label, not a toggle.
    expect(screen.queryByRole('button', { name: /^(Active|Draft|Archived)$/ })).toBeNull();
  });

  test('says in plain words who can change them', async () => {
    await mountManager({ readOnly: true });
    expect(screen.getByTestId('pmgr-readonly-note').textContent)
      .toMatch(/Engage.s AI prompts\. Only Engage staff can change them\./);
  });

  // rejects: a frozen team Workie that cannot be told apart from Engage's.
  test('each row says which library it is in', async () => {
    await mountManager({ readOnly: true });
    const rowFor = (name) => screen.getAllByRole('row').find((r) => within(r).queryByText(name));
    expect(within(rowFor('Default Workie')).getByText('Engage')).toBeInTheDocument();
    expect(within(rowFor('Northwind Retro')).getByText('Your team')).toBeInTheDocument();
  });

  test('a row opens read-only: both halves shown, nothing to type in, no Save', async () => {
    await mountManager({ readOnly: true });
    const rowFor = (name) => screen.getAllByRole('row').find((r) => within(r).queryByText(name));
    fireEvent.click(within(rowFor('Default Workie')).getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: 'Default Workie' });
    expect(within(dialog).getByText('Given {responsesText}')).toBeInTheDocument();
    expect(within(dialog).getByText(/Say what the room decided\./)).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByText(/Save/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the Workie library in Engage mode is unchanged', () => {
  // rejects: read-only leaking into the one place prompts are authored.
  test('Create and Edit are there, and there is no View', async () => {
    await mountManager({});
    expect(screen.getByText('Create New Prompt')).toBeInTheDocument();
    expect(screen.getAllByTitle('Edit this prompt').length).toBe(2);
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    expect(screen.queryByTestId('pmgr-readonly-note')).toBeNull();
  });
});

describe('a refused save says what the server said', () => {
  // rejects: "Failed to update prompt", which is what the owner saw — the
  // server's body named the rule and the way out, and the editor threw it away.
  test('the server’s own reason reaches the screen', async () => {
    authFetch.mockResolvedValueOnce(listOf([ENGAGE_ROW]));
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Edit this prompt'));
    await screen.findByText('Edit AI Prompt');
    authFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Prompts are changed in Engage mode. Switch to Engage in the top bar, then try again.' }),
    });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText(/Prompts are changed in Engage mode\. Switch to Engage in the top bar/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Failed to update prompt/)).toBeNull();
  });

  test('a body with no reason still says the status', async () => {
    authFetch.mockResolvedValueOnce(listOf([ENGAGE_ROW]));
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Edit this prompt'));
    await screen.findByText('Edit AI Prompt');
    authFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText(/HTTP 502/)).toBeInTheDocument();
  });
});

describe('the output half does not recommend what the save refuses', () => {
  // rejects: help text telling authors to "Use [square brackets]" in a prompt
  // that the server then refuses for containing square brackets
  // (assertNoBracketDirections, admin/shared/template-variable-usage.js).
  test('neither the lede nor the placeholder uses square brackets', async () => {
    authFetch.mockResolvedValueOnce(listOf([]));
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByText('Create New Prompt'));
    await screen.findByText('Create New AI Prompt');
    const half = screen.getByTestId('prompt-half-writes');
    expect(half.querySelector('.prompt-half-lede').textContent).not.toMatch(/Use \[square brackets\]/);
    expect(screen.getByTestId('prompt-output-textarea').getAttribute('placeholder')).not.toMatch(/\[[^\]]+\](?!\()/);
  });
});

describe('the generation library, read-only', () => {
  const GEN = {
    promptId: 'gen-1', promptType: 'generation', gameType: 'trivia', scenarioType: 'workplace-trivia',
    name: 'Workplace Trivia', status: 'active', scope: 'platform',
    basePrompt: 'Write trivia about the modern office.', outputFormat: 'JSON array of questions',
  };

  test('no Create, no Edit, no status toggle; a row opens read-only', async () => {
    authFetch.mockResolvedValue(listOf([GEN]));
    render(<AIGenerationPromptEditor readOnly />);
    await screen.findByText('Workplace Trivia');
    expect(screen.queryByText('Create New Prompt')).toBeNull();
    expect(screen.queryByTitle('Edit this prompt')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Active|Draft|Archived)$/ })).toBeNull();
    expect(screen.getByTestId('pgen-readonly-note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: 'Workplace Trivia' });
    expect(within(dialog).getByText('Write trivia about the modern office.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });
});
