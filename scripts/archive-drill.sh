#!/bin/bash
# A BACKUP NOBODY HAS RESTORED IS A HOPE. This drill restores one, end to end, on a live tier.
#
#   scripts/archive-drill.sh engagedev
#   scripts/archive-drill.sh engagetest
#
# It creates a throwaway, INACTIVE Engage set with one uploaded image and backs it up. Then it
# deletes the set and the image, restores them from the archive, and checks that the questions
# and the image came back under the original id. Finally it removes everything it made: the
# set, the image, the archive item and the item's copied media. It drives the tier's own Lambda
# functions with a synthetic Engage-admin event, so it exercises the roles a real restore uses.
#
# REFUSES engageprod. Production is restored from the admin screen, by a person.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${1:-}"
case "$STACK" in
  engagedev|engagetest) ;;
  engageprod) echo "Refusing engageprod: back up and restore from the admin screen instead." >&2; exit 2 ;;
  *) echo "usage: $0 engagedev|engagetest" >&2; exit 2 ;;
esac
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"
export AWS_REGION="us-east-1"

SET_ID="archivedrill$(date -u +%Y%m%d%H%M%S)"
MEDIA_BUCKET="${STACK}-media"
ARCHIVE_BUCKET="engage2-archive-content"
TABLE=$(aws cloudformation describe-stack-resources --stack-name "$STACK" --logical-resource-id GameTable \
  --query 'StackResources[0].PhysicalResourceId' --output text)
WORK=$(mktemp -d)
ARCHIVE_ID=""
SNAPSHOT_ID=""
ADMIN='{"groups":"admins","userId":"archive-drill","username":"archive-drill"}'
FAILED=0

# invoke <function-suffix> <event-json>: prints the response body, fails on a non-200.
invoke() {
  local out="$WORK/response.json"
  aws lambda invoke --function-name "${STACK}-$1" --cli-binary-format raw-in-base64-out --payload "$2" "$out" >/dev/null
  if [ "$(jq -r '.statusCode' "$out")" != "200" ]; then
    echo "  FAIL - ${STACK}-$1 answered $(jq -r '.statusCode' "$out"): $(jq -r '.body' "$out")" >&2
    return 1
  fi
  jq -r '.body' "$out"
}
delete_set_event() {
  jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
    '{requestContext:{routeKey:"DELETE /admin/question-sets/{setId}",authorizer:{lambda:$a}},pathParameters:{setId:$id}}'
}
cleanup() {
  set +e
  invoke admin-delete-question-set "$(delete_set_event)" >/dev/null 2>&1
  aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null 2>&1
  if [ -n "$ARCHIVE_ID" ]; then
    invoke admin-archive-items "$(jq -nc --arg id "$ARCHIVE_ID" --argjson a "$ADMIN" \
      '{requestContext:{routeKey:"DELETE /admin/archive/items/{archiveId}",authorizer:{lambda:$a}},pathParameters:{archiveId:$id}}')" >/dev/null 2>&1
  fi
  if [ -n "$SNAPSHOT_ID" ]; then
    aws s3 rm "s3://${ARCHIVE_BUCKET}/archive/media/${SNAPSHOT_ID}/" --recursive >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
expect() { if [ "$2" = "$3" ]; then echo "  ok   - $1"; else echo "  FAIL - $1: expected $3, got $2"; FAILED=1; fi; }

echo "archive drill on $STACK, set $SET_ID"

echo "1. create an inactive Engage set with one uploaded image"
node -e "process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=','base64'))" > "$WORK/drill.png"
aws s3 cp "$WORK/drill.png" "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" --content-type image/png >/dev/null
CSV=$'Category,Title,Detail,Image\nDrill One,First drill question,Detail one,drill.png\nDrill One,Second drill question,Detail two,\nDrill Two,Third drill question,Detail three,'
invoke admin-upload-questions "$(jq -nc --arg id "$SET_ID" --arg csv "$CSV" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({fileName:($id+".csv"),fileContent:$csv,customTitle:$id,scope:"platform",startInactive:true}|tojson)}')" >/dev/null
echo "  ok   - created"

echo "2. back it up"
EXPORT=$(invoke admin-export-to-archive "$(jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[{scope:"platform",id:$id}],exportType:"questionsets"}|tojson)}')")
ARCHIVE_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].archiveId // empty')
SNAPSHOT_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].snapshotId // empty')
if [ -z "$ARCHIVE_ID" ]; then echo "  FAIL - nothing was archived: $(echo "$EXPORT" | jq -c '.results.failed')"; exit 1; fi
expect "archived with its image" "$(echo "$EXPORT" | jq -r '.results.successful[0].media.copied')" "1"

echo "3. lose it: delete the set and its image"
invoke admin-delete-question-set "$(delete_set_event)" >/dev/null
aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null
expect "the set is gone" "$(aws dynamodb get-item --table-name "$TABLE" --key "{\"PK\":{\"S\":\"SETS\"},\"SK\":{\"S\":\"SET#${SET_ID}\"}}" --query 'Item.SK.S' --output text)" "None"

echo "4. restore it"
IMPORT=$(invoke admin-import-from-archive "$(jq -nc --arg arc "$ARCHIVE_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[$arc]}|tojson)}')")
expect "restored under its original id" "$(echo "$IMPORT" | jq -r '.results.successful[0].id')" "$SET_ID"
expect "recreated rather than versioned" "$(echo "$IMPORT" | jq -r '.results.successful[0].mode')" "created"
expect "written as version 1, the partition counted below" "$(echo "$IMPORT" | jq -r '.results.successful[0].version')" "1"
expect "still inactive" "$(echo "$IMPORT" | jq -r '.results.successful[0].active')" "false"
expect "its image came back" "$(echo "$IMPORT" | jq -r '.media.copied')" "1"
ROWS=$(aws dynamodb query --table-name "$TABLE" --key-condition-expression 'PK = :pk' \
  --expression-attribute-values "{\":pk\":{\"S\":\"SET#${SET_ID}#v1\"}}" --select COUNT --query Count --output text)
expect "all five content rows are back (2 categories, 3 questions)" "$ROWS" "5"
if aws s3api head-object --bucket "$MEDIA_BUCKET" --key "sets/${SET_ID}/drill.png" >/dev/null 2>&1; then
  echo "  ok   - the image object exists again"
else
  echo "  FAIL - the image object is missing"; FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then echo "drill passed on $STACK"; else echo "drill FAILED on $STACK"; exit 1; fi
