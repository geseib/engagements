/**
 * SIGNED CALLS TO THE SHARED ARCHIVE SERVICE — the only way the main app reaches it.
 *
 * The archive (template-archive.yaml, stack `engage2-archive-service`) is ONE service behind
 * dev, test and prod, and each tier has its own Cognito pool, so a Cognito authorizer there
 * would have no single pool to trust. It trusts the AWS account instead: every route requires
 * AWS_IAM, and a caller proves itself by signing with its Lambda role's credentials (SigV4,
 * service `execute-api`). WHO may act is decided before this module is reached, in the
 * handler, by canManageScope(event, PLATFORM).
 * See docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.6.
 *
 * SIGNED FOR THE execute-api HOST, NEVER archive.seibtribe.us. SigV4 signs the Host header,
 * and CloudFront rewrites it on the way to the origin, so a request signed for the CloudFront
 * name arrives carrying a signature for a host it no longer names.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT, not the SDK's provider chain. Lambda always sets
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN for the execution role.
 * Reading them directly cannot wander off to an SSO cache or the instance metadata endpoint,
 * which is how a test run or a laptop would hang instead of failing.
 */
const { SignatureV4 } = require('@smithy/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');

/** RFC 3986 escaping, which is SigV4's — encodeURIComponent leaves !'()* alone. */
const escapeUri = (value) => encodeURIComponent(value)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function archiveBaseUrl() {
  const raw = String(process.env.ARCHIVE_SERVICE_URL || '').trim();
  if (!raw) {
    throw new Error('ARCHIVE_SERVICE_URL is not set on this function, so the archive cannot be reached. '
      + 'This is a deployment fault (template-clean.yaml).');
  }
  const url = new URL(raw);
  if (!/\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
    throw new Error(`ARCHIVE_SERVICE_URL must be the archive API's execute-api endpoint, not ${url.hostname}: `
      + 'a request signed through CloudFront arrives with a different Host and is refused.');
  }
  return url;
}

function environmentCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('No AWS credentials in the environment, so the archive request cannot be signed.');
  }
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN || undefined };
}

/**
 * Build and sign one request, returning exactly what will be sent. Host is signed but not
 * returned: fetch derives it from the URL, which is the value that was signed, and a second
 * copy only invites a mismatch.
 */
async function signedRequest(method, path, { query, body, signingDate } = {}) {
  const base = archiveBaseUrl();
  const credentials = environmentCredentials();
  const entries = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)]);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const signer = new SignatureV4({
    credentials,
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'execute-api',
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method,
    protocol: 'https:',
    hostname: base.hostname,
    path,
    query: Object.fromEntries(entries),
    headers: {
      host: base.hostname,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload,
  }, signingDate ? { signingDate } : undefined);
  const headers = { ...signed.headers };
  delete headers.host;
  const qs = entries.map(([key, value]) => `${escapeUri(key)}=${escapeUri(value)}`).join('&');
  return { url: `${base.origin}${path}${qs ? `?${qs}` : ''}`, method, headers, body: payload };
}

/** Sign and send. `fetch` is looked up at call time so a suite can replace it. */
async function send(method, path, options) {
  const request = await signedRequest(method, path, options);
  return fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
}

/** The parsed reply, or an Error naming the call, the status and the archive's own words. */
async function readJson(response, what) {
  if (!response.ok) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    const error = new Error(`${what}: ${response.status} ${text}`.trim());
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const uploadItem = async (item) => readJson(await send('POST', '/archive/items', { body: item }), 'Archive upload');
const listItems = async (query) => readJson(await send('GET', '/archive/items', { query }), 'Archive list');
const searchItems = async (criteria) => readJson(await send('POST', '/archive/search', { body: criteria }), 'Archive search');
const getItem = async (archiveId) => readJson(
  await send('GET', `/archive/items/${escapeUri(archiveId)}`), `Archive read of ${archiveId}`,
);
const deleteItem = async (archiveId) => readJson(
  await send('DELETE', `/archive/items/${escapeUri(archiveId)}`), `Archive delete of ${archiveId}`,
);

/**
 * An item's row and its stored content. The content comes from the presigned S3 URL the
 * archive mints, fetched WITHOUT signing: S3 refuses a presigned request that also carries
 * an Authorization header.
 */
async function downloadItem(archiveId) {
  const data = await getItem(archiveId);
  const item = data.item || data;
  if (!data.downloadUrl) throw new Error(`Archive item ${archiveId} came back without a downloadUrl.`);
  const response = await fetch(data.downloadUrl);
  if (!response.ok) throw new Error(`Could not download archive item ${archiveId}: ${response.status}`);
  const content = await response.text();
  if (!content || !content.trim()) throw new Error(`Archive item ${archiveId} is empty.`);
  return { item, content };
}

module.exports = {
  archiveBaseUrl, signedRequest, send, readJson,
  uploadItem, listItems, searchItems, getItem, deleteItem, downloadItem,
};
