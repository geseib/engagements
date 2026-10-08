# Build Room Host Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Build Room host is always one focused button from the next step: each ask runs as a four-step path (Ask, Collect, Settle, Send to Claude), What's next leads between asks, decided answers can be ticked and combined into one editable prompt, and the Stage says plainly when there are mockups to compare.

**Architecture:** Pure rules in `buildScreens.js` decide the step, the summaries, the lead move and the combined text. Two new components (`BuildAskPath.jsx`, `BuildWhatsNext.jsx`) arrange the existing parts (`AskStage`, `WheelPanel`, `DecidePanel`, `PickConfirm`, `Composer`, `AskComposer`, `VoteFromIdeasDialog`) instead of rewriting them. One hook moves focus and scroll to the step's primary button; Space presses it on the Host screen as it does on the Stage.

**Tech Stack:** React (CRA), jest + Testing Library, plain CSS under `.brm-`.

**Spec:** the approved mockups `docs/design/build-room-host-flow/index.html` (H1-H5, S4) and `docs/design/build-room-combine-and-stage/index.html` (P1-P2). Owner, 2026-10-07: "there is a lot of scrolling and its unclear what to do. if i select something or a choice has been made, it seems i need to send to claude but the focus does [not] move to it ... always moving the focus to where they likely should be going next ... we want power in the host, but we really want to make it super easy to progress things forward asking questions, getting votes, spins, or selecting and getting to the next step with claude. the stage should be really clear about what its doing or what comes next (there is a question that needs answering there are mockups to look at etc.)". And: "ask a series of those starter questions ... the host goes back and checks all three of those and says add. all of that gets put into a prompt box that can be edited" (on the Host screen).

## Global Constraints

- Copy: laptops, tablets and phones, never phones only. No emoji in `src/src/buildroom/` (`node tests/build-room-copy.js`).
- Design system (`.claude/skills/engage-design/SKILL.md`): tokens only; never `color: var(--danger)` for text; every selector under `.brm-`; nothing below 12px on the Host screen; read `src/src/__tests__/buildRoomPalette.test.js` before adding CSS.
- Every popover or menu uses `useKeepOnScreen` (`src/src/buildroom/keepOnScreen.js`). Every dialog keeps an X and a bottom exit.
- Focus moves only when the step changes, never while the host is typing (an `input`, `textarea`, `select` or contentEditable has focus) and never while a dialog (`[role="dialog"]` with `aria-modal`, or `.brm-modal`) is open.
- Space presses the step's primary only on the Host screen, with the Stage's guards: not while typing, not with a modifier, not when a button, link or dialog has focus.
- No server change. No plugin change.
- Gates before push: from `src/` `./node_modules/.bin/jest --maxWorkers=3`, `npm run lint` (0 errors), `npm run build`; from the root every backend suite (`for f in tests/*.js; do case "$f" in *verify-question-set-ui.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`). A push to `dev` deploys dev.

## Review Focus

1. **A poll refetch while the host is mid-edit in Send to Claude** (every 8 s, and on every socket message): the direction text and the cursor must survive; focus must not jump back to a button.
2. **Another ask opens while one is at Settle or Send** (Claude's ask opening live with Auto on): the path must follow the new current ask without losing an unsent direction silently; the previous ask stays in results and can be reopened from the Asks list.
3. **A tie, then a spin**: Settle's focused move is Spin the wheel; once the wheel lands (`ask.wheel.landed`), Settle folds to "The wheel picked X" and Send to Claude opens with that pick.
4. **Answer for the room during Collect**: skips Settle; Send opens with the spoken DecidePanel; Cancel returns to Collect.
5. **Narrow screens (900 px and below, one column)**: the path still fits; the focused primary is scrolled into view in the page, not just inside a column.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/src/buildroom/buildScreens.js` (modify) | Pure: `askPathStep`, `askPathSummaries`, `whatsNextMoves`, `combineLine`, `combineText`, `mockupsReady`. |
| `src/src/buildroom/useNextFocus.js` (new) | The hook: on a step change, scroll to and focus the element marked `data-next-primary` inside a container. Plus `isTypingTarget`. |
| `src/src/buildroom/BuildAskPath.jsx` (new) | The four-step path for the current ask. |
| `src/src/buildroom/BuildWhatsNext.jsx` (new) | Claude's line and the ordered moves between asks; the Decided list with ticks. |
| `src/src/buildroom/BuildRoomPage.jsx` (modify) | Mount the path and What's next; lift the Composer's text; the Decided accordion item; Space on Host; AskStage `pathMode`; S4 on the idle stage. |
| `src/src/buildroom/BuildRoom.css` (modify) | `.brm-path*`, `.brm-next*`, `.brm-dec*`. |
| Tests | `buildScreens.test.js`, new `buildAskPath.test.jsx`, new `buildWhatsNext.test.jsx`, `buildRoomPage.test.jsx`. |

---

### Task 1: The rules (pure)

**Files:**
- Modify: `src/src/buildroom/buildScreens.js` (append; export each)
- Test: `src/src/__tests__/buildScreens.test.js` (append)

**Interfaces:**
- Produces:
  - `askPathStep(ask, { pickId = null, answering = false } = {}) → 'collect' | 'settle' | 'send'`
  - `askPathSummaries(ask, { pickId = null, playerCount = 0 } = {}) → { ask: string, collect: string, settle: string }`
  - `whatsNextMoves(room, { ticked = 0 } = {}) → Array<{ key: 'vote-ideas'|'combine'|'starter'|'new-ask'|'tell', title: string, hint: string, button: string, count?: number }>` (first item is the lead)
  - `combineLine(ask) → string`, `combineText(asks) → string`
  - `mockupsReady(room) → { ask, images: [{label, imageId}] } | null`

- [ ] **Step 1: Write the failing tests** (append to `buildScreens.test.js`; add the new names to its import line):

```js
describe('askPathStep: where the host is in one ask', () => {
  const ask = (over) => ({ askId: '004', kind: 'choice', status: 'live', prompt: 'How should it look and feel?', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }], results: { total: 0, options: [] }, ...over });
  test('live and voting are Collect', () => {
    expect(askPathStep(ask())).toBe('collect');
    expect(askPathStep(ask({ kind: 'suggest', status: 'voting' }))).toBe('collect');
  });
  test('results with nothing picked is Settle', () => {
    expect(askPathStep(ask({ status: 'results' }))).toBe('settle');
  });
  test('a pick, a landed wheel, or answering for the room is Send', () => {
    expect(askPathStep(ask({ status: 'results' }), { pickId: 'B' })).toBe('send');
    expect(askPathStep(ask({ status: 'results', wheel: { landed: 'A', spins: [{ landed: 'A' }] } }))).toBe('send');
    expect(askPathStep(ask({ status: 'live' }), { answering: true })).toBe('send');
  });
});

describe('askPathSummaries: what a folded step says', () => {
  test('ask, collect and settle in plain words', () => {
    const a = { askId: '004', kind: 'choice', status: 'results', prompt: 'How should it look and feel?', openedAt: '2026-10-07T14:51:00.000Z',
      options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
      results: { total: 11, options: [{ label: 'A', title: 'Calm', count: 4 }, { label: 'B', title: 'Playful', count: 7 }] } };
    const s = askPathSummaries(a, { pickId: 'B', playerCount: 12 });
    expect(s.ask).toMatch(/^Opened \d{1,2}:\d{2}/);
    expect(s.collect).toBe('11 of 12 voted');
    expect(s.settle).toBe("Going with B, the room's choice, 7 to 4");
  });
  test('an alternate pick says so; a wheel says so', () => {
    const a = { askId: '004', kind: 'choice', status: 'results', prompt: 'Look?', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
      results: { total: 11, options: [{ label: 'A', title: 'Calm', count: 4 }, { label: 'B', title: 'Playful', count: 7 }] } };
    expect(askPathSummaries(a, { pickId: 'A', playerCount: 12 }).settle).toBe('Going with A, your pick instead of B');
    expect(askPathSummaries({ ...a, wheel: { landed: 'A', spins: [{ landed: 'A' }] } }, { playerCount: 12 }).settle).toBe('The wheel picked A');
  });
});

describe('whatsNextMoves: the host between asks, most likely first', () => {
  const room = (over) => ({ asks: [], ideas: [], ...over });
  test('two or more new ideas lead', () => {
    const m = whatsNextMoves(room({ ideas: [{ ideaId: 'i1', status: 'new' }, { ideaId: 'i2', status: 'new' }] }), { ticked: 3 });
    expect(m[0]).toMatchObject({ key: 'vote-ideas', count: 2, button: 'To a vote' });
    expect(m.map((x) => x.key)).toEqual(['vote-ideas', 'combine', 'starter', 'new-ask', 'tell']);
  });
  test('ticked answers lead when fewer than two ideas wait', () => {
    expect(whatsNextMoves(room(), { ticked: 3 })[0]).toMatchObject({ key: 'combine', count: 3, button: 'Combine' });
  });
  test('otherwise the starter questions lead, and combine is not offered with nothing ticked', () => {
    const m = whatsNextMoves(room(), { ticked: 0 });
    expect(m.map((x) => x.key)).toEqual(['starter', 'new-ask', 'tell']);
  });
});

describe('combine: decided answers into one prompt', () => {
  test('one line per ask, question then answer, oldest decided first', () => {
    const asks = [
      { askId: '002', prompt: 'Who is it for?', decidedAt: '2026-10-07T14:40:00Z', decision: { direction: 'Who is it for: Everyone' } },
      { askId: '001', prompt: 'What are we building?', decidedAt: '2026-10-07T14:30:00Z', decision: { direction: 'An app' } },
    ];
    expect(combineLine(asks[1])).toBe('What are we building? An app');
    expect(combineLine(asks[0])).toBe('Who is it for? Everyone');
    expect(combineText(asks)).toBe('What are we building? An app\nWho is it for? Everyone');
  });
});

describe('mockupsReady: something for the room to look at before a vote', () => {
  test('a proposed choice ask whose options all have pictures', () => {
    const room = { asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', title: 'Calm', imageId: 'im1' }, { label: 'B', title: 'Playful', imageId: 'im2' }] }], images: [] };
    expect(mockupsReady(room)).toMatchObject({ ask: { askId: '005' }, images: [{ label: 'A', imageId: 'im1' }, { label: 'B', imageId: 'im2' }] });
  });
  test('nothing when an option has no picture yet, or there is no proposed choice', () => {
    expect(mockupsReady({ asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', imageId: 'im1' }, { label: 'B' }] }], images: [] })).toBeNull();
    expect(mockupsReady({ asks: [], images: [] })).toBeNull();
  });
});
```

Before writing these, read the existing `optionImages`/`imageId` handling (search `imageId` in buildScreens.js and BuildRoomPage.jsx) and the `results.options[].count` shape used by `winnerOf`; if the real shapes differ, keep the behaviour in these tests and adjust only the fixture shape, saying so in the report.

- [ ] **Step 2: Run and see them fail.** `cd src && ./node_modules/.bin/jest src/__tests__/buildScreens.test.js` — FAIL: not exported.

- [ ] **Step 3: Implement** (append to `buildScreens.js`):

```js
// ── THE HOST'S PATH (owner, 2026-10-07; docs/design/build-room-host-flow) ──
// Every ask runs Ask, Collect, Settle, Send to Claude. The step decides which
// button has focus; the summaries are what a folded step says.

export function askPathStep(ask, { pickId = null, answering = false } = {}) {
  if (!ask) return 'collect';
  if (answering) return 'send';
  if (['live', 'voting'].includes(ask.status)) return 'collect';
  if (pickId || (ask.wheel && ask.wheel.landed)) return 'send';
  return 'settle';
}

const countOf = (ask, label) => {
  const o = ((ask.results && ask.results.options) || []).find((x) => x.label === label);
  return o ? Number(o.count) || 0 : 0;
};

export function askPathSummaries(ask, { pickId = null, playerCount = 0 } = {}) {
  const opened = ask.openedAt ? `Opened ${clockOf(ask.openedAt)}` : 'Opened';
  const total = (ask.results && ask.results.total) || 0;
  const verb = ask.kind === 'suggest' ? 'answered' : ask.kind === 'rating' ? 'rated' : 'voted';
  const collect = `${total} of ${playerCount || total} ${verb}`;
  let settle = '';
  const winner = winnerOf(ask);
  if (ask.wheel && ask.wheel.landed && !pickId) settle = `The wheel picked ${ask.wheel.landed}`;
  else if (pickId && winner && pickId !== winner) settle = `Going with ${pickId}, your pick instead of ${winner}`;
  else if (pickId) {
    const others = ((ask.results && ask.results.options) || []).filter((o) => o.label !== pickId).map((o) => Number(o.count) || 0);
    const runnerUp = others.length ? Math.max(...others) : 0;
    settle = `Going with ${pickId}, the room's choice, ${countOf(ask, pickId)} to ${runnerUp}`;
  }
  return { ask: opened, collect, settle };
}

export function whatsNextMoves(room, { ticked = 0 } = {}) {
  const ideas = ((room && room.ideas) || []).filter((i) => i.status === 'new');
  const moves = [];
  if (ideas.length >= 2) moves.push({ key: 'vote-ideas', count: ideas.length, title: `Put ${ideas.length} ideas to a vote`, hint: 'The room sent these while you were busy', button: 'To a vote' });
  if (ticked > 0) moves.push({ key: 'combine', count: ticked, title: `Combine ${ticked} decided ${ticked === 1 ? 'answer' : 'answers'}`, hint: 'Into one prompt you can edit before Claude gets it', button: 'Combine' });
  moves.push({ key: 'starter', title: 'Ask the room a starter question', hint: 'From the question library', button: 'Ask it' });
  moves.push({ key: 'new-ask', title: 'Ask the room something new', hint: 'Ideas, a choice, or a 1 to 5 rating', button: 'New ask' });
  moves.push({ key: 'tell', title: 'Tell Claude', hint: 'Do now, keep in mind, later, or ask Claude', button: 'Write' });
  return moves;
}

export function combineLine(ask) {
  const q = questionOf(ask.prompt);
  const d = String((ask.decision && ask.decision.direction) || '').trim();
  const answer = d.toLowerCase().startsWith(`${q.toLowerCase()}:`) ? d.slice(q.length + 1).trim() : d;
  return `${q}? ${answer}`;
}

export function combineText(asks) {
  return [...(asks || [])]
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)))
    .map(combineLine)
    .join('\n');
}

export function mockupsReady(room) {
  const ask = ((room && room.asks) || []).find((a) => a.kind === 'choice' && a.status === 'proposed'
    && (a.options || []).length >= 2 && (a.options || []).every((o) => o.imageId));
  return ask ? { ask, images: ask.options.map((o) => ({ label: o.label, imageId: o.imageId, title: o.title || '' })) } : null;
}
```

`clockOf` and `winnerOf`: `winnerOf` exists in this file; for the clock, use the same h:mm formatting `clockTime` uses in BuildRoomPage.jsx (copy a small `clockOf(iso)` into buildScreens.js if none exists there; do not import from BuildRoomPage.jsx). Check `winnerOf` returns a label for choice asks and an id for suggest asks; the summaries use whatever it returns.

- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** (`git add src/src/buildroom/buildScreens.js src/src/__tests__/buildScreens.test.js`), plain subject, blank line, body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 2: The path and the focus

**Files:**
- Create: `src/src/buildroom/useNextFocus.js`, `src/src/buildroom/BuildAskPath.jsx`, `src/src/__tests__/buildAskPath.test.jsx`
- Modify: `src/src/buildroom/BuildRoomPage.jsx` (`AskStage` ~1736: a `pathMode` prop; the Host screen's `<main>` ~698-706: mount `AskPath` instead of `AskStage`; the global key handler ~523: Space), `src/src/buildroom/BuildRoom.css`

**Interfaces:**
- Consumes: Task 1's `askPathStep`, `askPathSummaries`.
- Produces: `useNextFocus(containerRef, stepKey)`, `isTypingTarget(el)`, `<AskPath ask room busy ended run api pickId onPick answering setAnswering />`, and the attribute contract `data-next-primary` (the one element Space presses and focus lands on).

**Behaviour (mockups H2, H3, H4):**
- `AskPath` renders an `<ol class="brm-path" aria-label="This ask">` of four steps: Ask (always done once live), Collect, Settle, Send to Claude. A step is `is-done` (folded to a one-line summary from `askPathSummaries`), `is-now` (open), or `is-next` (greyed, not interactive).
- Folded Ask opens on click to show Edit wording and Discard (move these out of AskStage's hostkit when `pathMode`); folded Collect at Settle/Send opens to show Reopen.
- Collect (`is-now`): `AskStage` with `pathMode` (no hostkit primary, no DecidePanel/WheelPanel of its own), then a row: **Close and show results** (primary, `data-next-primary`), Answer for the room, Spin instead; for an Ideas ask still live, **Open voting** is the primary instead of Close (as today's stageModel). Answer for the room sets `answering` (lifted to BuildRoom) and the path jumps to Send with the spoken DecidePanel; its Cancel returns to Collect.
- Settle (`is-now`): the results board (`AskStage pathMode`), then: with a winner, **Go with X** (primary, `data-next-primary`) which calls `onPick(winner)`-equivalent WITHOUT the alternate confirm (it is the room's choice) — set `pick` directly; with a tie, **Spin the wheel** is primary and **Vote again** beside it (reuse WheelPanel's actions); after a spin, WheelPanel as today with **Go with <landed>** primary. Clicking any option card keeps today's `PickConfirm` flow. Rating asks: Settle's primary is **Go with the average** (the existing rating decision default).
- Send (`is-now`): `DecidePanel` (existing, `pickId` or spoken) with its textarea marked to receive focus and its submit marked `data-next-primary`. Ctrl/Cmd+Enter in the textarea submits (add to DecidePanel if not there).
- After a successful send the ask is decided, `current` clears, and the Now column shows What's next (Task 3) with a status line "Sent to Claude as <kind>: <first 80 chars>" for 6 seconds (reuse `claudeKindLabel`).

**`useNextFocus(containerRef, stepKey)`:** in `useEffect` on `stepKey` change (not on mount if `stepKey` is unchanged across a refetch): find `containerRef.current.querySelector('[data-next-focus]') || ...('[data-next-primary]')`; if `!isTypingTarget(document.activeElement)` and no open dialog (`document.querySelector('[role="dialog"][aria-modal="true"], .brm-modal')` is null), call `el.scrollIntoView({ block: 'nearest' })` then `el.focus({ preventScroll: true })`. `isTypingTarget(el)`: input (not checkbox/radio/button), textarea, select, or `isContentEditable`. DecidePanel's textarea gets `data-next-focus` so focus lands in it at Send.

**Space on the Host screen:** in BuildRoom's existing keydown handler, when `screen === 'host'`, key is `' '`, no modifier, `!isTypingTarget(e.target)`, the target is not a button/link, and no dialog is open: `const b = document.querySelector('.brm-host [data-next-primary]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }`.

- [ ] **Step 1: Write the failing tests** in `src/src/__tests__/buildAskPath.test.jsx`. Render `AskPath` with a fake `api` (jest.fn returning Promise.resolve({})) and `run={(fn) => fn()}`. Cover, at minimum:

```jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AskPath } from '../buildroom/BuildAskPath';

const base = { askId: '004', kind: 'choice', prompt: 'How should it look and feel?', openedAt: '2026-10-07T14:51:00.000Z', source: 'host',
  options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }] };
const room = { playerCount: 12, asks: [], log: [] };
const api = () => ({ askAction: jest.fn(() => Promise.resolve({})) });
const mount = (ask, props = {}) => render(<AskPath ask={ask} room={room} busy={false} ended={false} run={(fn) => fn()} api={props.api || api()} pickId={props.pickId || null} onPick={props.onPick || jest.fn()} answering={props.answering || false} setAnswering={props.setAnswering || jest.fn()} />);

test('Collect: four steps, Ask folded, Close and show results focused', () => {
  mount({ ...base, status: 'live', results: { total: 7, options: [{ label: 'A', count: 3 }, { label: 'B', count: 4 }] } });
  const steps = screen.getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  expect(steps[0].className).toContain('is-done');
  expect(steps[1].className).toContain('is-now');
  expect(steps[2].className).toContain('is-next');
  const primary = screen.getByRole('button', { name: 'Close and show results' });
  expect(primary).toHaveAttribute('data-next-primary');
  expect(document.activeElement).toBe(primary);
});

test('Settle with a winner: Go with B is focused; pressing it picks B', () => {
  const onPick = jest.fn();
  mount({ ...base, status: 'results', results: { total: 11, options: [{ label: 'A', count: 4 }, { label: 'B', count: 7 }] } }, { onPick });
  const go = screen.getByRole('button', { name: 'Go with B' });
  expect(document.activeElement).toBe(go);
  fireEvent.click(go);
  expect(onPick).toHaveBeenCalledWith('B', { confirmed: true });
});

test('Settle with a tie: Spin the wheel is the focused move, Vote again beside it', () => {
  mount({ ...base, status: 'results', results: { total: 8, tied: ['A', 'B'], options: [{ label: 'A', count: 4 }, { label: 'B', count: 4 }] } });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Spin the wheel' }));
  expect(screen.getByRole('button', { name: 'Vote again' })).toBeInTheDocument();
});

test('Send: Settle folds to what was chosen; the cursor is in the direction; Send is the primary', () => {
  mount({ ...base, status: 'results', results: { total: 11, options: [{ label: 'A', count: 4 }, { label: 'B', count: 7 }] } }, { pickId: 'B' });
  expect(screen.getByText("Going with B, the room's choice, 7 to 4")).toBeInTheDocument();
  expect(document.activeElement.tagName).toBe('TEXTAREA');
  expect(screen.getByRole('button', { name: /Send to Claude/ })).toHaveAttribute('data-next-primary');
});

test('a refetch with the same step does not move focus out of the direction', () => {
  const ask = { ...base, status: 'results', results: { total: 11, options: [{ label: 'A', count: 4 }, { label: 'B', count: 7 }] } };
  const { rerender } = mount(ask, { pickId: 'B' });
  const ta = document.activeElement;
  fireEvent.change(ta, { target: { value: 'Playful, big numbers' } });
  rerender(<AskPath ask={{ ...ask }} room={{ ...room }} busy={false} ended={false} run={(fn) => fn()} api={api()} pickId="B" onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(document.activeElement).toBe(ta);
  expect(ta.value).toBe('Playful, big numbers');
});

test('Answer for the room jumps to Send; Cancel returns to Collect', () => {
  const setAnswering = jest.fn();
  mount({ ...base, status: 'live', results: { total: 2, options: [] } }, { setAnswering });
  fireEvent.click(screen.getByRole('button', { name: 'Answer for the room' }));
  expect(setAnswering).toHaveBeenCalledWith(true);
});
```

Note `onPick(id, { confirmed: true })`: in BuildRoom, `onPick` today opens `PickConfirm`; give it a second argument so "Go with <the room's choice>" sets `pick` directly (and closes the vote first if still open, as PickConfirm's confirm does), while card clicks keep calling `onPick(id)` and get the confirm. Update the existing `onPick` in BuildRoom accordingly and keep its tests passing.

Also add to `buildRoomPage.test.jsx`: Space on the Host screen presses the focused step's primary (render a room with a live current ask, press Space on `document.body`, expect `askAction` called with `close`); Space while typing in the Composer does not.

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** `useNextFocus.js`, `BuildAskPath.jsx` (export `AskPath`), AskStage's `pathMode`, BuildRoom's mount, `onPick` second argument, Space, Ctrl/Cmd+Enter in DecidePanel, the 6-second sent line, and CSS (`.brm-path`, `.brm-path-step`, `.is-done/.is-now/.is-next`, the summary row, the open body; follow the H2-H4 mockup styles, tokens only; the `is-now` step uses the amber line `--brm` equivalent of `var(--m-line-amber)` from the sheet's existing tokens).
- [ ] **Step 4: Run** the new and existing Build Room suites: `./node_modules/.bin/jest src/__tests__/buildAskPath.test.jsx src/__tests__/buildRoomPage.test.jsx src/__tests__/buildRoomPalette.test.js src/__tests__/buildScreens.test.js` — PASS. Update existing tests that pinned AskStage's hostkit Close or the DecidePanel's position only where the behaviour moved; list each in the report.
- [ ] **Step 5: Commit.**

---

### Task 3: What's next, and combining decided answers

**Files:**
- Create: `src/src/buildroom/BuildWhatsNext.jsx`, `src/src/__tests__/buildWhatsNext.test.jsx`
- Modify: `src/src/buildroom/BuildRoomPage.jsx` (`NowBuilding` ~2345; `Composer` ~2463 → controlled text; the HistoryStack items ~770-790: a Decided item first while building; BuildRoom state), `src/src/buildroom/BuildRoom.css`

**Interfaces:**
- Consumes: Task 1's `whatsNextMoves`, `combineText`, `claudeState` (exists), Task 2's `useNextFocus`.
- Produces: `<WhatsNext room now ticked onMove />`, `<DecidedList asks ticked setTicked used onCombine />`.

**Behaviour (mockups H1, H5, P1, P2):**
- Between asks in the building phase, NowBuilding's default card becomes: Claude's line (`claudeState(room, now)`: headline plus its `line`), then **What's next** with `whatsNextMoves(room, { ticked: ticked.size })`, one row each (title, hint, button). The lead row's button is `data-next-primary` and receives focus via `useNextFocus` keyed on the lead move's key. Keep NowBuilding's special branches as they are (the wrapped stage; the empty room's "What should we build?" starter; anything else it renders before the default card) — read it first.
- Moves:
  - `vote-ideas` → open `VoteFromIdeasDialog` with the new ideas (it exists; find how the Queue opens it and reuse that path; the dialog takes the ticked ideas, so pass all `status === 'new'` ideas, max 6).
  - `combine` → `composeText = combineText(tickedAsks)` appended under any existing Composer text with a blank line between; mark those asks used (`used[askId] = now`), clear the ticks, focus the Composer textarea with the cursor at the end.
  - `starter` → open `AskComposer` on its question library (it renders `ReadyLibrary`; open it the way the Composer's Ideas/Choose/Rate buttons do, then make the library visible — read AskComposer to find how; if the library is a separate toggle, open with it toggled).
  - `new-ask` → open `AskComposer` with kind `suggest`.
  - `tell` → focus the Composer textarea.
- Composer: lift its text to BuildRoom (`composeText`, `setComposeText`) so Combine can fill it; behaviour otherwise unchanged; it stays below the What's next card.
- Decided (right column): a new first HistoryStack item `{ key: 'decided', label: 'Decided', count }` while the phase is building (after "The opening" during the opening). Body: `DecidedList`: every decided ask, oldest first, one row each: a checkbox (named by the question), "Ask N · <question>", the answer (`combineLine` minus the question part, or `decision.direction`), and either "In a prompt · h:mm" (used) or how it was decided (`METHOD_WORDS`). A bar under the list when any are ticked: "N ticked", **Add to the prompt** (primary), Clear. Add to the prompt does exactly what the `combine` move does.
- `ticked` (Set of askIds) and `used` ({askId: iso}) live in BuildRoom state (session only; not saved).

- [ ] **Step 1: Write the failing tests** (`buildWhatsNext.test.jsx` for the components in isolation; `buildRoomPage.test.jsx` for the wiring). At minimum:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhatsNext, DecidedList } from '../buildroom/BuildWhatsNext';

const NOW = Date.parse('2026-10-07T15:00:00.000Z');
const decided = [
  { askId: '001', prompt: 'What are we building?', status: 'decided', decidedAt: '2026-10-07T14:30:00Z', decision: { direction: 'An app', method: 'vote' } },
  { askId: '002', prompt: 'Who is it for?', status: 'decided', decidedAt: '2026-10-07T14:40:00Z', decision: { direction: 'Who is it for: Everyone', method: 'host' } },
];

test('What\'s next: the lead move is focused and says what it does', () => {
  const onMove = jest.fn();
  render(<WhatsNext room={{ asks: decided, ideas: [], agent: { connected: true }, log: [] }} now={NOW} ticked={new Set(['001', '002'])} onMove={onMove} />);
  const lead = screen.getByRole('button', { name: 'Combine' });
  expect(document.activeElement).toBe(lead);
  fireEvent.click(lead);
  expect(onMove).toHaveBeenCalledWith('combine');
  expect(screen.getByText('Claude is ready for the next step')).toBeInTheDocument();
});

test('Decided: one row per decided ask with a tick; the bar adds the ticked ones', () => {
  const setTicked = jest.fn();
  const onCombine = jest.fn();
  render(<DecidedList asks={decided} ticked={new Set(['001'])} setTicked={setTicked} used={{}} onCombine={onCombine} />);
  expect(screen.getByRole('checkbox', { name: /What are we building/ })).toBeChecked();
  expect(screen.getByText('Everyone')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add to the prompt' }));
  expect(onCombine).toHaveBeenCalled();
});

test('a used answer says In a prompt', () => {
  render(<DecidedList asks={decided} ticked={new Set()} setTicked={jest.fn()} used={{ '001': '2026-10-07T14:41:00Z' }} onCombine={jest.fn()} />);
  expect(screen.getByText(/In a prompt · \d{1,2}:\d{2}/)).toBeInTheDocument();
});
```

And in `buildRoomPage.test.jsx`: with two decided asks, tick both in Decided, press Add to the prompt, and the Composer textarea's value is `"What are we building? An app\nWho is it for? Everyone"`; with text already typed, the lines go below it after a blank line.

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Build Room suites and palette test; update existing NowBuilding tests that pinned the old default card, listing each.
- [ ] **Step 5: Commit.**

---

### Task 4: The Stage says there is something to look at (S4)

**Files:**
- Modify: `src/src/buildroom/BuildRoomPage.jsx` (`IdleStage` ~2238, `BuildStage` ~1260 and its dock), `src/src/buildroom/buildScreens.js` (`stageModel`), `src/src/buildroom/BuildRoom.css`
- Test: `buildScreens.test.js`, `buildRoomPage.test.jsx`

**Interfaces:**
- Consumes: Task 1's `mockupsReady`.

**Behaviour (mockup S4):** with no current ask, when `mockupsReady(room)` returns an ask, the idle stage shows instead of Claude's status: headline "Two looks to compare" (or "N looks to compare" for 3 or more), the line "Claude made A and B. Look now; the vote opens next." (letters from the options; "A, B and C" for three), the pictures side by side with their letter and title (BuildImage), and the side column "Next · Pick one on your phone, laptop or tablet". `stageModel` returns `primary: { action: 'open', label: 'Open the vote', askId }` for that state with status "Mockups ready · the host opens the vote"; the Stage dock's handler performs `api.askAction(askId, { action: 'open' })` for it. Everything else on the idle stage is unchanged.

- [ ] **Step 1: Failing tests**: stageModel returns the open primary when mockupsReady; none otherwise. The idle stage renders the headline, both letters and the Next line; Space on the Stage calls `askAction('005', { action: 'open' })`.
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run** the Build Room suites. **Step 5: Commit.**

---

### Task 5: Gates, dev, and a look

- [ ] Run every gate in Global Constraints. All pass.
- [ ] Push to dev (`git fetch origin && git merge-base --is-ancestor origin/dev HEAD && git push origin HEAD:dev`; merge `origin/dev` first if it moved, then re-run the gates).
- [ ] On dev, in a test room: open a choice ask, see Collect focused; close; Settle focused on Go with X; Send with the cursor in the direction; send; What's next leads; tick two decided answers and Add to the prompt. Measure every popover and dialog at about 660 px and 375 px wide (`useKeepOnScreen` rule).
