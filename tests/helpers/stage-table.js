/**
 * A REAL UpdateCommand applier for the stage-route suites (stage-beat-flow,
 * stage-focus-flow, stage-focus-vote): SET (with if_not_exists), ADD, REMOVE,
 * and ConditionExpression evaluated for real — `#a = :v`,
 * attribute_exists / attribute_not_exists, AND / OR, parentheses. A stub that
 * returned `{}` would pass a handler that broadcasts a fact and never writes
 * it; one that ignored conditions would pass a write onto the wrong beat.
 *
 * `applyUpdate(store, key, input)` mutates `store` (a Map of "PK|SK" -> item)
 * and throws ConditionalCheckFailedException when the condition fails.
 */
function applyUpdate(store, key, input) {
  const k = key(input.Key.PK, input.Key.SK);
  const existing = store.get(k);
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};

  // ConditionExpression, evaluated for real: a stub that ignored it would let
  // a handler write Workie's page onto a round that is not on the read.
  if (input.ConditionExpression && !evalCondition(input.ConditionExpression, existing, names, values)) {
    const err = new Error('The conditional request failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }

  const item = existing ? { ...existing } : { ...input.Key };
  const touched = new Set();
  const attrOf = (token) => names[token.trim()] || token.trim();
  const sections = String(input.UpdateExpression || '').split(/\b(SET|ADD|REMOVE)\b/).map((x) => x.trim()).filter(Boolean);
  for (let n = 0; n < sections.length; n += 2) {
    const verb = sections[n];
    const body = sections[n + 1] || '';
    // Split on commas that are not inside if_not_exists( , ).
    const parts = body.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    for (const part of parts) {
      if (verb === 'SET') {
        const [lhs, rhs] = part.split(/=(.*)/s).map((x) => x.trim());
        const ine = /^if_not_exists\(\s*(#?\w+)\s*,\s*(:\w+)\s*\)$/.exec(rhs);
        if (ine) {
          const a = attrOf(ine[1]);
          item[attrOf(lhs)] = item[a] !== undefined ? item[a] : values[ine[2]];
          touched.add(attrOf(lhs));
        } else {
          if (!(rhs in values)) throw new Error(`fake: unsupported SET right-hand side "${rhs}"`);
          item[attrOf(lhs)] = values[rhs];
          touched.add(attrOf(lhs));
        }
      } else if (verb === 'ADD') {
        const [a, v] = part.split(/\s+/);
        item[attrOf(a)] = (Number(item[attrOf(a)]) || 0) + values[v];
        touched.add(attrOf(a));
      } else if (verb === 'REMOVE') {
        delete item[attrOf(part)];
      }
    }
  }
  store.set(k, item);
  // ReturnValues, as DynamoDB answers them: the whole item, or only what moved.
  if (input.ReturnValues === 'ALL_NEW') return { Attributes: { ...item } };
  if (input.ReturnValues === 'UPDATED_NEW') {
    const attrs = {};
    for (const a of touched) attrs[a] = item[a];
    return { Attributes: attrs };
  }
  return {};
}

/** `#a = :v`, `attribute_exists(x)`, `attribute_not_exists(x)`, joined by AND / OR with parentheses. */
function evalCondition(expression, item, names, values) {
  const row = item || {};
  const attr = (t) => names[t] || t;
  const js = expression
    .replace(/attribute_not_exists\(\s*(#?\w+)\s*\)/g, (_, t) => `(row[${JSON.stringify(attr(t))}] === undefined)`)
    .replace(/attribute_exists\(\s*(#?\w+)\s*\)/g, (_, t) => `(row[${JSON.stringify(attr(t))}] !== undefined)`)
    .replace(/(#?\w+)\s*=\s*(:\w+)/g, (_, t, v) => `(row[${JSON.stringify(attr(t))}] === values[${JSON.stringify(v)}])`)
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||');
  // eslint-disable-next-line no-new-func
  return Function('row', 'values', `return ${js};`)(row, values);
}

module.exports = { applyUpdate, evalCondition };
