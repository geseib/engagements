# -*- coding: utf-8 -*-
"""Builds every page, then the index."""
import build
import dialog, stage, phone, boards, data

INDEX_CSS = build.BOARD_CSS + """
.bd{max-width:1180px}
.grp{margin:0 0 26px}
.grp h2{margin:0 0 10px}
.lst{list-style:none;margin:0;padding:0;border-top:1px solid rgba(244,237,228,.12)}
.lst li{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;padding:10px 0;border-bottom:1px solid rgba(244,237,228,.12)}
.lst a{color:#F4EDE4;font-weight:700;text-decoration:none}
.lst a:hover{color:#F6A94C}
.lst span{color:#B6C2D4}
.st{width:100%;border-collapse:collapse;margin:0 0 28px;font-size:14px;table-layout:fixed}
.st th,.st td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(244,237,228,.12);vertical-align:top}
.st th{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#9BA8BE}
.st td:first-child{font-weight:700}
.st code{color:#F6A94C;font:12.5px ui-monospace,Menlo,monospace}
.no{color:#EF8C86;font-weight:700}.pt{color:#F6A94C;font-weight:700}.ok{color:#6FD0A4;font-weight:700}
.bd p.lede code{color:#F6A94C;font:13px ui-monospace,Menlo,monospace}
"""

GROUPS = [
    ("Create an engagement", [
        ("01-create.html", "The create dialog, Advanced closed", "Title, format, set and categories up front; the briefing row; one Advanced line that names every default in force."),
        ("02-create-advanced.html", "The same, Advanced open", "Responses, question order, Workie&rsquo;s voice and approach, instructions, event details &mdash; a changed value named in amber in the summary."),
        ("03-briefing-ready.html", "The briefing, ready to check", "The summary Workie will get, editable in full, with where it came from and how many names were left out."),
        ("04-briefing-states.html", "The briefing, every state", "Choose &rarr; read &rarr; write &rarr; check; scanned, too large, too long, locked, slides, failed; the Advanced line per format; the close confirm."),
    ]),
    ("Preview before opening", [
        ("10-preview-lobby.html", "The stage in preview", "The lobby as the room will see it, a dashed Preview chip and band, the meter says Closed, the primary opens the doors."),
        ("11-preview-round.html", "Stepping through round 1", "The plan&rsquo;s first question, read-only, from the same planner the live round uses."),
        ("12-preview-edit.html", "Editing from the preview", "The shipped edit dialog over the stage: name, categories, Workie info including the briefing; what is fixed, and why."),
        ("20-phone-not-open.html", "A phone that arrives early", "‘Not open yet’ &mdash; keeps the name, checks by itself, lets itself in when the doors open."),
        ("22-preview-board.html", "Both sides of the door (board)", "Stage, phone, edit dialog and step-through together, with the state model."),
    ]),
    ("Workie, briefed", [
        ("30-workie-briefed.html", "Workie&rsquo;s comment on the wall", "The MTTR example: its own knowledge (the quick-win play) tied to the brief (‘an MTTR the brief puts at three weeks’)."),
        ("31-mttr-end-to-end.html", "The example, end to end (board)", "Document &rarr; briefing &rarr; a participant&rsquo;s answer &rarr; the wall."),
        ("21-phone-answer.html", "The participant&rsquo;s answer", "Round 1 on the phone, as shipped (player-redesign 07)."),
    ]),
    ("Underneath", [
        ("40-data-and-prompt.html", "Data, prompt and states", "Where the briefing lives and for how long, the prompt layer word for word, guardrails, states, routes."),
    ]),
]

STATUS = [
    ("Create dialog", "pt", "Eleven controls in one scroll (<code>GameSetupDialog.jsx:380-750</code>): title, format, set, categories, anonymity, shuffle, event details, AI context, voice, approach, plan line. All but three have a default. Head and foot scroll away."),
    ("A document for Workie", "no", "No session-level document. <code>FileUploadPrompt</code> + <code>admin/parse-document.js</code> exist, but only the set builders use them, appending raw text to a generation prompt (<code>SurveyAIBuilder.jsx:612-620</code>). parse-document is admins-only in the authorizer (<code>authorizer.js:400</code>)."),
    ("Joining before start", "ok", "Refused: <code>session-gate.js:57-70</code> answers 403 ‘Game not started’. The phone shows the server&rsquo;s sentence on the join form, or nothing on an auto-join (<code>PlayerPage.jsx:540-565</code>)."),
    ("Looking before opening", "no", "Create lands on the history list (<code>GameHostPage.jsx:4404-4410</code>). The row offers Edit and Start; ‘Open’ was removed (<code>SessionHistoryPanel.jsx:50-79</code>). Start is the only way onto the stage, and it lets people in."),
    ("Editing before start", "pt", "<code>PUT /games/{id}</code> while CREATED: title, details, AI context, voice, approach, anonymity, categories (<code>update-game.js:69-72</code>). The dialog&rsquo;s note still says categories are fixed (<code>GameSetupDialog.jsx:424-425</code>)."),
    ("Workie&rsquo;s context", "pt", "Details and AI context reach the prompt twice (context block, host directive). But <code>get-ai-summary.js</code> never decrypts METADATA (<code>:756-759</code>), so on an org session they arrive as envelope objects."),
]


def build_all():
    dialog.build()
    stage.build()
    phone.build()
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
<title>Session setup — mockups</title><style>{INDEX_CSS}</style></head>
<body><main class="bd">
<h1>Create an engagement, and preview it</h1>
<p class="lede">Three pieces from one brief (owner, 23 Sep). A <b>simpler create dialog</b>: the few things a host must decide up front, everything with a safe default under one <b>Advanced</b> disclosure whose summary line names the defaults. A <b>briefing from a document</b> for Call &amp; Answer: a PDF summarised into a short, editable brief that Workie uses when it reflects the room&rsquo;s answers. A <b>preview</b>: after creating and before opening, the host looks at the stage, steps through, and edits &mdash; with the doors closed. The dialog pages are drawn by the shipped <code>GameSetupDialog.css</code>; the stage, phone and console by their approved mockup sheets. Press N on any page to hide the design notes. See <code>RATIONALE.md</code> and <code>PLAN.md</code> beside this file.</p>
<h2>Where it stands today (23 Sep 2026)</h2>
<table class="st"><colgroup><col style="width:190px"><col style="width:84px"><col></colgroup><thead><tr><th>Piece</th><th>State</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>
{groups}
</main></body></html>"""
    build.write("index.html", html, group="index")
    print(f"wrote {len(build.WRITTEN)} files")
