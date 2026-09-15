/**
 * THE ARCHIVE SCREEN — components/ArchivePanel.jsx, with the network mocked at authFetch.
 *
 * rejects: a call to the archive service that bypasses the tier; the hand-upload form coming
 * back; a backup that does not say which environment it came from; an export request that
 * does not name each set's library, or that includes an organisation's; an import that is not
 * confirmed, or whose result hides what went live.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.test.invalid/prod/';
  global.fetch = jest.fn();
});

test('the list comes through the tier, never from the archive service', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByTestId('archive-item-arc-2')).toBeInTheDocument();
  expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('there is no hand-upload form any more', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  expect(screen.queryByText('Upload New Item')).not.toBeInTheDocument();
});

test('each backup says which environment it came from, and the list filters by it', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  const latest = await screen.findByTestId('archive-item-arc-2');
  expect(within(latest).getByTestId('archive-item-tier')).toHaveTextContent('From prod');
  expect(within(screen.getByTestId('archive-item-arc-1')).getByTestId('archive-item-tier')).toHaveTextContent('From dev');
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'dev' } });
  expect(screen.queryByTestId('archive-item-arc-2')).not.toBeInTheDocument();
  expect(screen.getByTestId('archive-item-arc-1')).toBeInTheDocument();
  expect(screen.getByTestId('archive-item-arc-0')).toBeInTheDocument();
});

test("a source's backups sit together, newest first, and say so", async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  const order = screen.getAllByTestId(/^archive-item-arc-/).map((el) => el.getAttribute('data-testid'));
  expect(order).toEqual(['archive-item-arc-2', 'archive-item-arc-1', 'archive-item-arc-0']);
  expect(within(screen.getByTestId('archive-item-arc-2')).getByTestId('archive-item-snapshot')).toHaveTextContent('Latest of 2 backups');
});

test('export names each set\'s library, and never offers an organisation\'s set', async () => {
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
  fireEvent.click(await screen.findByText('Export to Archive'));
  fireEvent.click(await screen.findByLabelText('Select Team Retro'));
  fireEvent.click(screen.getByLabelText('Select Acme Quiz'));
  expect(screen.queryByText('Our Private Set')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Export Selected \(2\)/));
  await waitFor(() => expect(callsTo('POST', /admin\/export-to-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/export-to-archive$/)[0][1].body)).toEqual({
    selectedItems: [{ scope: 'platform', id: 'teamretro' }, { scope: 'public', id: 'acme-quiz' }],
    exportType: 'questionsets',
  });
  expect(await screen.findByText('Backed up 1: Team Retro.')).toBeInTheDocument();
});

test('an import is confirmed, names the environment, and reports what went live', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  route([
    LIST,
    ['POST', /admin\/import-from-archive$/, () => reply({
      results: { successful: [{ archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'created', version: 1, active: true }], failed: [] },
      becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
      media: { copied: 0, kept: 0, missing: [] },
    })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(await screen.findByText('Import from Archive'));
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByText(/Import Selected \(1\)/));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('into prod'));
  await waitFor(() => expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/import-from-archive$/)[0][1].body)).toEqual({ selectedItems: ['arc-2'] });
  expect(await screen.findByText('Now live for every organisation: Team Retro.')).toBeInTheDocument();
  confirm.mockRestore();
});

test('a declined confirmation sends nothing', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(await screen.findByText('Import from Archive'));
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByText(/Import Selected \(1\)/));
  expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(0);
  confirm.mockRestore();
});

test("the tier's refusal is shown, not swallowed", async () => {
  route([['GET', /admin\/archive\/items(\?|$)/, () => reply({ error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." }, 403)]]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByText(/Switch to Engage/)).toBeInTheDocument();
});
