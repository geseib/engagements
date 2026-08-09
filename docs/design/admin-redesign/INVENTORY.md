# Admin console — full element inventory

**Date:** 2026-08-09 · **Branch:** `dev` · **Status:** the input to the redesign, not a proposal

This is the same exercise `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` §2
performed on the host screen, applied to `src/src/AdminPage.jsx` (1,769 lines) and the five
components it mounts. **It was written before anything was designed.** Where the design that
followed disagrees with a verdict here, the rationale says so.

Verdicts:

- **KEEP** — it does a job, and it does it where it belongs.
- **MOVE** — the job is real, the location is wrong.
- **REDUNDANT** — the same fact, or the same control, already exists elsewhere on screen.
- **CUT** — it should not exist on this surface.
- **DEAD** — it is not reachable, or its output is never rendered. Not a design opinion.
- **BROKEN** — it runs and produces the wrong result.

Line numbers are from `dev` at `1a98d545`.

---

## 1. The shape of the thing

Six tabs (`prompts`, `questionsets`, `games`, `archive`, `users`, `settings`) over one
scrolling document, with `activeTab` defaulting to **`prompts`** (`:82`). Each tab is a stack
of `.admin-section` cards; two of them are accordions; one of them (`questionsets`) contains a
list, an editor that renders *below* the list, an upload form and a creation panel, in that
order, all on the same scroll.

There is also a `/builder` route, opened with `window.open('/builder', '_blank')` (`:1504`),
which knows nothing about the set you were looking at.

**The structural problem, stated once.** The host screen's problem was that a *document* was
being used as a *display*. The admin console's problem is the mirror image: a **list and its
detail view are the same scroll**. Pressing Edit on row 34 of 41 sets `editMode`, scrolls the
page down to a form that renders after the list, and flashes that form `#fff3cd` yellow with a
`#ffc107` border for three seconds (`:183–194`) — a light-theme colour, on a dark palette,
applied by direct DOM mutation, as the only cue to which of forty-one rows you are editing.
When the flash expires there is nothing on screen that says which set is open except the text
inside the fields.

Everything below is downstream of that.

---

## 2. Persistent chrome

| Element | Where | Verdict | Why |
|---|---|---|---|
| Parallax hero — 3 Webflow CDN `.webp` layers + "Admin Dashboard" | `:908–970` | **CUT** | ~250px of the fold on an authenticated operator surface, spent on a word the operator already knows, and it is a **third-party runtime dependency on `cdn.prod.website-files.com`** for an admin console. The host spec already cuts the identical block from the host page. |
| `admin-user-info` — name, "Administrator", Sign Out | `:923–962` | **MOVE** | Genuinely belongs here — unlike the host stage, where §7.2 forbids it. But it is `position:absolute` inside the parallax with fourteen inline style properties and two inline mouse handlers. It belongs in a top bar. |
| `HelpButton` × 8 (`admin`, `ai-prompts` ×2, `question-sets`, `upload-csv`, `ai-builders`, `game-management`, `websocket-settings`) | throughout | **REDUNDANT / reduce** | Eight separate entry points into one help system, each with its own `tooltip` string. Help is a surface, not a decoration on every heading. |
| `IssueFab` | `:1765` | **KEEP** | Reporting a bug from the console is right. |
| Tab bar, 6 tabs | `:974–1013` | **MOVE** | Becomes a nav (see §8). |
| `activeTab` default `'prompts'` | `:82` | **BROKEN** as a default | The console opens on AI Prompts. Question sets are the object every other screen depends on; prompts are edited rarely and by one person. |
| Env / API base | — | **MISSING** | Three tiers exist, the archive is shared across all of them, and **no admin screen says which one is loaded.** |

---

## 3. Question sets tab

### 3.1 The list

| Element | Where | Verdict | Why |
|---|---|---|---|
| Filters: search, type, status, sort | `:1112–1163` | **KEEP** | Four sensible client-side filters. |
| Result count | — | **MISSING** | Nothing states how many of how many are shown. |
| `set-info` → `<h3>` name + `SetImageBadge` | `:1177` | **KEEP** |
| `set-info` → description `<p>` | `:1178` | **KEEP**, one line |
| `set-info` → **Custom Instructions** paragraph | `:1179–1183` | **REDUNDANT in a list** | 140 characters of the set's player-facing instruction, printed on the index row. |
| `set-info` → **AI Context** paragraph | `:1190–1194` | **REDUNDANT in a list** | Same. |
| `set-info` → **AI Prompt · Round label · Voice** paragraph | `:1195–1204` | **REDUNDANT in a list** | Three more settings, on the row. |
| `set-info` → Created / Updated | `:1205–1212` | **KEEP** one of them | Two dates in two formats (`toLocaleDateString` and `toLocaleString`) in one sentence. |
| `set-stats` row 1 — 3 badges | `:1215–1219` | **KEEP**, compress |
| `set-stats` row 2 — Active toggle *button*, Quickstart *checkbox*, AI *badge* | `:1220–1241` | **KEEP**, unify | Three states, three different control idioms, in two stacked rows. |
| Edit / Delete buttons | `:1243–1258` | **KEEP** |
| Empty state, two variants | `:1167–1172` | **KEEP** — and it is the **only** place in the console that distinguishes "nothing exists" from "nothing matches". Every other list gets this wrong. |
| Empty-state copy: *"Upload your first question set above"* | `:1170` | **BROKEN** | The upload section is **below** it, and collapsed. |

**The row is a form printed as prose.** Five paragraphs, three badges, two toggles, two dates.
Forty-one of them is not a list; it is a document. And every field it prints is repeated in
full, editable, in the editor that opens when you click Edit.

### 3.2 The editor (`components/QuestionSetEditor.jsx`, 850 lines)

This file is the best-reasoned code in the admin surface and most of it survives.

| Element | Verdict | Why |
|---|---|---|
| Details panel — 8 fields | **KEEP** | Every field settable at creation is settable here. The payload is a diff, and the confirmation names what the *backend* says it wrote. Both are right. |
| `Categories` read-only + "download the CSV to change them" | **KEEP** | Honest about a real constraint instead of faking an editor. |
| Questions panel — Download CSV / Replace CSV | **KEEP** |
| **The questions themselves** | **MISSING** | `GET /question-sets/{setId}/questions` is deployed (`template-clean.yaml:383`) and **no admin screen calls it.** To check one bad row you download a CSV. |
| Replace preview — `describeReplacePlan()` | **KEEP**, extend | Two count deltas and a paragraph. It never says *which* categories are about to disappear, and a category with no rows ceases to exist. |
| Versions panel — list, promote, delete | **KEEP** |
| Version delete: 200-with-`pinnedByGames` instead of deleting, then confirm with the ids named | **KEEP — and generalise** | This is the best destructive-action pattern in the product. See §9. |
| Media panel | **SEAM** | Declared, not built. Images reach a set only through the CSV's Image column. |
| Save button position | **MOVE** | Mid-form, above two more panels. |

### 3.3 Upload form

| Element | Where | Verdict | Why |
|---|---|---|---|
| Accordion header, collapsed by default | `:1286–1298` | **CUT the accordion** | It is one of the two primary ways a set gets made and it is hidden behind a disclosure triangle, below the list. |
| Title / Description / Engagement type / Custom instructions / AI context / Prompt / File | `:1304–1438` | **KEEP** | |
| **Engagement type `<select>`** | `:1335–1346` | **REDUNDANT — the same control twice** | See below. |
| Title auto-filled from filename; description auto-filled from a School or Category cell; custom instructions auto-filled from a CustomInstruction cell | `:427–477` | **KEEP with a signal** | Three silent writes into fields the user is looking at, with no indication that they were guessed rather than typed. |
| Survey branch: *"survey JSON upload is not yet supported by the server"* | `:437` | **BROKEN** | The form accepts the file, names it, fills the fields, and then says the server will refuse it. |
| `uploadStatus` `StatusMessage` | `:1451` | **KEEP** |

### 3.4 Add New Set

| Element | Where | Verdict |
|---|---|---|
| **Engagement type `<select>` — the second one** | `:1466–1478` | **REDUNDANT** |
| AI Builder button (label and target both derived from `engagementType`) | `:1482–1501` | **KEEP**, move |
| Manual Builder Interface — `window.open('/builder','_blank')` | `:1502–1507` | **KEEP**, move |
| Download Template | `:1508–1517` | **KEEP**, move |
| Download Art Title Template (call-and-answer only) | `:1521–1529` | **KEEP**, move |

### 3.5 The redundancy that matters most on this tab

`engagementType` is **one React state** (`:54`) rendered as **two visible `<select>` elements**,
in two different sections of the same tab, about 130px apart after the accordion opens
(`:1335` and `:1467`). They are always in lockstep. Changing either one silently changes the
other, and the same variable also decides which of the four AI builders the button opens and
which template the download button fetches.

This is the admin's exact analogue of the host screen's "the same fact stated six times". It
is not the same fact twice — it is **the same control twice**, which is worse, because a
duplicated control that stays in sync teaches you it is two settings until the day it matters.

And there are **five** places a question set can be created, all on this one tab, none ranked:
the upload form, the AI builder modal, the manual builder in a second tab, a downloaded
template, and — from another tab entirely — an archive import.

---

## 4. Game Management tab

The entire tab is one `danger-section` (`:1540–1591`):

| Element | Verdict | Why |
|---|---|---|
| A radio pair, Single Game / All Games | **KEEP** |
| A free-text **"Enter Game ID"** input | **BROKEN as the only affordance** | To delete one session you must already know its id. Session ids are displayed on the host screen and nowhere in the admin console. |
| "Delete All Games" | **KEEP**, with a real confirmation |
| Confirmation modal — *"Are you sure you want to delete ALL games? This action cannot be undone!"* | **KEEP**, extend | It states danger and no consequence: not how many sessions, not that saved reports go with them, not that one is live. |
| **A list of games** | **MISSING** | `GET /games` is deployed (`get-games-list.js`, `template-clean.yaml:786`) and returns title, type, question set, host, created, lastPlayed, started, visibility. The host page's switch-game dialog reads it (`GameHostPage.jsx:2735`). The admin console has never asked. |

A tab named "Game Management" that can only delete, and can only delete by an id it does not
show you, is not management.

---

## 5. AI generation — the four builders

Generation became asynchronous when it outgrew the 30-second API Gateway ceiling. The UI did
not follow.

| Element | Verdict | Why |
|---|---|---|
| Step-1 configuration forms (Trivia / Poll / Survey / Scenario) | **KEEP** | Reasonable fields. Only the scenario builder mentions the 24-category bitmask ceiling; trivia has the same limit and does not. |
| **The entire in-progress state** | **BROKEN** | A CSS spinner and one line of text: `<div class="spinner"/><p>{generationStatus}</p>`. That is all of it. |
| `completed` / `requested` in every poll response | **DEAD** | A real "34 of 100" is on the wire and is discarded in favour of a prose `phase` string. |
| `items[]` streamed on every worker update | **DEAD** | They *do* reach component state via `onProgress`. They are then hidden behind the `isGenerating ?` branch, which wins. The code comment says "Show questions as they land rather than a spinner for minutes"; the code does not do that. |
| `warnings[]` | **DEAD** | Returned on every poll. Rendered in no builder, ever. Includes "stopped early to stay inside the time limit" and "produced only duplicates". |
| Near-duplicate suppression | **INVISIBLE** | Dropped server-side with a `console.warn`. Ask for 100, get 84, no explanation. |
| Modal footer during generation | **MISSING** | Renders nothing. No cancel, no back, no close-and-keep-running. |
| Closing the modal | **BROKEN** | Unmounts the component; the polling loop keeps running and keeps calling `setState` on it. Nothing aborts the fetch loop. |
| `jobId` persistence | **MISSING** | Lives in a local `const` inside `handleConfigSubmit`. The job row survives **three days** in DynamoDB and there is no way to reach it after a reload. |
| Poll timeout message: *"timed out after 10 minutes. The job may still finish — reopen the builder to check."* | **BROKEN** | Reopening the builder cannot check. Nothing stores the id. The client also gives up at 10 minutes on a worker allowed 15. |
| Failure **with** partial items | **BROKEN — the worst defect in this area** | Trivia, Poll and Survey set the items from `error.partialItems` and render the review UI. `Generation failed: …` is never displayed. **Failure looks exactly like success.** |
| Failure with partial items, scenario builder | **BROKEN differently** | Discards `error.partialItems` outright even though the job carries them. |
| Retry | **MISSING** | No failure branch in any builder offers one. The only control is "← Back to Configuration". |
| Cancel | **IMPOSSIBLE** | There is no cancel endpoint. `pollGenerationJob` has an `isCancelled` hook; no caller passes it, and it would only stop the client watching. |
| Review UI — one item at a time behind Previous/Next | **CUT** | Judging 84 questions through a one-item window is data entry, not review. |
| Per-item reject | **MISSING** | Accept all or none. One bad row means importing it or discarding the rest. |
| Survey → "Load into System" | **BROKEN** | Downloads a JSON file. `upload-questions.js` explicitly rejects survey. A survey set can be created and can never be played. |
| Poll CSV `Option1…Option5` vs importer's `Options` | **BROKEN** | The AI poll builder writes numbered columns; the importer reads one pipe-separated `Options` column. **Every AI-generated poll question imports with no options.** |
| Survey builder's Multiple Choice / Text Entry checkboxes | **BROKEN** | The state key is derived as `` `include${id[0].toUpperCase()+id.slice(1).replace('_','')}` ``, yielding `includeMultiplechoice` / `includeTextentry`, which match nothing. Both boxes render permanently unchecked while the payload always sends `true`. |
| CSV serialisation `"${value}"` | **BROKEN** | Naive interpolation. A `"` typed into an edited title corrupts the row. |

---

## 6. Users tab (`components/UserManagement.jsx`, 600 lines)

| Element | Verdict | Why |
|---|---|---|
| Access-denied gate for non-admins | **KEEP** |
| Search form (round-trips on submit) | **BROKEN** | `manage-users.js` **ignores the entire request body**. Search is client-side over whatever loaded. |
| Four filter tabs with counts | **BROKEN** | The counts and the filters use different predicates. The count badge for *Enabled* uses `u.enabled && u.status!=='pending'`; the filter matches `u.status === 'enabled'`, and `enabled` is not a Cognito group. **The Enabled tab always shows zero rows under a non-zero badge.** Same class of bug on *Disabled*. |
| Table: User / Status / Groups / Provider / Created / Actions | **KEEP** the shape |
| **Created column** | **BROKEN** | The lambda returns `created`; the table reads `user.createdAt`. **Every row shows `N/A`.** |
| Provider column | **BROKEN** | The lambda never returns `provider`. Every row says `cognito`. |
| `userStatus` (CONFIRMED / UNCONFIRMED / FORCE_CHANGE_PASSWORD) | **DEAD** | Returned, never displayed. Whether someone confirmed their email is invisible. |
| Four group buttons — Pending / Host / Admin / Disabled | **KEEP**, reshape | They are four identical-looking moves. **Nothing indicates which one is the approval.** |
| Delete (trash icon) | **KEEP** | Routes through `changeUserState(username,'delete')`. |
| `approveUser()`, `updateUserStatus()`, `deleteUser()` | **DEAD** | Three functions calling three routes that **do not exist** (`POST /admin/users/{id}/approve`, `PUT …/status`, `DELETE …/{id}`). None is called from JSX. |
| `.action-button.approve/.enable/.disable`, `.state-select`, `.action-spinner`, `.group-badge*`, `.no-groups` | **DEAD** | ~9 orphaned CSS blocks for controls the JSX no longer renders. |
| "Load More Users" | **DEAD** | `hasMore` can never be true — the lambda returns no `nextToken` and hard-caps at 60. |
| Confirmations | **CUT** | `window.confirm`. |
| **A queue** | **MISSING** | Approval is the one thing in this console that *decays* if nobody looks at it, and it is the second of four filter tabs. Nothing anywhere else in the console shows that three people are waiting. |

---

## 7. Prompts, archive, settings — condensed

Full detail is in the survey notes; these are the verdicts that changed the design.

**Prompts.** There are **three separate prompt-list UIs**: `AIPromptManager` (analysis),
`AIGenerationPromptEditor` (generation), and the Archive panel's Export tab. All three render a
card with name / status / game type / category / Default / tags, with **three different class
conventions and two incompatible status-badge schemes**. `AIGenerationPromptEditor` is missing
Survey from its game-type list; `AIPromptManager`'s category filter offers only the
call-and-answer categories, so every trivia, poll and wavelength category is unreachable from
it. The variable palette renders its 43 variables under a **fixed list of group headers that
omits Wavelength** — so all six wavelength variables are undisplayable. `AIGenerationPromptEditor`
**always POSTs to the create handler**, so editing a generation prompt creates a duplicate and
leaves the original untouched, with no visible confirmation either way (`console.log` only).
Non-default analysis prompts are **overwritten in place** — the versioning code exists in
`update-ai-prompt.js` and the editor never asks for it. **Six of forty-seven prompts on
engagedev are already flagged by the API as unusable or malformed**, and that surfaces as a
small badge on a card in a scrolling grid.

**Archive.** Three tabs that render two near-identical card grids; the per-card Import button
on Browse is **DEAD** (the panel is mounted without the `onQuestionSetImport` prop it needs).
Selection is a checkbox **and** a full-width "Select for Export" button, both toggling the same
Set. `https://archive.seibtribe.us` is a literal repeated six times in the component, called
with plain `fetch` and **no auth** — every archive route is unauthenticated, including DELETE.
Search results are silently discarded on any tab switch. The source environment is stored only
as a tag and has no filter of its own. A CSV round trip loses **tags, School, Question#**, the
attached summary prompt, the AI context, `isAIGenerated`, and the version history; images lose
their files entirely, because import mints a new setId and the Image key is rewritten to a
prefix with no objects under it.

**Settings.** Three `localStorage` toggles described by what they enable rather than by who
sees the result — two of them print AI prompt text onto the **host's** screen, which may be a
projector. Nothing states the environment, the API base, or that the archive is shared across
all three tiers.

---

## 8. Dead and never-rendered state in `AdminPage.jsx`

Found by grep, not by opinion:

| Symbol | Line | Finding |
|---|---|---|
| `questionSetDeleteStatus` | `:58` | **Set in four places. Rendered in zero.** |
| `isDeletingQuestionSet` | `:59` | Set in two places. Read nowhere. No busy state. |
| `handleDeleteQuestionSet` | `:864` | Defined. Never called. |
| `alert(...)` on toggle failure | `:280`, `:284`, `:312`, `:314` | Native alerts for a failed Active/Quickstart toggle. |
| `window.confirm` on sign-out | `:124` | |
| Six independent status strings | — | `uploadStatus`, `deleteStatus`, `saveStatus`, `questionSetDeleteStatus`, plus `replaceStatus` and `versionStatus` in the editor. One of them is invisible. |

---

## 9. The redundancy summary

Stated plainly, in the form the host spec used.

**The same control is rendered twice.** The engagement type is one state behind two `<select>`
elements on one tab (§3.5). This is worse than a duplicated fact.

**The same object is described twice, in full.** Every field in the set list row — custom
instructions, AI context, prompt, round label, voice — is repeated, editable, in the editor
that opens below it. The list is an index that carries the whole book.

**The same kind of thing has three UIs.** Prompts (§7). Two more archive grids differ only by a
checkbox.

**Four vocabularies for state.** `active | draft | archived` for prompts, plus `inactive`
written only by the archive importer — a fourth value **no status filter in the UI matches**;
`active | inactive` for sets; `pending | hosts | admins | disabled` for users, displayed as
`Pending | Disabled | Admin | Host | Enabled` where `Enabled` is not a group and its filter
returns nothing; and `Status: active` on archive records, never displayed.

**Four search boxes, four behaviours.** Enter-key plus a button; form submit that round-trips
to a lambda that ignores it; live filter; and none at all.

**And one asymmetry that is the headline.** `DELETE /admin/question-sets/{setId}/versions/{n}`
answers **200 with the list of games pinned to that version instead of deleting**, and the UI
names those games and asks again. `DELETE /admin/question-sets/{setId}` — which removes every
version, every question and every category, and which decides permanently whether past sessions
can ever produce a report, because `create-report.js` reads the live set on demand — performs
**no such check**, asks "are you sure?", and writes its result into
`questionSetDeleteStatus`, which **is never rendered anywhere.** Success and failure are
indistinguishable: the modal closes either way.

**The most destructive action in the console has the weakest confirmation and no feedback at
all.** That is the finding this redesign is built around.

---

## 10. What this inventory does *not* claim

- `QuestionSetEditor.jsx` and `utils/questionSetEditing.js` are good. The diff payload, the
  named save confirmation, the version-delete flow and the "the previous version is kept"
  copy are all correct and are kept.
- The four AI builder configuration forms are fine. It is only what happens *after* Generate
  that is undesigned.
- The archive's `utils/archiveFiltering.js` is careful, well-commented work about a genuinely
  messy data shape, and its client-side filtering is a deliberate choice with a stated reason.
- `config/gameTypes.js` is the single source of truth it claims to be, including where it
  documents behaviour it disagrees with (surveys running a vote phase).
- `ArchiveManager.jsx` and `ArchiveSearch.jsx` were not read. They are single-line escaped
  garbage, not valid JS, and are excluded by instruction.
