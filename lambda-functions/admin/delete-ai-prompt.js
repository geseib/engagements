const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const {
  findPromptForCaller, canManagePrompt, promptKey, promptBodyKey,
} = require('./shared/prompt-access');
const { requestedScope, callerUserId } = require('./shared/question-set-access');
const tenant = require('./shared/tenant');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

/**
 * Where does this prompt actually live?
 *
 * D14: create/get/update and the game-side reader all use
 * `PK:'AIPROMPTS', SK:'AIPROMPT#<id>'` (or, since tenancy, the scoped
 * equivalent `promptKey` builds), but this handler and ai-prompt-advisor.js
 * used to use `PK:'AI_PROMPT#<id>', SK:'METADATA'` — the shape only
 * `populate-default-prompts.js` (dead, unrouted) ever wrote. The result:
 * deleting ANY normally-created prompt threw "AI prompt not found".
 *
 * `LEGACY_KEY` is kept, and tried only after the scope-aware search below has
 * already missed: nothing but that dead writer ever produced this shape, so a
 * row genuinely stored there is always a platform row, byte-identical to how
 * this worked before tenancy — no scope, no orgId, no creator to check.
 */
const LEGACY_KEY = (promptId) => ({ PK: `AI_PROMPT#${promptId}`, SK: 'METADATA' });

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: ''
      };
    }

    const promptId = event.pathParameters?.promptId;
    console.log('📋 Extracted promptId:', promptId);
    
    if (!promptId) {
      console.error('❌ No promptId found in path parameters');
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          error: 'Missing promptId',
          message: 'promptId is required in path parameters',
          pathParameters: event.pathParameters
        })
      };
    }

    const queryParams = event.queryStringParameters || {};
    const hardDelete = queryParams.hardDelete === 'true';
    const deleteAllVersions = queryParams.deleteAllVersions === 'true';

    /*
      THIS USED TO LOG THE WHOLE EVENT — `event.requestContext.authorizer.lambda`
      carries the bearer identity for this call, in the clear, on every request.
      get-ai-prompts.js already made this same fix for the same reason. Trace
      the request, not the caller's credentials.
    */
    console.log('🗑️ Delete AI Prompt', JSON.stringify({
      promptId,
      method: event.requestContext?.http?.method,
      path: event.requestContext?.http?.path,
      sub: callerUserId(event) || null,
      orgId: tenant.callerOrgId(event) || null,
      hardDelete,
      deleteAllVersions,
    }));

    // WHICH LIBRARY, THEN WHO. `findPromptForCaller` searches only the scopes
    // this caller may READ — their own org, then platform, then public — so a
    // Workie in another organisation is ABSENT rather than forbidden and this
    // route 404s on it exactly as it would on a promptId that never existed.
    // See shared/prompt-access.js.
    const found = await findPromptForCaller(
      dynamodb, tableName, event, promptId, requestedScope(event), GetCommand
    );

    let currentPrompt;
    let dbKey;
    let ref;

    if (found) {
      currentPrompt = found.item;
      ref = found.ref;
      dbKey = promptKey(ref);
    } else {
      // LEGACY FALLBACK, tried only once the scope-aware search has missed.
      console.warn(`⚠️ ${promptId} not found under AIPROMPTS/AIPROMPT# (or an org partition) — trying the legacy AI_PROMPT#/METADATA key`);
      const legacy = await dynamodb.send(new GetCommand({
        TableName: tableName,
        Key: LEGACY_KEY(promptId)
      }));
      if (legacy.Item) {
        currentPrompt = legacy.Item;
        dbKey = LEGACY_KEY(promptId);
        ref = { scope: tenant.PLATFORM, orgId: '', promptId };
      }
    }

    if (!currentPrompt) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({ error: `AI prompt not found: ${promptId}` })
      };
    }

    // 403 before any destructive call — not one S3 object, not the row. Checked
    // on the RAW row: scope/orgId/createdBy are never encrypted, so this never
    // needs a KMS call.
    if (!canManagePrompt(event, currentPrompt)) {
      const groups = tenant.callerGroups(event);
      console.warn(
        `🚫 refused to let groups [${groups.join(', ') || 'none'}] `
        + `(org: ${tenant.callerOrgId(event) || 'none'}/${tenant.callerOrgRole(event) || '-'}) delete `
        + `Workie "${promptId}" in ${ref.scope}${ref.orgId ? `/${ref.orgId}` : ''}`
      );
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          error: 'This Workie belongs to someone else. You can only delete Workies you created.'
        })
      };
    }

    console.log(`📍 Found ${promptId} in ${ref.scope}${ref.orgId ? `/${ref.orgId}` : ''}: ${JSON.stringify(dbKey)}`);

    // Check if this is a default prompt
    if (currentPrompt.isDefault && !hardDelete) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          error: 'Cannot delete default prompt',
          message: 'Default prompts are protected. Use hardDelete=true query parameter to force deletion.',
          promptId: promptId,
          isDefault: true
        })
      };
    }

    const timestamp = new Date().toISOString();

    if (hardDelete) {
      console.log(`💥 Performing hard delete of AI prompt: ${promptId}`);

      // Delete all versions from S3 if requested
      if (deleteAllVersions) {
        console.log(`🗑️ Deleting all versions from S3`);

        // List all objects with the prompt prefix. SCOPED, like the single-key
        // path below: a hand-built platform-shaped prefix here would list (and
        // so only ever delete) the shared bucket's own directory, leaving every
        // version of an organisation's Workie behind after a "delete all
        // versions" that reported success. `promptBodyKey` always ends in
        // `v<n>.json`; stripping that leaves the directory every version of
        // this Workie lives under, in whichever library it is actually in.
        const s3Prefix = promptBodyKey(ref, currentPrompt.gameType, 1).replace(/v1\.json$/, '');
        const listResponse = await s3Client.send(new ListObjectsV2Command({
          Bucket: aiPromptsBucket,
          Prefix: s3Prefix
        }));

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          // Delete all versions
          const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
          
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: aiPromptsBucket,
            Delete: {
              Objects: objectsToDelete,
              Quiet: true
            }
          }));

          console.log(`🗑️ Deleted ${objectsToDelete.length} versions from S3`);
        }
      } else {
        // Delete only the current version
        if (currentPrompt.s3Key) {
          console.log(`🗑️ Deleting current version from S3: ${currentPrompt.s3Key}`);
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: aiPromptsBucket,
              Key: currentPrompt.s3Key
            }));
            console.log(`✅ Successfully deleted S3 object: ${currentPrompt.s3Key}`);
          } catch (s3Error) {
            console.error(`❌ Failed to delete S3 object: ${currentPrompt.s3Key}`, s3Error);
            // Continue with DynamoDB deletion even if S3 fails
          }
        } else {
          console.log(`⚠️ No S3 key found for prompt ${promptId}, skipping S3 deletion`);
        }
      }

      // Delete from DynamoDB — the partition this row was actually FOUND in,
      // not a rebuilt platform key. An org's Workie is deleted from its own
      // partition or this would silently leave it behind while reporting success.
      console.log(`🗑️ Deleting from DynamoDB`);
      await dynamodb.send(new DeleteCommand({
        TableName: tableName,
        Key: dbKey
      }));

      console.log(`✅ Hard delete completed for AI prompt: ${promptId}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          promptId,
          scope: ref.scope,
          orgId: ref.orgId || null,
          status: 'deleted',
          message: 'AI prompt permanently deleted'
        })
      };

    } else {
      // Soft delete - mark as archived
      console.log(`📦 Performing soft delete (archive) of AI prompt: ${promptId}`);

      await dynamodb.send(new UpdateCommand({
        TableName: tableName,
        Key: dbKey,
        UpdateExpression: 'SET #status = :status, archivedAt = :archivedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'archived',
          ':archivedAt': timestamp,
          ':updatedAt': timestamp
        }
      }));

      console.log(`✅ Soft delete completed for AI prompt: ${promptId}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          promptId,
          scope: ref.scope,
          orgId: ref.orgId || null,
          status: 'archived',
          message: 'AI prompt archived successfully'
        })
      };
    }

  } catch (error) {
    console.error('❌ Error deleting AI prompt:', error);
    
    // Handle specific error cases
    let statusCode = 500;
    if (error.message.includes('not found')) {
      statusCode = 404;
    } else if (error.message.includes('Cannot delete default prompt')) {
      statusCode = 403;
    }

    return {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to delete AI prompt',
        message: error.message
      })
    };
  }
};