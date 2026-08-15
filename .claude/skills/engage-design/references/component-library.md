# The mini design library

What exists, when to reach for it, and the markup to copy. Nothing here is proposed —
every entry is shipped code with a `file:line`.

---

## 1. Primitives

### `Modal` — `src/src/components/Modal.jsx`

**Every dialog routes through this.** It owns *behaviour*, not one class name: the overlay
and content class names arrive as props and are rendered verbatim, because `.qsets-scrim`,
`.new-game-overlay` and `.modal-overlay` carry z-index, palette and geometry that several
tests read straight out of the stylesheets.

What you get for free (none of which the four hand-rolled dialogs had):

| | how |
|---|---|
| Escape | `document` listener, answered by the **innermost** modal only |
| Tab trap | including "Tab from outside lands inside" |
| Scroll lock | **reference-counted**, so the last modal out restores the scrollbar |
| Focus restore | back to whatever opened it |
| ARIA | `role="dialog"`, `aria-modal`, `aria-labelledby` / `aria-label` |

```jsx
<Modal
  overlayClassName="qsets-scrim"
  contentClassName="qsets-modal"
  onClose={requestClose}                     // ONE canonical close
  closeOnBackdrop={false}                    // true | false | () => boolean
  closeOnEscape={() => !dirty}               // gated on unsaved work
  labelledBy="qsets-delete-title"            // or label="…"
>
  …
</Modal>
```

Three things that are deliberate and must not be "tidied":

- **No portal.** `new-game-overlay → qsets-scrim--over → qsets-scrim` nest three deep and
  the inner two are DOM *descendants*. That containment is load-bearing twice: the light
  theme reaches inner dialogs through `.qsets--onlight .qsets`, and the inner scrims'
  clicks are stopped by the outer content's `stopPropagation`.
- **Topmost is decided by DOM containment, not mount order.** React runs child effects
  before parent effects, so a modal mounting with a nested modal already open would
  register the inner one first.
- **It does not move focus on mount.** Pulling focus off whatever the host was typing in
  is a visible change; this primitive was a behaviour-preserving pass.

Current consumers: `QuestionSetDeleteDialog`, `HostQuestionSetsDialog`, `QuestionsPanel`,
`AnswerSpotlight`, `GameSetupDialog`, `QuestionSetEditor`, `PastRound`,
`QuestionPullDialog`. Everything else is still a raw overlay `div` — see
`docs/design/AUDIT.md`.

### `Icon` — `src/src/components/Icon.jsx`

Phosphor wrapper. Icons are **named imports** so webpack tree-shakes to only the ~90 in
`ICONS`; add a new one to the map. An unknown name falls back to `Circle`, so a typo never
crashes — which is why `designSystem.test.jsx:17-23` asserts every map entry resolves.

```jsx
<Icon name="Trophy" weight="duotone" color="var(--primary)" size={32} />
```

Weight discipline: **`duotone`** feature/hero icons, **`bold`** inline UI controls
(default), **`fill`** status dots.

Every icon carries `.ws-icon` (`styles.css:84-87`), which nudges to optical centre
(`vertical-align: -0.15em`) and sets `flex: none` so a flex row cannot squash it.
`styles.css:88-101` gives a 1em box to wrappers that size with `font-size` — an SVG
ignores `font-size`, and Phosphor writes width/height as inline presentation attributes
that CSS beats.

### `StatusMessage` — `src/src/components/StatusMessage.jsx`

Inline success / error / pending banner. **Tone is derived from the message text**
(`utils/statusTone.js`), not from an emoji embedded in the copy — the old sniffing for ✅
and ❌ broke the moment anyone reworded a message.

```jsx
<StatusMessage message={status} />              // tone inferred
<StatusMessage message={status} tone="error" /> // when the caller knows
```

Renders `role="status" aria-live="polite"`. `statusColor()` returns `var(--danger)` /
`var(--muted)` / `var(--success)` — note that on a paper surface `--success #4FB286` is
only 2.10:1 on the `.status-message.success` `#d4edda` ground, which is why
`.qsets--onlight .qs-editor` restates `--success: #1C7350`
(`QuestionSetsPanel.css:672-675`).

### `CategoryPicker` — `src/src/components/CategoryPicker.jsx` + `.css`

A type-to-filter **combobox, not a `<select>`** — sets run five to twenty categories and a
plain select is a scroll (`admin-container-rule.md:61-70`). It shows counts
(`Strategy · 12`), pins `+ New category` at the bottom **created inline**, and hard-caps at
24 **with the reason stated**.

Three rules it embodies, all worth copying:

- **It owns no logic.** Every fact comes from `utils/questionCategories.js`, which is
  mutation-tested against the real `upload-questions.js`. A second implementation of "what
  will Save produce" is a second thing to drift, invisibly.
- **The counts are the working copy's**, never `set.categoryCount` (a stale integer from
  the last save) and never `GET …/categories` (the persisted version).
- **Refusal states its mechanism.** Category 25 never reaches a host mask
  (`schema-compliant-manager.js:211`), so it is accepted, stored and silently inert. The
  picker refuses it and says why.

Its CSS deliberately uses **literals, not tokens** (`CategoryPicker.css:24-26`): it renders
in component tests where `styles.css`'s `:root` is not loaded. That is a documented
exception, not a precedent for new dusk surfaces.

---

## 2. The `.qsets` idiom — the list screen

`components/QuestionSetsPanel.css` + `QuestionSetsPanel.jsx`. **One stylesheet for three
components** (list, creation panel, dialog) on purpose: they are one screen sharing a token
block, a row height and a button set, and splitting them means three copies of the token
block that can drift.

### The pieces

| class | job | line |
|---|---|---|
| `.qsets` | scope root; declares the ladder, the rules, the tints | 52 |
| `.qsets-alert` / `--error` / `--success` | dismissible message strip | 93-127 |
| `.qsets-filters` / `-search` / `-input` / `-select` / `-count` | filter row with a leading search icon | 134-156 |
| `.qsets-btn` + `--sm/--lg/--primary/--danger/--ghostdanger/--dangersolid/--link` | the whole button set | 158-207 |
| `.qsets-head` / `-head-grow` | title row with trailing actions | 209-216 |
| `.qsets-tbl`, `.qsets-col-*` | `table-layout: fixed`, sticky head, 36px rows | 220-262 |
| `.qsets-nm` / `.qsets-sub` | the truncating name + description pair | 267-285 |
| `.qsets-rowact` | row action group | 291-307 |
| `.qsets-chip` + `--type/--on/--off/--warn/--bad` | state chips; `button.qsets-chip` for toggles | 309-330 |
| `.qsets-empty` | "nothing exists" poster, centred, with ranked paths | 334-346 |
| `.qsets-nomatch` / `-drops` / `-drop` | "nothing matches", **left-aligned**, with per-filter drop-exits | 350-373 |
| `.qsets-panel` / `-section` / `-field` / `-grid` / `-actions` | the creation panel | 377-418 |
| `.qsets-pf*` | preflight tiers (stop / skip / gap / ok) + tier table | 433-469 |
| `.qsets-scrim` / `-modal` / `--wide` / `--over` | the dialog | 473-554 |
| `.qsets--onlight` | the whole thing re-tinted for a white card | 585-604 |

### Copyable: the table

```jsx
<table className="qsets-tbl">
  <thead><tr>
    <th className="qsets-col-set">Set</th>
    <th className="qsets-col-type">Type</th>
    <th className="qsets-col-qs">Qs</th>
    <th className="qsets-col-state">State</th>
    <th className="qsets-col-when">Updated</th>
    <th className="qsets-col-acts" />
  </tr></thead>
  <tbody>{rows.map((r) => (
    <tr key={r.id}>
      <td>
        <span className="qsets-nm">{r.name}</span>
        <span className="qsets-sub">{truncate(r.description, 110) || '—'}</span>
      </td>
      <td><span className="qsets-chip qsets-chip--type">{label}</span></td>
      <td className="qsets-num">{r.count ?? 0}</td>
      <td><div className="qsets-states">{/* chips */}</div></td>
      <td className="qsets-when">{when}</td>
      <td><div className="qsets-rowact">
        <button className="qsets-btn qsets-btn--sm">Edit</button>
        <button className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger">Delete</button>
      </div></td>
    </tr>
  ))}</tbody>
</table>
```

Column widths are percentages that must sum to 100 and leave the action column enough for
its widest button pair — 10% did not fit "Edit"+"Delete" and clipped them
(`QuestionSetsPanel.css:251-262`). The width comes out of the **name** column, which
ellipsizes and degrades gracefully.

### Copyable: the two empty states

They are different situations with different exits — never one sentence for both.

```jsx
{nothingExists ? (
  <div className="qsets-empty">
    <Icon name="Books" weight="duotone" size={40} color="var(--muted)" />
    <h3>No question sets yet</h3>
    <p>{/* what the thing is, and why it is upstream of everything */}</p>
    <div className="qsets-paths">{/* ranked creation paths, each saying what it costs */}</div>
  </div>
) : nothingMatches ? (
  <div className="qsets-nomatch">
    <h3>No sets match {n === 1 ? 'this filter' : `these ${n} filters`}</h3>
    <p>{total} sets exist. Removing any one of these gets you results:</p>
    <div className="qsets-drops">{drops.map((d) => (
      <button className="qsets-drop" onClick={() => clearOne(d.key)}>
        <Icon name="X" weight="bold" size={12} color="currentColor" />
        {d.label} <em>— {d.count} sets</em>
      </button>
    ))}</div>
    <button className="qsets-btn qsets-btn--link" onClick={clearAll}>Clear all filters</button>
  </div>
) : <table className="qsets-tbl">…</table>}
```

**A drop-exit is only offered when dropping that filter actually produces rows.** Counting
that is one pass over an array already in memory, and it turns a dead end into N one-click
ways out.

### Copyable: the chip

```jsx
<span className="qsets-chip qsets-chip--warn">AI</span>
<button type="button" className="qsets-chip qsets-chip--on">Active</button>
```

`--type` text-coloured, `--on` green, `--off` muted **dashed**, `--warn` amber, `--bad`
red. `button.qsets-chip` gets `cursor: pointer; min-height: 24px` — a chip that is a
toggle must meet the 24px target (audit A5).

### The list/panel split

`QuestionSetsPanel` is **pure**: props in, callbacks out, no `authFetch`, no state of its
own. Fetching, dialogs and callbacks live in the page. `PromptLibraryPanel` copies this
arrangement exactly. Do the same for any new list — it is the only way the screen is
mountable in jsdom.

---

## 3. The `.adm-*` console chrome

`components/AdminShell.jsx` + `.css`. The shell is `position: fixed; inset: 0` with a
2×2 grid (`brand | top` / `nav | work`) and **`overflow: hidden`** — the shell never
scrolls, `.adm-work-body` does. That is what keeps the nav and the screen title on screen;
the shipped console scrolled the whole document, so the tab bar left the viewport as soon
as you read a list.

```jsx
<AdminShell
  navItems={[{ id, label, icon, count, badge }]}
  footNavItems={[…]}
  activeId={section}
  onNavigate={setSection}
  environment={{ id: 'dev', label: 'dev', detail: '…' }}
  currentUser={user}
  onSignOut={signOut}
  breadcrumb={detail ? { parentLabel: 'Question sets', onBack: close } : null}
  title="Question sets"
  subtitle="The thing every session is built from."
  actions={<button className="qsets-btn qsets-btn--primary">New set</button>}
  contentTheme="dark"          /* 'light' until the section's markup is converted */
>
  {children}
</AdminShell>
```

Rules the chrome encodes:

- **The top bar never restates the h1 30px below it.** On a root list the breadcrumb region
  is empty; on a detail it is a back link to the **parent**, never the object's own name.
- **A badge and a count are different things.** The count is a size and disappears below
  1180px with the label; the badge is the one number that decays if nobody looks at it
  (pending approvals) and survives at every width (`AdminShell.css:105-114`).
- **`aria-current="page"`**, not a bare `.active` class.
- **A subtitle must be true.** Sessions says it has no list, because it has none.
- **`.adm-work-body[data-theme="light"]`** (`AdminShell.css:402-413`) is marked
  TRANSITIONAL: it paints `#f5f7fa` under sections whose markup is still paper. The seam is
  visible on purpose — a half-converted console that says so beats one that hides the
  boundary behind an unreadable panel. Delete the block when the last section converts.

Sibling screens sharing the same idiom, all safe to copy from: `.sp`
(`SessionsPanel.css`), `.um` (`UserManagement.css`), `.plib`
(`AIPromptManager.css:1905-2020`, paper-toned).

---

## 4. Surface shells outside the console

| scope | file | notes |
|---|---|---|
| `.entry-page` | `components/RootPage.css` | the signed-out door. Own `--entry-*` token set, 48px tap targets, 17px body (below 16px iOS Safari zooms on focus) |
| `.wel-page` | `components/WelcomeScreen.css` | the host's front door. `data-theme="dark"`, one ladder, derived from RootPage + the stage |
| `.au-page` | `auth/auth.css` + `auth/AuthChrome.jsx:115` | sign-in / register / verify / pending |
| `.stage`, `.rail`, `.dock`, `.field` … | `styles/stage.css` | the projector. Ported verbatim from the audited mockup — ranges are copied, not retyped, because a lost digit in a `clamp` is invisible and wrong |
| `.report-*` | `components/GameReport.css` | `data-theme="light"` deliberately: a report is printed and shared |
| `.hr-*` / `.hrc-*` / `.hrq-*` | `HostRemote.css`, `RemoteCategoryList.css`, `RemoteQuestionBrowser.css` | the phone remote |

---

## 5. What NOT to build

- **A second modal shell.** Twelve already exist (`admin-container-rule.md:7-13`).
- **A side drawer for edit-in-a-list.** A drawer's one advantage is keeping list context
  visible, and the sibling browser inside the modal already gives that — so it buys
  nothing and costs a second container to be consistent about.
- **A card grid for a list.** Forty-one cards is a wall.
- **A determinate progress bar over per-pass progress.** `updateJobProgress` fires once per
  completed model call, and one call fits 17-67 items, so for the common case there is
  exactly **one** update, at the end. Use a real fraction that jumps plus an indeterminate
  sweep for liveness, and say why it jumps.
- **A Cancel button on a running generation job.** No cancel endpoint exists; the
  client-side `isCancelled` hook has no caller and, even wired, the worker keeps burning
  tokens. Say so in one line under "If you leave".
- **A new global class from a component stylesheet.** `UserManagement.css` used to declare
  `.alert`, `.empty-state`, `.loading-state`, `.loading-spinner`, `.filter-tab` and
  `.provider-badge` globally, so unrelated screens inherited them by import order.
