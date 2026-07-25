#!/usr/bin/env node
/**
 * Verify the Image URLs in an "Art Title" question set actually resolve.
 *
 * An Art Title round is an ordinary Call and Answer question carrying an Image
 * column. If that URL 404s the round still plays, but players stare at nothing --
 * so check the set before you run a session with it.
 *
 * Usage:
 *   node scripts/verify-art-images.js [path/to/set.csv]
 *
 * Defaults to sets/famous-art-titles.csv. Exits non-zero if any row fails, so it
 * can gate a deploy or run in CI.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_CSV = path.join(__dirname, '..', 'sets', 'famous-art-titles.csv');
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

// Mirrors the CSV parsing in lambda-functions/admin/upload-questions.js:
// quoted fields may contain commas.
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Follows redirects manually: Wikimedia's Special:FilePath endpoint always
// redirects to the current file location, so a 302 is expected, not a failure.
function head(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve) => {
    let client;
    try {
      client = url.startsWith('http://') ? http : https;
    } catch (e) {
      return resolve({ ok: false, detail: `bad URL: ${e.message}` });
    }

    const req = client.get(url, { headers: { 'User-Agent': 'engagements-art-verify/1.0' } }, (res) => {
      const { statusCode, headers } = res;
      res.resume(); // discard body; we only need status + content-type

      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        if (redirectsLeft <= 0) return resolve({ ok: false, detail: 'too many redirects' });
        const next = new URL(headers.location, url).toString();
        return resolve(head(next, redirectsLeft - 1));
      }

      if (statusCode !== 200) return resolve({ ok: false, detail: `HTTP ${statusCode}` });

      const type = headers['content-type'] || '';
      if (!type.startsWith('image/')) {
        return resolve({ ok: false, detail: `not an image (content-type: ${type || 'none'})` });
      }
      resolve({ ok: true, detail: type });
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve({ ok: false, detail: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV;

  if (!fs.existsSync(csvPath)) {
    console.error(`Not found: ${csvPath}`);
    process.exit(2);
  }

  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]).map((h) => h.replace(/"/g, '').trim());
  const imageIdx = headers.findIndex((h) => h.toLowerCase() === 'image');
  const titleIdx = headers.findIndex((h) => h.toLowerCase() === 'title');

  if (imageIdx === -1) {
    console.error(`No Image column in ${path.basename(csvPath)} -- headers: [${headers.join(', ')}]`);
    process.exit(2);
  }

  const rows = lines.slice(1).map((l) => parseCSVLine(l));
  console.log(`Checking ${rows.length} image URL(s) in ${path.basename(csvPath)}\n`);

  const failures = [];
  for (const [i, values] of rows.entries()) {
    const title = (values[titleIdx] || `row ${i + 1}`).replace(/"/g, '');
    const url = (values[imageIdx] || '').replace(/"/g, '').trim();

    if (!url) {
      console.log(`  SKIP  ${title} -- no image URL (plain text round)`);
      continue;
    }

    const res = await head(url);
    if (res.ok) {
      console.log(`  OK    ${title} [${res.detail}]`);
    } else {
      console.log(`  FAIL  ${title} -- ${res.detail}`);
      console.log(`        ${url}`);
      failures.push({ title, url, detail: res.detail });
    }
  }

  console.log('');
  if (failures.length) {
    console.error(`${failures.length} of ${rows.length} image(s) failed. Fix the Image column for:`);
    failures.forEach((f) => console.error(`  - ${f.title} (${f.detail})`));
    process.exit(1);
  }
  console.log(`All ${rows.length} image(s) resolved.`);
}

main().catch((e) => { console.error(e); process.exit(2); });
