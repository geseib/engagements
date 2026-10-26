#!/usr/bin/env node
/**
 * WHAT THE SET IS ABOUT, AND WHICH CATEGORY A QUESTION BELONGS IN.
 *
 * The owner, 2026-10-25: the generators should be told "what the question set
 * was about, the category and the list of other categories … make sure the
 * questions generated related to that category and not what really belongs in
 * another category." lambda-functions/admin/shared/category-brief.js writes
 * that block, and the trivia, poll, scenario and single-question generators
 * all use it. Standalone: judge by exit code.
 */
const assert = require('assert');
const path = require('path');

const ADMIN = path.join(__dirname, '..', 'lambda-functions', 'admin');
const brief = require(path.join(ADMIN, 'shared', 'category-brief'));
const trivia = require(path.join(ADMIN, 'ai-generate-trivia'));
const polls = require(path.join(ADMIN, 'ai-generate-polls'));
const scenarios = require(path.join(ADMIN, 'ai-generate-scenarios'));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

const ABOUT = { title: 'Lessons from the Q3 launch', description: 'What went well and badly.', aiContext: 'For product and support leads.' };

console.log('\nthe block');

test('a target names the other categories as the ones not to drift into', () => {
  const b = brief.categoryBlock({ target: 'Support', categories: ['Planning', 'Delivery', 'Support'] });
  assert.match(b, /for the category "Support"/);
  assert.match(b, /other categories are: Planning, Delivery\./);
  assert.match(b, /belongs better in one of those is not a "Support" question/);
});

test('a full list says keep them distinct, and spreads the total', () => {
  const b = brief.categoryBlock({ categories: 'Planning, Delivery, Support', count: 3, total: 9 });
  assert.match(b, /exactly one of these 3/);
  assert.match(b, /- Planning\n- Delivery\n- Support/);
  assert.match(b, /Keep them distinct/);
  assert.match(b, /about 3 in each/);
});

test('some named, more wanted: the named are required and the rest must not overlap', () => {
  const b = brief.categoryBlock({ categories: 'Presidents', count: 3 });
  assert.match(b, /EXACTLY 3 categories/);
  assert.match(b, /- Presidents/);
  assert.match(b, /Choose the other 2 so that no two categories overlap/);
  assert.doesNotMatch(b, /one of these 1/);
});

test('a count alone asks for categories that do not overlap', () => {
  assert.match(brief.categoryBlock({ count: 4 }), /EXACTLY 4 categories.*do not overlap/s);
});

test('nothing to say is nothing', () => {
  assert.strictEqual(brief.categoryBlock({}), '');
  assert.strictEqual(brief.aboutSetBlock(null), '');
  assert.strictEqual(brief.aboutSetBlock({ title: '  ' }), '');
});

test('category names are trimmed, de-duplicated and capped at 24', () => {
  assert.deepStrictEqual(brief.categoryList(' A , a, B,, '), ['A', 'B']);
  assert.strictEqual(brief.categoryList(Array.from({ length: 30 }, (_, i) => `C${i}`)).length, 24);
});

test('what the set is about carries its name, description and AI context, clipped', () => {
  const b = brief.aboutSetBlock({ ...ABOUT, description: 'x '.repeat(500) });
  assert.match(b, /Set: Lessons from the Q3 launch/);
  assert.match(b, /Background for the AI: For product and support leads\./);
  assert.ok(b.length < 1000, 'a long description crowds out the task');
});

console.log('\nthe generators');

test('trivia: the set it is adding to, and its categories, reach the prompt', () => {
  const { config } = trivia.parseRequest({
    topic: 'Launches', count: 6, numberOfCategories: 2, mustHaveCategories: 'Planning, Delivery', aboutSet: ABOUT,
  });
  const p = trivia.buildPrompt({ config, count: 6, alreadyUsedTitles: [] });
  assert.match(p, /WHAT THIS SET IS ABOUT/);
  assert.match(p, /Description: What went well and badly\./);
  assert.match(p, /- Planning\n- Delivery\nKeep them distinct/);
});

test('trivia: a regenerated category names its neighbours', () => {
  const { config } = trivia.parseRequest({
    topic: 'Launches', count: 3, numberOfCategories: 1, mustHaveCategories: 'Support',
    category: 'Support', categories: ['Planning', 'Delivery', 'Support'],
  });
  const p = trivia.buildPrompt({ config, count: 3, alreadyUsedTitles: [] });
  assert.match(p, /other categories are: Planning, Delivery\./);
});

test('polls: one category, with the others named, and no contradicting list', () => {
  const { config } = polls.parseRequest({
    topic: 'Launches', count: 4, category: 'Support', categories: ['Planning', 'Support'],
  });
  const p = polls.buildPrompt({ config, count: 4, alreadyUsedTitles: [] });
  assert.match(p, /for the category "Support"/);
  assert.match(p, /other categories are: Planning\./);
  assert.doesNotMatch(p, /Spread the questions/);
});

const TEMPLATE = {
  basePrompt: 'TOPIC', contextTemplate: '\n\nContext: {context}', audienceTemplate: '',
  categoryTemplate: '\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}',
};
const scenarioPrompt = (over) => scenarios.buildPrompt({
  template: TEMPLATE, engagementType: 'call-and-answer', count: 4, difficulty: '', context: 'Launches',
  audience: '', customPrompt: '', categories: 3, mustHaveCategories: '', alreadyUsedTitles: [],
  roundKind: null, roundKindBrief: '', ...over,
});

test('scenarios: no named categories no longer sends the literal {mustHaveCategories}', () => {
  const p = scenarioPrompt({});
  assert.doesNotMatch(p, /\{mustHaveCategories\}|\{numberOfCategories\}/);
  assert.match(p, /EXACTLY 3 categories.*do not overlap/s);
});

test('scenarios: named categories are listed once, with the rule', () => {
  const p = scenarioPrompt({ mustHaveCategories: 'Planning, Delivery, Support' });
  assert.strictEqual((p.match(/Planning/g) || []).length, 1, 'the names are said twice');
  assert.match(p, /Keep them distinct/);
});

test('scenarios: a target category and what the set is about', () => {
  const p = scenarioPrompt({ category: 'Support', setCategories: ['Planning', 'Support'], aboutSet: ABOUT });
  assert.match(p, /WHAT THIS SET IS ABOUT/);
  assert.match(p, /for the category "Support"/);
  assert.doesNotMatch(p, /Organize scenarios into/, 'the template\'s count line contradicts a one-category run');
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
