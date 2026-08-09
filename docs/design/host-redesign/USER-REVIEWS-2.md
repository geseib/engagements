# Host screen redesign — second-look reviews

The same three people who reviewed the sixteen mockups in revision 2 were brought back for revision 3. Two of them had said they would not run it. They were shown twenty-one mockups and nothing else — no spec, no critique, no source, and no changelog. They were not told what had been fixed. Each viewed the display profile matching how they would actually use the product, at 1920×1080 and 1280×720, and each was asked to name their prior objection out loud before looking for it. Their reactions are below, in their own words, followed by a researcher's read.

---

## Maya Ortiz — VP of Product, ~900-person B2B software company

*Viewed `d-table` and `d-room` at both sizes.*

### The objection I came back to check

I said one thing last time and I said it in italics: never truncate body content, ever. And I said the design had already proved it didn't need to, because `07-results-trivia.html` rendered the same six options in full that `03-ask-trivia.html` was chopping.

`03-ask-trivia.html` now renders all six options in full. Every profile I tried. In `d-room` at 1920 the question runs its full five lines and A through F all finish their sentences — "Migrating the installed base from seat-based licensing to usage-based billing," full stop, no ellipsis. In `d-table` it drops to one column and the rows get *shorter*, not clipped. And the case I specifically said I would not stand in front of my CPO for — `14-density-tv.html` at 1280, where five of six were cut mid-word — is clean. Six options, all whole.

So yes. Fixed. That is the answer and I'm not going to hedge it.

I also want to name something I did not ask for and think is better than what I asked for. At 1280, `07-results-trivia.html` shows four options and then says, in plain words at the bottom: *"Explanation · Options E–F — in the session report."* That is the difference between a product and an internal tool. It ran out of room, it made a decision, and it told me what the decision was. I can say that sentence out loud to a room. I could never say "the screen ate it."

### Where it still does the old thing

Two places, and one of them is bad.

**`10-ended.html` truncates a person's name.** The last screen of the session, sixty-point type, and it reads **"Aleksandra …"**. Her name is Aleksandra Wiśniewska. The tile is 378 pixels wide and the name needs 635, and there is about four hundred pixels of empty gradient sitting under the tile while it does that. This is the exact defect, the exact aggravating factor, and now it is happening to a colleague's name on the screen that is up while people are putting their coats on.

I want to be precise about why this bothers me more than the original bug did. The original bug was a fitter that stepped down the wrong axis. This is `text-overflow: ellipsis` and `white-space: nowrap` still sitting in the stylesheet, on a name, in 2026. It tells me the rule wasn't adopted. It was applied to the screens that got audited.

**The event title is still ellipsed on every single screen.** "Q3 Leadership Offsite — Pricing Strategy & C…" in `d-room`, "Q3 Lead…" in `d-tv` at 1280 — that is the literal string I quoted in my last review, unchanged. On `09-field-notes.html` at 1280 it is worse: the title gets about fifty pixels and the rest is gone. I accept that a header slot has to end somewhere. I do not accept that it ends at fifty pixels while `14-density-tv.html` has the phase chip, the category, "QUESTION 4 OF 10" and a join URL all sitting comfortably beside it.

### The rest of my list

- **Timer: exists, and it's done right.** `11-console.html` has ROUND TIMER — Off / 2:00 / 3:00 / 5:00 — with one line under it: *"A countdown appears in the header. It never advances the round on its own."* That sentence is the whole reason I'll turn it on. `02-ask-call-and-answer.html` shows it live as a small `2:14` chip in the header. It doesn't shout, it doesn't pressure the room, and I can look at it instead of at the dot grid.
- **Progress: fixed.** `03-ask-trivia.html` used to say the same fact four times. It now says `40 / 40` in the meter and "Safe to move on" in the dock, and those are two different statements — one is a number, one is advice. `12-density-table.html` is the busiest at three, and on a laptop among eight people I don't mind the roster.
- **"Names in the Console" is gone from `01-lobby.html`.** So is the word Console. The affordance is labelled `⋯ SETUP` and the panel is headed SESSION SETUP. Nobody in the room needs to learn a proper noun.
- **`04-ask-wavelength.html`:** "Pricing power" is now roughly a third of the screen instead of an eighth. That's a real fix.
- **Still no way back into a closed round.** There are step-backs now — `‹ Hide again` on `21`, `‹ Results` on `09`, `‹ Join screen` on `19` — and they're all display beats. If I hit `Show Results` while three people are typing, `07-results-trivia.html` offers me `Next Question` and nothing else. I understand the argument that reopening a vote is a data question, not a display question. I'd still like the software to say so on the screen rather than leave me looking for a button.
- **`Sign out` is still at the bottom of the setup panel, one stop from `Report a problem`.** I said move it. It didn't move.

### Would I put it in front of my leadership team?

**Yes to both now. Yes to the Monday staff meeting without reservation, and yes to the quarterly offsite with one bug filed as a blocker.**

The thing that made the offsite a no was that forty people, half of them peers who build software, would watch the screen abbreviate the choices they were being asked to make. That does not happen any more, at either size, in any profile I looked at. That was the whole objection and it's gone.

The blocker is `10-ended.html`. I am not closing a four-hour offsite on a screen that has mangled someone's surname. Fix the tile — let it wrap to two lines, there is a screen's worth of room — and I'll run it in October. In the meantime I'd type a short event title on purpose, which is a workaround I resent having to know about.

### What would still embarrass me

Aleksandra reading her own name cut in half at sixty points while everyone claps. Second: someone asking what the session was called and me having to say it, because the header says "Q3 Lead…".

### On anonymity

I didn't ask for this and I'd keep it.

My staff meeting has a specific pathology: I say a thing, and then seven people say versions of my thing. `06-results-call-and-answer.html` ranking the answers with *"Ranked on merit — nobody knows whose is whose yet"* in the dock is a direct hit on that. It's the meeting-design intervention I've been trying to run manually with index cards.

What convinced me it was built by someone honest is the caveat in `20-setup.html`: *"This hides names, not identities. In a small room, a handful of answers and a known guest list can still give someone away — and a distinctive turn of phrase always will. Treat it as removing the label, not as a promise of secrecy."* That is true, it is inconvenient to say, and they said it in the product instead of in a help doc. In a room of eight it hides almost nothing and the screen knows it.

Default on, yes. I'd want it for polls too, and `20-setup.html` says it applies to Call & Answer, Poll and Survey, so that's covered.

### `20-setup.html`

I could configure a session from this cold, in under a minute, and I'd be right about what I'd get. Title, format, question set, categories, two toggles, Create. The anonymity block explains itself with a before/after example — "RESPONSE 1" on the left, "Priya Raghavan · +180 pts" on the right — which is better than any tooltip.

What's missing:

- **No timer here.** The timer lives only in the in-session panel. I want to arm it while I'm planning, not while forty people watch me open Setup.
- **No scoring switch.** Standings appear on `07` and `21` and a champion tile on `10`. There is no way on this screen to say "this is not a quiz."
- **Nothing about length.** 47 questions in the set, eight rounds in the header — I can't tell from this screen how long the thing runs.
- **"New engagement."** That's an internal noun. It's on my screen and not the room's, so it's a nit, but it's the same nit as "Console" was.

### The reveal, `06` → `21`

It lands for me and I'd stage it. The dock does the work: *"Ranked on merit — nobody knows whose is whose yet"* with an amber **Reveal who wrote these**, and after, *"Results are on screen"* with **‹ Hide again** sitting there. The kicker flips from "STILL ANONYMOUS" to a pill reading "NOW ATTRIBUTED", the bylines appear under each answer, and the standings column slides in on the right. That's four simultaneous signals, which is the same trick `16-phase-wipe.html` uses, and it works.

`‹ Hide again` is the detail I like most. It means I can reveal, get the reaction, and put the lid back on while we discuss. Nobody builds that.

The bylines are set at about twenty pixels. That's the room floor. On the screen whose entire purpose is those twenty pixels, I'd have expected the design to spend more.

### The phone remote, `17-remote.html`

Yes, and I'd use it for the offsite and not for the staff meeting. On my laptop at a table I'd rather have one screen. Standing at the front of a room for six hours, I want the controls in my hand.

The bit that sold me is a sentence, not a control: *"Optional, never required."* I've been burned by tools that quietly require the companion app.

---

## Rachel Nkemdirim — Chief of Staff, mid-size healthcare organization

*Viewed `d-call` throughout, because that is how two hundred people see it.*

### My objections, in order, and what happened to them

I had four and I'll take them one at a time, because three of them are gone and I want to say so before I say the rest.

**1. "The console tells me it isn't private."** Gone. `11-console.html` opens with a heading that says SESSION SETUP and a close button. There is no apology caption. There is no roster. There is no email address. And the drawer stops at the top of the dock, so `Start Voting` is still sitting there in amber, live, while the panel is open — I can fix something and advance without closing anything.

More than that: the panel has a line in it, under DISPLAY, that reads *"Who has not answered yet, by name, is only ever shown there — never here, and never on the stage."* Somebody read my complaint and turned it into a written rule. That is not nothing.

**2. "The dock names and shames."** Gone. `02-ask-call-and-answer.html` now says, bottom left, *"Some are still answering."* That's it. Four words, no names, and it tells me exactly what I need — that I shouldn't advance yet. Dana, Tomás and Jordan are not on the wall. Our clinical staff answer late because they are with patients, and now the screen doesn't editorialise about it.

**3. "The question doesn't fit."** Gone, and this is the one I checked hardest, because `d-call` was cutting earlier than `d-room` and my remote half is already the disadvantaged half. The whole prompt is on `02` at 1920 in `d-call` — all the way to "inside your own function on Monday?" — plus the two-line instruction under it. And `06-results-call-and-answer.html`, the screen whose job is to remind people what was asked, carries the full recap.

**4. "No timer."** There now. `2:14` in the header on `02`, armed from the panel, and the panel says it never advances the round by itself. In a hybrid all-hands, silence is my enemy, and a clock the room can see does half my facilitation for me.

### The thing I actually asked for

I said: give me a private operator view on a second device, and most of my other objections shrink to nits. `17-remote.html` is that, and it is better than what I described.

It has the roster — Dana, Tomás, Jordan, Yuki, Kofi, Elena, Henrik, Rosa, eight names, on my phone, where two hundred people cannot see them. It has the round controls, the timer, the question picker. The bottom bar says *"14 people are still voting"* and the button says **"Tap again to show results"** — a two-tap confirm, which is the correct design for a device that lives in a pocket next to my hip.

And it argues for itself in writing: *"Who has not acted yet is a different fact from who wrote what. This list is safe to hold during an anonymous round; authorship is not, so it is not here either — the server has not sent it to anyone."* I have sat through vendor demos where nobody could answer that question. Here it's printed under the roster.

What it doesn't have: a step back. The setup panel's key legend mentions *"← step back a beat"*, but there's no back control on the phone. If the remote is the surface I'm supposed to live on, the recovery action has to be on it, or I'm reaching for the laptop in front of the room — which is the thing we were solving.

### What stopped me, and it's serious

**`16-phase-wipe.html` shows who wrote what.**

This is the screen I called the single best thing in the entire set. Full-width band, "VOTING IS OPEN — CHECK YOUR PHONE", solves half my hybrid problem. It is still the best screen here.

It is also, right now, the screen that breaks the anonymity promise. Behind the band, on the ballot, response 1 carries **"Priya Raghavan"** and response 2 carries **"Wes Duncan"**. On `05-vote.html` those same two slots say "RESPONSE 1" and "RESPONSE 2", and the kicker across the top reads *"ANSWERS ARE ANONYMOUS UNTIL THE VOTE CLOSES."* On `16` that kicker is absent and the names are present.

So at the exact moment voting opens — the moment with the loudest possible signal on it, the moment every one of two hundred faces is pointed at the screen — the product shows the room the two things it just promised to withhold. Then it hides them again a beat later.

I found that in about ten minutes, on the one screen I already liked. I'm not able to conclude it's the only one.

**And the written rule isn't a rule.** The panel says names are shown on the phone, "never here, and never on the stage." `12-density-table.html` is a stage profile, and it lists ten people with tick marks — Priya Raghavan ✓, Marcus Ola ✓, and then Sam Okafor and Ingrid Solberg with a dot, meaning they haven't answered — plus "+ 30 more". I understand the reasoning: it's a laptop, three to five people, they can see each other. But then the sentence in the panel is not a guarantee, it's a description of three profiles out of four, and I have to know which profile I'm in to know whether the promise applies. Guarantees don't work like that.

**And the locked-door screen got worse.** I said last time that `15-edge-minimum.html` — nobody has answered, primary greyed out — was my second-worst fear, a locked door with a cute sentence on it. At 1280 in `d-call` the cute sentence now reads: *"Nobody has answered yet — the join cod…"* It is cut off. The one line whose entire job is to stop the room thinking the software is broken is itself broken. There is a `Show join code` button next to it now, which is a real improvement, and I'd never get to read why I should press it.

### Would I put it in front of my leadership team?

**Yes to the executive meeting. Not yet to the two-hundred-person all-hands.**

That's a change and I want to be clear it's a real one. Last time I said no to both, and the reason was architectural: every recovery action was an action the audience watched me take. That is no longer true. The controls are on my phone, the wall shows only content, the console holds nothing embarrassing, and the dock stopped narrating who was late. The shape of this is now right, and it is right in a way Mentimeter isn't.

The all-hands is a no for two reasons and both are fixable. First, `16-phase-wipe.html` puts two names on two answers during an anonymous vote, and until that is fixed I cannot stand up and tell two hundred people their answers are anonymous. In healthcare I would be making a promise on behalf of the organisation. Second, I still cannot press anything. These are pictures. I have never seen the remote pair with the stage, never seen what happens when the wifi drops between them, never seen the console open on a Teams share. I said last time I'd need two rehearsals. I still would, and now I'd want the first one on the real hardware in the real room.

### What would still embarrass me

Telling the room their answers are anonymous and then `16-phase-wipe.html` putting Priya's name on Priya's answer, in orange, three feet tall, at the exact second everyone looks up.

### On anonymity

This is the most valuable thing in the release and it is the thing I most need fixed.

My all-hands has a structural problem that has nothing to do with software: nobody contradicts the Chief Medical Officer by name in front of two hundred colleagues. Anonymous responses is the first feature I've been shown that addresses it directly. `06-results-call-and-answer.html` — three answers ranked by what the room actually backed, no authors, no standings, and the dock reading *"Ranked on merit — nobody knows whose is whose yet"* — is what I have been trying to achieve with anonymous survey tools and a two-week delay.

"Nobody sees who wrote what, including you" helps me. It removes a decision I currently have to make badly in real time — whether to name the person who said the brave thing. During the round I don't want to know. Afterwards, at `21`, I do, and that's exactly where it's offered.

I would leave it on by default. I'd go further: I'd want it announced. `19-how-to-play.html` gets four lines on the stage in front of everyone — a prompt appears, answer on your phone, everyone votes, we put the top three up — and not one of them mentions that the answers are anonymous. That is the single most persuasive thing you could tell a room of clinicians before you ask them to be honest, and it's the one thing the explainer leaves out. `01-lobby.html` doesn't say it either. The only places anonymity appears are mid-round kickers on `05` and `06`, by which point people have already decided how candid to be.

### `20-setup.html`

Yes, I could run this cold, and that surprised me given I said no to everything else last time. Six decisions, sensible defaults, one screen, no wizard.

Missing, for me:

- **Who can join.** Nothing on this screen tells me whether the session is open to anyone with the code. For a healthcare all-hands I need to know that before I create anything.
- **The timer.** It's only in the in-session panel. I plan my all-hands to the minute a week out.
- **Retention.** Where do the answers live, for how long, and who can pull the report? `06` says "37 more responses in the session report" — I need to know who can open that report before I promise anonymity to two hundred people. That question will be asked by someone in compliance and "I'll find out" is not an answer I can give twice.

### The reveal, `06` → `21`

It lands, and the credit goes to the dock, not the stage. **Reveal who wrote these** is an unambiguous sentence sitting where the primary action always sits. I know what pressing it does. The room can read it too, which I like — it means the reveal is something I announce rather than something that happens.

Afterwards, `21` annotates each answer in place — "Priya Raghavan · +200 pts" under the winning one — and the standings column appears on the right. Would a room *notice*? The bylines are small and they slot in under text that was already there. The standings column arriving is the loudest change, and it's the one I care least about.

I'd want what `16-phase-wipe.html` does for phases: a band across the screen that says these answers now have names on them. Use the mechanism you already built, on the beat that most needs it.

---

## Tom Aldridge — Partner, strategy consultancy

*Viewed `d-room` at 1920 and 1280, the way it lands on a client's projector.*

### The vote screen

I'll start where I stopped last time, because that is where my afternoon fell apart.

`05-vote.html` no longer rotates. It says, at the bottom: **"RESPONSES 1–3 OF 20 · PAGE 1 OF 7 · ↑ ↓ TO PAGE."** Manual. With a dot indicator so I know where I am in the set. Each answer carries a number in the margin — 1, 2, 3 — and a stable label, "RESPONSE 1", underneath. And the question being voted on is back on the screen, in full, above the ballot.

That is my single change, delivered in full, including the part I asked for last and expected least. I can now say "let's talk about number six" and press down twice and there is a six, and it stays there while forty people argue about it. The room's shared attention was the deliverable and I have it back.

What I did not get is Mentimeter's actual advantage, which is twenty items visible at once. Three per page at 1920, seven pages. Manual paging makes that liveable — it converts a disaster into a limitation — but if a client says "put six and eleven side by side" I still can't. And the page is not full while it does this: at 1920 there's a strip of empty gradient under the third card. Four per page would cost nothing.

### The rest of my list

- **Truncation.** `03-ask-trivia.html`, my exhibit, renders all six options complete, and `09-field-notes.html` finishes its sentence — "Worth asking why the cheap moves were also the popular ones." That was an amputated AI insight and now it's an insight. At 1280 `07-results-trivia.html` shows four options and prints *"Explanation · Options E–F — in the session report"*, which is the right answer: a stated reduction rather than a silent one. I can read that line out loud.
- **"Workie's read on the room" is gone.** The screen is now headed **WHAT WE HEARD** and the phase chip matches. That's exactly what I asked for and it removes a fifteen-minute detour about what the model is.
- **`10-ended.html` leads with the conclusion.** "WHAT THE ROOM DECIDED — Hold price. Fix the story before the discount." The scoreboard is demoted to a small tile labelled "Most-backed contributor". That is a framing fix, not a cosmetic one, and it is the difference between a strategy tool and a quiz.
- **`08-results-wavelength.html` is better and still wrong.** "Discounting" is now a hundred and forty-five points and reads from anywhere. The tail — Margin, Scarcity, Terms, Rebates, Waterfall, Elasticity — sits at twenty pixels, which is the stated room floor, so nothing is technically undersized. But content ends a third of the way down the screen and the bottom fifty-four per cent is empty gradient. There is no reading of that layout where six terms at the legibility floor and half a projector doing nothing is the right trade. This is still the crescendo of a word round and it still looks like a page that gave up.
- **The `SPACE` hint is now in `d-room`.** It was in table and call and missing from the two profiles where I'm furthest from the keyboard. Fixed. And the setup panel carries a full key legend — space or → advance, ← step back, ↑↓ page the ballot, `\` open and close. I'd want that legend above the fold; at 1920 it's below the scroll in the panel, which means the operator most likely to need it is least likely to find it.

### What I found that's new and bad

**`10-ended.html` truncates a name.** "Aleksandra …" — sixty-point type, in a tile, with the rest of the screen empty. It's a client's staff member, on the final artefact of a paid engagement. The one rule was that content is never abbreviated on the stage, and the last screen abbreviates a person.

**The event title is a stub.** "Q3 Leaders…" at 1280 in `d-room`, and on `09-field-notes.html` it's down to about four characters. My event titles are client names and workstream names. If the header can't hold them it should drop the title, not amputate it — an empty slot reads as restraint, a chopped one reads as a bug.

**`18-question-browser.html` is a spoiler surface.** It's well built — filters, unasked-only, "Ask again" greyed for questions already used, and a note explaining that correct answers are deliberately absent because the stage is shared. All correct. But it puts eight upcoming question titles on the projector, dimmed but legible, while I browse. In a workshop where the sequence is the method, that's showing the client my hand. The phone version in `17-remote.html` is the one I'd use, and I'd want the stage version to blank the stage rather than dim it.

**A number doesn't add up.** `05-vote.html` says "RESPONSES 1–3 OF 20". `06` and `21` both say "37 MORE RESPONSES IN THE SESSION REPORT", which makes forty. Twenty or forty. It's a mockup and it's a detail, and details are what my clients pay me to notice.

### Would I put it in front of a client?

**Yes — for a working session, on the terms below. Still not for a flagship.**

That's a flip and I don't make it lightly. The two states I said I could not run, I can now run. The ellipsis is off the question and the options. The ballot holds still and the items have numbers. The AI has a professional name. The session ends on what the room decided instead of on a leaderboard. Every single thing I listed as fatal has been addressed on its merits rather than argued with.

My terms:

1. **I drive from the phone.** `17-remote.html` is the surface, the projector shows content only, and I never open a panel in front of the room.
2. **A short event title,** because the header will eat a real one.
3. **No wavelength rounds** until `08` uses the bottom half of the screen.
4. **Either `16-phase-wipe.html` gets fixed or I don't promise anonymity.** More on that below.
5. **Somebody fixes `10-ended.html` before I run the closing screen,** or I skip it and go straight to the report.

Flagship — the big annual one, the one where a managing partner is in the room — needs those five to be four fewer.

### What would still embarrass me

The last slide of a four-hour engagement showing a client's employee as "Aleksandra …". It's a small bug and it happens at the one moment everyone is looking at the screen and nobody is looking at the data.

### On anonymity

It's the best idea in the release and I would not have asked for it, which is the highest compliment I have.

Here's why it matters in my work. I run prioritisation with a client's own leadership in the room. The reliable failure mode is that the two most senior people's ideas get funded because they are the two most senior people. `06-results-call-and-answer.html` — three answers, ranked by votes, no bylines, no standings, and *"Ranked on merit — nobody knows whose is whose yet"* in the dock — is the intervention I currently achieve by making everyone write on index cards and collecting them myself. It costs me fifteen minutes and it always leaks, because I recognise the handwriting.

"Nobody sees who wrote what, including you" — my first reaction was that it hobbles me, because steering a discussion sometimes means knowing who to bring in. My second reaction, after reading the note on `17-remote.html`, is that it doesn't: *"the fact a facilitator actually needs — who has not acted yet — is not the fact anonymity withholds."* That is exactly right and I hadn't separated those two things myself. I need to know that eight people haven't answered. I do not need to know which of them wrote the brave answer, and knowing it changes how I run the next ten minutes.

Default on. And `20-setup.html` lets me turn it off, which I'd do for a named-commitment exercise where attribution is the point.

The thing that stops me promising it: `16-phase-wipe.html`. Behind the "VOTING IS OPEN" band, response 1 says "Priya Raghavan" and response 2 says "Wes Duncan", and the anonymity kicker that `05-vote.html` carries is missing. So on the transition into an anonymous vote, the authors are on the wall. If I have told a room their answers are anonymous and that screen goes up, I have misled a client. Anonymity has to be an invariant of the data, not a property of individual screens, and one screen out of four disagreeing tells me it's currently the latter.

### `20-setup.html`

I could configure this cold and I'd get what I expected. It's the clearest screen in the set — five formats as a single row of chips, question set, categories, two toggles with their consequences written out, Create.

The anonymity block is genuinely well-written. Two example cards side by side, "WHILE VOTING" and "AFTER YOU REVEAL", showing the same answer with and without its byline. And then this: *"This hides names, not identities... Treat it as removing the label, not as a promise of secrecy."* A vendor telling me the limits of their own feature, on the configuration screen, before I've bought anything. I will remember that.

What's missing for me:

- **No way to turn scoring off.** Standings on `21`, standings on `07`, a contributor tile on `10`. I asked for the scoreboard to be a footnote and it now is — but in a strategy workshop I want it absent, and this screen won't do it.
- **No timer.** It's in the in-session panel only. I set my timings the night before, in the room, with the AV person.
- **No structure.** How many rounds, how long, in what order. "Shuffle the question order" is on by default, which for a workshop with a designed arc is exactly backwards. I'd want it off by default for Call & Answer and on for trivia.
- **No branding.** I put a client's logo on everything I show them. There's nowhere here to do it.

### The reveal, `06` → `21`

It lands for me because the dock does it in words: **Reveal who wrote these**. That is a sentence I say out loud — "right, let's see who wrote these" — and then press. The pause between `06` and `21` is a facilitation beat and the design has given it a button.

`21` earns it. Each answer keeps its number and its votes and gains a byline — "Priya Raghavan · +200 pts" — and the standings column arrives on the right. Nothing moves, nothing re-ranks, nothing animates away from what people were reading. That restraint is correct.

Is it obvious to a room that anonymity just ended? Moderately. The pill changes from "STILL ANONYMOUS" to "NOW ATTRIBUTED", which is the clearest signal, and it's a small chip in the top-left of the content area. The bylines are at the room floor. You have a mechanism for exactly this — the full-width band in `16-phase-wipe.html` — and you didn't use it on the one beat in the product where a guarantee is being deliberately withdrawn. Use it.

`‹ Hide again` is a lovely control and I would use it constantly.

### The phone remote, `17-remote.html`

Yes. This is the highest-leverage thing in the release and it dissolves three of my complaints at once — I no longer have to hit a thirty-pixel `⋯` target with a clicker in one hand, the room no longer watches me hunt, and the correct answers live somewhere the projector isn't.

The browse screen is right: full question text, the four options, **CORRECT** flagged in green, "Ask this next". And *"Correct answers appear here and nowhere else. The stage lists the same questions without them."* That's the rule stated where it applies.

A second device is not a burden for me — I already carry a clicker and a timer and my phone. It's one fewer object. The one thing I'd need before a paying room: what happens when it drops. There's a green LIVE dot in the header, which suggests someone thought about it, and no screen showing me what the disconnected state looks like. That's the state I'll actually meet.

Also, the mockup page itself overlaps the two phone frames — the right-hand one sits on top of the left and clips its edge. Trivial, but it's the second time I've read a screen in this set where something is cut off by something else.

---

## Researcher's read

### What changed their minds

**All three verdicts moved, and one moved to an unqualified yes.**

| | Revision 2 | Revision 3 |
|---|---|---|
| **Ortiz** | Yes for the 8-person staff meeting; **no** for the 40-person offsite | **Yes to both**, with `10-ended.html` filed as a blocking bug |
| **Nkemdirim** | **No** to everything | **Yes** to the exec meeting; **not yet** to the 200-person all-hands |
| **Aldridge** | **No**, not with a paying client | **Yes** to a working session on five stated terms; **no** to a flagship |

Every evaluator named their own prior objection first and then went looking for it. What moved them, in order of how much work each fix did:

1. **Truncation, on the exhibits they chose themselves.** Ortiz went straight to `03-ask-trivia.html` and `14-density-tv.html` at 1280 and found six complete options in both. Aldridge found `09-field-notes.html` finishing its sentence. Nkemdirim found the full prompt on `02` in `d-call`, the profile that was cutting earliest. This was the shared primary objection and it is gone from the ask, vote and results bodies in all four profiles at both viewports. A programmatic sweep across eighteen mockups × four profiles × two viewports confirms it: no body content is clipped anywhere.
2. **The stated reduction.** Unprompted, two of three singled out `07-results-trivia.html` at 1280 printing *"Explanation · Options E–F — in the session report"*. Ortiz called it "the difference between a product and an internal tool"; Aldridge said "I can read that line out loud." Neither asked for it. Telling the operator what was dropped converted the reduction from a defect into a feature.
3. **The phone remote.** `17-remote.html` was Nkemdirim's stated single change and it was flagged in the last report as the highest-leverage fix available. It performed as predicted: it flipped her from architectural rejection to conditional acceptance, and it resolved Aldridge's `⋯`-target complaint and Ortiz's private-controls concern as side effects. Its written rationale — *"who has not acted yet is a different fact from who wrote what"* — persuaded Aldridge of something he had not worked out himself.
4. **The dock stopped narrating.** `02-ask-call-and-answer.html` reading "Some are still answering" instead of naming three colleagues removed Nkemdirim's HR objection entirely, in four words.
5. **The console became boring.** No apology caption, no roster, no email, a close button, and the drawer stopping at the dock so the primary action stays live. All three registered it; none had anything further to say about it, which is the outcome you want.
6. **The timer, and specifically its sentence.** *"A countdown appears in the header. It never advances the round on its own."* Ortiz said that sentence is why she'd turn it on. All three had asked for a timer; none had asked for the guarantee, and it is the guarantee that got adopted.
7. **Naming things properly.** "Workie's read on the room" → **WHAT WE HEARD**. "Names in the Console" → gone, along with the word Console. `10-ended.html` leading with "WHAT THE ROOM DECIDED" and demoting the champion to a footnote tile. Aldridge called the last one "a framing fix, not a cosmetic one."

### What still blocks

**One defect is cited by all three, and it is the same class of defect that got the design rejected the first time.**

`10-ended.html` renders "Aleksandra Wiśniewska" as **"Aleksandra …"** — `text-overflow: ellipsis; white-space: nowrap`, 635px of content in a 378px box, at 42–61px type, with roughly 40% of the screen empty below it. It fires in `d-room`, `d-call`, `d-table` and `d-tv` at 1920 and in three profiles at 1280. Ortiz's reading is the one that matters: "It tells me the rule wasn't adopted. It was applied to the screens that got audited."

Three further live clips, all found by sweep and all confirmed on screen:

- **The event title is truncated on every screen, in every profile, at both viewports.** Worst cases: `09-field-notes.html` at 1280 allots ~50px of the 747px needed; `14-density-tv.html` at 1280 renders "Q3 Lead…", the literal string Ortiz quoted in her first review.
- **`15-edge-minimum.html` at 1280 clips the sentence explaining its own disabled button** — "Nobody has answered yet — the join cod…" — in `d-room`, `d-call` and `d-tv`, and at 1920 in `d-tv`. This is the screen Nkemdirim called her second-worst fear, and the fix (a `Show join code` secondary) is now sitting next to an explanation nobody can read.
- **Dock status lines clip** on `21-results-revealed.html` at 1280 ("Results are on scr…") and marginally on `06` in `d-tv`.

Remaining, by evaluator:

- **Ortiz:** no way to reopen a closed answering phase (step-backs exist, but only for display beats — `‹ Hide again`, `‹ Results`, `‹ Join screen`); `Sign out` still adjacent to `Report a problem`; reveal bylines at the 20px room floor.
- **Nkemdirim:** cannot press anything — still pictures, still needs two rehearsals, now on real hardware; no step-back on the remote, so the one recovery action drives her back to the laptop; nothing anywhere about data retention or who can open the session report.
- **Aldridge:** `08-results-wavelength.html` still runs 54% empty with six terms at the legibility floor; `05-vote.html` still shows 3 of 20 per page when there is room for 4; `18-question-browser.html` puts upcoming question titles on the projector; no way to switch scoring off; response count inconsistent between `05` (20) and `06`/`21` (3 + 37).

### On anonymity

**Unanimous, enthusiastic, and unanimously undermined by one screen.** This is the cleanest result in the study: three evaluators who did not ask for the feature all independently described it as solving a problem they already had, and all three would ship it default on.

They value it for three different reasons, which is the strongest evidence that it generalises:

- **Ortiz** — a status problem. "I say a thing, and then seven people say versions of my thing."
- **Nkemdirim** — a hierarchy problem. "Nobody contradicts the Chief Medical Officer by name in front of two hundred colleagues."
- **Aldridge** — a seniority-capture problem in prioritisation. "The two most senior people's ideas get funded because they are the two most senior people."

The "including you" property was the one the brief expected to split them. It did not. Nkemdirim said it *removes* a judgement call she currently makes badly in real time. Aldridge's initial instinct was that it hobbled him and he reversed himself after reading the note on `17-remote.html` separating "who has not acted yet" from "who wrote what" — he described that distinction as one he had not made himself. The design's own argument won the objection.

Two of three volunteered praise for the caveat in `20-setup.html` — *"This hides names, not identities... Treat it as removing the label, not as a promise of secrecy"* — as the reason they trusted the rest of the feature. Stating the limit bought the claim.

**And then:**

> **`16-phase-wipe.html` shows author names on the ballot during an anonymous vote.** Response 1 carries "Priya Raghavan", response 2 carries "Wes Duncan", and the *"ANSWERS ARE ANONYMOUS UNTIL THE VOTE CLOSES"* kicker that `05-vote.html` carries in the same slot is absent.

Two of three found it independently, on the screen every evaluator in both rounds has named the best thing in the set. Nkemdirim: "at the exact moment voting opens — the moment with the loudest possible signal on it — the product shows the room the two things it just promised to withhold." Aldridge: "if I have told a room their answers are anonymous and that screen goes up, I have misled a client."

A second, quieter contradiction supports their reading. `11-console.html` states, under DISPLAY: *"Who has not answered yet, by name, is only ever shown there — never here, and never on the stage."* `12-density-table.html` is a stage profile and it names ten people with answered/not-answered marks, including two who have not answered, plus "+ 30 more". The rationale (a laptop among three to five people who can already see each other) is defensible; the written guarantee that contradicts it is not. Nkemdirim: "Guarantees don't work like that."

Both evaluators who found the leak drew the same conclusion, in nearly the same words: **anonymity is currently a property of individual screens rather than an invariant of the data.** Aldridge's phrasing is the one to design against.

Two smaller notes with unanimous support:

- **The room is never told.** `19-how-to-play.html` spends 38 words on the stage explaining the format and does not mention anonymity. `01-lobby.html` doesn't either. The only statements are mid-round kickers on `05` and `06`, by which point participants have already decided how candid to be. Nkemdirim: "That is the single most persuasive thing you could tell a room of clinicians before you ask them to be honest."
- **The reveal is under-signalled for what it is.** All three thought `06` → `21` lands, and all three credited the dock — **Reveal who wrote these** is a sentence a host says out loud before pressing. Two independently proposed the same fix: the beat where a guarantee is deliberately withdrawn is the beat that most deserves the full-width band from `16-phase-wipe.html`, and it's the one place the mechanism isn't used. `‹ Hide again` drew unprompted praise from two of three.

### The single highest-leverage fix

Make anonymity an invariant rather than a per-screen decision — starting with `16-phase-wipe.html`, and reconciling the console's written promise with what `12-density-table.html` actually shows. It is the only remaining defect that can cause harm in a live room rather than embarrassment, it is the one thing standing between Nkemdirim and the all-hands, and it is the fourth of Aldridge's five terms. The truncation residue in `10-ended.html` and the header title is the more-cited problem and the bigger credibility hit — Ortiz's "the rule wasn't adopted, it was applied" is the sentence to take away — but it is three CSS declarations. The anonymity leak is a correctness question about what the server sends and when, and the product has already written the right answer down on `17-remote.html`: *"the server does not send it until the host reveals."* One screen didn't get the message.
