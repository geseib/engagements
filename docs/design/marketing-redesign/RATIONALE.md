# Rationale — the marketing home and its related pages

Mockups: `index.html` lists them. `audit.html` checks them. This file says why
each page is shaped the way it is, and records the two decisions that shaped the
whole set.

---

## 1. The two decisions that shaped everything

### Joining stays in the hero

`/` is currently `RootPage`: a four-digit code entry and a sign-in aside. Turning
it into a marketing page takes that entry away from the one person who needs it
most urgently — somebody standing in a room where a session has already started,
holding a phone, with a number on the wall in front of them.

So the hero carries a compact `.jce` entry labelled **Have a code?**, above the
fold, at the same depth as the two calls to action. The full-page entry survives
at `/join` unchanged, which is where the QR codes point.

Rejected: putting join behind a nav link. A person who is late to a meeting does
not read a navigation bar. Rejected too: making join the hero's primary action —
the visitor this page is for is a team leader who has never seen the product, and
for them a four-digit box with nothing to type into it is a dead end.

`JoinCodeEntry` therefore has two presentations and one implementation. The
parse-a-pasted-join-URL behaviour, the pre-flight lookup and the "nothing is
running under that code" notice exist once, in one component, in both places.

### The scene is SVG, and it is SVG for a reason with a receipt

The hero art is four inline-SVG layers plus two CSS gradients. Nothing is
fetched: no image file, no webfont, no other origin, no `http(s)` URL anywhere in
this directory.

That is not a stylistic preference. The hero scene this replaces was removed
because it hot-linked three layer images from a third-party CDN nobody here
controls — unlicensed, on a screen only reachable behind Cognito, and one outage
away from a blank header. Three suites now fail if its class names return, which
is why every selector here is `.mk-ridge*` and no rule reuses a name from it.
`src/public/assets/art/CREDITS.json` states the rule the project already lives
by: serve from our own origin, and track provenance per file. Drawing the scene
satisfies both without a single file to track.

It also buys things raster could not: it is about two kilobytes, it is sharp on a
projector, and the route line and the climber marker are paths the page can move
along a scroll position later without a second asset set. The commissioned raster
set described by the art brief one directory up can still drop in behind it — the
layer names, the depths and the palette are the ones that brief specifies.

---

## 2. `01-home` — the climb

**For:** a team leader or facilitator who has never heard of this, arriving cold
on the bare domain.

**Must make them believe:** that a session built from *their own material* ends in
a decision and a document, and that running one is not a production.

The page is a climb, and the scene behind it is one continuous place rather than
a picture at the top: the ridge is `position: fixed`, the sections wash over it,
the route runs from base camp at the hero to the flag where the report is. The
narrative order is the spec's: the problem, the two shapes of round, your own
material, the room reacting, the summit.

**The hard rule that shaped it** is the art brief's contrast constraint, §4.
`#F4EDE4` measures **2.84:1** on `#C77B4A`. So the amber is boxed into the bottom
40% of the hero band, its focal bloom gathers behind the central summit, and the
headline lives in the top 55% where the field is `#0F1A2E` and the measurement is
14.97:1. A hero that looks superb and renders its own title illegible is a failed
hero; this one is built the other way round.

The second rule that shaped it is honesty. Trivia's own list says *"ask, then
results — trivia has no vote phase"*, because that is the easiest untrue sentence
to write about this product. The tally on the page keeps an answer that got zero
votes, and says why. Nothing on the page is called a rating, a score or a
preference; the report has votes.

## 3. `01m-home-mobile` — the same page at 390px

**For:** the same reader on a phone, which for a link shared in a chat is most of
them.

**Must make them believe:** the same thing, without a single sideways scroll.

Same markup, same classes; the file only forces mk.css's narrow branches on
inside a 390px column so the composition can be reviewed beside the desktop one.
Three decisions are visible here and nowhere else. The phone clip stacks **under**
the TV clip rather than shrinking beside it, because at this width the front-room
screen is the thing being explained and the player's phone is the follow-up. The
nav keeps **Sign in** and drops **Create a host account**, because nobody fills in
a registration form standing in a corridor and the hero's first button is that
same action anyway. And the route line, the climber and the flag are hidden under
720px: in one column they land underneath the buttons, and a dashed line crossing
a call to action is noise, not atmosphere.

**The hard rule that shaped it** is audit A1. The first cut of this file was a
fixed 390px frame inside a padded body, which pushed the document to 406px at a
390px viewport — a horizontal scrollbar on the page whose entire job is to prove
there is not one.

## 4. `02-how-it-works` — six steps

**For:** somebody who is interested and now wants to know what actually happens in
the room.

**Must make them believe:** that there is no setup, no install and no surprise —
six steps, and they can picture themselves doing each one.

Steps alternate sides. That is not decoration: it holds the copy column at a 48ch
measure while the clip slot stays large, and it stops six identical rows reading
as a table. Every caption names the slot id from §4.4 of the design spec, so
sub-project 2 records against this page rather than against a second list.

**The hard rule that shaped it** is honesty again, in its sharpest form: step 4
exists mostly to say what trivia does *not* do. A reader who has just seen step 3
will otherwise assume every round ends in a vote.

The display profiles get a short section at the foot rather than a step of their
own, because they are facilitator conveniences — the same session laid out for
the screen it is on — and promoting them to a step would imply four products.

## 5. `03-use-cases` — four scenarios

**For:** a reader who is convinced it works and is not yet convinced it is for
*them*.

**Must make them believe:** that a session like theirs already exists, and that the
difference between the four is the material, not the product.

Each block is a before / with pair, and only the "with" panel carries the amber
edge — marking both would turn the page into a comparison table, marking neither
would make it two paragraphs. Each names the **set type** it used, which is what
keeps three call-and-answer scenarios from reading as three separate features.
The same two CTAs repeat in every block, on purpose: a visitor sold by case three
should not have to scroll to the bottom to act on it.

**The hard rule that shaped it** is claim discipline. Every sentence here maps to
a behaviour listed in §5 of the design spec. No integrations, no scheduling, no
attendance tracking, no analytics — none of which exist.

## 6. `04-reports` — the annotated sheet

**For:** the reader who has understood the session and now wants to know what they
are left holding.

**Must make them believe:** that nothing said in the room is lost, and that the
document is worth circulating.

This is the only paper surface in the set, and markup and `data-theme="light"`
convert in the same change — dusk copy on this sheet measures 1.2:1, which is the
defect rule 9 of the design system's hard rules exists for. The numbered pins sit
*in* the paper and their sentences sit *outside* it, in their own column: an
annotation laid over the thing it annotates is how an earlier mockup set hid four
table rows behind an explanation of those rows.

**The hard rule that shaped it** is the amber-on-paper ban. `#F6A94C` is **1.84:1**
on `#FBF7F1`, so on this sheet amber draws the meter bars and the pin discs and
never carries a word; `--mk-amber-ink` (`#8a5300`, 5.93:1) says the vote counts and
the kicker, and the pin's numeral is `#0F1A2E` on amber at 8.86:1.

Callout 3 is where the honesty wording for the whole set gets settled: *the vote
count is a vote count*. Callout 6 explains its own absence — standings come from
the trivia rounds only, because a call-and-answer round has no right answer and
so has no score. Anonymity gets a heading rather than a line in a list, because it
is the first thing a facilitator asks about a retrospective tool.

## 7. `05-help` — the corpus with an address

**For:** a player who is stuck, and a host who wants to send somebody a link.

**Must make them believe:** that the answer is one click away and did not require
signing in to find.

The sidebar mirrors the existing `HELP_ROLES` corpus and the URL shape
`/help/<role>/<guide>`, so a deep link and a sidebar click land in the same place
and an unknown id falls back to the role index rather than a blank page. The
modal `HelpSystem` and every `HelpButton` entry point are untouched; this page
renders the same corpus through the same renderer and only gives it an address.

**The hard rule that shaped it** is the one about muted text. A guide is read end
to end, so its body is `--mk-text`; `--mk-muted` is reserved for the two asides.
Muted body copy is how a help page becomes a help page nobody finishes.

---

## 8. Two things the audit cannot see, and what was done instead

**The scene is not an ancestor.** `bgOf()` walks the DOM chain compositing alpha.
The ridge is a fixed sibling, so for anything sitting over it the audit measures
the wash over the page background rather than over the glow. The hero join card
was therefore measured by hand against the worst case — its `rgba(27,41,66,0.82)`
composited on *pure* `#F6A94C` — where `--mk-muted` lands at **4.26:1**, under AA.
That is why every word inside `.jce` is `--mk-text` (8.81:1 in the same stack) and
why no muted or blue text is used anywhere over the scene's bottom band. The four
section washes were checked the same way and all clear AA over pure amber.

**Specificity beat intent, and A4 caught it.** `.mk-root a { color: var(--mk-blue) }`
is 0,1,1; every component rule in mk.css is 0,1,0. The blanket rule therefore won
against all of them regardless of order, and painted the primary button's label,
the nav links and the report's buttons blue — **1.25:1** on amber and **2.46:1** on
paper. The fix is to scope the generic link colour to prose
(`.mk-root p a, .mk-root li a, .mk-root dd a`) and to add an explicit paper
override. Recorded here because it is the kind of defect that survives every
component test: jest maps CSS to `identity-obj-proxy` and loads no stylesheet, so
the collision exists only in the bundle.
