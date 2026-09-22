import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { ADD_MODES, MAX_CATEGORIES, rowsFromCsv, holdToMode } from '../utils/addQuestions';
import { PER_CATEGORY_PRESETS } from './CountField';
import { gameTypeLabel } from '../config/gameTypes';

/**
 * "ADD QUESTIONS" — the set is the hero, and the whole job is one sentence.
 *
 * What it replaced: a dialog that asked a question, then offered three routes,
 * then opened a builder whose form asked everything again. The owner's brief:
 * the experience that would thrill Jobs, Ive, Spielberg. So: REMOVE.
 *
 *   1. The set's name, as the headline. Under it, the balance — every
 *      category with its count, drawn as bars — because "is Method thin?" is
 *      the question a person is actually here to answer.
 *   2. One sentence: "Write **3** more in each of its **5** categories", or
 *      "…in **2** new categories". The bars answer live: History 8 → 11.
 *   3. One button: "Write 15 more". Workie starts at once — the builder opens
 *      already generating, with the set's own topic, audience and difficulty —
 *      and comes back to "Add 15 to the set".
 *
 * The CSV and by-hand routes survive as two quiet links at the foot: real,
 * reachable, and not in the way.
 *
 * NOTHING IS WRITTEN HERE. Rows join the editor's working copy and are saved,
 * as a new version, by the editor's own Save.
 */
export default function AddQuestionsDialog({
  setName,
  engagementType,
  categories = [],
  counts = new Map(),
  currentRows = [],
  aiAvailable = true,
  onClose,
  onOpenBuilder,
  onWriteOne,
  onAddRows,
}) {
  const hasCategories = categories.length > 0;
  const room = Math.max(0, MAX_CATEGORIES - categories.length);
  const [mode, setMode] = useState(hasCategories ? ADD_MODES.EXISTING : ADD_MODES.NEW);
  const [per, setPer] = useState(3);
  const [newCats, setNewCats] = useState(Math.min(2, Math.max(1, room)));
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState(null);

  const existing = mode === ADD_MODES.EXISTING;
  const catCount = existing ? categories.length : newCats;
  const total = Math.min(100, per * Math.max(1, catCount));
  const existingTotal = categories.reduce((n, c) => n + (counts.get(c) || 0), 0);
  const max = Math.max(1, ...categories.map((c) => counts.get(c) || 0), existing ? per : 0) + (existing ? per : 0);

  const readFile = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = rowsFromCsv(e.target.result);
      setCsv(parsed.error ? { fileName: file.name, error: parsed.error } : { fileName: file.name, parsedRows: parsed.rows });
    };
    reader.readAsText(file);
  };
  const held = csv && csv.parsedRows ? holdToMode(csv.parsedRows, currentRows, mode) : null;
  const dirty = Boolean(held);
  const requestClose = () => {
    if (dirty && !window.confirm('Close without adding? The file you chose has not been added.')) return;
    if (onClose) onClose();
  };

  const num = (value, set, maxV, label) => (
    <span className="addq-num" role="group" aria-label={label}>
      {PER_CATEGORY_PRESETS.filter((p) => p <= maxV).map((p) => (
        <button
          key={p}
          type="button"
          className={`addq-pill${value === p ? ' is-on' : ''}`}
          aria-pressed={value === p}
          onClick={() => set(p)}
        >
          {p}
        </button>
      ))}
    </span>
  );

  return (
    <Modal
      overlayClassName="qsets qsets-scrim qsets-scrim--over"
      contentClassName="qsets-modal addq"
      labelledBy="addq-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty}
      closeOnEscape={() => !dirty}
    >
      <header className="addq-head">
        <div className="qsets-grow">
          <p className="addq-kicker">Add to · {gameTypeLabel(engagementType)}</p>
          <h2 id="addq-title" className="addq-title">{setName}</h2>
        </div>
        <button type="button" className="qs-dialog-close" onClick={requestClose} aria-label="Close add questions" title="Close" data-testid="addq-close">×</button>
      </header>

      <div className="addq-body">
        {/* THE BALANCE. Every category, its count, and — live — what it becomes. */}
        <ol className="addq-bars" data-testid="addq-balance" aria-label="Questions in each category">
          {categories.map((name) => {
            const now = counts.get(name) || 0;
            const after = existing ? now + per : now;
            return (
              <li key={name} className="addq-bar">
                <span className="addq-bar-name" title={name}>{name}</span>
                <span className="addq-bar-track">
                  <span className="addq-bar-fill" style={{ width: `${(now / max) * 100}%` }} />
                  {existing && <span className="addq-bar-add" style={{ left: `${(now / max) * 100}%`, width: `${(per / max) * 100}%` }} />}
                </span>
                <span className="addq-bar-n">{existing ? <>{now} <b>→ {after}</b></> : now}</span>
              </li>
            );
          })}
          {!existing && Array.from({ length: newCats }).map((_, i) => (
            <li key={`new-${i}`} className="addq-bar addq-bar--new">
              <span className="addq-bar-name">New category {i + 1}</span>
              <span className="addq-bar-track"><span className="addq-bar-add" style={{ left: 0, width: `${(per / max) * 100}%` }} /></span>
              <span className="addq-bar-n"><b>+{per}</b></span>
            </li>
          ))}
          {!hasCategories && existing && <li className="qsets-dim">This set has no categories yet.</li>}
        </ol>

        {/* THE SENTENCE. */}
        <div className="addq-say" role="radiogroup" aria-label="Where the new questions go">
          <label className={`addq-line${existing ? ' is-on' : ''}${!hasCategories ? ' is-off' : ''}`}>
            <input type="radio" name="addq-mode" checked={existing} disabled={!hasCategories} onChange={() => setMode(ADD_MODES.EXISTING)} />
            <span>Write {num(per, setPer, 10, 'More in each')} more in each of its <b>{categories.length}</b> categor{categories.length === 1 ? 'y' : 'ies'}</span>
          </label>
          <label className={`addq-line${!existing ? ' is-on' : ''}${room === 0 ? ' is-off' : ''}`}>
            <input type="radio" name="addq-mode" checked={!existing} disabled={room === 0} onChange={() => setMode(ADD_MODES.NEW)} />
            <span>
              Write {num(per, setPer, 10, 'In each new')} in each of {num(newCats, setNewCats, Math.min(10, room), 'New categories')} <b>new</b> categor{newCats === 1 ? 'y' : 'ies'}
              {room === 0 && <small> — the set already holds all {MAX_CATEGORIES}</small>}
            </span>
          </label>
          <p className="addq-sum" data-testid="addq-sum">
            <b>{total}</b> new questions · the set goes from {existingTotal} to {existingTotal + total}. Nothing existing changes.
          </p>
        </div>

        {aiAvailable ? (
          <button
            type="button"
            className="addq-go"
            data-testid="addq-go"
            onClick={() => onOpenBuilder && onOpenBuilder(mode, { per, numberOfCategories: catCount, count: total, autoStart: true })}
          >
            <Icon name="Sparkle" weight="duotone" size={18} color="currentColor" />
            Write {total} more
          </button>
        ) : (
          <p className="qsets-dim">Survey questions are written by hand or uploaded — Workie does not draft them.</p>
        )}

        {/* THE QUIET WAYS. */}
        <div className="addq-alt">
          <button type="button" className="qsets-btn qsets-btn--link" onClick={() => setCsvOpen((o) => !o)} aria-expanded={csvOpen}>Upload a CSV instead</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="qsets-btn qsets-btn--link" onClick={() => onWriteOne && onWriteOne(mode)}>Write one by hand</button>
        </div>
        {csvOpen && (
          <div className="addq-csv">
            <input type="file" accept=".csv" onChange={readFile} aria-label="CSV of questions to add" />
            {csv && csv.error && <p className="qsets-alert qsets-alert--error" role="alert">{csv.error}</p>}
            {held && (
              <div className="qsets-addq-held" data-testid="addq-held">
                <p><b>{held.kept.length}</b> of {csv.parsedRows.length} in {csv.fileName} fit “{existing ? 'its categories' : 'new categories'}”.</p>
                {held.dropped.length > 0 && (
                  <ul>{[...new Set(held.dropped.map((d) => d.reason))].map((r) => <li key={r}>{held.dropped.filter((d) => d.reason === r).length} left out — {r}</li>)}</ul>
                )}
                <button type="button" className="qsets-btn qsets-btn--primary" disabled={held.kept.length === 0} onClick={() => onAddRows && onAddRows(held, mode)}>
                  Add {held.kept.length}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
