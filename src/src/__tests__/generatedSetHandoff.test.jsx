/**
 * THE SET THE WORKER ALREADY MADE — and the client not making a second one.
 *
 * THE REPORT. The owner ran the AI scenario builder for a set called "World
 * Leaders", was told *"Close — this keeps running"*, left, and came back to no
 * set. Nothing had crashed: the worker wrote ITEMS into the job record, and the
 * SET was only ever created here, in the browser, when a human returned and
 * pressed "Load N into System". The panel's promise was true about the job and
 * false about the outcome.
 *
 * The worker creates the set itself now, as an inactive draft, and writes it on
 * the job record as `createdSet` BEFORE the job goes terminal. Everything in
 * this file is about the client half of that: it must stop offering to create
 * what already exists, stop claiming nothing has been saved, and hand the page
 * a pointer instead of a payload.
 *
 * Rendered rather than source-asserted wherever the property is about what the
 * component does. Only `../auth/authFetch` is mocked — this builder does not
 * use useAuth, so AuthContext is untouched (the recipe
 * generationJobResume.test.jsx establishes and aiScenarioBuilderKind.test.jsx
 * follows).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;
const GenerationJobPanel = require('../components/GenerationJobPanel').default;
const GeneratedItemsTable = require('../components/GeneratedItemsTable').default;
const { interpretGenerationJob } = require('../utils/generationJob');

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const scenarioItems = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Scenario ${i + 1}`,
  category: 'General',
  detail: `Detail ${i + 1}`,
  customInstructions: '',
  tags: ['alpha'],
}));

/** The wire shape `jobToResponse()` really sends. Do not invent fields. */
const jobPayload = (overrides = {}) => ({
  jobId: 'job-1',
  status: 'complete',
  phase: 'Generated 2 of 2',
  requested: 2,
  completed: 2,
  items: scenarioItems(2),
  warnings: [],
  meta: null,
  error: null,
  createdSet: null,
  setCreationError: null,
  updatedAt: '2026-08-14T10:00:00.000Z',
  ...overrides,
});

function mockApi(job) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
    if (method === 'POST' && url.includes('admin/ai-generate-scenarios')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 2 });
    }
    if (method === 'GET' && url.includes('admin/ai-generate-scenarios/job-1')) {
      return jsonResponse(200, job);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** Open the builder and run one generation to its review step. */
async function generate(job) {
  const posted = mockApi(job);
  const onScenariosGenerated = jest.fn();
  render(
    <AIScenarioBuilder
      onClose={() => {}}
      onScenariosGenerated={onScenariosGenerated}
      engagementType="call-and-answer"
    />
  );
  await waitFor(() => expect(authFetch).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Lessons Learned Scenarios'));
  fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));
  await waitFor(() => expect(posted).toHaveLength(1));
  return { posted, onScenariosGenerated };
}

const CREATED = { setId: 'worldleaders', setName: 'World Leaders' };

describe('the poll response says whether a set already exists', () => {
  test('createdSet is carried through, not inferred', () => {
    // rejects: re-deriving "was a set made?" from items.length or from the
    // outcome. A failed job carries items, and a complete job may still have
    // failed to create its set — the two questions are independent and the
    // wire answers them separately.
    const read = interpretGenerationJob(jobPayload({ createdSet: CREATED }));
    expect(read.createdSet).toEqual(CREATED);
    expect(read.outcome).toBe('complete');
  });

  test('a job with no set reads as no set, and that is the manual path', () => {
    // rejects: defaulting createdSet to a truthy placeholder. A job started
    // before server-side creation shipped, and every survey job, carries
    // neither field — and the client must offer to create the set in that case
    // or the items are lost.
    expect(interpretGenerationJob(jobPayload()).createdSet).toBeNull();
    expect(interpretGenerationJob({ status: 'complete', items: [{ title: 'a' }] }).createdSet).toBeNull();
  });

  test('a set with no id is not a set you can open', () => {
    // rejects: trusting the shape. A `createdSet` without a setId would render
    // a button leading nowhere; reading it as "no set" routes the operator to
    // the manual path, which still works.
    expect(interpretGenerationJob(jobPayload({ createdSet: { setName: 'Nameless' } })).createdSet).toBeNull();
  });

  test('setCreationError travels so the client can say why there is no set', () => {
    // rejects: swallowing the worker's failure. Without it the review step
    // would offer the manual path with no explanation for why it is needed.
    const read = interpretGenerationJob(jobPayload({ setCreationError: 'Question set "X" already exists.' }));
    expect(read.setCreationError).toMatch(/already exists/);
  });
});

describe('the review step does not create what already exists', () => {
  test('the primary action opens the set instead of loading it', async () => {
    // rejects: leaving "Load N into System" live over a set the worker already
    // wrote. Pressing it posts the whole batch to /admin/upload-questions,
    // which refuses to overwrite an existing set — so the operator would be
    // shown a failure about a set that is sitting right there.
    await generate(jobPayload({ createdSet: CREATED }));
    expect(await screen.findByRole('button', { name: /Open .World Leaders./ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load .* into System/i })).not.toBeInTheDocument();
  });

  test('opening it hands the page a pointer and no questions to write', async () => {
    // rejects: calling onScenariosGenerated with `scenarios` and `metadata`
    // alongside the pointer. AdminPage builds a CSV and POSTs whenever it is
    // given questions; handing it both would be the double creation in a
    // different coat.
    const { onScenariosGenerated } = await generate(jobPayload({ createdSet: CREATED }));
    fireEvent.click(await screen.findByRole('button', { name: /Open .World Leaders./ }));
    await waitFor(() => expect(onScenariosGenerated).toHaveBeenCalled());
    const payload = onScenariosGenerated.mock.calls[0][0];
    expect(payload.createdSet).toEqual(CREATED);
    expect(payload.scenarios).toBeUndefined();
    expect(payload.metadata).toBeUndefined();
  });

  test('and it posts nothing itself', async () => {
    // rejects: a builder that opens the set AND uploads. The only POST this
    // component may ever make is the one that starts the generation job.
    await generate(jobPayload({ createdSet: CREATED }));
    fireEvent.click(await screen.findByRole('button', { name: /Open .World Leaders./ }));
    const uploads = authFetch.mock.calls.filter(([url]) => String(url).includes('upload-questions'));
    expect(uploads).toHaveLength(0);
  });

  test('the table stops claiming nothing has been saved', async () => {
    // rejects: keeping "Nothing has been saved yet." over rows that are already
    // in the database. It is the same class of untruth as the panel promising
    // an outcome the server never produced, which is the defect being repaired.
    await generate(jobPayload({ createdSet: CREATED }));
    await screen.findByRole('button', { name: /Open .World Leaders./ });
    expect(screen.queryByText(/Nothing has been saved yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Already saved/i)).toBeInTheDocument();
  });

  test('the per-row Leave out and Edit controls are withheld, not left inert', async () => {
    // rejects: leaving row controls live over a set that already holds every
    // row. Excluding one would change an array nothing reads any more, and the
    // operator would believe they had removed a question.
    await generate(jobPayload({ createdSet: CREATED }));
    await screen.findByRole('button', { name: /Open .World Leaders./ });
    expect(screen.queryByRole('button', { name: /Leave out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument();
  });

  test('with NO set the manual path is exactly as it was', async () => {
    // rejects: removing the fallback. A job that predates server-side creation,
    // or one whose creation was refused, has items and no set — and the only
    // way those items become a set is this button.
    const { onScenariosGenerated } = await generate(jobPayload());
    fireEvent.click(await screen.findByRole('button', { name: /Load 2 into System/i }));
    await waitFor(() => expect(onScenariosGenerated).toHaveBeenCalled());
    const payload = onScenariosGenerated.mock.calls[0][0];
    expect(payload.scenarios).toHaveLength(2);
    expect(payload.metadata.title).toBeTruthy();
    expect(payload.createdSet).toBeUndefined();
  });
});

describe('the worker is given what it needs to name the set', () => {
  test('the generation request carries the set metadata', async () => {
    // rejects: expecting the Lambda to re-derive this copy. Only the browser
    // holds the operator's own participant instruction for a `custom` round
    // kind and the chosen topic card's title, so a server-side second
    // implementation would drift on the first change to either.
    const { posted } = await generate(jobPayload({ createdSet: CREATED }));
    expect(posted[0].setMetadata).toBeTruthy();
    expect(posted[0].setMetadata.title).toBe('Lessons Learned Scenarios');
    expect(posted[0].setMetadata.customInstructions).toBeTruthy();
  });

  test('the description does not open with a count it cannot know yet', async () => {
    // rejects: `${generatedScenarios.length} AI-generated scenarios`. This copy
    // is now computed BEFORE generation, at the moment the job starts, so the
    // count is zero — and "0 AI-generated scenarios" over eighteen of them is
    // worse than not counting at all.
    const { posted } = await generate(jobPayload({ createdSet: CREATED }));
    expect(posted[0].setMetadata.description).not.toMatch(/^0 /);
    expect(posted[0].setMetadata.description).toMatch(/AI-generated scenarios/);
  });
});

describe('the running panel only promises what its worker really does', () => {
  const running = interpretGenerationJob(jobPayload({ status: 'running', completed: 1, items: scenarioItems(1) }));

  test('a builder whose worker creates the set says so under "If you leave"', () => {
    // rejects: shipping server-side creation without telling anyone. The whole
    // report is that "Close — this keeps running" was believed and produced
    // nothing; the fix is only half done if the screen still describes the old
    // behaviour.
    render(<GenerationJobPanel job={running} noun="scenarios" createsSet onKeepRunning={() => {}} />);
    expect(screen.getByText(/The set gets made without you/i)).toBeInTheDocument();
  });

  test('a builder whose worker does NOT create one stays silent about it', () => {
    // rejects: hardcoding the promise into the shared panel. The survey
    // builder's worker creates nothing — survey is not a playable type and
    // upload-questions.js refuses it — so this panel over that builder would be
    // telling the same lie in a new place.
    render(<GenerationJobPanel job={running} noun="questions" onKeepRunning={() => {}} />);
    expect(screen.queryByText(/The set gets made without you/i)).not.toBeInTheDocument();
  });
});

describe('a partial run that still produced a draft says so', () => {
  const partial = (extra) => interpretGenerationJob(jobPayload({
    status: 'error', requested: 5, completed: 2, error: 'model unavailable', ...extra,
  }));

  test('the review button stops promising to make a set', () => {
    // rejects: "Review the 2 and make a set" over a set that exists. The button
    // would be describing an action the screen no longer performs.
    render(<GenerationJobPanel job={partial({ createdSet: CREATED })} noun="scenarios" onReview={() => {}} />);
    expect(screen.getByRole('button', { name: /Review the 2 that were saved/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /and make a set/ })).not.toBeInTheDocument();
  });

  test('Discard is withheld, because nothing here can unmake the draft', () => {
    // rejects: a "Discard all 2" that clears the screen and leaves the set in
    // the library — a button doing the opposite of what it says. Deleting is
    // done to the set, from the list, where the dialog knows what it deletes.
    render(
      <GenerationJobPanel
        job={partial({ createdSet: CREATED })} noun="scenarios"
        onReview={() => {}} onDiscard={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Discard all/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing on this screen can unmake the draft/i)).toBeInTheDocument();
  });

  test('a partial with NO set keeps the original copy and the Discard button', () => {
    // rejects: applying the created-set copy unconditionally. The survey
    // builder and any refused creation still reach this screen with nothing
    // saved, and for them the old wording is the true one.
    render(
      <GenerationJobPanel
        job={partial()} noun="scenarios" onReview={() => {}} onDiscard={() => {}}
      />
    );
    expect(screen.getByText(/partial result, not a finished set/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Discard all 2/ })).toBeInTheDocument();
  });

  test('a creation that failed is named on the failure screen', () => {
    // rejects: showing the manual path with no reason for it. The operator is
    // being asked to do by hand something the system said it would do.
    render(
      <GenerationJobPanel
        job={partial({ setCreationError: 'Question set "World Leaders" already exists.' })}
        noun="scenarios" onReview={() => {}}
      />
    );
    expect(screen.getByText(/The set could not be created for you/i)).toBeInTheDocument();
  });
});

describe('the table counts honestly either way', () => {
  const items = scenarioItems(3);

  test('with a draft it says all of them are in it', () => {
    // rejects: "3 will be saved" over rows that are already saved.
    render(<GeneratedItemsTable items={items} noun="scenarios" savedAs={CREATED} />);
    expect(screen.getByText(/all 3 are in the draft/i)).toBeInTheDocument();
  });

  test('without one it still says what will be saved', () => {
    // rejects: dropping the original copy while adding the new branch.
    render(<GeneratedItemsTable items={items} noun="scenarios" onToggleExclude={() => {}} />);
    expect(screen.getByText(/3 will be saved/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been saved yet/i)).toBeInTheDocument();
  });
});
