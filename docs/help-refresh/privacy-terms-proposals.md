# Privacy and Terms: proposed corrections (for the owner)

Help refresh Phase 2, W11, 22 Oct 2026. **Nothing here is published.** The live
pages (`src/src/PrivacyPolicyPage.jsx` at `/privacy`, `src/src/TermsOfServicePage.jsx`
at `/terms`) were read against the code and left unchanged. Each item gives what the
page says, what the code does, and suggested wording. Wording is a starting point,
not legal advice; anything marked **Owner decides** needs a choice only you can make.

Where people meet these pages: the `/join` page footer and the sign-in pages link to
both (`RootPage.jsx:217`, `AuthChrome.jsx:141`), and registering says "By creating an
account you accept the terms and the privacy policy" (`RegisterForm.jsx:287`).

## 1. Problems on both pages

| # | Now | What is true | Proposal |
|---|---|---|---|
| B1 | "Effective Date:" is `new Date().toLocaleDateString()`, so it shows **today** on every visit (`Privacy:29`, `Terms:29`). | No real date exists. | A fixed date string, changed only when the text changes. Keep a short "What changed" line under it. |
| B2 | The product is called "Engagements" in the heading and the text. | The app, the help and the marketing pages say **Engage**. | Use "Engage" throughout. **Owner decides** the legal name of the operator (a person or a company) to name as "we". |
| B3 | Contact: "through our support channels or administrator". | There is no support address. The help's **Report an issue** and the in-app **Ask for help** both create a **public** GitHub issue (see P4). | Give a private contact (an email address) for privacy requests and terms questions. **Owner decides** the address. |
| B4 | Both pages are outside the site's own look and hard-code light colours. | Cosmetic; not a text correction. | Out of scope here; noted for the design pass. |

## 2. Privacy Policy

### P1. "1. Information We Collect" is incomplete

Now: account information (name, email), session data and responses, "usage
information and analytics data".

What the code stores:

- **Hosts and admins:** name and email in the sign-in service (Amazon Cognito); Google
  sign-in passes the Google account's name and email. Team membership and role.
- **Players (no account):** the name they type; their answers, votes, comments,
  ratings and scores; a random id kept in their browser for that one session, so the
  session can recognise the same browser again (`components/joinResult.js`
  `getClientId`, deliberately per session). No email, no account.
- **What hosts create:** question sets, session settings, a briefing for Workie
  (`game/draft-briefing.js`: the uploaded document itself is not kept; the briefing
  keeps roles, not names), saved reports (PDFs), events and their agendas.
- **Build Room:** ideas, votes, directions, Claude's posts and screenshots, and a
  timeline of the build.
- **Records about use:** plan usage counts, Activity, and a change log of every change
  made to a space or team, including by Engage staff, with the reason (kept a year,
  `RETENTION_DAYS 365`).
- **No third-party analytics or advertising trackers** were found in the frontend
  (no Google Analytics, Segment, Sentry or similar).

Proposed text:

> **What we collect.** If you host: your name and email address, from signing up or
> from Google if you sign in with Google, and the teams you belong to. If you take
> part: only the name you type and what you send during a session (answers, votes,
> comments, ratings), plus a random number your browser keeps so the session can
> recognise you if you lose the page. Players never create an account and we never
> ask them for an email address. We also keep what hosts make (question sets,
> sessions, reports, events), counts of use for plans and billing, and a log of
> changes made to each space or team. We do not use advertising or analytics
> trackers.

### P2. "3. Information Sharing" is not true

Now: "**We do not share your personal data with anyone.**"

What the code does:

| Who | What they receive | Source |
|---|---|---|
| **Amazon Web Services** | Everything, as the host: database, files, sign-in, email for sign-in codes. | `template-clean.yaml` |
| **Anthropic** (Claude models), through **Amazon Bedrock**, or Anthropic's own API where Engage's switch sends it there | The responses of a round, and **player names in rounds that show names**, so Workie can write What we heard; questions and descriptions when Workie writes or checks a set; a host's briefing document. | `game/get-ai-summary.js`, `game/claude-route.js` (Engage-wide switch; prod is not connected to the direct API yet), `admin/shared/generation-handler.js`, `admin/check-question-set.js`, `game/draft-briefing.js` |
| **Google** | Sign-in for accounts that use Google. Also, every page loads Google Fonts, which tells Google the visitor's IP address and browser. | `auth/googleSignIn.js`, `public/index.html:55-57` |
| **Cloudflare** | Only in a Build Room, only when the host turns on "Also open it to people who are not here": the demo running on the host's laptop is reachable through Cloudflare, which can see it. | `src/public/engage-mcp.mjs` (cloudflared) |
| **GitHub** | Anything typed into Report a bug / Request a feature / Ask for help, with the page address, the session code and the browser's user agent, posted as an issue in a **public** repository. | `admin/create-github-issue.js`, `components/IssueReportForm.jsx` |
| **The host's own Claude Code** | In a Build Room, what the room sends (ideas, answers, votes) reaches the host's Claude Code, which runs under the host's own Anthropic account. Whether the name of who sent an idea reaches it needs a check: `game/build-room.js:1063` logs `from <PlayerName>` on an idea that is sent straight on. **Owner to confirm.** | `game/build-room.js` |
| **Engage staff** | A person reads a set only when a shared set needs a human decision in the content check; every staff change is in the change log with a reason. | admin-data-privacy help, `PrivacyPanel.jsx` |

Proposed text:

> **Who else handles your data.** We use a small number of services to run Engage,
> and they process data only to provide that service: Amazon Web Services hosts
> Engage and its sign-in; Anthropic's Claude models, through Amazon Bedrock or
> Anthropic directly, write Workie's summaries and help write and check question
> sets, and so receive the responses (and, in rounds that show names, the names)
> they are asked about; Google handles sign-in for people who choose it, and
> serves the site's fonts. In a Build Room, what the room sends goes to the host's
> own Claude Code, and if the host chooses to share the demo with people who are not
> in the room, it is reached through Cloudflare. We do not sell personal data or
> use it for advertising.

**Owner decides:** whether to name the processors (recommended) or describe them by
role; whether to state that model providers do not train on the data (true of
Bedrock and of Anthropic's commercial API under their standard terms, but that is
your contract to confirm, not something the code shows).

### P3. "5. Data Retention" contradicts the product

Now: "Session data and reports are typically retained for 90 days unless deleted
earlier."

What the code does (`session-ttl.js`, `save-report.js`, `generation-drafts.js`,
`template-clean.yaml` bucket rules; the help's admin-data-privacy guide):

| What | Kept for |
|---|---|
| A session never started | 90 days from creation |
| A started session, its players and votes | 7 days from the start |
| Per-round results, scores, Workie's reads, late answers | 30 days |
| A saved report | 90 days, or a year if the host chose **Keep for 1 year** |
| An AI draft | 30 days; discarded, restorable 7 days; accepted, 30 days as a record |
| Invitations | 14 days |
| Change log | a year |
| Question sets, accounts, teams | until deleted |
| Server logs | **no retention period is set** (no `RetentionInDays` anywhere in `template-clean.yaml`, so CloudWatch keeps them indefinitely), and some log lines carry player names (e.g. `get-ai-summary.js` debug lines) |

Removal is automatic and can run up to about two days late.

Proposed text:

> **How long we keep it.** A session and everything people sent in it are deleted
> 7 days after it starts (90 days after it was made, if it never starts); a few
> per-round results last up to 30 days. A report a host saves is kept for 90 days,
> or a year if they choose. Question sets, accounts and teams stay until they are
> deleted. Deletion is automatic and can take up to two days to complete.

**Owner decides:** a retention period for server logs (suggest 30 days), and then
whether to mention logs. Until one is set, the page should not promise a limit that
logs do not meet.

### P4. "6. Your Rights" promises what the product cannot yet do

Now: access, correct, request deletion, withdraw consent.

What the code does: hosts can delete their own sessions and sets, and team owners and
admins can delete all of a team's sessions. **Export everything** and **Delete** on the
Data & privacy screen are shown but cannot be pressed yet (`PrivacyPanel` is mounted
without `onExport` / `onDelete`). There is no self-service account deletion
(`admin/manage-users.js` is staff-only). A player cannot delete what they sent; a
host's Remove keeps the player's answers in the record. The help currently tells
people to ask through **Report an issue**, which is a public GitHub issue, so a
deletion request would be published.

Proposed text:

> **Your choices.** Hosts can delete their own sessions and question sets at any
> time, and a team's owners and admins can delete all of its sessions. To get a copy
> of your data, correct it, or have your account or a team deleted, email
> [address]. If you took part in a session, ask the host, or email us with the
> session's code and the name you used.

**Owner decides:** the address (B3); then the help's admin-data-privacy#leaving should
point to it instead of Report an issue (that guide belongs to W8).

### P5. "7. Cookies and Tracking"

Now: "We use essential cookies…"

What the code does: the app sets no cookies of its own. It keeps the sign-in session,
a player's per-session id and a few preferences (theme, room screen size, chosen team)
in the browser's local storage. Google sign-in goes through the sign-in service's own
page, which uses its own cookies.

Proposed text:

> **Cookies and storage.** Engage keeps your sign-in, your preferences and, for
> players, the per-session id that lets you rejoin, in your browser's storage. It
> sets no advertising or tracking cookies. Signing in with Google uses the sign-in
> page's own cookies.

### P6. "4. Data Security": could say more, accurately

What the code does: each space and team has its own encryption key; sets, questions,
answers, votes, Workie's writing, session titles and reports are encrypted with it.
Identifiers, dates, counts, codes and category names are not.

Proposed addition:

> Your question sets, the answers and votes in your sessions, Workie's writing,
> session titles and reports are encrypted with a key that belongs to your space or
> team alone.

### P7. Players and names (new paragraph)

Worth saying because players never see the policy until they look for it:

> **If you take part.** The host sees your name beside what you send. Whether the
> room sees names depends on the session; a session that hides names from the room
> does not hide them from the host. Do not type anything you would not say in the
> room.

## 3. Terms of Service

| # | Now | Problem | Proposal |
|---|---|---|---|
| T1 | §3 "You may NOT copy, reproduce, distribute, or use any content from this site except for" your own reports and data. | Contradicts the product: hosts copy Engage's shared sets and other organisations' **Public** sets, and publish their own to the public library. | Replace with a content licence: you own what you create; by publishing a set publicly you let other Engage users use and copy it inside Engage; Engage's own sets may be used and copied inside Engage. **Owner decides** the licence terms. |
| T2 | §7 "We … will not share your personal data with third parties." | Same error as P2. | "How we handle personal data is in the Privacy Policy." Delete the promise. |
| T3 | No mention of plans, usage counts or invoices. | Plans, usage limits, invoices on the 1st of the month, credits and discount codes exist (`BillingPanel`, `admin/shared/invoices.js`, plan requests). There is no card payment in the product. | Add a short "Plans and billing" section: what a plan includes is shown in Plan & usage; a session counts once two of its questions have each been answered; how invoices are issued and paid. **Owner decides** payment terms. |
| T4 | No mention of AI output. | Workie writes summaries and question sets; the product itself warns that generated content is not checked. | "Workie's writing is generated by AI and can be wrong. Hosts are responsible for what they show to a room." |
| T5 | No mention of the Build Room. | The plugin runs on the host's laptop, commits to their git, can share their laptop's demo, and (crew mode, if the host turns on Run crew code) can run other people's code on the host's laptop. | "The Build Room plugin runs on your computer under your control. You are responsible for the code it writes and runs there and for what you choose to share." |
| T6 | §3 "Internal organizational use only" for reports. | Reasonable, but saved reports can be shared by link (`/shared-report`). | Confirm that sharing a report link is permitted use. **Owner decides.** |
| T7 | §10 "at least 30 days notice" of material changes. | Nothing in the product notifies users; the effective date currently changes daily (B1). | Keep only if you will actually notify (the bell or email). Otherwise: "We will post changes here with a new effective date." |
| T8 | §1 "terms and provision of this agreement… If you do not agree to abide by the above". | Boilerplate phrasing. | Plain words: "By using Engage you agree to these terms. If you do not, please do not use it." |

## 4. Product defects noticed while checking (for issue #43, not for the pages)

- The issue-report endpoint labels production as `eng.seibtribe.us`
  (`admin/create-github-issue.js`), the retired name; reports from
  `engage.seibtribe.us` are labelled "unknown" environment.
- The report form does not tell the person that their report becomes a public
  GitHub issue with the page address and session code.
- `/join`'s not-found box says codes "stop working once a session ends", but an
  ended session still lets people in (`session-gate.js` never refuses an ended
  session; the player lands on its closing screen).
