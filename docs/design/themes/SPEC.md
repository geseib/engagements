# Site skins: Classic and Present

**Status: PROPOSED, 2026-10-13. Not built.** Companion files: `INVENTORY.md` (every stylesheet
and surface, measured), `PLAN.md` (phases and work units), `TOOLING-BRIEF.md` (what the next agent
builds so a fleet can adopt pages).

Owner's decisions (2026-10-13) are fixed and not re-argued here: two skins, every page, one
site-wide setting owned by Engage staff, Classic by default, tokens first, then a shared component
library, then per-surface adoption; a third skin must be one values file plus one registry entry.

---

## 1. Goals and non-goals

| | |
|---|---|
| **Goal** | One switch in the console (Engage settings) changes fonts, colours and visual treatment on every page, the Presentation included, for every visitor, signed in or not. |
| **Goal** | Classic renders **pixel-identical to today** at every step of the migration. Nothing changes for anyone until staff flip the switch. |
| **Goal** | A third skin = `src/src/styles/skins/<id>.css` + one entry in `src/src/config/skins.js` (and its guarded-identical backend copy). No screen edits. |
| **Goal** | The build fails if a stylesheet paints a colour or names a font family outside the skin values (with a shrinking, dated allowlist during migration). |
| **Non-goal** | Layout. Every screen keeps its grid, sizes, spacing, type ladders, display profiles and copy in both skins. |
| **Non-goal** | Per-team or per-person skins (later, maybe; §4.6 leaves room). |
| **Non-goal** | Changing which surfaces are paper and which are dusk. `data-theme` stays a per-surface decision (open question Q1). |

---

## 2. What a skin is: three layers

```
 layer 1  SKIN VALUES      styles/skins/classic.css, styles/skins/present.css
          flat --sk-* custom properties on :root[data-skin="<id>"]. Values only. No selectors
          other than the one root block. This is the "one file" a new skin adds.

 layer 2  ROLES            styles/roles.css (one file, written once)
          maps   theme (dark | light)  x  skin value  ->  the role tokens stylesheets use:
          --bg --text --accent --accent-text --eyebrow-color --field --rule ...

 layer 3  SURFACES         every component stylesheet, and later the ui/ library
          reads ROLE tokens only. Never a --sk-* value, never a literal colour, never a font name.
```

Why the indirection (and why it works with the repo's known trap): a custom property that holds
`var()` is resolved **on the element that declares it** and inherited as that resolved value
(`styles/stage.css:96-104` records the `--k` scalar that drew four profiles identically because of
this). Roles are declared on `:root` and on every `[data-theme]` element; the `--sk-*` values they
read are declared on `:root[data-skin]`, so they have already been inherited by the time a role is
resolved. A role may therefore never be redeclared on an element that sits *above* `:root` (none
exists) and a `--sk-*` value may never be declared anywhere but the skin file.

**File naming:** never put `token` in a file name. `.gitignore:35` is an unanchored `*token*`; a
`tokens.css` or `skinTokens.test.js` is invisible to git and never reaches CI.

---

## 3. Composition: skin x theme x display profile x surface

| Axis | Attribute | Set by | Scope | Values |
|---|---|---|---|---|
| **Skin** | `data-skin` on `<html>` | boot script in `public/index.html`, then `SkinProvider` | **whole document, one value** | `classic` (default, also what a missing or unknown value renders), `present` |
| **Theme** | `data-theme` on any element | each surface's root, as today (83 setters in 51 files) | subtree, nestable | `dark` (dusk), `light` (paper) |
| **Display profile** | class `d-room` / `d-tv` / `d-call` / `d-table` on `<html>` | `config/displayProfile.js` | whole document | type ladders only (`styles/stage.css:43-90`) |
| **Wall** | `data-surface="wall"` | `PresentStage.jsx`, and the host stage only while it is the projected view | subtree | marks "this is what the room sees" |

Rules of composition:

1. **Skin never nests.** It lives on `<html>` only. Nothing below `<html>` may carry `data-skin`
   (enforced, §7). This is what makes "one site-wide setting" true by construction.
2. **Theme nests, as today.** Roles are declared for `:root, [data-theme="dark"]` and for
   `[data-theme="light"]`; an element carrying `data-theme` re-resolves every role from the
   (inherited) skin values. `<html data-theme="light">` in `public/index.html:2` stays.
3. **Profiles are orthogonal.** They set `--L-*`, `--floor`, `--hair`; skins set none of those.
   One cross-rule: under `:root.d-call` the role `--field` resolves to a flat `var(--bg)` in
   **every** skin (the reason is in `styles/stage.css:146-147`: wide gradients band under video
   compression). Present's glow is a gradient, so it obeys the same rule.
4. **The wall rule is a skin value, not a surface rule.** `--sk-wall-action` is `--sk-action`
   (orange) in Classic and `--sk-accent` (blue) in Present. Under `[data-surface="wall"]`,
   `--action` reads `--sk-wall-action`. That is the whole of "no orange on the wall" — it becomes a
   Present-skin property, and Classic's wall gets the stage's orange back.

Selector skeleton (`styles/roles.css`):

```css
:root, [data-theme="dark"] {           /* dusk */
  --bg: var(--sk-dark-bg);  --surface: var(--sk-dark-surface);  --text: var(--sk-dark-text);
  --accent-text: var(--sk-dark-accent-text);  --field: var(--sk-dark-field);  /* ... */
}
[data-theme="light"] {                  /* paper */
  --bg: var(--sk-light-bg); --surface: var(--sk-light-surface); --text: var(--sk-light-text);
  --accent-text: var(--sk-light-accent-text); --field: var(--sk-light-field); /* ... */
}
:root.d-call, :root.d-call [data-theme] { --field: var(--bg); }
[data-surface="wall"] { --action: var(--sk-wall-action); --on-action: var(--sk-wall-on-action); }
```

`styles/skins/classic.css` declares its block on `:root, :root[data-skin="classic"]` so Classic is
what renders with no attribute at all (first paint before the boot script, jest, a corrupt value).
`present.css` declares on `:root[data-skin="present"]` (specificity 0-2-0 beats `:root` 0-1-0).

---

## 4. The two skins as values

All ratios measured with the audit's own formula (WCAG relative luminance, the `lin/lum/ratio`
functions in `references/testing-a-surface.md`), flat against the named ground. Tints are
composited (`alphaOver`). AA = 4.5:1. Numbers marked † fail AA and are the reason a value exists.

### 4.1 Theme-invariant values

| `--sk-*` value | Role(s) it feeds | Classic | Present | Note |
|---|---|---|---|---|
| `font-display` | `--font-display` | `"Archivo", system-ui, sans-serif` | same | Both skins already share the faces: Archivo at wdth 125 + Inter, loaded once in `public/index.html:39`. The skins differ in *treatment*, below. |
| `font-ui` | `--font-ui` | `"Inter", system-ui, sans-serif` | same | |
| `font-mono` | `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | same | **New role.** Replaces 7 different hand-written mono stacks (INVENTORY §1). |
| `display-weight` | `--display-weight` | `800` | `800` | |
| `display-tracking` | `--display-tracking` | `-.01em` | `-.01em` | |
| `eyebrow-weight` | `--eyebrow-weight` | `700` | `600` | Classic: `.kicker` `styles/stage.css:711`. Present: `present.css:143`. |
| `eyebrow-tracking` | `--eyebrow-tracking` | `.15em` | `.12em` | same sources |
| `action` | `--action` | `#F6A94C` | `#F6A94C` | **One orange per screen** (R3) on interactive surfaces, both skins. |
| `action-hover` | `--action-hover` | `#FFBB63` | `#FFBB63` | from `--mk-amber-hi`, `MarketingShell.css:57` |
| `on-action` | `--on-action` | `#0F1A2E` (8.86:1 on `#F6A94C`) | same | |
| `wall-action` | `--action` under `[data-surface=wall]` | `#F6A94C` | `#7CA7E6` | the wall rule, §3.4 |
| `wall-on-action` | | `#0F1A2E` (8.86) | `#0F1A2E` (7.06) | |
| `accent` | `--accent` (fills, borders, pips, badges, selected) | `#F6A94C` | `#7CA7E6` | the main difference between the skins |
| `accent-rgb` | `--accent-rgb` (for tints) | `246 169 76` | `124 167 230` | tints are written `rgb(var(--accent-rgb) / .12)` |
| `accent-hover` | `--accent-hover` | `#FFBB63` | `#9CBEF0` | |
| `info` | `--info` (links, connected, non-reward) | `#7CA7E6` | `#7CA7E6` | today's `--secondary` |
| `info-rgb`, `slate-rgb`, `success-rgb`, `danger-rgb`, `warn-rgb` | channel roles for tints | `124 167 230`, `155 168 190`, `79 178 134`, `229 100 94`, `246 169 76` | same | so a scope's `rgba(155,168,190,.28)` becomes `rgb(var(--slate-rgb) / .28)` at identical pixels |
| `phase-ask` | `--phase-ask` | `#F6A94C` | `#7CA7E6` | `.chip.ask` `styles/stage.css:170` is orange today; Present's wipe is blue (`present.css` header) |
| `phase-vote` | `--phase-vote` | `#7CA7E6` | `#7CA7E6` | |
| `phase-results` | `--phase-results` | `#4FB286` | `#4FB286` | |
| `success`, `danger`, `danger-deep`, `gold/silver/bronze` | same-named roles | unchanged from `styles.css:21-38` | unchanged | status colours are not skin colours |
| `warn` | `--warn` | `#F6A94C` | `#F6A94C` | a warning stays amber in both skins; it is a status, not the accent. Never on the wall. |
| `radius` / `radius-sm` / `radius-lg` | same | `16px` / `8px` / `16px` | `16px` / `8px` / `20px` | Present's response card is 28px at 1920 (`present.css:288`), i.e. ~20px at laptop scale. Open question Q4. |
| `select-mark` | `--select-mark` (box-shadow on a selected row/card) | `none` | `inset 3px 0 0 var(--accent)` | from `docs/design/one-look/prototype.html` |
| `badge-shape` | `--badge-radius` | `999px` | `999px` | |

### 4.2 Dusk (`:root`, `[data-theme="dark"]`)

| `--sk-dark-*` | Role | Classic | Present | Measured |
|---|---|---|---|---|
| `bg` | `--bg` | `#0F1A2E` | `#0F1A2E` | |
| `surface` / `surface-2` | same | `#1B2942` / `#25375A` | same | |
| `text` | `--text` | `#F4EDE4` | `#F4EDE4` | 14.97 on bg · 12.53 surface · 10.20 surface-2 |
| `muted` | `--muted` | `#9BA8BE` | `#9BA8BE` | 7.24 · 6.06 · 4.93 |
| `accent-text` | `--accent-text` (accent as copy) | `#F6A94C` | **`#9CBEF0`** | Present needs a lifted blue: `#7CA7E6` is 4.81 on surface-2 and **4.43† on a .16 blue tint over surface** (a selected row). `#9CBEF0`: 9.14 bg · 7.65 surface · 6.23 surface-2 · 5.73 tint/surface · 4.74 tint/surface-2. Same argument that produced `--danger-text` (`styles.css:22-35`). |
| `eyebrow-color` | `--eyebrow-color` | `var(--muted)` | `var(--accent-text)` | Classic kicker is muted capitals; Present's is blue capitals |
| `success-text` | `--success-text` | `#6FD0A4` | same | 9.30 bg. **New global role**: today redeclared in 20+ scopes (`--qsets-success-text`, `--plr-success-text`, …) |
| `danger-text` | `--danger-text` | `#EF8C86` | same | 7.26 · 6.08 · 4.94 |
| `rule` / `rule-strong` | `--rule` / `--rule-strong` | `rgba(155,168,190,.20)` / `.34` | `rgba(155,168,190,.22)` / `.40` | Classic = the modal scoped value (39 and 34 scopes declare exactly these); Present from `present.css:38-39`. Replaces ~60 scoped `--*-rule(-strong)` |
| `row-hover` / `row-selected` | same | `rgba(155,168,190,.055)` / `rgb(var(--accent-rgb)/.10)` | `rgba(155,168,190,.055)` / `rgb(var(--accent-rgb)/.16)` | Classic: 28 and 6 scopes declare these exactly; Present `.16` from the prototype's `--sec-tint` |
| `scrim` | `--scrim` | `rgba(6,11,22,.72)` | same | 3 scopes declare it exactly; consolidates `--evts-scrim`, `--brm-scrim`, … |
| `on-accent` (dark and light) | `--on-accent` | `#1B2942` (7.42 on `#F6A94C`) | `#1B2942` (5.91 on `#7CA7E6`) | 8 scopes use `#1B2942`, 3 use `#0F1A2E`; ink on a filled `--action` stays `--on-action #0F1A2E` |
| `field` | `--field` (page ground, a `background` value) | the stage field: `linear-gradient(180deg,#0C1526 0%,#12203A 46%,#1B2C4A 78%,#2A3A57 100%)` + amber horizon (`styles/stage.css:148-151`) on the stage; flat `var(--bg)` elsewhere | `radial-gradient(120% 60% at 90% 0%, #1E3050 0%, var(--bg) 60%), var(--bg)` | text on the glow stop `#1E3050`: 11.34; muted 5.48; `#7CA7E6` 5.35. Classic's lightest field stop `#2A3A57`: text 9.82, muted 4.75, primary 5.81 |
| `wall-canvas` | `--wall-canvas` | the stage field gradient (as above) | `#0A1324` + glow `radial-gradient(120% 90% at 85% 0%, #1E3050 0%, var(--bg) 55%)` | `present.css:37,72` |
| `wall-quote` | `--wall-quote` | `#F4EDE4` | `#D9E5F7` | `present.css:42` |

**Near-variants are not silently merged.** Scoped rules today also use `.18`, `.22`, `.24`, `.28`
alphas and `rgba(182,194,212,…)` greys (the player's `--plr-*`). Merging one into `--rule` is a
visible Classic change, so a unit either keeps a local alias (`--bpl-rule: rgb(var(--slate-rgb) / .22)`, value unchanged) or records the delta as an *accepted Classic delta* with
the owner's sign-off. The zero-diff gate (§8) decides which.

### 4.3 Paper (`[data-theme="light"]`)

| `--sk-light-*` | Role | Classic | Present | Measured (bg #FBF7F1 · white · #F1EDE4) |
|---|---|---|---|---|
| `bg` / `surface` / `surface-2` | same | `#FBF7F1` / `#FFFFFF` / `#F1EDE4` | same | |
| `text` / `muted` | same | `#1B2942` / `#5E6167` | same | 13.64·14.56·12.46 / 5.82·6.21·5.32 |
| `accent-text` | `--accent-text` | `#9A5B18` (`QuestionSetsPanel.css:592`) | **`#2E5C9E`** | 5.07·5.41·4.63 / 6.26·6.69·5.72 |
| `eyebrow-color` | | `var(--muted)` | `var(--accent-text)` | |
| `success-text` | | `#1C7350` | same | 5.44·5.81·4.97 |
| `danger-text` | | `#B03A34` | same | 5.62·6.00·5.13 |
| `rule` / `rule-strong` | | `rgba(27,41,66,.14)` / `.28` | same | `--mk-paper-rule` `MarketingShell.css:62` |
| `field` | | `var(--bg)` flat | `radial-gradient(120% 60% at 90% 0%, #EAF0FA 0%, var(--bg) 60%), var(--bg)` | text 12.72, muted 5.42, accent-text 5.84 on `#EAF0FA` |

### 4.4 Aliases kept during migration

`--primary`, `--primary-deep`, `--secondary` stay declared (Classic values, both skins) until the
last surface is migrated; `--hairline` becomes `var(--hair, 1px) solid var(--rule)`. A migrated
stylesheet may not read `--primary` or `--secondary` (§7); the aliases are deleted in the last
phase. Today's counts: **796** `var(--primary…)` and **153** `var(--secondary)` (INVENTORY §1).
Mapping rule for the migration (the codemod's default; a worker overrides with a reason):

| Today | Means | Becomes |
|---|---|---|
| `var(--primary)` as `background` of the main button | the one action | `--action` / `--on-action` |
| `var(--primary)` as colour/border/fill of a state, chip, count, selection, progress, badge | accent | `--accent` (fills/borders) or `--accent-text` (copy) |
| `var(--secondary)` as a link / "connected" | info | `--info` |
| `var(--secondary)` as "showing / selected / pressed" (the Presentation, dock-present) | accent | `--accent` |
| `rgba(246,169,76,a)` (95 sites) | accent tint (or warn tint) | `rgb(var(--accent-rgb) / a)` or `--tint-warn` |
| `rgba(124,167,230,a)` (35 sites) | selected/showing tint | `rgb(var(--accent-rgb) / a)` or `rgb(var(--info-rgb) / a)` |

### 4.5 The Presentation in Classic

Same canvas, same ladders, same moments (`present/PresentMoments.jsx`). Only these change:

| Element | Present (today) | Classic |
|---|---|---|
| Canvas ground | `#0A1324` + top-right blue glow | the host stage's field: dusk gradient + amber horizon + ridge silhouette (`styles/stage.css:148-156`); flat under Call |
| Eyebrow | blue capitals, 600, .12em | muted capitals, 700, .15em (the stage `.kicker`) |
| Number badge, response-card border, meter "on", track, page pips, tally bar | `--secondary` blue | `--accent` = orange |
| Phase wipe "ASK/ANSWER" | blue band | orange band (`--phase-ask`) |
| Phase wipe "VOTE" / "RESULTS" | blue / green | blue / green (unchanged) |
| The three-second strip's "go" button | blue | orange (`--sk-wall-action`) |
| Safety-ask card border and eyebrow | blue | orange border, muted eyebrow |

`presentPalette.test.js:87-89` ("no `--primary`") becomes: *present.css reads no `--primary`,
`--secondary` or literal; under the Present skin `--action` on the wall resolves to blue* — the
rule moves from the stylesheet to the skin values, where it is asserted by the skin palette test.

### 4.6 Room for later (not built)

Per-team skins would set `data-skin` from the team's row after sign-in; the boot script already
reads one value and the CSS needs nothing new. Fonts beyond Archivo/Inter would add a `fonts` URL
to the registry entry and one `<link>` injected by the boot script (open question Q5).

---

## 5. The setting

### 5.1 Storage

| | |
|---|---|
| Row | `PK PLATFORM#SETTINGS` `SK SITE_SKIN` — beside the existing `CLAUDE_MODELS` row (`lambda-functions/admin/orgs/platform-settings.js:11`) |
| Fields | `RecordType: "PLATFORM_SETTING"`, `Skin: "classic" \| "present"`, `UpdatedAt` (ISO), `UpdatedBy` (staff sub) |
| No row | means `classic` |
| TTL | **None.** CLAUDE.md's TTL rules govern session and report rows, which are content with a lifetime; this is one platform-wide configuration row that must outlive every session, exactly like `CLAUDE_MODELS` (which also carries none). Its history lives in the audit log, kept one year. |
| Tenancy | Platform-scoped, no org. Not encrypted: it is public by design (it is served to signed-out visitors). Does not touch the `SETS`/`GAMES` partitions, so `tests/no-global-partition-literals.js` is unaffected. |
| Allowlist | `SKINS = ['classic', 'present']` in `lambda-functions/admin/shared/site-skin.js` and a **guarded-identical copy** in `lambda-functions/websocket/site-skin.js` (the public reader lives in the websocket CodeUri), both held equal to `src/src/config/skins.js` ids by `tests/site-skin-registry.js` — the same pattern as `session-ttl.js`. |

### 5.2 Routes (resource budget)

The stack: **155** explicit resources, of which **119** `AWS::Serverless::Function` and **188**
`HttpApi` events. SAM expands each function to Function + Role and each HttpApi event to one
`AWS::Lambda::Permission`; plus 1 Schedule (rule + permission), 1 DynamoDB stream mapping and the
HttpApi stage — **≈ 466 of 500** (estimate; confirm with
`aws cloudformation list-stack-resources --stack-name engagedev --query 'length(StackResourceSummaries)'`).
A function costs ≥ 2, a route costs 1.

| Need | Route | Function | Cost | Why |
|---|---|---|---|---|
| **Staff read + write** | `GET` and `POST /platform/settings/{name}` | `PlatformOrgsFunction` (`template-clean.yaml:1765-1780`) | **0 net** — the two events *replace* `GetClaudeModelsSetting` / `SetClaudeModelsSetting` | `/platform/settings/claude-models` still matches `{name}`, so `ClaudeModelsPanel` keeps working untouched. `platform-settings.js` dispatches on `name ∈ {claude-models, site-skin}`; `authorizer.js:545` becomes `path.startsWith('platform/settings/') → ['admins']`; the handler re-asks `isPlatformAdmin` and writes `recordAudit` (`platform.site-skin`) **before** the row, refusing with 503 if it cannot — identical to `claude-models`. Every future platform setting is then free. |
| **Public read** | `GET /site` | `ResolveJoinCodeFunction` (`template-clean.yaml:717`, CodeUri `websocket/`, already public, already `DynamoDBReadPolicy`, no write, no Scan) | **+1** Permission | The only public function whose job is "answer a visitor who has no identity yet". Dispatch on `rawPath === '/site'` before the code parse. Returns `{ skin, updatedAt }` and nothing else, with `Cache-Control: public, max-age=60, stale-while-revalidate=600`. It is the one read the whole site makes, so it is cheap: one `GetItem` on a key, no KMS. |

Alternatives considered:

| Option | Cost | Rejected because |
|---|---|---|
| Add `GET`+`POST /platform/settings/site-skin` beside claude-models | +2 | works, but the `{name}` route is the same work and makes the next setting free |
| Make `GET /platform/settings/{name}` public | 0 | one route key has one auth mode; it would publish the claude-models view (tier connection state) to anyone |
| Piggyback on `GET /join/{code}` with a magic code | 0 | a join code is four digits by contract (`resolve-code.js` returns 400 otherwise); a magic value is a trap for the next reader |
| Staff POST also writes `site.js` to `${StackName}-web`, loaded synchronously like `config.js` | 0 for the read | zero flash even on a first visit, but: the deploy's `aws s3 sync dist/ … --delete` (`buildspec-dev.yml:188`) deletes it unless all three buildspecs exclude it; a missing file is answered by CloudFront's 404→`/index.html` rule (`template-clean.yaml` CustomErrorResponses) and parsed as JS; and a Lambda writing executable JS into the site origin is a standing XSS surface. Keep as the fallback if Q3 says "no flash even on first visit". |

### 5.3 Client: no flash

1. **Boot (before any CSS exists).** An inline script at the top of `<head>` in
   `src/public/index.html` reads `localStorage['engage.skin']` (try/catch; private mode throws),
   accepts it only if it matches `^[a-z][a-z0-9-]{1,23}$`, and sets
   `document.documentElement.dataset.skin`. App CSS is injected by `style-loader` when the bundle
   runs (`webpack.config.js:63`), so the attribute is always set before the first styled paint.
   An unknown id renders Classic because Classic is declared on bare `:root`.
2. **Refresh.** `SkinProvider` (mounted in `App.jsx` outside `AuthProvider`, since marketing and
   `/present` are signed out) fetches `GET ${API_BASE}site` once per page load with no auth header
   (so no CORS preflight beyond the simple GET), sets the attribute if it differs, and writes
   localStorage. A failed fetch changes nothing.
3. **First-ever visit with Present on.** One Classic paint until the fetch lands (~100-600 ms incl.
   a cold Lambda). Accepted for v1 (Q3).
4. **Staff change.** Takes effect on the next page load for everyone (browser cache ≤ 60 s). The
   admin panel applies it to the staff member's own tab immediately.
5. **`/present` and the stage on a projector** pick it up on their next load; a running wall is not
   re-skinned mid-session (no socket broadcast in v1, Q6).
6. `<meta name="theme-color">` (`index.html:12`) stays `#0F1A2E` in both skins (same dusk bg).

### 5.4 The staff control

A second panel in the existing **Engage settings** section (`config/consoleSections.js:327`,
mounted at `AdminPage.jsx:2094`), `components/SiteSkinPanel.jsx`, platform staff only (the section
is already in `PLATFORM_SECTION_IDS`, `AdminPage.jsx:191`). Contents: the registry's skins as a
radio group with a live preview swatch each (rendered by temporarily scoping `data-skin` on the
swatch — the one allowed exception to "skin never nests", confined to `.ui-skin-swatch`), a reason
field (audited), Save, and "Last changed {date} by Engage staff". The section icon `Brain` should
become a neutral one when it holds two switches (`Gear` is taken by the foot's Settings; use
`SlidersHorizontal`).

---

## 6. Shared component library (`src/src/components/ui/`)

One stylesheet per component (`components/ui/Eyebrow.jsx` + `Eyebrow.css`, …) so components can be
built in parallel, all under the scope prefix `.ui-` (free today: no `.ui-*` selector in any
stylesheet; `.ui-eyebrow`, `.ui-badge`, …). Each component reads **role** tokens only, takes a
`className` passthrough, and has one CSS-contract test (`__tests__/ui<Name>Palette.test.js`). Built one at a time (PLAN Phase 2), each adopted by the Presentation first
because it is the reference look.

| Component | Purpose | Props | Roles read | Replaces (examples) |
|---|---|---|---|---|
| `Eyebrow` | small capital label above a title | `as='p'`, `tone='auto'\|'muted'\|'accent'`, `children` | `--eyebrow-color/-weight/-tracking`, `--font-ui` | `.present-eyebrow`, stage `.kicker`, `.meter h4`, `.rail-ctx`, ~225 `text-transform:uppercase` rules |
| `Heading` | display title | `level=1..4`, `size='hero'\|'primary'\|'secondary'\|'head'\|'title'`, `balance` | `--font-display`, `--display-weight/-tracking`, `--text`, the surface's own ladder var | `.present-hero`, `.q`, `.hero`, `adm-work-head h1` |
| `Button` | every button | `variant='action'\|'accent'\|'quiet'\|'danger'`, `size`, `as` | `--action`, `--action-hover`, `--on-action`, `--accent`, `--on-accent`, `--rule-strong`, `--danger-deep`, `--radius-sm` | `.btn`, `.btn-primary` (styles.css), scoped `*-btn` |
| `NumberBadge` | the number in a circle ("Response 3") | `n`, `size`, `tone='accent'\|'muted'` | `--accent`, `--on-accent`, `--font-display`, `--badge-radius` | `.present-badge`, styles.css "THE NUMBER IN A CIRCLE" (`:11855`) |
| `Card` | a bordered surface, optionally selected, optionally badged | `selected`, `badge`, `as` | `--surface`, `--rule`, `--accent`, `--select-mark`, `--radius-lg` | `.present-card`, `.present-mini`, response cards on Remote/participant |
| `Pips` | progress: meter, pages, track | `variant='meter'\|'pages'\|'track'`, `done`, `of`, `seen` | `--surface-2`, `--accent`, `--success`, `rgb(var(--accent-rgb)/.45)` | `Meter`, `.present-pages`, `.present-track` |
| `TopLine` | "**Session** · Round 5 …… moment" | `left`, `right` | `--muted`, `--text`, `--rule`, `--hair` | `.present-top`, stage `.rail` text |
| `Chip` | phase/status chip | `tone='ask'\|'vote'\|'results'\|'ok'\|'warn'\|'danger'\|'muted'` | `--phase-*`, `--success-text`, `--danger-text`, `--warn` | `.chip.ask/.vote/.results` (`stage.css:164-172`), scoped `*-chip` |
| `Ground` | page or canvas background | `variant='page'\|'wall'` | `--field`, `--wall-canvas`, `--bg` | `.present-canvas` background, stage `.field`, `.plr`/`.hr` backgrounds |
| `TallyRow` | rank · label · bar · points | `rank`, `label`, `sub`, `share`, `points` | `--accent`, `--muted`, `--text`, `--font-display` | `.present-trow`, poll/results bars |
| `RowSelect` (CSS-only mixin class `.ui-row`) | hover and selected states for table rows | — | `--row-hover`, `--row-selected`, `--select-mark` | ~25 scoped `--*-row-hover/-row-sel` |
| `Notice` | inline tinted banner | `tone` | `--tint-ok/-warn/-danger/-note`, matching `*-text` | `StatusMessage` styling, scoped `*-tint-*` |
| `Modal` styling | the shell's look only (behaviour stays in `Modal.jsx`) | `variant` via class | `--surface`, `--scrim`, `--radius`, `--rule` | 12 modal shells (`admin-container-rule.md`) |

The library never changes a surface's **layout**: sizes come from the surface's existing ladder
variable (`--L-*`, `--plr-t-*`, `--qsets-t-*`, …) passed in by class or by a `--ui-size` property
the surface sets.

---

## 7. Enforcement

All as jest tests reading CSS as text (the repo's only honest way; jsdom loads no stylesheet).
Names end in `Palette.test.js`, never `*token*`.

| Test | Fails when |
|---|---|
| `__tests__/skinPalette.test.js` | a skin file declares a `--sk-*` the other skin lacks (same key set in every skin file); a skin file contains any selector other than its root block; any value is missing; any role in `roles.css` reads an undeclared `--sk-*`; any AA pairing in §4 drops below 4.5 for **every skin × theme** (composited tints included); under Present, `--sk-wall-action` is not the accent. |
| `__tests__/skinLiteralsPalette.test.js` (the gate) | any stylesheet outside `styles/skins/` contains a colour literal (`#hex`, `rgb[a]()`, `hsl[a]()`, named `white`/`black`) **in a rule or in a scoped token declaration**, or a `font-family`/`font` naming a family, **unless** the file carries an allowance pragma at least that large: `/* skin-allowance: colour=16 font=0 */` in its first comment block (and, in `styles.css` only, one `/* skin-allowance SC-03: colour=84 font=2 */` per unit banner, counted to the next marker). The allowance lives **in the file it governs**, so parallel units never edit a shared list. Allowances start at today's measured counts (INVENTORY §1) and only go down: a count below its allowance fails until the allowance is lowered in the same change (ratchet); a file with no pragma must be clean. `rgb(var(--…-rgb) / a)` is allowed. |
| same file | a migrated file (allowance 0) reads `var(--primary)`, `var(--primary-deep)` or `var(--secondary)`. |
| same file | any element-level `data-skin` appears in `.jsx` outside `SkinProvider.jsx` and `SiteSkinPanel.jsx`'s swatch. |
| `__tests__/skinBoot.test.js` | the inline boot script is missing from `public/index.html`, is not before the first `<script src>`, or does not wrap storage in try/catch. |
| `tests/site-skin-registry.js` (backend, node) | the backend allowlist copies differ from each other or from `config/skins.js`; a registry id has no `styles/skins/<id>.css`; the `{name}` routes lose `CognitoAuthorizer` or `authorizer.js` stops naming them `['admins']`; `GET /site` gains an authorizer or returns any field but `skin`/`updatedAt`. |
| existing palette tests (67) | updated per unit as each surface moves to roles; they keep asserting AA, now for both skins (TOOLING-BRIEF §2 gives the helper). |

JSX literals are in scope too: 44 quoted colour literals on 40 lines in 7 files
(`TermsOfServicePage.jsx` 14 lines, `PrivacyPolicyPage.jsx` 9, `WordCloudTest.jsx` 9, `AuthChrome.jsx` 4, …;
INVENTORY §1) — the gate scans `style={{…}}` and `fill=`/`stroke=` attributes with the same allowlist.

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Classic drifts while migrating (a role resolves one shade off) | high | Classic values are copied, never re-derived; each unit's done-criterion is **zero resolved-declaration differences in Classic** (`classicEquivalence.js`, TOOLING-BRIEF §5.1) plus a zero-pixel screenshot diff at 375/660/1280 wherever the surface can be rendered (§5.2-5.3). |
| 124 frontend tests read CSS as text and pin literal values (`--qsets-success-text: #6FD0A4` …) | certain | Each unit updates the tests that read its sheets in the same change; the harness gets a `resolveRole(name, skin, theme)` helper so tests read values from `skins/*.css` + `roles.css` instead of retyping them. 34 backend `tests/*.js` read frontend source — every unit runs all of `node tests/*.js`. |
| `styles.css` (12,009 lines, 889 literals in rules, 263 `--primary`) is shared by host, Remote, participant, reports and authoring at once | certain | Split into owned regions (INVENTORY §3) migrated by one worker per region, serially per region; no two units edit the same line range. Later, extract regions into their own files. |
| The `--k` substitution trap: a role declared on `body` or a scope resolves against the wrong skin | medium | Roles declared only on `:root` and `[data-theme]`; the skin palette test asserts no `--sk-*` is read outside `roles.css`. |
| Present accent fails AA on some tint stack nobody listed | medium | Present gets its own lifted `--accent-text` (`#9CBEF0` dusk, `#2E5C9E` paper); every palette test runs both skins. |
| Cold `GET /site` Lambda adds latency to every first visit | low | localStorage makes it invisible after the first visit; `Cache-Control` max-age 60. |
| Stack resource limit | low | Net +1 resource (§5.2). |
| A third skin with a different font | later | registry `fonts` field + boot-injected `<link>` (Q5). |
| Display profiles and the Presentation canvas use px ladders that a skin could be tempted to touch | low | Skin files may not declare `--L-*`, `--floor`, `--hair`, `--*-t-*` (gate). |

---

## 9. Open questions (each with a recommendation)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Under Present, do paper surfaces (GameReport paper, Prompts, legal pages, marketing's paper bands) stay paper, or go dusk like the one-look NOTES suggest for session surfaces? | **Stay paper.** Theme is a per-surface decision and dusk/paper is closer to layout than to skin; Present on paper uses the blue ink `#2E5C9E` and Archivo headings. Revisit per surface later. |
| Q2 | Classic's wall: orange accent everywhere (badge, card border, pips, tally), or orange only for "ask" with blue for selection as the stage does today? | **Orange everywhere the Present wall is blue**, except the vote phase (blue) and results (green), mirroring the stage's chip colours. It is the literal reading of "the stage's orange accent". |
| Q3 | Is one Classic paint on a visitor's very first load acceptable when Present is on? | **Yes for v1.** If not, adopt the S3 `site.js` fallback (§5.2) with the three buildspec excludes. |
| Q4 | Present radii on laptops/phones: keep 16px cards or round up (20px)? | **20px for `--radius-lg` only** (response cards, the one big card per screen); everything else stays 16/8. |
| Q5 | Should a skin be allowed to change font families? | **Allowed in values now, unused**: both skins keep Archivo + Inter. Font loading per skin is designed (registry `fonts`) but not built until a skin needs it. |
| Q6 | Should a running Presentation or stage re-skin live when staff flip the switch? | **No.** Next load. A live switch would need a socket broadcast for a rare staff action. |
| Q7 | Who sees the change first? | **Staff preview without flipping:** the panel's "Preview on this tab" writes only the staff member's localStorage. Flip for everyone only after a test-tier walk. |
| Q8 | Is `--warn` amber acceptable inside Present screens (it is orange)? | **Yes**, warnings are status; R3 counts accent/action orange, not a caution tint. Never on the wall. |
