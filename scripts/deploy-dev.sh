#!/usr/bin/env bash
#
# Deploy the Engagements backend (SAM stack) to the development environment.
#
# Usage:
#   scripts/deploy-dev.sh                 # deploy using samconfig-dev.toml
#   AWS_PROFILE=myprofile scripts/deploy-dev.sh
#   scripts/deploy-dev.sh --guided        # extra args are passed through to `sam deploy`
#
# Configuration lives in samconfig-dev.toml (stack name, region, S3 bucket, and
# the DomainName / HostedZoneId parameter overrides). This script reads the stack
# name from there rather than repeating it, so the two cannot drift.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

TEMPLATE_FILE="template-dev.yaml"
CONFIG_FILE="samconfig-dev.toml"

# AWS profile is overridable; "adfs" is the historical default for this account.
export AWS_PROFILE="${AWS_PROFILE:-adfs}"

for f in "$TEMPLATE_FILE" "$CONFIG_FILE"; do
    if [ ! -f "$f" ]; then
        echo "❌ Error: $f not found in $PROJECT_ROOT" >&2
        exit 1
    fi
done

# Single source of truth for the stack name: samconfig-dev.toml. Reading it here
# is what keeps `sam deploy` and the describe-stacks calls below in agreement.
# They previously disagreed ("engagements-v1" in the config vs "quiz-game-dev"
# hardcoded here), so every output lookup silently failed and the script printed
# "Unable to fetch API URL" on an otherwise successful deploy.
STACK_NAME="$(grep -E '^\s*stack_name\s*=' "$CONFIG_FILE" | head -1 | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
REGION="$(grep -E '^\s*region\s*=' "$CONFIG_FILE" | head -1 | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
REGION="${REGION:-us-east-1}"

if [ -z "$STACK_NAME" ]; then
    echo "❌ Error: could not read stack_name from $CONFIG_FILE" >&2
    exit 1
fi

echo "🚀 Deploying Engagements backend"
echo "   stack:   $STACK_NAME"
echo "   region:  $REGION"
echo "   profile: $AWS_PROFILE"
echo

# Catch template defects before handing 4,000 lines to CloudFormation. --lint is
# what surfaces duplicate resource keys and end-of-life Lambda runtimes; plain
# `sam validate` does not. Findings are reported but do not block the deploy.
echo "🔍 Validating template..."
if ! sam validate --template-file "$TEMPLATE_FILE" --region "$REGION" --lint; then
    echo "⚠️  Template lint reported findings (see above). Deploying anyway."
fi
echo

echo "☁️  Running sam deploy..."
sam deploy \
    --template-file "$TEMPLATE_FILE" \
    --config-file "$CONFIG_FILE" \
    "$@"

echo
echo "✅ Backend deployment complete."

# Read endpoints back from the stack so the printed values are the deployed ones.
get_output() {
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

echo "🌐 API:       $(get_output ApiUrl)"
echo "🔌 WebSocket: $(get_output WebSocketUrl)"
echo "🌐 Website:   $(get_output WebsiteUrl)"
echo
echo "🔧 Next step: scripts/deploy-frontend-dev.sh"
