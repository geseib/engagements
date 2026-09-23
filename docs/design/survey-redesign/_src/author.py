# -*- coding: utf-8 -*-
"""Creating, generating, reviewing and editing a survey in the console."""
from build import console_page, write, ico, anno
from content import Q, KIND, TITLE, n_of

SETS_BG = """
    <div class="work-head">
      <div><h1>Question sets</h1><p class="sub">43 sets</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{dl}Templates</button>
        <button class="btn primary">{plus}New set</button></div>
    </div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.5" aria-hidden="true">
      <div class="filters"><div class="search">{srch}<input class="inp"></div><select class="inp"><option>All types</option></select></div>
      <table class="tbl"><thead><tr><th>Set</th><th style="width:150px">Type</th><th class="num" style="width:60px">Qs</th><th style="width:170px">State</th><th style="width:120px">Updated</th></tr></thead><tbody>
      <tr><td><span class="nm">Q3 Leadership Offsite — Lessons Learned</span></td><td><span class="chip type">Call &amp; Answer</span></td><td class="num">42</td><td><span class="chip on">Active</span></td><td class="when">7 Aug 2026</td></tr>
      <tr><td><span class="nm">Onboarding pulse — week 4</span></td><td><span class="chip type">Survey</span></td><td class="num">6</td><td><span class="chip on">Active</span></td><td class="when">19 Sep 2026</td></tr>
      <tr><td><span class="nm">Pricing Mechanics</span></td><td><span class="chip type">Trivia</span></td><td class="num">10</td><td><span class="chip on">Active</span></td><td class="when">2 Sep 2026</td></tr>
      <tr><td><span class="nm">Where should we land on March?</span></td><td><span class="chip type">Poll</span></td><td class="num">4</td><td><span class="chip off">Draft</span></td><td class="when">21 Sep 2026</td></tr>
      </tbody></table>
    </div>""".format(dl=ico("download"), plus=ico("plus"), srch=ico("search"))


def kind_chip(kind):
    icon, label = KIND[kind]
    return f'<span class="sv-kind">{ico(icon)}{label}</span>'


def preview(q):
    k = q["kind"]
    if k == "rating":
        return f'<b>1&ndash;5</b> &middot; {q["low"]} &rarr; {q["high"]}'
    if k == "nps":
        return f'<b>0&ndash;10</b> &middot; recommend score'
    if k == "choice":
        rule = f'pick up to {q["pick"]}' if q.get("multi") else "pick one"
        other = " + write-in" if q.get("other") else ""
        return f'<b>{len(q["opts"]) - (1 if q.get("other") else 0)} options</b> &middot; {rule}{other}'
    if k == "yesno":
        return f'<b>Yes / No / Not sure</b> &middot; asks why on No'
    if k == "rank":
        return f'<b>{len(q["items"])} items</b> &middot; top {q["top"]} is enough'
    return f'<b>{"Long" if q["length"] == "long" else "Short"} answer</b> &middot; up to {q["limit"]} characters'


def build():
    # ------------------------------------------------------------ 01 new ----
    body = SETS_BG + f"""
    <div class="scrim">
      <div class="modal sv-modal">
        <header><div><h2>New question set</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">Pick the kind of round, then generate it, start from a template, or upload a file.</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="field sv-step"><span class="lab">Kind of round</span>
            <div class="sv-opts" role="radiogroup">
              <button class="sv-opt one" aria-pressed="false">Call &amp; Answer</button>
              <button class="sv-opt one" aria-pressed="false">Trivia</button>
              <button class="sv-opt one" aria-pressed="false">Poll</button>
              <button class="sv-opt one" aria-pressed="false">Wavelength</button>
              <button class="sv-opt one" aria-pressed="true">Survey</button></div>
            <p class="help"><b style="color:var(--text)">A form people fill in at their own pace</b> &mdash; ratings, choices, yes/no, rankings and open answers. Results come together when you close it. <span class="dim">(A <b style="color:var(--text)">Poll</b> uses the same questions one at a time, with each result revealed on the big screen.)</span></p>
          </div>
          <div class="field sv-step"><span class="lab">Start from</span>
            <div class="sv-starts">
              <button class="sv-start" aria-pressed="true">{ico('sparkle')}<div><b>Your own material</b><span>Paste a talk outline or attach the deck. Workie drafts the questions; you review every one before it is saved.</span></div></button>
              <button class="sv-start" aria-pressed="false">{ico('books')}<div><b>A template</b><span>A ready survey you edit. Nothing is saved until you do.</span>
                <div class="sv-tpls"><span class="sv-tpl">Presentation feedback</span><span class="sv-tpl">Event feedback</span><span class="sv-tpl">Workshop retro</span><span class="sv-tpl">Training evaluation</span><span class="sv-tpl">Team pulse</span></div></div></button>
              <button class="sv-start" aria-pressed="false">{ico('pencil')}<div><b>A blank survey</b><span>Add questions one at a time.</span></div></button>
              <button class="sv-start" aria-pressed="false">{ico('upload')}<div><b>A file</b><span>A CSV with a Kind column, or the JSON a survey exports. <a href="#" style="color:var(--text)">Download the template</a></span></div></button>
            </div></div>
        </div>
        <footer><button class="btn">Close</button><span class="grow"></span><button class="btn primary">Continue</button></footer>
      </div>
    </div>
{anno("Survey stops being a dead end", "Today <code>gameTypes.js:159</code> marks Survey unplayable, the importer refuses it (<code>upload-questions.js:286-300</code>) and the AI builder can only download JSON. This dialog is the shipped <code>NewSetDialog</code> (same title, same sub-line, one Close through <code>requestClose</code>); Survey joins the kinds and gains the four ways in.")}
{anno("Poll vs Survey, said where it is chosen", "Both are built from the same five question kinds. <b>Poll</b> = host-paced, one question on the wall, result revealed live. <b>Survey</b> = everyone at their own pace, results when it closes. One sentence each, under the choice, not in a help page.")}
{anno("Never a modal from a modal", "Continue closes this and opens the next dialog (the generator or the editor) — the rule <code>NewSetDialog.jsx</code> already states.")}
"""
    write("01-new-survey.html", console_page("New survey", body), group="author")

    # ------------------------------------------------------------ 02 generate --
    kinds = [("star", "Rating", True), ("list", "Multiple choice", True), ("toggle", "Yes / No", True),
             ("rank", "Ranking", False), ("text", "Open answer", True)]
    toggles = "".join(f'<button class="sv-opt" aria-pressed="{"true" if on else "false"}">{ico(i)}{l}<span class="tick">&#10003;</span></button>'
                      for i, l, on in kinds)
    body = SETS_BG + f"""
    <div class="scrim">
      <div class="modal sv-modal">
        <header><div><h2>Generate a survey</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">The job runs on the server, so you can close this once it starts.</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="field sv-step sv-src"><label for="src">What was the session? Paste the outline, or attach the deck</label>
            <textarea class="inp" id="src" rows="6">Q3 all-hands, 22 Sep, 40 minutes, whole company (~45 people).
1. Q2 recap — what shipped, what slipped (the approval-flow delay)
2. Live demo: the new console, approval flow end to end (Dana)
3. Three customer stories — Halvorsen, Brightwater, Ostrava Rail — with renewal numbers
4. Pricing roadmap for FY27: list price hold, usage tier pilot
5. Hiring plan update; open Q&amp;A (5 min)</textarea>
            <div class="meta"><span class="sv-file">{ico('file')}Q3-allhands-deck.pdf &middot; 24 pages &middot; 6,180 words read<span class="x" aria-label="Remove">&times;</span></span><span class="grow"></span><span>Text, PDF or Word, up to 5&nbsp;MB</span></div>
          </div>
          <div class="field sv-step"><label for="goal">What do you want to find out?</label>
            <input class="inp" id="goal" value="Whether the new format worked, and what people want next time">
            <p class="help">One sentence. It decides what the questions are for; the material decides what they are about.</p></div>
          <div class="field sv-step"><span class="lab">Kinds of question</span>
            <div class="sv-opts" role="group" aria-label="Kinds of question">{toggles}</div>
            <p class="help">Workie uses only the ticked kinds and mixes them. Tick one for a single-kind survey.</p></div>
          <div class="field sv-step"><span class="lab">How many</span>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div class="sv-opts"><button class="sv-opt one" aria-pressed="false">Quick 5</button><button class="sv-opt one" aria-pressed="true">Standard 8</button><button class="sv-opt one" aria-pressed="false">Thorough 12</button></div>
              <p class="sv-line"><span>About</span><input class="sv-num" type="number" value="8" aria-label="Questions"><span>questions</span><span class="sv-per">about 3 minutes to answer</span></p></div>
            <p class="help">Past twelve, people stop reading. The cap is 20.</p></div>
          <details class="cs-more sv-step" style="border:1px solid var(--rule);border-radius:8px;background:var(--bg)"><summary style="display:flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;color:var(--muted);font:600 var(--t-label)/1 var(--font-ui);list-style:none">{ico('down')}Anything else Workie must obey</summary></details>
        </div>
        <footer><button class="btn">Cancel</button><span class="grow"></span><button class="btn primary">{ico('sparkle')}Write the survey</button></footer>
      </div>
    </div>
{anno("The material is the input", "The owner's ask: &ldquo;an AI can create a list of survey questions based on some input text.&rdquo; The builder already accepts pasted text and a file (<code>FileUploadPrompt</code> &rarr; <code>parse-document.js</code>) but files it under &lsquo;custom prompt&rsquo;. Here the material gets its own field and the goal gets another, because they do different jobs in the prompt.")}
{anno("Selectable kinds, all five", "Today's generator knows three (<code>ai-generate-survey.js</code>: rating, multiple_choice, text_entry) and two of its three checkboxes are dead (<code>SurveyAIBuilder.jsx:589-591</code> builds the key <code>includeMultiplechoice</code>). Five toggles, each an icon and a word, a tick as well as the fill.")}
{anno("Counted in minutes", "The shipped modal's quotient idea (&lsquo;6 per category&rsquo;): here the third fact is time to answer, because that is what a facilitator trades off. ~20s per question, 60s per open answer.")}
"""
    write("02-generate.html", console_page("Generate a survey", body, jobchip=""), group="author")

    # ------------------------------------------------------------ 03 review ----
    rows = []
    for q in Q:
        ex = q["n"] == 2
        changed = q["n"] == 6
        chip = kind_chip(q["kind"])
        extra = ""
        was = ' &middot; <span style="color:var(--primary)">was Multiple choice</span>' if changed else ""
        sel = ' style="opacity:.5"' if ex else ""
        rows.append(f"""      <tr{sel}><td><label class="cbx"><input type="checkbox"{'' if ex else ' checked'} aria-label="Keep question {q['n']}"></label></td>
        <td class="num dim">{q['n']}</td><td>{chip}{extra}</td>
        <td><span class="nm">{q['title']}</span><span class="sv-prev">{preview(q)}{was}</span></td>
        <td><div class="rowact show"><button class="btn sm">{ico('pencil')}Edit</button><button class="btn sm ghost">{ico('refresh')}Rewrite</button></div></td></tr>""")
    body = SETS_BG + f"""
    <div class="scrim">
      <div class="modal wide" style="width:min(1060px,100%)">
        <header><div><h2>Workie wrote 8 questions</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">From <b style="color:var(--text)">Q3-allhands-deck.pdf</b> and your outline. Untick to leave one out; nothing is saved until you do.</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body" style="padding:0 18px">
          <div class="sv-mix" style="margin:0 0 10px"><span class="dim" style="font-size:var(--t-label)">Mix:</span>
            {kind_chip('rating')}<span class="dim" style="font-size:var(--t-label)">&times;2</span>
            {kind_chip('choice')}<span class="dim" style="font-size:var(--t-label)">&times;2</span>
            {kind_chip('yesno')}<span class="dim" style="font-size:var(--t-label)">&times;1</span>
            {kind_chip('rank')}<span class="dim" style="font-size:var(--t-label)">&times;1</span>
            {kind_chip('text')}<span class="dim" style="font-size:var(--t-label)">&times;2</span>
            <span class="dim" style="font-size:var(--t-label);margin-left:auto">7 kept &middot; about 3 minutes</span></div>
          <table class="tbl"><thead><tr><th style="width:34px"></th><th class="num" style="width:32px">#</th><th style="width:250px">Kind</th><th>Question</th><th style="width:170px"></th></tr></thead><tbody>
{chr(10).join(rows)}
          </tbody></table>
        </div>
        <footer><button class="btn danger">Discard</button><span class="grow"></span>
          <button class="btn">{ico('sparkle')}Write 3 more like these</button>
          <button class="btn primary">Save 7 as a draft survey</button></footer>
      </div>
    </div>
{anno("The shared review table", "This is <code>GeneratedItemsTable</code>, the one the four builders already share (per-item exclude and edit), with a Kind column. Rewrite regenerates one row; Edit opens the same question form the editor uses (04/05), so there is one form, not two.")}
{anno("Saved as a draft set, not a download", "The survey worker has no <code>setCreation</code> (<code>ai-generate-survey.js:197-201</code>) so the only exit today is JSON. It gets the same draft-set path trivia and polls use (<code>shared/generated-set.js</code>): an <b>inactive</b> survey set, opened in the editor.")}
{anno("Kind is editable here", "Row 6 was drafted as multiple choice and switched to Ranking &mdash; the options carry over because the two kinds share a list. Switching to a kind that shares nothing asks first.")}
"""
    write("03-review.html", console_page("Review the draft survey", body), group="author")

    # ------------------------------------------------------------ 04 editor ----
    rows = []
    for q in Q:
        sel = ' aria-selected="true"' if q["n"] == 6 else ""
        req = '<span class="sv-req on">Required</span>' if q["req"] else '<span class="sv-req">Optional</span>'
        rows.append(f"""        <tr{sel}><td class="grip">{ico('grip')}</td><td class="num dim">{q['n']}</td>
          <td>{kind_chip(q['kind'])}</td>
          <td><span class="nm">{q['title']}</span><span class="sv-prev">{preview(q)}</span></td>
          <td>{req}</td>
          <td><div class="rowact"><button class="btn sm">{ico('pencil')}Edit</button><button class="btn sm ghost" aria-label="Move up">{ico('up')}</button><button class="btn sm ghost" aria-label="Move down">{ico('down')}</button><button class="btn sm ghost" aria-label="More">&#8943;</button></div></td></tr>""")
    HI = ' class="hi"'
    menu = "".join(f'<button{HI if k == "yesno" else ""}>{ico(KIND[k][0])}<div><b>{l}</b><span>{d}</span></div></button>' for k, l, d in [
        ("rating", "Rating", "A scale: 1–5, 1–10, 0–10 (a recommend score) or stars."),
        ("choice", "Multiple choice", "Pick one or several, with an optional write-in."),
        ("yesno", "Yes / No", "Two buttons, an optional Not sure, and an optional &lsquo;why?&rsquo;"),
        ("rank", "Ranking", "Put 3–7 items in order; the top few can be enough."),
        ("text", "Open answer", "Words. Workie groups them into themes when the survey closes."),
    ])
    body = f"""
    <div class="work-head">
      <div style="min-width:0"><h1>{TITLE}</h1>
        <p class="sub">Survey &middot; 8 questions &middot; about 3 minutes &middot; v2 &middot; run 3 times &middot; Names: Anonymous by default</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn"><span class="chip on">Active</span></button>
        <button class="btn">{ico('eye')}Try it on a phone</button><button class="btn">&#9889; Run it</button>
        <button class="btn ghost" aria-label="More">&#8943;</button></div>
    </div>
    <nav class="subnav"><button>Details</button><button aria-current="true">Questions <span class="dim">8</span></button>
      <button>Versions <span class="dim">2</span></button><button>Results <span class="dim">3 sessions</span></button>
      <button class="dngr">Delete</button></nav>
    <div class="work-body">
      <section class="sv-card">
        <header><h2>Questions</h2>
          <p class="dim" style="margin:0;font-size:var(--t-label)">2 ratings &middot; 2 multiple choice &middot; 1 yes/no &middot; 1 ranking &middot; 2 open</p>
          <span class="grow"></span>
          <div class="seg" role="group" aria-label="How the questions are shown"><button aria-pressed="true">Table</button><button aria-pressed="false">Preview</button></div>
          <button class="btn">{ico('sparkle')}Generate more</button>
          <span style="position:relative"><button class="btn primary" aria-expanded="true">{ico('plus')}Add question {ico('down')}</button>
            <div class="sv-menu" style="right:0;top:36px">{menu}<hr><button>{ico('books')}<div><b>From another set</b><span>Copy questions from a survey or poll you already have.</span></div></button></div></span>
        </header>
        <div class="sv-well">
          <table class="tbl"><thead><tr><th style="width:30px"></th><th class="num" style="width:30px">#</th><th style="width:170px">Kind</th><th>Question</th><th style="width:90px">Required</th><th style="width:210px"></th></tr></thead><tbody>
{chr(10).join(rows)}
          </tbody></table>
        </div>
        <p class="dim" style="font-size:var(--t-label);margin:0 14px 10px">Drag a row, or use its arrows. Each save is a new version; the three sessions already run keep the version they ran.</p>
      </section>
    </div>
    <div style="flex:none;display:flex;gap:10px;align-items:center;padding:10px 180px 10px 20px;border-top:1px solid var(--rule);background:var(--surface)">
      <span class="chip warn"><span class="dot"></span>1 unsaved change</span><span class="dim" style="font-size:var(--t-label)">moved question 6 above 7</span>
      <span class="grow" style="flex:1"></span><button class="btn">Discard</button><button class="btn primary">Save as v3</button></div>
{anno("The editor already exists", "This is <code>QuestionSetEditor</code> + <code>QuestionsPanel</code> (the working copy, tombstones, <code>moveRow</code> up/down, one save through <code>upload-questions</code> with <code>replaceSetId</code>). A survey set only adds the Kind column and the answer preview line. Dark, per the owner (<code>QuestionSetEditor.css</code>: card / well / row).")}
{anno("Add question names the kind first", "The menu is five sentences, not five icons: the kind decides every field that follows, so it is the first thing chosen. Yes / No is highlighted because the keyboard is on it (&uarr;&darr;, Enter).")}
{anno("Results live on the set", "A Results tab lists the sessions this set ran in, so &lsquo;how did the feedback survey do this quarter&rsquo; has one place. Each session opens 30-results.")}
{anno("Editing after it has run", "Every save is a version (<code>set-version.js</code>) and a running or finished session keeps its pinned one, so an edit can never rewrite a result. The sub-line says &lsquo;run 3 times&rsquo; so nobody edits blind.")}
"""
    write("04-editor.html", console_page("Survey editor — questions", body, nav="sets", back="Question sets"), group="author")

    # ------------------------------------------------------------ 05 edit a q --
    q1 = Q[0]
    kb = "".join(f'<button class="sv-opt" aria-pressed="{"true" if k == "rating" else "false"}">{ico(KIND[k][0])}{KIND[k][1] if k != "nps" else ""}</button>'
                 for k in ("rating", "choice", "yesno", "rank", "text"))
    body = f"""
    <div class="work-head"><div><h1>{TITLE}</h1><p class="sub">Survey &middot; 8 questions</p></div></div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.45" aria-hidden="true"><div class="sv-card" style="height:420px"></div></div>
    <div class="scrim">
      <div class="modal sv-qmodal">
        <header><div><h2>Question 1 of 8</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">Changes stay in this set&rsquo;s working copy until you save the set.</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="sv-edit">
          <div class="form">
            <div class="field"><span class="lab">Kind</span><div class="sv-kindbar">{kb}</div>
              <p class="help">Switching to Multiple choice or Ranking keeps nothing from a scale, so it asks first.</p></div>
            <div class="field"><label for="qt">Question</label><input class="inp" id="qt" value="{q1['title']}"></div>
            <div class="field"><label for="qd">Detail <span class="dim">&mdash; optional, shown under the question</span></label><input class="inp" id="qd" placeholder="Think about the next two weeks, not the quarter."></div>
            <div class="field"><span class="lab">Scale</span>
              <div class="seg" role="radiogroup"><button aria-pressed="true">1&ndash;5</button><button aria-pressed="false">1&ndash;10</button><button aria-pressed="false">0&ndash;10 recommend score</button><button aria-pressed="false">Stars</button></div></div>
            <div class="sv-row">
              <div class="field"><label for="lo">Label under 1</label><input class="inp" id="lo" value="{q1['low']}"></div>
              <div class="field"><label for="hi">Label under 5</label><input class="inp" id="hi" value="{q1['high']}"></div></div>
            <label class="sv-switch"><input type="checkbox" checked><span>Needs an answer<small>Required questions can&rsquo;t be skipped. Keep it to the one or two you must have.</small></span></label>
          </div>
          <div class="side"><span class="lab">On a phone</span>
            <div class="sv-phone"><iframe src="p-01-rating.html" title="Phone preview" tabindex="-1"></iframe></div>
            <p class="dim" style="font-size:var(--t-label);text-align:center;margin:0">The real player, not a sketch of it.</p></div>
        </div>
        <footer><button class="btn danger">{ico('trash')}Delete question</button><span class="grow"></span>
          <button class="btn">Cancel</button><button class="btn primary">Done</button></footer>
      </div>
    </div>
{anno("One form, the kind decides the fields", "<code>QuestionForm</code> (<code>QuestionsPanel.jsx:1751</code>) already switches fields by game type (trivia A&ndash;F, poll options). A survey switches them by <b>kind</b> instead. Title and Detail are the rows every question already has; the scale, labels and Required are new.")}
{anno("The preview is the player", "An iframe of the participant surface at phone width, fed this draft &mdash; the same idea as the editor's shipped Table / Preview switch (<code>QuestionPreview.jsx</code>). The labels you type appear under the ends, where the participant reads them.")}
{anno("Exits", "X, Cancel, Escape and the backdrop go through one <code>requestClose()</code> that asks when the draft differs; Done keeps it. Delete marks a tombstone like every other editor row.")}
"""
    write("05-edit-question.html", console_page("Edit a survey question", body, back="Question sets"), group="author")

    # ------------------------------------------------------------ 06 kinds -----
    q3, q4, q5, q6, q7 = Q[2], Q[3], Q[4], Q[5], Q[6]
    optlist = "".join(f'<div class="o"><span class="k">{"ABCDE"[i]}</span><input class="inp" value="{t}"><button class="btn sm ghost" aria-label="Remove">{ico("x")}</button></div>'
                      for i, (t, _) in enumerate(q3["opts"]))
    ranklist = "".join(f'<div class="o"><span class="k">{ico("grip")}</span><input class="inp" value="{t}"><button class="btn sm ghost" aria-label="Remove">{ico("x")}</button></div>'
                       for t, _, _ in q6["items"])
    body = f"""
    <div class="work-head"><div><h1>The fields each kind asks for</h1>
      <p class="sub">The same question form as 05, with the other four kinds selected. Title, Detail and Needs-an-answer are on every kind and are left out here.</p></div></div>
    <div class="work-body"><div class="sv-kinds4">
      <section class="panel"><header><h2>{ico('list')}Multiple choice</h2></header><div class="body">
        <div class="field"><span class="lab">Options <span class="dim">&mdash; 2 to 8</span></span><div class="sv-optlist">{optlist}</div>
          <button class="btn sm" style="align-self:flex-start;margin-top:4px">{ico('plus')}Add an option</button></div>
        <div class="field"><span class="lab">People can pick</span>
          <div class="sv-line"><div class="seg"><button aria-pressed="true">One</button><button aria-pressed="false">Several</button></div>
          <span class="dim" style="font-size:var(--t-label)">up to</span><input class="sv-num" value="2" disabled aria-label="Most picks"></div></div>
        <label class="sv-switch"><input type="checkbox"><span>Add &lsquo;Something else&rsquo; with a box<small>Write-ins are listed under the chart and never counted as an option.</small></span></label>
        <label class="sv-switch"><input type="checkbox" checked><span>Shuffle the order for each person<small>Stops the first option winning because it was first.</small></span></label>
      </div></section>

      <section class="panel"><header><h2>{ico('toggle')}Yes / No</h2></header><div class="body">
        <div class="sv-row"><div class="field"><label>Yes reads</label><input class="inp" value="Yes"></div>
          <div class="field"><label>No reads</label><input class="inp" value="No"></div></div>
        <label class="sv-switch"><input type="checkbox" checked><span>Offer &lsquo;Not sure&rsquo;<small>A third, smaller button. Counted, never folded into No.</small></span></label>
        <label class="sv-switch"><input type="checkbox" checked><span>Ask why<small>A box opens under the answer, on the same screen.</small></span></label>
        <div class="sv-sub"><div class="sv-row"><div class="field sm"><label>When they say</label><select class="inp"><option>No</option><option>Yes</option><option>Either</option></select></div>
          <div class="field"><label>Ask</label><input class="inp" value="{q5['follow'][1]}"></div></div></div>
      </div></section>

      <section class="panel"><header><h2>{ico('rank')}Ranking</h2></header><div class="body">
        <div class="field"><span class="lab">Items to put in order <span class="dim">&mdash; 3 to 7</span></span><div class="sv-optlist">{ranklist}</div>
          <button class="btn sm" style="align-self:flex-start;margin-top:4px">{ico('plus')}Add an item</button></div>
        <div class="field"><span class="lab">How much ranking</span>
          <div class="sv-line"><div class="seg"><button aria-pressed="false">All of them</button><button aria-pressed="true">Just the top</button></div><input class="sv-num" value="3" aria-label="Top how many"></div>
          <p class="help">Past four, people guess. The results read by average place, and unranked items count as last.</p></div>
      </div></section>

      <section class="panel"><header><h2>{ico('text')}Open answer</h2></header><div class="body">
        <div class="field"><span class="lab">Length</span><div class="seg"><button aria-pressed="false">Short &mdash; a line</button><button aria-pressed="true">Long &mdash; a paragraph</button></div></div>
        <div class="sv-row"><div class="field sm"><label>Up to</label><input class="inp" value="500"></div>
          <div class="field"><label>Placeholder <span class="dim">&mdash; optional</span></label><input class="inp" placeholder="What you'd tell a colleague who missed it"></div></div>
        <label class="sv-switch"><input type="checkbox" checked><span>Let Workie group the answers into themes<small>On close. You still read every answer; themes only sort them.</small></span></label>
        <div class="note-box" style="margin:0">Answers that name a person are held back from shared results until you release them.</div>
      </div></section>
    </div></div>
{anno("Field names follow what exists", "Choice keeps the poll's <code>options[]</code> + <code>allowMultiple</code> (<code>upload-questions.js:1089-1093</code>); rating keeps the generator's <code>scale.lowLabel/highLabel</code>. New fields: <code>maxPicks</code>, <code>allowOther</code>, <code>shuffle</code>, <code>unsure</code>, <code>followUp</code>, <code>rankTop</code>, <code>textLength</code>, <code>maxLength</code>, <code>themes</code>. See 40-data-model.")}
{anno("Two kinds share a list", "Choice and Ranking both edit a list of strings, so switching between them keeps the list. Rating &harr; anything, and Open answer &harr; anything, keep only Title and Detail &mdash; and ask first.")}
{anno("Anonymity is a promise", "An open answer can still name someone. The flag is Workie's (the same pass that finds themes) and the host decides; a shared page never shows one unreleased.")}
"""
    write("06-kind-fields.html", console_page("The fields each kind asks for", body, back="Question sets"), group="author")
