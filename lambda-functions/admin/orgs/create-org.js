/**
 * POST /orgs — start an organisation.
 *
 * The second of the two doors on `09-first-run.html`. A person whose account
 * has just been approved either joins the team that invited them or starts
 * their own; this is the second one, and it is one click, not a wizard.
 *
 * ── FIVE ROWS, ONE TRANSACTION, NO HALF-BUILT TENANT ───────────────────────
 *
 * Creating an organisation writes five rows in four partitions:
 *
 *   ORGS            / ORG#{orgId}   the platform's index of organisations
 *   ORG#{orgId}     / METADATA      the organisation itself
 *   ORG#{orgId}     / MEMBER#{sub}  the creator, as owner
 *   USER#{sub}      / ORG#{orgId}   the reverse row the AUTHORIZER reads
 *   USER#{sub}      / PROFILE       defaultOrgId, if they had none
 *
 * Written one at a time, every gap between them is a state somebody can end up
 * living in for ever, because there is no repair job and nothing notices:
 *
 *   after 1  an organisation in the platform list that does not exist
 *   after 2  an organisation with NO MEMBERS — unenterable, undeletable,
 *            invisible to its own creator, and nobody can be invited to it
 *            because inviting requires an admin and it has none
 *   after 3  a member the authorizer cannot see, so the creator is locked out
 *            of the organisation they are the owner of
 *
 * The middle one is the bad one. So all five go in one TransactWriteItems and
 * the failure mode collapses to "nothing happened", which the caller can
 * simply retry.
 *
 * ── WHY THE CONDITIONS ARE THERE WHEN THE ID IS RANDOM ─────────────────────
 *
 * `attribute_not_exists(PK)` on the index and metadata writes cannot fire: the
 * id is 22 base58 characters of `crypto.randomBytes`. They are there because
 * an unconditional Put onto an existing organisation's METADATA would REPLACE
 * that organisation's name and plan, and the only thing standing between us
 * and that is the quality of a random number generator somebody may one day
 * "simplify". A condition turns an argument about probability into an
 * arithmetic fact.
 */

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const tenant = require('../shared/tenant');
const { createOrgDataKey } = require('../shared/tenant-crypto');
const G = require('./shared/org-guards');

// Plans a customer may put themselves on. `09-first-run.html` prices exactly
// two: free while you are the only member, and Team at $5 a month. Anything
// else is refused rather than stored — an unknown plan string reaching the
// billing screen renders a blank price, which is worse than a rejection.
const PLANS = ['free', 'team'];

async function createOrg(event) {
  const sub = G.callerSub(event);
  if (!sub) return G.fail(403, 'Sign in to do this.');

  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');

  const named = G.validateName(body.name);
  if (named.error) return G.fail(400, named.error);

  const plan = G.clean(body.plan).toLowerCase() || 'free';
  if (!PLANS.includes(plan)) {
    return G.fail(400, `Plan must be one of: ${PLANS.join(', ')}.`);
  }

  // `seats` is an ALLOWANCE, not an occupancy count, and it is not a gate.
  // RATIONALE.md section 3: "Nothing is ever blocked" — the one moment a hard
  // limit would fire is the moment somebody is standing in front of a room.
  // Absent means unmetered; a number is carried for the billing screen to
  // display, never for a handler to enforce.
  const rawSeats = Number(body.seats);
  const seats = Number.isInteger(rawSeats) && rawSeats > 0 ? rawSeats : null;

  const orgId = G.mintOrgId();
  const now = new Date().toISOString();
  const email = G.callerEmail(event);
  const displayName = G.callerName(event);

/**
 * MINT THE ORGANISATION'S DATA KEY BEFORE ITS FIRST CONTENT WRITE.
 *
 * `tenant-crypto` throws `org <id> has no dataKeyCiphertext` rather than
 * silently writing plaintext for a tenant that believes it is encrypted — so an
 * org created without this cannot store a set or run a session at all. It is
 * the one call that needs `kms:GenerateDataKey`; everything else needs Decrypt.
 *
 * ONE KMS ROUND TRIP, HERE, and never again for this org: the wrapped blob goes
 * onto METADATA and every later request unwraps it from the row.
 *
 * Deliberately BEFORE the transaction rather than inside it. A key minted for an
 * org whose creation then fails is a few bytes of nothing — it references no
 * row and nobody can reach it. The reverse, a committed org with no key, is an
 * organisation that looks fine in the switcher and fails on everything the
 * moment somebody tries to use it.
 */
  const dataKeyCiphertext = await createOrgDataKey(orgId);

  const org = {
    PK: tenant.orgPk(orgId),
    SK: 'METADATA',
    orgId,
    dataKeyCiphertext,
    name: named.name,
    slug: G.slugify(named.name), // display only — see org-guards.js header
    // A TEAM, even on its first day with one member. This route is somebody
    // deliberately naming an organisation on 09-first-run.html; the `personal`
    // type is reserved for the home organisation provisioned automatically for
    // every approved account (shared/personal-org.js), which is the one that
    // cannot be left or deleted. Marking this one personal because it happens
    // to have a single member would make a mistyped name permanent.
    type: G.TEAM,
    plan,
    seats,
    status: 'active',
    createdAt: now,
    createdBy: sub,
  };

  const member = {
    PK: tenant.orgPk(orgId),
    SK: G.memberSk(sub),
    orgId,
    userId: sub,
    // OWNER, not admin. Somebody has to be un-removable or the last-owner rule
    // has nothing to protect and an organisation can be orphaned on day one.
    role: 'owner',
    email,
    displayName,
    joinedAt: now,
  };

  const reverse = {
    PK: tenant.userPk(sub),
    SK: G.userOrgSk(orgId),
    orgId,
    userId: sub,
    role: 'owner',
    joinedAt: now,
  };

  const indexRow = {
    // tenant.ORGS_INDEX_PK, never the literal — the same rule that keeps
    // 'SETS' and 'GAMES' out of handler source.
    PK: tenant.ORGS_INDEX_PK,
    SK: tenant.orgPk(orgId),
    orgId,
    name: named.name,
    plan,
    // The same `type`, on the platform's index row, because that is the row
    // 10-platform-orgs.html reads. "47 teams" is a count of THIS attribute; a
    // list that had to open every METADATA row to work out which entries are
    // somebody's private home would be a fan-out on the staff console's
    // landing page.
    type: G.TEAM,
    status: 'active',
    createdAt: now,
  };

  try {
    await G.db.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: G.tableName(),
            Item: indexRow,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: G.tableName(),
            Item: org,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        { Put: { TableName: G.tableName(), Item: member } },
        { Put: { TableName: G.tableName(), Item: reverse } },
        {
          // THE "when the user has none" RULE, EXPRESSED AS A CONDITION RATHER
          // THAN A READ. Reading PROFILE and then writing it is a race: two
          // tabs creating two organisations both read "no default" and the
          // second overwrites the first. `if_not_exists` makes the first
          // writer win inside DynamoDB, where the decision belongs.
          //
          // An Update also CREATES the row when it is absent, which is correct
          // here: `auth/post-confirmation.js` writes PROFILE at sign-up, but
          // accounts that predate it (the federated ones on dev) have none,
          // and their default org has to live somewhere.
          Update: {
            TableName: G.tableName(),
            Key: { PK: tenant.userPk(sub), SK: 'PROFILE' },
            UpdateExpression:
              'SET defaultOrgId = if_not_exists(defaultOrgId, :orgId), '
              + 'userId = if_not_exists(userId, :sub), '
              + 'updatedAt = :now',
            ExpressionAttributeValues: { ':orgId': orgId, ':sub': sub, ':now': now },
          },
        },
      ],
    }));
  } catch (error) {
    console.error('create-org transaction failed:', error);
    if (error.name === 'TransactionCanceledException') {
      // The only condition that can cancel this transaction is the id guard,
      // and it cannot realistically fire. Say so rather than emitting a 500
      // that reads like an outage.
      return G.fail(409, 'That organisation could not be created. Try again.');
    }
    return G.fail(500, `Could not create that organisation: ${error.message}`);
  }

  return G.json(201, {
    org: G.publicOrg(org),
    membership: G.publicMember(member),
  });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;

  // OPTIONS FIRST — a preflight carries no credentials and must not 403.
  if (method === 'OPTIONS') return G.handlePreflight();

  // No org guard here, and that is not an oversight: this is the route that
  // CREATES the caller's first organisation, so requiring one would make the
  // first organisation impossible to make. The only requirement is an
  // identity, and `createOrg` refuses a blank one on its first line.
  if (method === 'POST') return createOrg(event);

  return G.fail(404, 'Endpoint not found');
};
