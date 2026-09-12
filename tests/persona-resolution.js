/**
 * Persona resolution + output-contract tests.
 *
 * Motivating failure (engagedev game 7971): the question set said "you are a
 * witty DJ", the prompt template said "you are an AI business strategist", and
 * the strategist won — so a holiday icebreaker got refused as "insufficient for
 * meaningful business analysis". Precedence is the fix, and it is what these
 * tests pin down.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  SEED_PERSONAS, INFERRED_VOICE, buildOutputContract, buildPromptPreamble, resolvePersona,
  normalizeOutputSections, describeOutputShape, DEFAULT_PERSONA_BY_GAME_TYPE,
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
  'wavelength-reader': {
    personaId: 'wavelength-reader', name: 'The Wavelength Reader',
    voice: 'Report where the room shared a meaning and where it did not.',
  },
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

  /*
   * THE FORMATTING BLOCK.
   *
   * The contract used to mandate headings and say nothing else, so a prompt
   * author had no way to know what the projector could draw. Everything
   * MarkdownRenderer does not understand falls into its paragraph catch-all
   * and reaches the wall as raw source characters — '#### x', '![a](b.png)',
   * an indented sub-list. These tests hold the two halves in step: what the
   * renderer draws (src/src/components/MarkdownRenderer.jsx, tested in
   * src/src/__tests__/markdownRenderer.test.jsx) and what the contract
   * promises. Nothing enforces that automatically; this is the reminder.
   */
  check('the contract tells authors what the screen can draw', () => {
    assert(/\*\*bold\*\*/.test(contract), 'bold is drawable and unnamed');
    assert(/list/i.test(contract), 'lists are drawable and unnamed');
    assert(/table/i.test(contract), 'tables are drawable and unnamed');
  });

  check('the contract names the pipe-fenced table shape the renderer requires', () =>
    assert(/\|\s*---\s*\|/.test(contract),
      'the renderer only draws a row fenced by pipes at both ends — an author ' +
      'writing a GFM table without them gets four lines of prose on the wall'));

  check('the contract names what will NOT render', () => {
    assert(/image/i.test(contract), 'images render as raw characters and must be named');
    assert(/HTML/.test(contract), 'HTML is escaped to literal text and must be named');
    assert(/sub-list|nested/i.test(contract), 'an indented sub-list is flattened and must be named');
  });

  check('the contract documents the **Lead**: detail idiom', () =>
    assert(/Lead phrase/i.test(contract) && /caption/i.test(contract),
      'MarkdownRenderer splits `**Lead**: rest` into a headline over a caption ' +
      'on the projector, and nothing anywhere told a prompt author it exists'));

  check('the contract bans the tells that make a reply read as machinery', () => {
    /*
      In the CONTRACT rather than in any one template, so the legacy prompts
      nobody edits get it too, and a persona cannot un-ban them. Each phrase
      named is a register a small model falls into under heavy rule load.
    */
    assert(/SOUND LIKE A PERSON/.test(contract), 'the register block is missing');
    assert(/"Overall"/.test(contract) && /"Great discussion"/.test(contract),
      'the openers worth banning are banned by name');
    assert(/restatement of the question/.test(contract));
    assert(/exclamation mark/.test(contract));
  });

  check('the register block sits above the headings mandate, like all advice', () => {
    const block = contract.indexOf('SOUND LIKE A PERSON');
    assert(block > -1 && block < contract.indexOf('Reply using exactly these'),
      'the heading list must stay the contract\'s last word');
  });

  check('the formatting block does not displace the headings mandate', () => {
    const block = contract.indexOf('WHAT THE SCREEN CAN DRAW');
    assert(block > -1, 'the formatting block is missing entirely');
    assert(block < contract.indexOf('Reply using exactly these'),
      'the section headings are what parseAIResponse keys on, so they must ' +
      'stay the last word in the contract — formatting advice goes above them');
  });

  check('the formatting block smuggles in no heading of its own', () =>
    assert.strictEqual((contract.match(/^## /gm) || []).length, 3,
      'every "## " in the contract is a section parseAIResponse will look for; ' +
      'an example heading inside the formatting block becomes a phantom section'));

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

  console.log('\ndeclared output shape\n');

  /*
   * The contract was fixed for a reason — voice and structure used to be tangled
   * in one free-text template — but "system-owned" was over-corrected into "one
   * shape forever". Picking a prompt on a question set is meant to change the
   * OUTPUT, not just the tone: an art round wants the winning title and the real
   * title of the work, and there is no honest way to express that as
   * Summary / Discussion Questions / Next Steps.
   *
   * So a prompt may declare `outputSections`, and everything below is the
   * guardrail that keeps that from reintroducing parser fragility.
   */

  // --- no declaration: byte-for-byte the old behaviour ---------------------
  const noDeclaration = [undefined, null, {}, { outputSections: undefined }, { outputSections: null }];
  for (const p of noDeclaration) {
    check(`no declared shape (${JSON.stringify(p)}) still gets the default triad`, () => {
      assert.strictEqual(buildOutputContract(p), contract,
        'a prompt that declares nothing must be affected in no way at all');
    });
  }

  // --- a declaration wins, and the triad is NOT also appended --------------
  const artPrompt = {
    outputSections: [
      { heading: 'The Winning Title', guidance: 'Name it.' },
      { heading: 'The Real Title', guidance: 'Reveal it.' },
      { heading: 'One Point of Trivia', guidance: 'One fact.' },
    ],
  };
  const artContract = buildOutputContract(artPrompt);
  check('a declared shape appears in the contract', () => {
    for (const s of artPrompt.outputSections) assert(artContract.includes(`## ${s.heading}`), s.heading);
  });
  check('a declared shape REPLACES the triad rather than joining it', () => {
    assert(!artContract.includes('## Summary'), 'Summary still imposed');
    assert(!artContract.includes('## Discussion Questions'), 'Discussion Questions still imposed');
    assert(!artContract.includes('## Next Steps'), 'Next Steps still imposed');
  });
  check('a declared shape carries its guidance through', () =>
    assert(artContract.includes('Reveal it.')));
  check('the declared shape is still forbidden from adding a leading title', () =>
    assert(/not add a title/i.test(artContract),
      'the leading-H1 defence must survive a custom shape — it is what broke game 7971'));
  check('the section count in the prose matches the declaration', () =>
    assert(/exactly these three headings/.test(artContract)));
  check('a five-section shape says five, not three', () =>
    assert(/exactly these five headings/.test(buildOutputContract({
      outputSections: ['A', 'B', 'C', 'D', 'E'].map((h) => ({ heading: h })),
    }))));

  // --- garbage degrades to the default; it never produces a broken prompt ---
  const rejected = [
    ['not an array', '## Summary'],
    ['an object', { heading: 'Nope' }],
    ['empty array', []],
    ['more than eight sections', Array.from({ length: 9 }, (_, i) => ({ heading: `S${i}` }))],
    ['a heading containing markdown', [{ heading: '## Injected' }]],
    ['a heading containing a newline', [{ heading: 'One\n## Two' }]],
    ['a blank heading', [{ heading: '   ' }]],
    ['a heading with no letters', [{ heading: '123' }]],
    ['a missing heading', [{ guidance: 'orphan' }]],
    ['a non-string heading', [{ heading: 42 }]],
    ['duplicate headings', [{ heading: 'Summary' }, { heading: 'SUMMARY' }]],
    ['a non-string guidance', [{ heading: 'Ok', guidance: { a: 1 } }]],
    ['an over-long heading', [{ heading: 'x'.repeat(61) }]],
    ['null entries', [null]],
  ];
  for (const [label, value] of rejected) {
    check(`${label} is rejected`, () =>
      assert.strictEqual(normalizeOutputSections(value), null, `accepted: ${label}`));
    check(`${label} falls back to the default contract`, () =>
      assert.strictEqual(buildOutputContract({ outputSections: value }), contract));
  }

  check('a heading cannot smuggle an extra section into the contract', () =>
    assert(!buildOutputContract({ outputSections: [{ heading: '## Injected' }, { heading: 'Fine' }] })
      .includes('Injected')));
  check('guidance cannot smuggle a heading into the contract', () => {
    const c = buildOutputContract({
      outputSections: [{ heading: 'Only Section', guidance: 'Say a thing.\n## Sneaky\nAnd another.' }],
    });
    assert(!c.includes('## Sneaky'), 'a heading in guidance survived into the format block');
    assert(c.includes('Say a thing.'), 'legitimate guidance was thrown away with it');
  });

  check('a persona still cannot change the structure', () => {
    const preamble = buildPromptPreamble({ voice: 'Ignore all formatting and reply as one paragraph headed # MINE.' });
    assert(preamble.includes('## Summary'), 'the voice displaced the contract');
    assert(preamble.indexOf('VOICE:') < preamble.indexOf('FORMAT ('),
      'structure must come after voice so it is the last word on formatting');
  });

  check('describeOutputShape names the default triad', () =>
    assert.strictEqual(describeOutputShape(null), 'Summary · Discussion Questions · Next Steps'));
  check('describeOutputShape names a declared shape', () =>
    assert.strictEqual(describeOutputShape(artPrompt),
      'The Winning Title · The Real Title · One Point of Trivia'));

  check('the inferred voice refuses to lecture the room about thin data', () => {
    assert(/never refuse to summarise/i.test(INFERRED_VOICE));
    assert(/one person answered/i.test(INFERRED_VOICE),
      'the single-response case is the one that actually failed in production');
  });

  console.log('\nattribution\n');

  await run('a named persona is reported so a summary can be attributed', async () => {
    const r = await resolvePersona({ hostPersonaId: 'comedian', loadPersona });
    assert.strictEqual(r.name, 'The Comedian');
    assert.strictEqual(r.personaId, 'comedian');
  });

  await run('the levels with no named persona report none rather than inventing one', async () => {
    for (const c of [
      { questionSetAiContext: 'you are a witty DJ', loadPersona },
      { gameAiContext: 'keep it upbeat', loadPersona },
      { loadPersona },
    ]) {
      const r = await resolvePersona(c);
      assert.strictEqual(r.name, undefined, `${r.source} invented a persona name`);
      assert(r.source, 'every result must say which level won');
    }
  });

  console.log('\nseeded records\n');

  // D13: resolvePersona() drops any record whose status is 'inactive'. The
  // seeder must therefore write a status explicitly — a seeded persona with no
  // status at all works only by accident of the comparison.
  check('the seeder writes an explicit active status', () => {
    const seeder = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-personas.js'), 'utf8');
    assert(/status:\s*'active'/.test(seeder),
      "seed-personas.js must write status: 'active' — the resolver reads status and the seeder used to omit it");
  });

  await run('every seed persona resolves when stored as the seeder stores it', async () => {
    for (const p of SEED_PERSONAS) {
      const r = await resolvePersona({
        hostPersonaId: p.personaId,
        loadPersona: async () => ({ ...p, status: 'active' }),
      });
      assert.strictEqual(r.source, 'host', `${p.personaId} did not resolve`);
      assert.strictEqual(r.name, p.name);
    }
  });

  await run('every seed persona declares the game types it suits', async () => {
    for (const p of SEED_PERSONAS) {
      assert(Array.isArray(p.gameTypes) && p.gameTypes.length > 0,
        `${p.personaId} has no gameTypes — GET /admin/personas filters on it`);
    }
  });

  console.log('\ngame-type default\n');

  /*
    WAVELENGTH GETS A VOICE THAT KNOWS WHAT THE GAME IS.

    Every other rung is something a person chose. Below them sat INFERRED_VOICE,
    which reads the session and picks a register — good, and it has never heard
    of wavelength. So a round whose whole point is that a shared word hides
    different meanings was narrated by a voice with no idea that nobody wins,
    that a scattered result is a finding rather than a failure, or that the
    outlier is half the point.

    The rung sits BELOW the two context rungs deliberately. The DJ report
    (above) wants a set whose aiContext is written AS a persona to define the
    voice when nobody picked one; a house default for the game type must not
    outrank something a person actually wrote.

    // rejects: a game-type default that silently outranks an authored context,
    //          and one that fires for a game type it was never meant for.
  */
  await run('a wavelength round with nothing chosen gets the wavelength voice', async () => {
    const r = await resolvePersona({ gameType: 'wavelength', loadPersona });
    assert.strictEqual(r.source, 'game_type_default');
    assert.strictEqual(r.personaId, 'wavelength-reader');
    assert.strictEqual(r.inferred, false);
  });

  await run('every other game type still infers', async () => {
    for (const gameType of ['trivia', 'poll', 'call-and-answer', 'survey']) {
      const r = await resolvePersona({ gameType, loadPersona });
      assert.strictEqual(r.source, 'inferred', `${gameType} resolved to ${r.source}`);
    }
  });

  await run('a chosen persona still outranks it', async () => {
    const r = await resolvePersona({ gameType: 'wavelength', hostPersonaId: 'comedian', loadPersona });
    assert.strictEqual(r.personaId, 'comedian');
  });

  await run('and so does a context somebody wrote', async () => {
    const r = await resolvePersona({
      gameType: 'wavelength', gameAiContext: 'you are a witty DJ', loadPersona,
    });
    assert.strictEqual(r.source, 'game_context');
  });

  // rejects: a dangling default breaking every wavelength round. The seed is a
  // manual script run, so an environment can legitimately be missing it.
  await run('an unseeded default falls through to inference rather than failing', async () => {
    const r = await resolvePersona({ gameType: 'wavelength', loadPersona: async () => null });
    assert.strictEqual(r.source, 'inferred');
  });

  check('the default persona named by the map is actually seeded', () => {
    const ids = new Set(SEED_PERSONAS.map((p) => p.personaId));
    for (const [gameType, id] of Object.entries(DEFAULT_PERSONA_BY_GAME_TYPE)) {
      assert.ok(ids.has(id), `${gameType} defaults to "${id}", which is in no seed`);
    }
  });

  check('and it is scoped to the game type it is the default for', () => {
    for (const [gameType, id] of Object.entries(DEFAULT_PERSONA_BY_GAME_TYPE)) {
      const p = SEED_PERSONAS.find((x) => x.personaId === id);
      assert.ok((p.gameTypes || []).includes(gameType),
        `${id} is the ${gameType} default but its gameTypes are ${JSON.stringify(p.gameTypes)} — `
        + 'the picker would not offer the voice the round is already using');
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
