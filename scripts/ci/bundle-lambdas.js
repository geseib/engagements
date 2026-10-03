#!/usr/bin/env node
/**
 * ── ONE SMALL BUNDLE PER FUNCTION, IN PLACE OF 119 COPIES OF FOUR FOLDERS ──
 *
 * The 119 functions in template-clean.yaml share four CodeUri folders (63 admin,
 * 42 game, 12 websocket, 2 auth). `sam build` copied the whole folder, with its
 * production node_modules, into every function — 9.4 GB — and `sam deploy` then
 * zipped all 119 copies: ~18 minutes of a ~27-minute deploy (dev builds 4c71a3ad,
 * 9bea635e, 2026-10-01/02), and each admin function carried the 34 MB pdf-parse
 * that only AdminParseDocumentFunction uses.
 *
 * This replaces `sam build`. For each function it bundles the handler and only
 * what it requires into one file with esbuild, then writes
 * .aws-sam/bundled/template.yaml: template-clean.yaml byte for byte, except that
 * each function's CodeUri points at its bundle. `sam deploy` packages that.
 * template-clean.yaml itself is not edited.
 *
 * WHAT THE RUNTIME SEES IS THE SAME CODE AND THE SAME LIBRARY VERSIONS:
 *  - Each folder is copied to .aws-sam/bundled/src/ (node_modules excluded) and
 *    its production dependencies installed there from its lockfile, as sam build
 *    did. The source tree is never written to.
 *  - A bare import resolves ONLY inside the function's staged folder — exactly
 *    what its zip holds today. An @aws-sdk/* package the folder installs is
 *    bundled at the version it pins. One it does NOT install stays external and
 *    the Lambda runtime supplies it, as it does today: all of game (no
 *    package.json), and e.g. @aws-sdk/client-s3, which 17 admin files require
 *    but admin's package.json never declared. Any other import not installed in
 *    the folder fails the build. Without this rule esbuild walks up past the
 *    folder and, in a worktree, bundles whatever the main checkout's root
 *    node_modules holds — which is how the first CI run (1ce362bf) failed on a
 *    client-s3 that passed locally.
 *  - Handlers keep their paths ("orgs/foo.handler" -> orgs/foo.js in the bundle).
 *  - Not minified, so CloudWatch stack traces stay readable.
 *  - UNBUNDLED functions ship their staged folder whole, as before. A bundle of
 *    any other function that pulls in one of HEAVY fails the build, so the
 *    document parser cannot creep into the other bundles.
 *
 * Run from the repo root:  node scripts/ci/bundle-lambdas.js
 * Needs scripts/ci/node_modules (npm ci --prefix scripts/ci). Runs on Node 18,
 * the CodeBuild runtime, so no Node 20+ APIs.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(REPO, 'template-clean.yaml');
const OUT = path.join(REPO, '.aws-sam', 'bundled');

/** Packages the nodejs22.x runtime provides when a zip does not carry them. */
const RUNTIME_PROVIDED = /^@aws-sdk\//;
/** Functions shipped as their whole folder: pdf-parse/mammoth are not bundled. */
const UNBUNDLED = new Set(['AdminParseDocumentFunction']);
/** Packages that may only appear in an UNBUNDLED function. */
const HEAVY = ['pdf-parse', 'mammoth', 'pdfjs-dist'];

/**
 * Every AWS::Serverless::Function in the template, read line by line so the
 * rewrite below can change exactly the CodeUri lines and nothing else.
 * Throws unless each function has exactly one CodeUri and one Handler.
 */
function readFunctions(text) {
  const lines = text.split('\n');
  const fns = [];
  let inResources = false;
  let cur = null;
  const close = () => {
    if (!cur || !cur.isFunction) return;
    if (cur.codeUri.length !== 1 || cur.handler.length !== 1) {
      throw new Error(`${cur.name}: expected one CodeUri and one Handler, found ${cur.codeUri.length} and ${cur.handler.length}`);
    }
    fns.push({ name: cur.name, codeUri: cur.codeUri[0].value, codeUriLine: cur.codeUri[0].line, handler: cur.handler[0] });
  };
  lines.forEach((line, i) => {
    // A comment is never structure — template-clean.yaml has column-0 comments
    // inside Resources, which read as a new top-level key would end it.
    if (/^\s*#/.test(line)) return;
    if (/^\S/.test(line)) {
      close();
      cur = null;
      inResources = /^Resources:\s*$/.test(line);
      return;
    }
    if (!inResources) return;
    const head = line.match(/^ {2}([A-Za-z0-9]+):\s*$/);
    if (head) {
      close();
      cur = { name: head[1], isFunction: false, codeUri: [], handler: [] };
      return;
    }
    if (!cur) return;
    if (/^ {4}Type:\s*AWS::Serverless::Function\s*$/.test(line)) cur.isFunction = true;
    const uri = line.match(/^ {6}CodeUri:\s*(\S+)\s*$/);
    if (uri) cur.codeUri.push({ value: uri[1], line: i });
    const h = line.match(/^ {6}Handler:\s*(\S+)\s*$/);
    if (h) cur.handler.push(h[1]);
  });
  close();
  return fns;
}

/** template text with each named function's CodeUri line replaced; nothing else changes. */
function rewriteTemplate(text, newCodeUri) {
  const lines = text.split('\n');
  const fns = readFunctions(text);
  for (const fn of fns) {
    const to = newCodeUri[fn.name];
    if (!to) throw new Error(`no bundle location for ${fn.name}`);
    lines[fn.codeUriLine] = lines[fn.codeUriLine].replace(/CodeUri:\s*\S+/, `CodeUri: ${to}`);
  }
  return lines.join('\n');
}

/** "orgs/foo.handler" -> "orgs/foo.js" */
function handlerFile(handler) {
  return `${handler.split('.').slice(0, -1).join('.')}.js`;
}

/** Copy a CodeUri folder without node_modules and install its production deps there. */
function stage(codeUri) {
  const from = path.join(REPO, codeUri);
  const to = path.join(OUT, 'src', codeUri.replace(/^lambda-functions\//, ''));
  fs.cpSync(from, to, { recursive: true, filter: (p) => !p.split(path.sep).includes('node_modules') });
  if (fs.existsSync(path.join(to, 'package.json'))) {
    // The same install sam build ran ("NodejsNpmBuilder:NpmInstall" in the
    // CodeBuild logs, not NpmCI): `npm install` with the lockfile beside it, so
    // the versions shipped are the ones shipped today. Not `npm ci`: auth's
    // lockfile is out of step with its package.json, which ci refuses.
    execFileSync('npm', ['install', '--omit=dev', '--no-save', '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: to, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return to;
}

/**
 * esbuild plugin: a bare import must resolve inside `root` (the staged folder).
 * Outside it, a runtime-provided package goes external and anything else fails.
 */
function confineTo(folder) {
  // Real paths on both sides: no trailing slash, and no symlink (macOS /var is
  // /private/var; esbuild reports the real one), or nothing reads as "inside".
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const root = real(path.resolve(folder));
  const inside = (p) => { const r = real(p); return r === root || r.startsWith(root + path.sep); };
  const builtin = new Set(require('module').builtinModules);
  return {
    name: 'confine-to-staged-folder',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData === 'confined') return undefined;
        const bare = args.path.replace(/^node:/, '');
        if (args.path.startsWith('node:') || builtin.has(bare.split('/')[0])) return undefined;
        const r = await build.resolve(args.path, {
          kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: 'confined',
        });
        if (!r.errors.length && inside(r.path)) return r;
        if (RUNTIME_PROVIDED.test(args.path)) return { path: args.path, external: true };
        // A library's own optional require (follow-redirects' try { require('debug') })
        // of a package the folder does not install: left as a runtime require, which
        // fails and is caught exactly as it is in today's zip, where it is absent too.
        if (args.importer.split(path.sep).includes('node_modules')) return { path: args.path, external: true };
        return {
          errors: [{ text: `"${args.path}" is not installed in ${path.relative(REPO, root) || root}`
            + (r.errors.length ? '' : ` (it resolved to ${r.path}, outside the folder)`) }],
        };
      });
    },
  };
}

/** Bundle one handler; returns esbuild's metafile and the packages left to the runtime. */
async function bundleOne(esbuild, { entry, root, outfile }) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    metafile: true,
    logLevel: 'silent',
    plugins: [confineTo(root)],
  });
  const external = new Set();
  for (const out of Object.values(result.metafile.outputs)) {
    for (const imp of out.imports || []) if (imp.external) external.add(imp.path);
  }
  return { metafile: result.metafile, external: [...external].sort() };
  // `external` holds both kinds: runtime-provided @aws-sdk/* and a library's
  // optional requires. main() reports them separately.
}

async function main() {
  const esbuild = require('esbuild');
  const t0 = Date.now();
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const fns = readFunctions(text);
  for (const name of UNBUNDLED) {
    if (!fns.some((f) => f.name === name)) throw new Error(`UNBUNDLED names ${name}, which the template does not define`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  const staged = {};
  for (const codeUri of [...new Set(fns.map((f) => f.codeUri))]) staged[codeUri] = stage(codeUri);
  const tStaged = Date.now();

  const newCodeUri = {};
  const runtimeProvided = new Set();
  await Promise.all(fns.map(async (fn) => {
    const src = staged[fn.codeUri];
    const file = handlerFile(fn.handler);
    if (!fs.existsSync(path.join(src, file))) throw new Error(`${fn.name}: handler file ${fn.codeUri}${file} does not exist`);
    if (UNBUNDLED.has(fn.name)) {
      newCodeUri[fn.name] = `${path.relative(OUT, src)}/`;
      return;
    }
    const outDir = path.join(OUT, 'fn', fn.name);
    const result = await bundleOne(esbuild, { entry: path.join(src, file), root: src, outfile: path.join(outDir, file) });
    for (const pkg of result.external) runtimeProvided.add(pkg);
    const heavy = Object.keys(result.metafile.inputs)
      .filter((p) => HEAVY.some((pkg) => p.includes(`node_modules/${pkg}/`)));
    if (heavy.length) {
      throw new Error(`${fn.name} pulls in ${heavy[0]}; only ${[...UNBUNDLED].join(', ')} may. Add it to UNBUNDLED or drop the import.`);
    }
    newCodeUri[fn.name] = `fn/${fn.name}/`;
  }));

  fs.writeFileSync(path.join(OUT, 'template.yaml'), rewriteTemplate(text, newCodeUri));

  const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
  const fnBytes = size(path.join(OUT, 'fn'));
  console.log(`bundle-lambdas: ${fns.length - UNBUNDLED.size} bundled + ${UNBUNDLED.size} whole-folder; `
    + `staged ${((tStaged - t0) / 1000).toFixed(0)}s, bundled ${((Date.now() - tStaged) / 1000).toFixed(0)}s; `
    + `bundles total ${(fnBytes / 1e6).toFixed(1)} MB -> ${path.relative(REPO, path.join(OUT, 'template.yaml'))}`);
  const sdk = [...runtimeProvided].filter((p) => RUNTIME_PROVIDED.test(p)).sort();
  const builtin = new Set(require('module').builtinModules);
  const optional = [...runtimeProvided]
    .filter((p) => !RUNTIME_PROVIDED.test(p) && !p.startsWith('node:') && !builtin.has(p.split('/')[0])).sort();
  console.log(`bundle-lambdas: from the Lambda runtime's SDK (not installed in their folder, as today): ${sdk.join(', ') || 'none'}`);
  console.log(`bundle-lambdas: libraries' optional requires left unresolved (absent from today's zips too): ${optional.join(', ') || 'none'}`);
}

module.exports = { readFunctions, rewriteTemplate, handlerFile, bundleOne, UNBUNDLED, RUNTIME_PROVIDED, HEAVY };

if (require.main === module) {
  main().catch((err) => {
    console.error(`bundle-lambdas: FAILED — ${err.message}`);
    process.exit(1);
  });
}
