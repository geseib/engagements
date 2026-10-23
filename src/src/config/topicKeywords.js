/**
 * WHICH TOPIC A SET LOOKS LIKE, BY ITS WORDS — ESM MIRROR of
 * `lambda-functions/admin/shared/topic-keywords.js`.
 *
 * Used where the set list switches on an UNFILED set: instead of the server's
 * refusal ("Give this set a topic…"), the row asks for the topic in place,
 * pre-selected with what this reads out of the set's title and description
 * (QuestionSetsPanel.jsx). The server's refusal stays as the guard.
 *
 * DUPLICATED ON PURPOSE, for the reason config/setTopics.js gives: a Lambda
 * cannot import this ESM file. `__tests__/topicKeywordsParity.test.js` holds the
 * two keyword tables equal and the two classifiers to the same answers on
 * fixtures, so a change to one side that is not made to the other fails CI.
 *
 * A SUGGESTION, NEVER A DECISION: whatever this picks is shown pre-selected
 * and the person may change it before anything is saved. Nothing scores →
 * General Knowledge, never Unfiled and never an id off the shelf.
 *
 * TOPIC IS NOT CATEGORY: a category is the in-set grouping. Not called one here.
 */
import { SET_TOPIC_IDS } from './setTopics';

/** What answers when no keyword matched at all. */
export const FALLBACK_TOPIC = 'general-knowledge';

/** Ties go to the earlier one. The shelf's order, minus the catch-all. */
export const TIE_ORDER = SET_TOPIC_IDS.filter((id) => id !== FALLBACK_TOPIC);

const WEIGHTS = { title: 3, description: 2, question: 1 };

/*
  Lower-case words or short phrases. A single word also matches its plain
  plural (s / es). Byte-for-byte the backend's table.
*/
export const TOPIC_KEYWORDS = {
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
export function scoreSetTopics({ title = '', description = '', questions = [] } = {}) {
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
export function classifySetTopic(set = {}) {
  const { scores } = scoreSetTopics(set || {});
  let best = FALLBACK_TOPIC;
  let bestScore = 0;
  for (const id of TIE_ORDER) {
    if (scores[id] > bestScore) { best = id; bestScore = scores[id]; }
  }
  return best;
}
