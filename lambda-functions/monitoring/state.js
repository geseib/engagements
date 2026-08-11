/**
 * Monitor state, in SSM Parameter Store.
 *
 * Why SSM and not DynamoDB, when the rest of this repo is a single DynamoDB
 * table: this stack is deployed ONCE for the whole account (see
 * template-monitoring.yaml), while the game table exists once per tier. Making
 * an account-level safety control depend on a particular tier's table would
 * mean the prod table going away takes the SES breaker with it.
 *
 * Two parameters per monitor, under STATE_PREFIX:
 *   <prefix>/<id>/state    JSON, written by us
 *   <prefix>/<id>/enabled  "true"/"false", written by a human, never by us
 *
 * The enabled parameter is optional. Its absence means "no override".
 */

const {
  SSMClient, GetParameterCommand, PutParameterCommand, ParameterNotFound,
} = require('@aws-sdk/client-ssm');

const PREFIX = () => process.env.STATE_PREFIX || '/engage/monitors';

function statePath(id) { return `${PREFIX()}/${id}/state`; }
function enabledPath(id) { return `${PREFIX()}/${id}/enabled`; }

async function getParam(ssm, Name) {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name }));
    return res.Parameter ? res.Parameter.Value : undefined;
  } catch (err) {
    // A monitor that has never tripped has no state parameter. That is the
    // normal case on first run, not an error.
    if (err instanceof ParameterNotFound || err.name === 'ParameterNotFound') return undefined;
    throw err;
  }
}

async function readState(id, { ssm }) {
  const raw = await getParam(ssm, statePath(id));
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt state must not wedge the monitor. Treating it as "never tripped"
    // costs at most one duplicate alert; throwing would mean the breaker stops
    // evaluating entirely, which is the failure that matters.
    console.warn(`Monitor ${id}: unparseable state, treating as empty`);
    return {};
  }
}

async function writeState(id, state, { ssm }) {
  await ssm.send(new PutParameterCommand({
    Name: statePath(id),
    Value: JSON.stringify(state),
    Type: 'String',
    Overwrite: true,
  }));
}

async function readEnabledOverride(id, { ssm }) {
  const raw = await getParam(ssm, enabledPath(id));
  return raw === undefined ? undefined : String(raw).trim().toLowerCase();
}

function defaultClients() {
  return { ssm: new SSMClient({}) };
}

module.exports = { readState, writeState, readEnabledOverride, defaultClients, statePath, enabledPath };
