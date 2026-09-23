# -*- coding: utf-8 -*-
"""Builds every page, then the index."""
import build
import console, phone, stage, boards, data

INDEX_CSS = build.BOARD_CSS + """
.bd{max-width:1180px}
.grp{margin:0 0 26px}
.grp h2{margin:0 0 10px}
.lst{list-style:none;margin:0;padding:0;border-top:1px solid rgba(244,237,228,.12)}
.lst li{display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;padding:10px 0;border-bottom:1px solid rgba(244,237,228,.12)}
.lst a{color:#F4EDE4;font-weight:700;text-decoration:none}
.lst a:hover{color:#F6A94C}
.lst span{color:#B6C2D4}
.st{width:100%;border-collapse:collapse;margin:0 0 28px;font-size:14px;table-layout:fixed}
.st th,.st td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(244,237,228,.12);vertical-align:top}
.st th{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#B6C2D4}
.st td:first-child{font-weight:700}
.st code{color:#F6A94C;font:12.5px ui-monospace,Menlo,monospace}
.no{color:#EF8C86;font-weight:700}.pt{color:#F6A94C;font-weight:700}.ok{color:#6FD0A4;font-weight:700}
.bd p code{color:#F6A94C;font:13px ui-monospace,Menlo,monospace}
.dec{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:22px;margin:0 0 28px}
.dec ol{list-style:none;margin:0;padding:0;border-top:1px solid rgba(244,237,228,.12)}
.dec li{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:9px 0;border-bottom:1px solid rgba(244,237,228,.12);font-size:14px;color:#B6C2D4}
.dec li > b:first-child{font:800 14px/1.4 "Inter",system-ui,sans-serif;color:#6FD0A4;text-align:right}
.dec .open li > b:first-child{color:#F6A94C}
.dec li span b{color:#F4EDE4}
@media (max-width:900px){.dec{grid-template-columns:1fr}}
"""

GROUPS = [
    ("Plan it (console)", [
        ("01-events.html", "Events", "The new place in the console, for Team-plan organisations: upcoming and past events, each with its one code."),
        ("01b-events-personal.html", "Events in a Personal space", "What a Personal space sees instead: what an event is, and the one way in (Request the Team plan)."),
        ("05-new-event.html", "New event", "Name, date, start, time zone, place; open or invite-only; reports for attendees; how it is billed. The code is fixed here."),
        ("02-builder.html", "The agenda builder", "Ordered items and a break, times that follow the order, the caps counted in the foot (the break is not), Rehearse on the stage, the add menu open."),
        ("02b-cap-reached.html", "The agenda at the cap", "8 of 8 engagements: the engagement kinds disabled with the reason; Presentation still open up to 16 items."),
        ("03-add-item.html", "Add an engagement", "Pick a set of the chosen type; the version it will play; the title and description the room sees; the planned length."),
        ("04-add-presentation.html", "Add a presentation", "A talk from the presenter's own screen: title, presenter, length, description, and an optional PDF copy attendees can open once it starts."),
        ("06-invitations.html", "Invitations", "People and a personal passcode each, shown once to copy, download or print; the card each person gets. No email."),
    ]),
    ("Run it", [
        ("20-wall.html", "On the wall (board)", "Doors open, Now presenting, between items, starting an engagement, a break with the day&rsquo;s standings, and a rehearsal."),
        ("10-join.html", "Joining an invite-only event (board)", "Event code + personal passcode, and the three ways it goes wrong: not recognised, in use, too many tries."),
        ("11-on-the-day.html", "Before, during and after, on a phone (board)", "The agenda days ahead (phone and laptop), between items, a talk with its slides copy, a break, the switch beat, today&rsquo;s player unchanged, the end."),
    ]),
    ("Afterwards", [
        ("07-hub.html", "Reports and files", "Every item's report, slides copy and results; reports for attendees (Full, Anonymous, Not shared); the day&rsquo;s standings."),
    ]),
    ("Store it", [
        ("40-data-model.html", "Data model", "Rows, keys, lifetimes and routes. Every engagement is still an ordinary session."),
    ]),
]

DECIDED = [
    ("1", "Billing", "An event counts as one session for now; ultimately events are for Team-plan organisations only. At most 16 items, 8 of them engagements."),
    ("2", "Invitations", "No email for now: each person gets a personal passcode the host hands out. Joining is the event code plus that passcode. Sending email is approved for later."),
    ("3", "Reports for attendees", "Full reports by default, with a setting per event and per item: Full, Anonymous (names removed by the server) or Not shared. Survey results never carry names."),
    ("4", "Presentations", "PDF is the format for now; .pptx is out of every phase."),
    ("5", "Deck encryption", "Reference copies are encrypted per organisation, exactly as saved reports are, and opened through a decrypting Lambda."),
    ("6", "Standings", "Both: each scored item keeps its own, and the day&rsquo;s are the sum of every scored item&rsquo;s points, on the wall between items and in the hub."),
    ("7", "Breaks", "Listed on the agenda with a return time and a countdown on the wall; not counted in the caps, not billed, nothing stored."),
    ("8", "Presenting", "Slides run from the presenter's own presentation mode. Engage never shows or drives them; the PDF is a reference copy. The stage holds on &lsquo;Now presenting&rsquo;."),
    ("9", "Rehearsal", "One button, &lsquo;Rehearse on the stage&rsquo;: the doors stay closed, nothing is billed, counted or saved. The session-setup Preview model, for a whole event."),
    ("10", "Keep for a year", "Keeps only the saved reports. Event templates came up and are shelved."),
    ("11", "Before the day", "Decided by default, the owner may overrule: events don&rsquo;t wait for surveys (survey items appear once surveys ship). The agenda is readable beforehand, with descriptions; nothing is active until the host starts it."),
    ("12", "Event pricing", "A separate allowance from sessions: one event a month included on the Team plan, then $1 each. Events never use the 5 included sessions."),
]
OPEN = []
SHELVED = [("Event templates", "Reuse an event&rsquo;s agenda as a template (from answer 10). Not in any phase; the new-event dialog no longer offers to copy an agenda.")]

STATUS = [
    ("Several sessions under one code", "no", "A session is one set of one type: scalar <code>GameType</code> / <code>QuestionSetId</code> on METADATA (<code>schema-compliant-manager.js:192-205</code>), and <code>update-game.js:28-32</code> refuses to change either. No multi-set code exists; &lsquo;Switch game&rsquo; leaves the session (<code>GameHostPage.jsx:4130-4143</code>)."),
    ("Presentations", "no", "No upload, no display, no pptx anywhere. <code>parse-document.js</code> reads PDF / Word to <b>text</b> for question generation (<code>:43-60</code>)."),
    ("Private sessions", "pt", "Backend only: one shared <code>AccessCode</code>, plain-string compare (<code>session-gate.js:74-116</code>). The create dialog never sends it (<code>createGame.js:99-101</code>), so no host can turn it on."),
    ("Invitations by email", "no", "The app sends no email. Org-member invites return a link to copy or <code>mailto:</code> (<code>invite-member.js:4-7</code>, <code>TeamPanel.jsx:327-335</code>); SES is used only by Cognito (<code>template-clean.yaml:5155-5158</code>)."),
    ("A code matched to an email", "pt", "Exists for org invites: <code>accept-invite.js:91-93</code> refuses a signed-in email that differs. Nothing like it for players, who are anonymous and keyed by a typed name (<code>join-game.js:326-342</code>)."),
    ("Scheduling", "no", "No stored start time. <code>InviteDialog</code>'s date is kept only while the dialog is open (<code>InviteDialog.jsx:42-43</code>)."),
    ("Reports", "pt", "Per session, per round (<code>create-report.js:418-699</code>); saved PDFs outlive the session (<code>save-report.js:161-182</code>). Nothing spans sessions, and saving has no sign-in (<code>template-clean.yaml:2549-2556</code>)."),
    ("Survey", "no", "Unplayable (<code>gameTypes.js:159</code>); being designed in <code>survey-redesign/</code>. The intro and closing survey items depend on it."),
]


def build_all():
    console.build()
    phone.build()
    stage.build()
    boards.build()
    data.build()
    groups = "".join(
        f'<section class="grp"><h2>{g}</h2><ul class="lst">' +
        "".join(f'<li><a href="{f}">{t}</a><span>{d}</span></li>' for f, t, d in items) + "</ul></section>"
        for g, items in GROUPS)
    rows = "".join(f'<tr><td>{a}</td><td class="{c}">{ {"no": "Missing", "pt": "Partial", "ok": "Works"}[c] }</td><td>{d}</td></tr>'
                   for a, c, d in STATUS)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Events and agendas — mockups</title><style>{INDEX_CSS}</style></head>
<body><main class="bd">
<h1>Events and agendas</h1>
<p class="lede">One join code for a whole day: an intro survey, a talk, a quiz, a Call &amp; Answer, another talk, another quiz, another Call &amp; Answer, a closing survey &mdash; the owner&rsquo;s own example, in the owner&rsquo;s order. The host plans it in the console, can make it invite-only with a personal code per person, starts each item from the stage, and every phone follows into the mechanic that already ships. Afterwards one page holds every report, deck and result. <b>Future work, not scheduled.</b> Every page is built from the approved stylesheets (console, player, stage) with a small <code>ag-</code> sheet on top; press N to hide the design notes. See <code>RATIONALE.md</code> and <code>PLAN.md</code> beside this file.</p>
<h2>The owner&rsquo;s decisions (23 Sep 2026)</h2>
<div class="dec">
  <div><h2 style="font-size:13px;margin:0 0 8px">Decided &middot; {len(DECIDED)}</h2><ol>{"".join(f'<li><b>{n}</b><span><b>{t}.</b> {d}</span></li>' for n, t, d in DECIDED)}</ol></div>
  <div class="open"><h2 style="font-size:13px;margin:0 0 8px">Still open &middot; {len(OPEN)}</h2><p style="color:#B6C2D4;font-size:14px;margin:0 0 18px">None. Question 11 is decided by default and can be overruled.</p>
    <h2 style="font-size:13px;margin:0 0 8px">Shelved</h2><ol>{"".join(f'<li><b>&ndash;</b><span><b>{t}.</b> {d}</span></li>' for t, d in SHELVED)}</ol></div>
</div>
<p class="lede" style="margin-top:-12px">Numbers are the questions&rsquo; own, from <code>RATIONALE.md</code>; the owner&rsquo;s words are quoted there.</p>
<h2>Where it stands today (23 Sep 2026)</h2>
<table class="st"><thead><tr><th style="width:230px">Piece</th><th style="width:80px">State</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>
{groups}
</main></body></html>"""
    build.write("index.html", html, group="index")
    print(f"wrote {len(build.WRITTEN)} files")
