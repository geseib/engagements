import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import QuestionCard from './QuestionCard';
import { filterBrowserRows } from '../config/setupPanel';
import { resolveInstruction } from '../config/instructions';
import {
  stagedQuestion, previewRows, previewCategories, stepSelection,
} from '../config/questionPreview';
import './QuestionPreview.css';

/** Input types a person types into — ↑/↓ belong to the field there, not the list. */
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  return TEXT_ENTRY_TYPES.has(String(target.type || 'text').toLowerCase());
}

const optionDomId = (id) => `qprev-opt-${id}`;

/**
 * [Table] [Preview] — the Questions tab's two views of one working copy.
 *
 * Its own root and theme, because it sits in the Questions panel's toolbar
 * OUTSIDE the preview: the panel is paper on both mounts (the admin console
 * renders the editor with contentTheme 'light', AdminPage.jsx:1636; the host
 * shelf inside `.qsets--onlight`), and the token block it reads is declared on
 * `.qprev-switch` as well as `.qprev`.
 *
 * `previewBlocked` is the reason Preview cannot be pressed, or '' when it can.
 * A disabled control says why on its own title — never a dead button.
 */
export function QuestionViewSwitch({ mode = 'table', onChange, previewBlocked = '' }) {
  return (
    <div className="qprev-switch" data-theme="light" role="group" aria-label="How the questions are shown">
      <button
        type="button"
        className="qprev-seg-btn"
        aria-pressed={mode === 'table'}
        onClick={() => onChange && onChange('table')}
      >
        Table
      </button>
      <button
        type="button"
        className="qprev-seg-btn"
        aria-pressed={mode === 'preview'}
        disabled={Boolean(previewBlocked)}
        title={previewBlocked || undefined}
        onClick={() => onChange && onChange('preview')}
      >
        Preview
      </button>
    </div>
  );
}

/**
 * THE PREVIEW — browse a set and see each question as the room will.
 *
 * Spec: docs/superpowers/specs/2026-09-19-question-preview-design.md. Two panes:
 * the in-session browser's mechanics on the left (search, category chips,
 * "Showing N of M", click a row), and on the right the card the live stage
 * renders — components/QuestionCard.jsx, the same component — at the Table
 * profile on the stage's dusk ground.
 *
 * IT NEVER TOUCHES document.documentElement. The stage keeps its display
 * profile there (components/stage/Stage.jsx), and a preview that re-classed the
 * root would re-profile a projector. The Table ladder reaches the card through
 * the `.stage-ladder-table` class on the screen pane instead (styles/stage.css).
 *
 * IT READS THE WORKING COPY, NOT THE SERVER. `rows` is the Questions panel's
 * array, tombstones and unsaved edits included; a removed row is not listed,
 * and an edit made in the question dialog shows here the moment Done is pressed.
 *
 * ↑ / ↓ STOP HERE. They are handled on this root and never reach a window
 * listener — the stage's pager pages on a bare ↑/↓ (config/stagePaging.js
 * `pageIntentFor`), and a preview key must never turn a page on a projector.
 * They step through the VISIBLE rows, wrap at the ends, and belong to the field
 * instead whenever focus is in something the person types into.
 */
export default function QuestionPreview({
  rows = [],
  gameType = 'call-and-answer',
  setInstruction = '',
  setId = '',
  onEditQuestion,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // STICKY: flip to Reveal once and every question you move to shows its answer.
  const [phase, setPhase] = useState('ASK');

  const listRows = useMemo(() => previewRows(rows), [rows]);
  const categories = useMemo(() => previewCategories(listRows), [listRows]);
  // A chip whose last question was edited into another category filters
  // nothing that exists; it stops being a filter rather than emptying the list.
  const activeCategory = categories.includes(category) ? category : '';
  const visible = useMemo(
    () => filterBrowserRows(listRows, { search, category: activeCategory, matchDetail: true }),
    [listRows, search, activeCategory],
  );
  const selected = visible.find((r) => r.id === selectedId) || visible[0] || null;

  // A selection that is filtered out MOVES to the first visible row — it does
  // not wait there to snap back when the filter clears.
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const selectedRow = selected ? rows.find((r) => r.uid === selected.id) || null : null;
  const staged = selectedRow ? stagedQuestion(selectedRow, { setId }) : null;
  const reveal = gameType === 'trivia' && phase === 'REVEAL';

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (isTextEntry(event.target)) return;
    const next = stepSelection(visible.map((r) => r.id), selected ? selected.id : null,
      event.key === 'ArrowDown' ? 1 : -1);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(next);
    const el = document.getElementById(optionDomId(next));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  };

  if (listRows.length === 0) {
    return (
      <div className="qprev qprev--empty" data-theme="light" data-testid="question-preview">
        <p className="qprev-empty">This set has no questions yet, so there is nothing to preview.</p>
      </div>
    );
  }

  /* The root's keydown is a delegate for the list's keys, not a control of its
     own: the listbox inside is the focusable element, and the chips, the toggle
     and Edit keep ↑/↓ working when focus has moved onto them. */
  return (
    <div className="qprev" data-theme="light" data-testid="question-preview" onKeyDown={onKeyDown}>
      <div className="qprev-list">
        <input
          type="search"
          className="qprev-search"
          placeholder="Search titles and details…"
          aria-label="Search titles and details"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {categories.length > 1 && (
          <div className="qprev-chips" role="group" aria-label="Category">
            <button
              type="button"
              className="qprev-chip"
              aria-pressed={activeCategory === ''}
              onClick={() => setCategory('')}
            >
              All
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                className="qprev-chip"
                aria-pressed={activeCategory === name}
                onClick={() => setCategory(activeCategory === name ? '' : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <p className="qprev-count" data-testid="preview-count">
          {`Showing ${visible.length} of ${listRows.length}`}
        </p>
        {visible.length === 0 ? (
          <div className="qprev-nomatch">
            <p>
              {`No questions match “${search.trim()}”${activeCategory ? ` in ${activeCategory}` : ''}.`}
            </p>
            <button type="button" className="qprev-link" onClick={() => setSearch('')}>
              Clear search
            </button>
          </div>
        ) : (
          <ul
            className="qprev-rows"
            role="listbox"
            aria-label="Questions"
            tabIndex={0}
            aria-activedescendant={selected ? optionDomId(selected.id) : undefined}
          >
            {visible.map((r) => {
              const title = r.title || 'Untitled question';
              return (
                <li
                  key={r.id}
                  id={optionDomId(r.id)}
                  role="option"
                  aria-selected={Boolean(selected && selected.id === r.id)}
                  className="qprev-row"
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="qprev-row-title" title={title}>{title}</span>
                  <span className="qprev-row-meta">
                    {[r.category || 'No category', r.difficulty].filter(Boolean).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="qprev-detail">
        <div className="qprev-bar">
          {gameType === 'trivia' && (
            <div className="qprev-seg" role="group" aria-label="What the card shows">
              <button
                type="button"
                className="qprev-seg-btn"
                aria-pressed={!reveal}
                onClick={() => setPhase('ASK')}
              >
                ASK
              </button>
              <button
                type="button"
                className="qprev-seg-btn"
                aria-pressed={reveal}
                onClick={() => setPhase('REVEAL')}
              >
                Reveal
              </button>
            </div>
          )}
          {selected && (
            <span className="qprev-pos" data-testid="preview-position">
              {`${visible.indexOf(selected) + 1} / ${visible.length}`}
            </span>
          )}
          {selectedRow && typeof onEditQuestion === 'function' && (
            <button type="button" className="qprev-btn qprev-edit" onClick={() => onEditQuestion(selectedRow)}>
              <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit this question
            </button>
          )}
        </div>

        {/* THE SCREEN. Dusk and the Table ladder on this pane alone, so the card
            looks like the stage inside a paper editor. Nothing in here is
            restyled by this component's stylesheet: the card's rules are
            stage.css's, untouched (QuestionPreviewPalette.test.js holds that). */}
        <div className="qprev-screen stage-ladder-table" data-theme="dark" data-testid="preview-screen">
          {staged ? (
            <div className="qprev-card">
              <QuestionCard
                phase={reveal ? 'REVEAL' : 'ASK'}
                question={staged}
                gameType={gameType}
                instruction={resolveInstruction(staged, setInstruction, gameType)}
              />
            </div>
          ) : (
            <p className="qprev-screen-empty">Nothing is selected.</p>
          )}
        </div>

        {/* NOT ON THE SCREEN, AND SAID SO. The stage's RESULTS never shows the
            reveal text — it reaches players only in the round report — so it
            sits below and outside the screen, under the editor's own words. */}
        {reveal && selectedRow && selectedRow.answerDetails && (
          <p className="qprev-note" data-testid="preview-note">
            <b>Reveal — shown only after the round</b>
            {selectedRow.answerDetails}
          </p>
        )}
      </div>
    </div>
  );
}
