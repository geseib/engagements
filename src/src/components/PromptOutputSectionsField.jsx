import React from 'react';
import { DEFAULT_OUTPUT_HEADINGS } from './PromptShapePreview';

/**
 * THE REPLY'S HEADINGS — a Workie's `outputSections`, editable at last.
 *
 * The owner, 2026-09-25, met the editor's finding "discussionQuestions and
 * nextSteps will come back empty on every round" on a prompt whose sections
 * were The Winning Title · The Reveal · Keep Playing. The finding said to
 * rename a section so it matches — and the editor had no field for sections:
 * it checked the SAVED ones and never sent any back. So the one finding that
 * is fixed here could be fixed nowhere. Spec: docs/superpowers/specs/
 * 2026-09-25-prompt-workbench-design.md.
 *
 * `value` is the declaration — an array of { heading, guidance } — or
 * null/undefined for the default three. `onChange(null)` goes back to the
 * default, which the save sends as `outputSections: null` to clear it.
 *
 * NO VALIDATION HERE, on purpose: the editor's checks (utils/promptPreflight.js,
 * `output-shape-discarded`) already hold every rule of prompt-shape.js and
 * block the save, beside everything else that blocks it. A second copy of the
 * rules in this field would be a second place to drift. The one rule enforced
 * here is the count, by not offering a ninth row.
 *
 * Renders inside the editor's `.pmgr` form with its classes, like
 * RoundAnglesField.
 */
export const MAX_SECTIONS = 8;

export default function PromptOutputSectionsField({ value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const declared = rows.length > 0;

  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length ? next : null);
  };
  const add = () => onChange([...rows, { heading: '', guidance: '' }]);
  const writeOwn = () => onChange(DEFAULT_OUTPUT_HEADINGS.map((heading) => ({ heading, guidance: '' })));

  return (
    <div className="form-group pmgr-sections" data-testid="prompt-sections">
      <label>Output sections</label>
      <p className="prompt-half-lede">
        The headings the reply must use, in this order, each with a line saying what goes under it.
        The host&rsquo;s phone remote and the reports list a section only when its heading reads like
        &ldquo;Discussion topics&rdquo; or &ldquo;Next steps&rdquo;; the projector shows every section.
      </p>

      {declared ? (
        <ol className="pmgr-sections-list">
          {rows.map((row, i) => (
            // Index keys on purpose: a row IS its position — the order is the
            // contract — and two rows may carry the same heading mid-edit.
            <li className="pmgr-section-row" key={i}>
              <input
                type="text"
                aria-label={`Heading ${i + 1}`}
                value={row && typeof row.heading === 'string' ? row.heading : ''}
                placeholder="A heading, in plain words"
                onChange={(e) => update(i, { heading: e.target.value })}
              />
              <input
                type="text"
                aria-label={`Guidance for heading ${i + 1}`}
                value={row && typeof row.guidance === 'string' ? row.guidance : ''}
                placeholder="What goes under it, in one sentence"
                onChange={(e) => update(i, { guidance: e.target.value })}
              />
              <button
                type="button"
                className="pmgr-section-remove"
                aria-label={`Remove heading ${i + 1}`}
                title={`Remove heading ${i + 1}`}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pmgr-sections-default" data-testid="prompt-sections-default">
          None declared, so the default runs: {DEFAULT_OUTPUT_HEADINGS.join(' · ')}.
        </p>
      )}

      <div className="pmgr-sections-actions">
        {declared ? (
          <>
            <button type="button" className="btn-secondary" onClick={add} disabled={rows.length >= MAX_SECTIONS}>
              Add a heading
            </button>
            <button type="button" className="btn-secondary" onClick={() => onChange(null)}>
              Use the default headings
            </button>
          </>
        ) : (
          <button type="button" className="btn-secondary" onClick={writeOwn}>
            Write your own headings
          </button>
        )}
      </div>
    </div>
  );
}
