/**
 * The one line that actually moves the browser after an auth round trip.
 *
 * It is a module of its own for one reason: `window.location.href = x` is the
 * end of the OAuth flow and there is no way to observe it from a test. jsdom's
 * `Location` is unforgeable — it cannot be deleted, redefined or spied on, and
 * cross-document navigation is not implemented — so a test that renders the
 * real `/auth/callback` route can watch every step of the flow EXCEPT the one
 * that matters. That gap is exactly how a computed destination shipped while
 * being thrown away at the call site: `takeReturnPath()` was correct, its own
 * tests all passed, and every sign-in still landed on `/`.
 *
 * Route the navigation through here and the destination becomes observable.
 */
export function navigateTo(url) {
  window.location.href = url;
}

export default navigateTo;
