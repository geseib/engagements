import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import {
  applyListControls, computeDrops, initialListState, clearPatch, clearAllPatch, makeListPredicate, ALL,
} from '../config/listControls';
import {
  chooserConfig, CHOOSER_SORTS, UPDATED_WINDOWS, joinTags, splitTags, whenWords,
} from '../config/setFinder';
import { SET_TOPIC_IDS, SET_TOPICS, UNFILED, UNFILED_LABEL, setTopicLabel } from '../config/setTopics';
import { tagIndex, filterTagIndex } from '../config/setShelfIndex';
import {
  OWNER_OPTIONS, TEAM, setOwnerTag, setOwnerLabel, setOwnerTitle, setOwnerIsOurs,
} from '../utils/setOwnerTag';
import { setRefKey } from '../utils/setRef';
import { imageMarkerSuffix } from './SetImageBadge';
import './SetChooser.css';

/**
 * THE SET CHOOSER (issue #41; docs/design/set-chooser, frames S0-S5, owner
 * 23 Oct 2026: "the current UX is not going to scale to find what people need
 * as the question sets grow ... search, filter by mine/team/public/engage or
 * by date or by tag").
 *
 * One line in the form until it is wanted:
 *   - nothing picked: a search box ("Choose a question set") and the sets this
 *     host used lately, one click each (S0);
 *   - a set picked: ✓ its name, questions, owner and topic, and Change (S1b).
 * Clicking or typing opens the chooser IN PLACE (S1) — never a second dialog
 * (the container rule: no modal from a modal). Search, whose (All / Yours /
 * <your team> / Engage / Public, each counted), Topic, Tag (several: a set
 * carrying any of them), Updated (used by me lately, this week, this month,
 * older), Sort. Nothing matching says what each way out would find (S3).
 *
 * The filtering is config/setFinder.js on config/listControls.js, the same
 * predicate the console's list uses, so a count beside a control is the
 * number of rows pressing it gives.
 *
 * The sets arrive already narrowed to the chosen format; the caller owns the
 * selection (a pair key, utils/setRef.js) and what happens on a pick.
 */
/** Below this window width the wide chooser leaves out Topic and Tags. */
export const WIDE_COLUMNS_MIN = 900;

/** True while the window is at least `px` wide (true where there is no window). */
function useRoomy(px) {
  const query = `(min-width: ${px}px)`;
  const get = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches);
  const [roomy, setRoomy] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setRoomy(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, [query]);
  return roomy;
}

export default function SetChooser({
  sets = [],
  value = '',
  onChange,
  keyOf = setRefKey,
  recent = new Map(),
  formatLabel = '',
  teamName = '',
  otherTeams = [],
  onSwitchTeam = null,
  isUnreadable = () => false,
  unreadableLabel = (set) => `${set.id} (unreadable)`,
  unreadableReason = '',
  disabled = false,
  pinnedLabel = '',
  onMakeSet = null,
  makeSetLabel = 'Make a new set',
  otherFormats = [],
  rowNote = null,
  compact = false,
  idPrefix = 'sch',
  /** 'dark' where the surrounding card paints dusk under a paper page (GameSetupDialog). */
  theme = undefined,
  /** Never folds: the list stays, the picked row marked (an agenda item, whose job is the pick). */
  stayOpen = false,
  /**
   * WIDE (owner, 26 Oct 2026: "when the new engagement modal has the full table
   * of sets it is difficult to see all the info you need because it is so
   * narrow"): the caller has room, so each row shows its description under the
   * name and the Topic and Tags columns. A narrow window still drops the two
   * columns (SetChooser.css).
   */
  wide = false,
  /** (open) => void, so the caller can make room while the list is open. */
  onOpenChange = null,
  now: nowProp = 0,
}) {
  const [now] = useState(() => nowProp || Date.now());
  const config = useMemo(() => chooserConfig({ recent, keyOf, now }), [recent, keyOf, now]);
  const [state, setState] = useState(() => initialListState(config));
  const [openState, setOpen] = useState(false);
  const open = stayOpen || openState;
  // THE TWO EXTRA COLUMNS NEED THE ROOM (a browser at 820px showed why CSS
  // alone will not do: hiding cells under a fixed table layout slid Updated
  // into a zero-width column). Decided here, from the window, so the columns
  // and the cells always agree.
  const roomy = useRoomy(WIDE_COLUMNS_MIN);
  const wideCols = wide && roomy;
  const rootRef = useRef(null);
  const opened = useRef(false);
  useEffect(() => {
    // Opened by the host (not mounted open): bring the chooser to the top of
    // the dialog, so the list is in view rather than below the fold.
    if (open && !stayOpen && opened.current && rootRef.current && rootRef.current.scrollIntoView) {
      rootRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    opened.current = true;
  }, [open, stayOpen]);
  const tellOpen = useRef(onOpenChange);
  tellOpen.current = onOpenChange;
  useEffect(() => { if (tellOpen.current) tellOpen.current(open); }, [open]);
  const [tagMenu, setTagMenu] = useState(false);
  const [tagFind, setTagFind] = useState('');
  const [teamMenu, setTeamMenu] = useState(false);
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef(null);

  const patch = (p) => { setState((s) => ({ ...s, ...p })); setCursor(0); };
  const predicate = useMemo(() => makeListPredicate(config), [config]);
  const shown = useMemo(() => applyListControls(sets, config, state), [sets, config, state]);
  const chosen = sets.find((s) => keyOf(s) === value) || null;
  const pickable = (set) => !isUnreadable(set);
  const label = (set) => (isUnreadable(set) ? unreadableLabel(set) : set.name);
  const fmt = formatLabel ? `${formatLabel} ` : '';
  const ownerWord = (tag) => (tag === TEAM && teamName ? teamName : OWNER_OPTIONS.find((o) => o.value === tag).label);
  // The team's own name where the chip would say Team (one team at a time: the active one).
  const ownerChip = (set) => (setOwnerTag(set) === TEAM && teamName ? teamName : setOwnerLabel(set));
  const countWith = (p) => sets.filter((set) => predicate(set, { ...state, ...p })).length;
  const filtered = state.search.trim() || state.owner !== ALL || state.topic !== ALL || state.tags || state.updated !== 'any';

  // USED BY YOU LATELY (S0, S1): the newest three, while nothing narrows the list.
  const recentSets = [...sets].filter((s) => recent.get(keyOf(s)) && pickable(s))
    .sort((a, b) => recent.get(keyOf(b)) - recent.get(keyOf(a))).slice(0, 3);
  const cols = wideCols ? 6 : 4;
  const grouped = !filtered && state.sort === 'recent' && recentSets.length > 0;
  const rows = grouped
    ? [...recentSets, ...shown.filter((s) => !recentSets.includes(s))]
    : shown;

  const pick = (set) => {
    if (!set || !pickable(set) || disabled) return;
    onChange?.(keyOf(set), set);
    setOpen(false);
    setTagMenu(false);
  };
  const openUp = () => {
    if (disabled) return;
    setOpen(true);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open) pick(rows[cursor]); else openUp(); }
    else if (e.key === 'Escape') {
      if (state.search) { e.preventDefault(); e.stopPropagation(); patch({ search: '' }); }
      // A list that never folds leaves Esc to the dialog around it.
      else if (open && !stayOpen) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  };

  const searchBox = (placeholder) => (
    <label className="schs-search">
      <Icon name="MagnifyingGlass" size={16} />
      <input
        ref={searchRef}
        id={`${idPrefix}-search`}
        value={state.search}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
        onFocus={() => { if (!chosen) openUp(); }}
        onChange={(e) => { patch({ search: e.target.value }); setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && <span className="schs-keys" aria-hidden="true">{state.search ? 'Esc clears' : '↑↓ Enter'}</span>}
    </label>
  );

  // ── Folded: one line (S0 / S1b) ──
  if (!open) {
    if (chosen || (disabled && value)) {
      return (
        <div className="schs" data-testid="set-chooser" data-value={value} data-theme={theme}>
          <div className="schs-picked" role="group" aria-label="Question set">
            <Icon name="Check" size={16} />
            <b className="schs-picked-name" title={chosen ? label(chosen) : pinnedLabel}>{chosen ? label(chosen) : pinnedLabel}</b>
            {chosen && <span className="schs-dim">{chosen.totalQuestions || chosen.questionCount || 0} questions</span>}
            {chosen && <span className={`schs-own${setOwnerIsOurs(chosen) ? '' : ' schs-own--off'}`} title={setOwnerTitle(chosen)}>{ownerChip(chosen)}</span>}
            {chosen && !compact && <span className="schs-dim">{setTopicLabel(chosen.topic)}</span>}
            {!disabled && <button type="button" className="schs-btn schs-push" onClick={() => { setOpen(true); }}>Change</button>}
          </div>
        </div>
      );
    }
    return (
      <div className="schs" data-testid="set-chooser" data-value={value} data-theme={theme}>
        {searchBox(sets.length ? `Choose a question set: type to search ${sets.length} ${fmt}sets` : `No ${fmt}sets yet`)}
        {recentSets.length > 0 && (
          <div className="schs-recent">
            <span className="schs-dim">Used by you lately:</span>
            {recentSets.map((set) => (
              <button key={keyOf(set)} type="button" className="schs-recentbtn" onClick={() => pick(set)}>
                {label(set)} <span>· {ownerChip(set)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Open: the chooser in place (S1-S3) ──
  const tagsChosen = splitTags(state.tags);
  const tagOptions = filterTagIndex(tagIndex(sets.filter((set) => predicate(set, { ...state, tags: '' }))), tagFind);
  const toggleTag = (tag) => patch({ tags: joinTags(tagsChosen.includes(tag) ? tagsChosen.filter((t) => t !== tag) : [...tagsChosen, tag]) });
  const topicCount = (id) => countWith({ topic: id });
  const updatedCount = (v) => countWith({ updated: v });
  const drops = computeDrops(sets, config, state, {
    search: (q) => `Clear the search “${q}”`,
    owner: () => 'Look in every owner’s sets',
    topic: () => 'Any topic',
    tags: () => 'Any tag',
    updated: () => 'Any time',
  });
  const elsewhere = otherFormats
    .map((f) => ({ ...f, count: (f.sets || []).filter((set) => predicate(set, state)).length }))
    .filter((f) => f.count > 0);
  const chips = [];
  if (state.search.trim()) chips.push({ key: 'search', text: `Search “${state.search.trim()}”` });
  if (state.owner !== ALL) chips.push({ key: 'owner', text: ownerWord(state.owner) });
  if (state.topic !== ALL) chips.push({ key: 'topic', text: `Topic: ${state.topic === UNFILED ? UNFILED_LABEL : SET_TOPICS[state.topic].label}` });
  for (const t of tagsChosen) chips.push({ key: `tag:${t}`, text: `Tag: ${t}`, clear: () => toggleTag(t) });
  if (state.updated !== 'any') chips.push({ key: 'updated', text: UPDATED_WINDOWS.find((w) => w.value === state.updated).label });
  const team = teamName ? <> in <b>{teamName}</b></> : null;

  return (
    <div ref={rootRef} className={`schs schs--open${wide ? ' schs--wide' : ''}`} data-testid="set-chooser" data-value={value} data-theme={theme}>
      <div className="schs-head">
        <span className="schs-dim" role="status">
          {filtered ? `${shown.length} of ${sets.length} sets` : `${sets.length} ${fmt}sets you can use`}{team}
        </span>
        {onSwitchTeam && otherTeams.length > 0 && (
          <span className="schs-team">
            <button type="button" className="schs-link" aria-expanded={teamMenu} onClick={() => setTeamMenu((v) => !v)}>Switch team</button>
            {teamMenu && (
              <span className="schs-teammenu" role="group" aria-label="Switch team">
                {otherTeams.map((t) => (
                  <button key={t.orgId} type="button" className="schs-btn" onClick={() => onSwitchTeam(t.orgId)}>{t.name}</button>
                ))}
                <span className="schs-dim">The page reloads in that team.</span>
              </span>
            )}
          </span>
        )}
        {/* Sort sits up here, beside the count it orders, so the filters
            below fit on one line in a laptop-sized dialog (checked in a
            browser at 1280×720, 26 Oct 2026). */}
        <label className="schs-sel schs-push">
          <span>Sort</span>
          <select value={state.sort} onChange={(e) => patch({ sort: e.target.value })} aria-label="Sort">
            {CHOOSER_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {!stayOpen && <button type="button" className="schs-link" onClick={() => { setOpen(false); setTagMenu(false); }}>{chosen ? 'Keep the set I had' : 'Close'}</button>}
      </div>
      {searchBox(`Search ${sets.length} ${fmt}sets: name, description or tag`)}
      <div className="schs-filters">
        <div className="schs-seg" role="radiogroup" aria-label="Whose sets">
          {[{ value: ALL, label: 'All' }, ...OWNER_OPTIONS].map((o) => {
            const on = state.owner === o.value;
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} onClick={() => patch({ owner: o.value })}>
                {o.value === ALL ? 'All' : ownerWord(o.value)}<b>{countWith({ owner: o.value })}</b>
              </button>
            );
          })}
        </div>
        {!compact && (
          <label className="schs-sel">
            <span>Topic</span>
            <select value={state.topic} onChange={(e) => patch({ topic: e.target.value })} aria-label="Topic">
              <option value={ALL}>Any</option>
              {[...SET_TOPIC_IDS, UNFILED].map((id) => (
                <option key={id || 'unfiled'} value={id}>{id === UNFILED ? UNFILED_LABEL : SET_TOPICS[id].label} ({topicCount(id)})</option>
              ))}
            </select>
          </label>
        )}
        <span className="schs-tagwrap">
          <button type="button" className={`schs-fbtn${tagsChosen.length ? ' is-set' : ''}`} aria-expanded={tagMenu} onClick={() => setTagMenu((v) => !v)}>
            Tag <span>{tagsChosen.length ? tagsChosen.join(', ') : 'Any'}</span>
          </button>
          {tagMenu && (
            <div className="schs-pop" role="group" aria-label="Tags">
              <input className="schs-find" value={tagFind} placeholder="Find a tag" aria-label="Find a tag" onChange={(e) => setTagFind(e.target.value)} />
              {tagOptions.length === 0 && <span className="schs-dim">No tags here.</span>}
              {tagOptions.slice(0, 12).map(({ tag, count }) => (
                <label key={tag} className={tagsChosen.includes(tag) ? 'is-on' : ''}>
                  <input type="checkbox" checked={tagsChosen.includes(tag)} onChange={() => toggleTag(tag)} /> {tag}<b>{count}</b>
                </label>
              ))}
              <span className="schs-dim">Several: a set with any of them.</span>
            </div>
          )}
        </span>
        <label className="schs-sel">
          <span>Updated</span>
          <select value={state.updated} onChange={(e) => patch({ updated: e.target.value })} aria-label="Updated">
            {UPDATED_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}{w.value === 'any' ? '' : ` (${updatedCount(w.value)})`}</option>
            ))}
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className="schs-chips">
          {chips.map((c) => (
            <span key={c.key} className="schs-chip">
              {c.text}
              <button type="button" aria-label={`Remove ${c.text}`} onClick={c.clear || (() => patch(clearPatch(config, c.key)))}>×</button>
            </span>
          ))}
          <button type="button" className="schs-link" onClick={() => patch(clearAllPatch(config))}>Clear all</button>
        </div>
      )}

      {sets.length === 0 ? (
        <div className="schs-empty">
          <p>No {fmt}sets yet.</p>
          {onMakeSet && <button type="button" className="schs-btn" onClick={onMakeSet}>{makeSetLabel}</button>}
        </div>
      ) : rows.length === 0 ? (
        <div className="schs-empty" data-testid="set-chooser-empty">
          <h3>No {fmt}sets match{chips.length ? ` ${chips.map((c) => c.text).join(' · ')}` : ''}</h3>
          {(drops.length > 0 || elsewhere.length > 0) && <p>Each way out says what it would find:</p>}
          <div className="schs-exits">
            {drops.map((d) => (
              <button key={d.key} type="button" className="schs-exit" onClick={() => patch(d.next)}>{d.label}<b>{d.count} {d.count === 1 ? 'set' : 'sets'}</b></button>
            ))}
            {elsewhere.map((f) => (
              <button key={f.label} type="button" className="schs-exit" onClick={f.onPick}>Other formats: {f.label}<b>{f.count} {f.count === 1 ? 'set' : 'sets'}</b></button>
            ))}
          </div>
          {onMakeSet && (
            <div className="schs-row"><span className="schs-dim">Not there at all?</span><button type="button" className="schs-btn" onClick={onMakeSet}>{makeSetLabel}</button></div>
          )}
        </div>
      ) : (
        <div className="schs-list">
          <table className="schs-tbl">
            <colgroup>
              <col className="schs-c-name" /><col className="schs-c-qs" /><col className="schs-c-own" />
              {wideCols && <><col className="schs-c-topic" /><col className="schs-c-tags" /></>}
              <col className="schs-c-when" />
            </colgroup>
            <thead><tr>
              <th>Name</th><th>Qs</th><th>Owner</th>
              {wideCols && <><th className="schs-col-topic">Topic</th><th className="schs-col-tags">Tags</th></>}
              <th>{state.updated === 'used' || grouped ? 'Used / updated' : 'Updated'}</th>
            </tr></thead>
            <tbody>
              {rows.map((set, i) => {
                const k = keyOf(set);
                const ok = pickable(set);
                const note = rowNote ? rowNote(set) : '';
                return (
                  <React.Fragment key={k}>
                    {grouped && i === 0 && <tr className="schs-grp"><td colSpan={cols}>Used by you lately</td></tr>}
                    {grouped && i === recentSets.length && <tr className="schs-grp"><td colSpan={cols}>All {sets.length} sets</td></tr>}
                    <tr
                      className={`${k === value ? 'is-sel' : ''}${i === cursor ? ' is-cursor' : ''}${ok ? '' : ' is-off'}`}
                      data-testid="set-chooser-row"
                      onClick={() => pick(set)}
                      title={ok ? undefined : unreadableReason}
                    >
                      <td title={label(set)}>
                        <input type="radio" name={`${idPrefix}-set`} data-set-key={k} checked={k === value} disabled={!ok} onChange={() => pick(set)} aria-label={label(set)} />
                        {label(set)}{imageMarkerSuffix(set.hasImages)}
                        {note && <span className="schs-note">{note}</span>}
                        {wide && ok && set.description && <span className="schs-desc" title={set.description}>{set.description}</span>}
                      </td>
                      <td>{set.totalQuestions || set.questionCount || 0}</td>
                      <td><span className={`schs-own${setOwnerIsOurs(set) ? '' : ' schs-own--off'}`} title={setOwnerTitle(set)}>{ownerChip(set)}</span></td>
                      {wideCols && (
                        <>
                          <td className="schs-col-topic schs-dim">{setTopicLabel(set.topic)}</td>
                          <td className="schs-col-tags" title={(set.tags || []).join(', ')}>
                            {(set.tags || []).slice(0, 3).map((t) => <span key={t} className="schs-tag">{t}</span>)}
                            {(set.tags || []).length > 3 && <span className="schs-dim">+{set.tags.length - 3}</span>}
                          </td>
                        </>
                      )}
                      <td className="schs-dim">{whenWords(set, recent.get(k), now)}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {onMakeSet && rows.length > 0 && (
        <div className="schs-row"><button type="button" className="schs-link" onClick={onMakeSet}>{makeSetLabel}</button></div>
      )}
    </div>
  );
}
