# -*- coding: utf-8 -*-
"""
The multi-tenant screens. Content is deliberately concrete — a real-looking
team with real-looking numbers — because a mockup full of "Lorem" or "Team A"
cannot be judged for density, truncation or tone.

The worked example throughout: NORTHWIND LEARNING, a small training outfit on
the $5 Team plan with three hosts. In the month shown they have run 20 sessions
and stored 2 sets, which is the example the owner gave: $5 + $0 + $3.75 = $8.75.
"""

def ico(name, cls="ico"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-{name}"/></svg>'

def anno(top, left, kind, text, width=300):
    return (f'<aside class="anno" style="top:{top}px;left:{left}px;max-width:{width}px">'
            f'<b>{kind}</b>{text}</aside>')

def chip(text, cls=""):
    return f'<span class="chip {cls}">{text}</span>'

# ---------------------------------------------------------------- the nav --
# Grouped, and the grouping is the argument: "Your team" is content and people
# inside ONE org; "Engage" is the platform, and it contains no content section
# at all. After the split a platform admin cannot open an org's sets, sessions
# or reports without a logged, expiring grant — so there is nothing to link to.
NAV_ORG = [
    ("Northwind Learning", [
        ("sets",     "books",   "Question sets", 3),
        ("sessions", "play",    "Sessions",      20),
        ("library",  "globe",   "Public library", None),
        ("prompts",  "sparkle", "Prompts",       6),
    ]),
    ("Team", [
        ("team",    "users",  "Members",       "!2"),
        ("billing", "card",   "Plan & usage",  None),
        ("privacy", "shield", "Data & privacy", None),
    ]),
]

# A space of your own. NO Members section — there is nobody to manage, and a
# section that exists only to say "just you" is a section you stop looking at.
# The counts are the SAME NUMBERS the meter on 12-personal-limit.html shows;
# an earlier cut had the nav and the invoice disagreeing with nothing on screen
# to explain the gap, which reads as a bug in the bill.
NAV_PERSONAL = [
    ("Your space", [
        ("sets",     "books",   "Question sets", 3),
        ("sessions", "play",    "Sessions",      5),
        ("library",  "globe",   "Public library", None),
    ]),
    ("Account", [
        ("billing", "card",   "Plan & usage",   None),
        ("privacy", "shield", "Data & privacy", None),
    ]),
]

NAV_PLATFORM = [
    ("Engage", [
        ("orgs",       "building", "Organisations", 47),
        ("moderation", "flag",     "Moderation",    "!5"),
        ("users",      "users",    "Accounts",      312),
        ("archive",    "package",  "Archive",       None),
    ]),
]

ORG_CHIP_CLOSED = (
    '<div class="orgwrap"><button class="orgchip"><span class="oi">NW</span>'
    '<span>Northwind Learning</span>'
    f'<span class="car">{ico("down")}</span></button></div>')

ORG_CHIP_OPEN = (
    '<div class="orgwrap">'
    '<button class="orgchip"><span class="oi">NW</span>'
    '<span>Northwind Learning</span>'
    f'<span class="car">{ico("down")}</span></button>'
    '<div class="orgmenu">'
    '  <h6>Your organisations</h6>'
    '  <button class="om" aria-current="true"><span class="oi">NW</span>'
    '    Northwind Learning<span class="rl">Admin</span></button>'
    '  <button class="om"><span class="oi">HC</span>'
    '    Halcyon Coaching<span class="rl">Member</span></button>'
    '  <button class="om"><span class="oi">AR</span>'
    '    Amara Reyes<span class="rl">Personal</span></button>'
    '  <div class="sep"></div>'
    f'  <button class="om add">{ico("plus")}Create an organisation</button>'
    '</div></div>')

ORG_CHIP_SINGLE = ('<span class="orgchip single"><span class="oi">NW</span>'
                   '<span>Northwind Learning</span></span>')

PLATFORM_CHIP = ('<span class="orgchip single" style="border-style:solid">'
                 f'<span class="oi" style="color:var(--secondary)">{ico("shield")}</span>'
                 '<span>Engage staff</span></span>')


# ======================================================== 01 org switcher ==
_SETS_ROWS = "".join(f"""      <tr>
        <td><b>{n}</b><br><span class="dim" style="font-size:var(--t-label)">{d}</span></td>
        <td>{o}</td>
        <td>{chip(t, "type")}</td>
        <td class="tnum">{q}</td>
        <td>{v}</td>
      </tr>""" for n, d, o, t, q, v in [
    ("Onboarding — week one", "What we expect people to know by Friday",
     chip("Northwind", "solid"), "Trivia", 40, chip("Private", "priv")),
    ("Retro prompts, delivery team", "Sprint retrospective, blameless framing",
     chip("Northwind", "solid"), "Call &amp; answer", 18, chip("In review", "review")),
    ("Pricing mechanics", "Which lever moved the number, and why",
     chip("Engage library"), "Call &amp; answer", 24, chip("Everyone", "pub")),
    ("Blameless retrospective starters", "by Meridian Delivery &middot; copied 412 times",
     chip("Public"), "Call &amp; answer", 24, chip("Everyone", "pub")),
    ("Safety walkthrough", "Site induction, contractors",
     chip("Northwind", "solid"), "Trivia", 30, chip("Needs changes", "changes")),
])

SWITCHER_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1>
        <p class="sub"><b>3 of your own</b>, plus 9 from the shared libraries.
          Only your own are private, and only your own count towards storage.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn">{ico('plus')} New set</button>
      </div>
    </div>

    <div class="work-body">
      <table class="tbl">
        <thead><tr>
          <th style="width:34%">Set</th><th style="width:17%">Whose</th>
          <th style="width:17%">Format</th><th style="width:12%">Questions</th>
          <th style="width:20%">Who can see it</th>
        </tr></thead>
        <tbody>
{_SETS_ROWS}
        </tbody>
      </table>
    </div>

{anno(4, 700, "The switcher is in the topbar, not the nav", "The left nav lists places <i>inside</i> one organisation. The switcher changes which organisation those places belong to &mdash; a different axis, so a different spot. It sits beside the environment chip because both answer the same question: <i>which world am I looking at?</i>")}
{anno(160, 700, "One org, no menu", "A user who belongs to a single organisation gets the same chip without a caret and without a menu. A control whose menu has one item teaches people to ignore the control.", 290)}
{anno(300, 700, "Two numbers that look wrong together, and are not", "The nav says <b>3</b> and the billing meter says <b>3 of 5</b>, but this list has five rows. Sets from the Engage library and the public library are <i>readable</i> by every team and <i>stored</i> by none, so they cost nothing and are not counted. An earlier cut said &ldquo;12&rdquo; in the nav against &ldquo;2 of 5&rdquo; on the invoice with nothing explaining the gap &mdash; which reads as a bug in the bill.", 290)}
{anno(440, 700, "Whose, before what", "The second column is what tells the free rows from the billed ones at a glance. Without it, the only way to know whether a set counts against your plan is to open it.", 290)}
"""

# =============================================================== 02 team ==
def _member(initials, name, email, role, joined, acts):
    return f"""      <tr>
        <td><div class="person"><span class="avatar-sm">{initials}</span>
          <span class="pn"><b>{name}</b><span>{email}</span></span></div></td>
        <td>{role}</td>
        <td class="dim">{joined}</td>
        <td><div class="rowacts">{acts}</div></td>
      </tr>"""

_MEMBERS = "".join([
    _member("AR", "Amara Reyes", "amara.reyes@northwind.example",
            chip("Owner", "warn"), "Feb 2026",
            '<span class="dim" style="font-size:var(--t-label);margin-left:auto">'
            'You &middot; the last owner</span>'),
    _member("JO", "Jonah Osei", "jonah.osei@northwind.example",
            chip("Admin"), "Mar 2026",
            '<button class="btn sm">Make member</button><button class="btn sm ghost">Remove</button>'),
    _member("PK", "Priya Kaur", "priya.kaur@northwind.example",
            chip("Member"), "Apr 2026",
            '<button class="btn sm">Make admin</button><button class="btn sm ghost">Remove</button>'),
])

TEAM_BODY = f"""    <div class="work-head">
      <div><h1>Members</h1>
        <p class="sub">3 people can host for Northwind Learning. Two invitations are
          outstanding.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <button class="btn primary">{ico('plus')} Invite someone</button>
      </div>
    </div>

    <div class="work-body">
      <section class="panel">
        <header><h2>Invited, not joined yet</h2>
          <p class="note">An invitation expires after 14 days. Nothing is created
            until it is accepted.</p></header>
        <div class="body">
          <table class="tbl">
            <thead><tr><th style="width:36%">Email</th><th style="width:13%">Role</th>
              <th style="width:29%">Sent</th><th style="width:22%"></th></tr></thead>
            <tbody>
              <tr><td>dev.mensah@northwind.example</td><td>{chip("Member")}</td>
                <td class="dim">3 days ago</td>
                <td><div class="rowacts"><button class="btn sm">Resend</button>
                  <button class="btn sm ghost">Revoke</button></div></td></tr>
              <tr><td>rosa.iglesias@contractor.example</td><td>{chip("Member")}</td>
                <td class="dim">11 days ago &middot; <b class="stale">expires in 3</b></td>
                <td><div class="rowacts"><button class="btn sm">Resend</button>
                  <button class="btn sm ghost">Revoke</button></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <h4 class="secttl">Members &middot; 3</h4>
      <table class="tbl">
        <thead><tr><th style="width:40%">Person</th><th style="width:14%">Role</th>
          <th style="width:16%">Joined</th><th style="width:30%"></th></tr></thead>
        <tbody>
{_MEMBERS}
        </tbody>
      </table>

      <p class="note-box" style="margin-top:18px"><b>Roles here are not the same thing
        as an Engage account.</b> Someone can be an Admin of Northwind and a Member of
        another team with the same sign-in. Approving somebody to use Engage at all is a
        separate decision, made by Engage staff, on a screen these people never see.</p>
    </div>

{anno(4, 700, "Two lists, because they are two situations", "An outstanding invitation and a joined member need different verbs &mdash; Resend/Revoke against Make&nbsp;admin/Remove. Merging them into one table with a greyed row makes both harder to act on.")}
{anno(150, 700, "Show the expiry, not the send date alone", "&ldquo;11 days ago&rdquo; does not prompt anyone. &ldquo;expires in 3&rdquo; does. Same field, arithmetic done for the reader &mdash; the move the approval queue already makes with <i>Oldest has waited 21 days</i>.", 290)}
{anno(390, 700, "The last owner cannot be demoted", "No button, and a reason in the row rather than a disabled control. A dead button is a thing people click twice and then write in about.", 290)}
{anno(540, 700, "Say what this screen is NOT", "Team roles and Engage account approval look identical from here and are not. Stating it once, in place, is cheaper than the support thread.", 290)}
"""

# ============================================================ 03 billing ==
def meter(label, pct, incl_pct, incl_label, value, over=False):
    cls = " over" if over else ""
    # An allowance drawn at the very end of the track needs its label pulled
    # back inside, or it overhangs into the value column.
    end = " end" if incl_pct >= 96 else ""
    return f"""        <div class="meter{cls}">
          <span class="mlab">{label}</span>
          <span class="track"><span class="fill" style="width:{pct}%"></span>
            <span class="incl{end}" style="left:{incl_pct}%" data-label="{incl_label}"></span></span>
          <span class="mval">{value}</span>
        </div>"""

BILLING_BODY = f"""    <div class="work-head">
      <div><h1>Plan &amp; usage</h1>
        <p class="sub">Team plan &middot; billing period 1&ndash;31 August 2026 &middot;
          9 days left</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">Billing history</button></div>
    </div>

    <div class="work-body">
      <div class="grid2" style="align-items:start">
        <section class="panel">
          <header><h2>This period</h2>
            <p class="note">Updated as sessions run. Nothing here is a forecast.</p></header>
          <div class="body">
            <div class="meters">
{meter("Sessions run", 100, 25, "5 included", '<b class="ov">20</b> &middot; <span class="ov">15 over</span>', over=True)}
{meter("Question sets stored", 60, 100, "5 included", "<b>3</b> of 5")}
            </div>
            <p class="note-box warn" style="margin-top:18px">
              <b>You passed the included 5 sessions on 12 August.</b> Every session since
              has added $0.25. Nothing stopped, and nothing will &mdash; we do not block a
              session you are about to run in front of a room.</p>
          </div>
        </section>

        <section class="panel">
          <header><h2>What this period costs</h2></header>
          <div class="body">
            <div style="margin-bottom:16px"><span class="bignum"><span class="cur">$</span>8.75</span>
              <span class="dim" style="margin-left:8px">so far</span></div>
            <table class="calc">
              <tr><td>Team plan<span class="why">the monthly subscription</span></td>
                <td>$5.00</td></tr>
              <tr><td>Question sets<span class="why">3 stored, 5 included</span></td>
                <td>$0.00</td></tr>
              <tr><td>Sessions<span class="why">15 over the included 5, at $0.25</span></td>
                <td>$3.75</td></tr>
              <tr class="tot"><td>Total if the period ended today</td><td>$8.75</td></tr>
            </table>
            <p class="note" style="margin-top:14px">Storage is charged on the
              <b>highest</b> number of sets you held at once this period, not the number
              at the end. A set you created and deleted still counted.
              <b>Sets from the Engage library and the public library are free</b> &mdash;
              you can use as many as you like and none of them count here.</p>
          </div>
        </section>
      </div>

      <h4 class="secttl">Recent periods</h4>
      <table class="tbl">
        <thead><tr><th style="width:22%">Period</th><th style="width:16%">Sessions</th>
          <th style="width:16%">Sets held</th><th style="width:16%">Charged</th>
          <th style="width:30%"></th></tr></thead>
        <tbody>
          <tr><td>July 2026</td><td class="tnum">11</td><td class="tnum">2</td>
            <td class="tnum">$6.50</td>
            <td><div class="rowacts"><button class="btn sm ghost">Invoice</button></div></td></tr>
          <tr><td>June 2026</td><td class="tnum">4</td><td class="tnum">1</td>
            <td class="tnum">$5.00</td>
            <td><div class="rowacts"><button class="btn sm ghost">Invoice</button></div></td></tr>
        </tbody>
      </table>
    </div>

{anno(4, 700, "The included line is a notch, not the end of the bar", "A bar that fills to 100% and stops cannot show &ldquo;15 over&rdquo;. Drawing <i>5 included</i> as a rule ON the track lets the fill run past it, so the overage is a length you can see rather than a number you have to read.")}
{anno(190, 700, "Never block a session", "The one moment a hard limit would fire is the moment somebody is standing in front of a room. Overage is charged, stated, and never enforced &mdash; and the copy says so before anyone has to find out.", 290)}
{anno(340, 700, "Show the arithmetic", "Four lines that add up to the total, each naming the quantity it came from. Nobody trusts a figure they cannot reproduce, and this one is small enough to print in full.", 290)}
{anno(500, 700, "Say how storage is measured", "&ldquo;Highest held at once&rdquo; and &ldquo;count at the end&rdquo; give different bills, and only one of them is written down here. Leaving it implicit is how a $0.25 line becomes a support thread.", 290)}
"""

# ==================================================== 04 share for review ==
SHARE_BODY = f"""    <div class="work-head">
      <div><h1>Question sets</h1>
        <p class="sub"><b>3 of your own</b>, plus 9 from the Engage library and the public
          library.</p></div>
    </div>

    <div class="work-body">
      <table class="tbl">
        <thead><tr>
          <th style="width:34%">Set</th><th style="width:17%">Whose</th>
          <th style="width:17%">Format</th><th style="width:12%">Questions</th>
          <th style="width:20%">Who can see it</th>
        </tr></thead>
        <tbody>
{_SETS_ROWS}
        </tbody>
      </table>
    </div>

    <div class="scrim">
      <div class="modal" role="dialog" aria-labelledby="shr">
      <header><div><h2 id="shr">Share &ldquo;Pricing mechanics&rdquo; publicly</h2></div>
        <span class="grow"></span>
        <button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
      <div class="body">
        <p>Anyone using Engage will be able to find this set, read every question in it,
          and copy it into their own team.</p>

        <div class="note-box" style="margin:16px 0">
          <b>Every question is checked first.</b> An automated review reads the whole set
          looking for material that should not be published without a person seeing it:
          violence, sexual content, harassment, and content that targets a group. It
          usually finishes in under a minute.
        </div>

        <dl class="kv" style="margin-bottom:6px">
          <dt>If it passes</dt>
          <dd>The set appears in the public library. You can unpublish it at any time.</dd>
          <dt>If something is flagged</dt>
          <dd>Nothing is published. You get the specific questions and the reason for
            each, and you can edit and resubmit.</dd>
          <dt>If the check is unsure</dt>
          <dd>It goes to a person at Engage. You will hear back either way.</dd>
        </dl>

        <p class="note" style="margin-top:14px">Publishing copies the set. The public
          copy does not change when you edit yours, and nobody who copies it can change
          yours.</p>
      </div>
      <footer>
        <span class="grow"></span>
        <button class="btn">Cancel</button>
        <button class="btn primary">Submit for review</button>
      </footer>
      </div>
    </div>

{anno(4, 700, "Say what review is FOR, in the dialog", "&ldquo;Subject to moderation&rdquo; tells nobody anything. Naming the four categories sets an expectation that a rejection can then meet, which is what makes the rejection screen readable rather than insulting.")}
{anno(210, 700, "Three outcomes, all stated up front", "Pass, flagged, unsure. The third exists because an automated check that must answer yes or no will answer wrongly on a history trivia set that mentions a war &mdash; so it is allowed to escalate, and people are told it can.", 290)}
{anno(410, 700, "Publishing is a copy, and say so", "Shared identity would let one team's edit silently change another team's set. Copies are independent; this sentence is the whole of what a user needs to know about that decision.", 290)}
"""

# =========================================================== 05 rejected ==
REJECTED_BODY = f"""    <div class="work-head">
      <div><h1>Safety walkthrough</h1>
        <p class="sub">Trivia &middot; 30 questions &middot; {chip("Needs changes", "changes")}</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">Edit set</button>
        <button class="btn primary" disabled>Resubmit</button></div>
    </div>

    <div class="work-body">
      <div class="note-box bad">
        <b>This set was not published.</b> Two of its 30 questions were flagged on
        19 August. Nothing was shared, and your own copy is untouched &mdash; it is still
        private to Northwind Learning and still usable in your own sessions.
      </div>

      <h4 class="secttl">What was flagged</h4>
      <div class="verdict">
        <div class="vrow bad">
          <svg class="ico vi" viewBox="0 0 24 24"><use href="#i-warn"/></svg>
          <div><p class="q"><b>Q14.</b> Describe the worst injury you have seen on a
            site and what caused it.</p>
            <p class="rsn">Flagged as graphic violence. Asking a room to describe
              injuries in detail is the part that was flagged, not the safety topic.</p></div>
          <button class="btn sm">Edit Q14</button>
        </div>
        <div class="vrow bad">
          <svg class="ico vi" viewBox="0 0 24 24"><use href="#i-warn"/></svg>
          <div><p class="q"><b>Q22.</b> Which crew is usually the problem on a
            multi-trade site?</p>
            <p class="rsn">Flagged as targeting a group. The question invites an answer
              about a category of people rather than a practice.</p></div>
          <button class="btn sm">Edit Q22</button>
        </div>
        <div class="vrow ok">
          <svg class="ico vi" viewBox="0 0 24 24"><use href="#i-check"/></svg>
          <div><p class="q">The other 28 questions passed.</p>
            <p class="rsn">They are unchanged and need no attention.</p></div>
          <span></span>
        </div>
      </div>

      <p class="note-box warn" style="margin-top:18px">
        <b>Think this is wrong?</b> Ask a person to look at it. Automated review is
        deliberately cautious, and a set about safety is exactly the kind it gets wrong.
        <br><button class="btn sm" style="margin-top:9px">Ask for a human review</button>
      </p>
    </div>

{anno(4, 700, "Name the questions, quote them, give the reason", "A verdict with no route back is a dead end. Two of thirty is a five-minute edit; &ldquo;your set was rejected&rdquo; is a shrug and an abandoned feature.")}
{anno(150, 700, "Separate the topic from the treatment", "&ldquo;graphic violence&rdquo; on a workplace-safety set reads as absurd unless the reason distinguishes <i>asking people to describe injuries</i> from <i>the subject of safety</i>. Without that sentence the author concludes the checker is broken.", 290)}
{anno(330, 700, "Say what passed", "Twenty-eight fine, two to fix &mdash; that is a different feeling from a red banner, and it is the same data.", 290)}
{anno(450, 700, "An appeal, offered rather than buried", "The check is tuned to be cautious, so it will be wrong sometimes, and the product should say that itself rather than wait for someone to be annoyed enough to find support.", 290)}
"""

# ===================================================== 06 public library ==
def _pub(title, org, gtype, qs, used):
    return f"""      <tr>
        <td><b>{title}</b><br><span class="dim" style="font-size:var(--t-label)">by {org}</span></td>
        <td>{chip(gtype, "type")}</td>
        <td class="tnum">{qs}</td>
        <td class="dim">{used}</td>
        <td><div class="rowacts"><button class="btn sm">Preview</button>
          <button class="btn sm">Copy to my team</button></div></td>
      </tr>"""

LIBRARY_BODY = f"""    <div class="work-head">
      <div><h1>Public library</h1>
        <p class="sub">Sets other teams have published and had reviewed. Copying one
          makes your own copy &mdash; it does not link to theirs.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <div class="search" style="width:250px">{ico('search')}
          <input class="inp" placeholder="Search the library"></div>
      </div>
    </div>

    <div class="work-body">
      <div class="filters">
        <div class="seg"><button aria-pressed="true">All 214</button>
          <button>Call &amp; answer 96</button><button>Trivia 84</button>
          <button>Poll 21</button><button>Wavelength 13</button></div>
      </div>
      <table class="tbl">
        <thead><tr><th style="width:32%">Set</th><th style="width:15%">Format</th>
          <th style="width:11%">Questions</th><th style="width:12%">Copied</th>
          <th style="width:30%"></th></tr></thead>
        <tbody>
{_pub("Blameless retrospective starters", "Meridian Delivery", "Call &amp; answer", 24, "412 times")}
{_pub("New-hire week one", "Northwind Learning", "Trivia", 40, "180 times")}
{_pub("Estimation and confidence", "Halcyon Coaching", "Poll", 16, "96 times")}
{_pub("Where do we actually disagree?", "Meridian Delivery", "Wavelength", 12, "74 times")}
        </tbody>
      </table>

      <p class="note-box" style="margin-top:18px"><b>Your own published sets appear here
        too.</b> &ldquo;New-hire week one&rdquo; is yours &mdash; it is listed the same way
        everyone else sees it, which is the only reliable way to check what you actually
        shared.</p>
    </div>

{anno(4, 700, "Attribution, because a set is somebody's work", "The publishing team is named on every row. It is also the only signal a browser has for whether a set is likely to be any good.")}
{anno(190, 700, "&ldquo;Copied 412 times&rdquo; and not a star rating", "A count of a thing people actually did beats a rating nobody fills in, and it cannot be gamed by the four people who felt strongly.", 290)}
{anno(330, 700, "Show the author their own set as others see it", "The only reliable way to answer &ldquo;what did I actually publish?&rdquo; is to look at the published copy, in the public list, with everyone else's.", 290)}
"""

# ======================================================== 07 moderation ===
MODERATION_BODY = f"""    <div class="work-head">
      <div><h1>Moderation</h1>
        <p class="sub">5 sets the automated check would not decide on its own.
          Oldest has waited <b class="stale">2 days</b>.</p></div>
    </div>

    <div class="work-body">
      <section class="panel">
        <header><h2>Waiting for a person</h2>
          <p class="note">The check escalates rather than guessing. These are the ones
            it flagged as uncertain, not the ones it rejected.</p></header>
        <div class="body flush">
          <table class="tbl">
            <thead><tr><th style="width:26%">Set</th><th style="width:20%">Organisation</th>
              <th style="width:30%">Why it escalated</th><th style="width:11%">Waiting</th>
              <th style="width:13%"></th></tr></thead>
            <tbody>
              <tr><td><b>Conflict at work — scenarios</b><br>
                  <span class="dim" style="font-size:var(--t-label)">Call &amp; answer &middot; 18 questions</span></td>
                <td>Meridian Delivery</td>
                <td class="wrap tight dim">Harassment, low confidence (0.41)</td>
                <td class="dim">2 days</td>
                <td><div class="rowacts"><button class="btn sm">Review</button></div></td></tr>
              <tr><td><b>The Troubles — a timeline</b><br>
                  <span class="dim" style="font-size:var(--t-label)">Trivia &middot; 30 questions</span></td>
                <td>St Brendan&rsquo;s College</td>
                <td class="wrap tight dim">Violence, historical context</td>
                <td class="dim">1 day</td>
                <td><div class="rowacts"><button class="btn sm">Review</button></div></td></tr>
              <tr><td><b>Clinical handover drills</b><br>
                  <span class="dim" style="font-size:var(--t-label)">Trivia &middot; 22 questions</span></td>
                <td>Ardmore Health</td>
                <td class="wrap tight dim">Graphic medical detail</td>
                <td class="dim">4 hours</td>
                <td><div class="rowacts"><button class="btn sm">Review</button></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <p class="note-box warn" style="margin-top:18px">
        <b>Reviewing a set here shows you its questions, and that is a disclosure.</b>
        The organisation sees an entry in their own access log naming you, the set and the
        date &mdash; because they asked for it to be published, not because you looked.
        Nothing else in their account is reachable from this screen.
      </p>
    </div>

{anno(4, 700, "Escalation is a first-class outcome", "An automated check forced to answer yes or no will reject a history set about a war and a clinical set about injuries. Letting it say &ldquo;I am not sure&rdquo; is what keeps those teams as customers.")}
{anno(180, 700, "Show the confidence, not just the category", "&ldquo;Harassment&rdquo; alone reads as an accusation. &ldquo;Harassment, low confidence (0.41)&rdquo; tells the reviewer what the machine actually thought and how much weight to give it.", 290)}
{anno(400, 700, "Even the legitimate look is logged", "This is the one screen where Engage staff read a customer's content by design. It is still written to their access log, and this box says so &mdash; the guarantee is worth nothing if it has an unlogged exception.", 290)}
"""

# ============================================================ 08 privacy ==
def _log(actor, cls, who, action, target, when, reason=None):
    """
    `wrap tight` on every cell, from shell.css, not a new rule here.

    `.tbl td` is nowrap + ellipsis by default, which is right for a dense scan
    list and wrong for this one: the reason a person gives for reading a
    customer's data IS the record, and the first cut truncated it to
    "Report shows no responses for round 3" — tic…, which is worse than
    omitting the column. The shell already carries `.wrap` (normal white-space)
    and `.tight` (auto height, tighter padding) for exactly this case.
    """
    r = f'<span class="rsn">{reason}</span>' if reason else ""
    return f"""      <tr class="logrow">
        <td class="wrap tight"><span class="actor {cls}"><span class="dot"></span>{who}</span>
          <br><span class="dim" style="font-size:var(--t-floor)">{actor}</span></td>
        <td class="wrap tight">{action}{r}</td>
        <td class="wrap tight">{target}</td>
        <td class="wrap tight dim">{when}</td>
      </tr>"""

PRIVACY_BODY = f"""    <div class="work-head">
      <div><h1>Data &amp; privacy</h1>
        <p class="sub">What is stored, who has read it, and how to take it away.</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{ico('package')} Export everything</button></div>
    </div>

    <div class="work-body">
      <section class="panel">
        <header><h2>Encryption</h2></header>
        <div class="body">
          <dl class="kv">
            <dt>Your content</dt>
            <dd><span class="actor"><span class="dot" style="background:var(--success)"></span></span>
              Encrypted with a key that belongs to Northwind Learning alone.
              Set names, questions, participant answers, votes, summaries and reports.</dd>
            <dt>Not encrypted</dt>
            <dd>Record identifiers, timestamps, and counts &mdash; the things needed to
              find a row at all. No content.</dd>
            <dt>Published sets</dt>
            <dd>&ldquo;Pricing mechanics&rdquo; is public, so its copy is readable by
              anyone. Your original is not.</dd>
          </dl>
          <p class="note-box" style="margin-top:16px"><b>What this does and does not
            promise.</b> Engage staff browsing the database see identifiers and ciphertext,
            not your questions. Reading them takes a decryption request that names your
            organisation and is recorded below. It is not that we cannot &mdash; it is
            that we cannot do it quietly.</p>
        </div>
      </section>

      <h4 class="secttl">Who has read your data</h4>
      <table class="tbl">
        <thead><tr><th style="width:20%">Who</th><th style="width:36%">What they did</th>
          <th style="width:26%">What it touched</th><th style="width:18%">When</th></tr></thead>
        <tbody>
{_log("Engage staff", "plat", "Dai Ferreira", "Read a set submitted for publication",
      "Retro prompts, delivery team", "6 days ago",
      "Escalated by automated review &mdash; you submitted it on 14 Aug")}
{_log("Engage staff", "plat", "Dai Ferreira", "Support access, granted by Amara Reyes",
      "Sessions from 2&ndash;3 August", "12 Aug, expired after 4 hours",
      "&ldquo;Report shows no responses for round 3&rdquo; &mdash; ticket NW-1183")}
{_log("Northwind Learning", "mem", "Jonah Osei", "Exported a session report",
      "Delivery retro, 28 July", "28 July")}
        </tbody>
      </table>
      <p class="note" style="margin-top:10px">This log cannot be edited or cleared, by you
        or by us. It is kept for the life of the organisation.</p>

      <h4 class="secttl">Leaving</h4>
      <div class="grid2">
        <div class="panel"><div class="body">
          <b>Export everything</b>
          <p class="note" style="margin-top:6px">Every set, session, response and report as
            files you keep. Available at any time, with no notice and no conversation.</p>
        </div></div>
        <div class="panel"><div class="body">
          <b>Delete this organisation</b>
          <p class="note" style="margin-top:6px">Content, sessions and reports are
            destroyed and the encryption key is deleted, which makes any remaining copy
            unreadable. Your access log survives. This cannot be undone.</p>
          <button class="btn danger sm" style="margin-top:10px">Delete Northwind Learning</button>
        </div></div>
      </div>
    </div>

{anno(4, 700, "The guarantee has to be inspectable", "A promise about data handling that a customer cannot check is a sentence in a contract. This page is the check: what is encrypted, who read it, and when.")}
{anno(215, 700, "State the limit honestly", "&ldquo;We cannot read your data&rdquo; is false while anyone holds the AWS account, and a customer who finds that out has learned something worse than the limit itself. &ldquo;We cannot do it quietly&rdquo; is true, and this log is the proof.", 290)}
{anno(430, 700, "Log OUR access and THEIR OWN in one table", "Two tables would read as a surveillance panel. One table reads as a record, and it lets an admin answer &ldquo;who exported that report?&rdquo; on the same screen.", 290)}
{anno(620, 700, "Export needs no conversation", "A retention promise is only credible if leaving is self-service. Requiring an email turns the guarantee back into a negotiation.", 290)}
"""

# ================================================= 09 platform orgs list ==
ORGS_BODY = f"""    <div class="work-head">
      <div><h1>Organisations</h1>
        <p class="sub">47 teams. This is an account and billing view &mdash; no content
          is reachable from here.</p></div>
      <span class="grow"></span>
      <div class="head-actions">
        <div class="search" style="width:230px">{ico('search')}
          <input class="inp" placeholder="Search organisations"></div>
      </div>
    </div>

    <div class="work-body">
      <table class="tbl">
        <thead><tr><th style="width:28%">Organisation</th><th style="width:12%">Plan</th>
          <th style="width:10%">Members</th><th style="width:12%">Sessions</th>
          <th style="width:12%">This period</th><th style="width:26%"></th></tr></thead>
        <tbody>
          <tr><td><div class="person"><span class="avatar-sm">NW</span>
              <span class="pn"><b>Northwind Learning</b><span>since Feb 2026</span></span></div></td>
            <td>{chip("Team")}</td><td class="tnum">3</td><td class="tnum">20</td>
            <td class="tnum">$8.75</td>
            <td><div class="rowacts"><button class="btn sm">{ico('key')} Request access</button></div></td></tr>
          <tr><td><div class="person"><span class="avatar-sm">MD</span>
              <span class="pn"><b>Meridian Delivery</b><span>since Nov 2025</span></span></div></td>
            <td>{chip("Team")}</td><td class="tnum">9</td><td class="tnum">61</td>
            <td class="tnum">$19.00</td>
            <td><div class="rowacts"><button class="btn sm">{ico('key')} Request access</button></div></td></tr>
          <tr><td><div class="person"><span class="avatar-sm">AH</span>
              <span class="pn"><b>Ardmore Health</b><span>since Jun 2026</span></span></div></td>
            <td>{chip("Team")}</td><td class="tnum">4</td><td class="tnum">3</td>
            <td class="tnum">$5.00</td>
            <td><div class="rowacts"><button class="btn sm">{ico('key')} Request access</button></div></td></tr>
        </tbody>
      </table>

      <p class="note-box" style="margin-top:18px"><b>There is no &ldquo;view their sets&rdquo;
        button, and that is the change.</b> Being an Engage administrator used to mean
        being able to open any question set in the system. It now means managing accounts,
        plans and moderation. Reading a customer&rsquo;s content takes a request with a
        reason, expires after four hours, and appears in their own log.</p>
    </div>

    <div class="scrim">
      <div class="modal" role="dialog" aria-labelledby="req">
      <header><div><h2 id="req">Request access to Northwind Learning</h2></div>
        <span class="grow"></span>
        <button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
      <div class="body">
        <div class="field"><label for="rsn">Why do you need this?</label>
          <textarea class="inp" id="rsn" rows="3">Report shows no responses for round 3 — ticket NW-1183</textarea>
          <p class="note">Both owners of Northwind Learning receive this sentence by email,
            now, and it is written to their access log whether or not you open anything.</p>
        </div>
        <div class="field" style="margin-top:14px"><label for="dur">How long</label>
          <select class="inp" id="dur"><option>1 hour</option><option selected>4 hours (maximum)</option></select>
        </div>
        <div class="note-box warn" style="margin-top:16px">Access ends when the time is up.
          There is no extension &mdash; a second request is a second entry in their log.</div>
      </div>
      <footer><span class="grow"></span>
        <button class="btn">Cancel</button>
        <button class="btn primary">Request access</button></footer>
      </div>
    </div>

{anno(4, 700, "A platform console with no content in it", "The whole isolation story fails if this screen has a &ldquo;view their sets&rdquo; button. The nav on the left has no content section at all &mdash; there is nothing here to link to.")}
{anno(210, 700, "A reason is a required field, not a courtesy", "The reason is what the customer reads in their log. Making it mandatory and free-text is what turns an audit line from &ldquo;someone looked&rdquo; into something a person can judge.", 290)}
{anno(400, 700, "Notify on REQUEST, not on read", "Emailing when the grant is created means the customer hears before anything is opened. Emailing on first read would let a grant sit unused and unmentioned.", 290)}
"""

# =========================================================== 10 first run ==
FIRSTRUN_BODY = f"""    <div class="work-head">
      <div><h1>Welcome, Amara</h1>
        <p class="sub">Your account is approved. One more thing before you can build
          anything.</p></div>
    </div>

    <div class="work-body">
      <div class="grid2" style="align-items:start;max-width:900px">
        <section class="panel">
          <header><h2>You have been invited</h2></header>
          <div class="body">
            <div class="person" style="margin-bottom:12px">
              <span class="avatar-sm">NW</span>
              <span class="pn"><b>Northwind Learning</b>
                <span>Jonah Osei invited you as a Member &middot; 3 days ago</span></span>
            </div>
            <p class="note">You will be able to see and run this team&rsquo;s question
              sets, and anything you create belongs to them.</p>
            <div style="margin-top:14px;display:flex;gap:8px">
              <button class="btn primary">Join Northwind Learning</button>
              <button class="btn ghost">Decline</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <header><h2>Or start your own</h2></header>
          <div class="body">
            <div class="field"><label for="on">Organisation name</label>
              <input class="inp" id="on" placeholder="e.g. Northwind Learning"></div>
            <p class="note" style="margin-top:10px"><b>Your own space is free</b> &mdash;
              5 sessions and 5 stored sets a month, no card. Inviting anyone makes it a
              Team: $5 a month, the same 5 included, then 25&cent; each beyond.</p>
            <button class="btn" style="margin-top:14px">Create organisation</button>
          </div>
        </section>
      </div>

      <p class="note-box" style="margin-top:20px;max-width:900px">
        <b>You can do both, and change your mind.</b> One account can belong to several
        organisations &mdash; a personal one for your own drafts, a team one for work.
        The switcher at the top right moves between them, and nothing is shared across
        them unless you publish it.</p>
    </div>

{anno(4, 700, "Two doors, not a wizard", "Joining and creating are one click each, side by side. A stepped flow here would ask somebody who was invited three days ago to answer questions about billing they do not need yet.")}
{anno(230, 700, "Price the thing before they commit", "The subscription and the two overage rates fit in one sentence. Putting them behind a &ldquo;pricing&rdquo; link is how people find out on the invoice.", 290)}
{anno(380, 700, "Say that multi-membership exists, here", "This is the only moment the concept is unavoidable, and understanding it now prevents the &ldquo;my sets disappeared&rdquo; support thread that a forgotten switcher produces.", 290)}
"""


# ================================================ 12 personal org at limit ==
PERSONAL_LIMIT_BODY = f"""    <div class="work-head">
      <div><h1>Plan &amp; usage</h1>
        <p class="sub">Your own space &middot; free &middot; August 2026</p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn primary">Create a team</button></div>
    </div>

    <div class="work-body">
      <div class="grid2" style="align-items:start">
        <section class="panel">
          <header><h2>This month</h2>
            <p class="note">A space of your own is free. These are its limits.</p></header>
          <div class="body">
            <div class="meters">
{meter("Sessions run", 100, 100, "5 included", '<b class="ov">5</b> of 5', over=True)}
{meter("Question sets stored", 60, 100, "5 included", "<b>3</b> of 5")}
            </div>
            <p class="note-box warn" style="margin-top:18px">
              <b>You have used all 5 sessions this month.</b> Your next one needs a Team,
              which is $5 a month and includes 5 sessions and 5 sets &mdash; then 25&cent;
              each beyond, with nothing ever cut off mid-session.
              <br><button class="btn sm primary" style="margin-top:10px">Create a team</button>
              <span class="dim" style="margin-left:8px;font-size:var(--t-label)">
                or wait until 1 September</span></p>
          </div>
        </section>

        <section class="panel">
          <header><h2>What a team adds</h2></header>
          <div class="body">
            <dl class="kv">
              <dt>People</dt><dd>Invite colleagues. They can run your sets and build their own.</dd>
              <dt>More of everything</dt><dd>5 sessions and 5 sets included, then 25&cent; each.
                Nothing is ever blocked once you are paying.</dd>
              <dt>Your work comes with you</dt><dd>The 3 sets you already have stay yours.
                Nothing is copied, moved or shared until you say so.</dd>
            </dl>
            <p class="note" style="margin-top:14px">$5 a month. Cancel whenever &mdash;
              your sets and reports stay, and export needs no conversation.</p>
          </div>
        </section>
      </div>

      <p class="note-box" style="margin-top:20px"><b>The session you are running right now
        is not affected.</b> A limit only ever stops you STARTING one. Nothing interrupts a
        room that is already in front of you &mdash; joining, answering, voting and results
        keep working to the end, every time.</p>
    </div>

{anno(4, 700, "The limit lands on CREATE, never on a running room", "The one moment a hard cap would fire is when somebody is standing in front of an audience. Gating session creation gets the pricing the owner chose and still honours &ldquo;nothing is ever blocked&rdquo; &mdash; the box at the bottom says so, unprompted, because a person who has just hit a wall assumes the worst.")}
{anno(210, 700, "Name the alternative to paying", "&ldquo;or wait until 1 September&rdquo; costs a sale and buys the sentence its credibility. A limit with exactly one exit reads as a toll gate.", 290)}
{anno(360, 700, "Say what happens to their work", "The single question somebody asks before upgrading is whether the three sets they already made survive it. Answering before they ask is cheaper than the support thread.", 290)}
"""

C_SETS = [("Question sets", True)]

PAGES = [
 dict(file="01-org-switcher.html", title="Switching organisation", nav="sets",
      crumbs=C_SETS, orgchip=ORG_CHIP_OPEN, body=SWITCHER_BODY),
 dict(file="02-org-single.html", title="One organisation, no menu", nav="sets",
      crumbs=C_SETS, orgchip=ORG_CHIP_SINGLE, body=SWITCHER_BODY),
 dict(file="03-team.html", title="Members and invitations", nav="team",
      crumbs=[("Members", True)], orgchip=ORG_CHIP_CLOSED, body=TEAM_BODY),
 dict(file="04-billing.html", title="Plan and usage", nav="billing",
      crumbs=[("Plan &amp; usage", True)], orgchip=ORG_CHIP_CLOSED, body=BILLING_BODY),
 dict(file="05-share-review.html", title="Sharing a set publicly", nav="sets",
      crumbs=C_SETS, orgchip=ORG_CHIP_CLOSED, body=SHARE_BODY),
 dict(file="06-share-rejected.html", title="A set that needs changes", nav="sets",
      crumbs=[("Question sets", False), ("Safety walkthrough", True)],
      orgchip=ORG_CHIP_CLOSED, body=REJECTED_BODY),
 dict(file="07-public-library.html", title="The public library", nav="library",
      crumbs=[("Public library", True)], orgchip=ORG_CHIP_CLOSED, body=LIBRARY_BODY),
 dict(file="08-privacy.html", title="Data and privacy", nav="privacy",
      crumbs=[("Data &amp; privacy", True)], orgchip=ORG_CHIP_CLOSED, body=PRIVACY_BODY),
 dict(file="09-first-run.html", title="No organisation yet", nav="",
      navkind="none", crumbs=[("Welcome", True)], orgchip="", body=FIRSTRUN_BODY),
 dict(file="10-platform-orgs.html", title="Organisations, Engage staff", nav="orgs",
      navkind="platform", crumbs=[("Organisations", True)], orgchip=PLATFORM_CHIP,
      initials="DF", email="dai.ferreira@engage.internal", body=ORGS_BODY),
 dict(file="12-personal-limit.html", title="Your own space, at its limit", nav="billing",
      navkind="personal",
      crumbs=[("Plan &amp; usage", True)],
      orgchip=('<div class="orgwrap"><button class="orgchip"><span class="oi">AR</span>'
               '<span>Amara Reyes</span>' + ico("down") + '</button></div>'),
      body=PERSONAL_LIMIT_BODY),
 dict(file="11-moderation.html", title="Moderation queue", nav="moderation",
      navkind="platform", crumbs=[("Moderation", True)], orgchip=PLATFORM_CHIP,
      initials="DF", email="dai.ferreira@engage.internal", body=MODERATION_BODY),
]
