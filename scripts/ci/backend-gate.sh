#!/usr/bin/env bash
# ── THE BACKEND GATE: SKIP THE LAMBDA BUNDLE + `sam deploy` WHEN NOTHING THEY READ CHANGED ──
#
# Measured on dev builds 4c71a3ad and 9bea635e (2026-10-01/02, CodeBuild MEDIUM):
# a deploy took ~27 min, of which `sam deploy` spent ~18 min zipping the same four
# CodeUri folders 119 times — and then found 115-118 of the 119 zips already in S3.
# When the backend inputs are byte-identical to the last successful deploy, all of
# that work ends in an empty changeset (`--no-fail-on-empty-changeset`). This gate
# reaches the same outcome without the 22 minutes.
#
# WHAT IS SKIPPED: the Lambda bundle (scripts/ci/bundle-lambdas.js, which
# replaced `sam build`) and `sam deploy`. Nothing else. Lint, jest, webpack,
# the S3 sync and the CloudFront invalidation run on every deploy, because the
# frontend tests read lambda-functions/, template-clean.yaml and sets/ — a
# frontend skip cannot be made safe by path, so there is none.
#
# THE FINGERPRINT is a sha256 over:
#   - every file under lambda-functions/ (node_modules excluded; it is not in the
#     source artifact and the bundler installs its own)
#   - template-clean.yaml
#   - buildspec-$ENVIRONMENT.yml   (the SAM CLI pin, the sam command lines)
#   - every file under scripts/ci/ (this script, the bundler, the esbuild pin)
#   - a sha256 of $PARAM_OVERRIDES (secrets enter the hash, never the log or SSM)
#
# SKIP ONLY WHEN ALL OF THESE HOLD — anything else, including any error, RUNS:
#   - FORCE_FULL_DEPLOY is not "true"
#   - the fingerprint was computed and is non-empty
#   - SSM /$STACK_NAME/ci/backend-fingerprint exists and its fingerprint matches
#   - the stack's status is CREATE_COMPLETE or UPDATE_COMPLETE
#   - the stack's LastUpdatedTime equals the one recorded after that deploy, so a
#     stack changed by anything other than this pipeline since then forces a run
#
# Usage (from the repo root, in the buildspec build phase):
#   bash scripts/ci/backend-gate.sh fingerprint   -> prints the fingerprint
#   bash scripts/ci/backend-gate.sh check         -> prints "skip" or "run"; exits 0
#   bash scripts/ci/backend-gate.sh record        -> stores the marker; exits 0
# `check` and `record` read BACKEND_FP, STACK_NAME and (for the log) the commit.
#
# Escape hatch: start the pipeline's build with FORCE_FULL_DEPLOY=true.
# Inspect:  aws ssm get-parameter --name /engagedev/ci/backend-fingerprint

set -u -o pipefail
cmd="${1:-}"

log() { echo "backend-gate: $*" >&2; }

if command -v sha256sum >/dev/null 2>&1; then SHA_FILES=(sha256sum); else SHA_FILES=(shasum -a 256); fi
sha() { "${SHA_FILES[@]}"; }

param_name() { echo "/${STACK_NAME}/ci/backend-fingerprint"; }

# Prints "<status> <lastUpdated>" for the stack, or nothing on any failure.
stack_state() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query 'Stacks[0].[StackStatus,LastUpdatedTime||CreationTime]' --output text 2>/dev/null
}

fingerprint() {
  local env="${ENVIRONMENT:-}" files
  [ -n "$env" ] || return 1
  for f in template-clean.yaml "buildspec-${env}.yml" scripts/ci/backend-gate.sh scripts/ci/bundle-lambdas.js; do
    [ -f "$f" ] || return 1
  done
  [ -d lambda-functions ] || return 1
  {
    printf 'backend-gate v1\n'
    printf '%s' "${PARAM_OVERRIDES:-}" | sha
    # One "<sha256>  <path>" line per file, in a fixed order: a byte moved
    # between files, a rename, an added or a deleted file all change it.
    find lambda-functions template-clean.yaml "buildspec-${env}.yml" scripts/ci \
      -type f ! -path '*/node_modules/*' -print0 \
      | LC_ALL=C sort -z | xargs -0 "${SHA_FILES[@]}"
  } | sha | cut -d' ' -f1
}

case "$cmd" in
  fingerprint)
    fp="$(fingerprint)" || fp=""
    case "$fp" in [0-9a-f]*) echo "$fp" ;; *) echo "" ;; esac
    ;;

  check)
    decide() {
      if [ "${FORCE_FULL_DEPLOY:-}" = "true" ]; then log "FORCE_FULL_DEPLOY=true"; return 1; fi
      if [ -z "${STACK_NAME:-}" ]; then log "STACK_NAME is empty"; return 1; fi
      if ! printf '%s' "${BACKEND_FP:-}" | grep -qE '^[0-9a-f]{64}$'; then
        log "no fingerprint was computed"; return 1
      fi
      local marker stored_fp stored_updated stored_commit state status updated
      marker="$(aws ssm get-parameter --name "$(param_name)" --query 'Parameter.Value' --output text 2>/dev/null)" \
        || { log "no marker at $(param_name) (first gated deploy, or SSM unreadable)"; return 1; }
      read -r stored_fp stored_updated stored_commit <<<"$marker"
      if [ "$stored_fp" != "$BACKEND_FP" ]; then
        log "backend inputs changed since ${stored_commit:-the last recorded deploy}"; return 1
      fi
      state="$(stack_state)"
      read -r status updated <<<"$state"
      case "$status" in
        CREATE_COMPLETE|UPDATE_COMPLETE) ;;
        *) log "stack status is '${status:-unknown}', not a clean *_COMPLETE"; return 1 ;;
      esac
      if [ -z "$updated" ] || [ "$updated" != "$stored_updated" ]; then
        log "stack was updated at '${updated:-unknown}' by something other than the recorded deploy ('${stored_updated}')"
        return 1
      fi
      log "backend inputs identical to ${stored_commit:-the last recorded deploy}; stack unchanged since (${updated})"
      return 0
    }
    if decide; then echo skip; else echo run; fi
    ;;

  record)
    if ! printf '%s' "${BACKEND_FP:-}" | grep -qE '^[0-9a-f]{64}$' || [ -z "${STACK_NAME:-}" ]; then
      log "not recording: no fingerprint or no stack name (next deploy runs in full)"; exit 0
    fi
    read -r status updated <<<"$(stack_state)"
    case "$status" in
      CREATE_COMPLETE|UPDATE_COMPLETE) ;;
      *) log "not recording: stack status '${status:-unknown}'"; exit 0 ;;
    esac
    commit="${CODEBUILD_RESOLVED_SOURCE_VERSION:-unknown}"
    if aws ssm put-parameter --name "$(param_name)" --type String --overwrite \
         --value "$BACKEND_FP $updated ${commit:0:12}" >/dev/null 2>&1; then
      log "recorded $(param_name) for ${commit:0:12} (stack updated ${updated})"
    else
      log "WARNING: could not write $(param_name); the next deploy runs in full"
    fi
    exit 0
    ;;

  *)
    echo "usage: backend-gate.sh fingerprint|check|record" >&2
    exit 2
    ;;
esac
