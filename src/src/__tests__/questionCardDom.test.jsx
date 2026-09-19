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

  test('none of the card\'s markup survives inline', () => {
    expect(source).not.toMatch(/className="opts?"/);
    expect(source).not.toMatch(/className=\{`opt\b/);
    expect(source).not.toMatch(/TRIVIA_OPTION_KEYS|isCorrectTriviaOption/);
    expect(source).not.toMatch(/data-drop-note="(Full prompt|How to answer)"/);
  });
});
