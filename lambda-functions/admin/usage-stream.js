/**
 * THE PEAK-STORAGE METER. The table's stream, used for the first time.
 *
 * `template-clean.yaml` has carried `StreamViewType: NEW_AND_OLD_IMAGES` with
 * no consumer attached since the table was written. This is that consumer, and
 * it exists because storage is billed on a LEVEL rather than an event: the
 * screen promises "the highest number of sets you held at once this period,
 * not the number at the end", and nothing else in the system notices the
 * moment a set count goes up.
 *
 * ── IT DOES NOT TRUST THE RECORD IT WAS GIVEN ──────────────────────────────
 *
 * A stream record says "something changed in ORG#acme#SETS". This handler uses
 * it as a DOORBELL and nothing more: it re-queries the partition and writes the
 * count it finds. It never reads NewImage/OldImage to work out a delta.
 *
 * That is not fastidiousness, it is the only correct option. DynamoDB Streams
 * deliver AT LEAST ONCE and a Lambda batch that throws is retried in full, so
 * a `+1` is a double charge waiting for a redelivery. A recomputed absolute is
 * idempotent by construction: replay the same record a hundred times and the
 * partition still holds the same number of sets. tests/usage-metering.js
 * replays a record and asserts the peak does not move.
 *
 * ── WHY IT SWALLOWS ITS ERRORS ─────────────────────────────────────────────
 *
 * A shard is ordered and a throwing batch blocks it — one poison record would
 * stop metering for every organisation until the record aged out. Since
 * usage-reconcile.js recomputes the same number daily from the same source, a
 * dropped notification costs at most a few hours of peak resolution, while a
 * blocked shard costs the whole meter. So: log, continue, let the backstop
 * catch it.
 */
const { recordSetCount, countSets } = require('./shared/usage');

/** `ORG#acme#SETS` -> `acme`. Anything else -> null, and is ignored.
 *  The filter is what stops this handler from reacting to its OWN writes: the
 *  USAGE# rows it produces live in `ORG#acme`, not `ORG#acme#SETS`, so they do
 *  not match and there is no feedback loop. */
function orgOfSetsPartition(pk) {
  const m = /^ORG#(.+)#SETS$/.exec(String(pk || ''));
  return m && m[1] ? m[1] : null;
}

exports.handler = async (event) => {
  const records = (event && event.Records) || [];

  // One re-count per ORG per batch, not per record. A bulk upload of thirty
  // sets arrives as one batch of thirty records that all describe the same
  // partition; counting it thirty times would be thirty identical queries and
  // thirty identical writes for one answer.
  const orgs = new Set();
  for (const record of records) {
    const keys = (record && record.dynamodb && record.dynamodb.Keys) || {};
    const pk = keys.PK && keys.PK.S;
    const sk = (keys.SK && keys.SK.S) || '';
    // Only set METADATA rows change the count. Content partitions
    // (`ORG#<org>#SET#<id>`) hold questions and do not match the PK pattern
    // anyway, but the SK check keeps a future row kind in that partition from
    // being counted as a set.
    if (!String(sk).startsWith('SET#')) continue;
    const org = orgOfSetsPartition(pk);
    if (org) orgs.add(org);
  }

  if (!orgs.size) return { orgsMeasured: 0 };

  let measured = 0;
  for (const orgId of orgs) {
    try {
      // Re-query, never a delta. See the header.
      const count = await countSets(orgId);
      const result = await recordSetCount(orgId, count);
      measured++;
      console.log(`📈 usage: ${orgId} holds ${count} sets${result.raised ? ' (new peak)' : ''}`);
    } catch (error) {
      console.error(`⚠️ usage-stream: could not measure ${orgId}, leaving it to the reconciler:`, error);
    }
  }
  return { orgsMeasured: measured };
};

module.exports.orgOfSetsPartition = orgOfSetsPartition;
