# Open questions for the owner

Eleven forks I could not settle from the code. They are ordered by how much of the design is
waiting on them. Each states what I found, what I assumed in the mockups, and what I need.

---

## 1. Does set-delete get the contract that version-delete already has?

`DELETE /admin/question-sets/{setId}/versions/{n}` answers **200 with `pinnedByGames` instead
of deleting**, and the UI names those games before asking again. `DELETE
/admin/question-sets/{setId}` — which removes every version, every question and every category —
does no such check.

It matters more than for a version, because `create-report.js` reads the **live** set when a
report is first requested. Deleting a set decides, permanently, which past sessions can still
produce a report.

**Assumed in `14-confirm-delete-set.html`:** the endpoint gains the same shape — answer 200
with the affected sessions and, per session, whether a report is already stored; delete only on
`?confirm=true`.

**Need:** confirmation that this is wanted, or a decision to accept the risk. Without it the
confirmation screen can only say "are you sure", which is what it says today.

---

## 2. Should a session report be snapshotted at end-of-session instead?

The underlying problem behind Q1 is that a report is materialised lazily. If `create-report`
ran automatically when a session reaches `ENDED`, question-set deletion would stop being
destructive to history and Q1 would shrink to a courtesy warning.

**Need:** is lazy report generation a deliberate cost decision, or an accident?

---

## 3. Survey: finish it, or remove it?

Survey is in `GAME_TYPES`, in the upload form's type list, in the archive filter, in the prompt
editor, and it has its own AI builder. And `upload-questions.js` explicitly rejects it:
*"Survey upload is not yet supported… surveys cannot be imported as playable question sets."*
The survey builder's "Load into System" only downloads a JSON file. `gameTypes.js` also notes
that a survey would fall through into a **vote phase**, which is probably not intended.

**Assumed:** survey sets exist and are marked **Not playable** in the list (`01-sets.html`,
row 13).

**Need:** finish the path, or take Survey out of every picker until it exists. The current
state lets an admin create something that can never be used, which is the worst of the three
options.

---

## 4. The archive is a public, unauthenticated service shared by all three environments.

Every route in `template-archive.yaml` has no authorizer. `https://archive.seibtribe.us` is
publicly readable, writable and **deletable**, and `ArchivePanel`'s Delete button is an
unauthenticated `DELETE` issued from a browser. The URL is a literal repeated six times in the
component.

This is not a design question and no UI fixes it. Flagged because the archive screens are part
of this deliverable and I am not willing to draw a delete button on that surface without saying
so.

**Need:** a decision on authorizing the archive API. Until then, treat `20-archive.html` as
provisional.

---

## 5. What should an archive import actually do about the things it cannot carry?

A CSV round trip loses **tags, School, Question#**, the attached summary prompt, the AI
context, `isAIGenerated`, and the version history. Images lose their **files**: import mints a
new setId, and `toMediaKey()` rewrites the Image value to `sets/<newSetId>/…`, a prefix with no
objects under it. Only absolute `https://` URLs and repo-relative `/assets/…` paths survive.

Three ways out, and they are different products:

- **(a)** Widen the archive format to a JSON envelope that carries everything, including media
  keys, and copy the objects between buckets on import.
- **(b)** Keep the CSV and make the loss explicit and per-item, which is what
  `20-archive.html` draws.
- **(c)** Stop using the archive for promotion and promote by redeploying the same seed data.

**Assumed:** (b), because it is the only one that needs no backend work. It is also the least
good.

---

## 6. Is the prompt library one thing or two?

Generation prompts and summary prompts are the same DynamoDB record with different fields, and
they have two management UIs with two status-badge schemes, two game-type lists (one missing
Survey), and two different save paths — one of which, `POST /admin/ai-prompts/save`, is routed
to the **create** handler, so editing a generation prompt **creates a duplicate** and leaves the
original untouched, with no visible confirmation either way.

**Assumed in `18-prompts.html`:** one library, with `Kind` as a column and a segmented filter.

**Need:** agreement that they merge — and either way, `POST /admin/ai-prompts/save` needs to
stop being an alias for create.

---

## 7. Should editing a summary prompt create a version?

`update-ai-prompt.js` bumps the version and writes a new S3 object **only when the caller passes
`createNewVersion`, or the prompt is a default**. `AIPromptManager` never passes it, so every
edit to a non-default prompt overwrites `v{n}.json` in place. There is no history and no
rollback.

**Assumed in `19-prompt-editor.html`:** every save writes a new version, the way a question-set
CSV replace does.

**Need:** confirmation. It is a one-flag change with an S3 storage cost.

---

## 8. Six of forty-seven prompts are already broken. Fix them or hide them?

`get-ai-prompts.js` computes `summaryPromptStatus`, `summaryPromptDefect` and `malformed` on
every read. On engagedev, four prompts lack the fields a summary needs (attaching one to a set
silently falls back to the default — the "I picked a prompt and nothing changed" symptom), one
has no `promptId` attribute at all, and one was imported from the archive without its body and
carries `status: 'inactive'`, a fourth status value **no filter in the UI matches**.

`scripts/cull-ai-prompts.js` exists.

**Assumed in `18-prompts.html`:** they stay visible, flagged, at the top of the page.

**Need:** run the cull, or accept that the list carries them permanently.

---

## 9. Should a generation job be cancellable?

There is no cancel endpoint. `pollGenerationJob` has an `isCancelled` hook that no caller
passes, and even wired it would only stop the client watching while the worker kept spending.

**Assumed in `09-ai-job-running.html`:** no Cancel button, and the screen says why in one line.

**Need:** if cancellation matters — a 100-question run is six sequential Sonnet calls — it needs
`DELETE /admin/ai-generate-*/{jobId}` setting a flag the worker checks between passes. That is
a small change and it would let me draw the button.

---

## 10. Does the user list need to survive passing 60 accounts?

`manage-users.js` **ignores the request body entirely** — `limit`, `nextToken`, `search` and
`status` are all discarded — hardcodes Cognito's `Limit: 60`, and returns no `nextToken`. So
`hasMore` can never be true and "Load More Users" never renders. Search and status filtering are
client-side over whatever loaded. It also does an `AdminListGroupsForUser` per user inside a
`Promise.all`: 60 extra Cognito calls per page load, on a 60-second timeout.

There are 24 accounts today.

**Assumed in `16-users.html`:** the cap is stated in the subheading rather than hidden.

**Need:** a view on when this becomes real. Also: `manage-users.js` carries the comment
`// Skip authorization for now - just focus on getting user list working`, so there is no
in-lambda admin check — the only gate is the route authorizer plus a client-side `isAdmin()`.

---

## 11. Four small ones that only need a yes or no.

- **`created` vs `createdAt`.** The user-list lambda returns `created`; the table reads
  `createdAt`, so the Joined column is `N/A` for everybody. Drawn as `—` in the mockups
  deliberately. One-word fix — take it?
- **Poll `Option1..5` vs `Options`.** The AI poll builder emits numbered columns; the importer
  reads one pipe-separated `Options` column. Every AI-generated poll question imports with no
  options. Fix the builder, the importer, or both?
- **The survey builder's checkboxes.** The state key is derived as
  `` `include${id[0].toUpperCase()+id.slice(1).replace('_','')}` ``, producing
  `includeMultiplechoice` and `includeTextentry` — neither matches the real keys. Both boxes
  render permanently unchecked while the payload always sends `true`.
- **The 1969 dates.** Listed in `CLAUDE.md` under Active Issues and drawn as-is in
  `12-sessions.html`. Is it an epoch-zero write, or a formatter with no guard? The fix differs.

---

## And one thing I would like to be told I am wrong about

I removed the parallax hero, and with it the three
`cdn.prod.website-files.com` images. It is 250px of an operator surface and a third-party
runtime dependency on an authenticated admin page. But it is also the only thing in the console
that looks like it was made on purpose, and the host redesign cut the same block from the host
page, so between the two of them the product loses its whole visual signature in one week.

If that identity matters, it should come back as something that costs no layout — the way the
host stage's photo field sits *behind* content rather than above it. I did not draw that,
because on a dense console I think it would fight the tables. I could be wrong.
