/**
 * An in-memory DynamoDB for the follow-up asks suites (followup-store.js and
 * everything that reads through it). It PAGES (pageSize rows per Query, with
 * LastEvaluatedKey), honours the exact conditions the store writes, and runs
 * TransactWrite all-or-nothing with per-item CancellationReasons, as DynamoDB
 * does. Any expression it does not know THROWS: an ignored condition is a
 * passing test for a guard that does nothing.
 *
 * Commands are recognised by `cmd.type`, so a suite registers the classes
 * below as its '@aws-sdk/lib-dynamodb' stub.
 */
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transact'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batch'; } }

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const k = (pk, sk) => `${pk}\u0000${sk}`;

function conditionFailed() {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

/** The conditions followup-store.js and its neighbours write, and no others. */
function holds(expression, item, names = {}, values = {}) {
  if (!expression) return true;
  return expression.split(/\s+AND\s+/).every((clause) => {
    const c = clause.trim();
    let m = /^attribute_not_exists\(\s*(#?\w+)\s*\)$/.exec(c);
    if (m) { const a = m[1].startsWith('#') ? names[m[1]] : m[1]; return !item || item[a] === undefined; }
    m = /^attribute_exists\(\s*(#?\w+)\s*\)$/.exec(c);
    if (m) { const a = m[1].startsWith('#') ? names[m[1]] : m[1]; return Boolean(item) && item[a] !== undefined; }
    m = /^(#?\w+)\s*=\s*(:\w+)$/.exec(c);
    if (m) {
      const a = m[1].startsWith('#') ? names[m[1]] : m[1];
      if (!a || !(m[2] in values)) throw new Error(`followup-table: bad clause "${c}"`);
      return Boolean(item) && JSON.stringify(item[a]) === JSON.stringify(values[m[2]]);
    }
    throw new Error(`followup-table: unsupported condition "${c}"`);
  });
}

function applySet(item, expression, names = {}, values = {}) {
  const m = /^SET\s+(.+)$/.exec(String(expression || '').trim());
  if (!m) throw new Error(`followup-table: unsupported UpdateExpression "${expression}"`);
  for (const part of m[1].split(',')) {
    const p = /^\s*(#?\w+)\s*=\s*(:\w+)\s*$/.exec(part);
    if (!p) throw new Error(`followup-table: unsupported SET clause "${part}"`);
    const a = p[1].startsWith('#') ? names[p[1]] : p[1];
    if (!a || !(p[2] in values)) throw new Error(`followup-table: unbound SET clause "${part}"`);
    item[a] = clone(values[p[2]]);
  }
}

/**
 * @param {{pageSize?: number}} [opts]
 */
function createTable({ pageSize = 3 } = {}) {
  const rows = new Map();
  const log = [];
  let conflictsLeft = 0;

  const get = (pk, sk) => rows.get(k(pk, sk));
  const doPut = (input) => {
    const cur = get(input.Item.PK, input.Item.SK);
    if (!holds(input.ConditionExpression, cur, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw conditionFailed();
    rows.set(k(input.Item.PK, input.Item.SK), clone(input.Item));
  };

  const doc = {
    async send(cmd) {
      const inp = cmd.input || {};
      log.push({ type: cmd.type, input: clone(inp) });
      switch (cmd.type) {
        case 'get': return { Item: clone(get(inp.Key.PK, inp.Key.SK)) };
        case 'put': doPut(inp); return {};
        case 'delete': {
          const cur = get(inp.Key.PK, inp.Key.SK);
          if (!holds(inp.ConditionExpression, cur, inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
          rows.delete(k(inp.Key.PK, inp.Key.SK));
          return {};
        }
        case 'update': {
          const cur = get(inp.Key.PK, inp.Key.SK);
          if (!holds(inp.ConditionExpression, cur, inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
          const next = clone(cur) || { PK: inp.Key.PK, SK: inp.Key.SK };
          applySet(next, inp.UpdateExpression, inp.ExpressionAttributeNames, inp.ExpressionAttributeValues);
          rows.set(k(inp.Key.PK, inp.Key.SK), next);
          return inp.ReturnValues === 'ALL_NEW' ? { Attributes: clone(next) } : {};
        }
        case 'query': {
          const v = inp.ExpressionAttributeValues || {};
          const m = /^\s*PK\s*=\s*:pk(?:\s+AND\s+begins_with\(\s*SK\s*,\s*:sk\s*\))?\s*$/.exec(inp.KeyConditionExpression || '');
          if (!m) throw new Error(`followup-table: unsupported KeyConditionExpression "${inp.KeyConditionExpression}"`);
          if (inp.FilterExpression) {
            // The ai-summary worker's prompt lookup filters on isDefault; nothing else may filter.
            if (!/^isDefault = :isDefault$/.test(inp.FilterExpression.trim())) {
              throw new Error(`followup-table: unsupported FilterExpression "${inp.FilterExpression}"`);
            }
          }
          const all = [...rows.values()]
            .filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')))
            .sort((a, b) => (String(a.SK) < String(b.SK) ? -1 : 1));
          let start = 0;
          if (inp.ExclusiveStartKey) start = all.findIndex((i) => i.SK === inp.ExclusiveStartKey.SK) + 1;
          const page = all.slice(start, start + pageSize);
          const more = start + pageSize < all.length;
          const items = inp.FilterExpression ? page.filter((i) => i.isDefault === v[':isDefault']) : page;
          return {
            Items: clone(items),
            Count: items.length,
            ...(more ? { LastEvaluatedKey: { PK: page[page.length - 1].PK, SK: page[page.length - 1].SK } } : {}),
          };
        }
        case 'transact': {
          if (conflictsLeft > 0) {
            conflictsLeft -= 1;
            const e = new Error('Transaction cancelled');
            e.name = 'TransactionCanceledException';
            e.CancellationReasons = inp.TransactItems.map(() => ({ Code: 'TransactionConflict' }));
            throw e;
          }
          const reasons = inp.TransactItems.map((t) => {
            const op = t.Put || t.ConditionCheck || t.Update || t.Delete;
            const key = t.Put ? t.Put.Item : op.Key;
            const ok = holds(op.ConditionExpression, get(key.PK, key.SK), op.ExpressionAttributeNames, op.ExpressionAttributeValues);
            return { Code: ok ? 'None' : 'ConditionalCheckFailed' };
          });
          if (reasons.some((r) => r.Code !== 'None')) {
            const e = new Error('Transaction cancelled');
            e.name = 'TransactionCanceledException';
            e.CancellationReasons = reasons;
            throw e;
          }
          for (const t of inp.TransactItems) {
            if (t.Put) rows.set(k(t.Put.Item.PK, t.Put.Item.SK), clone(t.Put.Item));
            else if (t.ConditionCheck) continue;
            else throw new Error('followup-table: unsupported transaction item');
          }
          return {};
        }
        default:
          throw new Error(`followup-table: unsupported command ${cmd.type}`);
      }
    },
  };

  return {
    doc,
    rows,
    log,
    put: (item) => rows.set(k(item.PK, item.SK), clone(item)),
    get: (pk, sk) => clone(get(pk, sk)),
    remove: (pk, sk) => rows.delete(k(pk, sk)),
    prefix: (pk, p) => [...rows.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(p)).map(clone),
    /** The next `n` transactions fail with TransactionConflict, as forty phones at once can. */
    conflictNext: (n) => { conflictsLeft = n; },
  };
}

module.exports = {
  createTable,
  commands: { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand, TransactWriteCommand, BatchWriteCommand },
};
