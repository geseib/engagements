import React, { useId, useRef } from 'react';
import { yesNoLabel, rovingIndex, NOTE_LIMIT } from './surveyAnswers';

/** Does this answer open the follow-up? "Either way" is yes or no — never "Not sure". */
export function asksWhy(question, v) {
  const when = question.followUpWhen;
  if (!when || !String(question.followUpPrompt ?? '').trim()) return false;
  if (when === 'any') return v === 'yes' || v === 'no';
  return when === v;
}

/**
 * YES / NO — two big halves (three with "Not sure"), p-04.
 *
 * NOT A TOGGLE, and NOTHING IS PRESELECTED: a switch has a default, and a
 * default here is an answer the person never gave.
 *
 * The follow-up opens IN PLACE under the answer that triggered it — one
 * screen, not a second question the progress bar would count — and only for
 * that answer. Moving to an answer that does not ask takes the note out of the
 * value, so a "why" can never be filed under the wrong answer.
 */
export default function YesNoInput({ question, value, onChange, onBlur }) {
  const answers = [
    { v: 'yes', label: yesNoLabel(question, 'yes') },
    { v: 'no', label: yesNoLabel(question, 'no') },
    ...(question.unsure ? [{ v: 'unsure', label: yesNoLabel(question, 'unsure') }] : []),
  ];
  const chosen = value && typeof value === 'object' ? value.v : null;
  const why = value && typeof value.why === 'string' ? value.why : '';
  const chosenIndex = answers.findIndex((a) => a.v === chosen);
  const tabStop = chosenIndex >= 0 ? chosenIndex : 0;
  const refs = useRef([]);
  const whyId = useId();
  const countId = useId();

  const choose = (v) => {
    const keep = asksWhy(question, v) && why.trim();
    onChange(keep ? { v, why } : { v });
  };

  const onKeyDown = (event, index) => {
    const next = rovingIndex(event.key, index, answers.length);
    if (next === null) return;
    event.preventDefault();
    choose(answers[next].v);
    const el = refs.current[next];
    if (el) el.focus();
  };

  const typeWhy = (text) => {
    const t = text.slice(0, NOTE_LIMIT);
    onChange(t.trim() ? { v: chosen, why: t } : { v: chosen }, { typing: true });
  };

  const groupName = question.unsure
    ? `${answers[0].label}, ${answers[1].label} or ${answers[2].label}`
    : `${answers[0].label} or ${answers[1].label}`;

  return (
    <>
      <div
        className={`plr-yn${question.unsure ? ' plr-yn--three' : ''}`}
        role="radiogroup"
        aria-label={groupName}
      >
        {answers.map((a, i) => (
          <button
            key={a.v}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={chosen === a.v}
            tabIndex={i === tabStop ? 0 : -1}
            className="plr-step"
            onClick={() => choose(a.v)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {asksWhy(question, chosen) && (
        <div className="plr-follow">
          <label className="plr-lab" htmlFor={whyId}>
            {question.followUpPrompt} <span className="plr-req">· optional</span>
          </label>
          <textarea
            id={whyId}
            className="plr-inp plr-inp--note"
            maxLength={NOTE_LIMIT}
            value={why}
            aria-describedby={countId}
            onChange={(e) => typeWhy(e.target.value)}
            onBlur={onBlur}
          />
          <p className="plr-count" id={countId}>{why.length} / {NOTE_LIMIT}</p>
        </div>
      )}
    </>
  );
}
