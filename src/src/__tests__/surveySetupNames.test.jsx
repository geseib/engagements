/**
 * STARTING A SURVEY: the setup dialog's Names card.
 *
 * Built from docs/design/survey-redesign/07-start-survey.html (the dialog) and
 * 12-names.html (the three values side by side). Names is the one survey
 * setting that decides what the server WRITES about people — Anonymous, Who
 * finished, Named — so every sentence the card prints comes from
 * config/surveyNames.js, and these tests read the expected words from there
 * rather than retyping them.
 *
 * jsdom has no layout engine: nothing here asserts a size or a position.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import { NAMES_MODES, namesMode } from '../config/surveyNames';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [] }) })),
}));

const SETS = [
  { id: 'pricing', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer' },
  { id: 'q3-feedback', name: 'Q3 All-Hands feedback', totalQuestions: 8, engagementType: 'survey' },
  // Phase 2's set-level default is optional (plan §5 risk 11); a set that
  // carries one seeds the card, a set that does not reads as Anonymous.
  { id: 'retro', name: 'Workshop retro', totalQuestions: 6, engagementType: 'survey', namesDefault: 'finished' },
];

function setup(overrides = {}) {
  const props = {
    isFirstEngagement: true,
    eventTitle: 'Q3 All-Hands',
    onEventTitleChange: jest.fn(),
    questionSets: SETS,
    personas: [],
    categories: [{ name: 'Survey', questionCount: 8 }],
    activeCategoryIds: new Set(),
    onToggleCategory: jest.fn(),
    onQuestionSetChange: jest.fn(),
    onCancel: jest.fn(),
    onCreate: jest.fn(),
    ...overrides,
  };
  const utils = render(<GameSetupDialog {...props} />);
  return { ...utils, props };
}

const chooseSurvey = (setKey = 'platform:q3-feedback') => {
  fireEvent.click(screen.getByRole('button', { name: 'Survey' }));
  fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: setKey } });
};
const names = () => screen.getByRole('radiogroup', { name: 'Names' });
const radio = (label) => within(names()).getByRole('radio', { name: new RegExp(`^${label}`) });

describe('Survey is a format the host can start', () => {
  test('it is in the type pills', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Survey' })).toBeInTheDocument();
  });

  test('the survey sets are the ones offered under it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Survey' }));
    const options = within(screen.getByLabelText(/question set/i)).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t.startsWith('Q3 All-Hands feedback'))).toBe(true);
    expect(options.some((t) => t.startsWith('Strategic Pricing Plays'))).toBe(false);
  });
});

describe('the Names card', () => {
  test('three values, in order, each saying what the host gets', () => {
    setup();
    chooseSurvey();
    const radios = within(names()).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    NAMES_MODES.forEach((mode, i) => {
      expect(radios[i]).toHaveTextContent(mode.label);
      expect(radios[i]).toHaveTextContent(mode.hostLine);
    });
  });

  test('Anonymous is the default', () => {
    setup();
    chooseSurvey();
    expect(radio('Anonymous')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Who finished')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Named')).toHaveAttribute('aria-checked', 'false');
  });

  test('a set that carries its own default seeds the card', () => {
    setup();
    chooseSurvey('platform:retro');
    expect(radio('Who finished')).toHaveAttribute('aria-checked', 'true');
  });

  test('the host\'s own pick is not overwritten by the next set they look at', () => {
    setup();
    chooseSurvey();
    fireEvent.click(radio('Named'));
    fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:retro' } });
    expect(radio('Named')).toHaveAttribute('aria-checked', 'true');
  });

  test('the chosen value says what it does, and the phone preview is its promise', () => {
    setup();
    chooseSurvey();
    const anon = namesMode('anonymous');
    expect(screen.getByText(anon.does)).toBeInTheDocument();
    const phone = screen.getByTestId('names-phone-preview');
    expect(phone).toHaveTextContent(`${anon.phoneLead} ${anon.phoneLine}`);

    fireEvent.click(radio('Who finished'));
    const finished = namesMode('finished');
    expect(screen.getByText(finished.does)).toBeInTheDocument();
    expect(screen.queryByText(anon.does)).toBeNull();
    // Who finished has no lead word; the preview is the line alone.
    expect(screen.getByTestId('names-phone-preview').textContent.trim()).toBe(finished.phoneLine);

    fireEvent.click(radio('Named'));
    expect(screen.getByTestId('names-phone-preview')).toHaveTextContent(namesMode('named').phoneLine);
  });

  test('the arrow keys move the choice, the way a radio group does', () => {
    setup();
    chooseSurvey();
    fireEvent.keyDown(radio('Anonymous'), { key: 'ArrowRight' });
    expect(radio('Who finished')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Who finished')).toHaveAttribute('tabindex', '0');
    expect(radio('Anonymous')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(radio('Who finished'), { key: 'ArrowLeft' });
    expect(radio('Anonymous')).toHaveAttribute('aria-checked', 'true');
  });

  test('it says the choice locks when the survey opens, and never overclaims', () => {
    setup();
    chooseSurvey();
    expect(screen.getByText(/fixed once the survey opens/i)).toBeInTheDocument();
    expect(screen.getByText(/hides names, not identities/i)).toBeInTheDocument();
  });
});

describe('what a survey does not show', () => {
  test('no call-and-answer "Anonymous responses" card, no shuffle, no category grid', () => {
    setup();
    chooseSurvey();
    expect(screen.queryByRole('checkbox', { name: /anonymous responses/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /shuffle/i })).toBeNull();
    expect(screen.queryByRole('group', { name: /categories/i })).toBeNull();
  });

  test('no Names card on any other format', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:pricing' } });
    expect(screen.queryByRole('radiogroup', { name: 'Names' })).toBeNull();
  });
});

describe('submitting', () => {
  test('the button reads "Open the survey"', () => {
    setup();
    chooseSurvey();
    expect(screen.getByRole('button', { name: /open the survey/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /create engagement/i })).toBeNull();
  });

  test('the payload carries names, and a survey is never shuffled', () => {
    const { props } = setup();
    chooseSurvey();
    fireEvent.click(radio('Named'));
    fireEvent.click(screen.getByRole('button', { name: /open the survey/i }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      gameType: 'survey', setId: 'q3-feedback', names: 'named', randomizeQuestions: false,
    }));
  });

  test('left alone, it sends Anonymous', () => {
    const { props } = setup();
    chooseSurvey();
    fireEvent.click(screen.getByRole('button', { name: /open the survey/i }));
    expect(props.onCreate.mock.calls[0][0].names).toBe('anonymous');
  });
});

describe('editing a survey that has not opened', () => {
  test('the card opens on the session\'s own value', () => {
    setup({
      mode: 'edit',
      initialValues: {
        gameId: '4821', title: 'Q3 All-Hands', gameType: 'survey',
        questionSetId: 'q3-feedback', names: 'named', started: false,
      },
    });
    expect(radio('Named')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });
});
