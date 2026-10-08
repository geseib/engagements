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
// build when it is a label: a string literal, a template chunk or a JSX text
// node, trimmed, equal to the word (or starting with it, for `prefix` words).
// `files` scopes a word to those basenames. Comments and words.js are skipped.

/**
 * Every label-shaped piece of text in a source file: string literals, template
 * chunks, and the text between JSX delimiters. Comments are removed first
 * (state kept across lines); strings are lifted out so their contents never
 * read as code.
 */
function labelsOf(src) {
  const out = [];
  let code = '';
  let i = 0;
  const stack = []; // template literals: brace depth inside ${ }
  const n = src.length;
  const readString = (q) => {
    let j = i + 1; let buf = '';
    while (j < n && src[j] !== q) { if (src[j] === '\\') { buf += src[j + 1] || ''; j += 2; } else { buf += src[j]; j += 1; } }
    out.push(buf); i = j + 1; code += ' ';
  };
  const readTemplateChunk = () => { // i is just after ` or after the closing } of ${ }
    let buf = '';
    while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) {
      if (src[i] === '\\') { buf += src[i + 1] || ''; i += 2; } else { buf += src[i]; i += 1; }
    }
    out.push(buf);
    if (src[i] === '`') { i += 1; code += ' '; } else { i += 2; stack.push(0); code += ' '; }
  };
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/' && (i === 0 || /[\s;,)}{(]/.test(src[i - 1]))) { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
    if (c === '"' || c === "'") {
      // An apostrophe inside JSX text ("don't") is text, not a string: a quote
      // that follows a letter and is followed by a letter is a contraction.
      if (c === "'" && /[A-Za-z]/.test(src[i - 1] || '') && /[A-Za-z]/.test(d || '')) { code += c; i += 1; continue; }
      readString(c); continue;
    }
    if (c === '`') { i += 1; readTemplateChunk(); continue; }
    if (stack.length) {
      if (c === '{') stack[stack.length - 1] += 1;
      if (c === '}') { if (stack[stack.length - 1] === 0) { stack.pop(); i += 1; readTemplateChunk(); continue; } stack[stack.length - 1] -= 1; }
    }
    code += c; i += 1;
  }
  code.split(/[<>{}]/).forEach((seg) => out.push(seg));
  return out.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const matches = (r, label) => (r.prefix
  ? label === r.word || (label.startsWith(r.word) && !/[A-Za-z]/.test(label[r.word.length]))
  : label === r.word);

// Self-test: every form a label can take is caught; a comment is not.
{
  const probe = { word: 'Queue it' };
  const prefixed = { word: 'Parked', prefix: true };
  const cases = [
    ['string', "const a = 'Queue it';", probe, true],
    ['double-quoted attr', '<b title="Queue it" />', probe, true],
    ['JSX text inline', '<button>Queue it</button>', probe, true],
    ['JSX text on its own line', '<button\n  onClick={f}\n>\n  Queue it\n</button>', probe, true],
    ['text after an expression', "<button>{' '}Queue it</button>", probe, true],
    ['text before an expression', '<button>Queue it{n}</button>', probe, true],
    ['template chunk', 'const t = `Queue it`;', probe, true],
    ['template chunk after ${}', 'const t = `${n}Queue it`;', probe, true],
    ['label with a tail', '<h2>Parked · {later.length}</h2>', prefixed, true],
    ['tail in a string', "const h = 'Parked (2)';", prefixed, true],
    ['line comment', "// say 'Queue it' here\nconst a = 1;", probe, false],
    ['block comment on one line', "/* 'Queue it' */ const a = 1;", probe, false],
    ['multi-line JSX comment', "{/* The 'Queue it' button\n   was 'Queue it' once */}\n<b>ok</b>", probe, false],
    ['longer word is not the word', "const a = 'Queue it up';", probe, false],
    ['contraction is text, not a string', "<p>Don't Queue it</p>", probe, false],
    ['prefix needs a word boundary', '<p>Parkedness</p>', prefixed, false],
  ];
  const bad = cases.filter(([, src, r, hit]) => labelsOf(src).some((l) => matches(r, l)) !== hit);
  if (bad.length) {
    bad.forEach(([name]) => console.log(`  FAIL  scanner self-test: ${name}`));
    process.exit(1);
  }
  console.log(`  PASS  retired-word scanner self-test (${cases.length} fixtures)`);
}

const wordsSrc = fs.readFileSync(path.join(REPO, 'src/src/buildroom/words.js'), 'utf8');
const retiredBlock = wordsSrc.slice(wordsSrc.indexOf('export const RETIRED'));
const RETIRED = [...retiredBlock.matchAll(/\{\s*word:\s*'((?:[^'\\]|\\.)*)'([^}]*)\}/g)].map((m) => {
  const files = /files:\s*\[([^\]]*)\]/.exec(m[2]);
  return {
    word: m[1].replace(/\\'/g, "'"),
    prefix: /prefix:\s*true/.test(m[2]),
    enforced: /enforced:\s*true/.test(m[2]),
    files: files ? [...files[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null,
  };
});
if (!RETIRED.length) { console.log('  FAIL  words.js lists no RETIRED words'); process.exit(1); }
let retiredFail = 0;
const enforced = RETIRED.filter((r) => r.enforced);
for (const rel of FILES.filter((f) => /\.jsx?$/.test(f) && f.startsWith('src/src/buildroom/') && !f.endsWith('/words.js'))) {
  const base = path.basename(rel);
  const labels = labelsOf(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  for (const r of enforced) {
    if (r.files && !r.files.includes(base)) continue;
    const hit = labels.find((l) => matches(r, l));
    if (hit !== undefined) {
      console.log(`  FAIL  ${rel}  retired word "${r.word}" (use words.js)  ${hit.slice(0, 80)}`);
      retiredFail += 1;
    }
  }
}
console.log(retiredFail
  ? `\n${retiredFail} retired word(s) back in the Build Room`
  : `  PASS  no retired word (${enforced.length} of ${RETIRED.length} enforced; the rest switch on as their task lands)`);
process.exit(fail || retiredFail ? 1 : 0);
