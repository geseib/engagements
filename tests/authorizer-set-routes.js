/**
 * THE SET ROUTES DO NOT FALL THROUGH — spec §9, review finding R3.
 *
 * After the named set routes, authorizer.js has two generic rules:
 * `path.includes('games')` and `path.includes('join'|'answer'|'vote')` — the
 * second returns [] and hasPermission([]) is TRUE. A set slugged
 * `callandanswer` or `partygames` satisfies them by accident. Every route
 * added under question-sets/ must be matched before them, by template AND by
 * regex, or it is open to every token holder including `pending`.
 */
const path = require('path');
const assert = require('assert');
const { requiredGroupsForRoute } = require(path.join(__dirname, '..', 'lambda-functions/auth/authorizer.js'));
let pass = 0; let fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; } };
console.log('\nauthorizer: the set routes\n');
const TRAPS = ['callandanswer', 'partygames', 'joinery', 'votes', 'answers2026'];
const ROUTES = [
  ['POST', 'question-sets/{setId}/check', (id) => `question-sets/${id}/check`],
  ['GET', 'question-sets/{setId}/check/{jobId}', (id) => `question-sets/${id}/check/m1abc-xyz_9`],
  ['POST', 'question-sets/{setId}/appeal', (id) => `question-sets/${id}/appeal`],
  ['POST', 'question-sets/{setId}/publish', (id) => `question-sets/${id}/publish`],
  ['DELETE', 'question-sets/{setId}/publish', (id) => `question-sets/${id}/publish`],
];
for (const [method, template, concrete] of ROUTES) {
  check(`${method} ${template} requires a group by template`, () =>
    assert.deepStrictEqual(requiredGroupsForRoute(method, template), ['hosts', 'admins']));
  for (const id of TRAPS) {
    check(`${method} ${concrete(id)} requires a group despite the id`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute(method, concrete(id)), ['hosts', 'admins'],
        'fell through to a generic includes() rule'));
  }
}
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
