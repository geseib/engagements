/**
 * A TAGGED UPLOAD NEEDS s3:PutObjectTagging, AND S3CrudPolicy DOES NOT GRANT IT.
 *
 * The owner, 2026-09-23: "When I click save report I get option to save for 24
 * hrs or 1 year. But the 24 hr one failed but the 1 year one worked".
 *
 * The two differ in exactly one line of save-report.js: a standard save puts
 * the object with `Tagging: 'retention=standard'`, which the bucket's 90-day
 * lifecycle rule filters on; a permanent one sends no tag. S3 authorises a
 * PutObject that carries the x-amz-tagging header against s3:PutObjectTagging
 * as well as s3:PutObject. SaveReportFunction had only SAM's S3CrudPolicy,
 * whose action list is
 *
 *   GetObject ListBucket GetBucketLocation GetObjectVersion PutObject
 *   PutObjectAcl GetLifecycleConfiguration PutLifecycleConfiguration
 *   DeleteObject
 *
 * (read from samtranslator's policy_templates.json) — no PutObjectTagging. The
 * comment beside the tag said the opposite, and every 24-hour save on every
 * tier was refused from 203ab13f (2026-09-21) on.
 *
 * So this reads it from BOTH ends and requires they agree: every handler that
 * puts a tagged object, and the template function that runs it, which must
 * grant s3:PutObjectTagging explicitly (or carry S3FullAccessPolicy, the one
 * SAM template that includes it).
 *
 * rejects: a handler that tags an upload on a function without the grant.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1;
  }
};

/** Every handler file under lambda-functions/ whose code (comments aside) tags a put. */
function taggingHandlers() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.aws-sam', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const code = fs.readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
        if (/\bTagging\s*:/.test(code) && /PutObjectCommand/.test(code)) out.push(path.relative(REPO, full));
      }
    }
  };
  walk(path.join(REPO, 'lambda-functions'));
  return out;
}

/** `{ name, codeUri, handlerFile, body }` for every AWS::Serverless::Function. */
function functions() {
  const starts = [...template.matchAll(/^ {2}(\w+):\n {4}Type: AWS::Serverless::Function\n/gm)];
  return starts.map((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : template.length;
    // A resource ends at the next two-space key, whatever its type.
    const rest = template.slice(m.index + m[0].length, end);
    const next = rest.search(/^ {2}\w+:\s*$/m);
    const body = next === -1 ? rest : rest.slice(0, next);
    const codeUri = (body.match(/^\s+CodeUri:\s*(\S+)/m) || [])[1] || '';
    const handler = (body.match(/^\s+Handler:\s*(\S+)/m) || [])[1] || '';
    return {
      name: m[1],
      handlerFile: path.join(codeUri, `${handler.replace(/\.[^.]+$/, '')}.js`).replace(/\\/g, '/'),
      body: body.replace(/#[^\n]*/g, ''),
    };
  });
}

const grantsTagging = (body) => /s3:PutObjectTagging/.test(body) || /S3FullAccessPolicy:/.test(body);

console.log('\nevery tagged upload runs on a function allowed to tag');
const handlers = taggingHandlers();
const fns = functions();

check('the scan finds save-report.js tagging its standard saves (guards the scan)', () => {
  assert.ok(handlers.includes('lambda-functions/game/save-report.js'), `found ${JSON.stringify(handlers)}`);
});
check('the template parse finds the functions (guards the parse)', () => {
  assert.ok(fns.length > 40, `found ${fns.length}`);
  assert.ok(fns.some((f) => f.name === 'SaveReportFunction' && f.handlerFile === 'lambda-functions/game/save-report.js'));
});

for (const file of handlers) {
  const running = fns.filter((f) => f.handlerFile === file);
  check(`${file} is deployed by at least one function`, () => assert.ok(running.length, 'no template function runs it'));
  for (const f of running) {
    check(`${f.name} may tag what ${path.basename(file)} uploads`, () => {
      assert.ok(grantsTagging(f.body),
        `${f.name} has no s3:PutObjectTagging — S3CrudPolicy does not include it, so every tagged put is AccessDenied`);
    });
  }
}

check('the grant is on the reports bucket\'s objects, not on *', () => {
  const f = fns.find((x) => x.name === 'SaveReportFunction');
  assert.match(f.body, /Action:\s*\[\s*s3:PutObjectTagging\s*\]\s*\n\s*Resource:\s*!Sub '\$\{ReportsBucket\.Arn\}\/\*'/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
