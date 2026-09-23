/**
 * The create-engagement dialog, rendered.
 *
 * This is the first host surface that can be mounted in jsdom at all —
 * GameHostPage itself dies on the auth provider (see anonymitySetup.test.js:3-7),
 * which is why every decision on this screen has until now been tested as a pure
 * function or not at all. The extraction is what buys these assertions.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import { parseUpgradeRequired } from '../utils/upgradeRequired';

/*
  THE CATALOG'S SUMMARY PROMPTS. The dialog fetches `admin/ai-prompts` itself
  (for the plan sentence, and now for the approach picker). One list, served to
  every test: the two live tests about the plan sentence rely on `lp-behavioral`
  being a prompt the library knows.
*/
const PROMPTS = [
  { promptId: 'lp-behavioral', name: 'LP Behavioural', gameType: 'call-and-answer', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-vj', name: 'Trivia — VJ', gameType: 'trivia', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-gen', name: 'Trivia generator', gameType: 'trivia', summaryPromptStatus: 'unusable' },
];
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: PROMPTS }) })),
}));
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

/*
  THE PICKER'S VALUE IS `scope:id`, NOT `id`. A <select> can only carry a
  string, and a set reference is a pair — `teamretro` names a different set in
  each of platform, org and public (utils/setRef.js). Every fixture above is
  unscoped, which means platform.
*/

describe('the format picker', () => {
  // rejects: the shipped three-option <select>, which hand-listed
  // call-and-answer / trivia / wavelength and omitted poll — a picker that
  // drifted from the table built to prevent drift.
  test('offers Poll', () => {
    setup();
    expect(pill('Poll')).toBeInTheDocument();
  });

  // Surveys phase 2: a session plays a survey now, so the fifth pill the
  // mockup drew is offered (its own dialog is surveySetupNames.test.jsx).
  test('offers Survey', () => {
    setup();
    expect(pill('Survey')).toBeInTheDocument();
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
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(setSelect().value).toBe('platform:pricing');

    fireEvent.click(pill('Trivia'));

    expect(pill('Trivia')).toHaveAttribute('aria-pressed', 'true');
    expect(pill('Call & Answer')).toHaveAttribute('aria-pressed', 'false');
    expect(setSelect().value).toBe('');
    // and the page is told, so it can drop the old set's categories/instruction
    expect(props.onQuestionSetChange).toHaveBeenLastCalledWith('', 'platform');
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
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(props.onQuestionSetChange).toHaveBeenCalledWith('pricing', 'platform');
  });

  test('shows the category grid only once a set is chosen', () => {
    setup();
    expect(screen.queryByText('Leadership')).toBeNull();
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(screen.getByText('Leadership')).toBeInTheDocument();
  });

  // rejects: the mockup's single-value <select>, which cannot express
  // "these three, not those five".
  test('a category toggle goes back to the page that owns the selection', () => {
    const { props } = setup();
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
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
  // "AI context" is now "Instructions for Workie" — the name says what the
  // prompt does with it (personas.js: THE HOST'S INSTRUCTIONS, enforced in
  // every section of the summary).
  test('keeps event details, instructions for Workie and Workie\'s voice', () => {
    setup();
    expect(screen.getByLabelText(/event details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instructions for workie/i)).toBeInTheDocument();
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
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    return r;
  };

  // rejects: the mockup's always-live Create button. join-time failure here is
  // a room that cannot start.
  test('is blocked until both a title and a set exist', () => {
    setup();
    const create = screen.getByRole('button', { name: /create engagement/i });
    expect(create).toBeDisabled();               // no title, no set

    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
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
    fireEvent.change(screen.getByLabelText(/instructions for workie/i), { target: { value: 'Mid-market SaaS.' } });
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

  test('Cancel on a filled form asks first, and Discard leaves without creating', () => {
    const { props } = ready();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
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
    expect(screen.getByLabelText(/instructions for workie/i).value).toBe('Mid-market SaaS.');
    expect(screen.getByLabelText(/workie's voice/i).value).toBe('coach');
    expect(setSelect().value).toBe('platform:pricing');
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

  // rejects: the note that said "the format, question set and categories are
  // fixed" directly above a category grid that is live and saves.
  test('the edit note names only what is really fixed', () => {
    setupEdit();
    const note = screen.getByText(/format and question set are fixed once a session is created/i);
    expect(note.textContent).not.toMatch(/categor/i);
  });

  /*
    THE SESSION'S APPROACH SURVIVES AN EDIT. Two holes, both closed here: the
    prefill never carried promptId (get-game.js), and the "a pick that no
    longer suits the format" effect ran on MOUNT, before the prompt list had
    loaded, and cleared whatever was seeded. Either one sent promptId: '' on
    Save — and '' REMOVEs the session's PromptId.
  */
  test('a seeded summary approach is kept, shown and saved', async () => {
    const { props } = setupEdit({ promptId: 'lp-behavioral' });
    const picker = screen.getByLabelText(/summary approach/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: /LP Behavioural/ })).toBeInTheDocument());
    expect(picker.value).toBe('lp-behavioral');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(props.onCreate.mock.calls[0][0].promptId).toBe('lp-behavioral');
  });

  test('an untouched edit with a seeded approach closes at once — nothing changed', async () => {
    const { props } = setupEdit({ promptId: 'lp-behavioral' });
    await waitFor(() => expect(screen.getByRole('option', { name: /LP Behavioural/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /close without saving/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
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
    expect(setSelect().value).toBe('platform:retired-set');
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

/*
  THE ADVANCED SECTION — docs/design/session-setup-redesign 01/02/04 and PLAN
  Phase 1. Title, format, set and categories stay in view; everything with a
  safe default folds under a native <details>, closed on open. The line on the
  fold names every default in force and any change first, in amber, so closing
  it never hides a decision. It replaces the old green plan sentence.
*/
const advanced = () => document.querySelector('details.gsd-adv');
const advLine = () => screen.getByTestId('gsd-adv-summary');

describe('the Advanced section', () => {
  test('is closed when the dialog opens, and the line names the defaults', () => {
    setup();
    expect(advanced()).not.toBeNull();
    expect(advanced().open).toBe(false);
    expect(advLine().textContent).toMatch(
      /Using the defaults — answers anonymous until voting closes, questions shuffled; Workie adapts its voice and gives the standard Call & Answer summary\./);
  });

  test('opens from its summary, like any disclosure', () => {
    setup();
    fireEvent.click(within(advanced()).getByText(/^Advanced$/));
    expect(advanced().open).toBe(true);
  });

  // rejects: a fold that hides the choices that define the session.
  test('title, format, set and categories stay in the main view', () => {
    setup();
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    for (const el of [
      screen.getByLabelText(/event title/i),
      pill('Call & Answer'),
      setSelect(),
      screen.getByText('Leadership').closest('button'),
    ]) {
      expect(advanced().contains(el)).toBe(false);
    }
  });

  test('anonymity, shuffle, voice, approach, instructions and details are folded under it', () => {
    setup();
    for (const el of [
      screen.getByRole('checkbox', { name: /anonymous responses/i }),
      screen.getByRole('checkbox', { name: /shuffle the question order/i }),
      screen.getByLabelText(/workie's voice/i),
      screen.getByLabelText(/summary approach/i),
      screen.getByLabelText(/instructions for workie/i),
      screen.getByLabelText(/event details/i),
    ]) {
      expect(advanced().contains(el)).toBe(true);
    }
  });

  test('its four groups, in order: Responses, Questions, Workie, What people see', () => {
    setup();
    const heads = Array.from(advanced().querySelectorAll('.gsd-section')).map((h) => h.textContent);
    expect(heads).toEqual(['Responses', 'Questions', 'Workie', 'What people see when they join']);
  });

  // rejects: a "Responses" heading over nothing, which is what trivia showed.
  test.each(['Trivia', 'Wavelength'])('has no Responses group for %s', (label) => {
    setup();
    fireEvent.click(pill(label));
    const heads = Array.from(advanced().querySelectorAll('.gsd-section')).map((h) => h.textContent);
    expect(heads).toEqual(['Questions', 'Workie', 'What people see when they join']);
    expect(advLine().textContent).not.toMatch(/anonymous/);
  });

  test('a changed voice is named first, in amber, and the rest are still the defaults', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/workie's voice/i), { target: { value: 'coach' } });
    const lead = advLine().querySelector('b');
    expect(lead.textContent).toBe('Changed: Workie speaks as Coach.');
    expect(advLine().textContent).toMatch(/Otherwise the defaults — answers anonymous until voting closes, questions shuffled, the standard Call & Answer summary\./);
  });

  test('turning anonymity off is named as what it does', () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: /anonymous responses/i }));
    expect(advLine().querySelector('b').textContent).toBe('Changed: answers named from the start.');
  });

  test('the old plan sentence is gone — one statement of the plan, not two', () => {
    setup();
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(screen.queryByTestId('gsd-workie-plan')).toBeNull();
  });

  /*
    THE SESSION'S OWN PICK. Beside the voice, and with the same shape of
    default: nothing chosen means the set's approach if it has one, else the
    format standard. The list is the catalog's summary prompts for THIS
    format only; a generator prompt is not offered.
  */
  test('the approach picker offers the summary prompts for the chosen format', async () => {
    setup();
    fireEvent.click(pill('Trivia'));
    fireEvent.change(setSelect(), { target: { value: 'platform:space' } });
    const picker = await screen.findByLabelText(/summary approach/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: /Trivia — VJ/ })).toBeInTheDocument());
    expect(within(picker).queryByRole('option', { name: /LP Behavioural/ })).toBeNull();
    expect(within(picker).queryByRole('option', { name: /Trivia generator/ })).toBeNull();
    expect(within(picker).getByRole('option', { name: /standard Trivia way/i })).toBeInTheDocument();
  });

  test('a chosen approach reaches the payload, and none is the empty string', async () => {
    const { props } = setup({ eventTitle: 'Quiz night' });
    fireEvent.click(pill('Trivia'));
    fireEvent.change(setSelect(), { target: { value: 'platform:space' } });
    const picker = await screen.findByLabelText(/summary approach/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: /Trivia — VJ/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate.mock.calls[0][0].promptId).toBe('');
    fireEvent.change(picker, { target: { value: 'trivia-vj' } });
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate.mock.calls[1][0].promptId).toBe('trivia-vj');
  });

  // A prompt belongs to one format: switching format drops the pick.
  test('switching format drops an approach picked for the old one', async () => {
    const { props } = setup({ eventTitle: 'Quiz night' });
    fireEvent.click(pill('Trivia'));
    const picker = screen.getByLabelText(/summary approach/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: /Trivia — VJ/ })).toBeInTheDocument());
    fireEvent.change(picker, { target: { value: 'trivia-vj' } });
    fireEvent.click(pill('Poll'));
    fireEvent.change(setSelect(), { target: { value: 'platform:mood' } });
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(props.onCreate.mock.calls[0][0].promptId).toBe('');
  });

  test('the line names the session\'s pick over the set\'s', async () => {
    setup({
      questionSets: [
        { id: 'lp', name: 'Leadership Principles', totalQuestions: 10, engagementType: 'call-and-answer', hasImages: false, promptId: 'lp-behavioral' },
      ],
    });
    fireEvent.change(setSelect(), { target: { value: 'platform:lp' } });
    const picker = await screen.findByLabelText(/summary approach/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: /LP Behavioural/ })).toBeInTheDocument());
    // The default option says where the default comes from.
    expect(within(picker).getByRole('option', { name: /what the set says/i })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'lp-behavioral' } });
    expect(advLine().querySelector('b').textContent).toMatch(/Workie sums up with “LP Behavioural”/);
  });

  test('a set that names its own prompt is followed, and the line says so', () => {
    setup({
      questionSets: [
        { id: 'lp', name: 'Leadership Principles', totalQuestions: 10, engagementType: 'call-and-answer', hasImages: false, promptId: 'lp-behavioral' },
      ],
    });
    fireEvent.change(setSelect(), { target: { value: 'platform:lp' } });
    expect(advLine().textContent).toMatch(/follows this set’s own summary approach/i);
    expect(advLine().textContent).not.toMatch(/standard/i);
  });
});

/*
  CLOSING — one requestClose() behind the X, Cancel and Escape (engage-design
  hard rules 2 and 3). A clean form closes at once; with work in hand the foot
  turns into an inline "Discard?" — never a second modal.
*/
describe('closing the dialog', () => {
  const x = () => screen.getByRole('button', { name: /close without creating/i });
  const cancel = () => screen.getByRole('button', { name: /^cancel$/i });
  const escape = () => fireEvent.keyDown(document, { key: 'Escape' });
  const dirty = () => {
    const r = setup();
    fireEvent.change(screen.getByLabelText(/event details/i), { target: { value: 'Half a thought' } });
    return r;
  };

  test.each([['the X', () => x()], ['Cancel', () => cancel()]])(
    '%s on an untouched form closes at once', (_, button) => {
      const { props } = setup();
      fireEvent.click(button());
      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });

  test('Escape on an untouched form closes at once', () => {
    const { props } = setup();
    escape();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test.each([['the X', () => x()], ['Cancel', () => cancel()], ['Escape', null]])(
    '%s on a form with work in hand asks, and does not close', (_, button) => {
      const { props } = dirty();
      if (button) fireEvent.click(button()); else escape();
      expect(props.onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog', { name: /discard/i })).toBeInTheDocument();
      // The safe answer takes the focus.
      expect(screen.getByRole('button', { name: /keep editing/i })).toHaveFocus();
    });

  test('Keep editing puts the foot back and keeps the work', () => {
    const { props } = dirty();
    fireEvent.click(cancel());
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText(/event details/i).value).toBe('Half a thought');
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  test('Escape while it asks is Keep editing, not a second close', () => {
    const { props } = dirty();
    fireEvent.click(cancel());
    escape();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  test('Discard closes', () => {
    const { props } = dirty();
    fireEvent.click(x());
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('an edit with a change asks too, and says the session stays as it was', () => {
    const { props } = setup({
      mode: 'edit',
      initialValues: { title: 'Pricing Workshop', gameType: 'call-and-answer', questionSetId: 'pricing' },
    });
    fireEvent.change(screen.getByLabelText(/event title/i), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /close without saving/i }));
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).toMatch(/stays as it was/i);
  });
});

describe('the foot says who can get in', () => {
  // True today: a created session sits in history until Start, and every
  // phone is refused until it has started (session-gate.js).
  test('creating: nobody can join until it is started', () => {
    setup();
    expect(screen.getByText(/nobody can join until you start it/i)).toBeInTheDocument();
  });

  // A survey is created AND opened by this press — the note would be false.
  test('a survey, which opens on this press, makes no such claim', () => {
    setup();
    fireEvent.click(pill('Survey'));
    expect(screen.queryByText(/nobody can join/i)).toBeNull();
  });

  test('editing: the session has not started', () => {
    setup({ mode: 'edit', initialValues: { title: 'T', gameType: 'call-and-answer', questionSetId: 'pricing' } });
    expect(screen.getByText(/has not started/i)).toBeInTheDocument();
  });
});

describe('the category helper counts questions', () => {
  test('none picked: all of them are in, with the total', () => {
    setup({ activeCategoryIds: new Set() });
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(screen.getByText('None picked, so all 2 are in · 47 questions')).toBeInTheDocument();
  });

  test('some picked: how many of how many, and their questions', () => {
    setup({ activeCategoryIds: new Set(['Leadership']) });
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    expect(screen.getByText('1 of 2 categories · 20 questions')).toBeInTheDocument();
  });
});

/**
 * THE SCOPE HALF OF THE SET REFERENCE.
 *
 * `teamretro` names a different set in each of platform, org and public
 * (lambda-functions/game/tenant.js). `GET /question-sets` returns `scope` on
 * every row for exactly that reason. This picker used to drop it — the option
 * value was `set.id` — so the create body had no scope to send, `create-game.js`
 * applied its documented `platform` default, and a session built from an ORG's
 * set resolved to a partition with no categories and no questions. It created,
 * listed and joined fine. It just could not be played.
 */
describe('the question set reference survives the picker', () => {
  const SCOPED = [
    { id: 'teamretro', name: 'Team Retro (Engage)', totalQuestions: 20, engagementType: 'call-and-answer', scope: 'platform' },
    { id: 'teamretro', name: 'Team Retro (ours)', totalQuestions: 8, engagementType: 'call-and-answer', scope: 'org' },
    { id: 'pricing', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer' },
  ];

  /* `eventTitle` is owned by the PAGE in create mode (the live host screen
     reads it), so a submittable form is seeded through the prop rather than
     typed — typing here only calls onEventTitleChange. */
  const ready = (over = {}) => setup({ questionSets: SCOPED, eventTitle: 'Retro', ...over });
  const create = () => fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));

  /*
    THE BUG, AT THE SEAM IT ESCAPED THROUGH. Everything downstream of this
    callback was already correct: create-game.js names questionSetScope,
    schema-compliant-manager pins it, and tests/tenant-session-scoping.js proves
    an explicit scope is honoured. Only the picker forgot.
  */
  // rejects: raising the id alone, which pins the session to Engage's library.
  test('an org set is raised with its scope', () => {
    const { props } = ready();
    fireEvent.change(setSelect(), { target: { value: 'org:teamretro' } });
    create();
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ setId: 'teamretro', setScope: 'org' }),
    );
  });

  // rejects: hardcoding 'org' — a platform set must still say platform.
  test('a platform set is raised as platform', () => {
    const { props } = ready();
    fireEvent.change(setSelect(), { target: { value: 'platform:pricing' } });
    create();
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ setId: 'pricing', setScope: 'platform' }),
    );
  });

  /*
    Two sets, one slug. Keyed by id, the <select> renders duplicate option
    values and duplicate React keys, and whichever the browser resolves first
    wins — so the host cannot reliably pick the other one at all.
  */
  // rejects: a picker that cannot express "ours, not Engage's".
  test('both libraries\' copies of one slug are offered separately', () => {
    setup({ questionSets: SCOPED });
    expect(screen.getByRole('option', { name: /Team Retro \(Engage\)/ }).value).toBe('platform:teamretro');
    expect(screen.getByRole('option', { name: /Team Retro \(ours\)/ }).value).toBe('org:teamretro');
  });

  // rejects: the page being told an id with no scope, which sends
  // fetchCategories and fetchQuestionSetInstruction back to the same ambiguity.
  test('the page is told the scope too, so it loads the right categories', () => {
    const { props } = setup({ questionSets: SCOPED });
    fireEvent.change(setSelect(), { target: { value: 'org:teamretro' } });
    expect(props.onQuestionSetChange).toHaveBeenCalledWith('teamretro', 'org');
  });
});

/* --------------------------------------------- a set the server cannot read */

describe('a question set whose content could not be decrypted', () => {
  /*
    game/get-question-sets.js now degrades a row it cannot decrypt instead of
    500ing the whole picker — see utils/unreadableSet.js for the full story. The
    row arrives with its encrypted fields nulled and `decryptFailed: true`.

    This surface fails DIFFERENTLY from the console list, and worse. The handler
    used to project `name: item.name || 'Unknown Set'`, so a nulled name here did
    not come back empty — it came back as a plausible, wrong, unfalsifiable label
    a host could not tell from a set somebody genuinely left untitled. And unlike
    the console, this control does something with the row: picking it starts a
    session against content nobody can read.
  */
  const UNREADABLE = {
    id: 'q3retro',
    name: null,
    totalQuestions: 42,
    engagementType: 'call-and-answer',
    hasImages: false,
    decryptFailed: true,
  };
  const withUnreadable = () => setup({ questionSets: [...SETS, UNREADABLE] });
  const options = () => Array.from(setSelect().querySelectorAll('option'));
  const unreadableOption = () => options().find((o) => o.textContent.includes('q3retro'));

  // rejects: `{set.name} ({set.totalQuestions} questions)` rendered straight
  // through, which for a nulled name is the line " (42 questions)" — an option
  // with no subject at all.
  test('the option names the set by the field that was never encrypted', () => {
    withUnreadable();
    expect(unreadableOption()).toBeTruthy();
  });

  // rejects: keeping it selectable. The console can afford to just mark the row
  // — nothing there acts on it. Choosing it HERE pins a session to content that
  // cannot be read, and the failure surfaces in front of a room.
  test('and it cannot be chosen, because a session built on it could not be played', () => {
    withUnreadable();
    expect(unreadableOption()).toBeDisabled();
  });

  // rejects: a disabled option with no stated reason, which reads as a bug in
  // the picker rather than a fact about the set.
  test('the option says why it is unavailable rather than just being dead', () => {
    withUnreadable();
    expect(unreadableOption().textContent).toMatch(/unreadable/i);
  });

  // rejects: filtering `decryptFailed` rows out of the picker. The handler
  // deliberately keeps them listed; hiding one here would leave a host with a
  // set they can see in the console, cannot find here, and cannot explain.
  test('the readable sets are all still offered beside it', () => {
    withUnreadable();
    expect(options().some((o) => o.textContent.includes('Strategic Pricing Plays'))).toBe(true);
  });
});

describe('a refused Create lands in the dialog, not in a browser alert', () => {
  // docs/handoff/billing-experience-2026-09-22.md §1.7: the 402 said "upgrade"
  // and offered nothing to click; it arrived as alert('Failed to create game').
  test('a plan limit is the shared notice, in the owner\'s voice when the server says owner', () => {
    // rejects: telling everybody to "request the Team plan" — only an owner can
    // (22-plan-limit-notice.html; the role is the server's, via `resolve`).
    setup({ refusal: parseUpgradeRequired(402, {
      code: 'upgrade_required',
      limit: { kind: 'sessions', used: 5, included: 5 },
      resolve: { role: 'owner', canRequest: true, canViewBilling: true, org: { name: 'Amara', type: 'personal' }, contacts: [], request: null, resetsOn: '2026-10-01' },
    }) });
    expect(screen.queryByTestId('gsd-refusal')).toBeNull();
    const box = screen.getByTestId('plan-limit-notice');
    expect(box).toHaveTextContent('You’ve used the 5 sessions included this month. Nothing was created.');
    expect(within(box).getByRole('link', { name: 'Request the Team plan' }))
      .toHaveAttribute('href', '/admin?section=billing&request=team');
  });

  test('a member at the limit is told whom to ask, with no request button', () => {
    setup({ refusal: parseUpgradeRequired(402, {
      code: 'upgrade_required',
      limit: { kind: 'sessions', used: 5, included: 5 },
      resolve: { role: 'member', org: { name: 'Northwind', type: 'team' }, contacts: [{ name: 'Dana Whitfield', email: 'dana@x.example', role: 'owner' }], resetsOn: '2026-10-01' },
    }) });
    const box = screen.getByTestId('plan-limit-notice');
    expect(box).toHaveTextContent('Ask an owner or admin to move Northwind to the Team plan.');
    expect(within(box).getByRole('link', { name: /Dana Whitfield/ })).toHaveAttribute('href', 'mailto:dana@x.example');
    expect(within(box).queryByRole('link', { name: /Request/ })).toBeNull();
  });

  test('any other failure is said plainly, with no upgrade link', () => {
    setup({ refusal: { message: 'the question set could not be read' } });
    const box = screen.getByTestId('gsd-refusal');
    expect(box).toHaveTextContent('Could not create the session: the question set could not be read.');
    expect(box.querySelector('a')).toBeNull();
    expect(screen.queryByTestId('plan-limit-notice')).toBeNull();
  });

  test('the host page no longer alerts', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(src).not.toMatch(/alert\(`Failed to create game/);
    expect(src).not.toMatch(/alert\('Failed to create game/);
    expect(src).toMatch(/parseUpgradeRequired\(createResponse, errorData\)/);
  });
});
