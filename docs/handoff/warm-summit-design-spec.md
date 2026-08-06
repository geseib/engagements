# Warm Summit — Design Spec (approved direction: PHOTO hero)

## Buildable spec

I have the anchors I need. Here is the consolidated spec.

---

# Engage2 Design Refresh Spec — "Warm Summit"

**Base:** Direction 3 (Warm Summit) — dark, projector-first dusk stage where amber is scarce and the mountain carries continuity.
**Grafted in:** Direction 1's *one-warm-accent-per-screen* discipline + "Field Notes" reframe of the Workie panel; Direction 2's `<Ridge variant>` single-SVG component and strict *one-meaning-per-color* status rule (incorrect is neutral, never red).

Two surfaces, one palette: **light "paper"** for authoring/admin/lobby-editing UI; **dark "dusk stage"** reserved for the projector/big-screen states so it reads as *event mode*, not a skin.

---

## 1. Color tokens (CSS custom properties)

Ship this as the first artifact — a token layer in `src/src/styles.css` `:root`, since ~350 hardcoded literals block everything else.

```css
:root {
  /* ---- DUSK STAGE (big-screen / projector states) ---- */
  --bg:            #0F1A2E;  /* deepest dusk slate, full-viewport field */
  --surface:       #1B2942;  /* option cards, panels, AI panel */
  --surface-2:     #25375A;  /* nested/hover, ridge mid-tone */
  --text:          #F4EDE4;  /* warm paper-white, never pure #FFF (13.2:1) */
  --muted:         #9BA8BE;  /* metadata, counters, secondary (6.1:1) */

  --primary:       #F6A94C;  /* AMBER summit-glow — the one hero accent (8.4:1) */
  --primary-deep:  #C77B4A;  /* amber pressed / horizon gradient stop (4.9:1) */
  --secondary:     #7CA7E6;  /* dusk periwinkle — links, WS-connected, non-reward (6.8:1) */

  --success:       #4FB286;  /* correct answer, positive delta (5.6:1) */
  --danger:        #E5645E;  /* errors, destructive only (5.0:1) */
  --gold:          #F6A94C;  /* rank #1 == --primary; silver #C0C6D0, bronze #B4794A */

  /* signature sky — ONLY behind the mountain, never on buttons */
  --summit-sky: linear-gradient(180deg, #16233B 0%, #2A3A57 52%, #C77B4A 100%);
  --ridge-front: #16233B;
  --ridge-mid:   #22344F;
  --ridge-back:  #2E4262;

  /* geometry */
  --radius: 16px;
  --radius-sm: 8px;
  --hairline: 1px solid rgba(155,168,190,.18);
  --space: 8px; /* 8px base grid */
}

/* ---- PAPER (authoring / admin / host-editing UI) ---- */
[data-theme="light"] {
  --bg:        #FBF7F1;   /* warm paper, kills projector-room glare */
  --surface:   #FFFFFF;
  --surface-2: #F1EDE4;
  --text:      #1B2942;
  --muted:     #5E6167;
  /* --primary / --secondary / --success / --danger unchanged across themes */
}
```

**Two hard consolidation rules** (these are the audit's real bugs):

1. **Retire both status ramps.** The Bootstrap (`#28a745`/`#dc3545`) and Tailwind (`#10b981`/`#ef4444`) collision collapses into exactly `--success #4FB286` and `--danger #E5645E`. Replace every `#667eea → #764ba2` purple gradient (181 uses across `styles.css`, `App.jsx`, `BuilderPage.css`, `auth.css`, `UserManagement.css`, `HelpSystem.css`, `IssueFab.css`, `AIPromptManager.css`, `WavelengthWordCloud.jsx`) with tokens — flat `--surface`/`--primary`, never a gradient on interactive elements.
2. **One meaning per color, one warm accent per screen.** Amber (`--primary`) is reserved for the *single* most important thing on any given view — the timer, OR the correct-answer stat, OR rank #1, OR the alpenglow — never two at once. Correctness is teal (`--success`); **incorrect answers are neutral** (`--muted` + strike + `XCircle`), *not* red, so red only ever means "destructive/error." This scarcity is what breaks the generic-AI look.

**Projector contrast:** all ratios above are against `--bg`; large-text amber holds ≈8.4:1 even after a projector lifts the black point.

---

## 2. Typography

Two Google fonts, self-hosted — **removes the Webflow-CDN `PP Neue Corp Wide` dependency** currently in `styles.css`.

```html
<!-- index.html <head>, or @import top of styles.css -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```
```css
:root {
  --font-display: "Archivo Expanded", system-ui, sans-serif; /* wide+heavy, recreates PP Neue Corp Wide */
  --font-ui:      "Inter", system-ui, sans-serif;
}
/* tabular figures everywhere numbers must not jitter */
.tnum, .timer, .score, .vote-pct { font-feature-settings: "tnum" 1; }
```

- **Display — `Archivo Expanded` 700/800:** true *expanded* width axis → poster-confident headers at projector distance. Reserved for big moments only: question title, timer, leaderboard score, champion reveal, flash banners.
- **UI/body — `Inter` 400/500/600/700, tabular:** carries ~95% of the app. Already present once in the codebase — make it system-wide; retire the lone `Inter` ad-hoc usage and monospace stays for debug/prompt blocks only.

**Big-screen scale** (1920×1080, viewer ~10–20 ft; use `clamp()` for 4K/720p projectors). All headings **centered** on the stage except leaderboard rows (left-name / right-score):

| Element | Font / weight | Size | Notes |
|---|---|---|---|
| Question title | Archivo Exp 800 | `clamp(48px, 4.4vw, 68px)` | max 26ch, line-height 1.05 |
| Question detail | Inter 400 | 30px | `--muted`, below title |
| Option text | Inter 600 | 40px | in card |
| Option letter A–D | Archivo Exp 700 | 32px | amber filled circle badge |
| Timer numeral | Archivo Exp 700, tnum | `clamp(72px, 6vw, 96px)` | `--primary`, in progress ring |
| Kicker / category / "QUESTION 3 / 10" | Inter 600 | 20px | UPPERCASE, tracking .08em, `--muted` |
| Leaderboard name | Inter 600 | 36px | left-aligned |
| Leaderboard score | Archivo Exp 700, tnum | 44px | right-aligned |
| Answer explanation | Inter 400 *italic* | 30px | Field Notes pull-quote |
| Flash-alert banner | Archivo Exp 800 | 56px | full-bleed takeover |

---

## 3. Icon system — Phosphor (`@phosphor-icons/react`)

```bash
npm i @phosphor-icons/react
```

**Why Phosphor, not Lucide/Heroicons:** Lucide/Heroicons *are* the ubiquitous thin-stroke look the owner is reacting against, and neither has native trophy/medal/podium (would force substitutions; Heroicons ships only 2 weights). Phosphor: ~1,250 glyphs × 6 weights **including `duotone`** (a second color fills the shape) — covers all ~70 audit glyphs by name and delivers "simple but VERY stylized" with zero custom work.

**Weight rules:** `duotone` (amber fill) for the ~15 feature/hero icons → `bold` for inline UI controls → `fill` for status dots. Build **one `<Icon name weight>` wrapper**; sweep **JSX only** (leave `console.log` emoji in `WebSocketClient.js`, `aiBatchClient.js` alone).

```jsx
// src/src/components/Icon.jsx
import * as Ph from "@phosphor-icons/react";
export default function Icon({ name, weight = "bold", size = 24, color = "currentColor", ...rest }) {
  const C = Ph[name] ?? Ph.Circle;
  return <C size={size} weight={weight} color={color} {...rest} />;
}
```

| Current emoji | Meaning | Phosphor name | Weight / tint |
|---|---|---|---|
| 🏆 | Champion / results header | `Trophy` | duotone, `--primary` |
| 🥇🥈🥉 | Placement | `Medal` | fill — amber / `#C0C6D0` / `#B4794A` |
| 📊 | Report / results / distribution | `ChartBar` | duotone |
| 🎯 | Create engagement / target | `Target` | duotone |
| 🤖 / 💡 (Workie AI) | Insight panel | `Sparkle` | duotone, `--primary` |
| 💡 | Discussion / idea | `Lightbulb` | duotone |
| 🗳️ | Vote phase | `ListChecks` | bold |
| ⏳ | Waiting / countdown | `Timer` | bold, `--primary` |
| 🔌 | WS status | `Broadcast` (up) / `WifiSlash` (down) | bold, `--success` / `--muted` |
| 📺 | Big Screen toggle | `Monitor` | bold |
| ✅ / ❌ | Correct / incorrect | `CheckCircle` / `XCircle` | fill, `--success` / `--muted` |
| 🔍 | Browse questions | `MagnifyingGlass` | bold |
| 📋 | Copy invite / summary | `ClipboardText` | bold |
| 🔗 | Player URL | `LinkSimple` | bold |
| 👥 | Players | `UsersThree` | bold |
| ⚡ / 🚀 | Quick start / Start game | `Lightning` / `PlayCircle` | bold |
| 🎉 | Game complete | `Confetti` | duotone, amber + periwinkle |

**Workie mascot** (`workie.png`) stays as the one intentional character — re-tint its circular frame from purple to an `--primary` amber ring so it belongs to the system.

---

## 4. Mountain motif — `<Ridge>` component, continuity is the point

Replace the Osmo parallax `.webp` stack (referenced in `GameHostPage.jsx`, `PlayerPage.jsx`, `styles.css`) with **one inline-SVG ridgeline** — 3 overlapping vector paths anchored to the bottom edge, tokened fills (`--ridge-front/mid/back`), plus a soft radial **amber summit-glow** behind the peaks. Razor-sharp at any projector res, zero external deps.

```jsx
<Ridge variant="lobby | question | results | summit" />
```

**Usage rules (the discipline that makes it read as identity, not a sticker):**

1. **Persistent backdrop across all four big-screen states** — that continuity is what makes it intentional. Content always floats above it.
2. **It recedes when content needs the stage:**
   - **Lobby/waiting** → ridge tall (~40% viewport), glow low/warm; event title sits *above the peaks*.
   - **Question/voting** → ridge shrinks to a thin ~15% bottom band, glow near-zero — the question owns the screen. **No competing imagery behind live options** (the #1 amateur tell).
   - **Results** → glow **brightens and rises**: peaks catch an amber rim-light ("alpenglow") — a reward beat behind the leaderboard.
   - **Summit/champion** → filled peak + `Confetti`; this is the *only* screen where the mountain and amber fully meet, so the finale lands.
3. **Amber is banned from any photographic content** and there is none — the ridge is vector and tokened, so the summit-glow stays the only warm light.
4. **Transitions** (ASK→VOTE→RESULTS): 400ms CSS `transform/opacity` cross-fade — ridge nudges a few px, glow eases up. Replaces the JS parallax entirely. Optional flourish: `stroke-dashoffset` left-to-right ridge-draw on state entry.
5. Reuse the ridge stroke as **hairline section dividers** (`--muted` low-opacity) so every screen ties together.

---

## 5. Big-screen host layout — concrete

**Grid:** 8px base, 80px outer margins, 24–32px gaps, `--radius:16px` cards, hairline separators, **zero gradient/shadow on UI** (depth = hairlines + whitespace + the ridge only).

### Question state (dusk stage)
```
┌ 80px margin ─────────────────────────────────────────────────┐
│ ◆ TECHNOLOGY   QUESTION 3 / 10            ⟨ 0:24 ⟩  ◜ring◝    │ top bar ~96px
│ ───────────────────────── hairline ─────────────────────────  │   amber timer
│                                                               │   + circular
│              What year did the first iPhone                   │   progress ring
│                    ship to customers?                         │ Archivo Exp 800
│              context / detail line · Inter 400 muted          │ centered, ≤26ch
│                                                               │
│    ┌──────────────────────┐   ┌──────────────────────┐        │ 2×2 grid
│    │ (A)  2005            │   │ (B)  2007            │        │ --surface cards
│    ├──────────────────────┤   ├──────────────────────┤        │ 16px radius
│    │ (C)  2009            │   │ (D)  2010            │        │ 24px gap, 40px
│    └──────────────────────┘   └──────────────────────┘        │ fills lower ~55%
│                                                               │
│  ▁▂▃▅▂▁  ← Ridge variant="question" (15% band)   18 answered ●●●○ │ progress
└───────────────────────────────────────────────────────────────┘
```
- **Hierarchy:** only the **timer (amber, top-right, thin ring)** and the **question title** compete; option cards are visually quiet slate until reveal.
- **Letter badges:** A–D in filled amber circles, Archivo Expanded — instant scan.
- **Poll variant:** ASK→VOTE swaps the 2×2 for a single-column choice list, same card language; VOTE grows a 2px amber under-bar per tile with tabular % right-aligned.
- **Reveal:** correct card → 2px `--success` border + `CheckCircle` fill; selected-incorrect → `--muted` + strike + `XCircle` (never red). Amber stays reserved for the answer *stat/count*, teal for correctness — the two never fight.

### Results state (split 60 / 40)
```
┌───────────────────────────────────────────────────────────────┐
│ ◆ QUESTION 3 · RESULTS                                          │
│                                                                │
│ ✓ 2007  +300   (Archivo Exp, --success, CheckCircle)           │ correct band, full-width
│   explanation · Inter 400 italic pull-quote · --muted          │
│ ──────────────────────────── hairline ──────────────────────── │
│ ┌─ Leaderboard (60%) ─────────────┐  ┌─ FIELD NOTES (40%) ────┐ │
│ │ ▎♛ Priya            1,240  +180 │  │ ✦ Workie's Analysis    │ │ Sparkle duotone
│ │    Marcus             980  +90  │  │ ────────────           │ │ amber header
│ │    Dana               870  +90  │  │ Summary                │ │ --surface-2 card
│ │    Lee                640       │  │ Discussion (numbered)  │ │ hairline dividers
│ │    …                            │  │ Next steps             │ │ thin amber left-rule
│ └─────────────────────────────────┘  └────────────────────────┘ │
│  ░▂▃▅▇▅▃▂░  ← Ridge variant="results" (amber alpenglow rim-light)│
└────────────────────────────────────────────────────────────────┘
```
- **Distribution:** horizontal bars — correct bar `--success`, others `--muted`, %s tabular right-aligned. (Amber not used here; it's spent on the leaderboard leader.)
- **Leaderboard rows:** `Medal` fill (amber/silver/bronze), name Inter 600 36px, score Archivo Exp tabular 44px right-aligned, hairline between rows. **Only rank #1 carries a 4px amber left-rule** — the single amber in the list, so #1 pops.
- **Workie → "Field Notes":** reframed from chatbot bubble to an editorial sidebar — `--surface-2` card, `Sparkle` duotone amber header, thin amber left-rule, sections split by hairlines: Summary → numbered Discussion topics → Next steps. Re-tinted Workie avatar top-right.
- **Reveal choreography:** correct band slides in first → leaderboard rows stagger up (60ms each) → leader's `+delta` ticks in amber → ridge alpenglow brightens on entry.
- **Game-complete:** `<Ridge variant="summit">` — champion name in Archivo Expanded 100–120px *above the filled peak*, single `Trophy` duotone, one amber score, `Confetti` (amber + periwinkle). The only screen where mountain + amber fully converge.

---

## 6. Highest-impact first changes (ordered)

1. **Token layer first.** Add the `:root` + `[data-theme="light"]` blocks above to `src/src/styles.css`. Nothing else proceeds cleanly given the ~350 hardcoded literals.
2. **Kill the purple gradient.** Sweep `#667eea`/`#764ba2` → tokens across `styles.css`, `App.jsx`, `BuilderPage.css`, `auth/auth.css`, `components/UserManagement.css`, `HelpSystem.css`, `IssueFab.css`, `AIPromptManager.css`, `WavelengthWordCloud.jsx`. Interactive elements go flat `--primary`/`--surface`, gradient survives only as `--summit-sky` behind the ridge.
3. **Collapse status ramps** to single `--success`/`--danger`; make incorrect neutral (`--muted` + `XCircle`) wherever answer-correctness renders in `GameHostPage.jsx`.
4. **Swap fonts.** Add the Archivo Expanded + Inter `<link>` to `index.html`; delete the `PP Neue Corp Wide` @font-face/CDN reference in `styles.css`.
5. **`npm i @phosphor-icons/react`; add `src/src/components/Icon.jsx`;** begin the emoji→Phosphor JSX sweep in `GameHostPage.jsx` big-screen states first (highest visibility), then `PlayerPage.jsx`, `AdminPage.jsx`.
6. **Add `<Ridge>`** (`src/src/components/Ridge.jsx`) and replace the Osmo `.webp` parallax refs in `GameHostPage.jsx` / `PlayerPage.jsx` / `styles.css`. Wire `variant` to the four big-screen states.
7. **Relayout `GameHostPage.jsx` question + results** to the grids in §5 (dusk stage), gating the dark theme to projector/big-screen states while authoring UI stays on the paper theme.

---

## Current-design audit (file:line references)

I have everything needed. Here's the complete design map.

---

# Engage2 Frontend — Current Design Map

All paths under `/Users/georgeseib/Documents/projects/engage2/src/src/`

## 1. Screens & Routing

Routing is manual (`window.location.pathname`) in `App.jsx` (lines 141–223):

| Path | Component | Audience | Redesign focus? |
|------|-----------|----------|-----------------|
| `/` (default) | `GameHostPage.jsx` (193 KB) | **Host / projector** | **YES — primary** |
| `/play*` | `PlayerPage.jsx` (92 KB) | Mobile player | secondary |
| `/remote*` | `HostRemote.jsx` + `HostRemote.css` | Host's phone (drives projector) | supporting |
| `/builder*` | `BuilderPage.jsx` + `BuilderPage.css` | Host authoring | no |
| `/admin*` | `AdminPage.jsx` (77 KB) | Admin | no |
| `/auth*` | `auth/AuthPage.jsx` + `auth/auth.css` | Login | no |
| `/privacy`, `/terms` | policy pages | public | no |

Almost all styling lives in one giant global stylesheet: **`styles.css` (152 KB)**. Component-scoped CSS files exist only for a few widgets (`BuilderPage.css`, `HostRemote.css`, `auth/auth.css`, `components/AIPromptManager.css`, `HelpSystem.css`, `HelpButton.css`, `IssueFab.css`, `IssueReportForm.css`, `FileUploadPrompt.css`, `UserManagement.css`, `documentation/documentation.css`).

### Big-screen / projector presentation views (the redesign target)
`GameHostPage.jsx` has a **`bigScreenMode`** toggle (state at line 161; "📺 Big Screen ON/OFF" button at line 3121; keyboard shortcut at line 193). When on, it adds `big-screen-mode` classes to the state containers. The four projector states are:
- **Waiting/lobby** — `waiting-state` (join QR, players list) — JSX ~3373, CSS `styles.css:6661+`
- **Question** — `question-state` — JSX ~3408, CSS `styles.css:6721+`
- **Voting** — `voting-state` — JSX ~3495
- **Results** — `results-state` (leaderboard, Workie AI insights) — JSX ~3545, CSS `styles.css:6649+`

Big-screen container styling: `styles.css:6590–6790`. In big-screen mode the parallax hero is hidden (`styles.css:6607`) and content uses the full-viewport purple gradient (`styles.css:6649`). `PlayerPage.jsx` and `HostRemote.jsx` are mobile-first and are NOT the redesign focus.

## 2. Fonts

- **Display font: `'PP Neue Corp Wide'`** (ultrabold 800), `@font-face` at `styles.css:2–8`, loaded from a Webflow CDN woff2 (`cdn.prod.website-files.com/.../PPNeueCorp-WideUltrabold.woff2`). Used on ~30 headings/titles (game titles, section headers, parallax title, modal titles).
- **Body/UI font:** system stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif` (`styles.css:18`).
- **`'Inter', sans-serif`** — used once (`styles.css:5081`).
- **Monospace** (`'Monaco','Menlo','Ubuntu Mono'` / `'Courier New'`) — code/debug/prompt blocks only.

## 3. Color Palette (current, by frequency)

Primary brand is the classic **purple-indigo gradient** `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` (body bg `styles.css:21`, buttons, ~30 hero/content backgrounds).

| Hex | Role | Uses |
|-----|------|------|
| `#667eea` | **Primary indigo** (buttons, borders, accents) | 181 |
| `#764ba2` | **Primary purple** (gradient end) | 16 |
| `#5a6fd8` | primary hover | 8 |
| `#333333` | primary text | 84 |
| `#555` / `#666` / `#999` | secondary/muted text | 20 / 58 / 6 |
| `#2c3e50` | dark heading text | 19 |
| `#f8f9fa` | light surface / panel bg | 58 |
| `#f8f9ff` | tinted panel | 6 |
| `#e1e1e1` / `#e1e5e9` / `#e9ecef` / `#dee2e6` | borders/dividers | 44 / 11 / 15 / 9 |
| `#4caf50` / `#28a745` / `#10b981` | success green | 21 / 14 / 9 |
| `#d4edda` / `#155724` / `#f0f8f0` | success bg/text | 7 / 6 / 5 |
| `#ffc107` / `#ffd700` / `#f0ad4e` | warning / gold | 9 / 4 / 5 |
| `#fff3cd` / `#856404` | warning bg/text | 8 / 9 |
| `#ef4444` / `#ff6b6b` | error/danger red | 7 / 4 |
| `#f8d7da` / `#721c24` | error bg/text | 5 / 5 |
| `#4a90e2` | secondary blue accent | 5 |
| `#6c757d` / `#495057` / `#6b7280` | grays (bootstrap-ish) | 8 / 12 / 6 |

The palette is inconsistent — it mixes a Bootstrap gray/status ramp (`#28a745`, `#dc3545`-family, `#6c757d`) with a Tailwind-ish ramp (`#10b981`, `#ef4444`, `#6b7280`). **There are no CSS custom properties / design tokens** — every color is a hardcoded literal, so a token layer is a prerequisite for the refresh.

## 4. The "mountain image" motif

It is **not** literally a mountain file — it is a **layered parallax scenic hero** built from the Osmo Webflow parallax template, plus a mascot avatar. Two distinct things:

**A) Parallax hero header (the scenic/mountain motif)** — `GameHostPage.jsx:2510–2521`, CSS `styles.css:678–780` (`.parallax`, `.parallax__layers`, `.parallax__layer-img`, `.parallax__title`, `.parallax__fade`). Three stacked `data-parallax-layer` webp images from the Webflow CDN:
- `...6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp` (back)
- `...6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp` (mid)
- `...6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp` (front)

with the big `PP Neue Corp Wide` title ("Trivia" / "Engagements") layered between them (`styles.css:740`, 4rem, white, heavy text-shadow). Rendered only on the host landing/lobby; **hidden in big-screen mode** (`styles.css:6607`). This Osmo template is the source of both the parallax and the `PP Neue Corp Wide` font — it's the visual signature to replace.

**B) "Workie" mascot** — `public/workie.png` (1.4 MB; also `src/dist/workie.png`, `src/public/workie.png`). A circular AI-assistant avatar, not a mountain. CSS `.workie-avatar` / `-disabled` / `-large` / `-icon-small` at `styles.css:5726–5766`. Used in `GameHostPage.jsx:3730, 3739, 3854` (results AI-insights panel) and `AdminPage.jsx:1059`.

## 5. Emoji-as-icon inventory (to replace with a stylized icon set)

Emojis are used pervasively as UI icons. Distinct glyphs across JSX with total occurrences (includes some in `console.log`, but the vast majority render in UI): `🔍`(83) `✅`(79) `❌`(75) `🎯`(49) `📊`(47) `🔌`(41) `🤖`(38) `⚠️`(36) `🔄`(29) `📋`(27) `📝`(24) `🗳️`(19) `🎮`(17) `🗑️`(15) `💡`(15) `🏆`(15) `✓`(15) `📚`(13) `⏳`(13) `🚀`(12) `📤`(11) `✕`(11) `🥈`(10) `🔗`(10) `📥`(10) `📄`(10) `⚡`(10) `🧠`(9) `🥉`(9) `📡`(9) `📍`(9) `❓`(9) `🔧`(8) `🐛`(8) `⏭️`(7) `🥇`(6) `💾`(6) `🎨`(6) `🚨`(5) `📅`(5) `💬`(5) `👥`(5) `👤`(5) `➕`(5) `⚙️`(5) `🖥️`(4) `📱`(4) `📁`(4) `🌊`(4) `✨`(4) `⏱️`(4) `🪄`(3) `🤝`(3) `🔐`(3) `🏗️`(3) `✗`(3) `✏️`(3) `⏰`(3) plus singles: `📺 🏠 🏁 🎲 🎉 🔴 🟢 🟡 🚧 🔒 🎤 🏷️ 🆕 ⬆️ ⬇️ ➡️ ⏸️ ✈️` etc.

### Highest-value replacement targets (the projector/host view — `GameHostPage.jsx`, UI-rendered, file:line)
- 2534 `⚡ Quick Start` · 2538 `🎯 Create Engagement` · 2563 `📋 View Game History`
- 2621 `🎮 Game History` / `📊 Game Reports` (modal titles)
- 2631 `🎯` empty-state icon · 2651 `✨ Latest` · 2652 `📍 Current` · 2660 `⏸️ Ready to Start`
- 2670 `💬 Call & Answer` / `🧠 Trivia` · 2713 `🔗 Player URL` · 2723 `📋 Invite` · 2734 `📊 Report` · 2749 `▶️ Continue` / `🚀 Start Game` · 2769 `❌ Cancel` / `✖️ Close`
- 3074 `✓ Link copied!` · 3089 `🔌 WebSocket` status · 3093 `🔄 HTTP Polling Mode` · 3110 `📋 Copy Invite` · **3121 `📺 Big Screen ON/OFF`** · 3175 `📚` question-set header · 3263 `🔍` browse-questions button
- Rank icons (leaderboard, big-screen results): 3341–3346 & 4432 `👤/🏆/🥈/🥉/📍`; 3357/3362 `✓`/`⏱️` answered/voted status; 3546 `🏆 Question N Results`; 3711 `🥇/🥈/🥉` placement
- 3634 `✓`/`✗` +pts · Workie AI panel: 3732 `🤖`, 3741 `💡`, 3769 `📋 Summary`, 3775 `💬 Discussion Topics`, 3785 `🎡 Next Steps`, 3798 `🐛 Debug`, 3828 `🎯 Context Sources`, 3845 `📝 Full AI Prompt`, 3856 `🤖 Workie's Analysis`
- Flash alerts (big on-screen): 3905 `⏳`, 3916 `🎉`, 3927 `🗳️`, 3938 `📋` (class `flash-alert-icon`)
- 4033 `🔍 Browse Questions` · 4068/4325 `✓ Correct` · 4336 `🤖 AI Analysis` · 4435 `🏆 Session Champion`

### PlayerPage (mobile, secondary — `PlayerPage.jsx`, file:line)
841–843 `🥇/🥈/🥉` place · 1276 medal · 1338 `💡 Save this URL` · 1344 `🔐 Private Game` · 1404 `👤 {name}` · 1412 `🔌` connection · 1418 `🔄` restored · 1443 `✅ You're in!` · 1588 `✈️` submit · 1639 `✅ Answer Submitted` · 1649 `🗳️ Vote` · 1676–1678 medals · 1735 `✅ Votes Submitted` · 1744 `📊 Question N Results` · 1854/1855 `✓`/`✗` · 1878 `⚡` speed · 1902–1904 & 2047–2049 rank medals · 1925 `🤝 Common Words` · 1970 `📝 Your Words` · 2077 `🏁 Game Complete!`

### Emoji load by file (scope for the swap)
`GameHostPage.jsx` 365 · `PlayerPage.jsx` 186 · `AdminPage.jsx` 89 · `auth/OAuthCallback.jsx` 45 · `components/AIPromptManager.jsx` 41 · `WebSocketClient.js` 36 (mostly console) · `components/ArchivePanel.jsx` 35 · `documentation/HostQuickStartDoc.jsx` 32 · then a long tail across `components/*` (see counts: FileUploadPrompt 23, AIScenarioBuilder 22, ArchiveManager 21, HelpSystem 19, HostRemote 18, TriviaAIBuilder 17, ArchiveSearch 16, QuickstartMenu 15, PollAIBuilder 14, SurveyAIBuilder 13, IssueReportForm 12, BuilderPage 12, etc.).

Note: a meaningful fraction of `✅ ❌ 🔍 🔌 🔄 📊 📡 🚨` occurrences are `console.log`/`console.error` prefixes (esp. in `WebSocketClient.js`, `utils/aiBatchClient.js`, and top-of-file logging in the page components) — those are not UI and can be left alone. A recommended replacement approach: introduce a single `<Icon name="…">` component mapping the ~70 distinct glyphs to a stylized set, then sweep JSX (not console statements).

### Recommended refresh prerequisites
1. No design tokens exist — add a CSS-variable token layer first (colors, the `#667eea→#764ba2` gradient, spacing, radius).
2. Consolidate the two conflicting status-color ramps (Bootstrap vs Tailwind greens/reds) into one.
3. Replace the Osmo/Webflow dependency (parallax layer webp URLs + the `PP Neue Corp Wide` CDN font) — both are external Webflow-CDN assets and define the current look.
4. Build the `<Icon>` set to retire ~70 emoji glyphs, prioritizing the `GameHostPage` big-screen states listed above.