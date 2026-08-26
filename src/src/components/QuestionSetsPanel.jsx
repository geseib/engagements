import React from 'react';
import Icon from './Icon';
import ListControls from './ListControls';
import SetImageBadge from './SetImageBadge';
import useListControls from '../hooks/useListControls';
import { setOwnerLabel, setOwnerTitle, setOwnerIsOurs } from '../utils/setOwnerTag';
import { matchesListFilters } from '../config/listControls';
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

const SORTS = {
  newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  questions: (a, b) => (b.totalQuestions || 0) - (a.totalQuestions || 0),
};

/*
  THE LIST CONTROLS, DECLARED ONCE. This screen was the donor for
  config/listControls.js — its search / axes / sorts / drop-exits are now this
  config plus the shared mechanism, and the guarantee its old comment asked for
  ("one place, so the drop-counts cannot drift from the list they describe")
  is structural there: the list and the counts share one predicate by
  construction.

  Only the ITEM side of the type compare is normalised, deliberately: the
  filter's options come from GAME_TYPE_LIST, so its value is already canonical,
  while the rows still hold the original seeds' aliases (`callandanswer`,
  `polls`).
*/
const LIST_CONFIG = {
  searchFields: ['name', 'description', 'customInstruction'],
  axes: {
    type: { get: (set) => normalizeGameType(set.engagementType) },
    status: { get: (set) => (set.active ? 'active' : 'inactive') },
  },
  sorts: SORTS,
  defaultSort: 'newest',
};

/** Does this set survive a given filter combination? Kept as a named export —
 *  other suites import it — implemented on the shared predicate. */
export function matchesFilters(set, filters) {
  return matchesListFilters(set, LIST_CONFIG, filters);
}

export default function QuestionSetsPanel({
  questionSets = [],
  loading = false,
  /** One banner for everything the page did on this screen's behalf. */
  notice = null,
  onDismissNotice,
  onEdit,
  onDelete,
  /**
   * Take a copy of a set this organisation may read but not change.
   *
   * Optional: the host's own picker reuses this panel and has nowhere to put a
   * copy, so a Copy control only appears where the page can actually honour it.
   */
  onCopy,
  onToggleActive,
  onToggleQuickstart,
  /** The three ranked creation paths from mockup 02. */
  onCreate,
  /** Whether the creation panel below is already open, so the header button
   *  can say which way it goes rather than toggling something invisible. */
  createOpen = false,
  children,
}) {
  /*
    THE EXITS FROM "NOTHING MATCHES" (mockup 03) come back as `drops`: the
    result of removing each active filter individually, counted with the OTHER
    filters still applied — one extra pass over an array already in memory,
    converting a dead end into N one-click exits. A filter is only offered when
    dropping it actually produces rows; an exit that leads to another empty
    screen is not an exit. computeDrops in config/listControls.js keeps that
    contract, on the same predicate the list itself uses.
  */
  const {
    state: { search, type, status, sort },
    set,
    shown,
    drops,
    activeFilterCount,
    clearOne,
    clearAll,
  } = useListControls(questionSets, LIST_CONFIG, {
    labels: {
      search: (needle) => `Search “${needle}”`,
      type: (value) => `Type: ${gameTypeLabel(value)}`,
      status: (value) => `Status: ${value === 'active' ? 'Active' : 'Inactive'}`,
    },
  });

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

          {/*
            The bar renders through the shared ListControls under this screen's
            own scope, so .qsets-filters/.qsets-search/.qsets-input/
            .qsets-select/.qsets-count keep styling it unchanged. The TYPE
            options stay DERIVED, NOT HAND-WRITTEN: GAME_TYPE_LIST is the whole
            table, so a type added there appears here without an edit. Survey is
            present and annotated rather than dropped — see the header.
          */}
          <ListControls
            scope="qsets"
            search={{
              value: search,
              onChange: (value) => set({ search: value }),
              ariaLabel: 'Search name, description',
              placeholder: 'Search name, description',
            }}
            selects={[
              {
                key: 'type',
                value: type,
                onChange: (value) => set({ type: value }),
                ariaLabel: 'Filter by engagement type',
                options: [
                  { value: 'all', label: 'All types' },
                  ...GAME_TYPE_LIST.map((meta) => ({
                    value: meta.id,
                    label: `${meta.label}${
                      isPlayableGameType(meta.id) ? '' : ` — ${NOT_PLAYABLE_LABEL.toLowerCase()}`
                    }`,
                  })),
                ],
              },
              {
                key: 'status',
                value: status,
                onChange: (value) => set({ status: value }),
                ariaLabel: 'Filter by status',
                options: [
                  { value: 'all', label: 'All statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ],
              },
              {
                key: 'sort',
                value: sort,
                onChange: (value) => set({ sort: value }),
                ariaLabel: 'Sort order',
                options: [
                  { value: 'newest', label: 'Newest first' },
                  { value: 'oldest', label: 'Oldest first' },
                  { value: 'name', label: 'Name (A–Z)' },
                  { value: 'questions', label: 'Most questions' },
                ],
              },
            ]}
            count={`${questionSets.length} set${questionSets.length === 1 ? '' : 's'}${
              shown.length !== questionSets.length ? ` · ${shown.length} shown` : ''
            }`}
          />

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
                          {/*
                            AI, AND WHETHER ANYONE HAS READ IT. A generated set
                            arrives switched OFF and unreviewed
                            (admin/shared/generated-set.js, note 2), and until
                            now the row said only "AI" — the same badge a set
                            that was generated, reviewed and switched on months
                            ago carries. The state that changes what to DO is
                            the unreviewed one, so that is the one that is named.
                          */}
                          {set.isAIGenerated && (
                            set.active === false ? (
                              <span className="qsets-chip qsets-chip--warn" title="Written by the generator and not reviewed yet.">
                                AI draft
                              </span>
                            ) : (
                              <span className="qsets-chip qsets-chip--warn" title="AI-generated content">
                                AI
                              </span>
                            )
                          )}
                          {/*
                            WHOSE IT IS, ON EVERY ROW — Yours / Team / Engage /
                            Public. This reverses what was here, which badged
                            only the rows that were NOT this organisation's, on
                            the argument that "the common case is the quiet one,
                            or every row shouts and none of them reads."

                            That argument is right about alarms and wrong about
                            this. Badging the exceptions makes the chip a
                            WARNING, so an unbadged row means "no warning" —
                            which is not the same as "yours", and cannot be told
                            apart from a badge that failed to render. Tagging
                            every row makes it a COLUMN: four values, always
                            present, read once and then scanned.

                            The tone stays binary (see utils/setOwnerTag.js).
                            Four colours would be a legend to memorise; the only
                            distinction that changes what you can DO is whether
                            you must copy it first.
                          */}
                          <span
                            className={`qsets-chip${setOwnerIsOurs(set) ? '' : ' qsets-chip--off'}`}
                            title={setOwnerTitle(set)}
                          >
                            {setOwnerLabel(set)}
                          </span>
                        </div>
                      </td>
                      <td className="qsets-when">{formatWhen(set.updatedAt || set.createdAt)}</td>
                      <td>
                        <div className="qsets-rowact">
                          {/*
                            THE SERVER ALREADY DECIDED THIS. `canManage` comes
                            from admin/get-question-sets.js, which asks
                            `canManageSet` per row — Engage's own library and
                            the public one are readable by every organisation
                            and changeable by none of them.

                            This panel used to render Edit and Delete on every
                            row regardless, so a host clicked Edit on an Engage
                            set and got a 403. A control that is always refused
                            reads as a broken product rather than as a boundary,
                            which is why the fix is to remove the control and
                            offer the one that DOES work.

                            `!== false` and not a bare truthiness test: rows
                            from surfaces that do not project ownership carry no
                            `canManage` at all, and those must keep behaving as
                            they did rather than silently losing their controls.
                          */}
                          {set.canManage !== false ? (
                            <>
                              {/*
                                THE SAME DOOR, NAMED FOR WHAT IS BEHIND IT. On an
                                unreviewed generation the task is to READ it and
                                then decide; "Edit" is the label for a set you
                                already trust. It is also the row's primary
                                action in that state, because it is the only
                                thing anyone should be doing to it.
                              */}
                              <button
                                type="button"
                                className={`qsets-btn qsets-btn--sm${set.isAIGenerated && set.active === false ? ' qsets-btn--primary' : ''}`}
                                onClick={() => onEdit && onEdit(set)}
                                title={set.isAIGenerated && set.active === false
                                  ? 'Read what the generator wrote, then switch it on'
                                  : 'Edit this question set'}
                              >
                                {set.isAIGenerated && set.active === false ? 'Review' : 'Edit'}
                              </button>
                              <button
                                type="button"
                                className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger"
                                onClick={() => onDelete && onDelete(set)}
                                title="Delete this question set"
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <>
                              {/* OPEN IS SAFE ON A ROW YOU DO NOT OWN, because
                                  saving one now COPIES it (QuestionSetEditor:
                                  `isSomebodyElses`). Offering only Copy meant
                                  the shared library could not be READ in the
                                  editor at all — you could take a blind
                                  duplicate or nothing, and the reported flow was
                                  somebody wanting to look, adjust and then
                                  keep. Delete stays absent: that one has no
                                  copy-on-write equivalent. */}
                              <button
                                type="button"
                                className="qsets-btn qsets-btn--sm"
                                onClick={() => onEdit && onEdit(set)}
                                title="Open it. Saving makes your organisation its own copy."
                              >
                                Open
                              </button>
                              {onCopy && (
                                <button
                                  type="button"
                                  className="qsets-btn qsets-btn--sm"
                                  onClick={() => onCopy(set)}
                                  title="Take a copy now, without opening it"
                                >
                                  Copy
                                </button>
                              )}
                            </>
                          )}
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
