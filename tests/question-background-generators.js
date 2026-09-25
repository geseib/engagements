/**
 * THE GENERATORS WRITE BACKGROUND — question-background spec §2.
 * rejects: a generator that does not ask for background, asks without the truth rule,
 *          asks a wavelength round for one (the players supply the meaning), keeps an
 *          unclamped note, or builds a CSV that drops it.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const { BACKGROUND_TRUTH_RULE } = require(path.join(REPO, 'lambda-functions/admin/shared/question-background.js'));
const sg = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));
const { scenariosToCsv, triviaToCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/generated-set.js'));

(async () => {
  say('\n1. Call & Answer');
  const caTool = sg.buildItemsTool('call-and-answer');
  const caItem = caTool.input_schema.properties.items.items;
  await check('the tool asks for background, required', () => {
    assert.ok(caItem.properties.background, 'no background property');
    assert.ok(caItem.required.includes('background'));
  });
  await check('the length guidance carries the truth rule', () =>
    assert.ok(sg.lengthGuidance('call-and-answer').includes(BACKGROUND_TRUTH_RULE)));
  await check('wavelength is never asked for one', () => {
    const wItem = sg.buildItemsTool('wavelength').input_schema.properties.items.items;
    assert.ok(!wItem.properties.background && !wItem.required.includes('background'));
    assert.ok(!sg.lengthGuidance('wavelength').includes('background'));
  });

  say('\n2. Trivia');
  const config = { numChoices: 4, numCorrect: 1, topic: 'version control', difficulty: 'medium', categories: 2 };
  const tItem = trivia.buildTool(config).input_schema.properties.items.items;
  await check('the tool asks for background, required, apart from answerDetails', () => {
    assert.ok(tItem.properties.background && tItem.properties.answerDetails);
    assert.ok(tItem.required.includes('background'));
  });
  await check('the prompt carries the truth rule', () =>
    assert.ok(trivia.buildPrompt({ config, count: 5, alreadyUsedTitles: [] }).includes(BACKGROUND_TRUTH_RULE)));
  await check('normalizeItem keeps a clamped background', () => {
    const item = trivia.normalizeItem({ title: 'T', questionDetail: 'Q', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'OptionA', answerDetails: 'why',
      background: 'x '.repeat(500), difficulty: 'easy', tags: [] }, config);
    assert.ok(item.background.length > 0 && item.background.length <= 600);
  });

  say('\n3. The CSV the worker imports');
  await check('scenariosToCsv writes a Background column', () => {
    const csv = scenariosToCsv([{ title: 'T', category: 'C', detail: 'D', customInstructions: 'I',
      tags: ['a'], background: 'zqbg-scenario' }]);
    assert.ok(csv.split('\n')[0].split(',').includes('Background'), csv.split('\n')[0]);
    assert.ok(csv.includes('zqbg-scenario'));
  });
  await check('triviaToCsv writes a Background column', () => {
    const csv = triviaToCsv([{ title: 'T', category: 'C', questionDetail: 'Q', answerDetails: 'A',
      optionA: 'a', optionB: 'b', correctAnswer: 'OptionA', difficulty: 'easy', tags: [], background: 'zqbg-trivia' }]);
    assert.ok(csv.split('\n')[0].split(',').includes('Background'));
    assert.ok(csv.includes('zqbg-trivia'));
  });

  await check('the scenario normalizeItem keeps a clamped background, and none for wavelength', () => {
    const { normalizeItem } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js'));
    const raw = { title: 'T', category: 'C', detail: 'D', customInstructions: 'I', tags: [], background: 'y '.repeat(500) };
    assert.ok(normalizeItem(raw, 'call-and-answer').background.length <= 600);
    assert.strictEqual(normalizeItem(raw, 'wavelength').background, '');
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
