# Multi-tenant Engage — why these screens look like this

Eleven mockups in this directory. Open `index.html`, or serve the whole design
tree: `python3 -m http.server 8124 --directory docs/design` (`.claude/launch.json`
has it as **all-design-mockups**). Press **N** on any page to hide the design
notes — that is the state to judge a screen in.

**These files are the design.** Where this document and the rendered page
disagree, the page is what was decided.

---

## 1. What this set is for

Engage today is one shared environment. Every host sees every question set,
sessions have no owner, and being an administrator means being able to open
anything. This set draws what changes when separate organisations keep their own
work in it — and, just as importantly, what a person who works on Engage stops
being able to see.

It does **not** redraw the host stage or the participant phone. Tenancy does not
change either; they keep `../host-redesign/` and `../player-redesign/`.

## 2. It is the same console, not a lookalike

`_src/build.py` inlines `../admin-redesign/_src/shell.css` verbatim. There is one
shell, one type ladder, one set of tokens. `_src/extra.css` adds only the four
components that did not exist: the org switcher, the usage meter, the access log
and the moderation verdict.

Forking the stylesheet was the obvious alternative and it is how the ladder drifts.
Team and Plan & usage sit in the same left nav as Question sets, one click apart —
if the two sets of screens are ever a pixel apart in row height or label size, a
reader sees it immediately.

## 3. The decisions worth arguing with

**The org switcher is in the topbar, not the left nav.** The nav lists places
*inside* one organisation. The switcher changes which organisation those places
belong to — a different axis, so a different location. It sits beside the
environment chip because both answer the same question: *which world am I looking
at?*

**A user in one org gets no menu.** Same chip, no caret, nothing to open
(`02-org-single.html`). A control whose menu has one item teaches people to
ignore the control, and then they miss it on the day they have two.

**The nav is computed, and the platform console has no content section at all**
(`10-platform-orgs.html`). This is the whole isolation story in one screen: there
is no "view their sets" button because after the split there is nothing to link
to. Reading a customer's content takes a request with a written reason, expires
after four hours, and lands in that customer's own log.

**The included allowance is a notch on the track, not the end of it**
(`04-billing.html`). A bar that fills to 100% and stops cannot show "15 over".
Drawing *5 included* as a rule **on** the track lets the fill run past it, so the
overage is a length you can see rather than a number you have to read.

**Nothing is ever blocked.** The single moment a hard limit would fire is the
moment somebody is standing in front of a room. Overage is charged, stated in
advance, and never enforced — and the copy says so before anyone finds out.

**The invoice is shown as arithmetic.** Four lines that add up, each naming the
quantity it came from. Nobody trusts a total they cannot reproduce, and this one
is small enough to print in full. The measurement rule for storage — *highest
held at once*, not *count at the end* — is written on the screen, because the two
give different bills and only one of them is stated anywhere.

**A rejection names the questions and quotes them** (`06-share-rejected.html`).
Two of thirty is a five-minute edit; "your set was rejected" is a shrug and an
abandoned feature. Each reason separates the topic from the treatment — *asking a
room to describe injuries* is what was flagged, not *the subject of safety* —
because without that sentence the author concludes the checker is broken. An
appeal is offered rather than buried: the check is tuned to be cautious, so it
will be wrong sometimes, and the product should say that itself.

**Escalation is a first-class outcome** (`11-moderation.html`). An automated check
forced to answer yes or no will reject a history set about a war and a clinical
set about injuries. Letting it say *I am not sure* is what keeps those teams as
customers. The queue shows the model's confidence, not just the category:
"Harassment" alone reads as an accusation; "Harassment, low confidence (0.41)"
tells the reviewer how much weight to give it.

**The privacy page states the limit honestly** (`08-privacy.html`). *"We cannot
read your data"* is false while anyone holds the AWS account, and a customer who
discovers that has learned something worse than the limit itself. *"We cannot do
it quietly"* is true, and the access log on the same page is the proof. Our
access and the customer's own appear in **one** table — two would read as a
surveillance panel; one reads as a record, and it lets an admin answer "who
exported that report?" on the same screen.

**Export needs no conversation.** A retention promise is only credible if leaving
is self-service. Requiring an email turns the guarantee back into a negotiation.

## 4. Rules inherited from the shell, and where they bit

Everything in `.claude/skills/engage-design/SKILL.md` applies. Four of its rules
caught real defects while this set was being drawn, and all four are worth
repeating because none of them was visible in the source:

- **A reduction with no recovery is a deletion.** `.tbl td` is `overflow:hidden;
  text-overflow:ellipsis` by design, so a column that is too narrow silently
  deletes the end of a sentence. It ate the invitation expiry on 03 ("11 days ago
  · expir…"), the escalation reason on 11 ("Harassment, low confi…"), and three
  cells of the access log on 08 — every one of them the half that carried the
  meaning. `audit.js` now sweeps for it.
- **Nothing below 12px.** Avatar initials were drawn at 10 and 11px. The shipped
  shell holds itself to `var(--t-floor)` for exactly this element
  (`shell.css:162-163`); the only sub-12px type in it is the design-note rail,
  which is scaffolding.
- **One `<Modal>`, and it is a child of the scrim.** `.scrim` is
  `display:grid; place-items:center` and does the centring. The first cut made
  them siblings, and the request-access dialog rendered at the bottom-left of
  the page in normal flow.
- **A `<button>` may not contain a `<button>`.** The org menu was authored inside
  the chip; the parser hoisted every item out and the menu unwrapped itself
  across the whole topbar, pushing the environment chip off the row. The menu is
  now a sibling inside a positioned wrapper.

A fifth caught itself: **09-first-run.html originally rendered Northwind's fully
populated left nav** beside the words *"one more thing before you can build
anything"*. An account with no organisation has no sections, because every
section is a place inside an org. `build.py` grew a third nav kind for it.

## 5. What is deliberately not drawn

- **The usage strip on the signed-in host front door.** A host should see "3 of 5
  sessions used" *before* creating the sixth, not afterwards on an invoice. That
  surface is dusk full-page (`WelcomeScreen`), not console chrome, so drawing it
  in this shell would misrepresent it. It belongs with the host set.
- **Stripe, invoices and payment methods.** The plan meters now and wires payment
  later; drawing a card form would imply a decision that has not been made.
- **Per-org backup and restore.** Named as a later need. The house archive is the
  wrong mechanism for it — that store is shared operator content by design — and
  "Export everything" on 08 is a different thing: a customer taking their data
  out, not a backup service.
- **SSO, custom retention, and BYOK.** Enterprise tier, not the $5 plan.

## 6. Checking the set

```bash
python3 -m http.server 8124 --directory docs/design      # then open /tenancy-redesign/
cd docs/design/tenancy-redesign && python3 _src/build.py # after editing _src/pages.py
```

`audit.js` sweeps a page for text its own cell has cut off. Run it against all
eleven at 1440 and 1280 — the contact sheet's second note has the harness. It
found four real truncations during this work; it currently reports **0 clipped
and 0 below the 12px floor across 22 page-widths**.
