#!/usr/bin/env node
/**
 * A ROUND NOBODY ANSWERED IS NOT A ROUND WHOSE ANSWERS EXPIRED.
 *
 * Review of test 32ac4eb4 (issue #35): round 4 was started, got no answers,
 * the session ended and the report was generated minutes later. Its
 * "Incomplete record" notice said round 004's responses had expired under the
 * seven-day retention. ANSWER rows live seven days, so a round younger than
 * that with none never had any. report-merge.js now asks the round's age.
 *
 *   node tests/report-empty-round-not-expired.js
 */
const path = require('path');
const { reconcileReport, mergeRound, answersCouldHaveExpired } = require(
  path.join(__dirname, '..', 'lambda-functions', 'game', 'report-merge.js')
);

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.log(`  FAIL  ${name}`); }
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-17T12:00:00Z');
const empty = (n) => ({ questionNumber: n, answers: [], voteStats: { totalAnswers: 0 } });
const answered = (n) => ({ questionNumber: n, answers: [{ answerText: 'x' }], voteStats: { totalAnswers: 1 } });

console.log('1. The age rule');
check('a round started minutes ago cannot have expired', answersCouldHaveExpired(new Date(now - 5 * 60000).toISOString(), now) === false);
check('six days old cannot have expired', answersCouldHaveExpired(now - 6 * DAY, now) === false);
check('seven days old could have', answersCouldHaveExpired(now - 7 * DAY, now) === true);
check('unknown age keeps the cautious answer', answersCouldHaveExpired(undefined, now) === true);
check('an unparseable time keeps the cautious answer', answersCouldHaveExpired('not a date', now) === true);

console.log('\n2. mergeRound');
check('young empty round, no snapshot: not unrecoverable', mergeRound(empty('004'), undefined, false).unrecoverable === false);
check('old empty round, no snapshot: unrecoverable', mergeRound(empty('004'), undefined, true).unrecoverable === true);
check('young empty round, empty snapshot: not unrecoverable', mergeRound(empty('004'), empty('004'), false).unrecoverable === false);
check('default (no age given) is unchanged: unrecoverable', mergeRound(empty('004'), undefined).unrecoverable === true);

console.log('\n3. The #35 report: three answered rounds and a fresh empty one');
const rebuilt = { detailedQuestions: [answered('001'), answered('002'), answered('003'), empty('004')], playerPerformance: [], gameStats: {} };
const startedAt = { '001': now - 40 * 60000, '002': now - 30 * 60000, '003': now - 20 * 60000, '004': now - 5 * 60000 };
const fresh = reconcileReport(null, rebuilt, { answersMayHaveExpired: (n) => answersCouldHaveExpired(startedAt[n], now) });
check('the report is complete', fresh.completeness.complete === true);
check('no round is listed as unrecoverable', fresh.completeness.unrecoverableRounds.length === 0);
check('and there is no "expired" note', !fresh.completeness.note);
check('round 004 is still in the report', fresh.detailedQuestions.some((r) => r.questionNumber === '004'));

console.log('\n4. The genuine case still reports');
const old = reconcileReport(null, rebuilt, { answersMayHaveExpired: (n) => answersCouldHaveExpired(now - 10 * DAY, now) });
check('a ten-day-old empty round is unrecoverable', old.completeness.unrecoverableRounds.join() === '004');
check('with the expired note', /expired/.test(old.completeness.note || ''));
const noAge = reconcileReport(null, rebuilt);
check('a caller that passes no age keeps the old behaviour', noAge.completeness.unrecoverableRounds.join() === '004');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
