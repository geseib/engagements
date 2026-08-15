/**
 * ONE ANSWER TO "WHERE DOES THIS IMAGE LIVE", NOT TWO.
 *
 * Three implementations of the same contract exist and have to agree:
 *
 *   lambda-functions/admin/upload-questions.js   toMediaKey()  — the WRITE side
 *   lambda-functions/admin/shared/set-media.js   classify/key  — the READ side
 *   src/src/utils/setMedia.js                    the browser's copy
 *
 * A second opinion here is invisible and expensive: the browser predicts the
 * key a file will land on so it can put a name in the CSV cell, the verifier
 * looks that key up in the bucket, and the importer decides what is actually
 * stored. Disagree by one rule and the panel reports images as missing that
 * are there — or worse, silently stops uploading the ones that are not.
 *
 * This is the same arrangement `utils/questionCategories.js` has with the
 * importer, and it exists for the same reason.
 *
 * The lambda module is CommonJS OUTSIDE jest's rootDir, so it is read and
 * evaluated rather than resolved through jest — no config change, and the file
 * that runs in production is the file under test.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');

/** Evaluate a CommonJS file from outside jest's rootDir. */
function load(...p) {
  const source = fs.readFileSync(path.join(REPO, ...p), 'utf8');
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports;
}

const LAMBDA = load('lambda-functions', 'admin', 'shared', 'set-media.js');
const BROWSER = require('../utils/setMedia');

/**
 * `toMediaKey` read out of upload-questions.js and evaluated on its own.
 *
 * The handler cannot be required here — it constructs a DynamoDB client at
 * module load — and it does not export the function. Slicing the declaration
 * out means this test breaks loudly if the function is renamed or reshaped,
 * which is the intent: it is the definition everything else mirrors.
 */
function importerToMediaKey() {
  const source = fs.readFileSync(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js'), 'utf8');
  const start = source.indexOf('function toMediaKey(');
  if (start < 0) throw new Error('toMediaKey is gone from upload-questions.js — the whole contract moved');
  const end = source.indexOf('\n}', start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return toMediaKey;`)();
}

const toMediaKey = importerToMediaKey();
const SET = 'set-42';

/* The table every implementation is driven with. Each row states the RULE it
   pins, so a failure names the behaviour rather than a string. */
const CASES = [
  ['a bare filename becomes a set-scoped key', 'mona-lisa.jpg', `sets/${SET}/mona-lisa.jpg`, 'key'],
  ['an https URL is stored verbatim — the art sets', 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg', 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg', 'remote'],
  ['an http URL too', 'http://example.com/a.png', 'http://example.com/a.png', 'remote'],
  ['a URL keeps its query string', 'https://x.test/a.jpg?width=900', 'https://x.test/a.jpg?width=900', 'remote'],
  ['a /-rooted repo asset is stored verbatim', '/assets/art/the-enigmatic-smile.jpg', '/assets/art/the-enigmatic-smile.jpg', 'asset'],
  ['an empty cell stays empty', '', '', 'none'],
  ['whitespace is not an image', '   ', '', 'none'],
  ['an already-keyed value is not double-prefixed', `sets/${SET}/mona-lisa.jpg`, `sets/${SET}/mona-lisa.jpg`, 'key'],
  ['another set’s key is re-keyed to this set', 'sets/other/mona-lisa.jpg', `sets/${SET}/mona-lisa.jpg`, 'key'],
];

describe('the importer defines the contract, and it has not changed', () => {
  test.each(CASES)('%s', (_label, input, stored) => {
    expect(toMediaKey(input, SET)).toBe(stored);
  });

  test('toMediaKey is idempotent, so a downloaded CSV re-uploads unchanged', () => {
    for (const [, input] of CASES) {
      const once = toMediaKey(input, SET);
      expect(toMediaKey(once, SET)).toBe(once);
    }
  });
});

describe('the two readers classify exactly what the importer stored', () => {
  test.each(CASES)('%s', (_label, input, stored, kind) => {
    expect(LAMBDA.classifyImage(stored)).toBe(kind);
    expect(BROWSER.classifyImage(stored)).toBe(kind);
  });

  test('only a key is ever looked for in the bucket', () => {
    for (const [, , stored, kind] of CASES) {
      const expected = kind === 'key';
      expect(LAMBDA.isMediaKey(stored)).toBe(expected);
      expect(BROWSER.isMediaKey(stored)).toBe(expected);
    }
  });

  test('a remote URL and a repo asset are never reported missing', () => {
    // The Art set is entirely remote URLs, none of them in the bucket, and it
    // works. A verifier that condemned it would be worse than none.
    const nothingUploaded = new Set();
    expect(BROWSER.isImageMissing('https://x.test/a.jpg', nothingUploaded)).toBe(false);
    expect(BROWSER.isImageMissing('/assets/art/a.jpg', nothingUploaded)).toBe(false);
    expect(BROWSER.isImageMissing('', nothingUploaded)).toBe(false);
    expect(BROWSER.isImageMissing(`sets/${SET}/a.jpg`, nothingUploaded)).toBe(true);
    expect(BROWSER.isImageMissing(`sets/${SET}/a.jpg`, [`sets/${SET}/a.jpg`])).toBe(false);
  });
});

describe('the browser predicts the key the importer will produce', () => {
  const NAMES = [
    'mona-lisa.jpg',
    'Mona Lisa.JPG',
    'a/b/c/deep.png',
    '../../escape.png',
    'C:\\folder\\windows.png',
    'weird name (1).webp',
    '.hidden.png',
  ];

  test.each(NAMES)('%s lands on the same key in both implementations', (name) => {
    expect(BROWSER.mediaKeyFor(SET, name)).toBe(LAMBDA.mediaKeyFor(SET, name));
  });

  test('and the importer keys that same value to itself', () => {
    for (const name of NAMES) {
      const key = LAMBDA.mediaKeyFor(SET, name);
      if (!key) continue;
      // What the browser writes into the CSV cell is the sanitised NAME; the
      // importer must turn that into the key the file was uploaded to.
      const cell = key.slice(`sets/${SET}/`.length);
      expect(toMediaKey(cell, SET)).toBe(key);
    }
  });

  test('nothing can climb out of the set prefix', () => {
    for (const name of ['../../etc/passwd', '/etc/passwd', 'a/../../b.png', '....//x.png']) {
      for (const impl of [BROWSER, LAMBDA]) {
        const key = impl.mediaKeyFor(SET, name);
        if (!key) continue;
        expect(key.startsWith(`sets/${SET}/`)).toBe(true);
        expect(key.slice(`sets/${SET}/`.length)).not.toContain('/');
        expect(key).not.toContain('..');
      }
    }
  });

  test('a name that reduces to nothing is refused rather than renamed', () => {
    for (const name of ['', '   ', '...', '///', '\\\\']) {
      expect(BROWSER.mediaKeyFor(SET, name)).toBe('');
      expect(LAMBDA.mediaKeyFor(SET, name)).toBe('');
    }
  });
});

describe('the accepted types are one closed list, in both places', () => {
  test('the maps are identical', () => {
    expect(BROWSER.ALLOWED_TYPES).toEqual(LAMBDA.ALLOWED_TYPES);
  });

  test('the ceilings are identical', () => {
    expect(BROWSER.MAX_BYTES).toBe(LAMBDA.MAX_BYTES);
    expect(BROWSER.MAX_FILES_PER_REQUEST).toBe(LAMBDA.MAX_FILES_PER_REQUEST);
  });

  test.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['art.png', 'image/png'],
    ['art.webp', 'image/webp'],
    ['diagram.svg', 'image/svg+xml'],
    ['notes.pdf', ''],
    ['payload.exe', ''],
    ['archive.zip', ''],
    ['noextension', ''],
    ['trailing.', ''],
  ])('%s signs as %s in both implementations', (name, type) => {
    expect(BROWSER.contentTypeFor(name)).toBe(type);
    expect(LAMBDA.contentTypeFor(name)).toBe(type);
  });
});

describe('planning a folder', () => {
  const fake = (name, size = 1024) => ({ name, size, webkitRelativePath: `art/${name}` });

  test('non-images are skipped as a group and images are kept', () => {
    const plan = BROWSER.planFolderUpload(
      [fake('.DS_Store'), fake('questions.csv'), fake('a.jpg'), fake('b.png')],
      SET,
    );
    expect(plan.accepted.map((a) => a.name)).toEqual(['a.jpg', 'b.png']);
    expect(plan.skipped).toBe(2);
    expect(plan.rejected).toEqual([]);
  });

  test('two files that would become one key are reported, not silently raced', () => {
    const plan = BROWSER.planFolderUpload([fake('Mona Lisa.jpg'), fake('mona-lisa.jpg')], SET);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/also becomes/);
  });

  test('an oversized image is named, not skipped as noise', () => {
    const plan = BROWSER.planFolderUpload([fake('huge.jpg', BROWSER.MAX_BYTES + 1)], SET);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0].reason).toMatch(/the ceiling is 12 MB/);
    expect(plan.skipped).toBe(0);
  });

  test('every accepted file already knows its key and its content type', () => {
    const plan = BROWSER.planFolderUpload([fake('a.JPG')], SET);
    expect(plan.accepted[0].key).toBe(`sets/${SET}/a.jpg`);
    expect(plan.accepted[0].contentType).toBe('image/jpeg');
  });
});
