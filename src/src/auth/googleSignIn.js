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
/*
 * THE AUTHORIZATION CODE GRANT, WITH PKCE — not the implicit grant (2026-10-12).
 *
 * This asked for `response_type=token` from its first version (f0cc6fac4,
 * 2025-08). The implicit grant hands back an ID token and an access token in
 * the URL fragment and NEVER a refresh token, so a Google sign-in lived exactly
 * as long as its ID token: one hour (IdTokenValidity: 1 in template-clean.yaml).
 * After that `getSession` had nothing to refresh with, authFetch sent requests
 * with no Authorization header, and the host page's Next Round came back
 * "Unauthorized (HTTP 401)" — the owner's report. An email/password sign-in
 * carries a 30-day refresh token and never hit it, which is why it looked
 * intermittent.
 *
 * The code grant returns a refresh token. OAuthCallback.jsx already had the
 * exchange (it was written and never reached); PKCE is what makes that
 * exchange safe for a public client with no secret (GenerateSecret: false): the
 * code is useless to anyone without the verifier, which never leaves this tab.
 * All three tiers' app clients already allow `code` (AllowedOAuthFlows).
 */
export const PKCE_VERIFIER_KEY = 'engage.pkceVerifier';

const base64url = (bytes) => {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A fresh verifier and its S256 challenge, or null when the browser cannot. */
export async function makePkcePair(cryptoImpl = (typeof window !== 'undefined' ? window.crypto : null)) {
  if (!cryptoImpl || !cryptoImpl.getRandomValues || !cryptoImpl.subtle) return null;
  const verifier = base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  // The verifier is base64url, so plain ASCII: its bytes are its char codes.
  const digest = await cryptoImpl.subtle.digest('SHA-256', Uint8Array.from(verifier, (c) => c.charCodeAt(0)));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function googleAuthorizeUrl({ mode = 'login', challenge = null } = {}) {
  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID;
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID;
  const cognitoDomain = window.COGNITO_DOMAIN;

  const region = userPoolId.split('_')[0];
  const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');

  return `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/authorize?` +
    `identity_provider=Google&` +
    `redirect_uri=${redirectUri}&` +
    `response_type=code&` +
    `client_id=${clientId}&` +
    `scope=openid+email+profile+aws.cognito.signin.user.admin&` +
    `prompt=select_account&` +
    (challenge ? `code_challenge=${challenge}&code_challenge_method=S256&` : '') +
    `state=${mode}`;
}

export async function startGoogleSignIn(mode = 'login') {
  sessionStorage.setItem('authMode', mode);
  rememberReturnPath();

  let challenge = null;
  try {
    const pair = await makePkcePair();
    if (pair) {
      sessionStorage.setItem(PKCE_VERIFIER_KEY, pair.verifier);
      challenge = pair.challenge;
    } else {
      sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    }
  } catch (_) {
    /* No SubtleCrypto (an insecure origin): the plain code grant still works
       for this public client, it is just not bound to this tab. */
    try { sessionStorage.removeItem(PKCE_VERIFIER_KEY); } catch (__) { /* ignore */ }
  }

  const url = googleAuthorizeUrl({ mode, challenge });

  // The delay was here before and is kept: it is what lets the console lines
  // above survive the navigation when someone is debugging this flow.
  setTimeout(() => {
    window.location.href = url;
  }, 100);
}

/**
 * SIGNING OUT OF GOOGLE PROPERLY (2026-10-02, reported by the owner: "there is
 * no way to change the google account that they login with").
 *
 * `cognitoUser.signOut()` only forgets this tab's tokens. Cognito's hosted
 * sign-in domain keeps a session cookie of its own, so the next "Continue with
 * Google" was answered from that session without Google ever being asked —
 * `prompt=select_account` above never reached an account chooser, and the same
 * account came straight back. Cognito's /logout ends that session.
 *
 * `logout_uri` must match one of the app client's LogoutURLs exactly
 * (template-clean.yaml: `https://${DomainName}`, no path), which
 * `window.location.origin` is. Returns null when there is no hosted domain to
 * leave (local dev without one, or tests), so the caller simply stays put.
 */
export const isGoogleUsername = (username) => /^google_/i.test(String(username || ''));

export function hostedLogoutUrl() {
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID;
  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID;
  const cognitoDomain = window.COGNITO_DOMAIN;
  if (!cognitoDomain || !clientId || !userPoolId) return null;
  const region = String(userPoolId).split('_')[0];
  return `https://${cognitoDomain}.auth.${region}.amazoncognito.com/logout?`
    + `client_id=${encodeURIComponent(clientId)}&`
    + `logout_uri=${encodeURIComponent(window.location.origin)}`;
}
