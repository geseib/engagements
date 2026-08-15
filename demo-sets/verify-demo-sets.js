#!/usr/bin/env node
/**
 * VERIFY THE DEMO SETS AGAINST THE CODE THAT WILL REALLY RUN.
 *
 * Nothing in here is a hand-written expectation. Each CSV in this directory is
 * pushed through three real modules, unmodified:
 *
 *   1. src/src/utils/csvPreflight.js       — what the console would say about
 *                                            the file BEFORE it is sent.
 *   2. lambda-functions/admin/upload-questions.js — the actual importer handler,
 *                                            with only the AWS SDK stubbed, so
 *                                            the CATEGORY# and QUESTION# rows
 *                                            reported below are the rows the
 *                                            handler tried to write.
 *   3. src/src/utils/promptPreflight.js    — what the prompt editor would say
 *                                            about each Workie before it is saved.
 *
 * The stubbing pattern for (2) is the one src/src/__tests__/questionCategories.test.js
 * uses: virtual module mocks for @aws-sdk/*, a `send` that records BatchWrite
 * items, and a Get that answers "no such set" so the create path runs.
 *
 * Run:  node demo-sets/verify-demo-sets.js
 * Writes nothing anywhere. Touches no AWS.
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'src');
const TABLE_NAME = 'engage-verify-table';

/* ------------------------------------------------------------ AWS stubs -- */

const kinded = (kind) => class {
  constructor(input) { this.input = input; this.__kind = kind; }
};

let sendImpl = () => Promise.resolve({});

const STUBS = {
  '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} },
  '@aws-sdk/lib-dynamodb': {
    DynamoDBDocumentClient: { from: () => ({ send: (c) => sendImpl(c) }) },
    GetCommand: kinded('get'),
    QueryCommand: kinded('query'),
    BatchWriteCommand: kinded('batch'),
    UpdateCommand: kinded('update'),
  },
};

const realResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return request;
  return realResolve.call(this, request, ...rest);
};
const realLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return realLoad.call(this, request, ...rest);
};

/* ------------------------------------------- ESM under src/, through babel -- */

const babel = require(path.join(SRC, 'node_modules', '@babel', 'core'));
const babelOptions = require(path.join(SRC, 'babel.config.js'));
const defaultJs = require.extensions['.js'];
require.extensions['.js'] = function loadMaybeEsm(module, filename) {
  if (!filename.startsWith(path.join(SRC, 'src') + path.sep)) {
    return defaultJs(module, filename);
  }
  const source = fs.readFileSync(filename, 'utf8');
  // cwd/root pin preset resolution to src/node_modules; babel otherwise
  // resolves presets against process.cwd(), which is the repo root and has none.
  const { code } = babel.transformSync(source, {
    ...babelOptions, filename, cwd: SRC, root: SRC, configFile: false, babelrc: false,
  });
  return module._compile(code, filename);
};

const { preflight } = require(path.join(SRC, 'src', 'utils', 'csvPreflight.js'));
const { preflightPrompt } = require(path.join(SRC, 'src', 'utils', 'promptPreflight.js'));

/* -------------------------------------------------------------- the sets -- */

const SETS = [
  {
    csv: 'lessons-from-different-schools.csv',
    prompt: 'lessons-from-different-schools.prompt.json',
    title: 'Lessons from Different Schools',
    roundKind: 'apply',
  },
  {
    csv: 'what-we-should-be-known-for.csv',
    prompt: 'what-we-should-be-known-for.prompt.json',
    title: 'What We Should Be Known For',
    roundKind: 'produce',
  },
  {
    csv: 'the-rules-we-wrote-down.csv',
    prompt: 'the-rules-we-wrote-down.prompt.json',
    title: 'The Rules We Wrote Down',
    roundKind: 'improve',
  },
  {
    csv: 'ready-or-not.csv',
    prompt: 'ready-or-not.prompt.json',
    title: 'Ready or Not',
    roundKind: 'judge',
  },
];

const { DETAIL_CEILINGS } = require(
  path.join(REPO, 'lambda-functions', 'admin', 'shared', 'round-kinds.js')
);

/* ------------------------------------------------------------ the import -- */

async function runImporter(fileContent, fileName, customTitle, roundKind) {
  process.env.TABLE_NAME = TABLE_NAME;
  const written = [];
  sendImpl = (command) => {
    if (command.__kind === 'get') return Promise.resolve({});
    if (command.__kind === 'query') return Promise.resolve({ Items: [] });
    if (command.__kind === 'batch') {
      for (const req of command.input.RequestItems[TABLE_NAME]) {
        written.push(req.PutRequest.Item);
      }
    }
    return Promise.resolve({});
  };

  delete require.cache[require.resolve(
    path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')
  )];
  const { handler } = require(
    path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')
  );

  const response = await handler({
    body: JSON.stringify({
      fileName,
      fileContent,
      customTitle,
      engagementType: 'call-and-answer',
      roundKind,
    }),
  });

  return { response, written };
}

/* --------------------------------------------------------------- output -- */

const line = (s = '') => process.stdout.write(`${s}\n`);
const rule = (c = '-') => line(c.repeat(78));

let failures = 0;
const fail = (msg) => { failures += 1; line(`   FAIL  ${msg}`); };

(async () => {
  // The importer is chatty by design; its console.log is the wrong output here.
  const realLog = console.log;
  console.log = () => {};

  const summary = [];

  for (const set of SETS) {
    const csvPath = path.join(__dirname, set.csv);
    const fileContent = fs.readFileSync(csvPath, 'utf8');

    /* ---- 1. csvPreflight, the console's own read of the file ------------- */
    const pre = preflight(fileContent, 'call-and-answer', { fileName: set.csv });

    /* ---- 2. the real importer ------------------------------------------- */
    const { response, written } = await runImporter(
      fileContent, set.csv, set.title, set.roundKind
    );
    const body = JSON.parse(response.body);

    const categories = written
      .filter((i) => String(i.SK).startsWith('CATEGORY#'))
      .map((i) => ({ id: String(i.SK).replace('CATEGORY#', ''), name: i.Name, count: i.QuestionCount }));
    const questions = written.filter((i) => String(i.SK).startsWith('QUESTION#'));
    const meta = written.find((i) => i.PK === 'SETS');

    /* ---- 3. promptPreflight --------------------------------------------- */
    const record = JSON.parse(fs.readFileSync(path.join(__dirname, set.prompt), 'utf8'));
    const pp = preflightPrompt({
      instructions: record.instructions,
      outputFormat: record.outputFormat,
      outputSections: record.outputSections,
      gameType: record.gameType,
      promptType: record.promptType,
      isDefault: record.isDefault,
      category: record.category,
    });

    console.log = realLog;
    rule('=');
    line(`${set.title}   [roundKind: ${set.roundKind}]`);
    rule('=');

    line('CSV PREFLIGHT (src/src/utils/csvPreflight.js)');
    line(`   data rows ${pre.dataRowCount} · would import ${pre.importedCount} `
      + `· skipped ${pre.skippedRowCount} · categories ${pre.categories.length}`);
    for (const b of pre.blocking) fail(`blocking: ${b.title}`);
    for (const s of pre.skipped) fail(`skipped row ${s.row}: ${s.problem}`);
    for (const g of pre.gaps) line(`   gap: ${g.title}`);
    if (!pre.blocking.length && !pre.skipped.length && !pre.gaps.length) {
      line('   nothing to report');
    }
    line('');

    line('REAL IMPORTER (lambda-functions/admin/upload-questions.js)');
    if (response.statusCode !== 200) {
      fail(`statusCode ${response.statusCode}: ${body.error}`);
    } else {
      line(`   HTTP ${response.statusCode} · setId "${body.setId}"`);
      line(`   rows accepted ${body.questionCount} · rows skipped ${body.skippedRowCount}`
        + (body.skippedRowCount ? ` (${body.skippedRows.map((r) => `row ${r.row}: ${r.reason}`).join('; ')})` : ' (none)'));
      line(`   categories written ${body.categoryCount} of a maximum 24`);
      for (const c of categories) line(`      ${c.id}  ${c.name.padEnd(18)} ${c.count} question(s)`);
      line(`   QUESTION# rows written ${questions.length}`);
      line(`   set roundKind stored: ${meta && meta.roundKind ? meta.roundKind : '(absent - reads as produce)'}`);

      if (body.skippedRowCount !== 0) fail(`${body.skippedRowCount} row(s) dropped`);
      if (questions.length !== body.questionCount) fail('question row count disagrees with the reported count');
      if (body.categoryCount > 24) fail(`${body.categoryCount} categories exceeds the 24-bit ceiling`);
      if (!meta || meta.roundKind !== set.roundKind) fail(`roundKind not stored as ${set.roundKind}`);

      // Case-insensitive category identity: no two categories may fold together.
      const folded = categories.map((c) => c.name.trim().replace(/\s+/g, ' ').toLowerCase());
      if (new Set(folded).size !== folded.length) fail('two categories fold to the same identity');

      // Detail ceilings are house guidance for the kind, not enforced by code.
      const ceiling = DETAIL_CEILINGS[set.roundKind];
      const over = questions.filter((q) => (q.Detail || '').length > ceiling);
      line(`   detail ceiling for ${set.roundKind}: ${ceiling} chars · longest detail `
        + `${Math.max(...questions.map((q) => (q.Detail || '').length))} · over ceiling ${over.length}`);
      for (const q of over) fail(`detail over the ${ceiling}-char ${set.roundKind} ceiling: ${q.Title}`);

      const noDetail = questions.filter((q) => !(q.Detail || '').trim());
      for (const q of noDetail) fail(`question has no Detail: ${q.Title}`);
    }
    line('');

    line(`PROMPT PREFLIGHT — ${record.name}`);
    line(`   ~${pp.stats.assembledChars.toLocaleString()} chars assembled `
      + `· ${pp.stats.variablesUsed} variables · ${pp.stats.inlinedChars.toLocaleString()} substituted `
      + `· ${pp.stats.duplicatedChars.toLocaleString()} duplicated`);
    for (const f of pp.blocking) fail(`BLOCKING: ${f.title}`);
    for (const f of pp.silent) fail(`SILENT: ${f.title}`);
    for (const f of pp.advisory) line(`   advisory: ${f.title}`);
    if (!pp.blocking.length && !pp.silent.length) line('   no blocking and no silent findings');
    line(`   variables: ${pp.variables.map((v) => `{${v.name}}x${v.count}`).join(' ')}`);
    line('');

    summary.push({
      set: set.title,
      kind: set.roundKind,
      accepted: body.questionCount,
      skipped: body.skippedRowCount,
      categories: categories.map((c) => `${c.name}:${c.count}`).join(', '),
    });
    console.log = () => {};
  }

  console.log = realLog;
  rule('=');
  line('SUMMARY');
  rule('=');
  for (const s of summary) {
    line(`${s.set}`);
    line(`   kind ${s.kind} · accepted ${s.accepted} · skipped ${s.skipped}`);
    line(`   ${s.categories}`);
  }
  rule();
  line(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.log = console.log;
  console.error(e);
  process.exit(1);
});
