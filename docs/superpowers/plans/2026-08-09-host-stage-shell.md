# Host Stage Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both of GameHostPage's current layouts with one fixed-height stage that fits every state on a single screen, at type a room can read, with the four display profiles and the reduction ladder actually working.

**Architecture:** One DOM, one layout, four *literal* CSS ladders declared on the root element (not one ladder times a multiplier — §4.2 records in detail why that could not work). A `.stage` grid of four rows — rail, phase bar, main, dock — where `main` is a two-column grid of content and the room meter. A `fit()` pass searches for the largest presentation that loses nothing, and when nothing fits it sacrifices in a declared order, chrome before content, always.

**Tech Stack:** React 18 (CRA, `src/`), plain CSS in `src/src/styles.css` plus a new stylesheet, Jest + Testing Library (`src/src/__tests__/`), no CSS-in-JS, no build-step additions.

**Spec:** `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md`. This plan implements §8's steps (1) and (2). Steps (3)–(5) — the Console, per-state content, ENDED — are plans 3–5 and are explicitly out of scope here.

**Approved mockups:** `docs/design/host-redesign/`. These are not sketches — they are audited, running HTML at 168 checks / 0 failures across 21 pages × 4 profiles × 2 viewports, and they are the **source of truth for every CSS value and every line of the fitter**. Where this plan quotes them it quotes them verbatim; where it points at a line range, port that range unchanged rather than retyping it.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- **Never render room-facing text below the profile's floor** — 20px Room, 20px Call, 26px TV, 16px Table. Each is the same ~8.3 arcminute target projected through a different distance and pixel density (§4.2), which is why 16px on a laptop is *not* a violation of the 20px number. If content does not fit at the floor, reduce the content, not the type.
- **A reduction may only fire when space is actually exhausted.** Truncation is something the fitter *does*, never something it inherits from the base stylesheet. Line clamps in base CSS make the fitter blind: content arrives pre-cut, `scrollHeight` equals `clientHeight`, the fitter concludes it fits, and it stops. That produced the worst defect in the project — an 800px box holding 669px of content with five of six options truncated mid-word and 131px sitting empty underneath.
- **Chrome is sacrificed before content, always.** The meter's column goes at priority −1, ahead of every content group, through the ordered-sacrifice mechanism rather than a special case appended to the end.
- **Never abbreviate room-facing content.** Type steps down, layout changes, chrome is sacrificed, the meter's column is taken — and only then, if a state still cannot fit, does anything get cut, and that is a budget failure to fix, not a graceful landing.
- **Never scroll, and never clip silently.** No horizontal scroll anywhere, no vertical scroll on the stage, and no element may lose content to `overflow: hidden` without a *rendering* truncation. **A centred, clipping flex column is banned outright** — it decapitates the top of the content, which is the most important part. Columns are `flex-start` with `margin-block: auto` on the child, so overflow can only ever appear at the bottom.
- **Never state the same fact twice in one viewport.** One QR, one event title, one progress count, one score list, one round number.
- **Never name a person on the stage.** Not who has not answered, not who is late. A count is a nudge; a list of names is an attendance record and the room is the wrong audience for one. This binds Table too — Table is a stage profile.
- **Never print internal vocabulary on the stage.** No feature names, no model nicknames, no panel names.
- **Never lose the presentation state on reload.** The profile is written to `localStorage` and restored on mount.
- **The advance control must never be unreachable.** It is a grid row in a fixed-height grid; it cannot be scrolled past, clipped by an ancestor's `overflow: hidden`, or covered by a panel.
- **Sizes stay in `vh`,** because the binding constraint is vertical fit and `vh` tracks the projected image regardless of the projector's native resolution — one rule correct at 720p, 1080p and 4K.
- **Do not deploy.** `CLAUDE.md` reserves all deployments to the owner. Never run a deploy script, never push to `test` or `prod`.

## Baselines — verify before claiming a regression

| Suite | Command | Expected at start |
|---|---|---|
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / 242+ passed |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Backend | `for t in tests/*.js; do node "$t"; done` | 20 suites, 0 failed |

The 5 failing frontend suites are stale and out of scope — they predate the auth system (`useAuth must be used within an AuthProvider`) and call `new WebSocketClient()` on a singleton export. **Do not "fix" them.** Confirm the count before and after your task; a sixth failing suite is yours.

Aggregate backend counts with `grep -E '^[0-9]+ passed'`, **not** `tail -1`.

## The testing situation, stated honestly

`docs/design/host-redesign/audit.js` is written to port into component tests unchanged, and §8 says so. **It cannot be ported into Jest as-is.** Every one of its checks is geometric — `getBoundingClientRect`, `scrollHeight`, `getComputedStyle().fontSize` — and jsdom has no layout engine, so all of those return zero. A Jest port of `audit.js` would pass unconditionally and prove nothing, which is exactly the failure mode the spec spends §4.2b warning about.

So this plan splits the guarantee in two:

- **The fitter's *policy*** — the order of sacrifice, the binary search, the floor clamp, which elements may abbreviate — is extracted as pure functions over an injected measurement interface, and is unit-tested exhaustively in Jest. This is where the bugs actually were: `widen()` ordered after the drop loop, the epsilon that made A10 circular, `scrollHeight > clientHeight` asked of every element.
- **The rendered geometry** stays guarded by `audit.js` against the mockups, which run in a real browser and are already at 0 failures.

Closing the gap — running `audit.js` against the *React* app in a real browser — needs a headless-browser harness this repo does not have. That is real work and it is called out in "Out of scope, recorded" at the end. Do not fake it with jsdom.

## File Structure

**Create:**
- `src/src/styles/stage.css` — the four ladders, the stage grid, the three regions. New file rather than appending to the 9,654-line `styles.css`, because these rules must be readable as a set.
- `src/src/config/displayProfile.js` — the profile vocabulary, auto-selection and persistence. Pure; no React.
- `src/src/hooks/useStageFit.js` — the hook. Owns the DOM and the lifecycle, nothing else.
- `src/src/hooks/fitPolicy.js` — the fitter's decisions as pure functions over an injected measurer. This is the part that gets tested.
- `src/src/components/stage/Stage.jsx` — the grid and the profile class.
- `src/src/components/stage/Rail.jsx` — phase chip, title, round context, join line, optional timer.
- `src/src/components/stage/PhaseBar.jsx` — the full-width phase band.
- `src/src/components/stage/RoomMeter.jsx` — one region, one question: where is the room.
- `src/src/components/stage/Dock.jsx` — the bottom grid row. Wraps the existing `HostActionBar`.
- `src/src/__tests__/displayProfile.test.js`
- `src/src/__tests__/fitPolicy.test.js`
- `src/src/__tests__/stageShell.test.jsx`

**Modify:**
- `src/src/GameHostPage.jsx` — render the shell; delete the two old layouts and the listed dead code
- `src/src/index.css` or wherever global stylesheets are imported — import `styles/stage.css`
- `src/src/config/hostControls.js` — two additions only (§5.3); its decision logic is unchanged

**Do not modify:** `src/src/config/hostRemote.js`, `src/src/config/instructions.js`, `src/src/config/gameTypes.js`, `src/src/components/HostActionBar.jsx`'s keyboard handling / typing-target guard / disabled-hint behaviour. The spec names these as the best-reasoned files in the area. `HostActionBar`'s positioning CSS is the only part that changes.

---

### Task 1: The four display profiles

The parameter every later task reads. Pure logic plus a stylesheet; no components yet.

**Files:**
- Create: `src/src/config/displayProfile.js`
- Create: `src/src/styles/stage.css`
- Test: `src/src/__tests__/displayProfile.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PROFILES` → `['room', 'tv', 'call', 'table']`
  - `DEFAULT_PROFILE` → `'room'`
  - `profileClass(profile)` → `'d-room' | 'd-tv' | 'd-call' | 'd-table'`
  - `autoProfile(viewportWidth)` → `'table'` below 1600, `'room'` at or above
  - `loadProfile(storage, viewportWidth)` → the persisted profile if valid, else `autoProfile(...)`
  - `saveProfile(storage, profile)` → writes; ignores a throwing storage
  - `FLOORS` → `{ room: 20, tv: 26, call: 20, table: 16 }`

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/displayProfile.test.js`:

```js
/**
 * The display profile is the one parameter the whole stage reads, and it has
 * failed silently before: revision 1 scaled one ladder by a `--k` multiplier
 * declared on :root, where it substituted against :root's own value of 1, so
 * all three profiles rendered identically and only the boxes shrank. The audit
 * check that catches that (A5) lives in a browser; what CAN be tested here is
 * that the selection and persistence rules are right, because "never lose the
 * presentation state on reload" is a hard requirement and a projector browser
 * that reloads has to come back exactly as it was.
 */
import {
  PROFILES, DEFAULT_PROFILE, FLOORS,
  profileClass, autoProfile, loadProfile, saveProfile,
} from '../config/displayProfile';

/** A localStorage stand-in. jsdom provides one, but an explicit fake keeps
 *  these tests independent of jsdom's global state leaking between files. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

describe('the profile vocabulary', () => {
  test('there are exactly four, and Room is the default', () => {
    expect(PROFILES).toEqual(['room', 'tv', 'call', 'table']);
    expect(DEFAULT_PROFILE).toBe('room');
  });

  test('each profile maps to its root class', () => {
    expect(profileClass('room')).toBe('d-room');
    expect(profileClass('tv')).toBe('d-tv');
    expect(profileClass('call')).toBe('d-call');
    expect(profileClass('table')).toBe('d-table');
  });

  test('an unknown profile falls back to the default class rather than throwing', () => {
    expect(profileClass('projector')).toBe('d-room');
    expect(profileClass(undefined)).toBe('d-room');
  });

  // The floors are angular targets projected through a distance and a pixel
  // density, not a style preference. They are asserted here so a later "tidy
  // up" cannot quietly unify them.
  test('each profile carries its own floor', () => {
    expect(FLOORS).toEqual({ room: 20, tv: 26, call: 20, table: 16 });
  });
});

describe('automatic selection', () => {
  // TV and Call cannot be detected — the browser cannot know a panel's physical
  // size, and it cannot know it is being screen-shared. Only Table is
  // detectable, and only by the crude proxy of viewport width.
  test('below 1600px is Table', () => {
    expect(autoProfile(1440)).toBe('table');
    expect(autoProfile(1599)).toBe('table');
  });

  test('1600px and above is Room', () => {
    expect(autoProfile(1600)).toBe('room');
    expect(autoProfile(1920)).toBe('room');
  });

  test('a missing width does not crash and lands on the default', () => {
    expect(autoProfile(undefined)).toBe('room');
  });
});

describe('persistence', () => {
  test('a persisted profile wins over auto-selection', () => {
    // The whole point: a host on a 1366px laptop who chose TV meant it.
    expect(loadProfile(fakeStorage({ 'engage.displayProfile': 'tv' }), 1366)).toBe('tv');
  });

  test('nothing persisted falls back to auto-selection', () => {
    expect(loadProfile(fakeStorage(), 1366)).toBe('table');
    expect(loadProfile(fakeStorage(), 1920)).toBe('room');
  });

  test('a junk value is ignored rather than trusted', () => {
    expect(loadProfile(fakeStorage({ 'engage.displayProfile': 'banana' }), 1920)).toBe('room');
  });

  test('saving round-trips', () => {
    const s = fakeStorage();
    saveProfile(s, 'call');
    expect(loadProfile(s, 1920)).toBe('call');
  });

  test('an unknown profile is never saved', () => {
    const s = fakeStorage();
    saveProfile(s, 'banana');
    expect(s.getItem('engage.displayProfile')).toBeNull();
  });

  // Safari in private mode throws on setItem. Losing the preference is
  // survivable; a white screen in front of a room is not.
  test('a throwing storage does not propagate', () => {
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(() => saveProfile(hostile, 'tv')).not.toThrow();
    expect(loadProfile(hostile, 1920)).toBe('room');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/displayProfile.test.js
```

Expected: `Cannot find module '../config/displayProfile'`.

- [ ] **Step 3: Write the module**

Create `src/src/config/displayProfile.js`:

```js
/**
 * Which display the stage is being shown on.
 *
 * There are four profiles and they are four LITERAL ladders, not one ladder
 * times a scalar. Revision 1 of the design tried the scalar and it failed three
 * separate ways; the third is the one that matters — a multiplier can only
 * honour one floor, and the four contexts have four different ones, each
 * derived from the same ~8.3 arcminute label target through a different
 * viewing distance and pixel density:
 *
 *   Room   projected >=90in, <=30ft, ~20ppi   -> 20px
 *   TV     ~65in panel,      <=20ft, ~30ppi   -> 26px
 *   Call   screen-share; the ENCODER is the constraint, not the eye, so it
 *          keeps Room's ladder and changes treatment only  -> 20px
 *   Table  laptop, 2-4ft, ~120ppi             -> 16px
 *
 * Table's 16px is not a violation of the 20px rule. At ~120ppi and three feet
 * it subtends 9.0 arcminutes — MORE than the 20px Room floor buys at 25 feet.
 * Holding 20px there would spend space to over-serve an eye eight times closer.
 */

export const PROFILES = ['room', 'tv', 'call', 'table'];
export const DEFAULT_PROFILE = 'room';

/** Angular floors, expressed in pixels for the display each was derived for. */
export const FLOORS = { room: 20, tv: 26, call: 20, table: 16 };

const STORAGE_KEY = 'engage.displayProfile';

/** Width below which a browser is assumed to be a laptop panel, not a stage. */
const TABLE_MAX_WIDTH = 1600;

function isProfile(value) {
  return PROFILES.indexOf(value) !== -1;
}

/** The root class carrying this profile's ladder. */
export function profileClass(profile) {
  return `d-${isProfile(profile) ? profile : DEFAULT_PROFILE}`;
}

/**
 * The only profile a browser can infer.
 *
 * TV and Call are undetectable in principle — nothing in the platform reports a
 * panel's physical size, and nothing reports that the surface is being
 * re-encoded into a video call. Both are explicit choices in the Console.
 */
export function autoProfile(viewportWidth) {
  if (typeof viewportWidth !== 'number' || !isFinite(viewportWidth)) return DEFAULT_PROFILE;
  return viewportWidth < TABLE_MAX_WIDTH ? 'table' : DEFAULT_PROFILE;
}

/**
 * The profile to mount with.
 *
 * A stored choice always wins: a host on a 1366px laptop who picked TV meant
 * it, and "never lose the presentation state on reload" is a hard requirement —
 * a projector browser that reloads must come back exactly as it was. This is
 * why `useEffect(() => setBigScreenMode(false), [])` has to be deleted rather
 * than adapted.
 */
export function loadProfile(storage, viewportWidth) {
  let stored = null;
  try {
    stored = storage && storage.getItem(STORAGE_KEY);
  } catch (e) {
    // Private-mode Safari throws on access. Losing the preference is
    // survivable; a blank stage in front of a room is not.
    stored = null;
  }
  return isProfile(stored) ? stored : autoProfile(viewportWidth);
}

export function saveProfile(storage, profile) {
  if (!isProfile(profile)) return;
  try {
    storage && storage.setItem(STORAGE_KEY, profile);
  } catch (e) {
    /* see loadProfile */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src && npx jest __tests__/displayProfile.test.js
```

Expected: all pass.

- [ ] **Step 5: Create the stylesheet**

Create `src/src/styles/stage.css`. Port the following ranges from `docs/design/host-redesign/02-ask-call-and-answer.html` **verbatim** — they are the audited values and retyping them is how a digit gets lost:

- lines **63–106** — the four root ladders
- lines **108–117** — the `body` chrome tokens
- lines **122–131** — the `.stage` grid
- lines **133–144** — the `.field` treatment, including the two `:root.d-call` overrides

The four ladders are reproduced here so a reviewer can check the port without opening the mockup:

```css
:root, :root.d-room{
  --L-hero:      clamp(56px, 8.4vh, 104px);
  --L-primary:   clamp(40px, 5.6vh,  68px);
  --L-secondary: clamp(28px, 3.7vh,  44px);
  --L-body:      clamp(22px, 2.8vh,  34px);
  --L-meta:      clamp(20px, 1.9vh,  24px);
  --floor:20px; --measure-base:26ch; --bar-h:8px; --fit-min:.55;
  --dock-h:calc(9vh + 4vh);
}
:root.d-tv{
  --L-hero:      clamp(72px, 11vh, 132px);
  --L-primary:   clamp(52px, 7.4vh, 88px);
  --L-secondary: clamp(36px, 4.8vh, 56px);
  --L-body:      clamp(28px, 3.5vh, 42px);
  --L-meta:      clamp(26px, 2.4vh, 31px);
  /* TV may not scale below Room's rendered size — see minFit() in the fitter.
     56 x .78 = 43.7px, which is Room's 44px secondary tier. Below that it
     must drop something instead of shrinking. */
  --floor:26px; --measure-base:22ch; --bar-h:12px; --fit-min:.78;
  --dock-h:calc(11vh + 4vh);
}
:root.d-call{
  --L-hero:      clamp(56px, 8.4vh, 104px);
  --L-primary:   clamp(40px, 5.6vh,  68px);
  --L-secondary: clamp(28px, 3.7vh,  44px);
  --L-body:      clamp(22px, 2.8vh,  34px);
  --L-meta:      clamp(20px, 1.9vh,  24px);
  /* Measure matches Room exactly. A tighter measure wraps more, which makes
     the fitter scale down, which silently defeated the stated intent that Call
     keeps Room's type — measured ~6% below Room on every dense state. Call
     differs by field and hairline, not by size. */
  --floor:20px; --measure-base:26ch; --bar-h:10px; --fit-min:.55;
  --hair:2px;                         /* 1px rules do not survive a video codec */
  --dock-h:calc(9vh + 4vh);
}
:root.d-table{
  --L-hero:      clamp(44px, 6.2vh, 64px);
  --L-primary:   clamp(32px, 4.0vh, 44px);
  --L-secondary: clamp(22px, 2.6vh, 30px);
  --L-body:      clamp(18px, 2.0vh, 24px);
  --L-meta:      clamp(16px, 1.5vh, 19px);
  --floor:16px; --measure-base:30ch; --bar-h:5px; --fit-min:.55;
  --dock-h:calc(8vh + 3.5vh);
}
```

And the scaled content tiers, which are the mechanism the floor is enforced by — every scaled value wrapped in `max(var(--floor), …)` so the search can only shrink type as far as the floor and must then find a different lever:

```css
.content{ --fit:1; }
.content{
  --t-hero:max(var(--floor),calc(var(--L-hero) * var(--fit)));
  --t-primary:max(var(--floor),calc(var(--L-primary) * var(--fit)));
  --t-secondary:max(var(--floor),calc(var(--L-secondary) * var(--fit)));
  --t-body:max(var(--floor),calc(var(--L-body) * var(--fit)));
  /* Label and meta tiers do NOT scale. */
  --measure:calc(var(--measure-base) + (1 - var(--fit)) * 30ch);
}
```

Two rules that must be written by hand because they are the invariant, not a value:

```css
/* NEVER CENTRE A CLIPPING BOX. `justify-content: center` with `overflow:
   hidden` overflows BOTH ends and clips both — so the top of the question is
   the first thing to disappear, with no scrollbar and no out-of-bounds rect to
   detect it by. `flex-start` plus `margin-block: auto` on the child absorbs
   spare space (short content still centres) but never goes negative, so
   overflow can only ever appear at the bottom. Losing the tail of a list is
   survivable; losing the head of the question is not. */
.content{ display:flex; flex-direction:column; justify-content:flex-start; overflow:hidden; }
.content > .fitbox{ margin-block:auto; }

/* NO LINE CLAMPS LIVE HERE. Truncation is something the fitter DOES, after
   exhausting every other lever — never something the base stylesheet applies in
   advance. A clamp in base CSS makes the fitter blind: content arrives already
   cut, scrollHeight equals clientHeight, the fitter concludes it fits and
   stops. That shipped an 800px box holding 669px of content with five of six
   options truncated mid-word and 131px empty underneath. Clamps belong behind
   [data-clamped="on"] and nowhere else. */
.content[data-clamped="on"] .opt .txt{ -webkit-line-clamp:2; display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden; }
```

Import it once, beside the existing global stylesheet import.

- [ ] **Step 6: Verify the build**

```bash
cd src && npm run build
```

Expected: compiles, 2 pre-existing size warnings, no new ones.

- [ ] **Step 7: Commit**

```bash
git add src/src/config/displayProfile.js src/src/styles/stage.css src/src/__tests__/displayProfile.test.js
git commit -m "feat(stage): the four display profiles, as four literal ladders

Four ladders declared on the root element, not one ladder times a scalar.
The scalar was tried and failed three ways; the one that matters is that a
multiplier can only honour one floor and the four contexts have four,
each derived from the same ~8.3 arcminute target through a different
distance and pixel density.

Table's 16px floor is not a violation of the 20px rule: at ~120ppi and
three feet it subtends 9.0 arcminutes, more than 20px buys at 25 feet.

The profile persists. A projector browser that reloads must come back
exactly as it was."
```

---

### Task 2: The fitter's policy, as pure functions

The part that has actually broken, extracted so it can be tested without a layout engine. No DOM here — every measurement arrives through an injected interface.

**Files:**
- Create: `src/src/hooks/fitPolicy.js`
- Test: `src/src/__tests__/fitPolicy.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `searchScale({ min, max, iterations, isClean, setScale })` → `number | null` — the largest clean scale, or `null` if even `min` is dirty
  - `buildSacrificeList({ hasMeter, isSolo, dropGroups })` → ordered array of `{ order, kind: 'meter' | 'group', el?, note? }`
  - `declaresTruncation(computedStyle)` → boolean
  - `isAbbreviated(computedStyle, { scrollHeight, clientHeight, scrollWidth, clientWidth })` → boolean
  - `ITERATIONS` → `7`

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/fitPolicy.test.js`:

```js
/**
 * The fitter's decisions, with the measuring taken away.
 *
 * jsdom has no layout engine, so every geometric assertion in
 * docs/design/host-redesign/audit.js returns zero here and would pass
 * unconditionally. What CAN be tested — and what actually broke in three
 * separate rounds of review — is the policy: the order things are sacrificed
 * in, the shape of the search, and which elements are even allowed to
 * abbreviate. All three shipped wrong at least once.
 */
import {
  ITERATIONS, searchScale, buildSacrificeList,
  declaresTruncation, isAbbreviated,
} from '../hooks/fitPolicy';

describe('the scale search', () => {
  /** A box that is clean at or below `threshold`. Monotonic, like the real one. */
  function boxCleanBelow(threshold) {
    let scale = 1;
    return {
      setScale: (v) => { scale = v; },
      isClean: () => scale <= threshold,
      get scale() { return scale; },
    };
  }

  test('a state that fits at full size is left at full size', () => {
    const box = boxCleanBelow(1);
    expect(searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale }))
      .toBe(1);
  });

  test('a state that fits nowhere in range returns null rather than a wrong answer', () => {
    const box = boxCleanBelow(0.4); // below the floor
    expect(searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale }))
      .toBeNull();
  });

  test('it converges from below, never returning a scale that is not clean', () => {
    const box = boxCleanBelow(0.8);
    const found = searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale });
    expect(found).toBeLessThanOrEqual(0.8);
    // Seven halvings of a 0.45-wide interval resolves to ~0.0035.
    expect(found).toBeGreaterThan(0.8 - 0.01);
  });

  test('it leaves the box AT the scale it returns, not at the last one it probed', () => {
    // This is the bug shape: a binary search that reports a good value but
    // leaves the element rendering at whatever the final probe set.
    const box = boxCleanBelow(0.8);
    const found = searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale });
    expect(box.scale).toBe(found);
  });

  test('the search is exactly seven iterations — a resolution, not a guess', () => {
    let probes = 0;
    const box = boxCleanBelow(0.8);
    searchScale({
      min: 0.55, max: 1,
      isClean: () => { probes += 1; return box.isClean(); },
      setScale: box.setScale,
    });
    // max probe + min probe + ITERATIONS midpoints.
    expect(probes).toBe(ITERATIONS + 2);
  });

  // data-grow: a state carrying one object — a wavelength subject, a champion,
  // a join code — may exceed the ladder. The ladder is a legibility FLOOR
  // derived from the room, not a ceiling, and a ladder tuned for a dense screen
  // under-uses a sparse one.
  test('a growable state may exceed 1', () => {
    const box = boxCleanBelow(2);
    expect(searchScale({ min: 0.55, max: 2.2, isClean: box.isClean, setScale: box.setScale }))
      .toBe(2.2);
  });
});

describe('the order of sacrifice', () => {
  const groups = [
    { el: 'pager', order: 1, note: null },
    { el: 'guarantee', order: 2, note: null },
    { el: 'third-answer', order: 3, note: 'Answers 3+' },
  ];

  // THE BUG THIS TEST EXISTS FOR. widen() used to run only AFTER every
  // data-drop group had been hidden, so a state discarded an ANSWER and then
  // kept a 233px standings column. Measured on 21-results-revealed at
  // 1280x720: two cards, meter kept, 117px unused, second place thrown away —
  // on the reveal beat, the payoff of the entire anonymity feature.
  test('the meter goes before any content group', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: groups });
    expect(list[0].kind).toBe('meter');
    expect(list[0].order).toBe(-1);
  });

  test('groups follow in ascending declared order', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: groups });
    expect(list.slice(1).map((e) => e.el)).toEqual(['pager', 'guarantee', 'third-answer']);
  });

  test('declaration order does not matter — only the number does', () => {
    const shuffled = [groups[2], groups[0], groups[1]];
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: shuffled });
    expect(list.slice(1).map((e) => e.el)).toEqual(['pager', 'guarantee', 'third-answer']);
  });

  test('a state already solo does not offer the meter twice', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: true, dropGroups: groups });
    expect(list.some((e) => e.kind === 'meter')).toBe(false);
  });

  test('a state with no meter still sacrifices its groups', () => {
    const list = buildSacrificeList({ hasMeter: false, isSolo: false, dropGroups: groups });
    expect(list.map((e) => e.kind)).toEqual(['group', 'group', 'group']);
  });

  test('an empty state has nothing to give up', () => {
    expect(buildSacrificeList({ hasMeter: false, isSolo: false, dropGroups: [] })).toEqual([]);
  });
});

describe('which elements may abbreviate at all', () => {
  const base = { webkitLineClamp: 'none', textOverflow: 'clip', whiteSpace: 'normal' };

  test('a line clamp declares a truncation', () => {
    expect(declaresTruncation({ ...base, webkitLineClamp: '2' })).toBe(true);
  });

  test('ellipsis plus nowrap declares a truncation', () => {
    expect(declaresTruncation({ ...base, textOverflow: 'ellipsis', whiteSpace: 'nowrap' })).toBe(true);
  });

  // text-overflow only applies to a block container with inline content. On a
  // flex box it is inert — which is exactly how the rail shipped clipping
  // mid-glyph with no ellipsis, at -445px of slack.
  test('ellipsis without nowrap declares nothing, because it cannot render', () => {
    expect(declaresTruncation({ ...base, textOverflow: 'ellipsis', whiteSpace: 'normal' })).toBe(false);
  });

  test('ordinary text declares nothing — it just wraps and makes its parent taller', () => {
    expect(declaresTruncation(base)).toBe(false);
  });
});

describe('detecting an actual abbreviation', () => {
  const clamped = { webkitLineClamp: '2', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: '34.9272px', fontSize: '33.264px' };

  // THE OTHER BUG THIS EXISTS FOR. A block with a fractional line-height
  // reports a pixel of phantom overflow — measured, h1.q reported scrollHeight
  // 176 against clientHeight 175 — which made a naive predicate permanently
  // true, drove the search to its floor, and left 548px of a 795px box empty.
  test('one pixel of phantom overflow is not an abbreviation', () => {
    expect(isAbbreviated(clamped, { scrollHeight: 176, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
  });

  test('half a line of tolerance, and beyond it a real cut', () => {
    // Half of 34.93 is ~17.5. 190 - 175 = 15 is inside; 200 - 175 = 25 is not.
    expect(isAbbreviated(clamped, { scrollHeight: 190, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
    expect(isAbbreviated(clamped, { scrollHeight: 200, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(true);
  });

  test('a horizontal cut counts, with a tighter tolerance', () => {
    expect(isAbbreviated(clamped, { scrollHeight: 0, clientHeight: 0, scrollWidth: 300, clientWidth: 200 }))
      .toBe(true);
  });

  test('an element that declares no truncation can never be abbreviated', () => {
    const plain = { webkitLineClamp: 'none', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: '20px', fontSize: '16px' };
    expect(isAbbreviated(plain, { scrollHeight: 9999, clientHeight: 10, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/fitPolicy.test.js
```

Expected: `Cannot find module '../hooks/fitPolicy'`.

- [ ] **Step 3: Write the module**

Create `src/src/hooks/fitPolicy.js`:

```js
/**
 * The fitter's decisions, with the measuring taken out.
 *
 * The rule, stated once: A REDUCTION MAY ONLY FIRE WHEN SPACE IS ACTUALLY
 * EXHAUSTED.
 *
 * Order of preference, cheapest loss first:
 *   1. full size, no loss
 *   2. smaller type, no loss          (continuous, floored scale search)
 *   3. different layout, no loss      (option grid column count)
 *   4. drop CHROME                    (the meter, then data-drop groups)
 *   5. clamp                          (terminal; a budget failure, not a landing)
 *
 * Everything here is pure so it can be tested without a layout engine. The DOM
 * half lives in useStageFit.js and does nothing but measure and apply.
 */

/** Halvings of the scale interval. Seven resolves 0.45 to about 0.0035. */
export const ITERATIONS = 7;

/**
 * Largest scale in [min, max] that satisfies isClean().
 *
 * Monotonic — a smaller scale is never worse — so a binary search is exact to
 * its resolution. Returns null when even `min` is dirty, which is the signal
 * to reach for a different lever rather than to keep shrinking: below the floor
 * the search simply stops working, and that is the property that makes this not
 * the unfloored "auto-shrink to fit" the design rejects.
 *
 * Leaves the box AT the returned scale.
 */
export function searchScale({ min, max, iterations = ITERATIONS, isClean, setScale }) {
  setScale(max);
  if (isClean()) return max;

  setScale(min);
  if (!isClean()) return null;

  let lo = min;
  let hi = max;
  let best = min;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    setScale(mid);
    if (isClean()) { best = mid; lo = mid; } else { hi = mid; }
  }
  setScale(best);
  return best;
}

/**
 * Everything this state is willing to give up, cheapest first.
 *
 * CHROME BEFORE CONTENT, ALWAYS. The meter enters at priority -1, ahead of
 * every content group, through the same mechanism as everything else rather
 * than as a special case bolted to the end — which is what it was, and which
 * made a results state throw away an answer while keeping a 233px standings
 * column.
 *
 * Width is the cheapest lever on the stage: a wider measure means fewer lines,
 * which buys height at no cost to type size and no cost to content.
 */
export function buildSacrificeList({ hasMeter, isSolo, dropGroups }) {
  const list = [];
  if (hasMeter && !isSolo) list.push({ order: -1, kind: 'meter' });
  (dropGroups || []).forEach((g) => {
    list.push({ order: g.order, kind: 'group', el: g.el, note: g.note || null });
  });
  return list.sort((a, b) => a.order - b.order);
}

/**
 * Does this element DECLARE a truncation that renders?
 *
 * Only clamped or ellipsised elements can abbreviate anything; ordinary text
 * wraps and makes its parent taller, which the overflow check already sees.
 * And `text-overflow` only applies to a block container with inline content —
 * on a flex container it is inert, which is how the rail shipped clipping
 * mid-glyph with no ellipsis at all.
 */
export function declaresTruncation(cs) {
  if (!cs) return false;
  const clamp = cs.webkitLineClamp;
  if (clamp && clamp !== 'none' && clamp !== '') return true;
  return cs.textOverflow === 'ellipsis' && /nowrap|pre$/.test(cs.whiteSpace || '');
}

/**
 * Has this element actually lost content?
 *
 * Asking every element whether scrollHeight exceeds clientHeight is not a
 * stricter version of this question, it is a different and wrong one: a block
 * with a fractional line-height reports a pixel of phantom overflow — measured,
 * 176 against 175 — which makes the predicate permanently true, drives the
 * search to its floor, and leaves 548px of a 795px box empty. Ask only the
 * elements that can actually lie, with a tolerance of half a line.
 */
export function isAbbreviated(cs, rect) {
  if (!declaresTruncation(cs)) return false;
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 0;
  const tolerance = Math.max(2, lineHeight * 0.5);
  if (rect.scrollHeight > rect.clientHeight + tolerance) return true;
  return rect.scrollWidth > rect.clientWidth + 2;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src && npx jest __tests__/fitPolicy.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/src/hooks/fitPolicy.js src/src/__tests__/fitPolicy.test.js
git commit -m "feat(stage): the fitter's policy, extracted and tested

jsdom has no layout engine, so every geometric check in audit.js returns
zero there and would pass unconditionally. The policy is what actually
broke — three times — so it is extracted and tested instead: the meter
sacrificed before content rather than after it, a search that leaves the
box at the scale it reports, and a truncation predicate asked only of
elements that can actually lie.

That last one is the sub-pixel trap: a block with a fractional
line-height reports 176 against 175, which made a naive predicate
permanently true and left 548px of a 795px box empty."
```

---

### Task 3: The `useStageFit` hook

The DOM half. About forty lines of measuring and applying, wrapped around Task 2's decisions. It belongs in a hook, not in `GameHostPage`.

**Files:**
- Create: `src/src/hooks/useStageFit.js`
- Test: `src/src/__tests__/stageShell.test.jsx` (create; the hook's observable contract only)

**Interfaces:**
- Consumes: everything `fitPolicy.js` exports.
- Produces: `useStageFit(stageRef, deps)` → `void`. Runs on mount, on resize, and whenever `deps` change. Idempotent.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/stageShell.test.jsx`:

```jsx
/**
 * What can honestly be asserted about the hook in jsdom.
 *
 * Not the geometry — jsdom reports every box as zero-sized, so a "does it fit"
 * assertion here would be a lie. What IS real: the hook must be idempotent
 * (it is called on every render in practice), it must reset drop state before
 * measuring rather than accumulating it, and it must not leak listeners.
 * Those are lifecycle properties, and lifecycle is exactly what jsdom models
 * correctly.
 */
import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import useStageFit from '../hooks/useStageFit';

function Harness({ deps = [] }) {
  const ref = useRef(null);
  useStageFit(ref, deps);
  return (
    <div ref={ref} className="stage">
      <div className="content">
        <div className="fitbox">
          <h1 className="q">A question</h1>
          <p className="qdetail" data-drop="1" data-drop-note="Full prompt">Detail</p>
        </div>
        <p className="reduced" hidden />
      </div>
    </div>
  );
}

describe('useStageFit lifecycle', () => {
  test('it mounts without throwing in a zero-sized document', () => {
    expect(() => render(<Harness />)).not.toThrow();
  });

  test('a state that fits leaves no reduction applied', () => {
    // Every box is 0x0 in jsdom, so nothing overflows and nothing should be
    // sacrificed. A hook that drops groups here is dropping them unconditionally.
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-drop="1"]').hidden).toBe(false);
    expect(container.querySelector('.content').dataset.clamped).toBeUndefined();
    expect(container.querySelector('.reduced').hidden).toBe(true);
  });

  test('re-running is idempotent — drop state resets before measuring', () => {
    const { container, rerender } = render(<Harness deps={[1]} />);
    const dropped = container.querySelector('[data-drop="1"]');
    dropped.hidden = true; // simulate a previous pass having sacrificed it
    act(() => { rerender(<Harness deps={[2]} />); });
    expect(dropped.hidden).toBe(false);
  });

  test('it removes its resize listener on unmount', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Harness />);
    const added = add.mock.calls.filter(([e]) => e === 'resize').length;
    unmount();
    const removed = remove.mock.calls.filter(([e]) => e === 'resize').length;
    expect(removed).toBe(added);
    add.mockRestore();
    remove.mockRestore();
  });

  test('a null ref is survivable', () => {
    function NullHarness() {
      const ref = useRef(null);
      useStageFit(ref, []);
      return null;
    }
    expect(() => render(<NullHarness />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/stageShell.test.jsx
```

Expected: `Cannot find module '../hooks/useStageFit'`.

- [ ] **Step 3: Write the hook**

Create `src/src/hooks/useStageFit.js`. Port the measuring half from `docs/design/host-redesign/02-ask-call-and-answer.html` lines **803–1036**, replacing its `searchScale`, `sacrificeList` and `truncated` with the pure versions from `fitPolicy.js`, and its `window.__fit` + listener block with a React effect.

The parts that must survive the port unchanged, because each is a fixed bug:

```js
/** Vertical only. This is the axis .content competes on, and adding width here
 *  would import the same sub-pixel noise the truncation predicate had to be
 *  rescued from. */
function over(box) { return box.scrollHeight > box.clientHeight + 1; }

/** Both axes, for chrome. The rail overflows sideways, and reusing the
 *  vertical-only predicate for it meant the rail's own sacrifice loop could
 *  never see the thing it existed to fix: measured at 1280 with a timer armed,
 *  1298px of content in a 1280px bar, and not one group dropped. */
function overAny(box) {
  return box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 2;
}
```

The orchestration, with the sacrifice loop now driven by `buildSacrificeList`:

```js
function fitContent(box) {
  reset(box);
  unwiden(box);
  chooseLayout(box);
  if (searchScale({ min: minFit(box), max: maxFit(box), isClean: () => clean(box), setScale: (v) => setFit(box, v) }) !== null) return;

  const list = buildSacrificeList({
    hasMeter: hasMeter(box), isSolo: isSolo(box), dropGroups: readDropGroups(box),
  });
  const lost = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].kind === 'meter') {
      widen(box);
    } else {
      list[i].el.hidden = true;
      if (list[i].note && lost.indexOf(list[i].note) === -1) lost.push(list[i].note);
      announce(box, lost);
    }
    chooseLayout(box);
    if (searchScale({ min: minFit(box), max: maxFit(box), isClean: () => clean(box), setScale: (v) => setFit(box, v) }) !== null) return;
  }

  // Terminal. Everything above failed, so abbreviate and say so. Reaching this
  // point is a budget failure to fix, not a graceful landing.
  box.dataset.clamped = 'on';
  searchScale({ min: minFit(box), max: maxFit(box), isClean: () => !over(box), setScale: (v) => setFit(box, v) });
}
```

`reset(box)` must clear `data-clamped`, the `--fit` inline property, the grid's `data-cols`, every `[data-drop]`'s `hidden`, and the `.reduced` note — **before** anything is measured. The hook is called on every render in practice, and a fitter that accumulates reductions instead of recomputing them converges on an empty screen.

The effect:

```js
export default function useStageFit(stageRef, deps = []) {
  useEffect(() => {
    const root = stageRef.current;
    if (!root) return undefined;

    const run = () => {
      root.querySelectorAll('.content').forEach(fitContent);
      // Chrome boxes only sacrifice; their type is fixed by the profile and
      // must not shrink with content.
      root.querySelectorAll('.rail, .meter').forEach(fitChrome);
    };

    run();
    // One more after paint: web fonts and images land after the first pass and
    // change every measurement taken before them.
    const raf = requestAnimationFrame(run);
    window.addEventListener('resize', run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src && npx jest __tests__/stageShell.test.jsx
```

- [ ] **Step 5: Verify against the mockups, in a real browser**

The Jest tests cannot see geometry. Before committing, confirm the ported fitter still behaves against the audited pages: serve `docs/design/host-redesign/` on any port, open `audit.html`, and run the suite.

Expected: **168 checks, 0 failures**. If your port changed a mockup file to make this pass, you have changed the source of truth — revert it and fix the port instead.

- [ ] **Step 6: Commit**

```bash
git add src/src/hooks/useStageFit.js src/src/__tests__/stageShell.test.jsx
git commit -m "feat(stage): useStageFit — the measuring half of the fitter

Forty lines of measure-and-apply around fitPolicy's decisions. It runs on
mount, on resize, and whenever the question or answer list changes, and it
resets rung and drop state before measuring because it is called on every
render in practice — a fitter that accumulates reductions instead of
recomputing them converges on an empty screen.

over() stays vertical-only for content and both-axes for chrome. That is
not a tidy-up: reusing the vertical predicate for the rail meant the
rail's sacrifice loop could never see the overflow it existed to fix."
```

---

### Task 4: The stage shell

Five components carrying the three regions. They render the *existing* content — no new per-state design, which is plan 4.

**Files:**
- Create: `src/src/components/stage/Stage.jsx`, `Rail.jsx`, `PhaseBar.jsx`, `RoomMeter.jsx`, `Dock.jsx`
- Test: `src/src/__tests__/stageShell.test.jsx` (append)

**Interfaces:**
- Consumes: `profileClass`, `loadProfile`, `saveProfile` from Task 1; `useStageFit` from Task 3; the existing `HostActionBar`.
- Produces:
  - `<Stage profile phase>{children}</Stage>` — applies the profile class to the document root and renders the four grid areas
  - `<Rail title context join timer />`
  - `<PhaseBar phase />`
  - `<RoomMeter phase heading body />`
  - `<Dock status hint onSetup>{primary}</Dock>`

- [ ] **Step 1: Write the failing test**

Append to `src/src/__tests__/stageShell.test.jsx`:

```jsx
import Stage from '../components/stage/Stage';
import Rail from '../components/stage/Rail';
import RoomMeter from '../components/stage/RoomMeter';

describe('the stage grid', () => {
  test('the profile class lands on the document root, not on a wrapper', () => {
    // The ladders are declared on :root. A class on a div would leave every
    // custom property substituting against :root's own values, which is
    // precisely how the scalar approach rendered all four profiles identically.
    render(<Stage profile="tv" phase="ASK"><div /></Stage>);
    expect(document.documentElement.classList.contains('d-tv')).toBe(true);
    expect(document.documentElement.classList.contains('d-room')).toBe(false);
  });

  test('changing profile replaces the class rather than adding one', () => {
    const { rerender } = render(<Stage profile="tv" phase="ASK"><div /></Stage>);
    rerender(<Stage profile="table" phase="ASK"><div /></Stage>);
    expect(document.documentElement.className.match(/\bd-\w+/g)).toEqual(['d-table']);
  });

  test('all four grid areas are present in order', () => {
    const { container } = render(<Stage profile="room" phase="ASK"><div /></Stage>);
    const areas = Array.from(container.querySelectorAll('.stage > *'))
      .map((el) => el.className.split(' ')[0]);
    expect(areas).toEqual(['field', 'rail', 'bar', 'main', 'dock']);
  });
});

describe('the rail', () => {
  test('the title is a single text node, so its ellipsis can actually render', () => {
    // text-overflow applies to a block container with inline content. On a flex
    // box with span children it is inert, which is how the rail shipped
    // clipping mid-glyph at -445px of slack.
    const { container } = render(<Rail title="A very long event title" context={{}} join={{ code: '4821' }} />);
    const title = container.querySelector('.rail-title');
    expect(title.childNodes).toHaveLength(1);
    expect(title.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  test('the drop order sacrifices the title first and never the code', () => {
    const { container } = render(<Rail title="T" context={{}} join={{ url: 'eng.seibtribe.us/play', code: '4821' }} />);
    expect(container.querySelector('.rail-title').dataset.drop).toBe('1');
    expect(container.querySelector('[data-join-word]').dataset.drop).toBe('2');
    expect(container.querySelector('[data-join-url]').dataset.drop).toBe('3');
    // The code is what people in the room need. It is not droppable at all.
    expect(container.querySelector('code').dataset.drop).toBeUndefined();
  });

  test('the timer is absent unless armed', () => {
    const { container, rerender } = render(<Rail title="T" context={{}} join={{ code: '1' }} />);
    expect(container.querySelector('.rail-timer')).toBeNull();
    rerender(<Rail title="T" context={{}} join={{ code: '1' }} timer="2:14" />);
    expect(container.querySelector('.rail-timer')).not.toBeNull();
  });
});

describe('the room meter', () => {
  test('it states progress exactly once', () => {
    // Six simultaneous statements of the same fact shipped once: the word
    // ANSWERED, the numeral, a bar, a sentence, forty dots, and the dock.
    // What survives is the labelled fraction. The bar and the dot matrix are
    // deleted, and this is the test that keeps them deleted.
    const { container } = render(<RoomMeter phase="ASK" heading="ANSWERED" body="31 / 40" />);
    expect(container.querySelectorAll('.meter-bar')).toHaveLength(0);
    expect(container.querySelectorAll('.meter-dot')).toHaveLength(0);
    expect(container.textContent).toContain('31 / 40');
  });

  test('it never names anybody', () => {
    // A count is a nudge; a list of names is an attendance record, and the room
    // is the wrong audience for one. This binds Table too — Table is a stage.
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="31 / 40" players={[{ name: 'Dana' }, { name: 'Tomás' }]} />
    );
    expect(container.textContent).not.toMatch(/Dana|Tomás/);
  });

  test('it collapses where the spec says it collapses', () => {
    const { container } = render(<RoomMeter phase="ENDED" heading="" body="" />);
    expect(container.querySelector('.meter')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/stageShell.test.jsx
```

- [ ] **Step 3: Write the components**

Port from `docs/design/host-redesign/02-ask-call-and-answer.html`:

| What | Lines |
|---|---|
| `.rail` and `.chip` | 149–196 |
| `.rail-title` — the single-text-node rule and its `min-width:22ch` floor | 172–174 |
| `.bar`, including the doubled striped `done` band | 198–206 |
| `.main` and `.main.solo` | 207–218 |
| `.content` / `.fitbox` | 219–243 |
| `.dock` | 463 onward, to the end of that rule block |
| stage markup | 766–790 |

Two of those carry a correction each and must not be "tidied":

- `.rail-title` has `min-width: 22ch`, not `min-width: 0`. With `0` the title shrank silently to a 14% stub — "Q3 Lead…", verbatim the string an evaluator complained about — while the rail never reported an overflow, so `fitChrome()` never fired and the drop ladder never ran. The floor is what makes the rail overflow, which is what triggers the sacrifice.
- `.main` uses `grid-template-columns` with a `minmax(0,1fr)` content track. An `auto` track refuses to shrink below the min-content of its widest item, and one nowrap rail would otherwise push the whole stage past the viewport.

**`.content` was partly written in Task 1** (the never-centre-a-clipping-box rule and the scaled tiers). Lines 219–243 overlap it. Merge rather than appending a second `.content` block — two rule sets for the same selector in one stylesheet is how the clamp ended up back in base CSS the first time. The Task 1 comments are the ones to keep; they say why.

`Stage.jsx` applies the profile to `document.documentElement` in an effect and cleans up on unmount:

```jsx
useEffect(() => {
  const root = document.documentElement;
  const cls = profileClass(profile);
  PROFILES.forEach((p) => root.classList.remove(`d-${p}`));
  root.classList.add(cls);
  return () => root.classList.remove(cls);
}, [profile]);
```

`Dock.jsx` is a **grid row, not a fixed overlay**. This is a small change with a large consequence: `position: fixed` guarantees the control is *visible*, but a grid row guarantees it is *placed* — it cannot be covered by a rail, clipped by a `height: 100vh; overflow: hidden` ancestor (the exact bug documented at `styles.css:7190`), or reach a state where reserved padding fights the content. It reserves `--dock-h` per profile.

`Dock.jsx` renders the existing `HostActionBar` for the primary action. **Do not reimplement its keyboard handling, its typing-target guard or its disabled-hint behaviour** — only its positioning CSS changes.

The setup control is a minimum **48×48** target carrying the word `SETUP` beside the `⋯` glyph, at `--t-meta × 0.9` in `--muted`: a trackpad target from a foot away, an unreadable speck from the back row. It is not wired to anything in this plan — the Console is plan 3 — so it takes an `onSetup` prop and the caller passes a no-op for now.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src && npx jest __tests__/stageShell.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add src/src/components/stage src/src/__tests__/stageShell.test.jsx
git commit -m "feat(stage): the shell — rail, phase bar, main, dock

The dock is a grid row, not a fixed overlay. position:fixed guarantees the
control is visible; a grid row guarantees it is placed, so it cannot be
covered by a rail or clipped by a height:100vh;overflow:hidden ancestor —
which is the bug the big-screen CSS comment at styles.css:7190 documents.

The rail title is a single text node because text-overflow is inert on a
flex container with span children, which is how the rail shipped clipping
mid-glyph with no ellipsis at all.

The meter states progress once. The bar and the dot matrix are deleted:
they were the second and third statements of a fact that needed one."
```

---

### Task 5: `GameHostPage` adopts the shell

The replacement, and the deletions. Both current layouts go at once — **do not add a third mode.**

**Files:**
- Modify: `src/src/GameHostPage.jsx`
- Modify: `src/src/config/hostControls.js` — two additions
- Test: `src/src/__tests__/stageShell.test.jsx` (append), `src/src/__tests__/hostControls.test.js` (append)

**Interfaces:**
- Consumes: everything from Tasks 1, 3 and 4.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `src/src/__tests__/hostControls.test.js`:

The real API is `hostControlsFor({ gameType, phase, … })` → `{ phase, primary, secondary, status }`. Note `hostControlsFor` opens with `const resolvedPhase = HOST_PHASES.includes(phase) ? phase : 'LOBBY'`, so **both new phases must be added to `HOST_PHASES` or they will silently resolve to `LOBBY`** — which is the same class of bug as `isWaitingState('ENDED')` returning `true`, and it would pass a careless test.

```js
import { HOST_PHASES, hostPhaseSequence, hostControlsFor } from '../config/hostControls';

describe('the two additions the stage needs', () => {
  // The trap first: an unknown phase resolves to LOBBY, so a new phase that is
  // not in HOST_PHASES looks like it works and is actually rendering the lobby.
  test('both new phases are recognised rather than falling back to LOBBY', () => {
    expect(HOST_PHASES).toContain('FIELD_NOTES');
    expect(HOST_PHASES).toContain('ENDED');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).phase).toBe('ENDED');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).phase).toBe('FIELD_NOTES');
  });

  // RESULTS becomes two beats rather than one long screen.
  test('RESULTS advances to the Field Notes beat before the next round', () => {
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'RESULTS' }).primary.id)
      .toBe('field-notes');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).primary.id)
      .toBe('next');
  });

  // Today ENDED is a dead end: isWaitingState('ENDED') returns true, so a
  // finished session renders the lobby.
  test('ENDED offers a way forward', () => {
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).primary)
      .toEqual(expect.objectContaining({ id: 'report', label: 'Open Session Report' }));
  });

  // The existing invariant, restated because these additions are exactly the
  // kind of change that breaks it.
  test('every (type × phase) pair still yields exactly one primary', () => {
    for (const type of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
      for (const phase of hostPhaseSequence(type).concat(['FIELD_NOTES', 'ENDED'])) {
        const controls = hostControlsFor({ gameType: type, phase });
        expect(controls.primary).toBeTruthy();
        expect(controls.primary.id).toBeTruthy();
      }
    }
  });

  // ASK is the one phase with a secondary. Adding phases must not grow that.
  test('the new phases add no secondary action', () => {
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).secondary).toBeNull();
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).secondary).toBeNull();
  });
});
```

Append to `src/src/__tests__/stageShell.test.jsx`:

```jsx
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The deletions, asserted against the source.
 *
 * These are not style preferences — each is a named defect in the spec, and
 * each is the kind of thing that survives a refactor by being left "just in
 * case". Reading the file is crude, and it is also the only way to prove a
 * line is gone without rendering a 5,000-line component that currently cannot
 * mount in jsdom at all (see the five stale suites in the baseline).
 */
describe('what must be deleted, not adapted', () => {
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

  test('the bigScreenMode reset effect is gone', () => {
    // A projector browser that reloads must come back exactly as it was.
    expect(source).not.toMatch(/setBigScreenMode\(false\)/);
  });

  test('ENDED is no longer treated as a waiting state', () => {
    // isWaitingState('ENDED') returning true is why a finished session renders
    // the lobby — "Waiting for players to join…" after everyone has left.
    expect(source).not.toMatch(/isWaitingState[\s\S]{0,400}['"]ENDED['"]/);
  });

  test('the answer-navigator is gone', () => {
    expect(source).not.toMatch(/answer-navigator/);
  });

  test('the parallax block is gone', () => {
    expect(source).not.toMatch(/className=["'][^"']*\bparallax\b/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd src && npx jest __tests__/hostControls.test.js __tests__/stageShell.test.jsx
```

- [ ] **Step 3: Add the two `hostControls` entries**

In `src/src/config/hostControls.js`:

1. Extend `HOST_PHASES` to `['LOBBY', 'ASK', 'VOTE', 'RESULTS', 'FIELD_NOTES', 'ENDED']`. Without this, `hostControlsFor`'s `resolvedPhase` guard silently rewrites both new phases to `LOBBY`.
2. Add the `RESULTS` → `FIELD_NOTES` → `NEXT` sub-sequence in `primaryFor`, so RESULTS has two beats rather than one long screen.
3. Add the `ENDED` case returning `{ id: 'report', label: 'Open Session Report' }`.
4. Extend `statusTextFor` to cover both new phases — it is keyed on phase and will otherwise fall through to the lobby's copy.

**Change nothing else in this file.** The spec names its decision logic as needing no change beyond these, and the existing invariant test is what keeps the dock honest.

Leave `hostPhaseSequence` returning the round's phases only. It describes the phases a *round* passes through; `FIELD_NOTES` is a beat inside RESULTS and `ENDED` is a session state, and folding either into the round sequence would make the phase bar draw a fifth segment per round.

- [ ] **Step 4: Render the shell**

In `src/src/GameHostPage.jsx`, replace both current layouts with the shell. Hold the profile in state, initialised from `loadProfile(window.localStorage, window.innerWidth)`, and call `saveProfile` whenever it changes. Call `useStageFit(stageRef, [question, answers, phase, profile])`.

- [ ] **Step 5: Delete, do not adapt**

Each of these is a named defect. Remove them outright:

- the `bigScreenMode` reset effect (`:189–192`)
- the `isWaitingState` treatment of `ENDED` (`:59–67`)
- the `showConfirmation` end-of-game flow (`:961–975`) — a dialog box is not how a session ends
- the `answer-navigator` (`:3946–3975`)
- the three non-loading flash alerts (`:4401–4432`)
- the `.parallax` block in the host container (`:3671–3686`)

Line numbers are from the spec and will have drifted; find them by name.

- [ ] **Step 6: Verify the full baseline**

```bash
cd src && npx jest __tests__/ && npm run build
```

Expected: **5** failed suites (the stale ones, unchanged) and no new failures; build compiles with the 2 pre-existing size warnings.

Then confirm the real thing in a browser — the Jest suite cannot see geometry, and this is the task where geometry starts mattering:

```bash
cd src && npm start
```

Walk one call-and-answer round at 1920×1080 and at 1280×720, in Room and in Table. Confirm: the page does not scroll, the primary action is on screen at both sizes, the question is not decapitated, and reloading mid-session comes back on the same profile.

- [ ] **Step 7: Commit**

```bash
git add src/src/GameHostPage.jsx src/src/config/hostControls.js src/src/__tests__/stageShell.test.jsx src/src/__tests__/hostControls.test.js
git commit -m "feat(stage): GameHostPage renders the stage shell

Both layouts are replaced at once rather than adding a third mode. Two
modes is what produced two ASK headers and two QR blocks, and the mode did
not survive a reload, so it failed silently in front of a room.

Six deletions land with it, each a named defect: the bigScreenMode reset,
ENDED treated as a waiting state (which is why a finished session renders
the lobby), the end-of-game dialog, the answer-navigator, three flash
alerts and the parallax block."
```

---

## Manual verification before handing back

The Jest suites cover the policy and the lifecycle. These cannot be asserted in jsdom and must be walked through:

1. **`audit.html` against the mockups still reports 168 checks / 0 failures** after the fitter port. If it does not, the port changed behaviour.
2. **The four profiles measurably differ in the running app.** Switch between them and confirm the rail chip and dock button change size — those read the profile tokens directly and are never re-scaled, so they are the honest answer to "did the profile change anything". Four profiles that render identically is the exact failure the scalar approach shipped.
3. **A reload mid-session returns on the same profile.** This is the requirement the deleted reset effect was violating.
4. **A long question at 1280×720 in TV.** TV's ladder cannot be honoured below ~820px of viewport height on dense states even after every reduction; confirm it drops something rather than clipping.

## Out of scope, recorded

- **Running `audit.js` against the React app in a real browser.** The checks are pure functions over a rendered document and a viewport, so they port unchanged — but they need a headless-browser harness this repo does not have, and jsdom cannot substitute. Worth its own plan; until it exists the geometric guarantee is held by the mockups, not by the app.
- **The Console** (§5.4), including the Display section that selects TV and Call. Until it ships, those two profiles are reachable only by setting `localStorage` by hand. Plan 3.
- **Per-state content and the deletions in §6.** Plan 4.
- **ENDED and the Field Notes beat as surfaces.** This plan adds their `hostControls` entries so the dock has somewhere to point; the screens themselves are plan 5.
- **`POST /games/{id}/reopen-round`** (spec R2). A host who advances early cannot recover, and the shipped mitigation is the arm-then-fire confirmation, not an undo.
