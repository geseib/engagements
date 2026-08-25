#!/usr/bin/env bash
#
# WHICH LIBRARY IS EACH QUESTION SET ACTUALLY IN?
#
#   ./scripts/audit-set-scopes.sh engagetest adminaccess
#
# Two questions, one query each, and neither can be answered by looking at the
# screen.
#
# 1. DID THE TENANCY FIX TAKE? A generation used to be written into Engage's
#    shared PLATFORM library whatever organisation asked for it — the worker's
#    synthetic event carried a user id and no org, and `createSetRef` reads
#    "no groups and no org" as an internal invocation and routes those to
#    platform. So a customer's set landed somewhere every other customer could
#    read. A set generated AFTER the fix must appear under `ORG#<id>#SETS`.
#
#    The UI cannot prove this. A set in the wrong library still renders, still
#    opens, still plays; the only visible symptom was a badge reading "Engage",
#    and a badge is exactly the kind of thing that can be right for the wrong
#    reason. The partition is the fact.
#
# 2. HOW MUCH IS ALREADY MISFILED? The fix is forward-only. Every set generated
#    before it is still sitting in the platform partition, readable by every
#    organisation on the tier, and nothing moves it. This lists them so the
#    cleanup is a known quantity rather than a worry.
#
# READ-ONLY. It queries and scans; it writes nothing and deletes nothing. What
# to do about anything it finds is a decision, not a script.
#
# A NOTE ON WHAT YOU WILL SEE: org-scoped set content is ENCRYPTED per
# organisation (admin/shared/tenant-crypto.js), so names and descriptions on
# ORG# rows come back as ciphertext. That is correct and not a fault. Platform
# rows are deliberately not encrypted — they are the shared library — which is
# why their names are readable here.

set -euo pipefail

STACK="${1:-}"
PROFILE="${2:-${AWS_PROFILE:-}}"

if [[ -z "$STACK" ]]; then
  cat >&2 <<'USAGE'
usage: ./scripts/audit-set-scopes.sh <stack> [aws-profile]

  stacks:   engagedev | engagetest | engageprod   (read-only, so prod is allowed)
  profile:  optional; falls back to $AWS_PROFILE, then your default profile

example:
  ./scripts/audit-set-scopes.sh engagetest adminaccess
USAGE
  exit 2
fi

[[ -n "$PROFILE" ]] && export AWS_PROFILE="$PROFILE"

if ! IDENTITY="$(aws sts get-caller-identity --output text --query '[Account,Arn]' 2>&1)"; then
  echo "Could not use ${AWS_PROFILE:-your default} AWS credentials." >&2
  echo "  $IDENTITY" >&2
  [[ -n "${AWS_PROFILE:-}" ]] && echo "  Try: aws sso login --profile $AWS_PROFILE" >&2
  exit 1
fi
ACCOUNT="${IDENTITY%%$'\t'*}"

if ! TABLE="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`GameTableName`].OutputValue' \
    --output text 2>&1)"; then
  echo "Could not read stack '$STACK' in account $ACCOUNT." >&2
  echo "  $TABLE" >&2
  exit 1
fi
[[ -z "$TABLE" || "$TABLE" == "None" ]] && TABLE="$STACK"   # TableName: !Ref StackName

echo "account $ACCOUNT · stack $STACK · table $TABLE"
echo

# ── 1. THE SHARED LIBRARY ───────────────────────────────────────────────────
# One Query, because platform metadata lives in a single partition: PK 'SETS'.
PLATFORM_JSON="$(aws dynamodb query --table-name "$TABLE" \
  --key-condition-expression 'PK = :pk AND begins_with(SK, :sk)' \
  --expression-attribute-values '{":pk":{"S":"SETS"},":sk":{"S":"SET#"}}' \
  --output json)"

# ── 2. EVERY ORGANISATION'S LIBRARY ─────────────────────────────────────────
# A Scan, because each org is its own partition and there is no index across
# them. Fine on dev and test; on a large prod table this is the expensive call
# in this script and the only one.
ORG_JSON="$(aws dynamodb scan --table-name "$TABLE" \
  --filter-expression 'begins_with(PK, :org) AND begins_with(SK, :sk)' \
  --expression-attribute-values '{":org":{"S":"ORG#"},":sk":{"S":"SET#"}}' \
  --output json)"

PLATFORM_JSON="$PLATFORM_JSON" ORG_JSON="$ORG_JSON" python3 <<'PY'
import json, os, re

def rows(blob):
    # A readable failure beats a traceback: if the CLI ever answers with
    # something that is not JSON, say which call and show the head of it.
    try:
        return json.loads(blob).get("Items", [])
    except json.JSONDecodeError:
        raise SystemExit(
            "A DynamoDB call did not return JSON. First 200 characters:\n  "
            + blob[:200].replace("\n", "\n  ")
        )

def val(item, key, default=""):
    cell = item.get(key)
    if not cell:
        return default
    for t in ("S", "N"):
        if t in cell:
            return cell[t]
    if "BOOL" in cell:
        return cell["BOOL"]
    return default

plat = rows(os.environ["PLATFORM_JSON"])
orgs = rows(os.environ["ORG_JSON"])

print(f"ENGAGE'S SHARED LIBRARY (PK=SETS) — {len(plat)} set(s)")
print("  Every organisation on this tier can read these.")
suspect = []
for it in sorted(plat, key=lambda i: val(i, "SK")):
    set_id = val(it, "SK").replace("SET#", "")
    ai = val(it, "isAIGenerated", False) is True
    who = val(it, "createdByName") or val(it, "createdBy") or "(unowned)"
    when = (val(it, "createdAt") or "")[:10]
    mark = "  ⚠" if ai else "   "
    print(f"{mark} {set_id:<28} {'AI' if ai else '  '}  {who:<22} {when}")
    if ai:
        suspect.append((set_id, who, when))

print()
by_org = {}
for it in orgs:
    by_org.setdefault(val(it, "PK"), []).append(it)

print(f"ORGANISATION LIBRARIES — {len(by_org)} org(s), {len(orgs)} set(s)")
print("  Readable only by the organisation that owns them. Names are ciphertext")
print("  here on purpose — org content is encrypted per tenant.")
for pk in sorted(by_org):
    org_id = re.sub(r"^ORG#|#SETS$", "", pk)
    print(f"   {org_id}")
    for it in sorted(by_org[pk], key=lambda i: val(i, "SK")):
        set_id = val(it, "SK").replace("SET#", "")
        ai = val(it, "isAIGenerated", False) is True
        who = val(it, "createdByName") or val(it, "createdBy") or "(unowned)"
        when = (val(it, "createdAt") or "")[:10]
        print(f"     {set_id:<26} {'AI' if ai else '  '}  {who:<22} {when}")

print()
print("─" * 72)
if not suspect:
    print("No AI-generated set is sitting in the shared library. Nothing to clean up.")
else:
    print(f"{len(suspect)} AI-generated set(s) are in the SHARED library:")
    for set_id, who, when in suspect:
        print(f"   {set_id}  (by {who}, {when})")
    print()
    print("  Judge each by WHO made it, because both answers are legitimate:")
    print("   · Engage staff acting with no organisation selected are AUTHORING the")
    print("     shared library. That is the only way platform content gets made, and")
    print("     those sets belong exactly where they are.")
    print("   · Anyone else is a MISFILE from before the tenancy fix — their set is")
    print("     readable by every other customer on this tier, and it will not move")
    print("     on its own. The fix is forward-only.")
    print()
    print("  A set generated AFTER the fix deployed should appear under an ORG# line")
    print("  above, never here. If a fresh one lands here, the fix did not take.")
PY
