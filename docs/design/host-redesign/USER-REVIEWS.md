# Host screen redesign — first-look reviews

Three people who run meetings for a living were shown the sixteen host-screen mockups and nothing else. No spec, no critique, no source. They were told only what the design claims about itself: nothing scrolls, it reads from thirty feet, all operator controls hide behind a Console summoned by `\` or a `⋯` button, the dock always carries one status line and one primary action, and progress is stated in exactly one place. They viewed at 1920×1080 and 1280×720 in the display profile matching how they would actually use it. Their reactions are below, in their own words, followed by a short researcher's read.

---

## Maya Ortiz — VP of Product, ~900-person B2B software company

*Viewed `d-table` and `d-room` at both sizes.*

### First ten seconds

Better than I expected and not as good as it thinks it is. The type is real type — someone chose a grotesk with a proper 20% and a proper question mark, and `07-results-trivia.html` at 1920 is genuinely handsome. That screen would not embarrass me on a wall. Then I looked at `03-ask-trivia.html`, the same six options at the *asking* stage, and four of them end in an ellipsis. "Migrating the installed base from seat-based licensing to usage-…" — usage-what? And there are about two hundred vertical pixels of empty gradient sitting under the option grid while it does that.

So: product, then internal tool, in about four seconds. The polish is real and it is a veneer over an engineering decision nobody looked at with their eyes.

### Could I run it cold?

Mostly yes, and that is the surprise. The dock is the best idea here. One line of state on the left, one amber button on the right, same place every screen — I never had to hunt for "what happens next." `Start First Round` → `Start Voting` → `Show Results` → `Next Round` reads as a sentence. That is more than I can say for most of these tools.

Where I'd hesitate:

- **No way back.** Every dock I looked at moves forward. `06-results-call-and-answer.html` gives me `Next Round`. If I hit `Show Results` while three people are still typing, I can find nothing on screen that reopens answering. `11-console.html` offers `Re-pick question` and `Skip round`, neither of which is "undo."
- **No timer, anywhere.** Not on `02`, not on `04-ask-wavelength.html`. I run a staff meeting on a clock. "31 of 40 answered" tells me the denominator, not when this ends. I would be watching the dot grid like a hawk instead of listening to my team.
- **`04-ask-wavelength.html` is 60% empty.** The word "Pricing power" is the whole point of the screen and it occupies maybe an eighth of it. That is not restraint, that's a layout that gave up.

### Would I put it in front of my leadership team?

**Yes for my Monday staff — eight people, my laptop on the table, `d-table`. No for the quarterly offsite.**

The staff meeting is forgiving; if an option truncates I read it aloud and nobody files it away. The offsite is forty people, half of them peers, and it is on a wall for six hours. `14-density-tv.html` at 1280 truncates the event title to "Q3 Lead…" and cuts five of six options mid-word. I am not standing in front of my CPO explaining why the screen ate the question.

**The single change:** never truncate body content. Ever. And the design has already proved it doesn't need to — `07-results-trivia.html` renders all six of those same options in full, at *larger* type than `03` used to chop them. The fitter is stepping down the wrong axis. Shrink type, reflow to one column, drop the answer-count meter, take the empty band underneath — you have three levers and it's pulling none of them before it reaches for the ellipsis.

### The Console

The hotkey is fine. I run Keynote; I know what a hidden operator layer is for. Two things are not fine.

First, the panel's own banner in `11-console.html` says *"Setup — the room can see this panel."* You have built the hidden console and then written on it that it isn't hidden. It covers the right third, dims the stage, and lists my colleagues' names. That is exactly the configuration chrome the whole idea was supposed to prevent.

Second, and this is the product-craft complaint: `01-lobby.html` says **"Names in the Console."** You have put an internal feature name on the screen forty people are looking at. Nobody in that room knows what the Console is. Nobody should have to.

Also — `Sign out` is one tab-stop from `Report a problem` in a live-session panel. Move it.

### Versus what we use

Slido, mostly, and plain Keynote. Against Slido this is better-looking and worse-behaved. Slido has never hidden half a poll option from me. Against Keynote it's obviously better — Keynote can't count votes — but Keynote never surprises me either, and `05-vote.html` announcing "PAGE 1 OF 7 · ROTATES EVERY 10S" is a surprise machine.

### What would most embarrass me

Standing in front of my peers on `03-ask-trivia.html` and reading option B off my own screen because the screen wouldn't finish the sentence. Everyone in that room builds software. They would know instantly what they were looking at.

---

## Rachel Nkemdirim — Chief of Staff, mid-size healthcare organization

*Viewed `d-call` throughout, because that is how 200 people see it.*

### First ten seconds

Handsome. Calm. Dark, which our AV people will like because our overheads are terrible. My honest first thought was "someone spent money on this," which is a compliment.

My second thought was that I don't know how to get out of anything.

### Could I run it cold?

No. Not without a rehearsal, and I would need at least two.

I'm not being precious. Here is what stopped me:

**The console tells me it isn't private.** `11-console.html` — the very first line inside the panel says *"Setup — the room can see this panel."* I was told controls live behind a hidden overlay. They don't. They live behind an overlay that dims the room's screen, slides over a third of it, and posts a list of people's names — *"Waiting on Dana Whitfield, Tomás Ferreira, Jordan Pike, Yuki Tanaka…"* — in front of everyone. On a Teams share to two hundred people. In healthcare. If I ever need to fix something mid-session, two hundred people watch me fix it, and they watch a roster of who's slacking while I do.

**The dock does that anyway.** I don't even have to open the console. `02-ask-call-and-answer.html`, bottom left, permanently: *"31 of 40 answered · waiting on Dana, Tomás, Jordan and 6 more."* That is naming and shaming three named colleagues on the all-hands screen. I would have that removed before I would run this once. Our clinical staff answer late because they are with patients.

**The question doesn't fit.** This is the one that actually kills it for me. In `d-call` — the profile I would live in — `02` cuts the prompt at *"no change to the…"* and then leaves a third of the screen empty below it. It cuts *earlier* in call than it does in room, so the more people are remote, the less of the question they get. My remote half is already the disadvantaged half. And `06-results-call-and-answer.html`, the screen whose whole stated job is to remind people what was asked, truncates the reminder: *"briefed the trade press b…"*

**I couldn't test the escape hatch.** I pressed `\` on `01-lobby.html`. Nothing happened. I understand these are pictures. But that means the only thing I was shown about the console is one still frame on one screen, and the thing I most needed to know — what happens when it goes wrong — is the thing I was not shown.

**No timer.** In a hybrid all-hands, silence is the enemy. `04-ask-wavelength.html` gives me a count and no clock. I will fill that silence by talking, badly, for an unknown number of seconds.

### Would I put it in front of my leadership team?

**No.** Not the all-hands, not the exec meeting.

**The single change:** give me a private operator view on a second device. The console in `11` literally has a button labelled `Open phone remote` — so someone has thought about this — but it is a button in a picture and there is nothing anywhere showing me what it does. If I could hold the controls in my hand, see the roster and the fix-it options privately, and have the wall show nothing but the content, most of my other objections shrink to nits. As it stands, every recovery action I might need is an action the audience watches me take.

### Versus what we use

Mentimeter and, for the big ones, a slide deck with someone else clicking. Mentimeter is uglier and I trust it more. When something goes wrong in Menti I click a thing on my laptop and the room sees the result, not the repair. That is the whole job.

The one place this beats everything I use: `16-phase-wipe.html`. A full-width band across the screen reading **"VOTING IS OPEN — CHECK YOUR PHONE"** is the single best thing in this entire set. Half my hybrid problem is people not noticing the moment they're supposed to do something. That band solves it. Nothing in Menti does that as loudly.

### What would most embarrass me

Opening the console because something broke, and the room reading "Waiting on Dana Whitfield…" over my shoulder while I flail. Second place: `15-edge-minimum.html`, where the primary button is greyed out and the screen says *"The button wakes up on the first answer."* If nobody answers — bad wifi, wrong link, the usual — the shared screen is now a locked door with a cute sentence on it, and two hundred people are watching me try the handle.

---

## Tom Aldridge — Partner, strategy consultancy

*Viewed `d-room` at 1920 and 1280, the way it lands on a client's projector.*

### First ten seconds

Someone who actually knows what a room looks like touched this. That is rarer than it should be. The contrast is right for a washed-out boardroom projector, the phase chip top-left tells me the state from anywhere, and the type on `07-results-trivia.html` would read from the back of most rooms I work in. Menti's default deck does not read from the back of most rooms I work in. So: credit where it's due, this is not an internal tool, it's an unfinished product.

Then I opened the voting screen and my afternoon fell apart.

### Could I run it cold?

I could run *most* of it cold. The dock grammar is good enough that I'd trust it on a clicker. Two states I could not run.

**`05-vote.html`.** It says, in the middle of the screen: *"PAGE 1 OF 7 · 20 RESPONSES · ROTATES EVERY 10S."* Seventy seconds to cycle the ballot. Three long paragraphs at a time, on a timer, while forty people are trying to choose two of twenty. This is the single most facilitation-hostile thing in the set and I want to be precise about why.

When I run a prioritisation, the room's shared attention *is* the deliverable. I say "look at six and eleven" and forty heads go to the same place. On this screen there is no six and eleven — there is whatever page happens to be up, and it changes under them mid-sentence. I cannot point. I cannot hold. I cannot go back to the one someone wants to argue about, because nothing visible lets me page manually. And the insult is that at 1920 the screen paginates while roughly a third of it is empty gradient. It's rationing space it isn't using. (At 1280 the same file fills the frame far better, which tells you the sizing logic is tuned to the wrong end.)

Also: the actual question being voted on is not on that screen. Just *"PICK THE TWO YOU WOULD ACTUALLY FUND."* Two of what, in answer to what? The room was heads-down on phones for the last three minutes. `06` understood this problem and put the recap back. `05` didn't get the memo.

**`08-results-wavelength.html`.** Sixteen words crammed into the top quarter, sixty per cent of a projector screen showing empty gradient below them, and "Elasticity²" set at what looks like fourteen pixels. From twenty feet that's a smudge. This is meant to be the crescendo of a word round and it looks like a page that failed to load the rest of itself.

### Would I put it in front of a client?

**No.** Not a paying workshop.

Truncation is the reason, and `03-ask-trivia.html` is the exhibit. Four of six options cut, two mid-word, whitespace below. My clients are paying me for rigour. A screen that abbreviates the choices they're being asked to make is a screen that says I didn't check my materials. And `09-field-notes.html` does it to an *insight* — "Worth asking why the cheap moves were also the popular…" — an AI-generated observation, amputated, with half the screen empty beneath it. That's the moment a partner in the room says "the popular what?" and the answer is "I don't know, it's the software."

While I'm there: `09` is headed **"WORKIE'S READ ON THE ROOM."** Do not put your AI's pet name on a client's wall. It reads as unserious and it invites a fifteen-minute detour about what the model is and where the data goes. Call it "What we heard" and move on.

**The single change:** kill the ellipsis and kill the auto-rotation. One rule — content is never abbreviated on the stage; if it doesn't fit, the type steps down, the layout goes single-column, and the meter gets sacrificed before a single word does. And give me manual paging on `05` with a stable number against each item.

### The Console

Conceptually correct and I'd defend it against the obvious objection. Slido's host bar is always on the client's screen and it looks like I'm driving a spreadsheet. Hiding it is right.

The execution I don't accept. `11-console.html` prints *"the room can see this panel"* on the panel. And the summoning affordance is a `⋯` chip perhaps thirty pixels wide in the bottom-left corner at low contrast — I could not hit that reliably standing at a flipchart with a clicker in one hand, and the room can see me hunting for it. A hidden control needs a keyboard route I can hit blind. `\` may be that route; I couldn't test it, since pressing it on `01-lobby.html` did nothing.

Related inconsistency worth naming: `13-density-call.html` and `12-density-table.html` show a small `SPACE` hint chip beside the secondary action. `07` and `14-density-tv.html`, in room and TV, don't. The profile where I'm furthest from the machine and most dependent on a keyboard is the one profile that doesn't tell me a key exists.

### Versus what I use

Mentimeter and Slido, hundreds of times.

- **Better:** typographic legibility at range (`07`), phase signalling (`16-phase-wipe.html` — Menti has nothing that emphatic, and I've lost minutes to rooms not noticing a poll opened), and the join screen (`01-lobby.html` is cleaner than Menti's, though the code appearing both in the header and at 100pt in the middle is one place too many for a design claiming it cut redundancy).
- **Worse:** ballot handling, decisively. Menti shows me every option at once and lets me sit on it.
- **Different:** `10-ended.html` ends a pricing-strategy offsite with **"SESSION CHAMPION — Aleksandra Wiśniewska, 1,240 pts."** Not a scoring problem, a framing one. My clients spent four hours deciding something and the last artefact on the wall is a leaderboard. Menti at least ends on the data. If this wants to be a strategy tool rather than a quiz tool, the terminal screen should state what the room concluded and let the scoreboard be a footnote.

### What would most embarrass me

Saying "let's talk about the third one" in `05-vote.html` and having the page rotate away mid-sentence, in front of a client who is paying by the hour for me to be in control of the room.

---

## Researcher's read

### What all three agree on

1. **Truncation is disqualifying, and it is disqualifying because of the whitespace next to it.** All three independently named it as their primary objection and all three named the same aggravating factor: the ellipsis fires on `02`, `03`, `06`, `09`, `12` and `14` while a large empty band sits below the content. Ortiz supplied the killer evidence unprompted — `07-results-trivia.html` renders the same six options in full at larger type than `03` used to truncate them. Whatever the fitter is doing, no evaluator read it as "the reduction working"; all three read it as a bug that shipped.
2. **The Console is not private, and the mockup says so.** The line *"Setup — the room can see this panel"* in `11-console.html` was read by all three as the design conceding its own central claim. Two of the three raised the same consequence unprompted: recovery actions are performed in front of the audience.
3. **Progress is stated everywhere, not once.** On `03-ask-trivia.html` the same fact appears four times — `40 / 40`, a filled progress bar, a complete dot matrix with "✓ Everyone is in", and "All 40 answered" in the dock. `12-density-table.html` adds per-name checkmarks for a fifth. The claim of single-statement progress does not survive contact.
4. **`16-phase-wipe.html` is the best thing in the set.** Unanimous and enthusiastic. The full-width "VOTING IS OPEN — CHECK YOUR PHONE" band was the only element all three said beats their current tool outright.
5. **There is no timer and no visible way back.** Every dock across all sixteen states advances; nothing reopens a closed phase.

### Where they diverge

- **Verdict.** Ortiz splits — yes for her eight-person weekly on `d-table`, no for the forty-person offsite. Nkemdirim and Aldridge are unqualified nos. The split tracks audience size and stakes, not taste: the design degrades as the room grows, which is the opposite of the direction it claims to be optimised for.
- **Which failure is fatal.** Aldridge's is the vote screen's 7-page/10-second auto-rotation (`05-vote.html`) — a facilitation failure invisible to the other two, because neither runs live prioritisation for money. Nkemdirim's is the public naming of non-responders in the dock (`02`) and in the console roster — an HR and privacy problem invisible to the other two, because neither works in healthcare or runs 200-person hybrid all-hands. Ortiz's is craft legibility — the internal vocabulary leak ("Names in the Console" on `01-lobby.html`) that neither of the others even registered.
- **The gamification.** Aldridge objected to `10-ended.html` closing a strategy session on a leaderboard; Ortiz found the screen handsome and said nothing about its content; Nkemdirim didn't reach it. Whether "SESSION CHAMPION" is charming or off-key appears to depend entirely on whether the viewer is billing a client.
- **Density profiles.** Only Aldridge noticed that `d-call` and `d-room` render near-identically on `07`/`13`, and only he noticed the `SPACE` keyboard hint appears in `d-call` and `d-table` but not in `d-room` or `d-tv` — the two profiles where the operator is furthest from the keyboard.

### The one fix with the highest leverage

A private operator surface on a second device. It was Nkemdirim's stated single change, it dissolves Ortiz's "Names in the Console" leak and Aldridge's `⋯`-target complaint, and it converts the console from a thing the room watches you use into a thing the room never sees. Truncation is the more-cited problem and must also be fixed, but it is a layout bug with three untried levers; the console's visibility is an architectural choice that currently contradicts the design's own stated goal.
