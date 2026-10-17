import React, { useEffect, useRef } from 'react';
import { triviaOptions, isCorrectTriviaOption, optionShare } from '../config/questionCard';
import {
  shows, roleOf, sizeOf, textOf, ROLE,
} from '../config/roomContent';

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
 *                   With `withQuestion` (the preview) the question comes first,
 *                   in ASK's own lines: the heading, the picture and the full
 *                   prompt. The preview's Reveal is sticky, so every question it
 *                   moves to arrives already revealed, and the options alone
 *                   said nothing about what was asked. The how-to-answer line
 *                   stays ASK's: in Reveal the answering is over. The stage
 *                   never passes it, so its RESULTS is still the DOM it drew
 *                   inline (both held in __tests__/questionCardDom.test.jsx).
 *                   ASK draws its question anyway; there the prop changes
 *                   nothing.
 *
 * `instruction` IS A PROP. The stage passes getHostInstructionText(…) and the
 * preview resolveInstruction(…); the card never decides what the room is told.
 *
 * `room` IS WHAT THE ROOM SEES, AND HOW LARGE (owner, 17 Oct 2026): the
 * stage passes roomContentFor('ANSWERING', profile, questionRoomData(…)) for
 * a Call & Answer round, the same call the room's window makes
 * (present/presentModel.js). With it, ASK draws the parts that content names:
 * the task as the lead (h1.q, the expand recovery on it, never dropped), the
 * title as a kicker above it on Room, TV and Table or a heading on Call, the
 * lesson as support that may give way ("The lesson"). Without it (the set
 * editor's preview, the other types) ASK draws the frozen DOM below.
 */
export default function QuestionCard({
  phase = 'ASK',
  question = null,
  gameType,
  instruction = '',
  answers,
  onExpand,
  withQuestion = false,
  room = null,
}) {
  if (phase === 'REVEAL') {
    if (gameType !== 'trivia') return null;
    const tallied = Array.isArray(answers);
    const options = (
      <div className="opts">
        {triviaOptions(question).map(({ key, letter, text }) => {
          const isCorrect = isCorrectTriviaOption(question, key, letter);
          const pct = tallied ? optionShare(answers, letter) : 0;
          return (
            <div key={key} className={`opt ${isCorrect ? `correct${tallied ? ' hero-row' : ''}` : 'dim'}`}>
              {tallied && <span className="fill" style={{ width: `${pct}%` }} />}
              <span className="ltr">{letter}</span>
              <span className="txt">{text}</span>
              {/* THE WORD, NOT JUST THE BORDER. At 25ft a border-colour change
                  is not a signal; "Correct" is (refresh-2026-09-22 §6 step 3,
                  03-stage-results.html). Between the text and the share, as
                  the mockup places it. Stage only: the preview's Reveal marks
                  the row and draws no tally, and adds no flag either. */}
              {tallied && isCorrect && <span className="flag">Correct</span>}
              {tallied && <Share pct={pct} />}
            </div>
          );
        })}
      </div>
    );
    if (tallied) {
      /* THE STAGE'S RESULTS: the question restated above, the explanation
         below. RESULTS used to draw four bars and nothing else — the room saw
         a winning answer to a question it could no longer read, and the
         set's `answerDetails` (written to be "read to the room at the
         reveal") was read nowhere. The recap is the full prompt, since the
         trivia generator writes the title as a label and the question as
         asked into the detail; the title stands in when there is none.
         Content, so it announces its own loss: "3" sorts after every chrome
         group (stageShell: chrome before content) and before nothing — the
         options are never dropped. */
      const recap = question ? String(question.questionDetail || question.detail || question.title || question.question || '').trim() : '';
      const explain = question ? String(question.answerDetails || '').trim() : '';
      return (
        <>
          {recap && <p className="recap">{recap}</p>}
          {options}
          {explain && (
            <p className="qdetail explain" data-drop="3" data-drop-note="Explanation">
              {explain}
            </p>
          )}
        </>
      );
    }
    if (!withQuestion || !question) return options;
    return (
      <>
        <QuestionLines question={question} gameType={gameType} onExpand={onExpand} />
        {options}
      </>
    );
  }

  if (!question) return null;

  if (room) return <RoomLines question={question} room={room} onExpand={onExpand} />;

  return (
    <>
      <QuestionLines question={question} gameType={gameType} onExpand={onExpand} />
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

/** The data attributes a room-content part carries: which part, which role. */
const rcAttrs = (rc, key) => ({ 'data-rc-part': key, 'data-rc': roleOf(rc, key) });

/**
 * ASK, AS THE ROOM CONTENT SAYS (config/roomContent.js). The DOM stays the
 * stage's vocabulary — .kicker, h1.q, .qdetail — so the fitter's CONTENT list
 * and drop polarity hold: the lesson is room-facing content, "4" with its note.
 */
function RoomLines({ question, room, onExpand }) {
  const expand = typeof onExpand === 'function'
    ? { 'data-expandable': '1', title: 'Show the full question', onClick: onExpand }
    : {};
  const titleRole = roleOf(room, 'title');
  const leadKey = room.lead;
  return (
    <>
      {shows(room, 'category') && <div className="kicker" {...rcAttrs(room, 'category')}>{textOf(room, 'category')}</div>}
      {titleRole === ROLE.KICKER && <div className="kicker q-kicker" {...rcAttrs(room, 'title')}>{textOf(room, 'title')}</div>}
      {titleRole === ROLE.SUPPORT && <h2 className="q-sub" {...rcAttrs(room, 'title')}>{textOf(room, 'title')}</h2>}
      <h1 className={`q q-lead is-${sizeOf(room, leadKey)}`} data-rc-size={sizeOf(room, leadKey)} {...rcAttrs(room, leadKey)} {...expand}>
        {textOf(room, leadKey)}
      </h1>
      {question.image && (
        <img
          className="stage-art"
          src={question.image}
          alt={question.title || 'Artwork'}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {shows(room, 'story') && (
        <p className="qdetail" data-drop="4" data-drop-note="The lesson" {...rcAttrs(room, 'story')}>
          {textOf(room, 'story')}
        </p>
      )}
    </>
  );
}

/**
 * WHAT WAS ASKED — the heading, the picture and the full prompt, in that order.
 * ASK draws them above its options; REVEAL draws them above its answer only on
 * request (`withQuestion`). One block for both, so the question in the
 * preview's Reveal is the stage's ASK question and cannot drift from it.
 */
function QuestionLines({ question, gameType, onExpand }) {
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
          how-to-answer line ASK draws last is the only other thing the room
          needs. */}
      {gameType !== 'wavelength' && detail && (
        <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
          {detail}
        </p>
      )}
    </>
  );
}

/**
 * THE SHARE COUNTS UP — 03-stage-results.html's `.pct[data-pct]`: from 0 to
 * its figure over 620ms, starting after the reveal clock (`--rv`) plus its
 * row's stagger, so the number lands as its bar finishes growing. The DOM
 * always carries the FINAL figure: it is rendered that way, and the count is
 * a transient rewrite of the text that ends on the same string. Where motion
 * is not wanted — reduced-motion, or no matchMedia at all (jsdom, an old
 * embed) — nothing moves and the figure is simply there.
 */
function Share({ pct }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const row = el.closest('.opt');
    const index = row && row.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
    const rv = parseFloat(getComputedStyle(el.closest('.stage') || el).getPropertyValue('--rv')) || 1.4;
    const start = rv * 1000 + 50 + index * 80;
    const dur = 620;
    let frame = 0;
    let t0 = 0;
    const tick = (now) => {
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - k) ** 3;
      el.textContent = `${Math.round(pct * eased)}%`;
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    el.textContent = '0%';
    const timer = setTimeout(() => { frame = requestAnimationFrame(tick); }, start);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); el.textContent = `${pct}%`; };
  }, [pct]);
  return <span className="pct" ref={ref}>{`${pct}%`}</span>;
}
