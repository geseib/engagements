/**
 * SEEING A QUESTION AS THE ROOM WILL — on the host's own phone.
 *
 *   *"how does a host preview the questions. that same feature should be avail
 *    for the host"*
 *
 * The set editor's preview (components/QuestionPreview.jsx) draws the live
 * stage's card beside a list. This is the same feature on the surface a host
 * actually holds mid-session, and it belongs HERE rather than in the stage's
 * own question browser for one reason: `config/setupPanel.js:browserRow` strips
 * every option out of a stage row on purpose, because the stage renders on the
 * projector. A preview that revealed a trivia answer there would put it on the
 * wall. The phone is in the host's hand.
 *
 * WHAT EACH ASSERTION REJECTS is named, because most of the ways this can break
 * are silent:
 *
 *   - re-drawing the card instead of rendering components/QuestionCard.jsx,
 *     which forks the preview from the room on its first edit;
 *   - staging the wire question into some other shape, when the browsing
 *     endpoint already returns the field names the card reads;
 *   - a Reveal that is on by default, which turns the host's private surface
 *     into a screen that always shows the answer;
 *   - a toggle that resets between questions, so a host paging a trivia set has
 *     to press Reveal thirty times;
 *   - losing the row's own actions, which would make the preview a dead end.
 *
 * jsdom has no layout engine, so nothing here asserts a width, an offset or a
 * font size. Document ORDER is asserted where position carries meaning —
 * `compareDocumentPosition` is real. Colour is measured next door in
 * hostRemotePreviewPalette.test.js.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RemoteQuestionBrowser from '../components/RemoteQuestionBrowser';
import RemoteSessionPanel from '../components/RemoteSessionPanel';
import { authFetch } from '../auth/authFetch';
import { ART_TITLE_INSTRUCTION, GAME_TYPE_INSTRUCTIONS } from '../config/instructions';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/* ----------------------------------------------------------------- fixtures */

/** The shape `admin/get-question-set-questions.js` really returns. */
const TRIVIA_A = {
  id: '001',
  title: 'Which pricing change produced the largest one-year improvement?',
  questionDetail: 'Think about the whole book of business, not one deal.',
  category: 'Pricing Mechanics',
  difficulty: 'Hard',
  optionA: 'A 5% list increase held through renewal',
  optionB: 'Seat-based to usage-based billing',
  optionC: 'A premium support tier at 20% of contract',
  optionD: 'Discounting the entry plan',
  correctAnswer: 'OptionA',
  answerDetails: 'The increase compounds across every renewal in the book.',
};

const TRIVIA_B = {
  id: '002',
  title: 'Which renewal signal predicts churn earliest?',
  category: 'Pricing Power',
  optionA: 'Support ticket volume',
  optionB: 'Seats left unassigned',
  correctAnswer: 'OptionB',
};

/** An art round: call-and-answer carrying the picture, real title in the reveal. */
const ART = {
  id: '010',
  title: 'What would you call this?',
  category: 'Masterpieces',
  image: 'sets/masterpieces/smile.jpg',
  answerDetails: 'Mona Lisa, Leonardo da Vinci, c. 1503.',
};

/** Same format, nothing to reveal. */
const PLAIN = {
  id: '011',
  title: 'Where did this land for your team?',
  questionDetail: 'One sentence is plenty.',
  category: 'Masterpieces',
};

/** Trivia whose stored answer matches none of its own options. */
const TRIVIA_NO_ANSWER = {
  id: '004',
  title: 'Which of these did the board actually approve?',
  optionA: 'A 5% list increase',
  optionB: 'A new support tier',
  correctAnswer: 'None of the above',
};

function serve(questions, setName = 'Strategic Pricing Plays') {
  authFetch.mockImplementation(() => Promise.resolve({
    ok: true,
    json: async () => ({ questions, setName }),
  }));
}

async function mount(questions, props = {}) {
  serve(questions);
  const view = render(
    <RemoteQuestionBrowser setId="pricing" gameType="trivia" onAsk={jest.fn()} {...props} />,
  );
  await screen.findByText(questions[0].title);
  return view;
}

const cardFor = (title) => screen.getByText(title).closest('.hrq-card');
const openPreview = (title) =>
  fireEvent.click(within(cardFor(title)).getByRole('button', { name: /^preview/i }));
const preview = () => screen.getByTestId('hrq-preview');
const screenPane = () => screen.getByTestId('hrq-preview-screen');

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

/* -------------------------------------------------------- opening and closing */

describe('opening the preview, and getting back to the list', () => {
  // rejects: a preview with no way in, and one with no way out. The phone's bar
  // has a single back control and it means "back to the round" — leaving the
  // list is not the same journey as leaving the preview.
  it('opens from a row and closes back to the list', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);

    openPreview(TRIVIA_A.title);
    expect(preview()).toBeInTheDocument();
    // the list is gone: one column, one thing at a time
    expect(screen.queryByText(TRIVIA_B.title)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /all questions/i }));
    expect(screen.queryByTestId('hrq-preview')).not.toBeInTheDocument();
    expect(screen.getByText(TRIVIA_B.title)).toBeInTheDocument();
  });

  // rejects: a search box left on screen under the card. The preview is the
  // whole pane, so the row that opened it is what it shows — nothing else.
  it('reads its position out of the list it was opened from', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);

    openPreview(TRIVIA_B.title);
    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('2 / 2');
  });

  // rejects: a position counted against the whole set while the list is
  // filtered — "3 / 30" beside a list of three reads as a broken counter.
  it('counts within a search, not against the whole set', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);

    fireEvent.change(screen.getByLabelText(/search questions/i), { target: { value: 'renewal' } });
    openPreview(TRIVIA_B.title);

    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('1 / 1');
  });
});

/* ------------------------------------------------------------------ the card */

describe('the card is the stage\'s own, fed the wire\'s own fields', () => {
  // rejects: re-drawing the question in this component's markup. The stage
  // renders components/QuestionCard.jsx and so must this, or the two drift.
  // The classes below ARE the card's contract (__tests__/questionCardDom.test.jsx).
  it('renders QuestionCard\'s heading, prompt and options', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);

    const pane = screenPane();
    expect(pane.querySelector('h1.q')).toHaveTextContent(TRIVIA_A.title);
    expect(within(pane).getByText(TRIVIA_A.questionDetail)).toBeInTheDocument();
    expect([...pane.querySelectorAll('.opt .txt')].map((n) => n.textContent))
      .toEqual([TRIVIA_A.optionA, TRIVIA_A.optionB, TRIVIA_A.optionC, TRIVIA_A.optionD]);
  });

  // rejects: staging the wire row through some adapter. The browsing endpoint
  // already returns `title` / `questionDetail` / `image` / `optionA…` /
  // `correctAnswer` / `customInstructions` — the very names the card reads — so
  // an adapter here would be a second spelling to keep in step for no gain.
  it('draws the artwork from the stored media key, as the stage does', async () => {
    await mount([ART], { gameType: 'call-and-answer' });
    openPreview(ART.title);

    expect(screenPane().querySelector('img.stage-art')).toHaveAttribute('src', ART.image);
  });

  // rejects: the card deciding what the room is told. `instruction` is a prop
  // on purpose, and an art round's line is the artwork's, not call-and-answer's.
  it('carries the instruction the room would be given', async () => {
    await mount([ART, PLAIN], { gameType: 'call-and-answer' });
    openPreview(ART.title);
    expect(within(screenPane()).getByText(ART_TITLE_INSTRUCTION)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /all questions/i }));
    openPreview(PLAIN.title);
    expect(within(screenPane()).getByText(GAME_TYPE_INSTRUCTIONS['call-and-answer']))
      .toBeInTheDocument();
  });

  // rejects: a raw server game type reaching the card. `trivia` is compared as
  // a literal there and in config/instructions.js, so an alias or a capital
  // would silently draw a trivia question as free text with no options at all.
  it('normalises the session\'s game type before the card sees it', async () => {
    await mount([TRIVIA_A], { gameType: 'Trivia' });
    openPreview(TRIVIA_A.title);

    expect(screenPane().querySelectorAll('.opt')).toHaveLength(4);
  });

  // rejects: reaching for :root to get the Table ladder onto the card. The host
  // page can have a live stage mounted, and re-profiling the document would
  // resize the projector mid-session (components/stage/Stage.jsx owns that class).
  it('reaches the Table ladder through the scope class, never the document', async () => {
    const before = document.documentElement.outerHTML.split('>')[0];
    await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);

    expect(screenPane()).toHaveClass('stage-ladder-table');

    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screenPane().querySelector('h1.q')).toHaveTextContent(TRIVIA_B.title);
    expect(document.documentElement.outerHTML.split('>')[0]).toBe(before);
  });

  it('never names documentElement in the source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'RemoteQuestionBrowser.jsx'), 'utf8',
    );
    expect(src.includes('documentElement')).toBe(false);
  });
});

/* ----------------------------------------------------------------- the reveal */

describe('the answer, and the deliberate step to it', () => {
  // rejects: a card that arrives revealed. This surface may show the answer —
  // it is the only one that may — but the host asks for it.
  it('starts on ASK, with nothing marked correct', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);

    expect(screen.getByRole('button', { name: /^ask$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screenPane().querySelectorAll('.opt.correct')).toHaveLength(0);
  });

  // rejects: a Reveal that only dims. The correct option is what the host needs.
  it('marks the correct option once Reveal is pressed', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    const pane = screenPane();
    expect(pane.querySelector('.opt.correct .txt')).toHaveTextContent(TRIVIA_A.optionA);
    expect(pane.querySelectorAll('.opt.dim')).toHaveLength(3);
    // and the question stays above its own answer: four answers with nothing
    // saying what was asked is not a preview of anything.
    expect(pane.querySelector('h1.q')).toHaveTextContent(TRIVIA_A.title);
  });

  // rejects: per-question reveal state. A host paging a trivia set would press
  // Reveal on every one of them.
  it('stays revealed as the host pages to the next question', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    expect(screenPane().querySelector('h1.q')).toHaveTextContent(TRIVIA_B.title);
    expect(screen.getByRole('button', { name: /^reveal$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screenPane().querySelector('.opt.correct .txt')).toHaveTextContent(TRIVIA_B.optionB);
  });

  // rejects: gating Reveal on trivia. An art set is call-and-answer and keeps
  // the artwork's real title in `answerDetails` — the exact answer a host wants
  // to check before reading it out.
  it('is offered for any set that carries a reveal, not trivia alone', async () => {
    await mount([ART, PLAIN], { gameType: 'call-and-answer' });
    openPreview(PLAIN.title);

    expect(screen.getByRole('button', { name: /^reveal$/i })).toBeInTheDocument();
  });

  // rejects: rendering a control that can do nothing. A set with no answer
  // anywhere in it has nothing behind Reveal.
  it('is not offered for a set with no reveal in it at all', async () => {
    await mount([PLAIN], { gameType: 'call-and-answer' });
    openPreview(PLAIN.title);

    expect(screen.queryByRole('button', { name: /^reveal$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ask$/i })).not.toBeInTheDocument();
  });

  // rejects: putting the reveal text on the card. The stage's RESULTS never
  // draws it — it reaches players only in the round report — so a host who read
  // it off a card that looked like the room's screen would be reading out
  // something the room cannot see and would not know it.
  it('shows the reveal note outside the screen, labelled', async () => {
    await mount([ART], { gameType: 'call-and-answer' });
    openPreview(ART.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    const note = screen.getByTestId('hrq-preview-note');
    expect(note).toHaveTextContent(ART.answerDetails);
    expect(note.querySelector('b')).toHaveTextContent(/only after the round/i);
    expect(screenPane().contains(note)).toBe(false);
    // and it is below the screen, where the eye reaches it after the card
    expect(screenPane().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  // rejects: a Reveal that silently does nothing on the one question of the set
  // that has no answer. The control is offered for the SET so it holds still
  // while paging; the question has to say for itself that it carries none.
  it('says so when the question paged to has no reveal of its own', async () => {
    await mount([ART, PLAIN], { gameType: 'call-and-answer' });
    openPreview(ART.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    expect(screen.getByTestId('hrq-preview-note')).toHaveTextContent(/no reveal of its own/i);
  });

  // rejects: a Reveal that dims all four options, marks none and prints nothing —
  // a control that looks like it fired and said nothing. The LIST already handles
  // this case in words (`.hrq-unresolved`), so the preview says the same thing in
  // the same words rather than inventing a second sentence for one fact.
  it('says the set names no right answer instead of dimming everything in silence', async () => {
    await mount([TRIVIA_NO_ANSWER]);
    const inTheList = cardFor(TRIVIA_NO_ANSWER.title)
      .querySelector('.hrq-unresolved').textContent.trim();

    openPreview(TRIVIA_NO_ANSWER.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    // nothing marked on the card, and the reason printed off it
    expect(screenPane().querySelectorAll('.opt.correct')).toHaveLength(0);
    const said = screen.getByTestId('hrq-preview-unresolved');
    expect(said).toHaveTextContent(inTheList);
    expect(screenPane().contains(said)).toBe(false);
  });

  // rejects: printing the line whenever the answer is merely not on screen yet.
  // ASK marks nothing on purpose; only Reveal promises a mark.
  it('says nothing of the kind before Reveal is pressed', async () => {
    await mount([TRIVIA_NO_ANSWER]);
    openPreview(TRIVIA_NO_ANSWER.title);

    expect(screen.queryByTestId('hrq-preview-unresolved')).not.toBeInTheDocument();
  });

  // rejects: showing the line on a question whose answer IS resolvable, which
  // would say the set is broken when it is not.
  it('says nothing of the kind when Reveal does mark an answer', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    expect(screen.queryByTestId('hrq-preview-unresolved')).not.toBeInTheDocument();
  });

  // rejects: sending a non-trivia question to the card as REVEAL, which renders
  // nothing at all there (QuestionCard returns null) — a blank screen where the
  // room would see the question.
  it('leaves a non-trivia card exactly as the room sees it while revealing', async () => {
    await mount([ART], { gameType: 'call-and-answer' });
    openPreview(ART.title);
    const asked = screenPane().innerHTML;

    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));
    expect(screenPane().innerHTML).toBe(asked);
  });
});

/* ------------------------------------------------- one answer, one lettering */

/**
 * A HOLE IN THE SLOTS — the only fixture that can tell the two letterings apart.
 *
 * `config/questionCard.js:triviaOptions` letters the options the card DRAWS, by
 * position among the FILLED slots, so optionA / optionC / optionD are A, B, C on
 * the room's screen. Lettering by slot instead would call them A, C, D — and the
 * list and the card are one tap apart on this phone, so the host would read out
 * whichever of the two they happened to be looking at.
 *
 * The stored answer is the spelling CLAUDE.md mandates. It is also the spelling
 * that makes `isCorrectTriviaOption` match TWICE here — once on the slot
 * (`optionC`) and once on the positional letter of optionD, which is drawn as C
 * (config/questionPreview.js records this) — so it pins the mark as well as the
 * letter.
 */
const TRIVIA_GAP = {
  id: '003',
  title: 'Which lever moved the number?',
  optionA: 'Raised list price',
  optionC: 'Bundled onboarding',
  optionD: 'Cut the entry tier',
  correctAnswer: 'OptionC',
};

/*
 * THE LIST AND THE CARD ARE ONE TAP APART, so a host can read out whichever of
 * them they happen to be looking at. The room's card is the truth — the stage
 * renders components/QuestionCard.jsx — so the list letters and marks as it does,
 * and the fixture above is the one where "as it does" is not "as the slots are
 * named".
 */
describe('the list letters and marks exactly as the room does', () => {
  // rejects: lettering by slot (A, C, D). The room letters the options it DRAWS,
  // so a set with a hole in its slots would have the phone calling the room's B
  // "C" — and the host reads the letter out.
  it('letters a question with a hole in its slots by position, on both', async () => {
    await mount([TRIVIA_GAP]);
    const inTheList = [...cardFor(TRIVIA_GAP.title).querySelectorAll('.hrq-opts li b')]
      .map((node) => node.textContent);

    openPreview(TRIVIA_GAP.title);
    const onTheCard = [...screenPane().querySelectorAll('.opt .ltr')]
      .map((node) => node.textContent);

    expect(onTheCard).toEqual(['A', 'B', 'C']);
    expect(inTheList).toEqual(onTheCard);
  });

  // rejects: handing the card the stored `correctAnswer`. game/get-question.js
  // rewrites it to the option's own TEXT before the room ever sees it; the
  // browsing endpoint does not, and "OptionC" matches BOTH the optionC slot and
  // the option DRAWN as C — two answers marked where the room marks one.
  it('marks one option, and the same one the list flags', async () => {
    await mount([TRIVIA_GAP]);
    const flagged = cardFor(TRIVIA_GAP.title).querySelectorAll('.hrq-opts li.is-right');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].querySelector('b')).toHaveTextContent('B');

    openPreview(TRIVIA_GAP.title);
    fireEvent.click(screen.getByRole('button', { name: /^reveal$/i }));

    const marked = [...screenPane().querySelectorAll('.opt.correct')];
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector('.ltr')).toHaveTextContent('B');
    expect(marked[0].querySelector('.txt')).toHaveTextContent(TRIVIA_GAP.optionC);
  });
});

/* ------------------------------------------------------------------ paging */

describe('paging without leaving the card', () => {
  // rejects: going back to the list between questions, which is the whole point
  // of the view.
  it('steps forward and back, wrapping at both ends', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('2 / 2');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('1 / 2');
    fireEvent.click(screen.getByRole('button', { name: /^previous$/i }));
    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('2 / 2');
  });

  // rejects: two live controls that both wrap onto the question already shown —
  // and a silently held pair, which is the same dead button with the colour
  // changed. Held and saying why, not removed: the chrome must not change shape
  // as a search narrows to one result under the host's thumb.
  it('holds both steps, with the reason, when the list holds one question', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);

    for (const name of [/^next$/i, /^previous$/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', expect.stringMatching(/only question/i));
    }
    expect(screen.getByTestId('hrq-preview-position')).toHaveTextContent('1 / 1');
  });

  /*
   * EVERYTHING THE HOST OPERATES IS ABOVE THE CARD, and on a phone that is
   * load-bearing rather than cosmetic: a stage composition in a 390px column
   * runs past the fold, so a step control placed under the card would be reached
   * only by scrolling past the whole question — and paging from down there would
   * change the options under a heading the host could no longer see.
   *
   * jsdom gives every rect zero, so "above" can only be asserted as document
   * order — which `compareDocumentPosition` does model.
   */
  it('draws the way back, the toggle and the steps before the screen', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);

    const pane = screenPane();
    const before = [
      screen.getByRole('button', { name: /all questions/i }),
      screen.getByRole('group', { name: /what the card shows/i }),
      screen.getByRole('button', { name: /^previous$/i }),
      screen.getByTestId('hrq-preview-position'),
      screen.getByRole('button', { name: /^next$/i }),
    ];
    for (const node of before) {
      expect(pane.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    }
    // and the one committing action is after it: the host reads the question, then
    // decides.
    expect(pane.compareDocumentPosition(
      within(preview()).getByRole('button', { name: /ask this next/i }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // rejects: stepping through the whole set from inside a filtered list, which
  // would page to a question the host cannot see a reason for.
  it('steps inside the search the preview was opened from', async () => {
    await mount([TRIVIA_A, TRIVIA_B]);
    fireEvent.change(screen.getByLabelText(/search questions/i), { target: { value: 'renewal' } });
    openPreview(TRIVIA_B.title);

    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
    expect(screenPane().querySelector('h1.q')).toHaveTextContent(TRIVIA_B.title);
  });

  /*
   * THE SET CHANGES UNDER AN OPEN PREVIEW. This browser reads the set once per
   * `setId`, so the list only moves when the host switches the session's set —
   * and then the question on the card may not exist any more. Closing back to
   * the list is the honest move: the list is showing what there IS now, and a
   * card left drawing a question from a set the session no longer plays would
   * be a question the host cannot ask.
   */
  it('falls back to the list when the previewed question leaves the set', async () => {
    const view = await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);
    expect(preview()).toBeInTheDocument();

    serve([ART], 'Masterpieces');
    view.rerender(
      <RemoteQuestionBrowser setId="art" gameType="call-and-answer" onAsk={jest.fn()} />,
    );

    await screen.findByText(ART.title);
    expect(screen.queryByTestId('hrq-preview')).not.toBeInTheDocument();
  });

  // rejects: keeping the lost id in state. The list is re-read per `setId`, so a
  // host who switched set and switched back would find the preview springing
  // open on a question they had left behind two sets ago.
  it('does not spring back open when the old set returns', async () => {
    const view = await mount([TRIVIA_A, TRIVIA_B]);
    openPreview(TRIVIA_A.title);

    serve([ART], 'Masterpieces');
    view.rerender(<RemoteQuestionBrowser setId="art" gameType="call-and-answer" onAsk={jest.fn()} />);
    await screen.findByText(ART.title);

    serve([TRIVIA_A, TRIVIA_B]);
    view.rerender(<RemoteQuestionBrowser setId="pricing" gameType="trivia" onAsk={jest.fn()} />);
    await screen.findByText(TRIVIA_A.title);

    expect(screen.queryByTestId('hrq-preview')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------- the row's own action */

describe('what the row could already do, it can still do', () => {
  // rejects: a preview that is a dead end. The host opened it to decide, and
  // deciding means asking this one next.
  it('asks the previewed question from inside the preview', async () => {
    const onAsk = jest.fn().mockResolvedValue(undefined);
    await mount([TRIVIA_A, TRIVIA_B], { onAsk });

    openPreview(TRIVIA_B.title);
    fireEvent.click(within(preview()).getByRole('button', { name: /ask this next/i }));

    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));
    expect(onAsk.mock.calls[0][0]).toMatchObject({ id: TRIVIA_B.id, title: TRIVIA_B.title });
  });

  // rejects: the list losing its own Ask when the preview was added beside it.
  it('still asks straight from a row', async () => {
    const onAsk = jest.fn().mockResolvedValue(undefined);
    await mount([TRIVIA_A], { onAsk });

    fireEvent.click(within(cardFor(TRIVIA_A.title)).getByRole('button', { name: /ask this next/i }));

    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));
  });

  // rejects: an Ask that fires while the session is already moving. The remote
  // owns the cooldown; the preview has to respect the same flag the list does.
  it('holds Ask while the remote is busy', async () => {
    await mount([TRIVIA_A], { busy: true });
    openPreview(TRIVIA_A.title);

    expect(within(preview()).getByRole('button', { name: /ask this next/i })).toBeDisabled();
  });

  // rejects: dropping the line that says why this surface may show the answer.
  it('keeps the private-to-this-phone note beside the answer', async () => {
    await mount([TRIVIA_A]);
    openPreview(TRIVIA_A.title);

    expect(within(preview()).getByText(/appear here and nowhere else/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- the call site */

describe('the session panel hands the browser the game\'s own type', () => {
  // rejects: a correct component wired to nothing. Without the type the card
  // would draw every trivia question as free text — no options, and the
  // instruction line of a different game.
  it('renders a trivia card through the Questions tab', async () => {
    serve([TRIVIA_A]);
    render(
      <RemoteSessionPanel
        gameId="4821"
        setId="pricing"
        initialTab="questions"
        gameType="trivia"
        state="ASK#003"
      />,
    );

    await screen.findByText(TRIVIA_A.title);
    openPreview(TRIVIA_A.title);

    expect(screenPane().querySelectorAll('.opt')).toHaveLength(4);
    expect(within(screenPane()).getByText(GAME_TYPE_INSTRUCTIONS.trivia)).toBeInTheDocument();
  });
});

/* ------------------------------------------------- the stage browser, untouched */

describe('the stage\'s browser is not drawn into this', () => {
  /*
   * `config/setupPanel.js:browserRow` is an allow-list that carries no option
   * and no answer, because the stage's browser renders on the projector. This
   * feature is the reason someone would "unify" the two — so the guard is
   * restated here, next to the surface that tempts it.
   */
  it('setupPanel still strips every option and every answer', () => {
    // eslint-disable-next-line global-require
    const { browserRow } = require('../config/setupPanel');
    const row = browserRow(TRIVIA_A);
    // Not a key named for an option (`optionCount` is the allow-list's own
    // count, which carries no text), and not a VALUE equal to any option or to
    // the stored answer — the three spellings a set records it in included.
    expect(Object.keys(row).filter((k) => /^(option[A-F]|correctAnswer)$/i.test(k))).toEqual([]);
    const values = Object.values(row).map((v) => String(v));
    for (const leak of [TRIVIA_A.correctAnswer, TRIVIA_A.optionA, TRIVIA_A.optionB,
      TRIVIA_A.optionC, TRIVIA_A.optionD, 'A']) {
      expect(values).not.toContain(leak);
    }
  });
});
