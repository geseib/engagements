/**
 * A DynamoDB fake that pages the way DynamoDB does: CUT THE PAGE, THEN FILTER.
 *
 * WHY. A Scan or Query reads at most 1 MB and applies FilterExpression to what
 * it read, so a page can come back with `Items: []` and a `LastEvaluatedKey`
 * saying there is more. A handler that reads one page and treats `.Items` as
 * the answer works while the table is small and goes blind once it grows — on
 * dev (6,083 rows) the first Scan page held 1,987 of them and none of the
 * AIPROMPTS defaults, so every Workie summary fell back to the data-driven
 * template. A fake that filters first, or returns everything in one page,
 * passes that handler. This one does neither.
 *
 * MODEL.
 *   pageSize   rows READ per call (stands in for the 1 MB cap). A page holds
 *              up to pageSize rows before the filter, so it can hold none after.
 *   Scan       walks the whole table in one fixed order (PK, then SK).
 *   Query      `PK = :pk` or `PK = :pk AND begins_with(SK, :sk)`, SK order.
 *   Filter     `a = :v` clauses joined by AND, `#name` aliases allowed.
 *   Put        stores the item; `attribute_not_exists(PK|SK)` is the one condition.
 *   Update     `SET a = :v, #b = :w` and `REMOVE c` on an existing item.
 *   Anything else THROWS — an ignored clause is a passing test for a filter
 *   that does nothing.
 *
 * The log records every call with the rows it read and returned, so a suite
 * can assert HOW a lookup found its row (one partition vs the whole table).
 */
const keyOf = (item) => `${item.PK}\u0000${item.SK}`;
const bySortKey = (a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);

function parseFilter(expression, names = {}, values = {}) {
  if (!expression) return () => true;
  const clauses = expression.split(/\s+AND\s+/).map((clause) => {
    const m = /^\s*(#?[A-Za-z_][\w]*)\s*=\s*(:[\w]+)\s*$/.exec(clause);
    if (!m) throw new Error(`paged-table: unsupported FilterExpression clause "${clause}"`);
    const attr = m[1].startsWith('#') ? names[m[1]] : m[1];
    if (!attr) throw new Error(`paged-table: no ExpressionAttributeNames entry for ${m[1]}`);
    if (!(m[2] in values)) throw new Error(`paged-table: no ExpressionAttributeValues entry for ${m[2]}`);
    return { attr, value: values[m[2]] };
  });
  return (item) => clauses.every(({ attr, value }) => item[attr] === value);
}

function parseKeyCondition(expression, values = {}) {
  const m = /^\s*PK\s*=\s*(:[\w]+)(?:\s+AND\s+begins_with\(\s*SK\s*,\s*(:[\w]+)\s*\))?\s*$/.exec(expression || '');
  if (!m) throw new Error(`paged-table: unsupported KeyConditionExpression "${expression}"`);
  const pk = values[m[1]];
  const prefix = m[2] ? String(values[m[2]]) : '';
  return (item) => item.PK === pk && String(item.SK).startsWith(prefix);
}

function applyUpdate(store, input) {
  if (input.ConditionExpression) throw new Error('paged-table: Update conditions are not modelled');
  const item = store.get(keyOf(input.Key));
  if (!item) throw new Error(`paged-table: Update of a missing row ${JSON.stringify(input.Key)} is not modelled`);
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const attr = (token) => (token.startsWith('#') ? names[token] : token);
  const m = /^\s*(?:SET\s+(.+?))?\s*(?:REMOVE\s+(.+?))?\s*$/i.exec(input.UpdateExpression || '');
  if (!m || (!m[1] && !m[2])) throw new Error(`paged-table: unsupported UpdateExpression "${input.UpdateExpression}"`);
  for (const clause of (m[1] ? m[1].split(',') : [])) {
    const a = /^\s*(#?[\w]+)\s*=\s*(:[\w]+)\s*$/.exec(clause);
    if (!a || !(a[2] in values)) throw new Error(`paged-table: unsupported SET clause "${clause}"`);
    item[attr(a[1])] = values[a[2]];
  }
  for (const token of (m[2] ? m[2].split(',') : [])) delete item[attr(token.trim())];
}

function createPagedTable({ pageSize = 3 } = {}) {
  const store = new Map();
  const log = [];

  const page = (rows, input, kind) => {
    const sorted = rows.slice().sort(bySortKey);
    let start = 0;
    if (input.ExclusiveStartKey) {
      const after = keyOf(input.ExclusiveStartKey);
      start = sorted.findIndex((row) => keyOf(row) > after);
      if (start === -1) start = sorted.length;
    }
    const cap = Number(input.Limit) > 0 ? Math.min(Number(input.Limit), table.pageSize) : table.pageSize;
    const read = sorted.slice(start, start + cap);
    const keep = parseFilter(input.FilterExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const Items = read.filter(keep).map((row) => ({ ...row }));
    const more = start + cap < sorted.length;
    const last = read[read.length - 1];
    const out = { Items, Count: Items.length, ScannedCount: read.length };
    if (more && last) out.LastEvaluatedKey = { PK: last.PK, SK: last.SK };
    log.push({ kind, input, read: read.length, returned: Items.length, more });
    return out;
  };

  const table = {
    store,
    log,
    pageSize,
    put: (item) => store.set(keyOf(item), { ...item }),
    get: (pk, sk) => store.get(keyOf({ PK: pk, SK: sk })),
    has: (pk, sk) => store.has(keyOf({ PK: pk, SK: sk })),
    calls: (kind) => log.filter((entry) => entry.kind === kind),

    async send(cmd) {
      const input = cmd.input || {};
      switch (cmd.type) {
        case 'get': {
          const hit = store.get(keyOf(input.Key));
          return hit ? { Item: { ...hit } } : {};
        }
        case 'delete':
          store.delete(keyOf(input.Key));
          log.push({ kind: 'delete', input });
          return {};
        case 'put':
          if (input.ConditionExpression) {
            if (!/^\s*attribute_not_exists\((PK|SK)\)\s*$/.test(input.ConditionExpression)) {
              throw new Error(`paged-table: unsupported Put condition "${input.ConditionExpression}"`);
            }
            if (store.has(keyOf(input.Item))) {
              const e = new Error('The conditional request failed');
              e.name = 'ConditionalCheckFailedException';
              throw e;
            }
          }
          store.set(keyOf(input.Item), { ...input.Item });
          log.push({ kind: 'put', input });
          return {};
        case 'update':
          applyUpdate(store, input);
          log.push({ kind: 'update', input });
          return {};
        case 'scan':
          return page([...store.values()], input, 'scan');
        case 'query': {
          const inKey = parseKeyCondition(input.KeyConditionExpression, input.ExpressionAttributeValues);
          return page([...store.values()].filter(inKey), input, 'query');
        }
        default:
          throw new Error(`paged-table: unsupported command ${cmd.type}`);
      }
    },
  };
  return table;
}

// Command classes the handlers construct; `type` is how the fake dispatches.
const commands = {
  GetCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  PutCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  UpdateCommand: class { constructor(i) { this.input = i; this.type = 'update'; } },
  DeleteCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  QueryCommand: class { constructor(i) { this.input = i; this.type = 'query'; } },
  ScanCommand: class { constructor(i) { this.input = i; this.type = 'scan'; } },
};

module.exports = { createPagedTable, commands };
