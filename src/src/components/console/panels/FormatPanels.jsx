// src/src/components/console/panels/FormatPanels.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import Icon from '../../Icon';
import PollBoard from '../../stage/PollBoard';
import { triviaOptions, isCorrectTriviaOption } from '../../../config/questionCard';

/**
 * TRIVIA AND POLL IN THE CONSOLE'S CONTENT AREA (experience plan 2g; PLAN
 * §3.2a "Content area": Trivia "the question and the private answer", Poll
 * "live board"; mockup frames p-2 and p-6).
 *
 * The laptop is private on two screens, so Trivia's panel shows what the room
 * does not: each option's live count and the answer, "B is correct. Only you
 * see this." The answer comes from the host's door (get-game-state.js
 * `hostAnswer`, the drawn letters the scorer pays) while the room answers;
 * at the reveal the public read's own `correctAnswer` agrees with it.
 * The counts are the round's answer letters from /answers/host.
 */

/**
 * The drawn letters a revealed question marks correct (its `correctAnswer`,
 * read as the stage reads it, config/questionCard.js), or null when none.
 * Only for the reveal: before it no public read carries `correctAnswer`, and
 * the host's door's `hostAnswer` is the source.
 */
export function revealedLetters(question) {
  if (!question) return null;
  const letters = triviaOptions(question).filter(({ key, letter }) => isCorrectTriviaOption(question, key, letter)).map((o) => o.letter);
  return letters.length ? letters : null;
}

/** How many of the round's answers picked each drawn letter. */
export function triviaCounts(answers) {
  const counts = {};
  (Array.isArray(answers) ? answers : []).forEach((a) => {
    const letter = String((a && a.answer) || '').trim().toUpperCase();
    if (letter) counts[letter] = (counts[letter] || 0) + 1;
  });
  return counts;
}

/** "Correct so far": answers on a right letter, of all answers. Null when the answer is not known. */
export function correctSoFar(answers, letters) {
  if (!Array.isArray(letters) || !letters.length) return null;
  const list = Array.isArray(answers) ? answers : [];
  const right = list.filter((a) => letters.includes(String((a && a.answer) || '').trim().toUpperCase())).length;
  return { right, of: list.length };
}

export function TriviaPanel({
  kicker = '', question = null, answers = [], letters = null, revealed = false,
}) {
  const options = triviaOptions(question);
  const counts = triviaCounts(answers);
  const top = Math.max(1, ...Object.values(counts));
  const known = Array.isArray(letters) && letters.length > 0;
  const prompt = question ? String(question.questionDetail || question.detail || '').trim() : '';
  const title = question ? String(question.title || '') : '';
  return (
    <section className="hc-panel" data-format="trivia">
      {kicker ? <p className="hc-kicker">{kicker}</p> : null}
      <h2 className="hc-h">{title}</h2>
      {prompt && prompt !== title.trim() ? <p className="hc-lesson">{prompt}</p> : null}
      <ol className="hc-opts" aria-label="Options">
        {options.map(({ letter, text }) => {
          const n = counts[letter] || 0;
          const right = known && letters.includes(letter);
          return (
            <li key={letter} className={`hc-opt${right ? ' is-correct' : ''}`} data-letter={letter}>
              <span className="hc-opt-l">{letter}</span>
              <span className="hc-opt-t">{text}</span>
              <span className="hc-opt-n" data-testid={`hc-opt-count-${letter}`}>{n}</span>
              <span className="hc-opt-bar" role="presentation"><i style={{ width: `${Math.round((n / top) * 100)}%` }} /></span>
            </li>
          );
        })}
      </ol>
      <p className="hc-private" data-testid="hc-private-answer">
        <Icon name="Lock" size={16} aria-hidden="true" />
        <span>
          {known ? <b>{CW.isCorrect(letters)}</b> : <b>{CW.answerUnknown}</b>}
          {known ? ` ${revealed ? CW.revealedOnWall : `${CW.onlyYou} ${CW.onlyYouLong}`}` : ''}
        </span>
      </p>
    </section>
  );
}

export function PollPanel({ kicker = '', question = null, tally = null, live = false }) {
  const poll = question && question.poll;
  const title = question ? String(question.title || '') : '';
  const prompt = question ? String(question.questionDetail || question.detail || '').trim() : '';
  return (
    <section className="hc-panel" data-format="poll">
      {kicker ? <p className="hc-kicker">{kicker}</p> : null}
      <h2 className="hc-h">{title}</h2>
      {prompt && prompt !== title.trim() ? <p className="hc-lesson">{prompt}</p> : null}
      <p className="hc-muted">{live ? CW.liveBoardNote : CW.boardFinal}</p>
      {poll ? <div className="hc-poll"><PollBoard question={poll} tally={tally} live={live} /></div> : null}
    </section>
  );
}
