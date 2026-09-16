/**
 * NO FRONTEND CODE CALLS THE ARCHIVE SERVICE DIRECTLY.
 *
 * The archive requires signed AWS requests once it is locked (spec §4.6). A browser call to
 * archive.seibtribe.us would fail on that day, and until then it is an unauthenticated call to
 * a store every tier depends on. Every archive call goes through the tier's own admin routes.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sources(full, found);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

test('the scan reaches the archive screen at all', () => {
  expect(sources(SRC).some((file) => file.endsWith(path.join('components', 'ArchivePanel.jsx')))).toBe(true);
});

test('no source file names archive.seibtribe.us', () => {
  const offenders = sources(SRC)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('archive.seibtribe.us'))
    .map((file) => path.relative(SRC, file));
  expect(offenders).toEqual([]);
});
