/**
 * Reload this page. One line, in its own module so a test can stand in for it:
 * jsdom will not let a test replace window.location.reload.
 *
 * The Build Room's "Sign in again" uses it: a protected page shows the sign-in
 * form in place, so a reload is a sign-in that lands back on the same room.
 */
export default function reloadPage() {
  window.location.reload();
}
