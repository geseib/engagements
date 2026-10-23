# Set chooser (issue #41)

Owner, 23 Oct 2026: "the current UX is not going to scale to find what people need as the
question sets grow ... search, filter by mine/team/public/engage or by date or by tag."

The canvas: https://claude.ai/artifact/4CzdRQiANFbPVuTpEAz5Dp (frames copied here as
`.dc.html`). S0 before a set is picked, S1 the chooser opened in place, S1b picked, S2
filtering, S3 nothing matches, S4 an agenda item, S5 phone.

Built 23 Oct: `src/src/components/SetChooser.jsx` on `src/src/config/setFinder.js` (which
shares its search fields and sorts with the console's Question Sets list), in New
engagement (`GameSetupDialog.jsx`) and an agenda item (`EventItemDialog.jsx`).

Decided without the owner:
- Several tags: a set with ANY of them.
- One team at a time (the active one); Switch team reloads. No count of matches in your
  other teams (that would be an exception to the tenancy rule in tenant.js).
- The owner chip keeps the console's two tones, not the four colours drawn.
- The dialog's table shows Name, Qs, Owner, Used/Updated; topic and tags are filters.

Not yet: Quick start's search, Your question sets dialog, the console list's multi-tag and
Updated filters, a phone sheet for the filters (they wrap instead).
