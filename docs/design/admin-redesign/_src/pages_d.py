# -*- coding: utf-8 -*-
"""Page bodies, part 4: users, prompts, archive, settings."""

from pages import ico, anno, chip

# ============================================================ 16 users ====
_PEND = "\n".join(
  f"""        <li class="pend">
          <span class="pav">{initials}</span>
          <span class="pinfo"><span class="pn">{name}</span>
            <span class="pe">{email}</span></span>
          <span class="pmeta">{meta}</span>
          <span class="pacts">
            <button class="btn primary sm">{ico('check')}Approve as host</button>
            <button class="btn sm">Admin</button>
            <button class="btn sm danger">Reject</button>
          </span></li>"""
  for initials, name, email, meta in [
    ("BF", "Bartholomew Featherstonehaugh-Vance",
     "bartholomew.featherstonehaugh-vance@northgate-consulting-partners.example.com",
     "Signed up 3 days ago &middot; Google &middot; email confirmed"),
    ("AO", "Adaeze Okafor", "a.okafor@example.com",
     "Signed up 6 days ago &middot; Cognito &middot; <span class='unconf'>email not confirmed</span>"),
    ("&mdash;", "<span class='noname'>No name provided</span>",
     "d4f8b2e1-9c33-4a7e-b501-6f2a8c1d9e04",
     "Signed up 21 days ago &middot; Cognito &middot; email confirmed"),
  ])

_MEMBERS = "\n".join(
  f"""      <tr><td><span class="nm">{n}</span><span class="sub">{e}</span></td>
        <td>{role}</td><td>{prov}</td><td class="when">{cr}</td>
        <td><div class="rowact"><button class="btn sm">Change role</button>
          <button class="btn sm ghost danger" aria-label="Remove">{ico('trash')}</button>
        </div></td></tr>"""
  for n, e, role, prov, cr in [
    ("George Seib", "george.seib@gmail.com", chip("Admin","warn")+chip("you"),
     "Google", "&mdash;"),
    ("Ren Takahashi", "ren.takahashi@example.com", chip("Admin","warn"), "Cognito", "&mdash;"),
    ("Priya Balasubramanian", "priya.b@example.com", chip("Host","on"), "Cognito", "&mdash;"),
    ("Marcus Lindqvist", "m.lindqvist@example.com", chip("Host","on"), "Facebook", "&mdash;"),
    ("Nadia Cherkaoui", "nadia@example.com", chip("Host","on"), "Cognito", "&mdash;"),
    ("Sam Okonkwo", "sam.okonkwo@example.com", chip("Disabled","off"), "Cognito", "&mdash;"),
  ])

USERS_BODY = f"""    <div class="work-head">
      <div><h1>Users</h1>
        <p class="sub">24 accounts &middot; <b>3 waiting for a decision</b>. Cognito returns
          at most 60 in one page and there is no second page.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <div class="search" style="width:250px">{ico('search')}
          <input class="inp" placeholder="Search name, email, username"></div>
      </div>
    </div>

    <div class="work-body">
      <section class="panel queue">
        <header><h2>Waiting for approval</h2>
          <p class="note">Registration puts people here. Nothing else does.</p>
          <span class="grow"></span>
          <span class="dim" style="font-size:var(--t-label)">Oldest has waited
            <b class="stale">21 days</b></span></header>
        <div class="body flush">
          <ul class="pendlist">
{_PEND}
          </ul>
        </div>
      </section>

      <h4 class="secttl">Members &middot; 21</h4>
      <div class="filters">
        <div class="seg"><button aria-pressed="true">All 21</button><button>Admins 2</button>
          <button>Hosts 18</button><button>Disabled 1</button></div>
        <span class="count">21 members</span>
      </div>
      <table class="tbl">
        <thead><tr><th style="width:38%">Person</th><th style="width:16%">Role</th>
          <th style="width:14%">Signed in with</th><th style="width:14%">Joined</th>
          <th style="width:18%"></th></tr></thead>
        <tbody>
{_MEMBERS}
          <tr class="dimrow"><td class="dim">15 more</td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>

      <p class="note-box" style="margin-top:16px"><b>Joined shows &ldquo;&mdash;&rdquo; for
        everyone, and that is real.</b> The list endpoint returns the field as
        <span class="mono">created</span>; the table reads
        <span class="mono">createdAt</span>. Drawing a plausible date here would have hidden
        a one-word bug. So would leaving the column out.</p>
    </div>

{anno(64, 700, "A queue, not a filter tab", "Approval is the only thing in this console that decays if nobody looks at it, so it gets the top of the screen and a count in the nav that is visible from every other page. Today it is the second of four filter tabs, and its label is <code>Pending&nbsp;(3)</code>.", 300)}
{anno(230, 700, "One verb, named", "Today a pending person shows the same four buttons as everyone else &mdash; Pending / Host / Admin / Disabled &mdash; with the one they are already in disabled. Nothing says which is the approval. Here <b>Approve as host</b> is the primary and the rest are secondary.", 300)}
{anno(400, 700, "Show the wait", "&ldquo;21 days&rdquo; is the number that makes someone act. It is derivable from the account&rsquo;s creation date &mdash; which the list endpoint already returns, under a name nothing reads.", 300)}
"""

USERS_CSS = """
.queue{border-color:rgba(246,169,76,.4)}
.queue > header{background:rgba(246,169,76,.06)}
.stale{color:var(--primary)}
.pendlist{list-style:none;margin:0;padding:0}
.pend{display:flex;gap:12px;align-items:center;padding:11px 14px;
  border-bottom:1px solid var(--rule)}
.pend:last-child{border-bottom:0}
.pav{width:32px;height:32px;border-radius:50%;background:var(--surface-2);flex:none;
  display:grid;place-items:center;font-size:var(--t-label);font-weight:700}
.pinfo{flex:1 1 auto;min-width:0}
.pn{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  max-width:38ch}
.pe{display:block;font-size:var(--t-label);color:var(--muted);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:44ch}
.noname{color:var(--muted);font-style:italic;font-weight:400}
.pmeta{flex:0 1 250px;font-size:var(--t-label);color:var(--muted);min-width:0}
.unconf{color:var(--primary)}
.pacts{display:flex;gap:6px;flex:none}
.secttl{margin:20px 0 9px;font-size:var(--t-floor);letter-spacing:.09em;
  text-transform:uppercase;color:var(--muted);font-weight:700}
.filters .seg{margin-right:auto}
tr.dimrow td{color:var(--muted);font-style:italic;font-size:var(--t-label)}
.btn.ghost.danger{color:var(--danger-text);border-color:transparent}
"""

# ================================================== 17 users no pending ====
USERS_CLEAR_BODY = f"""    <div class="work-head">
      <div><h1>Users</h1><p class="sub">21 accounts &middot; nobody waiting.</p></div>
      <span class="grow"></span>
      <div class="head-actions"><div class="search" style="width:250px">{ico('search')}
        <input class="inp" placeholder="Search name, email, username"></div></div>
    </div>

    <div class="work-body">
      <section class="panel queue clear">
        <header><h2>Waiting for approval</h2><span class="grow"></span></header>
        <div class="body">
          <p class="clearline">{ico('check')}<span><b>Nobody is waiting.</b> The last person
            was approved 4 days ago. New registrations land here.</span></p>
        </div>
      </section>

      <h4 class="secttl">Members &middot; 21</h4>
      <div class="filters">
        <div class="seg"><button aria-pressed="true">All 21</button><button>Admins 2</button>
          <button>Hosts 18</button><button>Disabled 1</button></div>
        <span class="count">21 members</span>
      </div>
      <table class="tbl">
        <thead><tr><th style="width:38%">Person</th><th style="width:16%">Role</th>
          <th style="width:14%">Signed in with</th><th style="width:14%">Joined</th>
          <th style="width:18%"></th></tr></thead>
        <tbody>
{_MEMBERS}
          <tr class="dimrow"><td class="dim">15 more</td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    </div>

{anno(120, 700, "Keep the frame, empty it", "The queue panel stays on screen with nothing in it, rather than disappearing. A section that vanishes when it is empty teaches you to stop looking for it &mdash; which is exactly the failure mode an approval queue must not have.", 300)}
{anno(300, 700, "Not the same as no users", "There is no honest &ldquo;no users&rdquo; state on this screen: an admin is reading it, so at least one account exists. Drawing that empty state would have been drawing a screen nobody can ever see.", 300)}
"""

USERS_CLEAR_CSS = USERS_CSS + """
.queue.clear{border-color:var(--rule)}
.queue.clear > header{background:transparent}
.clearline{display:flex;gap:10px;align-items:flex-start;margin:0;font-size:var(--t-body);
  color:var(--muted)}
.clearline .ico{flex:none;margin-top:3px;color:var(--success-text);width:16px;height:16px}
.clearline b{color:var(--text)}
"""

# ========================================================== 18 prompts ====
_PROMPTS = "\n".join(
  f"""      <tr class="{cls}"><td><a class="nm" href="19-prompt-editor.html">{n}</a>
        <span class="sub">{d}</span></td>
        <td>{kind}</td><td>{chip(gt,'type')}</td><td class="dim lab">{cat}</td><td>{st}</td>
        <td><div class="rowact"><button class="btn sm">{ico('pencil')}Edit</button>
          <button class="btn sm ghost" aria-label="More">&#8943;</button></div></td></tr>"""
  for n, d, kind, gt, cat, st, cls in [
    ("Lessons Learned &mdash; Consultant voice",
     "Structured summary with discussion prompts and next steps.",
     chip("Summary","on"), "Call &amp; Answer", "lessons-learned",
     chip("Active","on")+chip("Default","warn"), ""),
    ("Trivia scoreboard recap", "Short recap keyed off the score distribution.",
     chip("Summary","on"), "Trivia", "general", chip("Active","on")+chip("Default","warn"), ""),
    ("General Knowledge Trivia generator",
     "Writes trivia questions. Cannot be used as a summary.",
     chip("Generator","type"), "Trivia", "general", chip("Active","on"), ""),
    ("Opinion Polls generator", "Writes poll questions and options.",
     chip("Generator","type"), "Poll", "opinion", chip("Active","on"), ""),
    ("Amazon Leadership Principles", "Maps answers onto the sixteen principles.",
     chip("Summary","on"), "Call &amp; Answer", "amazon-principles", chip("Draft","off"), ""),
    ("Interview Prep &mdash; Bar Raiser",
     "<span class='flagtxt'>No template and no instructions + output format &mdash; attaching this to a set silently falls back to the default.</span>",
     chip("Summary","on"), "Call &amp; Answer", "interview-prep",
     chip("Not usable","bad"), "broken"),
    ("(untitled record)",
     "<span class='flagtxt'>No promptId attribute. Cannot be attached to a set safely.</span>",
     chip("Unknown","off"), "Call &amp; Answer", "&mdash;", chip("Broken record","bad"), "broken"),
    ("Wavelength cloud commentary", "Reads the word cloud back to the room.",
     chip("Summary","on"), "Wavelength", "word-association", chip("Active","on"), ""),
    ("Team Dynamics Analysis", "Patterns across who answered what.",
     chip("Summary","on"), "Call &amp; Answer", "team-building", chip("Archived","off"), ""),
    ("Lessons Learned generator (imported)",
     "Imported from archive 2026-07-30. Body was not carried across.",
     chip("Generator","type"), "Call &amp; Answer", "&mdash;",
     chip("Status: inactive","bad"), "broken"),
  ])

PROMPTS_BODY = f"""    <div class="work-head">
      <div><h1>Prompts</h1>
        <p class="sub">47 prompts &middot; <b>6 cannot do the job they claim</b>. Two kinds
          live here: generators write questions, summaries read answers back.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">Restore defaults&hellip;</button>
        <button class="btn primary">{ico('plus')}New prompt</button></div>
    </div>

    <div class="work-body">
      <p class="note-box bad" style="max-width:none"><b>6 prompts are broken and one of them
        is attachable.</b> Four are missing the fields a summary needs, so a set pointed at
        one silently falls back to the default. One has no id. One was imported without its
        body. <a href="#" style="color:var(--danger-text);font-weight:700">Show only these
        6</a></p>

      <div class="filters">
        <div class="search">{ico('search')}<input class="inp"
          placeholder="Search name, description, category"></div>
        <div class="seg"><button aria-pressed="true">Both</button><button>Summary 31</button>
          <button>Generator 16</button></div>
        <select class="inp"><option>All engagement types</option><option>Call &amp; Answer</option>
          <option>Trivia</option><option>Poll</option><option>Wavelength</option>
          <option>Survey</option></select>
        <select class="inp"><option>All categories</option></select>
        <select class="inp"><option>All statuses</option><option>Active</option>
          <option>Draft</option><option>Archived</option></select>
        <span class="count">47 &middot; 10 shown</span>
      </div>

      <table class="tbl">
        <thead><tr><th style="width:31%">Prompt</th><th style="width:11%">Kind</th>
          <th style="width:13%">For</th><th style="width:15%">Category</th>
          <th style="width:21%">State</th><th style="width:9%"></th></tr></thead>
        <tbody>
{_PROMPTS}
        </tbody>
      </table>
    </div>

{anno(64, 700, "Three lists became one", "Generation prompts and summary prompts are the same record with a different shape, and today they have <b>two separate management UIs with different filters, different status badge classes and different game-type lists</b> &mdash; one of which is missing Survey. The archive&rsquo;s export tab renders a third variant of the same card.", 300)}
{anno(260, 700, "Surface the defects the API already reports", "<code>get-ai-prompts.js</code> computes <code>summaryPromptStatus</code>, <code>summaryPromptDefect</code> and <code>malformed</code> on every read. Today those become small badges on a card in a grid you have to scroll. Six broken records out of forty-seven deserves the top of the page.", 300)}
{anno(470, 700, "One vocabulary", "Statuses in the product today: active / draft / archived, plus <code>inactive</code> written only by the archive importer &mdash; a fourth value no filter in the UI matches, so those prompts are invisible unless the status filter is on &ldquo;All&rdquo;.", 300)}
"""

PROMPTS_CSS = """
.flagtxt{color:var(--danger-text)}
tr.broken td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
.filters .seg{flex:none}
"""

# ==================================================== 19 prompt editor ====
_VARGRP = lambda title, vars_: (
  f'<div class="vgrp"><h5>{title}</h5><div class="vbtns">' +
  "".join(f'<button class="vb{" na" if na else ""}"{" disabled" if na else ""}'
          f' title="{tip}">{{{v}}}</button>' for v, na, tip in vars_) +
  "</div></div>")

PROMPT_EDITOR_BODY = f"""    <div class="work-head">
      <div><h1>Wavelength cloud commentary</h1>
        <p class="sub">Summary prompt &middot; Wavelength &middot; word-association
          &middot; v4 &middot; updated 2026-08-02</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('sparkle')}Ask AI to improve it</button>
        <button class="btn primary">Save as v5</button></div>
    </div>

    <div class="work-body">
      <p class="note-box warn" style="max-width:none"><b>Saving writes version 5 and keeps
        version 4.</b> Today a non-default prompt is overwritten in place &mdash; the S3 object
        for the current version is replaced and there is no way back. The versioning code
        exists; the editor just never asks for it.</p>

      <div class="peditor">
        <div class="pmain">
          <section class="panel">
            <header><h2>1. Instructions</h2>
              <p class="note">Who the model is and how it should sound.</p></header>
            <div class="body">
              <textarea class="inp" rows="7">You are a facilitator reading a word cloud back to the room that produced it. You have the raw terms and their frequencies and nothing else — no names, no scores. Say what the room converged on, name the one outlier worth discussing, and stop. Never speculate about who wrote what.</textarea>
            </div>
          </section>

          <section class="panel">
            <header><h2>2. Output format</h2>
              <p class="note">Markdown. Variables are substituted before the model sees it.</p>
              <span class="grow"></span>
              <span class="dim" style="font-size:var(--t-floor)">1,204 characters</span></header>
            <div class="body">
              <textarea class="inp mono" rows="14">## What the room said about {{wavelengthTopic}}

{{commonWordsCount}} of {{playerCount}} people used the same word.

**Converged on:** {{commonWords}}

**Everything offered:** {{wavelengthWords}}

### One thing worth asking about

Pick the single term that fits least and ask the room who put it there and why.
Do not guess.

### Where this leaves you

Two sentences, no bullet list.</textarea>
            </div>
          </section>
        </div>

        <aside class="pside">
          <div class="panel">
            <header><h2>Variables</h2>
              <p class="note">Click to insert. 43 exist; 12 work for Wavelength.</p></header>
            <div class="body vbody">
{_VARGRP("Wavelength", [("wavelengthTopic",0,"The subject the room responded to"),("wavelengthWords",0,"Every term offered"),("commonWords",0,"Terms more than one person gave"),("commonWordsCount",0,"How many people converged"),("connectionScore",0,"0-100 convergence measure"),("teamScore",0,"Aggregate score for the round")])}
{_VARGRP("Set", [("setName",0,"Question set title"),("customInstruction",0,"The set's player-facing instruction"),("aiContext",0,"Background you wrote for Workie")])}
{_VARGRP("Session", [("playerCount",0,"People in the room"),("roundNumber",0,"Which round"),("eventTitle",0,"Session title")])}
{_VARGRP("Answers", [("answers",1,"Not available for Wavelength — there is no free-text answer list"),("answerCount",1,"Not available for Wavelength"),("topAnswers",1,"Not available for Wavelength")])}
{_VARGRP("Votes", [("voteTally",1,"Not available for Wavelength — Wavelength has no vote phase"),("winningAnswer",1,"Not available for Wavelength")])}
              <p class="vnote">Greyed variables exist but produce nothing for this
                engagement type. Inserting one leaves a literal
                <span class="mono">{{answers}}</span> in the output.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>

{anno(190, 690, "Six variables that were unreachable", "The variable palette groups its 43 entries under a fixed list of headers, and <b>Wavelength is not one of them</b> &mdash; so every wavelength variable in the catalogue is undisplayable, on the one engagement type whose summary needs them most. The group ordering was a literal array; this is the fix.", 300)}
{anno(430, 690, "Unavailable, not hidden", "Hiding the variables that do not apply would make the palette shorter and the model wrong. Showing them greyed, with the reason in the tooltip, is what stops someone pasting <span class='mono'>{voteTally}</span> into a Wavelength prompt that has no votes.", 300)}
{anno(96, 690, "Versioning already exists", "<code>update-ai-prompt.js</code> bumps the version and writes a new S3 object when the caller asks. The prompt manager never asks. Every edit to a non-default prompt therefore destroys the previous one.", 300)}
"""

PROMPT_EDITOR_CSS = """
.peditor{display:grid;grid-template-columns:minmax(0,1fr) 322px;gap:14px;align-items:start}
@media (max-width:1240px){.peditor{grid-template-columns:1fr}}
.pside .panel{position:sticky;top:0}
.vbody{max-height:none}
.vgrp{margin-bottom:13px}
.vgrp h5{margin:0 0 6px;font-size:var(--t-floor);letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted);font-weight:700}
.vbtns{display:flex;flex-wrap:wrap;gap:5px}
.vb{font:600 var(--t-floor)/1 var(--font-mono);background:var(--bg);color:var(--text);
  border:1px solid var(--rule-strong);border-radius:5px;padding:0 7px;cursor:pointer;
  min-height:24px;display:inline-flex;align-items:center}
.vb:hover{border-color:var(--primary);color:var(--primary)}
.vb.na{color:var(--muted);opacity:.5;border-style:dashed;cursor:not-allowed}
.vnote{margin:12px 0 0;font-size:var(--t-floor);color:var(--muted);line-height:1.5}
textarea.inp{line-height:1.55}
"""

# ========================================================== 20 archive ====
_ARCH = "\n".join(
  f"""      <tr><td><label class="cbx"><input type="checkbox" {ck}></label></td>
        <td><span class="nm">{n}</span><span class="sub">{d}</span></td>
        <td>{env}</td><td>{chip(gt,'type')}</td><td class="num dim">{sz}</td>
        <td class="when">{when}</td>
        <td><div class="rowact"><button class="btn sm">{ico('download')}</button>
          <button class="btn sm ghost danger">{ico('trash')}</button></div></td></tr>"""
  for ck, n, d, env, gt, sz, when in [
    ("checked", "Q3 Leadership Offsite &mdash; Lessons Learned",
     "42 questions &middot; 24 categories", chip("prod","warn"), "Call &amp; Answer",
     "38 KB", "7 Aug 15:10"),
    ("checked", "Nakamura Integration &mdash; Trivia",
     "160 questions &middot; <span class='losstxt'>tags and images have no column in the archive CSV</span>",
     chip("prod","warn"), "Trivia", "212 KB", "6 Aug 10:02"),
    ("", "Art Titles: Modernism 1905&ndash;1945",
     "36 questions &middot; <span class='losstxt'>36 image references; the files do not travel</span>",
     chip("test","type"), "Call &amp; Answer", "29 KB", "2 Aug 12:44"),
    ("", "Lessons Learned &mdash; Consultant voice", "Summary prompt",
     chip("dev","type"), "Call &amp; Answer", "6 KB", "30 Jul 08:00"),
    ("", "Q2 Retro", "31 questions &middot; 8 categories", chip("unknown","bad"),
     "Call &amp; Answer", "24 KB", "14 Jul 17:31"),
    ("", "Onboarding survey template", "Hand-uploaded. Category is a topic, not a type.",
     chip("&mdash;","off"), "&mdash;", "11 KB", "28 Jun 09:15"),
  ])

ARCHIVE_BODY = f"""    <div class="work-head">
      <div><h1>Archive</h1>
        <p class="sub">One shared store, all environments. 214 items &middot;
          <span class="mono">archive.seibtribe.us</span></p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('upload')}Export from dev&hellip;</button>
        <button class="btn primary" >{ico('download')}Import 2 selected</button></div>
    </div>

    <div class="work-body">
      <p class="note-box warn" style="max-width:none"><b>Importing is not a copy.</b>
        The archive stores a CSV with a fixed column set, so tags, School, Question numbers,
        the attached summary prompt and the AI context do not survive a round trip, and image
        files never travel &mdash; only their filenames, which point at a folder named after a
        set id that the import has just replaced.
        <a href="#" style="color:var(--primary)">What exactly is lost</a></p>

      <div class="filters">
        <div class="search">{ico('search')}<input class="inp"
          placeholder="Search title, description, tags"></div>
        <select class="inp"><option>All environments</option><option>dev</option>
          <option>test</option><option>prod</option><option>unknown</option></select>
        <select class="inp"><option>Question sets &amp; prompts</option>
          <option>Question sets</option><option>Prompts</option></select>
        <select class="inp"><option>All engagement types</option></select>
        <span class="count">214 items &middot; 6 shown &middot; 2 selected</span>
      </div>

      <table class="tbl">
        <thead><tr><th style="width:36px"><label class="cbx"><input type="checkbox"></label></th>
          <th style="width:32%">Item</th><th style="width:10%">From</th>
          <th style="width:14%">Type</th><th class="num" style="width:8%">Size</th>
          <th style="width:14%">Exported</th><th style="width:9%"></th></tr></thead>
        <tbody>
{_ARCH}
        </tbody>
      </table>

      <section class="panel" style="margin-top:16px">
        <header><h2>Importing 2 items into dev</h2></header>
        <div class="body">
          <div class="field" style="max-width:44ch"><label>If a set of the same name exists</label>
            <select class="inp"><option>Import as a copy, renamed with today&rsquo;s date</option>
              <option>Write it as a new version of the existing set</option>
              <option>Stop and tell me</option></select>
            <p class="help">Only the first is implemented today; the other two are the two
              behaviours people actually ask for.</p></div>
        </div>
      </section>
    </div>

{anno(64, 700, "Environment is the first question", "The archive is one shared bucket behind one public URL, and every item is tagged with the environment it came from. That tag is the most important column here and today it appears only buried in a general-purpose tag dropdown, alongside <span class='mono'>ai-generated</span> and <span class='mono'>questions:24</span>.", 300)}
{anno(240, 700, "One grid, not three", "Browse, Import and Export render three near-identical card grids, and the per-card &ldquo;Import&rdquo; button on the Browse tab is dead code &mdash; the panel is mounted without the callback it needs. Selection is a checkbox <b>and</b> a full-width Select button, both toggling the same set.", 300)}
{anno(430, 700, "Name the loss where it happens", "This is a promotion tool: dev to test to prod. Silently dropping an attached prompt on the way to prod is exactly the failure you find out about live. Two rows here carry the loss inline rather than in a footnote.", 300)}
{anno(600, 700, "Security note, not a design choice", "Every archive route is unauthenticated. The Delete button on this screen is an unauthenticated <code>DELETE</code> issued from a browser against a public URL. No amount of confirmation UI fixes that; it is listed in the open questions.", 300)}
"""

ARCHIVE_CSS = """
.losstxt{color:var(--primary)}
.btn.ghost.danger{color:var(--danger-text);border-color:transparent}
"""

# ============================================== 21 archive unreachable ====
ARCHIVE_DOWN_BODY = f"""    <div class="work-head">
      <div><h1>Archive</h1><p class="sub">Cannot reach the archive service.</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{ico('revert')}Try again</button></div>
    </div>
    <div class="work-body">
      <div class="empty">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.4" style="color:var(--danger-text)"><use href="#i-warn"/></svg>
        <h3>The archive did not answer</h3>
        <p><span class="mono">archive.seibtribe.us</span> returned nothing after 10 seconds.
           It is a <b>separate stack</b> from this environment, so this says nothing about
           your sets, prompts or sessions &mdash; only that promotion between environments
           is unavailable right now.</p>
        <div class="acts">
          <button class="btn primary lg">{ico('revert')}Try again</button>
          <button class="btn lg">{ico('download')}Export a set to a file instead</button>
        </div>
        <p class="failnote mono">GET https://archive.seibtribe.us/archive/items &mdash; no response</p>
      </div>
    </div>

{anno(160, 690, "Say whose fault it is", "Today a failed archive load sets the item list to <code>[]</code>, which renders as &ldquo;No archive items found&rdquo; &mdash; an outage indistinguishable from an empty archive. On a promotion tool that is the difference between &ldquo;wait&rdquo; and &ldquo;nothing was ever exported&rdquo;.", 300)}
{anno(320, 690, "Offer the local road", "Downloading a set&rsquo;s CSV and uploading it in the other environment does the same job by hand, and it is available while the archive is down.", 300)}
"""

ARCHIVE_DOWN_CSS = """
.failnote{margin-top:22px;font-size:var(--t-floor);color:var(--muted);
  border:1px solid var(--rule);border-radius:6px;padding:8px 11px;display:inline-block}
"""

# ========================================================= 22 settings ====
SETTINGS_BODY = f"""    <div class="work-head">
      <div><h1>Settings</h1>
        <p class="sub">Nothing here changes a session that is already running.</p></div>
    </div>

    <div class="work-body">
      <section class="panel">
        <header><h2>This environment</h2>
          <p class="note">Read-only. Where you are and what you are pointed at.</p></header>
        <div class="body flush">
          <dl class="kv">
            <div><dt>Environment</dt><dd><span class="chip warn">dev</span></dd></div>
            <div><dt>API</dt><dd class="mono">https://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev</dd></div>
            <div><dt>Front end</dt><dd class="mono">https://eng.dev.seibtribe.us</dd></div>
            <div><dt>Archive</dt><dd class="mono">https://archive.seibtribe.us
              <span class="chip bad" style="margin-left:6px">shared with test and prod</span></dd></div>
            <div><dt>Signed in as</dt><dd>george.seib@gmail.com &middot;
              <span class="chip warn">Admin</span></dd></div>
          </dl>
        </div>
      </section>

      <section class="panel">
        <header><h2>Real-time updates</h2></header>
        <div class="body">
          <label class="toggle"><input type="checkbox" checked>
            <span><b>Use WebSockets</b><br><span class="dim">Off falls back to HTTP polling,
              for networks that block WebSocket upgrades. Slower, and the host screen stops
              reacting to a player joining until the next poll.</span></span></label>
        </div>
      </section>

      <section class="panel">
        <header><h2>Diagnostics</h2>
          <p class="note">These change what a <b>host</b> sees during a live session.</p></header>
        <div class="body">
          <p class="note-box warn"><b>The host screen is a shared surface.</b> Both of these
            print AI prompt text and variable values onto a screen that may be projected in
            front of a room. They are for reproducing a problem, not for running a session.</p>
          <label class="toggle"><input type="checkbox">
            <span><b>Show the AI prompt above every summary</b><br>
              <span class="dim">On the results screen and in the AI dialog.</span></span></label>
          <label class="toggle"><input type="checkbox">
            <span><b>Show prompt variables and their values</b><br>
              <span class="dim">A side panel on the host results screen listing every
              variable and what it resolved to.</span></span></label>
          <p class="help" style="margin-top:12px">Both are stored in this browser only, and
            stay on until you turn them off.</p>
        </div>
      </section>

      <section class="panel">
        <header><h2>Account</h2></header>
        <div class="body">
          <button class="btn">Sign out</button>
        </div>
      </section>
    </div>

{anno(96, 700, "Answer the question the console never answers", "Three tiers exist, the archive is shared across all of them, and until now no admin screen said which one you were looking at. The environment block is read-only on purpose &mdash; it is orientation, not configuration.", 300)}
{anno(330, 700, "Say who is affected", "Both debug toggles are described today in terms of what they enable. What matters is who sees the result: they put prompt text on the <b>host&rsquo;s</b> screen, which may be a projector. That is a warning, not a feature description.", 300)}
{anno(470, 700, "Scope, stated", "&ldquo;Stored in this browser only&rdquo; is the difference between a setting and a preference. All three of these are <code>localStorage</code> flags; none of them are account-wide, and nobody could tell from the current copy.", 300)}
"""

SETTINGS_CSS = """
.kv{margin:0;padding:0}
.kv > div{display:flex;gap:16px;padding:10px 14px;border-bottom:1px solid var(--rule);
  align-items:baseline}
.kv > div:last-child{border-bottom:0}
.kv dt{flex:0 0 150px;color:var(--muted);font-size:var(--t-label);font-weight:600;margin:0}
.kv dd{margin:0;flex:1 1 auto;min-width:0;word-break:break-all}
.toggle{display:flex;gap:10px;align-items:flex-start;padding:9px 0;font-size:var(--t-body);
  line-height:1.5;max-width:92ch;cursor:pointer}
.toggle input{margin-top:4px;accent-color:var(--primary);width:15px;height:15px;flex:none}
.toggle b{font-weight:700}
.panel .body > .toggle:first-of-type{padding-top:0}
"""
