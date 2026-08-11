import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import './GeneratedItemsTable.css';

const NO_EXCLUSIONS = new Set();

/**
 * Review a generated batch as a LIST, with per-item reject.
 *
 * docs/design/admin-redesign/11-ai-job-review.html and RATIONALE.md §6.6.
 * Review used to be a one-item-at-a-time carousel behind Previous/Next, and
 * there was no way to drop a single generated item: `handleLoadIntoSystem` sent
 * the whole array. One bad question therefore meant importing it and fixing it
 * later, or discarding eighty-three good ones.
 *
 * ONE COMPONENT, FOUR BUILDERS. Trivia, poll, survey and scenario items share
 * no field names — `title`/`questionDetail`, `title`/`options`,
 * `question`/`type`, `title`/`detail` — so the shape is supplied by the caller
 * as `primary`, `secondary`, `flag` and `columns` accessors rather than
 * replicated four times with four sets of near-identical bugs.
 *
 * PURE PROPS: no useAuth, no authFetch, no fetch. Filtering is local state and
 * nothing else is.
 *
 * INDICES ARE THE ITEM'S REAL POSITION in `items`, always — filtering and
 * sorting never renumber them, because `onToggleExclude(index)` and
 * `onEdit(index)` are how the caller edits its own array. A filtered view that
 * renumbered would silently exclude the wrong row.
 *
 * Props:
 *   items            the generated array, in order
 *   requested        what was asked for, so the shortfall can be named
 *   noun             'questions' | 'scenarios' | …, for copy and counts
 *   excluded         Set of indices the operator has rejected
 *   onToggleExclude  (index) => void
 *   onEdit           (index) => void   opens the caller's per-item editor
 *   primary          (item) => string        the row's main text
 *   secondary        (item) => string|null   a second line under it
 *   flag             (item) => string|null   a REAL defect, or null; drives the
 *                                            "Needs attention" filter
 *   columns          [{ header, value(item), width, filterable }]
 *   actions          node rendered in the header (Export / Create set / …)
 */
export default function GeneratedItemsTable({
  items = [],
  requested = 0,
  noun = 'items',
  excluded = NO_EXCLUSIONS,
  onToggleExclude,
  onEdit,
  primary = (item) => item?.title || '',
  secondary = () => null,
  flag = () => null,
  columns = [],
  actions = null,
}) {
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState('');
  const [segment, setSegment] = useState('all');

  const facetColumn = columns.find((column) => column.filterable) || null;

  const rows = useMemo(() => items.map((item, index) => ({
    item,
    index,
    primary: String(primary(item) ?? ''),
    secondary: secondary(item) || null,
    flag: flag(item) || null,
    cells: columns.map((column) => {
      const value = column.value(item);
      return value === null || value === undefined || value === '' ? null : String(value);
    }),
  })), [items, primary, secondary, flag, columns]);

  const facetValues = useMemo(() => {
    if (!facetColumn) return [];
    const at = columns.indexOf(facetColumn);
    return Array.from(new Set(rows.map((row) => row.cells[at]).filter(Boolean))).sort();
  }, [rows, columns, facetColumn]);

  const flaggedCount = rows.filter((row) => row.flag).length;
  const excludedCount = rows.filter((row) => excluded.has(row.index)).length;
  const keptCount = rows.length - excludedCount;

  const needle = query.trim().toLowerCase();
  const facetAt = facetColumn ? columns.indexOf(facetColumn) : -1;

  const visible = rows.filter((row) => {
    if (segment === 'attention' && !row.flag) return false;
    if (segment === 'excluded' && !excluded.has(row.index)) return false;
    if (facet && row.cells[facetAt] !== facet) return false;
    if (!needle) return true;
    return [row.primary, row.secondary, ...row.cells]
      .filter(Boolean)
      .some((text) => text.toLowerCase().includes(needle));
  });

  const filtering = Boolean(needle) || Boolean(facet) || segment !== 'all';

  return (
    <section className="git">
      <div className="git-head">
        <div className="git-headtext">
          <h3 className="git-title">Review {rows.length} generated {noun}</h3>
          <p className="git-sub">
            Nothing has been saved yet.{' '}
            {excludedCount > 0
              ? `${excludedCount} of these ${excludedCount === 1 ? 'is' : 'are'} excluded and will not be saved.`
              : 'Every row below will be saved unless you leave it out.'}
          </p>
        </div>
        {actions && <div className="git-actions">{actions}</div>}
      </div>

      {/* The shortfall, named. Near-duplicate suppression happens on the server
          and is only console.warn-ed (generation-handler.js:172), so asking for
          100 and silently receiving 84 is the kind of gap people discover a week
          later, in a session. */}
      {requested > rows.length && (
        <p className="git-shortfall">
          <Icon name="Warning" weight="fill" size={16} color="var(--git-warn)" />{' '}
          <span>
            <b>You asked for {requested} and got {rows.length}.</b> The server drops any{' '}
            {singular(noun)} whose title is a near-duplicate of one it already kept, and it
            stops early when a pass produces nothing new. It reports neither, so this
            difference is the only trace.
          </span>
        </p>
      )}

      <div className="git-filters">
        <label className="git-search">
          <Icon name="MagnifyingGlass" weight="bold" size={16} color="var(--git-muted)" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter these ${rows.length}`}
            aria-label={`Filter these ${rows.length} ${noun}`}
          />
        </label>

        {facetValues.length > 1 && (
          <select
            className="git-facet"
            value={facet}
            onChange={(event) => setFacet(event.target.value)}
            aria-label={`Filter by ${facetColumn.header.toLowerCase()}`}
          >
            <option value="">All {facetValues.length} {facetColumn.header.toLowerCase()}</option>
            {facetValues.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        )}

        <div className="git-seg" role="group" aria-label="Which rows to show">
          <button
            type="button"
            aria-pressed={segment === 'all'}
            onClick={() => setSegment('all')}
          >
            All {rows.length}
          </button>
          {flaggedCount > 0 && (
            <button
              type="button"
              aria-pressed={segment === 'attention'}
              onClick={() => setSegment('attention')}
            >
              Needs attention {flaggedCount}
            </button>
          )}
          {excludedCount > 0 && (
            <button
              type="button"
              aria-pressed={segment === 'excluded'}
              onClick={() => setSegment('excluded')}
            >
              Excluded {excludedCount}
            </button>
          )}
        </div>

        <span className="git-count">
          {rows.length} generated &middot; {keptCount} will be saved
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="git-nomatch">
          None of the {rows.length} {noun} match that filter.{' '}
          <button
            type="button"
            className="git-linkbtn"
            onClick={() => { setQuery(''); setFacet(''); setSegment('all'); }}
          >
            Clear the filters
          </button>
        </p>
      ) : (
        <div className="git-scroll">
          <table className="git-tbl">
            <thead>
              <tr>
                <th className="git-num" scope="col">#</th>
                <th scope="col">{capitalize(singular(noun))}</th>
                {columns.map((column) => (
                  <th key={column.header} scope="col" style={column.width ? { width: column.width } : undefined}>
                    {column.header}
                  </th>
                ))}
                <th scope="col" className="git-actcol"><span className="git-sr">Row actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const isExcluded = excluded.has(row.index);
                return (
                  <tr key={row.index} className={isExcluded ? 'git-out' : undefined}>
                    <td className="git-num">{row.index + 1}</td>
                    <td>
                      <span className="git-nm">{row.primary || '(untitled)'}</span>
                      {row.flag
                        ? <span className="git-flag">{row.flag}</span>
                        : row.secondary && <span className="git-2nd">{row.secondary}</span>}
                    </td>
                    {row.cells.map((cell, at) => (
                      <td key={columns[at].header}>
                        {cell ? <span className="git-chip">{cell}</span> : <span className="git-none">&mdash;</span>}
                      </td>
                    ))}
                    <td className="git-actcol">
                      <div className="git-rowact">
                        {onEdit && (
                          <button type="button" className="git-btn" onClick={() => onEdit(row.index)}>
                            <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit
                          </button>
                        )}
                        {onToggleExclude && (
                          <button
                            type="button"
                            className="git-btn git-ghost"
                            onClick={() => onToggleExclude(row.index)}
                            title={isExcluded ? 'Put this one back' : 'Leave this one out'}
                          >
                            {isExcluded
                              ? <>Put back</>
                              : <><Icon name="X" weight="bold" size={14} color="currentColor" /> Leave out</>}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtering && visible.length > 0 && (
        <p className="git-fine">
          Showing {visible.length} of {rows.length}. Excluding a row still excludes it from the
          whole set, not just this view.
        </p>
      )}
    </section>
  );
}

function singular(noun) {
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
