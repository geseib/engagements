/**
 * THE SURVEY GENERATOR — components/SurveyAIBuilder.jsx, mockups 02 and 03
 * (docs/design/survey-redesign/02-generate.html, 03-review.html).
 *
 * What it replaces, and why each test below exists:
 *
 *   - Three "Include question types" checkboxes, two of which never did
 *     anything: the key was built as `include${Multiple_choice}` minus one
 *     underscore — `includeMultiplechoice` — against state named
 *     `includeMultipleChoice`, so the box read undefined and wrote a key nothing
 *     read (Phase 0 fix 1). Now five kind toggles, sent as `kinds`.
 *   - An attached document appended to "Additional Requirements". The material
 *     is the INPUT, so it has its own field and travels as `source`.
 *   - A count of 1–50. The cap is 20 and the form says how long it will take.
 *   - An export-only exit: "Export JSON and close", with no survey write path
 *     anywhere. The worker now creates a draft survey set (Track A, A5) and
 *     this builder hands over exactly as the trivia and poll builders do.
 *
 * The API is mocked at `../auth/authFetch`, the recipe generatedSetHandoff and
 * generationJobResume establish. FileUploadPrompt is replaced by a button that
 * reports extracted text, because what is under test is where that text LANDS,
 * not how a PDF is parsed. No geometric assertions — jsdom has no layout.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../components/FileUploadPrompt', () => function FakeFileUploadPrompt({ onContentExtracted }) {
  return (
    <button type="button" onClick={() => onContentExtracted('DECK: the approval flow, three customer stories')}>
      Attach the deck (fake)
    </button>
  );
});

const { authFetch } = require('../auth/authFetch');
const SurveyAIBuilder = require('../components/SurveyAIBuilder').default;

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Contract-shaped items, as A5's normalizeItem returns them. */
const ITEMS = [
  { kind: 'rating', title: 'How useful was today’s session?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['feedback'] },
  { kind: 'choice', title: 'Which part was most valuable?', required: true, options: ['Live demo', 'Customer stories', 'Pricing roadmap'], allowMultiple: false, maxPicks: null, allowOther: false, shuffle: false, tags: [] },
  { kind: 'text', title: 'What was the best part?', required: false, textLength: 'long', maxLength: 500, placeholder: '', themes: true, tags: [] },
];

const CREATED = { setId: 'q3-feedback', setName: 'Q3 feedback' };

/** The wire shape `jobToResponse()` really sends. Do not invent fields. */
const jobPayload = (overrides = {}) => ({
  jobId: 'job-s1',
  status: 'complete',
  phase: 'Generated 3 of 3',
  requested: 3,
  completed: 3,
  items: ITEMS,
  warnings: [],
  meta: null,
  error: null,
  createdSet: null,
  setCreationError: null,
  updatedAt: '2026-09-23T10:00:00.000Z',
  ...overrides,
});

function mockApi(job = jobPayload()) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST' && url.includes('admin/ai-generate-survey')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-s1', status: 'queued', requested: 3 });
    }
    if (method === 'GET' && url.includes('admin/ai-generate-survey/job-s1')) {
      return jsonResponse(200, job);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

function draw(props = {}) {
  const onClose = jest.fn();
  const onSurveyGenerated = jest.fn();
  render(<SurveyAIBuilder onClose={onClose} onSurveyGenerated={onSurveyGenerated} {...props} />);
  return { onClose, onSurveyGenerated };
}

const kindToggle = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const writeButton = () => screen.getByRole('button', { name: /Write the survey/i });
const material = () => screen.getByLabelText(/What was the session\?/i);
const goal = () => screen.getByLabelText(/What do you want to find out\?/i);
const countField = () => screen.getByRole('spinbutton', { name: /How many questions/i });

/** Fill the form enough to start, press Write, and wait for the POST. */
async function start(posted) {
  fireEvent.change(goal(), { target: { value: 'Whether the new format worked' } });
  fireEvent.click(writeButton());
  await waitFor(() => expect(posted).toHaveLength(1));
  return posted[0];
}

/** Run a generation to its review step. */
async function review(job, props) {
  const posted = mockApi(job);
  const utils = draw(props);
  await start(posted);
  await screen.findByRole('heading', { name: /Workie wrote 3 questions/i });
  return { posted, ...utils };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.API_BASE = 'https://api.example.test/dev/';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------------ the form -- */

describe('the form is mockup 02', () => {
  test('it is a named dialog titled for what it does', () => {
    mockApi();
    draw();
    expect(screen.getByRole('dialog', { name: 'Generate a survey' })).toBeInTheDocument();
  });

  test('five kind toggles, icon and word, every one on except Ranking', () => {
    // rejects: the three checkboxes, and a default of all five.
    mockApi();
    draw();
    const group = screen.getByRole('group', { name: 'Kinds of question' });
    const toggles = within(group).getAllByRole('button');
    expect(toggles.map((b) => b.textContent.replace('✓', '').trim())).toEqual([
      'Rating', 'Multiple choice', 'Yes / No', 'Ranking', 'Open answer',
    ]);
    expect(toggles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'false', 'true']);
  });

  test('the toggles reach the request as `kinds`, in menu order', async () => {
    // THE PHASE 0 FIX. rejects: any `include*` key — the checkbox for
    // multiple choice wrote `includeMultiplechoice`, which nothing read.
    const posted = mockApi();
    draw();
    fireEvent.click(kindToggle('Ranking'));
    fireEvent.click(kindToggle('Yes / No'));
    const body = await start(posted);
    expect(body.kinds).toEqual(['rating', 'choice', 'rank', 'text']);
    expect(Object.keys(body).filter((k) => k.startsWith('include'))).toEqual([]);
  });

  test('at least one kind stays on', () => {
    // rejects: a survey with no kind of question, which the server would read
    // as "all five" — the opposite of what the operator just did.
    mockApi();
    draw();
    ['Rating', 'Multiple choice', 'Yes / No'].forEach((k) => fireEvent.click(kindToggle(k)));
    expect(kindToggle('Open answer')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(kindToggle('Open answer'));
    expect(kindToggle('Open answer')).toHaveAttribute('aria-pressed', 'true');
  });

  /*
    HOW MANY is asked with the shared CountField — "the builders all ask the
    same way" (countField.test.jsx): presets first, then one exact row. Mockup
    02's Quick 5 / Standard 8 / Thorough 12 are its three presets, and the
    words travel in the field's hint.
  */
  const preset = (n) => within(screen.getByRole('radiogroup', { name: /How many questions/i }))
    .getByRole('radio', { name: String(n) });

  test('8 by default; the presets are 5, 8 and 12 and set the number', async () => {
    const posted = mockApi();
    draw();
    const presets = within(screen.getByRole('radiogroup', { name: /How many questions/i })).getAllByRole('radio');
    expect(presets.map((r) => r.textContent)).toEqual(['5', '8', '12']);
    expect(preset(8)).toHaveAttribute('aria-checked', 'true');
    expect(countField()).toHaveValue(8);
    expect(screen.getByText(/Quick is 5, standard 8, thorough 12/)).toBeInTheDocument();
    fireEvent.click(preset(5));
    expect(countField()).toHaveValue(5);
    expect(preset(5)).toHaveAttribute('aria-checked', 'true');
    const body = await start(posted);
    expect(body.questionCount).toBe(5);
  });

  test('the number is capped at 20, on screen and in the request', async () => {
    // rejects: the old ceiling of 50, and a field that shows 35 while the
    // server silently makes 20.
    const posted = mockApi();
    draw();
    fireEvent.change(countField(), { target: { value: '35' } });
    expect(countField()).toHaveValue(20);
    [5, 8, 12].forEach((n) => expect(preset(n)).toHaveAttribute('aria-checked', 'false'));
    const body = await start(posted);
    expect(body.questionCount).toBe(20);
  });

  test('it says how long the survey will take to answer', () => {
    // 8 across four kinds, two open answers: 6×20s + 2×60s = 4 minutes.
    mockApi();
    draw();
    expect(screen.getByText('about 4 minutes to answer')).toBeInTheDocument();
    fireEvent.click(preset(5));
    ['Rating', 'Multiple choice', 'Yes / No'].forEach((k) => fireEvent.click(kindToggle(k)));
    // Five open answers: a minute each.
    expect(screen.getByText('about 5 minutes to answer')).toBeInTheDocument();
  });

  test('an attached document lands in the material, never in the instructions', async () => {
    // rejects: the shipped `customPrompt + '\n\n' + content`. The material is
    // what the questions are ABOUT; the instructions are rules Workie obeys.
    const posted = mockApi();
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Attach the deck/ }));
    expect(material()).toHaveValue('DECK: the approval flow, three customer stories');
    // Reported twice (Process, then "Use this content") is still once.
    fireEvent.click(screen.getByRole('button', { name: /Attach the deck/ }));
    expect(material()).toHaveValue('DECK: the approval flow, three customer stories');
    const body = await start(posted);
    expect(body.source).toBe('DECK: the approval flow, three customer stories');
    expect(body.customPrompt).toBe('');
  });

  test('the instructions live behind "Anything else Workie must obey"', async () => {
    const posted = mockApi();
    draw();
    const more = screen.getByText('Anything else Workie must obey').closest('details');
    expect(more).not.toHaveAttribute('open');
    fireEvent.change(within(more).getByRole('textbox'), { target: { value: 'No leading questions.' } });
    const body = await start(posted);
    expect(body.customPrompt).toBe('No leading questions.');
  });

  test('the request is the generator contract, plus the set copy the worker names the set from', async () => {
    // A5's request: source, goal, kinds, questionCount, title, description,
    // customPrompt. `setMetadata` rides along because shared/generated-set.js
    // reads the set's title from `setMetadata.title` (or `customTitle`) and
    // creates NOTHING without one — the trivia and poll builders send it too.
    const posted = mockApi();
    draw();
    fireEvent.change(material(), { target: { value: 'Q3 all-hands\n1. Q2 recap' } });
    fireEvent.change(screen.getByLabelText(/Name it/i), { target: { value: 'Q3 All-Hands feedback' } });
    const body = await start(posted);
    expect(body).toEqual({
      source: 'Q3 all-hands\n1. Q2 recap',
      goal: 'Whether the new format worked',
      kinds: ['rating', 'choice', 'yesno', 'text'],
      questionCount: 8,
      title: 'Q3 All-Hands feedback',
      description: expect.stringContaining('Whether the new format worked'),
      customPrompt: '',
      setMetadata: {
        title: 'Q3 All-Hands feedback',
        description: expect.stringContaining('Whether the new format worked'),
      },
    });
  });

  test('with no name typed, the set is named from the material — and the field says so first', async () => {
    const posted = mockApi();
    draw();
    fireEvent.change(material(), { target: { value: 'Q3 all-hands, 22 Sep\n1. Q2 recap' } });
    expect(screen.getByLabelText(/Name it/i)).toHaveAttribute('placeholder', 'Q3 all-hands, 22 Sep');
    const body = await start(posted);
    expect(body.title).toBe('Q3 all-hands, 22 Sep');
    expect(body.setMetadata.title).toBe('Q3 all-hands, 22 Sep');
  });

  test('Write stays off until there is something to write about', () => {
    mockApi();
    draw();
    expect(writeButton()).toBeDisabled();
    fireEvent.change(material(), { target: { value: 'An outline' } });
    expect(writeButton()).toBeEnabled();
  });
});

/* ------------------------------------------------------------ the exits -- */

describe('every way out is one requestClose', () => {
  test('an untouched form closes from the X and from Cancel', () => {
    mockApi();
    const { onClose } = draw();
    fireEvent.click(screen.getByRole('button', { name: /Close the survey generator/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('with typed material it asks first, and keeps the work on No', () => {
    mockApi();
    const { onClose } = draw();
    fireEvent.change(material(), { target: { value: 'A long outline' } });
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Close the survey generator/i }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------ review, mockup 03 -- */

describe('when the worker has made the draft set', () => {
  test('the table is a receipt: kinds are chips, and the way on opens the set', async () => {
    // rejects: offering "Save as a draft survey" over a set that exists (the
    // importer would refuse it and report a failure over a set sitting there),
    // and a live kind select over rows already saved.
    await review(jobPayload({ createdSet: CREATED }));
    expect(screen.getByRole('button', { name: /Open .Q3 feedback./ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as a draft survey/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Kind of question/i })).toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Rating')).toBeInTheDocument();
    expect(within(table).getByText('Multiple choice')).toBeInTheDocument();
    expect(within(table).getByText('Open answer')).toBeInTheDocument();
  });

  test('each question carries its preview line', async () => {
    await review(jobPayload({ createdSet: CREATED }));
    expect(screen.getByText('1–5 · Not useful → Very useful')).toBeInTheDocument();
    expect(screen.getByText('3 options · pick one')).toBeInTheDocument();
    expect(screen.getByText('Long answer · up to 500 characters')).toBeInTheDocument();
  });

  test('opening it hands the page a pointer and nothing to write', async () => {
    const { onSurveyGenerated } = await review(jobPayload({ createdSet: CREATED }));
    fireEvent.click(screen.getByRole('button', { name: /Open .Q3 feedback./ }));
    expect(onSurveyGenerated).toHaveBeenCalledWith({ createdSet: CREATED });
    expect(authFetch.mock.calls.filter(([url]) => String(url).includes('upload-questions'))).toHaveLength(0);
  });

  test('the JSON export is gone', async () => {
    // rejects: "Export JSON and close" — the Phase 0 dead end.
    await review(jobPayload({ createdSet: CREATED }));
    expect(screen.queryByRole('button', { name: /JSON/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Download as CSV/i })).toBeInTheDocument();
  });
});

describe('when there is no set yet (an older job, or a creation that failed)', () => {
  test('the kind is a select, and choice → ranking keeps the list without asking', async () => {
    await review(jobPayload());
    const confirm = jest.spyOn(window, 'confirm');
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of question 2' }), { target: { value: 'rank' } });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Kind of question 2' })).toHaveValue('rank');
    expect(screen.getByText(/3 items · rank all/)).toBeInTheDocument();
    // Mockup 03, row 6: the row says what it was.
    expect(screen.getByText(/was Multiple choice/)).toBeInTheDocument();
  });

  test('a switch that would throw something away asks first, naming it', async () => {
    await review(jobPayload());
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of question 1' }), { target: { value: 'text' } });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/“Not useful”[\s\S]*“Very useful”/));
    expect(screen.getByRole('combobox', { name: 'Kind of question 1' })).toHaveValue('rating');

    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of question 1' }), { target: { value: 'text' } });
    expect(screen.getByRole('combobox', { name: 'Kind of question 1' })).toHaveValue('text');
  });

  test('the mix line counts the kept questions and their minutes', async () => {
    // rating + choice + text = 20 + 20 + 60 = 100s → 2 minutes. Leave the
    // open answer out: 40s → 1 minute.
    await review(jobPayload());
    expect(screen.getByText(/3 kept · about 2 minutes/)).toBeInTheDocument();
    const third = within(screen.getByRole('table')).getAllByRole('row')[3];
    fireEvent.click(within(third).getByRole('button', { name: /Leave out/ }));
    expect(screen.getByText(/2 kept · about 1 minute\b/)).toBeInTheDocument();
  });

  // rejects: saving a kept row the review cannot fill in — a rating switched
  // to multiple choice has blank options the table cannot edit, and the
  // importer would skip it (review finding, 2026-09-23).
  test('Save waits while a kept question could not be imported, and says why', async () => {
    await review(jobPayload());
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of question 1' }), { target: { value: 'choice' } });
    const save = screen.getByRole('button', { name: /as a draft survey/ });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', expect.stringMatching(/leave it out|leave them out/i));

    const first = within(screen.getByRole('table')).getAllByRole('row')[1];
    fireEvent.click(within(first).getByRole('button', { name: /Leave out/ }));
    expect(screen.getByRole('button', { name: /as a draft survey/ })).toBeEnabled();
  });

  test('saving hands over the kept questions, converted, with the set copy', async () => {
    // rejects: `{ survey, metadata }` for a Blob download. The page now makes
    // a draft set from `{ questions, metadata }`, as it does for trivia.
    const { onSurveyGenerated } = await review(jobPayload());
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of question 2' }), { target: { value: 'rank' } });
    const third = within(screen.getByRole('table')).getAllByRole('row')[3];
    fireEvent.click(within(third).getByRole('button', { name: /Leave out/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 as a draft survey' }));

    expect(onSurveyGenerated).toHaveBeenCalledTimes(1);
    const payload = onSurveyGenerated.mock.calls[0][0];
    expect(payload.createdSet).toBeUndefined();
    expect(payload.questions.map((q) => [q.kind, q.title])).toEqual([
      ['rating', 'How useful was today’s session?'],
      ['rank', 'Which part was most valuable?'],
    ]);
    expect(payload.questions[1].options).toEqual(['Live demo', 'Customer stories', 'Pricing roadmap']);
    expect(payload.metadata.title).toBeTruthy();
    expect(payload.metadata.description).toMatch(/Whether the new format worked/);
  });
});
