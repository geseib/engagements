/**
 * ONE ANGLE PER ROUND — lambda-functions/game/round-angles.js.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * A Call & Answer round carries participant counts, the event's own
 * information and the race — who leads overall against who won this round —
 * and the default Workie used none of the race and never decided to talk
 * about the event, so every read-back was the same kind of read-back. The
 * lambda now draws one angle per round (question, race, event, fact) from the
 * angles the round can support, by weight, never repeating race/event/fact
 * two rounds running, leaning toward the race on the final round.
 *
 * rejects: an angle offered without the data it needs (the race on a hidden
 *          round, on round 1, or with fewer than two scored players; the event
 *          with no event text); weights ignored; a race/event/fact angle two
 *          rounds running; no final-round lean; a zero weight still drawn; no
 *          fallback when every weight is zero; a race block whose numbers are
 *          not the standings it was given; a block that repeats the briefing.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const {
  HOUSE_ANGLE_WEIGHTS, availableAngles, pickAngle, buildAngleDirective, houseWeightsFor,
} = require(path.join(__dirname, '..', 'lambda-functions', 'game', 'round-angles.js'));

let pass = 0, fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};

/** A seeded generator, so a thousand draws are the same thousand every run. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const draws = (n, args, seed = 7) => {
  const rng = seeded(seed);
  const counts = {};
  for (let i = 0; i < n; i++) {
    const a = pickAngle({ ...args, rng });
    counts[a] = (counts[a] || 0) + 1;
  }
  return counts;
};

const STANDINGS = [{ name: 'Ada', score: 14 }, { name: 'Grace', score: 12 }, { name: 'Linus', score: 9 }];

console.log('\n1. which angles a round can support');
check('the house mix is question 40, race 25, event 20, fact 15', () =>
  assert.deepStrictEqual({ ...HOUSE_ANGLE_WEIGHTS }, { question: 40, race: 25, event: 20, fact: 15 }));
check('call-and-answer has the house mix; other game types have none yet', () => {
  assert.deepStrictEqual(houseWeightsFor('call-and-answer'), HOUSE_ANGLE_WEIGHTS);
  assert.deepStrictEqual(houseWeightsFor('callandanswer'), HOUSE_ANGLE_WEIGHTS);
  assert.strictEqual(houseWeightsFor('trivia'), null);
  assert.strictEqual(houseWeightsFor('wavelength'), null);
});
check('everything is on offer when the round has everything', () =>
  assert.deepStrictEqual(availableAngles({ hidden: false, roundNumber: 3, standings: STANDINGS, hasEventText: true }).sort(),
    ['event', 'fact', 'question', 'race']));
check('question and fact are always on offer', () =>
  assert.deepStrictEqual(availableAngles({}).sort(), ['fact', 'question']));
check('no race on a hidden round', () =>
  assert.ok(!availableAngles({ hidden: true, roundNumber: 3, standings: STANDINGS }).includes('race')));
check('no race on round 1', () =>
  assert.ok(!availableAngles({ hidden: false, roundNumber: 1, standings: STANDINGS }).includes('race')));
check('no race with fewer than two scored players', () => {
  const one = [{ name: 'Ada', score: 5 }, { name: 'Grace', score: 0 }];
  assert.ok(!availableAngles({ hidden: false, roundNumber: 2, standings: one }).includes('race'));
});
check('no event angle without event text', () =>
  assert.ok(!availableAngles({ hidden: false, roundNumber: 2, standings: STANDINGS, hasEventText: false }).includes('event')));

console.log('\n2. the draw');
const all = ['question', 'race', 'event', 'fact'];
check('over many draws each angle turns up in proportion to its weight', () => {
  const c = draws(4000, { available: all, weights: HOUSE_ANGLE_WEIGHTS });
  for (const [a, w] of Object.entries(HOUSE_ANGLE_WEIGHTS)) {
    const share = c[a] / 4000;
    assert.ok(Math.abs(share - w / 100) < 0.03, `${a}: ${share.toFixed(3)} against ${w / 100}`);
  }
});
check('an unavailable angle is never drawn, and the rest share its weight', () => {
  const c = draws(2000, { available: ['question', 'fact'], weights: HOUSE_ANGLE_WEIGHTS });
  assert.deepStrictEqual(Object.keys(c).sort(), ['fact', 'question']);
  assert.ok(Math.abs(c.question / 2000 - 40 / 55) < 0.04, JSON.stringify(c));
});
check('race, event and fact never run two rounds in a row', () => {
  for (const last of ['race', 'event', 'fact']) {
    const c = draws(1000, { available: all, weights: HOUSE_ANGLE_WEIGHTS, lastAngle: last });
    assert.ok(!c[last], `${last} was drawn right after ${last}`);
  }
});
check('question may follow question', () => {
  const c = draws(1000, { available: all, weights: HOUSE_ANGLE_WEIGHTS, lastAngle: 'question' });
  assert.ok(c.question > 0);
});
check('the final round doubles the race', () => {
  const plain = draws(4000, { available: all, weights: HOUSE_ANGLE_WEIGHTS }, 11).race / 4000;
  const final = draws(4000, { available: all, weights: HOUSE_ANGLE_WEIGHTS, isFinalRound: true }, 11).race / 4000;
  assert.ok(Math.abs(plain - 25 / 100) < 0.03, `plain ${plain}`);
  assert.ok(Math.abs(final - 50 / 125) < 0.03, `final ${final}`);
});
check('a zero weight is never drawn', () => {
  const c = draws(1000, { available: all, weights: { question: 0, race: 10, event: 0, fact: 0 } });
  assert.deepStrictEqual(Object.keys(c), ['race']);
});
check('when every remaining weight is zero the answer is question', () => {
  assert.strictEqual(pickAngle({ available: ['race', 'fact'], weights: { question: 0, race: 0, event: 0, fact: 0 }, rng: () => 0.5 }), 'question');
  assert.strictEqual(pickAngle({ available: ['race'], weights: HOUSE_ANGLE_WEIGHTS, lastAngle: 'race', rng: () => 0.5 }), 'question');
});
check('a weight missing from an override falls back to the house weight', () => {
  const c = draws(2000, { available: ['question', 'race'], weights: { race: 40 } });
  assert.ok(Math.abs(c.question / 2000 - 0.5) < 0.04, JSON.stringify(c));
});

console.log('\n3. the blocks');
const TURNOUT = { answered: 6, voted: 7, joined: 8 };
const race = buildAngleDirective('race', {
  turnout: TURNOUT,
  standings: STANDINGS,
  standingsBefore: [{ name: 'Grace', score: 12 }, { name: 'Ada', score: 8 }, { name: 'Linus', score: 9 }],
  roundWinners: [{ name: 'Ada', points: 6 }],
});
check('every block is a requirement of the format', () => {
  for (const a of all) {
    const block = buildAngleDirective(a, { turnout: TURNOUT, standings: STANDINGS, roundWinners: [{ name: 'Ada', points: 6 }] });
    assert.ok(block.startsWith("THIS ROUND'S ANGLE"), `${a}: ${block.slice(0, 60)}`);
    assert.ok(/identical in force to the headings/.test(block), a);
  }
});
check('every block ends on a self-check, and the three that ask for something call a reply without it malformed', () => {
  for (const a of all) {
    const block = buildAngleDirective(a, { turnout: TURNOUT, standings: STANDINGS, roundWinners: [{ name: 'Ada', points: 6 }] });
    const last = block.trim().split('\n').pop();
    assert.ok(/before you reply, re-read it and confirm/i.test(last), `${a} ends: ${last}`);
    if (a !== 'question') assert.ok(/malformed/.test(block), `${a} never says a reply without it is malformed`);
  }
});
check('every block carries the turnout', () => {
  for (const a of all) {
    const block = buildAngleDirective(a, { turnout: TURNOUT, standings: STANDINGS, roundWinners: [] });
    assert.ok(block.includes('6 answered') && block.includes('7 voted') && block.includes('8 joined the session'), `${a}: ${block}`);
  }
});
check('the race block states the standings after this round, exactly', () => {
  assert.ok(race.includes('1st Ada, 14 points'), race);
  assert.ok(race.includes('2nd Grace, 12 points'), race);
  assert.ok(race.includes('3rd Linus, 9 points'), race);
});
check("the race block states this round's winner and the gap", () => {
  assert.ok(race.includes('Ada, +6 points this round'), race);
  assert.ok(race.includes('2 points between first and second'), race);
});
check('the race block names a lead change when the leader changed this round', () =>
  assert.ok(/Ada took the lead from Grace this round/.test(race), race));
check('…and says the leader held on when they did', () => {
  const held = buildAngleDirective('race', {
    turnout: TURNOUT, standings: STANDINGS,
    standingsBefore: [{ name: 'Ada', score: 11 }, { name: 'Grace', score: 10 }],
    roundWinners: [{ name: 'Ada', points: 3 }],
  });
  assert.ok(!/took the lead/.test(held), held);
});
check('the race block forbids recounting', () => assert.ok(/copy these numbers exactly/i.test(race), race));
check('the event block points at the session context and never repeats the briefing', () => {
  const ev = buildAngleDirective('event', { turnout: TURNOUT });
  assert.ok(/what this session is for/i.test(ev), ev);
  assert.ok(!/Briefing:/.test(ev), 'the event block quotes a briefing');
});
check("the event block quotes the host's own words and names the first discussion question as the place", () => {
  const ev = buildAngleDirective('event', { turnout: TURNOUT, eventWords: 'Q4 reset: choosing three changes to trial in October' });
  assert.ok(ev.includes('in the host\'s own words: "Q4 reset: choosing three changes to trial in October"'), ev);
  assert.ok(/FIRST discussion question/.test(ev), ev);
});
check('with no host words the event block still names the place', () => {
  const ev = buildAngleDirective('event', { turnout: TURNOUT });
  assert.ok(!/host's own words/.test(ev), ev);
  assert.ok(/FIRST discussion question/.test(ev), ev);
});
check("a long event description is cut at a word, not pasted whole a third time", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const ev = buildAngleDirective('event', { turnout: TURNOUT, eventWords: long });
  const quoted = ev.match(/own words: "([^"]*)"/)[1];
  assert.ok(quoted.length <= 401, `quoted ${quoted.length} chars`);
  assert.ok(/word\d+…$/.test(quoted), quoted.slice(-30));
});
check('the fact block asks for NAMED history in the first discussion question', () => {
  const f = buildAngleDirective('fact', { turnout: TURNOUT });
  assert.ok(/named event, invention, person, company or origin story/.test(f), f);
  assert.ok(/FIRST discussion question/.test(f), f);
  assert.ok(/Not a general observation/.test(f), f);
});
check('the fact block widens rule 1 for general knowledge only', () => {
  const f = buildAngleDirective('fact', { turnout: TURNOUT });
  assert.ok(f.includes('the material listed at the end') && /general knowledge/i.test(f), f);
  assert.ok(/never contradict/i.test(f), f);
});
check('the question block keeps the scoreboard out', () =>
  assert.ok(/no standings/i.test(buildAngleDirective('question', { turnout: TURNOUT }))));
check("an unknown angle says nothing", () => assert.strictEqual(buildAngleDirective('nonsense', {}), ''));

console.log('\n4. the editor shows the same house mix');
check('src/src/config/roundAngles.js carries the house weights the lambda draws with', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'src', 'config', 'roundAngles.js'), 'utf8');
  const shown = {};
  for (const m of src.matchAll(/key: '(\w+)'[^}]*?house: (\d+)/g)) shown[m[1]] = Number(m[2]);
  assert.deepStrictEqual(shown, { ...HOUSE_ANGLE_WEIGHTS });
  assert.ok(/ANGLE_GAME_TYPES = Object\.freeze\(\['call-and-answer'\]\)/.test(src), 'the editor offers angles for a different set of game types');
});

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
