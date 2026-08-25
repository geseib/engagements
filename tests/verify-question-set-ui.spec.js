/**
 * THE FOUR THINGS ONLY A REAL BROWSER CAN SHOW.
 *
 *   ENGAGE_PASSWORD='…' npx playwright test tests/verify-question-set-ui.spec.js
 *
 * ── WHY THIS EXISTS WHEN THE JSDOM TESTS ALREADY PASS ──────────────────────
 *
 * All four assertions below have green component tests, written the same day as
 * the fixes. That is not the same thing, and this repo has the scar to prove
 * it: an entire OAuth return-path change once shipped as dead code with twelve
 * green tests on the module and nothing on its only call site. The AI builder
 * button did the same in miniature — `hostQuestionSets.test.jsx` asserted the
 * button was PRESENT and it was, while `onOpenBuilder` was never passed, so
 * pressing it did nothing at all.
 *
 * jsdom cannot catch that class. It has no layout engine, no real bundle, no
 * CDN, and no deployed backend. This runs against whatever is actually serving.
 *
 * ── THE PASSWORD IS YOURS AND STAYS YOURS ──────────────────────────────────
 *
 * Read from the environment, never a default, never an argument (which would be
 * in your shell history and in every other user's process list), and never
 * committed. Nothing here logs it. If it is absent every test SKIPS with a note
 * rather than failing, so an unset variable is never mistaken for a broken UI.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It starts no generation. A run costs Bedrock money against a real org's plan,
 * and a UI check is not worth a bill. The "generating" strip is exercised by
 * seeding the job slot the builders themselves write (utils/generationJob.js) —
 * the same state a real run leaves, without the run.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.ENGAGE_URL || 'https://engage.test.seibtribe.us';
const EMAIL = process.env.ENGAGE_EMAIL || 'qa-host-a@example.com';
const PASSWORD = process.env.ENGAGE_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

/*
  SCOPED TO THE TESTS THAT ACTUALLY NEED IT. A file-level skip took the bundle
  check down with the rest, and that one needs no credentials — it is the check
  worth having when nothing else is configured, because "this tier never got the
  deploy" explains every other failure in this file.
*/
const needsSignIn = () =>
  test.skip(!PASSWORD, 'Set ENGAGE_PASSWORD to run this. Nothing is defaulted — see the header.');

/**
 * Sign in and land on the host surface.
 *
 * Selectors are the accessible names read off the live page, not guesses:
 * a textbox placeheld "you@work.com", a "Password" textbox, a "Sign in" submit.
 */
async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.getByRole('textbox', { name: /you@work\.com/i }).fill(EMAIL);
  await page.getByRole('textbox', { name: /^password$/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // The sign-in form going away is the only reliable signal — where it lands
  // depends on whether this account has a session in flight.
  await expect(page.getByRole('textbox', { name: /^password$/i }))
    .toBeHidden({ timeout: 30000 });
}

/** Open the host's question-set dialog and the New question set form inside it. */
async function openCreateForm(page) {
  const sets = page.getByRole('button', { name: /your question sets|make a question set/i }).first();
  await sets.click();
  await page.getByRole('button', { name: /new question set/i }).first().click();
}

test('the deployed bundle is the one with today’s work in it', async ({ page }) => {
  // rejects: running this whole file against a tier that never got the deploy
  // and reading the absences as regressions.
  const body = await (await page.request.get(`${BASE}/bundle.js`)).text();
  for (const marker of ['Set roughly', 'qsets-route', 'Review the generation', 'questionSetScope']) {
    // A BOOLEAN, NOT `toContain`. Failing `toContain` against a 3.5MB bundle
    // prints the whole bundle, which buries the one sentence that matters.
    expect(
      body.includes(marker),
      `${BASE} is STALE: "${marker}" is not in its bundle. Deploy this tier before reading anything below as a regression.`,
    ).toBe(true);
  }
});

test('the AI builder button opens a builder', async ({ page }) => {
  needsSignIn();
  // rejects: THE REPORTED DEFECT. The button rendered with no `onOpenBuilder`
  // behind it, so it passed a presence test and did nothing when pressed.
  await signIn(page);
  await openCreateForm(page);

  await page.getByRole('button', { name: /AI .* builder/i }).first().click();
  await expect(page.getByRole('heading', { name: /AI .* builder/i }))
    .toBeVisible({ timeout: 15000 });
});

test('the ways in are ranked and each says when to take it', async ({ page }) => {
  needsSignIn();
  // rejects: the create panel going back to five sibling buttons in a wrap with
  // nothing to choose between them.
  await signIn(page);
  await openCreateForm(page);

  const routes = page.locator('.qsets-route');
  expect(await routes.count()).toBeGreaterThanOrEqual(3);
  // Exactly one recommendation: two is none, zero leaves you where you started.
  await expect(page.locator('.qsets-route--lead')).toHaveCount(1);
  for (let i = 0; i < await routes.count(); i += 1) {
    await expect(routes.nth(i).locator('.qsets-route-when')).not.toBeEmpty();
  }
});

test('a generation in flight is announced in the list', async ({ page }) => {
  needsSignIn();
  /*
    SEEDED, NOT RUN. The strip reads the slot the builders write to localStorage
    so a job survives a reload; writing one directly puts the list in exactly the
    state a real generation leaves, and costs nothing. Cleared afterwards so a
    later manual visit is not told a job is running for ever.
  */
  // rejects: the list staying silent for the minutes a generation takes, which
  // is what made a running job look like nothing had happened.
  await signIn(page);
  await page.evaluate(() => window.localStorage.setItem(
    'engage.generationJob.ai-generate-scenarios',
    JSON.stringify({ jobId: 'ui-verify', startedAt: Date.now() }),
  ));
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /your question sets|make a question set/i }).first().click();
    await expect(page.getByText(/generating/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /review the generation/i })).toBeVisible();
  } finally {
    await page.evaluate(() => window.localStorage.removeItem('engage.generationJob.ai-generate-scenarios'));
  }
});

test('an unreviewed generation reads as a draft, and its action is Review', async ({ page }) => {
  needsSignIn();
  /*
    NEEDS ONE. A generated set that has already been switched on is an ordinary
    set and correctly shows neither — qa-host-b's was activated within minutes of
    being made, which is why this cannot simply assume the row is there. Skipping
    with a reason beats failing on absent data and beats passing vacuously.
  */
  // rejects: a draft row explaining itself only as "Not offered in the picker",
  // and offering "Edit questions" as the way into something nobody has read.
  await signIn(page);
  await page.getByRole('button', { name: /your question sets|make a question set/i }).first().click();

  const draft = page.locator('tr', { has: page.getByText(/^draft$/i) }).first();
  if (await draft.count() === 0) {
    test.skip(true, 'No unreviewed generation on this account. Generate one, do not switch it on, and re-run.');
  }
  await expect(draft.getByRole('button', { name: /^review$/i })).toBeVisible();
  await expect(draft.getByText(/review it, then switch it on/i)).toBeVisible();
});
