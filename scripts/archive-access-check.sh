#!/bin/bash
# DOES EVERY TIER STILL REACH THE SHARED ARCHIVE?
#
#   scripts/archive-access-check.sh preflight [stack...]   before the archive is locked
#   scripts/archive-access-check.sh verify    [stack...]   after it is locked
#
# The archive (engage2-archive-service) is one service behind dev, test and prod. Once its
# routes require AWS_IAM, a tier whose functions do not sign, or whose roles may not invoke,
# loses its backups and its restores at the same moment. This proves, per tier:
#
#   preflight  each archive function names the execute-api URL, IAM simulation allows the
#              calls it makes, and the tier's relay lists the archive
#   verify     all of that, plus: every archive route requires AWS_IAM, and an UNSIGNED
#              request is refused
#
# Before the lock, the relay's list proves the URL, the route and the grant, but not the
# signature, because an unlocked archive answers unsigned requests too. After the lock,
# verify's list is the proof that each tier signs.
#
# Every failure is reported and counted, and the run always ends with its summary. Read-only,
# apart from one Lambda invocation per tier that LISTS the archive.
# scripts/deploy-archive.sh runs `preflight` before `preview` and `lock`, `verify` after `lock` deploys, and `preflight` after `unlock` deploys.
# tests/archive-infrastructure.js keeps TIERS and FUNCTIONS in step with the template, and
# tests/archive-scripts.js runs this script against a stubbed aws and curl.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
if [ "$#" -gt 0 ]; then shift; fi
TIERS=(engagedev engagetest engageprod)
if [ "$#" -gt 0 ]; then TIERS=("$@"); fi
FUNCTIONS=(admin-export-to-archive admin-import-from-archive admin-archive-items)
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"
export AWS_REGION="us-east-1"

case "$MODE" in
  preflight|verify) ;;
  *) echo "usage: $0 preflight|verify [stack...]" >&2; exit 2 ;;
esac

API_ID=$(node -p "new URL(require('./config/archive-service.json').archiveApiUrl).hostname.split('.')[0]")
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
FAILURES=0
ok() { echo "  ok   - $*"; }
fail() { echo "  FAIL - $*"; FAILURES=$((FAILURES + 1)); }

# The archive routes each function calls, as METHOD/path. A function with no entry fails.
calls_for() {
  case "$1" in
    admin-export-to-archive) echo "POST/archive/items" ;;
    admin-import-from-archive) echo "GET/archive/items/probe" ;;
    admin-archive-items) echo "GET/archive/items GET/archive/items/probe POST/archive/search DELETE/archive/items/probe" ;;
    *) return 1 ;;
  esac
}

check_tier() {
  local stack="$1" fn name conf url role calls call decision out status
  echo "$stack"
  for fn in "${FUNCTIONS[@]}"; do
    name="${stack}-${fn}"
    # The AWS error stays on stderr: an expired token must not read as a missing function.
    if ! conf=$(aws lambda get-function-configuration --function-name "$name" --output json); then
      fail "could not read $name (the AWS error is above; a tier that has not deployed the signed archive client has no such function)"
      continue
    fi
    url=$(echo "$conf" | jq -r '.Environment.Variables.ARCHIVE_SERVICE_URL // ""')
    if [ "$url" = "$URL" ]; then ok "$fn calls $URL"; else fail "$fn calls '${url}', not $URL"; fi
    role=$(echo "$conf" | jq -r '.Role')
    if ! calls=$(calls_for "$fn"); then
      fail "$fn has no entry in calls_for, so nothing checks what it may invoke"
      continue
    fi
    for call in $calls; do
      decision=$(aws iam simulate-principal-policy --policy-source-arn "$role" --action-names execute-api:Invoke \
        --resource-arns "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT}:${API_ID}/\$default/${call}" \
        --query 'EvaluationResults[0].EvalDecision' --output text) \
        || decision="the simulation call failed; the AWS error is above"
      if [ "$decision" = "allowed" ]; then ok "$fn may invoke $call"; else fail "$fn may not invoke $call ($decision)"; fi
    done
  done
  out=$(mktemp)
  if aws lambda invoke --function-name "${stack}-admin-archive-items" --cli-binary-format raw-in-base64-out \
      --payload '{"requestContext":{"routeKey":"GET /admin/archive/items","authorizer":{"lambda":{"groups":"admins","userId":"archive-access-check"}}}}' \
      "$out" >/dev/null; then
    status=$(jq -r '.statusCode // "none"' "$out" 2>/dev/null) || status="unreadable"
    if [ "$status" = "200" ]; then
      ok "$stack's relay lists the archive ($(jq -r '.body | fromjson | (.count // (.items | length))' "$out") items)"
    elif [ "$status" = "none" ] || [ "$status" = "unreadable" ]; then
      fail "$stack's relay failed without answering: $(cat "$out")"
    else
      fail "$stack's relay answered $status: $(jq -r '.body' "$out")"
    fi
  else
    fail "could not invoke ${stack}-admin-archive-items (the AWS error is above)"
  fi
  rm -f "$out"
}

for stack in "${TIERS[@]}"; do check_tier "$stack"; done

if [ "$MODE" = "verify" ]; then
  echo "strangers"
  # Every route, not one: PUT /archive/items/{archiveId} is called by no tier, so no signed
  # check would notice it left open.
  if routes=$(aws apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[].[RouteKey,AuthorizationType]' --output text); then
    if [ -z "$routes" ] || [ "$routes" = "None" ]; then
      fail "the archive API lists no routes"
    else
      while IFS=$'\t' read -r key auth; do
        if [ -z "$key" ]; then continue; fi
        if [ "$auth" = "AWS_IAM" ]; then ok "$key requires AWS_IAM"; else fail "$key is not locked (authorization: ${auth:-none})"; fi
      done <<< "$routes"
    fi
  else
    fail "could not list the archive API's routes (the AWS error is above)"
  fi
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "${URL}/archive/items") || code="no answer (curl exit $?)"
  if [ "$code" = "403" ]; then ok "an unsigned request is refused (403)"; else fail "an unsigned request answered $code — the archive is not locked"; fi
fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "all checks passed"; else echo "${FAILURES} check(s) failed"; exit 1; fi
