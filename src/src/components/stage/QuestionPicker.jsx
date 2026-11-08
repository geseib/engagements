import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import Button from '../ui/Button';
import RowMenu from './RowMenu';
import { isTypingTarget } from '../HostActionBar';
import { browserRow, categoryRows, questionKey } from '../../config/setupPanel';
import { queuePosition } from '../../config/questionQueue';
import { normalizeGameType } from '../../config/gameTypes';
import {
  PICKER_WORDS as W, DEFAULT_PICKER_VIEW, CATS_ON,
  filterPickerRows, serveNextKeys, categoryFacets, toggleCat, previewOptions,
} from '../../config/questionPicker';
import './QuestionPicker.css';

/**
 * CHOOSE A QUESTION (docs/design/question-picker, approved 5 Nov 2026): one
 * picker for every door — the C key, the rail's Round queue, Your part now's
 * "Change what's next" and the Session menu's Up next — with one way back.
 *
 * IT TAKES OVER THE CONTENT AREA AND NOTHING ELSE (F1, D1). On two screens
 * the page portals it into the console's sheet host (over the room tile and
 * the main area); on one screen it is the Stage's `view`, under the top bar
 * and Your part now. The rail, Your part now and Space stay live, so it is a
 * `region`, not a dialog: it traps no focus (review A1). Space on a picker
 * control presses that control (HostActionBar's key-landed guard knows
 * `.qpk`); Space anywhere else still advances. THE CLASS NAME IS
 * LOAD-BEARING.
 *
 * PRESENTATIONAL, LIKE THE SESSION MENU. The queue is the page's: every
 * action goes out as a prop to the handlers the menu already used
 * (handleQueueQuestion / handleQueueFirst / handleQueueRemove /
 * selectQuestion / handleDisableQuestion). The view — search, categories,
 * Show — is the page's too (D8), so closing and reopening returns the same
 * list; `scrollRef` keeps the list's scroll position the same way without
 * re-rendering the page on every scroll.
 *
 * NO CORRECT ANSWER ON ANY SURFACE. Rows are `browserRow`'s allow-list; the
 * preview adds the option texts (F7) and never which is right.
 */
export default function QuestionPicker({
  questions = [],
  loadingQuestions = false,
  usedQuestionIds = [],
  categories = [],
  categoryCounts = null,
  categoryBitmasks = null,
  activeCategoryIds = new Set(),
  questionQueue = [],
  queueBusyKeys = [],
  upNext = [],
  currentQuestionId = null,
  gameType = '',
  view = DEFAULT_PICKER_VIEW,
  onViewChange = () => {},
  scrollRef = null,
  focusKey = null,
  backLabel = '',
  backWhere = 'the round',
  onClose = () => {},
  onQueue = () => {},
  onUnqueue = () => {},
  onAskNext = () => {},
  onAskNow = () => {},
  onDisable = () => {},
  onWrite = null,
  onOpenCategories = null,
  queuedHere = 0,
  onUndoQueued = null,
  oneScreen = false,
  onHide = null,
  onUsePhone = null,
  place = 'sheet',
}) {
  const headId = useId();
  const headRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef(new Map());
  const v = { ...DEFAULT_PICKER_VIEW, ...(view || {}) };
  const change = (patch) => onViewChange({ ...v, ...patch });

  const catRows = useMemo(
    () => categoryRows({ categories, categoryCounts, categoryBitmasks, activeCategoryIds }),
    [categories, categoryCounts, categoryBitmasks, activeCategoryIds],
  );
  const activeCategoryNames = useMemo(() => {
    if (!catRows.length) return null;
    return new Set(catRows.filter((r) => r.enabled).map((r) => r.name));
  }, [catRows]);

  const entries = useMemo(
    () => questions.map((question) => {
      const row = browserRow(question, { usedIds: usedQuestionIds, activeCategories: activeCategoryNames });
      return { row, question, key: questionKey(String(row.id ?? '')) };
    }),
    [questions, usedQuestionIds, activeCategoryNames],
  );
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const total = entries.length;
  const notAsked = entries.filter((e) => !e.row.used).length;

  const visible = useMemo(() => {
    const keep = new Set(filterPickerRows(entries.map((e) => e.row), v).map((r) => questionKey(String(r.id ?? ''))));
    return entries.filter((e) => keep.has(e.key));
  }, [entries, v.search, v.cats, v.show]); // eslint-disable-line react-hooks/exhaustive-deps

  const serveKeys = useMemo(() => serveNextKeys(upNext, { currentQuestionId }), [upNext, currentQuestionId]);
  const visibleKeys = new Set(visible.map((e) => e.key));
  const serve = serveKeys.filter((k) => visibleKeys.has(k)).map((k) => byKey.get(k)).filter(Boolean);
  const serveSet = new Set(serve.map((e) => e.key));
  const rest = visible.filter((e) => !serveSet.has(e.key));
  const ordered = [...serve, ...rest];

  const facets = useMemo(
    () => categoryFacets(entries.map((e) => e.row), { search: v.search, show: v.show, order: catRows.map((r) => r.name) }),
    [entries, v.search, v.show, catRows],
  );

  const busy = useMemo(() => new Set(queueBusyKeys.map((k) => questionKey(String(k)))), [queueBusyKeys]);

  /* THE SELECTED ROW: the opener's (a planned rail row) or the first. A
     roving tabindex (review A3); the preview follows it. */
  const [selected, setSelected] = useState(() => (focusKey ? questionKey(String(focusKey)) : null));
  const selectedEntry = (selected && ordered.find((e) => e.key === selected)) || ordered[0] || null;
  const selectedKey = selectedEntry ? selectedEntry.key : null;
  const selectedAt = selectedEntry ? ordered.indexOf(selectedEntry) : -1;

  /* FOCUS ON OPEN GOES TO THE HEADING (review A1), never to the search: a
     screen-reader user is not dropped into an edit field. */
  useEffect(() => {
    if (headRef.current) headRef.current.focus();
  }, []);

  /* THE SCROLL POSITION SURVIVES CLOSE AND REOPEN (D8). */
  useLayoutEffect(() => {
    if (scrollRef && listRef.current && Number(scrollRef.current) > 0) listRef.current.scrollTop = Number(scrollRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ESC AND THE WAY BACK (D6): one press closes, from anywhere on the page.
     On `document`, because a pointer click on the console lets go of focus
     (HostConsole releasePointerFocus) and a listener on this root would then
     never hear the key. Inside the search box Esc clears the text first, the
     standard search-field behaviour, and the footer says so. A dialog on top
     (a confirm, the ⋯ menu, which takes Escape in the capture phase) owns
     its own Escape. */
  const searchText = v.search;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (searchRef.current && e.target === searchRef.current && searchText) {
        onViewChange({ ...DEFAULT_PICKER_VIEW, ...(view || {}), search: '' });
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onViewChange, view, searchText]);

  const focusRow = (key) => {
    const el = rowRefs.current.get(key);
    if (el && typeof el.focus === 'function') el.focus();
  };
  const move = (delta) => {
    if (!ordered.length) return;
    const at = selectedAt < 0 ? 0 : Math.min(ordered.length - 1, Math.max(0, selectedAt + delta));
    const key = ordered[at].key;
    setSelected(key);
    focusRow(key);
  };

  const askNext = (entry) => {
    if (!entry || entry.row.used || queuePosition(questionQueue, entry.key) === 1 || busy.has(entry.key)) return;
    onAskNext(entry.key, entry.row);
  };

  /* ↑/↓, Enter and / on the picker's root (README note 4). Arrows inside a
     radio or checkbox stay theirs; from the search box ↓ goes into the list.
     Enter asks next only from a row or the heading: on a button it is that
     button's. */
  const onKeyDown = (e) => {
    if (e.defaultPrevented) return;
    const typing = isTypingTarget(e.target);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      if (searchRef.current) searchRef.current.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (typing && e.target !== searchRef.current) return;
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' && e.target && typeof e.target.matches === 'function'
      && e.target.matches('.qpk-row, .qpk-title')) {
      e.preventDefault();
      askNext(selectedEntry);
    }
  };

  const typeKind = normalizeGameType(gameType);
  const metaOf = (row) => [
    row.category,
    typeKind === 'trivia' ? row.difficulty : '',
    row.responseKind ? row.responseKind.toLowerCase() : '',
  ].filter(Boolean).join(' · ');

  const menuItems = (entry, pos) => [
    {
      id: 'ask-now',
      label: entry.row.used ? W.askAgainNow : W.askNow,
      note: W.askNowNote,
      onSelect: () => onAskNow(entry.question),
    },
    !entry.row.used && {
      id: 'put-aside',
      label: W.putAside,
      disabled: busy.has(entry.key),
      onSelect: () => onDisable(entry.key, { queued: pos > 0 }),
    },
  ];

  const rowActs = (entry) => {
    const pos = queuePosition(questionQueue, entry.key);
    const held = busy.has(entry.key);
    const { row } = entry;
    return (
      <span className="qpk-acts">
        {pos > 0 ? (
          <span className="qpk-tag qpk-tag--q" data-testid="browser-queued-tag" title="This question is in the running order">
            {pos === 1 ? W.nextTag : W.queuedTag(pos)}
          </span>
        ) : null}
        {pos > 0 ? (
          <Button variant="secondary" size={36} className="qpk-act" disabled={held} onClick={() => onUnqueue(entry.key)} aria-label={`${W.unqueue}: ${row.title}`}>
            {W.unqueue}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size={36}
              className="qpk-act"
              disabled={held || row.used}
              title={row.used ? W.alreadyAsked : W.queueHint}
              onClick={() => onQueue(entry.question)}
              aria-label={`${W.queue}: ${row.title}`}
            >
              {W.queue}
            </Button>
            <Button
              variant="secondary"
              size={36}
              className="qpk-act qpk-act--next"
              disabled={held || row.used}
              title={row.used ? W.alreadyAsked : W.askNextHint}
              onClick={() => askNext(entry)}
              aria-label={`${W.askNext}: ${row.title}`}
              data-testid="picker-ask-next"
            >
              {W.askNext}
            </Button>
          </>
        )}
        <RowMenu label={`More for ${row.title}`} testId="browser-row-menu" items={menuItems(entry, pos)} />
      </span>
    );
  };

  const rowItem = (entry) => {
    const { row } = entry;
    const isSel = entry.key === selectedKey;
    return (
      <li
        key={entry.key}
        ref={(el) => { if (el) rowRefs.current.set(entry.key, el); else rowRefs.current.delete(entry.key); }}
        className={`qpk-row${row.used ? ' is-used' : ''}${row.disabled ? ' is-off' : ''}${isSel ? ' is-selected' : ''}`}
        data-testid="browser-row"
        data-key={entry.key}
        aria-current={isSel ? 'true' : undefined}
        tabIndex={isSel ? 0 : -1}
        onClick={() => setSelected(entry.key)}
        onFocus={(e) => { if (e.target === e.currentTarget) setSelected(entry.key); }}
      >
        <span className="qpk-row-text">
          <span className="qpk-row-t" title={row.title}>{row.title}</span>
          <span className="qpk-row-m" title={metaOf(row)}>
            {metaOf(row)}
            {row.used ? <span className="qpk-tag qpk-tag--asked" title="Already asked this session">{W.asked}</span> : null}
            {row.disabled ? <span className="qpk-tag qpk-tag--off" title="This category is switched off, so the session will not serve it">Off</span> : null}
          </span>
        </span>
        {rowActs(entry)}
      </li>
    );
  };

  const preview = () => {
    if (!selectedEntry) return null;
    const { row, question } = selectedEntry;
    const pos = queuePosition(questionQueue, selectedEntry.key);
    const held = busy.has(selectedEntry.key);
    const options = previewOptions(question);
    return (
      <>
        <p className="qpk-k">{`${W.preview} · ${oneScreen ? W.previewRoom : W.previewPrivate}`}</p>
        <h3 className="qpk-pv-t">{row.title}</h3>
        {row.detail ? <p className="qpk-pv-d">{row.detail}</p> : null}
        {options.length ? (
          <ol className="qpk-pv-opts" data-testid="picker-preview-options">
            {options.map((text, i) => <li key={`${i}-${text}`}>{text}</li>)}
          </ol>
        ) : null}
        <p className="qpk-pv-m">{metaOf(row)}</p>
        <div className="qpk-pv-acts">
          <Button
            variant="secondary"
            size={44}
            className="qpk-act qpk-act--strong"
            disabled={held || row.used || pos === 1}
            title={row.used ? W.alreadyAsked : W.askNextHint}
            onClick={() => askNext(selectedEntry)}
            aria-label={`${W.askNext}: ${row.title}`}
            data-testid="picker-preview-ask-next"
          >
            <Icon name="Check" weight="bold" size={15} color="currentColor" />
            {` ${W.askNext} `}
            <kbd className="qpk-kbd" aria-hidden="true">Enter</kbd>
          </Button>
          {pos > 0 ? (
            <Button variant="secondary" size={44} className="qpk-act" disabled={held} onClick={() => onUnqueue(selectedEntry.key)} aria-label={`${W.unqueue}: ${row.title}`}>{W.unqueue}</Button>
          ) : (
            <Button variant="secondary" size={44} className="qpk-act" disabled={held || row.used} onClick={() => onQueue(question)} aria-label={`${W.queue}: ${row.title}`} data-testid="picker-preview-queue">{W.queue}</Button>
          )}
          <RowMenu label={`More for ${row.title}`} testId="picker-preview-menu" items={menuItems(selectedEntry, pos)} size={44} />
        </div>
        <p className="qpk-note">{W.previewNote}</p>
        <div className="qpk-pager">
          <Button variant="tertiary" size={36} disabled={ordered.length < 2} onClick={() => move(-1)}>{`‹ ${W.previous}`}</Button>
          <span className="qpk-pos">{W.position(selectedAt + 1, ordered.length)}</span>
          <Button variant="tertiary" size={36} disabled={ordered.length < 2} onClick={() => move(1)}>{`${W.next} ›`}</Button>
        </div>
      </>
    );
  };

  const filtered = Boolean(v.search) || v.cats.length > 0;
  const list = () => {
    if (loadingQuestions && !total) return <p className="qpk-empty"><span className="spinner" /> {W.loading}</p>;
    if (!total) return <p className="qpk-empty">{W.emptySet}</p>;
    if (!ordered.length) {
      return (
        <div className="qpk-empty" data-testid="picker-empty-filter">
          <p>{W.emptyFilter}</p>
          {filtered ? (
            <Button variant="secondary" size={36} onClick={() => change({ search: '', cats: [] })}>{W.clearFilters}</Button>
          ) : null}
        </div>
      );
    }
    return (
      <>
        {serve.length ? (
          <section aria-labelledby={`${headId}-serve`} data-testid="picker-serve-next">
            <h3 className="qpk-gh" id={`${headId}-serve`} title={W.serveNextTitle}>
              {W.serveNext}
              <span className="qpk-gh-rest">{` · ${W.serveNextRest}`}</span>
            </h3>
            <ul className="qpk-rows">{serve.map(rowItem)}</ul>
          </section>
        ) : null}
        {rest.length ? (
          <section aria-labelledby={`${headId}-rest`} data-testid="picker-rest">
            <h3 className="qpk-gh" id={`${headId}-rest`}>
              {v.show === 'unasked' ? W.allNotAsked : W.allQuestions}
              {serve.length ? <span className="qpk-gh-rest">{` · ${W.more(rest.length)}`}</span> : null}
            </h3>
            <ul className="qpk-rows">{rest.map(rowItem)}</ul>
          </section>
        ) : null}
      </>
    );
  };

  const picked = new Set(v.cats);
  return (
    <section
      className="qpk"
      data-theme="dark"
      data-place={place}
      data-one-screen={oneScreen ? '' : undefined}
      role="region"
      aria-labelledby={headId}
      onKeyDown={onKeyDown}
      data-testid="question-picker"
    >
      <header className="qpk-head">
        <Button
          variant="secondary"
          size={36}
          className="qpk-back"
          onClick={onClose}
          aria-label={W.backTo(backLabel)}
          data-testid="picker-back"
        >
          <Icon name="CaretLeft" weight="bold" size={14} color="currentColor" />
          {` ${backLabel}`}
        </Button>
        <h2 className="qpk-title" id={headId} tabIndex={-1} ref={headRef}>
          {W.title}
          <span className="qpk-count">{` ${W.counts(notAsked, total)}`}</span>
        </h2>
        {queuedHere > 0 ? (
          <span className="qpk-queued" role="status" data-testid="picker-queued-here">
            {W.queuedHere(queuedHere)}
            {onUndoQueued ? <Button variant="tertiary" size={36} onClick={onUndoQueued} data-testid="picker-queued-undo">{W.undo}</Button> : null}
          </span>
        ) : null}
        <Button variant="secondary" size={36} className="qpk-done" onClick={onClose} data-testid="picker-done">
          <Icon name="Check" weight="bold" size={14} color="currentColor" />
          {` ${W.done} `}
          <kbd className="qpk-kbd" aria-hidden="true">Esc</kbd>
        </Button>
      </header>

      {/* ONE SCREEN, SHOWN HERE (D9): said, with the two ways out of it. */}
      {oneScreen ? (
        <div className="qpk-room" data-testid="picker-room-line">
          <Icon name="Eye" weight="bold" size={16} color="currentColor" />
          <span><b>{W.roomLine}</b>{` ${W.roomLineRest}`}</span>
          {onHide ? <Button variant="secondary" size={36} onClick={onHide} data-testid="picker-hide">{W.hide}</Button> : null}
          {onUsePhone ? <Button variant="secondary" size={36} onClick={onUsePhone} data-testid="picker-use-phone">{W.usePhone}</Button> : null}
        </div>
      ) : null}

      <div className="qpk-body">
        <div className="qpk-filters" role="group" aria-label="Filters">
          <label className="qpk-search">
            <Icon name="MagnifyingGlass" weight="bold" size={15} color="var(--muted)" />
            <input
              ref={searchRef}
              type="search"
              aria-label={W.searchLabel}
              placeholder={W.search(total)}
              value={v.search}
              onChange={(e) => change({ search: e.target.value })}
              data-testid="picker-search"
            />
            <kbd className="qpk-kbd" aria-hidden="true">/</kbd>
          </label>

          <fieldset className="qpk-fs">
            <legend className="qpk-k">{W.show}</legend>
            <label className="qpk-opt">
              <input type="radio" name={`${headId}-show`} checked={v.show === 'unasked'} onChange={() => change({ show: 'unasked' })} data-testid="picker-show-unasked" />
              <span>{W.notAsked}</span>
              <span className="qpk-n">{notAsked}</span>
            </label>
            <label className="qpk-opt">
              <input type="radio" name={`${headId}-show`} checked={v.show === 'all'} onChange={() => change({ show: 'all' })} data-testid="picker-show-all" />
              <span>{W.all}</span>
              <span className="qpk-n">{total}</span>
            </label>
          </fieldset>

          {facets.length ? (
            <fieldset className="qpk-fs">
              <legend className="qpk-k">{W.categories}</legend>
              <label className="qpk-opt">
                <input type="checkbox" checked={picked.size === 0} onChange={() => change(toggleCat(v, ''))} data-testid="picker-cat-all" />
                <span>{W.allCategories}</span>
              </label>
              {activeCategoryNames ? (
                <label className="qpk-opt">
                  <input type="checkbox" checked={picked.has(CATS_ON)} onChange={() => change(toggleCat(v, CATS_ON))} data-testid="picker-cat-on" />
                  <span>{W.catsOn}</span>
                </label>
              ) : null}
              {facets.map((f) => (
                <label className="qpk-opt" key={f.name}>
                  <input
                    type="checkbox"
                    checked={picked.has(f.name)}
                    onChange={() => change(toggleCat(v, f.name))}
                    aria-label={f.off ? W.offName(f.name, f.count) : `${f.name}, ${f.count}`}
                    data-testid="picker-cat"
                  />
                  <span className="qpk-opt-name">
                    {f.name}
                    {f.off ? <span className="qpk-offtag">{W.off}</span> : null}
                  </span>
                  <span className="qpk-n">{f.count}</span>
                </label>
              ))}
              <p className="qpk-note">
                {`${W.filtersNote} `}
                {onOpenCategories ? (
                  <button type="button" className="qpk-link" onClick={onOpenCategories} data-testid="picker-open-categories">{W.filtersLink}</button>
                ) : <b>{W.filtersLink}</b>}
                .
              </p>
            </fieldset>
          ) : null}
        </div>

        <div
          className="qpk-list"
          ref={listRef}
          onScroll={scrollRef ? (e) => { scrollRef.current = e.currentTarget.scrollTop; } : undefined}
        >
          <p className="qpk-showing" data-testid="browser-count" aria-live="polite">{W.showing(ordered.length, total)}</p>
          {list()}
        </div>

        <section className="qpk-preview" aria-label={W.preview} aria-live="off" data-testid="picker-preview">
          {preview()}
        </section>
      </div>

      <footer className="qpk-foot">
        <span className="qpk-keys">
          <kbd className="qpk-kbd">↑</kbd><kbd className="qpk-kbd">↓</kbd>{` ${W.keysMove}`}
          <kbd className="qpk-kbd">Enter</kbd>{` ${W.keysAsk}`}
          <kbd className="qpk-kbd">/</kbd>{` ${W.keysSearch}`}
          <kbd className="qpk-kbd">Esc</kbd>
          {v.search ? ' clears the search, then goes back' : ` ${W.keysBack} to ${backWhere}`}
        </span>
        {onWrite ? (
          <button type="button" className="qpk-link" onClick={onWrite} data-testid="picker-write">
            {`${W.writeOwn} `}
            <kbd className="qpk-kbd" aria-hidden="true">Q</kbd>
          </button>
        ) : null}
      </footer>
    </section>
  );
}
