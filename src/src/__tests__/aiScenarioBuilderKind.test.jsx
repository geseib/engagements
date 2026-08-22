/**
 * TOPIC AND DIRECTION ARE TWO CONTROLS — components/AIScenarioBuilder.jsx.
 *
 * The owner's report: *"if someone is creating a call and answer based on a
 * improve idea, but currently the question set generator prompt has direction
 * like improve, you get a confusing question set."*
 *
 * The narrow cause, and it is one hardcoded object in this file:
 * `generateCustomInstructions()` built the set-level participant instruction
 * from a map keyed on the SCENARIO TYPE, falling back for every type outside
 * its six keys — which is every database prompt and every "something else" — to
 *
 *     'Engage thoughtfully with each scenario and share your experiences
 *      and insights.'
 *
 * upload-questions.js stamps that onto every question with no instruction of
 * its own, and the room reads it during ASK. An Apply round therefore told
 * people to draw on their own experience about a passage they had just been
 * handed. The set was confusing because the instruction and the questions were
 * answering different questions.
 *
 * So the two properties this file exists for:
 *   1. changing the DIRECTION changes the participant instruction;
 *   2. changing only the TOPIC does not.
 *
 * Rendered, not source-asserted, because both properties are about what the
 * component actually sends. Only `../auth/authFetch` is mocked — this builder
 * does not use useAuth, so AuthContext is untouched and AuthProvider is never
 * wrapped (the recipe generationJobResume.test.jsx establishes).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;
const { ROUND_KINDS } = require('../config/roundKinds');


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
  tags: ['alpha', 'beta', 'gamma'],
}));

/**
 * Route by method + URL, with the POST body captured.
 *
 * An unmatched request throws rather than hanging, so a wiring mistake shows up
 * as a failure and not a timeout.
 */
function mockApi({ prompts = [], job } = {}) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('admin/ai-prompts')) {
      return jsonResponse(200, { prompts });
    }
    if (method === 'POST' && url.includes('admin/ai-generate-scenarios')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 5 });
    }
    if (method === 'GET' && url.includes('admin/ai-generate-scenarios/job-1')) {
      return jsonResponse(200, job);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

const completeJob = (n = 2) => ({
  jobId: 'job-1',
  status: 'complete',
  phase: `Generated ${n} of ${n}`,
  requested: n,
  completed: n,
  items: scenarioItems(n),
  warnings: [],
  meta: null,
  error: null,
  updatedAt: '2026-08-12T10:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** Open the builder on step 1, with the prompt list already settled. */
async function open(props = {}) {
  const posted = mockApi(props.api || {});
  const onScenariosGenerated = jest.fn();
  const view = render(
    <AIScenarioBuilder
      onClose={() => {}}
      onScenariosGenerated={onScenariosGenerated}
      engagementType={props.engagementType || 'call-and-answer'}
    />
  );
  await waitFor(() => expect(authFetch).toHaveBeenCalled());
  return { posted, onScenariosGenerated, unmount: view.unmount };
}

describe('the direction is a control of its own, beside the topic', () => {
  test('a call-and-answer builder asks what the room will DO before what it is about', async () => {
    // rejects: leaving the topic cards as the only steering. Every built-in
    // topic is reflection-shaped, so an operator who wanted "here is somebody
    // else's material, land it here" had one lever and it moved the wrong axis.
    await open();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Apply/i })).toBeInTheDocument();
    expect(screen.getByText(/This is the direction, not the subject/i)).toBeInTheDocument();
  });

  test('a wavelength builder shows no direction picker at all', async () => {
    // rejects: applying a round kind to a game that hands the room a bare
    // subject and asks for word associations. "Invention" and "verdict" mean
    // nothing there, and a direction written for discussion rounds reaching a
    // wavelength prompt would be a NEW way to confuse a generator.
    await open({ engagementType: 'wavelength' });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});

describe('the direction reaches the generator', () => {
  test('picking Apply sends roundKind on the generation request', async () => {
    // rejects: a picker that changes only the local instruction. The backend
    // puts the direction IN FRONT OF the topic's basePrompt, which is the half
    // of the fix that changes the questions themselves.
    const { posted } = await open({ api: { job: completeJob() } });

    fireEvent.click(screen.getByRole('radio', { name: /Apply/i }));
    fireEvent.click(screen.getByText('Lessons Learned Scenarios'));
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].roundKind).toBe('apply');
    expect(posted[0].scenarioType).toBe('lessons-learned');
  });

  test('with no choice made the request carries produce, not nothing', async () => {
    // rejects: sending undefined and relying on the backend's default. The
    // default IS produce, but a request that states it is a request that can be
    // read back in a log; a silent omission cannot.
    const { posted } = await open({ api: { job: completeJob() } });

    fireEvent.click(screen.getByText('Lessons Learned Scenarios'));
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].roundKind).toBe('produce');
  });
});

describe('the participant instruction follows the KIND and not the topic', () => {
  /**
   * Drive the whole flow and return what the builder handed the page.
   *
   * UNMOUNTS before returning. Two of the tests below run this twice to compare
   * one variable across two runs, and a second builder rendered on top of the
   * first gives every query two matches — which reads as a broken selector
   * rather than as the two-builder mistake it actually is.
   */
  async function generateWith({ kind, topic }) {
    const { posted, onScenariosGenerated, unmount } = await open({ api: { job: completeJob() } });
    if (kind) fireEvent.click(screen.getByRole('radio', { name: new RegExp(kind, 'i') }));
    fireEvent.click(screen.getByText(topic));
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: /Load .* into System/i }));
    await waitFor(() => expect(onScenariosGenerated).toHaveBeenCalled());
    const payload = onScenariosGenerated.mock.calls[0][0];
    unmount();
    return payload;
  }

  test('an Apply round tells the room the material is not theirs', async () => {
    // rejects: THE REPORTED DEFECT. The old map keyed on scenario type gave a
    // lessons-learned Apply round "Share specific experiences and focus on what
    // was learned" — an instruction about the room's own memory, printed under
    // a question about somebody else's document.
    const payload = await generateWith({ kind: 'Apply', topic: 'Lessons Learned Scenarios' });
    expect(payload.metadata.customInstructions).toContain(ROUND_KINDS.apply.participantInstruction);
    expect(payload.metadata.customInstructions).not.toMatch(/your own experience/i);
  });

  test('changing ONLY the topic leaves the instruction where it was', async () => {
    // rejects: re-keying the instruction map on scenario type in any form. Two
    // different topics under one direction must produce one instruction — that
    // is what "topic and direction are orthogonal" means in practice.
    const a = await generateWith({ kind: 'Judge', topic: 'Lessons Learned Scenarios' });
    const b = await generateWith({ kind: 'Judge', topic: 'Team Building Exercises' });
    expect(a.metadata.customInstructions).toBe(b.metadata.customInstructions);
    expect(a.metadata.customInstructions).toContain(ROUND_KINDS.judge.participantInstruction);
  });

  test('changing ONLY the kind changes the instruction', async () => {
    // rejects: a picker wired to the prompt but not to the instruction, which
    // would leave the questions Apply-shaped and the on-screen instruction
    // Produce-shaped — the same mismatch, arrived at from the other side.
    const produce = await generateWith({ topic: 'Lessons Learned Scenarios' });
    const improve = await generateWith({ kind: 'Improve', topic: 'Lessons Learned Scenarios' });
    expect(produce.metadata.customInstructions).not.toBe(improve.metadata.customInstructions);
    expect(improve.metadata.customInstructions).toContain(ROUND_KINDS.improve.participantInstruction);
  });

  test('the direction travels with the set, not only with the generation', async () => {
    // rejects: steering the generator and then forgetting. Without this the
    // SETS row would read as Produce for a set generated as Judge, and the
    // editor, the library and every later regeneration would believe it.
    const payload = await generateWith({ kind: 'Judge', topic: 'Lessons Learned Scenarios' });
    expect(payload.roundKind).toBe('judge');
  });
});

describe('the generic fallback is gone', () => {
  test('a topic with no entry anywhere still gets a real instruction', async () => {
    // rejects: restoring `|| 'Engage thoughtfully with each scenario and share
    // your experiences and insights.'`. That line was the default for EVERY
    // database prompt in the product, which is most of them.
    const { posted, onScenariosGenerated } = await open({
      api: {
        job: completeJob(),
        prompts: [{
          SK: 'AIPROMPT#gen-call-and-answer-onboarding',
          name: 'Onboarding Deep Dive',
          description: 'A database prompt with no hardcoded twin',
          basePrompt: 'Create onboarding scenarios',
          scenarioType: 'onboarding',
        }],
      },
    });

    fireEvent.click(screen.getByRole('radio', { name: /Apply/i }));
    fireEvent.click(await screen.findByText('Onboarding Deep Dive'));
    fireEvent.click(await screen.findByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: /Load .* into System/i }));
    await waitFor(() => expect(onScenariosGenerated).toHaveBeenCalled());

    const instruction = onScenariosGenerated.mock.calls[0][0].metadata.customInstructions;
    expect(instruction).not.toMatch(/share your experiences and insights/i);
    expect(instruction).toBe(ROUND_KINDS.apply.participantInstruction);
  });
});

describe('an incomplete custom direction cannot leave step 1', () => {
  test('the topic cards do not advance until the brief and the instruction exist', async () => {
    // rejects: letting an empty custom direction through. The picker does not
    // exist on step 2, so an operator who advanced with a hole in the direction
    // could not fix it without starting over — and the generator would get a
    // prompt with nothing where the direction should be.
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    fireEvent.click(screen.getByText('Lessons Learned Scenarios'));
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/What should this round do/i), {
      target: { value: 'Hand them two proposals and ask which they would fund.' },
    });
    fireEvent.change(screen.getByLabelText(/What is the room told/i), {
      target: { value: 'Pick one and say what you would cut to pay for it.' },
    });
    fireEvent.click(screen.getByText('Lessons Learned Scenarios'));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});

/**
 * THE SAMPLE IDEAS ANSWER THE DIRECTION — the owner, on the old step 1:
 * "it has these cards that say what kind of scenario do you want to build.
 * those seem odd after you pick produce/apply/improve/etc... these could be
 * sample idea, so they understand." Two taxonomies became one question and
 * three concrete briefs that switch with the kind.
 */
describe('sample ideas follow the chosen direction', () => {
  test('call-and-answer leads with samples for the current kind, templates demoted to "Or"', async () => {
    await open();
    expect(screen.getByTestId('scenario-samples')).toBeInTheDocument();
    expect(screen.getByText('Hard-won lessons')).toBeInTheDocument();
    expect(screen.getByText('Or start from a template')).toBeInTheDocument();
  });

  test('switching the kind switches the samples', async () => {
    // rejects: cards that ignore the choice just made — the exact confusion
    // reported.
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Apply/i }));
    expect(screen.getByText('A case, landed on us')).toBeInTheDocument();
    expect(screen.queryByText('Hard-won lessons')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Judge/i }));
    expect(screen.getByText('Ready or not')).toBeInTheDocument();
  });

  test('tapping a sample prefills the next step and stays editable', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Apply/i }));
    fireEvent.click(screen.getByText('A case, landed on us'));
    // Step 2, with the sample's brief already in the context field.
    const context = screen.getByDisplayValue(/land it on OUR situation/i);
    expect(context.tagName).toBe('TEXTAREA');
    fireEvent.change(context, { target: { value: 'my own words' } });
    expect(screen.getByDisplayValue('my own words')).toBeInTheDocument();
  });

  test('the custom direction gets no samples — its author already said what they want', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    expect(screen.queryByTestId('scenario-samples')).not.toBeInTheDocument();
    // And no orphaned "Or" with nothing above it.
    expect(screen.getByText('Start from a template')).toBeInTheDocument();
    expect(screen.queryByText('Or start from a template')).not.toBeInTheDocument();
  });

  test('types with no direction picker keep their template cards as the question', async () => {
    await open({ engagementType: 'trivia' });
    expect(screen.queryByTestId('scenario-samples')).not.toBeInTheDocument();
    expect(screen.getByText(/What type of trivia questions do you want to create/i)).toBeInTheDocument();
  });
});
