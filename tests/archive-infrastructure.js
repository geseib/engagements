/**
 * EVERY TIER CAN REACH THE SHARED ARCHIVE — asserted from the files that decide it.
 *
 * The owner's instruction for this work: "make sure that all tiers can access dev/test/prod".
 * All three tiers deploy template-clean.yaml, so what the template grants, every tier gets.
 * This suite pins that grant and the one source of the archive's API id, and (as later
 * sections are added) the scripts that prove it against live AWS and the archive stack's own
 * lock-down. scripts/archive-access-check.sh is the live half of the same claim.
 *
 * TEXT, NOT YAML. The template is full of CloudFormation short tags no loader in this repo
 * reads, the same reason tests/helpers/template-routes.js scans text. Every scanner here
 * asserts it found something before anything is concluded from it.
 *
 * // rejects: an archive caller without the invoke grant or on the CloudFront host; the API id
 * //          drifting from the archive stack's output; write grants wider than the paths the
 * //          archive code uses; the dead list-local-archive route coming back.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/** One top-level resource's text: from its two-space key to the next one. */
function resourceBlock(src, logicalId) {
  const start = src.indexOf(`\n  ${logicalId}:\n`);
  assert.ok(start !== -1, `${logicalId} is not declared`);
  const after = src.slice(start + 1);
  const next = after.slice(1).search(/\n {2}[A-Za-z0-9]+:\n/);
  return next === -1 ? after : after.slice(0, next + 2);
}

/** Every Serverless function whose FunctionName is `${StackName}-<suffix>`, keyed by suffix. */
function functionsBySuffix(src) {
  const found = new Map();
  for (const m of src.matchAll(/\n {2}([A-Za-z0-9]+):\n {4}Type: AWS::Serverless::Function\n/g)) {
    const block = resourceBlock(src, m[1]);
    const name = /FunctionName: !Sub '\$\{StackName\}-([a-z0-9-]+)'/.exec(block);
    if (name) found.set(name[1], { logicalId: m[1], block });
  }
  return found;
}

const template = read('template-clean.yaml');
const functions = functionsBySuffix(template);
const ARCHIVE_CALLERS = ['admin-archive-items', 'admin-export-to-archive', 'admin-import-from-archive'];
const URL_FROM_MAPPING = /ARCHIVE_SERVICE_URL: !Sub\s*\n\s*- 'https:\/\/\$\{ArchiveApiId\}\.execute-api\.\$\{AWS::Region\}\.amazonaws\.com'\s*\n\s*- ArchiveApiId: !FindInMap \[ArchiveService, Api, Id\]/;
const INVOKE_GRANT = /Action: \['execute-api:Invoke'\]\s*\n\s*Resource: !Sub\s*\n\s*- 'arn:aws:execute-api:\$\{AWS::Region\}:\$\{AWS::AccountId\}:\$\{ArchiveApiId\}\/\*\/\*\/archive\/\*'\s*\n\s*- ArchiveApiId: !FindInMap \[ArchiveService, Api, Id\]/;

console.log('1. the archive API id has one source, and it matches the archive stack');
check('the function scanner found the functions (it is not matching nothing)', () => {
  assert.ok(functions.size > 40, `found only ${functions.size}`);
});
check('ArchiveService → Api → Id is the id deploy-archive.sh recorded in config/archive-service.json', () => {
  const mapping = /\nMappings:\n[\s\S]*?\n {2}ArchiveService:\n {4}Api:\n {6}Id: (\S+)\n/.exec(template);
  assert.ok(mapping, 'no ArchiveService mapping in template-clean.yaml');
  const recorded = new URL(JSON.parse(read('config/archive-service.json')).archiveApiUrl).hostname.split('.')[0];
  assert.strictEqual(mapping[1], recorded);
});
check('nothing in the main template names archive.seibtribe.us', () => {
  assert.ok(!template.includes('archive.seibtribe.us'), 'a signed call through the CloudFront name is refused');
});

console.log('\n2. every archive caller signs for the execute-api host and may invoke it');
check('the functions that call the archive are exactly the three the access check knows', () => {
  const callers = [...functions].filter(([, f]) => f.block.includes('ARCHIVE_SERVICE_URL')).map(([suffix]) => suffix).sort();
  assert.deepStrictEqual(callers, ARCHIVE_CALLERS);
});
for (const suffix of ARCHIVE_CALLERS) {
  check(`${suffix} reads the URL from the mapping and holds execute-api:Invoke on /archive/*`, () => {
    const fn = functions.get(suffix);
    assert.ok(fn, `${suffix} is not declared`);
    assert.match(fn.block, URL_FROM_MAPPING);
    assert.match(fn.block, INVOKE_GRANT);
  });
}

console.log('\n3. least privilege on the data paths');
check('export reads the main table and writes nothing to it', () => {
  const { block } = functions.get('admin-export-to-archive');
  assert.ok(block.includes('DynamoDBReadPolicy'));
  assert.ok(!block.includes('DynamoDBCrudPolicy'), 'export writes nothing to the main table');
});
check('export may write only under the archive media prefix', () => {
  assert.match(functions.get('admin-export-to-archive').block, /Action: \['s3:PutObject', 's3:PutObjectTagging'\]\s*\n\s*Resource: 'arn:aws:s3:::engage2-archive-content\/archive\/media\/\*'/);
});
check('import may write images only under sets/', () => {
  assert.match(functions.get('admin-import-from-archive').block, /Action: \['s3:GetObject', 's3:PutObject', 's3:PutObjectTagging'\]\s*\n\s*Resource: !Sub '\$\{MediaBucket\.Arn\}\/sets\/\*'/);
});
check('both data functions may list the buckets they copy between, so a missing image is a 404', () => {
  assert.match(functions.get('admin-export-to-archive').block, /Action: \['s3:ListBucket'\]\s*\n\s*Resource: !GetAtt MediaBucket\.Arn/);
  assert.match(functions.get('admin-import-from-archive').block, /Action: \['s3:ListBucket'\]\s*\n\s*Resource: 'arn:aws:s3:::engage2-archive-content'/);
  assert.match(functions.get('admin-import-from-archive').block, /Action: \['s3:ListBucket'\]\s*\n\s*Resource: !GetAtt MediaBucket\.Arn/);
});
check('the relay holds nothing but the invoke grant', () => {
  const { block } = functions.get('admin-archive-items');
  assert.ok(!/DynamoDB\w*Policy|S3\w*Policy|s3:|kms:/.test(block), 'the relay needs no table, bucket or key');
});

console.log('\n4. the dead route is gone');
check('AdminListLocalArchiveFunction is not declared, and its handler is deleted', () => {
  assert.ok(!template.includes('AdminListLocalArchiveFunction'));
  assert.ok(!fs.existsSync(path.join(REPO, 'lambda-functions/admin/list-local-archive.js')));
});

console.log('\n5. the live checks look at exactly what the template grants');
const accessCheck = fs.existsSync(path.join(REPO, 'scripts/archive-access-check.sh')) ? read('scripts/archive-access-check.sh') : '';
const drill = fs.existsSync(path.join(REPO, 'scripts/archive-drill.sh')) ? read('scripts/archive-drill.sh') : '';
const bashArray = (src, name) => {
  const m = new RegExp(`\\n${name}=\\(([^)]*)\\)`).exec(src);
  return m ? m[1].trim().split(/\s+/) : null;
};
check('archive-access-check.sh checks all three tiers by default', () => {
  assert.deepStrictEqual(bashArray(accessCheck, 'TIERS'), ['engagedev', 'engagetest', 'engageprod']);
});
check('...and exactly the functions that call the archive', () => {
  assert.deepStrictEqual((bashArray(accessCheck, 'FUNCTIONS') || []).slice().sort(), ARCHIVE_CALLERS);
});
check('...reads the API id from config/archive-service.json, the file the mapping is pinned to', () => {
  assert.ok(accessCheck.includes('config/archive-service.json'));
});
check('...has both modes, and verify requires every route locked and an unsigned request refused', () => {
  assert.ok(/preflight\|verify\)/.test(accessCheck), 'no preflight|verify case');
  assert.ok(/403/.test(accessCheck) && /curl/.test(accessCheck), 'verify must prove an unsigned request is refused');
  assert.ok(/apigatewayv2 get-routes/.test(accessCheck) && /AWS_IAM/.test(accessCheck), 'verify must check that every route requires AWS_IAM');
});
check('the drill refuses production and covers the functions a restore uses', () => {
  assert.ok(/engageprod\)[^\n]*exit 2/.test(drill), 'the drill must refuse engageprod');
  for (const fn of ['admin-upload-questions', 'admin-export-to-archive', 'admin-delete-question-set', 'admin-import-from-archive', 'admin-archive-items']) {
    assert.ok(drill.includes(fn), `the drill does not use ${fn}`);
    if (fn !== 'admin-archive-items' && fn !== 'admin-export-to-archive' && fn !== 'admin-import-from-archive') {
      assert.ok(template.includes(`FunctionName: !Sub '\${StackName}-${fn}'`), `${fn} is not a function in the template`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
