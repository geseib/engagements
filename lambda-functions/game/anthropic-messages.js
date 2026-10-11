/**
 * ONE CALL TO THE ANTHROPIC MESSAGES API — signed in with Workload Identity
 * Federation, never a stored key.
 *
 * Two callers:
 *   - claude-route.js, the Engage-wide switch (owner, 2026-10-11) that sends
 *     every Bedrock Haiku 4.5 / Sonnet 4.6 call to Haiku 5.5 / Sonnet 5.5 here
 *     instead, through `postMessages`, falling back to Bedrock on any failure;
 *   - dev's model picker (summary-models.js), through `createMessage`.
 * Both are reached only where the four federation ids are configured for the
 * tier (`anthropicConnected`); elsewhere every call stays on Bedrock.
 *
 * HOW IT SIGNS IN (platform.claude.com/docs/en/manage-claude/wif-providers/aws):
 *   1. AWS STS GetWebIdentityToken, signed with this function's own role
 *      credentials, returns an AWS-signed JWT for the audience
 *      https://api.anthropic.com. Its `sub` is the role's ARN, which the
 *      owner's federation rule in the Claude Console matches — on a per-tier
 *      prefix (arn:aws:iam::<account>:role/engagedev-*), because every
 *      model-calling function has its own role. The real gate is that only
 *      those functions' roles are granted sts:GetWebIdentityToken.
 *   2. POST /v1/oauth/token exchanges that JWT, with the four ids from the
 *      template (ANTHROPIC_FEDERATION_RULE_ID, _ORGANIZATION_ID,
 *      _SERVICE_ACCOUNT_ID, _WORKSPACE_ID — none secret), for a short-lived
 *      access token.
 *   3. Messages is called with `authorization: Bearer <access token>`.
 * The access token is kept for the warm container until a minute before it
 * expires, and minted again then, or once after a 401.
 *
 * NO DEPENDENCY. The game functions have no package.json, and the bundler
 * (scripts/ci/bundle-lambdas.js) fails any bare import that is not @aws-sdk/*,
 * so @smithy/signature-v4 cannot be used here. The STS request is signed with
 * SigV4 by hand on node:crypto (`signSigV4`, pinned against a known answer in
 * tests/ai-model-picker.js), from the credentials Lambda puts in the
 * environment. Everything goes over node:https.
 *
 * DUPLICATED, BYTE FOR BYTE: lambda-functions/game/anthropic-messages.js and
 * lambda-functions/admin/shared/anthropic-messages.js, because Lambda bundles
 * are per-folder. tests/claude-55-switch.js fails the build if they drift.
 *
 * SECRETS NEVER TRAVEL. The JWT, the access token and the role's credentials
 * are never logged, never returned and never part of an error: every failure
 * is a ModelCallError carrying a fixed reason word and, at most, an HTTP
 * status — never a response body.
 *
 * WHAT LEAVES AWS on this path: the prompt — for a round's read, the answers
 * verbatim (and the names, unless the round is anonymous), the question and
 * the host's brief. The owner chose this for every tier where the ids are set.
 */
const https = require('https');
const nodeCrypto = require('crypto');

const API_HOST = 'api.anthropic.com';
const MESSAGES_PATH = '/v1/messages';
const TOKEN_PATH = '/v1/oauth/token';
const API_VERSION = '2023-06-01';
const AUDIENCE = 'https://api.anthropic.com';
/** Under the function's 300s, with room for a second try and the Bedrock fallback. */
const TIMEOUT_MS = 100000;
const AUTH_TIMEOUT_MS = 15000;
/** Mint again this long before the access token says it expires. */
const REFRESH_EARLY_MS = 60000;

const REASONS = Object.freeze({
  NOT_CONNECTED: 'not-connected',
  STS: 'sts-error',
  EXCHANGE: 'token-exchange',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate-limit',
  CREDIT: 'credit',
  OVERLOADED: 'overloaded',
  AUTH: 'auth',
  REFUSAL: 'refusal',
  EMPTY: 'empty-reply',
  MAX_TOKENS: 'max-tokens',
  INVALID: 'invalid-reply',
  API_ERROR: 'api-error',
  NETWORK: 'network',
});

class ModelCallError extends Error {
  constructor(reason, status) {
    super('Anthropic API call failed: ' + reason + (status ? ' (' + status + ')' : ''));
    this.name = 'ModelCallError';
    this.reason = reason;
    if (status) this.status = status;
  }
}

// ---- configuration -----------------------------------------------------------
const ID_VARS = Object.freeze({
  federation_rule_id: 'ANTHROPIC_FEDERATION_RULE_ID',
  organization_id: 'ANTHROPIC_ORGANIZATION_ID',
  service_account_id: 'ANTHROPIC_SERVICE_ACCOUNT_ID',
  workspace_id: 'ANTHROPIC_WORKSPACE_ID',
});

/** The four federation ids, or null when any is missing. */
function federationIds(env = process.env) {
  const ids = {};
  for (const [field, name] of Object.entries(ID_VARS)) {
    const v = String(env[name] || '').trim();
    if (!v) return null;
    ids[field] = v;
  }
  return ids;
}

/** Can an Anthropic API model be reached at all? All four ids set. */
function anthropicConnected(env = process.env) {
  return federationIds(env) !== null;
}

// ---- SigV4, by hand ------------------------------------------------------------
const sha256Hex = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (k, s) => nodeCrypto.createHmac('sha256', k).update(s, 'utf8').digest();

/** RFC 3986 encoding, as SigV4 wants it. */
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * Sign one POST with a form body (an AWS Query API call). Returns the headers
 * to send. `now` is a Date; credentials are { accessKeyId, secretAccessKey,
 * sessionToken? }.
 */
function signSigV4({ host, region, service, body, credentials, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers = {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    host,
    // Signed as @smithy/signature-v4 signs it, so the two agree byte for byte.
    'x-amz-content-sha256': sha256Hex(body),
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => n + ':' + String(headers[n]).trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');
  const scope = [day, region, service, 'aws4_request'].join('/');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + credentials.secretAccessKey, day);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = nodeCrypto.createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');
  return {
    ...headers,
    authorization: 'AWS4-HMAC-SHA256 Credential=' + credentials.accessKeyId + '/' + scope
      + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
  };
}

/** The role's credentials, as Lambda puts them in the environment. */
function roleCredentials(env = process.env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN || '',
  };
}

/** The STS Query body. Audience is a list: Audience.member.1. */
function stsBody() {
  return [
    'Action=GetWebIdentityToken',
    'Version=2011-06-15',
    'Audience.member.1=' + uriEncode(AUDIENCE),
    'SigningAlgorithm=RS256',
    'DurationSeconds=900',
  ].join('&');
}

/** The JWT out of STS's XML answer, or '' — read by tag, nothing else trusted. */
function webIdentityTokenFromXml(xml) {
  const m = /<WebIdentityToken>\s*([A-Za-z0-9_\-.]+)\s*<\/WebIdentityToken>/.exec(String(xml || ''));
  return m ? m[1] : '';
}

// ---- the transport (replaceable in tests; never a real network there) ---------
function httpsTransport({ host, path, method = 'POST', headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => reject(new ModelCallError(REASONS.NETWORK)));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new ModelCallError(REASONS.TIMEOUT));
    });
    req.on('error', (e) => reject(e instanceof ModelCallError ? e : new ModelCallError(REASONS.NETWORK)));
    req.end(body);
  });
}

let transport = httpsTransport;
let clock = () => Date.now();

/** One request; a transport failure is a reason word, never its own text. */
async function send(req, failReason) {
  try {
    return await transport(req);
  } catch (e) {
    if (e instanceof ModelCallError) throw e;
    throw new ModelCallError(failReason);
  }
}

// ---- the access token, once per container until it expires --------------------
let cached = null; // { token, expiresAt }
let minting = null;

async function mintAccessToken() {
  const ids = federationIds();
  if (!ids) throw new ModelCallError(REASONS.NOT_CONNECTED);
  const credentials = roleCredentials();
  if (!credentials) throw new ModelCallError(REASONS.STS);

  const region = process.env.AWS_REGION || 'us-east-1';
  const stsHost = 'sts.' + region + '.amazonaws.com';
  const body = stsBody();
  const sts = await send({
    host: stsHost, path: '/', method: 'POST',
    headers: { ...signSigV4({ host: stsHost, region, service: 'sts', body, credentials, now: new Date(clock()) }),
      'content-length': Buffer.byteLength(body) },
    body, timeoutMs: AUTH_TIMEOUT_MS,
  }, REASONS.STS);
  const jwt = sts.status === 200 ? webIdentityTokenFromXml(sts.body) : '';
  if (!jwt) throw new ModelCallError(REASONS.STS, sts.status);

  const exchange = JSON.stringify({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
    ...ids,
  });
  const res = await send({
    host: API_HOST, path: TOKEN_PATH, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(exchange) },
    body: exchange, timeoutMs: AUTH_TIMEOUT_MS,
  }, REASONS.EXCHANGE);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { parsed = null; }
  const token = parsed && typeof parsed.access_token === 'string' ? parsed.access_token : '';
  if (res.status !== 200 || !token) throw new ModelCallError(REASONS.EXCHANGE, res.status);
  const lifeMs = (Number.isFinite(parsed.expires_in) ? parsed.expires_in : 600) * 1000;
  cached = { token, expiresAt: clock() + lifeMs };
  return token;
}

/** A usable access token: the cached one, or a fresh one. One mint at a time. */
async function accessToken({ fresh = false } = {}) {
  if (!fresh && cached && clock() < cached.expiresAt - REFRESH_EARLY_MS) return cached.token;
  cached = null;
  if (!minting) minting = mintAccessToken().finally(() => { minting = null; });
  return minting;
}

// ---- the Messages call -----------------------------------------------------------
/** Map a non-200 answer to a reason. Reads the error TYPE only, never echoes the message. */
function reasonFor(status, parsed) {
  const type = parsed && parsed.error && parsed.error.type;
  const message = String((parsed && parsed.error && parsed.error.message) || '');
  if (status === 429 || type === 'rate_limit_error') return REASONS.RATE_LIMIT;
  if (status === 529 || type === 'overloaded_error') return REASONS.OVERLOADED;
  if (status === 401 || status === 403) return REASONS.AUTH;
  // Out of credit is a 400 invalid_request_error whose message names the
  // balance. Matched, never echoed.
  if (status === 400 && /credit balance/i.test(message)) return REASONS.CREDIT;
  return REASONS.API_ERROR;
}

/** The request body. Exported for the test that pins its shape. */
function buildRequest(model, promptText, { maxTokens = 2048 } = {}) {
  const body = {
    model: model.modelId,
    max_tokens: model.maxTokens || maxTokens,
    messages: [{ role: 'user', content: promptText }],
    output_config: { effort: 'low' },
  };
  if (model.thinking) body.thinking = model.thinking;
  return body;
}

async function postMessages(token, body, timeoutMs) {
  return send({
    host: API_HOST, path: MESSAGES_PATH, method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body, timeoutMs,
  }, REASONS.NETWORK);
}

/**
 * One Messages request with a body built by the caller, and its parsed answer.
 * The whole attempt — a token mint included — is bounded by `timeoutMs`, so a
 * slow sign-in cannot eat the time the Bedrock fallback needs. Throws a
 * ModelCallError for anything but a 200 with a JSON body, and for a refusal.
 */
async function postMessagesRaw(requestBody, { timeoutMs = TIMEOUT_MS } = {}) {
  const deadline = clock() + timeoutMs;
  const left = () => Math.max(1, deadline - clock());
  let timer;
  const overall = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ModelCallError(REASONS.TIMEOUT)), timeoutMs);
  });
  const attempt = (async () => {
    const body = JSON.stringify(requestBody);
    let res = await postMessages(await accessToken(), body, left());
    if (res.status === 401) {
      res = await postMessages(await accessToken({ fresh: true }), body, left());
    }
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch { parsed = null; }
    if (res.status !== 200) throw new ModelCallError(reasonFor(res.status, parsed), res.status);
    if (!parsed) throw new ModelCallError(REASONS.API_ERROR, res.status);
    if (parsed.stop_reason === 'refusal') throw new ModelCallError(REASONS.REFUSAL);
    return parsed;
  })();
  try {
    return await Promise.race([attempt, overall]);
  } finally {
    clearTimeout(timer);
    attempt.catch(() => {}); // a late failure after the race is already reported
  }
}

/**
 * One reply: { text, stopReason, inputTokens, outputTokens }.
 * Only the reply's text blocks are kept; a thinking block is never read.
 */
async function createMessage(model, promptText, opts = {}) {
  const body = JSON.stringify(buildRequest(model, promptText, opts));
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  let res = await postMessages(await accessToken(), body, timeoutMs);
  if (res.status === 401) {
    // The token may have been revoked or expired early: mint once more.
    res = await postMessages(await accessToken({ fresh: true }), body, timeoutMs);
  }
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { parsed = null; }
  if (res.status !== 200) throw new ModelCallError(reasonFor(res.status, parsed), res.status);
  if (!parsed) throw new ModelCallError(REASONS.API_ERROR, res.status);
  if (parsed.stop_reason === 'refusal') throw new ModelCallError(REASONS.REFUSAL);
  const text = (parsed.content || [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text).join('');
  if (!text.trim()) throw new ModelCallError(REASONS.EMPTY);
  const usage = parsed.usage || {};
  return {
    text,
    stopReason: parsed.stop_reason || null,
    inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
    outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
  };
}

module.exports = {
  REASONS,
  TIMEOUT_MS,
  API_VERSION,
  AUDIENCE,
  ID_VARS,
  ModelCallError,
  anthropicConnected,
  federationIds,
  buildRequest,
  createMessage,
  postMessagesRaw,
  signSigV4,
  stsBody,
  webIdentityTokenFromXml,
  /** Tests only: swap the network and the clock for fakes, and forget the token. */
  _setTransport(fn) { transport = fn || httpsTransport; },
  _setClock(fn) { clock = fn || (() => Date.now()); },
  _resetTokenCache() { cached = null; minting = null; },
};
