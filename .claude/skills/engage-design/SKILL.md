---
name: engage-design
description: The Warm Summit design system as it actually shipped in this repo — colour tokens, the two themes, the four display profiles, the type ladders, the component library (Modal, Icon, CategoryPicker, StatusMessage, the qsets/adm/sp/um panel idiom) and the hard rules (container rule, dialog exits, measured contrast, CSS-contract tests). Use when building, restyling, reviewing or auditing ANY screen, panel, dialog or stylesheet under src/src/, when converting a paper-theme admin surface to dusk, when adding a new component stylesheet, or when asked to make a surface "look like the question set screens". Also use before writing any test that touches CSS.
---

# The Engage design system

Everything here is **derived from what shipped**, not invented. Every claim carries a
`file:line`. When a doc in `docs/design/` and the CSS disagree, the CSS is what runs —
the known disagreements are listed at the bottom of this file.

**The standard to match is the question-sets screen**
(`src/src/components/QuestionSetsPanel.css`). The owner holds it up as the one that got
the UX treatment. Copy its shape, not just its colours.

---

## 0. The five-minute version

Building or converting a laptop surface (admin console, host editing, dialogs):

1. **One stylesheet per screen**, in `src/src/components/`, with a header comment stating
   what the surface is, where it derives from, and the **measured** contrast ratios.
2. **Namespace every selector** under a scope class no other stylesheet uses
   (`.qsets`, `.adm-shell`, `.sp`, `.um`, `.wel-page`, `.entry-page`, `.plib`). Never
   declare a bare `.btn`, `.chip`, `.modal`, `.form-group` — `styles.css` owns those.
3. **Declare the theme on your root element**: `data-theme="dark"` for the console/stage,
   `data-theme="light"` for paper. Never inherit it — `public/index.html` puts
   `data-theme="light"` on `<html>` (`components/AdminShell.jsx:113-116`).
4. **Colour is tokens only.** `var(--text)`, `var(--muted)`, `var(--primary)`,
   `var(--danger-text)`. A raw hex is allowed **only** inside your own scope's token
   block, and only when `styles.css` has no token for it.
5. **Scope your own local tokens** (`--qsets-t-body`, `--adm-rule`). An undefined custom
   property invalidates the *whole* declaration, so never reach for a token declared in a
   stylesheet that merely happens to be in the bundle
   (`components/QuestionSetsPanel.css:58-63`).
6. **The ladder is 12 / 13 / 15 / 19 / 24 / 30 px** for laptop surfaces, rows 36px.
   Nothing below 12px. (`docs/design/admin-redesign/RATIONALE.md` §3.)
7. **Lists are tables, not cards.** Forty-one cards is a wall (RATIONALE §4).
8. **Every dialog gets an X *and* a bottom exit**, both routed through one
   `requestClose()` that confirms when work is unsaved.
9. **Measure the contrast, do not eyeball it** — add a `*Palette.test.js` that parses your
   stylesheet as text and composites the alpha layers.
10. **No geometric assertions in tests.** jsdom has no layout engine; every width and
    offset is zero and passes unconditionally.

Read the reference files for the detail:

| File | What is in it |
|---|---|
| `references/tokens-and-type.md` | Every token, both themes, the four display profiles, all the type ladders, the measured contrast tables |
| `references/component-library.md` | The mini design library: what exists, when to reach for it, copyable markup |
| `references/hard-rules.md` | The rules with their reasons and the incidents that produced them |
| `references/testing-a-surface.md` | The CSS-contract test pattern, copyable |

---

## 1. Colour

Two surfaces, one palette. **Dusk** is the default (`:root`, `styles.css:9-55`); **paper**
is `[data-theme="light"]` (`styles.css:58-66`); `[data-theme="dark"]`
(`styles.css:69-76`) exists so a container can re-enter dusk under a paper ancestor.

```
DUSK                              PAPER  [data-theme="light"]
--bg          #0F1A2E             --bg          #FBF7F1
--surface     #1B2942             --surface     #FFFFFF
--surface-2   #25375A             --surface-2   #F1EDE4
--text        #F4EDE4             --text        #1B2942
--muted       #9BA8BE             --muted       #5E6167

THEME-INVARIANT (declared once on :root, never redeclared)
--primary #F6A94C  --primary-deep #C77B4A  --secondary #7CA7E6
--success #4FB286  --danger #E5645E
--danger-text #EF8C86   destructive COPY      (styles.css:34)
--danger-deep #B03A34   filled destructive    (styles.css:35)
```

**`--danger` never carries text.** 4.38:1 on `--surface`, 3.56:1 on `--surface-2` — under
AA. It keeps borders, rules and bar fills. That is what `--danger-text` and
`--danger-deep` exist for (`styles.css:22-35`, RATIONALE §5). A filled `#E5645E` button
carries white at 3.32:1.

**`--primary` cannot carry text on white.** #F6A94C is 1.96:1 on white. On a paper
surface use the deep amber-brown the repo already settled on: `#9A5B18`
(`components/QuestionSetsPanel.css:592`) or `#8a5300` (`components/CategoryPicker.css:19,120`).

### How a component declares its theme

```jsx
// components/AdminShell.jsx:116 — the console chrome
<div className="adm-shell" data-theme="dark">
// components/WelcomeScreen.jsx:88, auth/AuthChrome.jsx:115 — same move
// components/GameReport.jsx:208 — paper, deliberately
<div className="report-container report-paper" data-theme="light">
```

`AdminShell` also passes the theme *through* to its work body, per section:
`<div className="adm-work-body" data-theme={contentTheme}>` (`AdminShell.jsx:196`).
`AdminPage.jsx:43-95` sets `contentTheme: 'dark'` per section — today only
`questionsets`, `games` and `users` have it.

### Re-tinting a scope for the other polarity

When a dusk-built component is mounted on a white card, do **not** rewrite it. Re-point
its tokens in one block — `components/QuestionSetsPanel.css:585-604` is the worked
example (`.qsets.qsets--onlight, .qsets--onlight .qsets`). Note the second selector: nested
components re-declare `.qsets` on themselves, so descendants must be re-tinted too or the
failure reappears one level down.

---

## 2. Type

**Laptop surfaces (admin console, host editing, dialogs) — one ladder, derived for one
person at 24in on a ~120 ppi panel, where 1px of cap height ≈ 0.86 arcmin:**

| token | px | job |
|---|---|---|
| floor | 12 | counts, chip text, timestamps. Glanced, never read in runs. |
| label | 13 | field labels, column heads, secondary row text |
| **body** | **15** | rows, values, prose, **and every input** |
| head | 19 | panel headings |
| title | 24 | screen title |
| numeral | 30 | the one display number a panel is allowed |

Declared as scoped locals: `--qsets-t-floor` … (`QuestionSetsPanel.css:53-57`),
`--adm-t-*` (`AdminShell.css:56-61`), `--sp-t-*`, `--um-t-*`. Rows are **36px**.
**Never below 12px.** **Inputs render at body (15px), never at label** — a 13px input
producing 15px table text is how a dense console ends up illegible where a mistake is
most expensive (RATIONALE §3.2).

**The stage is different and its numbers must NOT be imported here.** The host stage has
**four literal ladders, not one ladder times a scalar** — `styles/stage.css:43-86`,
`config/displayProfile.js`. Revision 1 used a `--k` multiplier declared on `:root`, which
substituted against `:root`'s own value of 1, so all four profiles rendered identically.

| profile | class | floor | derived for |
|---|---|---|---|
| Room | `.d-room` | 20px | projected ≥90in, ≤30ft, ~20ppi (default) |
| TV | `.d-tv` | 26px | ~65in panel, ≤20ft, ~30ppi |
| Call | `.d-call` | 20px | screen-share; the **encoder** is the constraint, so it keeps Room's ladder and changes treatment only (`--hair:2px`) |
| Table | `.d-table` | 16px | laptop, 2–4ft, ~120ppi |

Only Table is auto-detectable (viewport < 1600px). A stored choice always wins
(`config/displayProfile.js:57-72`). Entry and welcome surfaces get **one** ladder each,
not four: `--entry-t-*` (`components/RootPage.css:30-36`), `--wel-t-*`
(`components/WelcomeScreen.css:38-43`) — a phone at 14in and a laptop at 20in land within
half an arcminute of each other.

---

## 3. The component library — what exists, and when to reach for it

Full detail and copyable markup in `references/component-library.md`.

| Reach for | When | Where |
|---|---|---|
| **`Modal`** | Any dialog. Owns Escape, Tab trap, scroll lock, focus restore, DOM-containment topmost. Class names are props, rendered verbatim. | `components/Modal.jsx` |
| **`Icon`** | Every glyph. Phosphor wrapper; unknown names fall back to `Circle`. `weight`: `duotone` hero / `bold` UI (default) / `fill` status. | `components/Icon.jsx` |
| **`StatusMessage`** | Inline success/error/pending banner. Tone derived from the text by `utils/statusTone.js`, not from an emoji in the copy. | `components/StatusMessage.jsx` |
| **`CategoryPicker`** | Any category choice. Type-to-filter combobox with counts, inline `+ New category`, 24-cap refused **with its reason**. | `components/CategoryPicker.jsx` |
| **The `.qsets` idiom** | A list screen: table + chips + two empty states + filter drop-exits + creation panel + confirm dialog. | `components/QuestionSetsPanel.css` |
| **The `.adm-*` chrome** | Console shell: brand, breadcrumb, env chip, left nav with badge/count, work head, the one scrolling region. | `components/AdminShell.css/.jsx` |
| **`RoundKindPicker`, `GeneratedItemsTable`, `GenerationJobPanel`, `RemoteQuestionBrowser`** | Already-namespaced pieces; extend rather than re-cut. | `components/*.css` |

**Never build a second modal shell.** `docs/design/admin-container-rule.md` counts twelve
that already exist. One `<Modal>`; variants are props.

**Never open a modal from inside a modal.** Inline the second step instead — that is why
`CategoryPicker` creates a category by turning its own row into a text input
(`admin-container-rule.md:68-69`).

---

## 4. The hard rules

Reasons and incidents in `references/hard-rules.md`. Short form:

1. **Container rule.** Make/edit one thing → Modal. Confirm/destroy → Modal, small. Long
   multi-step → Modal, full-height. **Stay inline** only when a modal would cover the
   thing being judged. Appending a form below the list and scrolling to it is *the*
   rejected pattern. A list and its detail are **two places, not two sections**
   (RATIONALE §2).
2. **Every dialog needs an X *and* a bottom exit**, both through one `requestClose()`.
   Commit `4fd425d6`: the host's set editor had a Cancel only at the foot of the first of
   four panels, an inert backdrop, and Escape gated on `!editorDirty` — with an edit in
   hand there was no way out at all. A dead X is the control people reach for first, so
   gate the affordance on the handler existing, never render one that does nothing.
3. **Escape is gated on unsaved work, not disabled.** `closeOnEscape={() => !dirty}`.
   Deliberately-dead controls are allowed but must be *decisions*: the delete dialog's X
   is dead while a delete is in flight, because a live one would unmount the only surface
   that can report the outcome.
4. **Contrast is measured, never eyeballed**, and composited **up the ancestor chain**.
   Reading only the element's own background is how dark-on-dark passes an audit. AA is
   4.5:1. No black-lift model on laptop surfaces — there is no projector there.
5. **Never state a *fact about one object* twice in a viewport.** A dimension appearing as
   both a control and a value is not redundancy (RATIONALE §4).
6. **Never show an empty state that lies.** "Nothing exists" and "nothing matches your
   filters" are two different situations with two different exits.
7. **A reduction with no recovery is a deletion.** Truncate only with `title=` carrying
   the full string.
8. **The `text-overflow` trap.** A truncating element must be a **single text node with
   `min-width: 0`**, never a flex container with span children — `text-overflow` is inert
   there and the text is silently cut. (`AdminShell.css:229-238`.)
9. **Never align a row's action group with `justify-content: flex-end`** inside an
   `overflow: hidden` cell. Use `margin-left: auto` on the first child, plus `flex-wrap`.
   Flex-end overflows toward the *start*, where a hidden overflow is unreachable.
   (`QuestionSetsPanel.css:291-307`, `__tests__/rowActionsReachable.test.js`.)
10. **A scrim scrolls and does not centre with the flex container.** `align-items:
    flex-start` + `overflow-y: auto` on the scrim, `margin: auto` on the card,
    `padding` for breathing room. `align-items: center` on a scrolling scrim overflows in
    *both* directions and only one is reachable. This bug has recurred four times.
11. **`table-layout: fixed`** on every table. Under auto layout declared widths are hints
    and a nowrap chip sets a min-content width that grows the whole table.
12. **Destructive dialogs state the consequence, not the severity**, and **offer the
    reversible neighbour** (RATIONALE §8). Type-to-confirm exactly twice in the console.
13. **No geometric assertions in tests.** jsdom has no layout engine.

---

## 5. How to test a surface's design

jsdom loads no stylesheet and resolves no custom property, so **the only honest way to
pin a design contract here is to read the stylesheet as text and do arithmetic on it.**
Three shipped exemplars, copy whichever fits:

| Pattern | Exemplar |
|---|---|
| Palette: composite the real paint stack, assert AA on every pairing and every tint | `src/src/__tests__/questionSetsPalette.test.js` |
| Ladder + token arithmetic with no DOM at all | `src/src/__tests__/adminShellPalette.test.js` |
| Behaviour rendered + CSS declarations read by selector | `src/src/__tests__/welcomeScreen.test.jsx` |
| Reachability contracts (scrims, row actions) | `src/src/__tests__/modalReachability.test.js`, `rowActionsReachable.test.js` |

Name the file `*Palette.test.js`, **never `*Token*`** — `.gitignore:35` is an unanchored
`*token*`, so a file named for tokens is invisible to git: it passes locally and never
reaches CI.

A new screen's palette test should assert, at minimum:

- every flat pairing clears 4.5:1, composited from the real ancestor stack;
- every **tinted** composite clears 4.5:1 (a tint is invisible in a token table);
- `AdminPage.jsx` passes the matching `contentTheme` — **the markup and the theme convert
  in the same change, or the surface renders at 1.4:1**;
- no hex literal survives outside your token block;
- `color: var(--danger)` appears nowhere;
- every `var(--x)` the sheet uses is declared somewhere;
- every selector is rooted at your scope class, **and** `styles.css` declares nothing in
  that scope (both halves — `.qs` collided once already);
- nothing below the 12px floor; the row height is 36px.

Full copyable harness in `references/testing-a-surface.md`.

---

## 6. Where the design docs and the shipped CSS disagree

Trust the CSS; these are the live discrepancies to know about.

| Doc says | Shipped says |
|---|---|
| RATIONALE §5 and the entry RATIONALE §4 both use `--muted #B6C2D4` | `styles.css:15` ships `#9BA8BE`. `AdminShell.css:48-51` names the divergence and chooses the shipped value on purpose; `RootPage.css:23` keeps `#B6C2D4` as its own `--entry-muted`. Two muted greys are live. |
| RATIONALE §5 table lists `--success-text #6FD0A4` as a token | `styles.css` has never declared it. Every screen redeclares it locally (`--qsets-success-text`, `--sp-success-text`). |
| `admin-container-rule.md:28` — "make or edit one thing → Modal" | RATIONALE §10 rejects a modal for the **set editor** (four panels + two tables), and `AdminPage.jsx:975` renders it as a full-work-area place. The same component *is* a modal on the host shelf. The real rule: a detail with panels and tables is a place in the console and a modal only where there is no console. |
| RATIONALE §5 says the two new danger tokens "should be folded back into `warm-summit-design-spec.md`" | That file does not exist in this repo. `styles.css:22-35` is the authority. |
| `docs/design/admin-redesign/18-prompts.html` / `19-prompt-editor.html` draw Prompts as a `.tbl` list plus a full-page editor with a breadcrumb | Shipped: `PromptLibraryPanel` **is** the table (paper-toned), but the editor is still a hand-rolled modal (`AIPromptManager.jsx:466`). |
| RATIONALE §12 and RESUME refer to `audit.js` | The file is `docs/design/admin-redesign/audit.html`; there is no `audit.js` there. (The entry and host redesigns *do* each have an `audit.js`.) |
| `AdminShell.css:38` cites `__tests__/adminShellTokens.test.js` | Renamed to `adminShellPalette.test.js` for the `.gitignore` reason above. |

---

## 7. Where a surface stands today

`docs/design/AUDIT.md` holds the repeatable checklist and a per-surface table of every
significant screen against every rule in this skill, with `file:line` for each failure.
Run through it before claiming a surface is converted, and update it when you convert one.
