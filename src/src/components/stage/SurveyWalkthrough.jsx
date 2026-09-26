import React, { useEffect, useMemo, useState } from 'react';
import Stage from './Stage';
import Rail from './Rail';
import Dock from './Dock';
import Pager from './Pager';
import ChoiceResult from '../survey/results/ChoiceResult';
import RatingResult from '../survey/results/RatingResult';
import YesNoResult from '../survey/results/YesNoResult';
import RankResult from '../survey/results/RankResult';
import TextResult from '../survey/results/TextResult';
import { pageSizeFor, pageSlice } from '../../config/stagePaging';
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
 * TAKING AND RELEASING THE KEYS. Unlike the scoreboard — which toggles OVER a
 * stage that stays mounted, so GameHostPage needs a page-level hook
 * (`useScoreboardKeys`) purely to decide whether the shortcut fires at all —
 * this presenter REPLACES the stage. GameHostPage.jsx renders it as an early
 * return, the same shape `showReport` / `showSurveyResults` already use, so
 * mounting IS opening and unmounting IS closing: HostActionBar and the live
 * round's own dock are not in the tree, and their `window` keydown listeners
 * are gone with them. The one `window.addEventListener` below is this
 * presenter's own — armed on mount, torn down on unmount, exactly the shape
 * `Scoreboard.jsx`'s own ← / → effect takes for the keys IT owns while
 * mounted. `event.stopImmediatePropagation()` is kept anyway, matching
 * `useScoreboardKeys`'s own close branch, as a second line of defence for any
 * listener that might otherwise still be registered on `window`.
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

  const goNext = () => {
    if (isText && textSlice.page < textSlice.pages - 1) {
      setTextPage(textSlice.page + 1);
      return;
    }
    if (!isLastQuestion) {
      setIndex(index + 1);
      setTextPage(0);
      return;
    }
    onLeave();
  };

  const goPrevious = () => {
    if (isText && textPage > 0) {
      setTextPage(textPage - 1);
      return;
    }
    if (index > 0) {
      setIndex(index - 1);
      setTextPage(0);
    }
  };

  const atStart = index === 0 && (!isText || textPage === 0);

  // Re-armed every render (goNext/goPrevious close over index/textPage), the
  // same trade — clarity over a stale-closure ref — Scoreboard.jsx's own
  // effect makes for the identical reason.
  useEffect(() => {
    const onKeyDown = (event) => {
      const intent = surveyWalkthroughKeyIntent(event);
      if (!intent) return;
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      if (intent === 'next') goNext();
      else if (intent === 'previous') goPrevious();
      else onLeave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <Stage
      profile={profile}
      phase="results"
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
          <button type="button" className="btn primary" onClick={goNext}>
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
              ) : isText ? (
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
          ) : (
            <p className="qdetail">No questions to show.</p>
          )}
        </div>
      </div>
    </Stage>
  );
}
