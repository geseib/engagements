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
 *   TransactWrite         ConditionCheck · Put · Update · Delete, ALL-OR-NOTHING:
 *                         every condition is evaluated against the table as it
 *                         is before any write lands, and one failure cancels the
 *                         lot with a `TransactionCanceledException` carrying
 *                         `CancellationReasons` in item order, as DynamoDB does.
 *                         The survey answer PUT rides on this (a ConditionCheck
 *                         on STATE beside the row's Put), and a fake that applied
 *                         the Put when the check failed would pass the very race
 *                         the check exists for.
 *   Query paging          `Limit` / `ExclusiveStartKey` / `LastEvaluatedKey`,
 *                         and `table.pageSize` to force DynamoDB's 1 MB page
 *                         boundary onto small fixtures. While paging is in play
 *                         the rows come back in SK order, as DynamoDB returns
 *                         them. A handler that reads one page and stops is only
 *                         caught by a fake that ever returns more than one.
 *                         (`ConsistentRead` is accepted and means nothing here:
 *                         the fake has one copy of every row.)
 *
 * `serialise` is how a race is driven: it interleaves two in-flight sends at a
 * chosen point, so both handlers read the same item and then write one after
 * the other — which is precisely the interleaving that a read-then-write
 * implementation gets wrong and a conditional write survives.
 *
 * FAULTS DYNAMODB REALLY RAISES, ON DEMAND (`table.inject`). A single-copy
 * fake never conflicts: two sends run one after the other, so a handler that
 * treats DynamoDB's transaction conflicts as fatal passes every test here and
 * 500s the first time a room answers together. `inject(predicate, makeError,
 * times)` makes the next `times` matching sends throw instead of running, and
 * two shapes are ready-made because they are the ones the survey routes meet:
 *
 *   conflictTransactions(n)  the next n TransactWrites cancel with reason
 *                            `TransactionConflict` on their first item — the
 *                            survey PUT's ConditionCheck on STATE, which every
 *                            concurrent answer in the room also holds
 *   conflictUpdates(n, pred) the next n UpdateItems (matching `pred`) throw
 *                            `TransactionConflictException` — the host's close
 *                            or warning landing on a STATE row a transaction
 *                            is holding
 *
 * and the throttling a room meets once it outruns ONE PARTITION's write rate
 * (every answer in a session writes `GAME#<id>`), seen on dev as
 * `ThrottlingException … TableWriteKeyRangeThroughputExceeded` after the SDK's
 * own three attempts:
 *
 *   throttle(n, pred, name)  the next n sends matching `pred` throw `name` —
 *                            ThrottlingException (the default, with the
 *                            `throttlingReasons` the dev log carried),
 *                            ProvisionedThroughputExceededException or
 *                            RequestLimitExceeded
 *   throttleTransactions(n, code, at)
 *                            the next n TransactWrites cancel with reason
 *                            `code` (ThrottlingError, the default, or
 *                            ProvisionedThroughputExceeded) on item `at`
 *
 * THE 400 KB ITEM LIMIT. DynamoDB refuses an item over 400 KB with a
 * ValidationException; a fake that stores anything let SURVEY#RESULTS grow
 * one encrypted blob per open answer, forever, and pass. Every Put, Update
 * result and transactional Put is sized here (the JSON byte length of the
 * item — a close, slightly generous stand-in for DynamoDB's own measure) and
 * refused over ITEM_LIMIT_BYTES.
 */

/** DynamoDB's item size limit. */
const ITEM_LIMIT_BYTES = 400 * 1024;

const itemBytes = (item) => Buffer.byteLength(JSON.stringify(item), 'utf8');

function tooLarge(item) {
  const error = new Error(`Item size has exceeded the maximum allowed size (${itemBytes(item)} bytes, ${item && item.PK}/${item && item.SK})`);
  error.name = 'ValidationException';
  return error;
}

/** Refuse, as DynamoDB does, an item over the limit. */
function assertFits(item) {
  if (itemBytes(item) > ITEM_LIMIT_BYTES) throw tooLarge(item);
}

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

const REASON_MESSAGES = {
  ConditionalCheckFailed: 'The conditional request failed',
  TransactionConflict: 'Transaction is ongoing for the item',
  ThrottlingError: 'Throughput exceeds the current capacity of your table or index.',
  ProvisionedThroughputExceeded: 'The level of configured provisioned throughput for the table was exceeded.',
};

const THROTTLE_MESSAGES = {
  ThrottlingException: 'Throughput exceeds the current capacity of your table or index. DynamoDB is automatically scaling your table or index so please try again shortly.',
  ProvisionedThroughputExceededException: 'The level of configured provisioned throughput for the table was exceeded. Consider increasing your provisioning level with the UpdateTable API.',
  RequestLimitExceeded: 'Throughput exceeds the current throughput limit for your account.',
};

/**
 * What DynamoDB throws when a partition (or the table, or the account) is out
 * of throughput — after the SDK's own retries, as the dev log showed it:
 * `$metadata.attempts: 3` and, for ThrottlingException, the reason.
 */
function throttled(name = 'ThrottlingException') {
  if (!THROTTLE_MESSAGES[name]) throw new Error(`fake: ${name} is not a throttling error`);
  const error = new Error(THROTTLE_MESSAGES[name]);
  error.name = name;
  error.$metadata = { httpStatusCode: 400, attempts: 3 };
  if (name === 'ThrottlingException') {
    error.throttlingReasons = [{ reason: 'TableWriteKeyRangeThroughputExceeded', resource: 'table/test-table' }];
  }
  return error;
}

/** DynamoDB's shape for a cancelled transaction: one reason per item, in order. */
function transactionCancelled(codes) {
  const error = new Error(`Transaction cancelled, please refer cancellation reasons for specific reasons [${codes.join(', ')}]`);
  error.name = 'TransactionCanceledException';
  error.CancellationReasons = codes.map((Code) => (Code === 'None' ? { Code } : { Code, Message: REASON_MESSAGES[Code] || Code }));
  return error;
}

/** What a non-transactional write gets when a transaction holds its item. */
function transactionConflict() {
  const error = new Error('Transaction is ongoing for the item');
  error.name = 'TransactionConflictException';
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

  /** Pending injected faults, in the order they were armed. */
  const faults = [];

  const table = {
    store,
    log,
    keyOf,
    faults,
    /**
     * Rows per Query page when the caller gives no `Limit`. null (the default)
     * is one page holding everything, which is what every suite written before
     * paging existed relies on. Set it to force a boundary a real 1 MB page
     * would put somewhere in a big room; clear() leaves it alone.
     */
    pageSize: null,

    put: (item) => store.set(keyOf(item.PK, item.SK), item),
    get: (pk, sk) => store.get(keyOf(pk, sk)),
    clear: () => { store.clear(); log.length = 0; gate = null; faults.length = 0; },

    /**
     * Make the next `times` sends for which `predicate(command)` is true throw
     * `makeError(command)` instead of running — nothing is written. Returns a
     * handle whose `thrown` counts how many actually fired.
     */
    inject(predicate, makeError, times = 1) {
      const fault = { predicate, makeError, left: times, thrown: 0 };
      faults.push(fault);
      return fault;
    },
    /** The next `n` TransactWrites cancel with TransactionConflict on their first item. */
    conflictTransactions(n = 1) {
      return table.inject(
        (c) => c.type === 'transactWrite',
        (c) => transactionCancelled((c.input.TransactItems || []).map((_, i) => (i === 0 ? 'TransactionConflict' : 'None'))),
        n
      );
    },
    /** The next `n` UpdateItems matching `predicate` throw TransactionConflictException. */
    conflictUpdates(n = 1, predicate = () => true) {
      return table.inject((c) => c.type === 'update' && predicate(c), () => transactionConflict(), n);
    },
    /** The next `n` sends matching `predicate` throw the throttling error `name`. */
    throttle(n = 1, predicate = () => true, name = 'ThrottlingException') {
      throttled(name); // an unknown name fails here, not at the send
      return table.inject(predicate, () => throttled(name), n);
    },
    /** The next `n` TransactWrites cancel with reason `code` on item `at` (the rest 'None'). */
    throttleTransactions(n = 1, code = 'ThrottlingError', at = 0) {
      return table.inject(
        (c) => c.type === 'transactWrite',
        (c) => transactionCancelled((c.input.TransactItems || []).map((_, i) => (i === at ? code : 'None'))),
        n
      );
    },

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

    /**
     * Run the next command matching `predicate` NOW, then hold its RESULT until
     * `release()`. `hold` stops a command before it touches the table; this one
     * lets it read the table as it is, and be slow to come back — how a read
     * that STARTED first can FINISH last, carrying older news than a read that
     * started after it.
     * @returns {{ reached: Promise<void>, release: () => void }}
     */
    holdResult(predicate) {
      const inner = table.doc.send;
      let releaseFn;
      let reached;
      const reachedPromise = new Promise((resolve) => { reached = resolve; });
      const held = new Promise((resolve) => { releaseFn = resolve; });
      let armed = true;
      const disarm = () => { armed = false; if (table.doc.send !== inner) table.doc.send = inner; };
      table.doc.send = async (command) => {
        const out = await inner(command);
        if (armed && predicate(command)) {
          disarm();
          reached();
          await held;
        }
        return out;
      };
      return { reached: reachedPromise, release: () => { disarm(); releaseFn(); } };
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

        const fault = faults.find((f) => f.left > 0 && f.predicate(command));
        if (fault) {
          fault.left -= 1;
          fault.thrown += 1;
          if (fault.left === 0) faults.splice(faults.indexOf(fault), 1);
          throw fault.makeError(command);
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
            assertFits(input.Item);
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
            const updated = applyUpdate(base, input);
            assertFits(updated);
            store.set(k, updated);
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
            // PAGING, only when something asks for it: a Limit, a start key,
            // or a table-wide page size. Pages are cut in SK order, and the
            // last key of a page that is not the end is handed back, exactly
            // as a caller following LastEvaluatedKey has to see it.
            const limit = Number(input.Limit) > 0 ? Number(input.Limit) : (Number(table.pageSize) > 0 ? Number(table.pageSize) : 0);
            if (limit || input.ExclusiveStartKey) {
              items = items.slice().sort((a, b) => (String(a.SK) < String(b.SK) ? -1 : String(a.SK) > String(b.SK) ? 1 : 0));
              if (input.ExclusiveStartKey) {
                const after = String(input.ExclusiveStartKey.SK);
                items = items.filter((i) => String(i.SK) > after);
              }
              if (limit && items.length > limit) {
                const page = items.slice(0, limit);
                const last = page[page.length - 1];
                const LastEvaluatedKey = { PK: last.PK, SK: last.SK };
                if (input.Select === 'COUNT') return { Count: page.length, LastEvaluatedKey };
                return { Items: page, LastEvaluatedKey };
              }
            }
            // Select COUNT returns the number and no rows, as DynamoDB does.
            if (input.Select === 'COUNT') return { Count: items.length };
            return { Items: items };
          }

          /*
            ALL OR NOTHING. Every condition is judged against the table as it
            stands BEFORE any of the transaction's writes, then either every
            write lands or none does. A failure names each item's fate in
            order — 'ConditionalCheckFailed' or 'None' — because a handler that
            retries one kind of failure and refuses another reads exactly that.
          */
          case 'transactWrite': {
            const entries = (input.TransactItems || []).map((entry) => {
              const [kind, spec] = Object.entries(entry)[0] || [];
              if (!['ConditionCheck', 'Put', 'Update', 'Delete'].includes(kind)) {
                throw new Error(`fake: unsupported TransactItems entry ${JSON.stringify(entry)}`);
              }
              const k = kind === 'Put' ? keyOf(spec.Item.PK, spec.Item.SK) : keyOf(spec.Key.PK, spec.Key.SK);
              return { kind, spec, k };
            });
            const codes = entries.map(({ kind, spec, k }) => {
              if (kind === 'ConditionCheck' && !spec.ConditionExpression) {
                throw new Error('fake: a ConditionCheck needs a ConditionExpression');
              }
              if (!spec.ConditionExpression) return 'None';
              return evaluateCondition(
                spec.ConditionExpression, store.get(k),
                spec.ExpressionAttributeNames, spec.ExpressionAttributeValues
              ) ? 'None' : 'ConditionalCheckFailed';
            });
            if (codes.some((c) => c !== 'None')) throw transactionCancelled(codes);
            // Sized before anything lands: an oversized item fails the whole
            // transaction (DynamoDB answers ValidationException, nothing written).
            const next = entries.map(({ kind, spec, k }) => {
              if (kind === 'Put') return spec.Item;
              if (kind === 'Update') return applyUpdate(store.get(k) || { ...spec.Key }, spec);
              return null;
            });
            next.forEach((item) => { if (item) assertFits(item); });
            entries.forEach(({ kind, k }, i) => {
              if (kind === 'Put' || kind === 'Update') store.set(k, next[i]);
              else if (kind === 'Delete') store.delete(k);
            });
            return {};
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
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transactWrite'; } }

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
    BatchGetCommand, TransactWriteCommand,
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
  transactionCancelled,
  transactionConflict,
  throttled,
  ITEM_LIMIT_BYTES,
  itemBytes,
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchGetCommand, TransactWriteCommand,
};
