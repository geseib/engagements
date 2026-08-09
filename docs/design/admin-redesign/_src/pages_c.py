# -*- coding: utf-8 -*-
"""Page bodies, part 3: the generation job (running / failed / review),
sessions, and the two destructive confirmations."""

from pages import ico, anno, chip

# The topbar chip. This is the whole point of the job design: the work is on the
# server, so it must have a home outside the modal that started it.
JOBCHIP_RUNNING = ('<button class="jobchip running"><span class="spinner"></span>'
                   '2 jobs<span class="dim" style="font-weight:400">&middot; 34/100</span></button>')
JOBCHIP_FAILED = ('<button class="jobchip failed">' +
                  ico('warn') + '1 job failed</button>')

_TRAY = f"""    <div class="tray" role="region" aria-label="Generation jobs">
      <header>{ico('sparkle')} Generation jobs</header>
      <div class="job">
        <span class="spinner" style="margin-top:4px"></span>
        <span class="txt">
          <span class="ttl">Trivia &mdash; Post-merger integration of a hardware business</span>
          <span class="meta">34 of 100 &middot; pass 3 of 6 &middot; started 2m 10s ago</span>
          <span class="sweep"><i></i></span>
        </span>
      </div>
      <div class="job">
        <span class="spinner" style="margin-top:4px"></span>
        <span class="txt">
          <span class="ttl">Wavelength &mdash; Platform vocabulary</span>
          <span class="meta">Queued &middot; started 6s ago</span>
          <span class="sweep"><i></i></span>
        </span>
      </div>
      <div class="job">
        <span style="margin-top:2px;color:var(--success-text)">{ico('check')}</span>
        <span class="txt">
          <span class="ttl">Poll &mdash; Onboarding pulse</span>
          <span class="meta">24 questions &middot; finished 8m ago &middot;
            <a href="11-ai-job-review.html" style="color:var(--primary)">review</a></span>
        </span>
      </div>
    </div>"""

# ======================================================= 09 job running ===
_LANDED = "\n".join(
  f"""        <li class="landed"><span class="n">{n}</span>
          <span class="q">{q}</span><span class="c">{c}</span></li>"""
  for n, q, c in [
    (34, "In which month did the two engineering orgs first publish a shared roadmap?", "Timeline"),
    (33, "What was the stated headcount target at close, before the October revision?", "People"),
    (32, "Which system was retired first after the platform decision?", "Engineering"),
    (31, "Who chaired the integration steering committee for the first two quarters?", "Governance"),
    (30, "What did the pricing harmonisation memo actually change?", "Commercial"),
  ])

JOB_RUNNING_BODY = f"""    <div class="work-head">
      <div><h1>Generating trivia questions</h1>
        <p class="sub">Job <span class="mono">m4k2p9x7bq1a</span> &middot;
          started 14:22:06 &middot; runs on the server</p></div>
    </div>

    <div class="work-body">
      <section class="panel">
        <div class="body">
          <div class="jobhead">
            <span class="bignum">34<span class="of">&thinsp;/&thinsp;100</span></span>
            <div class="jobtxt">
              <p class="phase">Generated 34 of 100&hellip;</p>
              <p class="sub2">Pass 3 of 6 &middot; elapsed 2m 10s &middot;
                 last update 4s ago</p>
              <span class="sweep"><i></i></span>
            </div>
          </div>

          <p class="note-box"><b>Progress arrives one pass at a time, not one question at a
            time.</b> The worker writes its count after each model call, so this jumps by
            about 19 and then sits still. That is the shape of the work, and a smoothly
            filling bar would be inventing motion that is not there.</p>

          <h4 class="landedh">Questions written so far</h4>
          <ul class="landedlist">
{_LANDED}
            <li class="landed dimrow"><span class="n">&middot;&middot;&middot;</span>
              <span class="q">29 earlier questions</span><span class="c"></span></li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <header><h2>If you leave</h2></header>
        <div class="body">
          <div class="acts" style="margin-bottom:14px">
            <button class="btn primary lg">Close &mdash; this keeps running</button>
            <button class="btn lg">Start another set while this runs</button>
          </div>
          <ul class="leavelist">
            <li>{ico('check')}<span>The job keeps running. It is a server-side worker; this
              page is only watching it.</span></li>
            <li>{ico('check')}<span>The job id is kept in this browser, so a reload or a
              closed tab picks it back up. It stays readable for three days.</span></li>
            <li>{ico('check')}<span>It appears in the jobs list in the top bar until you
              review it.</span></li>
            <li class="no">{ico('x')}<span><b>It cannot be stopped.</b> There is no cancel
              endpoint, so &ldquo;cancel&rdquo; would only stop you watching &mdash; the model
              calls and their cost would continue. This design refuses to draw a button that
              does not do what it says.</span></li>
          </ul>
        </div>
      </section>
    </div>
{_TRAY}

{anno(64, 700, "The state nobody had drawn", "Generation went asynchronous when it outgrew the 30-second gateway ceiling, and the UI did not follow: today this whole screen is a CSS spinner and one line of text, inside a modal whose only exit unmounts the component while the polling loop carries on writing into it.", 300)}
{anno(230, 700, "Data already on the wire", "<code>completed</code>, <code>requested</code>, <code>items[]</code> and <code>warnings[]</code> are in every poll response today. <code>items</code> even reaches component state during polling &mdash; and is then hidden behind the <code>isGenerating&nbsp;?</code> branch, which wins.", 300)}
{anno(468, 700, "Leaving is the design", "&ldquo;Close &mdash; this keeps running&rdquo; is the primary affordance, not an escape hatch. The client currently gives up after ten minutes on a worker allowed fifteen, and tells you to &ldquo;reopen the builder to check&rdquo; &mdash; which is impossible, because nothing anywhere stores the job id.", 300)}
"""

JOB_CSS = """
.jobhead{display:flex;gap:18px;align-items:flex-start;margin-bottom:14px}
.bignum{font:800 var(--t-numeral)/1 var(--font-display);color:var(--primary);
  font-variant-numeric:tabular-nums;flex:none}
.bignum .of{font-size:19px;color:var(--muted);font-weight:600}
.jobtxt{flex:1 1 auto;min-width:0;padding-top:2px}
.phase{margin:0;font-size:var(--t-body);font-weight:600}
.sub2{margin:2px 0 0;font-size:var(--t-label);color:var(--muted)}
.jobtxt .sweep{margin-top:9px}
.landedh{margin:16px 0 7px;font-size:var(--t-floor);letter-spacing:.09em;
  text-transform:uppercase;color:var(--muted);font-weight:700}
.landedlist{list-style:none;margin:0;padding:0;border:1px solid var(--rule);border-radius:8px;
  overflow:hidden}
.landed{display:flex;gap:11px;align-items:baseline;padding:7px 12px;
  border-bottom:1px solid var(--rule);font-size:var(--t-body)}
.landed:last-child{border-bottom:0}
.landed .n{color:var(--muted);font-size:var(--t-label);width:26px;flex:none;text-align:right;
  font-variant-numeric:tabular-nums}
.landed .q{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.landed .c{flex:none;font-size:var(--t-floor);color:var(--muted);
  border:1px solid var(--rule-strong);border-radius:999px;padding:1px 7px}
.landed.dimrow{color:var(--muted);font-style:italic}
.landed.dimrow .q{font-size:var(--t-label)}
.acts{display:flex;gap:9px;flex-wrap:wrap}
.leavelist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.leavelist li{display:flex;gap:9px;align-items:flex-start;font-size:var(--t-body);
  line-height:1.5;max-width:96ch}
.leavelist .ico{flex:none;margin-top:3px;color:var(--success-text);width:15px;height:15px}
.leavelist li.no .ico{color:var(--danger-text)}
.leavelist li.no{color:var(--muted)}
.leavelist li.no b{color:var(--text)}
"""

# ======================================================== 10 job failed ===
JOB_FAILED_BODY = f"""    <div class="work-head">
      <div><h1>Generation stopped at 41 of 100</h1>
        <p class="sub">Job <span class="mono">m4k2p9x7bq1a</span> &middot; ran 4m 02s
          &middot; ended 14:26:08</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn ghost">Close</button></div>
    </div>

    <div class="work-body">
      <p class="note-box bad" style="max-width:none">
        <b>This is a partial result, not a finished set.</b> Forty-one questions were written
        and kept. The fourth pass failed and the remaining fifty-nine were never attempted.</p>

      <section class="panel">
        <header><h2>What happened</h2></header>
        <div class="body">
          <div class="passes">
            <div class="pass ok">{ico('check')}<b>Pass 1</b><span>19 questions</span></div>
            <div class="pass ok">{ico('check')}<b>Pass 2</b><span>19 questions</span></div>
            <div class="pass ok">{ico('check')}<b>Pass 3</b><span>3 questions</span>
              <em>16 near-duplicates dropped</em></div>
            <div class="pass bad">{ico('warn')}<b>Pass 4</b><span>failed</span></div>
            <div class="pass none"><b>Passes 5&ndash;6</b><span>not attempted</span></div>
          </div>
          <p class="errmsg mono">rate limited by the AI service (HTTP 429)</p>
          <p class="dim" style="font-size:var(--t-label);margin:6px 0 0">
            That string is the whole error the API returns &mdash; there is no code and no
            retryable flag, so this screen can offer a retry but cannot promise it will work.</p>
        </div>
      </section>

      <section class="panel">
        <header><h2>Warnings from the passes that did run</h2>
          <p class="note">Returned on every poll today, displayed nowhere.</p></header>
        <div class="body">
          <ul class="warnlist">
            <li>{ico('warn')}<span>A pass of 19 exceeded the output budget; continuing in
              smaller passes.</span></li>
            <li>{ico('warn')}<span>A generation pass produced only duplicates; stopping
              early.</span></li>
          </ul>
          <p class="note-box warn" style="margin-top:12px"><b>Sixteen questions were dropped
            for being near-duplicates.</b> The server logs this and does not report it, so
            &ldquo;41 of 100&rdquo; understates how much the model actually produced. Asking
            for 100 questions across 24 categories on one narrow topic is close to the limit
            of what is distinct.</p>
        </div>
      </section>

      <section class="panel">
        <header><h2>What do you want to do with the 41?</h2></header>
        <div class="body">
          <div class="acts">
            <button class="btn primary lg">Review the 41 and make a set</button>
            <button class="btn lg">{ico('revert')}Try again for the remaining 59</button>
            <button class="btn lg danger">Discard all 41</button>
          </div>
          <p class="help" style="margin-top:10px">Trying again starts a second job with the
            same settings and a count of 59. It cannot resume this one &mdash; there is no
            resume, and pretending otherwise would produce duplicates.</p>
        </div>
      </section>
    </div>

{anno(70, 700, "The defect this screen exists for", "Today, a job that fails <b>with</b> partial items renders the review UI and the error string is never shown anywhere. Failure looks exactly like success. In the scenario builder it is worse: the partials are discarded outright even though the job carries them.", 300)}
{anno(330, 700, "Three real outcomes", "&ldquo;Back to Configuration&rdquo; is the only control that exists in any failure branch today &mdash; no retry, no keep, no discard. Keeping 41 usable questions is usually the right answer and there is no way to say so.", 300)}
{anno(520, 700, "Do not promise resume", "The job row is terminal once it fails. A &ldquo;resume&rdquo; button would have to start a fresh job that does not know what the first one wrote, so this asks for the remainder explicitly and says why.", 300)}
"""

JOB_FAILED_CSS = JOB_CSS + """
.passes{display:flex;gap:1px;background:var(--rule);border:1px solid var(--rule);
  border-radius:8px;overflow:hidden;margin-bottom:12px;flex-wrap:wrap}
.pass{background:var(--surface);padding:9px 13px;flex:1 1 130px;display:flex;
  flex-direction:column;gap:2px;font-size:var(--t-label)}
.pass .ico{width:14px;height:14px}
.pass b{font-size:var(--t-body)}
.pass span{color:var(--muted)}
.pass em{color:var(--primary);font-style:normal;font-size:var(--t-floor)}
.pass.ok .ico{color:var(--success-text)}
.pass.bad{background:rgba(229,100,94,.1)}
.pass.bad .ico{color:var(--danger-text)}
.pass.none{opacity:.45}
.errmsg{margin:0;padding:9px 12px;border-radius:6px;background:rgba(229,100,94,.11);
  color:var(--danger-text);border:1px solid rgba(229,100,94,.3);font-size:14px}
.warnlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.warnlist li{display:flex;gap:9px;align-items:flex-start;font-size:var(--t-body);
  color:var(--muted);max-width:96ch;line-height:1.5}
.warnlist .ico{flex:none;margin-top:3px;color:var(--primary);width:15px;height:15px}
.acts{display:flex;gap:9px;flex-wrap:wrap}
"""

# ======================================================== 11 job review ===
_REV = "\n".join(
  f"""      <tr><td class="num dim">{n}</td>
        <td><span class="nm">{q}</span><span class="sub">{a}</span></td>
        <td>{chip(c)}</td><td>{d}</td>
        <td><div class="rowact"><button class="btn sm">{ico('pencil')}Edit</button>
          <button class="btn sm ghost" title="Leave this one out">{ico('x')}</button></div></td></tr>"""
  for n, q, a, c, d in [
    (1, "Which system was retired first after the platform decision?",
     "Correct: B &mdash; the legacy order pipeline", "Engineering", chip("Medium")),
    (2, "What did the pricing harmonisation memo actually change?",
     "Correct: A &mdash; list price bands only", "Commercial", chip("Hard")),
    (3, "Who chaired the integration steering committee for the first two quarters?",
     "Correct: C &mdash; the incoming COO", "Governance", chip("Easy")),
    (4, "In which month did the two engineering orgs publish a shared roadmap?",
     "Correct: D &mdash; March", "Timeline", chip("Medium")),
    (5, "What was the stated headcount target at close?",
     "<span class='flagtxt'>No correct answer could be mapped &mdash; defaulted to A</span>",
     "People", chip("Medium")),
  ])

JOB_REVIEW_BODY = f"""    <div class="work-head">
      <div><h1>Review 84 generated questions</h1>
        <p class="sub">Nothing has been saved yet. Approving creates an
          <b>inactive</b> set you can edit before anyone plays it.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('download')}Export CSV</button>
        <button class="btn primary">Create set &mdash; 83 questions</button>
      </div>
    </div>

    <div class="work-body">
      <p class="note-box warn" style="max-width:none">
        <b>You asked for 100 and got 84.</b> Sixteen were dropped server-side for being too
        close to another question. One more has no usable correct answer and is excluded
        below &mdash; fix it or leave it out.</p>

      <div class="filters">
        <div class="search">{ico('search')}<input class="inp" placeholder="Filter these 84"></div>
        <select class="inp"><option>All 24 categories</option></select>
        <div class="seg"><button aria-pressed="true">All 84</button>
          <button>Needs attention 1</button></div>
        <span class="count">84 generated &middot; 83 will be saved</span>
      </div>

      <table class="tbl">
        <thead><tr><th class="num" style="width:46px">#</th><th>Question</th>
          <th style="width:130px">Category</th><th style="width:100px">Difficulty</th>
          <th style="width:120px"></th></tr></thead>
        <tbody>
{_REV}
          <tr class="dimrow"><td class="num dim">&middot;&middot;&middot;</td>
            <td class="dim">79 more</td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    </div>

{anno(150, 700, "A list, not a carousel", "Today review is one item at a time behind Previous / Next, with a counter. Judging eighty-four questions through a one-item window is not review; it is a data-entry task. It is also the only place where a table is obviously right and there is no table.", 300)}
{anno(330, 700, "Per-item reject", "There is no way to drop a single generated question today &mdash; you accept all of them or none. One bad row therefore means either importing it and fixing it later, or throwing away eighty-three good ones.", 300)}
{anno(470, 700, "Say the count changed", "Near-duplicate suppression happens on the server and is only <code>console.warn</code>-ed. Asking for 100 and silently receiving 84 is the kind of shortfall people notice a week later, in a session.", 300)}
"""

JOB_REVIEW_CSS = """
.flagtxt{color:var(--danger-text)}
tr.dimrow td{color:var(--muted);font-style:italic;font-size:var(--t-label)}
.tbl .rowact{opacity:1}
"""

# ========================================================= 12 sessions ====
_SESS = "\n".join(
  f"""      <tr class="{cls}"><td><a class="nm" href="#">{t}</a><span class="sub">{s}</span></td>
        <td>{chip(gt,'type')}</td><td>{st}</td><td class="num">{pl}</td>
        <td class="when">{when}</td><td>{rep}</td>
        <td><div class="rowact"><button class="btn sm">Open</button>
          <button class="btn sm ghost" aria-label="More">&#8943;</button></div></td></tr>"""
  for t, s, gt, st, pl, when, rep, cls in [
    ("Q3 Leadership Offsite", "Set: Q3 Leadership Offsite &mdash; Lessons Learned &middot; v7 &middot; host george.seib",
     "Call &amp; Answer", chip("Live &middot; Round 4","warn"), 38, "started 12m ago",
     chip("&mdash;"), "live"),
    ("Nakamura Trivia Night", "Set: Nakamura Integration &mdash; Trivia &middot; v3 &middot; host g.seib",
     "Trivia", chip("Ended","off"), 41, "6 Aug 19:12", chip("Report saved","on"), ""),
    ("Onboarding Pulse &mdash; Cohort 14", "Set: <s>Onboarding Pulse &mdash; Week 1</s> &middot; set deleted",
     "Poll", chip("Ended","off"), 12, "5 Aug 10:30",
     chip("No report &middot; cannot build","bad"), "broken"),
    ("Platform Vocabulary Warmup", "Set: Wavelength: Platform Vocabulary &middot; v1",
     "Wavelength", chip("Ended","off"), 22, "4 Aug 09:05", chip("No report","off"), ""),
    ("Untitled engagement", "Set: &mdash; &middot; created but never started",
     "Call &amp; Answer", chip("Never started","off"), 0, "31 Dec 1969",
     chip("&mdash;"), "broken"),
    ("Sales Kickoff", "Set: Sales Kickoff Icebreakers &middot; v2 &middot; host a.okafor",
     "Poll", chip("Ended","off"), 187, "25 Jul 14:00", chip("Report saved","on"), ""),
    ("Bar Raiser Calibration", "Set: Hiring Loop &mdash; Bar Raiser Prep &middot; v1",
     "Call &amp; Answer", chip("Ended","off"), 9, "24 Jul 16:45", chip("No report","off"), ""),
    ("Customer Advisory Board", "Set: Customer Advisory Board &mdash; Themes &middot; v1",
     "Call &amp; Answer", chip("Ended","off"), 14, "22 Jul 11:00",
     chip("Report saved","on"), ""),
  ])

SESSIONS_BODY = f"""    <div class="work-head">
      <div><h1>Sessions</h1>
        <p class="sub">18 sessions &middot; one is live now. Data here expires:
          90 days from creation, 7 days after last play.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn danger">{ico('trash')}Delete all sessions&hellip;</button>
      </div>
    </div>

    <div class="work-body">
      <div class="filters">
        <div class="search">{ico('search')}<input class="inp"
          placeholder="Search title, session code, host"></div>
        <select class="inp"><option>All states</option><option>Live</option>
          <option>Ended</option><option>Never started</option></select>
        <select class="inp"><option>All types</option></select>
        <span class="count">18 sessions &middot; 8 shown</span>
      </div>

      <table class="tbl">
        <thead><tr><th style="width:30%">Session</th><th style="width:12%">Type</th>
          <th style="width:14%">State</th><th class="num" style="width:7%">Players</th>
          <th style="width:13%">Last played</th><th style="width:15%">Report</th>
          <th style="width:9%"></th></tr></thead>
        <tbody>
{_SESS}
        </tbody>
      </table>
    </div>

{anno(90, 700, "The tab that had no list", "&ldquo;Game Management&rdquo; today is a single red panel: a free-text box for a game id and a Delete All button. There is no list &mdash; so to delete one session you must already know its id, and the only place ids are shown is the host screen.", 300)}
{anno(300, 700, "The list already exists", "<code>GET /games</code> is deployed and returns title, type, question set, host, created, lastPlayed and started. The host page&rsquo;s switch-game dialog reads it. The admin console has simply never asked.", 300)}
{anno(470, 700, "Worst case, on purpose", "Row 3 is a session whose question set has been deleted, so no report can ever be built for it. Row 5 carries the epoch-zero date from the open <i>&ldquo;player dates showing 1969&rdquo;</i> defect. Both render as ordinary rows in a list that formats blindly.", 300)}
"""

SESSIONS_CSS = """
tr.live td:first-child{box-shadow:inset 3px 0 0 var(--primary)}
tr.broken td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
.tbl .sub s{color:var(--danger-text)}
"""

# ================================================== 14 confirm delete set ==
CONFIRM_SET_BODY = f"""    <div class="work-head">
      <div><h1 style="max-width:58ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        Q3 Leadership Offsite &mdash; Lessons Learned from the Nakamura Integration</h1>
        <p class="sub">Call &amp; Answer &middot; 42 questions in 24 categories</p></div>
    </div>
    <nav class="subnav" aria-hidden="true"><button>Details</button><button>Questions</button>
      <button>Versions</button><button>Media</button>
      <button class="dngr" aria-current="true">Delete</button></nav>
    <div class="work-body" style="filter:blur(1.5px);opacity:.4" aria-hidden="true">
      <section class="panel"><div class="body" style="height:170px"></div></section>
    </div>

    <div class="scrim">
      <div class="modal">
        <header><span class="mico">{ico('warn')}</span>
          <div><h2>Delete this question set?</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">
            42 questions, 24 categories and 7 versions. This cannot be undone.</p></div></header>
        <div class="body">
          <p><b>Three past sessions used this set.</b> A session report is built from the
            live set when it is first requested, so deleting the set decides, permanently,
            which of them can still produce one.</p>

          <ul class="impact">
            <li class="ok">{ico('check')}<span><b>Nakamura Trivia Night</b> &middot;
              2026-08-06 &middot; 41 players<br><span class="dim">Report already saved.
              Unaffected.</span></span></li>
            <li class="bad">{ico('warn')}<span><b>Q3 Leadership Offsite</b> &middot;
              live now &middot; 38 players<br><span class="dim">Playing v7 right now.
              Deleting the set breaks the session mid-round.</span></span></li>
            <li class="bad">{ico('warn')}<span><b>Bar Raiser Calibration</b> &middot;
              2026-07-24 &middot; 9 players<br><span class="dim">No report saved. After this
              delete, one can never be built.</span></span></li>
          </ul>

          <div class="field" style="margin-top:6px">
            <label>Type the set&rsquo;s name to confirm</label>
            <input class="inp mono" placeholder="Q3 Leadership Offsite &mdash; Lessons Learned&hellip;">
          </div>
          <p class="help" style="margin-top:6px">Or
            <a href="#" style="color:var(--primary)">deactivate it instead</a> &mdash; it stops
            appearing in the host&rsquo;s picker and nothing is lost.</p>
        </div>
        <footer>
          <button class="btn">Keep it</button>
          <button class="btn danger-solid" disabled>{ico('trash')}Delete the set</button>
        </footer>
      </div>
    </div>

{anno(190, 40, "The headline gap", "Version delete already does this properly: the first DELETE answers <b>200 with the pinned game ids instead of deleting</b>, and the UI names them before it asks again. Set delete &mdash; strictly more destructive &mdash; has no such check, and its result is written into a state variable that is never rendered. Success and failure look identical: the modal closes.", 300)}
{anno(430, 40, "Offer the reversible neighbour", "Nine times in ten, &ldquo;delete&rdquo; means &ldquo;stop offering this to hosts&rdquo;, which is what the Active toggle already does. A destructive dialog that names the non-destructive alternative prevents more damage than any amount of red.", 300)}
{anno(560, 700, "Needs one backend change", "<code>DELETE /admin/question-sets/{setId}</code> must gain the contract <code>DELETE&nbsp;&hellip;/versions/{n}</code> already has: answer 200 with the affected sessions and whether each has a stored report, and only delete on <code>?confirm=true</code>.", 300)}
"""

CONFIRM_CSS = """
.mico{color:var(--danger-text);flex:none;margin-top:2px}
.mico .ico{width:20px;height:20px}
.impact{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:1px;
  background:var(--rule);border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.impact li{display:flex;gap:9px;align-items:flex-start;background:var(--bg);
  padding:9px 12px;font-size:var(--t-label);line-height:1.5}
.impact .ico{flex:none;margin-top:2px;width:15px;height:15px}
.impact li.ok .ico{color:var(--success-text)}
.impact li.bad .ico{color:var(--danger-text)}
.impact b{color:var(--text);font-size:var(--t-body)}
  font:600 var(--t-body)/1 var(--font-ui);padding:9px 12px 8px}
.subnav button[aria-current]{color:var(--danger-text);border-bottom-color:var(--danger)}
.subnav button.dngr{margin-left:auto;color:var(--danger-text)}
"""

# ================================================ 15 confirm delete all ====
CONFIRM_ALL_BODY = f"""    <div class="work-head">
      <div><h1>Sessions</h1><p class="sub">18 sessions</p></div>
    </div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.4" aria-hidden="true">
      <table class="tbl"><tbody><tr><td>&nbsp;</td></tr><tr><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td></tr></tbody></table>
    </div>

    <div class="scrim">
      <div class="modal">
        <header><span class="mico">{ico('warn')}</span>
          <div><h2>Delete all 18 sessions?</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">
            Everything below goes at once. There is no undo and no export first.</p></div></header>
        <div class="body">
          <ul class="impact">
            <li class="bad">{ico('warn')}<span><b>1 live session</b><br>
              <span class="dim">Q3 Leadership Offsite, 38 players, mid round 4. Their phones
              stop working immediately.</span></span></li>
            <li class="bad">{ico('warn')}<span><b>6 saved reports</b><br>
              <span class="dim">Deleted with their sessions. Reports live under the session,
              not the question set.</span></span></li>
            <li class="bad">{ico('warn')}<span><b>~2,400 answers and votes from 341
              players</b><br><span class="dim">Everything under
              <span class="mono">GAME#</span>.</span></span></li>
            <li class="ok">{ico('check')}<span><b>Question sets are not touched</b><br>
              <span class="dim">All 41 stay exactly as they are.</span></span></li>
          </ul>

          <div class="field">
            <label>Type <span class="mono" style="color:var(--danger-text)">delete all
              sessions</span> to confirm</label>
            <input class="inp mono" placeholder="delete all sessions">
          </div>
        </div>
        <footer>
          <span class="envwarn">{ico('warn')} You are on <b>dev</b></span>
          <span class="grow"></span>
          <button class="btn">Cancel</button>
          <button class="btn danger-solid" disabled>Delete all 18</button>
        </footer>
      </div>
    </div>

{anno(170, 40, "Count before you ask", "The current dialog says &ldquo;Are you sure you want to delete ALL games? This action cannot be undone!&rdquo; and then reports <code>itemsDeleted</code> <b>after</b> the fact. The number that matters is the one you see before you press it.", 300)}
{anno(390, 40, "Type-to-confirm, sparingly", "Two actions in this console earn it: delete-all-sessions and delete-a-set-with-history. Everywhere else it is friction theatre, and friction theatre trains people to type without reading.", 300)}
{anno(540, 700, "Which environment am I in", "The stack, the API base and the archive are all shared or near-identical across dev, test and prod, and the console gives no persistent signal of which one is loaded. The env chip is in the top bar of every screen, and it is repeated in the footer of the one dialog that could ruin a Tuesday.", 300)}
"""

CONFIRM_ALL_CSS = CONFIRM_CSS + """
.envwarn{display:inline-flex;align-items:center;gap:6px;font-size:var(--t-label);
  color:var(--primary)}
.envwarn .ico{width:14px;height:14px}
.envwarn b{text-transform:uppercase;letter-spacing:.06em}
"""

# ==================================================== 13 sessions empty ====
SESSIONS_EMPTY_BODY = f"""    <div class="work-head">
      <div><h1>Sessions</h1><p class="sub">Nothing has been played yet.</p></div>
    </div>
    <div class="work-body">
      <div class="empty">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.4"><use href="#i-play"/></svg>
        <h3>No sessions yet</h3>
        <p>Sessions are created by hosts, not here. This screen is where you find one
           afterwards &mdash; to read its report, or to clear it out.</p>
        <div class="acts">
          <button class="btn lg">{ico('books')}Check a set is active and quickstart-enabled</button>
        </div>
        <p style="margin-top:20px;font-size:var(--t-label);color:var(--muted)">
          A host can only start a session from a set that is <b>Active</b>.
          <span class="dim">12 of your 41 sets are currently inactive.</span></p>
      </div>
    </div>

{anno(160, 690, "An empty state that knows why", "The useful thing to say here is not &ldquo;no sessions&rdquo;. It is the most likely reason a host could not start one &mdash; and this console already knows how many sets are inactive.", 300)}
"""
