import React, { useState } from 'react';
import {
  SET_TOPICS,
  SET_TOPIC_IDS,
  UNFILED,
  UNFILED_LABEL,
  MAX_SET_TAGS,
  normalizeSetTopic,
  resolveSetTopic,
  setTopicLabel,
} from '../config/setTopics';
import { normalizeTag } from '../utils/tags';

/**
 * WHICH SHELF THIS SET SITS ON — one control, used everywhere a set is filed.
 *
 * The owner, asking for the whole feature: *"i think we need topic tags for
 * question sets and req at least 1 pretty broad for public ones … think how a
 * book store might classify sections."* A book sits on ONE shelf, and the shelf
 * is what the filter and the browse are built on; the author's own words sit
 * beside it for the specifics fifteen shelves will never carry.
 *
 * ── WHY A `<select>` AND NOT `CategoryPicker`'s COMBOBOX ───────────────────
 *
 * I read CategoryPicker first, as the brief asked. It does not fit, for three
 * reasons that are all the same reason:
 *
 *   - Its options are DERIVED from the working copy's rows. There are no rows
 *     here; the list is fixed, closed and identical on every set in the product.
 *   - Its headline affordance is `+ New category`, created inline. A sixteenth
 *     shelf is exactly what must not exist — it would be a shelf no filter and
 *     no browse has heard of.
 *   - It carries the 24-bit host-mask cap and its reindex warning, none of
 *     which has any meaning for a set-level field.
 *
 * What is left after removing those is a native `<select>`, which is what the
 * field beside this one (Engagement Type) already is. Fifteen options is not a
 * scroll, every option is visible to a screen reader for free, and the closed
 * list is enforced by the control rather than by a validator behind it.
 *
 * ── UNFILED IS A STATE, NOT AN ERROR ───────────────────────────────────────
 *
 * Around forty sets predate this field. They list, play and rename exactly as
 * they did. Here they read as Unfiled and say, once, what to do about it — a
 * native select shows its FIRST option when no option matches its value, so
 * without the placeholder below an unfiled set would quietly read as "Arts &
 * Culture", a shelf nobody chose, stated as fact. The placeholder is
 * `disabled`, so Unfiled is somewhere you can BE and not somewhere you can go.
 *
 * ── THE PROPOSAL IS A HELPER AND NEVER A GATE ──────────────────────────────
 *
 * The content check records the shelf it would have filed the set on
 * (`shared/topic-suggestion.js`). This offers it as one click and nothing more.
 * Where the check judged the chosen shelf to contradict the content it says so
 * ONCE, in one sentence, with no button to answer and nothing disabled — the
 * set is the author's and the library does not rearrange itself behind them.
 * The sentence goes quiet the moment the shelf it argued with is no longer the
 * one chosen (`filedAs` is what the set carried when it was checked).
 *
 * That sentence REPLACES the one-click offer rather than sitting under it. A
 * contradiction is by construction a proposal the set is not already on, so
 * both conditions are true together, and drawing both named the same shelf
 * twice six lines apart — once as a convenience, once as an argument.
 *
 * ── TWO WORDS THIS PRODUCT ALREADY OWNS ────────────────────────────────────
 *
 * CATEGORY is the IN-SET grouping (c001…c005, the host's 24-bit mask). Nothing
 * here is a category. TAGS also exist per QUESTION (`utils/questionRows.js`);
 * the list here is the SET's and the two never meet.
 *
 * It owns no colour: this editor is mounted on the paper console AND inside the
 * host's dusk dialog, and a colour measured against one of those is how a 2.6:1
 * chip shipped twice (setEditorChipsPalette.test.js). Inheriting the surface's
 * own ink cannot fail in either theme.
 */
export default function SetTopicField({
  /** The stored value: a shelf id, or '' for a set that was never filed. */
  topic = UNFILED,
  /** Called with a shelf id. Never called with ''— the list has no blank in it. */
  onTopicChange,
  /** The set's own tags, canonical. */
  tags = [],
  /** Called with the whole next list, so the caller stays the only owner. */
  onTagsChange,
  /**
   * `{ topic, tags, filedAs, mismatch }` from the newest check, or null.
   * `filedAs` is the shelf the SET carried when it was checked, which is how a
   * stale sentence tells itself apart from a live one.
   */
  suggestion = null,
  /** Prefixes every id, so two of these can share a screen. */
  idPrefix = 'set-topic',
  /** A word for what is being filed, for the copy. */
  noun = 'set',
}) {
  // The box holds RAW text while it is being typed. Normalising on every
  // keystroke eats the hyphen out of "remote-" the instant it is typed — the
  // editing note at the foot of utils/tags.js, which exists because it happened.
  const [draft, setDraft] = useState('');
  const [tagRefusal, setTagRefusal] = useState('');

  const chosen = resolveSetTopic(topic);
  const list = Array.isArray(tags) ? tags : [];
  const topicId = `${idPrefix}-topic`;
  const tagsId = `${idPrefix}-tags`;

  /* ------------------------------------------------------------ the shelf */

  const choose = (value) => {
    const id = normalizeSetTopic(value);
    if (id && onTopicChange) onTopicChange(id);
  };

  const proposed = suggestion ? normalizeSetTopic(suggestion.topic) : null;
  // Two things have to be true for the contradiction to still be worth saying:
  // the check flagged one, and the set is still on the shelf it flagged.
  const contradicts = !!(suggestion && suggestion.mismatch && proposed
    && resolveSetTopic(suggestion.filedAs) === chosen && chosen !== UNFILED);
  // Nothing to accept when the set is already there — a button that changes
  // nothing is the control people press twice wondering why. And nothing to
  // offer quietly when the sentence below is about to name the same shelf:
  // `contradicts` implies this condition, so the two are written as one
  // decision here rather than left to paint over each other in the markup.
  const offerShelf = proposed && proposed !== chosen && !contradicts ? proposed : null;

  /* ------------------------------------------------------------- the tags */

  const commitTag = (raw) => {
    const tag = normalizeTag(raw);
    setDraft('');
    if (!tag) return;
    if (list.includes(tag)) {
      // Not a refusal worth a sentence: the tag they wanted is already on the
      // row, in front of them, which is the whole answer.
      return;
    }
    if (list.length >= MAX_SET_TAGS) {
      // Said, not swallowed. `normalizeSetTags` would silently slice the
      // thirteenth off and the person would watch a word they typed vanish.
      setTagRefusal(`${MAX_SET_TAGS} tags is the ceiling for one ${noun}. `
        + 'Remove one you no longer want before adding another.');
      return;
    }
    setTagRefusal('');
    if (onTagsChange) onTagsChange([...list, tag]);
  };

  const removeTag = (tag) => {
    setTagRefusal('');
    if (onTagsChange) onTagsChange(list.filter((t) => t !== tag));
  };

  const suggestedTags = (suggestion && Array.isArray(suggestion.tags) ? suggestion.tags : [])
    .map((t) => normalizeTag(t))
    .filter((t) => t && !list.includes(t));

  /* ---------------------------------------------------------------- render */

  return (
    <div className="qs-topic">
      <div className="form-group">
        <label htmlFor={topicId}>Topic *</label>
        <select
          id={topicId}
          className="form-select"
          value={chosen}
          onChange={(e) => choose(e.target.value)}
        >
          {chosen === UNFILED && (
            <option value="" disabled>{UNFILED_LABEL} — choose a shelf</option>
          )}
          {SET_TOPIC_IDS.map((id) => (
            <option key={id} value={id}>{SET_TOPICS[id].label}</option>
          ))}
        </select>

        {chosen === UNFILED ? (
          <p className="help-text" data-testid={`${idPrefix}-unfiled`}>
            <strong>{UNFILED_LABEL}.</strong> This {noun} is on no shelf, so nobody browsing
            or filtering by topic will find it. Choose the one shelf it belongs on — it is
            the only thing the library filter is built on, and it is not the in-{noun}
            category the questions are grouped by.
          </p>
        ) : (
          <p className="help-text">{SET_TOPICS[chosen].blurb}</p>
        )}

        {offerShelf && (
          <p className="qs-topic-offer" data-testid={`${idPrefix}-suggestion`}>
            Reading this {noun}&rsquo;s own questions, the content check would file it under{' '}
            <strong>{setTopicLabel(offerShelf)}</strong>.{' '}
            <button
              type="button"
              className="btn-secondary btn-small"
              onClick={() => choose(offerShelf)}
            >
              File it under {setTopicLabel(offerShelf)}
            </button>
          </p>
        )}

        {contradicts && (
          <p className="qs-topic-mismatch" data-testid={`${idPrefix}-mismatch`} role="status">
            You have filed this {noun} under <strong>{setTopicLabel(chosen)}</strong>, and the
            content check read its questions as <strong>{setTopicLabel(proposed)}</strong>.
            It may well be right about a {noun} that spans both — this changes nothing and
            stops nothing, it is said once so the choice is a deliberate one.
          </p>
        )}
      </div>

      <div className="form-group">
        {/* NAMED FOR WHAT IT BELONGS TO. A bare "Tags" is the label the QUESTION
            editor two panels down already uses, and the two lists never meet —
            so where both can be on one screen, this one says which it is. */}
        <label htmlFor={tagsId}>Tags for this {noun}</label>

        <ul className="qs-topic-tags" data-testid={`${idPrefix}-tag-list`}>
          {list.map((tag) => (
            <li key={tag} className="qs-topic-tag">
              {tag}
              <button
                type="button"
                className="qs-topic-tagx"
                aria-label={`Remove ${tag}`}
                onClick={() => removeTag(tag)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="qs-topic-tagadd">
          <input
            id={tagsId}
            type="text"
            className="form-input"
            value={draft}
            placeholder="e.g. 1980s, onboarding"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the word and nothing else: this control lives inside
              // forms whose own submit would otherwise fire on the same key.
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTag(draft);
              }
            }}
            onBlur={() => commitTag(draft)}
          />
          <button type="button" className="btn-secondary btn-small" onClick={() => commitTag(draft)}>
            Add tag
          </button>
        </div>

        {tagRefusal
          ? <p className="help-text" data-testid={`${idPrefix}-tag-refusal`} role="alert">{tagRefusal}</p>
          : (
            <p className="help-text">
              Your own words, for the specifics a shelf of fifteen will never carry. Up to{' '}
              {MAX_SET_TAGS}, lower-cased and hyphenated as they are stored. These belong to
              the {noun}; a question&rsquo;s own tags are a separate list.
            </p>
          )}

        {suggestedTags.length > 0 && (
          <p className="qs-topic-offer" data-testid={`${idPrefix}-suggested-tags`}>
            The check also read these out of the questions:{' '}
            {suggestedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="qs-topic-tagadd-one"
                aria-label={`Add tag ${tag}`}
                onClick={() => commitTag(tag)}
              >
                + {tag}
              </button>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
