/**
 * THE LIST READS THE ORG'S OWN PARTITION CONSISTENTLY.
 *
 * Copy-on-save, create and import write a row into ORG#<org>#SETS and then
 * re-read the list to rebind the editor to it (AdminPage.handleEditorCopied).
 * A default Query is eventually consistent, so the row written a moment ago
 * can be missing from the very read meant to find it — and the editor is then
 * left bound to a bare id. The org's own partition is small and is the one
 * the caller just wrote to, so it is read with ConsistentRead; the platform and
 * public libraries are nobody's fresh write and stay eventually consistent.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const queries = [];
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class BatchGetCommand { constructor(i) { this.input = i; this.type = 'batchget'; } }
const fakeDoc = { async send(cmd) { if (cmd.type === 'query') { queries.push(cmd.input); return { Items: [] }; } return {}; } };
const stub = (name, exports) => {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'admin')]) {
    let p; try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, BatchGetCommand });
stub('@aws-sdk/client-kms', { KMSClient: class { async send() { throw new Error('no KMS in this suite'); } }, GenerateDataKeyCommand: class {}, DecryptCommand: class {} });
process.env.TABLE_NAME = 'test-table';

const { handler } = require(path.join(REPO, 'lambda-functions/admin/get-question-sets.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => { try { fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; } };

(async () => {
  console.log('\nquestion-sets list: the org partition is read consistently\n');
  const res = await handler({
    requestContext: { http: { method: 'GET' }, authorizer: { lambda: { userId: 'u', username: 'amara', groups: 'hosts', orgId: 'org_acme', orgRole: 'owner', orgIds: 'org_acme', status: 'enabled' } } },
    pathParameters: {},
  });
  check('the list answers 200 on an empty library', () => assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
  const byPk = new Map(queries.map((q) => [q.ExpressionAttributeValues && q.ExpressionAttributeValues[':pk'], q]));
  check('it queries the org, platform and public partitions', () =>
    assert.deepStrictEqual([...byPk.keys()].sort(), ['ORG#org_acme#SETS', 'PUBLIC#SETS', 'SETS']));
  check("the org's own partition is read with ConsistentRead", () =>
    assert.strictEqual(byPk.get('ORG#org_acme#SETS').ConsistentRead, true, JSON.stringify(byPk.get('ORG#org_acme#SETS'))));
  check('the platform and public libraries stay eventually consistent', () => {
    assert.ok(!byPk.get('SETS').ConsistentRead, 'platform read should not be consistent');
    assert.ok(!byPk.get('PUBLIC#SETS').ConsistentRead, 'public read should not be consistent');
  });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
