/**
 * BUILD ROOM COPY — emoji-free, by the owner's rule (2026-10-02): guidance in
 * the UX for everyone, written plainly ("the Orwell rules"), crisp and emoji
 * free; clean icons (components/Icon.jsx) where a menu or button needs one.
 *
 * Every Build Room surface is scanned: the host page, the phone view, the
 * report, the MCP server whose text Claude reads and repeats, and the backend
 * messages a host or a phone sees. A pictograph or dingbat anywhere in them
 * fails the build.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FILES = [
  ...fs.readdirSync(path.join(REPO, 'src/src/buildroom')).map((f) => `src/src/buildroom/${f}`),
  'src/public/engage-mcp.mjs',
  'lambda-functions/game/build-room.js',
  'lambda-functions/game/build-store.js',
];
// Emoji and pictographs, dingbats, misc symbols (★ ✓ ✔ ✻ ☆ ⚡ …), variation selector 16.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F]/u;

let fail = 0;
for (const rel of FILES) {
  const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (EMOJI.test(line)) {
      console.log(`  FAIL  ${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      fail += 1;
    }
  });
}
console.log(fail ? `\n${fail} line(s) carry emoji or pictographs` : `  PASS  ${FILES.length} Build Room files are emoji-free`);

// ---- RETIRED WORDS (docs/design/build-room-batch-2-3, B6) --------------------
// src/src/buildroom/words.js lists the old labels. Each has an `enforced` flag:
// the task that replaces the word switches it on. A retired word fails the
// build when it stands as a label: a whole string literal or JSX text node
// (`prefix` words may start one). Comments and words.js itself are skipped.
const wordsSrc = fs.readFileSync(path.join(REPO, 'src/src/buildroom/words.js'), 'utf8');
const retiredBlock = wordsSrc.slice(wordsSrc.indexOf('export const RETIRED'));
const RETIRED = [...retiredBlock.matchAll(/\{\s*word:\s*'((?:[^'\\]|\\.)*)'([^}]*)\}/g)].map((m) => ({
  word: m[1].replace(/\\'/g, "'"),
  prefix: /prefix:\s*true/.test(m[2]),
  enforced: /enforced:\s*true/.test(m[2]),
}));
if (!RETIRED.length) { console.log('  FAIL  words.js lists no RETIRED words'); process.exit(1); }
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (line) => line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '$1');
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
let retiredFail = 0;
const enforced = RETIRED.filter((r) => r.enforced);
for (const rel of FILES.filter((f) => /\.jsx?$/.test(f) && f.startsWith('src/src/buildroom/') && !f.endsWith('/words.js'))) {
  fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').forEach((raw, i) => {
    if (isCommentLine(raw)) return;
    const line = stripComments(raw);
    for (const r of enforced) {
      const w = escapeRe(r.word);
      const re = r.prefix
        ? new RegExp(`(["'\`>])\\s*${w}(?![A-Za-z])`)
        : new RegExp(`(["'\`>])\\s*${w}\\s*(["'\`<])`);
      if (re.test(line)) {
        console.log(`  FAIL  ${rel}:${i + 1}  retired word "${r.word}" (use words.js)  ${line.trim().slice(0, 80)}`);
        retiredFail += 1;
      }
    }
  });
}
console.log(retiredFail
  ? `\n${retiredFail} retired word(s) back in the Build Room`
  : `  PASS  no retired word (${enforced.length} of ${RETIRED.length} enforced; the rest switch on as their task lands)`);
process.exit(fail || retiredFail ? 1 : 0);
