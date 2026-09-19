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
  // The tally counts questions; the set's own text, seen here too, is named beside them.
  expect(cells(cats[0])[2].textContent).toBe("2 at medium · 1 at low · the set's own text at low");
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
  expect(screen.getAllByTestId('scard-obs').map(held)).toEqual(['needs changes']);
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
  // The category block says so too: every category's question count is empty,
  // and violence was still seen — in the set's own text, never "none".
  const cats = screen.getAllByTestId('scard-cat');
  expect(cells(cats[0])[1].textContent).toBe('low');
  expect(cells(cats[0])[2].textContent).toBe("the set's own text at low");
  expect(cats.slice(1).map((c) => cells(c)[1].textContent)).toEqual(['none', 'none', 'none', 'none']);
});
/*
  The final review, 2026-09-19: the tally counts QUESTIONS (content-guardrail.js
  tallyOf skips the set's own subject), so a category seen only in the set's
  own text had a null `worst`, and the card wrote "none" for it — one line
  above that text's own row, sending the set to a person.
*/
test('the category block never writes none over the set\'s own text, least of all where that text held the set', async () => {
  const SET_HELD = { questionId: '(set)', category: 'VIOLENCE', band: 'MEDIUM', intervened: true, text: 'True crime\nInfamous cases, solved and not.' };
  const clean = { scope: 'full', questions: 30, setTextChecked: true, setTextUnread: false, spotless: 30, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } };
  const view = await open(withReview({
    reasons: ['guardrail'], findings: [{ questionId: '(set)', category: 'VIOLENCE', band: 'MEDIUM' }], observed: [SET_HELD], tally: clean,
  }));
  const violence = screen.getAllByTestId('scard-cat')[0];
  expect(cells(violence)[1].textContent).toBe('medium');
  expect(cells(violence)[2].textContent).toBe("the set's own text at medium");
  expect(cells(screen.getAllByTestId('scard-obs')[0])[4]).toHaveTextContent('sent to a person');
  view.unmount();
  // Beside a question seen lower, the set's own text still sets the worst, and says it was the set's.
  await open(withReview({
    reasons: ['guardrail'], findings: [{ questionId: '(set)', category: 'VIOLENCE', band: 'MEDIUM' }],
    observed: [{ questionId: 'c001#003', category: 'VIOLENCE', band: 'LOW', intervened: false, text: 'Bow Street\nWho founded the Bow Street Runners?' }, SET_HELD],
    tally: { ...clean, spotless: 29, categories: { ...clean.categories, VIOLENCE: { worst: 'LOW', low: 1, medium: 0, high: 0 } } },
  }));
  const mixed = screen.getAllByTestId('scard-cat')[0];
  expect(cells(mixed)[1].textContent).toBe('medium');
  expect(cells(mixed)[2].textContent).toBe("1 at low · the set's own text at medium");
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
/*
  CHECKED BEFORE MEASURING, THEN DECIDED BY A PERSON — the final review,
  2026-09-19. The pre-tally card printed one line, "this check recorded only
  its verdict": true of a pass nobody touched, false of every escalation or
  appeal staff approved. An approval KEEPS the row (set-review.js
  transitionReview spreads it), so the findings that held the set stay on it
  with their explanations, and the reviewer's note is written over the
  check's "N/N clean" — which the check's own `checked` event still carries.
  The base card listed those findings. The measured card lists them too, by
  their text, and says what that check did and did not keep.
*/
const DECIDED = {
  ...TRUE_CRIME,
  sourceVersion: 3,
  publicVersion: 1,
  log: [
    { event: 'checked', at: '2026-09-18T09:00:00.000Z', version: 3, outcome: 'escalated', reasons: ['guardrail'], checked: 31, clean: 29 },
    { event: 'escalated', at: '2026-09-18T09:00:01.000Z', version: 3, reasons: ['guardrail'] },
    { event: 'decided', at: '2026-09-18T10:00:00.000Z', version: 3, decision: 'approve', reviewer: 'dai', note: 'Historical, not gratuitous.' },
    { event: 'published', at: '2026-09-18T10:01:00.000Z', version: 3, publicVersion: 1 },
  ],
  review: {
    status: 'passed', reviewer: 'dai', decidedAt: '2026-09-18T10:00:00.000Z', note: 'Historical, not gratuitous.', notice: [], checkedAt: '2026-09-18T09:00:00.000Z',
    reasons: ['guardrail'], tally: null, observed: [],
    // In the order the check stored them; worst first is the card's job.
    findings: [
      { questionId: 'c001#005', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'The wounds described in detail are what held it, not the case.', text: 'The Black Dahlia\nDescribe the injuries found on the body.' },
      { questionId: '(set)', category: 'HATE', band: 'MEDIUM', text: 'True crime\nInfamous cases, solved and not.' },
    ],
  },
};
const decided = (review, extra = {}) => ({ ...DECIDED, ...extra, review: { ...DECIDED.review, ...review } });
const PRE_TALLY_HELD = 'Checked before detailed scoring existed — this check recorded only what held the set, nothing it let through.';

// rejects: HEAD's card, which read no findings at all and told the reader the
// check "recorded only its verdict" above an empty space.
test('a set checked before measuring and approved by a person still lists what held it, by its text', async () => {
  await open(DECIDED);
  expect(screen.getByTestId('scard-pretally')).toHaveTextContent(PRE_TALLY_HELD);
  expect(screen.queryByText(/only its verdict/)).toBeNull();
  const rows = screen.getAllByTestId('scard-obs');
  expect(rows.map((r) => cells(r)[0].textContent)).toEqual(['The Black Dahlia — Describe the injuries found on the body.', "The set's own text"]);
  expect(subjectOf(rows[0])).toHaveAttribute('title', 'The Black Dahlia\nDescribe the injuries found on the body.');
  expect(cells(rows[0])[1]).toHaveTextContent('medium');
  expect(cells(rows[0])[2]).toHaveTextContent('violence or injury');
  expect(cells(rows[0])[3]).toHaveTextContent('The wounds described in detail are what held it, not the case.');
  expect(cells(rows[0])[4]).toHaveTextContent('sent to a person');
  expect(cells(rows[1])[2]).toHaveTextContent('hateful content');
  expect(cells(rows[1])[3]).toHaveTextContent("The check was unsure (medium confidence) whether the set's own text contains hateful content, so a person will look.");
  expect(cells(rows[1])[4]).toHaveTextContent('sent to a person');
  // Nothing was measured, so there is no tally to show and none is invented.
  expect(screen.queryAllByTestId('scard-cat')).toHaveLength(0);
  expect(screen.queryByTestId('scard-summary')).toBeNull();
  expect(screen.queryByText(/c00\d#\d{3}/)).toBeNull();
});
test('an approved appeal keeps the finding that flagged it, and it reads first', async () => {
  await open(decided({
    findings: [
      ...DECIDED.review.findings,
      { questionId: 'c002#001', category: 'MISCONDUCT', band: 'HIGH', explanation: 'The method is set out step by step.', text: 'The Poisoner\nHow was the poison prepared and given?' },
    ],
  }));
  const rows = screen.getAllByTestId('scard-obs');
  expect(cells(rows[0])[0].textContent).toBe('The Poisoner — How was the poison prepared and given?');
  expect(cells(rows[0])[1]).toHaveTextContent('high');
  expect(cells(rows[0])[2]).toHaveTextContent('dangerous or criminal instructions');
  expect(cells(rows[0])[4]).toHaveTextContent('needs changes');
  expect(rows).toHaveLength(3);
});
// rejects: dropping the check's own note the moment a reviewer's replaced it
// on the row, and borrowing counts from a check that was not this one.
test('the check\'s "N/N clean" stays beside the verdict, read from its own logged check once a reviewer\'s note replaced it', async () => {
  const view = await open(DECIDED);
  const verdict = screen.getByTestId('scard-verdict');
  expect(verdict).toHaveTextContent('Verdict: checked · “29/31 clean”');
  expect(verdict).not.toHaveTextContent(/historical/i);
  view.unmount();
  // The latest check of this version crashed and counted nothing; an older one's counts are not its.
  const crashed = await open(decided({}, {
    log: [
      { event: 'checked', at: '2026-09-17T09:00:00.000Z', version: 3, outcome: 'passed', reasons: [], checked: 31, clean: 31 },
      { event: 'checked', at: '2026-09-18T09:00:00.000Z', version: 3, outcome: 'escalated', reasons: ['error'], error: 'Throttled' },
      ...DECIDED.log.slice(1),
    ],
  }));
  expect(screen.getByTestId('scard-verdict').textContent).toBe('Verdict: checked');
  crashed.unmount();
  // Nor are another version's.
  await open(decided({}, { log: [{ event: 'checked', at: '2026-09-18T09:00:00.000Z', version: 2, outcome: 'passed', reasons: [], checked: 25, clean: 25 }, ...DECIDED.log.slice(1)] }));
  expect(screen.getByTestId('scard-verdict').textContent).toBe('Verdict: checked');
});
// rejects: a subject the guardrail never read being dressed as a band row —
// "noted at none confidence and let through" — or left out, which would make
// "what held the set" point at nothing.
test('what that check could not read held the set too, and it is said in words, never as a band', async () => {
  const view = await open(decided({
    // A subject the guardrail could not read escalates through the outcome and
    // adds no reason. `error` is the worker's catch block alone — a check that
    // did not finish — and reads otherwise (below).
    reasons: [],
    findings: [
      { questionId: 'c001#003', category: 'ERROR', band: 'NONE', detail: 'Throttled', text: 'Bow Street\nWho founded the Bow Street Runners?' },
      { questionId: 'c001#004', category: 'ERROR', band: 'NONE', detail: 'Throttled', text: 'The Yard\nWhere was Scotland Yard first housed?' },
      { questionId: '(set)', category: 'UNCONFIGURED', band: 'NONE', text: 'True crime\nInfamous cases, solved and not.' },
    ],
  }));
  expect(screen.getByTestId('scard-pretally').textContent).toBe(`${PRE_TALLY_HELD} 2 questions could not be read. The set's own text could not be read.`);
  expect(screen.queryAllByTestId('scard-obs')).toHaveLength(0);
  expect(screen.queryByText(/none confidence/)).toBeNull();
  view.unmount();
  await open(decided({ reasons: ['timeout'], findings: [{ questionId: null, category: 'TIMEOUT', band: 'NONE', text: '' }] }));
  expect(screen.getByTestId('scard-pretally').textContent).toBe(`${PRE_TALLY_HELD} The check was stopped before it finished.`);
  expect(screen.queryAllByTestId('scard-obs')).toHaveLength(0);
});

/*
  A CHECK THAT DID NOT FINISH — the final review, 2026-09-19. The worker keeps
  a tally only once measuring has finished (set-check-worker.js). A check that
  throws before then writes its review from the catch block: `reasons:
  ['error']` in place of whatever it had gathered, its error as the note, and
  no tally or observations, which writeReview drops as null. This one threw
  after its snapshot was saved, so a person could approve it, and approving
  keeps the row. The card read every review without a tally as one checked
  before detailed scoring existed — false of every check since that failed
  like this.
*/
const UNFINISHED = {
  ...DECIDED,
  log: [
    { event: 'checked', at: '2026-09-19T09:00:00.000Z', version: 3, outcome: 'escalated', reasons: ['error'], error: "Cannot read properties of undefined (reading 'trim')", snapshotKey: 'moderation/org_acme/safety/v3/2026-09-19T09-00-00-000Z.json' },
    { event: 'escalated', at: '2026-09-19T09:00:01.000Z', version: 3, reasons: ['error'] },
    { event: 'decided', at: '2026-09-19T10:00:00.000Z', version: 3, decision: 'approve', reviewer: 'dai', note: 'Read every question myself.' },
    { event: 'published', at: '2026-09-19T10:01:00.000Z', version: 3, publicVersion: 1 },
  ],
  review: {
    status: 'passed', reviewer: 'dai', decidedAt: '2026-09-19T10:00:00.000Z', note: 'Read every question myself.', notice: [], checkedAt: '2026-09-19T09:00:00.000Z',
    reasons: ['error'], findings: [], tally: null, observed: [],
  },
};
const UNFINISHED_LINE = 'This check did not finish — it recorded no detailed scoring.';

// rejects: HEAD's card, which read the missing tally as the check's age and
// told the reader a check that never got as far as measuring was "checked
// before detailed scoring existed".
test('a check that stopped on an error says it did not finish, never that it came before detailed scoring', async () => {
  const view = await open(UNFINISHED);
  expect(screen.getByTestId('scard-pretally').textContent).toBe(UNFINISHED_LINE);
  expect(screen.queryByText(/before detailed scoring existed/)).toBeNull();
  expect(screen.getByTestId('scard-verdict').textContent).toBe('Verdict: checked');
  expect(screen.queryAllByTestId('scard-cat')).toHaveLength(0);
  expect(screen.queryByTestId('scard-summary')).toBeNull();
  view.unmount();
  // Before measuring existed, a check that threw after the guardrail answered
  // kept what held the set. It did not finish either, and says so above it.
  await open({ ...UNFINISHED, review: { ...UNFINISHED.review, findings: [DECIDED.review.findings[0]] } });
  expect(screen.getByTestId('scard-pretally').textContent).toBe(UNFINISHED_LINE);
  expect(screen.getAllByTestId('scard-obs')).toHaveLength(1);
});

/*
  WHY A PERSON WAS NEEDED — the final review, 2026-09-19. The endpoint sends
  the check's reasons and the card printed none of them. One line under the
  verdict, measured or not, in the moderation queue's words
  (utils/moderationRow.js whyLabel) rather than a second vocabulary.
*/
const CLEAN = { scope: 'full', questions: 30, setTextChecked: true, setTextUnread: false, spotless: 30, unread: 0, categories: { VIOLENCE: NONE, SEXUAL: NONE, HATE: NONE, INSULTS: NONE, MISCONDUCT: NONE } };
test('the check\'s reasons read in the queue\'s words under the verdict, whether or not it measured', async () => {
  const measured = await open(TRUE_CRIME);
  expect(screen.getByTestId('scard-reasons').textContent).toBe('Why a person was needed: Uncertain');
  measured.unmount();
  const before = await open(DECIDED);
  expect(screen.getByTestId('scard-reasons').textContent).toBe('Why a person was needed: Uncertain');
  before.unmount();
  const stopped = await open(UNFINISHED);
  expect(screen.getByTestId('scard-reasons').textContent).toBe('Why a person was needed: Error');
  stopped.unmount();
  // Images the text filters cannot see and the author's own notice, on a check that saw nothing.
  await open(withReview({ reasons: ['images', 'declared'], findings: [], observed: [], tally: CLEAN }, {
    log: [
      { event: 'checked', at: '2026-09-19T09:00:00.000Z', version: 3, outcome: 'escalated', reasons: ['images', 'declared'], checked: 31, clean: 31 },
      { event: 'escalated', at: '2026-09-19T09:00:01.000Z', version: 3, reasons: ['images', 'declared'] },
      ...TRUE_CRIME.log.slice(2),
    ],
  }));
  expect(screen.getByTestId('scard-reasons').textContent).toBe('Why a person was needed: Declared: a content notice · Images');
});
// rejects: whyLabel's "Waiting", its word for a queue row with no reason,
// printed under every verdict the check reached on its own.
test('a check that needed no person says nothing about one', async () => {
  await open(withReview({ reasons: [], findings: [], observed: [], reviewer: '', decidedAt: null, note: '31/31 clean', tally: CLEAN }, {
    log: [
      { event: 'checked', at: '2026-09-19T09:00:00.000Z', version: 3, outcome: 'passed', reasons: [], checked: 31, clean: 31 },
      { event: 'published', at: '2026-09-19T09:00:02.000Z', version: 3, publicVersion: 1 },
    ],
  }));
  expect(screen.getByTestId('scard-verdict')).toHaveTextContent('Verdict: checked');
  expect(screen.queryByTestId('scard-reasons')).toBeNull();
});

/*
  ONE WORD FOR A FLAG — the final review, 2026-09-19. The held column said
  "flagged", the raw status, for a HIGH that held the set, a line below a
  timeline that says the same outcome the way the rest of the app does
  (utils/shareState.js versionChip).
*/
test('a HIGH that held the set says so in the word the timeline uses for the same flag', async () => {
  const HIGH = { questionId: 'c002#001', category: 'MISCONDUCT', band: 'HIGH', explanation: 'The method is set out step by step.' };
  const { container } = await open(withReview({
    reasons: [], findings: [HIGH],
    observed: [{ ...HIGH, intervened: true, text: 'The Poisoner\nHow was the poison prepared and given?' }],
    tally: { ...CLEAN, spotless: 29, categories: { ...CLEAN.categories, MISCONDUCT: { worst: 'HIGH', low: 0, medium: 0, high: 1 } } },
  }, {
    sourceVersion: 3,
    publicVersion: 1,
    log: [
      { event: 'checked', at: '2026-09-19T09:00:00.000Z', version: 3, outcome: 'flagged', reasons: [], checked: 31, clean: 30 },
      { event: 'appealed', at: '2026-09-19T09:30:00.000Z', version: 3, message: 'It is a history set.' },
      { event: 'decided', at: '2026-09-19T10:00:00.000Z', version: 3, decision: 'approve', reviewer: 'dai', note: 'Historical, not gratuitous.' },
      { event: 'published', at: '2026-09-19T10:01:00.000Z', version: 3, publicVersion: 1 },
    ],
  }));
  expect(cells(screen.getAllByTestId('scard-obs')[0])[4].textContent).toBe('needs changes');
  const events = screen.getAllByTestId('scard-event');
  expect(events[events.length - 1]).toHaveTextContent('Checked — needs changes');
  expect(container).not.toHaveTextContent(/\bflagged\b/);
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
