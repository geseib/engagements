# Entry and authentication — design rationale

Seventeen mockups in this directory, an annotated contents page at
`index.html`, a deck viewer at `view.html`, and a nine-check audit at
`audit.html`. The questions I could not settle from the code or the brief are
in `OPEN-QUESTIONS.md`.

This covers the root page, the whole participant join path, and the eight
authentication surfaces under `/auth`. It does **not** cover the player's
in-session screens or the host's session list; the join path stops the moment
someone is in.

---

## 1. The problem, stated precisely

Two audiences arrive at one URL, and almost everything about them differs.

| | Participant | Host |
|---|---|---|
| Share of arrivals | overwhelming | small |
| Device | phone | laptop |
| Frequency | once, ever | weekly, for years |
| State of mind | late, being watched, doesn't know the product | at a desk, knows exactly what they want |
| Needs | four digits | an email and a password |
| Account | never | always |

Today `/` renders `GameHostPage` behind `ProtectedRoute`, so a participant who
types the URL off a slide lands on a sign-in form for an account they will
never have. The only thing on that page for them is one sentence in the
footer — *"Players: No account needed to join sessions!"* — which is not a
link, does not go anywhere, and is the last thing on the page.

The asymmetry above is the entire design brief. Everything below follows from
it.

---

## 2. The root page, and where I disagree with the hypothesis

> *"The main page should have a place to just enter the game code as the main
> focus on one side, and the login for admins and hosts on the other."*

**I agree with the priority and disagree with the geometry**, for two reasons
the code and the numbers make concrete.

**The split cannot be the primitive, because the phone has no sides.** On a
375px screen a two-column layout is a stack, and the only real question is
what comes first and how far down the second thing starts. So the design is
built as a phone page — code entry owns it, host sign-in follows it below a
rule — and *grows* a second column at 900px. The DOM order is the priority
order at every width, which also means tab order and screen-reader order are,
without any extra work.

**900px, not 768.** At 768 the join column squeezes below the width the four
code cells need at their derived size, and the code cells are the one element
in this design that may not shrink.

**The join column stays dominant at 1280, and this is the arguable part.**
Desktop is where hosts are — so why not give them the emphasis there? Because
frequency cuts the other way. A host signs in a few hundred times and needs
the control to be *findable*; a participant sees this page once, under time
pressure, while a room waits. Findable is cheap: a heading, a rule, a
full-width outlined button, in the same place every time. So the host column
is quiet, not hidden, and it is a real column — not a link in a corner.

**Where I would go further than the hypothesis: most participants never see
this page.** They scan a QR into `/play?gameId=4821`. That makes the root page
primarily a *recovery* surface — the person whose phone would not scan, who
closed the tab, who typed the URL off a slide. That is why `02-join-identity`
is designed to be the QR landing as much as the second step of typing, and why
`09-join-rejoin` exists at all.

**One thing I did not design, deliberately.** A tempting move is to remember
that this device has signed in before and flip the emphasis for it. It is
cheap and it serves both audiences perfectly — right up until a shared
conference-room laptop shows a sign-in-dominant page to forty participants.
It is in `OPEN-QUESTIONS.md` rather than in the mockups.

**What `/` does when you *are* signed in.** Nothing changes: a signed-in host
goes straight to their host page, as today. Making the only repeat users click
through a landing page on every visit would be a real cost paid for a
hypothetical. The landing renders when signed out.

---

## 3. Type, derived

The host spec's ladders are derived for a projected image read at 25 feet and
are explicitly not to be reused here — its own §7.18 forbids reusing a number
derived for a different display. Its Console exemption (13–20px) is the right
neighbourhood but is asserted rather than derived. So:

### 3.1 The two contexts, measured

| | Phone | Laptop |
|---|---|---|
| Reference | 375 CSS px across ~2.60 in of glass | 1470 CSS px across ~11.4 in of panel |
| Density | **144 CSS px/in** | **129 CSS px/in** |
| Distance | **14 in** | **20 in** |

The distances are the measured medians in the ergonomics literature, not
guesses: smartphone reading clusters around 32–36 cm, laptop use around 50 cm.
Note that laptops sit closer than the 60–70 cm usually quoted for desktop
monitors, because the keyboard is attached to the screen.

### 3.2 The target, and why it is not the stage's target

The host spec targets **20–24 arcminutes of cap height** for prose. Applying
that constant here gives absurd answers — 27px body text on a laptop — so it
does not transfer, and it is worth saying why rather than quietly using a
different number.

That constant is right for its own case: a room reading unfamiliar text in
saccades across a wide field, where a misread costs the whole room a beat.
The reading literature measures something different and more portable — the
**critical print size**, the x-height below which reading speed falls off a
cliff, at roughly **12 arcminutes of x-height** for normal vision. Above it,
reading speed is flat; below it, it collapses.

So the model here is:

- **prose — anything read as a sentence — at or above 12′ x-height;**
- **labels and single glanced words** are not held to that, because they are
  not read, they are recognised; the binding constraint on them is layout and
  the 48px tap target, not acuity.

Inter's x-height is 0.545 em (1536/2816 units). Then, with
`angle = 2 · arctan(x-height / 2d)`:

| Size | x-height | Phone @144ppi, 14in | Laptop @129ppi, 20in |
|---|---|---|---|
| 13px | 7.09px | **12.1′** | 9.4′ |
| 14px | 7.63px | **13.0′** | 10.2′ |
| 16px | 8.72px | **14.9′** | 11.6′ |
| **17px** | 9.27px | **15.8′** | **12.3′** |
| 20px | 10.90px | 18.6′ | 14.5′ |

**17px is the smallest size that clears the critical print size on both
surfaces.** 16px does not clear it on a laptop (11.6′), which is a real
finding rather than a rounding artefact: the near-universal 16px body is at
the edge on a laptop, which is why people zoom.

**The second derivation, which lands on the same number.** iOS Safari zooms
the whole page when a focused text input is under 16px. Every input on these
surfaces is therefore ≥16px by necessity, and if inputs are 17px, prose set
smaller than the thing you type into looks broken. Two independent constraints
arriving at 17px is the strongest evidence available for a type size, and it
is also why Apple's system body is 17pt.

### 3.3 The ladder

```css
--t-code:    clamp(38px, 10.5vw, 46px);  /* the code cells */
--t-display: clamp(26px, 6.4vw, 34px);   /* page title */
--t-title:   20px;                       /* card heading */
--t-body:    17px;                       /* prose AND every input */
--t-label:   14px;                       /* field labels, helper text */
--t-meta:    13px;                       /* legal, kickers. FLOOR. */
```

**One ladder, both surfaces.** The host stage needs four ladders because its
four contexts have four different viewing distances and densities. These two
contexts land within half an arcminute of each other at the same pixel size,
so a second ladder would be a parameter that does nothing — which is exactly
the failure the host spec's §4.2 documents at length. What *does* change
between phone and laptop is composition, not size.

**13px is a floor for labels, never for a sentence.** At 9.4′ on a laptop it is
below the critical print size, so any 13px run must be short enough to be
recognised rather than read. Check **E2** enforces the floor; nothing enforces
"is this a sentence", so it is a rule for a reviewer, not a test.

**The code is sized against a different constraint entirely.** 38–46px is not
a reading size; it is a **transcription** size. The digits are compared
character by character against a screen thirty feet away, by someone who will
blame themselves when it fails. Each digit gets its own cell, tabular figures,
and about 29′ of x-height — roughly 2.4× the critical print size. Nothing else
on these surfaces earns that.

---

## 4. Colour

Warm Summit tokens, unchanged. Measured against the real `#0F1A2E`, with **no
projector black-lift model** — these surfaces are not projected, and applying a
lift derived for a projector is the mistake §7.18 of the host spec names.

| Pair | Ratio | Verdict |
|---|---|---|
| `--text #F4EDE4` on `--bg` | **15.0:1** | anything |
| `--muted #B6C2D4` on `--bg` | **9.7:1** | anything |
| `--muted` on `--surface #1B2942` | **8.1:1** | anything |
| `--primary #F6A94C` on `--bg` | **8.9:1** | anything, incl. body |
| `--success-text #6FD0A4` on `--bg` | **9.3:1** | anything |
| `--secondary #7CA7E6` on `--bg` (links) | **7.1:1** | anything |
| `--bg` on `--primary` (button label) | **8.9:1** | anything |

Check **E3** re-measures all of this against the *composited* background, so
the translucent notice fills are judged as seen rather than as declared. All
612 assertions pass at four viewports.

### 4.1 Where I disagree with the host spec — twice

**The `--muted` lightening is not needed here, and I adopted it anyway.**
The host spec replaced `#9BA8BE` with `#B6C2D4` because a projector's lifted
black point dropped it to 4.03:1. Unlifted, `#9BA8BE` measures **7.24:1** on
`#0F1A2E` — comfortably AA. So the stated reason does not apply to these
surfaces. I use `#B6C2D4` regardless, because a component lifted from here
onto the stage should not need a contrast audit to move, and one muted token
across the product is worth more than 0.2 of a shade. Recording it so nobody
later "discovers" the reason and finds it does not hold.

**"One amber per view" is a room rule and I do not adopt it.** On a projected
surface attention is scarce across twenty-five feet and a second amber costs
the room a beat. On a 375px surface at fourteen inches there is no such
scarcity, and the rule would force an impossible choice: the primary action is
amber-filled, and an error marker also needs the attention colour. Here they
coexist because they are different weights of the same colour doing different
jobs — a filled block is an action, a 3px stroke and a glyph are a flag. Never
more than one filled amber, which is the part of the rule that transfers.

### 4.2 No red, and what errors look like instead

`--danger #E5645E` means *destructive* in this system. A mistyped code is not
destructive; neither is a rejected password. Every error on these surfaces is
therefore:

- a **glyph**, plus
- a **sentence** in `--text` at 17px, plus
- a **2px `--primary` stroke** on the field it belongs to.

Never colour alone, and never red. Check **E6** fails if `--danger` appears in
any text, border or background across all seventeen files. It currently passes,
which is a claim worth being able to make mechanically rather than by memory.

---

## 5. The code field

This is the product's front door, so it gets a section.

**One real `<input>` behind four painted cells, not four inputs.** Four inputs
is the common pattern and it is wrong: paste lands in the first box, backspace
at a box boundary does nothing or jumps unpredictably, and a screen reader
announces four unlabelled fields. One input with `maxlength="4"` gets paste,
backspace, select-all, undo and a single accessible name for free. The cells
are `aria-hidden` decoration painted from the input's value.

**Attributes, and why each.**

| | Why |
|---|---|
| `inputmode="numeric"` `pattern="[0-9]*"` | numeric keypad, not the full keyboard |
| `autocomplete="off"` | there is nothing to autofill; `one-time-code` would be a lie and can pull an unrelated SMS code |
| `autofocus` | declarative, so each platform does the right thing — Chrome on Android raises the keyboard, iOS Safari declines without a gesture. A script forcing focus would be fighting both |
| font-size ≥16px | below it iOS Safari zooms the page on focus, and the participant then has to pinch back out |

**Sanitising, which is the part the brief asked about.** Everything a human
does on the way to typing four digits is noise to be removed, not an error to
be reported:

| Input | Result |
|---|---|
| `4 8 2 1` (spaces) | `4821` |
| `#4821` | `4821` |
| `48-21`, non-breaking spaces pasted from an invite | `4821` |
| `https://eng.dev.seibtribe.us/play?gameId=4821&name=Chris` | `4821`, with *"Took the code out of that link."* |
| `4821 9930` (8 digits) | **rejected** — *"That is 8 digits. The code on screen is 4."* |

The last row is the only judgement call. Guessing which four digits someone
meant is worse than asking, so the field says what it sees and keeps what is
already there. All five behaviours are live in `01-root.html` — they are
deliverables, not pictures.

**Auto-submit on the fourth digit.** A four-digit field has nothing left to
confirm. The risk of auto-submitting a typo is handled in the next section.

---

## 6. The name step is the confirmation step

Four-digit codes collide. Not often — but a mistyped code that happens to
match another live session drops a participant into the wrong room, and with
auto-submit they never touched a confirm button.

The fix costs nothing, because a name is needed anyway: **`02-join-identity`
shows the session title, the host, and where the session has got to, above the
name field.** *"Q3 Regional Leadership Offsite — Northeast & Mid-Atlantic
Commercial Team, hosted by Dr. Alexandra Vasquez-Kowalski, round 2 of 9"* is
either obviously right or obviously wrong to the person reading it, and the
back link is `← Change code`.

This is why auto-submit is safe, and it is why the session card appears on
every join screen after the code resolves.

---

## 7. The join failures — including two the brief did not list, and one that cannot be built

The brief asked for four. There are seven, and one of them is a data-integrity
bug rather than a UX gap.

### 7.1 Wrong code — and the honest limit

`join-game.js` checks `!gameCheck.Item` and returns `404 {error:'Game not
found'}`. That single 404 covers a typo, a session that ended, a session that
was deleted, and a TTL expiry. **The server cannot tell them apart, so the copy
must not pretend to.** Hence *"Nothing is running under 4821"* rather than
*"That code is wrong"*, and a second line that names both live possibilities.

### 7.2 Ended — specified, drawn, and blocked

There is **no ENDED branch in `join-game.js` at all.** A finished session still
has `Started` truthy, so a late arrival today is *silently admitted into a dead
room* and sits watching a lobby that will never move. `05-join-ended.html` is
drawn but cannot ship without:

```js
// lambda-functions/game/join-game.js, after the !Item.Started check
if (gameCheck.Item.Ended || gameCheck.Item.Status === 'ENDED') {
  return { statusCode: 410,
    body: JSON.stringify({ error: 'Game ended',
      message: 'This session has finished.', endedAt: gameCheck.Item.EndedAt }),
    headers: { 'Access-Control-Allow-Origin': '*' } };
}
```

410 rather than 404 or 403, because "was here, is gone" is exactly what 410
means and it keeps the client's branch a status check rather than a string
match. I have not verified which field the end-of-game handler writes — that is
in `OPEN-QUESTIONS.md`.

### 7.3 Not started — held, not bounced

Today: `alert('This game has not been started yet…')` and back to an empty
form, with the name cleared. The participant now refreshes and retries by hand
until it works.

`04-join-not-started.html` holds them instead: the page polls
`GET /games/{id}/state` (which exists and is already used) and joins them the
moment `Started` flips. **The copy does not say a place is held**, because none
is — no player record exists until the join succeeds. *"We will join you as
Bartholomew Fitzgerald-Chen"* is true; *"holding your place"* would not be.

Buildable today with no server change.

### 7.4 Rejoin — and a bug behind it

Today's rejoin prompt sets `joined = true` **locally, with no server call**, so
rejoining a deleted or ended session renders a working game UI over nothing.
`09-join-rejoin.html` re-POSTs; the server already returns
`isReconnection: true` and restores the player, so the correct behaviour is
already implemented server-side and simply not called.

### 7.5 Private session — a state with no design

`Visibility === 'private'` and an `AccessCode` are fully implemented, and the
client detects them by matching the string `'Access code required'`. Two
things: the design exists now (`06-join-private.html`), and the detection
should move to the HTTP status, because a copy edit currently breaks the flow
silently. The access-code field is not format-constrained — the code is
host-chosen and its shape is unknown, so constraining it would reject valid
codes.

Also fixed: today the *Back* button clears the name you already typed.

### 7.6 Name collision — the serious one

```js
Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` }
```

**A player's identity is their display name.** Two people called Chris are one
player: the second silently inherits the first's answers and score, and the
host sees one Chris with impossible timings. Nobody is told.

`07-join-name-collision.html` is the only thing that can stand between that
fact and a merged scoreline, and it offers both readings because both are real
— the server's `isReconnection` path is *correct* when it is the same person
coming back. So: *"If that Chris is you coming back, carry on. If it is not,
add something."* Plus three one-tap disambiguations.

This needs a name-availability check. It must return **a boolean, not the
roster** — anyone with a four-digit code could otherwise enumerate who is in
the room, and the host redesign's §7.15 spends real effort keeping names off
shared surfaces.

### 7.7 Offline

All join failures are `window.alert()` today, including network errors, so
"Network error" arrives in the same grey system dialog as "Game not found" and
reads as the participant's fault. `08-join-offline.html` separates them and the
copy declines to assign blame it cannot determine: *"Either your connection
dropped or we are having a problem — we cannot tell which from here."*

---

## 8. The authentication surfaces

### 8.1 Pending approval — the screen this exercise is really about

Registration puts a user in `pending`; an admin must promote them. The current
screen greets that moment with a promise the system cannot keep, and three
cards of filler.

**What I removed, and why.**

| Removed | Why |
|---|---|
| *"Our team will review your account within 24–48 hours"* | An SLA nobody agreed to. There is no queue, no timer, and on a small deployment "our team" is one colleague. Never overclaim. |
| *"You'll receive an email notification once approved"* | I could not find the pipeline that sends it. If it exists, put the line back; if it does not, this is the sentence that makes people stop checking. See `OPEN-QUESTIONS.md`. |
| *"Start thinking about what types of sessions you'd like to host"* | Filler on a blocked screen reads as being managed. |
| *"Learn More — explore our help documentation"* | Links to nothing. |
| *"Join a Session as Player"* as a secondary button to `/` | Correct instinct, wrong weight and wrong destination — `/` was a sign-in wall. |

**What replaced it.** Three things, in the order a blocked person needs them:

1. **The one thing they can do now** — a working four-digit code field, *on
   this page*. Not a link to it. They may be sitting in the meeting right now.
2. **The one thing that unblocks them** — their name, email and request time as
   a single copyable line to paste into Slack or an email. No backend, no
   notification system, and it converts a passive wait into one action.
3. **The facts** — requested when, which email, status, and a *Check again*
   button.

**A constraint that limits point 3.** Group membership is read from the cached
ID token's `cognito:groups`, and nothing forces a refresh. An admin can approve
someone and the UI will not notice until the token rolls or they sign out and
in. So *Check again* must call `refreshSession()`, not re-read state — and if
that is not wired, the honest label is *"Sign out and back in to check"*. A
live "you have been approved" transition is not currently possible at all.

### 8.2 Sign in

The participant escape hatch — one dead sentence in the footer today — becomes
a real route: `← Join a session instead` at top left, where a back affordance
belongs, on the screen most likely to be reached by mistake.

**Only Google exists.** The brief says four providers are configured in
Cognito; `LoginForm.jsx` and `RegisterForm.jsx` contain exactly one button. I
drew what exists, and added a third panel showing what the block becomes at
four providers — one full-width button becomes a two-up grid and nothing else
moves. Drawing four buttons as the design would have been drawing a feature.

Cognito's `signIn` errors are unmapped, so users currently see
*"Incorrect username or password."* — a product that never asks for a username
saying "username". Mapped here, and the address is echoed in the message
because that is the thing worth checking.

### 8.3 Register

The approval gate moves **above** the form. It is the single most important
fact about creating this account and today it appears halfway down, after the
password field, where someone who has decided to sign up has stopped reading.
It also names the alternative — joining needs no account — with a link.

Password rules are a **live checklist from the first keystroke**, not an error
after submitting. I removed the strength meter: the checklist states every fact
the meter approximates, and two statements of one thing is the redundancy the
host spec's §7.4 bans.

### 8.4 Password reset

Four moments; the third does not exist today. `ForgotPasswordForm` calls
`onToggleMode('login')` on success and the user lands on the sign-in form with
no confirmation that anything happened.

**The bigger change is a security one.** `AuthContext` maps
`UserNotFoundException` to *"No account found with this email address."* — an
account-enumeration oracle at an unauthenticated endpoint. The design answers
the same way either way: *"If there is an account for …, a code is on its
way."* This is a copy change plus deleting that mapping.

### 8.5 Coming back from the provider

`OAuthCallback.jsx` is 20KB and every failure path ends in a bare spinner, a
raw exception, or a timed redirect. Four panels:

- **in flight**, and **in flight after six seconds** with a way out — today a
  stuck callback is a spinner for as long as the user will tolerate one;
- **already linked**, with a button instead of today's 3-second auto-redirect,
  which is long enough to read and too short to act on;
- **everything else**, with one human sentence, an explicit *"Nothing was
  changed on your account"*, and the raw string behind a disclosure. Today
  `Authentication failed: ${tokenError.message}` puts an HTTP status and a
  response body in an `<h2>`.

### 8.6 Two more states nobody listed

`16-blocked.html`. Both are unstyled inline JSX in `App.jsx` today.

**And a live bug in one of them.** `App.jsx:117`:

```js
onClick={() => { const { signOut } = useAuth(); signOut(); … }}
```

`useAuth()` is a hook called inside an event handler. That throws the moment
anyone presses Sign Out on the "Access Pending" screen. Reported here rather
than fixed — this is a design directory.

### 8.7 Password policy: three validators, three answers

| File | Symbols accepted |
|---|---|
| `RegisterForm.jsx` | `[@$!%*?&]` only |
| `ForgotPasswordForm.jsx` | any non-alphanumeric |
| `PasswordChangeForm.jsx` | `[!@#$%^&*(),.?":{}|<>]` |

A password containing `#` or `-` is rejected at signup and accepted at reset.
The checklist in these mockups uses the permissive rule and is one component
used by all three screens — which is the actual fix.

---

## 9. What I rejected

**A modal or drawer for sign-in on the root page.** It hides the destination
behind an interaction on the one screen where a host's muscle memory is worth
most, and it makes the back button lie.

**Four separate inputs for the code.** §5.

**A "not a robot" or rate-limit affordance on the join field.** Four-digit
codes are trivially enumerable and this is a real exposure — but a CAPTCHA in
front of the join field would tax forty participants to inconvenience one
attacker, and the mitigation belongs server-side. Raised in
`OPEN-QUESTIONS.md`.

**Remembering the host on shared devices.** §2.

**Illustration, a product tour, or a marketing block on the root page.**
Everything on that page is either the code field or a route out of it.

**A strength meter alongside the rules checklist.** §8.3.

**"Secure sign-in", a padlock in the header, "your data is safe".** Reassurance
theatre. The lock glyph appears exactly once, on the private-session screen,
where it denotes a *fact about the session* rather than a claim about us.

---

## 10. Verification

`audit.html` runs nine checks over seventeen mockups at 320×568, 375×812,
768×1024 and 1280×800 — 612 assertions. Three were written after failing:

| | Asserts | Found |
|---|---|---|
| E1 | no sideways scroll | — |
| E2 | nothing under the 13px floor | — |
| **E3** | AA against the **composited** background | written to make §4 checkable rather than remembered |
| **E4** | every control ≥44px tall | three under-size targets |
| **E5** | every field has an accessible name | **three password fields with no label at all** |
| E6 | red only for destructive actions | — |
| **E7** | one h1 per screen | **three panels a user can land on with no heading** |
| E8 | no text input under 16px | one 13px field |
| E9 | nothing clipped without a declared truncation | — |

Two defects the audit is structurally incapable of seeing were caught by
looking: an inline SVG with no intrinsic size rendered the Google mark 300px
tall, and the rules checklist wrapped around an inline code run and pushed its
tick out of line. Both broke no rule any check asserts. That is the same
lesson the host spec's §11.1 records — a green sweep is evidence about the
checks, not about the design.

**Not verified.** Nothing here has been on a real phone in a real room. The
14-inch and 20-inch viewing distances are population medians applied to one
product; the arcminute figures in §3 are only as good as those two numbers.
Nobody has tried to type a code on this while a room watches, which is the
single highest-value test available and is not a thing a browser can simulate.
