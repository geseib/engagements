# -*- coding: utf-8 -*-
"""The host's side in the console: the events list, a new event, the agenda
builder with its add menu, adding an engagement, adding a presentation, the
invitation list, and everything from the day afterwards."""
from build import console_page, write, ico, anno, NAV_PERSONAL
from content import (qr_svg, TITLE, DATE, PLACE, TZ, CODE, ITEMS, TYPES, ENDS, INVITED, JOINED,
                     CAP_ITEMS, CAP_ENDS, MAX_ITEMS, MAX_ENGAGEMENTS, engagements, counted,
                     AGENDA, CAP_AGENDA, DAY)


def tchip(t):
    icon, label = TYPES[t]
    cls = {"slides": "ag-type slides", "break": "ag-type brk"}.get(t, "ag-type")
    return f'<span class="{cls}">{ico(icon)}{label}</span>'


def mins(m):
    return f"{m} min"


def src_line(it):
    if it["type"] == "break":
        return f'Back at {it["until"]} &middot; not counted, not billed'
    if it["type"] == "slides":
        return f'{it["who"]} &middot; copy for attendees: {it["src"]}, {it["count"]}'
    return f'{it["src"]} &middot; v{it["ver"]} &middot; {it["count"]}'


# ------------------------------------------------------------------ backdrops
EVENTS_BG = """
    <div class="work-head"><div><h1>Events</h1>
      <p class="sub">One join code for a whole agenda: presentations and engagements, in the order you run them.</p></div>
      <span class="grow"></span><div class="head-actions"><button class="btn primary lg">{plus}New event</button></div></div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.5" aria-hidden="true">
      <table class="tbl"><thead><tr><th>Event</th><th style="width:180px">When</th><th class="num" style="width:70px">Items</th><th style="width:190px">Who can join</th></tr></thead><tbody>
      <tr><td><span class="nm">Sales onboarding, cohort 7</span></td><td class="when">Tue 14 Oct &middot; 13:30</td><td class="num">5</td><td>Anyone with the code</td></tr>
      <tr><td><span class="nm">Partner day</span></td><td class="when">Wed 22 Oct &middot; 10:00</td><td class="num">11</td><td>Invite only</td></tr>
      </tbody></table></div>""".format(plus=ico("plus"))


def ev_head(tab, actions, n_items=None):
    def cur(t):
        return ' aria-current="page"' if t == tab else ""
    return f"""
    <div class="work-head"><div><h1>{TITLE}</h1></div><span class="grow"></span>
      <div class="head-actions">{actions}</div></div>
    <nav class="subnav" aria-label="Event">
      <button{cur('agenda')}>Agenda <span class="dim">{n_items or len(ITEMS)}</span></button>
      <button{cur('invites')}>Invitations <span class="dim">{INVITED}</span></button>
      <button{cur('after')}>Reports and files</button>
    </nav>"""


def agenda_rows(moving=None, items=AGENDA):
    rows = []
    for i, it in enumerate(items):
        n = it["n"]
        up = '' if i > 0 else ' disabled'
        dn = '' if i < len(items) - 1 else ' disabled'
        extra = ''
        if it["title"].startswith("How well"):
            extra = '<button class="btn sm">Use v3</button>'
        cls = ' class="moving"' if moving == n else (' class="brk"' if it["type"] == "break" else '')
        sub = src_line(it)
        no = n if n else '<span class="dim" title="Breaks are not numbered or counted">&ndash;</span>'
        rows.append(
            f'<tr{cls}><td class="grip" title="Drag to move">{ico("grip")}</td><td class="no">{no}</td>'
            f'<td class="at">{it["at"]}</td>'
            f'<td><span class="nm">{it["title"]}</span><span class="sub" title="{sub}">{sub}</span></td>'
            f'<td>{tchip(it["type"])}</td><td class="num">{mins(it["mins"])}</td>'
            f'<td><div class="rowact">{extra}'
            f'<button class="btn sm ico-btn" aria-label="Move up"{up}>{ico("up")}</button>'
            f'<button class="btn sm ico-btn" aria-label="Move down"{dn}>{ico("down")}</button>'
            f'<button class="btn sm">Edit</button></div></td></tr>')
    return "".join(rows)


def planned(items):
    h, m = divmod(sum(i["mins"] for i in items), 60)
    return f"{h} h {m} min"


def agenda_table(items=AGENDA, ends=ENDS, moving=None):
    e = engagements(items)
    b = sum(1 for i in items if i["type"] == "break")
    warn = ('<span class="ag-warn">&middot; the most an event can hold</span>' if e >= MAX_ENGAGEMENTS else "")
    brk = f' &middot; {b} break <span class="dim">(not counted)</span>' if b else ""
    return AGENDA_TABLE.format(rows=agenda_rows(moving, items), ends=ends, planned=planned(items), n=counted(items),
                               maxn=MAX_ITEMS, e=e, maxe=MAX_ENGAGEMENTS, warn=warn, brk=brk)


AGENDA_TABLE = """
      <table class="tbl ag-agenda">
        <thead><tr><th style="width:30px" aria-label="Drag"></th><th style="width:30px" class="num">#</th>
          <th style="width:66px">Time</th><th>Item</th><th style="width:158px">Type</th>
          <th class="num" style="width:74px">Length</th><th style="width:196px" aria-label="Actions"></th></tr></thead>
        <tbody>{rows}</tbody>
        <tfoot><tr><td colspan="7">Ends <b>{ends}</b> &middot; {planned} planned &middot; <b>{n}</b> of {maxn} items &middot; <b>{e}</b> of {maxe} engagements{warn}{brk}</td></tr></tfoot>
      </table>"""

FACTS = f"""
      <div class="ag-facts">
        <div><span class="lab">Date</span><span class="v">{DATE}</span></div>
        <div><span class="lab">Starts</span><span class="v">9:00 <span class="dim">&middot; {TZ}</span></span></div>
        <div><span class="lab">Place</span><span class="v">{PLACE}</span></div>
        <div><span class="lab">Who can join</span><span class="v ag-lock">{ico('lock')}Invite only</span></div>
        <div><span class="lab">Join code</span><span class="code">{CODE}</span></div>
        <div class="acts"><button class="btn">{ico('pencil')}Edit details</button></div>
      </div>"""


def build():
    # ------------------------------------------------------ 01 events list ----
    rows = [
        (TITLE, PLACE, "Thu 9 Oct &middot; 9:00", 8, "Invite only &middot; 42", CODE, '<span class="chip type">Scheduled</span>'),
        ("Sales onboarding, cohort 7", "Online", "Tue 14 Oct &middot; 13:30", 5, "Anyone with the code", "6120", '<span class="chip off">Draft</span>'),
        ("Partner day", "Riverside Hall", "Wed 22 Oct &middot; 10:00", 11, "Invite only &middot; 120", "2289", '<span class="chip type">Scheduled</span>'),
    ]
    trs = "".join(
        f'<tr><td><a class="nm" href="02-builder.html">{t}</a><span class="sub">{p}</span></td><td class="when">{w}</td>'
        f'<td class="num">{n}</td><td>{a}</td><td class="mono">{c}</td><td>{s}</td>'
        f'<td><div class="rowact" style="opacity:1"><button class="btn sm">Open</button></div></td></tr>'
        for t, p, w, n, a, c, s in rows)
    body = f"""
    <div class="work-head"><div><h1>Events</h1>
      <p class="sub">One join code for a whole agenda: presentations and engagements, in the order you run them.</p></div>
      <span class="grow"></span><div class="head-actions"><button class="btn primary lg">{ico('plus')}New event</button></div></div>
    <div class="work-body">
      <div class="filters"><div class="search">{ico('search')}<input class="inp" placeholder="Search events"></div>
        <div class="seg" role="group" aria-label="Show"><button aria-pressed="true">Upcoming <span class="dim">3</span></button>
          <button aria-pressed="false">Past <span class="dim">11</span></button></div></div>
      <table class="tbl">
        <thead><tr><th>Event</th><th style="width:180px">When</th><th class="num" style="width:64px">Items</th>
          <th style="width:200px">Who can join</th><th style="width:70px">Code</th><th style="width:110px">State</th><th style="width:80px" aria-label="Actions"></th></tr></thead>
        <tbody>{trs}</tbody></table>
    </div>
{anno("A place, not a dialog", "An event has an agenda table, an invitation list and a page of reports: three tables. By the container rule that is a <b>place</b> with a breadcrumb back here, the way the set editor is (<code>AdminPage.jsx:1813</code>), not a modal.")}
{anno("Where it sits", "The nav is <code>config/consoleSections.js:347-362</code> as it ships for an org admin; <b>Events</b> is the one new item, under Sessions, because every engagement in an event runs as a session.")}
{anno("The code is fixed when the event is made", "So it can go on passcode cards and title slides weeks ahead. It is reserved in the <b>same</b> <code>GAMES</code> partition with the <b>same</b> conditional put a session uses (<code>schema-compliant-manager.js:109-124</code>), so an event code and a session code can never be the same number.")}
{anno("Team-plan organisations only", "Owner, 23 Sep: events are &lsquo;only avail on orgs&rsquo;. This list is what a Team-plan organisation sees. A Personal space still has the nav item &mdash; so it can be found &mdash; and gets 01b: what an event is, and the one way in (<b>Request the Team plan</b>, the shipped <code>PlanRequestDialog</code>, <code>AdminPage.jsx:2174</code>). Never a dead end, never a greyed-out button.")}
{anno("One event, one charge", "Billed once, when the first person joins, as a session is today (<code>usage.js:21-35</code>). Until event pricing ships that is one session. Then events get their own allowance: one a month included on the Team plan, $1 each after that, never drawn from the 5 included sessions. The sessions an event's items create are never counted.")}
{anno("Past is a filter, not a second page", "Past events keep their hub until 90 days after the date. After that the saved reports are still in the host's Reports; the event itself is gone, and the list says so rather than showing an empty row.")}
"""
    write("01-events.html", console_page("Events", body), group="console")

    # ------------------------------------------------------ 01b personal ------
    body = f"""
    <div class="work-head"><div><h1>Events</h1>
      <p class="sub">One join code for a whole agenda: presentations and engagements, in the order you run them.</p></div></div>
    <div class="work-body">
      <div class="empty ag-teamonly">
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-calendar"/></svg>
        <h3>Events are part of the Team plan</h3>
        <p>An event runs a whole day behind one code &mdash; talks, quizzes, Call &amp; Answer, surveys &mdash; with personal passcodes for invite-only rooms and every report in one place afterwards. The Team plan includes one event a month, then $1 each. This space is on the Personal plan.</p>
        <div class="acts"><button class="btn primary lg">Request the Team plan</button><button class="btn lg">What the Team plan adds</button></div>
        <p class="ag-hint" style="margin-top:18px">Until then, <b>Sessions</b> runs one engagement at a time, exactly as today.</p>
      </div>
    </div>
{anno("What a Personal space sees", "The nav item stays, so the feature can be found. The page says what an event is, why it is not here (the plan, stated once), and the one way in. Request the Team plan opens the shipped dialog (<code>PlanRequestDialog.jsx</code>, offered to a personal space at <code>AdminPage.jsx:2174</code>); the second button goes to Plan &amp; usage (<code>BillingPanel.jsx:181-183</code>).")}
{anno("No greyed-out builder", "A disabled copy of the builder would be a page of controls that do nothing. One honest paragraph is less to read and cannot be mistaken for a fault.")}
{anno("Refused on the server too", "<code>POST /events</code> from a Personal space answers with the same 402-plus-upgrade body session creation uses (<code>create-game.js:162-172</code>, <code>utils/upgradeRequired.js</code>), so a stale tab gets this same sentence.")}
{anno("Drawn as the end state", "The owner said events are &lsquo;ultimately&rsquo; org-only. Whether a Personal space gets them before event pricing ships is open; the proposal is no, so nothing is taken away later (RATIONALE, decision 1).")}
"""
    write("01b-events-personal.html", console_page("Events — Personal space", body, nav="events",
          navset=NAV_PERSONAL, who="sam.okafor@gmail.com"), group="console")

    # ------------------------------------------------------ 05 new event ------
    body = EVENTS_BG + f"""
    <div class="scrim ag-scrim">
      <div class="modal ag-modal" role="dialog" aria-labelledby="ne-t">
        <header><div><h2 id="ne-t">New event</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">Name it, say when and where, and choose who can join. You build the agenda next, from empty.</p></div>
          <button class="btn ghost sm ag-x" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="field ag-step"><label for="ne-n">Name</label><input class="inp" id="ne-n" value="{TITLE}"></div>
          <div class="ag-grid ag-step">
            <div class="field"><label for="ne-d">Date</label><input class="inp" id="ne-d" value="{DATE}"></div>
            <div class="field"><label for="ne-s">Starts</label><input class="inp" id="ne-s" value="9:00"></div>
            <div class="field span2"><label for="ne-z">Time zone</label><select class="inp" id="ne-z"><option>{TZ}</option></select></div>
            <div class="field span4"><label for="ne-p">Place <span class="dim" style="font-weight:400">&middot; optional, shown on passcode cards and phones</span></label><input class="inp" id="ne-p" value="{PLACE}"></div>
          </div>
          <div class="field ag-step"><span class="lab">Who can join</span>
            <div class="ag-opts row" role="radiogroup" aria-label="Who can join">
              <label class="ag-opt" aria-checked="false"><input type="radio" name="acc"><div><b>Anyone with the code</b><span>Like a session today: the code on the main screen is all anyone needs, and they type their own name.</span></div></label>
              <label class="ag-opt" aria-checked="true"><input type="radio" name="acc" checked>{ico('lock')}<div><b>Only people you invite</b><span>Each person gets their own passcode, which you hand out. The event code and that passcode let one phone in as them. You see who came.</span></div></label>
            </div>
            <p class="ag-hint">You can change this until the first passcode is made.</p></div>
          <div class="field ag-step"><span class="lab">Reports for attendees, afterwards</span>
            <div class="ag-opts row ag-opts--3" role="radiogroup" aria-label="Reports for attendees">
              <label class="ag-opt" aria-checked="true"><input type="radio" name="rep" checked><div><b>Full</b><span>Each item&rsquo;s report as you see it, names included.</span></div></label>
              <label class="ag-opt" aria-checked="false"><input type="radio" name="rep"><div><b>Anonymous</b><span>The same reports with every name removed.</span></div></label>
              <label class="ag-opt" aria-checked="false"><input type="radio" name="rep"><div><b>Not shared</b><span>Reports stay in the console.</span></div></label>
            </div>
            <p class="ag-hint">The default for every item; change any one later. Phones are told when people join, so once anyone is in, names can be removed but not added back. Survey results never carry names.</p></div>
          <div class="note-box ag-step ag-bill">{ico('card')}<div><b>Your first event each month is included; after that, $1 each.</b> Charged once, when the first person joins &mdash; not now, and not per item. Events never use your 5 included sessions. Up to 16 items, 8 of them engagements.</div></div>
        </div>
        <footer><button class="btn">Close</button><span class="grow"></span>
          <span class="dim" style="font-size:var(--t-label)">The join code is chosen when you create it.</span>
          <button class="btn primary">Create event</button></footer>
      </div>
    </div>
{anno("Two exits, one close", "The X and Close both go through one <code>requestClose()</code> that asks before discarding a typed name (hard rule 2, commit <code>4fd425d6</code>). The scrim scrolls and the card centres with <code>margin:auto</code> &mdash; never <code>align-items:center</code> on a scrolling scrim (hard rule 10).")}
{anno("Scheduling is four fields", "A date, a start, a time zone and a place. The end is not asked for: it is the start plus the agenda's lengths, worked out on the next screen. Nothing starts itself at 9:00 &mdash; in the owner's words the host <b>triggers</b> each item.")}
{anno("The zone is stored, never guessed", "Passcode cards, phones and the wall all read the event's zone. A remote attendee's phone shows its own local time beside it.")}
{anno("Billing, said where it is decided", "Owner, 23 Sep: an event is one charge, &lsquo;only avail on orgs&rsquo;, up to 16 items with 8 engagements (decision 1), and events are a <b>separate allowance</b>: &lsquo;keep them separate with 1 free per month billed&rsquo; (decision 12). Drawn as that end state. <b>Until event pricing ships</b> this line reads &lsquo;Counts as one session&rsquo; (one of the plan's 5 included, then $0.25, <code>pricing.js:47-60</code>). Billed on first join, like a session (<code>usage.js:21-35</code>), so an event made and abandoned costs nothing.")}
{anno("Reports: Full by default", "Owner: &lsquo;allow seeing full report. with an option to turn this off, so the report is not shared, or is only anonymous.&rsquo; One setting, three values, chosen here as the event's default and overridable per item in the hub (07). A survey's results never carry names, whatever this says (<code>survey-redesign/RATIONALE.md</code> &sect;3, Names).")}
{anno("No copying an agenda, yet", "The first draft offered &lsquo;Copy the agenda of Q3 Kickoff&rsquo;. The owner has shelved event templates (decision 10); a copy picker is that idea half-built, so it is removed rather than left to define it by accident.")}
{anno("Access is one choice", "Open = today's join (code + a typed name). Invite only = event code + a personal passcode the host hands out; no email is typed or sent (owner, 23 Sep). Today's private session is a third thing &mdash; one shared <code>AccessCode</code> compared as a plain string (<code>session-gate.js:74-116</code>) that no screen can set (<code>createGame.js:99-101</code>). It is not reused here.")}
"""
    write("05-new-event.html", console_page("New event", body), group="console")

    # ------------------------------------------------------ 02 builder --------
    menu = f"""
      <div class="ag-menu" role="menu" style="top:50px;right:14px">
        <h6>Answered on phones</h6>
        <button role="menuitem">{ico('survey')}<div><b>Survey</b><span>A form people fill in at their own pace. Good to open and close a day.</span></div></button>
        <button role="menuitem" class="hi">{ico('trivia')}<div><b>Trivia</b><span>Questions with one right answer. Scored, with standings.</span></div></button>
        <button role="menuitem">{ico('call')}<div><b>Call &amp; Answer</b><span>Everyone writes an answer, then the room votes for the best.</span></div></button>
        <button role="menuitem">{ico('poll')}<div><b>Poll</b><span>One question at a time; each result revealed on the main screen.</span></div></button>
        <button role="menuitem">{ico('wave')}<div><b>Wavelength</b><span>Everyone gives a few words; the room&rsquo;s shared language appears.</span></div></button>
        <hr>
        <h6>Talks</h6>
        <button role="menuitem">{ico('slides')}<div><b>Presentation</b><span>A talk from the presenter&rsquo;s own screen, with an optional PDF copy for attendees.</span></div></button>
        <hr>
        <h6>Just on the agenda</h6>
        <button role="menuitem">{ico('clock')}<div><b>Break</b><span>A return time on the agenda and a countdown on the wall. Not counted, not billed.</span></div></button>
      </div>"""
    body = f"""
    {ev_head('agenda', '<button class="btn">' + ico('play') + 'Rehearse on the stage</button>')}
    <div class="work-body">
      {FACTS}
      <div style="position:relative">
        <section class="panel"><header><h2>Agenda</h2><p class="note">The host starts each item. Times are the plan, not a timer.</p>
          <span class="grow"></span><button class="btn primary" aria-expanded="true" aria-haspopup="menu">{ico('plus')}Add item</button></header>
          <div class="body flush">{agenda_table()}</div></section>
        {menu}
      </div>
    </div>
{anno("An event is sessions, in order", "Each engagement item becomes an <b>ordinary session</b> at the moment the host starts it: the create path is unchanged (<code>create-game.js:187-246</code>), pinned to one set of one type exactly as today (<code>schema-compliant-manager.js:192-205</code>). The phase machine never learns about mixed types, because no session is mixed.")}
{anno("Reorder three ways", "Drag the grip, the &uarr;/&darr; buttons, or Alt+&uarr;/&darr; on a focused row. Drag is never the only way (WCAG 2.5.7). Times recompute; nothing else moves.")}
{anno("A break is listed, not counted", "Owner, 23 Sep (decision 7): &lsquo;breaks should be listed but dont count toward any count as there is nothing to store or present other than perhaps a timer.&rsquo; So the break row has a time and a length but no number, sits in its own menu group, is left out of the caps in the foot, is never billed and stores nothing. On the wall it is a countdown to its return time (s-05).")}
{anno("Rehearse on the stage", "Decision 9, kept simple: the same stage with the doors closed &mdash; the session-setup design's Preview (a view of a not-yet-open thing, joins refused), for a whole event. Nobody can join, nothing is billed or counted, no report is saved, the hub is untouched, no invitee is contacted. The wall carries a dashed Rehearsal mark (s-06).")}
{anno("The version is pinned when you add it", "Item 3 plays <b>v2</b>, the version reviewed when it was added; the set has since saved v3. <b>Use v3</b> is one click and never silent &mdash; the same rule a session's pin keeps (<code>set-version.js</code>, the <code>REF</code> row at <code>next-question.js:1108-1128</code>).")}
{anno("Survey arrives when surveys do", "Survey is unplayable today (<code>gameTypes.js:159</code>). Decision 11, by default: events do not wait for it &mdash; the Survey row appears in this menu once <code>survey-redesign</code> ships, and is drawn here as that end state. The intro and closing items use that design's model: self-paced, closed by the host.")}
{anno("Two kinds of item", "The menu is grouped because the difference matters to the room: an engagement is <b>answered</b> on phones, a presentation is a <b>talk</b> given from the presenter's own screen. The dashed chip edge carries the same split in the table (a word and an icon too &mdash; never the edge alone).")}
{anno("The caps, counted where you build", "Owner, 23 Sep: &lsquo;up to 16 agenda items with 8 of them being engagement sessions&rsquo;. The foot counts both, once. At 8 engagements the five engagement kinds in this menu disable <b>with the reason</b> and Presentation stays open up to 16 items (02b). The server refuses a 17th item or a 9th engagement with the same sentence, so two hosts editing at once cannot slip past it.")}
{anno("Facts once", "Date, start, place, access and code live in one strip. The end time and the counts are only in the table's foot, because they are derived from the table.")}
"""
    write("02-builder.html", console_page(f"{TITLE} — agenda", body, back="Events"), group="console")

    # ------------------------------------------------------ 02b cap reached ---
    capmenu = f"""
      <div class="ag-menu" role="menu" style="top:50px;right:14px">
        <h6>Answered on phones &middot; 8 of 8</h6>
        <p class="ag-capnote" id="capwhy"><b>This event has 8 engagements, the most one can hold.</b> Remove one to add another. Presentations can still be added up to 16 items, and breaks at any time.</p>
        <button role="menuitem" disabled aria-describedby="capwhy">{ico('survey')}<div><b>Survey</b></div></button>
        <button role="menuitem" disabled aria-describedby="capwhy">{ico('trivia')}<div><b>Trivia</b></div></button>
        <button role="menuitem" disabled aria-describedby="capwhy">{ico('call')}<div><b>Call &amp; Answer</b></div></button>
        <button role="menuitem" disabled aria-describedby="capwhy">{ico('poll')}<div><b>Poll</b></div></button>
        <button role="menuitem" disabled aria-describedby="capwhy">{ico('wave')}<div><b>Wavelength</b></div></button>
        <hr>
        <h6>Talks &middot; 6 more fit</h6>
        <button role="menuitem" class="hi">{ico('slides')}<div><b>Presentation</b><span>A talk from the presenter&rsquo;s own screen, with an optional PDF copy for attendees.</span></div></button>
        <hr>
        <h6>Just on the agenda</h6>
        <button role="menuitem">{ico('clock')}<div><b>Break</b><span>A return time on the agenda and a countdown on the wall. Not counted.</span></div></button>
      </div>"""
    body = f"""
    {ev_head('agenda', '<button class="btn">' + ico('play') + 'Rehearse on the stage</button>', n_items=counted(CAP_AGENDA))}
    <div class="work-body">
      {FACTS}
      <div style="position:relative">
        <section class="panel"><header><h2>Agenda</h2><p class="note">The host starts each item. Times are the plan, not a timer.</p>
          <span class="grow"></span><button class="btn primary" aria-expanded="true" aria-haspopup="menu">{ico('plus')}Add item</button></header>
          <div class="body flush">{agenda_table(CAP_AGENDA, CAP_ENDS)}</div></section>
        {capmenu}
      </div>
    </div>
{anno("The same agenda, two engagements later", "A poll and a wavelength have been added, so the event holds 10 items and 8 engagements. The foot says so, and names the limit once.")}
{anno("Disabled, with the reason", "The five engagement kinds stay in the menu, disabled, so the host sees what exists. The reason sits above them at full contrast, not in a tooltip, and each button points to it (<code>aria-describedby</code>). The one-line descriptions are dropped: they describe choices that cannot be made right now.")}
{anno("Presentation stays open", "Presentations fill the rest of the 16. The group header says how many more fit, so a host planning a long day knows before uploading.")}
{anno("The way out is on the table", "Remove any engagement row and the kinds come back. Nothing in this state needs a dialog.")}
{anno("Why caps at all", "One event a month is included and each after is $1 (decision 12), so an event must not stand in for a month of sessions. Eight engagements is a very full day, sixteen items a long one.")}
"""
    write("02b-cap-reached.html", console_page(f"{TITLE} — agenda at the cap", body, back="Events"), group="console")

    # ------------------------------------------------------ 03 add engagement --
    builder_bg = f"""
    {ev_head('agenda', '<button class="btn">' + ico('play') + 'Rehearse on the stage</button>')}
    <div class="work-body" style="filter:blur(1.5px);opacity:.5" aria-hidden="true">{FACTS}
      <section class="panel"><header><h2>Agenda</h2></header><div class="body flush">{agenda_table()}</div></section></div>"""
    sets = [
        (True, "Customer knowledge — Q4", "v3", "latest", 10, "12 Sep", ""),
        (False, "FY27 plan — check-in", "v1", "latest", 8, "Never run", '<span class="chip warn">On this agenda &middot; 6</span>'),
        (False, "Pricing Mechanics", "v4", "latest", 10, "2 Sep", ""),
        (False, "Product trivia — onboarding", "v2", "latest", 15, "28 Aug", ""),
        (False, "Know your region: EMEA", "v1", "latest", 12, "Never run", ""),
    ]
    prow = "".join(
        f'<tr aria-selected="{"true" if sel else "false"}"><td class="r"><input type="radio" name="set"{" checked" if sel else ""} aria-label="{nm}"></td>'
        f'<td><span class="nm">{nm}</span></td><td><span class="ag-ver">{v} &middot; {lt}</span></td>'
        f'<td class="num">{q}</td><td class="when">{when}</td><td>{chip}</td></tr>'
        for sel, nm, v, lt, q, when, chip in sets)
    body = builder_bg + f"""
    <div class="scrim ag-scrim">
      <div class="modal ag-modal wide" role="dialog" aria-labelledby="at-t">
        <header><div><h2 id="at-t">Add trivia</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">Pick the set. It plays as its own round of trivia, started by you, with the event&rsquo;s code.</p></div>
          <button class="btn ghost sm ag-x" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="field ag-step"><span class="lab">Question set &middot; trivia sets in Northwind Traders</span>
            <div class="filters" style="padding:0 0 8px"><div class="search">{ico('search')}<input class="inp" placeholder="Search trivia sets"></div></div>
            <div class="ag-pick"><table class="tbl"><thead><tr><th style="width:34px" aria-label="Pick"></th><th>Set</th><th style="width:110px">Plays</th>
              <th class="num" style="width:50px">Qs</th><th style="width:100px">Last run</th><th style="width:170px"></th></tr></thead><tbody>{prow}</tbody></table></div></div>
          <div class="ag-grid ag-step">
            <div class="field span2"><label for="at-n">Title on the agenda</label><input class="inp" id="at-n" value="How well do you know our customers?"></div>
            <div class="field"><label for="at-l">Planned length</label><div class="ag-len"><input class="inp" id="at-l" value="15"><span class="dim">min</span></div></div>
            <div class="field"><label for="at-p">Goes after</label><select class="inp" id="at-p"><option>2 &middot; FY26 in review</option></select></div>
          </div>
          <div class="field ag-step"><label for="at-d">Description <span class="dim" style="font-weight:400">&middot; on the agenda, before and during the event</span></label>
            <textarea class="inp ag-desc" id="at-d">Ten questions about the customers we serve. Scored, fastest right answer wins.</textarea></div>
          <p class="ag-hint">The title and description are what the room and the phones see. The set&rsquo;s own name stays in the console. Ten questions usually take 12&ndash;16 minutes with the reveal.</p>
        </div>
        <footer><button class="btn">Close</button><span class="grow"></span><button class="btn primary">Add to agenda</button></footer>
      </div>
    </div>
{anno("Only sets of the type you chose", "The add menu picked Trivia, so only trivia sets are offered. One type per item is what lets every item be a plain session &mdash; <code>update-game.js:28-32</code> refuses to change a session's type or set, and nothing here asks it to.")}
{anno("What plays is what you see", "&lsquo;v3 &middot; latest&rsquo; is the version that will be pinned. It stays pinned if the set changes later; the builder then offers <b>Use v4</b> on the row.")}
{anno("A duplicate is allowed, and said", "&lsquo;On this agenda &middot; 6&rsquo; stops a set going in twice by accident without forbidding it (a quiz before and after a talk is a real pattern).")}
{anno("Never a modal from a modal", "The add menu is a popover, so this is the only dialog. A presentation's uploader is its own dialog for the same reason.")}
{anno("A description for the agenda", "Decision 11: before the day people can open the agenda and read what each item is. Nothing can be answered until the host starts the item on the day. The description is the item's, not the set's, so the same set can be introduced differently at two events.")}
{anno("The cap is checked again on Add", "The menu only opens this dialog below 8 engagements. If a co-host fills the last place meanwhile, Add is refused with the menu's own sentence (&lsquo;This event has 8 engagements, the most one can hold&rsquo;) and the choices here are kept.")}
"""
    write("03-add-item.html", console_page("Add trivia", body, back="Events"), group="console")

    # ------------------------------------------------------ 04 add a presentation
    # Owner, 23 Sep (decision 8): the presenter presents from their own
    # presentation mode. The PDF is only a reference copy for attendees.
    body = builder_bg + f"""
    <div class="scrim ag-scrim">
      <div class="modal ag-modal" role="dialog" aria-labelledby="up-t">
        <header><div><h2 id="up-t">Add a presentation</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">A talk given from the presenter&rsquo;s own screen. While it runs, phones say &ldquo;look up&rdquo;.</p></div>
          <button class="btn ghost sm ag-x" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="ag-grid ag-step">
            <div class="field span4"><label for="up-n">Title on the agenda</label><input class="inp" id="up-n" value="The FY27 plan"></div>
            <div class="field span2"><label for="up-w">Presenter</label><input class="inp" id="up-w" value="Marcus Oyelaran"></div>
            <div class="field span2"><label for="up-p">Goes after</label><select class="inp" id="up-p"><option>4 &middot; What&rsquo;s slowing us down?</option></select></div>
            <div class="field"><label for="up-l">Planned length</label><div class="ag-len"><input class="inp" id="up-l" value="35"><span class="dim">min</span></div></div>
            <div class="field span4"><label for="up-d">Description <span class="dim" style="font-weight:400">&middot; on the agenda, before and during the event</span></label>
              <textarea class="inp ag-desc" id="up-d">The plan for next year, the three bets in it, and what changes for your team.</textarea></div>
          </div>
          <div class="field ag-step"><span class="lab">A copy for attendees <span class="dim" style="font-weight:400">&middot; optional</span></span>
            <div class="ag-file">{ico('file')}<span class="nm" title="fy27-plan-v6.pdf">fy27-plan-v6.pdf</span>
              <span class="dim">8.4 MB &middot; 31 pages</span><button class="btn sm ghost">Remove</button></div>
            <label class="ag-switch"><input type="checkbox" checked><span><b>Attendees can open this copy</b>
              <span class="dim">From their agenda, from the moment you start this talk on the day. Never before. Off: it stays in the console.</span></span></label>
          </div>
          <p class="ag-hint">A PDF, up to 25 MB. Nothing here is shown on the main screen &mdash; the presenter runs the talk from their own slides. PowerPoint, Keynote and Google Slides all save as PDF.</p>
        </div>
        <footer><button class="btn">Close</button><span class="grow"></span><button class="btn primary">Add to agenda</button></footer>
      </div>
    </div>
{anno("Engage does not show the slides", "Owner, 23 Sep: &lsquo;for now we will assume the slides are being shared via their own preso mode. the only share is the copy for others to have and reference.&rsquo; So there is no slide viewer, no page rendering and no next-slide control. The presentation item holds the stage (s-02) while the presenter's laptop does the talk.")}
{anno("A reference copy, and optional", "A talk with no PDF is a complete item. With one, attendees can open it from their agenda (p-06, p-08) &mdash; on by default, per deck, and only once the host has started the talk (decision 11): the agenda before the day shows the description, not the slides. 31 pages is read from the PDF on the server; nothing else is extracted.")}
{anno("Encrypted like a saved report", "Owner, 23 Sep (decision 5): decks are app-encrypted per organisation, exactly as saved reports are &mdash; the org envelope <code>save-report.js</code> writes as <code>.pdf.enc</code> (<code>:82-94</code>) and <code>download-saved-report.js</code> opens through a Lambda. Never the public media bucket (<code>template-clean.yaml:4834-4844</code>).")}
{anno("PDF, decided", "Owner, 23 Sep: &lsquo;pdf would be the default way for now.&rsquo; Converting .pptx stays out of every phase. The hint says every deck tool saves as PDF rather than refusing a .pptx with no way forward.")}
{anno("Why 25 MB", "The upload goes to a private staging key by presigned PUT, then a Lambda seals it into the org envelope &mdash; an API request body stops at 10 MB. 25 MB keeps that seal well inside one Lambda.")}
"""
    write("04-add-presentation.html", console_page("Add a presentation", body, back="Events"), group="console")

    # ------------------------------------------------------ 06 invitations -----
    people = [
        ("Priya Raman", "priya.raman@northwind.example", '<span class="chip on"><span class="dot"></span>Joined 8:52 &middot; 1 phone</span>', '<button class="btn sm ghost">New passcode</button>'),
        ("Tomás Ferreira", "", '<span class="chip on"><span class="dot"></span>Joined 8:55 &middot; 1 phone</span>', '<button class="btn sm ghost">New passcode</button>'),
        ("Aleksandra Wiśniewska", "a.wisniewska@northwind.example", '<span class="chip">Not joined yet</span>', '<button class="btn sm ghost">New passcode</button>'),
        ("Dev Malhotra", "dev.malhotra@northwind-partners.example", '<span class="chip warn">Replaced 8:41 &middot; not joined</span>', '<button class="btn sm ghost">New passcode</button>'),
        ("Kwame Asante", "", '<span class="chip">Not joined yet</span>', '<button class="btn sm ghost">New passcode</button>'),
        ("Grace O&rsquo;Connell", "grace.oconnell@northwind.example", '<span class="chip">Not joined yet</span>', '<button class="btn sm ghost">New passcode</button>'),
    ]
    trs = "".join(
        f'<tr><td><span class="nm">{nm}</span><span class="sub"{f" title={chr(34)}{em}{chr(34)}" if em else ""}>{em or "No email kept"}</span></td><td>{st}</td>'
        f'<td><div class="rowact" style="opacity:1">{act}<button class="btn sm ghost" aria-label="More for {nm}">&hellip;</button></div></td></tr>'
        for nm, em, st, act in people)
    fresh = [("Hannah Lindqvist", "K7Q XPM"), ("Mateo Ruiz", "R4W J9C")]
    frows = "".join(
        f'<tr><td><span class="nm">{nm}</span></td><td><span class="ag-pass">{pc}</span></td>'
        f'<td><div class="rowact" style="opacity:1"><button class="btn sm">{ico("copy")}Copy link</button></div></td></tr>'
        for nm, pc in fresh)
    body = f"""
    {ev_head('invites', '<button class="btn">' + ico('upload') + 'Import names (CSV)</button>')}
    <div class="work-body">
      <div class="ag-two">
        <section class="panel"><header><h2>People</h2><p class="note">Thu 9 Oct, 8:56 &middot; doors open</p></header>
          <div class="body">
            <div class="ag-paste"><div class="field"><label for="iv-p">Add people</label>
              <textarea class="inp" id="iv-p" placeholder="One per line: a name, or Name &lt;email&gt; for your own records"></textarea></div>
              <div class="acts" style="padding-top:22px"><button class="btn">{ico('plus')}Add and make passcodes</button></div></div>
            <div class="ag-fresh" role="region" aria-labelledby="fr-t">
              <p id="fr-t"><b>2 passcodes made &mdash; shown once, now.</b> After this screen only a fingerprint of each is kept. Hand them out now; a lost one can only be replaced.</p>
              <table class="tbl ag-inv"><tbody>{frows}</tbody></table>
              <div class="acts"><button class="btn">{ico('copy')}Copy both</button><button class="btn">{ico('download')}Download CSV</button><button class="btn primary">{ico('file')}Print cards</button></div>
            </div>
          </div>
          <div class="body" style="padding-top:0">
            <div class="filters" style="padding:0 0 10px"><div class="search">{ico('search')}<input class="inp" placeholder="Name or email"></div>
              <div class="seg" role="group" aria-label="Show"><button aria-pressed="true">All <span class="dim">42</span></button><button aria-pressed="false">Joined <span class="dim">12</span></button>
                <button aria-pressed="false">Not joined <span class="dim">30</span></button></div></div>
            <table class="tbl ag-inv"><thead><tr><th>Person</th><th style="width:230px">Status</th><th style="width:170px" aria-label="Actions"></th></tr></thead>
              <tbody>{trs}</tbody>
              <tfoot><tr><td colspan="3" class="dim" style="font-size:var(--t-label);border-bottom:0">6 of 42 shown &middot; a passcode is never shown again after it is made</td></tr></tfoot></table>
          </div></section>
        <section class="panel"><header><h2>What each person gets</h2><p class="note">one card, eight to a page</p></header>
          <div class="body">
            <div class="ag-card">
              <div class="ag-card-t"><b>{TITLE}</b><span>Northwind Traders &middot; Thu 9 Oct, 9:00&ndash;{ENDS} &middot; {PLACE}</span></div>
              <div class="ag-card-b">
                <div class="ag-card-qr">{qr_svg()}</div>
                <dl><dt>On your phone, open</dt><dd>engage.seibtribe.us/play</dd>
                  <dt>Event code</dt><dd class="code">{CODE}</dd>
                  <dt>Your passcode &middot; Hannah Lindqvist</dt><dd class="code pc">K7Q XPM</dd></dl>
              </div>
              <p>Scanning fills both in. The passcode is yours alone: it lets one phone in as you.</p>
            </div>
            <p class="ag-hint">The CSV has one row per person &mdash; name, passcode, personal link &mdash; for your own mail merge, chat or calendar invite. Engage sends nothing.</p>
          </div></section>
      </div>
    </div>
{anno("A passcode, not an email", "Owner, 23 Sep: &lsquo;for now no email is needed, perhaps just the passcode.&rsquo; Read as: each person gets a personal passcode the host hands out; joining is the event code plus that passcode. No email is typed and none is sent. The email column is optional and only for the host's own records. If this reading is wrong, the owner can correct it in RATIONALE, decision 2.")}
{anno("Shown once", "Six characters from 30 symbols with no look-alikes (no 0/O, 1/I/L, 8/B): about 729 million. The server keeps a keyed fingerprint (HMAC with a secret key) to find the person, never the passcode. So it is shown in this strip once; after that it can only be replaced, which retires the old one.")}
{anno("Handed out however you like", "Copy, CSV or printed cards. The personal link carries the passcode after <code>#</code>, which a browser never sends to a server or in a Referer, so it never lands in a log.")}
{anno("Walk-ins", "Added on the day, they land in the same strip as everyone else did on 1 Oct: read the passcode out, or print the one card.")}
{anno("Email comes later", "Sending from Engage is approved in principle and planned for later (PLAN Phase 4). Only then could a join also ask for the email. Today the app sends no email at all (<code>invite-member.js:4-7</code>).")}
{anno("The filter is the tally", "42 / 12 / 30 are the filter's own counts, stated once, each a way in. No Sent or Bounced: nothing is sent.")}
"""
    write("06-invitations.html", console_page(f"{TITLE} — invitations", body, back="Events"), group="console")

    # ------------------------------------------------------ 07 hub ------------
    L = lambda icon, text, gone=False: f'<a class="ag-link{" gone" if gone else ""}" href="#">{ico(icon)}{text}</a>'
    REP = [("full", "Full report &middot; event default"), ("anon", "Anonymous report"), ("none", "Not shared")]
    SUR = [("res", "Results &middot; never names"), ("none", "Not shared")]
    SLD = [("sl", "Copy of the slides"), ("none", "Not shared")]

    def pick(opts, cur, label):
        o = "".join(f'<option{" selected" if k == cur else ""}>{t}</option>' for k, t in opts)
        return f'<select class="inp ag-see{" is-changed" if cur in ("anon",) else ""}" aria-label="Attendees see, {label}">{o}</select>'
    hub = [
        (1, [L("chart", "Results"), L("file", "Report (PDF)")], SUR, "res"),
        (2, [L("slides", "Slides copy (PDF)")], SLD, "sl"),
        (3, [L("file", "Report (PDF)"), L("file", "Anonymous (PDF)")], REP, "full"),
        (4, [L("file", "Report (PDF)"), L("file", "Anonymous (PDF)")], REP, "anon"),
        (5, [L("slides", "Slides copy (PDF)")], SLD, "none"),
        (6, [L("file", "Report (PDF)"), L("file", "Anonymous (PDF)")], REP, "full"),
        (7, [L("warn", "Not saved yet &middot; Save now", gone=True)], REP, "full"),
        (8, [L("chart", "Results"), L("file", "Report (PDF)")], SUR, "res"),
    ]
    trs = []
    for n, links, opts, cur in hub:
        it = ITEMS[n - 1]
        trs.append(f'<tr><td class="no">{n}</td><td><span class="nm">{it["title"]}</span><span class="sub">{TYPES[it["type"]][1]} &middot; {it["at"]}</span></td>'
                   f'<td><div class="ag-links">{"".join(links)}</div></td><td>{pick(opts, cur, it["title"])}</td></tr>')
    later = {"Tomás Ferreira": (450, 230), "Aleksandra Wiśniewska": (470, 240), "Hannah Lindqvist": (500, 270),
             "Priya Raman": (480, 220), "Kwame Asante": (360, 140)}
    full = sorted(((nm, a, b) + later[nm] for nm, a, b in DAY), key=lambda r: -sum(r[1:]))
    DAYROWS = "".join(
        f'<tr><td class="num">{i + 1}</td><td><span class="nm">{nm}</span></td><td class="num">{a}</td><td class="num">{b}</td>'
        f'<td class="num">{c}</td><td class="num">{d}</td><td class="num"><b>{a + b + c + d:,}</b></td></tr>'
        for i, (nm, a, b, c, d) in enumerate(full))
    body = f"""
    {ev_head('after', '<button class="btn">Keep reports for a year</button><button class="btn primary">' + ico('download') + 'Event report (PDF)</button>')}
    <div class="work-body">
      <div class="ag-stats">
        <div><span class="lab">Came</span><span class="v big">{JOINED}<small>of {INVITED} invited</small></span><span class="s">two of them added on the day</span></div>
        <div><span class="lab">Ran</span><span class="v">9:02&ndash;11:56</span><span class="s">13 min over the plan</span></div>
        <div><span class="lab">Items run</span><span class="v">8 of 8</span><span class="s">none skipped</span></div>
        <div><span class="lab">Kept until</span><span class="v">7 Jan 2027</span><span class="s">90 days after the event</span></div>
      </div>
      <section class="panel"><header><h2>Everything from the day</h2><p class="note">What attendees see is on their agenda page, per item.</p></header>
        <div class="ag-share">
          <span class="lab" id="sh-l">Reports for attendees</span>
          <div class="seg" role="radiogroup" aria-labelledby="sh-l"><button aria-pressed="true">Full</button><button aria-pressed="false">Anonymous</button><button aria-pressed="false">Not shared</button></div>
          <p class="ag-hint" style="margin:0">The default for every item below. <b>Anonymous</b> removes every name before the file exists: players become Player&nbsp;1&hellip;, answers Response&nbsp;1&hellip;. People were told &ldquo;with names&rdquo; when they joined, so names can be removed but not added back.</p>
        </div>
        <div class="body flush"><table class="tbl ag-hub"><thead><tr><th style="width:34px" class="num">#</th><th>Item</th><th style="width:330px">Report and files</th><th style="width:250px">Attendees see</th></tr></thead>
          <tbody>{"".join(trs)}</tbody></table></div></section>
      <section class="panel"><header><h2>The day&rsquo;s standings</h2><p class="note">points from the scored items, added up</p></header>
        <div class="body flush"><table class="tbl ag-day"><thead><tr><th style="width:44px" class="num">#</th><th>Name</th>
          <th class="num" style="width:120px">Trivia &middot; 3</th><th class="num" style="width:120px">C&amp;A &middot; 4</th><th class="num" style="width:120px">Trivia &middot; 6</th><th class="num" style="width:120px">C&amp;A &middot; 7</th><th class="num" style="width:110px">Day</th></tr></thead>
          <tbody>{DAYROWS}</tbody>
          <tfoot><tr><td colspan="7" class="dim" style="font-size:var(--t-label);border-bottom:0">5 of 38 shown &middot; surveys, talks and the break add nothing &middot; each item&rsquo;s own standings are in its report</td></tr></tfoot></table></div></section>
      <section class="panel"><header><h2>Invited, did not join</h2><p class="note">4 people</p></header>
        <div class="body" style="font-size:var(--t-body)">Kwame Asante &middot; Dev Malhotra <span class="dim">(passcode replaced 8:41)</span> &middot; Samuel Adeyemi &middot; Grace O&rsquo;Connell</div></section>
    </div>
{anno("Full by default, the owner's call", "Owner, 23 Sep: &lsquo;allow seeing full report. with an option to turn this off, so the report is not shared, or is only anonymous.&rsquo; One setting, three values: <b>Full</b> (default), <b>Anonymous</b>, <b>Not shared</b>. The event's default is chosen when it is made (05) and set here; each item can differ.")}
{anno("Anonymous is removed by the server", "When an item ends the stage saves two PDFs: today's full one, and one rendered from <code>GET /games/{id}/report?view=anonymous</code>, whose payload already has every name replaced &mdash; standings, answers, voters, a featured comment's author. Nothing is hidden with CSS, so a download can never carry a name the setting took away.")}
{anno("Names can go, not come back", "Phones said &lsquo;with names&rsquo; at join (p-01). So once anyone has joined, Full can become Anonymous or Not shared, and Not shared can become Anonymous, but nothing becomes Full that people were not told about. Item 4 (&lsquo;What's slowing us down?&rsquo;) was switched to Anonymous after the room got candid.")}
{anno("Surveys never carry names", "A survey item offers Results or Not shared: its shared results are the survey design's frozen, nameless copy whatever its Names setting (<code>survey-redesign/RATIONALE.md</code> &sect;3). A presentation's reference copy follows the switch set when it was added (04), and can be changed here.")}
{anno("Both standings, as the owner asked", "Decision 6: &lsquo;both&rsquo;. Each scored item keeps its own standings (in its report); the day's are the sum of every scored item's final points &mdash; trivia, and Call &amp; Answer's placement points. Surveys, polls, wavelength, talks and breaks add nothing. Copied onto each attendee's row when an item ends, so they outlive the 7-day sessions. The table shows names because this event's reports are Full; under Anonymous it would show Player N.")}
{anno("Keep reports for a year", "Decision 10: only the saved reports are kept for 365 days (<code>permanent/</code>, as <code>save-report.js</code> does). The event rows and reference copies still go 90 days after the event.")}
{anno("Built from saved reports", "Session rows expire 7 days after start (<code>session-ttl.js:29-30</code>). Each item keeps its <code>REPORT#</code> keys (<code>save-report.js:161-182</code>, 90 days, 365 if kept); this page reads those. Item 7's PDF did not save; the data lives 30 days (<code>create-report.js:911-916</code>), so the row offers the save rather than pretending.")}
{anno("Fix first: saving has no sign-in", "<code>POST /games/{id}/save-report</code> has no <code>Auth:</code> (<code>template-clean.yaml:2549-2556</code>) and never calls <code>callerMayDriveSession</code>. The hub must not lean on it until that is closed (PLAN 0a).")}
"""
    write("07-hub.html", console_page(f"{TITLE} — reports and files", body, back="Events"), group="console")
