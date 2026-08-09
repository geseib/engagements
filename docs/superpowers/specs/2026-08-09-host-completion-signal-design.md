# The room-is-done signal, and the join code's QR — design specification

**Date:** 2026-08-09
**Status:** proposed
**Scope:** `src/src/components/stage/RoomMeter.jsx`, `src/src/components/stage/Rail.jsx`, `src/src/GameHostPage.jsx`, `src/src/styles/stage.css`, plus one pure predicate beside `answeredCountFrom` in `src/src/config/anonymity.js`. **No backend change.**
**Mockups:** `docs/design/host-redesign/02-ask-call-and-answer.html` (`.meter .count.done`, `.meter .allin` — drawn, then deliberately not ported; §2 says why part of it comes back and part stays out).
**Prior art:** `docs/superpowers/plans/2026-08-09-host-stage-shell.md` Task 4 (the meter as one labelled fraction) and Task 5 (`dockStatus`). This does not undo either.

---

## 1. The problem

Two complaints from the owner, from running a real session.

**"There were pop-ups that showed when everyone had answered or voted so it was obvious."** Three full-screen celebratory alerts used to fire on completion. They were deleted in the stage-shell work for a good reason, recorded in `GameHostPage.jsx`: each covered the stage — *the advance control included* — for three seconds at exactly the moment the host wanted to move on. What replaced them was `dockStatus` flipping from "Some are still answering" to "Safe to move on": correct, and too quiet to notice from across a room.

**"For the join code, if I hover over it could a really large tooltip pop up with the QR code."** The stage rail prints `JOIN · <url> · <code>`. Someone arriving late has a URL to type and a four-digit code to remember. The app already renders a 300px QR — but only inside a host-only side panel that is closed by default, reachable by opening a panel and clicking. The room never sees it.

**And one precondition that is really the same complaint.** The owner's words: *"make sure you see the signal from the answers — it wasn't incrementing unless I refreshed the host screen."* A completion state is worth nothing if the count it derives from is stale. That defect is fixed in the working tree (see §5) and this design depends on that fix, not the other way round.

---

## 2. The completion signal

### What changes

`RoomMeter` gains one boolean prop, `complete`. When true the fraction takes the success colour and the meter fires **one** pulse.

That is the whole visual change. In particular:

**The mockup's "Everyone is in" text line does NOT come back.** The dock already says "Safe to move on" in the same viewport, and the stage-shell port cut that line specifically so the fact would not be stated twice. Adding it back re-creates the duplication. **The meter carries the signal; the dock carries the sentence.** Colour and motion are perceived without being read, which is the property the owner is actually asking for — the old pop-up was noticeable because it moved, not because it had words.

**The `.meter .bar2` progress bar and the dot matrix stay deleted.** `stageShell.test.jsx` — "it states progress exactly once" — pins that, and this change must not weaken it. The test stands unmodified.

### Why the dock keeps the words

The fitter's reduction ladder sacrifices chrome before content, and **the meter is the first thing it drops** (`fitPolicy.js`: the meter enters at priority `-1`, ahead of every `data-drop` group). On a dense round the meter is not on screen at all. If the meter were the only home for "everyone is in", the fact would vanish exactly when the round is heaviest. With the words in the dock, the worst case degrades to today's behaviour rather than to nothing.

### When it fires

Completion is `answeredCount >= playerCount && playerCount > 0` during ASK, and the same against `votedCount` during VOTE. This is the existing `everybodyIn` expression in `GameHostPage.jsx`; it is lifted into a named predicate so it can be tested, and `everybodyIn` becomes a caller rather than a second copy.

`playerCount > 0` is not defensive noise. An empty room is not "everyone has answered", and a green meter in front of a room nobody has joined is a lie that costs a round.

**The pulse fires on the transition into completeness, not on every render while complete.** The host page re-renders constantly — every socket frame, every refetch — and a pulse per render is a strobe. Held in a ref: previous completeness compared to current, animation triggered only on `false → true`.

**Falling back out of completeness is legitimate and must be handled.** A player rejoining raises the denominator, and the meter correctly stops being complete. It will pulse again when the room catches up. Nothing latches.

### The number behind it

Stated because it is the owner's actual complaint and because a reviewer will otherwise assume the count is fine: **on an anonymous round the ASK meter's numerator is not a count of names.** `message.js` strips `playerName` from the `playerAnswered` frame while a round is hidden, so `playersWhoAnswered` cannot grow between re-syncs. `answeredCountFrom` (already in the tree) takes the larger of the server's participation list and the `/answers` rows, and the rows arrive live. Verified against dev on an anonymous call-and-answer round, three answers submitted one at a time:

```
after 1 answer(s): /answers -> 200, rows=1, named=0, answererIds=["Ada"]
after 2 answer(s): /answers -> 200, rows=2, named=0, answererIds=["Ada","Grace"]
after 3 answer(s): /answers -> 200, rows=3, named=0, answererIds=["Ada","Grace","Hedy"]
```

Rows arrive during ASK, one per responder, carrying no attribution. That is the case the old code could not count.

---

## 3. The join code's QR

### Behaviour

The `<code>` in `Rail`'s join block becomes the trigger for the QR the app already has.

| Input | Result |
|---|---|
| Mouse enters the code | QR overlay appears — **preview** |
| Mouse leaves | Preview dismisses |
| Keyboard focus on the code | Preview appears (the code becomes focusable) |
| Blur | Preview dismisses |
| Click / tap the code | QR **pins** — stays until dismissed |
| Click away, or Escape | Pinned dismisses |
| Any advance (`runHostAction`) | Pinned dismisses |

**Pinning is not a nicety.** A touchscreen has no hover, so without a click path the feature does not exist on one. And a host who hovers, then walks to the back of the room to help someone, loses the QR the moment the mouse settles — which is precisely the moment it is needed.

### Which QR

The existing `expanded-qr-overlay` (`GameHostPage.jsx`), unchanged: 300px code, event title, URL, game id. Reused rather than reimplemented — a second QR surface is a second thing to keep in step with the first, and this one is already sized to be scanned from the back of a room.

### The one interaction rule that matters

`anyOverlayOpen` currently gates the SPACE shortcut, so that a keyboard advance cannot fire underneath something the host is reading. **The preview state must stay out of that check.** A host who rests the mouse near the rail and loses their advance key has been given a worse screen, not a better one. Only the **pinned** state joins `anyOverlayOpen`, because a pinned QR is a deliberate act with a deliberate dismissal.

### What must not move

The rail's drop order is fixed and asymmetric: title (1), the word JOIN (2), the URL (3) — and **the code carries no `data-drop` at all**, because the code is what the room needs in order to get in. An earlier revision numbered it backwards and sacrificed the code before the title. Making the code interactive must not give it a drop group, a wrapper that gets one, or a hit area that changes the rail's measured height. The overlay itself renders **outside** the measured stage subtree (as a sibling of `<Stage>`, where `expanded-qr-overlay` already lives), so it cannot enter the fitter's measurement.

---

## 4. Testing

Split by what can actually be verified, because this repo's dominant failure mode is tests that look like coverage and assert nothing.

**Unit — the predicate.** Pure, beside `answeredCountFrom`: complete; not complete; empty room is never complete; count exceeding the denominator is complete rather than a paradox; a missing or non-numeric count is not complete. Each of these rejects a specific wrong implementation, and the empty-room case rejects the naïve `count >= players`.

**RTL — the components.** `RoomMeter` renders the completed class when `complete`, and does not when it is not. `Rail` renders the code as a focusable trigger, and still renders no `data-drop` on it. The existing meter tests ("states progress exactly once", "never names anybody") must still pass unmodified — if either needs changing, the change is wrong.

**RTL — the interaction rule.** Preview open leaves the SPACE shortcut live; pinned suppresses it. This one is worth writing carefully: it is the assertion that would catch the regression a reviewer is most likely to introduce by folding both states into one flag.

**Not testable here, and said out loud rather than faked:** the pulse, the overlay's position, and whether the QR is scannable at the projected size. **jsdom has no layout engine** — every geometric assertion returns zero and passes unconditionally. These are a human in a browser, at the real display size, and the plan will carry them as an explicit manual checklist rather than as green tests that prove nothing.

**Verify the number before the colour.** The manual pass begins by watching the ASK count increment as answers land, with no refresh, on an *anonymous* round. If that does not happen the completion signal cannot be assessed at all, and any conclusion about it is noise.

---

## 5. Dependency

This design assumes two fixes already in the working tree, both verified but at the time of writing not yet deployed:

1. **`answeredCountFrom`** — the ASK count now reads the `/answers` rows as well as the server's participation list, so it moves on an anonymous round without a refresh.
2. **The connection-eviction fix** (`connect.js` ordering, `WebSocketClient` socket hygiene, all-hosts notification in `message.js` / `submit-vote.js`) — a host whose `CONNECTION#` row was deleted while its socket stayed open received no frames at all, so no count moved and no signal could fire.

Neither is optional. A completion signal built on a frozen count is a green light that appears when the host refocuses the tab.

---

## 6. Out of scope, recorded

- **The Console, the question browser, how-to-play and setup** (mockups 11, 18–20). Still plans 3–5 of the host redesign, still unwritten. This spec touches the meter and the rail only.
- **A QR anywhere but the rail and the host panel.** The rail carries the PLAYER
  join QR (§3). The host panel's QR now targets the Host Remote instead of the
  join URL, so the operator can pick the remote up on their own phone — the
  owner's request, 2026-08-09. The two never compete because they serve
  different people.
- **Sound.** A chime would be noticeable and is the wrong instrument in a room where someone may be speaking.
