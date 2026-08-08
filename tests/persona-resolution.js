/**
 * Persona resolution + output-contract tests.
 *
 * Motivating failure (engagedev game 7971): the question set said "you are a
 * witty DJ", the prompt template said "you are an AI business strategist", and
 * the strategist won — so a holiday icebreaker got refused as "insufficient for
 * meaningful business analysis". Precedence is the fix, and it is what these
 * tests pin down.
 */
const path = require('path');
const assert = require('assert');
const {
  SEED_PERSONAS, INFERRED_VOICE, buildOutputContract, buildPromptPreamble, resolvePersona,
} = require(path.join(__dirname, '..', 'lambda-functions', 'game', 'personas.js'));

let pass = 0, fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};
const run = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};

const STORE = {
  comedian: { personaId: 'comedian', name: 'The Comedian', voice: 'Be funny about the answers.' },
  coach: { personaId: 'coach', name: 'The Coach', voice: 'Ask the better question.' },
  retired: { personaId: 'retired', name: 'Retired', voice: 'Old voice.', status: 'inactive' },
  voiceless: { personaId: 'voiceless', name: 'Broken', voice: '' },
};
const loadPersona = async (id) => STORE[id] || null;

(async () => {
  console.log('persona library\n');

  check('every seed persona has the fields the admin UI needs', () => {
    for (const p of SEED_PERSONAS) {
      assert(p.personaId && p.name && p.tagline && p.icon && p.voice, `incomplete persona: ${p.personaId || '(no id)'}`);
      assert(p.voice.length > 80, `${p.personaId} voice is too thin to shape output`);
    }
  });
  check('exactly one seed persona is the default', () =>
    assert.strictEqual(SEED_PERSONAS.filter((p) => p.isDefault).length, 1));
  check('seed persona ids are unique', () =>
    assert.strictEqual(new Set(SEED_PERSONAS.map((p) => p.personaId)).size, SEED_PERSONAS.length));
  check('no seed persona tries to dictate structure', () => {
    for (const p of SEED_PERSONAS) {
      assert(!/##|\bheading\b|## Summary/i.test(p.voice),
        `${p.personaId} mentions headings — structure is the system's job, not the persona's`);
    }
  });

  console.log('\nprecedence\n');

  await run('host pick beats everything below it', async () => {
    const r = await resolvePersona({
      hostPersonaId: 'comedian', setPersonaId: 'coach',
      questionSetAiContext: 'you are a witty DJ', gameAiContext: 'formal',
      templateInstructions: 'you are a business strategist', loadPersona,
    });
    assert.strictEqual(r.source, 'host');
    assert.strictEqual(r.personaId, 'comedian');
  });

  await run('set persona beats context and template', async () => {
    const r = await resolvePersona({
      setPersonaId: 'coach', questionSetAiContext: 'you are a witty DJ',
      templateInstructions: 'you are a business strategist', loadPersona,
    });
    assert.strictEqual(r.source, 'question_set');
    assert.strictEqual(r.personaId, 'coach');
  });

  await run('the witty DJ beats the business strategist (the reported bug)', async () => {
    const r = await resolvePersona({
      questionSetAiContext: 'you are a witty DJ. Comment on the top picks and share trivia.',
      templateInstructions: 'You are an AI business strategist analyzing lessons learned.',
      loadPersona,
    });
    assert.strictEqual(r.source, 'question_set_context');
    assert(r.voice.includes('witty DJ'), r.voice);
    assert(!r.voice.includes('business strategist'), 'the template persona leaked through');
  });

  await run('game context is used when the set has none', async () => {
    const r = await resolvePersona({ gameAiContext: 'keep it upbeat', loadPersona });
    assert.strictEqual(r.source, 'game_context');
    assert.strictEqual(r.voice, 'keep it upbeat');
  });

  await run('nothing set at all yields the inferred voice', async () => {
    const r = await resolvePersona({ loadPersona });
    assert.strictEqual(r.source, 'inferred');
    assert.strictEqual(r.inferred, true);
    assert.strictEqual(r.voice, INFERRED_VOICE);
  });

  await run('a legacy template does NOT override inference', async () => {
    const r = await resolvePersona({
      templateInstructions: 'You are an AI business strategist analyzing lessons learned.',
      loadPersona,
    });
    assert.strictEqual(r.inferred, true, 'the template persona took over again');
  });

  console.log('\ndegradation\n');

  await run('a dangling personaId falls through instead of dead-ending', async () => {
    const r = await resolvePersona({ hostPersonaId: 'does-not-exist', setPersonaId: 'coach', loadPersona });
    assert.strictEqual(r.source, 'question_set');
    assert.strictEqual(r.personaId, 'coach');
  });

  await run('an inactive persona falls through', async () => {
    const r = await resolvePersona({ hostPersonaId: 'retired', loadPersona });
    assert.strictEqual(r.source, 'inferred');
  });

  await run('a persona with an empty voice falls through', async () => {
    const r = await resolvePersona({ hostPersonaId: 'voiceless', loadPersona });
    assert.strictEqual(r.source, 'inferred');
  });

  await run('a throwing loader falls through rather than failing the summary', async () => {
    const r = await resolvePersona({
      hostPersonaId: 'comedian',
      loadPersona: async () => { throw new Error('DynamoDB unavailable'); },
    });
    assert.strictEqual(r.source, 'inferred');
  });

  await run('there is always a voice', async () => {
    const r = await resolvePersona({});
    assert(r && r.voice && r.voice.length > 0);
  });

  console.log('\noutput contract\n');

  const contract = buildOutputContract();
  check('the contract names all three sections', () => {
    assert(contract.includes('## Summary'));
    assert(contract.includes('## Discussion Questions'));
    assert(contract.includes('## Next Steps'));
  });
  check('the contract forbids a leading title', () =>
    assert(/not add a title/i.test(contract),
      'a leading H1 is what broke parsing on game 7971 — the contract must forbid it'));

  await run('the contract is present whichever level supplied the voice', async () => {
    const cases = [
      { hostPersonaId: 'comedian', loadPersona },
      { questionSetAiContext: 'you are a witty DJ', loadPersona },
      { loadPersona },
    ];
    for (const c of cases) {
      const preamble = buildPromptPreamble(await resolvePersona(c));
      assert(preamble.includes('## Summary'), `contract missing for ${JSON.stringify(Object.keys(c))}`);
      assert(preamble.startsWith('VOICE:'), 'voice must come before structure');
    }
  });

  check('the inferred voice refuses to lecture the room about thin data', () => {
    assert(/never refuse to summarise/i.test(INFERRED_VOICE));
    assert(/one person answered/i.test(INFERRED_VOICE),
      'the single-response case is the one that actually failed in production');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
