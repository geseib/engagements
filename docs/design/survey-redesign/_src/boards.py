# -*- coding: utf-8 -*-
"""Boards: several real pages side by side, each in an iframe at its own device
size, so the phone renders at the phone ladder and the wall at Room's."""
from build import board_page, frame, mk_anno, write

PW, PH, PS = 390, 844, 0.72          # a phone
SW, SH, SS = 1920, 1080, 0.37        # the wall, Room profile
LW, LH, LS = 1280, 820, 0.5          # a laptop


def phone(src, cap):
    return frame(src, PW, PH, PS, cap, "phone")


def wall(src, cap):
    return frame(src, SW, SH, SS, cap, "stage")


def build():
    body = f"""
<h1>Answering on a phone</h1>
<p class="lede">Five kinds, one player. Each screen is the shipped participant surface (bar, question, dock) with the kind&rsquo;s control in the middle. The 4px phase strip at the top doubles as progress through the survey. Open any frame on its own to see it full size.</p>
<div class="row">
{phone("p-01-rating.html", "<b>Rating 1–5</b><span>Q1 · required · 4 chosen</span>")}
{phone("p-02-nps.html", "<b>Rating 0–10</b><span>Q2 · optional, nothing chosen: Next reads Skip</span>")}
{phone("p-03-choice.html", "<b>Multiple choice</b><span>Q4 · pick up to two, with a write-in</span>")}
{phone("p-04-yesno.html", "<b>Yes / No</b><span>Q5 · Not sure offered; ‘why?’ opens on No</span>")}
{phone("p-05-rank.html", "<b>Ranking</b><span>Q6 · tap in order; top three is enough</span>")}
{phone("p-06-text.html", "<b>Open answer</b><span>Q7 · long, 500 characters</span>")}
</div>"""
    notes = "".join([
        mk_anno("Nothing here is new furniture", "The option row (<code>.opt</code>, trivia's), the dock button, the bar, the anonymity line and the counter are all the shipped player's (<code>PlayerSurface.css</code>). New shapes only where no ancestor exists: the scale steps, the yes/no halves, the ranking list."),
        mk_anno("Chosen is always amber, always filled", "A picked scale step, a picked yes, a placed rank and a ticked option all use the player's one &lsquo;chosen&rsquo; fill (#0F1A2E on #F6A94C, 8.86:1). Pick-several gets a square key and a tick so the shape says the rule before the words do."),
        mk_anno("Yes / No is not a switch", "A switch has a default, and a default here is an answer nobody gave. Two big halves, nothing chosen until tapped."),
        mk_anno("Ranking without drag", "Tap in order, the way the Call &amp; Answer vote already fills its three slots; &uarr;/&darr; to adjust. Drag can be added; it is never required (WCAG 2.5.7)."),
        mk_anno("Saved, visibly", "Every answer is written as it is given. The dock says so, so nobody hunts for a Save button, and a reload resumes on the same question."),
        mk_anno("Back and Next", "Two of the player's full-width buttons side by side &mdash; no new button. Optional questions let Next read Skip; required ones leave Next disabled with the reason in the question line."),
    ])
    write("10-answering.html", board_page("Answering on a phone — survey", body, notes), group="board")

    body = f"""
<h1>Finishing, and the results coming back</h1>
<p class="lede">Check and send; the thank-you at rest volume; the phone when the host shares results; and the shared page itself, on a phone and on a laptop.</p>
<div class="row">
{phone("p-07-review.html", "<b>Check your answers</b><span>Skipped optionals shown, each one tap away</span>")}
{phone("p-08-done.html", "<b>Sent</b><span>Rest volume: no dock, no amber</span>")}
{phone("p-09-ended.html", "<b>Results shared</b><span>The ENDED screen gains one button</span>")}
{phone("p-10-shared.html", "<b>The shared page</b><span>Read-only; ‘You’ marked from this phone only</span>")}
</div>
<h2>The same shared page on a laptop</h2>
<div class="row">{frame("p-10-shared.html", LW, LH, LS, "<b>engage.seibtribe.us/r/7fK2-mQ9x</b><span>The player's laptop ladder; the gutter absorbs the width</span>", "stage")}</div>"""
    notes = "".join([
        mk_anno("Editable until close", "Answers are saved as given and stay editable until the host closes the survey. Send only marks the row complete, which is what the wall's &lsquo;finished&rsquo; count reads."),
        mk_anno("Rest volume", "The player's own rule: when the task is done there is no dock and no amber. The one link left is the only thing that can still be done."),
        mk_anno("Results come back to the phone", "Today the ENDED screen promises a link the host may share and nothing can publish one. A host's Share (32) pushes to phones still connected; the button opens the frozen page."),
        mk_anno("‘You’ is local", "The shared page is public and knows nobody. The phone that answered remembers its own answers in local storage and marks them; the link opened anywhere else shows no marks."),
        mk_anno("One page, both sizes", "The shared page is the player shell with the player's three literal ladders, so it reads at 14in and at 24in without a second design."),
    ])
    write("11-finishing.html", board_page("Finishing and shared results — survey", body, notes), group="board")

    body = f"""
<h1>On the wall</h1>
<p class="lede">A survey collecting at its own pace, then the host walking the room through the results one question at a time. A <b>Poll</b> reveals exactly these result screens after each question, because a poll is the same five kinds, host-paced. Room profile, 1920&times;1080.</p>
<div class="row">
{wall("s-01-collecting.html", "<b>Collecting</b><span>The way in stays up; progress, never names</span>")}
{wall("s-03-rating.html", "<b>Rating</b><span>Mean at the hero tier, histogram as evidence</span>")}
</div><div class="row">
{wall("s-02-choice.html", "<b>Multiple choice</b><span>Trivia’s bars; ‘Most picked’ in amber, not ‘Correct’</span>")}
{wall("s-04-yesno.html", "<b>Yes / No</b><span>One split bar, and the whys under it</span>")}
</div><div class="row">
{wall("s-05-rank.html", "<b>Ranking</b><span>The answer cards, by average place</span>")}
{wall("s-06-themes.html", "<b>Open answer</b><span>Themes with counts; the host’s chosen quote</span>")}
</div>"""
    notes = "".join([
        mk_anno("The audited stage, unchanged", "Rail, phase band, fitter, dock, the four ladders and every floor are <code>stage-base.css</code> + the 22 Sep refresh, inlined verbatim. The survey sheet adds two shapes (histogram, split) and reuses the rest."),
        mk_anno("Collecting is not ASK", "Nobody is looking up during a self-paced survey, so the wall's job is the way in (QR and code stay) and a sense of pace: finished of joined, and answered per question. No arrivals: a survey's words wait for close."),
        mk_anno("Most picked, not Correct", "Trivia's reveal (bars grow, the row lands, the flag slides in) with the flag in amber and the word changed. A survey has no right answer, so green would lie."),
        mk_anno("Walking the room through it", "After close, the dock pages through results (Previous / Next result). No wipe between them &mdash; it is not a phase change &mdash; so the reveal starts almost at once (<code>--rv:.15s</code>)."),
        mk_anno("Quotes without names", "The featured quote is the feedback wall's <code>blockquote.featured</code>. A comment carries its author because the author was told; a survey answer never does."),
        mk_anno("Ends with Workie", "The last result's primary is &lsquo;What we heard&rsquo;, the stage's existing field-notes beat, now reading Workie's survey read."),
    ])
    write("20-wall.html", board_page("On the wall — survey and poll", body, notes), group="board")
