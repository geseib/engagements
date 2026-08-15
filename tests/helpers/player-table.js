/**
 * A DynamoDB single-table fake that can actually FAIL A CONDITION.
 *
 * WHY THIS EXISTS RATHER THAN ANOTHER HAND-ROLLED SWITCH. The fake in
 * `tests/join-name-collision.js` matched ConditionExpressions by string
 * equality — `if (inp.ConditionExpression !== 'attribute_not_exists(ClientId)')
 * throw` — which is fine while there is one condition in the product and
 * useless the moment there are four. Worse, a stub that recognises only the
 * conditions it was written for cannot answer the question that matters here:
 *
 *   two browsers race a single one-shot handover grant. Does exactly one win?
 *
 * A stub that accepts every write, or that only knows how to reject a write it
 * has memorised, passes whether the product is correct or not. So this one
 * PARSES the expressions and evaluates them against the stored item, and the
 * one-shot rule is proven the way DynamoDB would prove it: the first writer's
 * condition holds and its REMOVE deletes the grant, the second writer's
 * `attribute_exists` then fails on the item as it now is.
 *
 * WHAT IT SUPPORTS — deliberately only what the handlers under test issue, so
 * an unsupported expression THROWS rather than being silently ignored (an
 * ignored clause is a passing test for a condition that does nothing):
 *
 *   ConditionExpression   attribute_exists(A) · attribute_not_exists(A)
 *                         A = :v · A > :v · AND · OR · parentheses
 *   UpdateExpression      SET a = :x, b = :y   REMOVE c, d
 *                         (either clause may be absent; `#name` aliases work)
 *
 * `serialise` is how a race is driven: it interleaves two in-flight sends at a
 * chosen point, so both handlers read the same item and then write one after
 * the other — which is precisely the interleaving that a read-then-write
 * implementation gets wrong and a conditional write survives.
 */

/* ---- expression parsing --------------------------------------------------- */

/**
 * A tiny recursive-descent evaluator for the subset above.
 *
 * Written out rather than regexed because precedence matters: the handover
 * condition is `A AND B AND (C OR D)`, and a regex that "handles OR" by
 * splitting on it evaluates that as `(A AND B AND C) OR D` — which is TRUE for
 * a lapsed grant, i.e. exactly the bug the condition exists to prevent, hidden
 * inside the thing asserting it is prevented.
 */
function evaluateCondition(expression, item, names = {}, values = {}) {
  const tokens = String(expression).match(/attribute_not_exists|attribute_exists|[A-Za-z0-9_#:]+|\(|\)|>=|<=|<>|>|<|=/g) || [];
  let pos = 0;

  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const resolveName = (token) => (token.startsWith('#') ? names[token] : token);
  const resolveValue = (token) => {
    if (!token.startsWith(':')) throw new Error(`fake: expected a value placeholder, got ${token}`);
    if (!(token in values)) throw new Error(`fake: unmapped value ${token}`);
    return values[token];
  };

  function parsePrimary() {
    const token = take();
    if (token === '(') {
      const value = parseOr();
      if (take() !== ')') throw new Error('fake: unbalanced parentheses in ConditionExpression');
      return value;
    }
    if (token === 'attribute_exists' || token === 'attribute_not_exists') {
      if (take() !== '(') throw new Error(`fake: ${token} without (`);
      const attribute = resolveName(take());
      if (take() !== ')') throw new Error(`fake: ${token} without )`);
      const present = item !== undefined && item !== null
        && Object.prototype.hasOwnProperty.call(item, attribute)
        && item[attribute] !== undefined;
      return token === 'attribute_exists' ? present : !present;
    }
    // A comparison: NAME op :value
    const attribute = resolveName(token);
    const operator = take();
    const right = resolveValue(take());
    const left = item ? item[attribute] : undefined;
    switch (operator) {
      // An absent attribute compares false to everything, as DynamoDB does.
      case '=': return left !== undefined && left === right;
      case '<>': return left !== undefined && left !== right;
      case '>': return left !== undefined && left > right;
      case '<': return left !== undefined && left < right;
      case '>=': return left !== undefined && left >= right;
      case '<=': return left !== undefined && left <= right;
      default: throw new Error(`fake: unsupported operator ${operator}`);
    }
  }

  function parseAnd() {
    let value = parsePrimary();
    while (peek() === 'AND') { take(); const rhs = parsePrimary(); value = value && rhs; }
    return value;
  }

  function parseOr() {
    let value = parseAnd();
    while (peek() === 'OR') { take(); const rhs = parseAnd(); value = value || rhs; }
    return value;
  }

  const result = parseOr();
  if (pos !== tokens.length) throw new Error(`fake: trailing tokens in ConditionExpression: ${tokens.slice(pos).join(' ')}`);
  return result;
}

/** `SET a = :x, b = :y REMOVE c, d` applied to a copy of the item. */
function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const expression = String(input.UpdateExpression || '').trim();

  const match = /^(?:SET\s+([\s\S]*?))?\s*(?:REMOVE\s+([\s\S]*))?$/i.exec(expression);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`fake: unsupported UpdateExpression: ${expression}`);
  }

  const next = { ...item };

  if (match[1]) {
    for (const clause of match[1].split(',')) {
      const parts = clause.split('=');
      if (parts.length !== 2) throw new Error(`fake: unsupported SET clause: ${clause}`);
      const lhs = parts[0].trim();
      const rhs = parts[1].trim();
      const attribute = lhs.startsWith('#') ? names[lhs] : lhs;
      if (!attribute) throw new Error(`fake: unmapped attribute name ${lhs}`);
      if (!(rhs in values)) throw new Error(`fake: unmapped attribute value ${rhs}`);
      next[attribute] = values[rhs];
    }
  }

  if (match[2]) {
    for (const raw of match[2].split(',')) {
      const token = raw.trim();
      const attribute = token.startsWith('#') ? names[token] : token;
      if (!attribute) throw new Error(`fake: unmapped attribute name ${token}`);
      delete next[attribute];
    }
  }

  return next;
}

function conditionalFailure() {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

/* ---- the table ------------------------------------------------------------ */

function createTable() {
  const store = new Map();
  const log = [];
  const keyOf = (pk, sk) => `${pk}|${sk}`;

  /**
   * A latch that holds the NEXT send matching `predicate` until `release()` is
   * called. This is how two handlers are made to interleave: hold the first
   * one's write, let the second run to completion, then release. Without it
   * "the race" is a comment rather than a test.
   */
  let gate = null;

  const table = {
    store,
    log,
    keyOf,

    put: (item) => store.set(keyOf(item.PK, item.SK), item),
    get: (pk, sk) => store.get(keyOf(pk, sk)),
    clear: () => { store.clear(); log.length = 0; gate = null; },

    /**
     * Hold the next command for which `predicate(command)` is true.
     * @returns {{ released: Promise<void>, release: () => void }}
     */
    hold(predicate) {
      let releaseFn;
      let reached;
      const reachedPromise = new Promise((resolve) => { reached = resolve; });
      const held = new Promise((resolve) => { releaseFn = resolve; });
      gate = { predicate, held, reached };
      return {
        reached: reachedPromise,
        release: () => { gate = null; releaseFn(); },
      };
    },

    doc: {
      async send(command) {
        const input = command.input || {};
        log.push({ type: command.type, input });

        // ONE-SHOT. The gate is cleared the instant it catches something, so
        // the OTHER racer — which by construction issues a matching command —
        // runs straight through instead of deadlocking against the same latch.
        if (gate && gate.predicate(command)) {
          const { held, reached } = gate;
          gate = null;
          reached();
          await held;
        }

        switch (command.type) {
          case 'get':
            return { Item: store.get(keyOf(input.Key.PK, input.Key.SK)) };

          case 'put': {
            const k = keyOf(input.Item.PK, input.Item.SK);
            if (input.ConditionExpression
              && !evaluateCondition(
                input.ConditionExpression, store.get(k),
                input.ExpressionAttributeNames, input.ExpressionAttributeValues
              )) {
              throw conditionalFailure();
            }
            store.set(k, input.Item);
            return {};
          }

          case 'update': {
            const k = keyOf(input.Key.PK, input.Key.SK);
            const current = store.get(k);
            if (input.ConditionExpression
              && !evaluateCondition(
                input.ConditionExpression, current,
                input.ExpressionAttributeNames, input.ExpressionAttributeValues
              )) {
              throw conditionalFailure();
            }
            // An Update with no matching item UPSERTS in DynamoDB, and that is
            // modelled faithfully rather than made an error: a handler that
            // forgets `attribute_exists(SK)` must be able to create the phantom
            // row here, or the test asserting it does not is asserting nothing.
            const base = current || { ...input.Key };
            store.set(k, applyUpdate(base, input));
            return {};
          }

          case 'delete':
            store.delete(keyOf(input.Key.PK, input.Key.SK));
            return {};

          case 'query': {
            const pk = input.ExpressionAttributeValues[':pk'];
            const prefix = input.ExpressionAttributeValues[':sk'] ?? '';
            let items = [...store.values()].filter(
              (item) => item.PK === pk && String(item.SK).startsWith(String(prefix))
            );
            if (input.FilterExpression === 'ConnectionType = :type') {
              items = items.filter((i) => i.ConnectionType === input.ExpressionAttributeValues[':type']);
            }
            return { Items: items };
          }

          default:
            return {};
        }
      },
    },
  };

  return table;
}

/* ---- SDK shims ------------------------------------------------------------ */

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }

/**
 * Install the AWS stubs so every handler under `lambda-functions/game/` sees
 * them, whichever `node_modules` it would have resolved to.
 */
function installStubs({ table, sent }) {
  const path = require('path');
  const REPO = path.join(__dirname, '..', '..');
  const bases = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')];

  const stub = (name, exports) => {
    const seen = new Set();
    for (const base of bases) {
      let resolved;
      try { resolved = require.resolve(name, { paths: [base] }); } catch { continue; }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
    }
    if (!seen.size) throw new Error(`installStubs(): could not resolve ${name}`);
  };

  stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
  stub('@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => table.doc },
    GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  });
  stub('@aws-sdk/client-apigatewaymanagementapi', {
    ApiGatewayManagementApiClient: class {
      async send(command) { sent.push(JSON.parse(command.input.Data)); return {}; }
    },
    PostToConnectionCommand: class { constructor(i) { this.input = i; } },
  });
}

module.exports = {
  createTable,
  installStubs,
  evaluateCondition,
  applyUpdate,
  conditionalFailure,
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
};
