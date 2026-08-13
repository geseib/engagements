import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType, gameTypeLabel } from '../config/gameTypes';
import { ROUND_KINDS, roundKindApplies } from '../config/roundKinds';
import { editableRows, copiedRow } from '../utils/questionRows';

const API_BASE = () => window.API_BASE;

/**
 * PULL A QUESTION OUT OF ANOTHER SET — the owner's idea, and it is better than
 * the separate library screen it replaces:
 *
 *   *"I don't see the ability to edit existing sets or create a subset. I'm
 *    thinking the add question button offer to pull from another question set."*
 *
 * Cross-set reuse belongs inside the add-question flow, not on a screen of its
 * own. Two things fall out for free: "create a subset" is new set → add → pull
 * → save, and NO NEW ROUTE IS NEEDED. The library plan wanted one that does not
 * exist; this needs only two reads that already do.
 *
 * ── FILTER, NEVER SEARCH ───────────────────────────────────────────────────
 *
 * The owner cut search deliberately: *"Maybe we hold off on that search but. I
 * think it might need a different tool."* This screen therefore lists and
 * FILTERS — by category and by round direction, over questions already
 * fetched — and says "filter" everywhere, because that is all it does. There is
 * no index behind it and none should be added for this: a GSI buys one
 * cross-set partition, not relevance or ranking, at the price of write capacity
 * on every question write and a backfill over every existing row.
 *
 * ── THE READ IS OPEN; THE WRITE IS NOT ─────────────────────────────────────
 *
 * Any set may be read here, including one the caller cannot manage. That is not
 * a relaxation of anything:
 *
 *   - `GET /question-sets/{setId}/questions` carries no authorizer already, by
 *     design — the host's question browser and the phone remote read it with a
 *     bare fetch — so refusing to show here what a host can already fetch would
 *     be theatre, not a control.
 *   - Copying cannot touch the source. A copy is an independent row in the
 *     TARGET set (decision 2): no shared identity, no back-reference, no
 *     propagation, and no write path back.
 *   - The write is the only place a permission belongs, and that is where it
 *     is: `upload-questions.js` runs `requireSetManager` on every replace, so
 *     the target is always a set the caller may write, whatever this dialog
 *     rendered. And where they may not, Save forks into a set of their own
 *     rather than being refused.
 *
 * ── SAME ENGAGEMENT TYPE ONLY ──────────────────────────────────────────────
 *
 * A trivia question copied into a call-and-answer set loses its options and its
 * correct answer, because the importer only parses those columns for a trivia
 * set. Offering the cross-type copy would be offering a silent field-eater, so
 * the picker lists compatible sets and says why the others are missing.
 */
export default function QuestionPullDialog({
  currentSetId,
  engagementType,
  availableSets = [],
  onCancel,
  onCopy,
}) {
  const [sourceSet, setSourceSet] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [chosen, setChosen] = useState([]);

  const wanted = normalizeGameType(engagementType);
  const compatible = useMemo(() => availableSets.filter(
    (s) => s.id !== currentSetId && normalizeGameType(s.engagementType) === wanted
  ), [availableSets, currentSetId, wanted]);
  const hiddenCount = availableSets.length - compatible.length - 1;

  const listedSets = setFilter
    ? compatible.filter((s) => `${s.name || ''} ${s.description || ''}`.toLowerCase()
      .includes(setFilter.toLowerCase()))
    : compatible;

  useEffect(() => {
    if (!sourceSet) return;
    let live = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const response = await authFetch(`${API_BASE()}question-sets/${sourceSet.id}/questions`);
        if (!response.ok) {
          if (live) setError(`Could not read "${sourceSet.name}" (HTTP ${response.status}).`);
          return;
        }
        const json = await response.json();
        if (live) setRows(editableRows(json));
      } catch (e) {
        if (live) setError(`Could not read "${sourceSet.name}": ${e.message}`);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [sourceSet]);

  const categories = useMemo(() => {
    const seen = [];
    for (const r of rows) if (r.category && !seen.includes(r.category)) seen.push(r.category);
    return seen;
  }, [rows]);

  const kinds = useMemo(() => {
    const seen = [];
    for (const r of rows) if (r.roundKind && !seen.includes(r.roundKind)) seen.push(r.roundKind);
    return seen;
  }, [rows]);

  // Filtering happens over what was already fetched — no refetch, no request
  // per keystroke, and no promise of completeness beyond this one set.
  const filtered = rows.filter((r) => (!categoryFilter || r.category === categoryFilter)
    && (!kindFilter || r.roundKind === kindFilter));

  const toggle = (uid) => setChosen((c) => (c.includes(uid) ? c.filter((x) => x !== uid) : [...c, uid]));
  const selectAllFiltered = () => setChosen(filtered.map((r) => r.uid));

  const copyChosen = () => {
    const picked = rows.filter((r) => chosen.includes(r.uid));
    onCopy(picked.map((r) => copiedRow(r, sourceSet.id, r.sk)));
  };

  const carriesImages = rows.some((r) => chosen.includes(r.uid) && r.image);

  return (
    <Modal
      overlayClassName="modal-overlay"
      contentClassName="modal-content qs-pull-dialog"
      labelledBy="qs-pull-title"
      onClose={onCancel}
    >
      <h3 id="qs-pull-title">
        <Icon name="Books" weight="bold" size={16} color="var(--primary)" />{' '}
        {sourceSet ? `Pull questions from "${sourceSet.name}"` : 'Pull questions from another set'}
      </h3>

      {!sourceSet && (
        <>
          <p>
            Pick the set to take questions from. Only {gameTypeLabel(wanted)} sets are listed:
            a question from another kind of set would lose the fields this one plays with.
            {hiddenCount > 0 && ` ${hiddenCount} set${hiddenCount === 1 ? ' is' : 's are'} hidden for that reason.`}
          </p>
          <div className="form-group">
            <label htmlFor="pull-set-filter">Filter sets by name</label>
            <input
              id="pull-set-filter"
              type="text"
              className="form-input"
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              placeholder="Type part of a set's name"
            />
          </div>
          {listedSets.length === 0 ? (
            <p className="qs-empty">
              {compatible.length
                ? 'No set matches that filter.'
                : `There is no other ${gameTypeLabel(wanted)} set to pull from yet.`}
            </p>
          ) : (
            <ul className="qs-pull-set-list">
              {listedSets.map((s) => (
                <li key={s.id}>
                  <button className="qs-pull-set" onClick={() => { setSourceSet(s); setChosen([]); }}>
                    <strong>{s.name}</strong>
                    <span className="qs-question-meta">
                      <span>{s.totalQuestions || s.questionCount || 0} questions</span>
                      <span>{s.categoryCount || 0} categories</span>
                      {/* The server's own answer, never a comparison made here. */}
                      {s.mine ? <span>yours</span> : <span>someone else's</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sourceSet && (
        <>
          <p>
            These become <strong>copies</strong>. Editing them in this set will not change
            the originals in "{sourceSet.name}", and nothing here changes that set at all.
          </p>

          <div className="qs-pull-filters">
            {categories.length > 1 && (
              <label>
                Filter by category:{' '}
                <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            {roundKindApplies(wanted) && kinds.length > 0 && (
              <label>
                Filter by direction:{' '}
                <select className="form-select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                  <option value="">Any direction</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>{ROUND_KINDS[k]?.label || k}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn-secondary btn-small" onClick={selectAllFiltered} disabled={!filtered.length}>
              Select all {filtered.length}
            </button>
          </div>

          {loading && <p className="qs-empty">Loading questions…</p>}
          {error && <StatusMessage message={error} tone="error" />}

          {!loading && !error && (
            filtered.length === 0 ? (
              <p className="qs-empty">Nothing in this set matches those filters.</p>
            ) : (
              <ul className="qs-pull-question-list" data-testid="pull-questions">
                {filtered.map((r) => (
                  <li key={r.uid}>
                    <label>
                      <input type="checkbox" checked={chosen.includes(r.uid)} onChange={() => toggle(r.uid)} />
                      <span className="qs-question-text">
                        <strong>{r.title}</strong>
                        <span className="qs-question-meta">
                          <span>{r.category}</span>
                          {r.roundKind && <span>{ROUND_KINDS[r.roundKind]?.label || r.roundKind}</span>}
                          {r.detail && <span className="qs-question-detail">{r.detail.slice(0, 80)}{r.detail.length > 80 ? '…' : ''}</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )
          )}

          {carriesImages && (
            <p className="qs-pull-caveat">
              <Icon name="Warning" weight="fill" size={14} color="#8a5300" />{' '}
              One or more of these carries artwork. The image file lives with the set it came
              from, so the copy will point at a picture this set does not have until you upload it.
            </p>
          )}
        </>
      )}

      <div className="modal-actions">
        {sourceSet && (
          <button className="btn-secondary" onClick={() => { setSourceSet(null); setRows([]); setChosen([]); }}>
            Pick a different set
          </button>
        )}
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        {sourceSet && (
          <button className="btn-primary" onClick={copyChosen} disabled={!chosen.length}>
            <Icon name="Plus" weight="bold" size={16} color="currentColor" />{' '}
            Copy {chosen.length || ''} question{chosen.length === 1 ? '' : 's'} in
          </button>
        )}
      </div>
    </Modal>
  );
}
