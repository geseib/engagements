# Prompts and the Workie advisor live in Engage mode — design

**Date:** 2026-09-24 · **Status:** decisions taken by the owner in conversation; to build and put on dev

## What the owner hit

> "It gave good advice on validate quality, but you cant action that advice… when using the
> improve prompt button, also did what appear to be nice work, but it failed when i attempted to
> save it. I was in User mode. but it turns out when you switch to engage mode you cant even see
> the prompts from the admin page. so it seems that the workie advisor and ai prompts should be
> only in the engage mode for now. team admins could view them. perhaps later we let them copy
> and create them."

Confirmed causes (code read, then dev's logs):

1. **The save was refused.** Since `4a21b46d` (2026-08-24) a platform Workie may be changed only
   by a platform admin acting for no organisation (`tenant.js` `canManageScope(PLATFORM)`). In
   user mode every request carries `X-Engage-Org`, so `update-ai-prompt.js` answered 403 — in the
   log: `refused to let groups [admins] (org: org_55CB…/owner) update Workie "mskc5h7boibe5abg15"
   in platform`. The editor threw the server's reason away and showed a generic refusal.
2. **Engage mode has no Prompts section.** `consoleSections.js` `sectionsFor` leaves
   `SECTION.prompts` out of the platform group (a test pins the absence), so `AIPromptManager`
   never mounts there. Together with (1): **no screen can edit a platform Workie today.**
3. **Validate's useful half is never shown.** The model returns `issues[]` (severity, where, the
   fix); the dialog renders only the score, strengths and general recommendations. Optimize's
   results render nothing at all.
4. **Apply puts the rewrite in the wrong place.** The advisor reviews both halves as one string
   and returns one `improvedPrompt`; "Apply to Prompt" pastes it all into Output Format and leaves
   the old Instructions in place.
5. **The advisor does not know the save rules** (`describeAuthoringRules()`: no square brackets,
   the responses must be in the prompt, each variable once) — `ai-generate-prompt.js` does — so
   its rewrites can be refused on save. The editor's own help text even recommends square
   brackets.
6. **`populate-defaults.js` has no scope check at all**: any admin, in any mode, can overwrite
   Engage's library.

## Decisions (owner, 2026-09-24)

- Prompts and the Workie advisor are **Engage-mode only** for now.
- **Team owners and admins may view** the prompt library, read-only. Members do not get the
  section. Hosts keep choosing a Workie in session setup exactly as today.
- **Existing team Workies keep working, frozen**: they still drive their teams' sessions, show
  read-only, and nobody can edit or retire them until team copy/create is designed later.
- Copying/creating for teams: later, not now.

## Design

### Where the section appears (`src/src/config/consoleSections.js`, `AdminPage.jsx`)

| Console | Prompts section | Can change anything |
|---|---|---|
| Engage mode (staff) | yes | yes — the one place prompts are authored |
| Team, owner or admin | yes, read-only | no |
| Personal space (its owner) | yes, read-only | no |
| Team member | no | — |

`AdminPage` passes `readOnly = !onPlatform` into `AIPromptManager` and
`AIGenerationPromptEditor`. Read-only passes no action handlers, so `PromptLibraryPanel`'s
existing "no handler, no button" rule hides Create, Edit, Advisor, Copy to archive, Retire and
the status toggle; the Workie opens in a read-only view instead of the editor. A line at the top
says so in plain words: "Engage's AI prompts. Only Engage staff can change them." Each row shows
which library it is in (Engage, or your team) so a frozen team Workie is recognisable.

### The server enforces it (the screen is not the authority)

Every write route refuses a caller who is not a platform admin acting for no organisation —
`canManageScope(event, PLATFORM)` — with a 403 that says why ("Prompts are changed in Engage
mode"):

- `create-ai-prompt.js` (and its `save` route) — `createPromptRef` stops offering the org library.
- `update-ai-prompt.js`, `delete-ai-prompt.js`, the status toggle — platform rows only; an org
  row is refused (frozen), whoever asks.
- `ai-prompt-advisor.js` (POST) and `ai-generate-prompt.js`.
- `populate-defaults.js` — closes the gap in (6).

`GET admin/ai-prompts` is unchanged: session setup, the mid-session picker and the builders all
read it, and team Workies keep resolving at run time (`get-ai-summary.js` reads the org library,
then the platform one). `authorizer.js` drops `POST admin/ai-prompts` from the host routes.

### Save errors say what the server said

`AIPromptManager`'s `handleSubmit` reads the response body and shows the server's own reason. The
Output Format help stops recommending square brackets.

### The advisor: tick the advice, apply the ticked

One pattern for both lenses. **Review** (was Validate: safety, bias, clarity, technical) and
**Improve** (was Improve + Optimize: effectiveness, tightening) each return a checklist:

```
issues: [{ id, severity: "high"|"medium"|"low", half: "instructions"|"outputFormat"|"both",
           issue, fix }]
```

The dialog lists them with a checkbox each (high-severity ones pre-ticked), grouped by half, in
readable sentences. **Apply selected (N)** starts a second advisor job, `analysisType: "apply"`,
sent the two halves separately and only the ticked fixes; the model returns the two halves
rewritten — `{ instructions, outputFormat, applied: [id…] }` — under `describeAuthoringRules()`
and changing nothing it was not asked to. The dialog shows each half before and after, runs the
editor's preflight on the result, and **Use this** fills the editor's two halves (never pastes
both into one). The admin reviews and saves as usual. Optimize, which rendered nothing, is folded
into Improve. The advisor's model and async job are unchanged (Sonnet 4.6 first, Haiku fallback,
poll), and every advisor prompt now carries the authoring rules.

## Out of scope

- Team copy/create of Workies (the owner's "later").
- Migrating or retiring existing team Workies.
- The generation-prompt library's own editor beyond making it read-only outside Engage mode.

## Testing

Test-first, in the repo's style:

- **Sections:** `consoleSections` puts Prompts in the platform group; team owners/admins and a
  personal space's owner get it, members do not (update `consoleSections.test.js` /
  `consoleModes.test.js`, which pin today's absence).
- **Read-only:** `AIPromptManager` with `readOnly` renders no Create/Edit/Advisor/Retire/status
  controls and opens a Workie read-only.
- **Server:** each write route refuses an org-mode admin and a host, accepts an Engage-mode
  admin, refuses any write to an org row; `populate-defaults` refuses outside Engage mode; the
  list still returns org + platform rows to a team caller. Existing backend tests that pin
  org-authored writes (`org-authored-prompts.js`, `prompt-scoping.js`,
  `prompt-lifecycle-tenant-scoping.js`, `ai-prompt-lifecycle.js`, `host-ai-builder-routes.js`)
  change to pin the frozen rule instead.
- **Errors:** a refused save shows the server's message.
- **Advisor:** the analysis prompts ask for the checklist shape and carry the authoring rules;
  the apply job is sent only ticked fixes and both halves, and returns both halves; the dialog
  renders the checklist, sends only ticked ids, previews both halves, and "Use this" fills both
  editor halves.
- **With the model:** run Review and Improve on dev's live default Workie and apply two ticked
  fixes; the result passes the preflight and saves in Engage mode.
