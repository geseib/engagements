/**
 * THE HOST SHELF'S AI BUILDERS, WHEN THE WORKER COULD NOT MAKE THE SET.
 *
 * A finished generation reaches the shelf (components/HostQuestionSetsDialog
 * .jsx) in one of two shapes. Usually the worker made the draft set itself, so
 * the builder hands over `{ createdSet }` and the shelf opens it. When the worker
 * could NOT (the organisation is at its stored-set allowance, or the job
 * predates server-side creation), the builder hands over the questions it kept,
 * `{ questions | scenarios, metadata, … }`, and expects the page to upload them.
 *
 * THE DEFECT. The shelf's `finishBuilder` read only `createdSet`. On the second
 * shape it closed the builder, re-read the list and saved NOTHING, and the
 * builder had already forgotten its job, so there was nothing to go back to.
 * The console (AdminPage handleTriviaGenerated and its three siblings) always
 * uploaded them. Both pages now go through utils/generatedSetUpload.js.
 *
 * THE BUILDERS ARE STUBBED, and only the builders. Each real builder reaches its
 * hand-over through several minutes of configuration and a polled job, and what
 * it hands over is already pinned where it is made (builderJobCallSite.test.js,
 * generatedSetHandoff.test.jsx). What is in question HERE is what the shelf does
 * with the payload. The stub records the props the shelf gave it, and the test
 * calls the callback exactly as the builder's Load/Save button does: without
 * awaiting it.
 *
 * `../auth/authFetch` is the only other mock, as in hostQuestionSets.test.jsx.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import HostQuestionSetsDialog from '../components/HostQuestionSetsDialog';
import { authFetch } from '../auth/authFetch';
import { surveyItemsToCsv } from '../utils/surveyDraft';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/** The builder the shelf has open, and the props it was given. */
const mockBuilder = { current: null };

// One stub per module. The factories cannot share a helper: jest.mock is
// hoisted above every const in this file.
jest.mock('../components/AIScenarioBuilder', () => ({
  __esModule: true,
  default: function StubScenarioBuilder(props) {
    mockBuilder.current = { name: 'scenario', props };
    return require('react').createElement('div', { 'data-testid': 'stub-builder' });
  },
}));
jest.mock('../components/TriviaAIBuilder', () => ({
  __esModule: true,
  default: function StubTriviaBuilder(props) {
    mockBuilder.current = { name: 'trivia', props };
    return require('react').createElement('div', { 'data-testid': 'stub-builder' });
  },
}));
jest.mock('../components/PollAIBuilder', () => ({
  __esModule: true,
  default: function StubPollBuilder(props) {
    mockBuilder.current = { name: 'poll', props };
    return require('react').createElement('div', { 'data-testid': 'stub-builder' });
  },
}));
jest.mock('../components/SurveyAIBuilder', () => ({
  __esModule: true,
  default: function StubSurveyBuilder(props) {
    mockBuilder.current = { name: 'survey', props };
    return require('react').createElement('div', { 'data-testid': 'stub-builder' });
  },
}));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const SHELF = [
  {
    id: 'ivy-retro', name: 'Ivy Retro', description: 'Made last Tuesday',
    engagementType: 'call-and-answer', totalQuestions: 12, categoryCount: 2,
    active: true, hasImages: false, canManage: true, mine: true, createdByName: 'ivy',
  },
];

/** A draft the worker made, as the job record's `createdSet` carries it. */
const CREATED = { setId: 'fresh-draft', setName: 'Fresh Draft' };
const CREATED_ROW = {
  id: 'fresh-draft', name: 'Fresh Draft', description: '', engagementType: 'trivia',
  totalQuestions: 2, categoryCount: 1, active: false, hasImages: false,
  canManage: true, mine: true, createdByName: 'ivy',
};

/** The 402 plan-limit.js sends, in the shape builderPageLimit.test.jsx uses. */
const SETS_REFUSAL = {
  code: 'upgrade_required',
  error: 'This organisation cannot store another question set yet.',
  limit: { kind: 'sets', used: 5, included: 5 },
  resolve: {
    role: 'admin', canViewBilling: true, org: { name: 'Northwind', type: 'team' },
    contacts: [{ name: 'Dana Whitfield', email: 'dana@x.example', role: 'owner' }],
    resetsOn: '2026-10-01',
  },
};

/* Every request no route above answers. The throw alone is not enough: the
   component catches it and renders it, so the test only saw it when the timing
   happened to put it on screen. Asserted empty after every test. */
let unhandled = [];

function mockApi({ upload = { status: 200, body: { message: 'Successfully created question set "Space Quiz"' } }, afterCreate = false } = {}) {
  let listCalls = 0;
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/admin\/question-sets$/.test(url)) {
      listCalls += 1;
      return jsonResponse(200, { questionSets: afterCreate && listCalls > 1 ? [...SHELF, CREATED_ROW] : SHELF });
    }
    if (method === 'GET' && url.includes('/admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
    if (method === 'GET' && url.includes('/admin/personas')) return jsonResponse(200, { personas: [] });
    // What the editor reads when the createdSet path opens the draft.
    if (method === 'GET' && /\/question-sets\/[^/]+\/questions$/.test(url)) {
      return jsonResponse(200, { setId: CREATED.setId, questions: [] });
    }
    /* And the media check the editor runs as it mounts (SetMediaPanel's
       verify). Left unanswered, the throw below became a SECOND role="status"
       — "The check could not run" — inside the shelf dialog, where the editor
       renders, and the shelf's own notice could no longer be found by role.
       Whether it had rendered yet when the test looked was down to timer
       order, so this failed one full run in several (dev, 2026-09-25). The
       shape is admin/media-status.js's, as setMediaPanel.test.jsx has it. */
    if (method === 'GET' && /\/question-sets\/[^/]+\/media$/.test(url)) {
      return jsonResponse(200, {
        setId: CREATED.setId,
        prefix: `sets/${CREATED.setId}/`,
        totalQuestions: 0,
        counts: { none: 0, remote: 0, asset: 0, key: 0 },
        missingCount: 0,
        missing: [],
        unused: [],
        deadRemoteCount: 0,
        deadRemote: [],
        remoteChecked: 0,
        remoteUnchecked: 0,
        unverifiable: 0,
      });
    }
    if (method === 'POST' && url.includes('/admin/upload-questions')) {
      if (upload.throws) throw new Error(upload.throws);
      return jsonResponse(upload.status, upload.body);
    }
    unhandled.push(`${method} ${url}`);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return {
    listCalls: () => listCalls,
    uploads: () => authFetch.mock.calls
      .filter(([url, opt]) => (opt?.method || 'GET').toUpperCase() === 'POST' && url.includes('/admin/upload-questions'))
      .map(([url, opt]) => ({ url, body: JSON.parse(opt.body) })),
  };
}

/**
 * Open the shelf on `engagementType`, press its AI builder, and return the
 * callback the shelf handed the builder that opened.
 */
async function openBuilder({ engagementType, callback, api }) {
  const utils = render(<HostQuestionSetsDialog engagementType={engagementType} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText(/loading your question sets/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /new question set/i }));
  // A survey's lead route is its own material; every other format says "AI … builder".
  fireEvent.click(screen.getByRole('button', {
    name: engagementType === 'survey' ? /write it from my material/i : /AI .* builder/i,
  }));
  await screen.findByTestId('stub-builder');
  return { ...utils, ...api, handOver: mockBuilder.current.props[callback], opened: mockBuilder.current.name };
}

/** The builder's own Load/Save handler: it calls, and does not wait. */
const handOver = (fn, payload) => act(() => { fn(payload); });

/*
  WHAT EACH BUILDER HANDS OVER on the fallback path, field for field from its
  handleLoadIntoSystem / handleSaveDraft: scenarios as `scenarios`, the others
  as `questions`; scenario and poll also carry the round direction.
*/
const BUILDERS = [
  {
    kind: 'scenario',
    engagementType: 'call-and-answer',
    callback: 'onScenariosGenerated',
    payload: {
      scenarios: [{ title: 'THE LATE DELIVERY', detail: 'A supplier slips a week.', category: 'Ops', tags: ['supply'] }],
      metadata: {
        title: 'Supply Retro', description: 'What we learned',
        customInstructions: 'Share one thing', aiContextInstructions: 'Summarise the lessons',
      },
      roundKind: 'apply',
      roundKindBrief: 'Use it on Monday',
    },
    header: 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags,Background',
    firstRow: '"Ops","1","THE LATE DELIVERY","A supplier slips a week.","Professional Development","","supply",""',
    expectBody: {
      customTitle: 'Supply Retro', customDescription: 'What we learned',
      customInstructions: 'Share one thing', aiContextInstructions: 'Summarise the lessons',
      engagementType: 'call-and-answer', roundKind: 'apply', roundKindBrief: 'Use it on Monday',
      isAIGenerated: true,
    },
    fileStem: 'Supply_Retro',
    created: 'question set created',
  },
  {
    kind: 'trivia',
    engagementType: 'trivia',
    callback: 'onTriviaGenerated',
    payload: {
      questions: [{
        title: 'RED PLANET', questionDetail: 'Which planet is red?', answerDetails: 'Iron oxide.',
        category: 'Space', optionA: 'Mars', optionB: 'Venus', correctAnswer: 'OptionA', difficulty: 'easy',
        tags: ['space'],
      }],
      metadata: {
        title: 'Space Quiz', description: 'Planets', customInstructions: 'Pick one',
        aiContextInstructions: 'Say who knew',
      },
    },
    header: 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags,Background',
    firstRow: '"Space","1","RED PLANET","Which planet is red?","Iron oxide.","General","Mars","Venus","","","","","OptionA","easy","space",""',
    expectBody: {
      customTitle: 'Space Quiz', customDescription: 'Planets', customInstructions: 'Pick one',
      aiContextInstructions: 'Say who knew', engagementType: 'trivia', isAIGenerated: true,
    },
    fileStem: 'Space_Quiz',
    created: 'trivia set created',
  },
  {
    kind: 'poll',
    engagementType: 'poll',
    callback: 'onPollGenerated',
    payload: {
      questions: [{
        title: 'LUNCH', detail: 'Where do we eat?', category: 'Team', options: ['Tacos', 'Pho'],
        allowMultiple: true, tags: ['food'],
      }],
      metadata: { title: 'Team Poll', description: 'Choices', customInstructions: 'Vote', aiContextInstructions: 'Tally' },
      roundKind: 'produce',
      roundKindBrief: '',
    },
    header: 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags',
    firstRow: '"Team","1","LUNCH","Where do we eat?","General","","Tacos|Pho","true","food"',
    expectBody: {
      customTitle: 'Team Poll', customDescription: 'Choices', customInstructions: 'Vote',
      aiContextInstructions: 'Tally', engagementType: 'poll', roundKind: 'produce', isAIGenerated: true,
    },
    fileStem: 'Team_Poll',
    created: 'poll set created',
  },
  {
    kind: 'survey',
    engagementType: 'survey',
    callback: 'onSurveyGenerated',
    payload: {
      questions: [
        { kind: 'rating', title: 'How useful was the talk?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['feedback'] },
        { kind: 'choice', title: 'Which part?', required: false, options: ['Demo', 'Stories'], tags: [] },
      ],
      metadata: { title: 'Talk Feedback', description: 'A survey Workie drafted from your material.' },
    },
    expectBody: {
      customTitle: 'Talk Feedback', customDescription: 'A survey Workie drafted from your material.',
      engagementType: 'survey', isAIGenerated: true,
    },
    fileStem: 'Talk_Feedback',
    created: 'draft survey created',
  },
];

beforeEach(() => {
  authFetch.mockReset();
  mockBuilder.current = null;
  window.API_BASE = 'https://api.example.test/dev/';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  const seen = unhandled;
  unhandled = [];
  expect(seen).toEqual([]);
});

describe.each(BUILDERS)('the $kind builder hands over questions, not a set', (b) => {
  test('the shelf uploads them, exactly as the console does', async () => {
    const api = mockApi();
    const { handOver: fn, opened, uploads, listCalls } = await openBuilder({ ...b, api });
    expect(opened).toBe(b.kind);
    const readsBefore = listCalls();

    handOver(fn, b.payload);

    // rejects: THE DEFECT. finishBuilder read `createdSet` only, so this
    // payload closed the builder and nothing was ever sent.
    await waitFor(() => expect(uploads()).toHaveLength(1));
    const [{ url, body }] = uploads();
    expect(url).toBe('https://api.example.test/dev/admin/upload-questions');

    // rejects: a body that drifts from the console's. The importer is the one
    // writer of the SETS row, so a field missing here is a field the set lacks.
    expect(body).toEqual({
      ...b.expectBody,
      fileName: expect.stringMatching(new RegExp(`^${b.fileStem}-\\d+\\.csv$`)),
      fileContent: expect.any(String),
    });
    if (b.kind === 'survey') {
      // The survey branch of the one CSV contract, not a writer of the shelf's own.
      expect(body.fileContent).toBe(surveyItemsToCsv(b.payload.questions));
    } else {
      expect(body.fileContent.split('\n')).toEqual([b.header, b.firstRow]);
    }

    // Said on the shelf, and the new set is on the list it points at.
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(`Successfully created question set "Space Quiz" — ${b.created}`);
    await waitFor(() => expect(listCalls()).toBeGreaterThan(readsBefore));
    expect(screen.queryByTestId('stub-builder')).toBeNull();
  });

  test('a 402 is the plan-limit notice, and says nothing was saved', async () => {
    const api = mockApi({ upload: { status: 402, body: SETS_REFUSAL } });
    const { handOver: fn } = await openBuilder({ ...b, api });

    handOver(fn, b.payload);

    // rejects: reporting a plan fact as "Upload failed", or saying nothing.
    const box = await screen.findByTestId('plan-limit-notice');
    expect(box).toHaveTextContent('Northwind holds 5 of the 5 question sets it includes. Nothing was saved.');
    expect(screen.queryByText(/upload failed/i)).toBeNull();
  });

  test('any other refusal is shown in the server\'s words', async () => {
    const api = mockApi({ upload: { status: 500, body: { error: 'The importer is down' } } });
    const { handOver: fn } = await openBuilder({ ...b, api });

    handOver(fn, b.payload);

    // rejects: swallowing it. The job is already forgotten; this line is the
    // only trace the person gets that their questions were not kept.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Upload failed: The importer is down');
    expect(screen.queryByTestId('plan-limit-notice')).toBeNull();
  });
});

describe('a request that never arrives', () => {
  test('is reported, not swallowed', async () => {
    const api = mockApi({ upload: { throws: 'Network request failed' } });
    const { handOver: fn } = await openBuilder({ ...BUILDERS[1], api });

    handOver(fn, BUILDERS[1].payload);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Upload failed: Network request failed');
  });
});

describe('the scenario builder uploads as the format the host chose', () => {
  test('a wavelength set is sent as wavelength, not as call-and-answer', async () => {
    // Every format without a builder of its own opens the scenario builder, as
    // AdminPage does. rejects: hardcoding the type, which would make a
    // wavelength set import as call-and-answer.
    const api = mockApi();
    const scenario = BUILDERS[0];
    const { handOver: fn, opened, uploads } = await openBuilder({ ...scenario, engagementType: 'wavelength', api });
    expect(opened).toBe('scenario');

    handOver(fn, scenario.payload);

    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(uploads()[0].body.engagementType).toBe('wavelength');
  });
});

describe('the worker already made the set: unchanged', () => {
  test.each(BUILDERS)('$kind: nothing is uploaded, and the draft opens', async (b) => {
    const api = mockApi({ afterCreate: true });
    const { handOver: fn, uploads } = await openBuilder({ ...b, api });

    handOver(fn, { createdSet: CREATED });

    // rejects: uploading a second copy. The importer refuses to write over a
    // set that exists, and would report that as a failure over a set that is
    // sitting on the list.
    await screen.findByRole('dialog', { name: /^edit fresh draft$/i });
    expect(uploads()).toHaveLength(0);
    const shelf = screen.getByRole('dialog', { name: /your question sets/i });
    expect(within(shelf).getByRole('status')).toHaveTextContent(
      '“Fresh Draft” was created while the generator ran. It is switched off until you review it and turn it on.'
    );
  });
});
