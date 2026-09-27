import React from 'react';
import RatingResult from '../survey/results/RatingResult';
import ChoiceResult from '../survey/results/ChoiceResult';
import YesNoResult from '../survey/results/YesNoResult';
import TextResult from '../survey/results/TextResult';
import '../survey/results/SurveyResults.css';

/**
 * A POLL ON THE WALL — the question's options, filling in as the room answers.
 *
 * The owner, 27 Sep 2026: "the question is asked and the options are
 * registered on screen right away … showing the options for poll can be the
 * same one that starts showing the results." So there is no separate "here
 * are the options" screen: during ASK this draws every option at 0%, and each
 * answer moves its bar; at RESULTS the same board simply stops moving.
 *
 * The survey's own renderers (components/survey/results), at the wall's
 * scale — `.svw`, exactly as SurveyWalkthrough mounts them — fed the round's
 * tally, which is the survey's aggregate over the round's answers
 * (lambda-functions/game/poll-round.js; live from GET /answers/host, final
 * from get-results). No arithmetic here: a share, a mean or a split is the
 * aggregate's, never re-derived.
 *
 * `question` is the poll's question as the server sends it (`{ kind, …the
 * kind's fields }`); `tally` the aggregate's shape for that kind plus `texts`
 * (open answers, write-ins, whys — nameless, in content-hash order).
 */
const RENDERERS = { rating: RatingResult, choice: ChoiceResult, yesno: YesNoResult };

/** Open answers on the wall at once: a screenful, newest never first (the order is a hash). */
const TEXT_ON_WALL = 6;

export default function PollBoard({ question, tally, live = false }) {
  if (!question || !question.kind) return null;
  const result = tally || { n: 0 };
  const shaped = { ...question, result, texts: Array.isArray(result.texts) ? result.texts : [] };
  const n = result.n || 0;
  const Renderer = RENDERERS[question.kind];

  let note;
  if (n > 0) note = `${n} answered${live ? ' so far' : ''}.`;
  else note = live ? 'Answers fill in here as they arrive.' : 'Nobody answered this one.';

  return (
    <div className="svw" data-poll-kind={question.kind} data-live={live ? '' : undefined}>
      <p className="rule-note" aria-live={live ? 'polite' : undefined}>{note}</p>
      {question.kind === 'text'
        ? (n > 0 && <TextResult question={shaped} page={0} pageSize={TEXT_ON_WALL} />)
        : Renderer && <Renderer question={shaped} />}
    </div>
  );
}
