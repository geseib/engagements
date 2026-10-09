/**
 * CLOSING A BUILDER'S CREW SEAT, from either door.
 *
 * Taking a person out of a Build Room (remove-player.js) and taking a builder
 * off the crew (build-room.js crewBuilderRemove) are one act: their Claude is
 * unlinked and their seat closes. This is the part both doors share, written
 * with plain Updates (SET one attribute) so it neither needs the org's data key
 * nor rewrites a sealed row. Bring back clears nothing here: the seat reopens
 * only when the person mints a new key (build-room.js builder-key), and the
 * old key stays retired.
 */
const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

async function closeSeat(db, tableName, gameId, name, at = new Date().toISOString()) {
  const pk = `GAME#${gameId}`;
  const keys = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': 'BUILD#KEY#' },
      ExclusiveStartKey,
    }));
    keys.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  for (const k of keys) {
    if (k.Role === 'builder' && k.PlayerName === name && !k.RevokedAt) {
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: pk, SK: k.SK },
        UpdateExpression: 'SET RevokedAt = :at',
        ConditionExpression: 'attribute_exists(SK)',
        ExpressionAttributeValues: { ':at': at },
      }));
    }
  }
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: `BUILD#BLD#${name}` },
      UpdateExpression: 'SET ClosedAt = :at',
      // Never create a seat that was not there, and never move a close date.
      ConditionExpression: 'attribute_exists(SK) AND attribute_not_exists(ClosedAt)',
      ExpressionAttributeValues: { ':at': at },
    }));
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') throw error;
  }
}

module.exports = { closeSeat };
