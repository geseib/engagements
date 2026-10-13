/**
 * The site look on the platform console's Engage settings
 * (components/SiteSkinPanel.jsx, docs/design/themes/SPEC.md §5.4).
 *
 *   - it reads GET /platform/settings/site-skin through authFetch;
 *   - every registry skin is a radio, the one in use says In use;
 *   - Save is off until a different skin is chosen, then POSTs { skin, reason }
 *     and this tab wears the new skin at once;
 *   - a refused change says nothing was changed and the page keeps its skin;
 *   - Preview puts the chosen skin on this browser only, End preview takes it off;
 *   - Engage settings now holds both panels, under a neutral icon.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SiteSkinPanel from '../components/SiteSkinPanel';
import SkinProvider, { SKIN_PREVIEW_KEY } from '../components/SkinProvider';
import { SKINS } from '../config/skins';
import { sectionsFor, PLATFORM_MODE } from '../config/consoleSections';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.authFetchMock(...args),
}));

const view = (over = {}) => ({
  setting: 'site-skin', skin: 'classic', isDefault: true, skins: ['classic', 'present'], updatedAt: null, ...over,
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refuse = (status, body) => ({ ok: false, status, json: async () => body });

function serve(...answers) {
  const queue = [...answers];
  global.authFetchMock = jest.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
}

const mount = () => render(<SkinProvider><SiteSkinPanel /></SkinProvider>);

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  // SkinProvider's public GET /site: unusable here, so it changes nothing.
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  window.localStorage.clear();
  delete document.documentElement.dataset.skin;
});

it('reads the staff route once, through authFetch', async () => {
  serve(ok(view()));
  mount();
  await screen.findByRole('heading', { name: 'Site look' });
  expect(global.authFetchMock).toHaveBeenCalledTimes(1);
  expect(global.authFetchMock.mock.calls[0][0]).toBe('https://api.test/platform/settings/site-skin');
});

it('offers every skin in the registry, and marks the one in use', async () => {
  serve(ok(view({ skin: 'classic', isDefault: true })));
  mount();
  for (const s of SKINS) expect(await screen.findByRole('radio', { name: new RegExp(s.name) })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Classic/ })).toBeChecked();
  expect(screen.getAllByText('In use')).toHaveLength(1);
  expect(screen.getByText(/the default/)).toBeInTheDocument();
  expect(screen.getByText(/Never changed: every page wears Classic/)).toBeInTheDocument();
});

it('Save is off until a different skin is chosen', async () => {
  serve(ok(view()));
  mount();
  const save = await screen.findByRole('button', { name: /for everyone/ });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /Present/ }));
  expect(screen.getByRole('button', { name: 'Use Present for everyone' })).not.toBeDisabled();
});

it('a save POSTs the skin and the reason, and this tab wears it at once', async () => {
  serve(ok(view()), ok(view({ skin: 'present', isDefault: false, updatedAt: '2026-10-13T12:00:00.000Z' })));
  mount();
  fireEvent.click(await screen.findByRole('radio', { name: /Present/ }));
  fireEvent.change(screen.getByLabelText(/Why/), { target: { value: '  the owner walked test  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use Present for everyone' }));
  await screen.findByText(/Saved\. Engage wears Present for everyone/);
  const [url, init] = global.authFetchMock.mock.calls[1];
  expect(url).toBe('https://api.test/platform/settings/site-skin');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ skin: 'present', reason: 'the owner walked test' });
  await waitFor(() => expect(document.documentElement.dataset.skin).toBe('present'));
  expect(window.localStorage.getItem('engage.skin')).toBe('present');
  expect(screen.getByText(/Last changed .* by Engage staff/)).toBeInTheDocument();
});

it('a refused change says so, and the page keeps its skin', async () => {
  serve(ok(view()), refuse(503, { error: 'Nothing was changed: the change could not be recorded in the audit log. Try again.' }));
  mount();
  fireEvent.click(await screen.findByRole('radio', { name: /Present/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Use Present for everyone' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was changed/);
  expect(document.documentElement.dataset.skin).toBe('classic');
  expect(window.localStorage.getItem('engage.skin')).toBeNull();
});

it('Preview puts the chosen skin on this browser only; End preview takes it off', async () => {
  serve(ok(view()));
  mount();
  fireEvent.click(await screen.findByRole('radio', { name: /Present/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Present in this browser' }));
  await waitFor(() => expect(document.documentElement.dataset.skin).toBe('present'));
  expect(window.localStorage.getItem(SKIN_PREVIEW_KEY)).toBe('present');
  expect(screen.getByRole('status')).toHaveTextContent('This browser is previewing Present. Everyone else sees Classic.');
  // Nothing was saved for anyone else.
  expect(global.authFetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole('button', { name: 'End preview' })[0]);
  await waitFor(() => expect(document.documentElement.dataset.skin).toBe('classic'));
  expect(window.localStorage.getItem(SKIN_PREVIEW_KEY)).toBeNull();
});

it('a failed read says so and offers nothing to change', async () => {
  serve(refuse(403, { error: 'This is an Engage staff screen.' }));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('This is an Engage staff screen.');
  expect(screen.queryByRole('radio')).toBeNull();
});

it('Engage settings names both switches and wears a neutral icon', () => {
  const items = sectionsFor({ groups: ['admins'], mode: PLATFORM_MODE }).flatMap((g) => g.items);
  const s = items.find((i) => i.id === 'engagesettings');
  expect(s.icon).toBe('SlidersHorizontal');
  expect(s.subtitle).toMatch(/site look/);
  expect(s.contentTheme).toBe('dark');
});
