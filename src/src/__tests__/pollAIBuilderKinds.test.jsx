/**
 * PollAIBuilder — TYPED POLLS, from the form to the hand-over.
 *
 * The owner, 27 Sep 2026: polls "should have all the same question mechanisms:
 * rate, pick from a few choices, binary … and then open ended", and the defect
 * that made it concrete was a generated poll "that didn't give options but open
 * text box". So the builder asks which kinds to write (it used to offer only
 * "Allow multiple selections"), the review shows each question's kind and what
 * the room will see, and the edit view is the set editor's own question form.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PollAIBuilder from '../components/PollAIBuilder';

jest.mock('../utils/aiBatchClient', () => ({
  startGenerationJob: jest.fn(),
  pollGenerationJob: jest.fn(),
}));

const { startGenerationJob, pollGenerationJob } = require('../utils/aiBatchClient');

const POLLS = [
  {
    kind: 'choice', title: 'Which release cadence suits us', category: 'Delivery',
    options: ['Weekly', 'Fortnightly', 'Monthly'], allowMultiple: false, required: false, tags: ['delivery'],
  },
  {
    kind: 'yesno', title: 'Adopt the new review rule', category: 'Process',
    yesLabel: 'Approve', noLabel: 'Decline', unsure: false, followUpWhen: '', required: false, tags: [],
  },
  {
    kind: 'rating', title: 'How ready is the launch', category: 'Delivery',
    scale: '1-5', lowLabel: 'Not ready', highLabel: 'Ready today', required: false, tags: [],
  },
];

/** The exact shape jobToResponse() sends (see pollCsvImportContract.test.jsx for why `status` matters). */
function completeJob(items) {
  startGenerationJob.mockResolvedValue({ jobId: 'job-1', status: 'queued', requested: items.length });
  pollGenerationJob.mockResolvedValue({
    jobId: 'job-1', status: 'complete', phase: '', requested: items.length, completed: items.length,
    items, warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
    updatedAt: '2026-09-27T00:00:00.000Z',
  });
}

function renderBuilder(props = {}) {
  const onPollGenerated = jest.fn();
  const utils = render(<PollAIBuilder onClose={() => {}} onPollGenerated={onPollGenerated} {...props} />);
  return { ...utils, onPollGenerated };
}

const kindToggles = () => within(screen.getByRole('group', { name: 'Kinds of poll question' })).getAllByRole('button');

async function toReview(items = POLLS) {
  completeJob(items);
  const utils = renderBuilder();
  fireEvent.change(screen.getByPlaceholderText(/Team Preferences/i), { target: { value: 'Release process' } });
  fireEvent.click(screen.getByRole('button', { name: /Generate Poll Questions/i }));
  await screen.findByRole('button', { name: /Export CSV/i });
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('the form asks which kinds of poll question to write', () => {
  test('four kinds, named for the host, all on to start with; the old checkbox is gone', () => {
    renderBuilder();
    expect(kindToggles().map((b) => b.textContent.replace('✓', '').trim()))
      .toEqual(['Pick from choices', 'Rate', 'Yes / No', 'Open answer']);
    kindToggles().forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'true'));
    // rejects: keeping "Allow multiple selections" beside the kinds, the one
    // say a host used to have over what a poll asked for.
    expect(screen.queryByLabelText(/Allow multiple selections/i)).toBeNull();
  });

  test('the kinds travel as `kinds`, in the contract order, and allowMultiple no longer does', async () => {
    completeJob(POLLS);
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: /Open answer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pick from choices/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pick from choices/ }));   // back on: order is the contract's
    fireEvent.change(screen.getByPlaceholderText(/Team Preferences/i), { target: { value: 'Release process' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Poll Questions/i }));
    await screen.findByRole('button', { name: /Export CSV/i });

    const body = startGenerationJob.mock.calls[0][1];
    expect(body.kinds).toEqual(['choice', 'rating', 'yesno']);
    expect(body).not.toHaveProperty('allowMultiple');
  });

  test('the last kind ticked stays ticked', () => {
    renderBuilder();
    ['Pick from choices', 'Rate', 'Yes / No', 'Open answer'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label.replace('/', '\\/')) }));
    });
    expect(kindToggles().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  test('the set\'s participant instruction is the mechanic for these kinds, not "select your preferred option"', async () => {
    completeJob(POLLS);
    renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: /Open answer/ }));
    fireEvent.change(screen.getByPlaceholderText(/Team Preferences/i), { target: { value: 'Release process' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Poll Questions/i }));
    await screen.findByRole('button', { name: /Export CSV/i });

    const { setMetadata } = startGenerationJob.mock.calls[0][1];
    expect(setMetadata.customInstructions).toMatch(/^Answer each question as it comes up — pick an option, rate it or answer yes or no/);
    expect(setMetadata.customInstructions).not.toMatch(/preferred option/);
    // The shape "Add questions" reads the brief back from (appendMode.briefFromSet).
    expect(setMetadata.aiContextInstructions).toMatch(/^These are medium-level instant-feedback poll questions about Release process\./);
  });
});

describe('the review shows each question\'s kind and what the room will see', () => {
  test('a Kind column of the four poll kinds, and the options, labels and scale in words', async () => {
    await toReview();
    expect(screen.getByRole('combobox', { name: 'Kind of poll question 1' })).toHaveValue('choice');
    expect(screen.getByRole('combobox', { name: 'Kind of poll question 2' })).toHaveValue('yesno');
    const kinds = within(screen.getByRole('combobox', { name: 'Kind of poll question 3' })).getAllByRole('option');
    expect(kinds.map((o) => o.value)).toEqual(['choice', 'rating', 'yesno', 'text']);

    expect(screen.getByText('Weekly · Fortnightly · Monthly')).toBeInTheDocument();
    expect(screen.getByText('Approve / Decline')).toBeInTheDocument();
    expect(screen.getByText('1–5 · Not ready → Ready today')).toBeInTheDocument();
  });

  test('a choice left without options is flagged and holds back the load, in the importer\'s words', async () => {
    await toReview([...POLLS.slice(0, 2), { ...POLLS[0], title: 'Too thin', options: ['Only one'] }]);
    expect(screen.getByText('needs at least two options')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load 3 into System/ })).toBeDisabled();
  });

  test('switching a kind in the table asks before it throws the options away', async () => {
    await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of poll question 1' }), { target: { value: 'rating' } });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Make question 1 Rate\? It would lose 3 options/));
    expect(screen.getByRole('combobox', { name: 'Kind of poll question 1' })).toHaveValue('choice');
  });
});

describe('editing a poll uses the set editor\'s question form', () => {
  async function openEditor(index = 1) {
    const utils = await toReview();
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/ })[index]);
    return utils;
  }

  test('the kind\'s own fields are there, on the editor\'s dusk card, and edits reach the hand-over', async () => {
    const { container, onPollGenerated } = await openEditor(1);
    const card = container.querySelector('.pab-edit');
    expect(card).toHaveAttribute('data-theme', 'dark');
    expect(card).toHaveClass('qs-editor');

    fireEvent.change(screen.getByLabelText('Yes reads'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: /Back to all 3 poll questions/ }));
    fireEvent.click(screen.getByRole('button', { name: /Load 3 into System/ }));

    const { questions } = onPollGenerated.mock.calls[0][0];
    expect(questions[1]).toMatchObject({ kind: 'yesno', yesLabel: 'Ship it', noLabel: 'Decline' });
  });

  test('Ranking is not offered: the form shows the four poll kinds only, and the poll keeps its kind', async () => {
    await openEditor(1);
    // The question form's `kinds` prop (SurveyQuestionFields) limits it to
    // POLL_KINDS, so a ranking cannot even be picked.
    expect(screen.queryByRole('button', { name: /Ranking/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Yes \/ No/, pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Yes reads')).toHaveValue('Approve');
  });

  test('switching to a choice in the form leaves it flagged until it has its options', async () => {
    await openEditor(2);
    fireEvent.click(screen.getByRole('button', { name: /Multiple choice/ }));
    const confirmSwitch = screen.queryByRole('button', { name: /Switch and lose/ });
    if (confirmSwitch) fireEvent.click(confirmSwitch);
    expect(screen.getByText(/Can’t be loaded yet: needs at least two options/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'Not yet' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'Ship it' } });
    expect(screen.queryByText(/Can’t be loaded yet/)).toBeNull();
  });
});
