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
  assert.deepStrictEqual(num('Across 99 contexts.'), ['99']));

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

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
