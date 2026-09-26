import React, { useEffect, useMemo, useRef, useState } from 'react';
import Stage from './Stage';
import Rail from './Rail';
import Dock from './Dock';
import Pager from './Pager';
import ChoiceResult from '../survey/results/ChoiceResult';
import RatingResult from '../survey/results/RatingResult';
import YesNoResult from '../survey/results/YesNoResult';
import RankResult from '../survey/results/RankResult';
import TextResult from '../survey/results/TextResult';
import { pageCount, pageSizeFor, pageSlice } from '../../config/stagePaging';
import { surveyWalkthroughKeyIntent } from '../../config/surveyWalkthrough';
import '../survey/results/SurveyResults.css';

/**
 * THE WALL WALK-THROUGH — Task 8 of the 2026-09-26 feature sweep: "we just
 * need the ability to see each question individually in a large format we
 * can cycle through." docs/design/survey-redesign/s-02-choice.html through
 * s-06-themes.html draw the shape: a "Results" kicker, the session title,
 * "Question N of M", one question full size, and a host dock reading
 * "Walking the room through the results" with Previous and SPACE Next result.
 *
 * NEVER A SECOND COPY OF THE CHART LOGIC. Choice/Rating/YesNo/Rank are the
 * SAME components `SurveyResultsPanel`'s cut sheet and the paper report mount
 * (KindResult.jsx's own header: "the SAME five renderers either way, so a
 * later wall pass can reuse them too") — this file adds no percentage, mean
 * or histogram arithmetic of its own. What changes is scale: `.svw` in
 * styles/stage.css re-derives the same `--svr-t-*` custom properties the
 * console ladder declares on `.svr-card`, this time from the STAGE's own
 * `--t-*` tokens, so the identical markup reads as room-scale type instead of
 * laptop-scale type — see styles/stage.css's own comment beside those rules,
 * and __tests__/surveyWalkthroughPalette.test.js for the measured contract.
 *
 * "N ANSWERED" IS THIS PRESENTER'S OWN LINE, per s-02/s-04's `.rule-note`
 * ("Pick one · 38 answered", "38 answered · Not sure 8%") — the console's
 * card header states the count instead (KindResult.jsx), and this presenter
 * has no such header, one question already being the header. Fix round 1:
 * this used to live inside RatingResult.jsx itself; moved OUT so the cut
 * sheet and the paper report stay byte-unchanged (they already print the
 * count once, in KindResult's header — GameReport.jsx:575) and so the SAME
 * line reads the same way for every kind, not rating alone.
 *
 * TEXT PAGES SEPARATELY FROM THE QUESTION COUNT. "the open answers in large
 * type, paged, so a long list cycles page by page" — components/stage/
 * Pager.jsx already owns exactly this (the same budget and ↑/↓ key the live
 * RESULTS answer list pages with, config/stagePaging.js), so a long text
 * question's answers turn under Pager's own key before Next/→/Space moves the
 * presenter to the next QUESTION. There is no Workie grouping and no
 * "feature this quote" control here — both are explicitly out of this task's
 * scope (the brief's own words); TextResult renders the plain list the frozen
 * aggregate holds, same as the console.
 *
 * STEPPING BACK INTO A TEXT QUESTION LANDS ON ITS LAST PAGE, not page 1 (fix
 * round 1, M3) — the same direction the console reads in: arriving from
 * "ahead" of a list lands you at its end, not its start, which is also why
 * `HostActionBar`'s own ← is called stepping "backwards" rather than "to the
 * top."
 *
 * AT THE LAST RESULT, THE KEYBOARD'S NEXT IS A NO-OP (fix round 1, ruling
 * I4) — only the Done button and Esc leave. A presenter's clicker sends
 * Space/→, and the dock entry point lands back on a CLOSED survey's stage
 * whose primary ("End the session") carries no confirm — a clicker's stray
 * extra click must not end the session. `stepForward()` returns whether it
 * moved; the Done BUTTON's own onClick checks that return and leaves when it
 * did not, but the keyboard's 'next' intent calls it and discards the
 * result, so the same press that would have advanced simply does nothing
 * once there is nowhere left to go.
 *
 * TAKING AND RELEASING THE KEYS. Unlike the scoreboard — which toggles OVER a
 * stage that stays mounted, so GameHostPage needs a page-level hook
 * (`useScoreboardKeys`) purely to decide whether the shortcut fires at all —
 * this presenter REPLACES the stage. GameHostPage.jsx renders it as an early
 * return, the same shape `showReport` / `showSurveyResults` already use, so
 * mounting IS opening and unmounting IS closing: HostActionBar and the live
 * round's own dock are not in the tree, and their `window` keydown listeners
 * are gone with them.
 *
 * THE LISTENER ITSELF IS ARMED ONCE (fix round 1, I3). The first cut re-armed
 * it on every render (no dependency array), which is exactly wrong for a
 * listener that must keep its PLACE in `window`'s dispatch order:
 * `removeEventListener` + `addEventListener` on every state change
 * (index/textPage both change on every Next) moves this listener to the back
 * of the queue relative to any OTHER listener that stayed put — so a second
 * or third keystroke could reach a stale sibling listener first. The
 * up-to-date `goNext`/`goPrevious`/`onLeave` closures live in a ref, assigned
 * on every render (the same shape `useScoreboardKeys`'s own `latest` ref
 * takes), and the ONE effect that adds/removes the DOM listener runs with an
 * empty dependency array — mounted once, unmounted once, its position in the
 * queue never disturbed by a re-render.
 *
 * REGISTERED IN THE CAPTURE PHASE, WITH `stopPropagation()` — genuine
 * defence in depth, not merely early-return coverage. A capture-phase
 * listener on `window` runs before ANY bubble-phase listener on the same
 * target during the same dispatch, regardless of registration order, so a
 * key this presenter owns cannot reach `HostActionBar`'s own bubble-phase
 * listener even in the pathological case of both being mounted at once —
 * proven directly in surveyWalkthrough.test.jsx by mounting a real
 * `HostActionBar` alongside this presenter and confirming its handler never
 * fires for a key the presenter claimed.
 *
 * `results` / `title` / `gameId` are the SAME fetched payload and target
 * `GameHostPage.jsx` already holds for the cut sheet (`surveyResultsData`,
 * `surveyResultsTarget`) — no new route, no new fetch shape. `gameId` drives
 * only the rail's join code, shown CLOSED (see below); it is never used to
 * refetch anything here.
 *
 * THE JOIN STRIP READS CLOSED, NOT LIVE. Every mockup sample in `s-02`
 * through `s-06` draws an open join block, but the walk-through only ever
 * exists once a survey's results are frozen — CLOSED or ENDED — and by then
 * nobody can join or answer. `Rail.jsx`'s own rule ("A FINISHED SESSION MUST
 * NOT ADVERTISE A LIVE ONE") already exists for exactly this, so this
 * presenter uses it (`join={{ code, closed: true }}`) rather than replaying
 * the mockups' placeholder sample data — a deliberate, documented departure
 * from the literal mockup, not an oversight.
 */
const RENDERERS = {
  rating: RatingResult,
  choice: ChoiceResult,
  yesno: YesNoResult,
  rank: RankResult,
};

export default function SurveyWalkthrough({
  results, title = '', profile = 'room', gameId = '', onLeave = () => {},
}) {
  const questions = useMemo(
    () => (results && Array.isArray(results.questions) ? results.questions : []),
    [results],
  );
  const total = questions.length;

  const [index, setIndex] = useState(0);
  const [textPage, setTextPage] = useState(0);

  // The list this presenter shows is fixed once fetched, but a re-render
  // against a different (shorter) survey — a host who leaves and reopens the
  // panel against another closed survey without this component remounting —
  // must not leave the index pointing past the end of the new list.
  useEffect(() => {
    if (total > 0 && index > total - 1) setIndex(total - 1);
  }, [index, total]);

  const question = questions[Math.min(index, Math.max(total - 1, 0))] || null;
  const n = (question && question.result && question.result.n) || 0;
  const isText = Boolean(question) && question.kind === 'text';
  const texts = isText && Array.isArray(question.texts) ? question.texts : [];
  const textPageSize = pageSizeFor(profile);
  const textSlice = pageSlice(texts, textPage, textPageSize);
  const Renderer = question ? RENDERERS[question.kind] : null;

  const isLastQuestion = total === 0 || index >= total - 1;
  const isLastTextPage = !isText || textSlice.page >= textSlice.pages - 1;
  const atEnd = isLastQuestion && isLastTextPage;

  /**
   * Moves one step forward — a text question's own pages first, then the
   * next question. Returns whether it actually moved, so callers can decide
   * what "nothing left to do" means for THEM: the Done button leaves, the
   * keyboard does nothing (see the header's ruling I4).
   */
  const stepForward = () => {
    if (isText && textSlice.page < textSlice.pages - 1) {
      setTextPage(textSlice.page + 1);
      return true;
    }
    if (!isLastQuestion) {
      setIndex(index + 1);
      setTextPage(0);
      return true;
    }
    return false;
  };

  /**
   * One step back. M3 (fix round 1): stepping back INTO a text question
   * lands on its LAST page, not its first — arriving from ahead of a list
   * lands at its end.
   */
  const goPrevious = () => {
    if (isText && textPage > 0) {
      setTextPage(textPage - 1);
      return;
    }
    if (index > 0) {
      const prevQuestion = questions[index - 1];
      const prevIsText = Boolean(prevQuestion) && prevQuestion.kind === 'text';
      const prevLastPage = prevIsText
        ? Math.max(0, pageCount(
          Array.isArray(prevQuestion.texts) ? prevQuestion.texts.length : 0,
          textPageSize,
        ) - 1)
        : 0;
      setIndex(index - 1);
      setTextPage(prevLastPage);
    }
  };

  const atStart = index === 0 && (!isText || textPage === 0);

  // The Done button's own click: unlike the keyboard's 'next' intent below,
  // a click that finds nothing left to advance to is the host's deliberate
  // "I'm done" — it leaves.
  const handleNextClick = () => {
    if (!stepForward()) onLeave();
  };

  /*
    THE LISTENER — armed once (see the header's "ARMED ONCE" note), reading
    the latest actions from a ref so it never goes stale without having to be
    torn down and re-added on every render.
  */
  const actionsRef = useRef(null);
  actionsRef.current = { stepForward, goPrevious, onLeave };

  useEffect(() => {
    const onKeyDown = (event) => {
      const intent = surveyWalkthroughKeyIntent(event);
      if (!intent) return;
      event.preventDefault();
      // Capture phase already puts this ahead of any bubble-phase listener
      // on `window` for the same event; stopPropagation is still correct
      // here so nothing ELSE — capture-phase or bubble-phase, on `window` or
      // a descendant — reacts to a key this presenter has claimed.
      event.stopPropagation();
      const actions = actionsRef.current;
      if (intent === 'next') actions.stepForward(); // no-op at the end — I4
      else if (intent === 'previous') actions.goPrevious();
      else actions.onLeave(); // 'close' (Esc)
    };
    // `true` = capture phase, on both add and remove (the third argument
    // must match for removeEventListener to find the same registration).
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <Stage
      profile={profile}
      phase="results"
      // C1 (fix round 1): without this, useStageFit keeps the FIRST
      // question's --fit / data-clamped for every later question and text
      // page (GameHostPage.jsx's own fitKey carries the identical warning:
      // "without this a question arriving... would re-render the stage and
      // never re-measure it"). Both terms that change what is actually on
      // screen: which question, and which page of a text question's answers.
      fitKey={`${index}|${textSlice.page}`}
      rail={(
        <Rail
          phase="results"
          title={title || 'Engagements'}
          context={total
            ? { category: 'Survey', round: index + 1, of: total, noun: 'Question' }
            : { category: 'Survey' }}
          join={gameId ? { code: gameId, closed: true } : {}}
        />
      )}
      dock={(
        <Dock status="Walking the room through the results" kbd={atEnd ? '' : 'SPACE'}>
          <button type="button" className="btn ghost" onClick={goPrevious} disabled={atStart}>
            Previous
          </button>
          <button type="button" className="btn primary" onClick={handleNextClick}>
            {atEnd ? 'Done' : 'Next result'}
          </button>
        </Dock>
      )}
    >
      <div className="content">
        <div className="fitbox">
          {question ? (
            <>
              <p className="recap">{question.title}</p>
              {/*
                `.qdetail`, NEVER `.reduced`. `.reduced` is `useStageFit.js`'s
                own reserved announcement slot — `reset()` unconditionally
                empties and hides the first `.reduced` element it finds under
                `.content` on every fit pass, mount included, so a message
                given that class here would be wiped the instant the fitter
                ran (found the hard way: this line rendered nothing at all
                until `.qdetail` replaced `.reduced`). `.qdetail` is already
                an ordinary stage-ladder class with no special meaning to the
                fitter beyond the content it truncates like anything else.
              */}
              {n === 0 ? (
                <p className="qdetail">No answers yet.</p>
              ) : (
                <>
                  {/* One "N answered" line, every kind — see the header note
                      on fix round 1's I2 ruling. */}
                  <p className="rule-note">{n} answered.</p>
                  {isText ? (
                    <div className="svw">
                      <TextResult question={question} page={textSlice.page} pageSize={textPageSize} />
                      <Pager
                        total={texts.length}
                        page={textSlice.page}
                        pageSize={textPageSize}
                        noun="Answers"
                        onPage={setTextPage}
                      />
                    </div>
                  ) : Renderer ? (
                    <div className="svw">
                      <Renderer question={question} />
                    </div>
                  ) : (
                    <p className="qdetail">This question type is not shown here.</p>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="qdetail">No questions to show.</p>
          )}
        </div>
      </div>
    </Stage>
  );
}
