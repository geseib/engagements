/**
 * 6a — CLOSING AN "ADD QUESTIONS" BUILDER ON ITS REVIEW SCREEN THROWS AWAY
 * PAID AI OUTPUT.
 *
 * In append mode the worker never creates a set (appendOnly: true) — the
 * generated items live only in this component's state until "Add N to …" is
 * pressed. Before this fix the scrim, the X and the review screen's Cancel
 * all called onClose directly, so closing lost a paid generation for good,
 * and reopening (autoStart) started a fresh job that overwrote the one
 * remembered in storage.
 *
 * The fix asks, in plain words, before that happens — but only when there is
 * something to lose: making a new set, or a review with nothing left to add,
 * closes exactly as it always did.
 *
 * Recipe: only `../auth/authFetch` is mocked, following
 * generationJobResume.test.jsx / generatedSetHandoff.test.jsx / batchGuidance.test.jsx.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;
const PollAIBuilder = require('../components/PollAIBuilder').default;
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Adding to an existing set — the shape components/AddQuestionsDialog.jsx builds. */
const appendTo = (overrides = {}) => ({
  setName: 'Historic Figures',
  mode: 'existing',
  categories: ['Presidents', 'Generals'],
  brief: { topic: 'Historic figures', audience: 'Adults', difficulty: 'medium', context: 'Historic figures', roundKind: 'produce' },
  existingTotal: 10,
  onModeChange: () => {},
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('TriviaAIBuilder: closing the review screen while adding', () => {
  const triviaItems = (n) => Array.from({ length: n }, (_, i) => ({
    title: `Question ${i + 1}`, questionDetail: `Detail ${i + 1}`, category: 'Presidents', difficulty: 'medium',
    optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: [],
  }));

  function mockApi(items) {
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'POST' && url.includes('admin/ai-generate-trivia')) {
        return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: items.length });
      }
      if (method === 'GET' && url.includes('admin/ai-generate-trivia/job-1')) {
        return jsonResponse(200, {
          jobId: 'job-1', status: 'complete', phase: '', requested: items.length, completed: items.length,
          items, warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
          updatedAt: '2026-09-26T10:00:00.000Z',
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
  }

  async function toReview() {
    mockApi(triviaItems(2));
    const onClose = jest.fn();
    const onTriviaGenerated = jest.fn();
    const utils = render(<TriviaAIBuilder appendTo={appendTo()} onClose={onClose} onTriviaGenerated={onTriviaGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));
    await screen.findByRole('button', { name: /Add 2 to/ });
    return { ...utils, onClose, onTriviaGenerated };
  }

  test('declining the confirm keeps the builder open', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('accepting the confirm closes it', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(container.querySelector('.close-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the scrim and the review Cancel button ask too — one shared close path', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(container.querySelector('.modal-overlay'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    window.confirm.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('with nothing generated yet, closing asks nothing', () => {
    mockApi([]);
    const onClose = jest.fn();
    const { container } = render(<TriviaAIBuilder appendTo={appendTo()} onClose={onClose} onTriviaGenerated={() => {}} />);
    jest.spyOn(window, 'confirm');
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('with every generated question left out, closing asks nothing', async () => {
    const { container } = await toReview();
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[1].querySelector('.git-ghost'));
    fireEvent.click(rows[2].querySelector('.git-ghost'));
    jest.spyOn(window, 'confirm');
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  test('making a NEW set (no appendTo) never asks, even mid-review', async () => {
    mockApi(triviaItems(2));
    const onClose = jest.fn();
    const { container } = render(<TriviaAIBuilder onClose={onClose} onTriviaGenerated={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/American History/i), { target: { value: 'Topic' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));
    await screen.findByRole('button', { name: /Load 2 into System/ });
    jest.spyOn(window, 'confirm');
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PollAIBuilder: closing the review screen while adding', () => {
  const pollItems = (n) => Array.from({ length: n }, (_, i) => ({
    title: `Poll ${i + 1}`, category: 'Presidents', options: ['A', 'B'], allowMultiple: false, tags: [],
  }));

  function mockApi(items) {
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'POST' && url.includes('admin/ai-generate-polls')) {
        return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: items.length });
      }
      if (method === 'GET' && url.includes('admin/ai-generate-polls/job-1')) {
        return jsonResponse(200, {
          jobId: 'job-1', status: 'complete', phase: '', requested: items.length, completed: items.length,
          items, warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
          updatedAt: '2026-09-26T10:00:00.000Z',
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
  }

  async function toReview() {
    mockApi(pollItems(2));
    const onClose = jest.fn();
    const onPollGenerated = jest.fn();
    const utils = render(<PollAIBuilder appendTo={appendTo()} onClose={onClose} onPollGenerated={onPollGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Poll Questions/ }));
    await screen.findByRole('button', { name: /Add 2 to/ });
    return { ...utils, onClose, onPollGenerated };
  }

  test('declining the confirm keeps the builder open', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('accepting the confirm closes it', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(container.querySelector('.close-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('with nothing generated yet, closing asks nothing', () => {
    mockApi([]);
    const onClose = jest.fn();
    const { container } = render(<PollAIBuilder appendTo={appendTo()} onClose={onClose} onPollGenerated={() => {}} />);
    jest.spyOn(window, 'confirm');
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AIScenarioBuilder: closing the review screen while adding', () => {
  const scenarioItems = (n) => Array.from({ length: n }, (_, i) => ({
    title: `Scenario ${i + 1}`, category: 'Presidents', detail: `Detail ${i + 1}`, customInstructions: '', tags: [],
  }));

  function mockApi(items) {
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
      if (method === 'POST' && url.includes('admin/ai-generate-scenarios')) {
        return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: items.length });
      }
      if (method === 'GET' && url.includes('admin/ai-generate-scenarios/job-1')) {
        return jsonResponse(200, {
          jobId: 'job-1', status: 'complete', phase: '', requested: items.length, completed: items.length,
          items, warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
          updatedAt: '2026-09-26T10:00:00.000Z',
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
  }

  async function toReview() {
    mockApi(scenarioItems(2));
    const onClose = jest.fn();
    const onScenariosGenerated = jest.fn();
    const utils = render(
      <AIScenarioBuilder
        appendTo={appendTo()}
        engagementType="call-and-answer"
        onClose={onClose}
        onScenariosGenerated={onScenariosGenerated}
      />
    );
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    const disclosure = screen.queryByTestId('template-disclosure');
    if (disclosure) fireEvent.click(disclosure);
    fireEvent.click(await screen.findByTestId('scenario-continue-blank'));
    fireEvent.click(await screen.findByRole('button', { name: /Generate Scenarios/ }));
    await screen.findByRole('button', { name: /Add 2 to/ });
    return { ...utils, onClose, onScenariosGenerated };
  }

  test('declining the confirm keeps the builder open', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('accepting the confirm closes it', async () => {
    const { container, onClose } = await toReview();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(container.querySelector('.close-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('with nothing generated yet, closing asks nothing', async () => {
    mockApi([]);
    const onClose = jest.fn();
    const { container } = render(
      <AIScenarioBuilder appendTo={appendTo()} engagementType="call-and-answer" onClose={onClose} onScenariosGenerated={() => {}} />
    );
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    jest.spyOn(window, 'confirm');
    fireEvent.click(container.querySelector('.close-button'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
