/**
 * PROMPT VERSIONS AND UPDATES FROM THE REPO — docs/design/prompt-versions/.
 *
 *   frame 1  the library's notice, Version column, repo chips, "Show only these"
 *   frame 2  the Review screen: each part changed/unchanged, the word diff,
 *            the edited-here warning, and the save it sends
 *   frame 3  the editor's Versions tab: the list, Compare with live, and
 *            Make live pressed twice
 *
 * Plus the matching rules (utils/repoPromptMatch.js) a row's mark comes from.
 * The backend half is tests/prompt-versions.js.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import PromptLibraryPanel from '../components/PromptLibraryPanel';
import PromptRepoReview from '../components/PromptRepoReview';
import PromptVersionsPanel from '../components/PromptVersionsPanel';
import AIPromptManager from '../components/AIPromptManager';
import {
  matchRepoEntry, repoStatusOf, normalizePromptName, wordDiff, REPO_STATE,
} from '../utils/repoPromptMatch';

const repoFile = require('../config/repoPrompts.json');

/* A repo entry in the shape scripts/build-repo-prompts.js writes. */
const ENTRY = {
  key: 'demo-sets/transfer.prompt.json',
  path: 'demo-sets/transfer.prompt.json',
  source: 'demo-sets',
  name: 'Workie - The Transfer Reader',
  gameType: 'call-and-answer',
  fields: ['description', 'instructions', 'outputFormat', 'outputSections'],
  values: {
    description: 'Reads the transfer back.',
    instructions: '11. EVERY NEXT STEP IS A SUGGESTION THE ROOM HAS NOT AGREED TO.',
    outputFormat: '## Summary\nTwo sentences.',
    outputSections: [{ heading: 'Summary', guidance: 'Two sentences.' }, { heading: 'Suggested next steps', guidance: 'Start with Suggested.' }],
  },
  fieldHashes: { description: 'd1', instructions: 'i2', outputFormat: 'o1', outputSections: 's2' },
  hash: 'h2',
  commitDate: '2026-10-21T16:40:12+00:00',
};
const DEFAULT_ENTRY = {
  ...ENTRY,
  key: 'lambda-functions/admin/default-ai-prompts.json#call-and-answer/lessons-learned',
  path: 'lambda-functions/admin/default-ai-prompts.json',
  source: 'defaults',
  name: 'Lessons Learned - Strategic Insights',
  fieldHashes: { description: 'dd', instructions: 'di', outputFormat: 'do', outputSections: 'ds' },
  commitDate: '2026-10-20T10:00:00+00:00',
};
const ENTRIES = [ENTRY, DEFAULT_ENTRY];

const LIVE = {
  promptId: 'p-transfer',
  name: 'Workie - The Transfer Reader (Imported 2026-08-15)',
  gameType: 'call-and-answer',
  status: 'active',
  version: 1,
  latestVersion: 1,
  description: 'Reads the transfer back.',
  instructions: '11. EVERY NEXT STEP IS ASSIGNABLE.',
  outputFormat: '## Summary\nTwo sentences.',
  outputSections: [{ heading: 'Summary', guidance: 'Two sentences.' }, { heading: 'Next steps', guidance: 'An owner.' }],
  fieldHashes: { description: 'd1', instructions: 'i1', outputFormat: 'o1', outputSections: 's1', angleWeights: 'a0' },
};
const MATCHING = {
  promptId: 'p-default', name: 'Lessons Learned - Strategic Insights', gameType: 'call-and-answer', status: 'active',
  version: 3, createdBy: 'system', fieldHashes: { ...DEFAULT_ENTRY.fieldHashes },
};
const LOCAL = {
  promptId: 'p-jobs', name: 'Steve Jobs on the product', gameType: 'call-and-answer', status: 'active',
  version: 4, fieldHashes: { instructions: 'x' },
};

describe('matching a live prompt to its repo file', () => {
  test('by the stored repoSource first', () => {
    expect(matchRepoEntry({ name: 'Renamed', repoSource: { key: ENTRY.key } }, ENTRIES)).toBe(ENTRY);
  });
  test('by a promptId the file names', () => {
    const quiz = { ...ENTRY, key: 'q', promptId: 'quiz-1', name: 'Quiz' };
    expect(matchRepoEntry({ promptId: 'quiz-1', name: 'Something else' }, [quiz])).toBe(quiz);
  });
  test('a seeded default by its seeded name and type', () => {
    expect(matchRepoEntry(MATCHING, ENTRIES)).toBe(DEFAULT_ENTRY);
  });
  test('by name, ignoring case and an "(Imported YYYY-MM-DD)" suffix', () => {
    expect(normalizePromptName('Workie - The Transfer Reader (Imported 2026-08-15)')).toBe('workie - the transfer reader');
    expect(matchRepoEntry({ name: 'WORKIE - the transfer reader' }, ENTRIES)).toBe(ENTRY);
    expect(matchRepoEntry(LIVE, ENTRIES)).toBe(ENTRY);
  });
  test('unmatched is "Not in the repo"', () => {
    expect(repoStatusOf(LOCAL, ENTRIES).state).toBe(REPO_STATE.NONE);
  });
  test('equal hashes over the file\'s fields are "Matches"; any difference is "Newer", naming the parts', () => {
    expect(repoStatusOf(MATCHING, ENTRIES).state).toBe(REPO_STATE.MATCHES);
    const s = repoStatusOf(LIVE, ENTRIES);
    expect(s.state).toBe(REPO_STATE.NEWER);
    expect(s.changed).toEqual(['instructions', 'outputSections']);
    expect(s.editedHere).toBe(false);
  });
  test('a field the file does not carry never makes it "Newer"', () => {
    expect(repoStatusOf({ ...MATCHING, fieldHashes: { ...MATCHING.fieldHashes, angleWeights: 'zz' } }, ENTRIES).state)
      .toBe(REPO_STATE.MATCHES);
  });
  test('edited here since it was taken: the live hash differs from what was taken AND from the repo', () => {
    const taken = { ...LIVE, repoSource: { key: ENTRY.key, fieldHashes: { ...LIVE.fieldHashes, instructions: 'i0' } } };
    expect(repoStatusOf(taken, ENTRIES).editedHere).toBe(true);
    const untouched = { ...LIVE, repoSource: { key: ENTRY.key, fieldHashes: { ...LIVE.fieldHashes } } };
    expect(repoStatusOf(untouched, ENTRIES).editedHere).toBe(false);
  });
  test('no live text loaded: nothing is claimed', () => {
    expect(repoStatusOf({ name: ENTRY.name }, ENTRIES)).toBeNull();
  });
  test('the word diff marks what was added and removed, and keeps the rest', () => {
    const d = wordDiff('one owner, then the action', 'one Suggested role, then the action');
    expect(d.filter((p) => p.type === 'del').map((p) => p.text.trim())).toEqual(['owner,']);
    expect(d.filter((p) => p.type === 'add').map((p) => p.text.trim())).toEqual(['Suggested role,']);
    expect(d.map((p) => (p.type === 'add' ? '' : p.text)).join('')).toBe('one owner, then the action');
  });
  test('the committed repo file has the four demo Workies the owner named', () => {
    const names = repoFile.prompts.map((p) => p.name);
    for (const n of ['Workie - The Transfer Reader', 'Workie - The Direction Advisor',
      'Workie - The Redline Reader', 'Workie - The Verdict Board']) expect(names).toContain(n);
  });
});

/* ------------------------------------------------------------- frame 1 -- */

function Library(props) {
  const [filters, setFilters] = React.useState({ search: '', gameType: 'all', category: 'all', status: 'all' });
  const statusFor = React.useCallback((p) => repoStatusOf(p, ENTRIES), []);
  return (
    <PromptLibraryPanel
      prompts={[LIVE, MATCHING, LOCAL]}
      filters={filters}
      onFilterChange={setFilters}
      repoStatusFor={statusFor}
      onEdit={() => {}}
      {...props}
    />
  );
}

describe('frame 1 — the library says which prompts the repo has newer', () => {
  test('a notice counts them and names the deploy date', () => {
    render(<Library />);
    const notice = screen.getByTestId('plib-repo-notice');
    expect(notice).toHaveTextContent('1 prompt has a newer version in the repo, from the deploy of 21 Oct.');
  });

  test('each row carries its mark and its live version', () => {
    render(<Library />);
    expect(screen.getByTestId('plib-repo-p-transfer')).toHaveTextContent('Repo has a newer version');
    expect(screen.getByTestId('plib-repo-p-default')).toHaveTextContent('Matches the repo');
    expect(screen.getByTestId('plib-repo-p-jobs')).toHaveTextContent('Not in the repo');
    expect(screen.getByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
    expect(screen.getByTestId('plib-ver-p-default')).toHaveTextContent('v3');
  });

  test('"Show only these" narrows to them, and the notice offers the way back', () => {
    render(<Library />);
    fireEvent.click(screen.getByTestId('plib-repo-only'));
    expect(screen.queryByTestId('plib-repo-p-jobs')).toBeNull();
    expect(screen.queryByTestId('plib-repo-p-default')).toBeNull();
    expect(screen.getByTestId('plib-repo-p-transfer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plib-repo-showall'));
    expect(screen.getByTestId('plib-repo-p-jobs')).toBeInTheDocument();
  });

  test('Review appears only on a row the repo has newer, and opens it with its status', () => {
    const onReviewRepo = jest.fn();
    render(<Library onReviewRepo={onReviewRepo} />);
    expect(screen.queryByTestId('plib-review-p-default')).toBeNull();
    expect(screen.queryByTestId('plib-review-p-jobs')).toBeNull();
    fireEvent.click(screen.getByTestId('plib-review-p-transfer'));
    expect(onReviewRepo).toHaveBeenCalledWith(LIVE, expect.objectContaining({ state: 'newer', entry: ENTRY }));
  });

  test('a mount with no repo marks draws none of it', () => {
    render(<Library repoStatusFor={undefined} />);
    expect(screen.queryByTestId('plib-repo-notice')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Version' })).toBeNull();
  });
});

/* ------------------------------------------------------------- frame 2 -- */

describe('frame 2 — review the repo\'s version, then save it as a new version', () => {
  const status = repoStatusOf(LIVE, ENTRIES);

  test('each part says changed or unchanged, with word counts and the words', () => {
    render(<PromptRepoReview prompt={LIVE} status={status} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('pmgr-repo-part-instructions')).toHaveTextContent('changed · 6 → 13 words');
    expect(screen.getByTestId('pmgr-repo-part-outputFormat')).toHaveTextContent('unchanged');
    expect(screen.getByTestId('pmgr-repo-part-description')).toHaveTextContent('unchanged');
    expect(screen.getByTestId('pmgr-repo-part-outputSections')).toHaveTextContent('1 of 2 changed');
    const diff = screen.getByTestId('pmgr-repo-diff-instructions');
    expect(within(diff).getByText(/ASSIGNABLE/, { selector: 'del' })).toBeInTheDocument();
    expect(within(diff).getByText(/SUGGESTION THE ROOM HAS NOT AGREED TO/, { selector: 'ins' })).toBeInTheDocument();
    expect(screen.queryByTestId('pmgr-repo-diff-outputFormat')).toBeNull();
    expect(screen.queryByTestId('pmgr-repo-edited-here')).toBeNull();
  });

  test('the edited-here warning, when the live text moved after it was taken', () => {
    const taken = { ...LIVE, repoSource: { key: ENTRY.key, fieldHashes: { ...LIVE.fieldHashes, instructions: 'i0' } } };
    render(<PromptRepoReview prompt={taken} status={repoStatusOf(taken, ENTRIES)} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('pmgr-repo-edited-here'))
      .toHaveTextContent('Edited here since it was taken from the repo; saving keeps that version in the history.');
  });

  test('"Save as version 2" hands the prompt and entry over; "Not now" only closes', async () => {
    const onSave = jest.fn().mockResolvedValue();
    const onClose = jest.fn();
    render(<PromptRepoReview prompt={LIVE} status={status} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText('Version 1 stays in the history; you can make it live again.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pmgr-repo-notnow'));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as version 2' })); });
    expect(onSave).toHaveBeenCalledWith(LIVE, ENTRY);
  });

  test('a refused save says nothing was saved and leaves the dialog open', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Prompts are changed in Engage mode.'));
    render(<PromptRepoReview prompt={LIVE} status={status} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('pmgr-repo-save')); });
    expect(screen.getByTestId('pmgr-repo-error')).toHaveTextContent('Nothing was saved');
    expect(screen.getByTestId('pmgr-repo-save')).not.toBeDisabled();
  });

  test('the manager sends the repo text as a from-repo save, then refreshes', async () => {
    authFetch.mockReset();
    const listed = [{ ...LIVE, promptContent: { ...LIVE } }];
    authFetch.mockImplementation(async (url, opts) => {
      if (opts && opts.method === 'PUT') return { ok: true, json: async () => ({ version: 2, newVersion: true }) };
      return { ok: true, json: async () => ({ prompts: listed }) };
    });
    // The real repo file has the real Transfer Reader, matched by name.
    render(<AIPromptManager />);
    const review = await screen.findByTestId('plib-review-p-transfer', {}, { timeout: 4000 });
    fireEvent.click(review);
    await act(async () => { fireEvent.click(await screen.findByTestId('pmgr-repo-save')); });
    const put = authFetch.mock.calls.find(([, o]) => o && o.method === 'PUT');
    expect(put[0]).toMatch(/admin\/ai-prompts\/p-transfer$/);
    const body = JSON.parse(put[1].body);
    const real = repoFile.prompts.find((p) => p.key === 'demo-sets/lessons-from-different-schools.prompt.json');
    expect(body.from).toBe('repo');
    expect(body.repoSource).toEqual(expect.objectContaining({ key: real.key, path: real.path, fields: real.fields }));
    expect(body.instructions).toBe(real.values.instructions);
    expect(body.outputSections).toEqual(real.values.outputSections);
    await waitFor(() => expect(screen.getByTestId('pmgr-notice')).toHaveTextContent('is now version 2, from the repo'));
  });
});

/* ------------------------------------------------------------- frame 3 -- */

const VERSIONS = [
  { version: 3, s3Key: 'k3', savedAt: '2026-10-21T14:02:00Z', by: 'george@seibtribe.com', how: 'edit', live: true },
  { version: 2, s3Key: 'k2', savedAt: '2026-10-21T13:40:00Z', by: 'george@seibtribe.com', how: 'repo', repoCommitDate: '2026-10-21T10:00:00Z', live: false },
  { version: 1, s3Key: 'k1', savedAt: '2026-08-15T19:10:00Z', by: 'admin import', how: 'archive', live: false },
];
const fakeApi = () => ({
  list: jest.fn().mockResolvedValue({ versions: VERSIONS }),
  get: jest.fn().mockResolvedValue({ content: { instructions: 'the v1 text', outputFormat: '## Summary' } }),
  makeLive: jest.fn().mockResolvedValue({ version: 1 }),
});

describe('frame 3 — the Versions tab', () => {
  test('every version, newest first: when, who, how, and which is live', async () => {
    const api = fakeApi();
    render(<PromptVersionsPanel api={api} live={{ instructions: 'live text' }} />);
    await screen.findByTestId('pmgr-ver-row-3');
    const rows = screen.getAllByTestId(/^pmgr-ver-row-/).map((r) => r.getAttribute('data-testid'));
    expect(rows).toEqual(['pmgr-ver-row-3', 'pmgr-ver-row-2', 'pmgr-ver-row-1']);
    expect(screen.getByTestId('pmgr-ver-row-3')).toHaveTextContent('21 Oct, 14:02');
    expect(screen.getByTestId('pmgr-ver-row-3')).toHaveTextContent('Edited here');
    expect(screen.getByTestId('pmgr-ver-live-3')).toHaveTextContent('Live');
    expect(screen.getByTestId('pmgr-ver-row-2')).toHaveTextContent('From the repo (deploy 21 Oct)');
    expect(screen.getByTestId('pmgr-ver-row-1')).toHaveTextContent('admin import');
    expect(screen.getByTestId('pmgr-ver-row-1')).toHaveTextContent('Imported from the archive');
    // The live one offers neither Compare nor Make live.
    expect(screen.queryByTestId('pmgr-ver-make-3')).toBeNull();
    expect(screen.queryByTestId('pmgr-ver-compare-3')).toBeNull();
  });

  test('Compare with live reads that version beside the live text', async () => {
    const api = fakeApi();
    render(<PromptVersionsPanel api={api} live={{ instructions: 'live text', outputFormat: '## Summary' }} />);
    const compare = await screen.findByTestId('pmgr-ver-compare-1');
    await act(async () => { fireEvent.click(compare); });
    expect(api.get).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('pmgr-ver-cmp-instructions-before')).toHaveTextContent('the v1 text');
    expect(screen.getByTestId('pmgr-ver-cmp-instructions-after')).toHaveTextContent('live text');
    expect(screen.getByTestId('pmgr-ver-cmp-instructions')).toHaveTextContent('v1 → live (v3)');
  });

  test('Make live is pressed twice, armed in place, and only the second press writes', async () => {
    const api = fakeApi();
    const onMadeLive = jest.fn();
    render(<PromptVersionsPanel api={api} live={{}} onMadeLive={onMadeLive} />);
    const make = await screen.findByTestId('pmgr-ver-make-1');
    fireEvent.click(make);
    expect(api.makeLive).not.toHaveBeenCalled();
    expect(make).toHaveTextContent('Make v1 live again?');
    expect(screen.getByTestId('pmgr-ver-armed')).toHaveTextContent('Press again to make v1 live. v3 stays in the list.');
    await act(async () => { fireEvent.click(make); });
    expect(api.makeLive).toHaveBeenCalledWith(1);
    expect(onMadeLive).toHaveBeenCalledWith(1);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  test('arming another row disarms the first', async () => {
    const api = fakeApi();
    render(<PromptVersionsPanel api={api} live={{}} />);
    fireEvent.click(await screen.findByTestId('pmgr-ver-make-1'));
    fireEvent.click(screen.getByTestId('pmgr-ver-make-2'));
    expect(screen.getByTestId('pmgr-ver-make-1')).toHaveTextContent('Make live');
    expect(screen.getByTestId('pmgr-ver-armed')).toHaveTextContent('Press again to make v2 live.');
    expect(api.makeLive).not.toHaveBeenCalled();
  });

  test('with unsaved edits in the Edit tab, Make live is held', async () => {
    render(<PromptVersionsPanel api={fakeApi()} live={{}} dirty />);
    expect(await screen.findByTestId('pmgr-ver-make-1')).toBeDisabled();
  });

  test('the editor has an Edit | Versions tab pair, and Versions lists on the routes that exist', async () => {
    authFetch.mockReset();
    authFetch.mockImplementation(async (url) => {
      if (String(url).includes('versions=')) return { ok: true, json: async () => ({ versions: VERSIONS }) };
      return { ok: true, json: async () => ({ prompts: [{ ...LOCAL, promptContent: { instructions: 'Given {responsesText}', outputFormat: '## S' } }] }) };
    });
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByTestId('pmgr-tab-versions'));
    await screen.findByTestId('pmgr-ver-row-3');
    expect(screen.getByTestId('pmgr-tab-versions')).toHaveTextContent('Versions · 3');
    const call = authFetch.mock.calls.find(([u]) => String(u).includes('versions='));
    expect(call[0]).toMatch(/admin\/ai-prompts\?versions=p-jobs$/);
    fireEvent.click(screen.getByTestId('pmgr-tab-edit'));
    expect(screen.queryByTestId('pmgr-versions-view')).toBeNull();
  });
});
