#!/usr/bin/env node
/**
 * REGENERATE docs/architecture/api.md FROM template-clean.yaml.
 *
 * The hand-written API_DOCUMENTATION.md this replaced was wrong in every
 * section that mattered: an `/api/…` prefix no route ever carried, three dead
 * handlers documented as live, five files that did not exist, and a `wss://`
 * host that resolves to nothing. It was last touched a fortnight before it was
 * deleted, so it looked maintained the whole time.
 *
 * A generated doc cannot drift. The template is the only artefact that must
 * agree with the deployed routes, so it is the only honest source.
 *
 * Usage:  node scripts/generate-api-doc.js [--check]
 *   --check  exit 1 if the committed doc is stale (for a future CI gate)
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template-clean.yaml');
const OUT = path.join(REPO, 'docs/architecture/api.md');

/**
 * Split on two-space-indented resource keys. Crude, and right for this file:
 * every top-level resource in template-clean.yaml sits at exactly that indent,
 * and a real YAML parser would need a dependency the test suite does not have.
 */
function resourceBlocks(src) {
  return src.split(/\n  (?=[A-Za-z0-9]+:\n)/);
}

function extract(src) {
  const rows = [];
  for (const block of resourceBlocks(src)) {
    const name = block.match(/^\s*([A-Za-z0-9]+):/);
    if (!name || !block.includes('AWS::Serverless::Function')) continue;
    const codeUri = block.match(/CodeUri:\s*(\S+)/);
    const handlerProp = block.match(/Handler:\s*(\S+)/);
    if (!codeUri || !handlerProp) continue;

    const file = `${codeUri[1].replace(/\/$/, '')}/${handlerProp[1].replace(/\.[^.]+$/, '')}.js`;

    // One function can declare several HttpApi events (get-results serves the
    // public read AND close-round). Capture each Path/Method, plus whether an
    // authorizer appears before the next Path.
    const events = /Path:\s*(\S+)\s*\n\s*Method:\s*(\S+)((?:(?!\n\s*Path:)[\s\S])*)/g;
    let ev;
    while ((ev = events.exec(block)) !== null) {
      rows.push({
        path: ev[1],
        method: ev[2].toUpperCase(),
        auth: /CognitoAuthorizer/.test(ev[3]) ? 'Cognito' : 'public',
        file,
        fn: name[1],
      });
    }
  }
  // Shallow paths first, then alphabetical, so /games sorts above /games/{id}/x
  rows.sort((a, b) =>
    (a.path.split('/').length - b.path.split('/').length) ||
    a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return rows;
}

function render(rows) {
  const groups = new Map();
  for (const r of rows) {
    const seg = r.path.replace(/^\//, '').split('/')[0] || '(root)';
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg).push(r);
  }
  const authed = rows.filter((r) => r.auth === 'Cognito').length;

  const out = [
    '# HTTP API surface',
    '',
    '**Generated from `template-clean.yaml` — do not hand-edit.**',
    'Regenerate with `node scripts/generate-api-doc.js`.',
    '',
    'The template is the only description of these routes that cannot drift from',
    'them, so it is the only source this doc will accept. The hand-written file it',
    'replaced documented an `/api/…` prefix no route ever had, three handlers that',
    'were already dead, and five files that did not exist.',
    '',
    `${rows.length} routes across ${groups.size} groups. ${authed} carry the Cognito ` +
    `authorizer; ${rows.length - authed} are public.`,
    '',
    '`public` means no authorizer **on the route**. Several public routes still',
    'enforce rules in the handler: the participant journey carries no token by',
    'design, so those checks live in code. See `callerMayDriveSession` in',
    '`lambda-functions/game/tenant.js`, and note that `get-results.js` serves one',
    'public route and one authenticated route from the same handler, discriminating',
    'on `requestContext.routeKey`.',
    '',
  ];
  for (const [seg, rs] of groups) {
    out.push(`## /${seg}`, '', '| Method | Path | Auth | Handler |', '|---|---|---|---|');
    for (const r of rs) {
      out.push(`| ${r.method} | \`${r.path}\` | ${r.auth === 'Cognito' ? '**Cognito**' : 'public'} | \`${r.file}\` |`);
    }
    out.push('');
  }
  return out.join('\n');
}

const rows = extract(fs.readFileSync(TEMPLATE, 'utf8'));
if (!rows.length) {
  console.error('generate-api-doc: extracted 0 routes — the template shape changed');
  process.exit(1);
}
const doc = render(rows);

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== doc) {
    console.error('docs/architecture/api.md is stale. Run: node scripts/generate-api-doc.js');
    process.exit(1);
  }
  console.log(`api.md is current (${rows.length} routes)`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, doc);
console.log(`wrote ${path.relative(REPO, OUT)} — ${rows.length} routes, ` +
  `${rows.filter((r) => r.auth === 'Cognito').length} authenticated`);
