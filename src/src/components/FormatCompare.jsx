import React from 'react';
import Icon from './Icon';
import FormatPreview from './FormatPreview';
import { formatGuide } from '../config/formatGuide';

/**
 * COMPARE THE FORMATS (docs/design/new-engagement frame 2, 12b).
 *
 * The rows all three reviewers praised, with the three the first-time review
 * corrected: Pace replaces the guessed "Typical length", Questions is an offer
 * ("Ready-made, or write your own"), and Starts says a Survey opens the moment
 * it is created. The head row, with each Use button, sticks while the rows
 * scroll (the 1280×720 frame), and the column the pressed meeting type
 * suggests is labelled in words, not only tinted.
 *
 * A real table: a hidden caption, `th scope="colgroup"` group heads, `th
 * scope="row"` row heads, `th scope="col"` format heads.
 */
const ROWS = [
  ['room', 'The room'],
  ['get', 'You get'],
  ['pace', 'Pace'],
  ['size', 'Group size'],
  ['questions', 'Questions'],
  ['starts', 'Starts'],
];

export default function FormatCompare({
  options = [], value = '', suggested = '', suggestedFor = '', onUse, onBack,
  /** A phone: "Use this", which fits (the name is in the column head; live dev test 4 N1). */
  shortUse = false,
}) {
  const live = options.filter((o) => !o.handoff);
  const own = options.filter((o) => o.handoff);
  return (
    <div className="gsd-compare" data-testid="gsd-compare">
      <div className="gsd-compare-head">
        <button type="button" className="gsd-btn gsd-btn--link" onClick={onBack}>
          <Icon name="ArrowLeft" size={14} /> Back to the form
        </button>
        <h3 className="gsd-compare-t" id="gsd-compare-t" tabIndex={-1}>Compare the formats</h3>
        <span className="gsd-compare-sub">Your title is kept. “Use …” returns you to the form with that format chosen.</span>
      </div>
      <div className="gsd-compare-scroll">
        <table className="gsd-compare-tbl" aria-labelledby="gsd-compare-t">
          <caption className="gsd-sr">What each format does in the room, what you get, and how it runs</caption>
          <colgroup>
            <col className="gsd-compare-rowhead" />
            {options.map((o) => <col key={o.id} className={o.id === suggested ? 'is-suggested' : ''} />)}
          </colgroup>
          <thead>
            <tr className="gsd-compare-groups">
              <td />
              <th scope="colgroup" colSpan={live.length}>Play a set of questions live</th>
              {own.length > 0 && <th scope="colgroup" colSpan={own.length} className="gsd-compare-own">Continue on their own page</th>}
            </tr>
            <tr className="gsd-compare-formats">
              <td />
              {options.map((o) => {
                const isSuggested = o.id === suggested;
                const on = o.id === value;
                return (
                  <th key={o.id} scope="col" className={`${isSuggested ? 'is-suggested' : ''}${o.handoff && o === own[0] ? ' gsd-compare-own' : ''}`}>
                    <FormatPreview format={o.id} />
                    <span className="gsd-compare-name">
                      {o.icon && <Icon name={o.icon} size={15} />} {o.label}
                    </span>
                    {isSuggested && suggestedFor && (
                      <span className="gsd-compare-sugg"><Icon name="Check" size={12} weight="bold" /> Suggested for a {suggestedFor.toLowerCase()}</span>
                    )}
                    {on && !isSuggested && <span className="gsd-compare-sugg"><Icon name="Check" size={12} weight="bold" /> Chosen</span>}
                    <button
                      type="button"
                      className={`gsd-btn gsd-compare-use${isSuggested || on ? " is-on" : ""}`}
                      onClick={() => onUse?.(o.id)}
                      aria-label={`Use ${o.label}`}
                    >
                      {shortUse ? 'Use this' : `Use ${o.label}`}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([key, head]) => (
              <tr key={key}>
                <th scope="row">{head}</th>
                {options.map((o) => (
                  <td key={o.id} className={`${o.id === suggested ? 'is-suggested' : ''}${o.handoff && o === own[0] ? ' gsd-compare-own' : ''}`}>
                    {formatGuide(o.id)[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
