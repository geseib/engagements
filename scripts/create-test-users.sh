#!/usr/bin/env bash
#
# TEST ACCOUNTS FOR A TIER, with the four things that make one actually usable.
#
# Run it yourself — it asks for the passwords rather than taking them as
# arguments, so nothing lands in shell history.
#
#   ./scripts/create-test-users.sh engagetest
#
# ── THE FOUR TRAPS, WHICH ARE WHY THIS IS A SCRIPT AND NOT A COMMAND ────────
#
# 1. `admin-create-user` ALONE LEAVES THE ACCOUNT UNUSABLE. It lands in
#    FORCE_CHANGE_PASSWORD, which has no password — so the account cannot sign
#    in normally AND `ForgotPassword` cannot reset it either. CLAUDE.md records
#    two sessions lost to exactly this on dev: reset "worked on test and not on
#    dev" with no configuration difference between them, because dev's only
#    native account had been admin-created and never exchanged its temporary
#    password. `admin-set-user-password --permanent` below is what moves it to
#    CONFIRMED.
#
# 2. THE GROUP DECIDES WHETHER THEY GET AN ORGANISATION AT ALL. Personal-org
#    provisioning is LAZY and reads the caller's groups
#    (admin/orgs/shared/personal-org.js): an account sitting in `pending` is
#    given nothing, deliberately, so abandoned signups do not mint rows. An
#    account with no org cannot create a question set — upload-questions.js
#    refuses with "Choose an organisation before creating a question set" — so a
#    test account left in `pending` looks broken in a way that has nothing to do
#    with what you are testing. These go straight into `hosts`.
#
# 3. THE ORG IS MINTED ON FIRST CONSOLE LOAD, NOT HERE. Provisioning hangs off
#    `GET /orgs`, the request that draws the switcher. So the account has no
#    organisation until somebody signs in with it once. Nothing below can do
#    that step for you and it is not optional — see the closing note.
#
# 4. THE POOL ID IS DERIVED, NOT TYPED. Every URL and id in CLAUDE.md's
#    environment table was wrong once, and its own instruction is to re-derive
#    rather than trust the table. This reads the stack output.
#
# `PostConfirmation` does NOT fire for an admin-created user, so no USER#/PROFILE
# row is written. That is fine and needs no fixing here: personal-org.js is
# explicitly self-healing for accounts with no profile row — it is how the
# federated accounts on dev were provisioned without a backfill.

set -euo pipefail

STACK="${1:-}"
if [[ -z "$STACK" ]]; then
  echo "usage: $0 <stack>            e.g. $0 engagetest" >&2
  echo "  stacks: engagedev | engagetest | engageprod" >&2
  exit 2
fi

if [[ "$STACK" == "engageprod" ]]; then
  echo "Refusing to create test accounts in PROD. Use engagetest." >&2
  exit 2
fi

# ── 4. derive the pool, never trust a table ────────────────────────────────
POOL_ID="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)"

if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  echo "Could not read UserPoolId from stack '$STACK'. Is the name right, and are your credentials current?" >&2
  exit 1
fi
echo "Pool for $STACK: $POOL_ID"

# TWO ACCOUNTS, IN TWO DIFFERENT ORGANISATIONS. One account cannot test tenancy.
# Each gets its own personal org on first sign-in, which is what makes "org A
# cannot see org B's sets or sessions" a thing you can actually check by hand.
DEFAULT_A="qa-host-a@example.com"
DEFAULT_B="qa-host-b@example.com"

read -r -p "First test host  [$DEFAULT_A]: " EMAIL_A
EMAIL_A="${EMAIL_A:-$DEFAULT_A}"
read -r -p "Second test host [$DEFAULT_B]: " EMAIL_B
EMAIL_B="${EMAIL_B:-$DEFAULT_B}"

# Asked for, never passed in: an argument would be in your shell history and in
# the process list of every other user on this machine.
read -r -s -p "Password for both accounts: " PASSWORD; echo
read -r -s -p "Again: " PASSWORD_AGAIN; echo
if [[ "$PASSWORD" != "$PASSWORD_AGAIN" ]]; then
  echo "They do not match." >&2
  exit 1
fi

make_user() {
  local email="$1"

  if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$email" >/dev/null 2>&1; then
    echo "  $email already exists — setting its password and group rather than recreating it"
  else
    # SUPPRESS: these addresses are not real and Cognito's invitation would
    # bounce. The temporary password is irrelevant — the next call replaces it.
    aws cognito-idp admin-create-user \
      --user-pool-id "$POOL_ID" \
      --username "$email" \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
                        Name=name,Value="${email%%@*}" \
      --message-action SUPPRESS >/dev/null
    echo "  created $email"
  fi

  # ── 1. the one that makes it signable-in AND resettable ─────────────────
  aws cognito-idp admin-set-user-password \
    --user-pool-id "$POOL_ID" --username "$email" \
    --password "$PASSWORD" --permanent

  # ── 2. hosts, not pending — see the header ──────────────────────────────
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$POOL_ID" --username "$email" --group-name hosts

  local status
  status="$(aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$email" \
    --query 'UserStatus' --output text)"
  echo "  $email -> $status, group hosts"
  if [[ "$status" != "CONFIRMED" ]]; then
    echo "  ⚠️  expected CONFIRMED. FORCE_CHANGE_PASSWORD here means the password step did not take," >&2
    echo "     and the account can neither sign in nor be reset. See trap 1 in this script's header." >&2
  fi
}

echo
echo "Creating:"
make_user "$EMAIL_A"
make_user "$EMAIL_B"

FRONTEND="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' --output text 2>/dev/null || true)"
[[ -z "$FRONTEND" || "$FRONTEND" == "None" ]] && FRONTEND="https://engage.test.seibtribe.us"

cat <<EOF

Done. ONE STEP LEFT, and it is not optional:

  Sign in once as each account at
    $FRONTEND

  Neither has an organisation yet. Personal orgs are minted lazily by GET /orgs
  — the request that draws the org switcher — so the first console load is what
  creates them. Until then both accounts will refuse to create a question set,
  which looks like a bug and is not one.

Then, to check they landed:

  aws cognito-idp admin-list-groups-for-user --user-pool-id $POOL_ID \\
    --username $EMAIL_A --query 'Groups[].GroupName'

  aws dynamodb query --table-name <table> \\
    --key-condition-expression 'PK = :pk' \\
    --expression-attribute-values '{":pk":{"S":"ORGS"}}' \\
    --query 'Items[].orgId.S'

To remove them afterwards:

  aws cognito-idp admin-delete-user --user-pool-id $POOL_ID --username $EMAIL_A
  aws cognito-idp admin-delete-user --user-pool-id $POOL_ID --username $EMAIL_B

  The organisations they created are NOT removed by that and have to go
  separately, or the platform org count keeps counting them.
EOF
