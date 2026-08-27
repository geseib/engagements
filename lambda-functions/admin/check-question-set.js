/**
 * RUN THE CONTENT CHECK ON ONE VERSION, AND RECORD WHAT IT SAID.
 *
 *   POST /admin/question-sets/{setId}/check   { version }
 *
 * This is the link between the two halves that already exist:
 * `shared/content-guardrail.js` knows how to judge content, and
 * `shared/set-review.js` knows where the answer belongs. Without it nothing can
 * ever reach `passed`, so `publish-question-set.js` refuses everything — which
 * is the correct failure, and a useless product.
 *
 * ── SYNCHRONOUS, FOR NOW, AND SAYING SO ──────────────────────────────────
 *
 * The design calls for a job: `06-share-rejected.html` names specific
 * questions, so a 40-question set is ~40 `ApplyGuardrail` calls, and the share
 * dialog is drawn as the same panel the AI builders use.
 *
 * This runs them inline instead. That is a deliberate first step, not a
 * disagreement with the design: the two modules it joins are the parts worth
 * getting right, and joining them synchronously makes the whole path testable
 * end to end today. Each call is sub-second, so a set of any ordinary size
 * finishes well inside the timeout.
 *
 * WHAT MAKES IT SAFE TO MOVE LATER: the outcome lands in the review ROW, not in
 * this response. A worker writing the same row is the same design with a job in
 * front of it, and nothing that reads the row has to change.
 *
 * WHERE IT WILL BITE: a set large enough to exhaust the timeout returns a 504
 * and leaves the version `checking`. That is why `checking` is a state rather
 * than a transient — it is visible, and re-running is safe because the row is
 * keyed by version and simply overwritten.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const {
  setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition, setRef,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { writeReview, STATUS } = require('./shared/set-review');
const { checkQuestions, OUTCOME } = require('./shared/content-guardrail');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

/** The guardrail's three outcomes, in the review row's vocabulary. */
const AS_STATUS = {
  [OUTCOME.PASSED]: STATUS.PASSED,
  [OUTCOME.FLAGGED]: STATUS.FLAGGED,
  [OUTCOME.ESCALATED]: STATUS.ESCALATED,
};

exports.handler = async (event) => {
  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');

  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation before checking a question set.');

  // The same bar as publishing: this is the step before it, and a check whose
  // result unlocks a publish should not be reachable by somebody who could not
  // then publish.
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can run the content check.');
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }

  const source = setRef({ scope: tenant.ORG, orgId, setId });

  try {
    const metaRes = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }));
    const meta = metaRes.Item;
    if (!meta) return fail(404, 'That set is not one of yours.');

    const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
    const version = resolved.version;

    // VISIBLE WHILE IT RUNS. If this times out the version stays `checking`
    // rather than silently reverting to unreviewed, which is the difference
    // between "nobody has looked" and "something went wrong".
    await writeReview(db, TABLE(), source, version, { status: STATUS.CHECKING });

    const { items: rows } = await queryPartition(db, TABLE(), resolved.pk);
    const questions = [];
    for (const row of rows) {
      if (!String(row.SK || '').startsWith('QUESTION#')) continue;
      // Decrypted to be READ. The guardrail cannot judge ciphertext, and a
      // check that silently passed base64 would be worse than no check at all.
      // eslint-disable-next-line no-await-in-loop
      const plain = await decryptItem(orgId, 'question', row);
      questions.push({
        id: String(row.SK).replace('QUESTION#', ''),
        title: plain.Title,
        questionDetail: plain.Detail,
        answerDetails: plain.answerDetails,
      });
    }

    const result = await checkQuestions(questions);
    const status = AS_STATUS[result.outcome] || STATUS.ESCALATED;

    await writeReview(db, TABLE(), source, version, {
      status,
      findings: result.findings,
      note: `${result.clean}/${result.checked} clean`,
    });

    console.log(`🔎 ${orgId}/${setId} v${version}: ${status} (${result.clean}/${result.checked} clean)`);
    return json(200, {
      version,
      status,
      checked: result.checked,
      clean: result.clean,
      findings: result.findings,
    });
  } catch (error) {
    console.error('check error:', error);
    return fail(500, `Could not check that set: ${error.message}`);
  }
};
