/**
 * The Claude models switch on the platform console's Engage settings
 * (components/ClaudeModelsPanel.jsx, docs/design/claude-55-switch).
 *
 *   - it reads GET /platform/settings/claude-models through authFetch;
 *   - on (the default) says the 5.5 models are in use and the switch is checked;
 *   - a click POSTs the opposite value and shows what the server answered;
 *   - a refused change keeps the old state and says nothing was changed;
 *   - not connected: the switch is disabled and the reason is in words;
 *   - Engage settings is in the platform nav only, last, dusk-themed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClaudeModelsPanel, { NOT_CONNECTED } from '../components/ClaudeModelsPanel';
import { sectionsFor, PLATFORM_MODE } from '../config/consoleSections';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const view = (over = {}) => ({
  setting: 'claude-models', anthropic55: true, isDefault: true, connected: true,
  effective: 'anthropic-5-5', updatedAt: null, takesEffectWithinSeconds: 60, ...over,
});

function serve(...answers) {
  const queue = [...answers];
  global.fetch = jest.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next && next.status) return { ok: false, status: next.status, json: async () => next.body || {} };
    return { ok: true, status: 200, json: async () => next };
  });
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

it('reads the staff route once, through authFetch', async () => {
  serve(view());
  render(<ClaudeModelsPanel />);
  await screen.findByRole('switch');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/platform/settings/claude-models');
});

it('on by default: says so, and maps Haiku 4.5 to 5.5 and Sonnet 4.6 to 5.5', async () => {
  serve(view());
  render(<ClaudeModelsPanel />);
  const sw = await screen.findByRole('switch');
  expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(sw).not.toBeDisabled();
  expect(screen.getByText('Anthropic API, 5.5 models')).toBeInTheDocument();
  expect(screen.getByText(/the default/)).toBeInTheDocument();
  expect(screen.getByText('Claude Haiku 5.5')).toBeInTheDocument();
  expect(screen.getByText('Claude Sonnet 5.5')).toBeInTheDocument();
});

it('a click posts the opposite value and shows the saved state', async () => {
  serve(view(), view({ anthropic55: false, isDefault: false, effective: 'bedrock-4' }));
  render(<ClaudeModelsPanel />);
  fireEvent.click(await screen.findByRole('switch'));
  await screen.findByText(/Saved\. Every call is on Bedrock within a minute\./);
  const [url, init] = global.fetch.mock.calls[1];
  expect(url).toBe('https://api.test/platform/settings/claude-models');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ anthropic55: false });
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText('Bedrock, 4.x models')).toBeInTheDocument();
  expect(screen.getByText('Claude Haiku 4.5')).toBeInTheDocument();
});

it('a refused change keeps the old state and says nothing was changed', async () => {
  serve(view(), { status: 503, body: { error: 'Nothing was changed: the change could not be recorded in the audit log. Try again.' } });
  render(<ClaudeModelsPanel />);
  fireEvent.click(await screen.findByRole('switch'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was changed/);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

it('not connected: the switch is disabled, the reason is in words, and nothing is posted', async () => {
  serve(view({ connected: false, effective: 'bedrock-4' }));
  render(<ClaudeModelsPanel />);
  const sw = await screen.findByRole('switch');
  expect(sw).toBeDisabled();
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText(NOT_CONNECTED)).toBeInTheDocument();
  expect(screen.getByText('Bedrock, 4.x models')).toBeInTheDocument();
  fireEvent.click(sw);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
});

it('a failed read says why and shows no switch', async () => {
  serve({ status: 403, body: { error: 'This is an Engage staff screen.' } });
  render(<ClaudeModelsPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This is an Engage staff screen.');
  expect(screen.queryByRole('switch')).toBeNull();
});

it('Engage settings is the last platform section, dusk, and never in an org console', () => {
  const items = sectionsFor({ groups: ['admins'], mode: PLATFORM_MODE }).flatMap((g) => g.items);
  expect(items[items.length - 1].id).toBe('engagesettings');
  expect(items[items.length - 1].contentTheme).toBe('dark');
  const org = sectionsFor({ groups: ['admins'], orgRole: 'owner', orgType: 'team', orgName: 'T' }).flatMap((g) => g.items.map((i) => i.id));
  expect(org).not.toContain('engagesettings');
  expect(sectionsFor({ groups: ['hosts'], mode: PLATFORM_MODE })).toEqual([]);
});
