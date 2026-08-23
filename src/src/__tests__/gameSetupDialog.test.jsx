/**
 * The create-engagement dialog, rendered.
 *
 * This is the first host surface that can be mounted in jsdom at all —
 * GameHostPage itself dies on the auth provider (see anonymitySetup.test.js:3-7),
 * which is why every decision on this screen has until now been tested as a pure
 * function or not at all. The extraction is what buys these assertions.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import { GAME_TYPE_LIST, GAME_TYPES, PICKER_GAME_TYPES, UNPLAYABLE_GAME_TYPES } from '../config/gameTypes';

const SETS = [
  { id: 'pricing', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer', hasImages: false },
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false },
  { id: 'mood', name: 'Room Mood', totalQuestions: 6, engagementType: 'poll', hasImages: false },
];

const CATEGORIES = [
  { name: 'Leadership', questionCount: 20 },
  { name: 'Ops', questionCount: 27 },
];

function setup(overrides = {}) {
  const props = {
    isFirstEngagement: true,
    eventTitle: '',
    onEventTitleChange: jest.fn(),
    questionSets: SETS,
    personas: [{ personaId: 'coach', name: 'Coach', tagline: 'warm and direct' }],
    categories: CATEGORIES,
    activeCategoryIds: new Set(['Leadership', 'Ops']),
    onToggleCategory: jest.fn(),
    onQuestionSetChange: jest.fn(),
    onCancel: jest.fn(),
    onCreate: jest.fn(),
    ...overrides,
  };
  const utils = render(<GameSetupDialog {...props} />);
  return { ...utils, props };
}

const pill = (label) => screen.getByRole('button', { name: label });
const setSelect = () => screen.getByLabelText(/question set/i);

describe('the format picker', () => {
  // rejects: the shipped three-option <select>, which hand-listed
  // call-and-answer / trivia / wavelength and omitted poll — a picker that
  // drifted from the table built to prevent drift.
  test('offers Poll', () => {
    setup();
    expect(pill('Poll')).toBeInTheDocument();
  });

  // rejects: building the mockup's five pills as drawn. upload-questions.js:146-157
  // rejects survey uploads outright, so no survey set can exist, so the pill
  // would open onto an empty list with Create permanently disabled.
  test('does not offer Survey', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Survey' })).toBeNull();
  });

  test('offers every other type in the registry', () => {
    setup();
    for (const type of GAME_TYPE_LIST) {
      if (UNPLAYABLE_GAME_TYPES.includes(type.id)) continue;
      expect(pill(type.label)).toBeInTheDocument();
    }
  });

  // rejects: choosing a format and keeping the previous format's question set,
  // which is what makes the set dropdown's type filter meaningful.
  test('choosing a format marks it, and clears the question set', () => {
    const { props } = setup();
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    expect(setSelect().value).toBe('pricing');

    fireEvent.click(pill('Trivia'));

    expect(pill('Trivia')).toHaveAttribute('aria-pressed', 'true');
    expect(pill('Call & Answer')).toHaveAttribute('aria-pressed', 'false');
    expect(setSelect().value).toBe('');
    // and the page is told, so it can drop the old set's categories/instruction
    expect(props.onQuestionSetChange).toHaveBeenLastCalledWith('');
  });

  // rejects: leaving `blurb` as the dead data it is today — it exists on all
  // five types and is rendered nowhere in src/src.
  test('prints the chosen format\'s blurb, and changes it with the format', () => {
    setup();
    expect(screen.getByText(GAME_TYPES['call-and-answer'].blurb)).toBeInTheDocument();
    fireEvent.click(pill('Wavelength'));
    expect(screen.getByText(GAME_TYPES.wavelength.blurb)).toBeInTheDocument();
  });

  // rejects: shipping the wavelength unanimity caveat before the scoring change
  // it describes. get-ai-summary.js:1931-1945 aggregates by frequency; there is
  // no "everyone said it" rule and no group-size limit to promise.
  test('makes no promise about group size on Wavelength', () => {
    setup();
    fireEvent.click(pill('Wavelength'));
    expect(screen.queryByText(/10 people or fewer|everyone said it|unanimous/i)).toBeNull();
  });
});

describe('the question set', () => {
  // rejects: the mockup's single hardcoded option, which loses the type filter,
  // the question count and the image marker.
  test('lists only sets of the chosen format, with their counts', () => {
    setup();
    const options = within(setSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Select a question set...', 'Strategic Pricing Plays (47 questions)']);

    fireEvent.click(pill('Poll'));
    const pollOptions = within(setSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(pollOptions).toEqual(['Select a question set...', 'Room Mood (6 questions)']);
  });

  // rejects: dropping the callback, which is the only thing that loads the
  // categories the create payload then carries.
  test('tells the page which set was chosen, so it can load the categories', () => {
    const { props } = setup();
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    expect(props.onQuestionSetChange).toHaveBeenCalledWith('pricing');
  });

  test('shows the category grid only once a set is chosen', () => {
    setup();
    expect(screen.queryByText('Leadership')).toBeNull();
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    expect(screen.getByText('Leadership')).toBeInTheDocument();
  });

  // rejects: the mockup's single-value <select>, which cannot express
  // "these three, not those five".
  test('a category toggle goes back to the page that owns the selection', () => {
    const { props } = setup();
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    fireEvent.click(screen.getByText('Leadership').closest('button'));
    expect(props.onToggleCategory).toHaveBeenCalledWith('Leadership');
  });
});

describe('the anonymity card', () => {
  const openVotingFormat = () => setup();

  // THE assertion on this screen. get-results.js:207-217 sets AuthorsRevealed
  // UNCONDITIONALLY on entering RESULTS, so the host does not hold that switch.
  // rejects: the mockup's "Until you reveal them", which tells a host they can
  // close voting and still be hiding names.
  test('promises the close of voting, not a button the host does not hold', () => {
    openVotingFormat();
    expect(screen.getByText(/Until voting closes, nobody sees who wrote which answer/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/until you reveal/i)).toBeNull();
  });

  test('the previews are headed "While voting" and "After voting closes"', () => {
    openVotingFormat();
    expect(screen.getByText(/^While voting$/i)).toBeInTheDocument();
    expect(screen.getByText(/^After voting closes$/i)).toBeInTheDocument();
    expect(screen.queryByText(/after you reveal/i)).toBeNull();
  });

  // rejects: dropping the limits sentence, or softening it into a promise of
  // secrecy the system cannot keep.
  test('states the limit — names, not identities', () => {
    openVotingFormat();
    expect(screen.getByText(/hides names, not identities/i)).toBeInTheDocument();
  });

  // rejects: gating on anything other than "does this format hold a vote".
  test.each(['Trivia', 'Wavelength'])('is absent for %s', (label) => {
    setup();
    fireEvent.click(pill(label));
    expect(screen.queryByText(/nobody sees who wrote which answer/i)).toBeNull();
  });

  test.each(['Call & Answer', 'Poll'])('is present for %s', (label) => {
    setup();
    fireEvent.click(pill(label));
    expect(screen.getByText(/nobody sees who wrote which answer/i)).toBeInTheDocument();
  });
});

describe('the fields the mockup drops', () => {
  // rejects: building 20-setup.html as drawn. Details reaches participants,
  // AIContext reaches the Bedrock prompt, PersonaId picks Workie's voice —
  // silence in a mockup is not an instruction to delete.
  test('keeps event details, AI context and Workie\'s voice', () => {
    setup();
    expect(screen.getByLabelText(/event details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ai context/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workie's voice/i)).toBeInTheDocument();
  });
});

describe('the trivia timer', () => {
  // rejects: restoring a control that never did anything. There is no countdown
  // anywhere in the product, and the sentence it carried promised players 30
  // seconds they were never given.
  test('has no control, and promises no seconds, on any format', () => {
    setup();
    for (const type of PICKER_GAME_TYPES) {
      fireEvent.click(pill(type.label));
      expect(screen.queryByRole('spinbutton')).toBeNull();
      expect(screen.queryByText(/seconds to answer/i)).toBeNull();
    }
  });
});

describe('creating', () => {
  const ready = (overrides = {}) => {
    const r = setup({ eventTitle: 'Q3 Offsite', ...overrides });
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    return r;
  };

  // rejects: the mockup's always-live Create button. join-time failure here is
  // a room that cannot start.
  test('is blocked until both a title and a set exist', () => {
    setup();
    const create = screen.getByRole('button', { name: /create engagement/i });
    expect(create).toBeDisabled();               // no title, no set

    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    expect(create).toBeDisabled();               // set, still no title

    setup({ eventTitle: '   ' });                 // whitespace is not a title
    expect(screen.getAllByRole('button', { name: /create engagement/i }).pop()).toBeDisabled();
  });

  test('is live once both exist', () => {
    ready();
    expect(screen.getByRole('button', { name: /create engagement/i })).toBeEnabled();
  });

  // THE reason for the extraction. handleStartNewGame calls leaveCurrentGame(),
  // which clears activeCategoryIds, and then reads it from the pre-reset
  // closure. Putting the ids in the payload removes that dependency entirely.
  test('hands the page the selected category ids, in the payload', () => {
    const { props } = ready();
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate.mock.calls[0][0].categoryIds).toEqual(['Leadership', 'Ops']);
  });

  // rejects: any field silently failing to reach the create call — the exact
  // shape of the triviaTimer defect.
  test('hands the page every value on the form', () => {
    const { props } = ready();
    fireEvent.change(screen.getByLabelText(/event details/i), { target: { value: 'Pricing day.' } });
    fireEvent.change(screen.getByLabelText(/ai context/i), { target: { value: 'Mid-market SaaS.' } });
    fireEvent.change(screen.getByLabelText(/workie's voice/i), { target: { value: 'coach' } });
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));

    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Q3 Offsite',
      gameType: 'call-and-answer',
      setId: 'pricing',
      eventDetails: 'Pricing day.',
      aiContext: 'Mid-market SaaS.',
      personaId: 'coach',
      randomizeQuestions: true,
      anonymousResponses: true,
    }));
  });

  // rejects: flipping the default. A host who never opens this card still gets
  // an anonymous round, which is the whole argument for spelling the guarantee
  // out rather than hiding it behind a label.
  test('anonymity defaults on, and the opt-out reaches the payload', () => {
    const { props } = ready();
    fireEvent.click(screen.getByRole('checkbox', { name: /anonymous responses/i }));
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate.mock.calls[0][0].anonymousResponses).toBe(false);
  });

  test('shuffle defaults on, and the opt-out reaches the payload', () => {
    const { props } = ready();
    fireEvent.click(screen.getByRole('checkbox', { name: /shuffle the question order/i }));
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate.mock.calls[0][0].randomizeQuestions).toBe(false);
  });

  test('Cancel leaves without creating', () => {
    const { props } = ready();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

describe('edit mode', () => {
  /*
    THE PREFILL, IN THE SHAPE THE SERVER ACTUALLY SENDS. Copied from
    get-game.js's host branch (baseGameInfo + the host extras), not invented
    from this component's props — the sessionHistory suite's own header records
    what an invented fixture cost last time: every test green while the screen
    showed nothing.
  */
  const HOST_INFO = {
    gameId: '9137',
    title: 'Pricing Workshop',
    gameType: 'call-and-answer',
    anonymousUntilReveal: false,
    createdAt: '2026-08-14T09:00:00Z',
    hostName: 'Host',
    visibility: 'private',
    started: false,
    state: 'CREATED',
    currentQuestionId: null,
    lessonNumber: 0,
    questionSetId: 'pricing',
    aiContext: 'Mid-market SaaS.',
    details: 'Pricing day.',
    personaId: 'coach',
    randomizeQuestions: false,
    usedQuestions: [],
    playedQuestions: [],
    categoryState: null,
    // Derived by the page from the session's HostMask bits
    // (editGameFromHistory -> convertBitmaskToCategories) and handed in with
    // the rest of the seed. Names, because the grid keys on names.
    selectedCategoryNames: ['Leadership', 'Ops'],
  };

  const setupEdit = (values = {}) =>
    setup({ mode: 'edit', initialValues: { ...HOST_INFO, ...values } });

  // rejects: an edit form that opens blank — a host who pressed Save would
  // wipe every field they did not retype.
  test('seeds every editable field from the session being edited', () => {
    setupEdit();
    expect(screen.getByLabelText(/event title/i).value).toBe('Pricing Workshop');
    expect(screen.getByLabelText(/event details/i).value).toBe('Pricing day.');
    expect(screen.getByLabelText(/ai context/i).value).toBe('Mid-market SaaS.');
    expect(screen.getByLabelText(/workie's voice/i).value).toBe('coach');
    expect(setSelect().value).toBe('pricing');
    expect(pill('Call & Answer')).toHaveAttribute('aria-pressed', 'true');
    // anonymousUntilReveal: false must arrive as an UNCHECKED box — seeding
    // the default instead would flip the session anonymous on the first save.
    expect(screen.getByRole('checkbox', { name: /anonymous responses/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /shuffle the question order/i })).not.toBeChecked();
  });

  test('the submit button says Save changes, and the heading says Edit', () => {
    setupEdit();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create engagement/i })).toBeNull();
    expect(screen.getByRole('heading', { name: /edit session/i })).toBeInTheDocument();
  });

  // rejects: live controls for the fields the PUT whitelist refuses. The
  // backend ignores gameType/questionSetId/categories/shuffle, so an enabled
  // picker here would let the host "change" something that silently fails to
  // save — shown disabled, with the note saying why.
  test('the format, set and shuffle controls are disabled — and categories are NOT', () => {
    /*
      Categories were in this locked list, and the owner called it: "the edit
      doesnt allow chaging the categories or even see the categories... I think
      you should be able to edit this." The lock was right for format/set/
      shuffle — the create path pins derived rows to those — but the enabled
      SUBSET is mask state, the same bits toggle-category flips mid-session,
      and the PUT now rewrites it. So the grid is live here and stays live.
    */
    setupEdit();
    expect(pill('Call & Answer')).toBeDisabled();
    expect(pill('Trivia')).toBeDisabled();
    expect(setSelect()).toBeDisabled();
    expect(screen.getByText('Leadership').closest('button')).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /shuffle the question order/i })).toBeDisabled();
    expect(screen.getAllByText(/fixed once a session is created/i).length).toBeGreaterThan(0);
  });

  test('a category toggled in edit mode flips locally and lands in the payload', () => {
    const { props } = setupEdit();
    // Seeded from the session's own masks: Leadership arrives selected.
    expect(screen.getByText('Leadership').closest('button')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByText('Leadership').closest('button'));
    expect(screen.getByText('Leadership').closest('button')).toHaveAttribute('aria-pressed', 'false');
    // The page's own toggle handler is NOT raised — edit owns its selection,
    // so editing session B cannot repaint the setup panel of session A on
    // stage behind the dialog.
    expect(props.onToggleCategory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      categoryIds: ['Ops'],
    }));
  });

  test('deselecting every category blocks Save instead of saving a question-less session', () => {
    const { props } = setupEdit();
    fireEvent.click(screen.getByText('Leadership').closest('button'));
    fireEvent.click(screen.getByText('Ops').closest('button'));
    expect(screen.getByText(/select at least one category/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('the header X closes without saving', () => {
    // Reported: "when editing, there is no 'x' to close the box without saving
    // changes." Same discard Escape always offered, where people look for it.
    const { props } = setupEdit();
    fireEvent.click(screen.getByRole('button', { name: /close without saving/i }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('the question-sets entry point is absent — the set cannot change here', () => {
    setupEdit();
    expect(screen.queryByRole('button', { name: /your question sets|make a question set/i })).toBeNull();
  });

  // rejects: showing a blank set control when the page's list does not carry
  // the pinned set (retired, or fetched for another format).
  test('a set the page\'s list does not carry still displays by id', () => {
    setupEdit({ questionSetId: 'retired-set' });
    expect(setSelect().value).toBe('retired-set');
  });

  /*
    THE TITLE IS LOCAL IN EDIT MODE. The page's `eventTitle` names the session
    ON STAGE (gameSession.js); an edit targets a session from history that
    need not be that one, so typing here must not rename the live screen.
  */
  test('editing the title stays local — the page\'s eventTitle is untouched', () => {
    const { props } = setupEdit();
    const input = screen.getByLabelText(/event title/i);
    fireEvent.change(input, { target: { value: 'Renamed Workshop' } });
    expect(input.value).toBe('Renamed Workshop');
    expect(props.onEventTitleChange).not.toHaveBeenCalled();
  });

  // rejects: any edited value silently failing to reach the save call — the
  // triviaTimer defect's shape, at the edit surface.
  test('Save changes raises the full edited payload', () => {
    const { props } = setupEdit();
    fireEvent.change(screen.getByLabelText(/event title/i), { target: { value: 'Renamed Workshop' } });
    fireEvent.change(screen.getByLabelText(/event details/i), { target: { value: 'Now two days.' } });
    fireEvent.change(screen.getByLabelText(/workie's voice/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /anonymous responses/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Renamed Workshop',
      gameType: 'call-and-answer',
      setId: 'pricing',
      eventDetails: 'Now two days.',
      aiContext: 'Mid-market SaaS.',
      personaId: '',
      anonymousResponses: true,
      // The seeded selection travels even when untouched — an edit that only
      // renamed the session must not silently clear its category masks.
      categoryIds: ['Leadership', 'Ops'],
    }));
  });

  test('a title blanked out disables Save rather than saving a nameless session', () => {
    const { props } = setupEdit();
    fireEvent.change(screen.getByLabelText(/event title/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('Cancel leaves without saving', () => {
    const { props } = setupEdit();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

describe('the title', () => {
  // eventTitle stays in GameHostPage: it is a per-game key the live host screen
  // reads (gameSession.js:105), so the dialog must not own it.
  // rejects: the dialog taking ownership, which would leave the live screen
  // reading a title nobody wrote.
  test('is the page\'s value, and edits go back to the page', () => {
    const { props } = setup({ eventTitle: 'Existing' });
    const input = screen.getByLabelText(/event title/i);
    expect(input.value).toBe('Existing');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect(props.onEventTitleChange).toHaveBeenCalledWith('Renamed');
  });
});

describe('the zero-setup plan line', () => {
  // The owner's redesign brief: a session should work well with none of the
  // optional Workie fields touched. The line states the plan; these pin that
  // it tells the truth about WHERE the summary approach comes from.
  test('absent until a set is picked — there is no plan to describe yet', () => {
    setup();
    expect(screen.queryByTestId('gsd-workie-plan')).toBeNull();
  });

  test('a set with no prompt of its own promises the format standard', () => {
    setup();
    fireEvent.change(setSelect(), { target: { value: 'pricing' } });
    const plan = screen.getByTestId('gsd-workie-plan');
    expect(plan.textContent).toMatch(/standard Call & Answer way/);
    expect(plan.textContent).toMatch(/nothing above needs setting up/i);
  });

  test('a set that names its own prompt is followed, and says so', () => {
    setup({
      questionSets: [
        { id: 'lp', name: 'Leadership Principles', totalQuestions: 10, engagementType: 'call-and-answer', hasImages: false, promptId: 'lp-behavioral' },
      ],
    });
    fireEvent.change(setSelect(), { target: { value: 'lp' } });
    const plan = screen.getByTestId('gsd-workie-plan');
    expect(plan.textContent).toMatch(/brings its own summary approach/i);
    expect(plan.textContent).not.toMatch(/standard/i);
  });
});
