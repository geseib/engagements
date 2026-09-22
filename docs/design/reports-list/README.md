# Reports list — mockup (2026-09-21)

Step 4 of the reports work: a place to FIND a saved report once its session is gone.
Steps 1–3 (session TTLs, the `REPORT#` index row, the split bucket rule) shipped to dev.

Serve with the `all-design-mockups` launch config (:8124) and open
`/reports-list/01-reports.html`. The shell is `admin-redesign`'s, inlined; the only
new CSS is the expiry column.

What it reads: `Query PK = ORG#<org>#REPORTS` (platform: `REPORTS`), decrypting `Title`
with the org's key. Download goes through `download-report.js` (org) or a presigned URL
(orgless), both already deployed. Needs one new route: `GET /reports`.

Decisions the mockup takes, open to reversal:
- Expiry is a **date**, red inside seven days; never a countdown.
- The session column says **Expired <date>** rather than offering a dead Open.
- A second save of the same session is a second row.
- Host surface: the same list, mounted where "Your question sets" is, filtered to sessions
  the host ran. Not drawn yet.
