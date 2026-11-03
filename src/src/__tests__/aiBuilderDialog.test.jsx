/**
 * THE FOUR AI BUILDERS OPEN IN ONE WINDOW (experience plan Phase 5 step 5e;
 * audit E §1.5 Q2, §3.3).
 *
 * Trivia, Poll, Survey and the scenario builder were four raw
 * `div.modal-overlay` + `.modal-content` shells — white paper inside a dusk
 * console — with four Title Case headings and no Escape. Each now renders
 * components/AIBuilderDialog: `Modal` (Escape, the Tab trap, focus restore),
 * the shared head and foot from ui/DialogParts, and `data-theme="dark"` on its
 * own overlay.
 *
 * rejects: a builder going back to a raw overlay or the paper `.modal-content`;
 * a builder inheriting the page's theme; a Title Case heading or primary
 * action; the browser's confirm instead of the app's small dialog; a builder
 * with no Escape.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;
const PollAIBuilder = require('../components/PollAIBuilder').default;
const SurveyAIBuilder = require('../components/SurveyAIBuilder').default;
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  authFetch.mockImplementation(async () => ok({ prompts: [], libraries: [] }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const BUILDERS = [
  {
    kind: 'trivia', title: 'Generate trivia questions', action: /^Generate trivia questions$/,
    draw: (onClose) => <TriviaAIBuilder onClose={onClose} onTriviaGenerated={() => {}} />,
  },
  {
    kind: 'poll', title: 'Generate poll questions', action: /^Generate poll questions$/,
    draw: (onClose) => <PollAIBuilder onClose={onClose} onPollGenerated={() => {}} />,
  },
  {
    kind: 'survey', title: 'Generate a survey', action: /^Write the survey$/,
    draw: (onClose) => <SurveyAIBuilder onClose={onClose} onSurveyGenerated={() => {}} />,
  },
  {
    kind: 'scenario', title: 'Generate scenarios', action: null,
    draw: (onClose) => <AIScenarioBuilder engagementType="call-and-answer" onClose={onClose} onScenariosGenerated={() => {}} />,
  },
];

describe.each(BUILDERS)('$kind builder', ({ kind, title, action, draw }) => {
  test('renders in the shared Modal, dusk on its own overlay', async () => {
    render(draw(jest.fn()));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('ui-dialog', 'ui-dialog--full', 'aib', `aib--${kind}`);
    const overlay = dialog.parentElement;
    expect(overlay).toHaveClass('ui-scrim', 'aib-scrim');
    expect(overlay).toHaveAttribute('data-theme', 'dark');
  });

  test('the head and foot are ui/DialogParts, with the Icon X', async () => {
    render(draw(jest.fn()));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(dialog.querySelector(':scope > header.ui-dialog-head')).not.toBeNull();
    expect(dialog.querySelector(':scope > footer.ui-dialog-foot')).not.toBeNull();
    const x = within(dialog).getByTestId('aib-close');
    expect(x).toHaveClass('ui-dialog-x');
    expect(x.textContent).not.toMatch(/[×✕]/);
    expect(x.querySelector('svg')).not.toBeNull();
  });

  test('no paper-theme shell or class survives on it', async () => {
    const { container } = render(draw(jest.fn()));
    await screen.findByRole('dialog', { name: title });
    for (const paper of ['.modal-overlay', '.modal-content', '.modal-header', '.modal-body', '.modal-footer', '.close-button',
      '.trivia-ai-builder-modal', '.poll-ai-builder-modal', '.survey-ai-builder-modal', '.ai-scenario-builder-modal']) {
      expect(document.querySelector(paper)).toBeNull();
    }
    // The builder's own buttons are ui/Button: its foot carries no .btn-* class.
    const foot = document.querySelector('.aib > footer.ui-dialog-foot');
    expect(foot.querySelectorAll('.btn-primary, .btn-secondary')).toHaveLength(0);
    expect(within(foot).getAllByRole('button').every((b) => b.classList.contains('ui-btn'))).toBe(true);
    expect(container).toBeTruthy();
  });

  if (action) {
    test('the primary action is sentence case and is the one main button', async () => {
      render(draw(jest.fn()));
      const dialog = await screen.findByRole('dialog', { name: title });
      const main = within(dialog).getByRole('button', { name: action });
      expect(main).toHaveClass('ui-btn--action');
    });
  }

  test('Escape closes an untouched builder through its one requestClose', async () => {
    const onClose = jest.fn();
    render(draw(onClose));
    await screen.findByRole('dialog', { name: title });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('the headings say what the window does, in sentence case', () => {
  test.each([
    ['trivia', 'Generate trivia questions'],
    ['poll', 'Generate poll questions'],
    ['wavelength', 'Generate wavelength prompts'],
    ['call-and-answer', 'Generate scenarios'],
  ])('the scenario builder for %s is "%s"', async (engagementType, heading) => {
    render(<AIScenarioBuilder engagementType={engagementType} onClose={() => {}} onScenariosGenerated={() => {}} />);
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
  });

  test('no builder source carries the old Title Case words', () => {
    const fs = require('fs');
    const path = require('path');
    const OLD = [/AI Trivia Builder/, /AI Poll Builder/, /\bBuilder\{isAppend/, /Generate Trivia Questions/, /Generate Poll Questions/,
      /Generate Scenarios/, /Configure Your/, /into System/, /Back to Configuration/, /Set as Correct/, /Retry Loading/,
      /Topic\/Subject/, /Target Audience/, /Must Have Categories/, /Additional Requirements \(Optional\)/];
    for (const name of ['TriviaAIBuilder', 'PollAIBuilder', 'SurveyAIBuilder', 'AIScenarioBuilder']) {
      const code = fs.readFileSync(path.join(__dirname, '..', 'components', `${name}.jsx`), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(OLD.filter((re) => re.test(code)).map(String)).toEqual([]);
    }
  });
});

describe('a decision is asked in the app, not the browser', () => {
  test('no builder calls window.confirm or alert', () => {
    const fs = require('fs');
    const path = require('path');
    for (const name of ['TriviaAIBuilder', 'PollAIBuilder', 'SurveyAIBuilder', 'AIScenarioBuilder']) {
      const code = fs.readFileSync(path.join(__dirname, '..', 'components', `${name}.jsx`), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/window\.confirm\(|\balert\(/);
      expect(code).toMatch(/useConfirm\(\)/);
    }
  });

  test('typing in the survey generator and closing asks with the small confirm', async () => {
    const onClose = jest.fn();
    jest.spyOn(window, 'confirm');
    render(<SurveyAIBuilder onClose={onClose} onSurveyGenerated={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Generate a survey' });
    fireEvent.change(dialog.querySelector('textarea'), { target: { value: 'An outline' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    const ask = await screen.findByRole('dialog', { name: /Close the survey generator\?/ });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(ask.closest('.ui-scrim--top')).not.toBeNull();
    // Escape answers the confirm first (the innermost dialog), keeping the work.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Close the survey generator\?/ })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
