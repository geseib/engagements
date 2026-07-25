#!/usr/bin/env node
/**
 * Build an "Art Title" question set from The Met's Open Access collection.
 *   https://www.metmuseum.org/hubs/open-access
 *
 * Every artwork the Met marks `isPublicDomain` is released CC0, so the image
 * can be reused freely -- which makes it a safer source than image search,
 * where the photograph of an old painting may still be owned by whoever shot it.
 *
 * Why this script exists: the artwork URL is the one part of an Art Title set
 * that cannot be authored by hand reliably. Met image paths
 * (/CRDImages/ep/original/DT1567.jpg) are opaque and only the API knows them.
 * So the round titles stay human-authored -- deliberately evocative and
 * non-spoiling, because inventing the title IS the game -- and the script
 * resolves only the image URL and artist credit, verifying CC0 status as it goes.
 *
 * Usage:
 *   node scripts/build-art-set-from-met.js [outfile.csv]
 *
 * Defaults to sets/met-art-titles.csv. Exits non-zero if any target fails to
 * resolve, so you never get a half-built set that looks complete.
 *
 * Test against a mock:  MET_API_BASE=http://127.0.0.1:8732 node scripts/...
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const API = process.env.MET_API_BASE || 'https://collectionapi.metmuseum.org/public/collection/v1';
const OUT = process.argv[2] || path.join(__dirname, '..', 'sets', 'met-art-titles.csv');
const TIMEOUT_MS = 25000;
// Left blank on purpose: with no per-question instruction the app falls back to its
// art-round defaults, which give a distinct banner and input placeholder rather than
// repeating one sentence twice on screen.
const PROMPT = '';

// Round titles are hand-written and intentionally do NOT reveal the real title.
// `query` is only used to locate the piece in the Met's collection.
const TARGETS = [
  { round: 'CROSSING IN THE COLD',      category: 'American',       query: 'Washington Crossing the Delaware Leutze' },
  { round: 'THE WOMAN IN BLACK',        category: 'Portraiture',    query: 'Madame X Sargent' },
  { round: 'THE LAST ARGUMENT',         category: 'Neoclassical',   query: 'The Death of Socrates David' },
  { round: 'RESTLESS FIELD',            category: 'Post-Impressionism', query: 'Wheat Field with Cypresses van Gogh' },
  { round: 'THE MAN IN THE STRAW HAT',  category: 'Post-Impressionism', query: 'Self-Portrait with a Straw Hat van Gogh' },
  { round: 'THE TOWERING SEA',          category: 'Ukiyo-e',        query: 'Under the Wave off Kanagawa Hokusai' },
  { round: 'GREEN WATER, STILL AIR',    category: 'Impressionism',  query: 'Bridge over a Pond of Water Lilies Monet' },
  { round: 'THE LONG AFTERNOON',        category: 'Renaissance',    query: 'The Harvesters Bruegel' },
  { round: 'A QUIET WINDOW',            category: 'Dutch Golden Age', query: 'Young Woman with a Water Pitcher Vermeer' },
  { round: 'THE VAST VALLEY',           category: 'Hudson River School', query: 'Heart of the Andes Church' },
];

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { headers: { 'User-Agent': 'engagements-met-builder/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`bad JSON: ${e.message}`)); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function csvEscape(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

async function resolveTarget(t) {
  const search = await getJSON(`${API}/search?hasImages=true&q=${encodeURIComponent(t.query)}`);
  const ids = search.objectIDs || [];
  if (!ids.length) throw new Error('no search results');

  // Walk the top hits until one is genuinely CC0 and has a usable image.
  for (const id of ids.slice(0, 10)) {
    let obj;
    try { obj = await getJSON(`${API}/objects/${id}`); }
    catch { continue; }

    if (!obj.isPublicDomain) continue;               // CC0 only -- never ship a restricted image
    const image = obj.primaryImage || obj.primaryImageSmall;
    if (!image) continue;

    const artist = obj.artistDisplayName || 'Unknown artist';
    const date = obj.objectDate ? `, ${obj.objectDate}` : '';
    return {
      objectID: obj.objectID,
      realTitle: obj.title,                          // reported only, never written to the CSV
      school: `${artist}${date} — The Met, CC0`,
      image,
    };
  }
  throw new Error('no public-domain result with an image in the top hits');
}

(async () => {
  console.log(`Building Art Title set from The Met Open Access API\n  ${API}\n`);

  const rows = [];
  const failures = [];

  for (const [i, t] of TARGETS.entries()) {
    process.stdout.write(`  ${String(i + 1).padStart(2)}. ${t.round} ... `);
    try {
      const r = await resolveTarget(t);
      // Detail_lesson is deliberately blank: any description would spoil the round.
      rows.push([
        csvEscape(t.category),
        i + 1,
        csvEscape(t.round),
        csvEscape(''),
        csvEscape(r.school),
        csvEscape(PROMPT),
        csvEscape(r.image),
      ].join(','));
      console.log(`ok  [#${r.objectID} "${r.realTitle}"]`);
    } catch (e) {
      console.log(`FAILED (${e.message})`);
      failures.push({ round: t.round, reason: e.message });
    }
  }

  if (!rows.length) {
    console.error('\nNothing resolved -- is the Met API reachable from here?');
    process.exit(1);
  }

  const header = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${header}\n${rows.join('\n')}\n`);
  console.log(`\nWrote ${rows.length} round(s) to ${OUT}`);

  if (failures.length) {
    console.error(`\n${failures.length} target(s) did not resolve:`);
    failures.forEach((f) => console.error(`  - ${f.round}: ${f.reason}`));
    console.error('\nEdit TARGETS or re-run. Verify the result with:');
    console.error(`  node scripts/verify-art-images.js ${OUT}`);
    process.exit(1);
  }

  console.log('\nNext: node scripts/verify-art-images.js ' + OUT);
})().catch((e) => { console.error(e); process.exit(2); });
