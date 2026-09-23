# -*- coding: utf-8 -*-
"""40 — how a survey is stored, recorded, frozen and shared. Drawn in the
console's own vocabulary (panels, tables, mono keys) so it reads as part of
the product's documentation rather than a separate diagram style."""
from build import console_page, write, ico, anno


def pre(s):
    return f'<pre class="sv-pre">{s}</pre>'


def build():
    q_row = pre("""<span class="c">// one row per question — the set's content partition, as today</span>
<span class="k">PK</span>  ORG#&lt;org&gt;#SET#&lt;id&gt;#v2
<span class="k">SK</span>  QUESTION#c001#005
<span class="k">Kind</span>        <span class="s">"yesno"</span>   <span class="c">rating|choice|yesno|rank|text</span>
<span class="k">Title</span>       <span class="s">"Was the length about right?"</span>  <span class="c">encrypted</span>
<span class="k">Detail</span>      <span class="s">""</span>
<span class="k">Required</span>    true
<span class="k">Unsure</span>      true
<span class="k">FollowUp</span>    { when: <span class="s">"no"</span>, prompt: <span class="s">"What would you cut…"</span> }
<span class="k">QuestionNumber</span> 5 · <span class="k">Active</span> true""")
    kinds = pre("""<span class="k">rating</span>  Scale { min:1, max:5, style:<span class="s">"numbers"</span>|<span class="s">"stars"</span>|<span class="s">"nps"</span>,
                lowLabel, highLabel }
<span class="k">choice</span>  options[2–8], allowMultiple, maxPicks,
        allowOther, shuffle          <span class="c">← poll's fields, kept;</span>
        <span class="c">a legacy poll row with options reads as choice</span>
<span class="k">yesno</span>   labels{yes,no}, Unsure, FollowUp
<span class="k">rank</span>    options[3–7], rankTop
<span class="k">text</span>    textLength <span class="s">"short"</span>|<span class="s">"long"</span>, maxLength,
        themes (bool)
<span class="c">encrypted for org sets: options, Scale labels,</span>
<span class="c">Labels, FollowUp.prompt, Placeholder — and,</span>
<span class="c">as today, Title and Detail</span>""")
    a_row = pre("""<span class="c">// one row per PERSON, overwritten as they go</span>
<span class="k">PK</span>  GAME#&lt;id&gt;
<span class="k">SK</span>  SURVEY#RESP#&lt;respondent&gt;  <span class="c">see Names below</span>
<span class="k">Answers</span> {
  <span class="s">"c001#001"</span>: 4,
  <span class="s">"c001#003"</span>: [0],
  <span class="s">"c001#004"</span>: [0, { other: <span class="s">"A one-page…"</span> }],
  <span class="s">"c001#005"</span>: { v: <span class="s">"no"</span>, why: <span class="s">"Cut the roadmap…"</span> },
  <span class="s">"c001#006"</span>: [2, 1, 0],      <span class="c">option indexes, in order</span>
  <span class="s">"c001#007"</span>: <span class="s">"Seeing the console…"</span>
}                                  <span class="c">encrypted, as ANSWER rows are</span>
<span class="k">Progress</span> 7 · <span class="k">Complete</span> true · <span class="k">UpdatedAt</span>
<span class="k">Name</span>  <span class="c">Named only</span>
<span class="k">ttl</span>  start + 7 days             <span class="c">same as ANSWER#</span>""")
    r_row = pre("""<span class="c">// written once, when the host closes it</span>
<span class="k">SK</span>  SURVEY#RESULTS               <span class="c">30 days</span>
<span class="k">Version</span> 2 · <span class="k">N</span> 41 · <span class="k">Finished</span> 38
<span class="k">PerQuestion</span> {
  <span class="s">"c001#001"</span>: { n:38, counts:[1,2,6,15,14], mean:4.03 },
  <span class="s">"c001#003"</span>: { n:38, counts:[14,11,7,4,2] },
  <span class="s">"c001#006"</span>: { n:35, avgPlace:[…], firsts:[…] },
  <span class="s">"c001#007"</span>: { n:31, answerIds:[…] }
}
<span class="k">SK</span>  SURVEY#ANALYSIS              <span class="c">30 days · Workie</span>
<span class="k">Lead</span>, <span class="k">Body</span>, <span class="k">Next</span>[], <span class="k">Caveat</span>, <span class="k">Notes</span>{qid},
<span class="k">Themes</span>{qid: [{label, answerIds}]}, <span class="k">HeldBack</span>[answerId],
<span class="k">PersonaId</span>, <span class="k">PromptId</span>, <span class="k">Edited</span> true""")
    s_row = pre("""<span class="c">// a frozen copy, so a link never changes under its readers</span>
<span class="k">PK</span>  SHARES           <span class="k">SK</span>  SHARE#7fK2-mQ9x
<span class="k">Game</span>, <span class="k">Org</span>, <span class="k">CreatedBy</span>, <span class="k">Scope</span> <span class="s">"link"</span>|<span class="s">"org"</span>
<span class="k">Snapshot</span>  s3://…/shares/7fK2-mQ9x.json  <span class="c">encrypted for org</span>
<span class="k">ttl</span>  OpenedAt + 2 days  <span class="c">default; 7/30/90 offered</span>
<span class="k">Revoked</span>  false""")

    flow = "".join(f'<div class="s"><b>{t}</b><span>{d}</span></div>' for t, d in [
        ("Author", "The set editor saves a new version through <code>upload-questions</code>; each question row carries <code>Kind</code>."),
        ("Run", "A session pins that version (<code>gameSetRef</code>). Survey: phones pace themselves. Poll: the host paces."),
        ("Open", "<code>start-game.js</code> stamps <code>OpenedAt</code> and locks <code>Names</code>. The share clock starts here."),
        ("Answer", "<code>PUT /games/{id}/survey/answers</code> per question. Overwrites; partial answers count."),
        ("Close", "<code>POST …/survey/close</code> aggregates into <code>SURVEY#RESULTS</code> and starts Workie."),
        ("Read", "Console, the wall walk-through, the report: one <code>GET …/survey-results</code>."),
        ("Share", "<code>POST …/survey/share</code> writes a snapshot; <code>GET /r/{token}</code> serves it, public."),
    ])
    life = [("SURVEY#RESP#&lt;respondent&gt;", "the phone, per answer", 7, "the raw answers; a name only when Named"),
            ("QUESTION#nnn#ANSWER#&lt;player&gt;", "a poll's phone, per question", 7, "as today, AnswerType = kind"),
            ("SURVEY#RESULTS", "close", 30, "counts, means, places — no text"),
            ("SURVEY#ANALYSIS", "Workie, on close / Redo", 30, "read, notes, themes, held-back ids"),
            ("REPORT (session)", "create-report", 30, "the report JSON, survey section included"),
            ("Saved PDF", "save-report", 90, "90 days standard, 365 permanent — as today"),
            ("SURVEY#DONE#&lt;player&gt;", "the phone, in Who finished", 7, "name + started/finished; no answers, no respondent id"),
            ("SHARE#&lt;token&gt;", "Share", 2, "from the survey opening: 2 days default, or 7 / 30 / 90")]
    lrows = "".join(f'<tr><td><span class="sv-key">{k}</span></td><td class="wrap">{w}</td>'
                    f'<td class="bar"><div class="lb"><i class="{"keep" if d > 7 else ""}" style="width:{min(100, round(d * 100 / 90))}%"></i></div></td>'
                    f'<td class="num">{d} d</td><td class="wrap dim">{n}</td></tr>' for k, w, d, n in life)
    routes = [("PUT", "/games/{id}/survey/answers", "player", "one answer: {qid, value}; idempotent"),
              ("POST", "/games/{id}/survey/submit", "player", "marks Complete; answers stay editable until close"),
              ("POST", "/games/{id}/survey/close", "host", "freeze results, start Workie, broadcast surveyClosed"),
              ("GET", "/games/{id}/survey-results", "host", "results + analysis; never names"),
              ("GET", "/games/{id}/survey/people", "host", "Who finished / Named only: the People tab"),
              ("POST", "/games/{id}/survey/analysis", "host", "Redo with a steer, or save edited words"),
              ("POST", "/games/{id}/survey/share", "host", "create / update / revoke a snapshot link"),
              ("GET", "/r/{token}", "public", "the shared page; 404 once revoked or expired")]
    rrows = "".join(f'<tr><td class="mono">{m}</td><td><span class="sv-key">{p}</span></td><td>{a}</td><td class="wrap dim">{w}</td></tr>'
                    for m, p, a, w in routes)
    agg = [("Rating 1–5 / 1–10", "one number", "count per step; mean; share at the top two steps"),
           ("Rating 0–10 (recommend)", "one number", "0–6 / 7–8 / 9–10 split; score = %9–10 − %0–6"),
           ("Choice, pick one", "[index]", "count per option ÷ people who answered"),
           ("Choice, pick several", "[index…, {other}]", "count per option ÷ people who answered (sums past 100%); write-ins listed"),
           ("Yes / No", "{v, why}", "count per answer; whys grouped under the answer that asked"),
           ("Ranking", "[index…] in order", "average place (unplaced = last); how many put each first; place histogram"),
           ("Open answer", "text", "count; Workie themes over answer ids; host picks quotes")]
    arows = "".join(f'<tr><td>{k}</td><td class="mono">{v}</td><td class="wrap">{h}</td></tr>' for k, v, h in agg)

    body = f"""
    <div class="work-head"><div><h1>How a survey is stored, recorded and shared</h1>
      <p class="sub">Single table, the prefixes this product already uses. Three new row kinds on the session (<span class="mono">SURVEY#RESP</span>, <span class="mono">SURVEY#RESULTS</span>, <span class="mono">SURVEY#ANALYSIS</span>), one new partition (<span class="mono">SHARES</span>), one new field on a question row (<span class="mono">Kind</span>).</p></div></div>
    <div class="work-body">
      <div class="sv-flow">{flow}</div>
      <div class="sv-dm">
        <section class="panel"><header><h2>The question</h2><p class="note">in the set, versioned</p></header><div class="body">{q_row}<p class="dim" style="font-size:var(--t-label);margin:10px 0 6px">What each kind adds:</p>{kinds}</div></section>
        <section class="panel"><header><h2>The answers</h2><p class="note">in the session, 7 days</p></header><div class="body">{a_row}
          <p class="dim" style="font-size:var(--t-label);margin:10px 0 0;line-height:1.5">One row per person keeps a survey to one write per answer and one read per person, and makes resume trivial: the phone asks for its own row back. A poll keeps today's per-question <span class="mono">ANSWER#</span> rows, with the same value shapes.</p></div></section>
        <section class="panel"><header><h2>Frozen at close</h2><p class="note">results, Workie, shares</p></header><div class="body">{r_row}<div style="height:10px"></div>{s_row}</div></section>
      </div>
      <section class="panel" style="margin-top:14px"><header><h2>Names decides what is written</h2><p class="note">session <span class="mono">METADATA.Names</span>, copied from the set's default at create, locked at open</p></header>
        <div class="body flush"><table class="tbl"><thead><tr><th style="width:150px">Names</th><th style="width:300px">Answer row key</th><th>Also written</th><th style="width:250px">Host gets</th><th style="width:210px">Resume</th></tr></thead><tbody>
          <tr><td><b>Anonymous</b></td><td class="wrap"><span class="sv-key">SURVEY#RESP#&lt;random id&gt;</span>made by the phone, kept in its local storage</td><td class="wrap">nothing</td><td class="wrap">counts and answer text</td><td class="wrap">same phone only</td></tr>
          <tr><td><b>Who finished</b></td><td class="wrap"><span class="sv-key">SURVEY#RESP#&lt;random id&gt;</span>exactly as Anonymous</td><td class="wrap"><span class="sv-key">SURVEY#DONE#&lt;player&gt;</span>name and status: started at the first answer, finished on Send; no link to the answers</td><td class="wrap">the above, plus who finished and who stopped partway</td><td class="wrap">same phone only</td></tr>
          <tr><td><b>Named</b></td><td class="wrap"><span class="sv-key">SURVEY#RESP#&lt;player&gt;</span>with <span class="mono">Name</span></td><td class="wrap">nothing</td><td class="wrap">each person&rsquo;s answers, People tab, CSV with names</td><td class="wrap">any device, by rejoining with the same name</td></tr>
        </tbody></table></div></section>
      <section class="panel" style="margin-top:14px"><header><h2>How each kind is counted</h2><p class="note">one function, <span class="mono">surveyResults.js</span>, used by the console, the wall, the PDF and the shared page</p></header>
        <div class="body flush"><table class="tbl"><thead><tr><th style="width:230px">Kind</th><th style="width:190px">Stored as</th><th>Counted as</th></tr></thead><tbody>{arows}</tbody></table></div></section>
      <div class="grid2">
        <section class="panel"><header><h2>How long each thing is kept</h2></header><div class="body flush">
          <table class="tbl sv-life"><thead><tr><th style="width:220px">Row</th><th style="width:150px">Written by</th><th style="width:90px"></th><th class="num" style="width:54px">Kept</th><th>What is in it</th></tr></thead><tbody>{lrows}</tbody></table></div></section>
        <section class="panel"><header><h2>Routes</h2><p class="note">all new; auth as the feedback round's</p></header><div class="body flush">
          <table class="tbl"><thead><tr><th style="width:52px"></th><th style="width:230px">Path</th><th style="width:64px">Who</th><th>Does</th></tr></thead><tbody>{rrows}</tbody></table></div></section>
      </div>
    </div>
{anno("Why one row per person", "A survey is eight answers from one person, read together at the end. Per-question rows (the poll's shape) would be eight writes and a Query per question at close; one row is one read per person. The row is small: eight answers, the longest 500 characters.")}
{anno("Recording is autosave", "Each answer is written the moment it is given (<code>PUT …/answers</code>, an idempotent overwrite of one map key). So a person who closes the tab at question 5 still counts for 1&ndash;4, a reload resumes where they were, and &lsquo;Send&rsquo; only marks the row complete.")}
{anno("Names: written, not hidden", "A promise is only as strong as what the server holds. In Anonymous and Who finished the answer row has no name and no player id &mdash; the phone makes a random id and keeps it &mdash; so there is nothing to leak or to subpoena. Who finished adds a separate list with no link back. Only Named stores a name with answers. Whatever the mode, results, Workie's prompt and shared snapshots are built from counts and text, never names. <code>tenant-crypto</code> encrypts Answers per org, like <code>ANSWER#</code> rows (<code>message.js:529-541</code>).")}
{anno("Why freeze at close", "Session rows expire at 7 days (<code>session-ttl.js</code>) and the report must not depend on them &mdash; the same reason <code>create-report.js</code> reconciles from a snapshot today. Close writes the results once; everything after reads that.")}
"""
    write("40-data-model.html", console_page("Survey data model", body, nav="sessions"), group="data")
