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
 *   UpdateExpression      SET a = :x, b = if_not_exists(b, :y)   REMOVE c, d
 *                         ADD n :one  (a number; the counters the platform
 *                         metrics keep — platform-metrics.js)
 *                         (any clause may be absent; `#name` aliases work)
 *   ReturnValues          ALL_OLD on a Put, UPDATED_OLD on an Update — the two
 *                         a recorder reads to tell a NEW row from an overwrite.
 *                         Any other value answers `{}` exactly as before.
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

/** Split on TOP-LEVEL commas only — `if_not_exists(a, :b)` must stay whole. */
function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(body)) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * The sections of an UpdateExpression, in order: [['SET', body], ['ADD', body]].
 * Keywords are matched UPPER-CASE and whole-word, which is how every handler
 * here writes them — so a `#setId` alias is never mistaken for a clause.
 */
function sectionsOf(expression) {
  const parts = String(expression || '').trim().split(/\b(SET|REMOVE|ADD)\b/);
  if (parts.length < 3 || parts[0].trim() !== '') {
    throw new Error(`fake: unsupported UpdateExpression: ${expression}`);
  }
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = String(parts[i + 1] || '').trim();
    if (!body) throw new Error(`fake: empty ${parts[i]} clause in: ${expression}`);
    out.push([parts[i], body]);
  }
  return out;
}

const nameOf = (token, names) => {
  const attribute = token.startsWith('#') ? names[token] : token;
  if (!attribute) throw new Error(`fake: unmapped attribute name ${token}`);
  return attribute;
};

/** Every attribute an UpdateExpression names on its left-hand sides. */
function updatedAttributes(input) {
  const names = input.ExpressionAttributeNames || {};
  const out = [];
  for (const [kind, body] of sectionsOf(input.UpdateExpression)) {
    for (const clause of splitTop(body)) {
      const lhs = kind === 'SET' ? clause.slice(0, clause.indexOf('='))
        : kind === 'ADD' ? clause.split(/\s+/)[0] : clause;
      out.push(nameOf(lhs.trim(), names));
    }
  }
  return out;
}

/** `SET a = :x, b = if_not_exists(b, :y) REMOVE c ADD n :one` applied to a copy. */
function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const valueOf = (token) => {
    if (!(token in values)) throw new Error(`fake: unmapped attribute value ${token}`);
    return values[token];
  };

  const next = { ...item };

  for (const [kind, body] of sectionsOf(input.UpdateExpression)) {
    for (const clause of splitTop(body)) {
      if (kind === 'SET') {
        const eq = clause.indexOf('=');
        if (eq === -1) throw new Error(`fake: unsupported SET clause: ${clause}`);
        const attribute = nameOf(clause.slice(0, eq).trim(), names);
        const rhs = clause.slice(eq + 1).trim();
        const ifNot = /^if_not_exists\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(rhs);
        if (ifNot) {
          const current = next[nameOf(ifNot[1], names)];
          next[attribute] = current !== undefined ? current : valueOf(ifNot[2]);
        } else if (/^:\w+$/.test(rhs)) {
          next[attribute] = valueOf(rhs);
        } else {
          throw new Error(`fake: unsupported SET clause: ${clause}`);
        }
      } else if (kind === 'REMOVE') {
        delete next[nameOf(clause, names)];
      } else {
        // ADD: numbers only. DynamoDB also adds to sets; nothing here does.
        const m = /^([#\w]+)\s+(:\w+)$/.exec(clause);
        if (!m) throw new Error(`fake: unsupported ADD clause: ${clause}`);
        const attribute = nameOf(m[1], names);
        const delta = valueOf(m[2]);
        if (typeof delta !== 'number') throw new Error(`fake: ADD of a non-number to ${attribute}`);
        const current = next[attribute];
        if (current !== undefined && typeof current !== 'number') {
          throw new Error(`fake: ADD to non-number ${attribute}`);
        }
        next[attribute] = (current || 0) + delta;
      }
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
            const previous = store.get(k);
            store.set(k, input.Item);
            // ALL_OLD is how a writer learns it OVERWROTE a row rather than
            // created one — an answer resubmitted by the same player.
            if (input.ReturnValues === 'ALL_OLD' && previous) return { Attributes: { ...previous } };
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
            // UPDATED_OLD: the prior values of the attributes this update
            // named, and only those that existed — DynamoDB's own shape.
            if (input.ReturnValues === 'UPDATED_OLD') {
              const old = {};
              for (const name of updatedAttributes(input)) {
                if (current && current[name] !== undefined) old[name] = current[name];
              }
              return Object.keys(old).length ? { Attributes: old } : {};
            }
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
            // Select COUNT returns the number and no rows, as DynamoDB does.
            if (input.Select === 'COUNT') return { Count: items.length };
            return { Items: items };
          }

          /*
            BatchGet, because get-games-list reads one STATE row per session
            and does it 100 at a time. Modelled honestly: DynamoDB OMITS keys
            it has no item for rather than returning a null placeholder, so
            missing rows simply do not appear in Responses — which is the
            behaviour that makes "an unstarted session has no rounds" resolve
            to null instead of 0.
          */
          case 'batchGet': {
            const out = {};
            for (const [name, spec] of Object.entries(input.RequestItems || {})) {
              out[name] = (spec.Keys || [])
                .map((k) => store.get(keyOf(k.PK, k.SK)))
                .filter(Boolean);
            }
            return { Responses: out };
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
class BatchGetCommand { constructor(i) { this.input = i; this.type = 'batchGet'; } }

/**
 * Install the AWS stubs so every handler under `lambda-functions/game/` sees
 * them, whichever `node_modules` it would have resolved to.
 *
 * `sent` keeps its original meaning — the parsed frames, in order — because
 * every existing caller reads it that way. Two OPTIONAL extras were added for
 * the queue handler, which broadcasts and reaps:
 *
 *   `frames` also records WHICH CONNECTION each frame went to, which `sent`
 *            throws away. "Was the projector told?" is a different question
 *            from "was a frame sent", and only the first one matters when the
 *            whole point of a type is that the other surface follows.
 *   `gone`   a Set of connection ids that answer 410 Gone, so the inline
 *            reaping every broadcaster in this repo performs can actually be
 *            exercised. Without it a handler that never deletes a dead row
 *            passes, and the row is retried on every future broadcast forever.
 *
 * `lambda-functions/websocket` is in the base list so a TEST can require a
 * module from that directory — the TTL constants live there and the game
 * handlers pin themselves against them. Production code must NOT require
 * across those directories: a Lambda package is rooted at its CodeUri, so it
 * resolves here and throws MODULE_NOT_FOUND once deployed.
 */
function installStubs({ table, sent, frames = null, gone = null }) {
  const path = require('path');
  const REPO = path.join(__dirname, '..', '..');
  const bases = [
    REPO,
    path.join(REPO, 'lambda-functions'),
    path.join(REPO, 'lambda-functions', 'game'),
    path.join(REPO, 'lambda-functions', 'websocket'),
  ];

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
    BatchGetCommand,
  });
  stub('@aws-sdk/client-apigatewaymanagementapi', {
    ApiGatewayManagementApiClient: class {
      async send(command) {
        const { ConnectionId, Data } = command.input;
        if (gone && gone.has(ConnectionId)) {
          const error = new Error('Gone');
          error.name = 'GoneException';
          error.statusCode = 410;
          throw error;
        }
        const message = JSON.parse(Data);
        sent.push(message);
        if (frames) frames.push({ connectionId: ConnectionId, message });
        return {};
      }
    },
    PostToConnectionCommand: class { constructor(i) { this.input = i; } },
  });
}

module.exports = {
  createTable,
  installStubs,
  evaluateCondition,
  applyUpdate,
  updatedAttributes,
  conditionalFailure,
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchGetCommand,
};
