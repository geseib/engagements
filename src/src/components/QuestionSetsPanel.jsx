import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import {
  GAME_TYPE_LIST,
  gameTypeLabel,
  isPlayableGameType,
  normalizeGameType,
  NOT_PLAYABLE_LABEL,
  notPlayableReason,
} from '../config/gameTypes';
import { truncate } from '../utils/questionSetEditing';
import './QuestionSetsPanel.css';
import { formatWhen } from '../config/tableCells';

/**
 * THE QUESTION SETS LIST.
 *
 * Grounded in docs/design/admin-redesign/01-sets.html, 02-sets-empty.html and
 * 03-sets-no-match.html (RATIONALE.md §4, §9). Wave D part two, Q2 and Q4.
 *
 * PURE PROPS, NO FETCH. `AdminPage.jsx` cannot be mounted in jsdom — `useAuth`
 * hard-throws and the only provider is the real Cognito one — so nothing that
 * stays inside that file is testable. Fetching stays in the page; everything
 * this screen decides happens here, where it can be rendered. Its test contains
 * zero `jest.mock` calls, like podium/welcomeScreen/adminShell.
 *
 * WHAT REPLACED WHAT.
 *
 * 1. FORTY-ONE CARDS became a table with a 36px row. RATIONALE §4: a card is a
 *    good container for one object read across a room; forty-one of them is a
 *    wall. The five fields the card printed (custom instructions, AI context,
 *    prompt, round label, voice) belong to the set, not to the index of sets,
 *    and are one click away in the editor — host §7.10, a reduction with a
 *    recovery is not a deletion.
 *
 * 2. THE TYPE FILTER WAS FOUR HAND-WRITTEN <option> ELEMENTS and omitted Survey,
 *    while two other selects on the same tab offered it. It is derived from
 *    config/gameTypes.js now. The owner's decision on Survey is LABEL IT, not
 *    hide it (OPEN-QUESTIONS #3): mockup 01 row 13 draws a survey set carrying a
 *    `Not playable` chip, and hiding the type would make an existing survey set
 *    unreachable in the one console that can delete it.
 *
 * 3. BOTH EMPTY STATES LIED. `questionSets.length === 0` printed "Upload your
 *    first question set above to get started" — while the upload form was BELOW
 *    it and collapsed by default. The `else` printed "No question sets found
 *    matching your filters" and offered no exit. They are different states with
 *    different words and different exits now (host §7.9).
 */

/** Does this set survive a given filter combination? One place, so the
 *  drop-counts below cannot drift from the list they describe. */
export function matchesFilters(set, { search = '', type = 'all', status = 'all' }) {
  const needle = search.trim().toLowerCase();
  if (needle) {
    const hay = [set.name, set.description, set.customInstruction]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    if (!hay.some((v) => v.includes(needle))) return false;
  }
  if (type !== 'all' && normalizeGameType(set.engagementType) !== type) return false;
  if (status !== 'all' && Boolean(set.active) !== (status === 'active')) return false;
  return true;
}

const SORTS = {
  newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  questions: (a, b) => (b.totalQuestions || 0) - (a.totalQuestions || 0),
};

export default function QuestionSetsPanel({
  questionSets = [],
  loading = false,
  /** One banner for everything the page did on this screen's behalf. */
  notice = null,
  onDismissNotice,
  onEdit,
  onDelete,
  onToggleActive,
  onToggleQuickstart,
  /** The three ranked creation paths from mockup 02. */
  onCreate,
  /** Whether the creation panel below is already open, so the header button
   *  can say which way it goes rather than toggling something invisible. */
  createOpen = false,
  children,
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');

  const filters = { search, type, status };

  const shown = useMemo(
    () => questionSets.filter((set) => matchesFilters(set, filters)).sort(SORTS[sort] || SORTS.newest),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questionSets, search, type, status, sort]
  );

  /*
    THE EXITS FROM "NOTHING MATCHES" (mockup 03). Counting the result of
    dropping each active filter individually is one extra pass over an array
    already in memory, and it converts a dead end into N one-click exits. A
    filter is only offered when dropping it actually produces rows — an exit
    that leads to another empty screen is not an exit.
  */
  const drops = useMemo(() => {
    const candidates = [];
    if (search.trim()) {
      candidates.push({ key: 'search', label: `Search “${search.trim()}”`, next: { ...filters, search: '' } });
    }
    if (type !== 'all') {
      candidates.push({ key: 'type', label: `Type: ${gameTypeLabel(type)}`, next: { ...filters, type: 'all' } });
    }
    if (status !== 'all') {
      candidates.push({
        key: 'status',
        label: `Status: ${status === 'active' ? 'Active' : 'Inactive'}`,
        next: { ...filters, status: 'all' },
      });
    }
    return candidates
      .map((c) => ({ ...c, count: questionSets.filter((set) => matchesFilters(set, c.next)).length }))
      .filter((c) => c.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionSets, search, type, status]);

  const clearOne = (key) => {
    if (key === 'search') setSearch('');
    if (key === 'type') setType('all');
    if (key === 'status') setStatus('all');
  };
  const clearAll = () => {
    setSearch('');
    setType('all');
    setStatus('all');
  };

  const activeFilterCount = (search.trim() ? 1 : 0) + (type !== 'all' ? 1 : 0) + (status !== 'all' ? 1 : 0);
  const nothingExists = questionSets.length === 0;

  return (
    <div className="qsets">
      {notice && notice.text ? (
        <div
          className={`qsets-alert${notice.tone === 'error' ? ' qsets-alert--error' : ''}${
            notice.tone === 'success' ? ' qsets-alert--success' : ''
          }`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <Icon
            name={notice.tone === 'error' ? 'Warning' : 'Check'}
            weight="fill"
            size={16}
            color="currentColor"
          />
          <span>{notice.text}</span>
          {onDismissNotice && (
            <button type="button" className="qsets-alert-close" onClick={onDismissNotice}>
              Dismiss
            </button>
          )}
        </div>
      ) : null}

      {loading && nothingExists && <p className="qsets-loading">Loading question sets…</p>}

      {!loading && nothingExists && (
        /*
          NOTHING EXISTS (mockup 02). Three ranked verbs in the work area, not a
          grey sentence — and emphatically not the shipped copy, which pointed
          "above" at a form that is below and collapsed. Mockup 02 also draws a
          "Compare the five ways in" link to the chooser of mockup 07; that
          chooser is not built (plan Part 5 puts it outside the constraint), and
          a link to a screen that does not exist is the same defect one level
          down, so it is not drawn here.
        */
        <div className="qsets-empty">
          <Icon name="Books" weight="duotone" size={40} color="var(--muted)" />
          <h3>No question sets yet</h3>
          <p>
            A question set is what a session plays. Every other screen in here — sessions,
            archive, reports — is downstream of one. There are three ways to make the first,
            and they are not equivalent.
          </p>
          <div className="qsets-paths">
            <button type="button" className="qsets-btn qsets-btn--lg qsets-btn--primary" onClick={() => onCreate && onCreate('ai')}>
              <Icon name="Sparkle" weight="duotone" size={16} color="currentColor" />
              Generate with AI
            </button>
            <button type="button" className="qsets-btn qsets-btn--lg" onClick={() => onCreate && onCreate('csv')}>
              <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" />
              Upload a CSV
            </button>
            <button type="button" className="qsets-btn qsets-btn--lg" onClick={() => onCreate && onCreate('template')}>
              <Icon name="FileText" weight="bold" size={16} color="currentColor" />
              Start from a template
            </button>
          </div>
        </div>
      )}

      {!nothingExists && (
        <>
          <div className="qsets-head">
            <span className="qsets-head-grow" />
            <button type="button" className="qsets-btn qsets-btn--primary" onClick={() => onCreate && onCreate('new')}>
              <Icon name="Plus" weight="bold" size={14} color="currentColor" />
              {createOpen ? 'Hide new set' : 'New set'}
            </button>
          </div>

          <div className="qsets-filters">
            <div className="qsets-search">
              <Icon name="MagnifyingGlass" weight="bold" size={14} color="var(--muted)" />
              <input
                type="search"
                className="qsets-input"
                aria-label="Search name, description"
                placeholder="Search name, description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {/*
              DERIVED, NOT HAND-WRITTEN. GAME_TYPE_LIST is the whole table, so a
              type added there appears here without an edit. Survey is present
              and annotated rather than dropped — see the header.
            */}
            <select
              className="qsets-input qsets-select"
              aria-label="Filter by engagement type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="all">All types</option>
              {GAME_TYPE_LIST.map((meta) => (
                <option key={meta.id} value={meta.id}>
                  {meta.label}
                  {isPlayableGameType(meta.id) ? '' : ` — ${NOT_PLAYABLE_LABEL.toLowerCase()}`}
                </option>
              ))}
            </select>

            <select
              className="qsets-input qsets-select"
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <select
              className="qsets-input qsets-select"
              aria-label="Sort order"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name (A–Z)</option>
              <option value="questions">Most questions</option>
            </select>

            <span className="qsets-count">
              {questionSets.length} set{questionSets.length === 1 ? '' : 's'}
              {shown.length !== questionSets.length ? ` · ${shown.length} shown` : ''}
            </span>
          </div>

          {shown.length === 0 ? (
            /*
              NOTHING MATCHES (mockup 03). A different state from "nothing
              exists", with different words and its own exits.
            */
            <div className="qsets-nomatch">
              <h3>
                No sets match {activeFilterCount === 1 ? 'this filter' : `these ${activeFilterCount} filters`}
              </h3>
              <p>
                {questionSets.length} set{questionSets.length === 1 ? '' : 's'} exist
                {questionSets.length === 1 ? 's' : ''}.
                {drops.length ? ' Removing any one of these gets you results:' : ''}
              </p>
              <div className="qsets-drops">
                {drops.map((drop) => (
                  <button
                    key={drop.key}
                    type="button"
                    className="qsets-drop"
                    onClick={() => clearOne(drop.key)}
                  >
                    <Icon name="X" weight="bold" size={12} color="currentColor" />
                    {drop.label} <em>— {drop.count} set{drop.count === 1 ? '' : 's'}</em>
                  </button>
                ))}
              </div>
              <button type="button" className="qsets-btn qsets-btn--link" onClick={clearAll}>
                Clear all filters
              </button>
            </div>
          ) : (
            <table className="qsets-tbl">
              <thead>
                <tr>
                  <th className="qsets-col-set">Set</th>
                  <th className="qsets-col-type">Type</th>
                  <th className="qsets-col-qs">Qs</th>
                  <th className="qsets-col-state">State</th>
                  <th className="qsets-col-when">Updated</th>
                  <th className="qsets-col-acts" />
                </tr>
              </thead>
              <tbody>
                {shown.map((set) => {
                  const typeId = normalizeGameType(set.engagementType);
                  const playable = isPlayableGameType(typeId);
                  return (
                    <tr key={set.id}>
                      <td>
                        <span className="qsets-nm">
                          {set.name}
                          <SetImageBadge hasImages={set.hasImages} />
                        </span>
                        <span className="qsets-sub">{truncate(set.description, 110) || '—'}</span>
                      </td>
                      <td>
                        <span className="qsets-chip qsets-chip--type">{gameTypeLabel(typeId)}</span>
                      </td>
                      <td className="qsets-num">{set.totalQuestions ?? 0}</td>
                      <td>
                        <div className="qsets-states">
                          <button
                            type="button"
                            className={`qsets-chip ${set.active ? 'qsets-chip--on' : 'qsets-chip--off'}`}
                            onClick={() => onToggleActive && onToggleActive(set)}
                            title={`Click to ${set.active ? 'deactivate' : 'activate'} this question set`}
                          >
                            {set.active ? 'Active' : 'Inactive'}
                          </button>
                          <button
                            type="button"
                            className={`qsets-chip ${set.quickstart ? 'qsets-chip--warn' : 'qsets-chip--off'}`}
                            onClick={() => onToggleQuickstart && onToggleQuickstart(set, !set.quickstart)}
                            title="Show this set in the host's quickstart menu"
                          >
                            <Icon name="Lightning" weight={set.quickstart ? 'fill' : 'regular'} size={12} color="currentColor" />
                            Quickstart
                          </button>
                          {/*
                            THE STATES THAT ARE REAL DEFECTS, VISIBLE (mockup 01).
                            A set that imported zero rows and a set that cannot be
                            played both read as ordinary rows today.
                          */}
                          {!playable && (
                            <span className="qsets-chip qsets-chip--bad" title={notPlayableReason(typeId)}>
                              {NOT_PLAYABLE_LABEL}
                            </span>
                          )}
                          {!set.totalQuestions && <span className="qsets-chip qsets-chip--bad">Empty</span>}
                          {set.isAIGenerated && (
                            <span className="qsets-chip qsets-chip--warn" title="AI-generated content">
                              AI
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="qsets-when">{formatWhen(set.updatedAt || set.createdAt)}</td>
                      <td>
                        <div className="qsets-rowact">
                          <button
                            type="button"
                            className="qsets-btn qsets-btn--sm"
                            onClick={() => onEdit && onEdit(set)}
                            title="Edit this question set"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger"
                            onClick={() => onDelete && onDelete(set)}
                            title="Delete this question set"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {children}
    </div>
  );
}
