/**
 * A KMS that behaves like the one the key policy describes, for suites whose
 * subject is NOT encryption.
 *
 * Once `tenant-crypto` is wired into the handlers, any fixture that creates org
 * content hits `org <id> has no dataKeyCiphertext` — a deliberate throw, because
 * silently writing plaintext for a tenant that believes it is encrypted is worse
 * than failing the request. Six suites went red on it at once, none of them
 * about crypto.
 *
 * THIS DOES NOT WEAKEN THEM. The stub REFUSES a Decrypt whose encryption context
 * is missing or disagrees with the blob, exactly as the deny-without-tenant-context
 * statement in template-clean.yaml will. An org-confusion bug in a call site
 * therefore fails here rather than passing quietly and failing in production.
 *
 * Two things are needed and both are easy to forget:
 *   1. the KMS stub, registered BEFORE any handler loads;
 *   2. an `ORG#<id>/METADATA` row carrying the wrapped blob.
 * Every tenant-crypto copy's default loader reads that row through the suite's
 * own stubbed DynamoDB, so seeding it once serves the admin, game and websocket
 * bundles alike without any of them being told about it.
 */
const nodeCrypto = require('crypto');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');

class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }

/** The wrapped blob remembers the org it was minted for — that is what makes
 *  the context check below meaningful rather than decorative. */
const wrap = (orgId, key) =>
  Buffer.from(JSON.stringify({ orgId, key: key.toString('base64') }), 'utf8');

/**
 * @returns {{exports: object, calls: {generate: number, decrypt: number}}}
 *   `exports` is what to register for '@aws-sdk/client-kms'.
 */
function makeKmsStub() {
  const calls = { generate: 0, decrypt: 0 };
  const exports = {
    KMSClient: class {
      async send(command) {
        if (command instanceof GenerateDataKeyCommand) {
          calls.generate++;
          const orgId = command.input.EncryptionContext?.orgId;
          assert.ok(orgId, 'GenerateDataKey must bind an orgId');
          const key = nodeCrypto.randomBytes(32);
          return { Plaintext: key, CiphertextBlob: wrap(orgId, key) };
        }
        if (command instanceof DecryptCommand) {
          calls.decrypt++;
          const ctx = command.input.EncryptionContext?.orgId;
          // The key policy's `Null: {kms:EncryptionContext:orgId: true}` Deny,
          // reproduced: there is no decrypt that does not name a tenant.
          if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
          const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
          if (blob.orgId && blob.orgId !== ctx) {
            throw new Error('InvalidCiphertextException: encryption context mismatch');
          }
          return { Plaintext: Buffer.from(blob.key, 'base64') };
        }
        throw new Error('unexpected KMS command');
      }
    },
    GenerateDataKeyCommand,
    DecryptCommand,
  };
  return { exports, calls };
}

/**
 * Mint an org's data key exactly as create-org does, and hand back the row to
 * seed. Call AFTER the stubs are installed.
 *
 * @param {(item: object) => void} put  the suite's own store writer
 */
async function mintOrg(put, orgId) {
  const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
  const dataKeyCiphertext = await C.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext });
  // The plaintext is cached in the GAME copy only. Drop it so every bundle
  // starts equal and the row above is what actually gets used.
  C.forgetOrg(orgId);
  return dataKeyCiphertext;
}

/** Clear every bundle copy's key cache — fixtures that reset the store must,
 *  or a later assertion decrypts with a key whose blob no longer exists. */
function forgetAllOrgs() {
  for (const rel of ['game', 'websocket', 'admin/shared']) {
    try {
      require(path.join(REPO, 'lambda-functions', rel, 'tenant-crypto.js')).forgetOrg();
    } catch { /* a bundle this suite never loads */ }
  }
}

/**
 * Give every bundle copy a data key for ANY org, with no DynamoDB row involved.
 *
 * `setCiphertextLoader` is the seam tenant-crypto documents for exactly this:
 * "tests can supply blobs without a DynamoDB in the room". Seeding a real
 * `ORG#<id>/METADATA` row works too — tests/tenant-crypto-wiring.js does it,
 * because proving the DEFAULT loader reads that row is part of its subject —
 * but for a suite whose subject is something else it fights the fixture: every
 * `reset()` clears the store, so the row has to be re-seeded at each one, and
 * an org invented halfway through a test has no row at all.
 *
 * The key is derived from the orgId, so it is stable across the three bundle
 * copies and across a reset, and DIFFERENT PER ORG — which is what keeps a
 * cross-tenant decrypt failing here just as it will in production.
 */
function installTestKeyLoader() {
  for (const rel of ['game', 'websocket', 'admin/shared']) {
    let C;
    try {
      C = require(path.join(REPO, 'lambda-functions', rel, 'tenant-crypto.js'));
    } catch { continue; }            // a bundle this suite never loads
    C.setCiphertextLoader(async (orgId) => {
      const key = nodeCrypto.createHash('sha256').update(`test-key:${orgId}`).digest();
      return wrap(orgId, key).toString('base64');
    });
  }
}

/** The same key `installTestKeyLoader` hands out. Deterministic per org. */
function testKeyFor(orgId) {
  return nodeCrypto.createHash('sha256').update(`test-key:${orgId}`).digest();
}

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/**
 * Unwrap every envelope in a stored row, SYNCHRONOUSLY.
 *
 * A suite whose subject is scoping or versioning compares stored rows to
 * expected values, and an envelope never equals a string. The handlers' own
 * `decryptItem` is async, so using it would mean turning a dozen `check()`s
 * into `await acheck()`s in each file — a large edit to tests that are not
 * about encryption.
 *
 * This does the real AES-256-GCM with the real AAD; the only thing it borrows
 * is that the TEST key is derivable rather than fetched. So an assertion still
 * fails if a handler wrote under the wrong org, wrote a corrupt envelope, or
 * skipped encryption where the boundary says it should not have — it just does
 * not need a KMS round trip to find out.
 *
 * It walks the whole row rather than a field list, so it needs no entity name
 * and cannot drift from ENCRYPTED_FIELDS.
 */
function plainRow(orgId, item) {
  if (!item || typeof item !== 'object') return item;
  const key = testKeyFor(orgId);
  const out = Array.isArray(item) ? [] : {};
  for (const [k, v] of Object.entries(item)) {
    if (isEnvelope(v)) {
      const d = nodeCrypto.createDecipheriv(
        'aes-256-gcm', key, Buffer.from(v.iv, 'base64'), { authTagLength: 16 },
      );
      d.setAAD(Buffer.from(orgId, 'utf8'));
      d.setAuthTag(Buffer.from(v.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(v.ct, 'base64')), d.final()]);
      out[k] = JSON.parse(plain.toString('utf8'));
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** `plainRow` over a list. */
const plainRows = (orgId, items) =>
  (Array.isArray(items) ? items.map((i) => plainRow(orgId, i)) : items);

/**
 * `plainRow`, with the org taken from the row's own partition key.
 *
 * For a suite spanning SEVERAL organisations — which is what an isolation test
 * is — naming the org at each call site is the mistake waiting to happen:
 * decrypting org A's row with org B's key throws, and decrypting with the org
 * you happened to type is a test that proves nothing about the row in front of
 * it. The partition key already says whose it is.
 *
 * A row with no `ORG#` prefix is platform content and passes through.
 */
function plainRowAuto(item) {
  const m = /^ORG#([^#]+)#/.exec(String((item && item.PK) || ''));
  return m ? plainRow(m[1], item) : item;
}

module.exports = {
  makeKmsStub, mintOrg, forgetAllOrgs, installTestKeyLoader,
  plainRow, plainRows, plainRowAuto, testKeyFor,
  GenerateDataKeyCommand, DecryptCommand,
};
