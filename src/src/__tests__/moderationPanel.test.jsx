import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ModerationPanel from '../components/ModerationPanel';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const QUEUE = { count: 2, oldestWaitingSince: '2026-09-15T10:00:00.000Z', items: [
  { sk: 'org_acme#safety#v2', orgName: 'Acme', setId: 'safety', title: 'Safety walkthrough', version: 2, gameType: 'trivia', questionCount: 30, reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'], waitingSince: '2026-09-15T10:00:00.000Z' },
  { sk: 'org_beta#onboarding#v1', orgName: 'Beta', setId: 'onboarding', title: 'Onboarding', version: 1, gameType: 'poll', questionCount: 12, reasons: ['appealed'], appealMessage: 'It is a clinical set.', waitingSince: '2026-09-17T09:00:00.000Z' },
] };
const ITEM = { pointer: QUEUE.items[0], review: { status: 'escalated', findings: [], reasons: ['guardrail'], checkedAt: '2026-09-17T10:00:00.000Z', note: '' }, setFindings: [], log: [], snapshot: {
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia' },
  categories: [{ id: 'c001', name: 'Injuries' }],
  questions: [
    { questionId: 'c001#014', category: 'Injuries', title: 'Describe the injury', text: 'Describe the injury. In detail.', findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Asking for injuries in detail is what was flagged, not the safety topic.' }] },
    { questionId: 'c001#001', category: 'Injuries', title: 'A clean one', text: 'Which glove?', findings: [] },
  ],
} };
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let decided;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  decided = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) { decided.push(JSON.parse(options.body)); return json({ decision: 'approve', publicSetId: 'orgacme-safety', publicVersion: 1 }); }
    if (u.endsWith('/admin/moderation')) return json(decided.length ? { count: 1, oldestWaitingSince: QUEUE.items[1].waitingSince, items: [QUEUE.items[1]] } : QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
});
afterEach(() => { Date.now.mockRestore(); });

test('the head says how many and how long, and each row says why in band words', async () => {
  render(<ModerationPanel />);
  expect(await screen.findByText('2 sets the check would not decide on its own. Oldest has waited 2 days.')).toBeInTheDocument();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText('Acme')).toBeInTheDocument();
  expect(within(row).getByText('2 uncertain questions')).toBeInTheDocument();
  expect(within(row).getByText('2 days')).toBeInTheDocument();
  // moderationRow.js's appealWords() wraps the appeal message in the
  // console's curly U+201C/U+201D quotes (fixed in 7bd1d490 to match the rest
  // of the console's typography), not straight ASCII ones.
  expect(within(screen.getByText('Onboarding').closest('tr')).getByText('Appealed: “It is a clinical set.”')).toBeInTheDocument();
  expect(screen.getByText(/these are the ones it flagged as uncertain/i)).toBeInTheDocument();
});
/*
  Rows as GET /admin/moderation projects them (moderation-list.js): bands one
  per category, and what a check escalation was for. Every one of these once
  read "Uncertain" — the queue row said only 'escalated', and the bands were
  read as counts.
*/
test('each row says what the check escalated it for, as the endpoint sends it', async () => {
  const base = { orgName: 'Acme', gameType: 'trivia', questionCount: 3, version: 1, reasons: ['escalated'], bands: {}, uncertainQuestionIds: [], checkReasons: [], declaredNotice: [], waitingSince: '2026-09-17T09:00:00.000Z' };
  const items = [
    { ...base, sk: 'org_acme#art#v1', setId: 'art', title: 'Gallery walk', checkReasons: ['images'] },
    { ...base, sk: 'org_acme#ward#v1', setId: 'ward', title: 'Ward drills', checkReasons: ['declared'], declaredNotice: ['graphic-medical'] },
    { ...base, sk: 'org_acme#hist#v1', setId: 'hist', title: 'A timeline', checkReasons: ['guardrail'], bands: { VIOLENCE: 'MEDIUM' }, uncertainQuestionIds: ['q002'] },
  ];
  global.fetch = jest.fn(async () => json({ count: items.length, oldestWaitingSince: base.waitingSince, items }));
  render(<ModerationPanel />);
  const rowOf = async (title) => within((await screen.findByText(title)).closest('tr'));
  expect((await rowOf('Gallery walk')).getByText('Images')).toBeInTheDocument();
  expect((await rowOf('Ward drills')).getByText('Declared: graphic medical')).toBeInTheDocument();
  expect((await rowOf('A timeline')).getByText('1 uncertain question (medium: violence)')).toBeInTheDocument();
});
test('an empty queue says the check decided everything, and never lies about an outage', async () => {
  global.fetch = jest.fn(async () => json({ count: 0, oldestWaitingSince: null, items: [] }));
  render(<ModerationPanel />);
  expect(await screen.findByText(/nothing is waiting — the check decided everything on its own/i)).toBeInTheDocument();
  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  render(<ModerationPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the queue/i);
});
test('Review opens the snapshot with the uncertain question first, and Approve decides and refreshes', async () => {
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  // Modal's dialog wrapper mounts (and role="dialog" satisfies findByRole
  // above) before ReviewDialog's own fetch resolves — the "Opening…" loading
  // state is real, not a testing artifact, so the heading that only exists
  // once state==='ready' has to be awaited too, not read synchronously right
  // after the wrapper appears. See task-9-report.md.
  expect(await within(dialog).findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  // Pins skUrl()'s encodeURIComponent(sk): the sk contains '#', which must
  // reach the wire as '%23' or the request targets the wrong (truncated)
  // path segment. authFetch is called with a single argument here (no
  // options object) — global.fetch(...args) receives exactly what
  // authFetch(skUrl(sk)) passed it.
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('org_acme%23safety%23v2'));
  const items = within(dialog).getAllByTestId('modq-question');
  expect(items[0]).toHaveTextContent('Describe the injury');
  expect(items[0]).toHaveTextContent(/medium/i);
  expect(items[0]).toHaveTextContent(/injuries in detail/i);
  expect(items[1]).toHaveTextContent('A clean one');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Clinical, not gratuitous.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
  await waitFor(() => expect(decided).toEqual([{ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('1 set the check would not decide on its own. Oldest has waited 3 hours.')).toBeInTheDocument();
});
/*
  RULING R21 REFRAMED WHAT THIS 409 MEANS, and so this test's first assertion.

  The fixture is unchanged: a reviewer sends `reject` and the server answers
  409 `{ status: 'passed' }`. What that actually describes is not a race
  somebody lost — the queue row is still there (a 404 is what a lost race
  looks like, since the winner deletes that row LAST), so under Ruling R9 it
  is dai's approve, crashed part-way and waiting to be finished. The dialog
  used to close the door on it with "Already decided by dai" and no buttons;
  it now says who decided AND what finishes it. The exits this test also
  guards — the X and the bottom Close — are unchanged.
*/
test('a decision that did not finish names who made it; the dialog still has an X and a bottom exit', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') return json({ error: 'Already decided by dai.', status: 'passed', reviewer: 'dai' }, 409);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  // Same loading-state gap as the test above: Reject only exists once
  // state==='ready', so it has to be awaited rather than read synchronously.
  fireEvent.click(await within(dialog).findByRole('button', { name: /^reject$/i }));
  expect(await within(dialog).findByText(/Approved by dai/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
test('a typed note survives an accidental Escape, but a deliberate Close still works (R16)', async () => {
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('heading', { name: /safety walkthrough/i });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Still drafting this.' } });
  // Accidental exit, gated on the unsaved note: the dialog must stay open.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  // Deliberate exit, through requestClose: still works regardless of the note.
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

/*
  RULING R21 — THE TWO RECOVERY PATHS THAT WERE DEAD ENDS.

  Both arrive at this dialog as a non-2xx from `decide`, and both used to end
  the reviewer's session with the item: the 404 as a generic "not recorded"
  beside two buttons that could only ever produce it again, the resumable 409
  as "Already decided" with every button gone.
*/
test('a 404 is a verdict, not an error: the list refreshes behind the open dialog (R21)', async () => {
  let listReads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') return json({ error: 'Nothing is waiting under that entry — it may already be decided.' }, 404);
    if (u.endsWith('/admin/moderation')) { listReads += 1; return json(QUEUE); }
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  const before = listReads;
  fireEvent.click(await within(dialog).findByRole('button', { name: /^reject$/i }));
  // The server's own sentence, rendered as the verdict — not "The decision was
  // not recorded (404)", and not an alert.
  expect(await within(dialog).findByText(/nothing is waiting under that entry/i)).toBeInTheDocument();
  // The dialog stays open (the reviewer reads why); the list behind it reloads
  // so the row that is no longer waiting goes.
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await waitFor(() => expect(listReads).toBeGreaterThan(before));
  // rejects: leaving the buttons live. Every further click is the same 404.
  expect(within(dialog).queryByRole('button', { name: /^reject$/i })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /^approve$/i })).toBeNull();
});

test("a crashed decision keeps the button that finishes it, and clicking it posts again (R21)", async () => {
  const posts = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') {
      posts.push(JSON.parse(options.body));
      if (posts.length === 1) return json({ error: 'Already decided by dai.', status: 'passed', reviewer: 'dai' }, 409);
      return json({ decision: 'approve', publicSetId: 'orgacme-safety', publicVersion: 1, resumed: true });
    }
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: /^approve$/i }));

  // The sentence says what happened AND what to do about it.
  expect(await within(dialog).findByText(/Approved by dai, but that decision did not finish — Approve again to complete it\./)).toBeInTheDocument();
  // rejects: hiding the one button that would finish it — the whole defect.
  const approve = within(dialog).getByRole('button', { name: /^approve$/i });
  expect(approve).toBeEnabled();
  // rejects: offering Reject as well. The server refuses a DIFFERENT decision
  // on an already-decided review, so it would be a second dead end.
  expect(within(dialog).queryByRole('button', { name: /^reject$/i })).toBeNull();

  fireEvent.click(approve);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual({ sk: 'org_acme#safety#v2', decision: 'approve', note: '' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('a 409 that is a genuine lost race stays the dead end it was', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') return json({ error: 'That entry is not waiting for a decision (status: checking).', status: 'checking' }, 409);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: /^reject$/i }));
  expect(await within(dialog).findByText(/not waiting for a decision/i)).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: /^reject$/i })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /^approve$/i })).toBeNull();
});

/*
  W6 — the nav badge was fetched once, when staff switched into platform mode,
  and never again. Decide four items and it still said four.
*/
test('every successful load reports the count, so the nav badge follows decisions', async () => {
  const counts = [];
  render(<ModerationPanel onQueueChanged={(n) => counts.push(n)} />);
  await screen.findByText('Safety walkthrough');
  await waitFor(() => expect(counts).toEqual([2]));
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: /^approve$/i }));
  // The shared mock serves a one-item queue once anything has been decided.
  await waitFor(() => expect(counts).toEqual([2, 1]));
});

test('an outage reports nothing rather than clearing the badge to zero', async () => {
  const counts = [];
  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  render(<ModerationPanel onQueueChanged={(n) => counts.push(n)} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the queue/i);
  // rejects: reporting 0 on a failure to look, which would clear a badge that
  // is the only sign anything is waiting.
  expect(counts).toEqual([]);
});

/*
  ITEM 1b — A SET-LEVEL FINDING WITH NOTHING TO READ IT AGAINST.

  `moderation-get.js` projects all five fields `publishable.contentHash`
  judges, and the check raises `'(set)'` findings against exactly those five.
  The dialog printed the VERDICT on them — "The set's own text: uncertain for
  harassment." — and none of the text, so a reviewer was asked to decide about
  prose they could not see: the name and the description are in the header and
  the sub-line, and `customInstruction`, `aiContextInstruction` and
  `roundKindBrief` were nowhere on the screen at all.
*/
const serveItem = (overrides) => {
  const item = {
    ...ITEM,
    ...overrides,
    snapshot: { ...ITEM.snapshot, meta: { ...ITEM.snapshot.meta, ...(overrides.meta || {}) } },
  };
  delete item.meta;
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(item);
    return json({});
  });
};
const openReview = async () => {
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('heading', { name: /safety walkthrough/i });
  return dialog;
};

test("a set-level finding shows the set's own judged text, labelled", async () => {
  serveItem({
    setFindings: [{ questionId: '(set)', category: 'HARASSMENT', band: 'MEDIUM', explanation: 'x' }],
    meta: { customInstruction: 'Insult the losers' },
  });
  const dialog = await openReview();
  // The verdict line is still there…
  expect(within(dialog).getByText(/The set's own text:/)).toBeInTheDocument();
  // …and now so is the text it is a verdict ON.
  expect(within(dialog).getByText('Custom instruction')).toBeInTheDocument();
  expect(within(dialog).getByText('Insult the losers')).toBeInTheDocument();
  // rejects: a block that prints empty rows for the fields this set does not
  // carry, which would bury the one that matters in four blank lines.
  expect(within(dialog).queryByText('Round brief')).toBeNull();
  expect(within(dialog).queryByText('AI context')).toBeNull();
});

test('and with nothing flagged at set level the block is absent', async () => {
  serveItem({ setFindings: [], meta: { customInstruction: 'Insult the losers' } });
  const dialog = await openReview();
  expect(within(dialog).queryByText('Custom instruction')).toBeNull();
  expect(within(dialog).queryByText('Insult the losers')).toBeNull();
  // rejects: hiding the whole surrounding line as well — there is no set-level
  // finding here, so neither should be on screen, and the questions still are.
  expect(within(dialog).queryByText(/The set's own text:/)).toBeNull();
  expect(within(dialog).getAllByTestId('modq-question')).toHaveLength(2);
});

test('a set-level finding with the snapshot gone renders no block to read', async () => {
  serveItem({ setFindings: [{ questionId: '(set)', category: 'HARASSMENT', band: 'MEDIUM' }] });
  // The snapshot is what was judged; without it there is nothing to show, and
  // the banner above already says so.
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) {
      return json({ ...ITEM, snapshot: null, setFindings: [{ questionId: '(set)', category: 'HARASSMENT', band: 'MEDIUM' }] });
    }
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText(/The set's own text:/)).toBeInTheDocument();
  expect(within(dialog).queryByText('Custom instruction')).toBeNull();
  expect(within(dialog).queryByText('Name')).toBeNull();
});

/*
  A ROW A RE-CHECK RAISED IS NOT DECIDED HERE.

  The library is already serving that exact version, so Approve would publish a
  second public version of it and Reject would stamp its author `flagged` for a
  check nobody told them about — moderation-decide.js refuses both. A button
  that can only produce a refusal is not an action, so the row offers the two
  that are: the score card, which shows the escalation, what held it, and Take
  down; and leaving it serving, which clears the row and changes nothing else.

  The sk is the LISTING's, which is how the worker keys such a row — never the
  organisation's version key, which is their own publish request's.
*/
const RECHECKED = { count: 1, oldestWaitingSince: '2026-09-16T10:00:00.000Z', items: [
  {
    sk: 'PUBLIC#orgacme-crime', orgName: 'Acme', setId: 'orgacme-crime', title: 'True crime', version: 2,
    gameType: 'trivia', questionCount: 11, reasons: ['escalated'], uncertainQuestionIds: ['c001#003'],
    waitingSince: '2026-09-16T10:00:00.000Z', publicSetId: 'orgacme-crime', recheck: true,
  },
  ...QUEUE.items,
] };

test('a re-checked listing offers the score card and no Review, and says the library already serves it', async () => {
  global.fetch = jest.fn(async (url) => (String(url).endsWith('/admin/moderation') ? json(RECHECKED) : json(ITEM)));
  const opened = [];
  render(<ModerationPanel onOpenScoreCard={(id) => opened.push(id)} />);
  const row = (await screen.findByText('True crime')).closest('tr');
  expect(within(row).getByText('Already in the library · 1 uncertain question')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /^review$/i })).toBeNull();
  fireEvent.click(within(row).getByRole('button', { name: /score card/i }));
  expect(opened).toEqual(['orgacme-crime']);
  // rejects: hiding Review on every row. An organisation's own escalated share
  // is still decided here.
  const ordinary = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(ordinary).getByRole('button', { name: /^review$/i })).toBeInTheDocument();
});

test('a re-checked listing with no score card to open still says why it is here', async () => {
  global.fetch = jest.fn(async (url) => (String(url).endsWith('/admin/moderation') ? json(RECHECKED) : json(ITEM)));
  // No onOpenScoreCard, and no publicSetId, is the shape a legacy entry can
  // reach: the row must still not offer a button that can only be refused.
  render(<ModerationPanel />);
  const row = (await screen.findByText('True crime')).closest('tr');
  expect(within(row).queryByRole('button', { name: /^review$/i })).toBeNull();
  expect(within(row).getByText(/already in the library/i)).toBeInTheDocument();
});

/*
  …AND IT IS ANSWERED, not just redirected.

  Neither review-dialog decision applies to a re-check's row, so before "Leave it
  serving" the only way to clear it was to take down content a person had already
  approved — and the likely outcome of exactly the re-checks staff run is a
  medium band somebody already ruled on. The row, and the nav badge it feeds,
  aged for ever instead.
*/
const LEAVE = /leave it serving/i;
test('a re-checked listing is left serving from the row, and the list reloads without it', async () => {
  let left = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) { left.push(JSON.parse(options.body)); return json({ decision: 'leave', leftServing: 'orgacme-crime' }); }
    if (u.endsWith('/admin/moderation')) return json(left.length ? QUEUE : RECHECKED);
    return json(ITEM);
  });
  const counts = [];
  render(<ModerationPanel onOpenScoreCard={() => {}} onQueueChanged={(n) => counts.push(n)} />);
  const row = (await screen.findByText('True crime')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: LEAVE }));
  await waitFor(() => expect(left).toEqual([{ sk: 'PUBLIC#orgacme-crime', decision: 'leave' }]));
  await waitFor(() => expect(screen.queryByText('True crime')).toBeNull());
  // The nav badge is told, the same way every decision here tells it.
  expect(counts[counts.length - 1]).toBe(2);
  // rejects: offering it on an organisation's own row, which is a decision
  // somebody owes them rather than a row to sweep away.
  const ordinary = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(ordinary).queryByRole('button', { name: LEAVE })).toBeNull();
});

// rejects: a refusal that switches the table off — the list is still perfectly
// good, and hiding it would take every other row away over one row's refusal.
test('a refusal is said on its own line and the queue stays on the screen', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) return json({ error: 'This entry also carries a report, which is answered on the report itself.' }, 409);
    if (u.endsWith('/admin/moderation')) return json(RECHECKED);
    return json(ITEM);
  });
  render(<ModerationPanel onOpenScoreCard={() => {}} />);
  const row = (await screen.findByText('True crime')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: LEAVE }));
  expect(await screen.findByTestId('modq-rowerror')).toHaveTextContent(/carries a report/i);
  expect(screen.getByText('True crime')).toBeInTheDocument();
  expect(within(screen.getByText('True crime').closest('tr')).getByRole('button', { name: LEAVE })).toBeEnabled();
});

/*
  ── ENGAGE'S OWN SET, WHICH BELONGS TO NO ORGANISATION ────────────────────

  A check of one of Engage's shared sets raises `PLATFORM#<setId>` (spec §3.2's
  third shape; set-check-worker.js). It is `recheck: false` and carries no
  `publicSetId`, so before this the row offered Review — whose Approve and
  Reject the server refuses outright ("That is not a queue entry this screen
  decides"), while the ONE decision it accepts, `leave`, was never drawn. The
  row could not be cleared by anybody, and aged for ever in the queue and in
  the nav badge: the failure "Leave it serving" was built to fix, reappearing
  for a different key.
*/
const HOUSE = { count: 1, oldestWaitingSince: '2026-09-19T10:00:00.000Z', items: [
  {
    sk: 'PLATFORM#icebreakers', scope: 'platform', orgId: '', orgName: '', setId: 'icebreakers',
    title: 'Icebreakers', version: 1, gameType: 'poll', questionCount: 12,
    reasons: ['escalated'], uncertainQuestionIds: ['c001#003'],
    waitingSince: '2026-09-19T10:00:00.000Z', recheck: false,
  },
  ...QUEUE.items,
] };

test("a check of Engage's own set is answered from the row, not sent to a dialog that refuses it", async () => {
  const left = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) { left.push(JSON.parse(options.body)); return json({ decision: 'leave', leftServing: 'icebreakers' }); }
    if (u.endsWith('/admin/moderation')) return json(left.length ? QUEUE : HOUSE);
    return json(ITEM);
  });
  render(<ModerationPanel onOpenScoreCard={() => {}} />);
  const row = (await screen.findByText('Icebreakers')).closest('tr');
  // rejects: the Review button, whose only outcome on this row is a 400.
  expect(within(row).queryByRole('button', { name: /^review$/i })).toBeNull();
  // rejects: a Score card button keyed by a publicSetId an Engage set has not got.
  expect(within(row).queryByRole('button', { name: /score card/i })).toBeNull();
  fireEvent.click(within(row).getByRole('button', { name: LEAVE }));
  await waitFor(() => expect(left).toEqual([{ sk: 'PLATFORM#icebreakers', decision: 'leave' }]));
  await waitFor(() => expect(screen.queryByText('Icebreakers')).toBeNull());
});

// rejects: a blank Organisation cell on a set that HAS no organisation, which
// reads as a customer whose name the console could not find.
test("Engage's own row names Engage in the Organisation column", async () => {
  global.fetch = jest.fn(async (url) => (String(url).endsWith('/admin/moderation') ? json(HOUSE) : json(ITEM)));
  render(<ModerationPanel onOpenScoreCard={() => {}} />);
  const row = (await screen.findByText('Icebreakers')).closest('tr');
  expect(within(row).getByTestId('modq-org')).toHaveTextContent(/^Engage$/);
  // rejects: writing "Engage" over every row. A customer's row is unchanged.
  const ordinary = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(ordinary).getByTestId('modq-org')).toHaveTextContent('Acme');
  // The why cell does not borrow the re-check's words: this set is not "already
  // in the library" in the sense that phrase carries, which is a PUBLIC copy.
  expect(within(row).queryByText(/already in the library/i)).toBeNull();
  expect(within(row).getByText(/1 uncertain question/i)).toBeInTheDocument();
});
