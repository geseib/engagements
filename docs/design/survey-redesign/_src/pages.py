# -*- coding: utf-8 -*-
"""Builds every page, then the index."""
import build
import phone, stage, author, results, data, boards, names

INDEX_CSS = build.BOARD_CSS + """
.bd{max-width:1180px}
.grp{margin:0 0 26px}
.grp h2{margin:0 0 10px}
.lst{list-style:none;margin:0;padding:0;border-top:1px solid rgba(244,237,228,.12)}
.lst li{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;padding:10px 0;border-bottom:1px solid rgba(244,237,228,.12)}
.lst a{color:#F4EDE4;font-weight:700;text-decoration:none}
.lst a:hover{color:#F6A94C}
.lst span{color:#B6C2D4}
.st{width:100%;border-collapse:collapse;margin:0 0 28px;font-size:14px}
.st th,.st td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(244,237,228,.12);vertical-align:top}
.st th{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#9BA8BE}
.st td:first-child{font-weight:700;white-space:nowrap}
.st code{color:#F6A94C;font:12.5px ui-monospace,Menlo,monospace}
.no{color:#EF8C86;font-weight:700}.pt{color:#F6A94C;font-weight:700}.ok{color:#6FD0A4;font-weight:700}
"""

GROUPS = [
    ("Create and edit", [
        ("01-new-survey.html", "New survey", "Survey joins the kinds of round; four ways in: your material, a template, blank, a file."),
        ("02-generate.html", "Generate from your material", "Paste the outline or attach the deck; say what you want to find out; pick the kinds; pick how many."),
        ("03-review.html", "Review the draft", "The shared review table with a Kind column; keep, edit, rewrite one, change its kind; saved as a draft set."),
        ("04-editor.html", "The editor", "The set editor's Questions tab for a survey: kind, question, answer preview; the Add question menu open."),
        ("05-edit-question.html", "Edit a question", "One form whose fields follow the kind, with the real player beside it as the preview."),
        ("06-kind-fields.html", "The fields each kind asks for", "Multiple choice, Yes / No, Ranking and Open answer, side by side."),
        ("07-start-survey.html", "Start a survey session", "Names — Anonymous, Who finished or Named — fixed once it opens; the results link's two-day clock starts at open."),
    ]),
    ("Answer", [
        ("10-answering.html", "Answering on a phone (board)", "Rating 1–5, rating 0–10, multiple choice, yes/no with its why, ranking, open answer."),
        ("11-finishing.html", "Finishing, and results coming back (board)", "Check and send, the thank-you, the ENDED screen with results, the shared page."),
        ("12-names.html", "Names (board)", "What each phone promises under the three settings; who's left on the wall, on request."),
    ]),
    ("On the wall", [
        ("20-wall.html", "On the wall (board)", "Collecting at its own pace, then a result screen per kind — the same screens a poll reveals."),
    ]),
    ("Results and sharing", [
        ("30-results.html", "Results", "Workie's read on top; a chart per question, each with Workie's one-line note."),
        ("31-open-text.html", "Open answers", "Themes as filters, every answer readable, put one on the wall, held-back answers that name a person."),
        ("32-share.html", "Share the results", "A frozen, read-only copy: anyone with the link, two days from when the survey opened; three ways out — wall, phones, link."),
        ("33-people.html", "People", "Named: who finished, who stopped partway, and each person's answers. Names stop at the console."),
        ("34-report.html", "The PDF report", "The survey section of the paper report, in GameReport's own type."),
    ]),
    ("Store and record", [
        ("40-data-model.html", "Data model", "Rows, keys, how each kind is counted, how long each thing is kept, the routes."),
    ]),
]

STATUS = [
    ("Survey type", "no", "Exists in <code>gameTypes.js</code> but is listed unplayable (<code>:159</code>). The importer rejects it (<code>upload-questions.js:286-300</code>); no session can run one; no player screen draws one."),
    ("Survey AI builder", "pt", "<code>SurveyAIBuilder.jsx</code> + <code>ai-generate-survey.js</code> (Sonnet 4.6) generate rating / multiple choice / text items, but <b>only download JSON</b>. Two of its three kind checkboxes are dead (<code>:589-591</code>). &lsquo;Export JSON and close&rsquo; on the host shelf downloads nothing."),
    ("Poll", "pt", "Plays exactly like Call &amp; Answer: free text, then rank a top three. Its <code>options[]</code> / <code>allowMultiple</code> are saved and never read by the game; the AI summary reads poll options from the wrong fields (<code>get-ai-summary.js:2107</code>)."),
    ("Multiple choice", "ok", "Trivia&rsquo;s A&ndash;F only: player option rows, answer rows, stage bars with the reveal. The mechanism to reuse."),
    ("Rating, yes/no, ranking, NPS", "no", "Absent from every game path. Ranking exists only as Call &amp; Answer&rsquo;s top-three vote."),
    ("Results back to participants", "no", "No shared page. The ENDED screen promises a link the host may share; nothing publishes one."),
    ("AI commentary", "pt", "Workie (persona + approach) writes per-round summaries for the other types. No survey persona, no survey default prompt."),
]


def build_all():
    phone.build()
    stage.build()
    author.build()
    results.build()
    data.build()
    boards.build()
    names.build()
    groups = "".join(
        f'<section class="grp"><h2>{g}</h2><ul class="lst">' +
        "".join(f'<li><a href="{f}">{t}</a><span>{d}</span></li>' for f, t, d in items) + "</ul></section>"
        for g, items in GROUPS)
    rows = "".join(f'<tr><td>{a}</td><td class="{c}">{ {"no": "Missing", "pt": "Partial", "ok": "Works"}[c] }</td><td>{d}</td></tr>'
                   for a, c, d in STATUS)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Surveys and polls — mockups</title><style>{INDEX_CSS}</style></head>
<body><main class="bd">
<h1>Surveys and polls</h1>
<p class="lede">Five question kinds &mdash; rating, multiple choice, yes/no, ranking, open answer &mdash; shared by two ways of running them. A <b>Survey</b> is a form people fill in at their own pace; results come together when the host closes it, and a <b>Names</b> setting decides whether it is Anonymous, records Who finished, or is Named. A <b>Poll</b> is the same questions one at a time, each result revealed on the wall. Every page is built from the approved stylesheets (admin console, player, stage, report) with a small survey sheet on top; press N on any page to hide the design notes. See <code>RATIONALE.md</code> and <code>PLAN.md</code> beside this file.</p>
<h2>Where it stands today (22 Sep 2026)</h2>
<table class="st"><thead><tr><th style="width:210px">Piece</th><th style="width:80px">State</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>
{groups}
</main></body></html>"""
    build.write("index.html", html, group="index")
    print(f"wrote {len(build.WRITTEN)} files")
