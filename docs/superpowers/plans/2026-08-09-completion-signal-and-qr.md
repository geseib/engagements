# Completion signal and the two QR codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "everyone is in" impossible to miss on the host stage, put the player join QR behind the rail's session code, and turn the host panel's QR into the one that opens the Host Remote on the host's own phone.

**Architecture:** Three independent slices over the existing stage shell. The completion state is a pure predicate consumed by two already-styled-but-unwired CSS rules. The join QR reuses the `expanded-qr-overlay` that already exists, driven by a three-valued mode so a hover can never suppress the SPACE shortcut. The remote QR is a URL change plus an auth return-path fix, without which scanning it lands the host's phone on a second host page.

**Tech Stack:** React 18 (no client-side router — `App.jsx` is a `window.location.pathname` switch), plain CSS in `src/src/styles/stage.css` and `src/src/styles.css`, Jest + React Testing Library, `qrcode.react`.

**Spec:** `docs/superpowers/specs/2026-08-09-host-completion-signal-design.md`. §3's "the side panel's click-to-expand stays exactly as it is" is **superseded by Task 3** — the panel's QR changes target. Update the spec in Task 3's commit.

## Global Constraints

- **Never deploy.** No `./deployall`, no `./scripts/deploy-*.sh`. The pipeline is the only route to any tier, and pushing is the owner's call. Commit locally; do not push.
- **Backend baseline:** `28 suites, 927 passed, 0 failed`. Aggregate with `grep -E '^[0-9]+ passed'`, never `tail -1`, and assert the suite count — a crashed suite prints no result line and silently vanishes from the total.
- **Frontend baseline:** `5 failed suites / 30 failed / 387 passed`. Those 5 are stale and out of scope (they predate the auth system and call `new WebSocketClient()` on a singleton export). **Do not fix them.** A sixth failing suite is yours.
- **Build baseline:** `cd src && npm run build` compiles with exactly 2 pre-existing size warnings.
- **jsdom has no layout engine.** Every geometric assertion returns zero and passes unconditionally. Do not write one. Where verification needs geometry, it goes in the manual checklist at the end of this plan.
- **For every test, name the implementation it would reject.** If the answer is "none", delete it rather than padding the count.
- **Do not modify** `src/src/__tests__/stageShell.test.jsx`'s two meter tests — "it states progress exactly once" and "it never names anybody". If a change appears to require it, the change is wrong.
- **The rail's `<code>` must never gain a `data-drop` attribute.** The drop order is title (1), the word JOIN (2), the URL (3); the session code is deliberately unsacrificeable because it is what the room needs in order to get in.
- Colour tokens: use `var(--success-text)`, not `var(--success)` — `--success` fails contrast on `--surface`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/src/config/hostControls.js` | add `roomIsComplete()` — the pure completion predicate | 1 |
| `src/src/components/stage/RoomMeter.jsx` | accept `complete`, apply the class | 1 |
| `src/src/components/stage/Dock.jsx` | accept `complete`, apply the already-styled `.go` class | 1 |
| `src/src/styles/stage.css` | `.meter .count.done` + its pulse (the `cue` keyframe already exists) | 1 |
| `src/src/components/stage/Rail.jsx` | make the session code an optional QR trigger | 2 |
| `src/src/GameHostPage.jsx` | own `qrMode`, wire both QRs, feed `complete` | 1,2,3 |
| `src/src/auth/returnPath.js` | **new** — remember/consume a same-origin return path | 3 |
| `src/src/auth/LoginForm.jsx`, `RegisterForm.jsx` | remember the destination before the OAuth redirect | 3 |
| `src/src/auth/OAuthCallback.jsx` | honour it instead of hardcoding `/` | 3 |
| `src/src/__tests__/roomComplete.test.js` | **new** — the predicate | 1 |
| `src/src/__tests__/stageCompletion.test.jsx` | **new** — RoomMeter/Dock class wiring | 1 |
| `src/src/__tests__/railJoinQr.test.jsx` | **new** — the code as a trigger | 2 |
| `src/src/__tests__/authReturnPath.test.js` | **new** — including the open-redirect guard | 3 |

---

### Task 1: The room-is-done signal

Two CSS rules for this already exist and **nothing applies either of them**. `.dock .status.go` in `src/src/styles/stage.css:281-284` carries the success colour, a three-iteration `cue` pulse and a `prefers-reduced-motion` guard — ported and then never wired, exactly as the phase chip once was. `.meter .count.done` exists in the mockup (`docs/design/host-redesign/02-ask-call-and-answer.html:282`) but was not ported at all.

No `useRef` transition-tracking is needed. A CSS animation with a finite iteration count runs when the class is applied and does **not** restart while that class stays applied, so a re-render cannot re-pulse. The class going away and coming back (someone rejoins, the room catches up again) re-pulses, which is correct.

**Files:**
- Modify: `src/src/config/hostControls.js`
- Modify: `src/src/components/stage/RoomMeter.jsx`
- Modify: `src/src/components/stage/Dock.jsx`
- Modify: `src/src/styles/stage.css` (after line 258, the `.meter .count` rule)
- Modify: `src/src/GameHostPage.jsx`
- Test: `src/src/__tests__/roomComplete.test.js`, `src/src/__tests__/stageCompletion.test.jsx`

**Interfaces:**
- Produces: `roomIsComplete({ phase, responded, playerCount }) -> boolean` from `src/src/config/hostControls.js`. `phase` is a `hostPhase` string (`'LOBBY'|'ASK'|'VOTE'|'RESULTS'|'FIELD_NOTES'|'ENDED'`).
- Produces: `<RoomMeter phase heading body complete />` and `<Dock status hint kbd onSetup complete />`.

- [ ] **Step 1: Write the failing predicate test**

Create `src/src/__tests__/roomComplete.test.js`:

```js
/**
 * The predicate behind the green meter.
 *
 * Each case names the wrong implementation it rejects, because a test that
 * rejects nothing is the dominant failure mode in this repo.
 */
import { roomIsComplete } from '../config/hostControls';

describe('roomIsComplete', () => {
  test('everyone in is complete', () => {
    // rejects: a predicate that never returns true
    expect(roomIsComplete({ phase: 'ASK', responded: 8, playerCount: 8 })).toBe(true);
  });

  test('one short is not complete', () => {
    // rejects: `responded > 0`
    expect(roomIsComplete({ phase: 'ASK', responded: 7, playerCount: 8 })).toBe(false);
  });

  test('an empty room is never complete', () => {
    // rejects: the naive `responded >= playerCount`, which is 0 >= 0 === true.
    // A green meter in front of a room nobody has joined is a lie that costs a round.
    expect(roomIsComplete({ phase: 'ASK', responded: 0, playerCount: 0 })).toBe(false);
  });

  test('more responses than players is complete, not a paradox', () => {
    // rejects: strict equality. Answer rows can outnumber deduplicated players.
    expect(roomIsComplete({ phase: 'VOTE', responded: 9, playerCount: 8 })).toBe(true);
  });

  test('VOTE is judged too', () => {
    // rejects: an ASK-only implementation
    expect(roomIsComplete({ phase: 'VOTE', responded: 8, playerCount: 8 })).toBe(true);
  });

  test('phases with nothing to wait for are never complete', () => {
    // rejects: a predicate that ignores phase and greens the dock on RESULTS
    for (const phase of ['LOBBY', 'RESULTS', 'FIELD_NOTES', 'ENDED']) {
      expect(roomIsComplete({ phase, responded: 8, playerCount: 8 })).toBe(false);
    }
  });

  test('missing or non-numeric counts are not complete', () => {
    // rejects: an implementation that compares undefined and gets NaN-truthiness wrong
    expect(roomIsComplete({ phase: 'ASK' })).toBe(false);
    expect(roomIsComplete({ phase: 'ASK', responded: 'x', playerCount: 8 })).toBe(false);
    expect(roomIsComplete({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/roomComplete.test.js
```

Expected: FAIL — `(0 , _hostControls.roomIsComplete) is not a function`.

- [ ] **Step 3: Add the predicate**

In `src/src/config/hostControls.js`, immediately after `isLobbyState`:

```js
/**
 * Is every person in the room accounted for on this beat?
 *
 * `playerCount > 0` is not defensive noise: an empty room is not "everyone has
 * answered", and the naive `responded >= playerCount` answers true for 0 of 0.
 *
 * `>=` rather than `===` because the two numbers count different things — answer
 * rows against deduplicated players — so a rejoin can legitimately put responses
 * ahead of the roster.
 *
 * Only ASK and VOTE have anything to wait for; every other phase is false, so a
 * caller cannot green the dock on RESULTS.
 */
export function roomIsComplete({ phase, responded, playerCount } = {}) {
  if (phase !== 'ASK' && phase !== 'VOTE') return false;
  const people = Number(playerCount);
  const inCount = Number(responded);
  if (!Number.isFinite(people) || people <= 0) return false;
  if (!Number.isFinite(inCount)) return false;
  return inCount >= people;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd src && npx jest __tests__/roomComplete.test.js
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing component test**

Create `src/src/__tests__/stageCompletion.test.jsx`:

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';

describe('the completed state reaches the DOM', () => {
  test('the meter fraction takes the done class when complete', () => {
    // rejects: a `complete` prop that is accepted and ignored
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="8 / 8" complete />
    );
    expect(container.querySelector('.count.done')).not.toBeNull();
    expect(container.querySelector('.meter.is-complete')).not.toBeNull();
  });

  test('and does not when it is not', () => {
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="7 / 8" />
    );
    expect(container.querySelector('.count.done')).toBeNull();
    expect(container.querySelector('.meter.is-complete')).toBeNull();
  });

  test('the dock status takes the go class, which is already styled and was never applied', () => {
    // rejects: leaving `.dock .status.go` dead, which is how it shipped
    const { container } = render(<Dock status="Safe to move on" complete />);
    expect(container.querySelector('.status.go')).not.toBeNull();
  });

  test('the dock status is plain when the room is still working', () => {
    const { container } = render(<Dock status="Some are still answering" />);
    expect(container.querySelector('.status')).not.toBeNull();
    expect(container.querySelector('.status.go')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd src && npx jest __tests__/stageCompletion.test.jsx
```

Expected: FAIL on all four class assertions.

- [ ] **Step 7: Wire the two components**

`src/src/components/stage/RoomMeter.jsx` — replace the function body's return:

```jsx
export default function RoomMeter({ phase, heading, body, complete = false }) {
  if (!heading && !body) return null;

  return (
    <aside className={`meter${complete ? ' is-complete' : ''}`} data-phase={phase}>
      <h4>{heading}</h4>
      <div className={`count${complete ? ' done' : ''}`}>{body}</div>
    </aside>
  );
}
```

`src/src/components/stage/Dock.jsx` — the signature and the status span:

```jsx
export default function Dock({ status, hint, kbd, onSetup, complete = false, children }) {
```

```jsx
      {status && <span className={`status${complete ? ' go' : ''}`} aria-live="polite">{status}</span>}
```

- [ ] **Step 8: Add the meter's CSS**

In `src/src/styles/stage.css`, immediately after the `.meter .count` rule (which ends `white-space:nowrap}`):

```css
/* The completed state. `.dock .status.go` below already carries the same idea
   for the dock — colour plus the finite `cue` pulse, guarded for reduced
   motion — and was ported without ever being applied. This is its counterpart
   on the meter, and the mockup's (02-ask-call-and-answer.html:282).

   Finite iterations on a stable class: the pulse runs once when the class
   lands and does not restart on a re-render, which is what stops a host page
   that re-renders on every socket frame from strobing. */
.meter .count.done{color:var(--success-text)}
.meter.is-complete .count{animation:cue 1.5s ease-in-out 3}
@media (prefers-reduced-motion:reduce){.meter.is-complete .count{animation:none}}
```

- [ ] **Step 9: Run the component test and watch it pass**

```bash
cd src && npx jest __tests__/stageCompletion.test.jsx
```

Expected: PASS, 4 tests.

- [ ] **Step 10: Feed it from the host page**

In `src/src/GameHostPage.jsx`, add `roomIsComplete` to the existing import from `./config/hostControls`.

Replace the `everybodyIn` expression (search for `const everybodyIn = players.length > 0 && (`) with:

```js
  const everybodyIn = roomIsComplete({
    phase: hostPhase,
    responded: hostPhase === 'VOTE' ? playersWhoVoted.length : answeredCount,
    playerCount: players.length,
  });
```

Pass it to both stage components — add `complete={everybodyIn}` to the `<RoomMeter …>` element and to the `<Dock …>` element.

- [ ] **Step 11: Run the whole frontend suite and check it against the baseline**

```bash
cd src && npx jest __tests__/
```

Expected: `5 failed suites / 30 failed`, and passing tests up from 387 to **398** (7 predicate + 4 component). A sixth failing suite is yours.

- [ ] **Step 12: Build**

```bash
cd src && npm run build
```

Expected: compiles, exactly 2 size warnings.

- [ ] **Step 13: Commit**

```bash
git add src/src/config/hostControls.js src/src/components/stage/RoomMeter.jsx src/src/components/stage/Dock.jsx src/src/styles/stage.css src/src/GameHostPage.jsx src/src/__tests__/roomComplete.test.js src/src/__tests__/stageCompletion.test.jsx
git commit -m "feat(host-stage): the room being done is visible from across the room

The dock already said 'Safe to move on' and it was too quiet to notice. The
meter now takes the success colour and pulses once when the last response
lands, and the dock's status takes the .go class that stage.css has styled --
colour, a three-iteration pulse, a reduced-motion guard -- since the port,
without anything ever applying it.

The words stay in the dock and are not repeated on the meter: the port cut the
mockup's 'Everyone is in' line precisely so the fact would not be stated twice
in one viewport, and the fitter drops the meter first on a dense round, so the
dock is also the fallback.

No transition ref: a finite-iteration animation on a stable class runs once and
does not restart on a re-render.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The join code opens the player QR

**Files:**
- Modify: `src/src/components/stage/Rail.jsx`
- Modify: `src/src/GameHostPage.jsx`
- Test: `src/src/__tests__/railJoinQr.test.jsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `join.onPreview`, `join.onPreviewEnd`, `join.onPin` — three optional callbacks on Rail's existing `join` prop. When `onPreview` is absent the code renders exactly as it does today, inert.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/railJoinQr.test.jsx`:

```jsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import Rail from '../components/stage/Rail';

const join = (extra = {}) => ({ code: '4821', url: 'eng.dev/play', ...extra });

describe('the session code as a QR trigger', () => {
  test('with handlers it is focusable and reachable by keyboard', () => {
    // rejects: a mouse-only implementation, which is unusable on a laptop
    // driven by keyboard and invisible to a screen reader
    const onPreview = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(code);
    expect(onPreview).toHaveBeenCalled();
  });

  test('hover previews and leaving dismisses', () => {
    const onPreview = jest.fn();
    const onPreviewEnd = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd, onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    fireEvent.mouseEnter(code);
    expect(onPreview).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(code);
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  });

  test('clicking pins', () => {
    // rejects: hover-only, which does not exist at all on a touchscreen
    const onPin = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin })} />
    );
    fireEvent.click(container.querySelector('.rail-join code'));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  test('without handlers the code is inert, not a fake button', () => {
    const { container } = render(<Rail phase="ASK" title="Q3" join={join()} />);
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBeNull();
    expect(code.getAttribute('role')).toBeNull();
  });

  test('the code still carries no data-drop', () => {
    // rejects: a wrapper or an attribute that lets the fitter sacrifice the one
    // thing the room needs in order to join. The drop order is title(1),
    // JOIN(2), url(3) -- deliberately asymmetric, and the code is not in it.
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('data-drop')).toBeNull();
    expect(code.closest('[data-drop]')).toBeNull();
  });

  test('a closed session offers no QR at all', () => {
    // rejects: advertising a way into a session that has ended
    const { container } = render(
      <Rail phase="ENDED" title="Q3" join={join({ closed: true, onPreview: jest.fn() })} />
    );
    expect(container.querySelector('.rail-join code')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/railJoinQr.test.jsx
```

Expected: FAIL — the first three cases, because the code has no attributes and no handlers.

- [ ] **Step 3: Make the code a trigger**

In `src/src/components/stage/Rail.jsx`, replace `{join.code && <code>{join.code}</code>}` with:

```jsx
      {join.code && (
        join.onPreview ? (
          /* The code, and now also the way into the QR. Interactive ONLY when
             the caller supplies handlers, so a closed session or a test
             rendering a bare rail gets the plain element rather than a button
             that does nothing. Hover for a mouse, focus for a keyboard, click
             for a touchscreen -- which has no hover at all, so without the
             click path the feature would not exist on one. */
          <code
            tabIndex={0}
            role="button"
            aria-label={`Session code ${join.code}. Show the join QR code`}
            onMouseEnter={join.onPreview}
            onMouseLeave={join.onPreviewEnd}
            onFocus={join.onPreview}
            onBlur={join.onPreviewEnd}
            onClick={join.onPin}
          >
            {join.code}
          </code>
        ) : (
          <code>{join.code}</code>
        )
      )}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd src && npx jest __tests__/railJoinQr.test.jsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Own the mode on the host page**

In `src/src/GameHostPage.jsx`, beside the other overlay flags (near `showExpandedQR`):

```js
  /**
   * null | 'preview' | 'pinned'.
   *
   * Three values rather than a boolean because only ONE of them may suppress
   * the SPACE shortcut. A host who rests the mouse near the rail and loses
   * their advance key has been given a worse screen; a pinned QR is a
   * deliberate act with a deliberate dismissal, so that one counts.
   */
  const [qrMode, setQrMode] = useState(null);
```

Add `qrMode === 'pinned'` to the `anyOverlayOpen` expression — and **not** `qrMode === 'preview'`.

Feed the rail by adding to the `join={{ … }}` object passed to `<Rail>`:

```js
            onPreview: () => setQrMode((mode) => (mode === 'pinned' ? mode : 'preview')),
            onPreviewEnd: () => setQrMode((mode) => (mode === 'pinned' ? mode : null)),
            onPin: () => setQrMode('pinned'),
```

Render the overlay from the existing `showExpandedQR` block by widening its condition to `{(showExpandedQR || qrMode) && (` and making its dismissal close both:

```jsx
        <div className="expanded-qr-overlay" onClick={() => { setShowExpandedQR(false); setQrMode(null); }}>
```

In `runHostAction`, immediately after `closeAllSidePanels();`, add `setQrMode(null);` — advancing the round clears a pinned QR the way it clears the rails.

- [ ] **Step 6: Escape dismisses a pinned QR**

Find the existing keyboard effect that handles Escape for the other overlays and add `qrMode` to the same handler, calling `setQrMode(null)`. If no Escape handler exists for overlays, add one scoped to this state:

```js
  useEffect(() => {
    if (!qrMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setQrMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrMode]);
```

- [ ] **Step 7: Full suite and build**

```bash
cd src && npx jest __tests__/ && npm run build
```

Expected: `5 failed suites / 30 failed`, passing up to **404**. Build compiles with 2 warnings.

- [ ] **Step 8: Commit**

```bash
git add src/src/components/stage/Rail.jsx src/src/GameHostPage.jsx src/src/__tests__/railJoinQr.test.jsx
git commit -m "feat(host-stage): the session code opens the join QR

Hover or keyboard-focus the code on the rail to preview the QR; click to pin it.
Pinning is not a nicety -- a touchscreen has no hover, so without it the feature
does not exist there, and a host who hovers and then walks away loses the QR at
the moment it is needed.

Only the pinned state joins anyOverlayOpen. A preview must not suppress SPACE:
losing the advance key by resting the mouse in the wrong place is a worse screen,
not a better one.

The code gains no data-drop and no wrapper that has one -- it stays the last
thing the fitter would ever sacrifice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The host panel's QR opens the Remote

Today the side panel renders the player join URL with the caption "Scan to join!". The owner wants it to be the Host Remote instead, so the operator can pick up the remote on their own phone. The stage's rail (Task 2) is now the player-facing QR, so the two do not compete.

**This does not work without the return-path fix.** `/remote` is behind `ProtectedRoute`, which renders the sign-in form *in place* — so an email/password sign-in reloads `/remote?gameId=4821` and lands correctly. The Google button does not: OAuth navigates away, and `OAuthCallback.jsx` ends with `window.location.href = '/'` hardcoded. `/` is the **host page**, so the host's phone opens a second host page and a second host WebSocket — which, since the connection-eviction fix made newest-wins deterministic, reliably knocks the projector off the air.

**Files:**
- Create: `src/src/auth/returnPath.js`
- Modify: `src/src/auth/LoginForm.jsx`, `src/src/auth/RegisterForm.jsx`, `src/src/auth/OAuthCallback.jsx`
- Modify: `src/src/GameHostPage.jsx`
- Modify: `docs/superpowers/specs/2026-08-09-host-completion-signal-design.md` (§3's "the side panel's click-to-expand stays exactly as it is" is now false)
- Test: `src/src/__tests__/authReturnPath.test.js`

**Interfaces:**
- Produces: `rememberReturnPath(location?)`, `takeReturnPath(storage?)`, `RETURN_KEY` from `src/src/auth/returnPath.js`. `takeReturnPath` returns a same-origin path string or `null`, and clears the stored value.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/authReturnPath.test.js`:

```js
import { rememberReturnPath, takeReturnPath, RETURN_KEY } from '../auth/returnPath';

beforeEach(() => sessionStorage.clear());

describe('the OAuth return path', () => {
  test('remembers path and query, so ?gameId survives the round trip', () => {
    // rejects: storing pathname only, which lands the host on a remote with no
    // session and a code to key in by hand -- defeating the QR entirely
    rememberReturnPath({ pathname: '/remote', search: '?gameId=4821' });
    expect(takeReturnPath()).toBe('/remote?gameId=4821');
  });

  test('is consumed once', () => {
    // rejects: leaving it behind, so a later ordinary sign-in is hijacked back
    // to a session that ended hours ago
    rememberReturnPath({ pathname: '/remote', search: '?gameId=4821' });
    takeReturnPath();
    expect(takeReturnPath()).toBeNull();
  });

  test('nothing stored is null, not the empty string', () => {
    expect(takeReturnPath()).toBeNull();
  });

  test('an absolute URL is refused', () => {
    // rejects: honouring whatever is in storage. This value survives a
    // cross-origin redirect, so treating it as a destination without a guard
    // is an open redirect.
    sessionStorage.setItem(RETURN_KEY, 'https://evil.example/steal');
    expect(takeReturnPath()).toBeNull();
  });

  test('a protocol-relative URL is refused', () => {
    // rejects: a guard that only checks for "http" -- //evil.example is still
    // off-origin and still navigates
    sessionStorage.setItem(RETURN_KEY, '//evil.example/steal');
    expect(takeReturnPath()).toBeNull();
  });

  test('the auth pages themselves are refused, so sign-in cannot loop', () => {
    sessionStorage.setItem(RETURN_KEY, '/auth?status=pending');
    expect(takeReturnPath()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npx jest __tests__/authReturnPath.test.js
```

Expected: FAIL — `Cannot find module '../auth/returnPath'`.

- [ ] **Step 3: Write the module**

Create `src/src/auth/returnPath.js`:

```js
/**
 * Where to go back to after an OAuth round trip.
 *
 * `ProtectedRoute` renders the sign-in form in place, so an email/password
 * sign-in never leaves the URL and needs none of this. The social path does
 * leave: the browser goes to Cognito and comes back to the callback route,
 * and nothing recorded where the host was heading. `OAuthCallback` therefore
 * hardcoded `/` -- which is the HOST PAGE, so a host scanning the remote QR
 * and choosing Google landed on a second host screen on their phone, opening a
 * second host socket and evicting the projector.
 *
 * The value survives a cross-origin redirect, so it is untrusted on the way
 * back out. Only a same-origin path is ever returned.
 */
export const RETURN_KEY = 'authReturnTo';

/** Auth surfaces are never a destination; returning to one loops the sign-in. */
const NEVER_RETURN_TO = ['/auth', '/login', '/register'];

export function rememberReturnPath(location = window.location) {
  try {
    const path = `${location.pathname || ''}${location.search || ''}`;
    if (path) sessionStorage.setItem(RETURN_KEY, path);
  } catch (_) {
    /* private mode, quota — the flow still works, it just lands on the default */
  }
}

export function takeReturnPath(storage = sessionStorage) {
  let value = null;
  try {
    value = storage.getItem(RETURN_KEY);
    storage.removeItem(RETURN_KEY);
  } catch (_) {
    return null;
  }
  if (typeof value !== 'string' || !value) return null;
  // A single leading slash and nothing else: rejects "https://…" and "//host".
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split('?')[0];
  if (NEVER_RETURN_TO.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return value;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd src && npx jest __tests__/authReturnPath.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Remember before leaving**

In `src/src/auth/LoginForm.jsx`, add the import and one line inside `handleGoogleSignIn`, immediately after the existing `sessionStorage.setItem('authMode', 'login');`:

```js
import { rememberReturnPath } from './returnPath';
```

```js
    // Where we were headed, so the callback can put us back. Without this the
    // callback's hardcoded '/' sends a host scanning the remote QR to a second
    // host page on their phone.
    rememberReturnPath();
```

Make the identical change in `src/src/auth/RegisterForm.jsx`, after its `sessionStorage.setItem('authMode', 'register');`.

- [ ] **Step 6: Honour it on the way back**

In `src/src/auth/OAuthCallback.jsx`, add `import { takeReturnPath } from './returnPath';` and replace the approved-user branch:

```js
          } else {
            // Approved user — back to wherever they were headed before the
            // redirect, defaulting to the app root only when there was nowhere.
            const back = takeReturnPath();
            console.log('🔍 OAuth Callback: Redirecting approved user to', back || '/');
            if (onSuccess) {
              onSuccess(user);
            } else {
              window.location.href = back || '/';
            }
          }
```

- [ ] **Step 7: Point the panel's QR at the remote**

In `src/src/GameHostPage.jsx`, beside the existing `playUrl`:

```js
  // The HOST's own phone, not a player's. The stage's rail carries the player
  // join QR (see Rail's join code); this one hands the operator the remote.
  const remoteUrl = `${window.location.origin}/remote?gameId=${gameId}`;
```

In the side panel's `qr-section`, change the QR value and the caption, **and drop the click-to-expand**:

```jsx
                {/* The host's own phone, scanned from arm's length, so 180px is
                    plenty and there is nothing to magnify. The click-to-expand
                    is deliberately gone: the expanded overlay renders `playUrl`,
                    so leaving it here would open a magnified PLAYER QR on top of
                    a REMOTE one. The room-facing QR is the rail's now (Task 2). */}
                <div className="qr-code-static">
                  <QRCodeSVG value={remoteUrl} size={180} />
                  <p>Scan to open the remote on your phone</p>
                </div>
```

Add the class beside the existing `.qr-code-clickable` rule in `src/src/styles.css`, copying its layout rules but without the pointer affordance (no `cursor:pointer`, no hover transform).

**`showExpandedQR` is left in place and is now set by nothing.** Removing it means touching `config/gameSession.js` and the test that binds its key, and the console stream is about to rebuild this panel entirely. Out of scope here, deliberately — do not delete it, and do not add a new caller to justify it.

- [ ] **Step 8: Correct the spec**

In `docs/superpowers/specs/2026-08-09-host-completion-signal-design.md` §6, replace the line reading "**A QR anywhere but the rail.** The side panel's existing click-to-expand stays exactly as it is." with:

```markdown
- **A QR anywhere but the rail and the host panel.** The rail carries the PLAYER
  join QR (§3). The host panel's QR now targets the Host Remote instead of the
  join URL, so the operator can pick the remote up on their own phone — the
  owner's request, 2026-08-09. The two never compete because they serve
  different people.
```

- [ ] **Step 9: Full suite and build**

```bash
cd src && npx jest __tests__/ && npm run build
```

Expected: `5 failed suites / 30 failed`, passing up to **410**. Build compiles with 2 warnings.

- [ ] **Step 10: Commit**

```bash
git add src/src/auth/returnPath.js src/src/auth/LoginForm.jsx src/src/auth/RegisterForm.jsx src/src/auth/OAuthCallback.jsx src/src/GameHostPage.jsx src/src/__tests__/authReturnPath.test.js docs/superpowers/specs/2026-08-09-host-completion-signal-design.md
git commit -m "feat(host): the panel QR opens the remote, and OAuth lands where it was going

The host panel's QR was the player join URL, duplicating what the stage's rail
now shows the room. It targets /remote?gameId= instead, so the operator picks up
the remote on their own phone.

That only works if sign-in returns you. ProtectedRoute renders the login in
place, so email/password already reloads the same URL and lands correctly -- but
the Google path navigates away and the callback hardcoded '/', which is the HOST
page. A host scanning the QR and choosing Google opened a second host page and a
second host socket on their phone, and since newest-connection-wins is now
deterministic that reliably knocked the projector off the air.

The stored path survives a cross-origin redirect, so it is untrusted coming
back: only a single-leading-slash same-origin path is honoured, never an
absolute or protocol-relative URL, and never an auth surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification — a human in a browser, before this is called done

jsdom has no layout engine, so none of the following can be a test. Run the app against dev and check each one. **Vary the configuration, not just the state** — a previous walkthrough of every phase missed a Critical because no measurement was taken with a side panel open.

- [ ] On an **anonymous** call-and-answer round, watch the ASK count climb as people answer, **with no refresh**. If this fails nothing below is assessable.
- [ ] The last answer lands: the fraction turns green and pulses once. It does **not** pulse again on subsequent socket frames.
- [ ] Someone rejoins mid-round: the green drops, then returns and pulses again when the room catches up.
- [ ] The dock's status turns green at the same moment.
- [ ] With the OS set to reduced motion, neither pulses — both still turn green.
- [ ] Hover the rail's session code: the QR appears. Move away: it goes. **Press SPACE while hovering — the round must advance.**
- [ ] Click the code: the QR pins. Move the mouse away — it stays. Escape dismisses it. Advancing the round dismisses it.
- [ ] On a touchscreen, tapping the code pins the QR.
- [ ] Scan the panel's QR with a phone, sign in with **email/password** — it opens the remote with the session loaded.
- [ ] Scan it again in a clean browser profile, sign in with **Google** — it opens the remote, *not* the host page, and the projector stays live.
- [ ] All four display profiles, at the real projected size: nothing clips, and the meter's green survives the fitter on a dense round (or is dropped entirely, with the dock still green — that is the designed fallback).

---

## Executed — and one thing parked, deliberately

All three tasks landed and passed review; the final whole-branch review found a
Critical that per-task review structurally could not see, and its fix wave passed
a scoped re-review with every negative control reproduced independently.

**Parked, with a ruling.** `shortcutsSuppressed()` is extracted and tested, and
deleting `=== 'pinned'` from it now fails two tests — the regression spec §4
named is closed. But deleting `qrMode,` from the argument object at its call site
in `GameHostPage.jsx` reinstates the original defect (a pinned full-screen QR
stops suppressing SPACE, so the host advances the round blind behind it) and
leaves the entire suite green.

**Ruling: the code as committed is correct, nothing downstream builds on this,
and it does not block merge on behaviour.** It is a coverage gap one layer out
from the one that was closed — the helper is tested, the wiring of `qrMode` INTO
the helper is not. Recorded here rather than fixed because the process allows one
fix wave after the final review and that wave is spent. Close it in the console
work, which rewrites this call site anyway: assert the argument, not just the
call.

**Also learned, and worth more than this plan.** `src/src/setupTests.js`'s
`window.location` mock is a silent no-op under jsdom 26 — `delete window.location`
returns `false`, so the real `Location` survives and every assignment to
`pathname`/`search` is a no-op navigation that also emits a jsdom error into each
suite's console. The reviewer traced it as the root cause of **three of the five
"stale" failing frontend suites** (`App`, `GameHostPage`, `PlayerPage`), which the
handoff has been telling everyone not to fix. It is a latent trap for any future
routing test, not a contaminant of this branch's tests.
