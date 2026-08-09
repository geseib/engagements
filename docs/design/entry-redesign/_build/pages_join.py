"""Mockups 01–09: the root landing and the whole participant join path."""

from shell import ICONS, CODE_JS

# --------------------------------------------------------------------------
# WORST-CASE CONTENT, used everywhere. Nothing here was chosen because it fits.
#   TITLE  71 chars, an em dash and an ampersand — a real offsite name.
#   NAME   27 chars, hyphenated, two capitals mid-word — breaks naive
#          truncation and has to survive being set inside a button.
#   EMAIL  58 chars with a hyphenated domain — the string that pushes a 375px
#          viewport sideways if nothing wraps it.
# --------------------------------------------------------------------------
TITLE = "Q3 Regional Leadership Offsite &mdash; Northeast &amp; Mid-Atlantic Commercial Team"
HOST = "Dr. Alexandra Vasquez-Kowalski"
NAME = "Bartholomew Fitzgerald-Chen"
EMAIL = "alexandra.vasquez-kowalski@northeast-commercial.example.com"


def top(back=None):
    b = ""
    if back:
        b = (f'<a class="btn btn-quiet sm" href="{back[1]}" '
             f'style="padding-left:0">&larr; {back[0]}</a>')
    return f"""
<header class="pad"><div class="shell top">
  <a class="brand" href="01-root.html">Engagements <span class="env">dev</span></a>
  {b}
</div></header>"""


def foot(host_link=True):
    """The root page already carries a Host sign in button in its own column.
    Repeating it in the footer states one fact twice in one viewport, which
    the host spec bans for good reason, so the root passes host_link=False."""
    extra = '<a href="10-signin.html">Host sign in</a>' if host_link else ''
    return f"""
<footer class="pad"><div class="shell foot">
  <nav class="footlinks">
    <a href="#">Privacy</a><a href="#">Terms</a>{extra}
  </nav>
</div></footer>"""


FOOT = foot()


def codeblock(value="", err=None, note=None, submit="Join", cid="code"):
    cells = "".join(
        f'<div class="cell{" filled" if i < len(value) else ""}'
        f'{" next" if i == len(value) and not err else ""}">{value[i] if i < len(value) else ""}</div>'
        for i in range(4))
    return f"""
      <div class="codewrap{' err' if err else ''}" data-code>
        <div class="cells" aria-hidden="true">{cells}</div>
        <input id="{cid}" name="{cid}" type="text" inputmode="numeric" pattern="[0-9]*"
               maxlength="4" autocomplete="off" autocorrect="off" spellcheck="false"
               autofocus aria-label="Session code, 4 digits" value="{value}">
      </div>
      <p class="hint" id="codesay" role="status" aria-live="polite">{note or ''}</p>
      <button class="btn btn-primary" data-code-submit {'' if len(value) == 4 else 'disabled'}
              style="margin-top:14px">{submit}</button>"""


def sess(code="4821", extra=None):
    return f"""
    <div class="sess">
      <div class="code">{code}</div>
      <div>
        <p class="ttl">{TITLE}</p>
        <p class="meta" style="margin-top:5px">Hosted by {HOST}{extra or ''}</p>
      </div>
    </div>"""


# ===========================================================================
# 01 — THE ROOT PAGE
# ===========================================================================
P01 = ("Join a session — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad center"><div class="shell split">

    <section class="join">
      <p class="kicker">Join a session</p>
      <h1 style="margin-top:10px">Enter the 4&#8209;digit code</h1>
      <p class="muted" style="margin-top:12px;max-width:32ch">
        It is on the screen at the front of the room.</p>

      <form class="codeblock" style="margin-top:24px" onsubmit="return false">
        <label class="label" for="code" style="display:block;margin-bottom:9px">Session code</label>
        {codeblock()}
      </form>

      <p class="meta phoneonly" style="margin-top:18px;max-width:40ch">
        Scanning the QR code on screen skips this step. No account, no app.</p>
    </section>

    <aside class="host">
      <p class="kicker">Running a session</p>
      <h2 style="margin-top:10px">Host sign in</h2>
      <p class="muted" style="margin-top:10px;font-size:var(--t-label);max-width:34ch">
        For people who create and run sessions.</p>
      <div class="stack s12" style="margin-top:18px">
        <a class="btn btn-ghost" href="10-signin.html">Sign in</a>
        <a class="btn btn-quiet" href="11-register.html">Create a host account</a>
      </div>
    </aside>

  </div></main>
{foot(host_link=False)}
</div>""", "", CODE_JS)


# ===========================================================================
# 02 — THE NAME BEAT. Doubles as the confirmation that the code was right.
# ===========================================================================
P02 = ("Joining — Engagements", f"""
<div class="page">
{top(("Change code", "01-root.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    {sess(extra=" &middot; round 2 of 9, already running")}

    <div>
      <h1>What should we call you?</h1>
      <p class="muted" style="margin-top:10px">Use whatever your host will recognise.</p>
    </div>

    <form class="stack s20" onsubmit="return false">
      <label class="field">
        <span class="label">Your name</span>
        <input class="input" type="text" name="name" maxlength="24"
               autocomplete="nickname" autocapitalize="words" spellcheck="false"
               value="{NAME}" aria-describedby="namehint">
        <span class="hint" id="namehint">27 of 24 characters &mdash; trim it a little.</span>
      </label>
      <button class="btn btn-primary">Join session</button>
    </form>

    <p class="meta">You are joining part-way through. You will pick up from the
      round that is running now &mdash; earlier rounds are not scored for you.</p>

  </div></main>
{FOOT}
</div>""", """
.input[aria-describedby="namehint"]{border-color:var(--primary)}
#namehint{color:var(--text)}
""", "")


# ===========================================================================
# 03 — CODE DOES NOT RESOLVE
# ===========================================================================
P03 = ("No session with that code — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad center"><div class="shell split">

    <section class="join">
      <p class="kicker">Join a session</p>
      <h1 style="margin-top:10px">Enter the 4&#8209;digit code</h1>

      <form class="codeblock" style="margin-top:22px" onsubmit="return false">
        <label class="label" for="code" style="display:block;margin-bottom:9px">Session code</label>
        {codeblock("4821", err=True, submit="Try again")}
      </form>

      <div class="notice attn codeblock" style="margin-top:18px">
        {ICONS['alert']}
        <div class="body">
          <h3>Nothing is running under 4821</h3>
          <p>Codes are different for every session, and they stop working once a
             session ends. Check the screen at the front of the room, or ask your
             host to read it out.</p>
        </div>
      </div>
    </section>

    <aside class="host">
      <p class="kicker">Running a session</p>
      <h2 style="margin-top:10px">Host sign in</h2>
      <p class="muted" style="margin-top:10px;font-size:var(--t-label);max-width:34ch">
        For people who create and run sessions.</p>
      <div class="stack s12" style="margin-top:18px">
        <a class="btn btn-ghost" href="10-signin.html">Sign in</a>
        <a class="btn btn-quiet" href="11-register.html">Create a host account</a>
      </div>
    </aside>

  </div></main>
{foot(host_link=False)}
</div>""", "", CODE_JS)


# ===========================================================================
# 04 — SESSION EXISTS BUT HAS NOT STARTED. You are held, not bounced.
# ===========================================================================
P04 = ("Waiting for your host — Engagements", f"""
<div class="page">
{top(("Use a different code", "01-root.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <span class="pill attn">{ICONS['clock']} Not open yet</span>

    <div>
      <h1>Waiting for your host</h1>
      <p class="muted" style="margin-top:12px">
        This session has not been opened yet. Keep this page open &mdash; you go
        straight in the moment it starts.</p>
    </div>

    {sess()}

    <div class="notice">
      {ICONS['spin']}
      <div class="body">
        <h3>Checking every few seconds</h3>
        <p>Last checked 3 seconds ago. We will join you as
           <strong class="wrapany">{NAME}</strong>.</p>
      </div>
    </div>

    <div class="stack s12">
      <button class="btn btn-ghost">Check now</button>
      <a class="btn btn-quiet" href="01-root.html">Use a different code</a>
    </div>

    <p class="meta">Nothing is reserved for you yet &mdash; your place is taken
      when the session opens, not now.</p>

  </div></main>
{FOOT}
</div>""", ".pill .ico{width:16px;height:16px}", "")


# ===========================================================================
# 05 — SESSION HAS ENDED.  Blocked on a server change; see RATIONALE §7.
# ===========================================================================
P05 = ("Session has ended — Engagements", f"""
<div class="page">
{top(("Use a different code", "01-root.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <span class="pill">Ended</span>

    <div>
      <h1>This session has finished</h1>
      <p class="muted" style="margin-top:12px">
        It closed at 4:52&#8202;pm. There is nothing left to join.</p>
    </div>

    {sess(extra=" &middot; 9 rounds, 34 people")}

    <div class="stack s12">
      <a class="btn btn-ghost" href="01-root.html">Enter a different code</a>
    </div>

    <p class="meta">Your host can send round the summary from their end. We do
      not have a copy to give you here.</p>

  </div></main>
{FOOT}
</div>""", "", "")


# ===========================================================================
# 06 — PRIVATE SESSION: the access-code beat, and getting it wrong.
# ===========================================================================
P06 = ("Access code needed — Engagements", f"""
<div class="page">
{top(("Change code", "01-root.html"))}
  <main class="grow pad"><div class="shell" style="padding-block:8px">
    <div class="panels">

      <div class="panel"><div class="cap">Asking &mdash; <b>first time</b></div>
      <div class="in"><div class="stack s20">
        <span class="pill">{ICONS['lock']} Private</span>
        <div>
          <h1>This session is private</h1>
          <p class="muted" style="margin-top:10px">Your host will have given you
            an access code &mdash; it is separate from the 4&#8209;digit session code.</p>
        </div>
        {sess()}
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Access code</span>
            <input class="input" type="text" name="access" autocomplete="off"
                   autocapitalize="none" autocorrect="off" spellcheck="false"
                   placeholder="From your host">
          </label>
          <button class="btn btn-primary">Join session</button>
        </form>
        <p class="meta">Joining as <strong class="wrapany">{NAME}</strong>.</p>
      </div></div></div>

      <div class="panel"><div class="cap">Rejected &mdash; <b>wrong code</b></div>
      <div class="in"><div class="stack s20">
        <span class="pill">{ICONS['lock']} Private</span>
        <div>
          <h1>This session is private</h1>
        </div>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Access code</span>
            <input class="input bad" type="text" name="access2" autocomplete="off"
                   autocapitalize="none" autocorrect="off" spellcheck="false"
                   value="northeast-q3-2026">
          </label>
          <div class="notice attn">
            {ICONS['alert']}
            <div class="body">
              <h3>That access code was not accepted</h3>
              <p>Codes are case sensitive. Attempt 2.</p>
            </div>
          </div>
          <button class="btn btn-primary">Try again</button>
          <a class="btn btn-quiet" href="01-root.html">Use a different session code</a>
        </form>
        <p class="meta">Your name is still <strong class="wrapany">{NAME}</strong>
          &mdash; going back does not clear it.</p>
      </div></div></div>

    </div>
  </div></main>
{FOOT}
</div>""", ".pill .ico{width:16px;height:16px}", "")


# ===========================================================================
# 07 — NAME COLLISION. The server keys a player on their name, so two people
#      with the same name are one player. This screen is the only thing
#      standing between that fact and a merged scoreline.
# ===========================================================================
P07 = ("That name is taken — Engagements", f"""
<div class="page">
{top(("Change code", "01-root.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    {sess()}

    <div>
      <h1>Someone here is already Chris</h1>
    </div>

    <div class="notice attn">
      {ICONS['person']}
      <div class="body">
        <h3>Two people cannot share a name in one session</h3>
        <p>If that Chris is you coming back, carry on &mdash; you will pick up
           your answers and your score. If it is not you, add something so your
           host can tell you apart.</p>
      </div>
    </div>

    <form class="stack s20" onsubmit="return false">
      <label class="field">
        <span class="label">Your name</span>
        <input class="input bad" type="text" name="name" maxlength="24" value="Chris"
               autocomplete="nickname" autocapitalize="words" spellcheck="false">
      </label>
      <div class="chips">
        <button type="button" class="chip">Chris B.</button>
        <button type="button" class="chip">Chris (Ops)</button>
        <button type="button" class="chip">Chris &mdash; Northeast</button>
      </div>
      <button class="btn btn-primary">Join as Chris B.</button>
      <button type="button" class="btn btn-ghost">That Chris is me &mdash; rejoin</button>
    </form>

  </div></main>
{FOOT}
</div>""", "", "")


# ===========================================================================
# 08 — THE NETWORK FAILED. Not the participant's fault, and the copy says so.
# ===========================================================================
P08 = ("Could not reach the session — Engagements", f"""
<div class="page">
{top(("Change code", "01-root.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <span class="pill">{ICONS['wifi']} No answer</span>

    <div>
      <h1>We could not reach the session</h1>
      <p class="muted" style="margin-top:12px">
        The code you typed looks fine. Either your connection dropped or we are
        having a problem &mdash; we cannot tell which from here.</p>
    </div>

    <div class="card">
      <dl class="dl">
        <dt>Code</dt><dd>4821</dd>
        <dt>Name</dt><dd class="wrapany">{NAME}</dd>
        <dt>Tried</dt><dd>3 times, last at 2:14&#8202;pm</dd>
      </dl>
    </div>

    <div class="stack s12">
      <button class="btn btn-primary">Try again</button>
      <a class="btn btn-quiet" href="01-root.html">Use a different code</a>
    </div>

    <p class="meta">Your code and name are kept on this device, so reloading
      will not lose them.</p>

  </div></main>
{FOOT}
</div>""", ".pill .ico{width:16px;height:16px}", "")


# ===========================================================================
# 09 — REJOIN after closing the tab mid-session.
# ===========================================================================
P09 = ("Welcome back — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <div>
      <p class="kicker">You were here before</p>
      <h1 style="margin-top:10px">Welcome back</h1>
    </div>

    {sess(extra=" &middot; round 4 of 9, running now")}

    <div class="card">
      <p class="label" style="margin-bottom:6px">You joined this session as</p>
      <p class="wrapany" style="font-weight:700;font-size:var(--t-title)">{NAME}</p>
      <p class="meta" style="margin-top:8px">3 answers in. Your score comes back with you.</p>
    </div>

    <div class="stack s12">
      <button class="btn btn-primary" style="text-align:center">
        <span class="wrapany">Rejoin as {NAME}</span></button>
      <button class="btn btn-ghost">Join as someone else</button>
    </div>

    <p class="meta">If the session has ended since you left, we will say so
      rather than dropping you into an empty room.</p>

  </div></main>
{FOOT}
</div>""", ".btn-primary span{overflow-wrap:anywhere}", "")


PAGES = {
    "01-root.html": P01,
    "02-join-identity.html": P02,
    "03-join-unknown-code.html": P03,
    "04-join-not-started.html": P04,
    "05-join-ended.html": P05,
    "06-join-private.html": P06,
    "07-join-name-collision.html": P07,
    "08-join-offline.html": P08,
    "09-join-rejoin.html": P09,
}
