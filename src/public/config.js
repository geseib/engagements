// Development environment configuration (engagedev / engage.dev.seibtribe.us)
window.API_BASE = 'https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/';
window.WS_URL = 'wss://h8ipndmk4d.execute-api.us-east-1.amazonaws.com/dev';
window.USER_POOL_ID = 'us-east-1_7VC2YyGnU';
window.USER_POOL_CLIENT_ID = '5jssphqmpqmjr1o51e1ba0e22b';
window.COGNITO_DOMAIN = 'engagedev-auth-v2';
window.ENV = 'development';

console.log('🔧 DEV Environment loaded:');
console.log('  API_BASE:', window.API_BASE);
console.log('  WS_URL:', window.WS_URL);
console.log('  USER_POOL_ID:', window.USER_POOL_ID);
console.log('  USER_POOL_CLIENT_ID:', window.USER_POOL_CLIENT_ID);
console.log('  COGNITO_DOMAIN:', window.COGNITO_DOMAIN);
console.log('  ENV:', window.ENV);
