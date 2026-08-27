// Lambda authorizer for the HTTP API (payload format 2.0, simple responses).
//
// Validates a Cognito JWT (ID token) from the Authorization header against
// the user pool configured via env (USER_POOL_ID / CLIENT_ID — UserPoolV2),
// resolves the user's groups, and allows/denies based on the route.
//
// Wired in template-clean.yaml as RestApi CognitoAuthorizer with
// AuthorizerPayloadFormatVersion "2.0" and EnableSimpleResponses true:
// the handler returns { isAuthorized, context }, not an IAM policy.
const { CognitoIdentityProviderClient, AdminListGroupsForUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');
const { pickActiveOrg } = require('./pick-active-org');

// Cache for Cognito JWKs (persists across warm invocations)
let cachedJwks = null;
let cacheExpiry = 0;

const cognito = new CognitoIdentityProviderClient({});
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Get Cognito JWKs with caching
async function getJwks() {
  const now = Date.now();
  if (cachedJwks && now < cacheExpiry) {
    return cachedJwks;
  }

  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.USER_POOL_ID;
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

  try {
    const response = await axios.get(url);
    cachedJwks = response.data;
    cacheExpiry = now + 3600000; // Cache for 1 hour
    return cachedJwks;
  } catch (error) {
    console.error('Error fetching JWKs:', error);
    throw new Error('Unable to fetch JWKs');
  }
}

// Verify JWT token
async function verifyToken(token) {
  // Decode token header to get kid
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader) {
    throw new Error('Invalid token');
  }

  // Get JWKs
  const jwks = await getJwks();
  const jwk = jwks.keys.find(key => key.kid === decodedHeader.header.kid);
  if (!jwk) {
    throw new Error('JWK not found');
  }

  // Convert JWK to PEM
  const pem = jwkToPem(jwk);

  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';

  // Verify signature, issuer, and audience (frontend sends the ID token,
  // whose aud claim is the app client id)
  return jwt.verify(token, pem, {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${region}.amazonaws.com/${process.env.USER_POOL_ID}`,
    audience: process.env.CLIENT_ID
  });
}

// Get user groups from Cognito
async function getUserGroups(username) {
  try {
    const response = await cognito.send(new AdminListGroupsForUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: username
    }));
    return response.Groups.map(group => group.GroupName);
  } catch (error) {
    console.error('Error fetching user groups:', error);
    return [];
  }
}

// ── THE CALLER'S ORGANISATION ──────────────────────────────────────────────
//
// Tenant identity is resolved HERE, once, and handed to every handler in the
// authorizer context — the same way `userId` and `groups` already are. The
// alternative was each handler querying memberships for itself, which is the
// same query written eleven times and eleven chances to write it wrong; and a
// handler that forgets it does not fail loudly, it silently acts for no org
// (or, worse, for whichever org it guesses). `game/tenant.js` reads what this
// writes and nothing else may re-derive it.
//
// TWO ROWS FEED THE ANSWER:
//
//   PK=USER#<sub>  SK begins_with 'ORG#'   → the memberships, each {orgId, role}
//   PK=USER#<sub>  SK='PROFILE'            → defaultOrgId, the caller's own tie-break
//
// The PROFILE row is already written on signup by `auth/post-confirmation.js`
// and, until now, read by nothing. See the note on readDefaultOrgId below for
// what it does and does not yet contain.
//
// THE MEMBERSHIP LOOKUP MUST NOT BE ABLE TO DENY A REQUEST. Every failure
// below — no table configured, a throttle, a torn row, no memberships at all —
// resolves to `orgId: ''`, and the request proceeds. Two reasons, and the
// second is the one that bites:
//
//   1. NO ORG IS A VALID STATE. A host who has not joined a team yet has no
//      membership row and never will until someone invites them. Platform and
//      public content is readable without an org (`tenant.js:readableScopes`),
//      which is the entire existing product. Denying here would lock out every
//      account that predates multi-tenancy — i.e. all of them.
//   2. THIS FUNCTION GATES THE WHOLE API. A DynamoDB blip turning into
//      `isAuthorized: false` is a total outage of every authorized route,
//      including the participant journey, caused by a table this authorizer
//      did not need five minutes ago. The org is an ENRICHMENT of the context,
//      not a second authentication factor. Handlers that genuinely require an
//      org call `tenant.js:requireOrg` and answer 403 themselves, where the
//      message can say something useful.

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Every organisation this user belongs to, as `{orgId, role}` rows.
 *
 * Returns [] on any failure, deliberately — see the block comment above. The
 * error is logged rather than swallowed silently so a persistently missing
 * table policy is visible in CloudWatch instead of presenting as "org features
 * mysteriously do nothing".
 */
async function getUserMemberships(sub) {
  if (!TABLE_NAME || !sub) return [];
  try {
    const res = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'ORG#' },
    }));
    return (res.Items || [])
      .map((i) => ({ orgId: i.orgId, role: i.role }))
      .filter((m) => typeof m.orgId === 'string' && m.orgId.trim());
  } catch (error) {
    console.error('Error fetching org memberships:', error);
    return [];
  }
}

/**
 * The caller's stated default organisation, or ''.
 *
 * NOTE WHAT THIS ROW CONTAINS TODAY: `post-confirmation.js` writes the PROFILE
 * row with username/email/status/role and NO `defaultOrgId` at all, so this
 * currently returns '' for every existing account. That is correct and not a
 * bug to route around — it only means the tie-break in `pickActiveOrg` has
 * nothing to say until an org picker starts writing the field. A caller with
 * one membership never reaches the tie-break anyway, and a caller with several
 * gets an explicit choice via `x-engage-org` rather than a guess.
 */
async function getDefaultOrgId(sub) {
  if (!TABLE_NAME || !sub) return '';
  try {
    const res = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${sub}`, SK: 'PROFILE' },
    }));
    const v = res.Item && res.Item.defaultOrgId;
    return typeof v === 'string' ? v.trim() : '';
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return '';
  }
}

/**
 * The tenant half of the authorizer context.
 *
 * `orgIds` is COMMA-JOINED, like `groups` immediately above it in the context,
 * and for the same unavoidable reason: a Lambda authorizer context is a flat
 * map of strings — an array put in here arrives at the handler stringified in
 * a shape nobody agreed on, or is dropped. `tenant.js:callerOrgIds` splits it
 * back. Every value is a string for the same reason.
 *
 * `orgIds` carries EVERY membership while `orgId` carries only the active one,
 * because they answer different questions: "may this caller switch to X"
 * (a picker) is not "is this caller acting for X right now" (a row guard).
 * Nothing may use `orgIds` to decide whether a write is permitted — that is
 * `canManageScope`, which reads the single active `orgId` on purpose.
 */
async function resolveOrgContext(sub, requestedOrgId) {
  const [memberships, defaultOrgId] = await Promise.all([
    getUserMemberships(sub),
    getDefaultOrgId(sub),
  ]);
  const active = pickActiveOrg(memberships, requestedOrgId, defaultOrgId);
  return {
    orgId: active ? active.orgId : '',
    orgRole: active ? active.role : '',
    orgIds: memberships.map((m) => String(m.orgId).trim()).filter(Boolean).join(','),
  };
}

// Check if user has required permissions
function hasPermission(groups, requiredGroups) {
  if (!requiredGroups || requiredGroups.length === 0) {
    return true;
  }
  return requiredGroups.some(group => groups.includes(group));
}

// Routes under /admin/* that HOSTS may also reach, matched on the EXACT
// "METHOD path" pair.
//
// These are the question-set routes the create-engagement flow needs: hosts
// build their own sets there rather than in the admin console. Reaching a route
// is not the same as being allowed to change a given row — WHICH set a host may
// edit or delete is decided per-row by `admin/shared/question-set-access.js`,
// which refuses any set the caller did not create. This gate only decides who
// may knock.
//
// EXACT PAIRS, NOT A PREFIX, AND THAT IS THE WHOLE POINT. `path.startsWith(
// 'admin/question-sets')` would read as the same intent and would additionally
// open `admin/question-sets/{setId}/versions`, `.../versions/{version}` (a
// DELETE) and `.../versions/{version}/promote` — three routes that decide which
// content a live game plays and that nothing here is asking to share. This is
// the mirror of the `path === 'games'` decision below: prefix matching in this
// function has already been the wrong tool once, in both directions.
//
// Not included, deliberately: toggle-question-set (global curation — which sets
// the whole product offers), the AI generation routes (they spend Bedrock
// budget), download-question-set, and every version route.
const HOST_ADMIN_ROUTES = new Set([
  // The list. Authenticated, and the only projection carrying ownership, so a
  // host can see which sets are theirs.
  'GET admin/question-sets',
  // Create a set (and, with replaceSetId, replace one the caller owns).
  'POST admin/upload-questions',
  // The blank CSV a host fills in. Read-only and set-independent.
  'GET admin/download-template',
  // Rename/describe a set. Ownership checked in the handler.
  'PUT admin/edit-question-set/{setId}',
  // Delete a set. Ownership checked in the handler.
  'DELETE admin/question-sets/{setId}',
  // The set's images: mint presigned upload URLs, and report which questions
  // point at a file that is not there. Both are ownership-guarded by
  // `requireSetManager` in their handlers, exactly like the two above — a host
  // who builds a set with artwork has to be able to put the artwork somewhere,
  // and to be told when a question is pointing at nothing.
  //
  // STILL EXACT PAIRS. `admin/question-sets/{setId}/media` and
  // `admin/question-sets/{setId}/media/uploads` are two entries because they
  // are two routes; a prefix match here would additionally open every version
  // route, which is the mistake this list's header exists to prevent.
  /*
    ── THE AI BUILDERS, WHICH WERE ADMINS-ONLY BECAUSE OF THE BILL ──────────

    These were withheld from hosts for one reason and it was a good one:
    Bedrock costs money, and before tenancy there was no way to say WHOSE money.
    Every generation was an unattributable charge against the platform.

    That reason has expired. A generation now happens inside an organisation —
    the caller carries an `orgId`, the org carries a plan, and the metering
    ledger exists to attribute usage to it. The owner's call: "now that we have
    teams with purchase and tracking capabilities coming in, it is ok to let it
    have the full AI Builder experience in the host create question set."

    Each is TWO entries, the POST that starts the job and the GET that polls it,
    because they are two routes — see the note below about prefix matching. A
    started job whose poll route refuses is worse than no job at all: the work
    is done, the money is spent, and the answer is unreachable.

    NOT included: the prompt LIBRARY writes (`POST/PUT/DELETE admin/ai-prompts…`,
    `ai-prompt-advisor`, `ai-generate-prompt`). Those shape what the AI does for
    everybody, and they stay Engage's. The read is here because the builders
    offer a summary prompt to choose from and cannot without it.
  */
  'POST admin/ai-generate-trivia',
  'GET admin/ai-generate-trivia/{jobId}',
  'POST admin/ai-generate-scenarios',
  'GET admin/ai-generate-scenarios/{jobId}',
  'POST admin/ai-generate-polls',
  'GET admin/ai-generate-polls/{jobId}',
  'POST admin/ai-generate-survey',
  'GET admin/ai-generate-survey/{jobId}',
  'POST admin/ai-generate-questions',
  'GET admin/ai-generate-questions/{jobId}',
  // "Fill in the rest" on the builder forms, and the set's own name/description
  // draft. Same job shape, same reasoning.
  'POST admin/ai-draft-builder-form',
  'GET admin/ai-draft-builder-form/{jobId}',
  'POST admin/ai-draft-set-metadata',
  'GET admin/ai-draft-set-metadata/{jobId}',
  // READ ONLY. The builders let somebody pick which summary prompt a set uses;
  // writing the library stays Engage's.
  'GET admin/ai-prompts',
  'POST admin/question-sets/{setId}/media/uploads',
  'GET admin/question-sets/{setId}/media',
  // Put a set on the quickstart shelf, or take it off. Ownership-guarded by
  // `requireSetManager` in the handler, exactly like the four above.
  //
  // THIS ONE WAS ON THE "NOT INCLUDED" LIST UNTIL NOW, and the reason it was
  // there is still true: `QuickstartMenu.jsx:46` filters on
  // `set.quickstart && set.active` with no ownership term, so a flagged set
  // shows on EVERY host's quickstart menu. What changed is not the blast
  // radius, it is the row guard — `toggle-quickstart.js` had no ownership
  // check of any kind when it was excluded, so opening the gate then would
  // have let any host flag any set. With the guard in place a host reaches the
  // route and then reaches only sets they created, which is the same bargain
  // edit and delete already make. Requested by the owner: "host question set
  // lists, should allow quick starts easily marked by clicking a tag".
  //
  // `toggle-question-set` (active/inactive) is deliberately still absent. It
  // was not asked for, and unlike quickstart it can take a set OUT of every
  // picker rather than adding it to one shelf.
  'POST admin/toggle-quickstart/{setId}',
]);

// Which groups a route requires. `path` is the route path without a leading
// slash, e.g. "admin/clear-game/{gameId}"; `method` is the HTTP verb.
function requiredGroupsForRoute(method, path) {
  // Hosts reset their own games via the admin clear-game endpoint
  // (GameHostPage.jsx), so hosts are allowed there.
  if (path.startsWith('admin/clear-game')) {
    return ['hosts', 'admins'];
  }
  // Hosts build and manage their own question sets. See HOST_ADMIN_ROUTES.
  if (HOST_ADMIN_ROUTES.has(`${method} ${path}`)) {
    return ['hosts', 'admins'];
  }
  // `platform/...` route, including one somebody meant to be public.
  // ── POLLING AN AI JOB YOU STARTED ────────────────────────────────────────
  //
  // HOST_ADMIN_ROUTES matches exact `METHOD template` pairs, and this handler
  // falls back to `event.rawPath` whenever `routeKey` is absent — which carries
  // a REAL job id, not `{jobId}`. So a host could start a generation, be
  // charged for it, and then be refused the poll that hands over the answer.
  // Strictly worse than never opening the route.
  //
  // Anchored on the five generation families and the two draft helpers by name,
  // not a prefix over `admin/ai-`: a prefix would additionally open
  // `ai-prompt-advisor` and `ai-generate-prompt`, which shape what the AI does
  // for every organisation and stay Engage's.
  const AI_JOB_POLL = new RegExp(
    '^admin/ai-(?:generate-(?:trivia|scenarios|polls|survey|questions)'
    + '|draft-(?:builder-form|set-metadata))/[A-Za-z0-9_-]+$',
  );
  if (method === 'GET' && AI_JOB_POLL.test(path)) {
    return ['hosts', 'admins'];
  }

  // All other admin routes require the admins group
  if (path.startsWith('admin')) {
    return ['admins'];
  }
  // ── ORGANISATION AND INVITATION ROUTES ───────────────────────────────────
  //
  // These do not begin with `admin`, so without this block they fall all the
  // way through to the trailing default. That default happens to be
  // ['hosts','admins'], which is the right answer — and relying on it is a
  // FAIL-OPEN waiting to happen, because two rules sit between here and there:
  //
  //     if (path.includes('join') || path.includes('answer')
  //         || path.includes('vote') || ...) return [];
  //
  // `includes`, on the whole path. An invitation token is 32 base58 characters
  // and travels IN THE PATH — `/invites/org_9xK.4Fq7joinPz2mNbVc8dQwLxRt3/accept`.
  // base58 contains j, o, i, n, v, t, e, a, s and w, so a token that happens to
  // spell one of those three words makes its own accept route return `[]`, and
  // `hasPermission` treats `[]` as "no groups required" — every account in the
  // pool passes, including one still sitting in `pending`. That is the exact
  // failure require-admin.js:19-24 records: authentication doing the work of
  // authorisation. Verified: all three sample tokens above resolve to PUBLIC
  // without this block.
  //
  // Matched by anchored regex covering BOTH the route template (what `routeKey`
  // gives) and a concrete path (what the `rawPath` fallback gives), for the same
  // reason the question-set block below does.
  //
  // Being allowed to KNOCK is all this decides. WHICH org a caller may act on is
  // decided per row by admin/orgs/shared/org-guards.js, which additionally
  // requires a MEMBER row and the right role.
  const ORG_ROUTE = /^orgs(\/[^/]+)*$/;
  // `invites` on its own is "which organisations are waiting for me" — the
  // route the landing screen reads. Signed in is the only requirement; the
  // handler answers with the caller's OWN address and nothing else, so there is
  // no org to be a member of yet. That is the whole point: the person being
  // invited is by definition not in the organisation inviting them.
  const MY_INVITES_ROUTE = /^invites$/;
  const INVITE_ROUTE = /^invites\/[^/]+\/accept$/;
  if (ORG_ROUTE.test(path) || INVITE_ROUTE.test(path) || MY_INVITES_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }

  // ── THE PLATFORM CONSOLE ─────────────────────────────────────────────────
  //
  // Engage staff only, and this is the SECOND of two checks, not the only one:
  // platform-orgs.js re-asks `tenant.isPlatformAdmin` on every call. Both exist
  // because they answer different questions — this one decides who may knock,
  // that one decides who is answered — and because a route whose only guard is
  // a group named here would be one edit away from being open.
  //
  // Anchored, and not `startsWith('platform')`, for the reason recorded on the
  // question-set block below: a prefix silently swallows every future

  const PLATFORM_ROUTE = /^platform\/orgs(\/[^/]+\/status)?$/;
  if (PLATFORM_ROUTE.test(path)) {
    return ['admins'];
  }

  // ── COPYING A SHARED SET INTO YOUR OWN ORGANISATION ──────────────────────
  //
  // Hosts and admins both: copying is how an ordinary member adapts something
  // from the shared library, and refusing it to hosts would leave the library
  // read-only for exactly the people it is for. WHICH set may be copied FROM is
  // decided in the handler — platform and public only, never another
  // organisation's partition.
  //
  // Named here explicitly rather than left to the trailing default, because two
  // rules sit between this point and that default, and one of them is the
  // `path.includes('answer')` clause that a set id can satisfy by accident.
  const COPY_ROUTE = /^question-sets\/[^/]+\/copy$/;
  if (path === 'question-sets/{setId}/copy' || COPY_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }

  /*
    SHARING A SET PUBLICLY, AND WITHDRAWING IT.

    A HOST reaches this route, and the narrower question — whether they may
    publish THIS organisation's content — is decided in the handler, which
    requires an org role of `admin` or `owner`. Copying a shared set IN is any
    member's call because it affects one team; publishing OUT puts their
    material in front of everyone, so the handler asks for more than the
    authorizer does.

    Matched by regex as well as by template for the same reason the copy route
    above is: this handler is reached with a real set id in `rawPath` on some
    paths, and a concrete id must not fall through to the rules below — one of
    which is the `path.includes('answer')` clause that a set id can satisfy by
    accident.
  */
  const PUBLISH_ROUTE = /^question-sets\/[^/]+\/publish$/;
  if (path === 'question-sets/{setId}/publish' || PUBLISH_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }

  // ── THE QUESTION-SET ROUTES, WHICH WERE PUBLIC ───────────────────────────
  //
  // These three carry the product's content — the questions, the answers, the
  // categories, the instructions — and none of them had an authorizer at all.
  // The participant surface was the proof: PlayerPage.jsx fetched the WHOLE of
  // `GET /question-sets` on every round to read two strings about its own set,
  // so every anonymous player in every session received the entire library.
  //
  // Hosts and admins both, not admins only: hosts build and run their own sets
  // and every picker in the create-engagement flow reads these. WHICH set a
  // host may change is still decided per row by
  // admin/shared/question-set-access.js — this only decides who may knock.
  //
  // MATCHED EXACTLY, like HOST_ADMIN_ROUTES above and for the same reason.
  // `path.startsWith('question-sets')` would read as the same intent and is
  // not, because the generic rules below no longer get a say once this returns
  // — and a future `question-sets/{setId}/something-public` would be silently
  // closed by a prefix nobody revisited.
  //
  // THE PLAYER HALF SHIPPED FIRST AND HAD TO. `game/get-question.js` projects
  // `setCustomInstruction`/`setRoundNoun` onto GET /games/{gameId}/question so
  // a participant never calls these. Closing them before that landed would
  // have 401'd every player out of the round — the exact mirror of the
  // `path === 'games'` decision below, in the other direction.
  // The `{setId}` form is the route TEMPLATE, which is what `routeKey` gives.
  // The regex covers the same two routes with a REAL id in place of the
  // placeholder, which is what `rawPath` gives — and the handler falls back to
  // `rawPath` whenever `routeKey` is absent.
  //
  // THAT FALLBACK IS NOT THEORETICAL COVER, IT IS A HOLE THIS CLOSES. The
  // generic rule further down is
  //
  //     if (path.includes('join') || path.includes('answer') || path.includes('vote') ...) return [];
  //
  // — `includes`, on the whole string. A set id is a slug of its title
  // (admin/upload-questions.js:298 lower-cases and strips non-alphanumerics),
  // so a set named "Lessons and Answers" becomes `lessonsandanswers`, and
  // `question-sets/lessonsandanswers/questions` matches `includes('answer')`
  // and returns PUBLIC. Same for any set with "vote" or "join" in its title.
  // Matching the concrete path here means these three routes are decided
  // before that rule is ever consulted.
  //
  // The regex names the two sub-routes rather than taking everything under
  // `question-sets/`, for the reason the HOST_ADMIN_ROUTES header gives: a
  // prefix silently closes routes nobody has written yet.
  const CONCRETE_SET_ROUTE = /^question-sets\/[^/]+\/(questions|categories)$/;
  if (method === 'GET' && (
    path === 'question-sets' ||
    path === 'question-sets/{setId}/questions' ||
    path === 'question-sets/{setId}/categories' ||
    CONCRETE_SET_ROUTE.test(path)
  )) {
    return ['hosts', 'admins'];
  }
  // The games LIST, not a game. `GET /games` returns every session's title,
  // host name and four-digit join code in the environment, and the generic
  // "GET + games is public" rule below would let ANY account in the pool read
  // it — including one still sitting in `pending`, unapproved. That is the
  // failure require-admin.js:19-24 documents for /admin/users/*: an authorizer
  // proves you are someone, it does not prove you are allowed.
  //
  // MATCHED EXACTLY, and that is load-bearing. `path.startsWith('games')` or
  // `path.includes('games')` here would also catch GET /games/{gameId} and
  // every GET /games/{gameId}/* below it — the session brief the root page
  // checks a code against, plus /state, /players, /answers, /question, /votes
  // — and 401 every participant out of the join flow.
  if (method === 'GET' && path === 'games') {
    return ['hosts', 'admins'];
  }
  // Game creation/management requires host or admin group
  if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && path.includes('games')) {
    return ['hosts', 'admins'];
  }
  // Public routes (GET game, join, answer, vote) don't require groups
  if (path.includes('join') || path.includes('answer') || path.includes('vote') ||
      (method === 'GET' && path.includes('games'))) {
    return [];
  }
  // All other routes require at least host group
  return ['hosts', 'admins'];
}

// Main handler — HTTP API payload 2.0 simple response
exports.handler = async (event) => {
  try {
    // HTTP API lowercases header names; identitySource is the configured
    // Authorization header value
    const rawToken = event.identitySource?.[0] || event.headers?.authorization || '';
    const token = rawToken.replace(/^Bearer\s+/i, '');
    if (!token) {
      console.log('Authorization denied: no token');
      return { isAuthorized: false };
    }

    // Verify token
    const decoded = await verifyToken(token);
    const username = decoded['cognito:username'] || decoded.sub;
    const email = decoded.email;

    // Get user groups
    const groups = await getUserGroups(username);

    // Check user status (custom attribute)
    const userStatus = decoded['custom:status'] || 'enabled';
    if (userStatus === 'disabled') {
      console.log(`Authorization denied: user ${username} is disabled`);
      return { isAuthorized: false };
    }

    // routeKey is e.g. "POST /admin/clear-game/{gameId}"
    const [method, routePath] = (event.routeKey || '').split(' ');
    const path = (routePath || event.rawPath || '').replace(/^\//, '');

    const requiredGroups = requiredGroupsForRoute(method, path);
    if (!hasPermission(groups, requiredGroups)) {
      console.log(`Authorization denied: ${username} (groups: ${groups.join(',')}) lacks ${requiredGroups.join('|')} for ${event.routeKey}`);
      return { isAuthorized: false };
    }

    // The organisation this request is acting for. Resolved only after the
    // group gate has passed, so a refused request never costs a table read.
    //
    // HTTP API lowercases header names, so `x-engage-org` is read lower-case
    // here exactly as `authorization` is a few lines up. A header naming an org
    // the caller does not belong to yields NO org — never a substitute one; see
    // pick-active-org.js for why that direction is the only safe one.
    const requestedOrgId = event.headers?.['x-engage-org'] || '';
    const org = await resolveOrgContext(decoded.sub, requestedOrgId);

    return {
      isAuthorized: true,
      // Available to backing lambdas as event.requestContext.authorizer.lambda
      context: {
        userId: decoded.sub,
        username,
        email,
        groups: groups.join(','),
        status: userStatus,
        role: decoded['custom:role'] || 'host',
        // Read by game/tenant.js: callerOrgId / callerOrgRole / callerOrgIds.
        orgId: org.orgId,
        orgRole: org.orgRole,
        orgIds: org.orgIds
      }
    };
  } catch (error) {
    console.error('Authorization error:', error);
    return { isAuthorized: false };
  }
};

// Export for testing
module.exports.HOST_ADMIN_ROUTES = HOST_ADMIN_ROUTES;
module.exports.verifyToken = verifyToken;
module.exports.getUserGroups = getUserGroups;
module.exports.hasPermission = hasPermission;
module.exports.requiredGroupsForRoute = requiredGroupsForRoute;
module.exports.getUserMemberships = getUserMemberships;
module.exports.getDefaultOrgId = getDefaultOrgId;
module.exports.resolveOrgContext = resolveOrgContext;
