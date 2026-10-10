import React, { useMemo, useState } from 'react';

/**
 * THE PLAYERS LIST, shared.
 *
 * Moved out of SessionSetupPanel's Players tab so the Build Room's Session
 * panel (docs/design/build-room-sidebar S2) and the other engagements show the
 * same rows with the same words and the same actions: Unlock name / Let them
 * take it, Remove, Bring back, and (when the page gives it the handler) Lock
 * again and Not now. What differs between engagements is only the column on the
 * right of the name, which the caller supplies as `renderExtra` (points and a
 * tick on the others; ideas and votes in the Build Room).
 *
 * PRESENTATIONAL. It fetches nothing and decides nothing: rows come in as
 * `rosterRows` / `departedRows` produce them, every action goes back out as a
 * prop, and an action with no handler renders no button, so a caller that has
 * not wired Lock again does not grow a dead one. The class names and test ids
 * are the ones the Players tab always had (`setup-roster__*`), so its
 * stylesheet and its tests carry over untouched.
 *
 * THE STATE IS PRINTED, NOT COLOURED, for the reason styles.css gives at
 * `.setup-roster__flag`: this is read on a projector, by hosts who cannot rely
 * on hue.
 *
 * Search and filters appear once a room is bigger than `searchAfter` people
 * (12 by default): below that a list is faster to scan than to search. A caller
 * that must stay exactly as it was passes `searchAfter={Infinity}`.
 */

const DEFAULT_SEARCH_AFTER = 12;

const plural = (n, one, many) => (n === 1 ? one : many);

export default function PlayersList({
  rows = [],
  departed = [],
  /* The column between the name and the actions. `(row, gone)`; return a
     fragment of cells (the grid is `auto`-tracked, so any count works). */
  renderExtra = null,
  /* After the name, e.g. a Builder chip. `(row)`. */
  renderBadge = null,
  /* A second line under the name, e.g. "Here · joined 2:31". `(row, gone)`. */
  renderMeta = null,
  showRank = true,
  sortBy = 'given',
  /* Pull people asking to take a name out of the order, onto the top, until
     answered. */
  askingFirst = false,
  emptyText = 'Nobody has joined yet.',
  countLabel = (n) => `${n} ${plural(n, 'player', 'players')}`,
  /* One line under the count, e.g. "11 here · 3 away". */
  summary = '',
  departedNote = 'Out of the live counts. Their answers, votes and points stay in the session report.',
  searchAfter = DEFAULT_SEARCH_AFTER,
  /* [{ id, label, test(row) }] after the built-in All. */
  filters = [],
  onUnlock = null,
  onGrant = () => {},
  onRemove = () => {},
  onRestore = () => {},
  onLock = null,
  onRefuse = null,
}) {
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState('all');

  const searchable = rows.length > searchAfter;
  const activeFilter = searchable ? filters.find((f) => f.id === filterId) : null;
  const needle = searchable ? query.trim().toLowerCase() : '';

  const visible = useMemo(() => {
    let list = rows;
    if (activeFilter) list = list.filter((r) => activeFilter.test(r));
    if (needle) list = list.filter((r) => r.name.toLowerCase().includes(needle));
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows, activeFilter, needle, sortBy]);

  const visibleGone = useMemo(
    () => (needle ? departed.filter((r) => r.name.toLowerCase().includes(needle)) : departed),
    [departed, needle]
  );

  const askingRows = askingFirst ? visible.filter((r) => r.handoverRequested && !r.handoverOpen) : [];
  const rest = askingFirst ? visible.filter((r) => !(r.handoverRequested && !r.handoverOpen)) : visible;

  /* The name cell. Flat (just the name) unless the caller wants a badge or a
     second line, in which case they stack in one grid cell. */
  const who = (player, gone) => {
    const name = (
      <span className="setup-roster__name" data-testid={gone ? 'departed-name' : 'roster-name'}>
        {player.name}
      </span>
    );
    if (!renderBadge && !renderMeta) return name;
    return (
      <span className="setup-roster__who">
        <span className="setup-roster__line">
          {name}
          {renderBadge && !gone && renderBadge(player)}
        </span>
        {renderMeta && <span className="setup-roster__meta">{renderMeta(player, gone)}</span>}
      </span>
    );
  };

  const row = (player) => {
    const requested = player.handoverRequested;
    const asking = requested && !player.handoverOpen;
    const open = player.handoverOpen;
    /* ONE STATE AT A TIME. Where the page wires Lock again / Not now (the Build
       Room) each state shows only its own verbs; where it does not (the other
       engagements) the old pair stays: Unlock name / Let them take it, Remove. */
    const showGrant = onLock || onRefuse ? !open : true;
    return (
      <li
        key={player.name}
        className={`setup-roster__row${showRank ? '' : ' setup-roster__row--norank'}${asking ? ' setup-roster__row--asking' : ''}`}
        data-testid="roster-row"
        data-done={player.done === null || player.done === undefined ? undefined : String(player.done)}
      >
        {showRank && <span className="setup-roster__rank">{player.rank}</span>}
        {who(player, false)}
        <span className="setup-roster__side">
          {renderExtra && renderExtra(player, false)}
          {asking && (
            <span className="setup-roster__flag" data-testid="handover-flag">
              Asking to take this name
            </span>
          )}
          {open && (
            <span className="setup-roster__flag" data-testid="handover-flag">
              Unlocked for one handover
            </span>
          )}
        </span>
        {/* THE HOST'S DECISIONS ABOUT THIS PERSON, on their own line. Handover
            verbs on the left, Remove alone on the right by `margin-left: auto`
            on the button, never `justify-content: flex-end` - hard rule 9. */}
        <span className="setup-roster__acts">
          {showGrant && (
            <button
              type="button"
              className="setup-roster__act"
              onClick={() => (requested || !onUnlock ? onGrant(player.name, requested) : onUnlock(player.name))}
              title={requested
                ? `Let the person who asked take over "${player.name}" — once`
                : `Unlock "${player.name}" so one other device can take it — once`}
            >
              {requested ? 'Let them take it' : 'Unlock name'}
            </button>
          )}
          {onRefuse && asking && (
            <button
              type="button"
              className="setup-roster__act"
              onClick={() => onRefuse(player.name)}
              title={`Tell the device asking for "${player.name}" not now`}
            >
              Not now
            </button>
          )}
          {onLock && open && (
            <button
              type="button"
              className="setup-roster__act"
              onClick={() => onLock(player.name)}
              title={`Close the unlock on "${player.name}" before anyone takes it`}
            >
              Lock again
            </button>
          )}
          <button
            type="button"
            className="setup-roster__act setup-roster__act--remove"
            onClick={() => onRemove(player.name)}
            title={`Take "${player.name}" out of the live counts. Their answers and points stay in the report.`}
          >
            Remove
          </button>
        </span>
      </li>
    );
  };

  return (
    <>
      {searchable && (
        <div className="setup-find" data-testid="players-find">
          <label className="setup-qb__searchlbl">
            <span className="setup-visually-hidden">Find a person</span>
            <input
              type="search"
              className="setup-qb__search"
              placeholder="Find a person"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="setup-find__filters" role="group" aria-label="Show">
            {[{ id: 'all', label: 'All', test: () => true }, ...filters].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`setup-chip${(activeFilter ? activeFilter.id : 'all') === f.id ? ' on' : ''}`}
                aria-pressed={(activeFilter ? activeFilter.id : 'all') === f.id}
                onClick={() => setFilterId(f.id)}
              >
                {`${f.label} ${rows.filter(f.test).length}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="setup-empty">{emptyText}</p>
      ) : (
        <>
          {askingRows.length > 0 && (
            <>
              <h3 className="setup-h" data-testid="asking-heading">Asking to take a name</h3>
              <ul className="setup-roster" data-testid="asking-list">{askingRows.map(row)}</ul>
            </>
          )}
          <h3 className="setup-h">{countLabel(rows.length)}</h3>
          {summary && <p className="setup-note">{summary}</p>}
          {visible.length === 0 && (
            <p className="setup-empty" data-testid="players-nomatch">Nobody matches.</p>
          )}
          {rest.length > 0 && <ul className="setup-roster">{rest.map(row)}</ul>}
        </>
      )}

      {/* WHO LEFT. A separate list, below the room, because these people are
          not in the counts and must not read as though they are — and on
          screen at all, because this is the only place a removal can be
          undone. */}
      {visibleGone.length > 0 && (
        <>
          <h3 className="setup-h setup-h--after" data-testid="departed-heading">
            {`${departed.length} removed from the room`}
          </h3>
          <p className="setup-note">{departedNote}</p>
          <ul className="setup-roster">
            {visibleGone.map((player) => (
              <li
                key={player.name}
                className="setup-roster__row setup-roster__row--gone setup-roster__row--norank"
                data-testid="departed-row"
              >
                {who(player, true)}
                <span className="setup-roster__side">{renderExtra && renderExtra(player, true)}</span>
                <span className="setup-roster__acts">
                  <button
                    type="button"
                    className="setup-roster__act"
                    onClick={() => onRestore(player.name)}
                    title={`Put "${player.name}" back into the live counts`}
                  >
                    Bring back
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
