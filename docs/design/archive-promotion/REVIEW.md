# Archive as a promotion path: a usability review

**Date:** 2026-11-05
**Job:** move four trivia sets (`aroundtheworldgeographyadventure`, `spacecosmiccuriosities`,
`techtoystomorrow`, `musicpopcultureencore`, 60 questions and 6 categories each) from dev to
test and then prod, using only the app's Archive screen, the way an Engage admin would.
**How:** real Chromium driven by Playwright. Signed in as a temporary admin on each tier. Every
click below is a real click on the deployed site. Read-back ran in-process against DynamoDB and
the app's own list handlers.
**Evidence:** screenshots are in
`/tmp/claude-0/-home-user-engagements/5d28207d-9725-5ad9-936c-89dd5e908516/scratchpad/archive-qa/shots/`
(abbreviated below as `shots/`). Screen text, network bodies and read-backs are in the folder
above it.

## Outcome

| Tier | What happened | Read-back against the CSV and dev |
|---|---|---|
| dev | Exported 4 sets. The archive returned ids `4ba6b81b…`, `15e385c8…`, `9942f39a…`, `41294876…` | n/a (source) |
| test | Restored 4, each marked "recreated", v1, active | 240/240 questions and 24/24 categories. 0 mismatches. Every content row is byte-equal to dev's apart from PK |
| prod | Same | Same, 0 mismatches |

**It works.** The full-fidelity design (spec 2026-09-14) does what it says. Ids are kept, no
suffixes are added, `active`, `topic`, an empty persona and an empty quickstart all carry over,
category order is kept, and each version note records the archive id, the export time and the
source tier. The sets appear in Engage's Shared library and in the host picker on both tiers.

## The path an admin takes

### Export on dev: 11 clicks

| # | Click | Screen |
|---|---|---|
| 1–2 | "Sign in" link, then the Sign in button | `shots/dev-21-home.png` (has a DEV tag) |
| 3 | Library & team | lands in the **personal space**, not in Engage |
| 4 | **Engage** (switcher, top right) | `shots/dev-22-engage-mode.png` |
| 5 | Archive (left rail) | `shots/dev-23-archive-before.png` |
| 6 | Export from dev… | `shots/dev-24-export-dialog.png` |
| 7–10 | tick each of the four sets in a list of 37 sets and 56 prompts | `shots/dev-25-export-picked.png` |
| 11 | Export 4 sets | `shots/dev-27-export-report.png`: "Backed up 4: …" |

### Import on test or prod: 13 clicks (14 including the check that follows)

| # | Click | Screen |
|---|---|---|
| 1–2 | Sign in | `shots/test-41-home.png` (TEST tag). On prod the home page is an older build: "Admin console", not "Library & team", and **no tier tag** (`shots/prod-72-FAIL.png`, first attempt) |
| 3 | Library & team / Admin console | personal space again |
| 4 | Engage | |
| 5 | Archive | `shots/test-43-archive.png` |
| 6–7 | Environment filter = dev, Engagement type = Trivia | `shots/test-44-archive-filtered.png` (19 of 46 shown) |
| 8–11 | tick the four rows | `shots/test-45-archive-picked.png`: "Importing 4 items into test" |
| 12 | Import 4 selected | `shots/test-46-import-confirm.png`, `shots/prod-76-import-confirm.png`: "Restore 4 backups into prod?" |
| 13 | Restore 4 | `shots/test-47-import-report.png`: "Now live for every organisation: …" and "Restored 4: … (recreated)" |
| 14 | Shared library, to check | `shots/test-48-shared-library.png`: **still says 20 sets, and none of the four is listed** |

Promoting four sets to two tiers took 11 + 13 + 13 = **37 clicks** across three sign-ins, plus a
reload on each target tier before the result could be seen.

## What was confusing or slow

1. **Every visit starts in the wrong place.** Library & team opens the personal space. The
   Archive appears only after the admin finds the "Engage" switch, top right. Nothing on the
   personal space says that the Archive exists or where it is.
2. **The export picker cannot be searched.** It is one long list of 37 sets and 56 prompts. It
   is not alphabetical by the name shown: "Music & Pop Culture: Encore!" sits between "Lessons
   from the Tech World" and "Historic World Leaders…". It shows no set id, no active/inactive
   state and no topic. It does not say whether a set was already backed up, or when.
3. **The archive list mixes old and new.** Of 46 items, 19 match dev + Trivia. The list
   includes CSV-era duplicates ("80s Trivia (dev)" twice). The Exported column shows the day
   only, so four snapshots taken today look the same as four taken this morning. The only way to
   tell the new snapshots from older ones with the same title is the "Latest of N backups" chip,
   which shows only when there is more than one.
4. **The heading is doubled.** "Archive / Backups of Engage…" in the banner, then "Archive / One
   shared store, all environments." again directly below it.
5. **Two of the steps are hidden from the admin's view.** Finding the right snapshot on the
   target tier means remembering the titles you exported. Nothing links an export on dev to the
   matching import on test.

## Errors and dead ends

- **No functional error.** Export and both imports returned 200 with no failures.
- **The Shared library is stale after an import.** In the same session, straight after "Restored
  4", Shared library showed 20 sets and none of the four (`shots/test-48-shared-library.png`).
  After a fresh sign-in it showed 24 on test (`shots/test-56-shared-library-fresh.png`) and 22 on
  prod (`shots/prod-86-shared-library-fresh.png`). An admin checking their work would conclude
  that the import had failed.
- **The prod home page differs from dev and test.** The first prod run failed at "Library &
  team" because prod's home calls it "Admin console". The Engage switch also has a badge count
  ("Engage 2"). An admin following written steps from test would get lost on prod.
- The browser console logged one 403 on test while the console reloaded, plus a few "Failed to
  fetch" messages from requests that were cut off by navigation. None of them affected the
  flow.

## Is it clear which environment you are in and writing to?

**Mostly, yes, inside the Archive.** The top bar carries a DEV / TEST / PROD tag. The buttons say
"Export from test…". The selection panel says "Importing 4 items into test". The confirm dialog's
title names the tier: "Restore 4 backups into prod?". Each row has a "From" chip.

**Weak spots:**
- The prod confirm dialog looks exactly like the test one. It has the same orange button, no
  extra friction, no prod colour and no typed confirmation, for a write that it says makes the
  sets "live for every organisation the moment it is restored".
- The prod home page has no tier tag.
- The tier tag is small and grey, in the corner. The dialog body never repeats the tier.

## Bulk or one at a time?

Both screens are bulk: there are checkboxes and "Select all" on export, and checkboxes and
"Select all shown" on import. But there is **no way to carry a selection across**. The four sets
picked on dev had to be found and ticked again by title on test, and again on prod. That is
three separate selections of the same four things.

## Do settings carry over?

**Yes, fully.** Checked field by field against dev: `name`, `description`, `active` (true),
`topic` (geography-travel, science-technology ×2, music), `personaId` (none, so the default
trivia prompt), `engagementType`, `customInstruction`, `aiContextInstruction`, `isAIGenerated`,
`hasImages` and category order. Each set was **written as a new set under its original id**
("recreated", v1, one `versions[]` entry). It was not a version of an existing set, because none
existed. The import added `restoredFrom {archiveId, exportedAt, scope, setId, tier}`,
`restoredBy` and `restoredAt`.

The screen does not tell the admin any of this. It never shows which settings went across, and
"recreated" is the only hint that this was a new set and not a new version.

## Does a read-back or confirmation exist?

- **Before the import:** the confirm dialog states the general rules (an existing set gets a new
  version, and active sets go live). It does **not** list the items, say which already exist on
  this tier, or say which will become active. There is no diff.
- **After the import:** the report lists "Now live for every organisation" and "Restored N: name
  (recreated | new version vN)". That is good and honest. But there are no counts (questions or
  categories), no link to the restored set, and no check against the snapshot. The one place an
  admin would go to check, Shared library, is stale until reload.
- **Audit:** the `restoredBy` on each set names the account that did it. Here that account was a
  temporary one, since deleted, so the provenance on these eight rows points to a user that no
  longer exists. Nothing in the UI shows who promoted what, or when.

## Improvements, ranked

1. **"Promote to test / prod" on the set (and on a multi-select in Shared library).** One
   action exports and imports. Why: it turns 37 clicks and three sign-ins into one decision, and
   removes the re-find-by-title step where a wrong pick is most likely.
2. **A pre-import diff per item: "new set" vs "new version of vN (live)", question/category
   counts, and active on arrival.** Why: today's confirm states rules in the abstract, and the
   admin cannot see whether they are about to overwrite a live set until afterwards.
3. **A post-import check: re-read each restored set, show its question and category counts
   next to the snapshot's, and link to it.** Also invalidate the Shared library cache. Why: the
   only check available today said 20 sets when there were 24, which reads as failure.
4. **A stronger confirmation on prod.** Use a prod-coloured dialog that names the tier in the
   body and the button ("Restore 4 into PROD"), and ask the admin to type "prod". Why: it is the
   one write that publishes to every customer organisation, and it looks identical to test.
5. **Searchable, sortable export picker with id, state and "last backed up".** Why: 93 unsorted
   rows with no search is where the wrong set gets ticked, and a "last backed up 2 min ago" column
   tells the admin whether a fresh export is needed.
6. **Carry the selection: after export, offer "Copy these archive ids" or a "Show this batch"
   filter, and give the archive list a "Batch / exported at hh:mm" column.** Why: the import side
   can then find exactly what was just exported, with no title matching.
7. **Open the console in Engage mode for staff, or put an Archive link on the personal space.**
   Why: two of the clicks on each tier are pure navigation to a mode the admin always needs here.
8. **A promotion audit trail: who exported and restored what, from which tier to which, and when,
   listed on the Archive screen.** Why: it is the only reliable record of what reached prod, and
   `restoredBy` alone dies with the account.
9. **Keep prod's frontend in step, or at least use the same labels and the tier tag on its home
   page.** Why: written steps that work on test fail on prod at the second click.
10. **Tidy the archive list.** Show time as well as date, hide or collapse CSV-era duplicates by
    default, and remove the doubled "Archive" heading. Why: less to scan on every promotion.
