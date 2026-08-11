/**
 * Value sources — "what number is this monitor watching right now?"
 *
 * Each source takes the monitor's `source` block plus a trailing window and
 * returns a single number. Adding a new kind of monitor is usually adding a
 * function here.
 *
 * Clients are injected rather than constructed at module scope so the tests can
 * run without AWS and without stubbing the SDK's module loader.
 */

const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Sum a CloudWatch metric over a trailing window.
 *
 * Deliberately sums HOURLY datapoints rather than asking for one datapoint at
 * Period=86400. A single 24h period is aligned to its own boundary and returns
 * nothing until the period closes, which is useless for a rolling limit; 24
 * hourly points can be summed the moment they exist.
 *
 * A metric with no activity publishes no datapoints at all — CloudWatch does
 * not emit zeros — so an empty Datapoints array means zero, not "unknown".
 */
async function cloudwatchSum({ source, windowMinutes, now, cloudwatch }) {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);

  const res = await cloudwatch.send(new GetMetricStatisticsCommand({
    Namespace: source.namespace,
    MetricName: source.metricName,
    Dimensions: source.dimensions || [],
    StartTime: start,
    EndTime: end,
    Period: 3600,
    Statistics: [source.statistic || 'Sum'],
  }));

  const key = source.statistic || 'Sum';
  const points = (res && res.Datapoints) || [];
  return points.reduce((total, p) => total + (p[key] || 0), 0);
}

/**
 * Count rows in a DynamoDB partition whose timestamp falls inside the window.
 *
 * This table has no GSIs (template-clean.yaml defines PK/SK only), so there is
 * no indexed way to ask "how many games since X". The honest implementation is
 * a paginated Query of the partition with a client-side date filter — the same
 * shape findGamesPinnedToVersion already uses for the same reason.
 *
 * Paginates fully: a Query caps at 1 MB, and a partial page would silently
 * under-count, which for a monitor means failing to alert.
 */
async function dynamoCount({ source, windowMinutes, now, ddb }) {
  const tableName = process.env[source.tableEnv];
  if (!tableName) {
    throw new Error(`Monitor source needs ${source.tableEnv} in the environment`);
  }

  const cutoff = now.getTime() - windowMinutes * 60 * 1000;
  const attr = source.timestampAttribute || 'createdAt';

  let count = 0;
  let ExclusiveStartKey;
  let pages = 0;

  do {
    const res = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': source.partition },
      ExclusiveStartKey,
    }));

    for (const item of (res.Items || [])) {
      const raw = item[attr];
      const t = typeof raw === 'number' ? raw : Date.parse(raw);
      if (Number.isFinite(t) && t >= cutoff) count += 1;
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
    pages += 1;
  } while (ExclusiveStartKey);

  console.log(`  ${source.partition}: counted ${count} row(s) over ${pages} page(s)`);
  return count;
}

const SOURCES = {
  cloudwatch: cloudwatchSum,
  'dynamodb-count': dynamoCount,
};

/**
 * Read a monitor's current value.
 * @returns {Promise<number>}
 */
async function readValue(monitor, deps) {
  const fn = SOURCES[monitor.source.type];
  if (!fn) throw new Error(`Monitor ${monitor.id}: unknown source type "${monitor.source.type}"`);
  return fn({
    source: monitor.source,
    windowMinutes: monitor.window,
    now: deps.now,
    cloudwatch: deps.cloudwatch,
    ddb: deps.ddb,
  });
}

function defaultClients() {
  return {
    cloudwatch: new CloudWatchClient({}),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  };
}

module.exports = { readValue, cloudwatchSum, dynamoCount, defaultClients, SOURCES };
