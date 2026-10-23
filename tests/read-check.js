/**
 * WORKIE'S AFTER-WRITING CHECK, ON ITS OWN — lambda-functions/game/read-check.js.
 *
 * Review #38 (test, session 7360, round 1): the read said "run one Friday with
 * a 15-minute hold" when no input held fifteen minutes, and "the strongest
 * resistance" when the vote never measured strength. The fixture below is that
 * round's four answers, exactly. docs/design/workie-grounding/STEP0.md.
 *
 * rejects: an invented number passed; a number the material holds flagged
 * (4pm, Friday, two branches, nine-branch); "15-minute" and "fifteen minutes"
 * read as different claims; "strongest" passed; "unanimous" passed when the
 * points were split, or flagged when they were not; a voice's own catchphrase
 * flagged; a decided-sounding next step passed, or a **Suggested** one
 * flagged; a name stored in a token; one filler word on a clean read reported;
 * "one question" read as a number; a revision note that is not the exact text.
 *
 * Review #46 (test cb30e35d, the same four answers): "two Friday runs" or
 * "two-week" passed because "two branches" holds a two; "Whoever runs the
 * weekly release" (the prompt's own example) passed as an owner; "the current
 * habit is to…" passed as a fact; "Route lead: count…" passed as a step. Also
 * rejects: "two branches", "4pm Friday", a named role or the fixture's plain
 * sentences flagged.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const { checkRead, collectMaterial, revisionNote, issueKinds } = require(path.join(__dirname, '..', 'lambda-functions/game/read-check.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`  PASS  ${label}`); } catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

// ---- the #38 fixture ---------------------------------------------------------
const ANSWERS = {
  Maya: "Keep the pilot to Friday's return route until every transfer has an acknowledged receiver. Growth sponsors will object to delaying nine-branch coverage.",
  Theo: "At Friday's van departure, unacknowledged returns stay coordinator-owned. The route lead objects because waiting can break the next branch's pickup slot.",
  Lena: "At Friday van departure, an unacknowledged return stays coordinator-owned. The driver objects: waiting can strand the next branch's booked stop.",
  Omar: "Stop van loading if returns lack an acknowledged owner at 4pm Friday. The route lead objects: a missed departure strands two branches.",
};
const NAMES = Object.keys(ANSWERS);
const responsesText = NAMES.map((n, i) => `${['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place', '4th Place'][i]}: ${n} - "${ANSWERS[n]}" (${[12, 8, 4, 0][i]} vote points)`).join('\n\n');
const MATERIAL = collectMaterial({
  questionInfo: 'Question: What should the Friday pilot hold on?',
  responsesText, responseCount: 4, voteCount: 4, consensusLevel: 'Mixed opinions',
  contextInstructions: 'IMPORTANT: tailor your analysis to 99 contexts', // an instruction, not material
}, ['Transfer pilot, branch network']);
const SPLIT = { points: [12, 8, 4, 0], rankCount: 4, votes: 4, answered: 4, joined: 4, round: 1, consensus: 'Mixed opinions', names: NAMES };
const VOICE = 'A plain-spoken transfer reader. Says "no fluff" and reads the room back.';

const ISSUE_38 = [
  '## What we heard',
  'Four answers hold the line at Friday van departure. Omar names 4 pm; a missed departure strands two branches, and nine-branch coverage waits.',
  'The strongest resistance came from the route lead.',
  '',
  '## Next steps',
  '1. The route lead: run one Friday with a 15-minute hold on departure for unacknowledged returns.',
].join('\n');

const tokens = (r, kind) => r.issues.filter((i) => !kind || i.kind === kind).map((i) => i.token);

console.log('\n1. the #38 read');
const r38 = checkRead({ read: ISSUE_38, material: MATERIAL, vote: SPLIT, voice: VOICE });
check('"15-minute" is flagged as a number not in the material', () => assert.deepStrictEqual(tokens(r38, 'number'), ['15-minute']));
check('"4 pm" (material says 4pm), Friday, two branches and nine-branch are not', () => {
  for (const t of tokens(r38)) assert.ok(!/4\s?pm|friday|two branches|nine-branch/i.test(t), t);
});
check('"strongest" is flagged as a claim the vote does not show', () => assert.deepStrictEqual(tokens(r38, 'claim'), ['strongest']));
check('the list marker "1." is layout, not a number', () => assert.ok(!tokens(r38).includes('1')));

console.log('\n2. numbers: forms and words');
const num = (read, vote = SPLIT) => tokens(checkRead({ read, material: MATERIAL, vote, voice: VOICE }), 'number');
check('"15 minutes" and "fifteen minutes" are flagged like "15-minute"', () => {
  assert.deepStrictEqual(num('Hold for 15 minutes.'), ['15 minutes']);
  assert.deepStrictEqual(num('Hold for fifteen minutes.'), ['fifteen minutes']);
});
check('30%, $200, 5x and 6 weeks are flagged when the material lacks them', () => {
  assert.deepStrictEqual(num('Cut 30% and save $200, 5x faster, in 6 weeks.'), ['30%', '$200', '5x', '6 weeks']);
});
check('number words with a unit are flagged ("two weeks" when 2 is absent)', () => {
  const vote = { ...SPLIT, points: [9, 5, 1, 0], votes: 3, answered: 3, joined: 3 };
  const mat = collectMaterial({ responsesText: 'A "Stop at departure" (9 vote points)' });
  assert.deepStrictEqual(tokens(checkRead({ read: 'Try it for two weeks.', material: mat, vote }), 'number'), ['two weeks']);
});
check('a number the material holds as a word is allowed as a digit ("9 branches" ← nine-branch)', () =>
  assert.deepStrictEqual(num('All 9 branches wait.'), []));
check('the printed counts and points are allowed (12 points, 4 answered, 4 voted)', () =>
  assert.deepStrictEqual(num('The top answer took 12 points; 4 answered and 4 voted, 8 for second.'), []));
check('round numbers and rank ordinals the ranking has are allowed ("Round 1", "2nd", "4th")', () =>
  assert.deepStrictEqual(num('In Round 1 the 2nd and 4th answers split.'), []));
check('an ordinal past the ranking is flagged ("9th" of four is fine only because nine is in the material; "7th" is not)', () =>
  assert.deepStrictEqual(num('It came 7th.'), ['7th']));
check('"one question", "one answer", "a week" are prose, not numbers', () =>
  assert.deepStrictEqual(num('One question for the room, one answer that stood out, and a week to try it.'), []));
check('"4:30pm" is flagged, "4pm"/"4 pm" are not', () => {
  assert.deepStrictEqual(num('Stop at 4pm, or 4 pm.'), []);
  assert.deepStrictEqual(num('Stop at 4:30pm.'), ['4:30pm']);
});
check('a number only in a fixed instruction (contextInstructions) is not material', () =>
  // The token carries the noun the number counts (review #46: numbers are unit-aware).
  assert.deepStrictEqual(num('Across 99 contexts.'), ['99 contexts']));

console.log('\n3. claims about the room');
const claims = (read, vote = SPLIT, voice = VOICE) => tokens(checkRead({ read, material: MATERIAL, vote, voice }), 'claim');
const ONE = { ...SPLIT, points: [12, 0, 0, 0], consensus: 'Strong consensus' };
const STRONG = { ...SPLIT, points: [12, 3, 1, 0], consensus: 'Strong consensus' };
check('"unanimous", "everyone" and "all agreed" are flagged on a split vote', () =>
  assert.deepStrictEqual(claims('A unanimous call: everyone liked it, all agreed.'), ['unanimous', 'all agreed', 'everyone']));
check('…and allowed when every point went to one answer', () =>
  assert.deepStrictEqual(claims('A unanimous call: everyone liked it, all agreed.', ONE), []));
check('"unanimous" is still flagged on a strong-but-not-total vote', () =>
  assert.deepStrictEqual(claims('A unanimous call.', STRONG), ['unanimous']));
check('"consensus", "clear winner", "decisive" and "the room agreed" need Strong consensus', () => {
  assert.deepStrictEqual(claims('A consensus, a clear winner, a decisive vote: the room agreed.'),
    ['consensus', 'the room agreed', 'clear winner', 'decisive']);
  assert.deepStrictEqual(claims('A consensus, a clear winner, a decisive vote: the room agreed.', STRONG), []);
});
check('"strongest" is never supported by a ranking, even a unanimous one', () =>
  assert.deepStrictEqual(claims('The strongest answer.', ONE), ['strongest']));
check('negated claims pass ("no consensus", "not unanimous")', () =>
  assert.deepStrictEqual(claims('There was no consensus, and it was not unanimous.'), []));
check('a word in the voice text is exempt (a catchphrase)', () =>
  assert.deepStrictEqual(claims('Strongest signal wins!', SPLIT, 'Coach voice. Catchphrase: "strongest signal wins".'), []));
check('a quoted answer\'s own words are the room\'s, not a claim', () => {
  const mat = collectMaterial({ responsesText: '"Everyone stays until the van leaves" (5 vote points)' });
  assert.deepStrictEqual(tokens(checkRead({ read: 'One answer: "Everyone stays until the van leaves".', material: mat, vote: SPLIT }), 'claim'), []);
});

console.log('\n4. next steps written as decided');
const commits = (read) => checkRead({ read, material: MATERIAL, vote: SPLIT, voice: VOICE }).issues.filter((i) => i.kind === 'commitment');
const STEPS = (...items) => `## Summary\nThe room split.\n\n## Next steps\n${items.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
check('"The route lead will run…" is flagged, with the role kept in the token', () => {
  const c = commits(STEPS('The route lead will run the Friday pilot.'));
  assert.deepStrictEqual(c.map((i) => i.token), ['The route lead will run']);
});
check('"Theo will draft…" is flagged and the name stays out of the token (but in the note\'s quote)', () => {
  const c = commits(STEPS('Theo will draft the receiver list.', 'Omar has agreed to own the 4pm cut-off.', 'Lena is responsible for checking.'));
  assert.deepStrictEqual(c.map((i) => i.token), ['will draft', 'has agreed to own', 'is responsible for checking']);
  for (const i of c) for (const n of NAMES) assert.ok(!i.token.includes(n), i.token);
  assert.strictEqual(c[0].quote, 'Theo will draft');
});
check('"owns" and "commits to" are flagged', () =>
  assert.deepStrictEqual(commits(STEPS('The coordinator owns every return.', 'The driver commits to waiting.')).map((i) => i.token),
    ['The coordinator owns every', 'The driver commits to waiting']));
check('a step starting **Suggested**, or with could/might/may, passes', () =>
  assert.deepStrictEqual(commits(STEPS('**Suggested:** the route lead will run one Friday.', 'The route lead could run one Friday.', 'Theo might draft it.', 'The driver may wait.')), []));
check('outside Next steps the same words are not a commitment', () =>
  assert.deepStrictEqual(commits('## Summary\nTheo will draft it, the answers say.'), []));
check('"The pilot will show…" is not a person or a role', () =>
  assert.deepStrictEqual(commits(STEPS('The pilot will show whether waiting works.')), []));

console.log('\n5. filler: low weight');
const fill = (read) => checkRead({ read, material: MATERIAL, vote: SPLIT, voice: VOICE }).issues;
check('one or two filler words on an otherwise clean read are not reported', () =>
  assert.deepStrictEqual(fill('A powerful idea and a crucial point.'), []));
check('three filler words are reported', () =>
  assert.deepStrictEqual(fill('A powerful, crucial, transformative idea.').map((i) => i.token), ['powerful', 'crucial', 'transformative']));
check('filler rides along when another issue already triggers a rewrite', () =>
  assert.deepStrictEqual(issueKinds(fill('A powerful 15-minute hold.')), { number: 1, filler: 1 }));
check('a filler word in the voice is exempt', () =>
  assert.deepStrictEqual(checkRead({ read: 'An amazing, powerful, crucial run.', material: MATERIAL, vote: SPLIT, voice: 'Says "amazing" a lot.' }).issues, []));

console.log('\n6. the revision note');
check('the note is the exact text, one line per issue', () => {
  const note = revisionNote([
    { kind: 'number', token: '15-minute' },
    { kind: 'claim', token: 'strongest' },
    { kind: 'commitment', token: 'The route lead will run', quote: 'The route lead will run' },
  ]);
  assert.strictEqual(note, [
    'Revise your reply. Change only these, keep everything else, keep the headings:',
    '- "15-minute" is not in the material: remove it, or use a number the material contains.',
    '- "strongest" is not something the vote shows: say what it shows instead (for example, "named by three answers").',
    '- "The route lead will run…" is written as decided: the room has not agreed; make it a suggestion starting **Suggested**.',
  ].join('\n'));
});
check('a clean read has no issues', () =>
  assert.deepStrictEqual(checkRead({ read: '## What we heard\nThree of four answers keep returns coordinator-owned at Friday departure; the top one took 12 points.\n\n## Next steps\n1. **Suggested:** try one Friday and see who acknowledges.', material: MATERIAL, vote: SPLIT, voice: VOICE }).issues, []));

// ---- review #46 (test cb30e35d, the same four answers) -----------------------
console.log('\n7. #46: numbers carry their unit or noun');
const ROUTE = 'Route lead: count how many pickup slots slip over the next two Friday runs when a return is held at the van.';
const GROWTH = "Growth sponsors: list the branches that would lose coverage under a two-week pilot held to Friday's return route.";
check('"two Friday runs" is flagged: the material\'s two counts branches, not runs', () =>
  assert.deepStrictEqual(num(ROUTE), ['two Friday runs']));
check('"two-week" is flagged: no answer holds two weeks', () =>
  assert.deepStrictEqual(num(GROWTH), ['two-week']));
check('"two branches", "2 branches" and "nine-branch coverage" are the material\'s', () =>
  assert.deepStrictEqual(num('A missed departure strands two branches (2 branches), and nine-branch coverage waits.'), []));
check('"4pm Friday" and "4 pm" are the material\'s clock', () =>
  assert.deepStrictEqual(num('Stop loading at 4pm Friday, or 4 pm.'), []));
check('"two weeks" ≈ "two-week" when the material holds two weeks', () => {
  const mat = collectMaterial({ responsesText: 'Theo - "Run it for two weeks first" (8 vote points)' });
  assert.deepStrictEqual(tokens(checkRead({ read: 'A two-week pilot, then 2 weeks of review.', material: mat, vote: SPLIT }), 'number'), []);
});
check('a count licenses a headcount, not a duration ("4 people" yes, "4 weeks" no)', () =>
  assert.deepStrictEqual(num('4 people answered; try it for 4 weeks.'), ['4 weeks']));
check('counts of the room\'s own things stay allowed ("three answers", "4 answers", "12 points")', () =>
  assert.deepStrictEqual(num('Named by three answers; all 4 answers, 12 points at the top, 8 points second.'), []));
check('a bare number keeps the by-value rule ("two of the four")', () =>
  assert.deepStrictEqual(num('Two of the four answers keep returns with the coordinator.'), []));

console.log('\n8. #46: owners the answers never named');
const INSTRUCTIONS = 'Rule 11. The owner is a person named in the material, or the role an answer implies, '
  + 'for example whoever runs the weekly release, whoever owns that wiki page.';
const owners = (read, instructions = INSTRUCTIONS) => checkRead({ read, material: MATERIAL, vote: SPLIT, voice: VOICE, instructions })
  .issues.filter((i) => i.kind === 'owner');
const RELEASE = 'Whoever runs the weekly release: book paid cover for that rehearsal before any dashboard work is scheduled.';
check('"Whoever runs the weekly release" is flagged as an owner the answers never named', () => {
  const o = owners(STEPS(`**Suggested** ${RELEASE}`));
  assert.deepStrictEqual(o.map((i) => i.token), ['Whoever runs the weekly release']);
});
check('…and flagged as leaked from the prompt even when its head noun is in the material', () => {
  const mat = collectMaterial({ responsesText: `${responsesText}\n\nA release slips when the van is late. (0 vote points)` });
  const o = checkRead({ read: STEPS(`**Suggested** ${RELEASE}`), material: mat, vote: SPLIT, instructions: INSTRUCTIONS })
    .issues.filter((i) => i.kind === 'owner');
  assert.strictEqual(o.length, 1);
  assert.match(o[0].why, /prompt/);
  // Without the prompt text the head noun grounds it.
  assert.strictEqual(checkRead({ read: STEPS(`**Suggested** ${RELEASE}`), material: mat, vote: SPLIT })
    .issues.filter((i) => i.kind === 'owner').length, 0);
});
check('"Route lead", "Growth sponsors", "The driver", "Coordinator" and a printed name are owners the answers name', () =>
  assert.deepStrictEqual(owners(STEPS(
    `**Suggested** ${ROUTE.replace('two Friday runs', 'next Friday run')}`,
    '**Suggested** Growth sponsors: list the branches that would lose coverage.',
    '**Suggested:** The driver: note each booked stop that waits.',
    '**Suggested** Coordinator: keep the unacknowledged returns.',
    '**Suggested** Omar: write down the 4pm cut-off.',
  )), []));
check('an invented role is flagged ("Release manager:"), the host is always an owner', () =>
  assert.deepStrictEqual(owners(STEPS('**Suggested** Release manager: book cover.', '**Suggested** Host: ask the room once more.')).map((i) => i.token),
    ['Release manager']));
check('a colon heading that is not a person ("Timing:", "First step:") is not an owner', () =>
  assert.deepStrictEqual(owners(STEPS('**Suggested** Timing: hold it to Friday.', '**Suggested** First step: ask the route lead.')), []));
check('an owner token never carries a participant\'s name', () => {
  const o = checkRead({ read: STEPS('**Suggested** Priya and Theo: draft it.'), material: MATERIAL, vote: { ...SPLIT, names: [...NAMES, 'Priya'] } })
    .issues.filter((i) => i.kind === 'owner');
  assert.strictEqual(o.length, 1);
  for (const n of [...NAMES, 'Priya']) assert.ok(!o[0].token.includes(n), o[0].token);
  assert.strictEqual(o[0].quote, 'Priya and Theo');
});

console.log('\n9. #46: what the organisation already does');
const practice = (read) => checkRead({ read, material: MATERIAL, vote: SPLIT, voice: VOICE }).issues.filter((i) => i.kind === 'practice');
const HABIT = 'Two answers put the rehearsal before the dashboard, which signals that the current habit is to build visible tooling first.';
check('the habit sentence is flagged as practice', () => {
  const p = practice(`## What we heard\n${HABIT}`);
  assert.deepStrictEqual(p.map((i) => i.token), ['signals that the current habit is to']);
  assert.strictEqual(p[0].quote, 'signals that the current habit is to build visible tooling first');
});
check('"currently", "as usual", "already has" and "the existing practice" are flagged', () =>
  assert.deepStrictEqual(practice('The depot currently loads at four. As usual, the van leaves early. The network already has a rota. The existing practice is to wait.').map((i) => i.token),
    ['currently', 'As usual', 'already has', 'The existing practice is']));
check('…unless an answer says the same thing', () => {
  const mat = collectMaterial({ responsesText: 'Theo - "We currently load the van before every return is acknowledged" (8 vote points)' });
  assert.deepStrictEqual(checkRead({ read: 'The depot currently loads the van before returns are acknowledged.', material: mat, vote: SPLIT })
    .issues.filter((i) => i.kind === 'practice'), []);
});
check('"the second answer already has a fix" is about an answer, not the organisation', () =>
  assert.deepStrictEqual(practice('The second answer already has a fix for the van.'), []));

console.log('\n10. #46: steps handed out as tasks');
check('a bare "Owner: verb …" step is flagged as a commitment; "**Suggested** Owner: verb …" passes', () => {
  const c = commits(STEPS('Route lead: count the pickup slots that slip.', '**Suggested** Route lead: count the pickup slots that slip.', 'Growth sponsors: list the branches.'));
  assert.deepStrictEqual(c.map((i) => i.token), ['Route lead: count', 'Growth sponsors: list']);
});
check('a step with could/might/may passes ("Route lead: could count…")', () =>
  assert.deepStrictEqual(commits(STEPS('Route lead: could count the slots that slip.', 'The driver: you might note each stop.')), []));
check('the #46 next steps, as written, are all flagged', () => {
  const r = checkRead({ read: STEPS(ROUTE, GROWTH, RELEASE), material: MATERIAL, vote: SPLIT, voice: VOICE, instructions: INSTRUCTIONS });
  assert.deepStrictEqual(issueKinds(r.issues), { number: 2, owner: 1, commitment: 3 });
});

console.log('\n11. no false positives on the fixture\'s plain sentences');
check('plain sentences built from the four answers pass', () => {
  const read = [
    '## What we heard',
    'Three of four answers keep an unacknowledged return coordinator-owned at Friday van departure; the top one took 12 points.',
    'Omar would stop van loading at 4pm Friday. The route lead objects that a missed departure strands two branches.',
    'The driver objects that waiting can strand the next branch\'s booked stop, and growth sponsors will object to delaying nine-branch coverage.',
    '',
    '## Next steps',
    '1. **Suggested** Route lead: list which pickup slots a Friday hold would move.',
    '2. **Suggested** Coordinator: keep each unacknowledged return until a receiver acknowledges it.',
    '3. **Suggested** Growth sponsors: say which of the nine branches can wait.',
  ].join('\n');
  assert.deepStrictEqual(checkRead({ read, material: MATERIAL, vote: SPLIT, voice: VOICE, instructions: INSTRUCTIONS }).issues, []);
});

console.log('\n12. the revision note for the new kinds');
check('owner and practice lines are the exact text', () => {
  assert.strictEqual(revisionNote([
    { kind: 'owner', token: 'Whoever runs the weekly release' },
    { kind: 'practice', token: 'signals that the current habit is to', quote: 'signals that the current habit is to build visible tooling first' },
    { kind: 'commitment', token: 'Route lead: count', quote: 'Route lead: count' },
  ]), [
    'Revise your reply. Change only these, keep everything else, keep the headings:',
    '- "Whoever runs the weekly release" is an owner the answers never named: use a person or a role an answer names.',
    '- "signals that the current habit is to build visible tooling first" says what the organisation already does; the answers only propose it: say it as their proposal.',
    '- "Route lead: count…" is written as decided: the room has not agreed; make it a suggestion starting **Suggested**.',
  ].join('\n'));
});

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
