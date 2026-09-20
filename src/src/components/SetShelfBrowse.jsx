import React, { useId, useMemo, useState } from 'react';
import Icon from './Icon';
import { ALL } from '../config/listControls';
import { topicIndex, tagIndex, filterTagIndex } from '../config/setShelfIndex';

/**
 * THE INDEX AT THE FRONT OF THE LIBRARY — what is actually on the shelves, and
 * which words the sets carry.
 *
 * The owner asked for two things that look like one: "an easy filter on that",
 * and "ability to see/search all tags". The first is the Topic select on the
 * bar above — a closed vocabulary of fifteen, always all fifteen, because a
 * person filtering has to be able to read what the vocabulary is. The second a
 * select cannot do at all: a tag vocabulary is OPEN, nobody knows what is in
 * it until they look, and the only way to search a word you have not seen is
 * to be shown the words.
 *
 * CLOSED BY DEFAULT. Browsing is the minority errand on this screen — most
 * visits are somebody looking for one set they can already name — and a
 * permanently-open index would push the table down for all of them. The
 * summary beside the toggle ("12 topics · 41 tags") says what is inside
 * without opening it, so the disclosure is not a guess.
 *
 * COUNTED OVER THE WHOLE LIST, NOT THE FILTERED VIEW, and the body says so in
 * one line. A tag that disappears from the index because an unrelated type
 * filter is set is not "all tags". The consequence is honest and handled: a
 * click can land on "nothing matches", which is a state this screen already
 * does properly — different words from "nothing exists", and a one-click exit
 * per active filter (`computeDrops`). So the index stays an index, and the
 * table stays responsible for the table.
 *
 * SCOPE. Every class is `.qsets-browse*`, declared in QuestionSetsPanel.css:
 * this renders inside `.qsets` and is styled by that screen's own stylesheet,
 * which is also what keeps it re-tinted for free under `.qsets--onlight`.
 *
 * NOT A CATEGORY, AND NOT A QUESTION'S TAGS. "Category" in this product is the
 * in-set grouping (c001…c005, the host's 24-bit mask); the tags here belong to
 * the SET, not to a question row. `config/setTopics.js` carries the whole of
 * that warning.
 */
export default function SetShelfBrowse({
  /** The whole library this list is showing — the org's sets, or the public ones. */
  sets = [],
  /** The topic axis's current value, so the shelf in force reads as pressed. */
  topic = ALL,
  /** The search box's current text, for the same reason on the tag side. */
  search = '',
  /** Called with a shelf id, or ALL to let go of the one in force. */
  onPickTopic,
  /** Called with a tag, or '' to let go of it. A tag goes into the SEARCH
   *  rather than an axis of its own: it is then visible in the box, clearable
   *  there, and carries the same drop-exit as any other search. */
  onPickTag,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [find, setFind] = useState('');
  const headId = useId();

  const topics = useMemo(() => topicIndex(sets), [sets]);
  const tags = useMemo(() => tagIndex(sets), [sets]);
  const shownTags = useMemo(() => filterTagIndex(tags, find), [tags, find]);

  // An index of nothing is nothing. The panel already draws its own "no
  // question sets yet" state, with the three ways in.
  if (!sets.length) return null;

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const pill = (key, label, count, active, pick) => (
    <button
      key={key}
      type="button"
      className={`qsets-browse-pill${active ? ' qsets-browse-pill--on' : ''}`}
      aria-pressed={active}
      // The visible text is "History2"; the NAME is "History — 2 sets". A
      // count glued to a label reads as a number to a screen reader and as a
      // year to anybody scanning, and the spacing between them is the
      // stylesheet's job, not a space in the markup.
      aria-label={`${label} — ${plural(count, 'set')}`}
      title={`${label} — ${plural(count, 'set')}`}
      onClick={pick}
    >
      {label}
      <em className="qsets-browse-n">{count}</em>
    </button>
  );

  return (
    <div className="qsets-browse">
      <button
        type="button"
        className="qsets-browse-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Icon name={isOpen ? 'CaretDown' : 'CaretRight'} weight="bold" size={12} color="currentColor" />
        Browse topics and tags
      </button>
      <span className="qsets-browse-sum">
        {plural(topics.length, 'topic')} · {plural(tags.length, 'tag')}
      </span>

      {isOpen && (
        <div className="qsets-browse-body">
          <p className="qsets-browse-lede">
            Every count is out of all {plural(sets.length, 'set')} here, whatever the filters
            above are set to.
          </p>

          <h4 className="qsets-browse-h" id={`${headId}-topics`}>Topics</h4>
          <div className="qsets-browse-pills" role="group" aria-labelledby={`${headId}-topics`}>
            {topics.map((entry) =>
              pill(
                entry.id || 'unfiled',
                entry.label,
                entry.count,
                topic === entry.id,
                () => onPickTopic && onPickTopic(topic === entry.id ? ALL : entry.id)
              ))}
          </div>

          <h4 className="qsets-browse-h" id={`${headId}-tags`}>Tags</h4>
          {tags.length > 0 && (
            <div className="qsets-browse-find">
              <Icon name="MagnifyingGlass" weight="bold" size={13} color="var(--muted)" />
              <input
                type="search"
                className="qsets-input qsets-browse-input"
                aria-label="Find a tag"
                placeholder="Find a tag"
                value={find}
                onChange={(event) => setFind(event.target.value)}
              />
            </div>
          )}

          {tags.length === 0 ? (
            /* NOTHING EXISTS. Not the same sentence as "nothing matches", and
               it says where tags come from, because the exit is to go and add
               one rather than to clear a box. */
            <p className="qsets-browse-none" data-testid="shelf-browse-no-tags">
              Nobody has tagged a set here yet. Tags are the author’s own words for the
              specifics a shelf of fifteen will never carry — “1980s”, “onboarding” — and they
              are set in the editor, beside the topic.
            </p>
          ) : shownTags.length === 0 ? (
            /* NOTHING MATCHES, with the way back, exactly as the table's own
               drop-exits work: an empty screen with no exit is the defect. */
            <p className="qsets-browse-none" data-testid="shelf-browse-no-match">
              No tag matches “{find.trim()}”. These sets carry {plural(tags.length, 'tag')}{' '}
              between them.{' '}
              <button type="button" className="qsets-browse-clear" onClick={() => setFind('')}>
                Show all {tags.length}
              </button>
            </p>
          ) : (
            <div className="qsets-browse-pills" role="group" aria-labelledby={`${headId}-tags`}>
              {shownTags.map((entry) =>
                pill(
                  entry.tag,
                  entry.tag,
                  entry.count,
                  search === entry.tag,
                  () => onPickTag && onPickTag(search === entry.tag ? '' : entry.tag)
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
