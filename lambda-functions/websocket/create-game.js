const { createGame } = require('./schema-compliant-manager');
const { callerOrgId } = require('./tenant');
const { readAllowance } = require('./usage');
const { upgradeRequired, UPGRADE_REQUIRED_STATUS } = require('./pricing');

/**
 * WHERE THE PLAYER LINK POINTS, and why it was pointing at a dead host.
 *
 * This response used to hand back a hardcoded `https://eng.dev.seibtribe.us/...`
 * — the RETIRED off-pipeline twin (CLAUDE.md: frozen at a July 2 bundle, its own
 * Cognito pool, no pipeline). Every session created on test or prod shipped its
 * host a join link to a stale dev site, and a hardcoded dev host in a prod
 * response is a link that cannot ever be right on two tiers out of three.
 *
 * So it is derived, in this order:
 *   1. PUBLIC_APP_URL, if the stack ever sets one — the explicit answer.
 *   2. The Origin of the request. The caller IS the host console; the link is
 *      for the room in front of that same console, so its origin is the right
 *      one by construction and is per-tier for free.
 *   3. The Referer's origin, for a caller that sends one and no Origin.
 *   4. A ROOT-RELATIVE path. Not a guess at a hostname: a relative link the
 *      client resolves against wherever it is actually running is right on
 *      every tier, where a wrong absolute one is silently wrong on two.
 */
const originOf = (event) => {
  const configured = (process.env.PUBLIC_APP_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const headers = event?.headers || {};
  // API Gateway lower-cases header names, but a hand-built invocation (a test,
  // a local harness) may not — so match case-insensitively rather than guessing
  // at three spellings.
  const header = (name) => {
    const want = name.toLowerCase();
    const hit = Object.keys(headers).find((h) => h.toLowerCase() === want);
    return hit ? headers[hit] : '';
  };

  const origin = (header('origin') || '').trim();
  if (/^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, '');

  const referer = (header('referer') || header('referrer') || '').trim();
  if (/^https?:\/\//i.test(referer)) {
    try { return new URL(referer).origin; } catch { /* fall through */ }
  }
  return '';
};

exports.handler = async (event) => {
  // ⚠️ This destructure is a whitelist: anything not named here is dropped on
  // the floor without a word. `triviaTimer` was sent by the frontend for months
  // and silently discarded that way. If you add a field to the create payload,
  // it needs THREE edits — here, the createGame() argument below, and the
  // METADATA item in schema-compliant-manager.js.
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId, questionSetScope } = JSON.parse(event.body || '{}');

  /*
    THE OWNING ORGANISATION. Until this line a session had no owner attribute of
    any kind, and `GET /games` therefore had nothing to scope by and returned
    every session in the environment.

    It is read, not trusted from the body: `callerOrgId` reads the authorizer
    context, which a caller cannot forge. A caller with none creates a session
    that no session list will ever show — see the warning in createGame(). That
    is the safe direction, and it stops being reachable the moment every host
    surface carries an active org.
  */
  const orgId = callerOrgId(event);

  /*
    THE ONE GATE IN THE WHOLE SESSION LIFECYCLE, AND IT IS HERE ON PURPOSE.

    A personal organisation includes five sessions a month and then must
    upgrade — it does not accrue overage, because there is no payment method to
    charge and no invoice to put it on. A Team organisation is metered instead
    and is NEVER gated.

    THE REFUSAL IS ONLY EVER ON CREATING A NEW SESSION. Not on starting one, not
    on joining, answering, voting or results. RATIONALE.md §3 — "Nothing is ever
    blocked" — was written because the single moment a hard limit would fire is
    the moment somebody is standing in front of a room, and a session that
    already exists must run to its end whatever the meter says. Moving this
    check one step later, into join-game.js or start-game.js, stops a room
    mid-round; that is the failure this comment exists to prevent somebody
    "tidying up" into existence. The meter itself (usage.js:recordBillableSession)
    documents the same rule and cannot refuse a join by construction.

    Creating a session is the safe place to say no: nobody is waiting, nothing
    is running, and the answer carries the button that fixes it (a 402 with an
    `upgrade` block, not a bare 403 string).

    `readAllowance` FAILS OPEN — an unreadable plan or counter returns an
    ungated state and logs. This is a commercial limit, not an authorisation
    boundary, and a DynamoDB blip must not stop a paying customer working.
  */
  if (orgId) {
    const allowance = await readAllowance(orgId);
    if (allowance.mustUpgradeForSession) {
      console.log(`🚧 ${orgId} is at its session allowance (${allowance.sessionsUsed}/${allowance.sessionsIncluded}) — refusing a NEW session`);
      return {
        statusCode: UPGRADE_REQUIRED_STATUS,
        body: JSON.stringify(upgradeRequired('sessions', allowance)),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
  }

  /*
    DRAW UNTIL THE ID IS ACTUALLY FREE (issue #26). The comment here used to
    read "Generate a unique 4-digit game ID" above a bare Math.random with no
    uniqueness anywhere — 9,000 values, and every session the table retains
    raises the odds that a new draw lands on a LIVING one and overwrites it
    row by row. The manager's first write (the GAMES index row) now carries
    attribute_not_exists, so a collision fails before anything is damaged and
    this loop simply draws again.

    Eight attempts, then an honest 503: eight straight collisions means the
    id space is effectively full, and creating by luck at that point would be
    the same bug with better odds.
  */
  const MAX_ID_ATTEMPTS = 8;
  let gameId = null;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && !gameId; attempt += 1) {
    const candidate = Math.floor(1000 + Math.random() * 9000).toString();
    console.log(`🎮 Creating game ${candidate} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}, visibility: ${visibility || 'public'}`);
    try {
      await createGame(candidate, {
      title: eventTitle || 'Engagement Session',
      engagementType: gameType || 'call-and-answer',
      questionSetId: questionSetId,
      // Optional explicit version pin. Omitted by the normal create flow, in
      // which case createGame() resolves the set's activeVersion and pins THAT
      // — the game keeps reading the questions it started on even after the set
      // is replaced. Supplying it lets a host deliberately run an older version.
      questionSetVersion: questionSetVersion,
      // WHICH partition that set id lives in — platform, this org's, or public.
      // The id alone stopped naming one partition when sets became per-org, so
      // the game pins the pair (tenant.js header).
      questionSetScope: questionSetScope,
      orgId,
      selectedCategories: selectedCategories || [],
      hostPreferences: {
        randomizeQuestions: randomizeQuestions !== false, // Default to true if not specified
        // Default ON, per the owner: a host who never touches setup still gets
        // an anonymous round. Only an explicit false opts out.
        anonymousUntilReveal: anonymousUntilReveal !== false
      },
      aiContext: aiContext,
      // The host's voice pick. Empty means "adapt to the session" — the
      // designed default — not "fall back to the legacy template".
      personaId: (personaId || '').trim(),
      details: engagementInfo || '',
      hostName: hostName || 'Host',
      visibility: visibility || 'public',
      accessCode: accessCode || null,
      debugMode: false
      });
      gameId = candidate;
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException') {
        console.warn(`⚠️ Game id ${candidate} is already taken — drawing again (attempt ${attempt + 1}/${MAX_ID_ATTEMPTS})`);
        lastError = error;
        continue;
      }
      // Any other failure is the old 500, answered HERE: the loop's throw has
      // nothing above it to land in, and an unhandled throw turns the friendly
      // error into a raw invocation failure.
      console.error(`❌ Create game error for ${candidate}:`, error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create game', details: error.message }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
  }

  if (!gameId) {
    console.error('❌ Could not allocate a free game id after', MAX_ID_ATTEMPTS, 'attempts', lastError);
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Could not allocate a session code — too many sessions are live. Try again, or delete old sessions.' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  console.log(`✅ Game ${gameId} created successfully`);
  return {
    statusCode: 201,
    body: JSON.stringify({
      gameId: gameId,
      title: eventTitle || 'Engagement Session',
      engagementType: gameType || 'call-and-answer',
      visibility: visibility || 'public',
      createdAt: new Date().toISOString(),
      joinUrl: `${originOf(event)}/play?gameId=${gameId}`
    }),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
};
