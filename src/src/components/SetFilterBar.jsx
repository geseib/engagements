import React from 'react';
import {
  SET_SEARCH_FIELDS, SET_SORTS, TAGS_AXIS, CONSOLE_UPDATED_WINDOWS, inUpdatedWindow, splitTags,
} from '../config/setFinder';
import ListControls from './ListControls';
import SetShelfBrowse from './SetShelfBrowse';
import { OWNER_OPTIONS, setOwnerTag } from '../utils/setOwnerTag';
import {
  GAME_TYPE_LIST,
  gameTypeLabel,
  isPlayableGameType,
  normalizeGameType,
  NOT_PLAYABLE_LABEL,
} from '../config/gameTypes';
import {
  resolveSetTopic, setTopicLabel, SET_TOPIC_IDS, SET_TOPICS, UNFILED, UNFILED_LABEL,
} from '../config/setTopics';

/**
 * THE QUESTION-SET FILTERS, DECLARED ONCE FOR BOTH EXPLORERS.
 *
 * Two screens browse a library of question sets: the console's Question Sets
 * list (QuestionSetsPanel, also the Public library) and the host's "Your
 * question sets" dialog, opened from the host home page (HostQuestionSetsDialog).
 * Until 2026-11-07 only the first had filters. The owner: *"why in the host
 * home page question set explorer do they not feature the same filter
 * treatments?"* — there was no reason a host should not have them. The host
 * dialog's header comment ("filters, sort … None of that is a host's job")
 * predates the owner's 23 Oct ask for "search, filter by mine/team/public/
 * engage or by date or by tag", and the commit that answered that ask on the
 * host side (32c9fb18f) shipped the search box alone.
 *
 * So the config (what each filter matches), the drop-exit labels (what "nothing
 * matches" offers) and the bar itself (which controls, in which order) live
 * here, and both screens render THIS. A filter added or reordered here moves
 * in both, and the two cannot drift apart again.
 *
 * TYPE FIRST. The owner, 7 Nov 2026: *"in the question set explorer it makes
 * sense to have the type filter be the first choice not second."* The format is
 * the first thing a set is chosen by — a trivia night cannot play a poll — so
 * the bar opens with it, then the shelf (topic), then status, owner, date and
 * the sort. The axes below are in the same order, so the drop-exits on the
 * "nothing matches" screen read in the order the bar does.
 *
 * Styled by QuestionSetsPanel.css under the `qsets` scope (ListControls renders
 * `.qsets-filters/.qsets-search/.qsets-input/.qsets-select/.qsets-count`
 * verbatim, SetShelfBrowse `.qsets-browse*`), which both screens load.
 */

/*
  WHAT EACH FILTER MATCHES.

  Only the ITEM side of the type compare is normalised, deliberately: the
  filter's options come from GAME_TYPE_LIST, so its value is already canonical,
  while the rows still hold the original seeds' aliases (`callandanswer`,
  `polls`).
*/
export const SET_LIST_CONFIG = {
  // The SET's own tags join the haystack (config/setTopics.js: not the list a
  // QUESTION carries, which lives on a different row and never meets this one).
  // A word somebody can write and never find again is not a tag.
  searchFields: SET_SEARCH_FIELDS,
  axes: {
    // THE FORMAT, first — see the header.
    type: { get: (set) => normalizeGameType(set.engagementType) },
    // THE SHELF. Only the ITEM side is resolved: the options come from the
    // closed vocabulary, so the filter's own value is already an id — and
    // `resolveSetTopic` folds a row with no shelf, or a shelf nothing
    // recognises, onto UNFILED, which is a real option here rather than a row
    // that cannot be reached.
    topic: { get: (set) => resolveSetTopic(set.topic) },
    /*
      THE AUTHOR'S OWN WORDS, and an axis rather than a phrase pushed into the
      search box — which is what the browse's tag pills used to do.

      The pill carries a COUNT: the sets carrying that tag (once another tag is
      in force, a click ADDS that tag's sets, so the list grows by that count
      less the overlap). The search box cannot give it even that: it OR-matches a
      substring across the name, the description, the custom instruction and
      the tags, so `empire` also returned "The British Empire" (which carries
      no such tag) and `ancient` also returned every `ancient-egypt` set.
      Matching through `setCarriesTag` — the same function config/
      setShelfIndex.js counts with — makes the two agree by construction.

      SEVERAL AT ONCE since the set chooser (owner, 23 Oct 2026: "filter ...
      by tag"): the value is a comma-joined list (setFinder's joinTags /
      splitTags) and a set carrying ANY of them stays. It is the chooser's own
      axis, TAGS_AXIS, so the two cannot disagree about what a tag finds.
    */
    tag: TAGS_AXIS,
    status: { get: (set) => (set.active ? 'active' : 'inactive') },
    // WHOSE IT IS — the same four values as the chip on every row, from the
    // same function, so the filter can never disagree with what a row says.
    owner: { get: (set) => setOwnerTag(set) },
    /*
      WHEN IT LAST CHANGED — the owner's "or by date". The same windows and
      the same rule as the chooser (setFinder's inUpdatedWindow), minus "Used
      by me lately": that reads the host's own sessions, which neither explorer
      loads. The clock is read when the row is tested rather than when the
      module loads, so a screen left open overnight still means today.
    */
    updated: { all: 'any', get: (set) => set, eq: (set, wanted) => inUpdatedWindow(set, wanted, Date.now()) },
  },
  // THE SORTS AND THE SEARCH FIELDS ARE SHARED with the host's set chooser
  // (config/setFinder.js), so a word or "newest" means the same thing in all three.
  sorts: SET_SORTS,
  defaultSort: 'newest',
};

/** The words on each "nothing matches" exit. A module constant, so the hook's
 *  drop memo is keyed on something stable. */
export const SET_FILTER_LABELS = {
  search: (needle) => `Search “${needle}”`,
  type: (value) => `Type: ${gameTypeLabel(value)}`,
  // setTopicLabel answers "Unfiled" for the empty id, so the exit out of
  // that filter names itself the same way the option does.
  topic: (value) => `Topic: ${setTopicLabel(value)}`,
  // A tag is already the word a person clicked, so it names itself; with
  // several, the exit drops them all, so it names them all.
  tag: (value) => {
    const tags = splitTags(value);
    return `${tags.length > 1 ? 'Tags' : 'Tag'}: ${tags.join(', ')}`;
  },
  status: (value) => `Status: ${value === 'active' ? 'Active' : 'Inactive'}`,
  owner: (value) => `Owner: ${(OWNER_OPTIONS.find((o) => o.value === value) || {}).label || value}`,
  updated: (value) => (CONSOLE_UPDATED_WINDOWS.find((w) => w.value === value) || {}).label || value,
};

/**
 * The select controls, in bar order. Exported for the order test; screens
 * render <SetFilterBar>, not this.
 */
export function setFilterSelects(state, set) {
  const { type, topic, status, owner, updated, sort } = state;
  return [
    {
      /*
        THE TYPE OPTIONS ARE DERIVED, NOT HAND-WRITTEN: GAME_TYPE_LIST is the
        whole table, so a type added there appears here without an edit. Survey
        is present and annotated rather than dropped (the owner's decision is
        LABEL IT, not hide it — OPEN-QUESTIONS #3).
      */
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
      /*
        THE SHELF. All fifteen are offered whether or not anything sits on
        them, exactly as the type filter offers every type: this control is the
        closed vocabulary, and a person filtering has to be able to read what
        the vocabulary is. What is ACTUALLY on the shelves, with counts, is the
        browse below the bar. Unfiled is last and is a real destination.
      */
      key: 'topic',
      value: topic,
      onChange: (value) => set({ topic: value }),
      ariaLabel: 'Filter by topic',
      options: [
        { value: 'all', label: 'All topics' },
        ...SET_TOPIC_IDS.map((id) => ({ value: id, label: SET_TOPICS[id].label })),
        { value: UNFILED, label: UNFILED_LABEL },
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
      key: 'owner',
      value: owner,
      onChange: (value) => set({ owner: value }),
      ariaLabel: 'Filter by owner',
      options: [
        { value: 'all', label: 'All owners' },
        ...OWNER_OPTIONS,
      ],
    },
    {
      // "Any time" reads as a filter label on this bar, where every other
      // select opens with its own "All …".
      key: 'updated',
      value: updated,
      onChange: (value) => set({ updated: value }),
      ariaLabel: 'Filter by when it was updated',
      options: CONSOLE_UPDATED_WINDOWS.map((w) => (
        w.value === 'any' ? { value: 'any', label: 'Updated any time' } : w
      )),
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
        { value: 'owner', label: 'Owner (yours first)' },
      ],
    },
  ];
}

/**
 * The bar and the shelf browse beneath it.
 *
 * @param sets      the whole list the screen is showing (the browse counts over
 *                  all of it, not the filtered view — see SetShelfBrowse).
 * @param controls  what `useListControls(sets, SET_LIST_CONFIG, …)` returned.
 * @param search    `{ ariaLabel, placeholder, testId, onKeyDown }` overrides
 *                  for the search box; the value and onChange are wired here.
 * @param count     the "41 sets · 3 shown" line, or omitted.
 */
export default function SetFilterBar({ sets = [], controls, search = {}, count }) {
  const { state, set } = controls;
  return (
    <>
      <ListControls
        scope="qsets"
        search={{
          value: state.search,
          onChange: (value) => set({ search: value }),
          /*
            IT NAMES THE TAGS BECAUSE IT READS THE TAGS. A control's label is
            the only documentation anybody reads.
          */
          ariaLabel: 'Search name, description, tags',
          placeholder: 'Search name, description, tags',
          ...search,
        }}
        selects={setFilterSelects(state, set)}
        count={count}
      />
      {/*
        WHAT IS ACTUALLY ON THE SHELVES, and the words these sets carry — which
        a select cannot do because a tag vocabulary is open. Closed by default,
        and rendered by the screen OUTSIDE its shown/empty branch: on the screen
        that says nothing matches, the one control showing what does exist is
        an exit.
      */}
      <SetShelfBrowse
        sets={sets}
        topic={state.topic}
        tag={state.tag}
        onPickTopic={(value) => set({ topic: value })}
        onPickTag={(value) => set({ tag: value })}
      />
    </>
  );
}
