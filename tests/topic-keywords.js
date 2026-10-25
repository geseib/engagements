/**
 * WHICH TOPIC A SET'S WORDS POINT TO — the keyword classifier behind every AI
 * run's suggested topic when the model gives none, and behind the set list's
 * pre-selected topic for an unfiled set being switched on.
 *
 * The owner, 23 Oct 2026: "when ai generates question sets. it should auto tag
 * (based on a list of categories) right now the user gets an error activating
 * sets because they dont have a tag".
 *
 * // rejects: a suggestion that is not on the shelf (a sixteenth id, Unfiled,
 * //          an empty string); an answer that changes between runs on a tie;
 * //          a classifier that cannot place anything and so leaves the set
 * //          exactly where the owner's error came from; a suggested tag that
 * //          only restates the topic.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const K = require(path.join(REPO, 'lambda-functions/admin/shared/topic-keywords.js'));
const { SET_TOPIC_IDS } = require(path.join(REPO, 'lambda-functions/admin/shared/set-topics.js'));
const D = require(path.join(REPO, 'lambda-functions/admin/shared/draft-topic.js'));

let passed = 0; let failed = 0;
function check(label, fn) {
  try { fn(); passed += 1; console.log(`  ok   - ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL - ${label}\n         ${e.message}`); }
}

/** One fixture per shelf: what a person would name a set on it. */
const FIXTURES = [
  ['arts-culture', { title: 'Renaissance painters', description: 'Museums and galleries of Europe' }],
  ['business-work', { title: 'Team retrospective', description: 'How our project went, and what the stakeholders thought' }],
  ['everyday-life', { title: 'Household habits', description: 'Chores, routines and the family budget' }],
  ['film-tv', { title: 'Oscar winning movies', description: 'Actors, directors and box office hits' }],
  ['food-drink', { title: 'World cuisine', description: 'Recipes, chefs and a little wine' }],
  ['geography-travel', { title: 'Capital cities', description: 'Countries, borders and rivers' }],
  ['health-medicine', { title: 'Mental health at work', description: 'Sleep, stress and burnout' }],
  ['history', { title: 'Ancient Egypt', description: 'Pharaohs, dynasties and the empire' }],
  ['language-literature', { title: 'Shakespeare and his poetry', description: 'Novels, poems and the authors who wrote them' }],
  ['music', { title: 'Jazz albums', description: 'Bands, singers and the songs everyone knows' }],
  ['nature-environment', { title: 'Climate change', description: 'Wildlife, forests and endangered species' }],
  ['politics-society', { title: 'How elections work', description: 'Parliament, voting and democracy' }],
  ['science-technology', { title: 'Machine learning basics', description: 'Software, algorithms and computing' }],
  ['sport-games', { title: 'World Cup football', description: 'Tournaments, leagues and athletes' }],
];

console.log('\nthe classifier');

for (const [want, set] of FIXTURES) {
  check(`"${set.title}" → ${want}`, () => assert.strictEqual(K.classifySetTopic(set), want));
}

check('every shelf except the catch-all has a fixture, and a keyword list', () => {
  const covered = new Set(FIXTURES.map(([id]) => id));
  for (const id of SET_TOPIC_IDS) {
    if (id === K.FALLBACK_TOPIC) continue;
    assert.ok(covered.has(id), `no fixture for ${id}`);
    assert.ok(Array.isArray(K.TOPIC_KEYWORDS[id]) && K.TOPIC_KEYWORDS[id].length >= 10, `${id} has a thin keyword list`);
  }
  assert.deepStrictEqual(Object.keys(K.TOPIC_KEYWORDS).sort(), SET_TOPIC_IDS.filter((id) => id !== K.FALLBACK_TOPIC).sort(),
    'the keyword table names a shelf that does not exist, or misses one');
});

check('questions are read too, when the title says nothing', () => {
  const set = {
    title: 'Friday quiz',
    questions: [
      { title: 'Which planet is largest?', questionDetail: 'Think of the solar system' },
      { title: 'What does an atom contain?', category: 'Physics' },
      'Who wrote the first computer program?',
    ],
  };
  assert.strictEqual(K.classifySetTopic(set), 'science-technology');
});

check('the title outweighs a stray word in one question', () => {
  const set = {
    title: 'Premier League football',
    questions: [{ title: 'Which club has a chef as mascot?' }, { title: 'Who scored the winning goal?' }],
  };
  assert.strictEqual(K.classifySetTopic(set), 'sport-games');
});

check('NOTHING SCORES → General Knowledge, never Unfiled or an invented id', () => {
  assert.strictEqual(K.classifySetTopic({ title: 'Zxq', description: 'Lorem ipsum dolor' }), 'general-knowledge');
  assert.strictEqual(K.classifySetTopic({}), 'general-knowledge');
  assert.strictEqual(K.classifySetTopic(), 'general-knowledge');
  assert.strictEqual(K.classifySetTopic({ questions: null, title: null }), 'general-knowledge');
});

check('a tie goes to the earlier shelf, the same way every time', () => {
  // One keyword each for music (song) and sport-games (football), same weight.
  const set = { title: 'Song football' };
  const { scores } = K.scoreSetTopics(set);
  assert.strictEqual(scores.music, scores['sport-games'], 'the fixture is not a tie');
  const first = K.TIE_ORDER.indexOf('music') < K.TIE_ORDER.indexOf('sport-games') ? 'music' : 'sport-games';
  for (let i = 0; i < 5; i += 1) assert.strictEqual(K.classifySetTopic(set), first);
});

check('never an id off the shelf, whatever it is fed', () => {
  const junk = [
    { title: 'Unfiled' }, { title: 'category c001' }, { title: '<script>' }, { title: 'history'.repeat(50) },
    { title: 42 }, { description: ['history'] }, { questions: [null, 3, {}, { title: {} }] },
    ...FIXTURES.map(([, s]) => s),
  ];
  for (const set of junk) assert.ok(SET_TOPIC_IDS.includes(K.classifySetTopic(set)), JSON.stringify(set));
});

check('a plural matches its keyword; a word inside another word does not', () => {
  assert.strictEqual(K.classifySetTopic({ title: 'Famous paintings' }), 'arts-culture');
  // "artichoke" carries "art" and is not about art.
  assert.notStrictEqual(K.classifySetTopic({ title: 'Artichoke' }), 'arts-culture');
});

check('"AI-generated" in a description is how it was written, not what it is about', () => {
  assert.strictEqual(K.classifySetTopic({ title: 'Zxq', description: 'AI-generated scenarios for detailed difficulty level.' }),
    'general-knowledge');
  // ...while AI as a subject still counts.
  assert.strictEqual(K.classifySetTopic({ title: 'AI at work: machine learning' }), 'science-technology');
});

console.log('\nthe tags');

check('the questions\' own tags first, most frequent first, never the topic, at most five', () => {
  const questions = [
    { title: 'a', tags: ['Pharaohs', 'nile'] },
    { title: 'b', tags: ['pharaohs', 'pyramids'] },
    { title: 'c', tags: ['history', 'pharaohs', 'tombs', 'gods', 'scribes', 'papyrus'] },
  ];
  const tags = K.suggestSetTags({ title: 'Ancient Egypt', questions }, 'history');
  assert.strictEqual(tags[0], 'pharaohs');
  assert.ok(!tags.includes('history'), 'a tag restated the topic');
  assert.ok(tags.length <= 5);
  assert.ok(tags.every((t) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)), tags.join(','));
});

check('with no question tags, the words that placed it', () => {
  const tags = K.suggestSetTags({ title: 'Ancient Egypt and its pharaohs' }, 'history');
  assert.ok(tags.includes('ancient') && tags.includes('egypt'), tags.join(','));
});

console.log('\nthe model\'s answer, and the fallback');

check('the tool gains two OPTIONAL fields and the items are untouched', () => {
  const tool = { name: 'emit_items', input_schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] } };
  const out = D.withTopicFields(tool);
  assert.deepStrictEqual(out.input_schema.required, ['items'], 'the topic became required');
  assert.deepStrictEqual(out.input_schema.properties.setTopic.enum, SET_TOPIC_IDS);
  assert.strictEqual(out.input_schema.properties.setTags.type, 'array');
  assert.deepStrictEqual(tool.input_schema.properties, { items: { type: 'array' } }, 'the original tool was mutated');
});

check('the prompt block names every id and its label', () => {
  const block = D.topicPromptBlock();
  for (const id of SET_TOPIC_IDS) assert.ok(block.includes(`- ${id}: `), id);
});

// rejects: ids and labels alone. set-topics.js calls the one-line blurb
// load-bearing — a catch-all with nothing said about it is where every set lands.
check('the prompt block gives each shelf its one-line description', () => {
  const { SET_TOPICS } = require(path.join(REPO, 'lambda-functions/admin/shared/set-topics.js'));
  const block = D.topicPromptBlock();
  for (const id of SET_TOPIC_IDS) {
    assert.ok(block.includes(`- ${id}: ${SET_TOPICS[id].label} — ${SET_TOPICS[id].blurb}`), id);
  }
});

check('a model answer on the shelf is read; one off it is not', () => {
  assert.deepStrictEqual(D.readModelTopic({ setTopic: 'history', setTags: ['Pharaohs', 'history', 'Nile Delta'] }),
    { topic: 'history', tags: ['pharaohs', 'nile-delta'] });
  assert.deepStrictEqual(D.readModelTopic({ setTopic: 'History' }), { topic: 'history', tags: [] });
  assert.strictEqual(D.readModelTopic({ setTopic: 'ancient-history' }), null);
  assert.strictEqual(D.readModelTopic({ setTopic: ['history'] }), null);
  assert.strictEqual(D.readModelTopic({ items: [] }), null);
  assert.strictEqual(D.readModelTopic(null), null);
});

check('proposeDraftTopic: the model when it answered, keywords when it did not', () => {
  const items = [{ title: 'Which river runs through Cairo?', tags: ['nile'] }];
  assert.deepStrictEqual(D.proposeDraftTopic({ model: { topic: 'geography-travel', tags: ['rivers'] }, title: 'Egypt', items }),
    { topic: 'geography-travel', tags: ['rivers'], source: 'model' });
  const fallback = D.proposeDraftTopic({ model: null, title: 'Ancient Egypt', items });
  assert.strictEqual(fallback.source, 'keywords');
  assert.strictEqual(fallback.topic, 'history');
  assert.ok(fallback.tags.includes('nile'));
  const garbled = D.proposeDraftTopic({ model: { topic: 'egyptology' }, title: 'Ancient Egypt' });
  assert.strictEqual(garbled.source, 'keywords');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
