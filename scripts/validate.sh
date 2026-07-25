#!/usr/bin/env bash
#
# Pre-deploy checks for the Engagements repo. Safe to run without AWS
# credentials — nothing here calls a live account.
#
# Usage:
#   scripts/validate.sh              # report findings, fail only on errors
#   STRICT=1 scripts/validate.sh     # also fail on warnings (EOL runtimes, etc.)
#
# Checks:
#   1. Template parses and every resource key is unique.
#      A duplicate key is NOT a YAML error — the parser keeps the last one and
#      silently discards the earlier definition. This repo shipped two
#      GetAISummaryFunction blocks for exactly this reason.
#   2. cfn-lint via `sam validate --lint` (duplicate keys, EOL Lambda runtimes,
#      malformed intrinsics). Plain `sam validate` catches none of these.
#   3. Inline Lambda code parses as JavaScript.
#      ~3,700 lines of JS live inside the template as InlineCode, where no
#      linter or test runner can see it. A syntax error there is only
#      discovered at Lambda cold start, in production.
#   4. Every function's runtime can actually load the AWS SDK it requires.
#      aws-sdk v2 is bundled in nodejs16.x but NOT in nodejs18.x or later;
#      `require('aws-sdk')` on a newer runtime throws at cold start.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Note: this script runs without `set -e` so it can collect every finding
# instead of stopping at the first, which makes an unguarded `cd` genuinely
# unsafe here.
cd "$PROJECT_ROOT" || exit 1

TEMPLATE_FILE="${TEMPLATE_FILE:-template-dev.yaml}"
REGION="${AWS_REGION:-us-east-1}"
STRICT="${STRICT:-0}"

errors=0
warnings=0

section() { echo; echo "── $1"; }
fail()    { echo "  ❌ $1"; errors=$((errors + 1)); }
warn()    { echo "  ⚠️  $1"; warnings=$((warnings + 1)); }
pass()    { echo "  ✅ $1"; }

echo "Validating $TEMPLATE_FILE"

# ---------------------------------------------------------------------------
section "1. Unique resource keys"
# ---------------------------------------------------------------------------
dupes="$(grep -nE '^  [A-Za-z0-9]+:[[:space:]]*$' "$TEMPLATE_FILE" \
    | sed -E 's/^([0-9]+):[[:space:]]*([A-Za-z0-9]+):.*/\2 \1/' \
    | awk '{ names[$1] = names[$1] " " $2; count[$1]++ }
           END { for (n in count) if (count[n] > 1) print n ":" names[n] }')"

if [ -n "$dupes" ]; then
    while IFS= read -r line; do
        fail "duplicate resource '${line%%:*}' at lines${line#*:} — only the last survives"
    done <<< "$dupes"
else
    pass "no duplicate resource keys"
fi

# ---------------------------------------------------------------------------
section "2. cfn-lint (via sam validate --lint)"
# ---------------------------------------------------------------------------
if command -v sam >/dev/null 2>&1; then
    lint_out="$(SAM_CLI_TELEMETRY=0 sam validate \
        --template-file "$TEMPLATE_FILE" --region "$REGION" --lint 2>&1)"

    eol_count="$(grep -o 'W2531' <<< "$lint_out" | wc -l | tr -d ' ')"
    other="$(tr ',' '\n' <<< "$lint_out" | grep -oE '\b[EW][0-9]{4}\b' | grep -v W2531 | sort -u)"

    if [ "$eol_count" -gt 0 ]; then
        warn "$eol_count function(s) on an end-of-life Lambda runtime (W2531) — see docs/AWS_DEPLOYMENT.md"
    fi
    if [ -n "$other" ]; then
        while IFS= read -r rule; do
            case "$rule" in
                E*) fail "cfn-lint $rule — run 'sam validate --lint' for detail" ;;
                W*) warn "cfn-lint $rule — run 'sam validate --lint' for detail" ;;
            esac
        done <<< "$other"
    fi
    [ "$eol_count" -eq 0 ] && [ -z "$other" ] && pass "cfn-lint clean"
else
    warn "sam CLI not found — skipped"
fi

# ---------------------------------------------------------------------------
section "3. Inline Lambda code parses / 4. runtime vs AWS SDK version"
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    python3 - "$TEMPLATE_FILE" > /tmp/engagements-inline-report.txt <<'PY'
import re, subprocess, sys, tempfile, os, json

path = sys.argv[1]
lines = open(path).read().split('\n')

# Split the Resources block into top-level resource chunks.
resources, cur, buf, start = [], None, [], 0
for i, l in enumerate(lines):
    m = re.match(r'^  ([A-Za-z0-9]+):\s*$', l)
    if m:
        if cur:
            resources.append((cur, start, buf))
        cur, buf, start = m.group(1), [], i + 1
    if cur:
        buf.append(l)
if cur:
    resources.append((cur, start, buf))

# Runtimes that no longer bundle AWS SDK for JavaScript v2.
NO_SDK_V2 = re.compile(r'nodejs(18|20|22|24)\.x')

report = {"syntax": [], "sdk": [], "checked": 0}
global_rt = None
gm = re.search(r'^Globals:.*?^\s+Runtime:\s*(\S+)', '\n'.join(lines), re.S | re.M)
if gm:
    global_rt = gm.group(1)

for name, start, body in resources:
    text = '\n'.join(body)
    if 'InlineCode:' not in text:
        continue
    report["checked"] += 1

    rt_m = re.search(r'^\s+Runtime:\s*(\S+)\s*$', text, re.M)
    runtime = rt_m.group(1) if rt_m else (global_rt or 'unknown')

    # Extract the InlineCode block by indentation.
    idx = next(i for i, l in enumerate(body) if 'InlineCode:' in l)
    indent = len(body[idx]) - len(body[idx].lstrip())
    code = []
    for l in body[idx + 1:]:
        if l.strip() and (len(l) - len(l.lstrip())) <= indent:
            break
        code.append(l[indent + 2:] if len(l) > indent + 2 else '')
    src = '\n'.join(code)

    if "require('aws-sdk')" in src and NO_SDK_V2.search(runtime):
        report["sdk"].append({"fn": name, "runtime": runtime})

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(src)
        tmp = f.name
    try:
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        if r.returncode != 0:
            # node --check prints "<tmpfile>:<line>" then the offending source
            # then the actual "SyntaxError: ...". Report the diagnosis plus the
            # line number, translated back to the template's own numbering.
            err = r.stderr.strip().split('\n')
            msg = next((l for l in err if 'Error:' in l), err[0] if err else 'parse failed')
            lineno = ''
            if err and ':' in err[0]:
                tail = err[0].rsplit(':', 1)[-1]
                if tail.isdigit():
                    lineno = f" (template line ~{start + idx + int(tail)})"
            report["syntax"].append({"fn": name, "error": msg.strip() + lineno})
    finally:
        os.unlink(tmp)

print(json.dumps(report))
PY
    rep="$(cat /tmp/engagements-inline-report.txt)"
    checked="$(python3 -c "import json,sys;print(json.load(sys.stdin)['checked'])" <<< "$rep")"
    n_syntax="$(python3 -c "import json,sys;print(len(json.load(sys.stdin)['syntax']))" <<< "$rep")"
    n_sdk="$(python3 -c "import json,sys;print(len(json.load(sys.stdin)['sdk']))" <<< "$rep")"

    if [ "$n_syntax" -gt 0 ]; then
        python3 -c "
import json,sys
for e in json.load(sys.stdin)['syntax']:
    print(f\"  ❌ {e['fn']}: {e['error']}\")
" <<< "$rep"
        errors=$((errors + n_syntax))
    else
        pass "$checked inline handler(s) parse as valid JavaScript"
    fi

    if [ "$n_sdk" -gt 0 ]; then
        python3 -c "
import json,sys
for e in json.load(sys.stdin)['sdk']:
    print(f\"  ❌ {e['fn']}: requires aws-sdk v2 but runs on {e['runtime']}, which does not bundle it\")
" <<< "$rep"
        errors=$((errors + n_sdk))
    else
        pass "no function requires aws-sdk v2 on a runtime that lacks it"
    fi
    rm -f /tmp/engagements-inline-report.txt
else
    warn "node not found — skipped inline JavaScript checks"
fi

# ---------------------------------------------------------------------------
section "5. Deploy scripts agree with samconfig"
# ---------------------------------------------------------------------------
if [ -f samconfig-dev.toml ]; then
    cfg_stack="$(grep -E '^\s*stack_name\s*=' samconfig-dev.toml | head -1 | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
    bad=0
    # Any literal stack name in a deploy script is drift waiting to happen; the
    # scripts should read it from samconfig. Skip this file, whose own detection
    # pattern would otherwise match itself.
    for f in scripts/*.sh; do
        [ "$(basename "$f")" = "validate.sh" ] && continue
        while IFS= read -r s; do
            [ -z "$s" ] && continue
            if [ "$s" != "$cfg_stack" ]; then
                fail "$(basename "$f") hardcodes stack '$s' but samconfig deploys '$cfg_stack'"
            else
                warn "$(basename "$f") hardcodes stack '$s'; read it from samconfig instead"
            fi
            bad=1
        done < <(grep -hoE '(STACK_NAME=|--stack-name )"?[A-Za-z][A-Za-z0-9-]*"?' "$f" 2>/dev/null \
                 | sed -E 's/^(STACK_NAME=|--stack-name )"?//; s/"?$//')
    done
    [ "$bad" -eq 0 ] && pass "no hardcoded stack names (samconfig: $cfg_stack)"
fi

# ---------------------------------------------------------------------------
echo
echo "──────────────────────────────────────────"
echo "  $errors error(s), $warnings warning(s)"
echo "──────────────────────────────────────────"

if [ "$errors" -gt 0 ]; then
    exit 1
fi
if [ "$STRICT" = "1" ] && [ "$warnings" -gt 0 ]; then
    echo "STRICT=1 — failing on warnings."
    exit 1
fi
exit 0
