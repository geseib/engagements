// tests/public-projection.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const list = require(path.join(H.REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const parse = (res) => JSON.parse(res.body || '{}');
(async () => {
  console.log('\npublic rows carry their provenance\n');
  await H.test('a public copy lists with the organisation it came from and its notice', async () => {
    H.reset();
    H.seedRow({ ...V.setMetadataKey({ scope: 'public', orgId: '', setId: 'orgacme-safety' }), name: 'Safety walkthrough', engagementType: 'trivia', activeVersion: 1, versions: [{ version: 1, questionCount: 30 }], questionCount: 30, sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, sensitivity: ['graphic-medical'], promptDropped: true, scope: 'public' });
    const res = await list(H.orgEvent({ orgId: 'org_beta', role: 'member', method: 'GET', path: {} }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const row = parse(res).questionSets.find((s) => s.id === 'orgacme-safety');
    assert.ok(row, 'the public row is listed for another org');
    assert.strictEqual(row.scope, 'public');
    assert.strictEqual(row.sourceOrgName, 'Acme');
    assert.strictEqual(row.sourceOrgId, 'org_acme');
    assert.deepStrictEqual(row.sensitivity, ['graphic-medical']);
    assert.strictEqual(row.promptDropped, true);
    assert.strictEqual(row.canManage, false, 'nobody edits a public copy in place');
  });
  await H.test('an org set without provenance projects the defaults', async () => {
    H.reset();
    const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
    H.seedRow(await C.encryptItem('org_beta', 'set', { ...V.setMetadataKey({ scope: 'org', orgId: 'org_beta', setId: 'own' }), name: 'Own', engagementType: 'trivia', scope: 'org', orgId: 'org_beta', activeVersion: 1, versions: [{ version: 1 }] }));
    const res = await list(H.orgEvent({ orgId: 'org_beta', role: 'member', method: 'GET', path: {} }), H.ctx());
    const row = parse(res).questionSets.find((s) => s.id === 'own');
    assert.strictEqual(row.sourceOrgName, '');
    assert.deepStrictEqual(row.sensitivity, []);
    assert.strictEqual(row.promptDropped, false);
  });
  H.summary();
})();
