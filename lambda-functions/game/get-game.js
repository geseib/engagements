const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { decryptItem } = require('./tenant-crypto');
const { callerMayDriveSession } = require('./tenant');
const { normalizeNames } = require('./survey-names');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/*
  THE HOST'S DOOR, `GET /games/{gameId}/host-details`: a second event on this
  function (template-clean.yaml, GetGameHostDetailsEvent), the way
  /ai-summary/host is on get-ai-summary.js. It returns everything the public
  `?role=host` branch does, plus the two fields that branch must not carry:
  the session's Workie context (`AIContext`) and its Call & Answer briefing,
  both DECRYPTED. They are the host's own writing about their organisation
  and a customer's document, ciphertext at rest per org, and no phone, laptop
  or tablet in the room is ever shown them. The edit dialog's prefill is their
  only reader (GameHostPage.jsx editGameFromHistory).

  Cognito in front, hosts|admins named in authorizer.js, and
  callerMayDriveSession here. NO IDENTITY IS REFUSED OUTRIGHT, before any
  read, as get-report.js does: callerMayDriveSession passes a caller with no
  groups, so on its own it would hand an orgless session's context to anyone
  the day this route lost its authorizer. The session's owner is checked on
  the RAW row, before anything is decrypted, so a refused caller costs no
  KMS call. Every refusal is the same "Game not found" as a code that names
  nothing: a different answer for "it is somebody else's" is an existence
  oracle over 9,000 codes. tests/get-game-host-details.js.
*/
const HOST_DETAILS_ROUTE = /\/host-details$/;

const gameNotFound = () => ({
  statusCode: 404,
  body: JSON.stringify({ error: 'Game not found' }),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { role } = queryParams; // 'host' or 'player'
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Which door: the ROUTE decides, never `role`. API Gateway sets routeKey;
    // rawPath is the fallback when it is absent.
    const rc = event.requestContext || {};
    const onHostDoor = HOST_DETAILS_ROUTE.test(rc.routeKey || event.routeKey || event.rawPath || '');

    console.log(`🎮 Getting game info for ${gameId}, ${onHostDoor ? 'host details' : `role: ${role || 'unspecified'}`}`);

    if (onHostDoor) {
      const authorizer = rc.authorizer || {};
      const identity = (authorizer.jwt && authorizer.jwt.claims) || authorizer.lambda;
      if (!identity) return gameNotFound();
    }

    // Get game metadata
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) return gameNotFound();
    if (onHostDoor && !callerMayDriveSession(event, gameMetadata.Item)) return gameNotFound();

    // ── THE ANONYMOUS DECRYPT, WHICH IS THE POINT ────────────────────────────
    //
    // `GET /games/{gameId}` is PUBLIC — RootPage checks a typed join code
    // against it before anyone has signed in — so this handler decrypts on an
    // unauthenticated path, and it CAN, because the row carries `orgId`.
    // Deriving the org from the caller would give '' for every real
    // participant, and a blank orgId throws rather than defaulting.
    //
    // Encrypting a title participants are shown anyway is not a contradiction:
    // the threat is a `Scan` of the table by someone who was never in the room,
    // not the person standing in it. "Q3 Restructure Retro" names the meeting
    // and usually the problem.
    const sessionOrgId = typeof gameMetadata.Item.orgId === 'string'
      ? gameMetadata.Item.orgId.trim()
      : '';
    const sessionMeta = sessionOrgId
      ? await decryptItem(sessionOrgId, 'session', gameMetadata.Item)
      : gameMetadata.Item;

    // Get game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    // Get category state
    const categoryState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
    }));

    // Same default-ON rule as the anonymity gate (game/anonymity.js:isHidden):
    // only an explicit `false` turns it off, so a game with no HostPreferences
    // recorded — including every game created before this flag existed —
    // reports `true`, matching what the gate would actually do for it.
    const hostPreferences = gameMetadata.Item.HostPreferences || {};
    const anonymousUntilReveal = hostPreferences.anonymousUntilReveal !== false;

    // Base game information (common to both host and player)
    const baseGameInfo = {
      gameId: gameId,
      title: sessionMeta.Title,
      gameType: gameMetadata.Item.GameType,
      anonymousUntilReveal: anonymousUntilReveal,
      createdAt: gameMetadata.Item.CreatedAt,
      hostName: sessionMeta.HostName,
      visibility: gameMetadata.Item.Visibility || 'public',
      started: gameMetadata.Item.Started || false,
      state: gameState.Item?.State || 'CREATED',
      currentQuestionId: gameState.Item?.CurrentQuestionId || null,
      lessonNumber: gameState.Item?.LessonNumber || 0,
      // THE SURVEY'S OWN FACTS, for a page that reloads mid-survey: what it
      // writes about people (null on every other session type), when the room
      // first opened (any session type — startSession stamps it), and the
      // two-minute warning if the host gave one. Behaviour every participant
      // is told about anyway; nothing here is a secret.
      names: gameMetadata.Item.GameType === 'survey' ? normalizeNames(gameMetadata.Item.Names) : null,
      openedAt: gameMetadata.Item.OpenedAt || null,
      warnedAt: gameState.Item?.WarnedAt || null
    };

    // Role-specific information.
    //
    // `role` IS A QUERY PARAMETER. This route is public and must stay public —
    // it is the session brief the root page checks a typed join code against,
    // and every participant's phone calls it — so `?role=host` is a CLAIM that
    // anyone can make, not a fact the API established. Nothing below this line
    // may be a secret.
    //
    // `accessCode: gameMetadata.Item.AccessCode` used to be here, and it was
    // the whole private-game control: `join-game.js:58-83` compares the code a
    // player types against exactly that value and nothing else. So
    // `GET /games/{id}?role=host` handed the password for a private session to
    // any unauthenticated caller who knew — or walked — the four-digit id.
    // DELETED, not gated: no caller ever read it. `attemptAutoJoin` and the
    // access-code form in PlayerPage.jsx supply the code from what the player
    // typed; GameHostPage's two `?role=host` reads take `started`,
    // `anonymousUntilReveal` and `categoryState`; the host already holds the
    // code because the create form chose it (`create-game.js:9`). Re-adding it
    // behind an `Authorization` check would mean this handler verifying a JWT
    // itself — the route carries no authorizer — to restore a field with no
    // reader. If a surface ever genuinely needs to display a running session's
    // own code, put it on a route that IS authorized.
    //
    // `aiContext` and `briefing` LEFT THIS BRANCH ON 2026-09-26 for the same
    // reason, and went to a route that IS authorized: the host's door at the
    // top of this file. What is still here is either shown to every phone
    // anyway (the title, the host's name, and `details`, which the player
    // branch returns as `engagementInfo`) or settings, not writing: the set's
    // id and library, the voice and the summary approach (all four also on
    // the public GET /games/{id}/state), the shuffle flag, the category masks,
    // and two question lists nothing ever writes. The host page's two public
    // reads still use this branch for `started`, `anonymousUntilReveal` and
    // `categoryState`.
    if (onHostDoor || role === 'host') {
      // Host gets additional administrative information
      const result = {
        ...baseGameInfo,
        questionSetId: gameMetadata.Item.QuestionSetId,
        // THE OTHER HALF OF THE PIN. `QuestionSetId` alone names one set PER
        // LIBRARY (tenant.js) — the runtime resolvers have always read the pair
        // off METADATA, but this route returned only the id, so the host page
        // restoring a session had to fall back to SEARCHING the readable scopes
        // for its categories. That search is org-first and right almost always;
        // it is ambiguous exactly when two libraries hold the same slug, which
        // is the case the pair exists for. Absent on sessions created before the
        // pin, which the client reads as platform.
        questionSetScope: gameMetadata.Item.QuestionSetScope || 'platform',
        details: sessionMeta.Details,
        // Prefill for the edit dialog (PUT /games/{gameId}). None of these is
        // a secret — the persona is a label, and both flags describe behaviour
        // every participant can observe. `visibility` and `anonymousUntilReveal`
        // are already in baseGameInfo above. `accessCode` is deliberately NOT
        // re-added; the comment above records why it was removed.
        personaId: gameMetadata.Item.PersonaId || '',
        // The summary approach, for the same prefill — and it has to be here:
        // the edit's PUT sends promptId, '' REMOVEs it, so a prefill without
        // it erased the approach chosen at create on any edit at all.
        promptId: gameMetadata.Item.PromptId || '',
        // Same default-ON rule as anonymousUntilReveal above: only an explicit
        // false means "in written order" (schema-compliant-manager.js:106).
        randomizeQuestions: hostPreferences.randomizeQuestions !== false,
        usedQuestions: gameState.Item?.UsedQuestions || [],
        playedQuestions: gameState.Item?.PlayedQuestions || [],
        categoryState: categoryState.Item ? {
          hostMask1_8: categoryState.Item['HostMask1-8'],
          hostMask9_16: categoryState.Item['HostMask9-16'],
          hostMask17_24: categoryState.Item['HostMask17-24'],
          availMask1_8: categoryState.Item['AvailMask1-8'],
          availMask9_16: categoryState.Item['AvailMask9-16'],
          availMask17_24: categoryState.Item['AvailMask17-24']
        } : null
      };

      if (onHostDoor) {
        // THE HOST'S OWN WRITING, DECRYPTED, for the edit prefill — on the
        // host's door only (see the top of this file). The Workie context is
        // what they told the AI about their organisation; the briefing is a
        // summary of a customer's document, its file name riding inside.
        result.aiContext = sessionMeta.AIContext;
        result.briefing = sessionMeta.Briefing || null;
      }

      console.log(`✅ Returning ${onHostDoor ? 'host details' : 'host game info'} for ${gameId}`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Player gets basic game information
      const result = {
        ...baseGameInfo,
        engagementInfo: sessionMeta.Details || ''
      };

      console.log(`✅ Returning player game info for ${gameId}`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

  } catch (error) {
    console.error('Get game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};