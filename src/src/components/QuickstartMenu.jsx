import React, { useState, useEffect, useMemo, useRef } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import PlanLimitNotice from './PlanLimitNotice';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import { parseUpgradeRequired } from '../utils/upgradeRequired';
import { gameTypeMeta } from '../config/gameTypes';
import { makeListPredicate, ALL } from '../config/listControls';
import { SET_SEARCH_FIELDS, TAGS_AXIS, joinTags, splitTags } from '../config/setFinder';
import { tagIndex } from '../config/setShelfIndex';
import { OWNER_OPTIONS, setOwnerTag } from '../utils/setOwnerTag';
import { SCREEN_WORDS } from '../config/roomScreen';
import { TWO_SURFACE_TYPES, presentHref } from '../config/surfaces';
import { openPendingRoomWindow, willPlace } from '../present/roomWindow';
import './stage/ScreensGroup.css';
import {
  isUnreadableSet, unreadableSetName, UNREADABLE_REASON, UNREADABLE_SUB,
} from '../utils/unreadableSet';

const API_BASE = window.API_BASE;

// One matcher for the sheet's life: the fields are the set chooser's
// (config/setFinder.js), so a word that finds a set there finds it here.
/*
  QUICK START'S FILTERS (owner, 23 Oct 2026: "add owner and tag filters to
  Quick start too"): the search, whose set it is and its tags, on the same
  rules as the set chooser and the console (config/setFinder.js): several tags
  at once means a set with ANY of them.
*/
const QS_CONFIG = {
  searchFields: SET_SEARCH_FIELDS,
  axes: { owner: { get: (set) => setOwnerTag(set) }, tags: TAGS_AXIS },
};
const matches = makeListPredicate(QS_CONFIG);
/** The tags shown before "More tags": the most used. */
const TAGS_SHOWN = 10;

/**
 * WHERE THE ROOM WATCHES, IN QUICK START (owner, 18 Oct 2026). Quick start
 * creates and starts in one press, so the lobby's "Where will the room
 * watch?" never came: the mode was whatever this browser chose last, unshown.
 * The same choice as Settings › Screens (it stores the same value), shown
 * before the press. Call & Answer sets only: the type two screens cover.
 */
export function QuickScreens({ choice, onChoose, blocked = false }) {
  const two = choice === 'two';
  const hint = blocked ? SCREEN_WORDS.quickBlocked
    : choice === null ? SCREEN_WORDS.quickUnchosen
      : two ? (willPlace() ? SCREEN_WORDS.quickTwoPlaces : SCREEN_WORDS.quickTwoBeside)
        : SCREEN_WORDS.quickOne;
  return (
    <div className="scr quickstart-screens">
      <div className="scr-row">
        <div className="scr-k">
          <span className="scr-label" id="qs-screens-label">{SCREEN_WORDS.where}</span>
          <span className="scr-hint" role={blocked ? 'alert' : undefined}>{hint}</span>
        </div>
        <div className="scr-seg" role="group" aria-labelledby="qs-screens-label">
          <button type="button" className="scr-seg-btn" aria-pressed={choice === 'classic'} onClick={() => onChoose('classic')}>{SCREEN_WORDS.one}</button>
          <button type="button" className="scr-seg-btn" aria-pressed={two} onClick={() => onChoose('two')}>{SCREEN_WORDS.two}</button>
        </div>
      </div>
    </div>
  );
}

const QuickstartMenu = ({ onGameCreated, onClose, roomScreen = null, onRoomScreen = null }) => {
  const [windowBlocked, setWindowBlocked] = useState(false);
  const [quickstartSets, setQuickstartSets] = useState({
    'call-and-answer': [],
    'trivia': [],
    'wavelength': [],
    'poll': []
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // A plan-limit refusal from the last press, shown in the sheet — it used to
  // be a browser alert() with the server's sentence and nothing to click.
  const [limit, setLimit] = useState(null);
  const [currentPage, setCurrentPage] = useState({
    'call-and-answer': 0,
    'trivia': 0,
    'wavelength': 0,
    'poll': 0
  });

  const SETS_PER_PAGE = 4;

  /*
    A SEARCH (owner, 23 Oct 2026: "add search to Quick start"; issue #41). The
    same fields as the set chooser and the console list (config/setFinder.js):
    name, description, custom instruction and tags. Each format's carousel
    shows only its matches and starts again at its first page — page 3 of a
    twelve-set list is past the end of a two-match one. A format with no match
    drops out rather than drawing an empty carousel.
  */
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState(ALL);
  const [tags, setTags] = useState('');
  const [allTags, setAllTags] = useState(false);
  const searchRef = useRef(null);
  const state = { search: query, owner, tags };
  const shownSets = useMemo(() => Object.fromEntries(
    Object.entries(quickstartSets).map(([type, list]) => [type, list.filter((set) => matches(set, { search: query, owner, tags }))])
  ), [quickstartSets, query, owner, tags]);
  const everySet = Object.values(quickstartSets).flat();
  const countWith = (patch) => everySet.filter((set) => matches(set, { ...state, ...patch })).length;
  const ownersPresent = OWNER_OPTIONS.filter((o) => everySet.some((set) => setOwnerTag(set) === o.value));
  const tagsChosen = splitTags(tags);
  // Counted within the search and the owner, so a tag's number is what it adds.
  const tagList = tagIndex(everySet.filter((set) => matches(set, { ...state, tags: '' })));
  for (const t of tagsChosen) if (!tagList.some((x) => x.tag === t)) tagList.unshift({ tag: t, count: 0 });
  const firstPage = () => setCurrentPage((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, 0])));
  const search = (value) => { setQuery(value); firstPage(); };
  const pickOwner = (value) => { setOwner(value); firstPage(); };
  const toggleTag = (tag) => {
    setTags(joinTags(tagsChosen.includes(tag) ? tagsChosen.filter((t) => t !== tag) : [...tagsChosen, tag]));
    firstPage();
  };
  const filtersOn = owner !== ALL || tagsChosen.length > 0;
  const clearAll = () => {
    setQuery(''); setOwner(ALL); setTags(''); firstPage();
    searchRef.current?.focus();
  };
  // Clear goes back to the box: the button that was pressed unmounts with the
  // no-match line, and focus left on nothing drops a keyboard user to the top
  // of the page, outside the sheet.
  const clearSearch = () => {
    search('');
    searchRef.current?.focus();
  };
  const noMatch = (query.trim() !== '' || filtersOn) && Object.values(shownSets).every((list) => list.length === 0);
  const noMatchWords = [
    query.trim() ? `“${query.trim()}”` : '',
    owner !== ALL ? `in ${OWNER_OPTIONS.find((o) => o.value === owner).label}` : '',
    tagsChosen.length ? `tagged ${tagsChosen.join(' or ')}` : '',
  ].filter(Boolean).join(', ');

  useEffect(() => {
    fetchQuickstartSets();
  }, []);

  const fetchQuickstartSets = async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${API_BASE}admin/question-sets`);
      const data = await response.json();
      
      // Filter and group quickstart-enabled sets by engagement type
      const quickstartData = {
        'call-and-answer': [],
        'trivia': [],
        'wavelength': [],
        'poll': []
      };

      (data.questionSets || []).forEach(set => {
        if (set.quickstart && set.active) {
          const type = set.engagementType || 'call-and-answer';
          if (quickstartData[type]) {
            quickstartData[type].push(set);
          }
        }
      });

      setQuickstartSets(quickstartData);
    } catch (error) {
      console.error('Error fetching quickstart sets:', error);
    } finally {
      setLoading(false);
    }
  };


  const createQuickGame = async (questionSet) => {
    if (creating) return;

    // TWO SCREENS: open the room's window now, inside this click, while the
    // browser still allows a popup. It is blank until the session exists,
    // then goes to the room's window and onto the other display
    // (present/roomWindow.js openPendingRoomWindow).
    const twoScreens = roomScreen === 'two' && TWO_SURFACE_TYPES.includes(questionSet.engagementType);
    const pending = twoScreens ? openPendingRoomWindow() : null;
    setWindowBlocked(twoScreens && !pending);

    setCreating(true);
    setLimit(null);
    try {
      console.log(`🚀 Creating quickstart game with set: ${questionSet.name}`);
      
      // Generate automatic title
      const quickTitle = `Quick ${questionSet.engagementType === 'call-and-answer' ? 'Lessons' : 
                          questionSet.engagementType === 'trivia' ? 'Trivia' :
                          questionSet.engagementType === 'wavelength' ? 'Wavelength' :
                          'Poll'}: ${questionSet.name}`;
      
      // Create the game.
      //
      // authFetch, NOT fetch, and it is deliberately ahead of the backend.
      // `POST /games` is still public today; this call site is being taught to
      // send a token FIRST because buildspec-dev.yml:49-58 deploys the API
      // before the frontend and cached bundles outlive the build — so a route
      // that starts demanding a token before its callers send one 401s the
      // quick-start path for everyone still holding the old JS. A token on a
      // public route is ignored, so this is a no-op until the authorizer lands
      // and correct the moment it does.
      //
      // The token always exists here: QuickstartMenu only ever renders from
      // GameHostPage (GameHostPage.jsx:3118), which sits behind
      // ProtectedRoute (App.jsx:176), which requires `hosts` or `admins`.
      const createResponse = await authFetch(`${API_BASE}games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventTitle: quickTitle,
          // The set's own description, which the room's window shows under the
          // title in the lobby (owner, 18 Oct 2026). It was "Quick start
          // session using <set>", which told a room nothing.
          engagementInfo: String(questionSet.description || '').trim(),
          aiContext: null,
          gameType: questionSet.engagementType,
          questionSetId: questionSet.id,
          randomizeQuestions: true,
          selectedCategories: [], // Use all categories
          // `triviaTimer` used to be sent here. It was deleted: create-game.js:9's
          // destructure is a whitelist that never named it, nothing anywhere
          // reads a timer, and no countdown exists on any screen.
          // No `personaId` on purpose. Quickstart's whole premise is zero
          // decisions, and adding a voice picker here would be one more. The
          // set's own persona still applies — resolvePersona() falls through
          // host → set → context → inferred — so a set that has been given a
          // voice keeps it, and everything else gets the adaptive default,
          // which is the designed behaviour rather than a gap.
        })
      });

      if (createResponse.ok) {
        const gameData = await createResponse.json();
        console.log(`✅ Quickstart game created:`, gameData);
        
        // Start the game immediately
        const startResponse = await authFetch(`${API_BASE}games/${gameData.gameId}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (startResponse.ok) {
          console.log(`✅ Quickstart game started: ${gameData.gameId}`);
          if (pending) pending.go(presentHref(gameData.gameId));
          
          // Store the event title in localStorage
          localStorage.setItem(`game_${gameData.gameId}_title`, quickTitle);
          
          // Update the URL
          const url = new URL(window.location);
          url.searchParams.set('gameId', gameData.gameId);
          url.searchParams.set('eventTitle', encodeURIComponent(quickTitle));
          window.history.replaceState(null, '', url);
          
          // Notify parent component
          onGameCreated({
            gameId: gameData.gameId,
            eventTitle: quickTitle,
            questionSetId: questionSet.id,
            gameType: questionSet.engagementType
          });
          
          onClose();
        } else {
          if (pending) pending.cancel();
          throw new Error('Failed to start game');
        }
      } else {
        const errorData = await createResponse.json().catch(() => ({}));
        // A plan limit is not a fault: say it in the sheet, with the way out
        // (PlanLimitNotice, compact — this sheet is narrow).
        const refusal = parseUpgradeRequired(createResponse, errorData);
        if (pending) pending.cancel();
        if (refusal) {
          setLimit(refusal);
          return;
        }
        throw new Error(errorData.error || 'Failed to create game');
      }
    } catch (error) {
      if (pending) pending.cancel();
      console.error('Failed to create quickstart game:', error);
      alert(`Failed to create quickstart game: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const nextPage = (type) => {
    const maxPage = Math.max(0, Math.ceil(shownSets[type].length / SETS_PER_PAGE) - 1);
    setCurrentPage(prev => ({
      ...prev,
      [type]: prev[type] >= maxPage ? 0 : prev[type] + 1 // Circular navigation
    }));
  };

  const prevPage = (type) => {
    const maxPage = Math.max(0, Math.ceil(shownSets[type].length / SETS_PER_PAGE) - 1);
    setCurrentPage(prev => ({
      ...prev,
      [type]: prev[type] <= 0 ? maxPage : prev[type] - 1 // Circular navigation
    }));
  };

  const getVisibleSets = (type) => {
    const sets = shownSets[type];
    const startIdx = currentPage[type] * SETS_PER_PAGE;
    return sets.slice(startIdx, startIdx + SETS_PER_PAGE);
  };

  // Clicking the scrim already closed this; Escape did not, so a keyboard user
  // who opened it had no way back out at all. Not gated on `creating` — the
  // create call is already in flight by then and the overlay closes itself on
  // success, so blocking the key would only trap someone whose request failed.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // Escape inside another dialog (the help this header's `?` opens) is
      // that dialog's; it must not close Quick start behind it as well.
      const t = event.target;
      const inOther = t && typeof t.closest === 'function' && t.closest('[role="dialog"]')
        && !t.closest('.quickstart-modal');
      if (inOther) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (loading) {
    return (
      <div className="quickstart-overlay" data-theme="dark">
        <div className="quickstart-modal">
          <div className="quickstart-loading">
            <div className="loading-spinner"></div>
            <p>Loading quickstart options...</p>
          </div>
        </div>
      </div>
    );
  }

  const totalQuickstartSets = Object.values(quickstartSets).reduce((sum, sets) => sum + sets.length, 0);

  return (
    <div className="quickstart-overlay" data-theme="dark" onClick={onClose}>
      <div
        className="quickstart-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quickstart-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quickstart-header">
          <div className="quickstart-title">
            <p className="quickstart-kicker">Quick start</p>
            <h2 id="quickstart-heading">
              <Icon name="Lightning" weight="fill" size={18} color="var(--primary)" /> Pick a set and go
            </h2>
            <p>Creates the session and starts it in one press. Nothing else to fill in.</p>
          </div>

          {/* Quick start's section of the setup guide (Help Phase 3). */}
          <HelpButton {...helpFor('host-quick-start')} variant="inline" size="small" tooltip="Help: Quick start" className="help-button-quiet" />
          {/* The glyph is decorative; the name is on the button. Without it a
              screen reader announced this control as "multiplication sign". */}
          <button
            type="button"
            className="quickstart-close"
            onClick={onClose}
            aria-label="Close quick start"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="quickstart-content">
          <PlanLimitNotice refusal={limit} outcome="Nothing was created." surface="dusk" compact onDismiss={() => setLimit(null)} />
          {onRoomScreen && TWO_SURFACE_TYPES.some((t) => (quickstartSets[t] || []).length > 0) ? (
            <QuickScreens choice={roomScreen} onChoose={onRoomScreen} blocked={windowBlocked} />
          ) : null}
          {totalQuickstartSets === 0 ? (
            <div className="no-quickstart-sets">
              <h3>No Quickstart Sets Available</h3>
              <p>To enable quickstart, go to Admin <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" /> Question Sets and check the "Quickstart" box for your desired question sets.</p>
            </div>
          ) : (
            <>
            <label className="quickstart-search">
              <Icon name="MagnifyingGlass" size={16} color="currentColor" aria-hidden="true" />
              {/* Esc with words in the box clears them and stops there, as in
                  the set chooser; Esc in an empty box falls through to the
                  sheet's own handler and closes Quick start. */}
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); search(''); } }}
                placeholder={`Search ${totalQuickstartSets} quick start sets: name, description or tag`}
                aria-label={`Search ${totalQuickstartSets} quick start sets: name, description or tag`}
              />
            </label>
            {(ownersPresent.length > 1 || tagList.length > 0) && (
              <div className="quickstart-filters">
                {ownersPresent.length > 1 && (
                  <div className="quickstart-owner" role="radiogroup" aria-label="Whose sets">
                    {[{ value: ALL, label: 'All' }, ...ownersPresent].map((o) => (
                      <button key={o.value} type="button" role="radio" aria-checked={owner === o.value} className={owner === o.value ? 'is-on' : ''} onClick={() => pickOwner(o.value)}>
                        {o.label}<b>{countWith({ owner: o.value })}</b>
                      </button>
                    ))}
                  </div>
                )}
                {tagList.length > 0 && (
                  <div className="quickstart-tags" role="group" aria-label="Tags">
                    {(allTags ? tagList : tagList.slice(0, TAGS_SHOWN)).map(({ tag, count }) => (
                      <button key={tag} type="button" aria-pressed={tagsChosen.includes(tag)} className={tagsChosen.includes(tag) ? 'is-on' : ''} onClick={() => toggleTag(tag)}>
                        {tag}<b>{count}</b>
                      </button>
                    ))}
                    {tagList.length > TAGS_SHOWN && (
                      <button type="button" className="quickstart-moretags" onClick={() => setAllTags((v) => !v)}>
                        {allTags ? 'Fewer tags' : `More tags (${tagList.length - TAGS_SHOWN})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* The live region stays mounted: one that appears already holding
                its sentence is often never read out. Only the sentence is in
                it; the button beside it is not read out as part of the news. */}
            <div className={noMatch ? 'quickstart-nomatch' : undefined}>
              <p role="status" className="quickstart-status">{noMatch ? `No quick start set matches ${noMatchWords}.` : ''}</p>
              {noMatch && (filtersOn
                ? <button type="button" className="quickstart-clear" onClick={clearAll}>Clear the search and filters</button>
                : <button type="button" className="quickstart-clear" onClick={clearSearch}>Clear the search</button>)}
            </div>
            {Object.entries(shownSets).map(([type, sets]) => {
              if (sets.length === 0) return null;
              const all = (quickstartSets[type] || []).length;
              
              const visibleSets = getVisibleSets(type);
              const totalPages = Math.ceil(sets.length / SETS_PER_PAGE);
              const showNavigation = sets.length > SETS_PER_PAGE;

              return (
                <div key={type} className="quickstart-section">
                  <div className="quickstart-section-header">
                    <h3>
                      <Icon
                        name={gameTypeMeta(type).icon}
                        weight="duotone"
                        size={18}
                        color={gameTypeMeta(type).accent}
                      />{' '}
                      {gameTypeMeta(type).label}
                      <span className="set-count">({sets.length === all ? `${all} available` : `${sets.length} of ${all}`})</span>
                    </h3>
                  </div>

                  {/* The nav gutter is RESERVED whether or not this format
                      pages. Without it a five-set format's cards sat inside a
                      grid 104px narrower than a two-set format's, so the same
                      sheet drew two different card widths. */}
                  <div className="quickstart-sets-container">
                    {showNavigation ? (
                      <button
                        type="button"
                        className="quickstart-nav-btn prev"
                        onClick={() => prevPage(type)}
                        aria-label={`Previous ${gameTypeMeta(type).label} sets`}
                      >
                        <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" />
                      </button>
                    ) : (
                      <span className="quickstart-nav-gap" aria-hidden="true" />
                    )}

                    <div className="quickstart-sets-grid">
                      {/* A BUTTON, NOT A DIV. Every one of these was a <div>
                          with an onClick: no tab stop, no Enter, no role, so
                          the entire quick-start path was mouse-only. */}
                      {visibleSets.map(set => (
                        <button
                          type="button"
                          key={set.id}
                          className="quickstart-set-card"
                          /*
                            A SET THE SERVER COULD NOT DECRYPT IS NOT QUICK-
                            STARTABLE. This is the surface where that costs the
                            most: there is no picker to back out of and no
                            confirm step — one press creates the session AND
                            starts it, so the first anybody would learn of the
                            failure is a room already looking at it.
                          */
                          disabled={creating || isUnreadableSet(set)}
                          title={isUnreadableSet(set) ? UNREADABLE_REASON : undefined}
                          onClick={() => !creating && !isUnreadableSet(set) && createQuickGame(set)}
                        >
                          <div className="quickstart-set-info">
                            {/* `{set.name}` on a nulled name leaves an empty
                                heading, and the card's accessible name falls
                                through to the leftovers — "Ready to play 42
                                questions" — which reads as an invitation. */}
                            <h4>
                              {isUnreadableSet(set) ? unreadableSetName(set) : set.name}
                              <SetImageBadge hasImages={set.hasImages} />
                            </h4>
                            <p className="quickstart-set-description">
                              {isUnreadableSet(set)
                                ? UNREADABLE_SUB
                                : (set.description || 'Ready to play')}
                            </p>
                            <div className="quickstart-set-stats">
                              <span>{set.totalQuestions} questions</span>
                              <span>{set.categoryCount} categories</span>
                            </div>
                          </div>
                          <span className="quickstart-play-icon">
                            {creating
                              ? <Icon name="Timer" weight="bold" size={20} color="var(--muted)" />
                              : <Icon name="PlayCircle" weight="fill" size={20} color="var(--primary)" />}
                          </span>
                        </button>
                      ))}
                    </div>

                    {showNavigation ? (
                      <button
                        type="button"
                        className="quickstart-nav-btn next"
                        onClick={() => nextPage(type)}
                        aria-label={`More ${gameTypeMeta(type).label} sets`}
                      >
                        <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                      </button>
                    ) : (
                      <span className="quickstart-nav-gap" aria-hidden="true" />
                    )}
                  </div>

                  {showNavigation && (
                    <div className="quickstart-pagination">
                      <span>Page {currentPage[type] + 1} of {totalPages}</span>
                    </div>
                  )}
                </div>
              );
            })}
            </>
          )}
        </div>

        {creating && (
          <div className="quickstart-creating-overlay">
            <div className="creating-message">
              <div className="loading-spinner"></div>
              <p>Creating and starting your quickstart game...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickstartMenu;