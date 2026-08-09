/**
 * Archive export/import regression — lambda-functions/admin/export-to-archive.js
 * and lambda-functions/admin/import-from-archive.js.
 *
 * BUG: an archived call-and-answer (art-title) question set loses its Image
 * (and AnswerDetails reveal) on every archive round-trip, in every environment
 * — not just across environments. `convertQuestionsToCSV()` in
 * export-to-archive.js emits a fixed four-column CSV
 * (Category,Title,Detail,CustomInstructions) with no Image column at all.
 * `upload-questions.js`, which the importer reuses to turn the downloaded CSV
 * back into a set, looks for a column literally named "Image"
 * (getColumnIndex('Image')); when it is not there, imageIndex stays -1, every
 * question's Image cell reads as '', and toMediaKey('', setId) returns ''.
 * The artwork reference is gone before the CSV ever leaves the source
 * environment — reimporting into the SAME environment is equally broken, it
 * is just that nobody tries that, so it only ever gets noticed as a
 * cross-environment failure.
 *
 * This exact defect shape (fixed CSV columns silently dropping Image and
 * AnswerDetails) was already found and fixed once, in the sibling "download
 * question set" CSV export — see lambda-functions/admin/download-question-set.js
 * around the `hasImages`/`hasAnswerDetails` conditional columns, commit
 * f6b5c3b0. export-to-archive.js has its own independent CSV serializer and
 * was never given the same fix.
 *
 * This test runs the REAL export and import handlers end-to-end, stubbing
 * only DynamoDB (in-memory store) and the archive service's `fetch` calls (an
 * in-memory relay standing in for archive.seibtribe.us), so the CSV that
 * export produces is the exact CSV import consumes — the same shape of proof
 * used by tests/edit-question-set-flow.js and tests/import-questions-flow.js.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; } }
class PutCommand { constructor(i) { this.input = i; } }
class ScanCommand { constructor(i) { this.input = i; } }
class QueryCommand { constructor(i) { this.input = i; } }
class UpdateCommand { constructor(i) { this.input = i; } }
class BatchWriteCommand { constructor(i) { this.input = i; } }
class DeleteCommand { constructor(i) { this.input = i; } }

const TABLE = 'test-table';
const store = new Map(); // "PK|SK" -> Item
const k = (pk, sk) => `${pk}|${sk}`;
function resetDb() { store.clear(); }

/** Crude FilterExpression support — only what export-to-archive.js actually issues:
 * 'PK = :pk AND begins_with(SK, :skPrefix)'. */
function scan(input) {
  const vals = input.ExpressionAttributeValues || {};
  const pk = vals[':pk'];
  const skPrefix = vals[':skPrefix'];
  const items = [...store.values()].filter((item) => {
    if (pk !== undefined && item.PK !== pk) return false;
    if (skPrefix !== undefined && !String(item.SK).startsWith(skPrefix)) return false;
    return true;
  });
  return { Items: items };
}

const db = {
  async send(cmd) {
    const name = cmd.constructor.name;
    if (name === 'GetCommand') {
      const { PK, SK } = cmd.input.Key;
      return { Item: store.get(k(PK, SK)) };
    }
    if (name === 'PutCommand') {
      const item = cmd.input.Item;
      store.set(k(item.PK, item.SK), item);
      return {};
    }
    if (name === 'ScanCommand') {
      return scan(cmd.input);
    }
    if (name === 'QueryCommand') {
      const vals = cmd.input.ExpressionAttributeValues || {};
      const pk = vals[':pk'];
      const skPrefix = vals[':sk'];
      const items = [...store.values()].filter((item) => {
        if (item.PK !== pk) return false;
        if (skPrefix !== undefined && !String(item.SK).startsWith(skPrefix)) return false;
        return true;
      });
      return { Items: items };
    }
    if (name === 'BatchWriteCommand') {
      const table = TABLE;
      const requests = (cmd.input.RequestItems && cmd.input.RequestItems[table]) || [];
      for (const req of requests) {
        if (req.PutRequest) {
          const item = req.PutRequest.Item;
          store.set(k(item.PK, item.SK), item);
        } else if (req.DeleteRequest) {
          const { PK, SK } = req.DeleteRequest.Key;
          store.delete(k(PK, SK));
        }
      }
      return { UnprocessedItems: {} };
    }
    if (name === 'DeleteCommand') {
      const { PK, SK } = cmd.input.Key;
      store.delete(k(PK, SK));
      return {};
    }
    if (name === 'UpdateCommand') {
      throw new Error('UpdateCommand not expected for a plain (non-replace) import');
    }
    throw new Error(`Unstubbed DynamoDB command: ${name}`);
  }
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => db },
  GetCommand, PutCommand, ScanCommand, QueryCommand, UpdateCommand, BatchWriteCommand, DeleteCommand
});
stub('@aws-sdk/client-s3', {
  S3Client: class { send() { throw new Error('S3 not expected in this test'); } },
  GetObjectCommand: class { constructor(i) { this.input = i; } }
});

process.env.TABLE_NAME = TABLE;
process.env.ARCHIVE_SERVICE_URL = 'https://archive.seibtribe.us';
process.env.STACK_NAME = 'engagedev';

// ---- Stub the archive service's HTTP surface via global.fetch --------------
const ARCHIVE_ID = 'test-archive-id-1';
let capturedUpload = null;
const realFetch = global.fetch;
function installFetchStub() {
  const fakeHeaders = () => new Map([['content-type', 'application/json']]);
  global.fetch = async (url, opts) => {
    if (url === 'https://archive.seibtribe.us/archive/items' && opts && opts.method === 'POST') {
      capturedUpload = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: fakeHeaders(), json: async () => ({ archiveId: ARCHIVE_ID, item: capturedUpload }) };
    }
    if (url === `https://archive.seibtribe.us/archive/items/${ARCHIVE_ID}`) {
      // Mirror the real archive service (lambda-functions/archive/upload-archive.js):
      // it stores/returns the item with PascalCase keys, not the lowerCamelCase
      // body export-to-archive.js POSTed.
      const item = {
        Title: capturedUpload.title,
        Description: capturedUpload.description,
        ContentType: capturedUpload.contentType,
        Category: capturedUpload.category,
        Tags: capturedUpload.tags
      };
      return {
        ok: true, status: 200, headers: fakeHeaders(),
        json: async () => ({ item, downloadUrl: 'https://fake-archive-s3/download' })
      };
    }
    if (url === 'https://fake-archive-s3/download') {
      return { ok: true, status: 200, headers: fakeHeaders(), text: async () => capturedUpload.content };
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
}
function restoreFetch() { global.fetch = realFetch; }

// ---- Load the REAL handlers (after stubs are in place) ----------------------
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js'));
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
  resetDb();
  capturedUpload = null;
  installFetchStub();
  try {
    await fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  } finally {
    restoreFetch();
  }
}

async function main() {
  await test('archived call-and-answer CSV keeps the Image column', async () => {
    const setId = 'artset1';
    store.set(k('SETS', `SET#${setId}`), {
      PK: 'SETS', SK: `SET#${setId}`,
      name: 'Mystery Art', description: 'An art-title round',
      engagementType: 'call-and-answer'
      // no activeVersion -> legacy partition SET#artset1, matching the QUESTION row below
    });
    store.set(k(`SET#${setId}`, 'QUESTION#c001#001'), {
      PK: `SET#${setId}`, SK: 'QUESTION#c001#001',
      Title: 'A puzzling smile', Detail: '', Category: 'Art',
      Image: '/assets/art/the-enigmatic-smile.jpg',
      AnswerDetails: 'The Enigmatic Smile — painted 1900s',
      CustomInstructions: ''
    });

    const exportRes = await exportHandler.handler({
      httpMethod: 'POST',
      body: JSON.stringify({ selectedItems: [setId], exportType: 'questionsets' })
    });
    assert.strictEqual(exportRes.statusCode, 200, `export failed: ${exportRes.body}`);
    assert.ok(capturedUpload, 'export should have POSTed to the archive service');

    const csvHeaderLine = capturedUpload.content.split('\n')[0];
    assert.ok(
      csvHeaderLine.includes('Image'),
      `archived CSV header is missing "Image": ${csvHeaderLine}`
    );
    assert.ok(
      capturedUpload.content.includes('/assets/art/the-enigmatic-smile.jpg'),
      'archived CSV body does not carry the image reference'
    );
  });

  await test('importing an archived art set restores the Image on the new question row', async () => {
    const setId = 'artset1';
    store.set(k('SETS', `SET#${setId}`), {
      PK: 'SETS', SK: `SET#${setId}`,
      name: 'Mystery Art', description: 'An art-title round',
      engagementType: 'call-and-answer'
    });
    store.set(k(`SET#${setId}`, 'QUESTION#c001#001'), {
      PK: `SET#${setId}`, SK: 'QUESTION#c001#001',
      Title: 'A puzzling smile', Detail: '', Category: 'Art',
      Image: '/assets/art/the-enigmatic-smile.jpg',
      AnswerDetails: 'The Enigmatic Smile — painted 1900s',
      CustomInstructions: ''
    });

    const exportRes = await exportHandler.handler({
      httpMethod: 'POST',
      body: JSON.stringify({ selectedItems: [setId], exportType: 'questionsets' })
    });
    assert.strictEqual(exportRes.statusCode, 200, `export failed: ${exportRes.body}`);

    // Simulate a fresh environment: the source set/question rows are gone,
    // only the archive service (our fetch stub) still has the content —
    // exactly like importing into `test` after archiving from `dev`.
    resetDbKeepArchive();

    const importRes = await importHandler.handler({
      httpMethod: 'POST',
      body: JSON.stringify({ selectedItems: [ARCHIVE_ID], importType: 'questionsets', conflictResolution: 'rename' })
    });
    assert.strictEqual(importRes.statusCode, 200, `import failed: ${importRes.body}`);
    const importBody = JSON.parse(importRes.body);
    assert.strictEqual(importBody.results.failed.length, 0, `import reported failures: ${JSON.stringify(importBody.results.failed)}`);
    assert.strictEqual(importBody.results.successful.length, 1, 'expected exactly one imported set');

    const newSetId = importBody.results.successful[0].newId;
    const importedQuestion = [...store.values()].find(
      (item) => item.PK === `SET#${newSetId}` && String(item.SK).startsWith('QUESTION#')
    );
    assert.ok(importedQuestion, 'expected an imported question row in the target environment');
    assert.strictEqual(
      importedQuestion.Image,
      '/assets/art/the-enigmatic-smile.jpg',
      `Image did not survive the archive round-trip (got ${JSON.stringify(importedQuestion.Image)})`
    );
    assert.strictEqual(
      importedQuestion.AnswerDetails,
      'The Enigmatic Smile — painted 1900s',
      'AnswerDetails (the reveal) did not survive the archive round-trip'
    );

    const newSetMeta = store.get(k('SETS', `SET#${newSetId}`));
    assert.ok(newSetMeta, 'expected a SETS metadata row for the imported set');
    assert.strictEqual(newSetMeta.hasImages, true, 'imported set should be flagged hasImages');
  });

  function resetDbKeepArchive() {
    store.clear();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
