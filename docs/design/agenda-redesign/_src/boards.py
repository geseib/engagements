# -*- coding: utf-8 -*-
"""Boards: several real pages side by side, each in an iframe at its own
device size, so a phone renders at the phone ladder and the wall at Room's.
Two frames are the approved player mockups themselves, unchanged — the point
of the design is that an engagement inside an event IS today's mechanic."""
from build import board_page, frame, mk_anno, write

PW, PH, PS = 390, 844, 0.72          # a phone
SW, SH, SS = 1920, 1080, 0.385       # the wall, Room profile


def phone(src, cap):
    return frame(src, PW, PH, PS, cap, "phone")


def wall(src, cap):
    return frame(src, SW, SH, SS, cap, "stage")


def build():
    # ------------------------------------------------------------- joining ---
    body = f"""
<h1>Joining an invite-only event</h1>
<p class="lede">The event code finds the event; the personal passcode the host handed out lets one phone in as that person. The same four digits on the wall, then one field &mdash; and three honest ways it can go wrong. No email is typed. Open any frame on its own to see it full size.</p>
<div class="row">
{phone("p-01-join-invite.html", "<b>Passcode</b><span>After typing 5307: the event is named; the name comes from the invitation list</span>")}
{phone("p-02-join-mismatch.html", "<b>Not recognised</b><span>One message for every wrong passcode; what was typed is kept</span>")}
{phone("p-03-join-in-use.html", "<b>Already on another phone</b><span>Move it here, or tell the host</span>")}
{phone("p-04-join-paused.html", "<b>Too many tries</b><span>A pause, a time, and who can help</span>")}
</div>"""
    notes = "".join([
        mk_anno("A passcode, not an email", "Owner, 23 Sep: &lsquo;for now no email is needed, perhaps just the passcode.&rsquo; So the join is the event code plus one personal passcode. Email matching comes back only if Engage ever sends the invitations itself (PLAN Phase 4)."),
        mk_anno("One message for every wrong passcode", "&lsquo;That passcode doesn&rsquo;t let anyone into Q4 Kickoff&rsquo; covers a typo, a replaced passcode and one from another event alike, so a guess learns nothing about which passcodes ever existed."),
        mk_anno("Amber, not red", "The player's own rule (02-join-code-bad): red is for destructive things; a mistyped passcode is not one. The error is attached to the field and keeps what was typed."),
        mk_anno("No name field", "The invitation list carries the name. Players today are keyed by the name they type (<code>join-game.js:326-342</code>); an attendee is keyed by the invitation, so two Priyas never collide and a rename never splits a person."),
        mk_anno("One passcode, one phone", "Moving the seat is allowed and says what happens to the other phone. A forwarded passcode shows up (the host sees one person, not two) without locking out someone who switched phones."),
        mk_anno("A pause, not a lock", "Five wrong tries start a 10-minute pause, counted per phone and per network address. With 30 symbols and six places a guess is one in about 729 million, so the pause only has to stop a script, not a person."),
        mk_anno("Told before they join", "p-01 says reports are shared afterwards, with names &mdash; the host's default. That promise is why the hub can remove names later but never add them back."),
        mk_anno("Today's private session is different", "The shipped &lsquo;This session is private.&rsquo; screen (<code>PlayerPage.jsx:2254-2300</code>) asks for one shared code, only after a failed join (<code>joinResult.js:77-78</code>). A passcode per person needs its own screen; this is it."),
    ])
    write("10-join.html", board_page("Joining an invite-only event", body, notes), group="board")

    # ------------------------------------------------------------ on the day --
    body = f"""
<h1>Before, during and after, on a phone</h1>
<p class="lede">Before the day the agenda can be read and nothing can be done. Between items the phone rests on the agenda. During a talk it says &ldquo;look up&rdquo;, and during a break when to be back. When the host starts an engagement it switches by itself &mdash; one beat that names the item &mdash; into the mechanic that already ships. At the end the agenda becomes the list of what was shared.</p>
<h2>Before the day</h2>
<div class="row">
{phone("p-05a-before.html", "<b>The agenda, days ahead</b><span>Times, presenters, descriptions; every item Not started</span>")}
{frame("p-05a-before.html", 1280, 820, 0.5, "<b>The same page on a laptop</b><span>The player&rsquo;s laptop ladder; the gutter absorbs the width</span>", "stage")}
</div>
<h2>On the day</h2>
<div class="row">
{phone("p-05-agenda.html", "<b>Between items</b><span>Rest volume: no dock. Done / Next said in words</span>")}
{phone("p-06-watching.html", "<b>A talk is on</b><span>Watch volume: look up; the slides copy, if shared</span>")}
{phone("p-09-break.html", "<b>A break</b><span>Back at 10:28, and what&rsquo;s next</span>")}
{phone("p-07-switching.html", "<b>The host pressed Start trivia</b><span>1.2 s, then the item&rsquo;s own lobby. No tap, no code</span>")}
</div>
<h2>&hellip; and then it is today&rsquo;s player, unchanged</h2>
<div class="row">
{phone("../player-redesign/05-lobby.html", "<b>The item&rsquo;s lobby</b><span>player-redesign/05 as approved, with its own sample session</span>")}
<span class="arrow" aria-hidden="true">&rsaquo;</span>
{phone("../player-redesign/06-ask-trivia.html", "<b>A trivia question</b><span>player-redesign/06 as approved, its own sample question</span>")}
<span class="arrow" aria-hidden="true">&rsaquo;</span>
{phone("p-08-ended.html", "<b>The day is over</b><span>The agenda, with reports, results and slides the host shared</span>")}
</div>"""
    notes = "".join([
        mk_anno("The phone follows; it is never re-joined", "Today a phone belongs to one session: <code>connect.js:9-11</code> takes a <code>gameId</code> and writes <code>GAME#&lt;id&gt;/CONNECTION#</code>. The event adds one row per phone under the event, and when an item starts the phone registers the same connection under the new session. <code>disconnect.js:14-20</code> already finds every row with that <code>CONNECTION#</code> key, so both go when the phone does."),
        mk_anno("Three volumes, as the player defines them", "Rest (between items, the end): no dock, no amber. Watch (a presentation): the phone carries only what is personal. Act (an engagement): the item's own screens. The agenda adds no fourth."),
        mk_anno("One context at a time", "The bar says &lsquo;Q4 Kickoff&rsquo; between items. Inside an item the item's own context wins (&lsquo;Question 4 of 10&rsquo;), which is why the two approved frames are shown unchanged: nothing in them needs to know it is part of an event."),
        mk_anno("The talk is not on the phone", "Owner, 23 Sep: slides run from the presenter's own presentation mode; &lsquo;the only share is the copy for others to have and reference.&rsquo; So the watch screen names the talk and offers that copy &mdash; open or save, the one personal thing it can do. Shown only when the host left the copy shared (04, 07)."),
        mk_anno("Reports follow the host's setting", "Full by default, so the trivia reports link straight from the final agenda. Item 4 was switched to Anonymous, so its link says <b>no names</b> and serves the server-stripped PDF. Unsaved or unshared items show no link at all. &lsquo;You came 5th of 36&rsquo; is only ever on that person's own phone."),
        mk_anno("Before the day: readable, not active", "Decision 11: people can visit the agenda beforehand and read each item's description; nothing can be answered, no survey opened, and no slides copy offered until the host starts that item on the day (then it stays). An open event's agenda is visible to anyone with the link; an invite-only event's only after the passcode &mdash; a proposal, flagged in RATIONALE."),
        mk_anno("Breaks and the day's place", "A break says when to be back (decision 7). The day's standings (decision 6) are the sum of every scored item's points; each phone shows only its own place &mdash; &lsquo;4th on the day so far&rsquo;."),
        mk_anno("Planned times, labelled as such", "The phone shows the agenda's planned times and never &lsquo;running late&rsquo;: the host decides the pace, and a printed agenda does not apologise either."),
    ])
    write("11-on-the-day.html", board_page("Before, during and after, on a phone", body, notes), group="board")

    # ------------------------------------------------------------ the wall ----
    body = f"""
<h1>On the wall</h1>
<p class="lede">Doors open with the day&rsquo;s agenda and the one code. During a talk the presenter&rsquo;s own screen does the work; if the projector stays on Engage it holds on &ldquo;Now presenting&rdquo;. Between items the next one is the headline and the rest of the day waits at the side. Starting an engagement plays the phase wipe once, over that item&rsquo;s own lobby, while the phones arrive by themselves. Room profile, 1920&times;1080.</p>
<div class="row">
{wall("s-01-doors.html", "<b>Doors open</b><span>The agenda and the way in; the code once</span>")}
{wall("s-02-presenting.html", "<b>Now presenting</b><span>A holding screen: the talk, the presenter, the way in, what&rsquo;s next</span>")}
</div><div class="row">
{wall("s-03-between.html", "<b>Between items</b><span>The next item is the headline; later items at the side</span>")}
{wall("s-04-trigger.html", "<b>Start trivia</b><span>The wipe, once; phones counting in; the item&rsquo;s own lobby</span>")}
</div><div class="row">
{wall("s-05-break.html", "<b>A break</b><span>A countdown to the planned return; the day&rsquo;s standings</span>")}
{wall("s-06-rehearsal.html", "<b>Rehearsal</b><span>Doors closed; the dashed mark; step through the items</span>")}
</div>"""
    notes = "".join([
        mk_anno("The audited stage, unchanged", "Rail, phase band, fitter, dock, the four literal ladders and every floor are <code>stage-base.css</code> + the 22 Sep refresh, inlined verbatim. The event adds two shapes (the wall agenda, the presenter line) and reuses the rest."),
        mk_anno("A presentation wears the lobby band", "The band means &lsquo;nobody needs a phone&rsquo;, which is true of a lobby and of a talk. No fifth phase colour."),
        mk_anno("The code, once per screen", "Where the join block is up, the rail drops its JOIN code; in the item lobby the rail keeps it, because a latecomer has no other way in. The code is the <b>event's</b> 5307 throughout &mdash; the item's own session code is never shown."),
        mk_anno("Lateness is not room-facing", "The dock is on the projected image, so drift from the plan (&lsquo;13 min over&rsquo;) lives only in the Setup drawer and on the host remote."),
        mk_anno("Engage never shows the slides", "Owner, 23 Sep (decision 8): the presenter presents from their own presentation mode. So there is no slide viewer, no page rendering and no next-slide control here or on the remote &mdash; and no question of an outside presenter driving Engage. The PDF is only a copy for attendees."),
        mk_anno("Now presenting holds the room", "For rooms where the projector stays on Engage (a second screen, or the host switches inputs): the talk, the presenter, the one code for latecomers, and what comes next. It is the between-items shape, so nothing new is learned."),
        mk_anno("Start trivia is the next press", "The dock's primary is always the next item, so the host can end a talk early or on time with the same key."),
        mk_anno("A break counts down, then stops", "Decision 7: the hero numeral counts to the planned return and stops at 0:00 (&lsquo;Starting now&rsquo;); it never runs negative on the wall. +5 min moves the return time for everyone. The right column is the day's standings (decision 6) &mdash; names because this event's reports are Full."),
        mk_anno("Rehearsal is Preview for a whole event", "Decision 9, simple: the session-setup design's Preview model &mdash; a view, not a state; joins refused, a phone that scans waits (session-setup 20). The dashed chip and dashed band are its marks. Stepping through shows each item's screen and an engagement's questions read-only from its pinned set; no session is created, nothing is billed, no report is saved."),
        mk_anno("The wipe means &lsquo;look at your phone now&rsquo;", "That is its job in the refresh (<code>refresh-stage.css</code> &sect;1), so it is spent here exactly once per engagement, with the one extra fact the room needs: no code to type."),
    ])
    write("20-wall.html", board_page("On the wall — an event", body, notes), group="board")
