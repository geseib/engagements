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
const TEST = { id: 'test', label: 'TEST', detail: 'API x' };
const DEV = { id: 'dev', label: 'DEV', detail: 'API x' };
const bodyOf = ([, init = {}]) => JSON.parse(init.body || '{}');
const dryRuns = () => callsTo('POST', /admin\/import-from-archive$/).filter((c) => bodyOf(c).dryRun === true);
const restores = () => callsTo('POST', /admin\/import-from-archive$/).filter((c) => bodyOf(c).dryRun !== true);
const PLAN_ARC2 = {
  dryRun: true,
  plan: [{
    archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'new-version',
    currentVersion: 3, currentlyActive: true, active: true, questionCount: 60, categoryCount: 6,
  }],
  failed: [],
};
const RESTORED_ARC2 = {
  results: { successful: [{
    archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'new-version', version: 4, active: true,
    check: { version: 4, questions: { expected: 60, found: 60 }, categories: { expected: 6, found: 6 }, matches: true },
  }], failed: [] },
  becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
  media: { copied: 0, kept: 0, missing: [] },
};
/** The import route: a plan for a dry run, the restore result otherwise. */
const IMPORT = (planBody = PLAN_ARC2, restoreBody = RESTORED_ARC2) => ['POST', /admin\/import-from-archive$/, (_url, init) => (
  JSON.parse(init.body).dryRun ? reply(planBody) : reply(restoreBody)
)];

test('an import is confirmed in a dialog that names the environment and the consequence, then reports what went live', async () => {
  route([LIST, IMPORT(PLAN_ARC2, { ...RESTORED_ARC2, results: { successful: [{ archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'created', version: 1, active: true }], failed: [] } })]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  expect(screen.getByRole('heading', { name: /importing 1 item into test/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(within(dialog()).getByRole('heading', { name: /restore 1 backup into test\?/i })).toBeInTheDocument();
  expect(dialog()).toHaveTextContent(/new version and switches to it/i);
  expect(dialog()).toHaveTextContent(/live for every organisation/i);
  const restore = within(dialog()).getByRole('button', { name: /^restore 1$/i });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  await waitFor(() => expect(restores()).toHaveLength(1));
  expect(bodyOf(restores()[0])).toEqual({ selectedItems: ['arc-2'] });
  expect(await screen.findByText('Now live for every organisation: Team Retro.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('the confirm opens on a preview: per item, new version of the live vN, its counts, and active on arrival', async () => {
  route([LIST, IMPORT({
    dryRun: true,
    plan: [
      PLAN_ARC2.plan[0],
      { archiveId: 'arc-1', kind: 'set', id: 'brandnew', name: 'Brand New', mode: 'created', currentVersion: null, currentlyActive: null, active: false, questionCount: 1, categoryCount: 1 },
    ],
    failed: [{ archiveId: 'arc-0', refused: true, error: 'Organisation content is not archived.' }],
  })]);
  render(<ArchivePanel environment={TEST} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('checkbox', { name: /select all shown/i }));
  fireEvent.click(screen.getByRole('button', { name: /import 3 selected/i }));
  expect(within(dialog()).getByText(/checking what each backup would do/i)).toBeInTheDocument();
  expect(within(dialog()).getByRole('button', { name: /^restore 3$/i })).toBeDisabled();
  const live = await within(dialog()).findByTestId('archive-plan-arc-2');
  expect(live).toHaveTextContent('New version of v3 (currently live)');
  expect(live).toHaveTextContent('60 questions · 6 categories');
  expect(live).toHaveTextContent('Active on arrival');
  const fresh = within(dialog()).getByTestId('archive-plan-arc-1');
  expect(fresh).toHaveTextContent('New set');
  expect(fresh).toHaveTextContent('1 question · 1 category');
  expect(fresh).toHaveTextContent('Inactive on arrival');
  expect(within(dialog()).getByTestId('archive-plan-arc-0')).toHaveTextContent(/will not be restored: organisation content/i);
  expect(dryRuns()).toHaveLength(1);
  expect(bodyOf(dryRuns()[0])).toEqual({ selectedItems: ['arc-2', 'arc-1', 'arc-0'], dryRun: true });
  expect(restores()).toHaveLength(0);
});

test('a declined confirmation restores nothing, and every exit of the dialog is the same exit', async () => {
  route([LIST, IMPORT()]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel$/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^close$/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(dryRuns()).toHaveLength(2));
  expect(restores()).toHaveLength(0);
});

test('a restore in flight cannot be sent twice', async () => {
  route([LIST, ['POST', /admin\/import-from-archive$/, (_url, init) => (JSON.parse(init.body).dryRun ? reply(PLAN_ARC2) : new Promise(() => {}))]]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  const restore = within(dialog()).getByRole('button', { name: /^restore 1$/i });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  await waitFor(() => expect(within(dialog()).getByRole('button', { name: /restoring/i })).toBeDisabled());
  fireEvent.click(within(dialog()).getByRole('button', { name: /restoring/i }));
  expect(restores()).toHaveLength(1);
});

test('a preview that fails does not block the restore, and says so', async () => {
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  route([LIST, ['POST', /admin\/import-from-archive$/, (_url, init) => (JSON.parse(init.body).dryRun ? reply({ error: 'boom' }, 500) : reply(RESTORED_ARC2))]]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(await within(dialog()).findByText(/the preview could not be made \(boom\)/i)).toBeInTheDocument();
  expect(within(dialog()).getByRole('button', { name: /^restore 1$/i })).toBeEnabled();
  logged.mockRestore();
});

/* ------------------------------------------------- prod asks for the word */
test('on prod the confirm names PROD, looks different, and the button waits for "prod" to be typed', async () => {
  route([LIST, IMPORT()]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(within(dialog()).getByRole('heading', { name: /Restore 1 backup into PROD\?/ })).toBeInTheDocument();
  expect(within(dialog()).getByTestId('archive-prod-warning')).toHaveTextContent(/This writes to PROD./);
  expect(dialog().className).toMatch(/arch-modal--prod/);
  await within(dialog()).findByTestId('archive-plan-arc-2');
  const restore = within(dialog()).getByRole('button', { name: 'Restore 1 into PROD' });
  expect(restore).toBeDisabled();
  expect(restore.className).toMatch(/arch-btn--dangersolid/);
  const word = within(dialog()).getByLabelText('Type prod to confirm');
  fireEvent.change(word, { target: { value: 'test' } });
  expect(restore).toBeDisabled();
  fireEvent.click(restore);
  expect(restores()).toHaveLength(0);
  fireEvent.change(word, { target: { value: ' PROD ' } });
  expect(restore).toBeEnabled();
  fireEvent.click(restore);
  await waitFor(() => expect(restores()).toHaveLength(1));
});

test('test and dev confirm with one press: no typed word, no prod treatment', async () => {
  for (const env of [TEST, DEV]) {
    route([LIST, IMPORT()]);
    const { unmount } = render(<ArchivePanel environment={env} />);
    // eslint-disable-next-line no-await-in-loop
    fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
    expect(within(dialog()).queryByLabelText('Type prod to confirm')).not.toBeInTheDocument();
    expect(dialog().className).not.toMatch(/arch-modal--prod/);
    // eslint-disable-next-line no-await-in-loop
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /^restore 1$/i })).toBeEnabled());
    unmount();
  }
});

/* ------------------------------------------ after the restore: check, refresh, promote */
test('after a restore each set is read back beside the snapshot, opens from the report, and the console refreshes its sets', async () => {
  const onRestored = jest.fn();
  route([LIST, IMPORT(PLAN_ARC2, {
    ...RESTORED_ARC2,
    results: { successful: [
      RESTORED_ARC2.results.successful[0],
      { archiveId: 'arc-1', kind: 'set', id: 'shortset', name: 'Short Set', mode: 'created', version: 1, active: false,
        check: { version: 1, questions: { expected: 60, found: 58 }, categories: { expected: 6, found: 6 }, matches: false } },
    ], failed: [] },
  })]);
  render(<ArchivePanel environment={TEST} onRestored={onRestored} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  const restore = within(dialog()).getByRole('button', { name: /^restore 1$/i });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  const good = await screen.findByTestId('archive-check-teamretro');
  expect(good).toHaveTextContent('60 of 60');
  expect(good).toHaveTextContent('6 of 6');
  expect(good).toHaveTextContent('Matches');
  expect(within(good).getByRole('link', { name: /open the set/i })).toHaveAttribute('href', '/admin?section=questionsets&set=teamretro&setScope=platform');
  const short = screen.getByTestId('archive-check-shortset');
  expect(short).toHaveTextContent('58 of 60');
  expect(short).toHaveTextContent('Does not match');
  expect(onRestored).toHaveBeenCalledTimes(1);
  // On test, the restored batch can go on to prod with the same archive ids.
  expect(screen.getByRole('link', { name: /promote these to prod/i }))
    .toHaveAttribute('href', 'https://engage.seibtribe.us/admin?section=archive&promote=arc-2,arc-1&from=test');
});

test('prod offers no further promotion', async () => {
  route([LIST, IMPORT()]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  await within(dialog()).findByTestId('archive-plan-arc-2');
  fireEvent.change(within(dialog()).getByLabelText('Type prod to confirm'), { target: { value: 'prod' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Restore 1 into PROD' }));
  expect(await screen.findByTestId('archive-check-teamretro')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /promote these/i })).not.toBeInTheDocument();
});

/* ------------------------------------------------- arriving on a promotion link */
describe('arriving on a promotion link', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  test('selects exactly the batch, says where it came from, goes straight to the preview, and drops the link', async () => {
    window.history.replaceState({}, '', '/admin?section=archive&promote=arc-2,arc-1,arc-gone&from=dev');
    route([LIST, IMPORT()]);
    render(<ArchivePanel environment={TEST} />);
    const banner = await screen.findByTestId('archive-promotion-banner');
    expect(banner).toHaveTextContent('2 items promoted from dev — review and restore');
    expect(banner).toHaveTextContent('1 of the 3 archive ids in the link is not in the archive.');
    expect(within(dialog()).getByRole('heading', { name: /restore 2 backups into test\?/i })).toBeInTheDocument();
    await waitFor(() => expect(dryRuns()).toHaveLength(1));
    expect(bodyOf(dryRuns()[0])).toEqual({ selectedItems: ['arc-2', 'arc-1'], dryRun: true });
    expect(within(row('arc-2')).getByRole('checkbox')).toBeChecked();
    expect(within(row('arc-1')).getByRole('checkbox')).toBeChecked();
    expect(within(row('arc-0')).getByRole('checkbox')).not.toBeChecked();
    expect(window.location.search).toBe('?section=archive');
    await within(dialog()).findByTestId('archive-plan-arc-2');
  });

  test('closing the preview leaves the banner, which reopens it', async () => {
    window.history.replaceState({}, '', '/admin?section=archive&promote=arc-2&from=dev');
    route([LIST, IMPORT()]);
    render(<ArchivePanel environment={TEST} />);
    await screen.findByTestId('archive-promotion-banner');
    fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /review and restore/i }));
    expect(within(dialog()).getByRole('heading', { name: /restore 1 backup into test\?/i })).toBeInTheDocument();
    await within(dialog()).findByTestId('archive-plan-arc-2');
  });
});

test('an unknown environment is named as this environment, never guessed', async () => {
  route([LIST, IMPORT()]);
  render(<ArchivePanel environment={{ id: 'unknown', label: 'UNKNOWN', detail: '' }} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  expect(within(dialog()).getByRole('heading', { name: /into this environment\?/i })).toBeInTheDocument();
  await within(dialog()).findByTestId('archive-plan-arc-2');
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

/* ------------------------------------------------ the list says the time */
test('the Exported column carries the time as well as the day, so two batches from one day differ', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  const when = within(await screen.findByTestId('archive-item-arc-2')).getByTestId('archive-item-when');
  expect(when.textContent).toMatch(/^Sep 1[45], 2026, \d{2}:\d{2}$/);
  expect(when).toHaveAttribute('title', '2026-09-15T12:00:00.000Z');
});

test('the panel has no heading of its own: the console head already says Archive', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  expect(screen.queryByRole('heading', { name: /^archive$/i })).not.toBeInTheDocument();
  expect(screen.queryByText('One shared store, all environments.')).not.toBeInTheDocument();
});

/* ------------------------------------------ the export picker: search, sort, state */
const FIVE_MIN_AGO = () => new Date(Date.now() - 5 * 60000).toISOString();
const PICKER_SETS = [
  { id: 'musicpopcultureencore', scope: 'platform', name: 'Music & Pop Culture: Encore!', engagementType: 'trivia', active: true, topic: 'music' },
  { id: 'techworld', scope: 'platform', name: 'lessons from the Tech World', engagementType: 'call-and-answer', active: false },
  { id: 'historicleaders', scope: 'platform', name: 'Historic World Leaders', engagementType: 'trivia', active: true },
];
const pickerRoutes = (extraItems = []) => [
  ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST, ...extraItems] })],
  ['GET', /admin\/question-sets$/, () => reply({ questionSets: PICKER_SETS })],
  ['GET', /admin\/ai-prompts$/, () => reply({ prompts: [] })],
];
const pickOrder = () => within(dialog()).getAllByTestId(/^archive-pick-/).map((el) => el.getAttribute('data-testid').slice('archive-pick-'.length));
const devBackupOf = (id, createdAt) => ({
  ArchiveId: `arc-${id}`, Title: id, ContentType: 'questionset', Category: 'trivia', FileSize: 10, CreatedAt: createdAt,
  Tags: ['dev', 'schema:engage.set/1', 'scope:platform', `source:platform/${id}`, `exportedAt:${createdAt}`],
});

test('the export picker sorts by the name shown, ignoring case, and each row says its id, state and topic', async () => {
  route(pickerRoutes());
  render(<ArchivePanel environment={DEV} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from dev…/i }));
  await within(dialog()).findByLabelText('Select Historic World Leaders');
  expect(pickOrder()).toEqual(['historicleaders', 'techworld', 'musicpopcultureencore']);
  const music = within(dialog()).getByTestId('archive-pick-musicpopcultureencore');
  expect(music).toHaveTextContent('musicpopcultureencore');
  expect(music).toHaveTextContent('Music');
  expect(music).toHaveTextContent('Active');
  expect(within(dialog()).getByTestId('archive-pick-techworld')).toHaveTextContent('Inactive');
});

test('search matches name or id, and Select all takes only what is shown', async () => {
  route(pickerRoutes());
  render(<ArchivePanel environment={DEV} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from dev…/i }));
  await within(dialog()).findByLabelText('Select Historic World Leaders');
  const box = within(dialog()).getByLabelText('Search name or id');
  fireEvent.change(box, { target: { value: 'WORLD' } });
  expect(pickOrder()).toEqual(['historicleaders', 'techworld']);
  expect(within(dialog()).getByRole('heading', { name: 'Question sets (2 of 3)' })).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'popcultureenc' } });
  expect(pickOrder()).toEqual(['musicpopcultureencore']);
  fireEvent.click(within(dialog()).getAllByRole('button', { name: /^select all$/i })[0]);
  expect(within(dialog()).getByRole('button', { name: /^export 1 set$/i })).toBeEnabled();
  fireEvent.change(box, { target: { value: 'nothing like it' } });
  expect(within(dialog()).getByText('No set matches “nothing like it”.')).toBeInTheDocument();
});

test('each row says when it was last backed up from THIS tier, and the picker sorts by it', async () => {
  route(pickerRoutes([devBackupOf('techworld', FIVE_MIN_AGO()), { ...devBackupOf('historicleaders', FIVE_MIN_AGO()), Tags: ['test', 'schema:engage.set/1', 'scope:platform', 'source:platform/historicleaders'] }]));
  render(<ArchivePanel environment={DEV} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from dev…/i }));
  await within(dialog()).findByLabelText('Select Historic World Leaders');
  expect(within(within(dialog()).getByTestId('archive-pick-techworld')).getByTestId('archive-last')).toHaveTextContent('Last backed up 5 min ago');
  // test's backup of it is not a backup from dev.
  expect(within(within(dialog()).getByTestId('archive-pick-historicleaders')).getByTestId('archive-last')).toHaveTextContent('Never backed up here');
  fireEvent.change(within(dialog()).getByLabelText('Sort by'), { target: { value: 'last' } });
  expect(pickOrder()[0]).toBe('techworld');
  fireEvent.change(within(dialog()).getByLabelText('Sort by'), { target: { value: 'type' } });
  expect(pickOrder()).toEqual(['techworld', 'historicleaders', 'musicpopcultureencore']);
});

/* ------------------------------------------------------- promote to test / prod */
test('Promote to test… exports and hands on a link to test\'s Archive with the batch, plus the ids to copy', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  route([
    ...pickerRoutes(),
    ['POST', /admin\/export-to-archive$/, () => reply({ results: { successful: [
      { id: 'historicleaders', name: 'Historic World Leaders', archiveId: 'new-1', media: { copied: 0, missing: [] } },
      { id: 'techworld', name: 'lessons from the Tech World', archiveId: 'new-2', media: { copied: 0, missing: [] } },
    ], failed: [] } })],
  ]);
  render(<ArchivePanel environment={DEV} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from dev…/i }));
  fireEvent.click(await within(dialog()).findByLabelText('Select Historic World Leaders'));
  fireEvent.click(within(dialog()).getByLabelText('Select lessons from the Tech World'));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^promote 2 sets to test…$/i }));
  const result = await screen.findByTestId('archive-export-result');
  expect(result).toHaveTextContent('2 items ready for test');
  expect(within(result).getByRole('link', { name: /open test’s archive/i }))
    .toHaveAttribute('href', 'https://engage.test.seibtribe.us/admin?section=archive&promote=new-1,new-2&from=dev');
  fireEvent.click(within(result).getByRole('button', { name: /copy archive ids/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('new-1,new-2'));
  expect(await within(result).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

test('a plain export also offers the ids and a way on; prod has no Promote button', async () => {
  route([
    ...pickerRoutes(),
    ['POST', /admin\/export-to-archive$/, () => reply({ results: { successful: [{ id: 'techworld', name: 'T', archiveId: 'new-9', media: { copied: 0, missing: [] } }], failed: [] } })],
  ]);
  const { unmount } = render(<ArchivePanel environment={TEST} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from test…/i }));
  fireEvent.click(await within(dialog()).findByLabelText('Select lessons from the Tech World'));
  fireEvent.click(within(dialog()).getByRole('button', { name: /^export 1 set$/i }));
  const result = await screen.findByTestId('archive-export-result');
  expect(within(result).getByRole('button', { name: /copy archive ids/i })).toBeInTheDocument();
  expect(within(result).getByRole('link', { name: /promote these to prod/i }))
    .toHaveAttribute('href', 'https://engage.seibtribe.us/admin?section=archive&promote=new-9&from=test');
  unmount();

  route(pickerRoutes());
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from prod…/i }));
  await within(dialog()).findByLabelText('Select lessons from the Tech World');
  expect(within(dialog()).queryByRole('button', { name: /promote to/i })).not.toBeInTheDocument();
});

/* ------------------------------------- one batch for sets and prompts (2026-11-08) */
const PICK_PROMPTS = [{ promptId: 'witt-reveal', name: 'What Is This Thing? reveal', scope: 'platform', status: 'active', gameType: 'call-and-answer' }];

test('sets and prompts are one selection with one Promote, prompts first, and the link carries every id', async () => {
  route([
    ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST] })],
    ['GET', /admin\/question-sets$/, () => reply({ questionSets: PICKER_SETS })],
    ['GET', /admin\/ai-prompts$/, () => reply({ prompts: PICK_PROMPTS })],
    ['POST', /admin\/export-to-archive$/, (_url, init) => (JSON.parse(init.body).exportType === 'prompts'
      ? reply({ results: { successful: [{ id: 'witt-reveal', name: 'What Is This Thing? reveal', archiveId: 'new-p' }], failed: [], totalRequested: 1 } })
      : reply({ results: { successful: [{ id: 'techworld', name: 'T', archiveId: 'new-s', media: { copied: 2, missing: [], skipped: [], external: ['https://commons.wikimedia.org/x.jpg'] } }], failed: [], totalRequested: 1 } }))],
  ]);
  render(<ArchivePanel environment={DEV} />);
  await screen.findByTestId('archive-item-arc-2');
  fireEvent.click(screen.getByRole('button', { name: /export from dev…/i }));
  fireEvent.click(await within(dialog()).findByLabelText('Select lessons from the Tech World'));
  fireEvent.click(within(dialog()).getByLabelText('Select What Is This Thing? reveal'));
  // Ticking the prompt keeps the set: both lists are one batch.
  expect(within(dialog()).getByLabelText('Select lessons from the Tech World')).toBeChecked();
  // One pair of actions, at the foot, naming the whole batch.
  expect(within(dialog()).getAllByRole('button', { name: /^promote/i })).toHaveLength(1);
  expect(within(dialog()).getByRole('button', { name: /^export 1 set and 1 prompt$/i })).toBeEnabled();
  fireEvent.click(within(dialog()).getByRole('button', { name: /^promote 1 set and 1 prompt to test…$/i }));
  const result = await screen.findByTestId('archive-export-result');
  const exports = callsTo('POST', /admin\/export-to-archive$/).map(bodyOf);
  expect(exports.map((b) => b.exportType)).toEqual(['prompts', 'questionsets']);
  expect(exports[0].selectedItems).toEqual([{ scope: 'platform', id: 'witt-reveal' }]);
  expect(result).toHaveTextContent('2 items ready for test');
  expect(within(result).getByRole('link', { name: /open test’s archive/i }))
    .toHaveAttribute('href', 'https://engage.test.seibtribe.us/admin?section=archive&promote=new-p,new-s&from=dev');
  expect(screen.getByTestId('archive-report')).toHaveTextContent('1 image stays on another site, not copied: https://commons.wikimedia.org/x.jpg.');
});

test('a restore sends prompts before sets, lists what stays on another site, and reads the prompt back', async () => {
  const PROMPT_TEST = { ...PROMPT, Tags: ['dev', ...PROMPT.Tags.slice(1)] };
  route([
    ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST, PROMPT_TEST] })],
    IMPORT({
      dryRun: true,
      plan: [
        { archiveId: 'arc-p', kind: 'prompt', id: 'consultant', name: 'Consultant voice', mode: 'created', status: 'active' },
        { ...PLAN_ARC2.plan[0], externalImages: ['https://commons.wikimedia.org/a.jpg', 'https://commons.wikimedia.org/b.jpg'] },
      ],
      failed: [],
    }, {
      results: { successful: [
        { archiveId: 'arc-p', kind: 'prompt', id: 'consultant', name: 'Consultant voice', mode: 'created', version: 2, status: 'active',
          check: { version: 2, status: 'active', active: true, name: 'Consultant voice', hasBody: true, matches: true } },
        RESTORED_ARC2.results.successful[0],
      ], failed: [] },
      becameActive: [],
      media: { copied: 0, kept: 0, missing: [], skipped: [], external: ['https://commons.wikimedia.org/a.jpg'] },
    }),
  ]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(within(row('arc-p')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 2 selected/i }));
  await waitFor(() => expect(dryRuns()).toHaveLength(1));
  expect(bodyOf(dryRuns()[0]).selectedItems).toEqual(['arc-p', 'arc-2']);
  const setPlan = await within(dialog()).findByTestId('archive-plan-arc-2');
  expect(within(setPlan).getByTestId('archive-plan-sub')).toHaveTextContent('2 images stay on another site');
  fireEvent.click(within(dialog()).getByRole('button', { name: /^restore 2$/i }));
  await waitFor(() => expect(restores()).toHaveLength(1));
  expect(bodyOf(restores()[0]).selectedItems).toEqual(['arc-p', 'arc-2']);
  const check = await screen.findByTestId('archive-check-prompt-consultant');
  expect(check).toHaveTextContent('Consultant voice');
  expect(check).toHaveTextContent('v2');
  expect(check).toHaveTextContent('Active');
  expect(check).toHaveTextContent('Matches');
  expect(screen.getByTestId('archive-report')).toHaveTextContent('1 image stays on another site, not copied: https://commons.wikimedia.org/a.jpg.');
});

test('a prompt-only restore still shows the read-back, not only the way on', async () => {
  route([
    LIST_WITH_PROMPT,
    IMPORT({ dryRun: true, plan: [{ archiveId: 'arc-p', kind: 'prompt', id: 'consultant', name: 'Consultant voice', mode: 'new-version', currentVersion: 3, status: 'draft' }], failed: [] }, {
      results: { successful: [{ archiveId: 'arc-p', kind: 'prompt', id: 'consultant', name: 'Consultant voice', mode: 'new-version', version: 4, status: 'draft',
        check: { version: 4, status: 'draft', active: false, name: 'Consultant voice', hasBody: true, matches: true } }], failed: [] },
      becameActive: [],
      media: { copied: 0, kept: 0, missing: [], skipped: [], external: [] },
    }),
  ]);
  render(<ArchivePanel environment={TEST} />);
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-p')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /import 1 selected/i }));
  const restore = within(dialog()).getByRole('button', { name: /^restore 1$/i });
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  const section = await screen.findByTestId('archive-restore-check');
  expect(within(section).getByRole('heading', { name: 'Checked after the restore' })).toBeInTheDocument();
  const check = within(section).getByTestId('archive-check-prompt-consultant');
  expect(check).toHaveTextContent('v4');
  expect(check).toHaveTextContent('draft');
  expect(within(section).getByRole('link', { name: /promote these to prod/i })).toBeInTheDocument();
});
