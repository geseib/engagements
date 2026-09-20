/**
 * THE SHELF A SET SITS ON — the frontend half of the vocabulary.
 *
 * Pure module, no rendering. `tests/set-topics.js` on the backend side owns the
 * data itself (and fails the build if these two copies drift); this file owns
 * the BEHAVIOUR the screens will stand on — which spellings resolve, what an
 * unfiled set reads as, and what a form is told to say when it refuses.
 *
 * ── THE TWO WORDS THIS APP ALREADY OVERLOADS ───────────────────────────────
 *
 * CATEGORY is taken: in this app it means the IN-SET grouping (c001…c005,
 * `categoryCount`, `CategoryPicker`, the host's 24-bit mask). A shelf is not a
 * category.
 *
 * TAGS is half taken: `tags` on a QUESTION row are that question's keywords.
 * The list here is the SET's. Nothing may carry one to the other.
 *
 * ── UNFILED IS A STATE ─────────────────────────────────────────────────────
 *
 * Around forty sets predate this field. A screen that threw, hid them, or
 * showed a blank chip where a shelf goes would be the reading of "required"
 * that breaks forty working sets, so `resolveSetTopic` answers UNFILED for
 * anything it does not recognise and `setTopicLabel` gives it a name.
 */
import {
  SET_TOPICS,
  SET_TOPIC_IDS,
  UNFILED,
  UNFILED_LABEL,
  MAX_SET_TAGS,
  normalizeSetTopic,
  resolveSetTopic,
  setTopicLabel,
  setTopicChoices,
  setTopicRefusal,
  normalizeSetTags,
} from '../config/setTopics';

describe('the shelf is closed', () => {
  test('fifteen shelves, in picker order, with the catch-all last', () => {
    // rejects: a shelf appearing or vanishing without a decision. A filter
    // built on a moving list is a filter nobody can learn.
    expect(SET_TOPIC_IDS).toHaveLength(15);
    expect(SET_TOPIC_IDS[SET_TOPIC_IDS.length - 1]).toBe('general-knowledge');
    expect(SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label)).toEqual([
      'Arts & Culture', 'Business & Work', 'Everyday Life', 'Film & TV',
      'Food & Drink', 'Geography & Travel', 'Health & Medicine', 'History',
      'Language & Literature', 'Music', 'Nature & Environment',
      'Politics & Society', 'Science & Technology', 'Sport & Games',
      'General Knowledge',
    ]);
  });

  test('every shelf carries a line a picker can show', () => {
    // rejects: a shelf shipping as a bare label. Somebody choosing between
    // "Everyday Life" and "General Knowledge" needs to be told the difference,
    // and the catch-all needs it most.
    for (const id of SET_TOPIC_IDS) {
      expect(SET_TOPICS[id].blurb.length).toBeGreaterThan(20);
    }
  });

  test('an id is a well-formed tag, so a browse can compare the two', () => {
    // rejects: ids drifting into a second shape ('Film & TV', 'film_tv') that
    // a tag comparison would then have to special-case.
    for (const id of SET_TOPIC_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(SET_TOPICS[id].id).toBe(id);
    }
  });
});

describe('what counts as a topic', () => {
  test('a label and an id name the same shelf', () => {
    expect(normalizeSetTopic('Science & Technology')).toBe('science-technology');
    expect(normalizeSetTopic('science-technology')).toBe('science-technology');
    expect(normalizeSetTopic('  HISTORY ')).toBe('history');
  });

  test('anything off the shelf is not a topic', () => {
    // rejects: normalizeSetTopic becoming a pass-through, which would turn a
    // typo into a sixteenth shelf no filter knows about.
    expect(normalizeSetTopic('astrology')).toBeNull();
    expect(normalizeSetTopic('Science and Technology')).toBeNull();
    expect(normalizeSetTopic('')).toBeNull();
    expect(normalizeSetTopic(undefined)).toBeNull();
  });

  test('exactly one shelf — a list is not a topic', () => {
    // rejects: a set claiming two shelves. `String(['history'])` is 'history',
    // so without a type guard an array of one would be accepted.
    expect(normalizeSetTopic(['history'])).toBeNull();
    expect(normalizeSetTopic(['history', 'music'])).toBeNull();
  });
});

describe('unfiled', () => {
  test('a screen resolves anything it does not recognise, rather than breaking', () => {
    // rejects: a list throwing, or hiding a row, over one of the ~40 sets that
    // predate the shelf.
    expect(resolveSetTopic('history')).toBe('history');
    expect(resolveSetTopic(undefined)).toBe(UNFILED);
    expect(resolveSetTopic('astrology')).toBe(UNFILED);
    expect(UNFILED).toBe('');
  });

  test('an unfiled set still has something to show where a shelf goes', () => {
    expect(setTopicLabel(undefined)).toBe(UNFILED_LABEL);
    expect(setTopicLabel('')).toBe('Unfiled');
    expect(setTopicLabel('history')).toBe('History');
  });
});

describe('what a form says when it refuses', () => {
  test('both refusals name the whole shelf', () => {
    // rejects: a refusal that withholds the answer and sends the person back
    // to guess again.
    const missing = setTopicRefusal('');
    const unknown = setTopicRefusal('astrology');
    for (const message of [missing, unknown]) {
      expect(message).toContain('Science & Technology');
      expect(message).toContain('General Knowledge');
    }
    expect(unknown).toContain('astrology');
  });

  test('a real shelf is not refused', () => {
    expect(setTopicRefusal('History')).toBeNull();
    expect(setTopicChoices()).toContain('Arts & Culture');
  });
});

describe("a set's own tags", () => {
  test('trimmed, folded and de-duplicated', () => {
    // rejects: a second tag vocabulary. There is one in this app already
    // (utils/tags.js), and it folds on write precisely so a filter on "star"
    // matches a stored "STAR".
    expect(normalizeSetTags(['  1980s ', 'Onboarding', 'ONBOARDING'])).toEqual(['1980s', 'onboarding']);
    expect(normalizeSetTags('remote work, Remote Work')).toEqual(['remote-work']);
    expect(normalizeSetTags(['  ', '---'])).toEqual([]);
    expect(normalizeSetTags(undefined)).toEqual([]);
  });

  test('capped, so one paste cannot become a hundred chips', () => {
    const many = Array.from({ length: MAX_SET_TAGS + 5 }, (_, i) => `tag-${i}`);
    expect(normalizeSetTags(many)).toHaveLength(MAX_SET_TAGS);
  });
});
