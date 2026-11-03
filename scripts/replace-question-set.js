#!/usr/bin/env node
/**
 * Give an existing ENGAGE question set a new version from a CSV, and/or change
 * its details (name, description, instruction, round kind, Workie).
 *
 *   AWS_PROFILE=adminaccess node scripts/replace-question-set.js <table> <setId> \
 *     [--csv sets/file.csv] [--note "why this version"] \
 *     [--name "New name"] [--description "..."] [--instruction "..."] \
 *     [--round-kind apply] [--prompt <promptId>] [--ai-context "..."] [--apply]
 *
 * WHY THIS EXISTS. scripts/install-question-set.js only creates a set and
 * refuses one that exists ("replace it through the editor"). Rewriting a set
 * from a reviewed CSV — Lessons from the Tech World, 1 Nov 2026 — needs the
 * editor's own two moves without a person clicking: a NEW VERSION of the
 * questions, and a change to the set's details.
 *
 * It does NOT reimplement either. It invokes the real handlers in-process, as
 * a platform admin acting for no organisation (the same caller the console's
 * Engage mode is):
 *   - admin/upload-questions.js with `replaceSetId`: a legacy set is first
 *     snapshotted as v1, the CSV becomes the next version, and activeVersion
 *     moves to it. The old version stays and can be made live again from the
 *     set's Versions.
 *   - admin/edit-question-set.js: the details, validated as the editor's are
 *     (an unknown round kind or prompt is refused).
 *
 * DRY RUN (the default): reads go to the real table, every write is recorded
 * and dropped, so the report is what the app would do. Engage's own sets only:
 * the caller has no organisation, so a team's set is not found.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const [tableName, setId] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--apply'));
const apply = argv.includes('--apply');
const csvFile = flag('csv');
const details = {
  name: flag('name'),
  description: flag('description'),
  customInstruction: flag('instruction'),
  roundKind: flag('round-kind'),
  promptId: flag('prompt'),
  aiContextInstruction: flag('ai-context'),
};
const detailChanges = Object.fromEntries(Object.entries(details).filter(([, v]) => typeof v === 'string'));

if (!tableName || !setId || (!csvFile && Object.keys(detailChanges).length === 0)) {
  console.error('usage: replace-question-set.js <table> <setId> [--csv file] [--note ...] [--name ...] [--description ...] [--instruction ...] [--round-kind ...] [--prompt ...] [--apply]');
  process.exit(2);
}

process.env.TABLE_NAME = tableName;
const admin = path.join(REPO, 'lambda-functions', 'admin');
const handlerRequire = createRequire(path.join(admin, 'upload-questions.js'));
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));

/** The caller the authorizer hands an Engage admin acting for no organisation. */
const adminEvent = (extra) => ({
  ...extra,
  requestContext: {
    authorizer: {
      lambda: { userId: 'script:replace-question-set', username: 'replace-question-set', groups: 'admins', status: 'enabled' },
    },
  },
});

/** Every copy of the document client the handlers might load (install-question-set.js says why). */
function clientProtos() {
  return [...new Set([
    lambdaRequire('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.prototype,
    handlerRequire('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.prototype,
  ])];
}

/** On a dry run, writes are recorded and dropped; reads are real. */
async function withWritesHeld(fn) {
  if (apply) return { result: await fn(), writes: null };
  const protos = clientProtos();
  const real = protos.map((p) => p.send);
  const writes = [];
  const READS = ['GetCommand', 'QueryCommand', 'ScanCommand', 'BatchGetCommand'];
  const send = async function send(cmd) {
    const type = (cmd && cmd.constructor && cmd.constructor.name) || 'Unknown';
    if (READS.includes(type)) return real[0].call(this, cmd);
    if (type === 'BatchWriteCommand') {
      const reqs = Object.values(cmd.input.RequestItems || {})[0] || [];
      reqs.forEach((r) => { const it = r.PutRequest && r.PutRequest.Item; if (it) writes.push(`put ${it.PK} | ${it.SK}`); });
      return { UnprocessedItems: {} };
    }
    const it = cmd.input && cmd.input.Item;
    writes.push(it ? `put ${it.PK} | ${it.SK}` : `${type} ${JSON.stringify((cmd.input && cmd.input.Key) || {})}`);
    return {};
  };
  protos.forEach((p) => { p.send = send; });
  try {
    return { result: await fn(), writes };
  } finally {
    protos.forEach((p, i) => { p.send = real[i]; });
  }
}

const reply = (res) => ({ status: res.statusCode, body: JSON.parse(res.body || '{}') });

(async () => {
  console.log(`${apply ? 'APPLYING to' : 'DRY RUN on'} ${tableName}, set "${setId}"\n`);
  let failed = false;

  if (csvFile) {
    const fileContent = fs.readFileSync(path.resolve(REPO, csvFile), 'utf8');
    const { handler } = require(path.join(admin, 'upload-questions.js'));
    const { result, writes } = await withWritesHeld(() => handler(adminEvent({
      body: JSON.stringify({
        fileName: path.basename(csvFile),
        fileContent,
        customTitle: setId,
        replaceSetId: setId,
        ...(flag('note') ? { versionNote: flag('note') } : {}),
      }),
    })));
    const r = reply(result);
    console.log('--- questions: a new version from', csvFile);
    if (r.status >= 300) {
      console.error(`  REFUSED ${r.status}: ${r.body.error || r.body.message}`);
      failed = true;
    } else {
      console.log(`  questions : ${r.body.questionCount ?? '?'}   categories: ${r.body.categoryCount ?? '?'}`);
      console.log(`  version   : ${r.body.version ?? r.body.activeVersion ?? '(see the set)'}`);
      console.log(`  skipped   : ${r.body.skippedRowCount || 0}`);
      (r.body.skippedRows || []).slice(0, 10).forEach((row) => console.log(`    ${JSON.stringify(row)}`));
      if (writes) console.log(`  writes held (dry run): ${writes.length}`);
      if (r.body.skippedRowCount) failed = true;
    }
  }

  if (!failed && Object.keys(detailChanges).length) {
    const { handler } = require(path.join(admin, 'edit-question-set.js'));
    // edit-question-set requires the name on every save; keep the current one
    // unless a new one is given.
    const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const current = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: 'SETS', SK: `SET#${setId}` } }))).Item;
    if (!current) {
      console.error(`--- details: no Engage set "${setId}" on ${tableName}`);
      process.exit(1);
    }
    const body = { name: current.name, ...detailChanges };
    const { result, writes } = await withWritesHeld(() => handler(adminEvent({
      pathParameters: { setId },
      body: JSON.stringify(body),
    })));
    const r = reply(result);
    console.log('\n--- details');
    for (const [k, v] of Object.entries(detailChanges)) {
      console.log(`  ${k.padEnd(17)} ${JSON.stringify(current[k] ?? '')}  ->  ${JSON.stringify(v)}`);
    }
    if (r.status >= 300) {
      console.error(`  REFUSED ${r.status}: ${r.body.error || r.body.message}`);
      failed = true;
    } else if (writes) {
      console.log(`  writes held (dry run): ${writes.length}`);
    } else {
      console.log('  saved');
    }
  }

  if (!apply && !failed) console.log('\nDry run only. Re-run with --apply.');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('error:', e); process.exit(1); });
