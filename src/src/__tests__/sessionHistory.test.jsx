/**
 * GOING BACK THROUGH ROUNDS THAT ALREADY HAPPENED.
 *
 *   "once you move on to a new question it would be nice to go back through AI
 *    responses, and results screens. perhaphs there is even a session tab that
 *    list questions so far, and lists those."
 *
 * The owner chose both shapes when asked — a tab listing the rounds AND arrows
 * between neighbours — with each round showing the question, its results, its
 * AI summary, and a way to regenerate that summary.
 *
 * NO NEW BACKEND. `POST /games/{gameId}/report` already returns every one of
 * those fields; `roundsFrom` normalises what create-report.js emits. So most of
 * what can go wrong here is in the normalising and in the edges of the stepping,
 * which is what these test.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PastRound from '../components/PastRound';
import {
  roundsFrom, roundSubtitle, hasSummary, indexOfRound,
  answersFrom, snippetOf, podiumAnswers, roundIsAttributed,
} from '../config/sessionHistory';

/**
 * A report payload shaped the way create-report.js ACTUALLY emits one.
 *
 * THIS USED TO BE `{ detailedQuestions }` AND THAT IS WHY THE TAB SHIPPED
 * EMPTY. `POST /games/{gameId}/report` returns
 * `{ success, gameId, report: { … detailedQuestions … }, message }` —
 * create-report.js:674-681. The old fixture agreed with my reading of the
 * client and disagreed with the server, so every test here passed while a
 * completed round showed "No rounds yet."
 *
 * A fixture invented to match the code under test proves only that the code is
 * self-consistent. This one is copied from the handler's return statement.
 */
const report = (overrides = []) => ({
  success: true,
  gameId: '4821',
  report: { detailedQuestions: overrides },
  message: 'Game report created successfully',
});

/** The inner object, which is what the stored REPORT row and GET hand back. */
const storedReport = (overrides = []) => ({ detailedQuestions: overrides });

const q = (number, extra = {}) => ({
  questionNumber: number,
  questionData: { title: `Round ${number}`, category: 'Strategy', ...(extra.questionData || {}) },
  answers: extra.answers || [],
  voteStats: extra.voteStats || null,
  aiSummary: extra.aiSummary ?? null,
});

/**
 * ONE RANKED ANSWER ROW, IN THE SHAPE create-report.js ACTUALLY BUILDS ONE.
 *
 * THE SECOND HALF OF THE SAME MISTAKE THE ENVELOPE COMMENT ABOVE DESCRIBES.
 * The answer rows in this file used to be written `{ answer, playerName, rank }`
 * — invented from `PastRound`'s JSX, not copied from the handler. create-report
 * emits `answerText`, `totalScore` and the three placement tallies
 * (create-report.js:384-415); nothing on that route has ever written `answer`.
 * So `PastRound` rendered `answer.answer` for every past round, printed
 * nothing, and the suite stayed green: *"the actual answers are not there"*.
 *
 * `playerName` is OMITTED, never nulled, on a round whose authors are still
 * hidden — create-report.js:344-354 spells that rule out — so `hidden()` below
 * omits the key rather than passing undefined.
 */
const answerRow = ({
  text, name, rank = 1, score = 3, first = 1, second = 0, third = 0, index = 0,
}) => ({
  answerIndex: index,
  ...(name === undefined ? {} : { playerName: name }),
  answerText: text,
  totalScore: score,
  firstPlace: first,
  secondPlace: second,
  thirdPlace: third,
  voteBreakdown: `${first} first, ${second} second, ${third} third`,
  rank,
  rankDisplay: rank === 1 ? '🥇 1st Place' : `${rank}th Place`,
});

describe('turning a report into a list of rounds', () => {
  // rejects: THE ORDERING BUG THIS IS MOST LIKELY TO HAVE. create-report builds
  //          `detailedQuestions` from a Map keyed by strings, and string order
  //          puts "10" before "2". A history list that shows round ten second
  //          is not a history list.
  test('rounds come back in the order they were played', () => {
    const rounds = roundsFrom(report([q('10'), q('2'), q('1')]));
    expect(rounds.map((r) => r.ordinal)).toEqual([1, 2, 10]);
  });

  // rejects: THE REPORTED BUG — reading `detailedQuestions` one level too high.
  //          The POST route wraps it in `report`, so this returned undefined for
  //          every session and the tab said "No rounds yet" after a completed
  //          round.
  test('it reads through the POST envelope', () => {
    expect(roundsFrom(report([q('1')])).map((r) => r.ordinal)).toEqual([1]);
  });

  // rejects: fixing the envelope by hard-coding the OTHER shape. The stored
  //          REPORT row is the inner object, so GET hands back the unwrapped
  //          form and a reader that insists on the wrapper breaks on it.
  test('it also reads the unwrapped shape the stored report uses', () => {
    expect(roundsFrom(storedReport([q('1')])).map((r) => r.ordinal)).toEqual([1]);
  });

  // rejects: handing the AI-summary endpoint an unpadded number. It takes
  //          `questionId` in the padded form the rest of the system uses, so
  //          Regenerate on round 2 would address a round that does not exist.
  test('the round number is padded, ready to send back', () => {
    expect(roundsFrom(report([q('2')]))[0].number).toBe('002');
  });

  // rejects: losing the question. The owner asked for it explicitly, and a
  //          results screen with no question on it is unreadable a quarter of
  //          an hour later.
  test('the question survives, under either of its two names', () => {
    const withDetail = roundsFrom(report([q('1', {
      questionData: { title: 'What matters', detail: 'the long form' },
    })]))[0];
    expect(withDetail.title).toBe('What matters');
    expect(withDetail.detail).toBe('the long form');

    // Trivia rounds carry the same text under `questionDetail` instead.
    const trivia = roundsFrom(report([q('1', {
      questionData: { title: 'Capital?', questionDetail: 'Of France' },
    })]))[0];
    expect(trivia.detail).toBe('Of France');
  });

  // rejects: dropping the trivia options and the correct answer. A past round
  //          is exactly where somebody goes to check what the answer was.
  test('trivia options and the answer come through', () => {
    const round = roundsFrom(report([q('1', {
      questionData: {
        optionA: 'Berlin', optionB: 'Paris', optionD: 'Madrid',
        correctAnswer: 'OptionB', answerDetails: 'It has been since 987.',
      },
    })]))[0];
    // Blank slots are dropped rather than rendered as empty bullets.
    expect(round.options).toEqual(['Berlin', 'Paris', 'Madrid']);
    expect(round.correctAnswer).toBe('OptionB');
    expect(round.answerDetails).toBe('It has been since 987.');
  });

  // rejects: a payload with nothing in it throwing. A session in its first
  //          minutes has no report at all, which is the normal state, not an
  //          error.
  test('an empty or missing payload is an empty list', () => {
    expect(roundsFrom(null)).toEqual([]);
    expect(roundsFrom({})).toEqual([]);
    expect(roundsFrom(report([]))).toEqual([]);
  });

  // rejects: a summary object that exists but holds nothing readable being
  //          counted as a summary — generation failed part way, or the row is
  //          old. Both the list badge and the button's label key off this, and
  //          both would lie.
  test('an empty summary object does not count as a summary', () => {
    expect(hasSummary({ aiSummary: null })).toBe(false);
    expect(hasSummary({ aiSummary: {} })).toBe(false);
    expect(hasSummary({ aiSummary: { summaryText: '   ' } })).toBe(false);
    expect(hasSummary({ aiSummary: { summaryText: 'It went well.' } })).toBe(true);
    expect(hasSummary({ aiSummary: { discussionQuestions: ['Why?'] } })).toBe(true);
  });

  // rejects: a bare number where a sentence belongs, and a singular "1
  //          responses".
  test('the row subtitle reads as a sentence', () => {
    expect(roundSubtitle({ category: 'Strategy', answers: [1, 2] })).toBe('Strategy · 2 responses');
    expect(roundSubtitle({ category: '', answers: [1] })).toBe('1 response');
    expect(roundSubtitle({ answers: [] })).toBe('0 responses');
  });

  // rejects: looking a round up by position. The arrows step by position, but a
  //          caller opening a round from elsewhere has a NUMBER — and after
  //          sorting the two are not the same thing.
  test('a round can be found by its number, padded or not', () => {
    const rounds = roundsFrom(report([q('10'), q('2')]));
    expect(indexOfRound(rounds, '2')).toBe(0);
    expect(indexOfRound(rounds, '002')).toBe(0);
    expect(indexOfRound(rounds, 10)).toBe(1);
    expect(indexOfRound(rounds, 99)).toBe(-1);
  });
});

/*
 * THE ANSWER ROWS, WHICH THE ROUNDS TAB HAS NEVER ONCE RENDERED.
 *
 * `POST /report` speaks a different dialect from `GET /answers`, and every
 * dialog in this product was written against the second one.
 */
describe('the answers a round came back with', () => {
  // rejects: THE REPORTED DEFECT — "the actual answers are not there".
  //          create-report writes the text as `answerText`; the dialogs read
  //          `answer`. Nothing on that route has ever written `answer`.
  test('the report’s answerText becomes the answer the dialogs read', () => {
    const [row] = answersFrom({ answers: [answerRow({ text: 'We should ship it', name: 'Ada' })] });
    expect(row.answer).toBe('We should ship it');
    expect(row.playerName).toBe('Ada');
  });

  // rejects: hard-coding the report's spelling and breaking the live payload,
  //          whose rows carry `answer` instead. One normaliser, both routes.
  test('a live `answer` row still normalises', () => {
    const [row] = answersFrom({ answers: [{ answer: 'From /answers', playerName: 'Grace', points: 2, votes: 1 }] });
    expect(row.answer).toBe('From /answers');
    expect(row.points).toBe(2);
    expect(row.votes).toBe(1);
  });

  // rejects: nulling or defaulting the author of a round the server redacted.
  //          The omit-don't-null rule is what lets config/anonymity.js answer
  //          the label question from the row; a `playerName: null` would make
  //          every redacted row indistinguishable from a bug.
  test('a redacted row keeps no author key at all', () => {
    const [row] = answersFrom({ answers: [answerRow({ text: 'Unattributed' })] });
    expect(row).not.toHaveProperty('playerName');
    expect(row.answer).toBe('Unattributed');
  });

  // rejects: losing the placement tallies. The spotlight prints "+3" and "2
  //          votes", and the report keeps those apart as totalScore and three
  //          placement counts.
  test('the score and the vote count survive the shape change', () => {
    const [row] = answersFrom({
      answers: [answerRow({ text: 'x', name: 'Ada', score: 5, first: 1, second: 1, third: 2 })],
    });
    expect(row.points).toBe(5);
    expect(row.votes).toBe(4);
  });

  test('a round with no answers is an empty list, not a throw', () => {
    expect(answersFrom(null)).toEqual([]);
    expect(answersFrom({})).toEqual([]);
  });

  // rejects: an ellipsis on an answer that already fits, which makes a
  //          complete response read as a truncated one.
  test('a short answer is not truncated', () => {
    expect(snippetOf('Short and complete.')).toBe('Short and complete.');
  });

  // rejects: cutting mid-word, which reads as a corrupted value rather than as
  //          an opening.
  test('a long answer is cut at a word boundary and marked', () => {
    const long = `${'word '.repeat(40)}end`;
    const cut = snippetOf(long, 30);
    expect(cut.length).toBeLessThanOrEqual(31);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/wor…$/);
  });

  // rejects: returning the whole wall of text when there is no space to cut
  //          at — a pasted URL or a 200-character unbroken string.
  test('an unbroken string is still cut', () => {
    const cut = snippetOf('x'.repeat(200), 30);
    expect(cut.length).toBe(31);
  });

  // rejects: offering more than the three the owner asked for, or re-sorting
  //          rows create-report already ranked.
  test('the podium is the first three, in the order they arrived', () => {
    const answers = ['a', 'b', 'c', 'd'].map((t, i) => answerRow({ text: t, name: t, rank: i + 1, index: i }));
    const round = { answers: answersFrom({ answers }) };
    expect(podiumAnswers(round).map((r) => r.answer)).toEqual(['a', 'b', 'c']);
    expect(podiumAnswers({ answers: [] })).toEqual([]);
  });

  // rejects: printing a score beside a response on a round whose authors are
  //          still hidden (§5.6.4 — the scores go wherever the names go), and
  //          claiming a round with no responses is attributed.
  test('a round is attributed only when every row carries its author', () => {
    expect(roundIsAttributed({ answers: answersFrom({ answers: [answerRow({ text: 'x', name: 'Ada' })] }) })).toBe(true);
    expect(roundIsAttributed({ answers: answersFrom({ answers: [answerRow({ text: 'x' })] }) })).toBe(false);
    expect(roundIsAttributed({ answers: [] })).toBe(false);
  });
});

describe('reopening one round', () => {
  const rounds = roundsFrom(report([
    q('1', {
      questionData: { title: 'First question', detail: 'Some context' },
      answers: [
        answerRow({ text: 'A good answer', name: 'Ada', rank: 1, score: 3, index: 0 }),
        answerRow({ text: 'A second answer', name: 'Grace', rank: 2, score: 1, first: 0, second: 1, index: 1 }),
      ],
      aiSummary: { summaryText: 'The room agreed.', discussionQuestions: ['And then?'] },
    }),
    q('2', { questionData: { title: 'Second question' }, answers: [] }),
  ]));

  function mount(props = {}) {
    const onIndex = jest.fn();
    const onClose = jest.fn();
    const onRegenerate = jest.fn();
    const utils = render(
      <PastRound
        rounds={rounds}
        index={0}
        onIndex={onIndex}
        onClose={onClose}
        onRegenerate={onRegenerate}
        {...props}
      />,
    );
    return { ...utils, onIndex, onClose, onRegenerate };
  }

  // rejects: THE THREE THINGS THE OWNER ASKED A PAST ROUND TO SHOW, all at once.
  test('it shows the question, the results and the AI summary', () => {
    mount();
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Some context')).toBeInTheDocument();
    expect(screen.getByText('A good answer')).toBeInTheDocument();
    expect(screen.getByText('The room agreed.')).toBeInTheDocument();
    expect(screen.getByText('And then?')).toBeInTheDocument();
  });

  test('a null index renders nothing', () => {
    const { container } = mount({ index: null });
    expect(container).toBeEmptyDOMElement();
  });

  // rejects: an empty round rendering as a blank panel, which reads as a failed
  //          load and sends the host hunting for a bug that is not there.
  test('a round nobody answered says so', () => {
    mount({ index: 1 });
    expect(screen.getByText(/nobody responded/i)).toBeInTheDocument();
  });

  test('the X and the backdrop both close it', () => {
    const { onClose, container } = mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.past-round__scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // rejects: dropping the arrows the owner explicitly chose alongside the list.
  test('the arrows step between neighbouring rounds', () => {
    const { onIndex } = mount();
    fireEvent.click(screen.getByRole('button', { name: /next round/i }));
    expect(onIndex).toHaveBeenCalledWith(1);
  });

  test('the pager is disabled at the ends', () => {
    const first = mount({ index: 0 });
    expect(screen.getByRole('button', { name: /previous round/i })).toBeDisabled();
    first.unmount();
    mount({ index: 1 });
    expect(screen.getByRole('button', { name: /next round/i })).toBeDisabled();
  });

  test('arrow keys step too, and stop once it closes', () => {
    const { onIndex, unmount } = mount();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(1);
    unmount();
    onIndex.mockClear();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).not.toHaveBeenCalled();
  });

  // rejects: sending the index where the endpoint takes a padded round number.
  //          Round 2 at position 1 would regenerate whatever round "1" is.
  test('regenerate names the round, not its position', () => {
    const { onRegenerate } = mount({ index: 1 });
    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    expect(onRegenerate).toHaveBeenCalledWith('002');
  });

  // rejects: offering "Regenerate" over a round that has no summary, which
  //          invites the reasonable question of what is being regenerated.
  test('the button says what it will actually do', () => {
    const withOne = mount({ index: 0 });
    expect(screen.getByRole('button', { name: /^regenerate summary$/i })).toBeInTheDocument();
    withOne.unmount();
    mount({ index: 1 });
    expect(screen.getByRole('button', { name: /^generate summary$/i })).toBeInTheDocument();
  });

  // rejects: leaving the button live while a worker is running, so a host
  //          presses it four times and queues four generations.
  test('it says it is working and refuses a second press', () => {
    const { onRegenerate } = mount({ regenerating: ['001'] });
    const button = screen.getByRole('button', { name: /regenerating/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  /*
    WHO WROTE WHAT.

    THE PREDICATE MOVED, AND THAT IS THE FIX. This dialog used to take a
    `labelFor` prop, and the host page passed it the CURRENT round's
    `authorsHiddenNow(...)`. Every past round was therefore relabelled by
    whether the round in play had been revealed — so during round four's ASK,
    rounds one to three showed "Response 1, 2, 3" with their authors sitting
    unread in the payload. The owner reported it as "the responses are just
    listed anonymous, and they should not".

    create-report.js decides this PER ROUND, through the same isHidden() gate
    as GET /answers, and omits `playerName` from the rounds that are still
    hidden. So the row is the decision, and `displayLabelFor` — anonymity.js's
    reader for a payload the server redacted — is the only thing asked.
  */
  // rejects: THE REPORTED DEFECT. A round that came back attributed must print
  //          its authors, whatever the round in play is doing.
  test('a round that came back with its authors shows them', () => {
    mount();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  // rejects: "fixing" the above by printing names the server did not send.
  //          A round abandoned mid-vote arrives redacted and must stay so.
  test('a round the server redacted stays redacted', () => {
    const hiddenRounds = roundsFrom(report([q('1', {
      answers: [answerRow({ text: 'Unattributed answer', rank: 1 })],
    })]));
    render(
      <PastRound rounds={hiddenRounds} index={0} onIndex={jest.fn()} onClose={jest.fn()} onRegenerate={jest.fn()} />,
    );
    expect(screen.getByText('Response 1')).toBeInTheDocument();
    expect(screen.queryByText(/anonymous/i)).not.toBeInTheDocument();
  });
});

/*
 * READING ONE RESPONSE PROPERLY, FROM A ROUND THAT ALREADY HAPPENED.
 *
 *   "i do like the brief bar of the answers, but i think we need an easy way to
 *    review these in detail. so if each of the 3 has a number in a circle, the
 *    start of their answer, their name and you click that number the full modal
 *    shows there answer. any key takes you back to the review overview page for
 *    the question they were looking at."
 *
 * jsdom has no layout engine, so "a number in a circle" cannot be tested as
 * geometry — the circle is a stylesheet fact. What CAN be tested is everything
 * the sentence actually promises: the number is a control, it names whose
 * response it opens, pressing it shows the full text, and a keypress comes back
 * to the same round.
 */
describe('opening one response in full', () => {
  const long = `${'A deliberately long response that will not fit in the row. '.repeat(4)}Final clause.`;
  const rounds = roundsFrom(report([
    q('1', {
      questionData: { title: 'First question' },
      answers: [
        answerRow({ text: long, name: 'Ada', rank: 1, score: 3, index: 0 }),
        answerRow({ text: 'Second', name: 'Grace', rank: 2, score: 2, first: 0, second: 1, index: 1 }),
        answerRow({ text: 'Third', name: 'Katherine', rank: 3, score: 1, first: 0, third: 1, index: 2 }),
        answerRow({ text: 'Fourth', name: 'Hedy', rank: 4, score: 0, first: 0, index: 3 }),
      ],
    }),
    q('2', { questionData: { title: 'Second question' }, answers: [] }),
  ]));

  function mount(props = {}) {
    const onIndex = jest.fn();
    const onClose = jest.fn();
    const utils = render(
      <PastRound
        rounds={rounds}
        index={0}
        onIndex={onIndex}
        onClose={onClose}
        onRegenerate={jest.fn()}
        {...props}
      />,
    );
    return { ...utils, onIndex, onClose };
  }

  const openers = () => screen.getAllByRole('button', { name: /read response .* in full/i });

  // rejects: rendering the number as inert text. "you click that number" — so
  //          it has to BE a control, reachable by Tab and operable by Enter.
  test('each response’s number is a control that names what it opens', () => {
    mount();
    const names = openers().map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Read response 1 in full, by Ada',
      'Read response 2 in full, by Grace',
      'Read response 3 in full, by Katherine',
      'Read response 4 in full, by Hedy',
    ]);
  });

  // rejects: the row printing the whole response, which is the "brief bar" the
  //          owner said they liked; and printing NOTHING, which is the defect
  //          being fixed. It shows the start, and the start only.
  test('the row shows the start of the answer, not all of it', () => {
    const { container } = mount();
    const bar = container.querySelector('.past-round__answer').textContent;
    expect(bar.startsWith('A deliberately long response')).toBe(true);
    expect(bar.endsWith('…')).toBe(true);
    expect(bar).not.toContain('Final clause.');
  });

  // rejects: dropping the emphasis the owner asked for on the top three — and
  //          equally, marking every row, which would make the mark meaningless.
  test('exactly the top three carry the podium mark', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.past-round__rank.is-podium')).toHaveLength(3);
    expect(container.querySelectorAll('.past-round__rank')).toHaveLength(4);
  });

  // rejects: THE POINT OF THE FEATURE. Clicking the number must show the full
  //          text, which the row deliberately does not.
  test('clicking the number opens the whole response', () => {
    const { container } = mount();
    expect(container.querySelector('.answer-spotlight')).toBeNull();
    fireEvent.click(openers()[0]);
    const dialog = container.querySelector('.answer-spotlight');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Final clause.');
    expect(dialog.textContent).toContain('Ada');
  });

  // rejects: opening the wrong response, which on a redacted-adjacent surface
  //          means showing a room somebody else's words under this name.
  test('it opens the response whose number was pressed', () => {
    const { container } = mount();
    fireEvent.click(openers()[2]);
    const dialog = container.querySelector('.answer-spotlight');
    expect(dialog.textContent).toContain('Third');
    expect(dialog.textContent).toContain('Katherine');
    expect(screen.getByText('3 of 4')).toBeInTheDocument();
  });

  /*
    TIES ARE WHERE THE BADGE AND THE ROW DISAGREE. create-report gives equal
    scores equal ranks (1, 1, 3), so two circles both read "1". A handler keyed
    on the number printed on the circle would open the first of the two from
    either one — the wrong person's words under the other's name.
  */
  // rejects: opening by the displayed placement instead of by the row.
  test('two responses tied at rank 1 open their own answers', () => {
    const tied = roundsFrom(report([q('1', {
      answers: [
        answerRow({ text: 'Tied first', name: 'Ada', rank: 1, score: 3, index: 0 }),
        answerRow({ text: 'Tied second', name: 'Grace', rank: 1, score: 3, index: 1 }),
        answerRow({ text: 'Behind them', name: 'Katherine', rank: 3, score: 1, index: 2 }),
      ],
    })]));
    const { container } = render(
      <PastRound rounds={tied} index={0} onIndex={jest.fn()} onClose={jest.fn()} onRegenerate={jest.fn()} />,
    );
    // Both circles really do print the same number — that is the premise.
    const circles = Array.from(container.querySelectorAll('.past-round__rank'));
    expect(circles.map((b) => b.textContent)).toEqual(['1', '1', '3']);

    fireEvent.click(circles[1]);
    const dialog = container.querySelector('.answer-spotlight');
    expect(dialog.textContent).toContain('Tied second');
    expect(dialog.textContent).toContain('Grace');
    expect(dialog.textContent).not.toContain('Tied first');
  });

  // rejects: THE OWNER'S "any key takes you back". Back to the ROUND, not out
  //          of the review — `onClose` (which closes the round) must not fire,
  //          and `onIndex` (which would move to another round) must not either.
  test('a keypress returns to the round it was opened from', () => {
    const { container, onClose, onIndex } = mount();
    fireEvent.click(openers()[0]);
    fireEvent.keyDown(document, { key: 'k' });
    expect(container.querySelector('.answer-spotlight')).toBeNull();
    expect(container.querySelector('.past-round')).toBeTruthy();
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndex).not.toHaveBeenCalled();
  });

  // rejects: a literal any-key handler. Tab is how a keyboard user reaches the
  //          dialog's own controls and <Modal> traps it on purpose; swallowing
  //          it makes the dialog unusable without a mouse.
  test('Tab does not dismiss it', () => {
    const { container } = mount();
    fireEvent.click(openers()[0]);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(container.querySelector('.answer-spotlight')).toBeTruthy();
  });

  // rejects: dismissing on the keys that READ the thing. This dialog exists
  //          because the answer is too long for the row, and these are how a
  //          keyboard-only user scrolls it.
  test('the scrolling keys do not dismiss it', () => {
    const { container } = mount();
    fireEvent.click(openers()[0]);
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'Home', 'End', ' ']) {
      fireEvent.keyDown(document, { key });
      expect(container.querySelector('.answer-spotlight')).toBeTruthy();
    }
  });

  // rejects: closing under a screen-reader command or Ctrl+C, both of which
  //          are chords by construction.
  test('a chord does not dismiss it', () => {
    const { container } = mount();
    fireEvent.click(openers()[0]);
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Shift' });
    expect(container.querySelector('.answer-spotlight')).toBeTruthy();
  });

  // rejects: both dialogs answering one arrow press — the response steps AND
  //          the round underneath it changes, which then closes the response.
  //          One press, two moves, and the host sees the dialog vanish.
  test('the arrows step the response, never the round beneath it', () => {
    const { container, onIndex } = mount();
    fireEvent.click(openers()[0]);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).not.toHaveBeenCalled();
    expect(container.querySelector('.answer-spotlight').textContent).toContain('Second');
  });

  // rejects: keeping the response open across a round change, which would show
  //          round two's fifth response with nothing saying anything moved.
  test('changing round closes whatever response was open', () => {
    const { container, rerender } = mount();
    fireEvent.click(openers()[0]);
    expect(container.querySelector('.answer-spotlight')).toBeTruthy();
    rerender(
      <PastRound rounds={rounds} index={1} onIndex={jest.fn()} onClose={jest.fn()} onRegenerate={jest.fn()} />,
    );
    expect(container.querySelector('.answer-spotlight')).toBeNull();
  });

  // rejects: a score beside a response on a round whose authors the server
  //          withheld. §5.6.4 — the scores go wherever the names go.
  test('the score appears only on an attributed round', () => {
    const shown = mount();
    fireEvent.click(openers()[0]);
    expect(screen.getByText('+3')).toBeInTheDocument();
    shown.unmount();

    const hiddenRounds = roundsFrom(report([q('1', {
      answers: [answerRow({ text: 'Unattributed', rank: 1, score: 3 })],
    })]));
    const { container } = render(
      <PastRound rounds={hiddenRounds} index={0} onIndex={jest.fn()} onClose={jest.fn()} onRegenerate={jest.fn()} />,
    );
    fireEvent.click(openers()[0]);
    expect(container.querySelector('.answer-spotlight')).toBeTruthy();
    expect(screen.queryByText('+3')).not.toBeInTheDocument();
  });
});

/*
 * THE WORKIE SECTION IS MARKDOWN.
 *
 *   "also the workie section in the rounds review modal isnt formatted from md
 *    instead the md sysbols just show like ** ."
 *
 * Every field here is model output and personas.js's output contract tells the
 * model it may write markdown. A <p>{text}</p> prints the asterisks.
 */
describe('the AI summary renders as markdown', () => {
  const mountWith = (aiSummary) => {
    const rounds = roundsFrom(report([q('1', { aiSummary })]));
    return render(
      <PastRound rounds={rounds} index={0} onIndex={jest.fn()} onClose={jest.fn()} onRegenerate={jest.fn()} />,
    );
  };

  // rejects: THE REPORTED DEFECT, in the field the owner was looking at.
  test('bold in the summary text is bold, not asterisks', () => {
    const { container } = mountWith({ summaryText: 'The room **agreed** on scope.' });
    expect(container.querySelector('.past-round__summary strong')).toHaveTextContent('agreed');
    expect(container.querySelector('.past-round__summary').textContent).not.toContain('**');
  });

  // rejects: fixing the paragraph and leaving the lists raw. They arrive as
  //          "**Lead phrase**: detail", which is the exact shape the asterisks
  //          were seen on.
  test('the discussion and next-step items are markdown too', () => {
    const { container } = mountWith({
      summaryText: 'Plain.',
      discussionQuestions: ['**Scope**: what did we cut?'],
      nextSteps: ['**Owner**: Ada'],
    });
    const bolds = Array.from(container.querySelectorAll('.past-round__summary strong'))
      .map((el) => el.textContent);
    expect(bolds).toEqual(expect.arrayContaining(['Scope', 'Owner']));
    expect(container.querySelector('.past-round__summary').textContent).not.toContain('**');
  });

  // rejects: ignoring the whole-document field, which is the one the session
  //          report prefers — so one summary would render two different ways
  //          in two places.
  test('a whole markdown document is preferred when there is one', () => {
    const { container } = mountWith({
      summaryText: 'The structured fallback.',
      markdownResponse: '## What we heard\n\nThe room **agreed**.',
    });
    expect(container.querySelector('.past-round__summary h3')).toHaveTextContent('What we heard');
    expect(container.querySelector('.past-round__summary').textContent)
      .not.toContain('The structured fallback.');
  });
});

/*
 * THE SCROLL CONTRACT — the tallest dialog in the product after the prompt
 * editor, and jsdom cannot see any of it.
 */
describe('a long round can be scrolled', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
    return m[2];
  };

  // rejects: the flex trap, for the sixth time. A past round holds a question,
  //          every response AND a full summary, so it is the likeliest dialog
  //          in the product to overflow.
  test('the body is what scrolls', () => {
    const body = block('.past-round__body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/min-height:\s*0/);
  });

  // rejects: the pager or the Close button being what gets compressed — the
  //          exact shape of the iPad trap, where the way out left the screen.
  test('the way out does not shrink away', () => {
    expect(block('.past-round__head')).toMatch(/flex:\s*none/);
    expect(block('.past-round__nav')).toMatch(/flex:\s*none/);
  });

  test('the card is capped against the viewport', () => {
    expect(block('.past-round')).toMatch(/max-height:/);
    expect(block('.past-round')).toMatch(/flex-direction:\s*column/);
  });
});

/*
 * THE TAB EXISTS AND THE PAGE FEEDS IT — read as text, because SessionSetupPanel
 * needs the whole host page around it and GameHostPage cannot be mounted here.
 */
describe('the Rounds tab is wired to the page', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  // rejects: shipping the dialog with no way to reach it.
  test('the tab is offered', () => {
    expect(strip(read('config', 'setupPanel.js'))).toMatch(/id:\s*'history'/);
  });

  // rejects: a tab that renders its empty state forever because nothing ever
  //          fetches — which is exactly how the Questions tab shipped once.
  test('the page loads rounds when the panel opens', () => {
    const host = strip(read('GameHostPage.jsx'));
    expect(host).toMatch(/if \(setupPanelOpen\) loadRounds\(\)/);
    expect(host).toMatch(/rounds=\{rounds\}/);
    expect(host).toMatch(/onOpenRound=\{setPastRoundIndex\}/);
  });

  // rejects: reusing the read-only report GET, which returns only a report that
  //          was already saved — so the tab would be empty for every session
  //          that had not generated one.
  test('it asks the route that assembles the rounds', () => {
    expect(strip(read('GameHostPage.jsx'))).toMatch(/games\/\$\{gameId\}\/report[\s\S]{0,120}method: 'POST'/);
  });

  /*
    SCOPED TO regenerateRoundSummary'S OWN BODY, and the first version was not.
    It asserted `generateNew=true` appeared somewhere in the file — and it does,
    in `fetchAISummary`'s retry, on a completely different call. So deleting it
    from the button's own request left the test green over a button that
    silently re-read the cache. Found by mutating; the same gap, in the same
    shape, as one caught in playerParticipation.test.js earlier today.
  */
  const regenBody = () => {
    const host = strip(read('GameHostPage.jsx'));
    const at = host.indexOf('const regenerateRoundSummary');
    expect(at).toBeGreaterThan(-1);
    return host.slice(at, host.indexOf('\n  };', at));
  };

  /*
    THE FIRST VERSION OF THIS ASSERTED THE WRONG THING, and the codebase told
    me so. It checked for a literal `generateNew=true` in this function, which
    meant it was checking that the button rolled its OWN fetch — and
    `aiSummaryWiring.test.js` exists precisely to forbid that. A second
    hand-rolled trigger has already shipped once as a bug: it carried its own
    `.catch` that logged and cleared the watchdog, so a throw left the host with
    no request in flight and no sign of it. `ERR_INTERNET_DISCONNECTED` lands
    exactly there.

    So the requirement is the opposite of what I first wrote: go through the one
    trigger that classifies its own failure.
  */
  // rejects: a second hand-rolled trigger, which is a shape that has shipped
  //          broken before — and which loses the offline case, the 4xx case and
  //          the classifier's specific message with it.
  test('regenerate goes through the one sanctioned trigger', () => {
    const body = regenBody();
    expect(body).toMatch(/await triggerAISummary\(/);
    expect(body).not.toMatch(/fetch\(/);
    expect(body).not.toMatch(/generateNew/);
  });

  // rejects: pasting a round number into a URL unencoded. Padded numbers are
  //          safe today, but the value comes off the payload.
  test('the round number is encoded', () => {
    expect(regenBody()).toMatch(/encodeURIComponent\(roundNumber\)/);
  });

  // rejects: swallowing a refused regeneration. The button releases and the
  //          host is told which failure it was — `headline` and `detail` are
  //          what the classifier actually returns, and reaching for a
  //          non-existent `message` would show the fallback sentence every
  //          time, discarding the specific one.
  test('a refused regeneration releases the button and says why', () => {
    const body = regenBody();
    expect(body).toMatch(/if \(!result\.ok\)/);
    expect(body).toMatch(/setRegeneratingRounds\(\(prev\) => prev\.filter/);
    expect(body).toMatch(/headline/);
    expect(body).toMatch(/detail/);
  });

  // rejects: leaving the button stuck. The 202 says "started", and only the
  //          socket frame says "finished" — so that frame has to release it.
  test('the summary-ready frame releases the button and refreshes the list', () => {
    const host = strip(read('GameHostPage.jsx'));
    const at = host.indexOf("onMessage('aiSummaryReady'");
    expect(at).toBeGreaterThan(-1);
    const handler = host.slice(at, at + 1200);
    expect(handler).toMatch(/setRegeneratingRounds/);
    expect(handler).toMatch(/loadRounds\(\)/);
  });
});
