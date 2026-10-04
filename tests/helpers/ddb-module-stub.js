/**
 * The two DynamoDB SDK modules, answered by one in-memory paged table
 * (tests/helpers/paged-table.js), for suites that stub modules by NAME
 * (`Module._load` / `require.cache`) rather than by injecting a client.
 *
 * Added for the audit log (admin/shared/audit-log.js): a handler that only
 * ever talked to Cognito now writes an entry to the table before it acts, so
 * a Cognito-only suite needs a table to write it to — and one that can fail on
 * demand (`table.failPutsTo = 'ORG#…#AUDIT'` or a predicate), to prove a
 * failed entry refuses the action.
 *
 *   const { createPagedTable } = require('./paged-table');
 *   const table = createPagedTable({ pageSize: 50 });
 *   const mods = dynamoModules(table);
 *   stubs.set('@aws-sdk/lib-dynamodb', mods.lib);
 *   stubs.set('@aws-sdk/client-dynamodb', mods.client);
 */
const { commands } = require('./paged-table');

function dynamoModules(table) {
  const send = async (cmd) => {
    const fail = table.failPutsTo;
    if (cmd.type === 'put' && fail) {
      const pk = cmd.input && cmd.input.Item && cmd.input.Item.PK;
      const hit = typeof fail === 'function' ? fail(cmd.input.Item) : String(pk || '').startsWith(fail);
      if (hit) {
        const e = new Error('ProvisionedThroughputExceededException: simulated');
        e.name = 'ProvisionedThroughputExceededException';
        throw e;
      }
    }
    return table.send(cmd);
  };
  const doc = { send };
  return {
    lib: {
      ...commands,
      TransactWriteCommand: class { constructor(i) { this.input = i; this.type = 'transactWrite'; } },
      BatchWriteCommand: class { constructor(i) { this.input = i; this.type = 'batchWrite'; } },
      DynamoDBDocumentClient: { from: () => doc },
    },
    client: { DynamoDBClient: class {} },
  };
}

module.exports = { dynamoModules };
