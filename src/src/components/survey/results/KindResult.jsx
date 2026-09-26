import React from 'react';
import Icon from '../../Icon';
import { surveyKindMeta, kindLabel } from '../../../config/surveyKinds';
import RatingResult from './RatingResult';
import ChoiceResult from './ChoiceResult';
import YesNoResult from './YesNoResult';
import RankResult from './RankResult';
import TextResult from './TextResult';
import './SurveyResults.css';

/**
 * ONE QUESTION'S RESULT CARD — the dispatcher over the five kinds.
 *
 * docs/design/survey-redesign/PLAN.md "Phase 3": "one KindResult per kind
 * ... Rating and yes/no are the two new shapes ... Choice reuses QuestionCard's
 * bars." This is the console/report shape (30-results.html), not the stage's
 * own walk-through (s-02..s-06, wall-only, out of Task 3's scope) — but it is
 * the SAME five renderers either way, so a later wall pass can reuse them too.
 *
 * PRESENTATIONAL BY RULE, per the task brief: props in, markup out, no
 * fetching, no state, so Task 4 mounts it unchanged in the paper report and
 * this task mounts it unchanged in the console. Every colour is a shared
 * token (SurveyResults.css), so the SAME markup renders correctly under
 * either data-theme.
 *
 * `question` is one entry of `GET /games/{id}/survey-results` `.questions[]`
 * (lambda-functions/game/survey-host.js `results()`): the question's own
 * fields (title, kind, options, scale, labels, …) beside its frozen `result`
 * (survey-aggregate.js's per-kind shape) and `texts` (its open answers,
 * write-ins or whys). `onOpenAnswers(qid)`, if given, is offered only to a
 * text question, wired to SurveyOpenAnswersPanel by the console.
 */
const RENDERERS = {
  rating: RatingResult,
  choice: ChoiceResult,
  yesno: YesNoResult,
  rank: RankResult,
  text: TextResult,
};

export default function KindResult({ question, onOpenAnswers }) {
  if (!question) return null;
  const kind = question.kind;
  const Renderer = RENDERERS[kind];
  const meta = surveyKindMeta(kind);
  const n = (question.result && question.result.n) || 0;

  return (
    <section className="svr-card">
      <header className="svr-card-head">
        <span className="svr-card-n">Q{question.n}</span>
        <span className="svr-chip">
          <Icon name={meta.icon} weight="bold" size={14} />
          {kindLabel(question)}
        </span>
        <span className="svr-grow" />
        <span className="svr-count">
          {n} answered
          {question.required ? '' : ' · optional'}
        </span>
      </header>
      <h3 className="svr-card-title">{question.title}</h3>
      <div className="svr-card-body">
        {n === 0 || !Renderer ? (
          <p className="svr-empty">No answers yet.</p>
        ) : (
          <Renderer question={question} onOpenAnswers={kind === 'text' ? onOpenAnswers : undefined} />
        )}
      </div>
    </section>
  );
}
