/**
 * MAKING A NEW SET — components/QuestionSetUploadPanel.jsx
 *
 * Q3 (the summary-prompt picker), Q5 (validate before the round trip) and Q6
 * option (a) (one engagement-type control).
 *
 * The SessionsPanel pattern: one mocked module, a `jsonResponse` helper, a
 * router that throws on an unmatched URL. No `AuthProvider` is ever wrapped —
 * this component does not call `useAuth`, so mocking it would be mocking a
 * module it does not import.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuestionSetUploadPanel from '../components/QuestionSetUploadPanel';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/**
 * Prompts exactly as `get-ai-prompts.js` returns them, including the four
 * shapes that made the shipped picker wrong.
 */
const PROMPTS = [
  { promptId: 'p-caa', name: 'Lessons Learned Summary', gameType: 'callandanswer', status: 'active' },
  { promptId: 'p-poll', name: 'Opinion Poll Readout', gameType: 'polls', status: 'active' },
  { promptId: 'p-trivia', name: 'Quiz Recap', gameType: 'trivia', status: 'active' },
  // A GENERATION prompt. Selectable in the shipped picker; attaching it does
  // nothing, because get-ai-summary.js rejects it and falls back to the default.
  { promptId: 'gen-caa-lessons', name: 'Lessons Generator', gameType: 'callandanswer', status: 'active', promptType: 'generation' },
  // No promptId at all. Rendered <option value={undefined}>, which makes the
  // browser submit the option's LABEL as the value.
  { promptId: undefined, name: 'Orphaned record', gameType: 'callandanswer', status: 'active' },
  { promptId: 'p-inactive', name: 'Retired', gameType: 'callandanswer', status: 'inactive' },
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function mockApi({ uploadStatus = 200, uploadBody = null } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/admin/upload-questions')) {
      return uploadStatus === 200
        ? jsonResponse(200, uploadBody || { message: 'Created "Q3 Retro" with 2 questions' })
        : jsonResponse(uploadStatus, uploadBody || { error: 'Missing required columns: Title' });
    }
    if (method === 'GET' && url.includes('/admin/download-template')) {
      return jsonResponse(200, { filename: 'trivia-template.csv', content: 'Category,Title' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

function mount(props = {}, options) {
  mockApi(options);
  const onEngagementTypeChange = props.onEngagementTypeChange || jest.fn();
  const utils = render(
    <QuestionSetUploadPanel
      engagementType="call-and-answer"
      onEngagementTypeChange={onEngagementTypeChange}
      availablePrompts={PROMPTS}
      defaultInstructions="How would you apply this?"
      {...props}
    />
  );
  return { ...utils, onEngagementTypeChange };
}

/**
 * Drive the file input the way the browser does, then wait for FileReader —
 * which is a second async hop, so one flush resolves nothing.
 */
async function chooseFile(text, name = 'questions.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [file] } });
  // Wait for the REPORT, not for the filename. Setting the file is synchronous
  // and the FileReader is not, so waiting on the name resolves before anything
  // has been parsed — the same "one flush resolves only the first await" trap
  // sessionsPanel.test.jsx documents for fetch → json().
  await waitFor(() => expect(document.querySelector('.qsets-pf')).not.toBeNull());
  return file;
}

const typeSelect = () => screen.getByLabelText(/engagement type/i);
const promptSelect = () => screen.getByLabelText(/AI summary prompt/i);
const uploadButton = () => screen.getByRole('button', { name: /^upload question set$/i });

const GOOD = 'Category,Title,Detail_lesson\nRetro,"What broke, and when?",Context\nRetro,And after?,Context';

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* ------------------------------------------------------------- Q6 option (a) */

describe('one engagement-type control, once', () => {
  test('there is exactly one engagement-type select in the tree', () => {
    // THE BUG. `engagementType` is ONE React state that was rendered as TWO
    // <select> elements in two sections of the same tab, so changing either
    // silently changed the other. rejects: a second copy reappearing beside the
    // creation buttons, which is where the duplicate lived.
    mount();
    expect(screen.getAllByLabelText(/engagement type/i)).toHaveLength(1);
    expect(document.querySelectorAll('#engagement-type')).toHaveLength(1);
  });

  test('the type is derived from the table, with Survey present and labelled', () => {
    // rejects: hand-writing the options here too — the drift Q4 fixes in the
    // filter is the same drift, in the same tab.
    mount();
    const labels = within(typeSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([
      'Call & Answer',
      'Trivia',
      'Poll',
      'Wavelength',
      expect.stringContaining('not playable'),
    ]);
  });

  test('the one control drives the builder, the template and the prompt list', () => {
    // rejects: a chooser that asks for the type and then opens a builder wired
    // to a different state. The single control is only worth having if
    // everything downstream reads it.
    const onOpenBuilder = jest.fn();
    mount({ engagementType: 'trivia', onOpenBuilder });
    expect(screen.getByRole('button', { name: /AI Trivia builder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Trivia template/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /AI Trivia builder/i }));
    expect(onOpenBuilder).toHaveBeenCalledWith('trivia');
  });

  test('changing the type is reported upwards rather than kept locally', () => {
    // The AI builder modals live in AdminPage and read this state. rejects:
    // a local copy here, which would reintroduce two sources of truth — the
    // exact defect, one file further down.
    const { onEngagementTypeChange } = mount();
    fireEvent.change(typeSelect(), { target: { value: 'poll' } });
    expect(onEngagementTypeChange).toHaveBeenCalledWith('poll');
  });

  test('the survey builder button says it exports rather than creates', () => {
    // handleSurveyGenerated builds a Blob and clicks an anchor; it does not
    // upload. rejects: a button that reads identically to the four that do
    // create a set (OPEN-QUESTIONS #3, the copy from option (c)).
    mount({ engagementType: 'survey' });
    expect(screen.getByRole('button', { name: /exports json/i })).toBeInTheDocument();
  });

  test('the Art Title template is offered only for call-and-answer', () => {
    // It is a Call and Answer set with an extra Image column, not its own type.
    const { rerender } = mount();
    expect(screen.getByRole('button', { name: /art title template/i })).toBeInTheDocument();
    rerender(
      <QuestionSetUploadPanel engagementType="poll" onEngagementTypeChange={jest.fn()} availablePrompts={PROMPTS} />
    );
    expect(screen.queryByRole('button', { name: /art title template/i })).toBeNull();
  });
});

/* --------------------------------------------------------------------- Q3 */

describe('the summary-prompt picker uses the helper that already existed', () => {
  test('a poll prompt stored as `polls` is offered for a poll set', () => {
    // THE BUG. The filter was `prompt.gameType === (engagementType ===
    // 'call-and-answer' ? 'callandanswer' : engagementType)` — a raw compare
    // with one hand-patched case — so the seeds' `polls` spelling never matched
    // and this dropdown has never shown a single poll prompt. rejects: a return
    // to the raw compare.
    mount({ engagementType: 'poll' });
    expect(within(promptSelect()).getByRole('option', { name: /Opinion Poll Readout/ })).toBeInTheDocument();
  });

  test('a generation prompt is not offered', () => {
    // get-ai-summary.js rejects it and silently falls back to the default —
    // the "I picked a prompt and nothing changed" symptom. rejects: listing
    // every prompt in the table, which is what the shipped picker did for the
    // one type it matched.
    mount();
    expect(within(promptSelect()).queryByRole('option', { name: /Lessons Generator/ })).toBeNull();
  });

  test('a record with no promptId is not offered', () => {
    // <option value={undefined}> makes the browser submit the option's LABEL as
    // the value — get-ai-prompts.js:100-107 documents exactly this failure.
    mount();
    expect(within(promptSelect()).queryByRole('option', { name: /Orphaned record/ })).toBeNull();
  });

  test('prompts for other game types are counted rather than silently dropped', () => {
    // The set editor already says "showing N of M" (mockup 04). rejects:
    // filtering a list from 47 to 2 and saying nothing, which reads as a broken
    // dropdown.
    mount();
    expect(screen.getByText(/prompts for other game types/i)).toBeInTheDocument();
  });

  test('the filter is structural, never a status filter', () => {
    // `summaryPromptStatus` is computed from `promptContent || basePrompt` and
    // promptContent only arrives with includeContent=true, which this console
    // does not pass — so analysis prompts come back 'unknown'. A `!== 'usable'`
    // filter would empty the list. rejects: "improving" the helper into a status
    // filter. Status annotates; structure excludes.
    mount({
      availablePrompts: [
        { promptId: 'p-caa', name: 'Lessons Learned Summary', gameType: 'callandanswer', status: 'active', summaryPromptStatus: 'unknown' },
      ],
    });
    expect(within(promptSelect()).getByRole('option', { name: /Lessons Learned Summary/ })).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------------- Q5 */

describe('the file is read before it is sent', () => {
  test('a file with no Title column disables Upload and nothing is sent', async () => {
    // rejects: the shipped flow, which enabled Upload for any .csv and learned
    // about the missing column from a 400 after the round trip.
    mount();
    await chooseFile('Category,Prompt\nOnboarding,Which step?');
    expect(screen.getByText(/no Title column/i)).toBeInTheDocument();
    expect(uploadButton()).toBeDisabled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('rows that would be skipped are shown BEFORE the write, with their reasons', async () => {
    // The server already returns skippedRowCount and the first fifty
    // skippedRows; the only place that has ever surfaced is one clause appended
    // to a SUCCESS message. rejects: keeping it there.
    mount();
    await chooseFile('Category,Title\nRetro,Fine\n,Missing category\nRetro,Also fine');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Missing Category')).toBeInTheDocument();
    expect(within(table).getByText('3')).toBeInTheDocument();
    // Skipped rows are a warning, not a blocker: this import still creates a set.
    expect(uploadButton()).toBeEnabled();
  });

  test('the report header counts rows, not findings', async () => {
    // A row can be two findings at once — an unterminated quote AND a missing
    // Category — so counting entries printed "3 of 3 data rows" for a file with
    // two bad rows, and on the real fixture it printed "5 of 4". rejects: any
    // header count that can exceed the number of rows in the file.
    mount();
    await chooseFile('Category,Title\nRetro,Fine\n,Missing\n,"open');
    expect(screen.getByText('2 of 3 data rows')).toBeInTheDocument();
  });

  test('a poll file with numbered option columns is named as a known gap', async () => {
    // The importer reads one pipe-separated Options column with no fallback, so
    // every question imports with nothing to vote on. rejects: a preflight that
    // reports this file clean because all of its rows parse.
    mount({ engagementType: 'poll' });
    await chooseFile('Category,Title,Option1,Option2\nOnboarding,How often?,Daily,Weekly');
    expect(screen.getByText(/wrong shape/i)).toBeInTheDocument();
    expect(uploadButton()).toBeEnabled();
  });

  test('the description is filled from the quote-aware parse', async () => {
    // rejects: `lines[0].split(',')` with `replace(/"/g,'')`, which counts this
    // file as four columns and reads School out of the wrong one.
    mount();
    await chooseFile('Category,Title,School\nRetro,"What broke, and when?",Nakamura Integration');
    expect(screen.getByLabelText(/^description$/i)).toHaveValue('Questions from Nakamura Integration');
  });

  test('changing the type after choosing a file drops the verdict rather than keeping a stale one', async () => {
    // The verdict is type-dependent — poll options, trivia answers, the survey
    // block. rejects: leaving a call-and-answer report on screen after the type
    // becomes Poll, which is a confident wrong answer.
    mount();
    await chooseFile('Category,Title,Option1\nOnboarding,How often?,Daily');
    expect(screen.getByText(/nothing to fix/i)).toBeInTheDocument();
    fireEvent.change(typeSelect(), { target: { value: 'poll' } });
    expect(screen.queryByText(/nothing to fix/i)).toBeNull();
  });

  test('a clean file says so, and says how much of it is real', async () => {
    mount();
    await chooseFile(GOOD);
    expect(screen.getByText(/nothing to fix/i)).toBeInTheDocument();
    expect(screen.getByText(/2 questions in 1 category/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ upload */

describe('the upload itself', () => {
  test('it posts what the form holds and reports the server’s message', async () => {
    const onUploaded = jest.fn();
    mount({ onUploaded });
    await chooseFile(GOOD, 'q3-retro.csv');
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Q3 Retro' } });
    fireEvent.click(uploadButton());

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Created "Q3 Retro"/));
    const [url, options] = authFetch.mock.calls.find(([u]) => u.includes('upload-questions'));
    expect(url).toBe('https://api.example.test/dev/admin/upload-questions');
    expect(JSON.parse(options.body)).toMatchObject({
      fileName: 'q3-retro.csv',
      customTitle: 'Q3 Retro',
      engagementType: 'call-and-answer',
    });
    expect(onUploaded).toHaveBeenCalled();
  });

  test('a rejected upload is an alert and the list is not re-read', async () => {
    // rejects: calling onUploaded regardless, which refetches the list and makes
    // a failure look like a slow success.
    const onUploaded = jest.fn();
    mount({ onUploaded }, { uploadStatus: 400 });
    await chooseFile(GOOD);
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Q3 Retro' } });
    fireEvent.click(uploadButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/Missing required columns/);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  test('Upload stays disabled until there is both a file and a title', async () => {
    mount();
    expect(uploadButton()).toBeDisabled();
    await chooseFile(GOOD);
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: '   ' } });
    expect(uploadButton()).toBeDisabled();
  });
});
