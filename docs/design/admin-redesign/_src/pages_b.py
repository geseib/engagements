# -*- coding: utf-8 -*-
"""Page bodies, part 2: creating a set, CSV import, and the AI generation job."""

from pages import ico, anno, chip, LONG_SET

# ==================================================== 05 replace preview ==
REPLACE_BODY = f"""    <div class="work-head">
      <div style="min-width:0">
        <h1 style="max-width:58ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="{LONG_SET}">{LONG_SET}</h1>
        <p class="sub">Replacing the questions writes version 8. Nothing is overwritten.</p>
      </div>
    </div>

    <nav class="subnav">
      <button>Details</button><button aria-current="true">Questions <span class="dim">42</span></button>
      <button>Versions <span class="dim">7</span></button><button>Media</button>
      <button class="dngr">Delete</button>
    </nav>

    <div class="work-body">
      <section class="panel">
        <header><h2>Before you replace</h2>
          <p class="note">Read from <span class="mono">q3-offsite-v8-draft.csv</span>
             in your browser. Nothing has been sent yet.</p></header>
        <div class="body">
          <div class="difftable">
            <div class="d"><span class="k">Questions</span>
              <span class="v">42 <span class="arrow">&rarr;</span> 39</span>
              <span class="delta down">3 fewer</span></div>
            <div class="d"><span class="k">Categories</span>
              <span class="v">24 <span class="arrow">&rarr;</span> 22</span>
              <span class="delta down">2 fewer</span></div>
            <div class="d"><span class="k">Images declared</span>
              <span class="v">0 <span class="arrow">&rarr;</span> 0</span>
              <span class="delta">unchanged</span></div>
            <div class="d"><span class="k">Version</span>
              <span class="v">v7 <span class="arrow">&rarr;</span> v8</span>
              <span class="delta new">new</span></div>
          </div>

          <p class="note-box warn"><b>Two categories disappear from this set:</b>
            <span class="mono">Commercial &mdash; Pricing</span> and
            <span class="mono">People &mdash; Retention</span>. Five questions across them
            are not in the new file. Categories are derived from the Category column, so a
            category with no rows ceases to exist.</p>

          <details class="catdiff" open>
            <summary>22 categories in the new file &mdash; 2 removed, 0 added</summary>
            <p class="mono dim">Governance &middot; Engineering &middot; Engineering &mdash;
              Platform &middot; Commercial &middot; <s>Commercial &mdash; Pricing</s> &middot;
              People &middot; <s>People &mdash; Retention</s> &middot; Legal &middot;
              Finance &middot; Customer &middot; Timeline &middot; Comms &middot;
              Culture &middot; Tooling &middot; Data &middot; Security &middot;
              Support &middot; Partners &middot; Brand &middot; Facilities &middot;
              Programme &middot; Risk &middot; Retrospective</p>
          </details>

          <p class="note-box">Version 7 stays in the list and can be promoted back in one
            click. <b>Sessions already in play stay on the version they started with</b> &mdash;
            two are currently pinned to v6.</p>

          <div class="acts">
            <button class="btn primary lg">{ico('upload')}Write version 8 and make it live</button>
            <button class="btn lg">Cancel</button>
          </div>
        </div>
      </section>
    </div>

{anno(210, 690, "The diff the code does not compute", "<code>describeReplacePlan()</code> today reports two count deltas and a paragraph. It never says <b>which</b> categories are leaving, and a vanished category is the change most likely to surprise &mdash; the host&rsquo;s per-category toggles are built from exactly this list.", 300)}
{anno(430, 690, "Right instinct, kept", "&ldquo;The old version is kept and can be promoted back&rdquo; is the single best piece of copy in the current admin. It corrects the mental model the owner arrives with. Unchanged.", 300)}
"""

REPLACE_CSS = """
.difftable{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule);border-radius:8px;overflow:hidden;
  margin-bottom:14px}
.difftable .d{background:var(--surface);padding:10px 13px;display:flex;flex-direction:column;gap:3px}
.difftable .k{font-size:var(--t-floor);letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted);font-weight:700}
.difftable .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.difftable .arrow{color:var(--muted);font-weight:400;margin:0 3px}
.difftable .delta{font-size:var(--t-label);color:var(--muted)}
.difftable .delta.down{color:var(--primary)}
.difftable .delta.new{color:var(--success-text)}
.catdiff{border:1px solid var(--rule);border-radius:8px;padding:10px 13px;margin:0 0 14px;
  font-size:var(--t-label)}
.catdiff summary{cursor:pointer;font-weight:600;color:var(--muted)}
.catdiff p{margin:8px 0 0;line-height:1.7}
.catdiff s{color:var(--danger-text);text-decoration-thickness:1px}
.acts{display:flex;gap:9px;margin-top:4px}
"""

# ====================================================== 06 import errors ==
_BADROWS = "\n".join(
  f"""      <tr class="{cls}"><td class="num dim">{n}</td><td>{what}</td>
        <td class="mono dim">{cell}</td><td>{verdict}</td></tr>"""
  for n, what, cell, cls, verdict in [
    (1, "Header row", "Category,Question#,Prompt,Detail_lesson,Options,AllowMultiple,Tags",
     "fatal", '<span class="chip bad">No Title column</span>'),
    (4, "Missing Category", '"",4,"Which onboarding step lost the most people?",…',
     "skip", '<span class="chip warn">Row skipped</span>'),
    (9, "Missing Category", '"",9,"Rank these by how often you actually use them",…',
     "skip", '<span class="chip warn">Row skipped</span>'),
    (17, "Only one field", '"Engagement"', "skip",
     '<span class="chip warn">Row skipped &mdash; too few columns</span>'),
    (23, "Unbalanced quote", '"Team health","23","How would you describe the "vibe" now?"',
     "skip", '<span class="chip warn">Row skipped &mdash; malformed</span>'),
    (31, "Poll options", 'Option1="Daily" Option2="Weekly" Option3="Monthly"',
     "warn", '<span class="chip warn">Options will be dropped</span>'),
  ])

IMPORT_ERR_BODY = f"""    <div class="work-head">
      <div><h1>Upload a CSV</h1>
        <p class="sub"><span class="mono">onboarding-pulse-q3.csv</span> &middot; 60&nbsp;KB
           &middot; 61 rows &middot; read in your browser, not yet sent</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn ghost">Choose a different file</button></div>
    </div>

    <div class="work-body">
      <p class="note-box bad" style="max-width:none">
        <b>This file cannot be imported as it stands.</b> One problem stops the whole file;
        four more would cost you rows silently. Nothing has been sent to the server.</p>

      <section class="panel">
        <header><h2>1. Stops the import</h2></header>
        <div class="body">
          <p><b>There is no Title column.</b> A question needs a Title and a Category;
             everything else is optional.</p>
          <p class="dim" style="font-size:var(--t-label)">Headers found:
            <span class="mono">Category</span>, <span class="mono">Question#</span>,
            <span class="mono badhdr">Prompt</span>, <span class="mono">Detail_lesson</span>,
            <span class="mono">Options</span>, <span class="mono">AllowMultiple</span>,
            <span class="mono">Tags</span></p>
          <p class="note-box warn" style="margin-top:12px">Your <span class="mono">Prompt</span>
            column looks like the titles. The importer matches
            <span class="mono">Title</span> exactly, then falls back to any header
            <i>containing</i> &ldquo;title&rdquo;. <span class="mono">Prompt</span> matches
            neither.
            <button class="btn sm" style="margin-left:8px">Treat
              <span class="mono">Prompt</span> as Title</button></p>
        </div>
      </section>

      <section class="panel">
        <header><h2>2. Would be skipped without telling you</h2>
          <p class="note">4 of 60 data rows</p></header>
        <div class="body flush">
          <table class="tbl inner">
            <thead><tr><th class="num" style="width:56px">Row</th>
              <th style="width:180px">Problem</th><th>In the file</th>
              <th style="width:250px">Result</th></tr></thead>
            <tbody>
{_BADROWS}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <header><h2>3. Known importer gaps this file will hit</h2></header>
        <div class="body">
          <p class="note-box bad"><b>Poll options are in the wrong shape.</b> This file has
            <span class="mono">Option1&hellip;Option5</span> columns. The importer reads a
            single <span class="mono">Options</span> column with values separated by
            <span class="mono">|</span>, and ignores the numbered ones. All 31 poll questions
            would import <b>with no options at all</b>. This is the same mismatch the AI poll
            builder produces.
            <button class="btn sm" style="margin-left:8px">Merge into
              <span class="mono">Options</span></button></p>
          <p class="note-box warn"><b>3 Image values point at files that are not there.</b>
            <span class="mono">nakamura-org-chart.png</span>,
            <span class="mono">retention-curve.png</span>,
            <span class="mono">/assets/legal-redaction.png</span> &mdash; the third is a
            repo-relative path and will resolve; the first two would be stored as
            <span class="mono">sets/&lt;setId&gt;/&hellip;</span> and 404 at play time,
            because nothing uploads them.</p>
        </div>
      </section>

      <div class="acts">
        <button class="btn primary lg" disabled>Import 60 questions</button>
        <button class="btn lg">{ico('download')}Download the report</button>
        <span class="dim" style="font-size:var(--t-label);align-self:center">
          Fix the Title column to continue.</span>
      </div>
    </div>

{anno(60, 700, "Validate before the round trip", "<code>summarizeCsv()</code> already parses the file in the browser, quote-aware. It currently reports two counts. Everything on this page comes from the same parse plus the importer&rsquo;s own published rules &mdash; no new endpoint.", 300)}
{anno(310, 700, "&ldquo;Skipped&rdquo; is not a footnote", "The server does return <code>skippedRowCount</code> and the first fifty <code>skippedRows</code> with reasons, and the only place that surfaces is one sentence appended to a success message after the write has already happened.", 300)}
{anno(560, 700, "Name the product&rsquo;s own bugs", "The poll <span class='mono'>Option1..5</span> vs <span class='mono'>Options</span> mismatch silently empties every poll question, and the AI poll builder emits the broken shape. A design that hides a known defect behind a green tick is worse than no design.", 300)}
"""

IMPORT_ERR_CSS = """
.badhdr{color:var(--danger-text);text-decoration:underline;text-decoration-style:wavy}
.tbl.inner th{background:var(--surface);padding-top:8px;padding-left:14px}
.tbl.inner td{padding-left:14px;height:auto;padding-top:7px;padding-bottom:7px}
.tbl.inner td:last-child{padding-right:14px}
tr.fatal td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
tr.skip td:first-child,tr.warn td:first-child{box-shadow:inset 3px 0 0 var(--primary)}
.acts{display:flex;gap:9px;margin:4px 0 0}
"""

# ========================================================== 07 new set ====
_WAY = lambda ic, t, s, best, cost, cls="": f"""      <button class="way {cls}">
        <span class="wi">{ico(ic)}</span>
        <span class="wt">{t}</span>
        <span class="ws">{s}</span>
        <span class="wm wm1"><b>Best when</b> {best}</span>
        <span class="wm wm2"><b>Costs you</b> {cost}</span>
      </button>"""

NEW_SET_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1><p class="sub">41 sets</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{ico('download')}Templates</button>
        <button class="btn primary">{ico('plus')}New set</button></div>
    </div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.5" aria-hidden="true">
      <div class="filters"><div class="search">{ico('search')}<input class="inp"></div>
        <select class="inp"><option>All types</option></select></div>
      <table class="tbl"><thead><tr><th>Set</th><th>Type</th><th class="num">Qs</th>
        <th>State</th><th>Updated</th></tr></thead><tbody>
        <tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
        <tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
        <tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr></tbody></table>
    </div>

    <div class="scrim">
      <div class="modal wide">
        <header><div><h2>New question set</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">
            Five ways in. They are not interchangeable, so this says what each costs.</p></div>
          <span style="flex:1"></span>
          <button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="ways">
{_WAY('sparkle','Generate with AI','Describe a topic; a job writes the questions.','you have a topic and no source material.','a review pass &mdash; generated sets land inactive on purpose.','primaryway')}
{_WAY('upload','Upload a CSV','The authoring path everything else compiles down to.','you already have the content, or you exported it from somewhere.','nothing. This is the only lossless route.')}
{_WAY('package','Import from archive','Pull a set another environment exported.','you are promoting a set from dev to test or prod.','tags, School, Question#, the attached prompt and the AI context &mdash; the archive CSV has no columns for them.','lossyway')}
{_WAY('pencil','Manual builder','Type questions one at a time in the builder.','you are writing three or four questions.','time. It opens in a second tab and does not know about this set.')}
{_WAY('file','Start from a template','Download a CSV with the right columns, fill it in, upload it.','you want the CSV route but not the column guesswork.','a round trip through a spreadsheet.')}
          </div>
        </div>
        <footer>
          <span class="dim" style="font-size:var(--t-label)">Engagement type is chosen
            <b>inside</b> whichever path you pick.</span>
          <span class="grow"></span>
          <button class="btn">Cancel</button>
        </footer>
      </div>
    </div>

{anno(120, 46, "One control, once", "Today the engagement type is a single React state rendered as <b>two separate selects</b> in two different sections of the same tab. Changing either silently changes the other, and it also decides which AI builder the button opens. Here the type is asked once, inside the path that needs it.", 290)}
{anno(400, 46, "Say what it costs", "Import is the path that quietly loses the most &mdash; tags, School, the attached summary prompt, the AI context, and every image whose filename is not an absolute URL. Marking it is not discouragement; it is the difference between a choice and a trap.", 290)}
"""

NEW_SET_CSS = """
.ways{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:2px 0 8px}
.way{display:grid;grid-template-columns:26px 1fr;grid-template-areas:"i t" ". s" ". m1" ". m2";
  gap:2px 10px;text-align:left;background:var(--bg);border:1px solid var(--rule-strong);
  border-radius:9px;padding:12px 13px;cursor:pointer;color:var(--text);font-family:inherit}
.way:hover{border-color:var(--muted);background:var(--surface-2)}
.way.primaryway{border-color:rgba(246,169,76,.55);background:rgba(246,169,76,.07)}
.way.lossyway{border-color:rgba(229,100,94,.34)}
.way .wi{grid-area:i;color:var(--primary)}
.way .wi .ico{width:18px;height:18px}
.way .wt{grid-area:t;font-weight:700;font-size:var(--t-body)}
.way .ws{grid-area:s;font-size:var(--t-label);color:var(--muted);margin-bottom:5px}
.way .wm{font-size:var(--t-floor);color:var(--muted);line-height:1.45}
.way .wm1{grid-area:m1}
.way .wm2{grid-area:m2;margin-top:3px}
.way .wm b{color:var(--text);font-weight:700;margin-right:3px}
.way.lossyway .wm2 b{color:var(--danger-text)}
.modal footer .grow{flex:1 1 auto}
"""

# ==================================================== 08 AI builder form ==
AI_CONFIG_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1><p class="sub">41 sets</p></div>
    </div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.45" aria-hidden="true">
      <div class="filters"><div class="search">{ico('search')}<input class="inp"></div></div>
      <table class="tbl"><tbody><tr><td>&nbsp;</td></tr><tr><td>&nbsp;</td></tr></tbody></table>
    </div>

    <div class="scrim">
      <div class="modal wide">
        <header><div><h2>Generate trivia questions</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">
            Step 1 of 2 &middot; the job runs on the server, so you can close this once it
            starts.</p></div>
          <span style="flex:1"></span>
          <button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="grid2">
            <div class="field"><label>Topic <span class="req">required</span></label>
              <input class="inp" value="Post-merger integration of a hardware business into a software-led org">
            </div>
            <div class="field"><label>Audience</label>
              <input class="inp" value="Extended leadership team and their direct reports"></div>
          </div>

          <div class="grid3" style="margin-top:13px">
            <div class="field"><label>Questions</label>
              <div class="numrow"><input class="inp num" value="100">
                <div class="seg"><button>5</button><button>10</button><button>20</button>
                  <button aria-pressed="true">50</button></div></div>
              <p class="help">1&ndash;100. Above 19 the job runs in several passes.</p></div>
            <div class="field"><label>Categories</label>
              <div class="numrow"><input class="inp num" value="24">
                <div class="seg"><button>3</button><button>5</button><button>8</button>
                  <button>12</button></div></div>
              <p class="help ceiling">24 is the hard ceiling &mdash; the host&rsquo;s category
                filter is a 24-bit mask.</p></div>
            <div class="field"><label>Difficulty</label>
              <select class="inp"><option>Easy</option><option selected>Medium</option>
                <option>Hard</option></select></div>
          </div>

          <div class="grid2" style="margin-top:13px">
            <div class="field"><label>Answer choices</label>
              <select class="inp"><option>4 &mdash; A to D</option>
                <option>5 &mdash; A to E</option><option selected>6 &mdash; A to F</option></select></div>
            <div class="field"><label>Correct answers per question</label>
              <select class="inp"><option selected>1</option><option>2</option>
                <option>3</option></select></div>
          </div>

          <div class="field" style="margin-top:13px"><label>Categories it must include</label>
            <input class="inp" value="Governance, Engineering, Commercial, People, Legal, Timeline"></div>

          <div class="field" style="margin-top:13px"><label>Anything else</label>
            <textarea class="inp" rows="3" placeholder="Constraints, tone, things to avoid.">Avoid anything that names an individual. Every question must be answerable from the published integration timeline.</textarea></div>

          <div class="field" style="margin-top:13px"><label>Source material <span class="dim">optional</span></label>
            <div class="drop">{ico('file')}<span><b>nakamura-integration-retro.docx</b>
              &middot; 84&nbsp;KB &middot; 11,200 words extracted</span>
              <button class="btn sm ghost">Remove</button></div>
            <p class="help">.txt, .md, .pdf, .docx. The extracted text is appended to the
               instructions above.</p></div>
        </div>
        <footer>
          <span class="dim" style="font-size:var(--t-label)">100 questions &times; 6 choices
            runs in <b>6 passes</b>, roughly 3&ndash;5 minutes.</span>
          <span class="grow"></span>
          <button class="btn">Cancel</button>
          <button class="btn primary">{ico('sparkle')}Start generating</button>
        </footer>
      </div>
    </div>

{anno(300, 40, "Estimate, from real constants", "The worker fits <code>floor((8000-600)/380)</code> = 19 trivia items per model call, so 100 questions is six sequential passes. The number is already knowable at submit time and no builder shows it &mdash; which is why nobody knows whether to wait.", 280)}
{anno(500, 40, "The ceiling, stated where it binds", "24 categories is not a preference; it is three bytes of bitmask in the host&rsquo;s category filter. The scenario builder says so in help text and the trivia builder, which has the same limit, does not.", 280)}
"""

AI_CONFIG_CSS = """
.req{color:var(--primary);font-weight:600;font-size:var(--t-floor);
  text-transform:uppercase;letter-spacing:.07em;margin-left:5px}
.numrow{display:flex;gap:7px;align-items:center}
.numrow .inp.num{width:72px;flex:none;text-align:right}
.help.ceiling{color:var(--primary)}
.drop{display:flex;align-items:center;gap:9px;border:1px dashed var(--rule-strong);
  border-radius:7px;padding:9px 12px;font-size:var(--t-label);color:var(--muted)}
.drop .ico{color:var(--primary);flex:none}
.drop b{color:var(--text)}
.drop .btn{margin-left:auto}
.modal footer .grow{flex:1 1 auto}
"""
