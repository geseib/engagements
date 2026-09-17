/**
 * THE ARCHIVE SCREEN — components/ArchivePanel.jsx, with the network mocked at authFetch.
 *
 * Built to docs/design/admin-redesign/20-archive.html and 21-archive-down.html on the list
 * idiom every library screen shares (ListControls + useListControls, a table, two empty
 * states with drop-exits, Modal confirms that state the consequence).
 *
 * rejects: a call to the archive service that bypasses the tier; the hand-upload form coming
 * back; a backup that does not say which environment it came from; an export request that
 * does not name each set's library, or that includes an organisation's; an import that is not
 * confirmed, or whose result hides what went live; an outage rendered as an empty archive;
 * a "nothing matches" that offers no way out; a filter that goes back to the server.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
import ArchivePanel from '../components/ArchivePanel';

const reply = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const PROD = { id: 'prod', label: 'PROD', detail: 'API x' };
const snapshot = (id, tier, createdAt) => ({
  ArchiveId: id, Title: 'Team Retro', ContentType: 'questionset', Category: 'call-and-answer', FileSize: 2048, CreatedAt: createdAt,
  Tags: [tier, 'schema:engage.set/1', 'scope:platform', 'source:platform/teamretro', `exportedAt:${createdAt}`, 'call-and-answer', 'questions:12'],
});
const LATEST = snapshot('arc-2', 'prod', '2026-09-15T12:00:00.000Z');
const EARLIER = snapshot('arc-1', 'dev', '2026-09-01T12:00:00.000Z');
const LEGACY = { ArchiveId: 'arc-0', Title: 'Old Quiz (dev)', ContentType: 'questionset', Category: 'trivia', FileSize: 100, CreatedAt: '2026-08-01T12:00:00.000Z', Tags: ['dev', 'trivia'] };
const PROMPT = {
  ArchiveId: 'arc-p', Title: 'Consultant voice', ContentType: 'prompt', Category: 'call-and-answer', FileSize: 6000, CreatedAt: '2026-07-30T08:00:00.000Z',
  Tags: ['test', 'schema:engage.prompt/1', 'scope:platform', 'source:platform/prompt/consultant', 'call-and-answer'],
};

function route(handlers) {
  authFetch.mockImplementation((url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const address = String(url);
    const hit = handlers.find(([m, pattern]) => m === method && pattern.test(address));
    return hit ? hit[2](address, init) : reply({ error: `unrouted ${method} ${address}` }, 404);
  });
}
const callsTo = (method, pattern) => authFetch.mock.calls.filter(([url, init = {}]) => String(init.method || 'GET').toUpperCase() === method && pattern.test(String(url)));
const LIST = ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST] })];
const LIST_WITH_PROMPT = ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST, PROMPT] })];
const row = (id) => screen.getByTestId(`archive-item-${id}`);
const dialog = () => screen.getByRole('dialog');

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.test.invalid/prod/';
  global.fetch = jest.fn();
});

/* ------------------------------------------------------------------ the list */
test('the list comes through the tier, never from the archive service', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByTestId('archive-item-arc-2')).toBeInTheDocument();
  expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('it is one table under the console head, not three tabs of cards', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.queryByText('Browse Archive')).not.toBeInTheDocument();
  expect(screen.queryByText('Upload New Item')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /export from prod…/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /import 0 selected/i })).toBeDisabled();
});

test('each backup says which environment it came from, and the list filters by it', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  const latest = await screen.findByTestId('archive-item-arc-2');
  expect(within(latest).getByTestId('archive-item-tier')).toHaveTextContent('prod');
  expect(within(row('arc-1')).getByTestId('archive-item-tier')).toHaveTextContent('dev');
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'dev' } });
  expect(screen.queryByTestId('archive-item-arc-2')).not.toBeInTheDocument();
  expect(row('arc-1')).toBeInTheDocument();
  expect(row('arc-0')).toBeInTheDocument();
  // The filter is the browser's: nothing went back to the tier for it.
  expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(1);
});

test("a source's backups sit together, newest first, and say so", async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  const order = screen.getAllByTestId(/^archive-item-arc-/).map((el) => el.getAttribute('data-testid'));
  expect(order).toEqual(['archive-item-arc-2', 'archive-item-arc-1', 'archive-item-arc-0']);
  expect(within(row('arc-2')).getByTestId('archive-item-snapshot')).toHaveTextContent('Latest of 2 backups');
  expect(within(row('arc-1')).getByTestId('archive-item-snapshot')).toHaveTextContent('Earlier backup');
});

test('content type and engagement type filter in the browser, and the count line says so', async () => {
  route([LIST_WITH_PROMPT]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-p');
  expect(screen.getByText('4 items')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'prompt' } });
  expect(screen.queryByTestId('archive-item-arc-2')).not.toBeInTheDocument();
  expect(row('arc-p')).toBeInTheDocument();
  expect(screen.getByText('4 items · 1 shown')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Content type'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Engagement type'), { target: { value: 'trivia' } });
  expect(screen.getAllByTestId(/^archive-item-arc-/)).toHaveLength(1);
  expect(row('arc-0')).toBeInTheDocument();
  expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(1);
});

test('"nothing matches" is not "nothing exists": it names the filter and offers a way out', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'test' } });
  expect(screen.getByRole('heading', { name: /no items match this filter/i })).toBeInTheDocument();
  expect(screen.queryByText(/nothing has been backed up/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /environment: test/i }));
  expect(await screen.findByTestId('archive-item-arc-2')).toBeInTheDocument();
});

test('an empty archive says nothing has been backed up yet, and offers Export', async () => {
  route([['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [] })]]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByRole('heading', { name: /nothing has been backed up yet/i })).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /export from prod…/i })).toBeEnabled();
});

/* -------------------------------------------------------------- the outage */
test('an archive that does not answer is an outage, not an empty archive, and Try again asks again', async () => {
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  let calls = 0;
  route([['GET', /admin\/archive\/items(\?|$)/, () => { calls += 1; return calls === 1 ? Promise.reject(new TypeError('Failed to fetch')) : reply({ items: [LATEST] }); }]]);
  render(<ArchivePanel environment={PROD} />);
  const down = await screen.findByRole('alert');
  expect(down).toHaveTextContent(/the archive did not answer/i);
  expect(down).toHaveTextContent(/separate stack/i);
  expect(down).toHaveTextContent(/Failed to fetch/);
  expect(screen.queryByText(/nothing has been backed up/i)).not.toBeInTheDocument();
  fireEvent.click(within(down).getByRole('button', { name: /try again/i }));
  expect(await screen.findByTestId('archive-item-arc-2')).toBeInTheDocument();
  expect(calls).toBe(2);
  logged.mockRestore();
});

test("the tier's refusal is shown as its own words, not as an outage", async () => {
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  route([['GET', /admin\/archive\/items(\?|$)/, () => reply({ error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." }, 403)]]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByText(/Switch to Engage/)).toBeInTheDocument();
  expect(screen.queryByText(/the archive did not answer/i)).not.toBeInTheDocument();
  expect(logged).toHaveBeenCalledWith('Failed to load archive items:', expect.any(Error));
  logged.mockRestore();
});

/* ------------------------------------------------------------- selecting */
test('ticking rows counts them, select-all takes every shown row, and the head button names the count', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(within(row('arc-2')).getByRole('checkbox', { name: /select team retro/i }));
  expect(screen.getByRole('button', { name: /import 1 selected/i })).toBeEnabled();
  expect(screen.getByText('3 items · 1 selected')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'dev' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /select all shown/i }));
  expect(screen.getByRole('button', { name: /import 3 selected/i })).toBeInTheDocument();
  expect(screen.getByText('3 items · 2 shown · 3 selected')).toBeInTheDocument();
});

/* ------------------------------------------------------------- importing */
test('an import is confirmed in a dialog that names the environment and the consequence, then reports what went live', async () => {
  route([
    LIST,
    ['POST', /admin\/import-from-archive$/, () => reply({
      results: { successful: [{ archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'created', version: 1, active: true }], failed: [] },
      becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
      media: { copied: 0, kept: 0, missing: [] },
    })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  expect(screen.getByRole('heading', { name: /importing 1 item into prod/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(within(dialog()).getByRole('heading', { name: /restore 1 backup into prod\?/i })).toBeInTheDocument();
  expect(dialog()).toHaveTextContent(/new version and switches to it/i);
  expect(dialog()).toHaveTextContent(/live for every organisation/i);
  fireEvent.click(within(dialog()).getByRole('button', { name: /^restore 1$/i }));
  await waitFor(() => expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/import-from-archive$/)[0][1].body)).toEqual({ selectedItems: ['arc-2'] });
  expect(await screen.findByText('Now live for every organisation: Team Retro.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a declined confirmation sends nothing, and every exit of the dialog is the same exit', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel$/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^close$/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(0);
});

test('a restore in flight cannot be sent twice', async () => {
  route([LIST, ['POST', /admin\/import-from-archive$/, () => new Promise(() => {})]]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^restore 1$/i }));
  await waitFor(() => expect(within(dialog()).getByRole('button', { name: /restoring/i })).toBeDisabled());
  fireEvent.click(within(dialog()).getByRole('button', { name: /restoring/i }));
  expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(1);
});

test('an unknown environment is named as this environment, never guessed', async () => {
  route([LIST]);
  render(<ArchivePanel environment={{ id: 'unknown', label: 'UNKNOWN', detail: '' }} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(within(dialog()).getByRole('heading', { name: /into this environment\?/i })).toBeInTheDocument();
});

/* ------------------------------------------------------------- exporting */
test("export opens a dialog that names each set's library, never offers an organisation's, and reports the backup", async () => {
  route([
    LIST,
    ['GET', /admin\/question-sets$/, () => reply({ questionSets: [
      { id: 'teamretro', scope: 'platform', name: 'Team Retro' },
      { id: 'acme-quiz', scope: 'public', name: 'Acme Quiz' },
      { id: 'ours', scope: 'org', name: 'Our Private Set' },
    ] })],
    ['GET', /admin\/ai-prompts$/, () => reply({ prompts: [] })],
    ['POST', /admin\/export-to-archive$/, () => reply({ results: { successful: [{ id: 'teamretro', name: 'Team Retro', media: { copied: 0, missing: [] } }], failed: [] } })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from prod…/i }));
  expect(within(dialog()).getByRole('heading', { name: /back up from prod/i })).toBeInTheDocument();
  expect(dialog()).toHaveTextContent(/organisation content is encrypted per organisation and is never archived/i);
  fireEvent.click(await within(dialog()).findByLabelText('Select Team Retro'));
  expect(within(dialog()).getByText('Engage library')).toBeInTheDocument();
  fireEvent.click(within(dialog()).getByLabelText('Select Acme Quiz'));
  expect(within(dialog()).getByText('Public library')).toBeInTheDocument();
  expect(within(dialog()).queryByText('Our Private Set')).not.toBeInTheDocument();
  fireEvent.click(within(dialog()).getByRole('button', { name: /export 2 sets/i }));
  await waitFor(() => expect(callsTo('POST', /admin\/export-to-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/export-to-archive$/)[0][1].body)).toEqual({
    selectedItems: [{ scope: 'platform', id: 'teamretro' }, { scope: 'public', id: 'acme-quiz' }],
    exportType: 'questionsets',
  });
  expect(await screen.findByText('Backed up 1: Team Retro.')).toBeInTheDocument();
  // The list is re-read so the new backup appears.
  await waitFor(() => expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(2));
});

test('the export lists wait for both loads, whichever answers first', async () => {
  let answerSets;
  route([
    LIST,
    ['GET', /admin\/question-sets$/, () => new Promise((resolve) => { answerSets = resolve; })],
    ['GET', /admin\/ai-prompts$/, () => reply({ prompts: [] })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from prod…/i }));
  await waitFor(() => expect(callsTo('GET', /admin\/question-sets$/)).toHaveLength(1));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(within(dialog()).getByText('Loading local content…')).toBeInTheDocument();
  await act(async () => {
    answerSets({ ok: true, status: 200, json: async () => ({ questionSets: [{ id: 'teamretro', scope: 'platform', name: 'Team Retro' }] }) });
  });
  expect(await within(dialog()).findByLabelText('Select Team Retro')).toBeInTheDocument();
});

/* -------------------------------------------------------------- deleting */
test("a delete is confirmed in a dialog that says the archive is shared, then goes to the tier's relay", async () => {
  route([LIST, ['DELETE', /admin\/archive\/items\/arc-2$/, () => reply({ message: 'deleted' })]]);
  render(<ArchivePanel environment={PROD} />);
  const target = await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(within(target).getByRole('button', { name: /^delete$/i }));
  expect(dialog()).toHaveTextContent(/every environment shares this archive/i);
  fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel$/i }));
  expect(callsTo('DELETE', /admin\/archive\/items\//)).toHaveLength(0);
  fireEvent.click(within(target).getByRole('button', { name: /^delete$/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /delete the backup/i }));
  await waitFor(() => expect(callsTo('DELETE', /admin\/archive\/items\/arc-2$/)).toHaveLength(1));
  expect(await screen.findByText('Deleted the backup "Team Retro".')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------- download */
test('download asks the tier for the link and opens it', async () => {
  route([LIST, ['GET', /admin\/archive\/items\/arc-2$/, () => reply({ downloadUrl: 'https://signed.invalid/arc-2' })]]);
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  render(<ArchivePanel environment={PROD} />);
  const target = await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(within(target).getByRole('button', { name: /^download$/i }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.invalid/arc-2', '_blank'));
  open.mockRestore();
});
