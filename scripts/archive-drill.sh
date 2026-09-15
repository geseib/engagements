#!/bin/bash
# A BACKUP NOBODY HAS RESTORED IS A HOPE. This drill restores one, end to end, on a live tier.
#
#   scripts/archive-drill.sh engagedev
#   scripts/archive-drill.sh engagetest
#
# It creates a throwaway, INACTIVE Engage set with one uploaded image and backs it up. Then it
# deletes the set and the image, restores them from the archive, and checks that the questions
# and the image came back under the original id. Finally it removes everything it made — the
# set, the image, the archive item and the item's copied images — through the same routes, and
# checks they are gone. It drives the tier's own Lambda functions with a synthetic Engage-admin
# event, so it exercises the roles a real restore uses.
#
# If the drill stops early, its exit trap removes whatever it may have made, and prints a
# LEFT BEHIND line for anything it could not remove. The archive is shared with production,
# so nothing may be left there silently. tests/archive-scripts.js runs it against a stub.
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

# The tier is in the id: dev and test share one archive, and a drill must never touch another's items.
SET_ID="archivedrill${STACK#engage}$(date -u +%Y%m%d%H%M%S)"
MEDIA_BUCKET="${STACK}-media"
ARCHIVE_BUCKET="engage2-archive-content"
TABLE=$(aws cloudformation describe-stack-resources --stack-name "$STACK" --logical-resource-id GameTable \
  --query 'StackResources[0].PhysicalResourceId' --output text)
WORK=$(mktemp -d)
ARCHIVE_ID=""
SNAPSHOT_ID=""
SET_MAY_EXIST=0
MEDIA_MAY_EXIST=0
ADMIN='{"groups":"admins","userId":"archive-drill","username":"archive-drill"}'
FAILED=0

# invoke <function-suffix> <event-json>: prints the response body. Returns 1, saying why, when
# the call fails, when the handler throws, or when it answers anything but 200. The output file
# is removed first, because the CLI leaves it untouched on an error, and a stale reply must
# never read as this call's answer.
invoke() {
  local out="$WORK/response.json" status
  rm -f "$out"
  if ! aws lambda invoke --function-name "${STACK}-$1" --cli-binary-format raw-in-base64-out --payload "$2" "$out" >/dev/null; then
    echo "  FAIL - could not invoke ${STACK}-$1 (the AWS error is above)" >&2
    return 1
  fi
  status=$(jq -r '.statusCode // "none"' "$out" 2>/dev/null) || status="unreadable"
  if [ "$status" != "200" ]; then
    echo "  FAIL - ${STACK}-$1 answered ${status}: $(cat "$out")" >&2
    return 1
  fi
  jq -r '.body' "$out"
}
die() { echo "drill FAILED on $STACK: $*"; exit 1; }
expect() { if [ "$2" = "$3" ]; then echo "  ok   - $1"; else echo "  FAIL - $1: expected $3, got $2"; FAILED=1; fi; }

delete_set_event() {
  jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
    '{requestContext:{routeKey:"DELETE /admin/question-sets/{setId}",authorizer:{lambda:$a}},pathParameters:{setId:$id}}'
}
delete_archive_event() {
  jq -nc --arg id "$ARCHIVE_ID" --argjson a "$ADMIN" \
    '{requestContext:{routeKey:"DELETE /admin/archive/items/{archiveId}",authorizer:{lambda:$a}},pathParameters:{archiveId:$id}}'
}
# Deletes the set. Succeeds when it is gone: removed now (200) or already absent (404).
remove_set() {
  local out="$WORK/delete-set.json" status
  rm -f "$out"
  aws lambda invoke --function-name "${STACK}-admin-delete-question-set" --cli-binary-format raw-in-base64-out \
    --payload "$(delete_set_event)" "$out" >/dev/null || return 1
  status=$(jq -r '.statusCode // "none"' "$out" 2>/dev/null) || return 1
  [ "$status" = "200" ] || [ "$status" = "404" ]
}
# The drill's copied images in the archive: under its snapshot when export named one, otherwise
# found by the set id, which no other set carries. Prints the keys, or None.
media_keys() {
  if [ -n "$SNAPSHOT_ID" ]; then
    aws s3api list-objects-v2 --bucket "$ARCHIVE_BUCKET" --prefix "archive/media/${SNAPSHOT_ID}/" \
      --query 'Contents[].Key' --output text
  else
    aws s3api list-objects-v2 --bucket "$ARCHIVE_BUCKET" --prefix "archive/media/" \
      --query "Contents[?contains(Key, '/sets/${SET_ID}/')].Key" --output text
  fi
}
remove_media() {
  local keys key
  keys=$(media_keys) || return 1
  if [ -z "$keys" ] || [ "$keys" = "None" ]; then return 0; fi
  for key in $keys; do
    aws s3 rm "s3://${ARCHIVE_BUCKET}/${key}" >/dev/null || return 1
  done
}
# content_rows <partition>: how many rows the partition still holds.
content_rows() {
  aws dynamodb query --table-name "$TABLE" --key-condition-expression 'PK = :pk' \
    --expression-attribute-values "{\":pk\":{\"S\":\"$1\"}}" --select COUNT --query Count --output text
}
cleanup() {
  set +e
  if [ "$SET_MAY_EXIST" = 1 ]; then
    remove_set || echo "  LEFT BEHIND - set ${SET_ID} on ${STACK} (delete it from the admin screen)"
    aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null \
      || echo "  LEFT BEHIND - s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png"
  fi
  if [ -n "$ARCHIVE_ID" ]; then
    invoke admin-archive-items "$(delete_archive_event)" >/dev/null \
      || echo "  LEFT BEHIND - archive item ${ARCHIVE_ID} (delete it from the admin screen)"
  fi
  if [ "$MEDIA_MAY_EXIST" = 1 ]; then
    remove_media || echo "  LEFT BEHIND - copied images for ${SET_ID} under s3://${ARCHIVE_BUCKET}/archive/media/"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "archive drill on $STACK, set $SET_ID"

echo "1. create an inactive Engage set with one uploaded image"
SET_MAY_EXIST=1
node -e "process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=','base64'))" > "$WORK/drill.png" \
  || die "the test image could not be written"
aws s3 cp "$WORK/drill.png" "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" --content-type image/png >/dev/null \
  || die "the image could not be uploaded"
CSV=$'Category,Title,Detail,Image\nDrill One,First drill question,Detail one,drill.png\nDrill One,Second drill question,Detail two,\nDrill Two,Third drill question,Detail three,'
invoke admin-upload-questions "$(jq -nc --arg id "$SET_ID" --arg csv "$CSV" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({fileName:($id+".csv"),fileContent:$csv,customTitle:$id,scope:"platform",startInactive:true}|tojson)}')" >/dev/null \
  || die "the set could not be created"
echo "  ok   - created"

echo "2. back it up"
MEDIA_MAY_EXIST=1
EXPORT=$(invoke admin-export-to-archive "$(jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[{scope:"platform",id:$id}],exportType:"questionsets"}|tojson)}')") \
  || die "the export call failed"
ARCHIVE_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].archiveId // empty') || die "the export's reply is not JSON: $EXPORT"
SNAPSHOT_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].snapshotId // empty') || die "the export's reply is not JSON: $EXPORT"
if [ -z "$ARCHIVE_ID" ]; then die "nothing was archived: $(echo "$EXPORT" | jq -c '.results.failed')"; fi
expect "archived with its image" "$(echo "$EXPORT" | jq -r '.results.successful[0].media.copied')" "1"

echo "3. lose it: delete the set and its image"
invoke admin-delete-question-set "$(delete_set_event)" >/dev/null || die "the set could not be deleted"
aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null || die "the image could not be deleted"
expect "the set is gone" "$(aws dynamodb get-item --table-name "$TABLE" --key "{\"PK\":{\"S\":\"SETS\"},\"SK\":{\"S\":\"SET#${SET_ID}\"}}" --query 'Item.SK.S' --output text)" "None"

echo "4. restore it"
IMPORT=$(invoke admin-import-from-archive "$(jq -nc --arg arc "$ARCHIVE_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[$arc]}|tojson)}')") \
  || die "the import call failed"
expect "restored under its original id" "$(echo "$IMPORT" | jq -r '.results.successful[0].id')" "$SET_ID"
expect "recreated rather than versioned" "$(echo "$IMPORT" | jq -r '.results.successful[0].mode')" "created"
expect "written as version 1, the partition counted below" "$(echo "$IMPORT" | jq -r '.results.successful[0].version')" "1"
expect "still inactive" "$(echo "$IMPORT" | jq -r '.results.successful[0].active')" "false"
expect "its image came back" "$(echo "$IMPORT" | jq -r '.media.copied')" "1"
META=$(aws dynamodb get-item --table-name "$TABLE" --key "{\"PK\":{\"S\":\"SETS\"},\"SK\":{\"S\":\"SET#${SET_ID}\"}}" --output json) \
  || die "the restored set's row could not be read"
expect "listed in Engage's library again, on version 1" "$(echo "$META" | jq -r '.Item.activeVersion.N // "missing"')" "1"
# Not `// "missing"`: jq's alternative operator replaces false as well as null, so it could
# never print false. An absent flag prints null, which fails the comparison too.
expect "and inactive there" "$(echo "$META" | jq -r '.Item.active.BOOL')" "false"
ROWS=$(content_rows "SET#${SET_ID}#v1") || die "the restored rows could not be counted"
expect "all five content rows are back (2 categories, 3 questions)" "$ROWS" "5"
if aws s3api head-object --bucket "$MEDIA_BUCKET" --key "sets/${SET_ID}/drill.png" >/dev/null; then
  echo "  ok   - the image object exists again"
else
  echo "  FAIL - the image object is missing (any AWS error is above)"; FAILED=1
fi

echo "5. remove everything the drill made, through the same routes, and check it is gone"
invoke admin-archive-items "$(delete_archive_event)" >/dev/null \
  || die "the backup could not be deleted through ${STACK}-admin-archive-items"
ARCHIVE_ID=""
echo "  ok   - the backup is deleted through the relay"
remove_media || die "the backup's copied images could not be removed"
expect "no copied image is left in the archive" "$(media_keys)" "None"
MEDIA_MAY_EXIST=0
remove_set || die "the restored set could not be deleted"
expect "no content rows are left" "$(content_rows "SET#${SET_ID}")+$(content_rows "SET#${SET_ID}#v1")" "0+0"
aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null || die "the restored image could not be removed"
SET_MAY_EXIST=0
echo "  ok   - the set and its image are removed"

if [ "$FAILED" -eq 0 ]; then echo "drill passed on $STACK"; else echo "drill FAILED on $STACK"; exit 1; fi
