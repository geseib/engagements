---
name: engage-event-qa
description: How to run an end-to-end usability drive of Engage on a deployed tier. Covers real browsers, fake organisations, an event agenda with every item type, several concurrent events, and N fake players on mixed devices, ending in per-event reports plus a consolidated report. Use when asked to "test events/sessions with fake participants", "run a mock event", "play through the agenda as host and players", "evaluate the host/player experience", or to repeat the 2026-09-29 two-event drive. Mechanics and presentation only; question-set content and Workie's writing are separate evaluations.
---

# Engage event QA drive

The reference run is `docs/qa/2026-09-29-two-event-drive/`. Read its README first: it is what a
finished drive produces, and it lists the traps below as they were hit.

## 0. Decide with the owner (once, up front)

- **Tier:** dev by default. It carries events (`EVENTS_ENABLED` is on for dev only, see
  `template-clean.yaml`). Never prod.
- **Host account:** see §1. The owner has to approve it, and later approve the plan requests.
  Ask both at once so they do not wait on you twice.
- **Scope sentence for every report:** "Mechanics, interaction and presentation. Not the
  question sets, not Workie's content."

## 1. Access: what blocks a cloud container, and the working route

| Blocker | What works |
|---|---|
| `AWS_*` keys are proxy placeholders (InvalidClientTokenId) | Do not plan on the AWS CLI. Everything below goes through the app. |
| The CloudFront site may be blocked by the network policy | Ask the owner to allow it. Failing that: `cd src && npm ci && npm run build`, serve `src/dist` with an SPA fallback, and point at the dev API (CORS is `*`). |
| Chromium rejects the proxy's TLS | The NSS store `~/.pki/nssdb` can be empty despite the README. Add the `CCR … CA` / `sandbox-egress …` certs from `/root/.ccr/ca-bundle.crt` with `certutil -A -t "C,,"`. Never use `--ignore-certificate-errors*`. |
| **Chromium's WebSocket to the WS API returns HTTP 400** (Node's `ws` through the same proxy works) | Unsolved in-container; a local relay was refused by sandbox policy. **Check this first** (`scripts/ws-probe.js`). If it fails, anything a player *sends* (C&A, trivia, wavelength answers, votes) will not arrive; surveys (HTTP) still work. Either run the drive from a machine with normal networking, or run degraded (reload after each host step) and mark the gap in every report. |
| No password for any account | Self-register a QA host (below). Never ask for a password in chat. |

**QA host, no passwords in chat:**
1. Register at `/auth?mode=register` with a plus-address of the owner's Gmail (for example
   `owner+engage-qa@gmail.com`). Generate the password into a `0600` scratch file.
2. Read the 6-digit code with the Gmail connector (`to:<address> newer_than:1h`).
3. Confirm through Cognito `ConfirmSignUp`: public client id from `config.js`, no secret, a plain
   HTTPS POST to `cognito-idp.us-east-1.amazonaws.com` with `X-Amz-Target:
   AWSCognitoIdentityProviderService.ConfirmSignUp`.
4. Ask the owner to approve the account into `hosts` (console → Accounts → Waiting for approval).
5. If sign-in then says "password does not match", the approval reset it. Use `ForgotPassword`,
   then `ConfirmForgotPassword` with the emailed code and a new generated password.

**Organisations:** the host chip → "Create an organisation" → name → **Create team**. Each one files
an Organisation-plan request, and events need a paid plan. Ask the owner to approve them under Plan
requests. The active org lives in localStorage, so keep **one storageState file per org**
(`host-<org>.json`) and switch with the header chip.

## 2. Build the agenda (one per event)

Host main screen → **New event** (`#evts-name`, `#evts-date`, `#evts-time`, `#evts-zone`,
`#evts-place`) → **Create event** lands on `/host/event/<code>/agenda`.

**Add item** (`role=menuitem`: Survey, Trivia, Call & Answer, Poll, Wavelength, Presentation,
Activity, Break) opens the item dialog:

- **Set:** `getByRole('radio', {name: '<set name>', exact: true})`. Public-library sets are listed
  for any org.
- **Fields:** `#evb-title` (overwrite it, or the "(Demo)" prefix leaks to the room), `#evb-ledby`,
  `#evb-minutes`, `#evb-description`.
- **Presentation:** `setInputFiles('input[type=file]', deck.pdf)`. Make the PDF with
  `page.pdf({width:'1280px',height:'720px'})`.
- **Workie briefing (C&A only):**
  - Upload: `setInputFiles` on `[role=dialog] input[type=file]` with a `.txt` of at least 200
    characters. It is ready when the dialog shows "What Workie will know".
  - Typed: click "or write the key points yourself", then fill `getByLabel('What Workie will know')`.
- **Advanced** (click the text): goal is `#evb-so-goal`; shuffle is
  `getByLabel('Shuffle the question order')`.
- Finish with **Add to agenda**, then read the agenda row back to confirm what was saved.

**Setting the question order ahead of time:** on the event board, **Open** the item (the preview;
phones do not move) → **SESSION** → Questions → the "Search titles…" box → **Queue**, in the order
you want. Check that "RUNNING ORDER · n queued" reads right. Go live reuses this session.

## 3. Players

- Each player is its own browser context: phone 390×844, small phone 360×740, tablet 820×1180,
  and one laptop 1280×800 (`isMobile`, `hasTouch`).
- Go to `/play?event=<code>`, fill `#evp-name`, then press the submit button of `#evp-join-form`.
  Their token lives in localStorage, so a reload keeps the seat.
- **C&A:** `#plr-answer` → **Submit Answer**.
- **Trivia:** `[role=radio]` in "Answer options" → **Submit Answer**.
- **Wavelength:** `#plr-word-0..9` → **Submit Words (n/10)**.
- **Survey:** the rating buttons are `<button role=radio aria-label="n of max">`, so target them by
  `aria-label`, not by role name. Choices are buttons with visible text. Yes/No is `[role=radio]`.
  Text is a textarea. Then Next, and finally **Send my answers**. `scripts/survey-player.js`
  handles all of this.

## 4. Run the day

- **Board:** `/host/event/<code>`. Rows carry "Open <title>", "Go live with <title>",
  "Pause/Resume/End <title>".
- **Inside an item:** the dock has "Back to the event's agenda" and "Session panel". The primary
  button goes Start First Round/Question/Subject → Start Voting / Show Results → What We Heard →
  Next.
- **To run events concurrently**, use one Node process holding every page (`scripts/driver.js`)
  and fire both hosts' actions with `Promise.all`.
- **After each host step,** check (or, in degraded mode, reload) every phone before acting as the
  players.
- **End each item, then End the event.** Observe what the board and phones say in between.

## 5. What to capture

- **Screenshot every state** on the host and on at least the phone, small-phone and tablet players.
- **Stitch before and after pairs side by side** (`scripts/combine.js`) so each finding has one
  evidence image.
- **Fit sweep:** open the board at 1024×768, 768×1024 and 1920×1080, and assert
  `scrollHeight <= innerHeight` and `scrollWidth <= innerWidth`.
- **When a phone and the host disagree,** read the server's truth (`host-state`,
  `answers/host?questionId=`) from the page's network responses before calling it a bug. Then find
  the line of code.
- **Log findings as you go** in a raw file, tagged `[host|player][good|clarity|cutoff|layout|
  mechanics|visibility|wording]`.

## 6. Reports

- **Per event** (`docs/qa/<date>-<slug>/<org>.md`): agenda table, coverage, What worked, What
  didn't, an Easy vs hard table, and Looks good / could look better. Every claim names its
  screenshot.
- **Consolidated** (`README.md`): a coverage matrix (✅/❌ with the reason), a findings table ranked
  by severity (High means data loss or a blocked task), what to keep, and next steps.
- Commit the curated screenshots (combos first, about 4 MB total), not all 150.
- **Publishing:** a branch push to `dev` deploys (CLAUDE.md), so run the baselines before pushing,
  even for docs.

## Scripts

All scripts take `QA_DIR` (a scratch directory) and `ENGAGE_BASE` (default
`https://engage.dev.seibtribe.us`).

| Script | What it does |
|---|---|
| `scripts/driver.js` | A long-lived Playwright process. POST JS to `127.0.0.1:9333` (`scripts/run.sh`). The globals are `G`, `P` (pages by name), `shot`, `text`, `sleep` and `log`. |
| `scripts/ws-probe.js` | Checks whether browser WebSockets work here, before you build a whole drive on them. |
| `scripts/survey-player.js` | Answers any survey, whatever its question types. Paste it into the driver. |
| `scripts/combine.js` | Stitches screenshots side by side. |
