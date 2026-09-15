#!/bin/bash
# DEPLOY THE SHARED ARCHIVE SERVICE (stack engage2-archive-service) — by hand; no pipeline reaches it.
#
# One archive serves dev, test AND prod, and its routes require AWS_IAM. Deploying it while any
# tier still calls it unsigned locks that tier out of its backups. So this script REFUSES to
# deploy until scripts/archive-access-check.sh passes for every tier, and afterwards runs the
# check again to prove every tier still gets in, every route requires AWS_IAM, and a stranger
# does not.
#
# Rollback: deploy the same template with the ArchiveApi `Auth:` block removed. The table and
# bucket are retained whatever the template says, so no rollback can delete a backup.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="engage2-archive-service"
TEMPLATE_FILE="template-archive.yaml"
BUILD_DIR=".aws-sam/archive-build"
DOMAIN_NAME="archive.seibtribe.us"
HOSTED_ZONE_ID="ZB9TUA073B5SH"
export AWS_REGION="us-east-1"
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"

echo "== 1. pre-flight: can every tier sign its archive calls, and may it invoke? =="
scripts/archive-access-check.sh preflight

echo "== 2. build and deploy ${STACK_NAME} =="
sam build -t "$TEMPLATE_FILE" --build-dir "$BUILD_DIR"
sam deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$BUILD_DIR/template.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName="$DOMAIN_NAME" HostedZoneId="$HOSTED_ZONE_ID" \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
cat > config/archive-service.json <<EOF
{
  "archiveServiceUrl": "$(output ArchiveDomainUrl)",
  "archiveApiUrl": "$(output ArchiveApiUrl)",
  "tableName": "$(output ArchiveTableName)",
  "bucketName": "$(output ArchiveBucketName)",
  "region": "${AWS_REGION}"
}
EOF
echo "wrote config/archive-service.json"
if ! git diff --quiet -- config/archive-service.json; then
  echo "WARNING: the archive API id changed. Update ArchiveService in template-clean.yaml, run the suites, and redeploy every tier." >&2
fi

echo "== 3. verify: every tier still gets in, every route is locked, and a stranger does not =="
scripts/archive-access-check.sh verify

# Before the lock nothing could prove a signature: an unlocked archive answers unsigned
# requests too. verify has now proved each tier's signed list; the drill proves a signed
# backup, restore and delete.
echo "Now run: scripts/archive-drill.sh engagedev && scripts/archive-drill.sh engagetest"
