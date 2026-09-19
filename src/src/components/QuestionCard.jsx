import React from 'react';
import { triviaOptions, isCorrectTriviaOption, optionShare } from '../config/questionCard';

/**
 * THE QUESTION AS THE ROOM SEES IT — one component for the stage and the
 * set editor's question preview.
 *
 * The live stage renders it for ASK and for trivia RESULTS (GameHostPage.jsx);
 * the set editor's question preview is its second caller, for ASK and Reveal
 * (spec 2026-09-19 §4.4). It used to be inline markup in GameHostPage, which
 * no test can mount, so a preview built beside it would have been a second
 * copy that drifted on its first edit. One component makes that drift
 * structurally impossible (spec 2026-09-19 §2.3).
 *
 * IT RENDERS FRAGMENTS, NOT A BOX. The stage places these elements directly
 * inside `.content > .fitbox`, which the fitter measures and scales; a wrapper
 * here would change the DOM the fitter walks. A caller that needs a box
 * supplies its own.
 *
 * THE STAGE'S DOM IS THE CONTRACT: same elements, classes, attributes and
 * order as the inline markup it replaced, pinned against a frozen copy of that
 * markup in __tests__/questionCardDom.test.jsx.
 *
 *   phase="ASK"     h1.q, img.stage-art, the full-prompt line (never for
 *                   wavelength), the trivia options, the how-to-answer line.
 *   phase="REVEAL"  trivia only: the options, correct one marked, the rest
 *                   dimmed. With `answers` (the stage) every option also
 *                   carries its share — 0% included, because on the stage 0%
 *                   is true. Without `answers` (the preview) neither the bar
 *                   nor the figure renders: there were no votes, and a 0% bar
 *                   would claim nobody chose it.
 *
 * `instruction` IS A PROP. The stage passes getHostInstructionText(…) and the
 * preview resolveInstruction(…); the card never decides what the room is told.
 */
export default function QuestionCard({
  phase = 'ASK',
  question = null,
  gameType,
  instruction = '',
  answers,
  onExpand,
}) {
  if (phase === 'REVEAL') {
    if (gameType !== 'trivia') return null;
    const tallied = Array.isArray(answers);
    return (
      <div className="opts">
        {triviaOptions(question).map(({ key, letter, text }) => {
          const isCorrect = isCorrectTriviaOption(question, key, letter);
          const pct = tallied ? optionShare(answers, letter) : 0;
          return (
            <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
              {tallied && <span className="fill" style={{ width: `${pct}%` }} />}
              <span className="ltr">{letter}</span>
              <span className="txt">{text}</span>
              {tallied && <span className="pct">{`${pct}%`}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  if (!question) return null;

  /* THE RECOVERY FOR A DROPPED PROMPT, and only where there is one.
     The full prompt below is the LAST thing the fitter sacrifices on a dense
     ASK, after both host controls and the how-to-answer line — but it can
     still go. Click-to-expand is how the host gets it back, and without it a
     dense round loses the prompt from both the room's screen and the host's
     with no way to read it again. Mouse-only on purpose: giving the heading a
     tabIndex would put SPACE — the advance shortcut — on a focusable element
     that also opens a modal.
     GATED ON THE HANDLER. The preview passes none, and a heading that shows
     the zoom cursor and does nothing on click is a dead control. */
  const expand = typeof onExpand === 'function'
    ? { 'data-expandable': '1', title: 'Show the full question', onClick: onExpand }
    : {};
  const detail = question.questionDetail || question.detail;

  return (
    <>
      <h1 className="q" {...expand}>
        {question.title || question.question}
      </h1>
      {question.image && (
        <img
          className="stage-art"
          src={question.image}
          alt={question.title || 'Artwork'}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {/* WAVELENGTH SHOWS THE TERM AND NOTHING ABOUT IT. The owner, off the AI
          Jargon set: "we dont want to give them ideas of the meaning, we are
          looking to them to share their meaning." A stored detail sentence IS
          a definition, so for wavelength this line never renders — whatever
          the set carries. The subject is the headline above; the
          how-to-answer line below is the only other thing the room needs. */}
      {gameType !== 'wavelength' && detail && (
        <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
          {detail}
        </p>
      )}
      {gameType === 'trivia' && (
        <div className="opts">
          {triviaOptions(question).map(({ key, letter, text }) => (
            <div key={key} className="opt">
              <span className="ltr">{letter}</span>
              <span className="txt">{text}</span>
            </div>
          ))}
        </div>
      )}
      <p className="qdetail" data-drop="3" data-drop-note="How to answer">
        {instruction}
      </p>
    </>
  );
}
