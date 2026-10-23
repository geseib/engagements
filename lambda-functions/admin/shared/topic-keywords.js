/**
 * WHICH TOPIC A SET LOOKS LIKE, BY ITS WORDS — no model, no network, no cost.
 *
 * The owner, 23 Oct 2026: *"when ai generates question sets. it should auto
 * tag (based on a list of categories) right now the user gets an error
 * activating sets because they dont have a tag"*. The "tag" there is the set's
 * TOPIC — one id from shared/set-topics.js — and switching a set on is refused
 * without one (toggle-question-set.js, check-question-set.js).
 *
 * Every AI run now proposes a topic. The model is asked first, in the call the
 * run already makes (shared/draft-topic.js). THIS is what answers when it does
 * not: an omitted field, a garbled id, a pass that failed. It is also what the
 * set list uses, client-side, to pre-select a topic for an unfiled set being
 * switched on (src/src/config/topicKeywords.js is the ESM mirror).
 *
 * ── HOW IT DECIDES ────────────────────────────────────────────────────────
 *
 * A keyword list per topic, matched against the title (weight 3), the
 * description (weight 2) and each question's own words (weight 1 each). A
 * keyword counts once per field, so one word repeated forty times in one
 * question does not outvote a title. Highest score wins; a tie goes to the
 * topic that comes first in `TIE_ORDER`, which is the shelf's own order, so the
 * answer is the same on every run and on both sides of the wire.
 *
 * NOTHING SCORES → General Knowledge. It is the one honest answer for a set the
 * words do not place, and a person can change it in one click; a sixteenth id,
 * or Unfiled, would put the set straight back where the owner's error came from.
 *
 * ── NOT `shared/topic-suggestion.js` ──────────────────────────────────────
 *
 * That one is a model call made by the content check, recorded beside a
 * review, and never applied. This one is pure, synchronous, and its answer is
 * PRE-FILLED for a person to accept or change. Different jobs, so a different
 * name: `classifySetTopic`, not a second `suggestSetTopic`.
 *
 * TOPIC IS NOT CATEGORY. A question's `category` is the in-set grouping; its
 * TEXT is read here only as more words about what the set is about.
 *
 * DUPLICATED ON PURPOSE in src/src/config/topicKeywords.js, for the reason
 * set-topics.js gives. src/src/__tests__/topicKeywordsParity.test.js holds the
 * two tables equal and the two classifiers to the same answers.
 */
const { SET_TOPIC_IDS, normalizeSetTopic, normalizeSetTags } = require('./set-topics');
const { normalizeTag } = require('./tags');

/** What answers when no keyword matched at all. */
const FALLBACK_TOPIC = 'general-knowledge';

/** Ties go to the earlier one. The shelf's order, minus the catch-all. */
const TIE_ORDER = SET_TOPIC_IDS.filter((id) => id !== FALLBACK_TOPIC);

/** How many tags a run proposes. */
const MAX_SUGGESTED_SET_TAGS = 5;

const WEIGHTS = { title: 3, description: 2, question: 1 };

/*
  Lower-case words or short phrases. A single word also matches its plain
  plural (s / es). Kept to words that point ONE way: "court" is law and
  basketball, "record" is music and sport, so neither is here.
*/
const TOPIC_KEYWORDS = {
  'arts-culture': [
    'art', 'artist', 'painting', 'painter', 'sculpture', 'museum', 'gallery', 'theatre', 'theater',
    'ballet', 'opera', 'design', 'architecture', 'photography', 'renaissance', 'impressionism',
    'culture', 'cultural', 'dance', 'fashion', 'craft', 'heritage', 'festival', 'mythology',
  ],
  'business-work': [
    'business', 'company', 'companies', 'startup', 'market', 'marketing', 'sales', 'finance',
    'investment', 'economy', 'economics', 'career', 'workplace', 'office', 'manager', 'management',
    'leadership', 'team', 'teamwork', 'meeting', 'customer', 'strategy', 'onboarding', 'hiring',
    'employee', 'retrospective', 'retro', 'project', 'stakeholder', 'brand', 'entrepreneur',
    'remote work', 'feedback', 'okr', 'kpi', 'revenue', 'profit',
  ],
  'everyday-life': [
    'home', 'household', 'habit', 'routine', 'chores', 'cleaning', 'parenting', 'family',
    'budget', 'shopping', 'commute', 'weekend', 'holiday', 'hobby', 'gardening', 'pets',
    'etiquette', 'lifestyle', 'everyday', 'daily life', 'diy', 'relationships', 'friendship',
  ],
  'film-tv': [
    'film', 'movie', 'cinema', 'hollywood', 'actor', 'actress', 'director', 'oscar', 'oscars',
    'television', 'tv', 'sitcom', 'series', 'netflix', 'episode', 'screenplay', 'box office',
    'blockbuster', 'documentary', 'disney', 'pixar', 'star wars', 'marvel', 'soap opera',
  ],
  'food-drink': [
    'food', 'cooking', 'cook', 'recipe', 'cuisine', 'chef', 'restaurant', 'kitchen', 'baking',
    'bread', 'cheese', 'wine', 'beer', 'coffee', 'tea', 'cocktail', 'spice', 'dessert', 'fruit',
    'vegetable', 'meal', 'dish', 'ingredient', 'chocolate', 'pasta', 'pizza', 'sushi', 'drink',
  ],
  'geography-travel': [
    'geography', 'country', 'countries', 'capital', 'city', 'cities', 'continent', 'map',
    'border', 'river', 'mountain', 'island', 'ocean', 'travel', 'tourism', 'tourist', 'journey',
    'flag', 'landmark', 'population', 'europe', 'asia', 'africa', 'australia', 'america',
    'latitude', 'longitude', 'desert', 'lake',
  ],
  'health-medicine': [
    'health', 'medicine', 'medical', 'doctor', 'nurse', 'hospital', 'disease', 'illness',
    'vaccine', 'virus', 'anatomy', 'heart', 'brain', 'fitness', 'exercise', 'nutrition',
    'diet', 'wellbeing', 'wellness', 'mental health', 'sleep', 'stress', 'patient', 'surgery',
    'symptom', 'pharmacy', 'therapy', 'burnout',
  ],
  history: [
    'history', 'historical', 'ancient', 'medieval', 'century', 'empire', 'emperor', 'king',
    'queen', 'dynasty', 'war', 'world war', 'revolution', 'civil war', 'battle', 'pharaoh',
    'roman', 'romans', 'egypt', 'viking', 'colonial', 'independence', 'cold war', 'treaty',
    'president', 'presidents', 'archaeology', 'tudor', 'victorian',
  ],
  'language-literature': [
    'book', 'novel', 'author', 'poet', 'poetry', 'poem', 'literature', 'literary', 'shakespeare',
    'writer', 'writing', 'grammar', 'vocabulary', 'language', 'spelling', 'etymology',
    'dictionary', 'fiction', 'library', 'playwright', 'idiom', 'translation',
  ],
  music: [
    'music', 'musical', 'song', 'singer', 'band', 'album', 'guitar', 'piano', 'drum', 'orchestra',
    'symphony', 'composer', 'jazz', 'rock', 'pop', 'hip hop', 'rap', 'concert', 'lyrics',
    'melody', 'beatles', 'genre', 'instrument', 'chart', 'classical music',
  ],
  'nature-environment': [
    'nature', 'animal', 'animals', 'wildlife', 'bird', 'birds', 'fish', 'insect', 'plant',
    'tree', 'forest', 'flower', 'ecosystem', 'environment', 'environmental', 'climate',
    'climate change', 'weather', 'sustainability', 'recycling', 'pollution', 'ecology',
    'species', 'mammal', 'reptile', 'conservation', 'biodiversity', 'volcano', 'earthquake',
  ],
  'politics-society': [
    'politics', 'political', 'government', 'election', 'vote', 'voting', 'parliament',
    'congress', 'senate', 'democracy', 'law', 'laws', 'constitution', 'policy', 'rights',
    'human rights', 'religion', 'religious', 'society', 'social', 'ethics', 'justice',
    'protest', 'citizen', 'diversity', 'inclusion', 'equality', 'united nations',
  ],
  'science-technology': [
    'science', 'scientific', 'physics', 'chemistry', 'biology', 'astronomy', 'space', 'planet',
    'planets', 'galaxy', 'atom', 'molecule', 'element', 'periodic table', 'experiment',
    'technology', 'tech', 'computer', 'computing', 'software', 'programming', 'code', 'coding',
    'internet', 'ai', 'artificial intelligence', 'machine learning', 'robot', 'engineering',
    'invention', 'cloud', 'cybersecurity', 'math', 'maths', 'mathematics', 'algorithm',
  ],
  'sport-games': [
    'sport', 'sports', 'football', 'soccer', 'basketball', 'baseball', 'cricket', 'rugby',
    'tennis', 'golf', 'hockey', 'olympics', 'olympic', 'athlete', 'world cup', 'tournament',
    'league', 'championship', 'chess', 'board game', 'video game', 'gaming', 'puzzle',
    'cycling', 'marathon', 'swimming', 'boxing', 'formula 1', 'nba', 'nfl',
  ],
};

/**
 * The words of a string, lower case, letters and digits only.
 *
 * "AI-generated" is dropped first: the builders write it into every generated
 * set's description, and left in it would file every one of them under
 * Science & Technology on the strength of a word about how it was written.
 */
function wordsOf(text) {
  return String(text || '').toLowerCase()
    .replace(/\bai[\s-]*(generated|written|drafted)\b/g, ' ')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does a field (its word list and its space-joined form) carry this keyword? */
function carries(words, joined, keyword) {
  if (keyword.includes(' ')) return joined.includes(` ${keyword} `);
  return words.some((w) => w === keyword || w === `${keyword}s` || w === `${keyword}es`);
}

/** The words a question carries, whatever kind of item it is. */
function questionText(q) {
  if (q == null) return '';
  if (typeof q === 'string') return q;
  if (typeof q !== 'object') return '';
  return [
    q.title, q.Title, q.questionDetail, q.detail, q.Detail, q.category, q.Category,
    ...(Array.isArray(q.options) ? q.options : []),
    // The question's own tags are words about it too ("remote-work" reads as
    // "remote work").
    ...(Array.isArray(q.tags) ? q.tags : [q.tags, q.Tags]),
  ].filter((v) => typeof v === 'string').join(' ');
}

/**
 * Every topic's score for this set, and which keywords earned it.
 *
 * @param {{title?: string, description?: string, questions?: Array<object|string>}} set
 * @returns {{scores: Object<string, number>, matched: Object<string, string[]>}}
 */
function scoreSetTopics({ title = '', description = '', questions = [] } = {}) {
  const fields = [
    { text: title, weight: WEIGHTS.title },
    { text: description, weight: WEIGHTS.description },
    ...(Array.isArray(questions) ? questions : []).map((q) => ({ text: questionText(q), weight: WEIGHTS.question })),
  ].map((f) => {
    const words = wordsOf(f.text);
    return { words, joined: ` ${words.join(' ')} `, weight: f.weight };
  }).filter((f) => f.words.length);
  const scores = {};
  const matched = {};
  for (const id of TIE_ORDER) {
    scores[id] = 0;
    matched[id] = [];
    for (const keyword of TOPIC_KEYWORDS[id] || []) {
      let hit = false;
      for (const f of fields) {
        if (carries(f.words, f.joined, keyword)) { scores[id] += f.weight; hit = true; }
      }
      if (hit) matched[id].push(keyword);
    }
  }
  return { scores, matched };
}

/**
 * THE ONE TOPIC this set's words point to. Always an id on the shelf.
 *
 * @param {{title?: string, description?: string, questions?: Array<object|string>}} set
 * @returns {string}
 */
function classifySetTopic(set = {}) {
  const { scores } = scoreSetTopics(set || {});
  let best = FALLBACK_TOPIC;
  let bestScore = 0;
  for (const id of TIE_ORDER) {
    if (scores[id] > bestScore) { best = id; bestScore = scores[id]; }
  }
  return best;
}

/**
 * Up to five of the set's own words, for when the model offered none: the tags
 * its questions already carry, most frequent first, then the keywords that
 * placed it. Never the topic itself — a tag that restates the shelf filters
 * nothing.
 */
function suggestSetTags({ title = '', description = '', questions = [] } = {}, topic = '') {
  const counts = new Map();
  for (const q of Array.isArray(questions) ? questions : []) {
    const raw = q && typeof q === 'object' ? (q.tags ?? q.Tags) : null;
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[;,|]/) : []);
    for (const t of new Set(list.map((x) => normalizeTag(x)).filter(Boolean))) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const fromItems = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
  const shelf = normalizeSetTopic(topic) || '';
  const { matched } = scoreSetTopics({ title, description, questions });
  const fromWords = (shelf && matched[shelf]) || [];
  const out = normalizeSetTags([...fromItems, ...fromWords].filter((t) => normalizeTag(t) !== shelf));
  return out.slice(0, MAX_SUGGESTED_SET_TAGS);
}

module.exports = {
  TOPIC_KEYWORDS,
  TIE_ORDER,
  FALLBACK_TOPIC,
  MAX_SUGGESTED_SET_TAGS,
  scoreSetTopics,
  classifySetTopic,
  suggestSetTags,
};
