import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { ADD_MODES, MAX_CATEGORIES, rowsFromCsv, holdToMode } from '../utils/addQuestions';
import { gameTypeLabel } from '../config/gameTypes';

/**
 * "ADD QUESTIONS" — the New set dialog's routes, pointed at a set that exists.
 *
 * The owner: "You should be able to add additional questions to a question set
 * using the exact same AI/csv/1by1 etc. it should be identical to the create
 * new. of course it should ask if you want the same categories, or are adding
 * new categories ... should either be one or the other at a time."
 *
 * So it asks ONE question first — where do they go? — and then offers the same
 * three ways in, in the same order and the same words as creating a set:
 * generate with AI, upload a CSV, write one by hand.
 *
 * WHY THE MODE IS ASKED AT ALL. Twelve new questions spread over a set's six
 * categories AND two new ones leaves the old categories at 7 and the new at 3:
 * a category the host switches on mid-session and exhausts in three rounds.
 * One mode per pass keeps each pass even.
 *
 * NOTHING IS WRITTEN HERE. Every route ends by handing rows to the editor's
 * working copy; they are saved, as a new version, by the editor's own Save.
 *
 * NEVER A MODAL FROM A MODAL: the AI route closes this dialog and hands over
 * to the builder; the by-hand route closes it and opens the question form.
 */
export default function AddQuestionsDialog({
  setName,
  engagementType,
  categories = [],
  counts = new Map(),
  currentRows = [],
  /** false where the caller has no builder for this format (survey). */
  aiAvailable = true,
  onClose,
  onOpenBuilder,
  onWriteOne,
  onAddRows,
  onDownloadTemplate,
}) {
  const hasCategories = categories.length > 0;
  const room = Math.max(0, MAX_CATEGORIES - categories.length);
  const [mode, setMode] = useState(hasCategories ? ADD_MODES.EXISTING : ADD_MODES.NEW);
  const [csv, setCsv] = useState(null); // { fileName, kept, dropped, error }

  const readFile = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = rowsFromCsv(e.target.result);
      if (parsed.error) { setCsv({ fileName: file.name, kept: [], dropped: [], error: parsed.error }); return; }
      setCsv({ fileName: file.name, error: '', parsedRows: parsed.rows });
    };
    reader.onerror = () => setCsv({ fileName: file.name, kept: [], dropped: [], error: `Could not read ${file.name}.` });
    reader.readAsText(file);
  };

  // Re-held whenever the mode changes, so the count on the button is always
  // the count for the mode on screen.
  const held = csv && csv.parsedRows ? holdToMode(csv.parsedRows, currentRows, mode) : null;
  const dirty = Boolean(csv && csv.parsedRows);

  const requestClose = () => {
    if (dirty && !window.confirm('Close without adding? The file you chose has not been added to the set.')) return;
    if (onClose) onClose();
  };

  const modeCard = (value, title, body, disabled, why) => (
    <label className={`qsets-mode${mode === value ? ' is-on' : ''}${disabled ? ' is-off' : ''}`}>
      <input
        type="radio"
        name="addq-mode"
        value={value}
        checked={mode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
      />
      <span className="qsets-mode-body">
        <span className="qsets-route-nm">{title}</span>
        <span className="qsets-route-when">{disabled ? why : body}</span>
      </span>
    </label>
  );

  return (
    <Modal
      overlayClassName="qsets qsets-scrim qsets-scrim--over"
      contentClassName="qsets-modal qsets-modal--create"
      labelledBy="qsets-addq-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty}
      closeOnEscape={() => !dirty}
    >
      <header>
        <Icon name="NotePencil" weight="duotone" size={20} color="var(--primary)" />
        <div className="qsets-grow">
          <h2 id="qsets-addq-title">Add questions</h2>
          <p className="qsets-dim">
            To “{setName}” · {gameTypeLabel(engagementType)}. They join the questions below and are saved,
            as a new version, when you press Save.
          </p>
        </div>
        <button
          type="button"
          className="qs-dialog-close"
          onClick={requestClose}
          aria-label="Close add questions"
          title="Close"
          data-testid="addq-close"
        >
          ×
        </button>
      </header>

      <div className="qsets-modal-body">
        <div className="qsets-section" role="radiogroup" aria-labelledby="addq-where">
          <h4 id="addq-where">Where do they go?</h4>
          <p className="qsets-route-when" style={{ margin: '-4px 0 10px' }}>
            One or the other per pass. Mixing the two leaves the new categories thin beside the old ones.
          </p>
          <div className="qsets-modes">
            {modeCard(
              ADD_MODES.EXISTING,
              'Into the categories this set already has',
              hasCategories
                ? categories.map((name) => `${name} (${counts.get(name) || 0})`).join(' · ')
                : '',
              !hasCategories,
              'This set has no categories yet.',
            )}
            {modeCard(
              ADD_MODES.NEW,
              'As new categories',
              `Room for ${room} more — a set holds ${MAX_CATEGORIES}.`,
              room === 0,
              `This set already has all ${MAX_CATEGORIES} categories it can hold.`,
            )}
          </div>
        </div>

        <div className="qsets-section">
          <h4>How do you want to make them?</h4>
          <div className="qsets-routes">
            {aiAvailable && (
              <div className="qsets-route qsets-route--lead">
                <span className="qsets-route-nm">Generate with AI</span>
                <p className="qsets-route-when">
                  The same builder that makes a new set
                  {mode === ADD_MODES.EXISTING
                    ? ', told to write into this set’s categories and nothing else.'
                    : ', told which category names are already taken.'}
                </p>
                <button
                  type="button"
                  className="qsets-btn qsets-btn--primary"
                  onClick={() => onOpenBuilder && onOpenBuilder(mode)}
                >
                  <Icon name="Sparkle" weight="duotone" size={14} color="currentColor" />
                  AI {gameTypeLabel(engagementType)} builder
                </button>
              </div>
            )}

            <div className="qsets-route">
              <span className="qsets-route-nm">Upload a CSV</span>
              <p className="qsets-route-when">
                The template’s columns. Only rows that fit the choice above are added; the rest are
                listed with the reason.
              </p>
              <div className="qsets-file">
                <input type="file" accept=".csv" onChange={readFile} aria-label="CSV of questions to add" />
                {onDownloadTemplate && (
                  <button type="button" className="qsets-btn qsets-btn--link" onClick={onDownloadTemplate}>
                    Download the template
                  </button>
                )}
              </div>
              {csv && csv.error && <p className="qsets-alert qsets-alert--error" role="alert">{csv.error}</p>}
              {held && (
                <div className="qsets-addq-held" data-testid="addq-held">
                  <p>
                    <b>{held.kept.length}</b> of {csv.parsedRows.length} in {csv.fileName} will be added.
                  </p>
                  {held.dropped.length > 0 && (
                    <ul>
                      {[...new Set(held.dropped.map((d) => d.reason))].map((reason) => (
                        <li key={reason}>
                          {held.dropped.filter((d) => d.reason === reason).length} left out — {reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="qsets-btn qsets-btn--primary"
                    disabled={held.kept.length === 0}
                    onClick={() => onAddRows && onAddRows(held, mode)}
                  >
                    Add {held.kept.length} question{held.kept.length === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>

            <div className="qsets-route">
              <span className="qsets-route-nm">Write one by hand</span>
              <p className="qsets-route-when">
                The question form, with AI drafting available inside it.
              </p>
              <button type="button" className="qsets-btn" onClick={() => onWriteOne && onWriteOne(mode)}>
                <Icon name="Plus" weight="bold" size={14} color="currentColor" /> Add a question
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer>
        <button type="button" className="qsets-btn" onClick={requestClose}>Close</button>
      </footer>
    </Modal>
  );
}
