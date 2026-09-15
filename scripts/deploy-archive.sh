#!/bin/bash
# DEPLOY THE SHARED ARCHIVE SERVICE (stack engage2-archive-service) — by hand; no pipeline reaches it.
#
#   scripts/deploy-archive.sh preview   pre-flight, build, and show the change set; nothing is deployed
#   scripts/deploy-archive.sh lock      pre-flight, build, deploy, record the outputs, verify
#   scripts/deploy-archive.sh unlock    deploy the same template with the ArchiveApi lock removed
#
# One archive serves dev, test AND prod, and its routes require AWS_IAM. Deploying the lock while
# any tier still calls it unsigned locks that tier out of its backups. So `preview` and `lock`
# REFUSE to go on until scripts/archive-access-check.sh passes for every tier, and `lock` then
# runs the check again to prove every tier still gets in, every route requires AWS_IAM, and a
# stranger does not.
#
# `unlock` is the rollback. It runs no pre-flight first, because the failure it exists for — a tier
# whose signature the locked archive rejects — fails the pre-flight's signed list too. After
# deploying, it runs the pre-flight to show every tier reaching the archive again. The table and
# bucket are retained whatever the template says, so no deploy here can delete a backup.
#
# This stack has no pipeline history, so what `preview` and `lock` deploy must be a commit, and
# every run prints which one. tests/archive-scripts.js runs every mode against a stubbed aws,
# curl and sam.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in
  preview|lock|unlock) ;;
  *) echo "usage: $0 preview|lock|unlock" >&2; exit 2 ;;
esac

STACK_NAME="engage2-archive-service"
TEMPLATE_FILE="template-archive.yaml"
CONFIG_FILE="config/archive-service.json"
DOMAIN_NAME="archive.seibtribe.us"
HOSTED_ZONE_ID="ZB9TUA073B5SH"
export AWS_REGION="us-east-1"
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"

COMMIT=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- "$TEMPLATE_FILE" lambda-functions/archive)" ]; then
  if [ "$MODE" = "unlock" ]; then
    echo "WARNING: deploying uncommitted changes to $TEMPLATE_FILE or lambda-functions/archive." >&2
  else
    echo "Refusing: $TEMPLATE_FILE or lambda-functions/archive has uncommitted changes. This stack has no pipeline history, so what is deployed must be a commit." >&2
    exit 2
  fi
fi
echo "== ${MODE} ${STACK_NAME} from commit ${COMMIT} =="

case "$MODE" in
  preview|lock)
    echo "== 1. pre-flight: can every tier sign its archive calls, and may it invoke? =="
    scripts/archive-access-check.sh preflight
    echo "== 2. build =="
    BUILT=".aws-sam/archive-build/template.yaml"
    sam build -t "$TEMPLATE_FILE" --build-dir .aws-sam/archive-build
    ;;
  unlock)
    echo "== 1. build the template with the ArchiveApi lock removed (no pre-flight: see the header) =="
    UNLOCKED_DIR=$(mktemp -d)
    trap 'rm -rf "$UNLOCKED_DIR"' EXIT
    node -e '
      const fs = require("fs");
      const [src, dest] = process.argv.slice(1);
      const lock = "    Properties:\n      Auth:\n        EnableIamAuthorizer: true\n        DefaultAuthorizer: AWS_IAM\n";
      const text = fs.readFileSync(src, "utf8");
      if (text.split(lock).length !== 2) {
        console.error("The ArchiveApi Auth block is not in the form this script removes. Unlock by hand: delete it from template-archive.yaml, then sam build and sam deploy.");
        process.exit(1);
      }
      fs.writeFileSync(dest, text.replace(lock, "    Properties: {}\n"));
    ' "$TEMPLATE_FILE" "$UNLOCKED_DIR/template-archive.yaml"
    BUILT=".aws-sam/archive-unlock-build/template.yaml"
    sam build -t "$UNLOCKED_DIR/template-archive.yaml" --base-dir . --build-dir .aws-sam/archive-unlock-build
    ;;
esac

# sam_deploy <execute|preview>
sam_deploy() {
  local -a flags
  flags=(--stack-name "$STACK_NAME" --template-file "$BUILT" --region "$AWS_REGION"
    --capabilities CAPABILITY_IAM --parameter-overrides DomainName="$DOMAIN_NAME" HostedZoneId="$HOSTED_ZONE_ID"
    --resolve-s3 --no-fail-on-empty-changeset)
  if [ "$1" = "execute" ]; then flags+=(--no-confirm-changeset); else flags+=(--no-execute-changeset); fi
  sam deploy "${flags[@]}"
}
# sam deploy can exit non-zero after the change set ran (credentials expiring during the wait,
# for one), so a failed deploy is not a rolled-back deploy, and nothing here may say it is.
deploy_failed() {
  echo >&2
  echo "The deploy did not report success. The stack may be unchanged, updated, or rolling back, so whether the archive is locked is not known." >&2
  echo "  aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --profile $AWS_PROFILE --query 'Stacks[0].StackStatus'" >&2
  echo "UPDATE_COMPLETE means the change set ran: run scripts/archive-access-check.sh verify, and if any tier cannot reach the archive, run scripts/deploy-archive.sh unlock." >&2
  echo "UPDATE_ROLLBACK_COMPLETE means it was undone." >&2
  echo "UPDATE_ROLLBACK_FAILED: see aws cloudformation continue-update-rollback." >&2
  exit 1
}

if [ "$MODE" = "preview" ]; then
  echo "== 3. the change set =="
  sam_deploy preview
  echo
  echo "Nothing was deployed. Every change above should be * Modify with Replacement False, and none should be - Delete."
  exit 0
fi

if [ "$MODE" = "unlock" ]; then
  echo "== 2. deploy the unlocked template =="
  sam_deploy execute || deploy_failed
  echo "== 3. every tier reaches the archive again =="
  if scripts/archive-access-check.sh preflight; then status=0; else status=1; fi
  echo
  echo "THE SHARED ARCHIVE IS UNLOCKED: its routes accept unsigned requests again."
  echo "Find why the lock failed. Then run scripts/deploy-archive.sh preview, read its change set, and only then run scripts/deploy-archive.sh lock."
  exit "$status"
fi

echo "== 3. deploy ${STACK_NAME} =="
sam_deploy execute || deploy_failed

# From here the lock is live, and nothing below may leave the operator unsure of that. The
# config is written to a temp file beside it, and this removes that file, so a failure between
# the write and the move leaves nothing in config/.
locked_but() {
  rm -f "${NEW_CONFIG:-}"
  echo >&2
  echo "THE SHARED ARCHIVE IS NOW LOCKED, but $*." >&2
  echo "If any tier cannot reach it, unlock it now: scripts/deploy-archive.sh unlock" >&2
  exit 1
}
output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "== 4. record the stack's outputs in ${CONFIG_FILE} =="
NEW_CONFIG=""
UNREAD="its outputs could not be read, so ${CONFIG_FILE} was left unchanged"
DOMAIN_URL=$(output ArchiveDomainUrl) || locked_but "$UNREAD"
API_URL=$(output ArchiveApiUrl) || locked_but "$UNREAD"
TABLE_NAME=$(output ArchiveTableName) || locked_but "$UNREAD"
BUCKET_NAME=$(output ArchiveBucketName) || locked_but "$UNREAD"
for value in "$DOMAIN_URL" "$API_URL" "$TABLE_NAME" "$BUCKET_NAME"; do
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    locked_but "a stack output is missing, so ${CONFIG_FILE} was left unchanged"
  fi
done
if ! [[ "$API_URL" =~ ^https://[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com$ ]]; then
  locked_but "ArchiveApiUrl '${API_URL}' is not an execute-api URL, so ${CONFIG_FILE} was left unchanged"
fi
# Written beside the config and moved into place, so the config is either the old file or the
# whole new one, and every step that can fail says the archive is locked.
NEW_CONFIG=$(mktemp "${CONFIG_FILE}.XXXXXX") || locked_but "no temporary file could be created, so ${CONFIG_FILE} was left unchanged"
cat > "$NEW_CONFIG" <<EOF || locked_but "the new config could not be written, so ${CONFIG_FILE} was left unchanged"
{
  "archiveServiceUrl": "${DOMAIN_URL}",
  "archiveApiUrl": "${API_URL}",
  "tableName": "${TABLE_NAME}",
  "bucketName": "${BUCKET_NAME}",
  "region": "${AWS_REGION}"
}
EOF
chmod 644 "$NEW_CONFIG" || locked_but "the new config's permissions could not be set, so ${CONFIG_FILE} was left unchanged"
mv "$NEW_CONFIG" "$CONFIG_FILE" || locked_but "the new config could not be moved into place, so ${CONFIG_FILE} was left unchanged"
echo "wrote ${CONFIG_FILE}"
if ! git diff --quiet -- "$CONFIG_FILE"; then
  echo "NOTE: ${CONFIG_FILE} changed:" >&2
  git --no-pager diff -- "$CONFIG_FILE" >&2 || true
  echo "If archiveApiUrl changed, update ArchiveService in template-clean.yaml, run the suites, and redeploy every tier." >&2
fi

echo "== 5. verify: every tier still gets in, every route is locked, and a stranger does not =="
scripts/archive-access-check.sh verify || locked_but "verify failed (above)"

# Before the lock nothing could prove a signature: an unlocked archive answers unsigned
# requests too. verify has now proved each tier's signed list; the drill proves a signed
# backup, restore and delete.
echo "Now run: scripts/archive-drill.sh engagedev && scripts/archive-drill.sh engagetest"
