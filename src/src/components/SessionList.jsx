import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './SessionList.css';
import Icon from './Icon';
import Button from './ui/Button';
import ListControls from './ListControls';
import SetImageBadge from './SetImageBadge';
import DeleteReasonField from './DeleteReasonField';
import useListControls from '../hooks/useListControls';
import { matchesListFilters } from '../config/listControls';
import { formatWhen, countOrDash } from '../config/tableCells';
import {
  kindOf, kindLabel, kindIcon, isEventRow, typeOptions, itemTitles, itemKindLabel,
  itemStateLabel, itemCountText, EVENT_KIND, BUILD_KIND,
} from '../config/engagementKinds';
import {
  sessionActions, itemActions, statusOf, rowDate, setNameOf, newestFirst,
  ROW_ACTION_WORDS, ROW_ACTION_ICONS,
} from '../config/sessionRows';

/**
 * THE SESSIONS LIST — one component, used by Library & team's Sessions place,
 * the host's "Your sessions" dialog and Home's Rejoin and recent rows
 * (experience plan 4a/4b; audit E §1.3 L1: two lists, two idioms, built twice).
 *
 * A ROW IS ONE SHAPE EVERYWHERE: the session (title, then its set and code),
 * its format, its status (a word, with its people and rounds under it), one
 * date, and its actions — ONE primary button and a ⋯ menu with the rest.
 * Which actions a row offers is config/sessionRows.js `sessionActions`, and
 * nothing here decides it; what each action does is the frame's (`on`).
 *
 * PRESENTATIONAL BY RULE, as SessionHistoryPanel was: no fetch, no auth. The
 * one thing it owns is the delete confirm, because both frames need the same
 * one: inline under the row it is about (never a browser dialog), saying what
 * goes and what stays, and asking Engage staff for their reason.
 *
 * Styled under `.slist` (SessionList.css), the `.sp` table it grew from.
 */

const STATE_AXIS = (row) => (row.started ? 'played' : 'unstarted');

/** The search and the filters, declared once (config/listControls.js). */
export const SESSION_LIST_CONFIG = {
  searchFields: ['title', 'eventTitle', 'gameId', 'hostName', 'questionSetId', itemTitles],
  axes: {
    type: { get: kindOf },
    state: { get: STATE_AXIS },
  },
  sorts: {
    newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
    lastPlayed: (a, b) => new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0),
  },
  defaultSort: 'newest',
};

/** Does a row survive a filter combination? The list and the drop counts share it. */
export function matchesSessionFilters(row, filters) {
  return matchesListFilters(row, SESSION_LIST_CONFIG, filters);
}

const titleOf = (row) => row.title || row.eventTitle || (isEventRow(row) ? 'Untitled event' : 'Untitled session');

/** "12 people · 3 rounds", leaving out what was not read (null is not zero). */
function countsLine(row) {
  const parts = [];
  if (row.playerCount != null) parts.push(`${countOrDash(row.playerCount)} ${Number(row.playerCount) === 1 ? 'person' : 'people'}`);
  if (!isEventRow(row) && row.roundsPlayed != null) parts.push(`${countOrDash(row.roundsPlayed)} ${Number(row.roundsPlayed) === 1 ? 'round' : 'rounds'}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------ the ⋯ menu -- */

/**
 * The row's other actions. Fixed-position, placed from its button, because a
 * table cell and a scrolling list both clip: a menu inside them is cut off at
 * the last row (hard rule 10's cousin). Escape closes it and puts focus back;
 * so does a click outside, a scroll or a resize.
 */
function RowMenu({ label, items, onPick }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = (refocus) => {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus();
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    const vw = window.innerWidth || 0;
    const up = vh && r.bottom + 280 > vh && r.top > 280;
    setPlace({
      right: Math.max(8, vw - r.right),
      ...(up ? { bottom: Math.max(8, vh - r.top + 4) } : { top: r.bottom + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const first = menuRef.current && menuRef.current.querySelector('[role="menuitem"]');
    if (first) first.focus();
    const onDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      close(false);
    };
    const onMove = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const onKey = (e) => {
    const all = menuRef.current ? [...menuRef.current.querySelectorAll('[role="menuitem"]')] : [];
    const at = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (all[at + 1] || all[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (all[at - 1] || all[all.length - 1])?.focus(); }
    else if (e.key === 'Tab') close(false);
  };

  if (!items.length) return null;
  return (
    <span className="slist-menuwrap">
      <button
        ref={btnRef}
        type="button"
        className="slist-btn slist-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="DotsThree" weight="bold" size={18} color="currentColor" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="slist-menu"
          role="menu"
          aria-label={label}
          style={place || undefined}
          onKeyDown={onKey}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`slist-menu-item${it.id === 'delete' ? ' slist-menu-item--danger' : ''}`}
              title={it.title}
              aria-disabled={it.disabled ? 'true' : undefined}
              aria-describedby={it.disabled ? `${it.id}-why` : undefined}
              onClick={() => { if (it.disabled) return; close(false); onPick(it.id); }}
            >
              <Icon name={it.icon} weight="bold" size={15} color="currentColor" />
              <span>{it.label}</span>
              {it.disabled && <span className="slist-menu-why" id={`${it.id}-why`}>{it.title}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* --------------------------------------------------------------- the list -- */

export default function SessionList({
  rows = [],
  /** For each row's set name and has-images badge. Optional. */
  questionSets = [],
  /**
   * What each action does in this frame: { start, edit, continue, open,
   * agenda, report, results, invite, link, delete, continueItem, reportItem }.
   * Each takes the row (items: the item and its event). An action with no
   * handler is not offered, so a frame can never render a dead button.
   * `delete(row, reason)` returns a promise; a rejection with
   * `code: 'reason_required'` asks for the reason.
   */
  on = {},
  /** Start's label for a row (2b: "Start · two screens"). Defaults to "Start". */
  startLabel = null,
  /** The session on the host's stage, flagged so nobody restarts it. */
  currentGameId = null,
  /** A row to mark as just made or saved, and the word to mark it with. */
  highlightId = null,
  highlightWord = 'Just saved',
  /** Flag the newest row "Latest" (the host's own list). */
  flagLatest = false,
  /** Search, type, state and sort over the list, with its count. */
  controls = false,
  /** Extra controls at the end of the bar (the console's Delete all). */
  toolbar = null,
  /** Show at most this many rows (Home's recent five). */
  limit = 0,
  /** The table's accessible name. */
  label = 'Sessions',
  /** Said when there are no rows at all. */
  emptyText = 'No sessions yet.',
  /** Id prefix, so two lists on one page do not collide. */
  idPrefix = 'slist',
  /** A plainer row for Home: no counts line, no host. */
  compact = false,
}) {
  const [openEvents, setOpenEvents] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // { id, asking: bool, error }
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const toggleEvent = (code) => setOpenEvents((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const sorted = useMemo(() => newestFirst(rows), [rows]);
  const latestId = flagLatest && sorted.length ? sorted[0].gameId : null;
  const list = useListControls(sorted, SESSION_LIST_CONFIG, {
    labels: {
      search: (needle) => `Search “${needle}”`,
      type: (value) => `Type: ${kindLabel(value)}`,
      state: (value) => `State: ${value === 'played' ? 'Started' : 'Not started'}`,
    },
  });
  const filtered = controls ? list.shown : sorted;
  const shown = limit > 0 ? filtered.slice(0, limit) : filtered;

  const has = (id) => typeof on[id] === 'function';
  const wordFor = (id, row) => (id === 'start' && startLabel ? startLabel(row) : ROW_ACTION_WORDS[id]);
  const hintFor = (id, title) => ({
    start: `Start "${title}": players can join once it starts`,
    edit: `Edit "${title}": title, settings and categories. Nobody can join yet.`,
    continue: `Continue "${title}"`,
    open: `Open "${title}" on its stage`,
    agenda: `Edit the agenda of "${title}"`,
    report: `Read the report for "${title}"`,
    results: `See the survey results for "${title}"`,
    invite: `Invite people to "${title}"`,
    link: `Copy the join link for "${title}"`,
    delete: `Delete "${title}"`,
  }[id]);

  const run = (id, row) => {
    if (id === 'delete') {
      setReason('');
      setConfirm({ id: row.gameId, asking: row.deleteAs === 'platform-admin', error: '' });
      return;
    }
    on[id](row);
  };

  const doDelete = async (row) => {
    if (!has('delete')) return;
    setBusyId(row.gameId);
    try {
      await on.delete(row, reason.trim());
      setConfirm(null);
    } catch (err) {
      if (err && err.code === 'reason_required') setConfirm({ id: row.gameId, asking: true, error: '' });
      else setConfirm({ id: row.gameId, asking: confirm && confirm.asking, error: (err && err.message) || 'It could not be deleted.' });
    } finally {
      setBusyId(null);
    }
  };

  const actionsCell = (row, title) => {
    const { primary, menu } = sessionActions(row);
    const can = (id) => has(id);
    const items = menu.filter(can).map((id) => ({
      id, label: wordFor(id, row), icon: ROW_ACTION_ICONS[id], title: hintFor(id, title),
    }));
    /* A row this caller may not delete still says who may, rather than the
       control vanishing without a reason (the owner's delete rule). */
    if (has('delete') && row.deleteAs === '') {
      items.push({
        id: 'delete', label: ROW_ACTION_WORDS.delete, icon: ROW_ACTION_ICONS.delete, disabled: true,
        title: 'Only the host who created it, or an owner or admin of this team, can delete it.',
      });
    }
    return (
      <div className="slist-acts">
        {/* THE ONE PRIMARY: the shared ui/Button (experience plan §5), not a
            primary class of this list's own. */}
        {primary && can(primary) && (
          <Button
            variant="quiet"
            size="sm"
            className="slist-lead"
            onClick={() => run(primary, row)}
            title={hintFor(primary, title)}
          >
            <Icon name={ROW_ACTION_ICONS[primary]} weight="fill" size={14} color="currentColor" />
            <span>{wordFor(primary, row)}</span>
          </Button>
        )}
        <RowMenu label={`More for "${title}"`} items={items} onPick={(id) => run(id, row)} />
      </div>
    );
  };

  const confirmRow = (row) => {
    if (!confirm || confirm.id !== row.gameId) return null;
    const title = titleOf(row);
    const fieldId = `${idPrefix}-reason-${row.gameId}`;
    return (
      <tr key={`${row.gameId}-confirm`} className="slist-confirmrow" data-testid="delete-confirm">
        <td colSpan={5}>
          <div className="slist-confirm" role="group" aria-label={`Delete "${title}"?`}>
            <p className="slist-confirm-q">
              Delete <b>{title}</b> ({row.gameId})?{' '}
              {isEventRow(row)
                ? 'Its agenda, its join code and the sessions its items ran go with it, with every answer in them. Saved reports are kept.'
                : 'Every answer, vote and player record stored under it goes with it. Saved reports and the question set it used are kept.'}
            </p>
            {confirm.asking && (
              <DeleteReasonField
                id={fieldId}
                value={reason}
                onChange={setReason}
                scope="slist"
                labelClass="slist-confirm-label"
                hintClass="slist-dim"
              />
            )}
            {confirm.error && <p className="slist-confirm-err" role="alert">{confirm.error}</p>}
            <div className="slist-confirm-acts">
              <button type="button" className="slist-btn" onClick={() => setConfirm(null)}>Keep it</button>
              <button
                type="button"
                className="slist-btn slist-btn--dangersolid"
                disabled={busyId === row.gameId || (confirm.asking && !reason.trim())}
                onClick={() => doDelete(row)}
              >
                Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  const nameCell = (row, title) => {
    const set = setNameOf(row, questionSets);
    const setRow = (questionSets || []).find((s) => s && s.id === row.questionSetId);
    const sub = isEventRow(row)
      ? [itemCountText(row.itemCount), row.place, row.gameId].filter(Boolean).join(' · ')
      : [
        set ? `Set: ${set}` : (row.gameType === BUILD_KIND ? '' : 'Set: —'),
        row.gameId,
        !compact && row.hostName && row.hostName !== 'Host' ? `host ${row.hostName}` : '',
      ].filter(Boolean).join(' · ');
    const flags = (
      <>
        {currentGameId && row.gameId === currentGameId && <span className="slist-flag slist-flag--now">On stage</span>}
        {highlightId && String(row.gameId) === String(highlightId) && <span className="slist-flag slist-flag--now">{highlightWord}</span>}
        {latestId === row.gameId && row.gameId !== currentGameId && <span className="slist-flag">Latest</span>}
      </>
    );
    return (
      <td className="slist-c-name">
        {isEventRow(row) ? (
          <button
            type="button"
            className="slist-disclose"
            aria-expanded={openEvents.has(row.gameId)}
            aria-controls={`${idPrefix}-items-${row.gameId}`}
            onClick={() => toggleEvent(row.gameId)}
            title={title}
          >
            <Icon name={openEvents.has(row.gameId) ? 'CaretDown' : 'CaretRight'} weight="bold" size={12} color="currentColor" />
            <span className="slist-nm">{title}</span>
          </button>
        ) : (
          <span className="slist-namerow">
            <span className="slist-nm" title={title}>{title}</span>
            {flags}
          </span>
        )}
        <span className="slist-sub" title={sub}>
          {sub}
          {!isEventRow(row) && <SetImageBadge hasImages={setRow && setRow.hasImages} />}
        </span>
      </td>
    );
  };

  const kindCell = (kind) => (
    <td className="slist-c-kind">
      {kind ? (
        <span className="slist-chip slist-chip--type">
          <Icon name={kindIcon(kind)} weight="bold" size={13} color="currentColor" />
          <span>{kindLabel(kind)}</span>
        </span>
      ) : '—'}
    </td>
  );

  const renderRow = (row) => {
    const title = titleOf(row);
    const status = statusOf(row);
    const counts = compact ? '' : countsLine(row);
    const when = rowDate(row);
    const out = [(
      <tr
        key={row.gameId}
        className={[
          busyId === row.gameId ? 'slist-busy' : '',
          highlightId && String(row.gameId) === String(highlightId) ? 'slist-row--done' : '',
          currentGameId && row.gameId === currentGameId ? 'slist-row--now' : '',
        ].filter(Boolean).join(' ') || undefined}
        data-testid={isEventRow(row) ? 'event-row' : 'session-row'}
      >
        {nameCell(row, title)}
        {kindCell(isEventRow(row) ? EVENT_KIND : kindOf(row))}
        <td className="slist-c-state">
          <span className={`slist-chip ${status.on ? 'slist-chip--on' : 'slist-chip--off'}`}>{status.word}</span>
          {counts && <span className="slist-sub">{counts}</span>}
        </td>
        <td
          className="slist-c-when"
          title={`Created ${formatWhen(row.createdAt)} · last played ${formatWhen(row.lastPlayedAt)}`}
        >
          {formatWhen(when)}
        </td>
        <td className="slist-c-acts">{actionsCell(row, title)}</td>
      </tr>
    ), confirmRow(row)];
    if (isEventRow(row) && openEvents.has(row.gameId)) {
      (row.items || []).forEach((item, n) => out.push(renderItem(row, item, n)));
    }
    return out;
  };

  const renderItem = (event, item, n) => {
    const s = item.session;
    const itemTitle = item.title || (item.decryptFailed ? 'Unreadable item' : itemKindLabel(item.type));
    const acts = itemActions(item);
    return (
      <tr
        key={`${event.gameId}-${item.itemId}`}
        className="slist-subrow"
        id={n === 0 ? `${idPrefix}-items-${event.gameId}` : undefined}
        data-testid="event-item-row"
      >
        <td className="slist-c-name">
          <span className="slist-nm" title={itemTitle}>{itemTitle}</span>
          <span className="slist-sub">{[item.minutes ? `${item.minutes} min` : '', s ? s.gameId : ''].filter(Boolean).join(' · ') || '—'}</span>
        </td>
        <td className="slist-c-kind"><span className="slist-chip slist-chip--type"><span>{itemKindLabel(item.type)}</span></span></td>
        <td className="slist-c-state">
          <span className={`slist-chip ${item.state === 'planned' ? 'slist-chip--off' : 'slist-chip--on'}`}>{itemStateLabel(item.state)}</span>
        </td>
        <td className="slist-c-when">{formatWhen(item.startedAt || item.endedAt)}</td>
        <td className="slist-c-acts">
          <div className="slist-acts">
            {acts.expired && <span className="slist-chip slist-chip--off">Session expired</span>}
            {acts.menu.includes('report') && has('reportItem') && (
              <button type="button" className="slist-btn" onClick={() => on.reportItem(item, event)} title={`Read the report for "${itemTitle}"`}>
                <Icon name="ChartBar" weight="bold" size={14} color="currentColor" />
                <span>{ROW_ACTION_WORDS.report}</span>
              </button>
            )}
            {acts.primary === 'continue' && has('continueItem') && (
              <Button variant="quiet" size="sm" className="slist-lead" onClick={() => on.continueItem(item, event)} title={`Continue "${itemTitle}" on the stage`}>
                <Icon name="Play" weight="fill" size={14} color="currentColor" />
                <span>{ROW_ACTION_WORDS.continue}</span>
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className={`slist${compact ? ' slist--compact' : ''}`}>
      {controls && sorted.length > 0 && (
        <ListControls
          scope="slist"
          search={{
            value: list.state.search,
            onChange: (value) => list.set({ search: value }),
            ariaLabel: 'Search sessions',
            placeholder: 'Title, code, host or set…',
          }}
          selects={[
            {
              key: 'type',
              value: list.state.type,
              onChange: (value) => list.set({ type: value }),
              ariaLabel: 'Filter by type',
              options: typeOptions(sorted),
            },
            {
              key: 'state',
              value: list.state.state,
              onChange: (value) => list.set({ state: value }),
              ariaLabel: 'Filter by state',
              options: [
                { value: 'all', label: 'All states' },
                { value: 'played', label: 'Started' },
                { value: 'unstarted', label: 'Not started' },
              ],
            },
            {
              key: 'sort',
              value: list.state.sort,
              onChange: (value) => list.set({ sort: value }),
              ariaLabel: 'Sort order',
              options: [
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'title', label: 'Title (A–Z)' },
                { value: 'lastPlayed', label: 'Recently played' },
              ],
            },
          ]}
          count={filtered.length === sorted.length
            ? `${sorted.length} ${sorted.length === 1 ? 'session' : 'sessions'}`
            : `${filtered.length} of ${sorted.length}`}
        >
          {toolbar}
        </ListControls>
      )}

      {sorted.length === 0 && <p className="slist-empty">{emptyText}</p>}

      {sorted.length > 0 && filtered.length === 0 && (
        /* NOTHING MATCHES is not "no sessions yet" (design rule 6): each
           filter that is costing rows is a one-click way out, with its count. */
        <div className="slist-nomatch">
          <h3>No session matches {list.activeFilterCount === 1 ? 'this filter' : `these ${list.activeFilterCount} filters`}</h3>
          {list.drops.length > 0 && <p>Removing any one of these gets you results:</p>}
          <div className="slist-drops">
            {list.drops.map((drop) => (
              <button key={drop.key} type="button" className="slist-drop" onClick={() => list.clearOne(drop.key)}>
                <Icon name="X" weight="bold" size={12} color="currentColor" />
                {drop.label} <em>— {drop.count} session{drop.count === 1 ? '' : 's'}</em>
              </button>
            ))}
          </div>
          <button type="button" className="slist-btn slist-btn--link" onClick={list.clearAll}>Clear all filters</button>
        </div>
      )}

      {shown.length > 0 && (
        <div className="slist-scroll">
          {/* table-layout: fixed in the sheet (hard rule 11). */}
          <table className="slist-tbl" aria-label={label}>
            <thead>
              <tr>
                <th className="slist-c-name">Session</th>
                <th className="slist-c-kind">Format</th>
                <th className="slist-c-state">Status</th>
                <th className="slist-c-when">Date</th>
                <th className="slist-c-acts"><span className="slist-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>{shown.map(renderRow)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
