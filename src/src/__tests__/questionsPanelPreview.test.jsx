import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/*
 * THE QUESTIONS TAB'S [Table] [Preview] — the preview mounted where the owner
 * asked for it (spec 2026-09-19 §2.1, §4.5): inside the set editor, reading the
 * working copy, unsaved edits included.
 *
 * `authFetch` is the only mock — the recipe questionSetEditorQuestions.test.jsx
 * uses — so the real panel loads, edits and renders. The preview's own
 * mechanics (search, chips, keys, the card) are questionPreview.test.jsx's;
 * this file holds the panel to what it hands the preview, and to the switch.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'true-crime',
  name: 'True Crime',
  engagementType: 'trivia',
  customInstruction: 'Answer for your table.',
  canManage: true,
};

const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'History', title: 'Which killer was caught by a parking ticket?',
      questionDetail: 'New York, 1977.', optionA: 'Ted Bundy', optionB: 'David Berkowitz',
      optionC: 'John Wayne Gacy', optionD: 'Richard Ramirez', correctAnswer: 'OptionB', difficulty: 'easy',
    },
    {
      id: 'c002#001', Category: 'Method', title: 'The Green River case',
      questionDetail: 'Solved by DNA in 2001.', optionA: 'Gary Ridgway', optionB: 'Ted Bundy',
      correctAnswer: 'OptionA', difficulty: 'hard',
      customInstructions: 'Name the man, not the river.',
    },
  ],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

function mockApi(payload = QUESTIONS) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, payload);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderPanel = (props = {}) => render(
  <QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} {...props} />
);
const views = () => within(screen.getByRole('group', { name: 'How the questions are shown' }));
const card = () => screen.getByTestId('preview-screen');
async function ready() {
  await screen.findByText('Which killer was caught by a parking ticket?');
}

describe('the switch', () => {
  test('Table is today\'s tab, unchanged, and it is where the tab opens', async () => {
    mockApi();
    renderPanel();
    await ready();
    expect(views().getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('question-0')).toBeInTheDocument();
    expect(screen.queryByTestId('question-preview')).toBeNull();
  });

  test('Preview replaces the table with the two panes', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('question-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('question-0')).toBeNull();
    expect(card().querySelector('h1.q')).toHaveTextContent('Which killer was caught by a parking ticket?');
    expect(views().getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Preview is disabled, and says why, when the set has no questions', async () => {
    mockApi({ setId: SET.id, questions: [] });
    renderPanel();
    await screen.findByText(/This set has no questions yet/);
    const preview = views().getByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('title', 'This set has no questions yet, so there is nothing to preview.');
  });

  test('Preview is disabled, and says why, when every question is marked for removal', async () => {
    // rejects: calling that set empty. It has two questions, both struck
    // through with Restore beside them, and Discard in the bar above.
    mockApi();
    renderPanel();
    await ready();
    for (const i of [0, 1]) {
      fireEvent.click(within(screen.getByTestId(`question-${i}`)).getByRole('button', { name: /remove/i }));
    }
    const preview = views().getByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('title',
      'Every question is marked for removal, so there is nothing to preview. '
      + 'Restore one in the Table, or discard your changes.');
  });

  test('while the questions load, and after they fail to, Preview says so — never that the set is empty', async () => {
    // rejects: one reason for every blocked state. A load that failed is not
    // an empty set, and saying it is would be an empty state that lies.
    let answer;
    authFetch.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderPanel();
    const preview = () => views().getByRole('button', { name: 'Preview' });
    expect(preview()).toBeDisabled();
    expect(preview()).toHaveAttribute('title', 'The questions are still loading.');
    answer(jsonResponse(500, { error: 'Internal Server Error' }));
    await screen.findByText(/Could not load the questions \(HTTP 500\)/);
    expect(preview()).toBeDisabled();
    expect(preview()).toHaveAttribute('title', 'The questions could not be loaded, so there is nothing to preview.');
  });

  test('the table\'s category select is not offered in Preview, which has its own chips', async () => {
    mockApi();
    renderPanel();
    await ready();
    expect(screen.getByText(/Filter by category/)).toBeInTheDocument();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.queryByText(/Filter by category/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument();
  });

  test('"Save N selected as a new set…" is not offered in Preview, where the selection cannot be seen', async () => {
    // rejects: a button that acts on checkboxes the preview does not show —
    // "Save 1 selected" with nothing on screen saying which one.
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByLabelText('Select Which killer was caught by a parking ticket?'));
    expect(screen.getByRole('button', { name: /Save 1 selected as a new set/ })).toBeInTheDocument();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('button', { name: /selected as a new set/ })).toBeNull();
    // The selection is kept, and the button returns with the table that shows it.
    fireEvent.click(views().getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('button', { name: /Save 1 selected as a new set/ })).toBeInTheDocument();
  });

  test('opening a different set starts it in Table', async () => {
    mockApi();
    const { rerender } = renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    rerender(<QuestionsPanel questionSet={{ ...SET, id: 'other-set' }} availableSets={[SET]}
      plannedVersion={2} onChanged={jest.fn()} onDirtyChange={jest.fn()} />);
    await ready();
    expect(views().getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('question-preview')).toBeNull();
  });
});

describe('the preview reads the working copy', () => {
  test('a removed question is not previewed', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(within(screen.getByTestId('question-1')).getByRole('button', { name: /remove/i }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 1');
    expect(screen.getByRole('listbox', { name: 'Questions' })).not.toHaveTextContent('Green River');
  });

  test('Edit opens the existing question dialog, and after Done the preview shows the edit', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    // The SECOND question: a preview that lost its place would fall back to the
    // first, so editing the first could not tell "still open" from "reset".
    const options = () => within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option');
    fireEvent.click(options()[1]);
    fireEvent.click(screen.getByRole('button', { name: /edit this question/i }));
    const dialog = screen.getByRole('dialog', { name: /edit question/i });
    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Ridgway, caught by DNA' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit question/i })).toBeNull());
    // Still in Preview, on the same question, showing the unsaved words.
    expect(screen.getByTestId('question-preview')).toBeInTheDocument();
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(card().querySelector('h1.q')).toHaveTextContent('Ridgway, caught by DNA');
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
  });

  test('a picture chosen in the dialog is previewed as the file this set will hold once saved', async () => {
    // rejects: the panel not handing the preview its set id. The importer keys
    // a bare file name to sets/<setId>/ on Save, and the card would otherwise
    // ask for a 'hydrant.jpg' that no Save ever writes.
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: /edit this question/i }));
    const dialog = screen.getByRole('dialog', { name: /edit question/i });
    fireEvent.change(within(dialog).getByLabelText('Picture'), { target: { value: 'hydrant.jpg' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit question/i })).toBeNull());
    expect(card().querySelector('img.stage-art')).toHaveAttribute('src', 'sets/true-crime/hydrant.jpg');
  });

  test('the card plays the set as the host would: trivia, with Reveal', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const phase = within(screen.getByRole('group', { name: 'What the card shows' }));
    fireEvent.click(phase.getByRole('button', { name: 'Reveal' }));
    expect(card().querySelector('.opt.correct .txt')).toHaveTextContent('David Berkowitz');
  });

  test('a call-and-answer set with no reveal written on any question has nothing to reveal', async () => {
    mockApi();
    renderPanel({ questionSet: { ...SET, engagementType: 'call-and-answer' } });
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('group', { name: 'What the card shows' })).toBeNull();
  });

  test('an art set, which is call-and-answer with the real title kept as its reveal, can be revealed', async () => {
    // rejects: the Reveal gated on trivia, which no art set ever is.
    mockApi({
      setId: 'masterpieces',
      questions: [{
        id: 'c001#001', Category: 'Renaissance', title: 'THE ENIGMATIC SMILE', School: 'Leonardo da Vinci',
        Image: 'smile.jpg', AnswerDetails: 'Real title: Mona Lisa. Stolen from the Louvre in 1911.',
      }],
    });
    renderPanel({ questionSet: { ...SET, id: 'masterpieces', engagementType: 'call-and-answer', customInstruction: '' } });
    await screen.findByText('THE ENIGMATIC SMILE');
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'What the card shows' })).getByRole('button', { name: 'Reveal' }));
    expect(card().querySelector('img.stage-art')).toHaveAttribute('src', 'sets/masterpieces/smile.jpg');
    expect(screen.getByTestId('preview-note')).toHaveTextContent('Real title: Mona Lisa.');
  });

  test('the how-to-answer line is the question\'s own, else the set\'s', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const howTo = () => card().querySelector('p.qdetail[data-drop="3"]').textContent;
    expect(howTo()).toBe('Answer for your table.');
    // Scoped to the list: the table's <select> options are role="option" too.
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option')[1]);
    expect(howTo()).toBe('Name the man, not the river.');
  });
});

/*
 * THE SET'S OWN INSTRUCTION, AS THE DETAILS PANEL HOLDS IT. The editor draws
 * Details and Questions together, and the owner's decision is that the
 * preview shows unsaved edits — a Details edit is one. The real editor is
 * rendered here, because the value lives in its state, not in the set object
 * the panel is handed.
 */
describe('the how-to-answer line follows the set editor\'s Details, saved or not', () => {
  test('an unsaved change to Custom Instructions shows on the card, and a cleared one falls to the default', async () => {
    // rejects: reading the SAVED instruction (questionSet.customInstruction),
    // which showed the old line until Details' own Save Changes.
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
      if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
    render(<QuestionSetEditor questionSet={SET} availableSets={[SET]}
      onSaved={jest.fn()} onChanged={jest.fn()} onCancel={jest.fn()} />);
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const howTo = () => card().querySelector('p.qdetail[data-drop="3"]').textContent;
    expect(howTo()).toBe('Answer for your table.');

    const field = screen.getByLabelText(/Custom Instructions/);
    fireEvent.change(field, { target: { value: 'One word per table, no conferring.' } });
    expect(howTo()).toBe('One word per table, no conferring.');
    // A question's own instruction still wins over the set's.
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option')[1]);
    expect(howTo()).toBe('Name the man, not the river.');
    // Cleared, the set has no line of its own, and saving it would give the format's.
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option')[0]);
    fireEvent.change(field, { target: { value: '   ' } });
    expect(howTo()).toBe('Select the best answer:');
  });
});

/*
 * A SAVE MADE IN PREVIEW. Save writes the working copy and reads the set back:
 * every row returns with a new uid (utils/questionRows.js mints one per read),
 * and every key is the one the importer just gave it, which is not always the
 * key it had. The preview used to be unmounted for that read and come back at
 * the first question in ASK.
 */
describe('a Save made in Preview keeps the preview where it was', () => {
  const trivia = (id, title, answer) => ({
    id, Category: 'History', title, questionDetail: `${title} (the question as asked)`,
    optionA: 'Ted Bundy', optionB: 'David Berkowitz', optionC: 'Zodiac', optionD: 'Richard Ramirez',
    correctAnswer: answer, difficulty: 'medium',
  });
  const KILLER = trivia('c001#001', 'Which killer was caught by a parking ticket?', 'OptionB');
  const STALKER = trivia('c001#002', 'Who was dubbed the Night Stalker?', 'OptionD');
  const CIPHER = trivia('c001#003', 'Whose cipher was solved in 2020?', 'OptionC');
  const BTK = trivia('c001#004', 'Who signed his letters BTK?', 'OptionA');
  const GREEN = { ...trivia('c002#001', 'The Green River case', 'OptionA'), Category: 'Method' };
  // What the importer stores once KILLER is gone: History renumbered from 1.
  const READ_BACK = [
    { ...STALKER, id: 'c001#001' }, { ...CIPHER, id: 'c001#002' }, { ...BTK, id: 'c001#003' }, GREEN,
  ];

  const options = () => within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option');
  const cardTitle = () => card().querySelector('h1.q').textContent;
  const phase = () => within(screen.getByRole('group', { name: 'What the card shows' }));

  test('it stays up through the read-back, on the same question, still in Reveal', async () => {
    // rejects: unmounting the preview while the saved set is read back (it
    // returned at question 1 in ASK), keeping it up but losing the question
    // with its uid, and finding the question by the key it had BEFORE the save
    // — CIPHER was stored as c001#003, and after this save c001#003 is BTK.
    let readBack = null;
    let reads = 0;
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/questions')) {
        reads += 1;
        if (reads === 1) return jsonResponse(200, { setId: SET.id, questions: [KILLER, STALKER, CIPHER, BTK, GREEN] });
        return new Promise((resolve) => {
          readBack = () => resolve(jsonResponse(200, { setId: SET.id, questions: READ_BACK }));
        });
      }
      if (method === 'POST' && url.includes('/admin/upload-questions')) {
        return jsonResponse(200, { version: 2, questionCount: 4, setName: SET.name });
      }
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
    renderPanel();
    await ready();
    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /remove/i }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(options()[1]);
    fireEvent.click(phase().getByRole('button', { name: 'Reveal' }));
    expect(cardTitle()).toBe(CIPHER.title);
    const preview = screen.getByTestId('question-preview');

    fireEvent.click(screen.getAllByRole('button', { name: 'Save as version 2' })[0]);
    await waitFor(() => expect(readBack).not.toBeNull());
    // While the saved set is read back, the preview is still the one on screen.
    expect(screen.getByTestId('question-preview')).toBe(preview);
    expect(cardTitle()).toBe(CIPHER.title);

    readBack();
    await waitFor(() => expect(screen.queryByTestId('unsaved-bar')).toBeNull());
    expect(screen.getByTestId('question-preview')).toBe(preview);
    expect(cardTitle()).toBe(CIPHER.title);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('preview-position')).toHaveTextContent('2 / 4');
    expect(phase().getByRole('button', { name: 'Reveal' })).toHaveAttribute('aria-pressed', 'true');
    expect(card().querySelector('.opt.correct .txt')).toHaveTextContent('Zodiac');
  });
});

/*
 * THE PREVIEW'S EDIT WAITS FOR A SAVE. The preview stays up while a Save is
 * written and while the set is read back after it, and the read-back gives
 * every row a new uid. An edit opened in that time is an edit of a row that is
 * about to stop existing: a dialog opened on it and finished after the
 * read-back came back into the working copy as a NEW question — the saved one,
 * twice. So Edit is held, and says why, until the set it shows is the saved one.
 */
describe('the preview\'s Edit waits while a Save is written and read back', () => {
  const edit = () => screen.getByRole('button', { name: /edit this question/i });
  const KILLER = QUESTIONS.questions[0];

  /** The first read answers at once; the write and the read-back after it wait for the test. */
  function holdTheSave() {
    const held = { write: null, readBack: null };
    let reads = 0;
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/questions')) {
        reads += 1;
        if (reads === 1) return jsonResponse(200, QUESTIONS);
        return new Promise((resolve) => {
          held.readBack = (questions) => resolve(jsonResponse(200, { setId: SET.id, questions }));
        });
      }
      if (method === 'POST' && url.includes('/admin/upload-questions')) {
        return new Promise((resolve) => {
          held.write = () => resolve(jsonResponse(200, { version: 2, questionCount: 1, setName: SET.name }));
        });
      }
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
    return held;
  }

  test('the reviewer\'s repro: Edit is held and says why, so the saved set comes back once and nothing is unsaved', async () => {
    // rejects: an Edit left live over the read-back. Pressed there, it opened
    // the dialog on a row the read-back replaced, and Done appended that row
    // as a new question — "Showing 2 of 2" for a set of one, and "Unsaved:
    // reordered … 2 questions will be saved as version 2".
    const held = holdTheSave();
    renderPanel();
    await ready();
    fireEvent.click(within(screen.getByTestId('question-1')).getByRole('button', { name: /remove/i }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save as version 2' })[0]);

    // While the version is written…
    expect(edit()).toBeDisabled();
    expect(edit()).toHaveAttribute('title', 'Wait for the save to finish.');
    held.write();
    // …and while the set is read back after it.
    await waitFor(() => expect(held.readBack).not.toBeNull());
    expect(edit()).toBeDisabled();
    expect(edit()).toHaveAttribute('title', 'Wait for the save to finish.');
    fireEvent.click(edit());
    expect(screen.queryByRole('dialog')).toBeNull();

    held.readBack([KILLER]);
    await waitFor(() => expect(edit()).toBeEnabled());
    expect(edit()).not.toHaveAttribute('title');
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 1');
    expect(screen.queryByTestId('unsaved-bar')).toBeNull();
  });

  test('a replace from a CSV holds it the same way, until the set it wrote is read back', async () => {
    // rejects: holding Edit for a Save alone. A replace writes a version and
    // reads the set back under the preview exactly as a Save does — its
    // controls stay below the preview, and the preview stays up through it.
    const held = holdTheSave();
    renderPanel();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    const csv = new File(['Category,Title\nHistory,Which killer was caught by a parking ticket?\n'],
      'replacement.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Replace every question from a CSV...'), { target: { files: [csv] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace questions with replacement.csv' }));

    expect(edit()).toBeDisabled();
    expect(edit()).toHaveAttribute('title', 'Wait for the save to finish.');
    held.write();
    await waitFor(() => expect(held.readBack).not.toBeNull());
    expect(edit()).toBeDisabled();

    held.readBack([KILLER]);
    await waitFor(() => expect(edit()).toBeEnabled());
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 1');
  });
});

/*
 * "EDIT Qn" FROM THE NEEDS-CHANGES BANNER, WHILE IN PREVIEW. The banner lives
 * in QuestionSetEditor (setEditorShare.test.jsx drives it end to end); here the
 * panel is handed what the editor passes down — `focusRequest`, a BARE question
 * id and a `seq` — and held to where it sends it. The table's rows are the only
 * thing that carries `data-question-id`, and Preview unmounts the table, so
 * before this the request found nothing and did nothing at all.
 */
describe('"Edit Qn" from the needs-changes banner, in Preview', () => {
  let scrollIntoView;
  let original;
  beforeEach(() => {
    scrollIntoView = jest.fn();
    original = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    window.HTMLElement.prototype.scrollIntoView = original;
  });

  function renderAsking() {
    const view = renderPanel();
    return (id, seq) => view.rerender(
      <QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
        onChanged={jest.fn()} onDirtyChange={jest.fn()} focusRequest={{ id, seq }} />
    );
  }
  const options = () => within(screen.getByRole('listbox', { name: 'Questions' })).getAllByRole('option');
  const cardTitle = () => card().querySelector('h1.q').textContent;

  test('the question is found by its bare id and shown in the preview: the list selects it, the card draws it', async () => {
    mockApi();
    const ask = renderAsking();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    ask('c002#001', 1);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('The Green River case');
    expect(views().getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(scrollIntoView.mock.contexts).toEqual([options()[1]]);
  });

  test('a question removed from the working copy is not in the preview, so the request goes to the Table, where its Restore is', async () => {
    mockApi();
    const ask = renderAsking();
    await ready();
    fireEvent.click(within(screen.getByTestId('question-1')).getByRole('button', { name: /remove/i }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    ask('c002#001', 1);
    expect(views().getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    const row = screen.getByTestId('question-1');
    expect(row).toHaveAttribute('data-question-id', 'c002#001');
    expect(row).toHaveClass('removed', 'focused');
    expect(within(row).getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(scrollIntoView.mock.contexts).toEqual([row]);
  });

  test('a table highlight from an earlier request does not outlive a request the preview takes', async () => {
    // rejects: the next request clearing the highlight's 2-second timer while
    // setting none of its own — the preview's sets none — so the table row
    // stays marked for good.
    mockApi();
    const ask = renderAsking();
    await ready();
    ask('c002#001', 1);                                           // in the Table
    expect(screen.getByTestId('question-1')).toHaveClass('focused');
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    ask('c002#001', 2);                                           // the preview's
    expect(cardTitle()).toBe('The Green River case');
    fireEvent.click(views().getByRole('button', { name: 'Table' }));
    expect(screen.getByTestId('question-1')).not.toHaveClass('focused');
  });

  test('a request is spent with the preview it was made for: Table and back starts at the top again', async () => {
    // rejects: the preview remounting on a request made minutes ago and
    // jumping to it, as if the banner had been pressed again.
    mockApi();
    const ask = renderAsking();
    await ready();
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    ask('c002#001', 1);
    expect(cardTitle()).toBe('The Green River case');
    fireEvent.click(views().getByRole('button', { name: 'Table' }));
    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
  });
});
