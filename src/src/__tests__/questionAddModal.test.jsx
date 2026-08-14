import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * THE ADD/EDIT QUESTION MODAL, THE SIBLING BROWSER, AND AI DRAFTING.
 *
 * Three claims are under test here and they are not independent:
 *
 *   1. The form is in a container of its own, not appended to the list. It used
 *      to render inside the edited row's <li>, at the bottom of an <ol> that can
 *      be a hundred rows long — see docs/design/admin-container-rule.md, which
 *      rejects "append a form below the list, then scroll to it" by name.
 *   2. The sibling browser shows the questions the new one has to sound like,
 *      out of the WORKING COPY, so unsaved edits count.
 *   3. The AI draft is conditioned on that same list. The design doc's whole
 *      argument for showing the siblings is that the human's "what am I
 *      matching?" and the model's conditioning must be ONE list — so the test
 *      for it compares the rendered titles to the request body, and would fail
 *      if the two ever drifted.
 *
 * NO GEOMETRY. jsdom has no layout engine, so "is the form on screen", "is it
 * centred" and "is it above the fold" are unfalsifiable here and are not
 * asserted. What is asserted is containment, attributes, callbacks, what
 * reaches `rows`, and what reaches the wire.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  engagementType: 'call-and-answer',
  description: 'What a delivery team learns the hard way.',
  customInstruction: 'Answer from your own experience.',
  aiContextInstruction: 'Keep it about software delivery, never about sport.',
  totalQuestions: 4,
  categoryCount: 2,
  activeVersion: 2,
  canManage: true,
};

/**
 * Four questions, three of them in one category, and one carrying fields the
 * form never renders — an Image, a Question# and a provenance stamp. Those are
 * the fields a save must carry through untouched.
 */
const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', School: 'Business School',
      customInstructions: 'Answer from your own experience.', Tags: ['retro'],
    },
    {
      id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 7,
      questionDetail: 'One thing only.', School: 'Business School',
      Image: 'sets/lessons-learned/retro.png',
      SourceSetId: 'older-set', SourceQuestionSk: 'c009#004',
      customInstructions: 'Answer from your own experience.', Tags: ['retro'],
    },
    {
      id: 'c001#003', Category: 'Retro', title: 'WHO SHOULD HAVE SAID SOMETHING', QuestionNumber: 3,
      questionDetail: 'Nobody is named.', School: 'Business School', Tags: ['retro'],
    },
    {
      id: 'c002#001', Category: 'Delivery', title: 'ARE WE SHIPPING', QuestionNumber: 1,
      questionDetail: 'Weekly, or when it is ready?', School: 'Business School', Tags: ['delivery'],
    },
  ],
};

const TRIVIA_SET = { ...SET, id: '80s-trivia', name: '80s Trivia', engagementType: 'trivia' };
const TRIVIA_QUESTIONS = {
  setId: '80s-trivia',
  questions: [
    {
      id: 'c001#001', Category: 'Music', title: 'WHO SANG THIS', QuestionNumber: 1,
      questionDetail: 'A 1984 number one.',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', optionE: 'E', optionF: 'F',
      correctAnswer: 'OptionE', difficulty: 'hard', Tags: ['music'],
    },
  ],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** What the generator answers with — `normalizeItem`'s real output shape. */
const GENERATED = {
  // normalizeItem stamps this, and it is a FLOAT, and `toRow` reads `id` as the
  // row's stored sort key. It is in the fixture on purpose.
  id: 1755123456789.4321,
  active: true,
  title: 'WHAT DID THE ESTIMATE MISS',
  category: 'Estimates',
  detail: 'The team said six weeks and it took fourteen.',
  school: 'Business School',
  customInstructions: 'Name the assumption, not the person.',
  tags: ['estimation', 'retro'],
};

/**
 * Every request the panel can make. `posts` records the writes, `aiPosts` the
 * generation requests — the two things this suite reads back.
 */
function mockApi(options = {}) {
  const { questions = QUESTIONS, job = null, startStatus = 202 } = options;
  const posts = [];
  const aiPosts = [];
  const jobBody = job || {
    jobId: 'job-1', status: 'complete', requested: 1, completed: 1,
    items: [GENERATED], warnings: [], phase: 'Done',
  };

  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('ai-generate-questions')) {
      aiPosts.push(JSON.parse(opts.body));
      return startStatus === 202
        ? jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 1 })
        : jsonResponse(startStatus, { error: 'no' });
    }
    if (method === 'GET' && url.includes('ai-generate-questions/')) {
      return jsonResponse(200, jobBody);
    }
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(opts.body));
      return jsonResponse(200, { setId: SET.id, setName: SET.name, version: 3, questionCount: 4 });
    }
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, questions);
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return { posts, aiPosts };
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

afterEach(() => {
  // Modal's scroll lock is module state; a leak would be paid for by the next file.
  document.body.style.overflow = '';
});

const renderPanel = (props = {}) => render(
  <QuestionsPanel
    questionSet={SET}
    availableSets={[SET]}
    plannedVersion={3}
    onChanged={jest.fn()}
    onDirtyChange={jest.fn()}
    {...props}
  />
);

const ready = () => screen.findByText('WHAT WENT WRONG');
const dialog = () => screen.getByRole('dialog');
const listRows = () => [...document.querySelectorAll('.qs-question-list .qs-question-title strong')]
  .map((n) => n.textContent);
const siblingTitles = () => screen.getAllByTestId('sibling').map((li) => li.querySelector('strong').textContent);
const csvRows = (post) => post.fileContent.trim().split('\n');
const rowContaining = (post, text) => csvRows(post).find((line) => line.includes(text));

const addQuestion = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Add a question/i }));
  return screen.findByRole('dialog');
};

const editQuestion = async (title) => {
  const row = screen.getByText(title).closest('li');
  fireEvent.click(within(row).getByRole('button', { name: /edit/i }));
  return screen.findByRole('dialog');
};

/**
 * Set the category the way the picker requires. Typing into it only FILTERS —
 * free text used to mint a category on a fresh host-mask bit the moment it
 * differed by a character — so committing is either picking one that exists or
 * creating one on purpose, which is where the 24 cap gets its chance to refuse.
 * Emptying the box still clears the choice.
 */
const chooseCategory = (name) => {
  const box = screen.getByLabelText('Category *');
  fireEvent.click(box);
  fireEvent.change(box, { target: { value: name } });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = screen.queryByRole('option', { name: new RegExp(`^${escaped} · `) });
  if (existing) {
    fireEvent.click(existing);
    return;
  }
  fireEvent.click(screen.getByRole('option', { name: /\+ New category/ }));
  fireEvent.change(screen.getByLabelText('New category name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
};

/* ------------------------------------------------------------ the container */

describe('the container the form lives in', () => {
  it('renders the form in a dialog of its own, not inside the row it belongs to', async () => {
    // rejects: the shipped behaviour — `startAdd` appended a blank row to the
    // END of `rows` and the form rendered inside that row's <li>, inside
    // <ol class="qs-question-list">. On a hundred-question set that puts the
    // form below the hundredth row with no scroll-into-view anywhere in the
    // file, so the button reads as broken. docs/design/admin-container-rule.md
    // rejects "append a form below the list" by name. Containment is the part
    // of that jsdom can actually see; the geometry is not asserted here at all.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    const title = screen.getByLabelText('Title *');
    expect(dialog().contains(title)).toBe(true);
    expect(title.closest('li')).toBeNull();
    expect(title.closest('.qs-question-list')).toBeNull();
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
  });

  it('is the same dialog for editing as for adding', async () => {
    // rejects: a modal for add and the old in-list form for edit. They are one
    // form and one kind of task ("make or edit one thing"), and the container
    // rule is one container per kind of task, not one per entry point.
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('WHAT WENT WRONG');

    expect(screen.getByRole('dialog', { name: /Edit question/i })).toBeTruthy();
    expect(screen.getByLabelText('Title *')).toHaveValue('WHAT WENT WRONG');
    expect(screen.getByLabelText('Title *').closest('li')).toBeNull();
  });

  it('does not close on a stray backdrop click', async () => {
    // rejects: the primitive's default. There is a half-filled form in here and
    // no draft saved anywhere; a mis-aimed click on the margin must not be a
    // discard. Escape is the deliberate way out and it goes through the ask.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'HALF TYPED' } });

    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('HALF TYPED');
  });
});

/* ------------------------------------------------------ closing with a draft */

describe('closing the dialog with something typed in it', () => {
  it('leaves NOTHING in the working copy when a part-typed add is thrown away', async () => {
    // rejects: the shipped `cancelEdit`, which collected the abandoned row back
    // only when BOTH title and category were empty — and `startAdd` SEEDS the
    // category. So every abandoned add left a titleless row in the working copy
    // that made the set dirty and then blocked every later Save with "needs a
    // title", reported against a form nobody could see any more.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'NEVER MIND' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Cancel$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Throw it away/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('NEVER MIND')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unsaved-bar')).not.toBeInTheDocument();
    expect(listRows()).toEqual([
      'WHAT WENT WRONG', 'WHAT WOULD YOU CHANGE', 'WHO SHOULD HAVE SAID SOMETHING', 'ARE WE SHIPPING',
    ]);
  });

  it('asks first, and Keep editing gives the typing back', async () => {
    // rejects: a Cancel that discards on the first click. Nothing typed here
    // exists anywhere else — the draft is deliberately kept OUT of `rows` until
    // Done, which is what makes the abandon clean and the accidental close
    // expensive.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'STILL WANTED' } });

    fireEvent.click(within(dialog()).getByRole('button', { name: /^Cancel$/ }));
    expect(await screen.findByText(/Throw this new question away\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Keep editing/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('STILL WANTED');
  });

  it('sends Escape through the same ask as Cancel', async () => {
    // rejects: a keyboard route that skips the gate. The backdrop is inert here
    // precisely so a stray click cannot discard, and Escape is then the only way
    // out that is not a button — a second way out that does not ask is the same
    // defect the ask was written for.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'TYPED' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText(/Throw this new question away\?/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes straight away when nothing was typed', async () => {
    // rejects: asking unconditionally, which trains people to click through the
    // question and makes it worthless on the day it matters.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    fireEvent.click(within(dialog()).getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Throw this new question away\?/i)).not.toBeInTheDocument();
  });

  it('puts an edited question back as it was, and keeps the other unsaved work', async () => {
    // rejects: a close that commits the half-made edit anyway, and one that
    // reverts the whole working copy rather than this one draft.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(within(screen.getByText('ARE WE SHIPPING').closest('li'))
      .getByRole('button', { name: /remove/i }));

    await editQuestion('WHAT WENT WRONG');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'REWRITTEN' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Cancel$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Throw it away/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('WHAT WENT WRONG')).toBeInTheDocument();
    expect(screen.queryByText('REWRITTEN')).not.toBeInTheDocument();
    expect(screen.getByTestId('unsaved-bar')).toHaveTextContent('1 removed');
  });

  it('offers a close control that asks before binning a draft', async () => {
    // rejects: shipping the dialog with no close control at all, which is how
    // it went out. The footer holding Cancel runs past the fold on a long form,
    // the backdrop is inert on purpose, and a tablet has no Escape key — so on
    // an iPad there was no way out of this dialog. Reported from real use.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'HALF TYPED' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /close/i }));

    // It asks. Silently binning typed work is what the inert backdrop exists to
    // prevent; a close control that skips the ask would reopen that hole.
    expect(await screen.findByRole('button', { name: /Throw it away/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Throw it away/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('HALF TYPED')).not.toBeInTheDocument();
  });

  it('closes straight away when nothing has been typed', async () => {
    // rejects: asking "are you sure" over an untouched form. The ask is for
    // work worth keeping; on an empty draft it is a second obstacle in front of
    // someone who already found the exit hard to reach.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    fireEvent.click(within(dialog()).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Throw it away/i })).not.toBeInTheDocument();
  });

  it('reports a half-filled question inside the dialog, where the form is', async () => {
    // rejects: reporting it in the panel's status bar underneath the modal,
    // which is where `commitEdit` used to put it — behind the dialog, invisible
    // to the person who has to fix it.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'NO CATEGORY ON ME' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));

    const problem = await screen.findByText(/needs a category/i);
    expect(dialog().contains(problem)).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------- sibling browser */

describe('writing alongside these', () => {
  it('lists the other questions in the chosen category and never the row being edited', async () => {
    // rejects: a sibling list that includes the question you are editing, which
    // invites you to match a question against itself and — once it is sent to
    // the model — asks it to write something distinct from the very row it is
    // rewriting.
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('WHAT WENT WRONG');

    expect(within(screen.getByTestId('sibling-browser')).getByText(/Writing alongside these/i))
      .toBeInTheDocument();
    expect(siblingTitles()).toEqual(['WHAT WOULD YOU CHANGE', 'WHO SHOULD HAVE SAID SOMETHING']);
  });

  it('reads the WORKING COPY, so an unsaved edit is what you write alongside', async () => {
    // rejects: sourcing the siblings from the loaded payload, or from a second
    // fetch. The whole panel is a working copy with no per-question write; a
    // sibling list showing the last SAVED text while the author looks at their
    // own unsaved rewrite is the same lie the category counts are warned about
    // in docs/design/admin-container-rule.md.
    mockApi();
    renderPanel();
    await ready();

    await editQuestion('WHO SHOULD HAVE SAID SOMETHING');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'WHO STAYED QUIET' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await editQuestion('WHAT WENT WRONG');
    expect(siblingTitles()).toEqual(['WHAT WOULD YOU CHANGE', 'WHO STAYED QUIET']);
  });

  it('leaves out a question that has been removed but not saved yet', async () => {
    // rejects: filtering only on category. A tombstoned row is still in `rows`
    // — that is the undo — but it is on its way out of the set and is not
    // something to write alongside, or to condition the model on.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(within(screen.getByText('WHO SHOULD HAVE SAID SOMETHING').closest('li'))
      .getByRole('button', { name: /remove/i }));
    await editQuestion('WHAT WENT WRONG');

    expect(siblingTitles()).toEqual(['WHAT WOULD YOU CHANGE']);
  });

  it('says so rather than rendering an empty box', async () => {
    // rejects: an empty <ol> under a heading, which reads as a loading failure.
    // Two different nothings, and they mean different things to the author.
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();

    // Seeded from the last row's category — Delivery, which holds only itself.
    chooseCategory('Brand New');
    expect(screen.queryAllByTestId('sibling')).toHaveLength(0);
    expect(screen.getByText(/Nothing else in .Brand New. yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: '' } });
    expect(screen.getByText(/Choose a category and the other questions in it appear here/i))
      .toBeInTheDocument();
  });

  it('shows at most five', async () => {
    // rejects: dumping a forty-question category into the dialog. The design
    // doc says three to five; past that it stops being context and becomes the
    // list the modal was supposed to get you out of.
    const many = {
      setId: SET.id,
      questions: Array.from({ length: 9 }, (_, i) => ({
        id: `c001#00${i + 1}`, Category: 'Retro', title: `QUESTION ${i + 1}`, QuestionNumber: i + 1,
      })),
    };
    mockApi({ questions: many });
    renderPanel();
    await screen.findByText('QUESTION 1');
    await addQuestion();

    expect(screen.getAllByTestId('sibling')).toHaveLength(5);
  });
});

/* ------------------------------------------------------------- AI drafting */

describe('drafting a question with AI', () => {
  const draftWithAi = async (brief = 'a question about a missed estimate') => {
    fireEvent.click(screen.getByRole('button', { name: /Draft this with AI/i }));
    fireEvent.change(await screen.findByLabelText(/What should this question be about/i), {
      target: { value: brief },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Draft it$/i }));
    return screen.findByTestId('ai-provenance');
  };

  it('sends the model exactly the siblings it showed the human', async () => {
    // THE ONE THAT MATTERS. docs/design/admin-container-rule.md: the sibling
    // browser "is the AI prompt made visible... If the two ever disagree, that
    // is a bug we want visible." rejects: rendering one list and sending
    // another, and rejects rendering the list while sending the model nothing —
    // which is what every other AI surface in this product does today.
    const { aiPosts } = mockApi();
    renderPanel();
    await ready();
    await editQuestion('WHAT WENT WRONG');

    const shown = siblingTitles();
    expect(shown.length).toBeGreaterThan(0);
    await draftWithAi();

    expect(aiPosts).toHaveLength(1);
    expect(aiPosts[0].context.siblingQuestions.map((s) => s.title)).toEqual(shown);
  });

  it('sends the set context the generator was previously flying without', async () => {
    // rejects: posting a bare userInput. There was no AI affordance in this flow
    // at all — AIAssistant is imported only by BuilderPage, which never opens an
    // existing set — so a question added to a set that had been GENERATED with a
    // description, set instructions and AI context was written with none of them.
    const { aiPosts } = mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    chooseCategory('Retro');
    await draftWithAi('one about the estimate');

    const body = aiPosts[0];
    expect(body.engagementType).toBe('call-and-answer');
    expect(body.questionCount).toBe(1);
    expect(body.userInput).toBe('one about the estimate');
    expect(body.context.title).toBe('Lessons Learned');
    expect(body.context.description).toBe(SET.description);
    // Singular on the client, PLURAL on the wire — ai-generate-questions.js
    // reads context.customInstructions / context.aiContextInstructions.
    expect(body.context.customInstructions).toBe(SET.customInstruction);
    expect(body.context.aiContextInstructions).toBe(SET.aiContextInstruction);
    expect(body.context.categories).toEqual(['Retro', 'Delivery']);
    expect(body.context.category).toBe('Retro');
    // De-dup, the way the bulk branch does it.
    expect(body.alreadyUsedTitles).toEqual([
      'WHAT WENT WRONG', 'WHAT WOULD YOU CHANGE', 'WHO SHOULD HAVE SAID SOMETHING', 'ARE WE SHIPPING',
    ]);
  });

  it('lands the result as an editable draft and writes nothing', async () => {
    // rejects: an AI result that goes straight into the set, or straight to the
    // server. There is one write path in this panel and it is Save; a generated
    // question is a suggestion until a person has read it and pressed Done.
    const { posts } = mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    await draftWithAi();

    // In the form, editable.
    expect(screen.getByLabelText('Title *')).toHaveValue('WHAT DID THE ESTIMATE MISS');
    expect(screen.getByLabelText(/Instruction shown to the room/i))
      .toHaveValue('Name the assumption, not the person.');
    // Not in the set, and nothing written.
    expect(listRows()).not.toContain('WHAT DID THE ESTIMATE MISS');
    expect(screen.queryByTestId('unsaved-bar')).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);

    // The person confirms it, and only then is it in the working copy.
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'WHAT DID WE MISS' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(listRows()).toContain('WHAT DID WE MISS'));
    expect(posts).toHaveLength(0);
  });

  it('keeps the AI authorship visible, and keeps it through the save', async () => {
    // rejects: a silent AI insert. The owner's ruling is that AI authorship
    // stays visible; a banner that dies with the dialog is not visibility, so
    // the stamp is a TAG and rides the Tags column through the CSV.
    const { posts } = mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    await draftWithAi();

    expect(screen.getByTestId('ai-provenance')).toHaveTextContent(/AI drafted this/i);
    expect(screen.getByLabelText('Tags')).toHaveValue('estimation, retro, ai-drafted');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(listRows()).toContain('WHAT DID THE ESTIMATE MISS'));
    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/i })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));

    expect(rowContaining(posts[0], 'WHAT DID THE ESTIMATE MISS')).toContain('ai-drafted');
  });

  it('reads the generated item through toRow instead of assigning fields by hand', async () => {
    // rejects: hand-mapping normalizeItem's camelCase onto the row. It emits
    // `customInstructions` where a row carries `customInstruction`, and it
    // stamps `id: Date.now() + Math.random()` — which `toRow` reads as the row's
    // STORED SORT KEY. Assign that by hand and the row's `c001#002` becomes a
    // float; here the key is observable because saving a selection stamps
    // `sourceQuestionSk` from it.
    const { posts } = mockApi();
    renderPanel();
    await ready();
    await editQuestion('WHAT WENT WRONG');   // sk c001#001, no source stamp of its own
    await draftWithAi();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Select WHAT DID THE ESTIMATE MISS'));
    fireEvent.click(screen.getByRole('button', { name: /Save 1 selected as a new set/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Create the set/i }));
    await waitFor(() => expect(posts).toHaveLength(1));

    const line = rowContaining(posts[0], 'WHAT DID THE ESTIMATE MISS');
    expect(line).toContain('c001#001');
    expect(line).not.toMatch(/1755123456789/);
    // And the camelCase mapping landed: customInstructions -> CustomInstruction.
    expect(line).toContain('Name the assumption, not the person.');
  });

  it('leaves the author\'s category alone rather than moving the question', async () => {
    // rejects: letting the model's `category` overwrite the one the author
    // chose. Category identity here is POSITIONAL — first appearance in the CSV
    // decides the host mask bit — so a generator that quietly invents a category
    // reindexes the set. The fixture's item says "Estimates"; the author said
    // "Retro".
    mockApi();
    renderPanel();
    await ready();
    await addQuestion();
    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: 'Retro' } });
    await draftWithAi();

    expect(screen.getByLabelText('Category *')).toHaveValue('Retro');
  });

  it('says what the generator writes for trivia, and never marks an option it did not write', async () => {
    // rejects: pretending the generator fills all six options. The Lambda tool
    // schema stops at OptionD (:87 enum, :93 required) while this form edits
    // A-F and rowProblems validates six, so E and F come back empty and the
    // form has to say so instead of leaving them looking generated-and-blank.
    // The correct answer can therefore only ever be A-D, which is also the only
    // reason a draft cannot arrive marking an empty option correct.
    mockApi({ questions: TRIVIA_QUESTIONS });
    renderPanel({ questionSet: TRIVIA_SET });
    await screen.findByText('WHO SANG THIS');
    await addQuestion();

    fireEvent.click(screen.getByRole('button', { name: /Draft this with AI/i }));
    expect(await screen.findByText(/writes four options \(A–D\); E and F are yours to add/i))
      .toBeInTheDocument();
  });

  it('reports a failed job and leaves the question untouched', async () => {
    // rejects: branching on items.length, which is TRUE for a failed job that
    // wrote partials — the defect utils/generationJob.js exists for — and
    // rejects wiping the author's form when the generator fails.
    mockApi({
      job: {
        jobId: 'job-1', status: 'error', requested: 1, completed: 0,
        items: [], warnings: [], error: 'Bedrock said no',
      },
    });
    renderPanel();
    await ready();
    await addQuestion();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'MINE, TYPED BY HAND' } });

    fireEvent.click(screen.getByRole('button', { name: /Draft this with AI/i }));
    fireEvent.change(await screen.findByLabelText(/What should this question be about/i), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Draft it$/i }));

    expect(await screen.findByText(/Bedrock said no/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('MINE, TYPED BY HAND');
    expect(screen.queryByTestId('ai-provenance')).not.toBeInTheDocument();
  });
});

/* --------------------------------------------------- the whole row survives */

describe('what the form never shows', () => {
  it('carries every unrendered field through an edit made in the dialog', async () => {
    // rejects: passing a PICKED SUBSET of the row into the dialog and merging
    // it back. The row object IS the question — Image, the stored Question#,
    // SourceSetId and SourceQuestionSk are on it and are rendered by nothing —
    // and tests/question-set-roundtrip.js asserts the same promise against the
    // real handlers ("keeps every field the form never showed"). A dialog is a
    // new place for that to be quietly broken.
    const { posts } = mockApi();
    renderPanel();
    await ready();

    await editQuestion('WHAT WOULD YOU CHANGE');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'WHAT WOULD YOU CHANGE NOW' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/i })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));

    const header = csvRows(posts[0])[0];
    expect(header).toContain('Image');
    expect(header).toContain('SourceSetId');
    expect(header).toContain('SourceQuestionSk');

    const line = rowContaining(posts[0], 'WHAT WOULD YOU CHANGE NOW');
    expect(line).toContain('sets/lessons-learned/retro.png');
    expect(line).toContain('older-set');
    expect(line).toContain('c009#004');
    // The stored Question# is the exporter's, and it is 7, not the row's position.
    expect(line.split(',')[1]).toBe('7');
  });

  it('carries them through an AI draft too', async () => {
    // rejects: rebuilding the row from the generated item alone. `toRow` fills
    // every field it knows and blanks the rest, so the identity and provenance
    // fields have to be taken back off the row being edited — otherwise a draft
    // silently detaches a question from its artwork and its origin.
    const { posts } = mockApi();
    renderPanel();
    await ready();
    await editQuestion('WHAT WOULD YOU CHANGE');
    await draftAndDone();

    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/i })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));

    const line = rowContaining(posts[0], 'WHAT DID THE ESTIMATE MISS');
    expect(line).toContain('sets/lessons-learned/retro.png');
    expect(line).toContain('older-set');
    expect(line).toContain('c009#004');
    expect(line.split(',')[1]).toBe('7');
  });

  async function draftAndDone() {
    fireEvent.click(screen.getByRole('button', { name: /Draft this with AI/i }));
    fireEvent.change(await screen.findByLabelText(/What should this question be about/i), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Draft it$/i }));
    await screen.findByTestId('ai-provenance');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
});
