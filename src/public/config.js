// Runtime environment configuration.
//
// SOURCE OF TRUTH: this file is REGENERATED at deploy time from
// CloudFormation stack outputs — by scripts/deploy-frontend-eng.sh (dev)
// and buildspec-test.yml / buildspec-prod.yml (CI). The committed copy only
// provides dev defaults for local work; do not hand-edit per-environment
// values here and expect them to survive a deploy.
window.API_BASE = 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/';
window.WS_URL = 'wss://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev';
window.USER_POOL_ID = 'us-east-1_ow22HbCT0';
window.USER_POOL_CLIENT_ID = '1s7v4imvde9kmvs119kfqtlg5e';
window.COGNITO_DOMAIN = 'engdev-auth-v2';
window.ENV = 'development';

console.log('🔧 DEV Environment loaded:');
console.log('  API_BASE:', window.API_BASE);
console.log('  WS_URL:', window.WS_URL);
console.log('  USER_POOL_ID:', window.USER_POOL_ID);
console.log('  USER_POOL_CLIENT_ID:', window.USER_POOL_CLIENT_ID);
console.log('  COGNITO_DOMAIN:', window.COGNITO_DOMAIN);
console.log('  ENV:', window.ENV);
