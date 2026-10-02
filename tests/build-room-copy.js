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
process.exit(fail ? 1 : 0);
