/**
 * WORKIE'S TWO SETTINGS, ON THE EDITOR A HOST ACTUALLY OPENS —
 * components/HostQuestionSetsDialog.jsx.
 *
 * The owner: *"I don't see where the prompt/Workie selection maps to a question
 * set, and as a host, how do I change it?"* The answer was that it did not, for
 * a reason that reads as a bug only once both mounts are put side by side:
 * `AdminPage.jsx` passes `QuestionSetEditor` both `availablePrompts` and
 * `availablePersonas`; this dialog opens THE SAME COMPONENT and passed neither.
 * So the two selects rendered with exactly one option each — "Use default prompt
 * for game type" and "Adapt to the session (recommended)" — and a host reading
 * that concluded, correctly for what was on screen, that there was nothing to
 * choose.
 *
 * WHY THIS IS DATA AND NOT A PERMISSION CHANGE. `GET admin/ai-prompts` and
 * `GET admin/personas` are both in `HOST_ADMIN_ROUTES` in
 * `lambda-functions/auth/authorizer.js` (:325 and :250), the second with a
 * comment saying its absence "was an oversight, not a policy". Nothing here
 * opens a route; it fetches two lists a host was already allowed to read and
 * hands them to the editor that was already mounted. The three flags that ARE
 * permission decisions — `showVersions`, `showDownload`, `showAIAssist` — stay
 * off, and the last test in this file holds them there.
 *
 * NOT THE QUICK-CREATE PANEL. `QuestionSetUploadPanel` keeps
 * `showSummaryPrompt={false}`: that is a recorded choice about the quick "make
 * me a set" path, not an accident, and a test below pins it so a later reading
 * of this file does not "finish the job" by turning it on.
 *
 * Same pattern as hostQuestionSets.test.jsx: one mocked module
 * (`../auth/authFetch`), a router that throws on anything unrouted, and no
 * AuthProvider — this component does not call `useAuth`.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostQuestionSetsDialog from '../components/HostQuestionSetsDialog';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** One manageable set, `canManage` exactly as the admin projection sends it. */
const HOST_VIEW = [
  {
    id: 'ivy-retro', name: 'Ivy Retro', description: 'Made last Tuesday',
    // Filed, because the Details save requires a shelf before it will send.
    topic: 'business-work',
    engagementType: 'call-and-answer', totalQuestions: 12, categoryCount: 2,
    active: true, hasImages: false, canManage: true, mine: true, createdByName: 'ivy',
  },
];

const IVY_QUESTIONS = {
  setId: 'ivy-retro',
  questions: [
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', Tags: ['retro'],
    },
  ],
};

/**
 * `GET /admin/personas` as get-personas.js sends it. Platform-global, no org
 * term, no status field — the endpoint returns what it returns and the console
 * does not filter it (AdminPage.jsx:620, deliberately unfiltered so voices do
 * not appear and vanish while the engagement type is being edited).
 */
const PERSONAS = {
  personas: [
    { personaId: 'sage', name: 'Sage', tagline: 'measured and dry' },
    { personaId: 'coach', name: 'Coach', tagline: 'all encouragement' },
  ],
};

/**
 * `GET /admin/ai-prompts`. Four rows chosen to prove the list is handed over
 * RAW rather than pre-filtered: the editor runs `selectableSummaryPrompts()`
 * itself and also counts what that helper hid, so a caller that filters first
 * would silently zero the "N prompts for other game types are hidden" sentence.
 */
const PROMPTS = {
  prompts: [
    { promptId: 'lessons-learned', name: 'Lessons Learned', status: 'active', gameType: 'call-and-answer', category: 'Retro' },
    { promptId: 'themes', name: 'Common Themes', status: 'active', gameType: 'all' },
    { promptId: 'quiz-recap', name: 'Quiz Recap', status: 'active', gameType: 'trivia' },
    { promptId: 'retired-one', name: 'Retired One', status: 'archived', gameType: 'call-and-answer' },
  ],
};

function mockApi({ promptStatus = 200, personaStatus = 200 } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/admin\/question-sets$/.test(url)) {
      return jsonResponse(200, { questionSets: HOST_VIEW });
    }
    if (method === 'GET' && /\/question-sets\/[^/]+\/questions$/.test(url)) {
      return jsonResponse(200, IVY_QUESTIONS);
    }
    if (method === 'GET' && /\/admin\/ai-prompts$/.test(url)) {
      return promptStatus === 200
        ? jsonResponse(200, PROMPTS)
        : jsonResponse(promptStatus, { error: 'nope' });
    }
    if (method === 'GET' && /\/admin\/personas$/.test(url)) {
      return personaStatus === 200
        ? jsonResponse(200, PERSONAS)
        : jsonResponse(personaStatus, { error: 'nope' });
    }
    if (method === 'PUT' && url.includes('/admin/edit-question-set/')) {
      return jsonResponse(200, { message: 'ok', updated: {} });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return {
    promptCalls: () => authFetch.mock.calls.filter(([url]) => /\/admin\/ai-prompts$/.test(String(url))),
    personaCalls: () => authFetch.mock.calls.filter(([url]) => /\/admin\/personas$/.test(String(url))),
    edits: () => authFetch.mock.calls
      .filter(([url, opt]) => (opt?.method || '') === 'PUT' && String(url).includes('/admin/edit-question-set/'))
      .map(([, opt]) => JSON.parse(opt.body || '{}')),
  };
}

async function openDialog(options) {
  const api = mockApi(options);
  const utils = render(<HostQuestionSetsDialog onClose={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText(/loading your question sets/i)).toBeNull());
  return { ...utils, ...api };
}

const rowFor = (name) => screen.getByText(name).closest('tr');

/** Open the mounted editor and wait for its working copy to arrive. */
async function openEditor(name = 'Ivy Retro') {
  fireEvent.click(within(rowFor(name)).getByRole('button', { name: /edit questions/i }));
  await screen.findByTestId('question-0');
}

const voiceSelect = () => document.getElementById('edit-persona-id');
const promptSelect = () => document.getElementById('edit-prompt-id');
const optionLabels = (select) => Array.from(select.options).map((o) => o.textContent.trim());

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* --------------------------------------------------- the two pickers, full --- */

describe("a host can see what Workie will do with the set they are editing", () => {
  test('the voice picker offers the voices this environment has', async () => {
    // THE HEADLINE. rejects: the reported state — a select carrying only
    // "Adapt to the session (recommended)", which reads as "there are no
    // voices" rather than "nobody handed this component the list".
    await openDialog();
    await openEditor();
    const select = voiceSelect();
    expect(select).not.toBeNull();
    expect(within(select).getByRole('option', { name: /Sage/ })).toBeTruthy();
    expect(within(select).getByRole('option', { name: /Coach/ })).toBeTruthy();
    // The designed default survives; this adds voices, it does not replace it.
    expect(within(select).getByRole('option', { name: /adapt to the session/i })).toBeTruthy();
  });

  test("the summary-prompt picker offers the prompts for this set's format", async () => {
    // rejects: the same dead select on the other control. `all` is offered
    // alongside the format's own; the trivia prompt and the archived one are
    // not, which is `selectableSummaryPrompts()` doing its job INSIDE the
    // editor — i.e. proof the raw list reached it rather than a pre-filtered one.
    await openDialog();
    await openEditor();
    const labels = optionLabels(promptSelect());
    expect(labels.join('|')).toMatch(/Lessons Learned/);
    expect(labels.join('|')).toMatch(/Common Themes/);
    expect(labels.join('|')).not.toMatch(/Quiz Recap/);
    expect(labels.join('|')).not.toMatch(/Retired One/);
  });

  test('the editor still reports how many prompts its filter hid', async () => {
    // WHY THE LIST IS PASSED RAW. `hiddenPromptCount` is
    // `availablePrompts.length - summaryPromptChoices.length`, so a caller that
    // ran the helper first would hand over a list whose hidden count is always
    // zero and the sentence would quietly stop being true. One trivia prompt is
    // hidden here (the archived row is dropped by the status filter, not the
    // game-type one).
    await openDialog();
    await openEditor();
    expect(screen.getByText(/prompts? for other game types are hidden/i)).toBeTruthy();
  });

  test('choosing a voice and a summary approach saves both', async () => {
    // rejects: pickers that render and then send nothing — the selects are the
    // editor's own state, and this proves the values survive `buildEditPayload`
    // onto the one route a host may call for a set they own.
    const { edits } = await openDialog();
    await openEditor();
    fireEvent.change(voiceSelect(), { target: { value: 'coach' } });
    fireEvent.change(promptSelect(), { target: { value: 'lessons-learned' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(edits()).toHaveLength(1));
    expect(edits()[0]).toMatchObject({ personaId: 'coach', promptId: 'lessons-learned' });
  });
});

/* ------------------------------------------------------- when a fetch fails --- */

describe('a list that will not load costs the host nothing else', () => {
  test('a refused persona list leaves the editor — and the other picker — working', async () => {
    // rejects: letting a 403/500 on a SIDE list take down the screen, or
    // blocking the editor behind it. Both callers of these endpoints in this
    // codebase swallow a failure into an empty list on purpose; this holds that
    // shape and proves the failure is isolated to its own control.
    await openDialog({ personaStatus: 500 });
    await openEditor();
    expect(screen.getByText('WHAT WENT WRONG')).toBeTruthy();
    expect(optionLabels(voiceSelect())).toHaveLength(1);
    expect(optionLabels(promptSelect()).join('|')).toMatch(/Lessons Learned/);
  });

  test('a refused prompt list leaves the editor — and the other picker — working', async () => {
    await openDialog({ promptStatus: 403 });
    await openEditor();
    expect(screen.getByText('WHAT WENT WRONG')).toBeTruthy();
    expect(optionLabels(promptSelect())).toHaveLength(1);
    expect(within(voiceSelect()).getByRole('option', { name: /Sage/ })).toBeTruthy();
  });

  test('a thrown request is caught rather than left unhandled', async () => {
    // rejects: a bare `await authFetch(...)` with no try/catch. authFetch
    // rejects outright when there is no session to attach, and an unhandled
    // rejection inside an effect takes the dialog down with it.
    authFetch.mockReset();
    authFetch.mockImplementation(async (url) => {
      if (/\/admin\/question-sets$/.test(String(url))) {
        return jsonResponse(200, { questionSets: HOST_VIEW });
      }
      throw new Error('no session');
    });
    render(<HostQuestionSetsDialog onClose={jest.fn()} />);
    await waitFor(() => expect(screen.queryByText(/loading your question sets/i)).toBeNull());
    expect(screen.getByText('Ivy Retro')).toBeTruthy();
  });
});

/* ------------------------------------------------- and the failure is heard --- */

/**
 * SWALLOWED IS NOT THE SAME AS SILENT. Degrading to an empty list is the right
 * behaviour on screen — neither list is needed to edit a set — but the two
 * fetches used to do it with a comment where a log line belongs, so a host
 * saying "the voice picker is empty" left nobody anything to read. Both
 * existing callers of these endpoints (`AdminPage.fetchAvailablePrompts` /
 * `fetchAvailablePersonas`, and BuilderPage's prompt read) report the failure
 * to the console; this dialog now does too.
 */
describe('a list that will not load is still reported somewhere', () => {
  const capturingWarnings = async (body) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await body();
      return warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    } finally {
      warn.mockRestore();
    }
  };

  test('a refused list names itself and its status', async () => {
    // rejects: `if (!response.ok) return;` with nothing said. A 403 on one list
    // and a 500 on the other are the two most likely failures here and were the
    // two least visible.
    const said = await capturingWarnings(async () => {
      await openDialog({ promptStatus: 403, personaStatus: 500 });
      await openEditor();
    });
    expect(said).toMatch(/prompt/i);
    expect(said).toMatch(/403/);
    expect(said).toMatch(/voice|persona/i);
    expect(said).toMatch(/500/);
  });

  test('a thrown request is reported, not only caught', async () => {
    // rejects: THE DEFECT as written — two catch blocks whose whole body was a
    // comment. authFetch rejects outright when there is no session, which is
    // precisely the case somebody would be asked to diagnose.
    const said = await capturingWarnings(async () => {
      authFetch.mockReset();
      authFetch.mockImplementation(async (url) => {
        if (/\/admin\/question-sets$/.test(String(url))) {
          return jsonResponse(200, { questionSets: HOST_VIEW });
        }
        throw new Error('no session');
      });
      render(<HostQuestionSetsDialog onClose={jest.fn()} />);
      await waitFor(() => expect(screen.queryByText(/loading your question sets/i)).toBeNull());
      await waitFor(() => expect(screen.getByText('Ivy Retro')).toBeTruthy());
    });
    expect(said).toMatch(/prompt/i);
    expect(said).toMatch(/voice|persona/i);
    expect(said).toMatch(/no session/);
  });
});

/* ------------------------------------------------------------ once, not per --- */

describe('the lists are read when the dialog opens, once', () => {
  test('opening, closing and reopening the editor does not refetch', async () => {
    // rejects: a fetch in render, or one hung off the editor's mount — either
    // would put two requests on the wire every time a host opened a set, and a
    // fetch in render would loop. One dialog, one read of each list.
    const { promptCalls, personaCalls } = await openDialog();
    expect(promptCalls()).toHaveLength(1);
    expect(personaCalls()).toHaveLength(1);

    await openEditor();
    fireEvent.click(screen.getByTestId('qs-editor-cancel'));
    await waitFor(() => expect(screen.queryByTestId('question-0')).toBeNull());
    await openEditor();

    expect(promptCalls()).toHaveLength(1);
    expect(personaCalls()).toHaveLength(1);
  });

  test('typing in the editor does not put either list back on the wire', async () => {
    // rejects: the same bug with a slower fuse — a fetch called from the render
    // body only shows up once something re-renders.
    const { promptCalls, personaCalls } = await openDialog();
    await openEditor();
    const name = document.getElementById('edit-title');
    fireEvent.change(name, { target: { value: 'Ivy Retro v2' } });
    fireEvent.change(name, { target: { value: 'Ivy Retro v3' } });
    expect(promptCalls()).toHaveLength(1);
    expect(personaCalls()).toHaveLength(1);
  });
});

/* ------------------------------------------------ what this must NOT change --- */

describe('nothing gated came along with the data', () => {
  test('the three admins-only controls are still absent', async () => {
    // The flags at the editor mount are permission decisions with route
    // reasons: versions and download are admins-only in the authorizer, and AI
    // generation spends Bedrock budget. rejects: "while we are in here" —
    // passing two lists is not a licence to unset a flag beside them.
    await openDialog();
    await openEditor();
    expect(screen.queryByRole('button', { name: /download csv/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^versions$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /promote/i })).toBeNull();
  });

  test('the quick-create panel still does not ask for a summary prompt', async () => {
    // `showSummaryPrompt={false}` is recorded in the file as a choice about the
    // fast path, not an oversight. rejects: reading this task as "show the
    // prompt everywhere" and switching it on where the comment says not to.
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /new question set/i }));
    await screen.findByRole('heading', { name: /new question set/i });
    expect(document.getElementById('qsets-prompt-id')).toBeNull();
  });
});
