import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ScoreCard from '../components/ScoreCard';

/*
  THE FIXTURE IS THE REVIEW PRODUCTION WRITES (2026-09-19).

  It used to put a LOW finding on a passed review, a shape no code path
  writes: `findings` holds only what INTERVENED, and the guardrail intervenes
  at HIGH (the set is flagged) or MEDIUM (a person looks), never at LOW. It is
  now what an escalation leaves once staff approve it — the one MEDIUM that
  held the set is the finding; the LOW the check saw and let through, and a LOW
  in the set's own text, are observations beside it; the tally counts them in
  questions (lambda-functions/admin/shared/content-guardrail.js tallyOf). Each
  assertion below still checks what it checked — the uncertain question first,
  with its explanation, the low one after it — with the question named by its
  text rather than its id.
*/
const NONE = { worst: null, low: 0, medium: 0, high: 0 };
const CARD = {
  publicSetId: 'orgacme-safety', name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia',
  sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, publicVersion: 2, questionCount: 30,
  contentHash: 'c'.repeat(64), sensitivity: ['graphic-medical'], promptDropped: true, publishedAt: '2026-08-19T10:01:00.000Z',
  review: { status: 'passed', reviewer: 'dai', decidedAt: '2026-08-19T10:00:00.000Z', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'], checkedAt: '2026-08-19T09:00:00.000Z',
    reasons: ['guardrail'],
    findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Injuries in detail.' }],
    observed: [
      { questionId: 'c001#001', category: 'VIOLENCE', band: 'LOW', intervened: false, explanation: 'A fall is named; nothing about it is described.', text: 'Ladders\nHow many points of contact should you keep on a ladder?' },
      { questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', intervened: true, explanation: 'Injuries in detail.', text: 'After a fall\nDescribe the injuries a fall from height causes.' },
      { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'Safety walkthrough\nSite safety' },
    ],
    tally: { scope: 'full', questions: 30, setTextChecked: true, setTextUnread: false, spotless: 28, unread: 0, categories: { VIOLENCE: { worst: 'MEDIUM', low: 1, medium: 1, high: 0 }, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } } },
  log: [
    { event: 'checked', at: '2026-08-19T09:00:00.000Z', version: 2, outcome: 'escalated' },
    { event: 'decided', at: '2026-08-19T10:00:00.000Z', version: 2, decision: 'approve', reviewer: 'dai', note: 'Clinical, not gratuitous.' },
    { event: 'published', at: '2026-08-19T10:01:00.000Z', version: 2, publicVersion: 2 },
  ],
};
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let deleted;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  deleted = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'DELETE') { deleted.push(JSON.parse(options.body)); return json({ takenDown: 'orgacme-safety' }); }
    return json(CARD);
  });
});

test('the identity line, the timeline newest first, and what the check saw, uncertain first', async () => {
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  const line = screen.getByTestId('scard-identity');
  expect(line).toHaveTextContent('Public v2');
  expect(line).toHaveTextContent('by Acme');
  expect(line).toHaveTextContent(/approved by dai, 19 Aug/i);
  expect(line).toHaveTextContent(/content notice: graphic medical/i);
  const events = screen.getAllByTestId('scard-event');
  expect(events[0]).toHaveTextContent(/published/i);
  expect(events[2]).toHaveTextContent(/checked/i);
  expect(events[1]).toHaveTextContent(/clinical, not gratuitous/i);
  const rows = screen.getAllByTestId('scard-obs');
  expect(rows[0]).toHaveTextContent('After a fall — Describe the injuries a fall from height causes.');
  expect(rows[0]).toHaveTextContent(/medium/i);
  expect(rows[0]).toHaveTextContent(/sent to a person/i);
  expect(rows[0]).toHaveTextContent(/injuries in detail/i);
  expect(rows[1]).toHaveTextContent(/low/i);
});
test('Take down states the consequence, needs a note, and hands back the id', async () => {
  const onTakenDown = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={onTakenDown} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/gone for everyone/i);
  expect(dialog).toHaveTextContent(/keeps their copy and sees your note/i);
  const confirm = within(dialog).getByRole('button', { name: /^take down$/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Reported for graphic detail.' } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(deleted).toEqual([{ note: 'Reported for graphic detail.' }]));
  await waitFor(() => expect(onTakenDown).toHaveBeenCalledWith('orgacme-safety'));
});
test('the back link calls onBack, and a missing set says so', async () => {
  const onBack = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={onBack} onTakenDown={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /public library/i }));
  expect(onBack).toHaveBeenCalled();
  global.fetch = jest.fn(async () => json({ error: 'No such public set.' }, 404));
  render(<ScoreCard publicSetId="gone" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/no such public set/i);
});
test('a card with no review renders without throwing (R17 Important #1)', async () => {
  const { review, ...noReview } = CARD;
  global.fetch = jest.fn(async () => json(noReview));
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
});
test('a typed note survives an accidental Escape, but a deliberate Cancel still works (R16)', async () => {
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Still drafting this.' } });
  // Accidental exit, gated on the unsaved note: the dialog must stay open.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  // Deliberate exit, through requestClose: still works regardless of the note.
  fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
test('a failed takedown keeps the note and shows why, and a retry succeeds (R17 Important #3)', async () => {
  const onTakenDown = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={onTakenDown} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  const note = within(dialog).getByRole('textbox', { name: /note/i });
  fireEvent.change(note, { target: { value: 'Reported for graphic detail.' } });

  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  fireEvent.click(within(dialog).getByRole('button', { name: /^take down$/i }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/boom/i);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(note).toHaveValue('Reported for graphic detail.');

  global.fetch = jest.fn(async (url, options = {}) => {
    deleted.push(JSON.parse(options.body));
    return json({ takenDown: 'orgacme-safety' });
  });
  fireEvent.click(within(dialog).getByRole('button', { name: /^take down$/i }));
  await waitFor(() => expect(deleted).toEqual([{ note: 'Reported for graphic detail.' }]));
  await waitFor(() => expect(onTakenDown).toHaveBeenCalledWith('orgacme-safety'));
  expect(onTakenDown).toHaveBeenCalledTimes(1);
});

/*
  WHAT THE CHECK MEASURED — the owner, 2026-09-19: the card "doesn't reveal
  much". A trivia set about serial killers read "Checked — passed" and "The
  check found nothing to say." Decision A: the card MEASURES — a tally per
  category, and the questions named by their text. Decision C: a set checked
  before measuring existed says so plainly and shows what it has — its verdict
  and its note — with no re-check and no backfill.
*/
const TRUE_CRIME = {
  ...CARD,
  publicSetId: 'orgacme-crime', name: 'True crime', description: 'Infamous cases, solved and not.', sensitivity: [], questionCount: 30,
  log: [
    { event: 'checked', at: '2026-09-19T09:00:00.000Z', version: 3, outcome: 'escalated' },
    { event: 'escalated', at: '2026-09-19T09:00:01.000Z', version: 3, reasons: ['guardrail'] },
    { event: 'decided', at: '2026-09-19T10:00:00.000Z', version: 3, decision: 'approve', reviewer: 'dai', note: 'Historical, not gratuitous.' },
    { event: 'published', at: '2026-09-19T10:01:00.000Z', version: 3, publicVersion: 1 },
  ],
  review: {
    status: 'passed', reviewer: 'dai', decidedAt: '2026-09-19T10:00:00.000Z', note: 'Historical, not gratuitous.', notice: [], checkedAt: '2026-09-19T09:00:00.000Z',
    reasons: ['guardrail'],
    findings: [{ questionId: 'c001#005', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'The wounds described in detail are what held it, not the case.' }],
    // Stored in question order with the set's own subject last, the way the
    // check writes them — putting the worst first is the card's job.
    observed: [
      { questionId: 'c001#001', category: 'MISCONDUCT', band: 'LOW', intervened: false, explanation: 'A cipher is named; nothing is taught.', text: 'The Zodiac\nWhich newspaper received the first cipher?' },
      { questionId: 'c001#002', category: 'VIOLENCE', band: 'MEDIUM', intervened: false, explanation: 'The murders are the setting; the question asks about a place.', text: 'The Ripper\nIn which district were the murders?' },
      { questionId: 'c001#003', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'Bow Street\nWho founded the Bow Street Runners?' },
      { questionId: 'c001#005', category: 'VIOLENCE', band: 'MEDIUM', intervened: true, explanation: 'The wounds described in detail are what held it, not the case.', text: 'The Black Dahlia\nDescribe the injuries found on the body.' },
      { questionId: 'c002#004', category: 'HATE', band: 'LOW', intervened: false, explanation: 'A slur is quoted from a trial record.', text: '' },
      { questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'True crime\nInfamous cases, solved and not.' },
    ],
    tally: {
      scope: 'full', questions: 30, setTextChecked: true, setTextUnread: false, spotless: 25, unread: 0,
      categories: { VIOLENCE: { worst: 'MEDIUM', low: 1, medium: 2, high: 0 }, SEXUAL: NONE, HATE: { worst: 'LOW', low: 1, medium: 0, high: 0 }, INSULTS: NONE, MISCONDUCT: { worst: 'LOW', low: 1, medium: 0, high: 0 } },
    },
  },
};
const withReview = (review, extra = {}) => ({ ...TRUE_CRIME, ...extra, review: { ...TRUE_CRIME.review, ...review } });
async function open(card) {
  global.fetch = jest.fn(async () => json(card));
  const view = render(<ScoreCard publicSetId={card.publicSetId} onBack={() => {}} onTakenDown={() => {}} />);
  await screen.findByRole('heading', { name: card.name });
  return view;
}
const cells = (row) => within(row).getAllByRole('cell');
/** The element that names a row's subject: the one that truncates, and carries the full string. */
const subjectOf = (row) => cells(row)[0].firstElementChild;

test('a measured check: the summary line from the tally, and all five categories with none written out', async () => {
  await open(TRUE_CRIME);
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("30 questions and the set's own text checked · 25 with nothing in any category");
  const cats = screen.getAllByTestId('scard-cat');
  expect(cats.map((c) => cells(c)[0].textContent)).toEqual([
    'Violence or injury', 'Sexual content', 'Hateful content', 'Insulting or harassing language', 'Dangerous or criminal instructions',
  ]);
  expect(cells(cats[0])[1]).toHaveTextContent('medium');
  expect(cells(cats[0])[2]).toHaveTextContent('2 at medium · 1 at low');
  expect(cells(cats[1])[1]).toHaveTextContent('none');
  expect(cells(cats[2])[1]).toHaveTextContent('low');
  expect(cells(cats[2])[2]).toHaveTextContent('1 at low');
  expect(cells(cats[3])[1]).toHaveTextContent('none');
  expect(cells(cats[4])[2]).toHaveTextContent('1 at low');
  expect(screen.queryByText(/nothing to say/i)).toBeNull();
});
test('every row is named by its question\'s text, worst first, and the full text survives the truncation', async () => {
  await open(TRUE_CRIME);
  const rows = screen.getAllByTestId('scard-obs');
  expect(rows.map((r) => cells(r)[0].textContent)).toEqual([
    'The Black Dahlia — Describe the injuries found on the body.',
    'The Ripper — In which district were the murders?',
    'The Zodiac — Which newspaper received the first cipher?',
    'Bow Street — Who founded the Bow Street Runners?',
    'Not in the public copy',
    "The set's own text",
  ]);
  expect(subjectOf(rows[0])).toHaveAttribute('title', 'The Black Dahlia\nDescribe the injuries found on the body.');
  expect(subjectOf(rows[4]).getAttribute('title')).toMatch(/c002#004/);
  expect(subjectOf(rows[5])).toHaveAttribute('title', 'True crime\nInfamous cases, solved and not.');
  // Hard rule 8: what truncates is ONE text node, never a box of spans, or
  // the clip is silent rather than an ellipsis.
  for (const row of rows) {
    expect(subjectOf(row).childNodes).toHaveLength(1);
    expect(subjectOf(row).firstChild.nodeType).toBe(Node.TEXT_NODE);
  }
  expect(cells(rows[0])[1]).toHaveTextContent('medium');
  expect(cells(rows[2])[1]).toHaveTextContent('low');
  expect(cells(rows[2])[2]).toHaveTextContent('dangerous or criminal instructions');
  expect(cells(rows[4])[2]).toHaveTextContent('hateful content');
  // Ids are for the machine: no row is named by one where text exists.
  expect(screen.queryByText(/c00\d#\d{3}/)).toBeNull();
});
test('the why column is the explanation, or the band sentence where there is none', async () => {
  await open(TRUE_CRIME);
  const rows = screen.getAllByTestId('scard-obs');
  expect(cells(rows[0])[3]).toHaveTextContent('The wounds described in detail are what held it, not the case.');
  expect(cells(rows[1])[3]).toHaveTextContent('The murders are the setting; the question asks about a place.');
  expect(cells(rows[3])[3]).toHaveTextContent('The check noted violence or injury at low confidence and let the question through.');
  expect(cells(rows[5])[3]).toHaveTextContent("The check noted violence or injury at low confidence and let the set's own text through.");
});
test('only a row that held the set says so: a near-miss at the same band was let through', async () => {
  const view = await open(TRUE_CRIME);
  const held = (row) => cells(row)[4].textContent;
  const rows = screen.getAllByTestId('scard-obs');
  expect(rows.map(held)).toEqual(['sent to a person', 'no', 'no', 'no', 'no', 'no']);
  view.unmount();
  // A HIGH that held the set flagged it — on a public card, an appeal a person then approved.
  await open(withReview({
    observed: [{ questionId: 'c001#005', category: 'VIOLENCE', band: 'HIGH', intervened: true, explanation: 'A killing described step by step.', text: 'The Black Dahlia\nDescribe the injuries found on the body.' }],
    tally: { ...TRUE_CRIME.review.tally, spotless: 29, categories: { ...TRUE_CRIME.review.tally.categories, VIOLENCE: { worst: 'HIGH', low: 0, medium: 0, high: 1 }, HATE: NONE, MISCONDUCT: NONE } },
  }));
  expect(screen.getAllByTestId('scard-obs').map(held)).toEqual(['flagged']);
});
test('a measured check that saw nothing says every question was clean — never that it had nothing to say', async () => {
  await open(withReview({
    reasons: [], findings: [], observed: [], reviewer: '', decidedAt: null, note: '13/13 clean',
    tally: { scope: 'full', questions: 12, setTextChecked: true, setTextUnread: false, spotless: 12, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } },
  }, { questionCount: 12 }));
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("12 questions and the set's own text checked · all clean in every category");
  const cats = screen.getAllByTestId('scard-cat');
  expect(cats).toHaveLength(5);
  expect(cats.map((c) => cells(c)[1].textContent)).toEqual(['none', 'none', 'none', 'none', 'none']);
  expect(screen.queryAllByTestId('scard-obs')).toHaveLength(0);
  expect(screen.queryByText(/nothing to say/i)).toBeNull();
  // The summary IS the measurement. "13/13 clean" counts something else — no
  // question HELD — and printing both asks the reader to reconcile 13 with 12.
  expect(screen.getByTestId('scard-verdict')).not.toHaveTextContent('13/13');
});
test('a question the check could not read is never counted clean', async () => {
  await open(withReview({
    reasons: ['error'], findings: [], observed: [],
    tally: { scope: 'full', questions: 10, setTextChecked: true, setTextUnread: false, spotless: 8, unread: 2, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } },
  }, { questionCount: 10 }));
  const summary = screen.getByTestId('scard-summary');
  expect(summary).toHaveTextContent("10 questions and the set's own text checked · 8 with nothing in any category · 2 could not be read");
  expect(summary).not.toHaveTextContent(/every question|all clean/);
});
/*
  The same rule for the set's own text. The guardrail threw on it (a throttle,
  or no guardrail configured) and staff approved the set anyway: the check
  reached the text and read nothing, so the card neither names it as checked
  nor counts it in "all clean" — and it is not "not reached" either, which is
  a check its budget stopped.
*/
test('the set\'s own text the check could not read is never named as checked, nor called clean', async () => {
  await open(withReview({
    reasons: [], findings: [{ questionId: '(set)', category: 'ERROR', band: 'NONE' }], observed: [],
    tally: { scope: 'full', questions: 3, setTextChecked: false, setTextUnread: true, spotless: 3, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } },
  }, { questionCount: 3 }));
  const summary = screen.getByTestId('scard-summary');
  expect(summary).toHaveTextContent("3 questions checked · every question clean in every category · the set's own text could not be read");
  expect(summary).not.toHaveTextContent(/own text checked|all clean|not reached/);
});
test('a check its budget stopped says how far it got, and claims nothing about the rest', async () => {
  const stopped = { scope: 'full', questions: 25, setTextChecked: false, setTextUnread: false, spotless: 25, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } };
  const view = await open(withReview({ reasons: ['timeout'], findings: [], observed: [], tally: stopped }));
  const summary = screen.getByTestId('scard-summary');
  expect(summary).toHaveTextContent("25 of 30 questions checked · all 25 clean in every category · the set's own text was not reached");
  expect(summary).not.toHaveTextContent(/every question/);
  view.unmount();
  // With no count to set it against, it still says only what it checked.
  await open(withReview({ reasons: ['timeout'], findings: [], observed: [], tally: stopped }, { questionCount: 0 }));
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("25 questions checked · all 25 clean in every category · the set's own text was not reached");
  expect(screen.getByTestId('scard-summary')).not.toHaveTextContent(/every question/);
});
/*
  A past version shared while a bigger one is active: the check reached every
  question it was given. Only a check its budget stopped reached fewer than
  the set holds, and only the tally can say it was one — never a question
  count beside it.
*/
test('a complete check is never read as cut short, whatever question count sits beside it', async () => {
  const complete = { scope: 'full', questions: 25, setTextChecked: true, setTextUnread: false, spotless: 25, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } };
  const view = await open(withReview({ reasons: [], findings: [], observed: [], tally: complete }, { questionCount: 30 }));
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("25 questions and the set's own text checked · all clean in every category");
  expect(screen.getByTestId('scard-summary')).not.toHaveTextContent(/ of \d/);
  view.unmount();
  await open(withReview({
    reasons: [], findings: [],
    observed: [{ questionId: 'c001#003', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'Bow Street\nWho founded the Bow Street Runners?' }],
    tally: { ...complete, spotless: 24, categories: { ...complete.categories, VIOLENCE: { worst: 'LOW', low: 1, medium: 0, high: 0 } } },
  }, { questionCount: 30 }));
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("25 questions and the set's own text checked · 24 with nothing in any category");
  expect(screen.getByTestId('scard-summary')).not.toHaveTextContent(/ of \d/);
});
test('a band seen only in the set\'s own text leaves every question clean, and is listed on its own', async () => {
  await open(withReview({
    reasons: [], findings: [],
    observed: [{ questionId: '(set)', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'True crime\nInfamous cases, solved and not.' }],
    tally: { scope: 'full', questions: 30, setTextChecked: true, setTextUnread: false, spotless: 30, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } },
  }));
  expect(screen.getByTestId('scard-summary')).toHaveTextContent("30 questions and the set's own text checked · every question clean in every category");
  expect(screen.getAllByTestId('scard-obs').map((r) => cells(r)[0].textContent)).toEqual(["The set's own text"]);
});
test('a set checked before measuring existed says so, with its verdict and its note', async () => {
  await open(withReview({ reasons: [], findings: [], observed: [], tally: null, reviewer: '', decidedAt: null, note: '30/30 clean' }));
  expect(screen.getByText('Checked before detailed scoring existed — this check recorded only its verdict.')).toBeInTheDocument();
  const verdict = screen.getByTestId('scard-verdict');
  expect(verdict).toHaveTextContent('Verdict: checked');
  expect(verdict).toHaveTextContent('30/30 clean');
  expect(screen.queryAllByTestId('scard-cat')).toHaveLength(0);
  expect(screen.queryByTestId('scard-summary')).toBeNull();
  expect(screen.queryByText(/nothing to say/i)).toBeNull();
});
test('a reviewer\'s note is theirs: the verdict does not quote it as the check\'s', async () => {
  await open(withReview({ reasons: [], findings: [], observed: [], tally: null, note: 'Historical, not gratuitous.' }));
  expect(screen.getByTestId('scard-verdict')).not.toHaveTextContent(/historical/i);
  // It is where the reviewer said it: on the decision, in the timeline.
  expect(screen.getAllByTestId('scard-event')[1]).toHaveTextContent(/historical, not gratuitous/i);
});
test('the timeline and the verdict speak the app\'s words, never a raw status', async () => {
  const { container } = await open({
    ...TRUE_CRIME,
    log: [
      { event: 'checked', at: '2026-09-15T09:00:00.000Z', version: 1, outcome: 'passed' },
      { event: 'checked', at: '2026-09-17T09:00:00.000Z', version: 2, outcome: 'flagged' },
      ...TRUE_CRIME.log,
    ],
  });
  const events = screen.getAllByTestId('scard-event');
  expect(events[events.length - 1]).toHaveTextContent(/Checked · v1$/);
  expect(events[events.length - 2]).toHaveTextContent(/Checked — needs changes · v2$/);
  expect(events[events.length - 3]).toHaveTextContent(/Checked — waiting for Engage · v3$/);
  for (const e of events) expect(e).not.toHaveTextContent(/\bpassed\b|\bescalated\b|\bflagged\b/);
  expect(screen.getByTestId('scard-verdict')).toHaveTextContent('Verdict: checked');
  expect(container).not.toHaveTextContent(/\bpassed\b|\bescalated\b/);
});
test('a version with no check on record says so rather than claiming a verdict', async () => {
  await open(withReview({ status: 'unreviewed', reviewer: '', decidedAt: null, note: '', findings: [], observed: [], reasons: [], tally: null, checkedAt: null }));
  expect(screen.getByText('No check is on record for the version this came from.')).toBeInTheDocument();
  expect(screen.queryByTestId('scard-verdict')).toBeNull();
  expect(screen.queryByText(/before detailed scoring existed/i)).toBeNull();
});
test('a re-check in flight reads as checking, and one that never finished says so', async () => {
  const running = { reviewer: '', decidedAt: null, note: '', findings: [], observed: [], reasons: [], tally: null };
  const view = await open(withReview({ ...running, status: 'checking', checkedAt: new Date(Date.now() - 60 * 1000).toISOString() }));
  expect(screen.getByTestId('scard-verdict')).toHaveTextContent('Verdict: checking…');
  expect(screen.queryByText(/before detailed scoring existed/i)).toBeNull();
  view.unmount();
  await open(withReview({ ...running, status: 'checking', checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
  expect(screen.getByTestId('scard-verdict')).toHaveTextContent("Verdict: didn't finish");
});
