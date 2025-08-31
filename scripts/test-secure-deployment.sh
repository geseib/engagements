#!/bin/bash

# Test Script for Secure GitHub Token Integration
# Validates that secrets are properly configured and accessible

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}    Secure Deployment Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✅ PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[❌ FAIL]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

test_count=0
pass_count=0
fail_count=0

run_test() {
    local test_name="$1"
    local command="$2"
    
    test_count=$((test_count + 1))
    print_test "$test_name"
    
    if eval "$command" > /dev/null 2>&1; then
        print_success "$test_name"
        pass_count=$((pass_count + 1))
        return 0
    else
        print_fail "$test_name"
        fail_count=$((fail_count + 1))
        return 1
    fi
}

print_header

print_info "Testing secure GitHub token configuration..."
echo ""

# Test 1: AWS CLI is configured
run_test "AWS CLI Configuration" "aws sts get-caller-identity"

# Test 2: Test environment secret exists
run_test "Test Environment Secret Exists" "aws secretsmanager describe-secret --secret-id engage/test/github-token"

# Test 3: Prod environment secret exists
run_test "Prod Environment Secret Exists" "aws secretsmanager describe-secret --secret-id engage/prod/github-token"

# Test 4: Test secret is retrievable
run_test "Test Secret Retrievable" "aws secretsmanager get-secret-value --secret-id engage/test/github-token --query SecretString"

# Test 5: Prod secret is retrievable
run_test "Prod Secret Retrievable" "aws secretsmanager get-secret-value --secret-id engage/prod/github-token --query SecretString"

# Test 6: Token format validation for test
print_test "Test Token Format Validation"
TEST_TOKEN=$(aws secretsmanager get-secret-value --secret-id engage/test/github-token --query SecretString --output text 2>/dev/null | jq -r .GITHUB_TOKEN 2>/dev/null || echo "")
if [[ "$TEST_TOKEN" =~ ^(ghp_|github_pat_) ]]; then
    print_success "Test Token Format Validation"
    pass_count=$((pass_count + 1))
else
    print_fail "Test Token Format Validation (token doesn't match expected format)"
    fail_count=$((fail_count + 1))
fi
test_count=$((test_count + 1))

# Test 7: Token format validation for prod
print_test "Prod Token Format Validation"
PROD_TOKEN=$(aws secretsmanager get-secret-value --secret-id engage/prod/github-token --query SecretString --output text 2>/dev/null | jq -r .GITHUB_TOKEN 2>/dev/null || echo "")
if [[ "$PROD_TOKEN" =~ ^(ghp_|github_pat_) ]]; then
    print_success "Prod Token Format Validation"
    pass_count=$((pass_count + 1))
else
    print_fail "Prod Token Format Validation (token doesn't match expected format)"
    fail_count=$((fail_count + 1))
fi
test_count=$((test_count + 1))

# Test 8: CodeBuild role exists
run_test "CodeBuild Service Role Exists" "aws iam get-role --role-name engagecicd-codebuild"

# Test 9: CodeBuild role has secrets access (check for our new policy)
run_test "CodeBuild Has Secrets Policy" "aws iam list-role-policies --role-name engagecicd-codebuild | grep -E '(EngageSecretsAccess|SecretsManager)'"

# Test 10: CI/CD Stack exists
run_test "CI/CD Stack Exists" "aws cloudformation describe-stacks --stack-name engagecicd"

# Test 11: GitHub connection exists
run_test "GitHub Connection Exists" "aws codestar-connections list-connections | grep engage-github-connection"

# Test 12: Test build project exists  
run_test "Test Build Project Exists" "aws codebuild batch-get-projects --names engagecicd-build-test"

# Test 13: Prod build project exists
run_test "Prod Build Project Exists" "aws codebuild batch-get-projects --names engagecicd-build-prod"

# Summary
echo ""
echo "============================================"
echo -e "${BLUE}TEST RESULTS${NC}"
echo "============================================"
echo "Total Tests: $test_count"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    print_success "🎉 ALL TESTS PASSED - Secure deployment is ready!"
    echo ""
    echo "✅ GitHub tokens are securely stored"
    echo "✅ CI/CD pipeline is configured"
    echo "✅ CodeBuild has proper permissions"
    echo ""
    echo "Next steps:"
    echo "1. Activate GitHub connection in AWS Console"
    echo "2. Push to test/prod branches to trigger deployments"
    echo "3. Monitor CodeBuild logs to verify token retrieval"
else
    print_fail "⚠️ Some tests failed - please fix issues before deploying"
    echo ""
    echo "Common fixes:"
    echo "- Run: ./scripts/setup-secure-github-token.sh test"
    echo "- Run: ./scripts/setup-secure-github-token.sh prod"  
    echo "- Deploy: aws cloudformation deploy --template-file cicd/pipeline-secure.yaml --stack-name engage-cicd-secure --capabilities CAPABILITY_NAMED_IAM"
    echo "- Activate GitHub connection in AWS Console"
fi

exit $fail_count