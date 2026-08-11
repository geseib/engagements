# Art brief — the Warm Summit hero, layered

**For:** an artist producing original assets for this project
**Status:** brief. No assets exist yet.
**Companion:** `src/src/components/Ridge.jsx` (the vector motif that already exists)

---

## 0. The one-paragraph version

The product's visual signature is a mountain ridgeline at dusk with an amber
summit-glow. It exists today as a **vector** component (`Ridge.jsx`) — sharp at
any projector resolution, ~2 KB, zero network. What is wanted in addition is a
**layered raster version** for the few moments that deserve depth and
atmosphere: the landing page, the session lobby, and the end-of-session summit.

Both must read as **the same mountain**. The raster art is the vector motif with
air, light and texture added — not a different landscape.

---

## 1. Why we are commissioning rather than mirroring

`src/public/assets/art/CREDITS.json` sets this project's rule:

> Public-domain artwork mirrored from Wikimedia Commons and re-encoded to
> 1200px JPEG. Served from the app origin via CloudFront so a round never
> depends on an external host mid-session.

Two halves, both binding. **Serve from our own origin** — the parallax that was
removed pulled three `.webp` layers from a third-party CDN nobody here controls,
on a screen only reachable behind Cognito. And **provenance is tracked per
file**, public-domain or owned only. The removed layers were neither: they came
from a paid design library. So they are not the thing to mirror, and original
work is the clean route.

**Every delivered file gets a `CREDITS.json` entry** (§7).

---

## 2. Where each treatment is used

| Surface | Treatment | Why |
|---|---|---|
| Admin console header | **Vector** `Ridge` | Dense, utilitarian, read at 24in. Costs nothing. |
| Host page header | **Vector** `Ridge` | Same block was removed from both; decided once. |
| Question / voting states | **Vector** `Ridge variant="question"` | Must recede to near-nothing. The question owns the screen. |
| **Landing / root page** | **Raster, layered** | First impression, and the one page a stranger sees. |
| **Session lobby** | **Raster, layered** | On screen for minutes while people join. Earns depth. |
| **ENDED / summit** | **Raster, layered** | The payoff moment. Pairs with confetti. |

The rule: **raster where the screen is held and looked at; vector where it is
worked in.** Do not put raster behind a dense working surface — it competes with
content and costs bytes on a conference wifi connection.

---

## 3. The palette — locked, not suggested

These are live design tokens in `src/src/styles.css`. Match them exactly; the
raster must composite seamlessly with the vector `Ridge` on the same screen.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0F1A2E` | Deepest dusk slate. The field everything sits on. |
| `--ridge-front` | `#16233B` | Front range — nearest, darkest |
| `--ridge-mid` | `#22344F` | Middle range |
| `--ridge-back` | `#2E4262` | Back range — furthest, lightest |
| `--primary` | `#F6A94C` | Amber summit-glow. **The only warm light on the stage.** |
| `--primary-deep` | `#C77B4A` | Horizon gradient stop, summit fill |
| `--text` | `#F4EDE4` | Warm paper-white. Never pure `#FFF`. |

Sky gradient (`--summit-sky`), top to bottom:
`#16233B 0%` → `#2A3A57 52%` → `#C77B4A 100%`

**One amber source.** The glow behind the peaks is the only warm light in the
frame. No second light source, no warm rim on unrelated elements, no lens flare.

---

## 4. THE HARD CONSTRAINT — text legibility

Product copy is rendered **over** this art in `--text` `#F4EDE4`. Measured
contrast against the sky gradient's own stops:

| Under the text | Contrast with `#F4EDE4` | Verdict |
|---|---|---|
| `#16233B` (gradient top) | **13.57:1** | excellent |
| `#2A3A57` (gradient mid) | ~10.5:1 | fine |
| `#C77B4A` (gradient bottom) | **2.84:1** | **fails AA badly** |

So: **the warm amber must stay in the bottom 40% of the frame**, where no text
lands. The top 55–60% must hold a luminance low enough that `#F4EDE4` clears
**4.5:1**, and 7:1 is better — some of this is read at 25 feet in a lit room.

Practically that means: keep the upper field dark and quiet. Atmosphere,
gradient and star-field are welcome up there; brightness is not. If a
composition genuinely needs light high in the frame, it must be dim enough to
stay under the ceiling, or the layer ships with a built-in scrim.

**This is the single most common way this kind of art fails in use.** A hero
that looks superb in isolation and renders the title illegible on a projector is
a failed asset. The existing design audit checks exactly this
(`docs/design/admin-redesign/audit.html`, check A4, which composites before
measuring).

---

## 5. Layer structure

**Minimum three layers**, matching the vector motif's three ranges so the two
treatments are recognisably the same mountain:

| # | Layer | Content | Alpha | Parallax depth |
|---|---|---|---|---|
| 0 | `sky` | Sky gradient, atmosphere, optional sparse stars. Amber glow bloom behind where the peaks will be. | opaque | `0.0` (static) |
| 1 | `back` | Furthest ridge, `--ridge-back` family. Softest edges, most atmospheric haze. | **transparent above ridgeline** | `0.15` |
| 2 | `mid` | Middle range, `--ridge-mid` family. | **transparent** | `0.35` |
| 3 | `front` | Nearest range, `--ridge-front` family. Sharpest silhouette, the central summit sits under the glow. | **transparent** | `0.60` |

Optional 4th if it earns its bytes: `haze` — a thin valley-fog band between mid
and front, transparent, depth `0.45`.

Layers 1–3 are **bottom-anchored silhouettes**: opaque from their ridgeline down
to the bottom edge, fully transparent above it. Composite them over layer 0 and
you get the finished frame.

The central summit should sit at roughly **50% width**, matching the vector
path's peak at x=600 of a 1200 viewBox.

### Overscan

Parallax layers translate horizontally. Each of layers 1–3 needs **20%
horizontal overscan** (10% bleed each side) so movement never reveals an edge.
Layer 0 needs 10%.

---

## 6. Formats, sizes, budget

**Format:** WebP (primary). Add AVIF if convenient — smaller, and every browser
this product supports handles it. No JPEG for layers 1–3; they need alpha.

**Widths** — three of each layer, for `srcset`:

| Width | Target |
|---|---|
| 1280px | laptop, phone landscape |
| 1920px | most projectors and desktops |
| 2560px | large displays, ultrawide |

Heights: aim **16:9** for layer 0; layers 1–3 need only the band they occupy —
roughly the bottom 45% of the frame — plus the overscan.

**Byte budget**, and it is real: this is delivered over conference wifi, often
while thirty people are joining on phones.

| | Budget |
|---|---|
| Any single layer @2560 | **≤ 180 KB** |
| Full hero set @1920 (4 files) | **≤ 450 KB** |
| Full hero set @2560 | **≤ 550 KB** |

For calibration, the existing art in `src/public/assets/art/` runs 205–673 KB
per full-frame JPEG. Silhouette layers compress far better than photographs —
large flat regions, few gradients — so this budget is generous, not tight.

**Do not exceed the budget to add detail nobody sees at 25 feet.**

---

## 7. Delivery

Files land in **`src/public/assets/hero/`** (new directory). That path is copied
verbatim into `dist/` by `CopyWebpackPlugin` and synced to S3, so it is served
from our own origin and **does not enter the JS bundle**.

Naming — lowercase, hyphenated, width-suffixed:

```
src/public/assets/hero/
  summit-sky-1280.webp     summit-sky-1920.webp     summit-sky-2560.webp
  summit-back-1280.webp    summit-back-1920.webp    summit-back-2560.webp
  summit-mid-1280.webp     summit-mid-1920.webp     summit-mid-2560.webp
  summit-front-1280.webp   summit-front-1920.webp   summit-front-2560.webp
  CREDITS.json
```

`CREDITS.json` follows the existing convention in `assets/art/`:

```json
{
  "note": "Original commissioned artwork for the Warm Summit hero. Served from the app origin so a session never depends on an external host.",
  "images": [
    {
      "file": "summit-front-1920.webp",
      "title": "SUMMIT — FRONT RANGE",
      "credit": "<artist name>, 2026",
      "source": "Original work commissioned for this project",
      "license": "<licence granted — e.g. exclusive, perpetual, worldwide>"
    }
  ]
}
```

**The `license` field must be filled in for real.** The whole reason this brief
exists is that the previous assets had no answer to that question.

---

## 8. Motion

Parallax translates on pointer movement and/or scroll, along the depth values in
§5. Keep it **subtle** — a total travel of ~2–4% of viewport width across the
full input range. This is a backdrop, not a ride.

Two non-negotiables:

- **`prefers-reduced-motion: reduce` disables the translation entirely.** The
  layers still composite; they just stop moving.
- **No motion at all on the question and voting states.** People are reading and
  deciding. The vector `Ridge` handles those states anyway.

---

## 9. What to look at first

`Ridge.jsx` renders the shape language this must match — three overlapping
paths, bottom-anchored, with a radial amber glow at 50% width / 42% height and
55% radius. Its four variants (`lobby`, `question`, `results`, `summit`) show how
the band height and glow strength shift by state.

The front range's silhouette, as vector path data, is the canonical profile:

```
M0,600 L0,420 L180,470 L340,360 L520,300 L600,230 L700,320 L880,380 L1060,440 L1200,410 L1200,600 Z
```

The raster front range does not have to trace this exactly — it should feel like
the same ridge with real rock, snow and air, and the summit in the same place.

---

## 10. Acceptance checks

Before these are wired in:

1. **Contrast.** Sample the composited frame at 20 points across the top 55%.
   `#F4EDE4` must clear **4.5:1** at every one.
2. **Budget.** Every file inside §6.
3. **Alpha.** Layers 1–3 fully transparent above the ridgeline — composite over
   pure magenta and check for fringing.
4. **Overscan.** Push each layer to its full parallax travel; no edge enters frame.
5. **Seam.** Vector `Ridge` and the raster front range on adjacent screens should
   read as the same mountain.
6. **Projector.** Full-screen at 1920×1080 in a lit room, viewed from 25 feet.
   This one cannot be automated and is the one that matters most.
7. **`CREDITS.json`** complete, `license` filled in.
