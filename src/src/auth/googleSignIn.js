import { rememberReturnPath } from './returnPath';

/**
 * Hand the browser to Cognito's hosted UI for the Google provider.
 *
 * Extracted verbatim from the copies that were in LoginForm and RegisterForm.
 * The two differed only in the `state` value and the `authMode` they recorded,
 * and keeping two copies of an OAuth URL builder is how one of them ends up
 * missing a scope.
 *
 * THE `rememberReturnPath()` CALL STAYS EXACTLY WHERE IT IS. Without it the
 * callback falls back to `/` -- which is the HOST PAGE, so a host scanning the
 * remote QR and choosing Google lands on a second host screen on their phone,
 * opening a second host socket and evicting the projector. These forms render
 * both in place (ProtectedRoute leaves the URL on /remote, and that is the path
 * worth keeping) and on /auth, where the call is a deliberate no-op:
 * `rememberReturnPath` refuses auth surfaces, so whatever sent the host here
 * keeps its destination.
 */
export function startGoogleSignIn(mode = 'login') {
  sessionStorage.setItem('authMode', mode);
  rememberReturnPath();

  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID;
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID;
  const cognitoDomain = window.COGNITO_DOMAIN;

  const region = userPoolId.split('_')[0];
  const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');

  const url =
    `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/authorize?` +
    `identity_provider=Google&` +
    `redirect_uri=${redirectUri}&` +
    `response_type=token&` +
    `client_id=${clientId}&` +
    `scope=openid+email+profile+aws.cognito.signin.user.admin&` +
    `prompt=select_account&` +
    `state=${mode}`;

  // The delay was here before and is kept: it is what lets the console lines
  // above survive the navigation when someone is debugging this flow.
  setTimeout(() => {
    window.location.href = url;
  }, 100);
}
