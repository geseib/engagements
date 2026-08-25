#!/usr/bin/env bash
#
# TEST ACCOUNTS FOR A TIER, with the four things that make one actually usable.
#
# Run it yourself — it asks for the passwords rather than taking them as
# arguments, so nothing lands in shell history.
#
#   ./scripts/create-test-users.sh engagetest adminaccess
#   AWS_PROFILE=adminaccess ./scripts/create-test-users.sh engagetest
#
# THE PROFILE IS NOT OPTIONAL UNLESS YOUR DEFAULT ONE IS THE RIGHT ACCOUNT.
# The first version of this script called plain `aws` and therefore used the
# DEFAULT profile, so signing in with `aws sso login --profile adminaccess`
# changed nothing it could see and it died on "Unable to locate credentials"
# with no hint that a profile existed, let alone that it was being ignored.
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
#    CONFIRMED, and the status is READ BACK rather than assumed.
#
# 2. THE GROUP DECIDES WHETHER THEY GET AN ORGANISATION AT ALL. Personal-org
#    provisioning is LAZY and reads the caller's groups
#    (admin/orgs/shared/personal-org.js): `APPROVED_GROUPS = ['hosts','admins']`,
#    with `pending` and the empty list both deliberately absent so abandoned
#    signups mint no rows. An account with no org cannot create a question set —
#    upload-questions.js refuses with "Choose an organisation before creating a
#    question set" — so a test account left in `pending` looks broken in a way
#    that has nothing to do with what you are testing. These go into `hosts`.
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
#
# ── A NOTE ON `set -e` AND ERROR MESSAGES ──────────────────────────────────
# `VAR="$(aws ...)"` under `set -e` exits AT THE ASSIGNMENT when the command
# fails, so any check written after it never runs. That is how the first version
# of this script ended up with a friendly credentials message that could not
# fire. Every capture below is therefore `if ! VAR="$(...)"`, which puts the
# command in a condition and lets the handler actually run.

set -euo pipefail

STACK="${1:-}"
PROFILE="${2:-${AWS_PROFILE:-}}"

if [[ -z "$STACK" ]]; then
  cat >&2 <<'USAGE'
usage: ./scripts/create-test-users.sh <stack> [aws-profile]

  stacks:   engagedev | engagetest        (engageprod is refused)
  profile:  optional; falls back to $AWS_PROFILE, then your default profile

examples:
  ./scripts/create-test-users.sh engagetest adminaccess
  AWS_PROFILE=adminaccess ./scripts/create-test-users.sh engagetest
USAGE
  exit 2
fi

if [[ "$STACK" == "engageprod" ]]; then
  echo "Refusing to create test accounts in PROD. Use engagetest." >&2
  exit 2
fi

# Exported rather than threaded through as `--profile` on every call: an array
# of optional flags is a bash-3.2 unbound-variable trap under `set -u`, and
# macOS still ships bash 3.2.
if [[ -n "$PROFILE" ]]; then
  export AWS_PROFILE="$PROFILE"
fi

# ── PREFLIGHT: whose credentials, and are they live? ───────────────────────
# Before anything is created, and reported with the profile NAMED — the failure
# this replaces said only "Unable to locate credentials", which is true of a
# missing profile, an expired SSO session and a typo alike.
if ! IDENTITY="$(aws sts get-caller-identity --output text --query '[Account,Arn]' 2>&1)"; then
  echo "Could not use ${AWS_PROFILE:-your default} AWS credentials." >&2
  echo >&2
  echo "  $IDENTITY" >&2
  echo >&2
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    echo "  Try:  aws sso login --profile $AWS_PROFILE" >&2
    echo "  Then: ./scripts/create-test-users.sh $STACK $AWS_PROFILE" >&2
  else
    echo "  No profile was given and the default one is not usable. Pass one:" >&2
    echo "    ./scripts/create-test-users.sh $STACK <profile>" >&2
    echo >&2
    echo "  Your profiles:" >&2
    aws configure list-profiles 2>/dev/null | sed 's/^/    /' >&2 || true
  fi
  exit 1
fi

ACCOUNT="${IDENTITY%%$'\t'*}"
WHO="${IDENTITY#*$'\t'}"

# ── 4. derive the pool, never trust a table ────────────────────────────────
if ! POOL_ID="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>&1)"; then
  echo "Could not read stack '$STACK' in account $ACCOUNT." >&2
  echo >&2
  echo "  $POOL_ID" >&2
  echo >&2
  echo "  Either the stack name is wrong, or ${AWS_PROFILE:-your default profile} points at a different account." >&2
  exit 1
fi

if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  echo "Stack '$STACK' exists but publishes no UserPoolId output." >&2
  exit 1
fi

cat <<EOF

  AWS account : $ACCOUNT
  acting as   : $WHO
  profile     : ${AWS_PROFILE:-(default)}
  stack       : $STACK
  user pool   : $POOL_ID

EOF

# Creating sign-in identities is worth one look at WHICH account first — the
# stack name is easy to get right while the profile points somewhere else.
read -r -p "Create test accounts here? [y/N] " AGREE
if [[ "$AGREE" != "y" && "$AGREE" != "Y" ]]; then
  echo "Nothing was created."
  exit 0
fi

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
  local out status

  if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$email" >/dev/null 2>&1; then
    echo "  $email already exists — setting its password and group rather than recreating it"
  else
    # SUPPRESS: these addresses are not real and Cognito's invitation would
    # bounce. The temporary password is irrelevant — the next call replaces it.
    if ! out="$(aws cognito-idp admin-create-user \
        --user-pool-id "$POOL_ID" \
        --username "$email" \
        --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
                          Name=name,Value="${email%%@*}" \
        --message-action SUPPRESS 2>&1)"; then
      echo "  could not create $email:" >&2
      echo "    $out" >&2
      return 1
    fi
    echo "  created $email"
  fi

  # ── 1. the one that makes it signable-in AND resettable ─────────────────
  if ! out="$(aws cognito-idp admin-set-user-password \
      --user-pool-id "$POOL_ID" --username "$email" \
      --password "$PASSWORD" --permanent 2>&1)"; then
    echo "  could not set the password for $email:" >&2
    echo "    $out" >&2
    echo "    (a pool password policy rejects weak passwords here, and the account" >&2
    echo "     stays in FORCE_CHANGE_PASSWORD — unusable AND unresettable)" >&2
    return 1
  fi

  # ── 2. hosts, not pending — see the header ──────────────────────────────
  if ! out="$(aws cognito-idp admin-add-user-to-group \
      --user-pool-id "$POOL_ID" --username "$email" --group-name hosts 2>&1)"; then
    echo "  could not add $email to hosts:" >&2
    echo "    $out" >&2
    return 1
  fi

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

To remove them afterwards:

  aws cognito-idp admin-delete-user --user-pool-id $POOL_ID --username $EMAIL_A
  aws cognito-idp admin-delete-user --user-pool-id $POOL_ID --username $EMAIL_B

  The organisations they created are NOT removed by that and have to go
  separately, or the platform org count keeps counting them.
EOF
