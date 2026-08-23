/**
 * THE AI FORM HELPER, ON SCREEN — components/AIFormAssist.jsx and FieldLock.jsx.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered. So say they only filled on
 * the description box of what they wanted. the AI could come up with a title,
 * categories, Instructions etc. or if the user filled those in the ai would
 * refine (unless locked, a small icon lock/unlock on cells."*
 *
 * The DECISIONS are tested without React in fieldDrafting.test.js. What is left
 * here is the wiring, which is where this kind of feature actually breaks:
 *
 *   1. THE LOCK STATE REACHES THE REQUEST. A padlock that toggles a class and
 *      sends nothing is the exact failure the owner would never see until an
 *      hour of work was overwritten.
 *   2. THE SNAPSHOT. The request is built from the values as they were when it
 *      started, and the response is applied against those — not against
 *      whatever the operator typed while the job ran.
 *   3. THE HELD PATH. A rewrite is shown beside the operator's words with a
 *      choice, and neither button is chosen for them.
 *   4. THE UNDO. What a refinement replaced comes back exactly.
 *
 * Rendered rather than source-asserted, because every one of those is a claim
 * about behaviour. Only `../auth/authFetch` is mocked — this panel uses no
 * context, following the recipe generationJobResume.test.jsx established.
 *
 * NO GEOMETRY IS ASSERTED ANYWHERE IN THIS FILE. jsdom has no layout engine, so
 * anything about size, overflow or position would pass unconditionally and
 * prove nothing.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const AIFormAssist = require('../components/AIFormAssist').default;
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;
const PollAIBuilder = require('../components/PollAIBuilder').default;
const { BUILDER_FORM_FIELDS } = require('../config/builderFormFields');

const FORM = BUILDER_FORM_FIELDS.scenario;
const ENDPOINT = 'http://localhost:3000/api/admin/ai-draft-builder-form';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const completeJob = (item) => ({
  jobId: 'job-1',
  status: 'complete',
  phase: 'Generated 1 of 1',
  requested: 1,
  completed: 1,
  items: [item],
  warnings: [],
  meta: null,
  error: null,
  createdSet: null,
  updatedAt: '2026-08-14T10:00:00.000Z',
});

/** Route by method + URL, capturing every POST body. Unmatched requests throw. */
function mockDraft(job, { prompts = [] } = {}) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts });
    if (method === 'POST' && url.includes('admin/ai-draft-builder-form')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 1 });
    }
    if (method === 'GET' && url.includes('admin/ai-draft-builder-form/job-1')) {
      return jsonResponse(200, job);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

/**
 * A minimal host for the panel: it owns the values and the lock set exactly the
 * way the three builders do, so the test exercises that contract rather than a
 * simplified version of it.
 */
function Host({ initial = {}, onValues = () => {} }) {
  const [values, setValues] = useState({
    customTitle: '', context: '', audience: '', mustHaveCategories: '', customPrompt: '',
    ...initial,
  });
  const [locked, setLocked] = useState(() => new Set());
  const toggle = (field) => setLocked((prev) => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });
  onValues(values);
  return (
    <div>
      <AIFormAssist
        formId={FORM.formId}
        fields={FORM.fields}
        seed={FORM.seed}
        values={values}
        locked={locked}
        onApply={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        endpoint={ENDPOINT}
        hints={['The operator asked for 3 categories.']}
      />
      {FORM.fields.map((field) => (
        <label key={field.key}>
          {field.label}
          <textarea
            value={values[field.key]}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
          />
        </label>
      ))}
      {/* The builders' own padlocks; rendered here so the lock set is reachable. */}
      {FORM.fields.map((field) => (
        <button key={field.key} data-testid={`toggle-${field.key}`} onClick={() => toggle(field.key)}>
          lock {field.key}
        </button>
      ))}
    </div>
  );
}

const SEEDED = {
  context: 'Support keeps escalating billing disputes to engineering because nobody owns refunds.',
};

const DRAFT = {
  customTitle: 'Owning The Refund Path',
  audience: 'Support leads and engineering managers',
  mustHaveCategories: 'Escalation, Ownership, Customer Trust',
  customPrompt: 'Write scenarios where the ownership gap is the real problem.',
};

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /Let AI fill this in/i }));
const pressDraft = () => fireEvent.click(screen.getByRole('button', { name: /Fill in the rest/i }));

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('1. the lock reaches the request', () => {
  test('locking a field sends its key, and unlocking it takes the key back', async () => {
    // rejects: a padlock that only toggles a class. THIS IS THE ONE THAT
    // MATTERS. The server builds the tool schema from this array, so a lock that
    // never leaves the browser is a lock that does nothing at all — and the
    // operator would not find out until a paragraph they wrote was gone.
    const posted = mockDraft(completeJob(DRAFT));
    render(<Host initial={SEEDED} />);
    openPanel();

    fireEvent.click(screen.getByTestId('toggle-audience'));
    pressDraft();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].locked).toEqual(['audience']);

    fireEvent.click(screen.getByTestId('toggle-audience'));
    pressDraft();
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].locked).toEqual([]);
  });

  test('the values the operator typed are what is sent as `current`', async () => {
    // rejects: sending the field NAMES and not their values. The description box
    // is the whole input — a request that says which fields exist but not what
    // the operator wrote has nothing to draft from.
    const posted = mockDraft(completeJob(DRAFT));
    render(<Host initial={SEEDED} />);
    openPanel();
    pressDraft();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].current.context).toBe(SEEDED.context);
    expect(posted[0].formId).toBe('scenario');
    expect(posted[0].hints).toEqual(['The operator asked for 3 categories.']);
  });

  test('a locked field is not written even if the response carries it anyway', async () => {
    // rejects: applying the response as it arrives because "the server already
    // stripped it". The browser talks to whatever Lambda is deployed; the lock
    // must hold against a stale one.
    mockDraft(completeJob({ ...DRAFT, context: 'Something else entirely, about a different company.' }));
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    fireEvent.click(screen.getByTestId('toggle-context'));
    pressDraft();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Filled in/));
    expect(latest.context).toBe(SEEDED.context);
    expect(screen.getByRole('status')).toHaveTextContent(/which you had locked. It was refused/);
  });
});

describe('2. the plan the panel shows before anything is spent', () => {
  test('each field is named as empty, yours, or locked', async () => {
    // rejects: a panel that says "the AI will improve your form" and nothing
    // more. The plan list is the only place the lock is visible as an EFFECT
    // rather than as an icon, and it is what makes the button safe to press.
    mockDraft(completeJob(DRAFT));
    render(<Host initial={SEEDED} />);
    openPanel();
    expect(screen.getByTestId('assist-plan-context')).toHaveTextContent(/will be refined/);
    expect(screen.getByTestId('assist-plan-audience')).toHaveTextContent(/will be filled in/);

    fireEvent.click(screen.getByTestId('toggle-audience'));
    expect(screen.getByTestId('assist-plan-audience')).toHaveTextContent(/left alone/);
  });

  test('an empty form disables the button and says which box to start with', async () => {
    // rejects: letting the model write the whole form from nothing. It invents a
    // session about a company that does not exist and the operator cannot tell
    // an invention from a proposal.
    mockDraft(completeJob(DRAFT));
    render(<Host />);
    openPanel();
    expect(screen.getByRole('button', { name: /Fill in the rest/i })).toBeDisabled();
    expect(screen.getByText(/Type something into/i)).toHaveTextContent('Context/Background');
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('locking every field disables the button too', async () => {
    // rejects: spending a generation whose entire output is discarded on arrival
    // by design.
    mockDraft(completeJob(DRAFT));
    render(<Host initial={SEEDED} />);
    openPanel();
    FORM.fields.forEach((f) => fireEvent.click(screen.getByTestId(`toggle-${f.key}`)));
    expect(screen.getByRole('button', { name: /Fill in the rest/i })).toBeDisabled();
    expect(screen.getByText(/Every field is locked/i)).toBeInTheDocument();
  });
});

describe('3. fill, refine and hold, on screen', () => {
  test('empty fields are filled in and the status names them', async () => {
    // rejects: applying the patch and saying nothing. Four boxes changing at
    // once with no account of what happened is indistinguishable from a bug.
    mockDraft(completeJob(DRAFT));
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Filled in/));
    expect(latest.customTitle).toBe(DRAFT.customTitle);
    expect(latest.audience).toBe(DRAFT.audience);
    expect(screen.getByRole('status')).toHaveTextContent('Question Set Title');
    expect(screen.getByTestId('assist-provenance')).toHaveTextContent(/AI wrote/);
  });

  test('a rewrite of the operator\'s own words is HELD, with both texts and a choice', async () => {
    // rejects: applying whatever comes back for a written field. The owner's
    // word is "refine"; a helper that discards their sentence and substitutes
    // its own is the wrong product, and nothing on screen would tell them what
    // their sentence had been.
    mockDraft(completeJob({ ...DRAFT, context: 'Explore cross-functional friction through workplace vignettes.' }));
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    const held = await screen.findByTestId('assist-held-context');
    expect(latest.context).toBe(SEEDED.context);
    expect(held).toHaveTextContent('nobody owns refunds');
    expect(held).toHaveTextContent('cross-functional friction');
    expect(within(held).getByRole('button', { name: /Use the AI/i })).toBeInTheDocument();
    expect(within(held).getByRole('button', { name: /Keep mine/i })).toBeInTheDocument();
  });

  test('"Keep mine" drops the draft and leaves the field exactly as it was', async () => {
    // rejects: a reject button that hides the panel but has already written the
    // value, or one that stores the draft to re-offer later.
    mockDraft(completeJob({ ...DRAFT, context: 'Explore cross-functional friction through workplace vignettes.' }));
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    const held = await screen.findByTestId('assist-held-context');
    fireEvent.click(within(held).getByRole('button', { name: /Keep mine/i }));
    await waitFor(() => expect(screen.queryByTestId('assist-held-context')).not.toBeInTheDocument());
    expect(latest.context).toBe(SEEDED.context);
  });

  test('"Use the AI\'s" writes it, and undo puts their exact words back', async () => {
    // rejects: an undo that re-runs the job, or one that restores a trimmed or
    // re-derived version of the original. Undo is what makes applying anything
    // automatically defensible; it has to be lossless.
    mockDraft(completeJob({ ...DRAFT, context: 'Explore cross-functional friction through workplace vignettes.' }));
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    const held = await screen.findByTestId('assist-held-context');
    fireEvent.click(within(held).getByRole('button', { name: /Use the AI/i }));
    await waitFor(() => expect(latest.context).toBe('Explore cross-functional friction through workplace vignettes.'));

    fireEvent.click(screen.getByTestId('assist-undo-context'));
    await waitFor(() => expect(latest.context).toBe(SEEDED.context));
  });

  test('a proposal is applied against the values it was BUILT from, not later edits', async () => {
    // rejects: reading `values` out of the closure at apply time. The operator
    // can keep typing while the job runs; applying against fields that moved
    // underneath would overwrite words the model never saw, and would measure
    // retention against the wrong text.
    let resolvePoll;
    const gate = new Promise((resolve) => { resolvePoll = resolve; });
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'POST') return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 1 });
      await gate;
      return jsonResponse(200, completeJob(DRAFT));
    });

    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    // The operator types an audience while the job is in flight.
    const audienceBox = screen.getByLabelText('Target Audience');
    fireEvent.change(audienceBox, { target: { value: 'Only the support leads' } });
    resolvePoll();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Filled in/));
    expect(latest.audience).toBe('Only the support leads');
    // Dropped, and said out loud — a proposal that vanishes with no account of
    // itself is indistinguishable from one that was never made.
    expect(screen.getByRole('status')).toHaveTextContent(/You changed Target Audience while this was running/);
    // The fields they did NOT touch still land.
    expect(latest.customTitle).toBe(DRAFT.customTitle);
  });

  test('a failed job changes nothing and says so', async () => {
    // rejects: branching on `items.length`. A FAILED job can carry partials, and
    // that is precisely how a partial failure used to render as a success in
    // every builder in this repo.
    mockDraft({
      jobId: 'job-1', status: 'error', phase: 'Failed', requested: 1, completed: 0,
      items: [DRAFT], warnings: [], error: 'Bedrock said no', createdSet: null,
    });
    let latest;
    render(<Host initial={SEEDED} onValues={(v) => { latest = v; }} />);
    openPanel();
    pressDraft();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Nothing was proposed/));
    expect(screen.getByRole('status')).toHaveTextContent(/Bedrock said no/);
    expect(latest.customTitle).toBe('');
  });
});

describe('4b. the classes the panel and the padlock hang their styling on', () => {
  /*
   * READ AS TEXT, NOT MEASURED. jsdom has no layout engine — it computes no
   * heights, does no overflow and returns zeroes from getBoundingClientRect —
   * so any assertion about how this LOOKS would pass unconditionally. Parsing
   * the stylesheet is the workaround this repo already uses
   * (modalReachability.test.js, questionSetsPalette.test.js), and the only claim
   * it can honestly make is the one made here: the hook exists.
   */
  const fs = require('fs');
  const path = require('path');
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  test.each([
    '.field-lock',
    '.field-lock.is-locked',
    '.field-lock:focus-visible',
    '.label-row',
    '.form-assist-body',
    '.form-assist-held',
  ])('%s is styled, not just emitted', (selector) => {
    // rejects: adding a class in the JSX and never styling it. `is-locked` in
    // particular is the ONLY hook the locked state has in the stylesheet — the
    // shape change is in the icon, everything else about it is these rules — so
    // an unstyled one leaves a locked field looking exactly like an unlocked one.
    expect(CSS).toContain(`${selector} {`);
  });
});

describe('4. the padlocks in the real builder', () => {
  /** Open AIScenarioBuilder and walk to the configuration step. */
  async function openBuilder() {
    mockDraft(completeJob(DRAFT), { prompts: [] });
    render(<AIScenarioBuilder onClose={() => {}} onScenariosGenerated={() => {}} engagementType="call-and-answer" />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    // The custom card is withheld from the folded deck — the blank-canvas
    // continue button is that route now.
    fireEvent.click(screen.getByTestId('scenario-continue-blank'));
    await screen.findByText(/Configure Your Scenarios/i);
  }

  test('every drafted field carries a padlock, and only those', async () => {
    // rejects: wiring the panel in and forgetting the icons the owner actually
    // asked for — "a small icon lock/unlock on cells" — or drawing one beside a
    // field the request does not carry, which promises a guarantee nothing
    // enforces.
    await openBuilder();
    for (const field of FORM.fields) {
      expect(screen.getByTestId(`field-lock-${field.key}`)).toBeInTheDocument();
    }
    // The enums are deliberately not drafted, so they get no padlock.
    expect(screen.queryByTestId('field-lock-difficulty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-lock-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-lock-roundKind')).not.toBeInTheDocument();
  });

  test('the padlock announces itself as a two-state control naming its field', async () => {
    // rejects: an icon-only button. There are five on this form, so "Lock" five
    // times over is unusable, and `aria-pressed` is the only thing that tells a
    // screen reader this toggles rather than acts.
    await openBuilder();
    const lock = screen.getByTestId('field-lock-context');
    expect(lock).toHaveAttribute('aria-pressed', 'false');
    expect(lock).toHaveAccessibleName(/Context\/Background is unlocked/i);
    fireEvent.click(lock);
    expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(lock).toHaveAccessibleName(/Context\/Background is locked/i);
  });

  test('the padlock changes shape, not only colour, when it is locked', async () => {
    // rejects: rendering the same icon in both states and leaning on colour to
    // carry the difference. Found by mutation — pinning the icon to `Lock` left
    // every other test green, because `aria-pressed` and the accessible name
    // were still correct. The owner asked for "a small icon lock/unlock"; a
    // padlock that never opens is not that, and colour alone fails anyone who
    // cannot see it. Comparing the rendered SVG is the only non-geometric way to
    // assert this — jsdom has no layout engine, so anything about how it LOOKS
    // would pass unconditionally.
    await openBuilder();
    const lock = screen.getByTestId('field-lock-context');
    const unlockedGlyph = lock.querySelector('svg').innerHTML;
    expect(unlockedGlyph.length).toBeGreaterThan(0);
    fireEvent.click(lock);
    expect(lock.querySelector('svg').innerHTML).not.toBe(unlockedGlyph);
  });

  test('the padlock carries the class its locked styling hangs off', async () => {
    // rejects: dropping `is-locked`. It is the only hook the stylesheet has for
    // the filled state, so without it a locked field looks exactly like an
    // unlocked one to anyone scanning the form rather than reading each control.
    await openBuilder();
    const lock = screen.getByTestId('field-lock-audience');
    expect(lock.className).not.toMatch(/is-locked/);
    fireEvent.click(lock);
    expect(lock.className).toMatch(/is-locked/);
  });

  test('a lock set in the builder travels on the builder\'s drafting request', async () => {
    // rejects: the panel keeping its own lock state separate from the padlocks
    // beside the inputs. Two sources of truth for one guarantee is the same as
    // none.
    const posted = mockDraft(completeJob(DRAFT));
    render(<AIScenarioBuilder onClose={() => {}} onScenariosGenerated={() => {}} engagementType="call-and-answer" />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    // The custom card is withheld from the folded deck — the blank-canvas
    // continue button is that route now.
    fireEvent.click(screen.getByTestId('scenario-continue-blank'));
    await screen.findByText(/Configure Your Scenarios/i);

    fireEvent.change(screen.getByPlaceholderText(/Describe the context, industry/i), {
      target: { value: 'Refund ownership disputes at BillingCo.' },
    });
    fireEvent.click(screen.getByTestId('field-lock-customTitle'));
    openPanel();
    pressDraft();

    await waitFor(() => expect(posted.filter((p) => p.formId)).toHaveLength(1));
    const draftRequest = posted.find((p) => p.formId === 'scenario');
    expect(draftRequest.locked).toEqual(['customTitle']);
    expect(draftRequest.current.context).toBe('Refund ownership disputes at BillingCo.');
  });
});

/*
 * ALL THREE BUILDERS, NOT JUST THE ONE.
 *
 * Added after mutation testing: pointing the trivia builder's panel at an empty
 * lock set, and the poll builder's padlock labels at the wrong form, left every
 * test in this file green. The scenario builder was the only one actually
 * driven, so two thirds of the feature were asserted by resemblance.
 *
 * Each builder is mounted for real and each one is asked the two questions that
 * matter: does every field it drafts carry a padlock, and does locking one reach
 * the request body.
 */
describe('5. every builder, wired the same way', () => {
  const BUILDERS = [
    {
      name: 'trivia',
      form: BUILDER_FORM_FIELDS.trivia,
      seedPlaceholder: /e\.g\., American History/i,
      render: () => render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />),
    },
    {
      name: 'poll',
      form: BUILDER_FORM_FIELDS.poll,
      seedPlaceholder: /e\.g\., Team Preferences/i,
      render: () => render(<PollAIBuilder onClose={() => {}} onPollGenerated={() => {}} />),
    },
  ];

  test.each(BUILDERS)('$name: every field it drafts carries a padlock', async ({ form, render: mount }) => {
    // rejects: wiring the panel into one builder and stopping. The owner asked
    // for this on the forms, plural, and a padlock missing from one of them is a
    // field that silently cannot be protected.
    mockDraft(completeJob({}));
    mount();
    for (const field of form.fields) {
      expect(screen.getByTestId(`field-lock-${field.key}`)).toBeInTheDocument();
    }
  });

  test.each(BUILDERS)('$name: the padlock names ITS OWN form\'s field', async ({ form, render: mount }) => {
    // rejects: pointing a builder's label lookup at another form's field list.
    // The keys overlap between the three, so a wrong list still renders — it just
    // calls the field by the wrong name, in the accessible name a screen reader
    // reads out and in the status line afterwards.
    mockDraft(completeJob({}));
    mount();
    for (const field of form.fields) {
      expect(screen.getByTestId(`field-lock-${field.key}`))
        .toHaveAccessibleName(new RegExp(`^${field.label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is`, 'i'));
    }
  });

  test.each(BUILDERS)('$name: a lock set on the form travels on the drafting request', async ({ form, seedPlaceholder, render: mount }) => {
    // rejects: the panel holding a lock set of its own, separate from the
    // padlocks beside the inputs. Two sources of truth for one guarantee is the
    // same as none — and this is the mutation that survived until this test
    // existed.
    const posted = mockDraft(completeJob({ audience: 'Somebody' }));
    mount();
    fireEvent.change(screen.getByPlaceholderText(seedPlaceholder), {
      target: { value: 'Refund ownership disputes at BillingCo.' },
    });
    fireEvent.click(screen.getByTestId('field-lock-audience'));
    openPanel();
    pressDraft();

    await waitFor(() => expect(posted.filter((p) => p.formId)).toHaveLength(1));
    const request = posted.find((p) => p.formId);
    expect(request.formId).toBe(form.formId);
    expect(request.locked).toEqual(['audience']);
    expect(request.current[form.seed]).toBe('Refund ownership disputes at BillingCo.');
  });
});
