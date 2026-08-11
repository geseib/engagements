# The Admin console — plan

**Date:** 2026-08-10
**Owner ask:** *"its interface is all over the map and not aligned with the rest of the app. So a great UX makeover is in order. But there are a few other mechanics that could use some work."* Plus: fix bugs, add needed capabilities, **no major uplift items**, and get design-critic and tester feedback before deploying.

**Grounding:** `docs/design/admin-redesign/` (22 mockups, `RATIONALE.md`, `OPEN-QUESTIONS.md`, `INVENTORY.md`) and a fresh audit of the code at `31547218`.

> `INVENTORY.md`'s line numbers are from a 1,769-line `AdminPage.jsx`; it is **1,805** today, so its refs run ~36 low. Its *findings* hold; its *numbers* do not.

---

## The order, and why it is this order

Four waves. The first two are the "mechanics" the owner named and are almost entirely invisible — they are also what makes the visible work worth doing, because a beautiful prompt editor on top of a save path that duplicates records is decoration.

| Wave | What | Why here |
|---|---|---|
| **A** | The prompt tooling — the variable contract | The owner's stated complaint. Small, mostly backend, and it unblocks authoring anything |
| **B** | The AI output contract and the renderer | The owner's second ask. Includes an XSS fix that should not wait |
| **C** | The shell — left nav, breadcrumb, env chip | Every mockup sits inside it. Two agents touching it collide, so it goes alone |
| **D** | The tabs, extracted one at a time, each with its own defects | Only safe after C |

---

## Wave A — the variable contract

### A1. One source of truth for what a variable IS

Today there are **three** lists and they disagree:

| List | Where | State |
|---|---|---|
| The chip palette | `AIPromptManager.jsx:41-404`, 49 entries | **Correct** — all 49 exist |
| The wand's list | `ai-generate-prompt.js:6-30`, keyed by game type | **Wrong**: 3 of 5 keys never match, and `wavelength` names 5 variables that do not exist |
| The advisor's list | `ai-prompt-advisor.js` | **Does not exist** — it is asked to "validate variable usage" while being told nothing |

Reality is the 68 keys of `templateVars` in `get-ai-summary.js:1966-2087`.

**Build `lambda-functions/game/template-variables.js`** — one exported catalogue: `{ name, description, category, gameTypes, example }`, the chip palette's shape, since that is the one that is right. Every consumer reads it:

- `ai-generate-prompt.js` — replace the hardcoded table entirely
- `ai-prompt-advisor.js` — inject the real list into all three prompt variants
- `AIPromptManager.jsx` — import rather than redeclare
- A test that **every catalogue entry exists in `templateVars`**, and that every `templateVars` key is either catalogued or explicitly marked internal. This is the test that stops the three lists diverging again.

### A2. Fix the key mismatch — the one-line bug

`ai-generate-prompt.js:79` — `TEMPLATE_VARIABLES[gameType]` with `gameType` arriving dashed. Route it through `normalizeGameType`, and **fail loudly on an unknown type** rather than silently yielding `[]`. An empty variable list must never reach the model while the instructions tell it to use one.

### A3. Validate placeholders — three gates, cheapest first

1. **Author time.** `AIPromptManager` marks unknown `{tokens}` in the textarea and lists them under it. Non-blocking; a warning, not a wall.
2. **Save time.** `create-ai-prompt.js` and `update-ai-prompt.js` reject a prompt containing a `{token}` that is not in the catalogue, naming each one. This is the gate that matters, because it is the one the wand and the advisor both pass through.
3. **Run time.** `get-ai-summary.js` scans for surviving `{tokens}` after substitution and **logs them**. Left literal as today — changing that is a behaviour change on live prompts — but no longer silent, and surfaced in `debugInfo`.

### A4. The palette bugs

- `AIPromptManager.jsx:705` iterates a hardcoded header list that omits `'Wavelength'` and includes a `'Context'` that no variable declares. **All 6 wavelength variables are unreachable.** Derive the headers from the catalogue.
- The filter's category dropdown (`:1249-1256`) offers only call-and-answer categories. Derive per game type, as the editor's select already does.
- Advertise the 19 real-but-uncatalogued variables, or mark them internal. `pollOptions` is the notable gap — a poll author cannot reference the options.

---

## Wave B — the output contract and the renderer

### B1. Tell prompt authors what the screen can actually draw

`buildOutputContract()` mandates headings and says nothing about formatting. Meanwhile `MarkdownRenderer` supports **headings (H1-H3 only), lists, bold, italic, inline code and tables** and silently drops everything else — H4-H6, links, images, blockquotes, fenced code, horizontal rules, nested lists, task lists, strikethrough — each rendering as literal source text on a projector.

It also has an **undocumented affordance**: a list item written `**Lead**: detail` splits into a headline over a caption on the big screen (`MarkdownRenderer.jsx:88-99`). Nothing tells anyone.

Add a formatting block to the contract stating what is supported, what is dropped, and the `**Lead**: detail` idiom. This is the owner's *"good formatting instructions so that what the AI outputs can be easily formatted nicely"*.

### B2. Harden the renderer

- **Sanitise.** `formatInlineText` ends in `dangerouslySetInnerHTML` with unsanitised model output. Escape HTML before inserting markup. **This is a security fix and leads the wave.**
- Support `####`-`######`, links, blockquotes and horizontal rules; render fenced code as code rather than parsing its contents as markdown.
- Fix the table false positive: any line containing a `|` currently becomes a table.
- **Render the fallbacks through the renderer too.** When `markdownResponse` is absent, `GameHostPage.jsx:3978` and `:4548` print raw strings, so `**bold**` shows as asterisks on a projector.

---

## Wave C — the shell

Left vertical nav, top bar, breadcrumb, **environment chip** (the console has never said which of the three environments it is talking to). Per `RATIONALE.md:53-61`, the load-bearing decision is that **a list and its detail are two places, not two sections** — that is what kills the five-paragraph row, the accordion upload, and the yellow `element.style` flash at `AdminPage.jsx:187-191`.

Adopt the designers' type ladder (12/13/15/19/24/30) and their `--danger-text` / `--danger-deep` additions — `--danger` at 4.38:1 on `--surface` is **under AA** and the console has no projector black-lift to hide behind.

Drop the parallax hero and its three Webflow CDN images from an authenticated operator console. *(The designers ask to be argued with here; the owner has an open question on it — flag, do not decide unilaterally.)*

---

## Wave D — the tabs

Extracted one at a time, each carrying its own defects.

**Users** — three functions (`approveUser`, `updateUserStatus`, `deleteUser`) call routes that do not exist and are wired to nothing; the Enabled/Disabled badges count one predicate while the filter matches a value that is not a Cognito group, so the tab always renders empty under a non-zero badge; Created is always `N/A` (`created` vs `createdAt`); Provider always says `cognito`; "Load More" can never fire because `listUsers` discards the request body. `UserManagement.jsx:21` also **hardcodes a dev API Gateway id as its fallback** and bypasses `authFetch`.

**Sessions** — there is no list. `GET /games` is deployed and admin has never called it. To delete a session you must know an id the console never shows you.

**Question sets** — 446 inline lines. The detail view is the point of Wave C. `questionSetDeleteStatus` is set six times and rendered zero times, so a **failed delete looks identical to a success**; `isDeletingQuestionSet` is never read; `handleDeleteQuestionSet` is dead; the empty state points at an upload form that is below it and collapsed.

**Generation jobs** — partial failure renders as success in all four builders. The job dies, `partialItems` populate the review UI, `Generation failed:` is written to a field that branch never displays, and "Load into System" is live. `RATIONALE.md:239` says this is the piece to ship first and needs **zero backend**: the job outlives the modal, show `completed/requested`, an indeterminate bar (a determinate one would be inventing motion), no Cancel with the reason stated, and partial failure named with three real outcomes.

**Settings** — three localStorage toggles. Gains the environment block.

---

## Out of scope, and why

- **Archive** — blocked on the owner's ruling. The service is public and unauthenticated, shared across all three environments, **including DELETE**, and is not in this repo. `RATIONALE.md`: *"No UI fixes it."*
- **Prompts as a merged library** — blocked on `POST /admin/ai-prompts/save` aliasing create, which makes editing a generation prompt **duplicate the record**. Wave A fixes the variable contract; the library merge is its own decision.
- **The `/builder` route** — the designers cut it deliberately.
- **Survey** — cannot be played; it is a product decision, not a console one.
- Anything needing a new backend contract: set-delete consequence data, job cancellation, report snapshots.

## Verification

Each wave: unit tests naming what they reject, a **design critic** pass against the mockups, and a **tester** pass driving the real console. `docs/design/admin-redesign/audit.js` is 6 assertions × 22 mockups × 2 viewports and every check was demonstrated failing before it was trusted — reuse it against the built screens.

Baselines to hold: backend **29 suites / 983 / 0**; frontend **5 failed suites / 30 failed / 768 passed**.
