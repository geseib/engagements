/**
 * A SIGNED-IN USER MAY NOT REWRITE THEIR OWN STANDING (2026-10-10).
 *
 * The authorizer reads `custom:status` to refuse a disabled account
 * (lambda-functions/auth/authorizer.js) and passes `custom:role` on. Both are
 * Mutable in the pool's schema, and a UserPoolClient with no WriteAttributes
 * lets the user write every mutable attribute with their own access token
 * (UpdateUserAttributes). So a disabled host could set themselves enabled.
 *
 * The web client now lists what a user may write: the attributes the Google
 * provider maps (a federated sign-in writes them through the client, and fails
 * if one is missing) and nothing custom. Admin writes (post-confirmation's
 * AdminUpdateUserAttributes) are not limited by a client's WriteAttributes.
 *
 * Read as text, like the other template checks here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const text = fs.readFileSync(path.join(__dirname, '..', 'template-clean.yaml'), 'utf8');

/** The body of the one resource whose Type is `type`: from its Type line to the next top-level resource. */
function resourceBody(type) {
  const at = text.indexOf(`Type: ${type}`);
  assert.ok(at >= 0, `no ${type} in the template`);
  const rest = text.slice(at);
  const end = rest.search(/\n {2}[A-Za-z0-9]+:\s*\n/);
  return end >= 0 ? rest.slice(0, end) : rest;
}
/** The `- item` lines under `key:` in a block. */
function listUnder(block, key) {
  const m = new RegExp(`\\n(\\s+)${key}:\\s*\\n((?:\\1\\s+- .*\\n?)+)`).exec(block);
  return m ? m[2].split('\n').map((l) => l.trim().replace(/^- /, '').replace(/['"]/g, '')).filter(Boolean) : null;
}

let pass = 0; let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; }
}

const clients = text.split('Type: AWS::Cognito::UserPoolClient').length - 1;
const client = resourceBody('AWS::Cognito::UserPoolClient');
const write = listUnder(client, 'WriteAttributes');
const mapping = (/AttributeMapping:\s*\n((?:\s+\w+: .*\n)+)/.exec(text) || [])[1] || '';
const mapped = mapping.split('\n').map((l) => l.trim().split(':')[0]).filter((k) => k && k !== 'username');

check('there is one web client (a second would need the same rule)', () => assert.strictEqual(clients, 1));
check('the web client says what a user may write', () => assert.ok(Array.isArray(write) && write.length, 'WriteAttributes is missing'));
check('no custom attribute is writable by the user: custom:status and custom:role are the server\'s', () => {
  assert.deepStrictEqual((write || []).filter((a) => a.startsWith('custom:')), []);
});
check('every attribute the Google provider maps stays writable, or federated sign-in fails', () => {
  assert.deepStrictEqual(mapped.sort(), ['email', 'name']);
  for (const a of mapped) assert.ok((write || []).includes(a), `${a} is mapped from Google but not writable`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
