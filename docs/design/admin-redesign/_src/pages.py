# -*- coding: utf-8 -*-
"""
Page bodies for the admin-console mockups.

CONTENT RULE, and it is the reason this file is as ugly as it is:
every string here is a WORST case, not a representative one. The longest set
title the product has actually produced, the 24-category ceiling the bitmask
imposes, a set whose import skipped rows, a user whose Created column is N/A
because the lambda returns `created` and the table reads `createdAt`, a session
dated 1969 because an epoch of 0 got formatted. Copy chosen to fit is how the
previous host revision shipped sixteen green pages over nine defects.
"""

NAV_COUNTS = {"sets": 41, "sessions": 18, "prompts": 47, "users": 24, "pending": 3}

# ---------------------------------------------------------------- content --
LONG_SET = ("Q3 Leadership Offsite — Lessons Learned from the Nakamura "
            "Integration (Revised, Post-Legal Review)")
LONG_DESC = ("Retrospective prompts covering the eighteen months from LOI to close, "
             "written for the extended leadership team and their direct reports, with "
             "the legal-review redactions applied in October.")
LONG_INSTR = ("Answer from your own experience on this programme, not from the "
              "playbook. Name one decision you would take differently and one you "
              "would take again, and say what evidence you had at the time. Keep it "
              "to something you would be comfortable having read aloud.")

# ------------------------------------------------------------------ atoms --
def ico(name, cls="ico"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-{name}"/></svg>'

def anno(top, left, kind, text, width=None):
    w = f";max-width:{width}px" if width else ""
    return (f'<aside class="anno" style="top:{top}px;left:{left}px{w}">'
            f'<b>{kind}</b>{text}</aside>')

def chip(text, cls=""):
    return f'<span class="chip {cls}">{text}</span>'


# =========================================================== 01 sets list ==
def _set_row(name, sub, gtype, qs, flags, updated, extra_cls="", nm_title=""):
    t = f' title="{nm_title}"' if nm_title else ""
    return f"""      <tr class="{extra_cls}">
        <td><a class="nm" href="04-set-detail.html"{t}>{name}</a>
            <span class="sub">{sub}</span></td>
        <td>{chip(gtype,'type')}</td>
        <td class="num">{qs}</td>
        <td class="flags">{flags}</td>
        <td class="when">{updated}</td>
        <td><div class="rowact">
          <button class="btn sm">{ico('pencil')}Edit</button>
          <button class="btn sm ghost" aria-label="More actions">&#8943;</button>
        </div></td>
      </tr>"""

SETS_ROWS = "\n".join([
  _set_row(LONG_SET, LONG_DESC, "Call &amp; Answer", 42,
           chip("Active","on")+chip("v7")+chip("&#9889; Quickstart","warn"),
           "7 Aug 2026", nm_title=LONG_SET),
  _set_row("Nakamura Integration — Trivia", "Fact recall on the integration timeline.",
           "Trivia", 160,
           chip("Active","on")+chip("24 cats")+chip("v3"), "6 Aug 2026"),
  _set_row("Art Titles: Modernism 1905–1945",
           "Players title the work, then the room votes. Artwork ships in the Image column.",
           "Call &amp; Answer", 36,
           chip("Active","on")+'<span class="chip">'+ico('image','ico16')+' 36 images</span>',
           "5 Aug 2026"),
  _set_row("北米統合レトロスペクティブ",
           "setId set7f2a91 — the title has no ASCII, so the id is hash-derived.",
           "Call &amp; Answer", 18, chip("Inactive","off"), "5 Aug 2026"),
  _set_row("Onboarding Pulse — Week 1",
           "Generated 2026-08-04. Inactive until reviewed.", "Poll", 24,
           chip("Needs review","warn")+chip("AI","warn"), "4 Aug 2026",
           extra_cls="needsreview"),
  _set_row("Q2 Retro (Imported 2026-07-30)",
           "Imported from archive. AI context and attached prompt were not carried across.",
           "Call &amp; Answer", 31, chip("Active","on")+chip("Imported"), "30 Jul 2026"),
  _set_row("Hiring Loop — Bar Raiser Prep", "Interview calibration scenarios.",
           "Call &amp; Answer", 28, chip("Active","on"), "28 Jul 2026"),
  _set_row("Wavelength: Platform Vocabulary",
           "Single-word association on shared platform terms.", "Wavelength", 12,
           chip("Active","on"), "27 Jul 2026"),
  _set_row("Security Awareness 2026", "&mdash;", "Trivia", 0,
           chip("Empty","bad")+chip("Inactive","off"), "26 Jul 2026",
           extra_cls="broken"),
  _set_row("Sales Kickoff Icebreakers", "Light openers for a 200-person room.",
           "Poll", 15, chip("Active","on")+chip("&#9889; Quickstart","warn"), "25 Jul 2026"),
  _set_row("Legacy: Lessons Learned (2024)",
           "No engagement type stored. Displayed as Call &amp; Answer by normalisation.",
           "Call &amp; Answer", 47, chip("Inactive","off")+chip("Legacy"), "2 Nov 2024"),
  _set_row("Customer Advisory Board — Themes", "Open discussion prompts.",
           "Call &amp; Answer", 22, chip("Active","on"), "22 Jul 2026"),
  _set_row("Engineering Values Check", "Where do we actually stand?", "Survey", 33,
           chip("Not playable","bad")+chip("Inactive","off"), "21 Jul 2026",
           extra_cls="broken"),
  _set_row("General Knowledge — Mixed", "Filler round.", "Trivia", 60,
           chip("Active","on"), "19 Jul 2026"),
])

_FILLER = [
  ("Design Systems &mdash; Retro", "What broke when we merged the two token sets.", "Call &amp; Answer", 19),
  ("Incident Review: 2026-06-14", "Blameless retro prompts.", "Call &amp; Answer", 11),
  ("Product Trivia &mdash; Release History", "Which release shipped what.", "Trivia", 45),
  ("Team Health Pulse", "Five-question temperature check.", "Poll", 5),
  ("Wavelength: Customer Words", "How customers describe us in one word.", "Wavelength", 8),
  ("Onboarding Quiz &mdash; Security", "Mandatory module.", "Trivia", 30),
  ("Roadmap Prioritisation", "Force-ranked trade-offs.", "Poll", 14),
  ("Support Escalation Scenarios", "What would you do next.", "Call &amp; Answer", 26),
  ("Trivia: Company History", "Founding to Series C.", "Trivia", 52),
  ("Retro: Platform Migration", "Six months of it.", "Call &amp; Answer", 34),
  ("Icebreakers &mdash; Remote Teams", "Openers that survive a video call.", "Poll", 12),
  ("Wavelength: Engineering Values", "One word each.", "Wavelength", 6),
]
SETS_ROWS += "\n" + "\n".join(
  _set_row(n, d, t, q, chip("Active","on"), "%d Jul 2026" % (18 - i))
  for i, (n, d, t, q) in enumerate(_FILLER))

SETS_LIST_BODY = f"""    <div class="work-head">
      <div>
        <h1>Question sets</h1>
        <p class="sub">41 sets &middot; the thing every session is built from.</p>
      </div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('download')}Templates</button>
        <button class="btn primary">{ico('plus')}New set</button>
      </div>
    </div>

    <div class="work-body">
      <div class="filters">
        <div class="search">{ico('search')}
          <input class="inp" placeholder="Search name, description, instructions" value="">
        </div>
        <select class="inp"><option>All types</option><option>Call &amp; Answer</option>
          <option>Trivia</option><option>Poll</option><option>Wavelength</option>
          <option>Survey</option></select>
        <select class="inp"><option>All statuses</option><option>Active</option>
          <option>Inactive</option><option>Needs review</option></select>
        <select class="inp"><option>Recently updated</option><option>Name A&ndash;Z</option>
          <option>Most questions</option><option>Oldest</option></select>
        <span class="count">41 sets &middot; 26 shown</span>
      </div>

      <table class="tbl">
        <thead><tr>
          <th style="width:44%">Set</th><th style="width:12%">Type</th>
          <th class="num" style="width:6%">Qs</th>
          <th style="width:23%">State</th>
          <th style="width:13%">Updated</th><th style="width:9%"></th>
        </tr></thead>
        <tbody>
{SETS_ROWS}
        </tbody>
      </table>
    </div>

{anno(96, 236, "Worst case", "The longest title the product has produced (98 chars). It ellipsises against a <b>single text node</b> with <code>min-width:0</code> &mdash; the host spec&rsquo;s &sect;5.1 trap was putting <code>text-overflow</code> on a flex container, where it is inert.", 300)}
{anno(300, 700, "Redundancy cut", "Today each row prints five paragraphs: description, custom instructions, AI context, prompt + round label + voice, and dates. Forty-one of those is a wall. Those fields belong in the set, not in the index of sets.", 280)}
{anno(452, 316, "State, once", "Active/inactive, quickstart, AI-review, version and image count share one column and one vocabulary. Today they are a clickable status button, a checkbox with a lightning bolt, and a badge, in two stacked rows.", 270)}
{anno(560, 700, "Real defects, visible", "A set that imported zero rows and a survey set that <b>cannot be played at all</b> (<code>upload-questions.js</code> rejects survey) both read as ordinary rows today. Here they carry a state.", 280)}
"""

SETS_LIST_CSS = """
.tbl .flags{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbl .flags .chip{margin-right:4px}
.ico16{width:12px;height:12px;vertical-align:-1px}
tr.needsreview td:first-child{box-shadow:inset 3px 0 0 var(--primary)}
tr.broken td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
"""

# ========================================================== 02 sets empty ==
SETS_EMPTY_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1>
        <p class="sub">Nothing here yet.</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn primary">{ico('plus')}New set</button></div>
    </div>
    <div class="work-body">
      <div class="empty">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.4"><use href="#i-books"/></svg>
        <h3>No question sets yet</h3>
        <p>A question set is what a session plays. Every other screen in here
           &mdash; sessions, archive, reports &mdash; is downstream of one.
           There are three ways to make the first one, and they are not equivalent.</p>
        <div class="acts">
          <button class="btn primary lg">{ico('sparkle')}Generate with AI</button>
          <button class="btn lg">{ico('upload')}Upload a CSV</button>
          <button class="btn lg">{ico('package')}Import from archive</button>
        </div>
        <p style="margin-top:22px;font-size:var(--t-label)">
          Not sure which? <a href="07-new-set.html" style="color:var(--primary)">Compare
          the five ways in</a>.</p>
      </div>
    </div>

{anno(150, 690, "Never shrug", "An empty state on the object everything else depends on is the highest-leverage screen in the console, and today it is one grey sentence &mdash; <i>&ldquo;Upload your first question set above to get started&rdquo;</i> &mdash; pointing at a collapsed accordion that is <b>below</b> it.", 300)}
{anno(330, 690, "Ranked, not listed", "Three verbs, ordered by how most sets actually get made. The fourth and fifth ways (manual builder, download-a-template) are one click deeper because they are slower, not because they are worse.", 300)}
"""

# ======================================================= 03 sets no match ==
SETS_NOMATCH_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1>
        <p class="sub">41 sets &middot; none match what you are looking for.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('download')}Templates</button>
        <button class="btn primary">{ico('plus')}New set</button>
      </div>
    </div>
    <div class="work-body">
      <div class="filters">
        <div class="search">{ico('search')}
          <input class="inp" value="nakamura retrospective bar-raiser">
        </div>
        <select class="inp"><option>Wavelength</option></select>
        <select class="inp"><option>Inactive</option></select>
        <select class="inp"><option>Recently updated</option></select>
        <span class="count">0 of 41</span>
      </div>

      <div class="empty left" style="max-width:70ch">
        <h3>No sets match these three filters</h3>
        <p>Forty-one sets exist. Removing any one of these gets you results:</p>
        <div class="acts" style="margin-bottom:14px">
          <button class="btn">{ico('x')}Search &ldquo;nakamura retrospective bar-raiser&rdquo;
            <span class="dim">&mdash; 2 sets</span></button>
          <button class="btn">{ico('x')}Type: Wavelength <span class="dim">&mdash; 3 sets</span></button>
          <button class="btn">{ico('x')}Status: Inactive <span class="dim">&mdash; 12 sets</span></button>
        </div>
        <button class="btn ghost">Clear all filters</button>
      </div>
    </div>

{anno(230, 700, "Two empties, not one", "&ldquo;Nothing exists&rdquo; and &ldquo;nothing matches&rdquo; need different words and different exits. The current code gets this right for sets and wrong everywhere else: prompts, generation prompts and archive all print one message for both, so a filter you forgot you set reads as an empty database.", 300)}
{anno(400, 700, "Say which filter is doing it", "Counting the result of dropping each filter costs one pass over an array that is already in memory. It converts a dead end into three one-click exits.", 300)}
"""

# ========================================================= 04 set detail ==
_QROWS = "\n".join(
  f"""      <tr><td class="num dim">{n}</td>
        <td><span class="nm">{t}</span><span class="sub">{d}</span></td>
        <td>{chip(c)}</td><td class="dim" style="font-size:var(--t-label)">{tags}</td>
        <td>{img}</td></tr>"""
  for n, t, d, c, tags, img in [
    (1, "What did the first integration steering committee actually decide?",
     "Look at the minutes, not the deck.", "Governance", "governance, decisions", ""),
    (2, "Where did the two engineering orgs first disagree in public?",
     "Name the forum and the week.", "Engineering", "engineering", ""),
    (3, "Which customer commitment survived legal review unchanged?",
     "&mdash;", "Commercial", "&mdash;", ""),
    (4, "The retention offer we did not make",
     "Redacted per legal review, October. Detail intentionally blank.",
     "People", "people, redacted", ""),
    (5, "Untitled question",
     "Row 5 of the CSV had a Title but no Category and was skipped on import.",
     "&mdash;", "&mdash;", ""),
  ])

SET_DETAIL_BODY = f"""    <div class="work-head">
      <div style="min-width:0">
        <h1 style="max-width:58ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="{LONG_SET}">{LONG_SET}</h1>
        <p class="sub">Call &amp; Answer &middot; 24 categories &middot;
           <span class="mono">q3leadershipoffsitelessonslearned</span></p>
      </div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{chip('Active','on')}</button>
        <button class="btn">&#9889; Quickstart</button>
        <button class="btn ghost" aria-label="More">&#8943;</button>
      </div>
    </div>

    <nav class="subnav">
      <button aria-current="true">Details</button>
      <button>Questions <span class="dim">42</span></button>
      <button>Versions <span class="dim">7</span></button>
      <button>Media <span class="dim">0</span></button>
      <button class="dngr">Delete</button>
    </nav>

    <div class="work-body">
      <section class="panel">
        <header><h2>Details</h2>
          <p class="note">Everything that could be set when this set was created.</p></header>
        <div class="body">
          <div class="grid2">
            <div class="field"><label>Title</label>
              <input class="inp" value="{LONG_SET}"></div>
            <div class="field"><label>Engagement type</label>
              <select class="inp"><option>Call &amp; Answer</option><option>Trivia</option>
                <option>Poll</option><option>Wavelength</option><option>Survey</option></select>
              <p class="help">Controls which phases the session runs and which default AI
                 prompt applies. It does not rewrite the questions.</p></div>
          </div>
          <div class="field" style="margin-top:14px"><label>Description</label>
            <textarea class="inp" rows="2">{LONG_DESC}</textarea></div>
          <div class="grid2" style="margin-top:14px">
            <div class="field"><label>Round label</label>
              <input class="inp" placeholder="Round" value="Lesson">
              <p class="help">What one item is called on screen &mdash; &ldquo;Lesson 3&rdquo;.
                 Blank uses the default for the type.</p></div>
            <div class="field"><label>Workie&rsquo;s voice</label>
              <select class="inp"><option>Adapt to the session (recommended)</option>
                <option selected>Dry Analyst &mdash; understated, evidence-first</option></select>
              <p class="help">A host&rsquo;s pick at session creation wins over this.</p></div>
          </div>
          <div class="grid2" style="margin-top:14px">
            <div class="field"><label>Custom instructions &mdash; shown to players</label>
              <textarea class="inp" rows="4">{LONG_INSTR}</textarea></div>
            <div class="field"><label>AI context &mdash; background for Workie</label>
              <textarea class="inp" rows="4">Post-merger integration of a 400-person hardware business into a software-led org. The audience ran it. Assume they know the timeline; do not restate it.</textarea></div>
          </div>
          <div class="field" style="margin-top:14px;max-width:52%"><label>AI summary prompt</label>
            <select class="inp"><option>Default for Call &amp; Answer</option>
              <option selected>Lessons Learned &mdash; Consultant voice (lessons-learned)</option></select>
            <p class="help">Showing 7 of 47 prompts. The other 40 are for other engagement
               types or are generation prompts, which cannot drive a summary.</p></div>
        </div>
      </section>

      <section class="panel">
        <header><h2>Questions</h2>
          <p class="note">Read-only here. Authoring is a CSV round trip.</p>
          <span class="grow"></span>
          <button class="btn sm">{ico('download')}Download CSV</button>
          <button class="btn sm">{ico('upload')}Replace from CSV</button>
        </header>
        <div class="body flush">
          <table class="tbl inner">
            <thead><tr><th class="num" style="width:44px">#</th><th>Question</th>
              <th style="width:130px">Category</th><th style="width:180px">Tags</th>
              <th style="width:60px">Image</th></tr></thead>
            <tbody>
{_QROWS}
            </tbody>
          </table>
          <p class="morerow">Showing 5 of 42 &middot; <a href="#">show all</a></p>
        </div>
      </section>

      <section class="panel">
        <header><h2>Versions</h2>
          <p class="note">Every replace keeps what it replaced.</p></header>
        <div class="body flush">
          <table class="tbl inner">
            <thead><tr><th style="width:110px">Version</th><th>Source file</th>
              <th class="num" style="width:70px">Qs</th><th class="num" style="width:80px">Cats</th>
              <th style="width:150px">Written</th><th style="width:190px"></th></tr></thead>
            <tbody>
              <tr><td><strong>v7</strong> {chip('Active','on')}</td>
                  <td class="mono dim">q3-offsite-legal-rev.csv</td>
                  <td class="num">42</td><td class="num">24</td>
                  <td class="dim" style="font-size:var(--t-label)">2026-08-07 14:02</td>
                  <td><div class="rowact"><button class="btn sm" disabled>Promote</button>
                      <button class="btn sm danger" disabled title="The active version cannot be deleted &mdash; promote another first">Delete</button></div></td></tr>
              <tr><td><strong>v6</strong> {chip(ico('pin','ico16')+' 2 in play','warn')}</td>
                  <td class="mono dim">q3-offsite-v6.csv</td>
                  <td class="num">44</td><td class="num">24</td>
                  <td class="dim" style="font-size:var(--t-label)">2026-08-06 08:55</td>
                  <td><div class="rowact"><button class="btn sm">Promote</button>
                      <button class="btn sm danger">Delete</button></div></td></tr>
              <tr><td><strong>v5</strong></td><td class="mono dim">q3-offsite-v5.csv</td>
                  <td class="num">44</td><td class="num">23</td>
                  <td class="dim" style="font-size:var(--t-label)">2026-08-01 19:40</td>
                  <td><div class="rowact"><button class="btn sm">Promote</button>
                      <button class="btn sm danger">Delete</button></div></td></tr>
            </tbody>
          </table>
          <p class="morerow">v1&ndash;v4 &middot; <a href="#">show older</a></p>
        </div>
      </section>

      <section class="panel">
        <header><h2>Media</h2>
          <p class="note">Artwork referenced by the Image column.</p></header>
        <div class="body">
          <p class="note-box">This set&rsquo;s CSV declares no Image values, so there is nothing
            to show. <b>Upload is not wired up yet</b> &mdash; images reach a set only through
            the Image column of its CSV, and the file must already exist under
            <span class="mono">sets/&lt;setId&gt;/</span>.</p>
        </div>
      </section>

      <section class="panel dangerpanel">
        <header><h2>Delete this set</h2>
          <p class="note">Three past sessions used it.</p></header>
        <div class="body">
          <p class="note-box bad"><b>Two of those three have no saved report.</b> A report is
            built on demand from the live set, so deleting this set means those two sessions
            can never produce one. The third already has a stored report and is unaffected.</p>
          <button class="btn danger">{ico('trash')}Delete this set&hellip;</button>
        </div>
      </section>
    </div>

    <div class="savebar" role="status">
      <span class="dot"></span>
      <span>3 unsaved changes &mdash; <b>round label</b>, <b>Workie&rsquo;s voice</b>,
        <b>custom instructions</b></span>
      <span class="grow"></span>
      <button class="btn ghost">Discard</button>
      <button class="btn primary">Save changes</button>
    </div>

{anno(58, 660, "A place, not a section", "Editing a set is its own screen with its own breadcrumb. Today the editor appears <b>below</b> the list of forty-one sets, and the page scroll-jumps you to it and flashes it <code>#fff3cd</code> yellow for three seconds &mdash; a light-theme colour, on this palette, as the only cue to which row you are on.", 300)}
{anno(300, 660, "Name the diff", "The save button is pinned and states which fields are dirty. Today Save sits mid-form above two more panels, and the confirmation reports what the <i>backend</i> says it wrote &mdash; which is the right instinct, kept here and moved to where you can see it before you commit.", 300)}
{anno(560, 660, "The questions were unreachable", "<code>GET /question-sets/{setId}/questions</code> has existed all along and no admin screen calls it. Until now, checking one bad row meant downloading the CSV.", 300)}
{anno(760, 660, "Consequence, not danger", "Version delete already asks a real question &mdash; it names the games pinned to the version. Set delete, which is strictly more destructive, asks &ldquo;are you sure?&rdquo; and reports its result into a state variable that is <b>never rendered</b>.", 300)}
"""

SET_DETAIL_CSS = """
  font:600 var(--t-body)/1 var(--font-ui);padding:9px 12px 8px;cursor:pointer}
.subnav button:hover{color:var(--text)}
.subnav button[aria-current]{color:var(--text);border-bottom-color:var(--primary)}
.subnav button.dngr{margin-left:auto;color:var(--danger-text)}
.subnav .dim{font-size:var(--t-floor);margin-left:4px}
.tbl.inner th{background:var(--surface);padding-top:8px;padding-left:14px}
.tbl.inner th:last-child,.tbl.inner td:last-child{padding-right:14px}
.tbl.inner td{padding-left:14px}
.tbl.inner tbody tr:last-child td{border-bottom:0}
.morerow{margin:0;padding:9px 14px;border-top:1px solid var(--rule);
  font-size:var(--t-label);color:var(--muted)}
.morerow a{color:var(--primary)}
.dangerpanel{border-color:rgba(229,100,94,.34)}
.work-body{padding-bottom:78px}
.savebar{position:fixed;left:var(--nav-w);right:var(--rail-w,330px);bottom:0;height:52px;z-index:40;
  display:flex;align-items:center;gap:11px;padding:0 20px;background:var(--surface);
  border-top:1px solid var(--rule-strong);font-size:var(--t-label);
  box-shadow:0 -8px 24px rgba(0,0,0,.28)}
.savebar .dot{width:7px;height:7px;border-radius:50%;background:var(--primary);flex:none}
.savebar .grow{flex:1 1 auto}
body.no-anno .savebar{padding-right:178px}
.savebar b{color:var(--text)}
.ico16{width:12px;height:12px;vertical-align:-1px}
"""


# ============================================================== manifest ==
# Imported at the bottom so the helpers above are already defined when the
# part files do `from pages import ico, anno, chip`.
from pages_b import (REPLACE_BODY, REPLACE_CSS, IMPORT_ERR_BODY, IMPORT_ERR_CSS,
                     NEW_SET_BODY, NEW_SET_CSS, AI_CONFIG_BODY, AI_CONFIG_CSS)
from pages_c import (JOBCHIP_RUNNING, JOBCHIP_FAILED, JOB_RUNNING_BODY, JOB_CSS,
                     JOB_FAILED_BODY, JOB_FAILED_CSS, JOB_REVIEW_BODY, JOB_REVIEW_CSS,
                     SESSIONS_BODY, SESSIONS_CSS, SESSIONS_EMPTY_BODY,
                     CONFIRM_SET_BODY, CONFIRM_CSS, CONFIRM_ALL_BODY, CONFIRM_ALL_CSS)
from pages_d import (USERS_BODY, USERS_CSS, USERS_CLEAR_BODY, USERS_CLEAR_CSS,
                     PROMPTS_BODY, PROMPTS_CSS, PROMPT_EDITOR_BODY, PROMPT_EDITOR_CSS,
                     ARCHIVE_BODY, ARCHIVE_CSS, ARCHIVE_DOWN_BODY, ARCHIVE_DOWN_CSS,
                     SETTINGS_BODY, SETTINGS_CSS)

C_SETS = [("Question sets", True)]
C_SET = [("Question sets", False), (LONG_SET, True)]

PAGES = [
 dict(file="01-sets.html", title="Question sets", nav="sets", crumbs=C_SETS,
      body=SETS_LIST_BODY, css=SETS_LIST_CSS),
 dict(file="02-sets-empty.html", title="Question sets, first run", nav="sets",
      crumbs=C_SETS, counts=dict(sets=0, sessions=0, prompts=12, users=1, pending=0),
      body=SETS_EMPTY_BODY),
 dict(file="03-sets-no-match.html", title="Question sets, nothing matches", nav="sets",
      crumbs=C_SETS, body=SETS_NOMATCH_BODY),
 dict(file="04-set-detail.html", title="Editing a question set", nav="sets",
      crumbs=C_SET, body=SET_DETAIL_BODY, css=SET_DETAIL_CSS),
 dict(file="05-set-replace.html", title="Replacing a set's questions", nav="sets",
      crumbs=C_SET, body=REPLACE_BODY, css=REPLACE_CSS),
 dict(file="06-csv-errors.html", title="CSV import, validation report", nav="sets",
      crumbs=[("Question sets", False), ("Upload a CSV", True)],
      body=IMPORT_ERR_BODY, css=IMPORT_ERR_CSS),
 dict(file="07-new-set.html", title="New question set", nav="sets", crumbs=C_SETS,
      body=NEW_SET_BODY, css=NEW_SET_CSS),
 dict(file="08-ai-config.html", title="Generating with AI, setup", nav="sets",
      crumbs=C_SETS, body=AI_CONFIG_BODY, css=AI_CONFIG_CSS),
 dict(file="09-ai-job-running.html", title="Generation job running", nav="sets",
      crumbs=[("Question sets", False), ("Generating trivia", True)],
      jobchip=JOBCHIP_RUNNING, body=JOB_RUNNING_BODY, css=JOB_CSS),
 dict(file="10-ai-job-failed.html", title="Generation job failed", nav="sets",
      crumbs=[("Question sets", False), ("Generating trivia", True)],
      jobchip=JOBCHIP_FAILED, body=JOB_FAILED_BODY, css=JOB_FAILED_CSS),
 dict(file="11-ai-job-review.html", title="Reviewing generated questions", nav="sets",
      crumbs=[("Question sets", False), ("Review 84 questions", True)],
      body=JOB_REVIEW_BODY, css=JOB_REVIEW_CSS),
 dict(file="12-sessions.html", title="Sessions", nav="sessions",
      crumbs=[("Sessions", True)], body=SESSIONS_BODY, css=SESSIONS_CSS),
 dict(file="13-sessions-empty.html", title="Sessions, none yet", nav="sessions",
      crumbs=[("Sessions", True)], counts=dict(sessions=0), body=SESSIONS_EMPTY_BODY),
 dict(file="14-confirm-delete-set.html", title="Delete a question set", nav="sets",
      crumbs=C_SET, body=CONFIRM_SET_BODY, css=CONFIRM_CSS),
 dict(file="15-confirm-delete-all.html", title="Delete all sessions", nav="sessions",
      crumbs=[("Sessions", True)], body=CONFIRM_ALL_BODY, css=CONFIRM_ALL_CSS),
 dict(file="16-users.html", title="Users and the approval queue", nav="users",
      crumbs=[("Users", True)], body=USERS_BODY, css=USERS_CSS),
 dict(file="17-users-clear.html", title="Users, nobody waiting", nav="users",
      crumbs=[("Users", True)], counts=dict(users=21, pending=0),
      body=USERS_CLEAR_BODY, css=USERS_CLEAR_CSS),
 dict(file="18-prompts.html", title="Prompts", nav="prompts",
      crumbs=[("Prompts", True)], body=PROMPTS_BODY, css=PROMPTS_CSS),
 dict(file="19-prompt-editor.html", title="Editing a prompt", nav="prompts",
      crumbs=[("Prompts", False), ("Wavelength cloud commentary", True)],
      body=PROMPT_EDITOR_BODY, css=PROMPT_EDITOR_CSS),
 dict(file="20-archive.html", title="Archive", nav="archive",
      crumbs=[("Archive", True)], body=ARCHIVE_BODY, css=ARCHIVE_CSS),
 dict(file="21-archive-down.html", title="Archive unreachable", nav="archive",
      crumbs=[("Archive", True)], body=ARCHIVE_DOWN_BODY, css=ARCHIVE_DOWN_CSS),
 dict(file="22-settings.html", title="Settings", nav="settings",
      crumbs=[("Settings", True)], body=SETTINGS_BODY, css=SETTINGS_CSS),
]
