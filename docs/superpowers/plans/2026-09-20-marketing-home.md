# Marketing Home and Related Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the signed-out `/` join page with a marketing home page (hero keeps a compact join-code entry), and add public `/how-it-works`, `/use-cases`, `/reports`, `/help` and `/join` pages.

**Architecture:** A lazy-loaded `src/src/marketing/` surface inside the existing React app, routed by new branches in the hand-rolled pathname switch in `App.jsx`. Join logic moves into one hook shared by `RootPage` and the hero. The hero backdrop is an inline-SVG layered ridge scene driven by scroll progress; screen clips are poster-backed `<video>` slots filled by a later sub-project.

**Tech Stack:** React 18 (function components, `React.lazy`), plain CSS with scoped custom properties, Jest 30 + Testing Library + jsdom, webpack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-marketing-home-design.md` — read it before starting any task.

## Global Constraints

- **Never push.** A push to `dev`, `test` or `prod` is a deploy. Commit locally only; the owner decides when it ships. Baselines (backend suite, `npm test`, `npm run lint`, `npm run build`) must hold first.
- **Never run `npm install` in a populated checkout** (it prunes ~85 undeclared packages). No new dependencies are needed.
- **No `.parallax` class, anywhere.** Three existing tests fail on it. The scene uses `.mk-ridge*`.
- **No third-party asset origins.** No `http(s)://` URL in any marketing JSX, CSS or content file except `href`s to this site's own paths.
- **Namespacing:** every marketing class is `.mk-*`; the compact join entry is `.jce-*`. Never a bare `.btn`, `.chip`, `.modal`, `.form-group`.
- **Tokens:** scoped on `.mk-root` as `--mk-*`. One type ladder `--mk-t-*`. Nothing under 12px. `--primary` never carries text on a light surface (use `--mk-amber-ink: #8a5300`). `--danger` never carries text.
- **Palette tests are named `*Palette.test.js`** — `.gitignore` has an unanchored `*token*`, so a `*Token*` file never reaches CI.
- **No geometric assertions in tests.** jsdom has no layout. Assert DOM order, presence, accessible names, and stylesheet text.
- **Navigation in tests is `window.history.pushState`**, never `window.location.pathname = …` (a silent no-op under jsdom). Destinations are asserted on the mocked `navigateTo`.
- **Honesty:** the report has no "favourites" field. The only permitted wording is that the team *votes* and the vote breakdown shows which ideas rose. Never write "favourite"/"favorite" as a product feature.
- **Banned deploy phrases:** the twin guard fails on the strings "deploys nothing" and "tags only" in any tracked file. Do not write them.
- **Mockups are the design.** Task 1's approved mockups are the source for every visual value not given literally in this plan. Serve them with the `all-design-mockups` launch config (:8124) and look before coding.
- Run frontend commands from `src/` (the package root): `cd /Users/georgeseib/Documents/projects/engage2/src`.
- Commit messages in this repo are one plain sentence describing the behaviour (see `git log`). End each with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

```
docs/design/marketing-redesign/          Task 1   mockups + RATIONALE.md
src/src/hooks/useJoinCode.js             Task 2   the join logic, once
src/src/components/RootPage.jsx          Task 2   consumes the hook, markup unchanged
src/src/components/JoinCodeEntry.jsx/.css Task 3  compact hero entry (.jce-*)
src/src/marketing/
  MarketingShell.jsx/.css                Task 4   nav, footer, tokens, ladder, error boundary
  useScrollProgress.js                   Task 5
  components/RidgeScene.jsx/.css         Task 5
  content/clips.js                       Task 6   slot manifest
  components/ClipFrame.jsx/.css          Task 6
  components/DeviceFrame.jsx/.css        Task 6
  content/home.js, HomePage.jsx/.css     Task 7
  (App.jsx routing + RootGate)           Task 8
  content/howItWorks.js, HowItWorksPage  Task 9
  content/useCases.js, UseCasesPage      Task 9
  content/sampleReport.js, reports.js,
  components/SampleReport, ReportsPage   Task 10
  HelpPage.jsx/.css                      Task 11
src/src/__tests__/marketingPalette.test.js, marketingCopy.test.js   Task 12
src/public/index.html, styles.css cleanup, Ridge.jsx removal        Task 13
```

**Deviation from the spec, deliberate:** spec §4.3 describes `JoinCodeEntry` as one component with `page` and `compact` variants. `rootPage.test.jsx` pins RootPage's exact `.entry-*` markup, so this plan extracts the **logic** into `useJoinCode()` and leaves RootPage's markup alone; `JoinCodeEntry` is only the compact presentation. The requirement that the logic exists once is met, with no churn in a pinned surface.

---

### Task 1: Mockups (owner review gate)

**Files:**
- Create: `docs/design/marketing-redesign/index.html`, `01-home.html`, `01m-home-mobile.html`, `02-how-it-works.html`, `03-use-cases.html`, `04-reports.html`, `05-help.html`, `mk.css`, `RATIONALE.md`

**Interfaces:**
- Produces: the visual source of truth for Tasks 4–11. Class names in the mockups are the `.mk-*` names the React uses.

- [ ] **Step 1: Read the references**

Read `.claude/skills/engage-design/SKILL.md` and `references/hard-rules.md`, `docs/design/parallax-art-brief.md` §3–§5 (palette and contrast constraint), and open `docs/design/entry-redesign/01-root.html` to match how mockups in this repo are structured (notes panel toggled with **N**).

- [ ] **Step 2: Write `mk.css` with the token block**

This exact block is reused verbatim in Task 4:

```css
.mk-root {
  --mk-bg: #0F1A2E;
  --mk-surface: #1B2942;
  --mk-surface-2: #25375A;
  --mk-text: #F4EDE4;
  --mk-muted: #9BA8BE;
  --mk-amber: #F6A94C;
  --mk-amber-deep: #C77B4A;
  --mk-blue: #7CA7E6;
  --mk-ridge-front: #16233B;
  --mk-ridge-mid: #22344F;
  --mk-ridge-back: #2E4262;
  --mk-paper: #FBF7F1;
  --mk-paper-surface: #FFFFFF;
  --mk-paper-text: #1B2942;
  --mk-paper-muted: #5E6167;
  --mk-amber-ink: #8a5300;
  --mk-hair: rgba(244, 237, 228, 0.14);

  --mk-t-floor: 12px;
  --mk-t-label: 13px;
  --mk-t-body: 17px;
  --mk-t-lead: 21px;
  --mk-t-head: 30px;
  --mk-t-title: 44px;
  --mk-t-display: 68px;

  --mk-shell: 1160px;
  --mk-gutter: 24px;
  background: var(--mk-bg);
  color: var(--mk-text);
  font-size: var(--mk-t-body);
  line-height: 1.55;
}
@media (max-width: 720px) {
  .mk-root { --mk-t-head: 25px; --mk-t-title: 32px; --mk-t-display: 42px; --mk-gutter: 16px; }
}
```

- [ ] **Step 3: Build the six mockups** as static HTML using `mk.css`, with these sections and class names:

`01-home.html` — `.mk-nav` (brand; links How it works, Use cases, Reports, Help; `.mk-btn-quiet` Sign in; `.mk-btn-primary` Create a host account) · `.mk-hero` over `.mk-ridge` (four SVG layers, dashed `.mk-ridge-route`, `.mk-ridge-climber` dot; headline `.mk-display`; sub-line; the two CTAs; `.jce` compact code entry labelled "Have a code?") · `.mk-section.mk-problem` (three statements) · `.mk-section.mk-modes` (two `.mk-mode` cards, each a TV `.mk-device--tv` beside a `.mk-device--phone`) · `.mk-section.mk-material` · `.mk-section.mk-react` · `.mk-section.mk-summit` (paper `.mk-report` sheet, `data-theme="light"`) · `.mk-cta` · `.mk-foot`.
Hero contrast rule from the art brief: amber glow confined to the bottom 40% of the hero; headline text sits in the top 55%.

`01m-home-mobile.html` — the same page at 390px wide: single column, phone clip stacked under TV clip, nav collapsed to brand + Sign in + menu button.

`02-how-it-works.html` — six `.mk-step` rows (number, title, two sentences, clip slot), alternating sides.
`03-use-cases.html` — four `.mk-case` blocks (scenario, "before", "with Engagements", set type used, CTAs).
`04-reports.html` — a large `.mk-report` sheet with six numbered `.mk-callout`s, then export/sharing, then anonymity.
`05-help.html` — `.mk-help` two-column: role/guide sidebar, guide body.

Use poster placeholders drawn in CSS (a dusk rectangle with the slot caption) — no image files yet.

- [ ] **Step 4: Write `RATIONALE.md`** — one paragraph per page: who it is for, what it must make them believe, and which hard rule shaped it. State the join-in-hero decision and why the scene is SVG.

- [ ] **Step 5: Measure contrast in the rendered mockups.** Start the `all-design-mockups` preview, open each page, and with the browser's JS console run the `bgOf`/`ratio` functions from `docs/design/admin-redesign/audit.html` against the headline, sub-line, nav links, muted copy on `--mk-surface`, and every text colour on the paper sheet. Every pairing ≥ 4.5:1. Fix the mockup, not the threshold.

- [ ] **Step 6: Commit and STOP for owner review**

```bash
git add docs/design/marketing-redesign
git commit -m "Mockups for the marketing home, its four related pages and the mobile home, with the measured contrast and the rationale"
```

Send screenshots of each mockup to the owner. **Do not start Task 4 or later until the owner approves the mockups.** Tasks 2 and 3 carry no visual decisions and may proceed in parallel.

---

### Task 2: `useJoinCode` — the join logic, once

**Files:**
- Create: `src/src/hooks/useJoinCode.js`
- Create: `src/src/__tests__/useJoinCode.test.jsx`
- Modify: `src/src/components/RootPage.jsx` (lines 21–33 helpers and 43–120 state/handlers move out)

**Interfaces:**
- Produces: `useJoinCode()` → `{ code, note, missing, checking, focused, setFocused, canSubmit, cells, handleChange, handlePaste, handleSubmit }`; named exports `CODE_LENGTH` (4) and `codeFromUrl(raw) → string|null`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/useJoinCode.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import useJoinCode, { codeFromUrl, CODE_LENGTH } from '../hooks/useJoinCode';
import { navigateTo } from '../auth/navigate';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

function Probe() {
  const j = useJoinCode();
  return (
    <form onSubmit={j.handleSubmit}>
      <input aria-label="code" value={j.code} onChange={j.handleChange} onPaste={j.handlePaste} />
      <p data-testid="note">{j.note}</p>
      <p data-testid="missing">{j.missing || ''}</p>
      <button type="submit" disabled={!j.canSubmit}>go</button>
    </form>
  );
}
const field = () => screen.getByLabelText('code');
const respond = (status) => global.fetch.mockResolvedValueOnce({ status, ok: status < 300, json: async () => ({}) });

beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); window.API_BASE = 'https://api.example/'; });

test('the code length is four', () => expect(CODE_LENGTH).toBe(4));

test('codeFromUrl reads both shapes this app produces', () => {
  expect(codeFromUrl('https://x/play?gameId=4821')).toBe('4821');
  expect(codeFromUrl('https://x/play/4821')).toBe('4821');
  expect(codeFromUrl('https://x/play?gameId=48210')).toBeNull();
});

test('noise is removed, and submit unlocks only at four digits', () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '48-2' } });
  expect(field()).toHaveValue('482');
  expect(screen.getByRole('button')).toBeDisabled();
  fireEvent.change(field(), { target: { value: '48 21' } });
  expect(screen.getByRole('button')).toBeEnabled();
});

test('more than four pasted digits is refused and keeps what was there', () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '12' } });
  fireEvent.paste(field(), { clipboardData: { getData: () => '123456' } });
  expect(field()).toHaveValue('12');
  expect(screen.getByTestId('note')).toHaveTextContent('That is 6 digits');
});

test('404 stays put and names the code', async () => {
  render(<Probe />);
  fireEvent.change(field(), { target: { value: '4821' } });
  respond(404);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByTestId('missing')).toHaveTextContent('4821'));
  expect(navigateTo).not.toHaveBeenCalled();
});

test('200, 500 and a network failure all navigate', async () => {
  for (const arrange of [() => respond(200), () => respond(500), () => global.fetch.mockRejectedValueOnce(new Error('x'))]) {
    navigateTo.mockClear();
    const { unmount } = render(<Probe />);
    fireEvent.change(field(), { target: { value: '4821' } });
    arrange();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
    unmount();
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest src/__tests__/useJoinCode.test.jsx`
Expected: FAIL — `Cannot find module '../hooks/useJoinCode'`.

- [ ] **Step 3: Write the hook** — move the code out of `RootPage.jsx` unchanged, keeping its comments:

```jsx
// src/src/hooks/useJoinCode.js
import { useCallback, useState } from 'react';
import { navigateTo } from '../auth/navigate';

export const CODE_LENGTH = 4;

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

/**
 * A code arrives as four digits, or as the whole join URL off a slide or out of
 * a calendar invite. Both shapes this app itself produces are recognised.
 */
export function codeFromUrl(raw) {
  const match =
    /[?&]gameId=(\d{4})(?!\d)/.exec(raw) || /\/play\D{0,12}(\d{4})(?!\d)/.exec(raw);
  return match ? match[1] : null;
}

/**
 * THE JOIN LOGIC, ONCE. RootPage (/join) and the marketing hero both type a
 * code; a second copy of the pre-flight rule below is how one of them would end
 * up stranding a participant.
 */
export default function useJoinCode() {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(null); // the code the server did not know
  const [focused, setFocused] = useState(false);
  const [checking, setChecking] = useState(false);

  const clearFeedback = useCallback(() => { setNote(''); setMissing(null); }, []);

  const handleChange = (event) => {
    clearFeedback();
    setCode(digitsOnly(event.target.value).slice(0, CODE_LENGTH));
  };

  // Noise is removed rather than reported. The one exception is more than four
  // digits: guessing which four someone meant could drop them into a different
  // live room, so the field says what it sees and keeps what is already there.
  const handlePaste = (event) => {
    event.preventDefault();
    const clipboard = event.clipboardData || window.clipboardData;
    const raw = (clipboard && clipboard.getData('text')) || '';

    const fromUrl = codeFromUrl(raw);
    if (fromUrl) {
      setMissing(null);
      setCode(fromUrl);
      setNote('Took the code out of that link.');
      return;
    }
    const digits = digitsOnly(raw);
    if (digits.length > CODE_LENGTH) {
      setNote(`That is ${digits.length} digits. The code on screen is ${CODE_LENGTH}.`);
      return;
    }
    clearFeedback();
    setCode(digits);
  };

  // 404 -> say so, stay put. 200 -> /play. ANYTHING ELSE -> navigate anyway: a
  // check that can strand a participant is worse than no check.
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH || checking) return;
    setChecking(true);
    clearFeedback();
    try {
      const response = await fetch(`${window.API_BASE}games/${code}`);
      if (response && response.status === 404) {
        setMissing(code);
        setChecking(false);
        return;
      }
    } catch (_) {
      /* deliberate: fall through to the navigation below */
    }
    navigateTo(`/play?gameId=${code}`);
  };

  return {
    code, note, missing, checking, focused, setFocused,
    canSubmit: code.length === CODE_LENGTH && !checking,
    cells: Array.from({ length: CODE_LENGTH }, (_, index) => index),
    handleChange, handlePaste, handleSubmit,
  };
}
```

- [ ] **Step 4: Make `RootPage` consume it.** In `RootPage.jsx`: delete `CODE_LENGTH`, `digitsOnly`, `codeFromUrl`, the five `useState` lines, `clearFeedback`, `handleChange`, `handlePaste`, `handleSubmit` and the `cells` const. Change the React import to `import React from 'react';`, drop the `navigateTo` import only if no longer used (it is still used by `goToAuth` — keep it), add:

```jsx
import useJoinCode, { CODE_LENGTH } from '../hooks/useJoinCode';
```

and at the top of the component:

```jsx
  const {
    code, note, missing, checking, focused, setFocused, canSubmit, cells,
    handleChange, handlePaste, handleSubmit,
  } = useJoinCode();
```

Replace `disabled={code.length !== CODE_LENGTH || checking}` with `disabled={!canSubmit}`. `CODE_LENGTH` is still used by `maxLength`. Leave every line of markup and every comment block that describes markup as it is; move the handler comment blocks with the code.

- [ ] **Step 5: Run both suites**

Run: `npx jest src/__tests__/useJoinCode.test.jsx src/__tests__/rootPage.test.jsx`
Expected: PASS, with `rootPage.test.jsx` untouched and its test count unchanged (17).

- [ ] **Step 6: Commit**

```bash
git add src/src/hooks/useJoinCode.js src/src/__tests__/useJoinCode.test.jsx src/src/components/RootPage.jsx
git commit -m "The join-code logic lives in one hook, so the hero can take a code without a second copy of the pre-flight rule"
```

---

### Task 3: `JoinCodeEntry` — the compact hero entry

**Files:**
- Create: `src/src/components/JoinCodeEntry.jsx`, `src/src/components/JoinCodeEntry.css`
- Test: `src/src/__tests__/joinCodeEntry.test.jsx`

**Interfaces:**
- Consumes: `useJoinCode()` from Task 2.
- Produces: `<JoinCodeEntry label="Have a code?" />` — default export, one optional prop `label`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/joinCodeEntry.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinCodeEntry from '../components/JoinCodeEntry';
import { navigateTo } from '../auth/navigate';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const field = () => screen.getByLabelText(/session code/i);

beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); window.API_BASE = 'https://api.example/'; });

test('it does not steal focus from a marketing page', () => {
  // rejects: copying RootPage's autoFocus, which on the home page would scroll
  // a reader to the field and raise a phone keyboard over the headline
  render(<JoinCodeEntry />);
  expect(field()).not.toHaveFocus();
});

test('a valid code joins', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('an unknown code says so inline, as an alert', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 404, ok: false, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is running under 4821');
  expect(navigateTo).not.toHaveBeenCalled();
});

test('every class is in the jce namespace', () => {
  const { container } = render(<JoinCodeEntry />);
  const names = [...container.querySelectorAll('[class]')].flatMap((el) => [...el.classList]);
  expect(names.filter((n) => !n.startsWith('jce') && !n.startsWith('is-'))).toEqual([]);
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/joinCodeEntry.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the component**

```jsx
// src/src/components/JoinCodeEntry.jsx
import React from 'react';
import useJoinCode, { CODE_LENGTH } from '../hooks/useJoinCode';
import './JoinCodeEntry.css';

/**
 * The join field for a page whose main job is something else. No autoFocus:
 * on /join the field IS the page, here it is one line under a headline.
 */
export default function JoinCodeEntry({ label = 'Have a code?' }) {
  const j = useJoinCode();
  return (
    <form className="jce" onSubmit={j.handleSubmit}>
      <label className="jce-label" htmlFor="jce-code">{label}</label>
      <div className={['jce-row', j.focused ? 'is-focused' : '', j.missing ? 'is-bad' : ''].filter(Boolean).join(' ')}>
        <input
          id="jce-code"
          className="jce-input"
          name="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          placeholder="4-digit code"
          aria-label="Session code, 4 digits"
          value={j.code}
          onChange={j.handleChange}
          onPaste={j.handlePaste}
          onFocus={() => j.setFocused(true)}
          onBlur={() => j.setFocused(false)}
        />
        <button type="submit" className="jce-go" disabled={!j.canSubmit}>Join</button>
      </div>
      <p className="jce-note" role="status" aria-live="polite">{j.note}</p>
      {j.missing && (
        <p className="jce-missing" role="alert">
          Nothing is running under {j.missing}. Check the screen at the front of the room.
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Write the stylesheet.** Visual values come from the `.jce` block in the approved `01-home.html`; the structural contract is:

```css
/* src/src/components/JoinCodeEntry.css */
.jce { display: grid; gap: 6px; max-width: 320px; }
.jce-label { font-size: var(--mk-t-label, 13px); color: var(--mk-muted, #9BA8BE); }
.jce-row { display: flex; gap: 8px; border: 1px solid var(--mk-hair, rgba(244,237,228,.14)); border-radius: 10px; padding: 4px; background: var(--mk-surface, #1B2942); }
.jce-row.is-focused { border-color: var(--mk-amber, #F6A94C); }
.jce-row.is-bad { border-color: var(--danger-text, #EF8C86); }
.jce-input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--mk-text, #F4EDE4); font-size: var(--mk-t-body, 17px); letter-spacing: 0.2em; padding: 8px 10px; }
.jce-go { min-height: 44px; padding: 0 18px; border: 0; border-radius: 8px; background: var(--mk-amber, #F6A94C); color: var(--mk-bg, #0F1A2E); font-size: var(--mk-t-body, 17px); font-weight: 600; cursor: pointer; }
.jce-go:disabled { opacity: 0.45; cursor: default; }
.jce-note { min-height: 1.2em; margin: 0; font-size: var(--mk-t-label, 13px); color: var(--mk-muted, #9BA8BE); }
.jce-missing { margin: 0; font-size: var(--mk-t-label, 13px); color: var(--danger-text, #EF8C86); }
```

- [ ] **Step 5: Run** — `npx jest src/__tests__/joinCodeEntry.test.jsx src/__tests__/scopedClassesDeclared.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/components/JoinCodeEntry.jsx src/src/components/JoinCodeEntry.css src/src/__tests__/joinCodeEntry.test.jsx
git commit -m "A compact join entry for the hero, which takes a code without taking focus"
```

---

### Task 4: `MarketingShell` — nav, footer, tokens, error boundary

**Files:**
- Create: `src/src/marketing/MarketingShell.jsx`, `src/src/marketing/MarketingShell.css`
- Test: `src/src/__tests__/marketingShell.test.jsx`

**Interfaces:**
- Consumes: `navigateTo`, `rememberReturnPath(location)`.
- Produces: `<MarketingShell title="…" current="home|how|cases|reports|help">{children}</MarketingShell>`; named export `goToAuth(destination) → (event) => void`, which every marketing CTA uses.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/marketingShell.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MarketingShell from '../marketing/MarketingShell';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

test('the nav reaches every marketing page, and both auth doors', () => {
  render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  const nav = screen.getByRole('navigation', { name: /main/i });
  for (const [name, href] of [[/how it works/i, '/how-it-works'], [/use cases/i, '/use-cases'], [/reports/i, '/reports'], [/help/i, '/help']]) {
    expect(screen.getAllByRole('link', { name })[0]).toHaveAttribute('href', href);
  }
  expect(nav).toContainElement(screen.getByRole('link', { name: /^sign in$/i }));
  expect(nav).toContainElement(screen.getByRole('link', { name: /create a host account/i }));
});

test('signing in from any marketing page returns a host to /, not to the brochure', () => {
  // rejects: a bare rememberReturnPath(), which would record /how-it-works and
  // land a freshly signed-in host back on a marketing page
  window.history.pushState({}, '', '/how-it-works');
  render(<MarketingShell title="T" current="how"><p>body</p></MarketingShell>);
  fireEvent.click(screen.getByRole('link', { name: /^sign in$/i }));
  expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
  expect(navigateTo).toHaveBeenCalledWith('/auth');
  window.history.pushState({}, '', '/');
});

test('the current page is marked for assistive tech', () => {
  render(<MarketingShell title="T" current="reports"><p>body</p></MarketingShell>);
  expect(screen.getAllByRole('link', { name: /reports/i })[0]).toHaveAttribute('aria-current', 'page');
});

test('it sets the document title', () => {
  render(<MarketingShell title="How it works" current="how"><p>body</p></MarketingShell>);
  expect(document.title).toBe('How it works · Engagements');
});

test('a page that throws leaves the doors standing', () => {
  const Boom = () => { throw new Error('chunk'); };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<MarketingShell title="T" current="home"><Boom /></MarketingShell>);
  expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
  expect(screen.getByRole('link', { name: /join a session/i })).toHaveAttribute('href', '/join');
  spy.mockRestore();
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/marketingShell.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the shell**

```jsx
// src/src/marketing/MarketingShell.jsx
import React, { useEffect, useState } from 'react';
import { navigateTo } from '../auth/navigate';
import { rememberReturnPath } from '../auth/returnPath';
import './MarketingShell.css';

const LINKS = [
  { id: 'how', label: 'How it works', href: '/how-it-works' },
  { id: 'cases', label: 'Use cases', href: '/use-cases' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'help', label: 'Help', href: '/help' },
];

/**
 * A host who signs in from a brochure page wants their host page, which is `/`.
 * rememberReturnPath() with no argument would record the brochure.
 */
export const goToAuth = (destination) => (event) => {
  event.preventDefault();
  rememberReturnPath({ pathname: '/', search: '' });
  navigateTo(destination);
};

class PageBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mk-shell mk-failed" role="alert">
        <h1 className="mk-head">This page could not load.</h1>
        <p>Reload to try again. Everything else still works:</p>
        <p><a className="mk-link" href="/join">Join a session</a> · <a className="mk-link" href="/auth">Sign in</a></p>
      </div>
    );
  }
}

export default function MarketingShell({ title, current, children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { document.title = title ? `${title} · Engagements` : 'Engagements'; }, [title]);

  return (
    <div className="mk-root">
      <header className="mk-nav">
        <div className="mk-shell mk-nav-row">
          <a className="mk-brand" href="/">Engagements</a>
          <nav aria-label="Main" className={`mk-nav-links${open ? ' is-open' : ''}`}>
            {LINKS.map((link) => (
              <a key={link.id} className="mk-nav-link" href={link.href} aria-current={current === link.id ? 'page' : undefined}>
                {link.label}
              </a>
            ))}
            <a className="mk-btn mk-btn-quiet" href="/auth" onClick={goToAuth('/auth')}>Sign in</a>
            <a className="mk-btn mk-btn-primary" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
          </nav>
          <button type="button" className="mk-menu" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((v) => !v)}>
            <span aria-hidden="true">≡</span>
          </button>
        </div>
      </header>

      <main className="mk-main"><PageBoundary>{children}</PageBoundary></main>

      <footer className="mk-foot">
        <div className="mk-shell mk-foot-row">
          <span className="mk-foot-brand">Engagements</span>
          <nav aria-label="Footer" className="mk-foot-links">
            <a href="/join">Join a session</a>
            <a href="/help">Help</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Write `MarketingShell.css`.** Start with the token block from Task 1 Step 2 **verbatim**, then the shared primitives every page uses. Visual values not listed come from the approved mockups' `mk.css`:

```css
.mk-shell { max-width: var(--mk-shell); margin: 0 auto; padding: 0 var(--mk-gutter); }
.mk-nav { position: sticky; top: 0; z-index: 10; background: rgba(15, 26, 46, 0.86); backdrop-filter: blur(8px); border-bottom: 1px solid var(--mk-hair); }
.mk-nav-row { display: flex; align-items: center; gap: 20px; min-height: 64px; }
.mk-brand { font-weight: 700; font-size: var(--mk-t-lead); color: var(--mk-text); text-decoration: none; margin-right: auto; }
.mk-nav-links { display: flex; align-items: center; gap: 20px; }
.mk-nav-link { color: var(--mk-muted); text-decoration: none; font-size: var(--mk-t-label); }
.mk-nav-link:hover, .mk-nav-link[aria-current="page"] { color: var(--mk-text); }
.mk-menu { display: none; min-width: 44px; min-height: 44px; background: transparent; border: 1px solid var(--mk-hair); border-radius: 8px; color: var(--mk-text); font-size: var(--mk-t-lead); }
.mk-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px; border-radius: 10px; font-size: var(--mk-t-body); font-weight: 600; text-decoration: none; }
.mk-btn-primary { background: var(--mk-amber); color: var(--mk-bg); }
.mk-btn-quiet { border: 1px solid var(--mk-hair); color: var(--mk-text); }
.mk-link { color: var(--mk-amber); }
.mk-kicker { font-size: var(--mk-t-label); letter-spacing: 0.12em; text-transform: uppercase; color: var(--mk-amber); }
.mk-display { font-size: var(--mk-t-display); line-height: 1.04; letter-spacing: -0.02em; margin: 0; }
.mk-title { font-size: var(--mk-t-title); line-height: 1.1; margin: 0; }
.mk-head { font-size: var(--mk-t-head); line-height: 1.2; margin: 0; }
.mk-lead { font-size: var(--mk-t-lead); color: var(--mk-muted); }
.mk-muted { color: var(--mk-muted); }
.mk-section { padding: 96px 0; position: relative; }
.mk-cta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.mk-foot { border-top: 1px solid var(--mk-hair); padding: 32px 0; font-size: var(--mk-t-label); color: var(--mk-muted); }
.mk-foot-row { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; }
.mk-foot-links { display: flex; gap: 20px; }
.mk-foot-links a { color: var(--mk-muted); }
.mk-failed { padding: 96px var(--mk-gutter); }
@media (max-width: 720px) {
  .mk-menu { display: inline-flex; align-items: center; justify-content: center; }
  .mk-nav-links { display: none; position: absolute; left: 0; right: 0; top: 64px; flex-direction: column; align-items: stretch; padding: 16px var(--mk-gutter); background: var(--mk-bg); border-bottom: 1px solid var(--mk-hair); }
  .mk-nav-links.is-open { display: flex; }
  .mk-section { padding: 56px 0; }
}
```

- [ ] **Step 5: Run** — `npx jest src/__tests__/marketingShell.test.jsx src/__tests__/scopedClassesDeclared.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/marketing/MarketingShell.jsx src/src/marketing/MarketingShell.css src/src/__tests__/marketingShell.test.jsx
git commit -m "The marketing shell: one nav and footer, scoped tokens and ladder, and a boundary that keeps the join and sign-in doors open when a page fails"
```

---

### Task 5: `useScrollProgress` and `RidgeScene`

**Files:**
- Create: `src/src/marketing/useScrollProgress.js`, `src/src/marketing/components/RidgeScene.jsx`, `src/src/marketing/components/RidgeScene.css`
- Test: `src/src/__tests__/ridgeScene.test.jsx`

**Interfaces:**
- Produces: `useScrollProgress() → number` in `[0,1]`; `prefersReducedMotion() → boolean` (named export of the same file); `<RidgeScene progress={0..1} />`; named export `pointOnRoute(progress) → { x, y }` in the 1200×600 viewBox.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/ridgeScene.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import RidgeScene, { pointOnRoute } from '../marketing/components/RidgeScene';
import { prefersReducedMotion } from '../marketing/useScrollProgress';

const fs = require('fs');
const path = require('path');
const SRC = ['RidgeScene.jsx', 'RidgeScene.css']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'marketing', 'components', f), 'utf8')).join('\n');

test('the banned parallax class does not come back under a new file', () => {
  expect(SRC).not.toMatch(/parallax/i);
  const { container } = render(<RidgeScene progress={0.5} />);
  expect(container.querySelector('[class*="parallax"]')).toBeNull();
});

test('no art is loaded from anywhere — the old hero hot-linked a paid library', () => {
  expect(SRC).not.toMatch(/https?:\/\//);
  expect(SRC).not.toMatch(/\.(webp|png|jpe?g)/i);
});

test('it is decoration, and says so', () => {
  const { container } = render(<RidgeScene progress={0} />);
  expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
});

test('the climber starts at base camp and ends on the summit', () => {
  expect(pointOnRoute(0)).toEqual({ x: 180, y: 470 });
  expect(pointOnRoute(1)).toEqual({ x: 600, y: 230 });
  const mid = pointOnRoute(0.5);
  expect(mid.y).toBeLessThan(470);
  expect(mid.y).toBeGreaterThan(230);
  expect(pointOnRoute(7)).toEqual(pointOnRoute(1));   // clamped
  expect(pointOnRoute(-1)).toEqual(pointOnRoute(0));
});

test('deeper layers move further', () => {
  const { container } = render(<RidgeScene progress={1} />);
  const shift = (name) => Number(/translate3d\(0px?, (-?[\d.]+)px/.exec(container.querySelector(name).style.transform)[1]);
  expect(Math.abs(shift('.mk-ridge-front'))).toBeGreaterThan(Math.abs(shift('.mk-ridge-mid')));
  expect(Math.abs(shift('.mk-ridge-mid'))).toBeGreaterThan(Math.abs(shift('.mk-ridge-back')));
});

test('reduced motion is read without a matchMedia to read it from', () => {
  // jsdom has no matchMedia; the hook must not throw there
  expect(prefersReducedMotion()).toBe(false);
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/ridgeScene.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the hook**

```js
// src/src/marketing/useScrollProgress.js
import { useEffect, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How far down the document the reader is, 0..1, sampled once per frame.
 * Under reduced motion it is pinned at 1: the scene is static and the climber
 * is already on the summit, which is the honest still of this page.
 */
export default function useScrollProgress() {
  const reduced = prefersReducedMotion();
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const doc = document.documentElement;
      const span = doc.scrollHeight - window.innerHeight;
      setProgress(span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return progress;
}
```

- [ ] **Step 4: Write the scene.** Paths are `Ridge.jsx`'s three ranges, so the motif is the same one the design spec §4 defined; the route follows the front range's own vertices from its left shoulder to its summit.

```jsx
// src/src/marketing/components/RidgeScene.jsx
import React, { useId } from 'react';
import './RidgeScene.css';

/** Depths from docs/design/parallax-art-brief.md, so a raster set could drop in. */
const DEPTH = { back: 0.15, mid: 0.35, front: 0.6 };
const TRAVEL = 140; // px of drift at depth 1 across the whole page

/** Front-range vertices from the left shoulder to the summit. */
const ROUTE = [[180, 470], [340, 360], [520, 300], [600, 230]];

const LENGTHS = ROUTE.slice(1).map(([x, y], i) => Math.hypot(x - ROUTE[i][0], y - ROUTE[i][1]));
const TOTAL = LENGTHS.reduce((a, b) => a + b, 0);

/** Linear walk along the polyline. jsdom has no getPointAtLength, and this needs none. */
export function pointOnRoute(progress) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  let remaining = p * TOTAL;
  for (let i = 0; i < LENGTHS.length; i += 1) {
    if (remaining <= LENGTHS[i] || i === LENGTHS.length - 1) {
      const t = LENGTHS[i] ? Math.min(1, remaining / LENGTHS[i]) : 0;
      const [x0, y0] = ROUTE[i];
      const [x1, y1] = ROUTE[i + 1];
      return { x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t) };
    }
    remaining -= LENGTHS[i];
  }
  return { x: ROUTE[0][0], y: ROUTE[0][1] };
}

const drift = (depth, progress) => ({ transform: `translate3d(0px, ${(-TRAVEL * depth * progress).toFixed(1)}px, 0px)` });

export default function RidgeScene({ progress = 0 }) {
  const glowId = `mk-glow-${useId().replace(/:/g, '')}`;
  const climber = pointOnRoute(progress);

  return (
    <div className="mk-ridge" aria-hidden="true">
      <svg className="mk-ridge-svg" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice">
        <defs>
          {/* Centred low: the art brief keeps amber in the bottom 40% so the
              headline above it holds its contrast. */}
          <radialGradient id={glowId} cx="50%" cy="78%" r="45%">
            <stop offset="0%" stopColor="var(--mk-amber)" stopOpacity="0.75" />
            <stop offset="50%" stopColor="var(--mk-amber)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--mk-amber)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect className="mk-ridge-glow" x="0" y="0" width="1200" height="600" fill={`url(#${glowId})`} opacity={0.35 + 0.5 * progress} />
        <path className="mk-ridge-back" style={drift(DEPTH.back, progress)}
          d="M0,600 L0,510 L260,540 L520,500 L780,540 L1040,510 L1200,530 L1200,600 Z" />
        <path className="mk-ridge-mid" style={drift(DEPTH.mid, progress)}
          d="M0,600 L0,470 L220,500 L430,430 L640,470 L860,420 L1080,480 L1200,460 L1200,600 Z" />
        <g className="mk-ridge-front" style={drift(DEPTH.front, progress)}>
          <path className="mk-ridge-front-fill"
            d="M0,600 L0,420 L180,470 L340,360 L520,300 L600,230 L700,320 L880,380 L1060,440 L1200,410 L1200,600 Z" />
          <polyline className="mk-ridge-route" points={ROUTE.map((pt) => pt.join(',')).join(' ')} />
          <circle className="mk-ridge-climber" cx={climber.x} cy={climber.y} r="7" />
        </g>
      </svg>
    </div>
  );
}
```

```css
/* src/src/marketing/components/RidgeScene.css */
.mk-ridge { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.mk-ridge-svg { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; display: block; }
.mk-ridge-back { fill: var(--mk-ridge-back); }
.mk-ridge-mid { fill: var(--mk-ridge-mid); }
.mk-ridge-front-fill { fill: var(--mk-ridge-front); stroke: var(--mk-amber); stroke-width: 2; stroke-opacity: 0.5; }
.mk-ridge-route { fill: none; stroke: var(--mk-text); stroke-opacity: 0.55; stroke-width: 2; stroke-dasharray: 3 9; stroke-linecap: round; }
.mk-ridge-climber { fill: var(--mk-amber); stroke: var(--mk-bg); stroke-width: 3; }
.mk-ridge-back, .mk-ridge-mid, .mk-ridge-front { will-change: transform; }
@media (prefers-reduced-motion: reduce) {
  .mk-ridge-back, .mk-ridge-mid, .mk-ridge-front { transform: none !important; }
}
```

- [ ] **Step 5: Run** — `npx jest src/__tests__/ridgeScene.test.jsx` → PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/src/marketing/useScrollProgress.js src/src/marketing/components/RidgeScene.jsx src/src/marketing/components/RidgeScene.css src/src/__tests__/ridgeScene.test.jsx
git commit -m "A layered SVG ridge scene whose climber follows the reader up the page, with no art from anywhere and nothing moving under reduced motion"
```

---

### Task 6: Clip slots — manifest, `ClipFrame`, `DeviceFrame`

**Files:**
- Create: `src/src/marketing/content/clips.js`, `src/src/marketing/components/ClipFrame.jsx`/`.css`, `src/src/marketing/components/DeviceFrame.jsx`/`.css`, `src/public/assets/marketing/CREDITS.json`
- Test: `src/src/__tests__/clipFrame.test.jsx`

**Interfaces:**
- Produces: `CLIPS` — object keyed by slot id, each `{ frame: 'tv'|'phone'|'laptop', caption, alt, poster: string|null, webm: string|null, mp4: string|null }`; `<ClipFrame slot="trivia-host" />`; `<DeviceFrame kind="tv|phone|laptop">{children}</DeviceFrame>`. Sub-project 2 fills `poster`/`webm`/`mp4` and touches nothing else.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/clipFrame.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import ClipFrame from '../marketing/components/ClipFrame';
import { CLIPS } from '../marketing/content/clips';

const SLOTS = ['trivia-host', 'trivia-player', 'poll-host', 'poll-player', 'join-qr', 'builder', 'report'];

test('the manifest carries exactly the seven slots the spec defines', () => {
  expect(Object.keys(CLIPS).sort()).toEqual([...SLOTS].sort());
});

test.each(SLOTS)('%s describes itself to someone who cannot see it', (slot) => {
  expect(CLIPS[slot].alt.length).toBeGreaterThan(20);
  expect(CLIPS[slot].caption.length).toBeGreaterThan(5);
  expect(['tv', 'phone', 'laptop']).toContain(CLIPS[slot].frame);
});

test('with no recording yet, a slot is a captioned still — never a dead player', () => {
  const { container } = render(<ClipFrame slot="trivia-host" />);
  expect(container.querySelector('video')).toBeNull();
  expect(screen.getByRole('img', { name: CLIPS['trivia-host'].alt })).toBeInTheDocument();
  expect(screen.getByText(CLIPS['trivia-host'].caption)).toBeInTheDocument();
});

test('with a recording, it is a muted, looping, inline video that waits to be seen', () => {
  const clip = { ...CLIPS['poll-host'], poster: '/assets/marketing/poll-host.jpg', webm: '/assets/marketing/poll-host.webm', mp4: '/assets/marketing/poll-host.mp4' };
  const { container } = render(<ClipFrame slot="poll-host" clip={clip} />);
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video.muted).toBe(true);
  expect(video).toHaveAttribute('loop');
  expect(video).toHaveAttribute('playsinline');
  expect(video).toHaveAttribute('preload', 'none');
  expect(video).toHaveAttribute('poster', clip.poster);
  expect(video).not.toHaveAttribute('autoplay');
  expect([...container.querySelectorAll('source')].map((s) => s.getAttribute('type'))).toEqual(['video/webm', 'video/mp4']);
});

test('an unknown slot renders nothing rather than crashing the page', () => {
  const { container } = render(<ClipFrame slot="nope" />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/clipFrame.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the manifest**

```js
// src/src/marketing/content/clips.js
/**
 * EVERY SCREEN CLIP SLOT ON THE MARKETING PAGES, AND THE ONLY LIST OF THEM.
 * poster/webm/mp4 are null until the capture script (sub-project 2) records
 * them; ClipFrame shows a captioned still until then. Paths, when set, are
 * site-relative under /assets/marketing/ — never another origin.
 */
const slot = (frame, caption, alt) => ({ frame, caption, alt, poster: null, webm: null, mp4: null });

export const CLIPS = {
  'trivia-host': slot('tv', 'Trivia on the big screen',
    'The host screen shows a trivia question with four choices, answers lock in, then the correct answer and the standings appear.'),
  'trivia-player': slot('phone', 'Answering from a phone',
    'A phone shows the same question; the player taps a choice and sees whether it was right.'),
  'poll-host': slot('tv', 'Call and answer on the big screen',
    'The host screen shows a prompt, ideas from the room arrive one by one, the room votes, and the results are revealed with a summary.'),
  'poll-player': slot('phone', 'Adding an idea, then voting',
    'A phone shows the prompt; the player types an idea and sends it, then votes on the ideas from the rest of the room.'),
  'join-qr': slot('tv', 'Joining by QR code',
    'The lobby screen shows a QR code and a four-digit code while player names appear as people join.'),
  builder: slot('laptop', 'Drafting a set from your material',
    'The set builder takes a topic and source material and drafts questions, which the host reviews and edits.'),
  report: slot('laptop', 'The session report',
    'The report opens on paper: every answer, the vote breakdown, comments and the summary, then exports to PDF.'),
};
```

- [ ] **Step 4: Write the components**

```jsx
// src/src/marketing/components/DeviceFrame.jsx
import React from 'react';
import './DeviceFrame.css';

export default function DeviceFrame({ kind = 'tv', children }) {
  return <div className={`mk-device mk-device--${kind}`}><div className="mk-device-screen">{children}</div></div>;
}
```

```jsx
// src/src/marketing/components/ClipFrame.jsx
import React, { useEffect, useRef } from 'react';
import DeviceFrame from './DeviceFrame';
import { CLIPS } from '../content/clips';
import { prefersReducedMotion } from '../useScrollProgress';
import './ClipFrame.css';

/** `clip` overrides the manifest entry — for tests, and for the capture script's preview. */
export default function ClipFrame({ slot, clip: override }) {
  const clip = override || CLIPS[slot];
  const ref = useRef(null);
  const playable = Boolean(clip && (clip.webm || clip.mp4)) && !prefersReducedMotion();

  // Play only while on screen. No autoplay attribute: seven looping videos
  // decoding at once on a phone is a cost nobody watching one of them agreed to.
  useEffect(() => {
    const video = ref.current;
    if (!playable || !video || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } else video.pause();
    }, { threshold: 0.4 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [playable]);

  if (!clip) return null;

  return (
    <figure className="mk-clip">
      <DeviceFrame kind={clip.frame}>
        {playable ? (
          <video ref={ref} className="mk-clip-media" muted loop playsInline preload="none" poster={clip.poster || undefined} aria-label={clip.alt}>
            {clip.webm && <source src={clip.webm} type="video/webm" />}
            {clip.mp4 && <source src={clip.mp4} type="video/mp4" />}
          </video>
        ) : clip.poster ? (
          <img className="mk-clip-media" src={clip.poster} alt={clip.alt} loading="lazy" />
        ) : (
          <div className="mk-clip-still" role="img" aria-label={clip.alt} />
        )}
      </DeviceFrame>
      <figcaption className="mk-clip-caption">{clip.caption}</figcaption>
    </figure>
  );
}
```

React sets `muted` as a property, not an attribute — the test reads `video.muted` for that reason. `playsInline` renders as the `playsinline` attribute.

```css
/* src/src/marketing/components/DeviceFrame.css */
.mk-device { background: var(--mk-surface-2); border: 1px solid var(--mk-hair); padding: 8px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35); }
.mk-device-screen { overflow: hidden; background: var(--mk-bg); height: 100%; }
.mk-device--tv { border-radius: 14px; aspect-ratio: 16 / 9; }
.mk-device--tv .mk-device-screen { border-radius: 8px; }
.mk-device--laptop { border-radius: 12px 12px 4px 4px; aspect-ratio: 16 / 10; }
.mk-device--laptop .mk-device-screen { border-radius: 6px; }
.mk-device--phone { border-radius: 28px; aspect-ratio: 9 / 19; max-width: 220px; }
.mk-device--phone .mk-device-screen { border-radius: 22px; }
```

```css
/* src/src/marketing/components/ClipFrame.css */
.mk-clip { margin: 0; display: grid; gap: 10px; }
.mk-clip-media { display: block; width: 100%; height: 100%; object-fit: cover; }
.mk-clip-still { width: 100%; height: 100%; background: linear-gradient(160deg, var(--mk-surface) 0%, var(--mk-bg) 70%); }
.mk-clip-caption { font-size: var(--mk-t-label); color: var(--mk-muted); }
```

```json
// src/public/assets/marketing/CREDITS.json
{
  "note": "Every file in this directory is a recording or still of this product, produced by this project's own capture script. Nothing here is third-party.",
  "files": []
}
```
(Write the JSON without the comment line.)

- [ ] **Step 5: Run** — `npx jest src/__tests__/clipFrame.test.jsx` → PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/src/marketing/content/clips.js src/src/marketing/components/ClipFrame.* src/src/marketing/components/DeviceFrame.* src/public/assets/marketing/CREDITS.json src/src/__tests__/clipFrame.test.jsx
git commit -m "Seven screen-clip slots that are captioned stills until a recording exists, and quiet, in-view-only videos once one does"
```

---

### Task 7: `HomePage`

**Files:**
- Create: `src/src/marketing/content/home.js`, `src/src/marketing/HomePage.jsx`, `src/src/marketing/HomePage.css`, `src/src/marketing/components/SampleReport.jsx`/`.css`, `src/src/marketing/content/sampleReport.js`
- Test: `src/src/__tests__/homePage.test.jsx`

`SampleReport` is built here because the summit section needs it; `/reports` (Task 10) reuses it with callouts.

**Interfaces:**
- Consumes: `MarketingShell`, `goToAuth`, `RidgeScene`, `useScrollProgress`, `ClipFrame`, `JoinCodeEntry`.
- Produces: `HomePage` default export; `<SampleReport callouts={false} />`; `SAMPLE_REPORT` fixture `{ event, date, players, round: { prompt, answers: [{ text, author, votes }], comments: [string], summary, discussionQuestions: [string], nextSteps: [string] }, standings: [{ name, score }] }`; `HOME` content object.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/homePage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HomePage from '../marketing/HomePage';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); sessionStorage.clear(); window.API_BASE = 'https://api.example/'; });

test('one h1, and it is about the reader, not the product', () => {
  render(<HomePage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/team/i);
});

test('the climb is told in order: problem, two modes, material, the room, the report', () => {
  render(<HomePage />);
  const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
  expect(ids).toEqual(['top', 'problem', 'modes', 'material', 'room', 'summit', 'start']);
});

test('a player who types the bare domain can still join from the hero', async () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.change(within(hero).getByLabelText(/session code/i), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(within(hero).getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('the hero register CTA asks for the register form and returns the host to /', () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.click(within(hero).getByRole('link', { name: /create a host account/i }));
  expect(navigateTo).toHaveBeenCalledWith('/auth?mode=register');
  expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
});

test('both modes show the room and the phone', () => {
  render(<HomePage />);
  const modes = document.getElementById('modes');
  expect(within(modes).getByRole('heading', { name: /trivia/i })).toBeInTheDocument();
  expect(within(modes).getByRole('heading', { name: /call and answer/i })).toBeInTheDocument();
  expect(within(modes).getAllByRole('img')).toHaveLength(4);
});

test('the report is the one paper surface, and converts theme and markup together', () => {
  render(<HomePage />);
  const paper = document.querySelectorAll('[data-theme="light"]');
  expect(paper).toHaveLength(1);
  expect(document.getElementById('summit')).toContainElement(paper[0]);
  expect(within(paper[0]).getByText(/next steps/i)).toBeInTheDocument();
});

test('the tour and the report page are one click away', () => {
  render(<HomePage />);
  expect(screen.getByRole('link', { name: /see how a session runs/i })).toHaveAttribute('href', '/how-it-works');
  expect(screen.getByRole('link', { name: /see what the report captures/i })).toHaveAttribute('href', '/reports');
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/homePage.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the content**

```js
// src/src/marketing/content/home.js
export const HOME = {
  hero: {
    kicker: 'Live sessions for teams',
    headline: 'Turn your team’s own material into decisions everyone climbed toward.',
    lead: 'Run a session from your documents and your questions. Warm the room up with trivia, then put the real question to everyone at once — and leave with a report of every idea and how the team voted.',
  },
  problem: {
    title: 'Most meetings lose the best thinking in the room.',
    points: [
      { title: 'Three people talk.', text: 'Everyone else has an answer and nowhere to put it.' },
      { title: 'Ideas evaporate.', text: 'What was said at minute twelve is gone by minute forty.' },
      { title: 'Nobody can say what was decided.', text: 'The notes are one person’s memory of a conversation.' },
    ],
  },
  modes: {
    title: 'Two ways to play',
    items: [
      { id: 'trivia', name: 'Trivia', text: 'Questions with a right answer, scored live. Use it to warm the room up, or to check that everyone read the brief.', slots: ['trivia-host', 'trivia-player'] },
      { id: 'poll', name: 'Call and answer', text: 'Put a prompt on the screen. Everyone answers from their phone at the same time, then the room votes on what came back.', slots: ['poll-host', 'poll-player'] },
    ],
    link: 'See how a session runs',
  },
  material: {
    title: 'Built from your material, not ours.',
    lead: 'Bring the strategy paper, the customer research, the retro notes. The set builder drafts questions from them; you review, preview and edit every one before it reaches a screen.',
    points: [
      'Draft a question set from a topic and your own source material.',
      'Preview each question exactly as the room will see it.',
      'Keep your organisation’s sets in a private, encrypted library.',
      'Start from a moderated public library when you have nothing yet.',
    ],
  },
  room: {
    title: 'The whole room answers. Then the room decides.',
    lead: 'Ideas arrive on the big screen as they are sent. When the asking stops, everyone votes — and the vote breakdown shows which ideas rose and how far.',
  },
  summit: {
    title: 'The summit: a report that kept everything.',
    lead: 'Every answer, every vote, every comment. A summary of each question with discussion questions and next steps. Export it as a PDF or share a link.',
    link: 'See what the report captures',
  },
  start: { title: 'Run your first session this week.', lead: 'Players need no account and no app — a QR code or four digits.' },
};
```

```js
// src/src/marketing/content/sampleReport.js
/** FIXTURE. Invented people and an invented session; shaped like GameReport's data, not read from it. */
export const SAMPLE_REPORT = {
  event: 'Q4 planning offsite',
  date: '14 October',
  players: 23,
  round: {
    prompt: 'What is the one thing we should stop doing next quarter?',
    answers: [
      { text: 'Weekly status meetings that repeat the dashboard', author: 'Priya', votes: 14 },
      { text: 'Building custom reports for one customer at a time', author: 'Marcus', votes: 9 },
      { text: 'Approving every discount by hand', author: 'Hidden', votes: 6 },
    ],
    comments: ['The status meeting is where we find blockers — keep 15 minutes of it.'],
    summary: 'The room converged on reclaiming meeting time. Fourteen of 23 votes went to ending the weekly status meeting, with a clear caveat that blocker-finding has to live somewhere.',
    discussionQuestions: ['Where do blockers surface if the meeting goes?', 'Which custom reports could become a product feature?'],
    nextSteps: ['Trial an async status update for four weeks.', 'List the custom reports built this year and who asked for them.'],
  },
  standings: [{ name: 'Priya', score: 2400 }, { name: 'Marcus', score: 2150 }, { name: 'Ana', score: 1900 }],
};
```

- [ ] **Step 4: Write `SampleReport`**

```jsx
// src/src/marketing/components/SampleReport.jsx
import React from 'react';
import { SAMPLE_REPORT } from '../content/sampleReport';
import './SampleReport.css';

/**
 * A still of a report, on paper. Deliberately NOT GameReport: that component is
 * bound to live session data and a print sheet. This is fixture data, and the
 * page says so.
 */
export default function SampleReport({ callouts = false }) {
  const r = SAMPLE_REPORT;
  const top = Math.max(...r.round.answers.map((a) => a.votes));
  const mark = (n) => (callouts ? <span className="mk-report-mark" aria-hidden="true">{n}</span> : null);

  return (
    <article className="mk-report" data-theme="light" aria-label="Sample session report">
      <header className="mk-report-head">
        <p className="mk-report-meta">{r.date} · {r.players} players · sample</p>
        <h3 className="mk-report-title">{r.event}</h3>
      </header>
      <section>
        <h4 className="mk-report-prompt">{mark(1)}{r.round.prompt}</h4>
        <ol className="mk-report-answers">
          {r.round.answers.map((a) => (
            <li key={a.text} className="mk-report-answer">
              <span className="mk-report-text">{a.text}</span>
              <span className="mk-report-author">{a.author}</span>
              <span className="mk-report-bar" style={{ '--mk-share': `${Math.round((a.votes / top) * 100)}%` }} />
              <span className="mk-report-votes">{a.votes} votes</span>
            </li>
          ))}
        </ol>
        {mark(2)}
      </section>
      <section>
        <h4 className="mk-report-sub">{mark(3)}Comments</h4>
        {r.round.comments.map((c) => <p key={c} className="mk-report-comment">{c}</p>)}
      </section>
      <section>
        <h4 className="mk-report-sub">{mark(4)}Summary</h4>
        <p>{r.round.summary}</p>
        <h4 className="mk-report-sub">Discussion questions</h4>
        <ul>{r.round.discussionQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
        <h4 className="mk-report-sub">{mark(5)}Next steps</h4>
        <ul>{r.round.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>
      <section>
        <h4 className="mk-report-sub">{mark(6)}Standings</h4>
        <ol className="mk-report-standings">{r.standings.map((s) => <li key={s.name}>{s.name} <span>{s.score}</span></li>)}</ol>
      </section>
    </article>
  );
}
```

```css
/* src/src/marketing/components/SampleReport.css */
.mk-report { background: var(--mk-paper-surface); color: var(--mk-paper-text); border-radius: 6px; padding: 40px; max-width: 760px; margin: 0 auto; box-shadow: 0 40px 90px rgba(0, 0, 0, 0.45); font-size: var(--mk-t-body); }
.mk-report-meta { color: var(--mk-paper-muted); font-size: var(--mk-t-label); margin: 0; }
.mk-report-title { font-size: var(--mk-t-head); margin: 4px 0 24px; }
.mk-report-prompt { font-size: var(--mk-t-lead); margin: 0 0 12px; }
.mk-report-sub { font-size: var(--mk-t-label); letter-spacing: 0.1em; text-transform: uppercase; color: var(--mk-amber-ink); margin: 24px 0 8px; }
.mk-report-answers, .mk-report-standings { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.mk-report-answer { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
.mk-report-author, .mk-report-votes { color: var(--mk-paper-muted); font-size: var(--mk-t-label); }
.mk-report-bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: var(--mk-amber-deep); width: var(--mk-share); }
.mk-report-comment { border-left: 3px solid var(--mk-paper-muted); padding-left: 12px; margin: 0; }
.mk-report-mark { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 8px; border-radius: 50%; background: var(--mk-paper-text); color: var(--mk-paper-surface); font-size: var(--mk-t-floor); }
@media (max-width: 720px) { .mk-report { padding: 22px; } }
```

- [ ] **Step 5: Write `HomePage`**

```jsx
// src/src/marketing/HomePage.jsx
import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import useScrollProgress from './useScrollProgress';
import RidgeScene from './components/RidgeScene';
import ClipFrame from './components/ClipFrame';
import SampleReport from './components/SampleReport';
import JoinCodeEntry from '../components/JoinCodeEntry';
import { HOME } from './content/home';
import './HomePage.css';

const Doors = () => (
  <div className="mk-cta">
    <a className="mk-btn mk-btn-primary" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
    <a className="mk-btn mk-btn-quiet" href="/auth" onClick={goToAuth('/auth')}>Sign in</a>
  </div>
);

export default function HomePage() {
  const progress = useScrollProgress();
  const { hero, problem, modes, material, room, summit, start } = HOME;

  return (
    <MarketingShell title="" current="home">
      <div className="mk-home">
        <div className="mk-home-scene"><RidgeScene progress={progress} /></div>

        <section id="top" className="mk-hero">
          <div className="mk-shell mk-hero-grid">
            <div className="mk-hero-copy">
              <p className="mk-kicker">{hero.kicker}</p>
              <h1 className="mk-display">{hero.headline}</h1>
              <p className="mk-lead">{hero.lead}</p>
              <Doors />
            </div>
            <div className="mk-hero-join"><JoinCodeEntry /></div>
          </div>
        </section>

        <section id="problem" className="mk-section mk-problem">
          <div className="mk-shell">
            <h2 className="mk-title">{problem.title}</h2>
            <ul className="mk-problem-list">
              {problem.points.map((p) => <li key={p.title}><strong>{p.title}</strong> <span className="mk-muted">{p.text}</span></li>)}
            </ul>
          </div>
        </section>

        <section id="modes" className="mk-section mk-modes">
          <div className="mk-shell">
            <h2 className="mk-title">{modes.title}</h2>
            {modes.items.map((mode) => (
              <div key={mode.id} className="mk-mode">
                <div className="mk-mode-copy"><h3 className="mk-head">{mode.name}</h3><p className="mk-lead">{mode.text}</p></div>
                <div className="mk-mode-clips">{mode.slots.map((s) => <ClipFrame key={s} slot={s} />)}</div>
              </div>
            ))}
            <p><a className="mk-link" href="/how-it-works">{modes.link}</a></p>
          </div>
        </section>

        <section id="material" className="mk-section mk-material">
          <div className="mk-shell mk-material-grid">
            <div><h2 className="mk-title">{material.title}</h2><p className="mk-lead">{material.lead}</p></div>
            <ul className="mk-material-list">{material.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </section>

        <section id="room" className="mk-section mk-room">
          <div className="mk-shell"><h2 className="mk-title">{room.title}</h2><p className="mk-lead">{room.lead}</p></div>
        </section>

        <section id="summit" className="mk-section mk-summit">
          <div className="mk-shell">
            <h2 className="mk-title">{summit.title}</h2>
            <p className="mk-lead">{summit.lead}</p>
            <SampleReport />
            <p><a className="mk-link" href="/reports">{summit.link}</a></p>
          </div>
        </section>

        <section id="start" className="mk-section mk-start">
          <div className="mk-shell"><h2 className="mk-title">{start.title}</h2><p className="mk-lead">{start.lead}</p><Doors /></div>
        </section>
      </div>
    </MarketingShell>
  );
}
```

The modes test expects four `role="img"` elements: the four unrecorded slots render `.mk-clip-still` with `role="img"`. `SampleReport` contains no images, so the count stays four.

- [ ] **Step 6: Write `HomePage.css`.** Structural contract below; spacing and the fine values come from the approved `01-home.html` / `01m-home-mobile.html`:

```css
.mk-home { position: relative; }
.mk-home-scene { position: fixed; inset: 0; z-index: 0; }
.mk-home > section { position: relative; z-index: 1; }
.mk-hero { min-height: 92vh; display: flex; align-items: flex-start; padding-top: 12vh; }
.mk-hero-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 48px; align-items: end; width: 100%; }
.mk-hero-copy { display: grid; gap: 20px; max-width: 60ch; }
.mk-hero-join { padding: 20px; background: rgba(27, 41, 66, 0.82); border: 1px solid var(--mk-hair); border-radius: 14px; }
.mk-problem, .mk-material, .mk-room, .mk-start { background: rgba(15, 26, 46, 0.9); }
.mk-modes, .mk-summit { background: rgba(27, 41, 66, 0.92); }
.mk-problem-list, .mk-material-list { list-style: none; padding: 0; display: grid; gap: 16px; margin-top: 32px; }
.mk-mode { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 40px; align-items: center; margin: 48px 0; }
.mk-mode-clips { display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 20px; align-items: end; }
.mk-material-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
.mk-summit .mk-report { margin-top: 40px; }
@media (max-width: 720px) {
  .mk-hero-grid, .mk-mode, .mk-material-grid, .mk-mode-clips { grid-template-columns: minmax(0, 1fr); }
  .mk-hero { min-height: 0; padding-top: 48px; padding-bottom: 48px; }
}
```

- [ ] **Step 7: Run** — `npx jest src/__tests__/homePage.test.jsx src/__tests__/scopedClassesDeclared.test.js` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/src/marketing/HomePage.* src/src/marketing/content/home.js src/src/marketing/content/sampleReport.js src/src/marketing/components/SampleReport.* src/src/__tests__/homePage.test.jsx
git commit -m "The marketing home: the climb from a meeting that loses ideas to a report that kept them, with the join field still in the hero"
```

---

### Task 8: Routing — `RootGate`, `/join`, lazy marketing routes

**Files:**
- Modify: `src/src/App.jsx` (imports at 1–14; `RootGate` at 165–181; router before the `/admin` branch at 269)
- Modify: `src/src/__tests__/rootGate.test.jsx`
- Create: `src/src/__tests__/marketingRoutes.test.jsx`

Pages from Tasks 9–11 do not exist yet. This task routes `/` and `/join` only; Tasks 9–11 each add their own branch and their own route test.

**Interfaces:**
- Produces: in `App.jsx`, a `MarketingRoute` helper — `<MarketingRoute page={LazyComponent} />` — that later tasks reuse.

- [ ] **Step 1: Update `rootGate.test.jsx`.** Replace the `RootPage` mock line with both mocks:

```jsx
jest.mock('../components/RootPage', () => () => <div data-testid="root-page" />);
jest.mock('../marketing/HomePage', () => () => <div data-testid="home-page" />);
```

Rewrite the first test and adjust the others that query `root-page` (lazy pages resolve asynchronously, so use `findBy`):

```jsx
  test('a signed-out arrival gets the marketing home, not a sign-in wall', async () => {
    render(<App />);
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });

  test('a signed-in host still goes straight to their host page', () => {
    mockAuthValue = { currentUser: signedInHost, loading: false, signOut: jest.fn() };
    render(<App />);
    expect(screen.getByTestId('game-host-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });
```

In "while auth is still resolving" and "an unrecognised path", replace `root-page` with `home-page`.

- [ ] **Step 2: Write `marketingRoutes.test.jsx`**

```jsx
// src/src/__tests__/marketingRoutes.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';

let mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() };
jest.mock('../auth/AuthContext', () => {
  const R = require('react');
  const Ctx = R.createContext(null);
  return { __esModule: true, AuthProvider: ({ children }) => R.createElement(Ctx.Provider, { value: mockAuthValue }, children), useAuth: () => R.useContext(Ctx) };
});
jest.mock('../GameHostPage', () => () => <div data-testid="game-host-page" />);
jest.mock('../PlayerPage', () => () => <div data-testid="player-page" />);
jest.mock('../AdminPage', () => () => <div data-testid="admin-page" />);
jest.mock('../BuilderPage', () => () => <div data-testid="builder-page" />);
jest.mock('../HostRemote', () => () => <div data-testid="host-remote" />);
jest.mock('../WordCloudTest', () => () => <div data-testid="wordcloud" />);
jest.mock('../auth/AuthPage', () => () => <div data-testid="auth-page" />);
jest.mock('../components/RootPage', () => () => <div data-testid="root-page" />);
jest.mock('../marketing/HomePage', () => () => <div data-testid="home-page" />);

import App from '../App';

const goTo = (p) => window.history.pushState({}, '', p);
beforeEach(() => { mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() }; });
afterEach(() => goTo('/'));

// Tasks 9–11 append their rows here.
const PUBLIC = [
  ['/join', 'root-page'],
];

test.each(PUBLIC)('%s is public: a signed-out visitor gets the page, not the sign-in form', async (path, testId) => {
  // rejects: forgetting the branch, which drops the path through to the
  // protected catch-all and shows a prospect a login wall
  goTo(path);
  render(<App />);
  expect(await screen.findByTestId(testId)).toBeInTheDocument();
  expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
});

test('/join is the join page even for a signed-in host', async () => {
  // a host helping someone join should see the same screen they do
  mockAuthValue = { currentUser: { groups: ['hosts'] }, loading: false, signOut: jest.fn() };
  goTo('/join');
  render(<App />);
  expect(await screen.findByTestId('root-page')).toBeInTheDocument();
});

test('/joining is not /join', () => {
  // rejects: startsWith('/join'), which would swallow any future path
  goTo('/joining');
  render(<App />);
  expect(screen.queryByTestId('root-page')).not.toBeInTheDocument();
  expect(screen.getByTestId('auth-page')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to see both fail** — `npx jest src/__tests__/rootGate.test.jsx src/__tests__/marketingRoutes.test.jsx` → FAIL (`home-page` not found; `/join` renders `auth-page`).

- [ ] **Step 4: Edit `App.jsx`.** Change the React import and add the lazy page after the existing imports:

```jsx
import React, { Suspense, lazy } from 'react';
```
```jsx
// Marketing is lazy so that a player on /play and a host on the stage never
// download a brochure. One chunk per page; AuthLoading is the fallback.
const HomePage = lazy(() => import('./marketing/HomePage'));
```

Add below `AuthLoading`:

```jsx
function MarketingRoute({ page: Page }) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Page />
    </Suspense>
  );
}
```

In `RootGate`, update the comment table row `signed out | the marketing home, with the join field in its hero` and replace `return <RootPage />;` with:

```jsx
    return <MarketingRoute page={HomePage} />;
```

In `AppRouter`, immediately **before** the `/admin` comment block, add:

```jsx
  // The focused join page. `/` used to be this; it is now the marketing home
  // with a compact join field, and this stays as the page to send a room to.
  // Exact match, like `/` below.
  if (path === '/join') {
    return <RootPage />;
  }
```

- [ ] **Step 5: Run the routing suites and everything that mounts `App`**

Run: `npx jest src/__tests__/rootGate.test.jsx src/__tests__/marketingRoutes.test.jsx src/__tests__/App.test.jsx src/__tests__/adminRouteAccess.test.jsx src/__tests__/oauthCallbackRoute.test.jsx src/__tests__/authSurfaces.test.jsx`
Expected: PASS. If `App.test.jsx` or another suite asserted the join page at `/`, update that assertion to the home page the same way as Step 1 and say so in the commit.

- [ ] **Step 6: Look at it.** Start the frontend with the project's `preview_start` dev-server config, open `/` signed out, and check in the browser: hero legible over the scene, the climber moves as you scroll, the hero join field accepts a code, `/join` shows the old page, console is clean. Screenshot desktop and the 390px mobile preset for the owner.

- [ ] **Step 7: Commit**

```bash
git add src/src/App.jsx src/src/__tests__/rootGate.test.jsx src/src/__tests__/marketingRoutes.test.jsx
git commit -m "A signed-out visitor to / gets the marketing home, the focused join page moves to /join, and marketing loads in its own chunk"
```

---

### Task 9: `/how-it-works` and `/use-cases`

**Files:**
- Create: `src/src/marketing/content/howItWorks.js`, `HowItWorksPage.jsx`/`.css`, `content/useCases.js`, `UseCasesPage.jsx`/`.css`
- Modify: `src/src/App.jsx`, `src/src/__tests__/marketingRoutes.test.jsx`
- Test: `src/src/__tests__/marketingPages.test.jsx`

**Interfaces:**
- Consumes: `MarketingShell`, `goToAuth`, `ClipFrame`, `CLIPS`, `MarketingRoute`.
- Produces: `HOW_STEPS` — array of `{ n, title, text, slot }`; `USE_CASES` — array of `{ id, title, before, after, setType }`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/src/__tests__/marketingPages.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import HowItWorksPage from '../marketing/HowItWorksPage';
import UseCasesPage from '../marketing/UseCasesPage';
import { HOW_STEPS } from '../marketing/content/howItWorks';
import { USE_CASES } from '../marketing/content/useCases';
import { CLIPS } from '../marketing/content/clips';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

test('the tour is six steps, in the order a session actually runs', () => {
  expect(HOW_STEPS.map((s) => s.title)).toEqual(['Create', 'Join', 'Ask', 'Vote', 'Results', 'Report']);
  expect(HOW_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('every step points at a clip slot that exists', () => {
  for (const step of HOW_STEPS) expect(CLIPS[step.slot]).toBeDefined();
});

test('the tour tells the truth about trivia: it has no vote', () => {
  // config/gameTypes.js: GAME_TYPES.trivia.phases is ['ASK','RESULTS']
  render(<HowItWorksPage />);
  expect(screen.getByText(/trivia skips this step/i)).toBeInTheDocument();
});

test('the tour renders one h1 and six numbered steps', () => {
  render(<HowItWorksPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('mk-step'))).toHaveLength(6);
});

test('four use cases, each naming the kind of set it runs on and ending at a door', () => {
  expect(USE_CASES).toHaveLength(4);
  render(<UseCasesPage />);
  for (const c of USE_CASES) expect(screen.getByRole('heading', { name: c.title })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /create a host account/i }).length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run to see it fail** — `npx jest src/__tests__/marketingPages.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the content**

```js
// src/src/marketing/content/howItWorks.js
export const HOW_STEPS = [
  { n: 1, title: 'Create', slot: 'builder', text: 'Pick a question set — your own, your organisation’s, or one from the public library — or draft a new one from your material. Name the session and choose how it displays: a room projector, a TV, a video call or a table.' },
  { n: 2, title: 'Join', slot: 'join-qr', text: 'The lobby shows a QR code and a four-digit code. Players scan or type it on their phone. No account, no app, and names appear on screen as people arrive.' },
  { n: 3, title: 'Ask', slot: 'poll-player', text: 'You put a question on the screen and everyone answers at once from their phone. In trivia they pick a choice; in call and answer they write an idea in their own words.' },
  { n: 4, title: 'Vote', slot: 'poll-host', text: 'In call and answer the room votes on everything that came back, so the strongest ideas rise on their merits rather than on who said them. Trivia skips this step — it has a right answer.' },
  { n: 5, title: 'Results', slot: 'trivia-host', text: 'Reveal the results when the room is ready: the correct answer and standings for trivia; the vote breakdown and a summary with discussion questions for call and answer.' },
  { n: 6, title: 'Report', slot: 'report', text: 'When the session ends, the report has every answer, vote and comment, the summaries and next steps, and the final standings. Export a PDF or share a link.' },
];

export const HOW_NOTES = [
  { title: 'Run it from your phone', text: 'A remote control page lets you advance the session while you walk the room.' },
  { title: 'Names or no names', text: 'Hide player names for a session when candour matters more than credit.' },
];
```

```js
// src/src/marketing/content/useCases.js
export const USE_CASES = [
  { id: 'offsite', title: 'Strategy offsite', setType: 'Call and answer, built from your strategy paper',
    before: 'Two days, forty slides, and the same five voices.',
    after: 'Each strategic question goes to the whole room at once. The vote shows where conviction is, and the report is the offsite’s minutes.' },
  { id: 'retro', title: 'Retrospective', setType: 'Call and answer, with names hidden',
    before: 'Sticky notes, then a debate about the three that the loudest person wrote.',
    after: 'Everyone answers the same prompts anonymously. The summary groups what came back; the next steps go straight into the plan.' },
  { id: 'decision', title: 'Decision workshop', setType: 'Call and answer, one prompt per option',
    before: 'A decision made in the meeting and re-opened in the corridor.',
    after: 'Objections and conditions are written down by the people who hold them, voted on, and kept — so the decision has a record.' },
  { id: 'warmup', title: 'Team trivia warm-up', setType: 'Trivia, drafted from the pre-read',
    before: 'An icebreaker nobody asked for.',
    after: 'Ten minutes of scored questions from the material everyone was meant to read. The room is awake and on the same page.' },
];
```

- [ ] **Step 4: Write the pages**

```jsx
// src/src/marketing/HowItWorksPage.jsx
import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import ClipFrame from './components/ClipFrame';
import { HOW_STEPS, HOW_NOTES } from './content/howItWorks';
import './HowItWorksPage.css';

export default function HowItWorksPage() {
  return (
    <MarketingShell title="How it works" current="how">
      <div className="mk-shell mk-how">
        <header className="mk-page-head">
          <p className="mk-kicker">How it works</p>
          <h1 className="mk-title">A session, start to finish.</h1>
          <p className="mk-lead">Six steps. The first takes you a few minutes; the rest take the room wherever your questions lead.</p>
        </header>
        <ol className="mk-steps">
          {HOW_STEPS.map((step) => (
            <li key={step.n} className="mk-step">
              <div className="mk-step-copy">
                <span className="mk-step-n" aria-hidden="true">{step.n}</span>
                <h2 className="mk-head">{step.title}</h2>
                <p>{step.text}</p>
              </div>
              <ClipFrame slot={step.slot} />
            </li>
          ))}
        </ol>
        <ul className="mk-how-notes">
          {HOW_NOTES.map((n) => <li key={n.title}><strong>{n.title}.</strong> <span className="mk-muted">{n.text}</span></li>)}
        </ul>
        <div className="mk-cta">
          <a className="mk-btn mk-btn-primary" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
          <a className="mk-btn mk-btn-quiet" href="/use-cases">See who uses it</a>
        </div>
      </div>
    </MarketingShell>
  );
}
```

```jsx
// src/src/marketing/UseCasesPage.jsx
import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import { USE_CASES } from './content/useCases';
import './UseCasesPage.css';

const Door = () => (
  <a className="mk-btn mk-btn-primary" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
);

export default function UseCasesPage() {
  return (
    <MarketingShell title="Use cases" current="cases">
      <div className="mk-shell mk-cases">
        <header className="mk-page-head">
          <p className="mk-kicker">Use cases</p>
          <h1 className="mk-title">For the meetings that are supposed to decide something.</h1>
          <div className="mk-cta"><Door /></div>
        </header>
        {USE_CASES.map((c) => (
          <section key={c.id} className="mk-case" aria-labelledby={`mk-case-${c.id}`}>
            <h2 id={`mk-case-${c.id}`} className="mk-head">{c.title}</h2>
            <dl className="mk-case-grid">
              <div><dt className="mk-kicker">Before</dt><dd>{c.before}</dd></div>
              <div><dt className="mk-kicker">With a session</dt><dd>{c.after}</dd></div>
            </dl>
            <p className="mk-case-set mk-muted">Runs on: {c.setType}</p>
          </section>
        ))}
        <div className="mk-cta"><Door /><a className="mk-btn mk-btn-quiet" href="/how-it-works">See how a session runs</a></div>
      </div>
    </MarketingShell>
  );
}
```

`.mk-page-head` is shared by four pages: declare it once in `MarketingShell.css` (`.mk-page-head { padding: 72px 0 40px; display: grid; gap: 16px; max-width: 60ch; }`), not in each page sheet.

```css
/* src/src/marketing/HowItWorksPage.css */
.mk-steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 72px; }
.mk-step { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 48px; align-items: center; }
.mk-step:nth-child(even) .mk-step-copy { order: 2; }
.mk-step-n { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--mk-amber); color: var(--mk-amber); font-size: var(--mk-t-label); margin-bottom: 12px; }
.mk-how-notes { list-style: none; padding: 0; margin: 72px 0 40px; display: grid; gap: 12px; }
.mk-how { padding-bottom: 96px; }
@media (max-width: 720px) { .mk-step { grid-template-columns: minmax(0, 1fr); gap: 20px; } .mk-step:nth-child(even) .mk-step-copy { order: 0; } }
```

```css
/* src/src/marketing/UseCasesPage.css */
.mk-cases { padding-bottom: 96px; }
.mk-case { padding: 40px 0; border-top: 1px solid var(--mk-hair); }
.mk-case-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin: 20px 0 12px; }
.mk-case-grid dd { margin: 6px 0 0; }
.mk-case-set { font-size: var(--mk-t-label); margin: 0; }
@media (max-width: 720px) { .mk-case-grid { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 5: Route them.** In `App.jsx` add beside `HomePage`:

```jsx
const HowItWorksPage = lazy(() => import('./marketing/HowItWorksPage'));
const UseCasesPage = lazy(() => import('./marketing/UseCasesPage'));
```
and beside the `/join` branch:
```jsx
  if (path === '/how-it-works') return <MarketingRoute page={HowItWorksPage} />;
  if (path === '/use-cases') return <MarketingRoute page={UseCasesPage} />;
```
In `marketingRoutes.test.jsx` add the mocks
```jsx
jest.mock('../marketing/HowItWorksPage', () => () => <div data-testid="how-page" />);
jest.mock('../marketing/UseCasesPage', () => () => <div data-testid="cases-page" />);
```
and the rows `['/how-it-works', 'how-page'], ['/use-cases', 'cases-page'],` to `PUBLIC`.

- [ ] **Step 6: Run** — `npx jest src/__tests__/marketingPages.test.jsx src/__tests__/marketingRoutes.test.jsx src/__tests__/scopedClassesDeclared.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/marketing src/src/App.jsx src/src/__tests__/marketingPages.test.jsx src/src/__tests__/marketingRoutes.test.jsx
git commit -m "The six-step tour and four facilitator use cases, public and routed, with the tour honest that trivia has no vote"
```

---

### Task 10: `/reports`

**Files:**
- Create: `src/src/marketing/content/reports.js`, `src/src/marketing/ReportsPage.jsx`/`.css`
- Modify: `src/src/App.jsx`, `src/src/__tests__/marketingRoutes.test.jsx`, `src/src/__tests__/marketingPages.test.jsx`

**Interfaces:**
- Consumes: `SampleReport` with `callouts` (Task 7).
- Produces: `REPORT_CALLOUTS` — six `{ n, title, text }`, numbered to match `SampleReport`'s marks 1–6.

- [ ] **Step 1: Add the failing tests** to `marketingPages.test.jsx`:

```jsx
import ReportsPage from '../marketing/ReportsPage';
import { REPORT_CALLOUTS } from '../marketing/content/reports';

test('six callouts, numbered to match the marks on the sheet', () => {
  expect(REPORT_CALLOUTS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
  const { container } = render(<ReportsPage />);
  expect(container.querySelectorAll('.mk-report-mark')).toHaveLength(6);
});

test('the sheet is labelled as a sample, because it is one', () => {
  render(<ReportsPage />);
  expect(screen.getByRole('article', { name: /sample session report/i })).toBeInTheDocument();
  expect(screen.getByText(/invented session/i)).toBeInTheDocument();
});

test('export and sharing say only what exists: PDF, print, a saved link', () => {
  render(<ReportsPage />);
  expect(screen.getByText(/PDF/)).toBeInTheDocument();
  expect(screen.getByText(/temporary or permanent/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to see them fail** — `npx jest src/__tests__/marketingPages.test.jsx` → FAIL, module not found.

- [ ] **Step 3: Write the content and page**

```js
// src/src/marketing/content/reports.js
export const REPORT_CALLOUTS = [
  { n: 1, title: 'Every question, as it was asked', text: 'Each round appears with the prompt the room saw.' },
  { n: 2, title: 'Every answer, and how it was voted', text: 'All answers are kept, not just the winners, with the votes each one received.' },
  { n: 3, title: 'Comments', text: 'What people added during a round is kept with that round.' },
  { n: 4, title: 'A summary of each question', text: 'What the room converged on, written from the answers and the votes, with questions worth discussing next.' },
  { n: 5, title: 'Next steps', text: 'Suggested actions drawn from what the room said — a starting point for your own.' },
  { n: 6, title: 'Standings', text: 'Final scores and the podium, for sessions that kept score.' },
];

export const REPORT_SHARING = [
  { title: 'Export a PDF', text: 'One click produces a PDF named for the event and date. It also prints cleanly from the browser.' },
  { title: 'Share a link', text: 'Save the report and copy a link to it. You choose whether the saved copy is temporary or permanent.' },
  { title: 'Names, or not', text: 'If you hid player names for the session, the report hides them too.' },
];
```

```jsx
// src/src/marketing/ReportsPage.jsx
import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import SampleReport from './components/SampleReport';
import { REPORT_CALLOUTS, REPORT_SHARING } from './content/reports';
import './ReportsPage.css';

export default function ReportsPage() {
  return (
    <MarketingShell title="Reports" current="reports">
      <div className="mk-shell mk-reports">
        <header className="mk-page-head">
          <p className="mk-kicker">Reports</p>
          <h1 className="mk-title">What was said, what was chosen, what happens next.</h1>
          <p className="mk-lead">The report is written by the session itself. Nobody takes notes.</p>
        </header>
        <div className="mk-reports-grid">
          <div>
            <SampleReport callouts />
            <p className="mk-reports-note mk-muted">A sample from an invented session, to show the shape of a real one.</p>
          </div>
          <ol className="mk-callouts">
            {REPORT_CALLOUTS.map((c) => (
              <li key={c.n} className="mk-callout"><span className="mk-callout-n" aria-hidden="true">{c.n}</span><div><h2 className="mk-callout-title">{c.title}</h2><p className="mk-muted">{c.text}</p></div></li>
            ))}
          </ol>
        </div>
        <ul className="mk-sharing">
          {REPORT_SHARING.map((s) => <li key={s.title}><h2 className="mk-head">{s.title}</h2><p className="mk-muted">{s.text}</p></li>)}
        </ul>
        <div className="mk-cta">
          <a className="mk-btn mk-btn-primary" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
        </div>
      </div>
    </MarketingShell>
  );
}
```

```css
/* src/src/marketing/ReportsPage.css */
.mk-reports { padding-bottom: 96px; }
.mk-reports-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 48px; align-items: start; }
.mk-reports-note { font-size: var(--mk-t-label); text-align: center; margin-top: 12px; }
.mk-callouts { list-style: none; padding: 0; margin: 0; display: grid; gap: 22px; position: sticky; top: 96px; }
.mk-callout { display: grid; grid-template-columns: 28px 1fr; gap: 12px; }
.mk-callout-n { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--mk-text); color: var(--mk-bg); font-size: var(--mk-t-floor); }
.mk-callout-title { font-size: var(--mk-t-body); margin: 0 0 4px; }
.mk-sharing { list-style: none; padding: 0; margin: 80px 0 40px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px; }
@media (max-width: 720px) { .mk-reports-grid, .mk-sharing { grid-template-columns: minmax(0, 1fr); } .mk-callouts { position: static; } }
```

- [ ] **Step 4: Route it** — in `App.jsx`: `const ReportsPage = lazy(() => import('./marketing/ReportsPage'));` and `if (path === '/reports') return <MarketingRoute page={ReportsPage} />;`. In `marketingRoutes.test.jsx` add `jest.mock('../marketing/ReportsPage', () => () => <div data-testid="reports-page" />);` and the row `['/reports', 'reports-page'],`.

- [ ] **Step 5: Run** — `npx jest src/__tests__/marketingPages.test.jsx src/__tests__/marketingRoutes.test.jsx src/__tests__/scopedClassesDeclared.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/marketing src/src/App.jsx src/src/__tests__/marketingPages.test.jsx src/src/__tests__/marketingRoutes.test.jsx
git commit -m "A reports page that annotates a sample sheet, says it is a sample, and claims only the export and sharing that exist"
```

---

### Task 11: `/help` as a real URL

**Files:**
- Create: `src/src/marketing/HelpPage.jsx`, `src/src/marketing/HelpPage.css`
- Modify: `src/src/App.jsx`, `src/src/__tests__/marketingRoutes.test.jsx`
- Test: `src/src/__tests__/helpPage.test.jsx`

**Interfaces:**
- Consumes: from `config/help/index.js` — `HELP_ROLES` (each `{ id, guides: [{ id, title, summary }] , … }`), `ROLE_BY_ID`, `GUIDE_BY_ID`, `ROLE_ID_BY_GUIDE_ID`, `resolveHelpTarget(id) → { kind: 'home'|'role'|'guide', id }`; `DocRenderer` (`<DocRenderer guide={guide} />`).
- Produces: `helpTargetFromPath(pathname) → { kind, id }` (named export) and `helpHref(target) → string`.

The modal `HelpSystem`, every `HelpButton`, and the three existing help suites are not touched.

- [ ] **Step 1: Check the role shape.** Open `src/src/config/help/player.js` and confirm the display-name field on a role object (expected `title`; if it is `name` or `label`, use that field everywhere this task writes `role.title`).

- [ ] **Step 2: Write the failing test**

```jsx
// src/src/__tests__/helpPage.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import HelpPage, { helpTargetFromPath, helpHref } from '../marketing/HelpPage';
import { HELP_ROLES, HELP_ALIASES, ROLE_ID_BY_GUIDE_ID } from '../config/help';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const goTo = (p) => window.history.pushState({}, '', p);
afterEach(() => goTo('/'));

const role = HELP_ROLES[0];
const guide = role.guides[0];

test('the path resolves through the same resolver the modal uses', () => {
  expect(helpTargetFromPath('/help')).toEqual({ kind: 'home', id: 'home' });
  expect(helpTargetFromPath('/help/')).toEqual({ kind: 'home', id: 'home' });
  expect(helpTargetFromPath(`/help/${role.id}`)).toEqual({ kind: 'role', id: role.id });
  expect(helpTargetFromPath(`/help/${role.id}/${guide.id}`)).toEqual({ kind: 'guide', id: guide.id });
  expect(helpTargetFromPath(`/help/${guide.id}`)).toEqual({ kind: 'guide', id: guide.id });
});

test('an alias in a URL lands on the guide it names', () => {
  const [alias, real] = Object.entries(HELP_ALIASES)[0];
  expect(helpTargetFromPath(`/help/${alias}`)).toEqual({ kind: 'guide', id: real });
});

test('a link nobody recognises goes home, never to a blank page', () => {
  expect(helpTargetFromPath('/help/admin/not-a-guide')).toEqual({ kind: 'role', id: 'admin' });
  expect(helpTargetFromPath('/help/nonsense/also-nonsense')).toEqual({ kind: 'home', id: 'home' });
});

test('hrefs are canonical: /help/<role>/<guide>', () => {
  expect(helpHref({ kind: 'home', id: 'home' })).toBe('/help');
  expect(helpHref({ kind: 'role', id: role.id })).toBe(`/help/${role.id}`);
  expect(helpHref({ kind: 'guide', id: guide.id })).toBe(`/help/${ROLE_ID_BY_GUIDE_ID[guide.id]}/${guide.id}`);
});

test('home lists every role, and every guide is a real link', () => {
  goTo('/help');
  render(<HelpPage />);
  const total = HELP_ROLES.reduce((n, r) => n + r.guides.length, 0);
  const guideLinks = screen.getAllByRole('link').filter((a) => /^\/help\/[^/]+\/[^/]+$/.test(a.getAttribute('href')));
  expect(guideLinks).toHaveLength(total);
});

test('a guide URL renders that guide, with its title as the h1', () => {
  goTo(`/help/${role.id}/${guide.id}`);
  render(<HelpPage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(guide.title);
  expect(document.title).toBe(`${guide.title} · Engagements`);
});
```

- [ ] **Step 3: Run to see it fail** — `npx jest src/__tests__/helpPage.test.jsx` → FAIL, module not found.

- [ ] **Step 4: Write the page**

```jsx
// src/src/marketing/HelpPage.jsx
import React from 'react';
import MarketingShell from './MarketingShell';
import DocRenderer from '../components/documentation/DocRenderer';
import { HELP_ROLES, ROLE_BY_ID, GUIDE_BY_ID, ROLE_ID_BY_GUIDE_ID, resolveHelpTarget } from '../config/help';
import './HelpPage.css';

/**
 * THE HELP CORPUS AT A URL. The modal (HelpSystem) stays exactly as it is;
 * this is a second reader of the same data, so a guide can be linked from a
 * marketing page or an email. Resolution is the modal's own resolver, walked
 * from the most specific path segment outward, so an alias or a bare guide id
 * works and a wrong link degrades to the nearest real place.
 */
export function helpTargetFromPath(pathname) {
  const segments = String(pathname || '').replace(/^\/help\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const target = resolveHelpTarget(segments[i]);
    if (target.kind !== 'home') return target;
  }
  return { kind: 'home', id: 'home' };
}

export function helpHref(target) {
  if (target.kind === 'guide') return `/help/${ROLE_ID_BY_GUIDE_ID[target.id]}/${target.id}`;
  if (target.kind === 'role') return `/help/${target.id}`;
  return '/help';
}

function Sidebar({ activeGuide }) {
  return (
    <nav className="mk-help-side" aria-label="Guides">
      {HELP_ROLES.map((role) => (
        <div key={role.id} className="mk-help-group">
          <a className="mk-help-role" href={helpHref({ kind: 'role', id: role.id })}>{role.title}</a>
          <ul className="mk-help-guides">
            {role.guides.map((g) => (
              <li key={g.id}><a className="mk-help-guide" href={helpHref({ kind: 'guide', id: g.id })} aria-current={g.id === activeGuide ? 'page' : undefined}>{g.title}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function HelpPage() {
  const target = helpTargetFromPath(window.location.pathname);
  const guide = target.kind === 'guide' ? GUIDE_BY_ID[target.id] : null;
  const role = target.kind === 'role' ? ROLE_BY_ID[target.id] : null;
  const title = guide ? guide.title : role ? `${role.title} help` : 'Help';

  return (
    <MarketingShell title={title} current="help">
      <div className="mk-shell mk-help">
        <Sidebar activeGuide={guide ? guide.id : null} />
        <article className="mk-help-body">
          {guide && (<><h1 className="mk-title">{guide.title}</h1><p className="mk-lead">{guide.summary}</p><div className="mk-help-doc"><DocRenderer guide={guide} /></div></>)}
          {role && (<><h1 className="mk-title">{role.title} help</h1><ul className="mk-help-index">{role.guides.map((g) => <li key={g.id}><a className="mk-link" href={helpHref({ kind: 'guide', id: g.id })}>{g.title}</a><p className="mk-muted">{g.summary}</p></li>)}</ul></>)}
          {!guide && !role && (<><h1 className="mk-title">Help</h1><p className="mk-lead">Guides for players, hosts, administrators and set builders. Pick one from the list.</p></>)}
        </article>
      </div>
    </MarketingShell>
  );
}
```

Note on the "every guide is a real link" test: on the home view the guide links come from the sidebar only, so the count equals the corpus total. On a role view the index adds duplicates — the test deliberately runs at `/help`.

```css
/* src/src/marketing/HelpPage.css */
.mk-help { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 48px; padding-top: 56px; padding-bottom: 96px; }
.mk-help-side { display: grid; gap: 24px; align-content: start; position: sticky; top: 96px; max-height: calc(100vh - 120px); overflow-y: auto; }
.mk-help-role { color: var(--mk-text); font-weight: 600; text-decoration: none; }
.mk-help-guides { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.mk-help-guide { color: var(--mk-muted); text-decoration: none; font-size: var(--mk-t-label); }
.mk-help-guide[aria-current="page"], .mk-help-guide:hover { color: var(--mk-amber); }
.mk-help-index { list-style: none; padding: 0; display: grid; gap: 20px; margin-top: 32px; }
.mk-help-doc { margin-top: 32px; max-width: 72ch; }
@media (max-width: 720px) { .mk-help { grid-template-columns: minmax(0, 1fr); } .mk-help-side { position: static; max-height: none; } }
```

- [ ] **Step 5: Check `DocRenderer` reads on dusk.** `documentation.css` was written for the modal. Open `/help/<role>/<guide>` in the dev preview for one guide of each role and check the note boxes, tables and code blocks against `--mk-bg`. If a block is unreadable, fix it with a rule scoped under `.mk-help-doc` in `HelpPage.css` — do not edit `documentation.css`, which the modal and `helpEntryPoints.test.jsx` depend on. Record each override with a one-line comment naming the block.

- [ ] **Step 6: Route it** — in `App.jsx`: `const HelpPage = lazy(() => import('./marketing/HelpPage'));` and

```jsx
  // Exact or a sub-path -- never startsWith('/help'), which would also claim
  // a future /helpers.
  if (path === '/help' || path.startsWith('/help/')) return <MarketingRoute page={HelpPage} />;
```
In `marketingRoutes.test.jsx`: `jest.mock('../marketing/HelpPage', () => () => <div data-testid="help-page" />);` and rows `['/help', 'help-page'], ['/help/host/host-quick-start', 'help-page'],`.

- [ ] **Step 7: Run** — `npx jest src/__tests__/helpPage.test.jsx src/__tests__/marketingRoutes.test.jsx src/__tests__/helpContent.test.js src/__tests__/helpSystem.test.jsx src/__tests__/helpEntryPoints.test.jsx` → PASS, the three existing help suites unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/src/marketing/HelpPage.* src/src/App.jsx src/src/__tests__/helpPage.test.jsx src/src/__tests__/marketingRoutes.test.jsx
git commit -m "Help has a URL: the same corpus and the same resolver as the modal, linkable per guide, and a wrong link lands somewhere real"
```

---

### Task 12: Contract suites — palette and copy

**Files:**
- Create: `src/src/__tests__/marketingPalette.test.js`, `src/src/__tests__/marketingCopy.test.js`

**Interfaces:**
- Consumes: every stylesheet and content file from Tasks 3–11.

- [ ] **Step 1: Write the palette suite.** Copy the harness from `.claude/skills/engage-design/references/testing-a-surface.md` §1 (`lin`, `lum`, `ratio`, `alphaOver`, `bgOf`, `parseHex`, `composited`, `on`, `AA`) verbatim into the top of the file, then:

```js
// src/src/__tests__/marketingPalette.test.js
/**
 * Named *Palette*, never *Token*: .gitignore has an unanchored `*token*` and a
 * file matching it runs locally, passes, and never reaches CI.
 *
 * GREEN HERE MEANS the contrast arithmetic and the namespace have not been
 * reverted. It cannot prove the hero headline is legible over the moving
 * scene in a browser — Task 1 Step 5 and Task 8 Step 6 are where that is looked at.
 */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/* …harness from testing-a-surface.md §1, verbatim… */

const GLOBAL_CSS = read('styles.css');
const SHEETS = {
  shell: read('marketing', 'MarketingShell.css'),
  home: read('marketing', 'HomePage.css'),
  how: read('marketing', 'HowItWorksPage.css'),
  cases: read('marketing', 'UseCasesPage.css'),
  reports: read('marketing', 'ReportsPage.css'),
  help: read('marketing', 'HelpPage.css'),
  ridge: read('marketing', 'components', 'RidgeScene.css'),
  clip: read('marketing', 'components', 'ClipFrame.css'),
  device: read('marketing', 'components', 'DeviceFrame.css'),
  report: read('marketing', 'components', 'SampleReport.css'),
};
const JCE = read('components', 'JoinCodeEntry.css');
const ALL = Object.values(SHEETS).join('\n');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const mk = (name) => {
  const m = SHEETS.shell.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in MarketingShell.css`);
  return m[1];
};
const T = {
  bg: mk('--mk-bg'), surface: mk('--mk-surface'), surface2: mk('--mk-surface-2'),
  text: mk('--mk-text'), muted: mk('--mk-muted'), amber: mk('--mk-amber'),
  paper: mk('--mk-paper'), paperSurface: mk('--mk-paper-surface'),
  paperText: mk('--mk-paper-text'), paperMuted: mk('--mk-paper-muted'), amberInk: mk('--mk-amber-ink'),
  ridgeFront: mk('--mk-ridge-front'), ridgeMid: mk('--mk-ridge-mid'), ridgeBack: mk('--mk-ridge-back'),
};

describe('the marketing tokens are the Warm Summit tokens, not a second palette', () => {
  const token = (block, name) => {
    const start = GLOBAL_CSS.indexOf(block);
    return GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('}', start)).match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`))[1];
  };
  test.each([
    ['--mk-bg', T.bg, '[data-theme="dark"] {', '--bg'],
    ['--mk-surface', T.surface, '[data-theme="dark"] {', '--surface'],
    ['--mk-text', T.text, '[data-theme="dark"] {', '--text'],
    ['--mk-muted', T.muted, '[data-theme="dark"] {', '--muted'],
    ['--mk-amber', T.amber, ':root {', '--primary'],
  ])('%s matches the global token', (_n, value, block, name) => {
    expect(value.toUpperCase()).toBe(token(block, name).toUpperCase());
  });
});

describe('every flat pairing these pages paint', () => {
  test.each([
    ['headline and body on the dusk field', T.text, [T.bg]],
    ['lead and muted copy on the dusk field', T.muted, [T.bg]],
    ['copy in the --surface sections (modes, summit)', T.text, [T.bg, T.surface]],
    ['muted copy in the --surface sections', T.muted, [T.bg, T.surface]],
    ['kickers and links in amber on the field', T.amber, [T.bg]],
    ['kickers and links in amber on --surface', T.amber, [T.bg, T.surface]],
    ['the filled primary button', T.bg, [T.amber]],
    ['headline over the front ridge', T.text, [T.ridgeFront]],
    ['headline over the mid ridge', T.text, [T.ridgeMid]],
    ['headline over the back ridge', T.text, [T.ridgeBack]],
    ['report body on the paper sheet', T.paperText, [T.paperSurface]],
    ['report meta on the paper sheet', T.paperMuted, [T.paperSurface]],
    ['report section labels in amber ink on paper', T.amberInk, [T.paperSurface]],
    ['the numbered mark on the sheet', T.paperSurface, [T.paperText]],
    ['the callout number beside the sheet', T.bg, [T.text]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites', () => {
  test('nav copy over the translucent sticky bar, over the brightest thing behind it', () => {
    // .mk-nav is rgba(15,26,46,.86); the brightest layer it can sit over is the back ridge
    expect(on(T.muted, [T.ridgeBack, 'rgba(15, 26, 46, 0.86)'])).toBeGreaterThanOrEqual(AA);
  });
  test('the hero join card over the scene', () => {
    expect(on(T.muted, [T.ridgeBack, 'rgba(27, 41, 66, 0.82)'])).toBeGreaterThanOrEqual(AA);
  });
  test('section washes over the scene', () => {
    expect(on(T.muted, [T.ridgeBack, 'rgba(15, 26, 46, 0.9)'])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.ridgeBack, 'rgba(27, 41, 66, 0.92)'])).toBeGreaterThanOrEqual(AA);
  });
});

test('amber never carries text on paper — that is what --mk-amber-ink is for', () => {
  expect(ratio(parseHex(T.amber), parseHex(T.paperSurface))).toBeLessThan(AA); // the premise
  const reportRules = stripped(SHEETS.report).split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--mk-amber\)/.test(l));
  expect(reportRules).toEqual([]);
});

test('--danger never carries text here', () => {
  const offenders = (ALL + JCE).split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
  expect(offenders).toEqual([]);
});

test('no hex literal survives outside the token block', () => {
  const tokenBlock = /\.mk-root\s*\{[^}]*\}/;
  const body = stripped(ALL).replace(tokenBlock, '');
  const literals = [...body.matchAll(/(?:^|[\s:(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
  expect(literals).toEqual([]);
});

test('every custom property used is declared somewhere', () => {
  const declared = new Set();
  for (const css of [GLOBAL_CSS, ALL, JCE]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
  // set inline from JSX, not from a stylesheet
  declared.add('--mk-share');
  const used = [...(ALL + JCE).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
});

describe('the namespace, both ways', () => {
  const roots = (css) => {
    const out = new Set();
    for (const blk of stripped(css).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) { const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/); if (m) out.add(m[1]); }
    }
    return [...out];
  };
  test('every marketing selector is rooted at mk-', () => expect(roots(ALL).filter((n) => !n.startsWith('mk-'))).toEqual([]));
  test('every join-entry selector is rooted at jce', () => expect(roots(JCE).filter((n) => !n.startsWith('jce'))).toEqual([]));
  test('styles.css declares nothing in either scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.((?:mk-|jce)[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '17px', lead: '21px', head: '30px', title: '44px', display: '68px' };
  test.each(Object.entries(LADDER))('--mk-t-%s is %s', (step, value) => {
    expect(SHEETS.shell).toMatch(new RegExp(`--mk-t-${step}:\\s*${value}`));
  });
  test('no stylesheet sets a font-size in px — everything goes through the ladder', () => {
    const px = [...stripped(ALL).replace(/\.mk-root\s*\{[^}]*\}/g, '').matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px).toEqual([]);
  });
  test('nothing in the ladder is under 12px, at any width', () => {
    const steps = [...SHEETS.shell.matchAll(/--mk-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(steps.filter((n) => n < 12)).toEqual([]);
  });
});

test('the paper surface converts theme and markup together', () => {
  expect(read('marketing', 'components', 'SampleReport.jsx')).toMatch(/className="mk-report"\s+data-theme="light"/);
});

test('reduced motion stills the scene in CSS as well as in JS', () => {
  expect(SHEETS.ridge).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transform:\s*none/);
});
```

The JCE fallbacks (`var(--mk-text, #F4EDE4)`) are hex literals inside `JoinCodeEntry.css`; that file is deliberately outside the "no hex literal" check because it must render on `/` before and without `.mk-root` being guaranteed. Say so in a comment beside the test.

- [ ] **Step 2: Run the palette suite.** `npx jest src/__tests__/marketingPalette.test.js`. Expected: PASS. **If a contrast row fails, change the token or the wash opacity in the stylesheet and the mockup — never the threshold.** The box-shadow `rgba(0,0,0,…)` values are not text-bearing and contain no hex, so they do not trip the literal check.

- [ ] **Step 3: Write the copy suite**

```js
// src/src/__tests__/marketingCopy.test.js
/**
 * HONESTY PINS. Marketing copy drifts toward the product someone wishes they
 * had. Each rule here names a claim the product cannot back, with where that
 * was established.
 */
import { HOME } from '../marketing/content/home';
import { HOW_STEPS, HOW_NOTES } from '../marketing/content/howItWorks';
import { USE_CASES } from '../marketing/content/useCases';
import { REPORT_CALLOUTS, REPORT_SHARING } from '../marketing/content/reports';
import { CLIPS } from '../marketing/content/clips';

const words = [];
const walk = (v) => { if (typeof v === 'string') words.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
[HOME, HOW_STEPS, HOW_NOTES, USE_CASES, REPORT_CALLOUTS, REPORT_SHARING, CLIPS].forEach(walk);
const COPY = words.join('\n');

test('no "favourites" feature is claimed — the report has votes, not favourites', () => {
  // create-report.js and GameReport.jsx carry no favourite field anywhere
  expect(COPY).not.toMatch(/favou?rite/i);
});

test.each([
  ['real-time translation', /translat/i],
  ['integrations that do not exist', /\b(slack|teams integration|zapier|salesforce|jira)\b/i],
  ['spreadsheet export — the export is PDF', /\b(csv|excel|spreadsheet)\b/i],
  ['a native app — players use a browser', /\b(ios app|android app|app store|download the app)\b/i],
  ['compliance certifications nobody holds', /\b(soc ?2|iso ?27001|hipaa|gdpr.compliant)\b/i],
  ['unlimited anything', /\bunlimited\b/i],
  ['superlatives with no evidence', /\b(best.in.class|world.class|revolutionary|#1)\b/i],
])('no claim of %s', (_label, pattern) => {
  expect(COPY).not.toMatch(pattern);
});

test('AI is described as drafting and summarising, which a person reviews — never as deciding', () => {
  expect(COPY).not.toMatch(/\bAI (decides|chooses|picks|knows)\b/i);
  expect(HOME.material.lead).toMatch(/review/i);
});

test('the banned deploy phrases are not in the copy either', () => {
  expect(COPY).not.toMatch(/deploys nothing|tags only/i);
});

test('players needing no account is claimed — and is true of /play', () => {
  expect(HOME.start.lead).toMatch(/no account/i);
});
```

- [ ] **Step 4: Run** — `npx jest src/__tests__/marketingCopy.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/__tests__/marketingPalette.test.js src/src/__tests__/marketingCopy.test.js
git commit -m "The marketing surface is pinned: composited contrast over the scene and on paper, the namespace, the ladder, and the claims the copy may not make"
```

---

### Task 13: Metadata, dead CSS, `Ridge.jsx`, baselines

**Files:**
- Modify: `src/public/index.html` (line 6 `<title>`)
- Modify: `src/src/styles.css` (dead `.parallax` rules: ~1795–1900, ~407–418, ~2697, ~7746–7747)
- Delete: `src/src/components/Ridge.jsx`
- Create: `src/public/assets/marketing/share.svg`
- Modify: `docs/handoff/` — new `marketing-home-2026-09-20.md`

- [ ] **Step 1: Prove the dead CSS is dead before deleting it**

```bash
cd /Users/georgeseib/Documents/projects/engage2
grep -rn "parallax" src/src --include='*.jsx' --include='*.js' | grep -v __tests__
grep -rn "components/Ridge'\|components/Ridge\"\|from './Ridge'\|from \"./Ridge\"" src/src
```
Expected: the first prints only comments (no `className`); the second prints nothing. If either finds a live reference, stop and report it instead of deleting.

- [ ] **Step 2: Delete** every rule in `styles.css` whose selector contains `.parallax` or `.player-parallax`, including the ones inside media queries (re-find them by grep; the line numbers above drift). Then `git rm src/src/components/Ridge.jsx`. Leave the `--ridge-*` tokens in `styles.css` — `designSystem.test.jsx` may read them; check with `grep -rn "ridge-" src/src/__tests__` and remove them only if nothing does.

- [ ] **Step 3: Metadata.** Replace line 6 of `src/public/index.html` with:

```html
  <title>Engagements — live sessions that turn your team’s material into decisions</title>
  <meta name="description" content="Run trivia and call-and-answer sessions from your own material. Everyone answers from their phone, the room votes, and the report keeps every idea." />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Engagements" />
  <meta property="og:description" content="Live sessions that turn your team’s own material into decisions — with a report that kept everything." />
  <meta property="og:image" content="/assets/marketing/share.svg" />
  <meta name="twitter:card" content="summary_large_image" />
```

`share.svg`: a 1200×630 SVG — `#0F1A2E` field, the three ridge paths from `RidgeScene.jsx` scaled to fit, the low amber glow, and the word "Engagements" in `#F4EDE4`. Add it to `CREDITS.json`'s `files` as `{ "file": "share.svg", "source": "drawn for this project" }`. (Some networks will not render an SVG share image; a PNG export is recorded as follow-up in the handoff rather than blocking this task.)

- [ ] **Step 4: Run the whole frontend baseline**

```bash
cd /Users/georgeseib/Documents/projects/engage2/src
rm -rf ../.aws-sam
npm test 2>&1 | tail -15
npm run lint 2>&1 | tail -5
npm run build 2>&1 | tail -15
```
Expected: exit code 0 on all three **and** a suite count equal to the pre-work count plus the eleven new suites (`useJoinCode`, `joinCodeEntry`, `marketingShell`, `ridgeScene`, `clipFrame`, `homePage`, `marketingRoutes`, `marketingPages`, `helpPage`, `marketingPalette`, `marketingCopy`). Judge by exit code **and** suite count — a suite that fails to load can vanish from the total. In the build output, confirm separate chunks exist for the marketing pages and that the main bundle did not grow by more than the router changes.

- [ ] **Step 5: Run the backend suite and the repo guards** the way the session memory's "running the suites" note describes (`node tests/<file>.js`, judged by exit code), including `tests/no-global-partition-literals.js` and the twin guard. Stage all new files first — untracked files are not scanned.

- [ ] **Step 6: Look at all five pages** in the dev preview at desktop and the mobile preset, signed out: `/`, `/how-it-works`, `/use-cases`, `/reports`, `/help/host/host-quick-start`, plus `/join`. Then signed in: `/` must be the stage. Console clean, no failed requests, no horizontal scroll at 390px. Screenshot each for the owner.

- [ ] **Step 7: Write the handoff** `docs/handoff/marketing-home-2026-09-20.md`: what is built, the file map, the seven empty clip slots and that `content/clips.js` is the only file sub-project 2 edits, the help gaps left for sub-project 3 (organisations, public library, moderation review, question preview, score card, archive snapshots/restore, billing, invites), the PNG share-image follow-up, and that **nothing has been pushed**.

- [ ] **Step 8: Commit**

```bash
git add -A src/public src/src docs/handoff/marketing-home-2026-09-20.md
git commit -m "Page metadata and a share image, the dead parallax CSS and the unmounted Ridge removed, and a handoff naming the clip slots and help gaps still to fill"
```

- [ ] **Step 9: Stop and report.** Tell the owner the commit range, that baselines hold with the numbers, and that nothing is deployed. Pushing `dev` is their call.

---

## Self-review notes

- **Spec coverage:** §4.1 files → Tasks 2–11; §4.2 routing/lazy → Tasks 8–11; §4.3 → Tasks 2–3 (deviation stated above); §4.4 → Task 5 and Task 13 (Ridge removal); §4.5 and the seven slots → Task 6; §5.1–5.5 → Tasks 7, 9, 9, 10, 11; §6 styling and dead CSS → Tasks 4, 12, 13; §7 metadata → Task 13; §8 errors → Task 3 (join 404), Task 6 (missing clip), Task 4 (boundary), Task 11 (unknown help target); §9 tests → each task plus Task 12; §10 order → task order, with the mockup gate in Task 1.
- **Names checked across tasks:** `useJoinCode`/`CODE_LENGTH`/`codeFromUrl`; `goToAuth`; `MarketingRoute`; `CLIPS`; `pointOnRoute`; `prefersReducedMotion`; `SAMPLE_REPORT`; `helpTargetFromPath`/`helpHref`; `.mk-page-head` declared once in the shell sheet.
- **Known soft spot:** Task 11 Step 1 verifies the role display field name before using `role.title`.
