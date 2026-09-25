/**
 * GUIDANCE FOR THE FIRST BATCH — the Add questions dialog, end to end.
 *
 * "Write N more" opens the builder ALREADY GENERATING, so a guidance box that
 * lives only in the builder's form is reached after one paid generation has
 * run without it. The owner approved "a box in the Add Questions flow" so that
 * the guidance steers the FIRST batch; the dialog therefore carries the box
 * too, beside the "Write N more" choice, and hands its text to the builder.
 *
 * Pinned here:
 *   - the dialog shows the box only for the builders that send guidance
 *     (trivia, and the call-and-answer builder, which also serves wavelength) —
 *     not for polls, whose builder does not, and not for surveys, which Workie
 *     does not write;
 *   - typed guidance rides in the plan handed to the builder; a blank box adds
 *     nothing to it;
 *   - THROUGH THE REAL PANEL: Add questions → type → Write → the builder's very
 *     first request carries `batchGuidance`, the review quotes it, and the
 *     builder's own box holds the same text for a regenerate.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const AddQuestionsDialog = require('../components/AddQuestionsDialog').default;
const QuestionsPanel = require('../components/QuestionsPanel').default;
const { toRow } = require('../utils/questionRows');

const LABEL = 'Guidance for these questions (optional)';
const GW = 'Include George Washington in at least one question';

const rows = [toRow({ Category: 'Presidents', Title: 'a' }), toRow({ Category: 'Generals', Title: 'b' })];

const drawDialog = (props = {}) => {
  const onOpenBuilder = jest.fn();
  render(
    <AddQuestionsDialog
      setName="Historic Figures"
      engagementType="trivia"
      categories={['Presidents', 'Generals']}
      counts={new Map([['Presidents', 1], ['Generals', 1]])}
      currentRows={rows}
      onClose={() => {}}
      onOpenBuilder={onOpenBuilder}
      onWriteOne={() => {}}
      onAddRows={() => {}}
      {...props}
    />
  );
  return onOpenBuilder;
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.API_BASE = 'https://api.test/';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('the Add questions dialog carries the box', () => {
  test.each(['trivia', 'call-and-answer', 'wavelength'])('%s: shown, labelled, capped at 500, with its hint', (engagementType) => {
    drawDialog({ engagementType });
    const box = screen.getByLabelText(LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('maxLength', '500');
    expect(box.getAttribute('placeholder')).toMatch(/George Washington/);
    expect(screen.getByText('Applies to this batch only.')).toBeInTheDocument();
    // With the "Write N more" choice: after the sentence, before the button.
    const go = screen.getByTestId('addq-go');
    expect(box.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('addq-sum').compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('polls get no box — their builder does not send guidance', () => {
    drawDialog({ engagementType: 'poll' });
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  test('surveys get no box — Workie does not write them', () => {
    drawDialog({ engagementType: 'survey', aiAvailable: false });
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  test('typed guidance, trimmed, rides in the plan handed to the builder', () => {
    const onOpenBuilder = drawDialog();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: `  ${GW}\n` } });
    expect(screen.getByText(`${GW.length + 3} / 500`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('addq-go'));
    expect(onOpenBuilder).toHaveBeenCalledWith('existing', {
      per: 3, numberOfCategories: 2, count: 6, autoStart: true, batchGuidance: GW,
    });
  });

  test('a blank box adds nothing to the plan', () => {
    const onOpenBuilder = drawDialog();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('addq-go'));
    expect(onOpenBuilder).toHaveBeenCalledWith('existing', { per: 3, numberOfCategories: 2, count: 6, autoStart: true });
  });
});

describe('end to end: the panel, the dialog, the builder, the wire', () => {
  const SET = {
    id: 'historic-figures', name: 'Historic Figures', topic: 'history', engagementType: 'trivia',
    description: 'AI-generated trivia questions about Historic figures. Difficulty: medium. 4 choices per question.',
    aiContextInstruction: 'These are medium-level trivia questions about Historic figures.',
    totalQuestions: 2, categoryCount: 2, activeVersion: 1, canManage: true,
  };
  const QUESTIONS = {
    setId: SET.id,
    questions: [
      { id: 'c001#001', Category: 'Presidents', title: 'FIRST PRESIDENT', QuestionNumber: 1, questionDetail: 'Who?',
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', difficulty: 'medium' },
      { id: 'c002#001', Category: 'Generals', title: 'APPOMATTOX', QuestionNumber: 1, questionDetail: 'Who?',
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', difficulty: 'medium' },
    ],
  };
  const GENERATED = [1, 2].map((n) => ({
    title: `Generated ${n}`, questionDetail: `Q${n}?`, category: n === 1 ? 'Presidents' : 'Generals', difficulty: 'medium',
    optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: [],
  }));
  const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
  });

  function mockApi() {
    const aiPosts = [];
    authFetch.mockImplementation(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST' && url.includes('ai-generate-trivia')) {
        aiPosts.push(JSON.parse(opts.body));
        return jsonResponse(202, { jobId: 'job-e2e', status: 'queued', requested: 2 });
      }
      if (method === 'GET' && url.includes('ai-generate-trivia/job-e2e')) {
        return jsonResponse(200, {
          jobId: 'job-e2e', status: 'complete', phase: '', requested: 2, completed: 2, items: GENERATED,
          warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
          updatedAt: '2026-09-25T10:00:00.000Z',
        });
      }
      if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
      if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
    return aiPosts;
  }

  test('the FIRST generation sends the dialog\'s guidance, the review quotes it, the builder keeps it', async () => {
    const aiPosts = mockApi();
    render(
      <QuestionsPanel
        questionSet={SET}
        availableSets={[SET]}
        plannedVersion={2}
        onChanged={jest.fn()}
        onDirtyChange={jest.fn()}
      />
    );
    await screen.findByText('FIRST PRESIDENT');
    fireEvent.click(screen.getByRole('button', { name: /Add questions/ }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(LABEL), { target: { value: GW } });
    fireEvent.click(within(dialog).getByTestId('addq-go'));

    // The builder opens generating; its first and only request carries it.
    await waitFor(() => expect(aiPosts).toHaveLength(1));
    expect(aiPosts[0].batchGuidance).toBe(GW);
    expect(aiPosts[0].appendOnly).toBe(true);
    expect(aiPosts[0].customPrompt || '').not.toContain('Washington');

    expect(await screen.findByTestId('git-guidance')).toHaveTextContent(`Your guidance: “${GW}”`);

    // Back to the form: the builder's own box holds the same text, to edit.
    fireEvent.click(screen.getByRole('button', { name: /Back to Configuration/ }));
    expect(screen.getByLabelText(LABEL)).toHaveValue(GW);
  });
});
