import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent } from '@testing-library/react';
import QuestionCard from '../components/QuestionCard';
import { isCorrectTriviaOption } from '../config/questionCard';

/**
 * THE CARD RENDERS THE STAGE'S DOM — proved against the markup it replaced.
 *
 * GameHostPage.jsx cannot mount in jsdom, so "the stage renders the same DOM
 * before and after" cannot be asserted by rendering the stage. It is asserted
 * here instead: the two oracles below are the inline markup exactly as it stood
 * at 29a055a7 (GameHostPage.jsx 5672-5715 for ASK, 5843-5861 for trivia
 * RESULTS), with only their free variables turned into props. innerHTML
 * equality is attribute-for-attribute and order-for-order.
 *
 * THE ORACLES ARE FROZEN. Never "update one to match" the component — a
 * difference IS the finding. If the stage's markup is changed on purpose, change
 * QuestionCard and retire the matching case here with a note saying why.
 */
const KEYS_AT_29A055A7 = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

function OracleAsk({ currentQuestion, currentGameType, instructionText, expandQuestion }) {
  return (
    <>
      <h1
        className="q"
        data-expandable="1"
        title="Show the full question"
        onClick={expandQuestion}
      >
        {currentQuestion.title || currentQuestion.question}
      </h1>
      {currentQuestion.image && (
        <img
          className="stage-art"
          src={currentQuestion.image}
          alt={currentQuestion.title || 'Artwork'}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {currentGameType !== 'wavelength'
        && (currentQuestion.questionDetail || currentQuestion.detail) && (
        <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
          {currentQuestion.questionDetail || currentQuestion.detail}
        </p>
      )}
      {currentGameType === 'trivia' && (
        <div className="opts">
          {KEYS_AT_29A055A7
            .filter((key) => currentQuestion[key])
            .map((key, index) => (
              <div key={key} className="opt">
                <span className="ltr">{String.fromCharCode(65 + index)}</span>
                <span className="txt">{currentQuestion[key]}</span>
              </div>
            ))}
        </div>
      )}
      <p className="qdetail" data-drop="3" data-drop-note="How to answer">
        {instructionText}
      </p>
    </>
  );
}

function OracleTriviaResults({ currentQuestion, answers }) {
  return (
    <div className="opts">
      {KEYS_AT_29A055A7
        .filter((key) => currentQuestion?.[key])
        .map((key, index) => {
          const letter = String.fromCharCode(65 + index);
          const isCorrect = isCorrectTriviaOption(currentQuestion, key, letter);
          const picked = answers.filter((a) => a.answer === letter).length;
          const pct = answers.length
            ? Math.round((picked / answers.length) * 100) : 0;
          return (
            <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
              <span className="fill" style={{ width: `${pct}%` }} />
              <span className="ltr">{letter}</span>
              <span className="txt">{currentQuestion[key]}</span>
              <span className="pct">{`${pct}%`}</span>
            </div>
          );
        })}
    </div>
  );
}

const html = (element) => render(element).container.innerHTML;

const TRIVIA = {
  id: 'q-7',
  title: 'Which killer was caught by a parking ticket?',
  questionDetail: 'New York, 1977.',
  optionA: 'Ted Bundy',
  optionB: 'David Berkowitz',
  optionC: 'John Wayne Gacy',
  optionD: 'Richard Ramirez',
  correctAnswer: 'David Berkowitz',
};
/* Filled slots A, C and D. The stage letters them A, B and C — by position
   among the filled slots, never by slot — and the room's phones answer in
   those letters. Only a gap tells the two apart: with A to D all filled, a card
   that lettered or tallied by slot would pass every other case in this file. */
const GAPPED = {
  id: 'q-9',
  title: 'Which river runs through Paris?',
  optionA: 'The Thames',
  optionC: 'The Seine',
  optionD: 'The Danube',
  correctAnswer: 'The Seine',
};
/* A set that records its answer as a LOWERCASE bare letter. Sets in the wild
   do: the host phone's decoder matches `/^[A-F]$/i` on purpose
   (config/hostRemote.js `correctOptionIndex`), and nothing upstream tidies the
   spelling on the way to the stage — lambda-functions/game/get-question.js
   rewrites an answer only when it startsWith('Option'). */
const LOWERCASE_LETTER = {
  id: 'q-11',
  title: 'Which river runs through Rome?',
  optionA: 'The Seine',
  optionB: 'The Thames',
  optionC: 'The Tiber',
  correctAnswer: 'c',
};
/* The same asymmetry one spelling over: the SLOT ID, recorded in a case the
   card does not read. `correctOptionIndex` matches `/^option\s*([A-F])$/i` —
   the `i` and the `\s*` are both deliberate — so the phone has always read
   `optionc`, `Option C` and `OPTIONC`, while the card's branch is guarded on
   `startsWith('Option')` and then compares the letter exactly. Nothing upstream
   tidies it either: lambda-functions/admin/upload-questions.js stores the
   CorrectAnswer cell of an imported CSV verbatim, with no validation at all,
   and get-question.js rewrites an answer only when it startsWith('Option'). */
const LOWERCASE_SLOT_ID = {
  id: 'q-12',
  title: 'Which river runs through Vienna?',
  optionA: 'The Tiber',
  optionB: 'The Seine',
  optionC: 'The Danube',
  correctAnswer: 'optionc',
};
const ART = {
  id: 'a-2', title: 'THE COMPANY STEPS OUT', detail: 'Oil on canvas.', image: '/assets/art/x.jpg',
};
const HOW = 'Select the best answer:';

describe('ASK — the card is the markup the stage rendered inline', () => {
  test.each([
    ['trivia', TRIVIA, 'trivia'],
    ['trivia whose filled slots skip a letter', GAPPED, 'trivia'],
    ['a question with an image', ART, 'call-and-answer'],
    ['wavelength, whose stored detail never renders', { ...ART, image: '' }, 'wavelength'],
    ['a question with no detail at all', { id: 'x', title: 'Bare' }, 'poll'],
    ['a question carrying only the wire\'s legacy `question` field', { id: 'y', question: 'Legacy' }, 'call-and-answer'],
  ])('%s, with the stage\'s expand handler', (_label, question, gameType) => {
    const onExpand = () => {};
    expect(html(<QuestionCard phase="ASK" question={question} gameType={gameType} instruction={HOW} onExpand={onExpand} />))
      .toBe(html(<OracleAsk currentQuestion={question} currentGameType={gameType} instructionText={HOW} expandQuestion={onExpand} />));
  });

  test('without a handler, the heading carries none of the expand affordance and nothing else changes', () => {
    // rejects: a heading that shows the zoom cursor and "Show the full
    // question" and then does nothing when pressed — a dead control.
    const card = render(<QuestionCard phase="ASK" question={TRIVIA} gameType="trivia" instruction={HOW} />).container;
    const h1 = card.querySelector('h1.q');
    expect(h1.hasAttribute('data-expandable')).toBe(false);
    expect(h1.hasAttribute('title')).toBe(false);

    const oracle = render(<OracleAsk currentQuestion={TRIVIA} currentGameType="trivia" instructionText={HOW} expandQuestion={() => {}} />).container;
    const oracleH1 = oracle.querySelector('h1.q');
    oracleH1.removeAttribute('data-expandable');
    oracleH1.removeAttribute('title');
    expect(card.innerHTML).toBe(oracle.innerHTML);
  });

  test('the heading calls the handler it was given', () => {
    const onExpand = jest.fn();
    const { container } = render(<QuestionCard phase="ASK" question={TRIVIA} gameType="trivia" instruction={HOW} onExpand={onExpand} />);
    fireEvent.click(container.querySelector('h1.q'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  test('a broken image hides itself, as the stage\'s does', () => {
    const { container } = render(<QuestionCard phase="ASK" question={ART} gameType="call-and-answer" instruction={HOW} />);
    const img = container.querySelector('img.stage-art');
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
  });

  test('no question, no card', () => {
    // The stage guards with `currentQuestion &&`; the card must not throw if a
    // caller forgets to.
    expect(html(<QuestionCard phase="ASK" question={null} gameType="trivia" instruction={HOW} />)).toBe('');
  });
});

describe('REVEAL — the trivia RESULTS option treatment', () => {
  const answers = [{ answer: 'B' }, { answer: 'B' }, { answer: 'A' }, { answer: 'C' }];

  test('with the room\'s answers, every option carries its bar and its share', () => {
    expect(html(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" answers={answers} />))
      .toBe(html(<OracleTriviaResults currentQuestion={TRIVIA} answers={answers} />));
  });

  test('with an empty answer list, 0% is drawn — on the stage 0% is true', () => {
    const { container } = render(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" answers={[]} />);
    expect(container.innerHTML).toBe(html(<OracleTriviaResults currentQuestion={TRIVIA} answers={[]} />));
    expect([...container.querySelectorAll('.pct')].map((n) => n.textContent)).toEqual(['0%', '0%', '0%', '0%']);
  });

  test('a question whose filled slots skip a letter is lettered and tallied by position', () => {
    // rejects: a card that letters or tallies by slot. The phones sent "B" for
    // the Seine, because the stage drew the Seine as B.
    const picks = [{ answer: 'B' }, { answer: 'B' }, { answer: 'C' }];
    const { container } = render(<QuestionCard phase="REVEAL" question={GAPPED} gameType="trivia" answers={picks} />);
    expect(container.innerHTML).toBe(html(<OracleTriviaResults currentQuestion={GAPPED} answers={picks} />));
    expect([...container.querySelectorAll('.ltr')].map((n) => n.textContent)).toEqual(['A', 'B', 'C']);
    expect([...container.querySelectorAll('.pct')].map((n) => n.textContent)).toEqual(['0%', '67%', '33%']);
    expect([...container.querySelectorAll('.opt')].map((n) => n.className)).toEqual(['opt dim', 'opt correct', 'opt dim']);
  });

  test('an answer recorded as a lowercase bare letter marks its option, and only it', () => {
    // rejects: comparing the stored letter against the stage's uppercase
    // positional letter as stored. Every option came back dim and the room was
    // never told which answer was right.
    //
    // DELIBERATELY NOT COMPARED AGAINST OracleTriviaResults. The oracle calls
    // the very `isCorrectTriviaOption` under test, so a card and an oracle that
    // both mark nothing are equal — the innerHTML cases above stay green right
    // through this bug, which is why it survived them.
    const { container } = render(
      <QuestionCard phase="REVEAL" question={LOWERCASE_LETTER} gameType="trivia" answers={[]} />
    );
    const marked = [...container.querySelectorAll('.opt.correct')];
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector('.ltr').textContent).toBe('C');
    expect(marked[0].querySelector('.txt').textContent).toBe(LOWERCASE_LETTER.optionC);
    expect([...container.querySelectorAll('.opt')].map((n) => n.className))
      .toEqual(['opt dim', 'opt dim', 'opt correct']);
  });

  test('an answer recorded as a lowercase slot id marks its option, and only it', () => {
    // rejects: reading the slot id case-sensitively — `startsWith('Option')`,
    // then comparing the letter it strips against the stage's UPPERCASE
    // positional letter. `optionc` enters no branch at all: it is not the
    // exact slot id, not the bare letter, not one character long, and not the
    // option's text, so every option came back dim and the room was never told
    // which answer was right. The host's phone reads that set
    // (config/hostRemote.js `correctOptionIndex` matches `/^option\s*([A-F])$/i`),
    // so the phone marked an answer the projector behind it could not.
    //
    // DELIBERATELY NOT COMPARED AGAINST OracleTriviaResults, for the same
    // reason as the case above: the oracle calls the very predicate under test,
    // so a card and an oracle that both mark nothing are equal, and every
    // innerHTML case in this file stays green straight through the bug.
    const { container } = render(
      <QuestionCard phase="REVEAL" question={LOWERCASE_SLOT_ID} gameType="trivia" answers={[]} />
    );
    const marked = [...container.querySelectorAll('.opt.correct')];
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector('.ltr').textContent).toBe('C');
    expect(marked[0].querySelector('.txt').textContent).toBe(LOWERCASE_SLOT_ID.optionC);
    expect([...container.querySelectorAll('.opt')].map((n) => n.className))
      .toEqual(['opt dim', 'opt dim', 'opt correct']);
  });

  test('with no question, the stage\'s empty options block — as the inline markup drew it', () => {
    expect(html(<QuestionCard phase="REVEAL" question={null} gameType="trivia" answers={[]} />))
      .toBe(html(<OracleTriviaResults currentQuestion={null} answers={[]} />));
  });

  test('without answers, neither the bar nor the figure renders', () => {
    // rejects: a 0% bar in the preview, which would claim nobody chose it.
    const { container } = render(<QuestionCard phase="REVEAL" question={TRIVIA} gameType="trivia" />);
    expect(container.querySelector('.fill')).toBeNull();
    expect(container.querySelector('.pct')).toBeNull();
    const rows = [...container.querySelectorAll('.opt')];
    expect(rows.map((r) => r.className)).toEqual(['opt dim', 'opt correct', 'opt dim', 'opt dim']);
    expect(rows.map((r) => [...r.children].map((c) => c.className))).toEqual(
      rows.map(() => ['ltr', 'txt'])
    );
  });

  test('only trivia has anything to reveal', () => {
    for (const gameType of ['call-and-answer', 'poll', 'wavelength', 'survey']) {
      expect(html(<QuestionCard phase="REVEAL" question={TRIVIA} gameType={gameType} />)).toBe('');
    }
  });
});

/*
 * REVEAL WITH ITS QUESTION — the set editor's preview, the card's second caller.
 *
 * The preview holds Reveal across every question it moves to, so each one
 * arrives already revealed. The options alone put four answers on the screen
 * and nothing saying what was asked, which is not what the spec draws: its
 * sketch (2026-09-19 §1) is in Reveal and has the question above them. The
 * heading alone is not enough either. The trivia generator writes the title as
 * "a label for the question, not the question itself" and the question as asked
 * into the detail (lambda-functions/admin/ai-generate-trivia.js), so the full
 * prompt is the question.
 *
 * Built from the frozen oracles above and nothing else, so the composition can
 * only be made of lines the stage draws: ASK's heading, picture and full prompt,
 * then RESULTS' options without the tally. The how-to-answer line is not one of
 * them. It tells the room how to answer, and in Reveal the answering is over.
 *
 * Each oracle is cut down in a detached COPY of what it rendered. Removing
 * nodes React still owns makes the unmount after the test throw.
 */
function oracleRevealWithQuestion(question) {
  const ask = render(
    <OracleAsk currentQuestion={question} currentGameType="trivia" instructionText={HOW} expandQuestion={() => {}} />
  ).container.cloneNode(true);
  const heading = ask.querySelector('h1.q');
  heading.removeAttribute('data-expandable');                 // the preview passes no handler
  heading.removeAttribute('title');
  ask.querySelector('.opts').remove();                        // RESULTS' options replace ASK's
  ask.querySelector('[data-drop-note="How to answer"]').remove();
  const results = render(<OracleTriviaResults currentQuestion={question} answers={[]} />).container.cloneNode(true);
  results.querySelectorAll('.fill, .pct').forEach((node) => node.remove());   // no votes, no tally
  return `${ask.innerHTML}${results.innerHTML}`;
}

describe('REVEAL withQuestion — the question above its answer, in the stage\'s own lines', () => {
  const PICTURED = { ...TRIVIA, image: '/assets/art/x.jpg' };

  test.each([
    ['a heading, a picture and a full prompt', PICTURED],
    ['a heading alone, over slots that skip a letter', GAPPED],
  ])('%s: ASK\'s question lines, then RESULTS\' options without the tally', (_label, question) => {
    // rejects: the options alone, which is what the preview drew before.
    expect(html(<QuestionCard phase="REVEAL" question={question} gameType="trivia" withQuestion />))
      .toBe(oracleRevealWithQuestion(question));
  });

  test('ASK already draws its question, so asking for it there changes nothing', () => {
    const onExpand = () => {};
    expect(html(<QuestionCard phase="ASK" question={PICTURED} gameType="trivia" instruction={HOW} onExpand={onExpand} withQuestion />))
      .toBe(html(<OracleAsk currentQuestion={PICTURED} currentGameType="trivia" instructionText={HOW} expandQuestion={onExpand} />));
  });

  test('it adds a question to a Reveal and never makes one: no question, or no trivia, draws what it drew before', () => {
    // With no question there is nothing to put above the options, and the card
    // must not throw reading one.
    expect(html(<QuestionCard phase="REVEAL" question={null} gameType="trivia" withQuestion />))
      .toBe(html(<QuestionCard phase="REVEAL" question={null} gameType="trivia" />));
    for (const gameType of ['call-and-answer', 'poll', 'wavelength', 'survey']) {
      expect(html(<QuestionCard phase="REVEAL" question={TRIVIA} gameType={gameType} withQuestion />)).toBe('');
    }
  });
});

describe('the stage really renders it', () => {
  /*
   * Read from the source, because GameHostPage cannot mount in jsdom. Without
   * this, re-inlining the markup "just for one tweak" would fork the stage from
   * the preview silently — every test above would still pass.
   */
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const cards = source.match(/<QuestionCard\b[^>]*\/>/g) || [];

  test('it imports the card and renders it twice: ASK and trivia RESULTS', () => {
    expect(source).toMatch(/import QuestionCard from '\.\/components\/QuestionCard';/);
    expect(cards).toHaveLength(2);
  });

  test('ASK hands over the question, the expand handler and the host\'s instruction', () => {
    const ask = cards.find((c) => /phase="ASK"/.test(c));
    expect(ask).toMatch(/question=\{currentQuestion\}/);
    expect(ask).toMatch(/onExpand=\{expandQuestion\}/);
    expect(ask).toMatch(/instruction=\{getHostInstructionText\(currentQuestionOf\(questions, currentQuestionId\)\)\}/);
    expect(ask).toMatch(/gameType=\{currentGameType\}/);
  });

  test('RESULTS hands over the question, its type and the room\'s answers', () => {
    const reveal = cards.find((c) => /phase="REVEAL"/.test(c));
    expect(reveal).toMatch(/question=\{currentQuestion\}/);
    // rejects: dropping `gameType`. The card reveals for trivia only, so
    // without it trivia RESULTS would put no options on the projector at all.
    expect(reveal).toMatch(/gameType=\{currentGameType\}/);
    // rejects: dropping `answers` at the call site. The card would then render
    // the PREVIEW's treatment on the projector: no bars, no percentages.
    expect(reveal).toMatch(/answers=\{answers\}/);
  });

  test('the stage never asks for the question above its RESULTS', () => {
    // rejects: the projector's RESULTS growing a heading, a picture and a
    // prompt. Every oracle above would stay green, because they render the card
    // without the prop; only the stage's own call sites can show it was passed.
    expect(source).not.toMatch(/withQuestion/);
  });

  test('none of the card\'s markup survives inline', () => {
    expect(source).not.toMatch(/className="opts?"/);
    expect(source).not.toMatch(/className=\{`opt\b/);
    expect(source).not.toMatch(/TRIVIA_OPTION_KEYS|isCorrectTriviaOption/);
    expect(source).not.toMatch(/data-drop-note="(Full prompt|How to answer)"/);
  });
});
