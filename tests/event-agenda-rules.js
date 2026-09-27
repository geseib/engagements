/**
 * THE AGENDA'S RULES — lambda-functions/websocket/events/agenda-rules.js.
 *
 * One file decides the caps, the planned times and an event's lifetime, and
 * both the item route and the console's builder read it. So a rule pinned
 * here is pinned on both sides of the wire.
 *
 * The times fixture is the design's own agenda (docs/design/agenda-redesign/
 * _src/content.py): a 9:00 start, lengths 8, 30, 15, 20, a 15-minute break,
 * 35, 12, 20 and 8 — planned to end at 11:43, "2 h 43 min planned".
 *
 * rejects: a 17th item or a 9th engagement admitted; a break counted toward
 * either cap; a reorder that leaves a time where it was; an unreal date or
 * clock accepted; an event kept for a fixed 90 days from creation (an event
 * booked for next month would vanish before its day); a module the browser
 * cannot import (a require or a process read); the type aliases drifting from
 * game-types.js.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const FILE = path.join(REPO, 'lambda-functions/websocket/events/agenda-rules.js');
const R = require(FILE);

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const DAY = 24 * 60 * 60;

console.log('\n1. the caps: 16 items, 8 of them engagements, breaks count for nothing');
check('the numbers are the owner\'s', () => {
  assert.strictEqual(R.MAX_ITEMS, 16);
  assert.strictEqual(R.MAX_ENGAGEMENTS, 8);
});
check('a break counts toward neither cap', () =>
  assert.deepStrictEqual(R.countItems([{ type: 'trivia' }, { type: 'break' }, { Type: 'poll' }, { type: 'presentation' }]),
    { items: 3, engagements: 2, breaks: 1 }));
check('the 16th item is allowed', () =>
  assert.strictEqual(R.capRefusal({ items: 15, engagements: 7 }, 'trivia'), null));
check('a 17th item is refused with the sentence', () =>
  assert.deepStrictEqual(R.capRefusal({ items: 16, engagements: 7 }, 'trivia'),
    { cap: 'items', message: R.CAP_SENTENCES.items }));
check('a 9th engagement is refused while a 9th presentation is allowed', () => {
  assert.deepStrictEqual(R.capRefusal({ items: 8, engagements: 8 }, 'poll'),
    { cap: 'engagements', message: R.CAP_SENTENCES.engagements });
  assert.strictEqual(R.capRefusal({ items: 8, engagements: 8 }, 'presentation'), null);
});
check('a break is allowed at both caps', () =>
  assert.strictEqual(R.capRefusal({ items: 16, engagements: 8, breaks: 3 }, 'break'), null));
check('breaks have a ceiling of their own', () =>
  assert.strictEqual(R.capRefusal({ breaks: R.MAX_BREAKS }, 'break').cap, 'breaks'));
check('the refusal names the limit in the builder\'s words', () =>
  assert.strictEqual(R.CAP_SENTENCES.engagements,
    'This event has 8 engagements, the most one can hold. Remove one to add another.'));

console.log('\n2. the times follow the order');
const DESIGN = [8, 30, 15, 20, 15, 35, 12, 20, 8].map((minutes, i) => ({ id: `i${i}`, minutes }));
check('the design\'s agenda starts where the mockup says', () => {
  const { rows, endsAt, totalMinutes } = R.agendaTimes('2026-10-09T09:00', DESIGN);
  assert.deepStrictEqual(rows.map((r) => r.at),
    ['9:00', '9:08', '9:38', '9:53', '10:13', '10:28', '11:03', '11:15', '11:35']);
  assert.strictEqual(rows[4].until, '10:28');
  assert.strictEqual(endsAt, '11:43');
  assert.strictEqual(R.formatDuration(totalMinutes), '2 h 43 min');
});
check('moving an item moves every time after it, and nothing before', () => {
  const moved = [DESIGN[0], DESIGN[3], DESIGN[2], DESIGN[1], ...DESIGN.slice(4)];
  const { rows, endsAt } = R.agendaTimes('2026-10-09T09:00', moved);
  assert.deepStrictEqual(rows.slice(0, 4).map((r) => r.at), ['9:00', '9:08', '9:28', '9:43']);
  assert.strictEqual(endsAt, '11:43');
});
check('Minutes (a stored row) works as well as minutes', () =>
  assert.strictEqual(R.agendaTimes('2026-10-09T13:30', [{ Minutes: 45 }]).endsAt, '14:15'));
check('an agenda that runs past midnight wraps the clock', () =>
  assert.strictEqual(R.agendaTimes('2026-10-09T23:30', [{ minutes: 45 }]).endsAt, '0:15'));
check('under an hour reads in minutes', () => assert.strictEqual(R.formatDuration(45), '45 min'));

console.log('\n3. a start is a real day and a real clock');
check('a real start parses', () =>
  assert.deepStrictEqual(R.parseStartsAt('2026-10-09T09:00'), { y: 2026, mo: 10, d: 9, h: 9, mi: 0 }));
for (const bad of ['2026-02-30T09:00', '2026-10-09 09:00', '2026-10-09T24:00', '2026-10-09T09:60', '9:00', '', null]) {
  check(`${JSON.stringify(bad)} is refused`, () => assert.strictEqual(R.parseStartsAt(bad), null));
}
check('9 Oct 2026 is a Friday', () => {
  assert.strictEqual(R.formatEventDay('2026-10-09T09:00'), 'Fri 9 Oct 2026');
  assert.strictEqual(R.formatEventWhen('2026-10-09T09:00'), 'Fri 9 Oct · 9:00');
  assert.strictEqual(R.formatStartTime('2026-10-09T13:05'), '13:05');
});

console.log('\n4. an event is kept 90 days after its day, never less than 90 from now');
const NOW = Date.UTC(2026, 8, 26, 12, 0) / 1000;           // 26 Sep 2026, 12:00 UTC
check('a future event: two days after its date, plus 90', () =>
  assert.strictEqual(R.eventTtl('2026-10-09T09:00', NOW), Date.UTC(2026, 9, 11) / 1000 + 90 * DAY));
// rejects: session-ttl's creation clock — an event booked for next month
// would expire weeks after its own day, or before it for one booked far ahead.
check('an event months ahead outlives its day by the full 90', () =>
  assert.ok(R.eventTtl('2027-06-01T09:00', NOW) > Date.UTC(2027, 5, 1) / 1000 + 89 * DAY));
check('an event dated in the past is kept 90 days from now', () =>
  assert.strictEqual(R.eventTtl('2026-01-01T09:00', NOW), NOW + 90 * DAY));
check('the day after the date has ended everywhere on Earth', () =>
  assert.ok(R.eventTtl('2026-10-09T23:59', NOW) - 90 * DAY > Date.UTC(2026, 9, 10, 11, 59) / 1000));

console.log('\n5. the details a host types');
const GOOD = { title: '  Q4 Kickoff ', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London' };
check('good details come back trimmed, open, reports Full', () =>
  assert.deepStrictEqual(R.checkEventFields(GOOD, { nowSeconds: NOW }).value,
    { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London', access: 'open', attendeeReports: 'full' }));
for (const [label, patch, error] of [
  ['no name', { title: ' ' }, /name/],
  ['no start', { startsAt: '2026-10-09' }, /date and a start/],
  ['an unknown zone', { timeZone: 'Mars/Base' }, /time zone/],
  ['invite-only, before Phase 3', { access: 'invite' }, /Invite-only events are not available yet/],
  ['an unknown access', { access: 'private' }, /who can join/],
  ['an unknown report default', { attendeeReports: 'some' }, /each report/],
  ['a date more than a year out', { startsAt: '2028-01-01T09:00' }, /within the next year/],
  ['a 121-character name', { title: 'x'.repeat(121) }, /120 characters/],
]) {
  check(`${label} is refused`, () =>
    assert.match(R.checkEventFields({ ...GOOD, ...patch }, { nowSeconds: NOW }).error || '', error));
}
check('an item needs a title, unless it is a break', () => {
  assert.match(R.checkItemFields({ minutes: 10 }, 'trivia').error, /title/);
  assert.deepStrictEqual(R.checkItemFields({ minutes: 10 }, 'break').value,
    { title: 'Break', description: '', minutes: 10 });
});
for (const minutes of [0, 241, 2.5, 'fifteen', null]) {
  check(`a length of ${JSON.stringify(minutes)} is refused`, () =>
    assert.match(R.checkItemFields({ title: 'x', minutes }, 'trivia').error || '', /whole number of minutes/));
}

console.log('\n6. which kinds exist, and which may be added now');
check('every kind may be added: five engagements, a presentation, an activity and a break', () => {
  assert.deepStrictEqual([...R.ITEM_TYPES],
    ['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey', 'presentation', 'custom', 'break']);
  assert.strictEqual(R.ADDABLE_TYPES, undefined);
  assert.strictEqual(R.COMING_SOON, undefined);
});
check('an activity is called Activity, and counts as an item, never an engagement', () => {
  assert.strictEqual(R.TYPE_LABELS.custom, 'Activity');
  assert.deepStrictEqual(R.countItems([{ type: 'custom' }, { type: 'presentation' }, { type: 'trivia' }]),
    { items: 3, engagements: 1, breaks: 0 });
  assert.strictEqual(R.capRefusal({ items: 15, engagements: 8 }, 'custom'), null);
  assert.strictEqual(R.capRefusal({ items: 16, engagements: 8 }, 'custom').cap, 'items');
});
check('who leads an item, by kind', () => {
  for (const t of ['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']) assert.strictEqual(R.ledByLabel(t), 'Facilitator', t);
  assert.strictEqual(R.ledByLabel('presentation'), 'Presenter');
  assert.strictEqual(R.ledByLabel('custom'), 'Led by');
  assert.strictEqual(R.ledByLabel('break'), '');
  assert.ok(!R.hasLeader('break') && R.hasLeader('custom') && R.hasLeader('poll') && !R.hasLeader('party'));
});
check('a name is optional, trimmed and capped; a break carries none', () => {
  assert.deepStrictEqual(R.checkLedBy('  Marcus Oyelaran ', 'presentation'), { value: 'Marcus Oyelaran' });
  assert.deepStrictEqual(R.checkLedBy(undefined, 'custom'), { value: '' });
  assert.match(R.checkLedBy('x'.repeat(81), 'custom').error, /80 characters/);
  assert.match(R.checkLedBy('Sam', 'break').error, /not led by anyone/);
  assert.deepStrictEqual(R.checkLedBy('', 'break'), { value: '' });
  assert.strictEqual(R.LED_BY_MAX, 80);
});
check('a set row\'s type reads as an engagement type, old spellings included', () => {
  assert.strictEqual(R.canonicalSetType('quiz'), 'trivia');
  assert.strictEqual(R.canonicalSetType('callandanswer'), 'call-and-answer');
  assert.strictEqual(R.canonicalSetType(undefined), 'call-and-answer');
  assert.strictEqual(R.canonicalSetType('banana'), '');
});
check('the aliases are game-types.js\'s, both copies', () => {
  for (const rel of ['lambda-functions/game/game-types.js', 'lambda-functions/admin/shared/game-types.js']) {
    assert.deepStrictEqual({ ...R.TYPE_ALIASES }, { ...require(path.join(REPO, rel)).ALIASES }, rel);
  }
});

console.log('\n8. what an engagement item carries of its session');
check('the options each format has, in the create dialog\'s own names', () => {
  assert.deepStrictEqual(R.settingKeysFor('trivia'), ['randomizeQuestions', 'categoryIds', 'target', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('wavelength'), R.settingKeysFor('trivia'));
  assert.deepStrictEqual(R.settingKeysFor('poll'), ['anonymousResponses', 'randomizeQuestions', 'categoryIds', 'target', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('call-and-answer'), ['anonymousResponses', 'randomizeQuestions', 'categoryIds', 'target', 'briefing', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('survey'), ['names', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  for (const t of ['presentation', 'custom', 'break']) assert.deepStrictEqual(R.settingKeysFor(t), [], t);
});
check('untouched options are the create dialog\'s defaults, and never share an array', () => {
  const a = R.settingsFor('trivia', {});
  a.categoryIds.push('x');
  assert.deepStrictEqual(R.settingsFor('trivia', {}).categoryIds, []);
  assert.deepStrictEqual(R.settingsFor('survey'), { names: 'anonymous', personaId: '', promptId: '', aiContext: '', eventDetails: '' });
});
check('a key the format does not have is dropped, not carried', () =>
  assert.ok(!('briefing' in R.settingsFor('trivia', { briefing: { text: 'x' } }))));
check('an item becomes the create dialog\'s payload, its pinned version beside it', () =>
  assert.deepStrictEqual(R.sessionFormOf({
    type: 'survey', title: 'Pulse', ledBy: 'Sam', description: 'Five questions.',
    setRef: { scope: 'platform', orgId: '', setId: 'kickoff', version: 3 }, settings: { names: 'named' },
  }), {
    title: 'Pulse', gameType: 'survey', setId: 'kickoff', setScope: 'platform', setVersion: 3,
    names: 'named', personaId: '', promptId: '', aiContext: '', eventDetails: '',
  }));

console.log('\n7. the browser can import it');
check('no require and no process in the code (comments aside)', () => {
  const code = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\brequire\s*\(/.test(code), 'it requires something');
  assert.ok(!/\bprocess\./.test(code), 'it reads process');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
