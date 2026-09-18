/**
 * THE STAFF ROUTES ARE NAMED, NOT PREFIXED — spec §9.
 * `admin/moderation/{sk}` carries a set id inside its last segment (percent-
 * encoded `org_x%23callandanswer%23v2`), so a generic includes('answer') rule
 * would decide it before an unnamed route could. Every route here must return
 * ['admins'] by template AND by regex over such a path.
 */
const path = require('path');
const assert = require('assert');
const { requiredGroupsForRoute } = require(path.join(__dirname, '..', 'lambda-functions/auth/authorizer.js'));
let pass = 0; let fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; } };
console.log('\nauthorizer: the staff routes\n');
const CASES = [
  ['GET', 'admin/moderation', ['admin/moderation']],
  ['GET', 'admin/moderation/{sk}', ['admin/moderation/org_x%23callandanswer%23v2', 'admin/moderation/PUBLIC%23partygames', 'admin/moderation/org_x%23joinery%23v1']],
  ['POST', 'admin/moderation/decide', ['admin/moderation/decide']],
  ['GET', 'admin/public-library/{publicSetId}', ['admin/public-library/orgx-callandanswer', 'admin/public-library/orgx-votes']],
  ['DELETE', 'admin/public-library/{publicSetId}', ['admin/public-library/orgx-partygames']],
];
for (const [method, template, concretes] of CASES) {
  check(`${method} ${template} is staff-only by template`, () => assert.deepStrictEqual(requiredGroupsForRoute(method, template), ['admins']));
  for (const p of concretes) {
    check(`${method} ${p} is staff-only despite the id`, () => assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['admins'], 'fell through to a generic rule'));
  }
}
check('a hosts-only caller is not enough for the queue', () => assert.ok(!requiredGroupsForRoute('GET', 'admin/moderation').includes('hosts')));
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
