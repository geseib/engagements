import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/*
 * DRAFTING THE QUESTION SET'S OWN FOUR FIELDS.
 *
 * The owner: *"there is no ai button to update fix the question set fields."*
 *
 * `name`, `description`, `customInstruction` and `aiContextInstruction` are what
 * `QuestionsPanel.buildAiContext()` hands to the question generator as
 * `context.title` / `description` / `customInstructions` /
 * `aiContextInstructions`. A thin description therefore degrades every question
 * drafted for the set afterwards, silently, forever. This panel repairs them.
 *
 * THREE CLAIMS ARE UNDER TEST and they are not independent:
 *
 *   1. THE RESULT IS A DRAFT IN THE FORM. Nothing is written. Save Changes is
 *      still the only writer, exactly as Done/Save is in the Questions panel.
 *   2. TEXT THE AUTHOR ALREADY WROTE SURVIVES. A blank field is filled in; a
 *      field with words in it is HELD and offered, never replaced.
 *   3. WHAT THE SCREEN SHOWS IS WHAT THE MODEL IS GIVEN. The list rendered under
 *      "Drafted from these questions" is reconstructed out of the DOM here and
 *      deep-equalled against the request body, the same discipline
 *      questionAddModal.test.jsx applies to the sibling browser.
 *
 * NO GEOMETRY. jsdom has no layout engine, so "is the panel visible", "is the
 * badge beside the label" and "is it above the fold" are unfalsifiable here and
 * are not asserted. What is asserted is presence, containment, form values,
 * which requests are made, and what is in their bodies.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/** All four fields blank except the name — the ordinary case for an old set. */
const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  engagementType: 'call-and-answer',
  description: '',
  customInstruction: '',
  aiContextInstruction: '',
  totalQuestions: 4,
  categoryCount: 2,
  activeVersion: 3
};

/** The same set with an author's words in every field. */
const WRITTEN_SET = {
  ...SET,
  description: 'My own description, written by me over an afternoon.',
  customInstruction: 'My own instruction to the room.',
  aiContextInstruction: 'My own AI context, naming our vocabulary.'
};

const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', customInstructions: 'From your own experience.'
    },
    {
      id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 2,
      questionDetail: 'One thing only.'
    },
    {
      id: 'c002#001', Category: 'Delivery', title: 'ARE WE SHIPPING', QuestionNumber: 1,
      questionDetail: 'Weekly, or when it is ready?'
    }
  ]
};

/** What the endpoint answers with — `normalizeItem`'s real output shape. */
const DRAFT = {
  name: 'Delivery Retrospectives',
  description: 'What a delivery team learns the hard way.',
  customInstruction: 'Answer from something you lived through, not from theory.',
  aiContextInstruction: 'Software delivery retrospectives for mixed teams. Never name individuals.'
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

/**
 * Every request this editor can make. `aiPosts` records the generation starts,
 * `edits` the metadata PUTs and `uploads` the question replaces — the three
 * things this suite reads back, because two of them must stay EMPTY.
 */
function mockApi(options = {}) {
  const { questions = QUESTIONS, job = null, startStatus = 202 } = options;
  const aiPosts = [];
  const edits = [];
  const uploads = [];
  const jobBody = job || {
    jobId: 'job-1', status: 'complete', requested: 1, completed: 1,
    items: [DRAFT], warnings: [], phase: 'Done'
  };

  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('ai-draft-set-metadata')) {
      aiPosts.push(JSON.parse(opts.body));
      return startStatus === 202
        ? jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 1 })
        : jsonResponse(startStatus, { error: 'Administrator access required' });
    }
    if (method === 'GET' && url.includes('ai-draft-set-metadata/')) return jsonResponse(200, jobBody);
    if (method === 'PUT' && url.includes('edit-question-set')) {
      edits.push(JSON.parse(opts.body));
      return jsonResponse(200, { updated: {} });
    }
    if (method === 'POST' && url.includes('upload-questions')) {
      uploads.push(JSON.parse(opts.body));
      return jsonResponse(200, { setId: SET.id, version: 4 });
    }
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, questions);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return { aiPosts, edits, uploads };
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderEditor = (props = {}) => render(
  <QuestionSetEditor
    questionSet={SET}
    onSaved={jest.fn()}
    onChanged={jest.fn()}
    onCancel={jest.fn()}
    {...props}
  />
);

const aiButton = () => screen.getByRole('button', { name: /Draft these fields with AI/i });
const openAiPanel = async () => {
  fireEvent.click(aiButton());
  return screen.findByTestId('ai-details-panel');
};
const draftIt = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Draft it$/i }));
  /*
    THE DEFAULT 1000ms BUDGET IS A RACE HERE, NOT A LIMIT.

    Waiting for this button to come back enabled means waiting for a whole
    async job: start, then poll, then apply. `pollGenerationJob` does its first
    poll immediately, so the happy path takes no `POLL_INTERVAL_MS` sleep — but
    that interval is 2000ms of REAL time (utils/aiBatchClient.js:108), so any
    run that needs a second poll blows a one-second budget outright, and even
    the single-poll path is several awaits and a re-render deep.

    It is green on every developer machine and it took the whole dev build down
    on f68b31b5, which is the signature of contention rather than of a defect.

    Nothing here measures speed — the assertion is "the button comes back
    enabled" — so the budget is raised clear of one poll cycle rather than the
    wait being weakened.

    `questionAddModal.test.jsx` drives the same flow through `findByTestId`,
    which carries the same 1000ms default. It has not failed yet; if it starts
    to, this is why.
  */
  await waitFor(
    () => expect(screen.getByRole('button', { name: /^Draft it$/i })).toBeEnabled(),
    { timeout: 8000 },
  );
};

/**
 * Rebuild every sent field of every question out of the RENDERED list.
 *
 * Not the titles alone. The request body carries four keys per question and all
 * four are rendered with a `data-field`, so this reconstruction can be
 * deep-equalled against the body whole — a screen that showed three of four
 * fields would still be showing less than it sends.
 */
const shownQuestions = () => screen.getAllByTestId('ai-source-question').map((li) => ({
  title: li.querySelector('[data-field="title"]')?.textContent ?? '',
  category: li.querySelector('[data-field="category"]')?.textContent ?? '',
  detail: li.querySelector('[data-field="detail"]')?.textContent ?? '',
  customInstructions: li.querySelector('[data-field="customInstructions"]')?.textContent ?? ''
}));

const field = {
  title: () => screen.getByLabelText(/^Title \*/),
  description: () => screen.getByLabelText(/^Description/),
  instructions: () => screen.getByLabelText(/^Custom Instructions/),
  aiContext: () => screen.getByLabelText(/^AI Context Instructions/)
};

/* ══════════════════════════════════════════════════════ who gets the button */

describe('who is offered the drafter', () => {
  it('draws no AI button on the host surface', async () => {
    // rejects: drawing the button for a host. The route is admins-only in
    // auth/authorizer.js because AI routes spend Bedrock budget, so the button
    // would be a 403 with a sparkle on it. HostQuestionSetsDialog already passes
    // showAIAssist={false} for the Questions panel's drafter; this one rides the
    // same flag rather than inventing a second answer to the same question.
    mockApi();
    renderEditor({ showAIAssist: false, showVersions: false, showDownload: false });
    await screen.findByLabelText(/^Title \*/);
    expect(screen.queryByRole('button', { name: /Draft these fields with AI/i })).toBeNull();
  });

  it('draws it for an admin', async () => {
    // rejects: hiding the feature by default and never turning it on. AdminPage
    // passes no flags at all, so the console gets it because true is the default.
    mockApi();
    renderEditor();
    expect(await screen.findByRole('button', { name: /Draft these fields with AI/i })).toBeEnabled();
  });
});

/* ════════════════════════════════════════════════════ shown equals sent */

describe('the questions the draft is made from', () => {
  it('shows the set\'s questions before anything is generated', async () => {
    // rejects: asking a model to describe a set without telling the author what
    // it read. The author's "is that a fair summary?" is unanswerable unless the
    // material is on the screen next to the button.
    mockApi();
    renderEditor();
    await openAiPanel();

    await screen.findAllByTestId('ai-source-question');
    expect(shownQuestions().map((q) => q.title)).toEqual([
      'WHAT WENT WRONG', 'WHAT WOULD YOU CHANGE', 'ARE WE SHIPPING'
    ]);
  });

  it('sends the model exactly the questions it showed the human', async () => {
    // THE ONE THAT MATTERS, and the same discipline questionAddModal.test.jsx
    // applies to the sibling browser: the human's "what was this written from?"
    // and the model's conditioning must be ONE array. rejects: rendering one list
    // and sending another; rejects rendering the list and sending the model
    // nothing; rejects rendering a 120-character preview of a value that is sent
    // whole, which would make the screen show less than it claims.
    const { aiPosts } = mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');

    const shown = shownQuestions();
    expect(shown.length).toBeGreaterThan(0);
    await draftIt();

    expect(aiPosts).toHaveLength(1);
    expect(aiPosts[0].questions).toEqual(shown);
  });

  it('says how many of the set\'s questions were sent', async () => {
    // rejects: a silent server-side cap. The handler keeps the first 60; if the
    // screen does not say a sample was sent, the author reads the draft as a
    // summary of the whole set.
    const many = {
      setId: SET.id,
      questions: Array.from({ length: 70 }, (_, i) => ({
        id: `c001#${String(i + 1).padStart(3, '0')}`,
        Category: 'Bulk', title: `QUESTION ${i}`, questionDetail: 'd'
      }))
    };
    const { aiPosts } = mockApi({ questions: many });
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');

    expect(shownQuestions()).toHaveLength(60);
    expect(await screen.findByText(/60 of 70 questions/)).toBeInTheDocument();
    await draftIt();
    expect(aiPosts[0].questions).toHaveLength(60);
    expect(aiPosts[0].totalQuestions).toBe(70);
  });

  it('says so plainly when the set has no questions to read', async () => {
    // rejects: an empty list rendered as an empty <ol>, which reads as "the model
    // saw nothing and that is fine". It is fine — but only if it is said.
    mockApi({ questions: { setId: SET.id, questions: [] } });
    renderEditor();
    await openAiPanel();

    // Scoped to this panel. The Questions panel below says something similar
    // about the same empty set, and an unscoped query would pass on ITS copy
    // while this panel rendered nothing at all.
    const source = await screen.findByTestId('ai-source-questions');
    await waitFor(() =>
      expect(within(source).getByText(/This set has no questions yet/i)).toBeInTheDocument());
    expect(screen.queryAllByTestId('ai-source-question')).toHaveLength(0);
  });

  it('sends the set id, the author\'s current wording and the brief', async () => {
    // rejects: posting a bare setId. The handler shows the model what the author
    // has already written so it can improve on it rather than talk past it, and
    // the brief is the one piece of intent the questions cannot carry.
    const { aiPosts } = mockApi();
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');

    fireEvent.change(screen.getByLabelText(/Anything it should know/i), {
      target: { value: 'say it is for first-time managers' }
    });
    await draftIt();

    const body = aiPosts[0];
    expect(body.setId).toBe(SET.id);
    expect(body.engagementType).toBe('call-and-answer');
    expect(body.brief).toBe('say it is for first-time managers');
    expect(body.categories).toEqual(['Retro', 'Delivery']);
    expect(body.current).toEqual({
      name: WRITTEN_SET.name,
      description: WRITTEN_SET.description,
      customInstruction: WRITTEN_SET.customInstruction,
      aiContextInstruction: WRITTEN_SET.aiContextInstruction
    });
  });
});

/* ═══════════════════════════════════════════ a draft, never a write */

describe('the result is a draft in the form', () => {
  it('fills the blank fields in and sends nothing to the server', async () => {
    // rejects: an AI result that goes straight to `PUT edit-question-set`. There
    // is one writer in this panel and it is Save Changes; a drafted description
    // is a suggestion until a person has read it and pressed it. rejects, equally:
    // a draft that lands somewhere other than the form the author is editing.
    const { edits, uploads } = mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    // In the form, editable.
    expect(field.description()).toHaveValue(DRAFT.description);
    expect(field.instructions()).toHaveValue(DRAFT.customInstruction);
    expect(field.aiContext()).toHaveValue(DRAFT.aiContextInstruction);

    // And nowhere else.
    expect(edits).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('is still just a form value — Save Changes is what sends it', async () => {
    // rejects: a draft the author cannot correct before it is saved. The drafted
    // text has to be ordinary editable form state, not a locked preview.
    const { edits } = mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    fireEvent.change(field.description(), { target: { value: 'My correction of the draft.' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0].description).toBe('My correction of the draft.');
  });

  it('leaves the form alone when the endpoint refuses', async () => {
    // rejects: applying a draft from a failed request, and rejects a 403 reported
    // as a generic failure. The route is admins-only; a 403 reaches a VALID
    // session that lacks the group, so the message names the permission instead
    // of sending the author around a sign-in loop that cannot help (#9).
    const { edits } = mockApi({ startStatus: 403 });
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    expect(await screen.findByText(/not permitted/i)).toBeInTheDocument();
    expect(field.description()).toHaveValue(WRITTEN_SET.description);
    expect(field.aiContext()).toHaveValue(WRITTEN_SET.aiContextInstruction);
    expect(edits).toHaveLength(0);
  });

  it('leaves the form alone when the job produced nothing', async () => {
    // rejects: reading `items.length` as the outcome. A job that completes with
    // zero items is a REAL empty failure (generation-handler breaks out of its
    // loop with nothing produced), and blanking four fields over it would be the
    // worst possible reading of "the AI had no suggestions".
    mockApi({
      job: { jobId: 'job-1', status: 'complete', requested: 1, completed: 0, items: [], warnings: [], phase: 'Done' }
    });
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    expect(await screen.findByText(/Nothing was drafted/i)).toBeInTheDocument();
    expect(field.description()).toHaveValue(WRITTEN_SET.description);
    expect(field.instructions()).toHaveValue(WRITTEN_SET.customInstruction);
    expect(screen.queryByTestId('ai-set-provenance')).toBeNull();
  });
});

/* ══════════════════════════════ text the author already wrote */

describe('words the author already wrote', () => {
  it('does not replace a single one of them', async () => {
    // THE OTHER ONE THAT MATTERS. rejects: applying the draft over every field.
    // Nothing here is saved yet, but an author whose paragraph is silently
    // replaced by a paraphrase has no way back to their own sentence — the
    // editor keeps no undo and the snapshot it diffs against is the SAVED value,
    // not the one they had just typed. WRITTEN_SET has words in all four fields;
    // after a draft, all four must still read exactly as they were.
    mockApi();
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    expect(field.title()).toHaveValue(WRITTEN_SET.name);
    expect(field.description()).toHaveValue(WRITTEN_SET.description);
    expect(field.instructions()).toHaveValue(WRITTEN_SET.customInstruction);
    expect(field.aiContext()).toHaveValue(WRITTEN_SET.aiContextInstruction);
  });

  it('holds the draft beside them instead of throwing it away', async () => {
    // rejects: the other cheap answer — refusing to draft a field that has words
    // in it at all. The author asked for help with these fields; withholding the
    // suggestion is not the same as protecting their text.
    mockApi();
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    const held = await screen.findByTestId('ai-held-panel');
    expect(within(held).getByText(DRAFT.description)).toBeInTheDocument();
    expect(within(held).getByText(WRITTEN_SET.description)).toBeInTheDocument();
    // Every field that had words in it is offered; none is applied.
    for (const key of ['name', 'description', 'customInstruction', 'aiContextInstruction']) {
      expect(screen.getByTestId(`ai-held-${key}`)).toBeInTheDocument();
    }
  });

  it('replaces one only when the author says so, and only that one', async () => {
    // rejects: an all-or-nothing accept. The model can be right about the AI
    // context and wrong about the title in the same draft, and a single "apply"
    // button forces the author to take both or neither.
    mockApi();
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    const row = await screen.findByTestId('ai-held-description');
    fireEvent.click(within(row).getByRole('button', { name: /Replace mine with this/i }));

    expect(field.description()).toHaveValue(DRAFT.description);
    // And nothing else moved.
    expect(field.title()).toHaveValue(WRITTEN_SET.name);
    expect(field.instructions()).toHaveValue(WRITTEN_SET.customInstruction);
    expect(field.aiContext()).toHaveValue(WRITTEN_SET.aiContextInstruction);
    expect(screen.queryByTestId('ai-held-description')).toBeNull();
  });

  it('drops the draft and keeps the author\'s words on "Keep mine"', async () => {
    // rejects: a "dismiss" that quietly applies anyway, and rejects one that
    // leaves the suggestion on screen forever so the author cannot tell whether
    // they have dealt with it.
    mockApi();
    renderEditor({ questionSet: WRITTEN_SET });
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    const row = await screen.findByTestId('ai-held-description');
    fireEvent.click(within(row).getByRole('button', { name: /Keep mine/i }));

    expect(field.description()).toHaveValue(WRITTEN_SET.description);
    expect(screen.queryByTestId('ai-held-description')).toBeNull();
  });

  it('a blank field is filled in and a written one is held, in the same draft', async () => {
    // rejects: a rule applied per-DRAFT instead of per-FIELD. SET carries a name
    // and three blanks, which is the ordinary state of an old set — the name must
    // be held and the other three written, out of one response.
    mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    expect(field.title()).toHaveValue(SET.name);
    expect(await screen.findByTestId('ai-held-name')).toBeInTheDocument();
    expect(field.description()).toHaveValue(DRAFT.description);
    expect(screen.queryByTestId('ai-held-description')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════ provenance */

describe('provenance', () => {
  it('names exactly the fields the model wrote, and no others', async () => {
    // rejects: a banner that says "AI drafted this set" over four fields when the
    // model wrote three of them. A set's metadata has no tag list and no CSV
    // column to carry authorship — `edit-question-set.js` writes a closed
    // allow-list of fields — so the only honest place to state it is here, before
    // the save, naming which fields it applies to.
    mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    const banner = await screen.findByTestId('ai-set-provenance');
    expect(banner).toHaveTextContent('Description');
    expect(banner).toHaveTextContent('Custom Instructions');
    expect(banner).toHaveTextContent('AI Context Instructions');
    // The Title was HELD, not written, so it is not claimed.
    expect(banner.textContent).not.toMatch(/AI drafted[^.]*Title/);

    // And per field, beside the label that changed.
    expect(screen.getByTestId('ai-drafted-description')).toBeInTheDocument();
    expect(screen.getByTestId('ai-drafted-customInstruction')).toBeInTheDocument();
    expect(screen.getByTestId('ai-drafted-aiContextInstruction')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-drafted-name')).toBeNull();
  });

  it('claims a held field only once the author accepts it', async () => {
    // rejects: marking a field as AI-drafted while the author's own words are
    // still in it. The mark has to track what is in the box, not what was offered.
    mockApi();
    renderEditor();
    await openAiPanel();
    await screen.findAllByTestId('ai-source-question');
    await draftIt();

    expect(screen.queryByTestId('ai-drafted-name')).toBeNull();
    const row = await screen.findByTestId('ai-held-name');
    fireEvent.click(within(row).getByRole('button', { name: /Replace mine with this/i }));

    expect(field.title()).toHaveValue(DRAFT.name);
    expect(await screen.findByTestId('ai-drafted-name')).toBeInTheDocument();
  });

  it('says nothing before anything has been drafted', async () => {
    // rejects: a provenance line rendered unconditionally. A permanent "AI
    // drafted these" on a set nobody has run the drafter on is a false record.
    mockApi();
    renderEditor();
    await screen.findByLabelText(/^Title \*/);
    expect(screen.queryByTestId('ai-set-provenance')).toBeNull();
    expect(screen.queryByTestId('ai-drafted-description')).toBeNull();
  });
});
