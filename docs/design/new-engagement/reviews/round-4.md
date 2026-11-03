# Round 4 review: progressive reveal

*31 Oct 2026. A desk review of the first draft of `index-4.html`. Three people walked through
frames 4a to 4g and the two forks. The draft's renders are kept outside the repo; the PNGs beside
`index-4.html` are the revised frames. Each comment ends with what was done about it.*

## 1. First-time host: "Dana", has never used Engage, running a team retro

> Opened it cold, with the brief "set up a retro for Friday".

1. **"Two things to do. That's the first time this screen hasn't made me scroll to see what I'm
   in for."** (4a) The draft's main claim holds: on open she read the whole form in one sweep.
   *Kept.*
2. **"The right side says 'Example: the first stage of Call & Answer'. Is that the one I'm
   supposed to pick?"** She read the example as a recommendation, which is a real risk when the
   example is also the first card. *Changed:* the line now says it is an example shown while she
   chooses, and that pointing at or focusing a format shows that format. The stage card carries
   its own label, "Example · Call & Answer, stage 1 of 6".
3. **"'Something bigger?' sounds like you're about to sell me something."** *Changed* to
   "Bigger than one session", with a three-word line for each ("with your Claude Code", "a whole
   day, one join code") and the shared note "each continues on its own page".
4. **"I clicked Create to see what would happen and nothing did."** (4a) The outlined button
   with "Still needed" beside it was clear once she read the foot, but the click did nothing at
   all. *Changed:* pressing Create early moves focus to the first missing decision and says
   which one (see A1 below).
5. **"When the questions box appeared I saw it straight away. The fade was enough. Anything
   bigger would have felt like a pop-up."** (4c) *Kept:* 180ms of opacity and 4px of rise, with
   nothing animating height.
6. **"What do I type in the search? I don't know what sets exist."** She asked to see a few
   sets under the search without typing. *Declined, for now:* a list there would make the
   revealed section tall and push it off the first screen at 1280×720 (frame 4f), which defeats
   the reveal. "Browse all 16 sets" already sits beside the search as a button, and a plain line
   says what a set is. Listing three ready-made sets is an open question for
   the owner.
7. **"'Names are hidden until the vote closes' is what I was going to ask about, and it turned
   up right when the questions did."** (4d) *Kept.* This is the strongest argument for revealing
   the names card with the set rather than with the format: before there is a set, there is
   nothing to be anonymous about.
8. **"Advanced: Defaults in use. Which defaults?"** (4d) *Changed*, together with the
   facilitator's comment 2.

## 2. Weekly facilitator: "Sam", runs an ops session every Friday, mostly keyboard

1. **"It opens where I left off. My format's chosen, the questions box is there, the side panel
   stays shut because I shut it once. Fine."** (4e) The key path is unchanged: title, Tab, Tab,
   Enter, ⌘↵. *Kept.*
2. **"I check 'shuffled' before every create. 'Defaults in use' makes me open Advanced to find
   out."** The draft cut the Advanced line to two words. *Changed:* closed, it now names the
   defaults the names card does not already state ("Defaults: questions shuffled, Workie's
   standard summary"), or shows "Changed: …" in amber. The full sentence is inside the fold. The
   names rule is no longer said twice on one screen.
3. **"Don't make me hunt for Advanced before I've picked a set. Actually, I never do that."**
   Asked about fork 2: he doesn't mind either way, and he never touches options before the set.
   *Recommendation stays A* (one rule for everyone).
4. **"If I arrow from Call & Answer to Trivia and back, does the questions box flash every
   time?"** In the draft, yes, because the section re-rendered with its entrance animation.
   *Changed:* the entrance plays once per dialog, on the first reveal. Switching format inside a
   section that is already showing swaps its contents with no animation.
5. **"If I switch format after picking a set, do the options vanish?"** No. Once shown they stay
   for the life of the dialog, and each shows only for the formats it applies to, as today. The
   rule is now written into the reveal table. *Clarified.*
6. **"I don't need 'The questions you will ask…' every time."** It only shows to a host with
   nothing in "Used by you lately", so he never sees it. *Already so, now stated.*
7. **"The step numbers going is fine. I never read them."** *Kept.*

## 3. Accessibility reviewer: keyboard, NVDA and VoiceOver, reduced motion, 200% zoom

**A1. Create is unreachable when it matters most (must fix).** The draft kept the native
`disabled` attribute, so a keyboard user's Tab stopped at Cancel and a screen-reader user never
heard "Still needed: a question set". A reason beside a control nobody can reach is decoration.
*Changed:* Create uses `aria-disabled="true"` and stays in the Tab order, with
`aria-describedby` pointing to the foot's reason. Pressing it, or ⌘/Ctrl+Enter, while not ready
moves focus to the first missing decision (the title, then the format's tab stop, then the set
search) and announces "Add a title first." / "Pick a format first." / "Pick a question set
first." politely. While a create is in flight (`busy`) the button stays truly `disabled`, as
today.

**A2. An announcement on every arrow (must fix).** In the format radio group, the arrow keys
choose as well as move. A rule of "announce the reveal" would have said "Question set added
below" on the first arrow press and again after every trip through Build Room. *Changed:*

- There is one live region, which already exists (`.gsd-sr`).
- Each action produces at most one message.
- The Question set reveal is announced once, on its first appearance.
- Swapping to a hand-off format announces "Next: the Build Room page, below." once per swap.
- Returning to a session format announces nothing new.
- A meeting chip's reason and the reveal are joined into one message ("For a retro: Call &
  Answer. … Question set is below."), because two polite messages from one press interrupt each
  other.

**A3. Focus is never moved by a reveal.** *Confirmed in the draft.* Focus moves only where it
moves today: Enter in the title goes to the format, and Enter on a format goes to the set search.
A click leaves focus on the thing clicked. New sections are inserted after the current one in
DOM order, so the next Tab reaches them. Each is a `<section aria-labelledby>` with an `h3`, so
heading navigation finds it.

**A4. Reduced motion.** The base style is the end state, and the entrance runs only under
`prefers-reduced-motion: no-preference`. Nothing animates height or position of other content.
The gallery folding to chips on a set pick is instant (as today). *Confirmed.*

**A5. The foot's reason must not be a live region.** It changes with every keystroke that
empties or fills the title. *Confirmed:* plain text, read through `aria-describedby` when Create
is focused.

**A6. "Bigger than one session".** The two hand-off options are still radios in the one format
group, so the roving tabindex and arrow keys reach them, and the cell is `role="presentation"`.
Each option is described by its own line plus the shared "each continues on its own page". The
12px muted lines measure 7.0:1 on the card. *Confirmed.*

**A7. Phone fold closed by default.** The summary reads "How Call & Answer runs, 6 stages" and
is a native `details`, so it is announced as collapsed. *Accepted.* Open by default, its stacked
stages put the revealed Question set two screens below, where a screen-magnifier user would never
find it.

**A8. At 200% zoom (an effective 720px width) the dialog takes the narrow layout** (the pane
becomes the fold) and the reveal order is unchanged. *No change needed.*

## What changed in the mockup

| Comment | Change in `index-4.html` |
|---|---|
| Dana 2 | The pane's example line and the "Example · Call & Answer, stage 1 of 6" label (4a) |
| Dana 3 | "Bigger than one session" with short lines (4a–4c, 4f) |
| Dana 4, A1 | Create is `aria-disabled`, described by "Still needed"; pressing it moves focus to the gap (every not-ready frame) |
| Dana 8, Sam 2 | The Advanced line names the two remaining defaults (4d, fork 2) |
| Sam 4, A2 | The entrance plays once; one message per action (README rules) |
| Sam 5 | "Hidden again when" column in the reveal table |
| Preview wording | 4b: "A preview of the card you are on. Click it, or press Enter, to choose it." The draft named Space and Enter, which means nothing to a mouse user. |
