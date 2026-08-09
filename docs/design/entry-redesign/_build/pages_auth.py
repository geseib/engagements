"""Mockups 10–17: sign in, register, verify, pending, reset, OAuth, blocked."""

from shell import ICONS
from pages_join import top, FOOT, EMAIL, HOST

PW_JS = r"""
(function(){
  var pw = document.querySelector('[data-pw]');
  if(!pw) return;
  var rules = [].slice.call(document.querySelectorAll('[data-rule]'));
  var bar = document.querySelector('.strength .bar i');
  var txt = document.querySelector('.strength .txt');
  var tests = {
    len:  function(v){ return v.length >= 8; },
    up:   function(v){ return /[A-Z]/.test(v); },
    low:  function(v){ return /[a-z]/.test(v); },
    num:  function(v){ return /\d/.test(v); },
    // Any non-alphanumeric. RegisterForm.jsx today allows only [@$!%*?&],
    // so a password containing '#' or '-' is rejected in the browser and
    // would have been accepted by Cognito. See RATIONALE.md §8.
    sym:  function(v){ return /[^A-Za-z0-9]/.test(v); }
  };
  function run(){
    var v = pw.value, hits = 0;
    rules.forEach(function(li){
      var ok = tests[li.getAttribute('data-rule')](v);
      li.classList.toggle('ok', ok);
      if(ok) hits++;
    });
    if(bar){
      bar.style.width = (v ? (hits/5*100) : 0) + '%';
      bar.style.background = hits >= 5 ? 'var(--success)'
                           : hits >= 3 ? 'var(--primary)' : 'var(--primary-deep)';
      txt.textContent = !v ? '' : hits >= 5 ? 'All five' : hits + ' of 5';
    }
  }
  pw.addEventListener('input', run); run();
  var t = document.querySelector('.pwtoggle');
  if(t) t.addEventListener('click', function(){
    var show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    t.textContent = show ? 'Hide' : 'Show';
    t.setAttribute('aria-label', (show ? 'Hide' : 'Show') + ' password');
  });
})();
"""

RULES = """
      <ul class="rules">
        <li data-rule="len"><span class="bx"></span>8 characters or more</li>
        <li data-rule="up"><span class="bx"></span>An upper-case letter</li>
        <li data-rule="low"><span class="bx"></span>A lower-case letter</li>
        <li data-rule="num"><span class="bx"></span>A number</li>
        <li data-rule="sym"><span class="bx"></span>A symbol &mdash; ! ? # $ % or any other</li>
      </ul>"""


# ===========================================================================
# 10 — SIGN IN
# ===========================================================================
P10 = ("Host sign in — Engagements", f"""
<div class="page">
{top(("Join a session instead", "01-root.html"))}
  <main class="grow pad"><div class="shell" style="padding-block:8px">
    <div class="panels">

      <div class="panel"><div class="cap">Sign in &mdash; <b>as shipped today</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <p class="kicker">Running a session</p>
          <h1 style="margin-top:10px">Host sign in</h1>
        </div>
        <button class="btn btn-social">{ICONS['google']} Continue with Google</button>
        <p class="divider">or</p>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Email</span>
            <input class="input" type="email" name="email" autocomplete="email"
                   autocapitalize="none" spellcheck="false" placeholder="you@work.com">
          </label>
          <label class="field">
            <span class="label" style="display:flex;justify-content:space-between;gap:12px">
              Password <a href="14-forgot.html" style="font-weight:600">Forgotten it?</a></span>
            <span class="pwwrap">
              <input class="input" type="password" name="password" autocomplete="current-password">
              <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <button class="btn btn-primary">Sign in</button>
        </form>
        <p class="meta">New here? <a href="11-register.html">Create a host account</a>.
          It has to be approved by an admin before you can run a session.</p>
      </div></div></div>

      <div class="panel"><div class="cap">Rejected &mdash; <b>bad credentials</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <p class="kicker">Running a session</p>
          <h1 style="margin-top:10px">Host sign in</h1>
        </div>
        <div class="notice attn">
          {ICONS['alert']}
          <div class="body">
            <h3>That password does not match
              <span class="wrapany">{EMAIL}</span></h3>
            <p>Signed up with Google? Use the Google button &mdash; there is no
               password on that account.</p>
          </div>
        </div>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Email</span>
            <input class="input bad" type="email" name="email2" autocomplete="email"
                   autocapitalize="none" spellcheck="false" value="{EMAIL}">
          </label>
          <label class="field">
            <span class="label" style="display:flex;justify-content:space-between;gap:12px">
              Password <a href="14-forgot.html" style="font-weight:600">Forgotten it?</a></span>
            <span class="pwwrap">
              <input class="input bad" type="password" name="password2"
                     autocomplete="current-password" value="wrongpassword">
              <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <button class="btn btn-primary">Sign in</button>
        </form>
      </div></div></div>

      <div class="panel"><div class="cap">Variant &mdash; <b>four providers</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <p class="kicker">Running a session</p>
          <h1 style="margin-top:10px">Host sign in</h1>
        </div>
        <div class="provrow">
          <button class="btn btn-social">{ICONS['google']} Google</button>
          <button class="btn btn-social">Apple</button>
          <button class="btn btn-social">Amazon</button>
          <button class="btn btn-social">Facebook</button>
        </div>
        <p class="divider">or</p>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Email</span>
            <input class="input" type="email" name="email3" autocomplete="email"
                   autocapitalize="none" spellcheck="false" placeholder="you@work.com">
          </label>
          <label class="field">
            <span class="label" style="display:flex;justify-content:space-between;gap:12px">
              Password <a href="14-forgot.html" style="font-weight:600">Forgotten it?</a></span>
            <span class="pwwrap">
              <input class="input" type="password" name="password3" autocomplete="current-password">
              <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <button class="btn btn-primary">Sign in</button>
        </form>
        <p class="meta">Only Google exists in the app today. This is what the block
          becomes if the other three Cognito providers are actually wired up &mdash;
          one full-width button becomes a two-up grid, and the layout does not
          otherwise move.</p>
      </div></div></div>

    </div>
  </div></main>
{FOOT}
</div>""", """
.provrow{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.provrow .btn{width:100%;font-size:var(--t-label)}
""", PW_JS)


# ===========================================================================
# 11 — REGISTER
# ===========================================================================
P11 = ("Create a host account — Engagements", f"""
<div class="page">
{top(("Sign in instead", "10-signin.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <div>
      <p class="kicker">Running a session</p>
      <h1 style="margin-top:10px">Create a host account</h1>
    </div>

    <div class="notice attn">
      {ICONS['clock']}
      <div class="body">
        <h3>An admin has to approve you before you can run a session</h3>
        <p>Creating the account is instant. Being able to host is not. If you
           need to <em>join</em> something today,
           <a href="01-root.html">a code is all you need</a>.</p>
      </div>
    </div>

    <button class="btn btn-social">{ICONS['google']} Continue with Google</button>
    <p class="divider">or</p>

    <form class="stack s20" onsubmit="return false">
      <label class="field">
        <span class="label">Your name</span>
        <input class="input" type="text" name="name" autocomplete="name"
               autocapitalize="words" value="{HOST}">
      </label>
      <label class="field">
        <span class="label">Work email</span>
        <input class="input bad" type="email" name="email" autocomplete="email"
               autocapitalize="none" spellcheck="false" value="{EMAIL}"
               aria-describedby="emailerr">
        <span class="hint wrapany" id="emailerr" style="color:var(--text)">
          An account already uses {EMAIL}.
          <a href="10-signin.html">Sign in</a> or
          <a href="14-forgot.html">reset the password</a>.</span>
      </label>
      <div class="field">
        <label class="label" for="reg-pw" style="display:block;margin-bottom:6px">Password</label>
        <span class="pwwrap">
          <input class="input" type="password" id="reg-pw" name="password" data-pw
                 autocomplete="new-password" value="Northeast#26">
          <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
        </span>
        {RULES}
      </div>
      <button class="btn btn-primary">Create account</button>
    </form>

    <p class="meta">By creating an account you accept the
      <a href="#">terms</a> and the <a href="#">privacy policy</a>.</p>

  </div></main>
{FOOT}
</div>""", "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;color:var(--text)}", PW_JS)


# ===========================================================================
# 12 — EMAIL VERIFICATION (six digits)
# ===========================================================================
P12 = ("Confirm your email — Engagements", f"""
<div class="page">
{top(("Use a different email", "11-register.html"))}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <div>
      <h1>Check your email</h1>
      <p class="muted" style="margin-top:12px">We sent a 6&#8209;digit code to
        <strong class="wrapany" style="color:var(--text)">al***@northeast-commercial.example.com</strong>.</p>
    </div>

    <form onsubmit="return false">
      <label class="label" for="code" style="display:block;margin-bottom:9px">Code from the email</label>
      <div class="codewrap" data-code>
        <div class="cells cells6">
          <div class="cell filled">4</div><div class="cell filled">0</div>
          <div class="cell filled">7</div><div class="cell filled">1</div>
          <div class="cell filled">9</div><div class="cell next"></div>
        </div>
        <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]*"
               maxlength="6" autocomplete="one-time-code" autocorrect="off"
               spellcheck="false" aria-label="Verification code, 6 digits" value="40719">
      </div>
      <p class="hint" id="codesay" role="status" aria-live="polite"></p>
      <button class="btn btn-primary" data-code-submit disabled style="margin-top:14px">Confirm</button>
    </form>

    <div class="notice">
      {ICONS['clock']}
      <div class="body">
        <h3>Nothing arrived?</h3>
        <p>Look in spam. Codes take up to a minute. You can ask for another one
           in <strong style="color:var(--text)">47 seconds</strong>.</p>
      </div>
    </div>

    <button class="btn btn-quiet" disabled style="border:2px solid var(--rule)">
      Send another code in 47s</button>

  </div></main>
{FOOT}
</div>""", "", r"""
(function(){
  var wrap=document.querySelector('[data-code]'); if(!wrap) return;
  var input=wrap.querySelector('input'), cells=[].slice.call(wrap.querySelectorAll('.cell')),
      go=document.querySelector('[data-code-submit]'), say=document.getElementById('codesay');
  function paint(){var v=input.value;cells.forEach(function(c,i){
    c.textContent=v[i]||'';c.classList.toggle('filled',!!v[i]);
    c.classList.toggle('next',i===v.length);});
    if(go) go.disabled=v.length!==6;}
  input.addEventListener('input',function(){
    input.value=input.value.replace(/\D+/g,'').slice(0,6); paint();
    // Six digits is a complete code. There is nothing to confirm, so it submits
    // itself rather than asking for a tap the user has no reason to withhold.
    if(input.value.length===6 && say) say.textContent='Confirming…';});
  input.addEventListener('paste',function(e){e.preventDefault();
    var raw=(e.clipboardData||window.clipboardData).getData('text')||'';
    input.value=raw.replace(/\D+/g,'').slice(0,6); paint();});
  input.addEventListener('focus',paint); input.addEventListener('blur',paint);
  paint(); if(!matchMedia('(hover:none)').matches) input.focus();
})();
""")


# ===========================================================================
# 13 — PENDING APPROVAL.  The screen this whole exercise exists for.
# ===========================================================================
P13 = ("Waiting on approval — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <span class="pill attn">{ICONS['clock']} Not approved yet</span>

    <div>
      <h1>Your account exists. It cannot host yet.</h1>
      <p class="muted" style="margin-top:12px">
        Someone with admin rights at your organisation has to approve it first.
        We cannot do that from here and we cannot tell you when they will.</p>
    </div>

    <div class="card stack s20">
      <div>
        <h2>You can still join a session</h2>
        <p class="muted" style="margin-top:8px;font-size:var(--t-label)">
          Approval is only about <em>hosting</em>. If a session is running right
          now, your code works.</p>
      </div>
      <form onsubmit="return false">
        <label class="label" for="code" style="display:block;margin-bottom:9px">Session code</label>
        <div class="codewrap" data-code>
          <div class="cells codemini">
            <div class="cell next"></div><div class="cell"></div>
            <div class="cell"></div><div class="cell"></div>
          </div>
          <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]*"
                 maxlength="4" autocomplete="off" spellcheck="false"
                 aria-label="Session code, 4 digits">
        </div>
        <p class="hint" id="codesay" role="status" aria-live="polite"></p>
        <button class="btn btn-primary" data-code-submit disabled style="margin-top:14px">Join</button>
      </form>
    </div>

    <div class="card stack s20">
      <div>
        <h2>Nudge whoever approves accounts</h2>
        <p class="muted" style="margin-top:8px;font-size:var(--t-label)">
          There is no queue we can jump for you. Sending them your details is
          the fastest route.</p>
      </div>
      <div class="card" style="background:var(--surface-2);border-color:transparent">
        <p class="wrapany" style="font-size:var(--t-label);line-height:1.55">
          Host access request &mdash; {HOST}, {EMAIL}, requested 9 August 11:42.</p>
      </div>
      <button class="btn btn-ghost">Copy this</button>
    </div>

    <hr class="hr">

    <div class="stack s12">
      <div class="dl">
        <dt>Requested</dt><dd>9 August 2026, 11:42</dd>
        <dt>Email</dt><dd class="wrapany">{EMAIL}</dd>
        <dt>Status</dt><dd>Pending &mdash; last checked just now</dd>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-ghost sm">Check again</button>
        <button class="btn btn-quiet sm">Sign out</button>
      </div>
    </div>

  </div></main>
{FOOT}
</div>""", ".pill .ico{width:16px;height:16px}\n.card .card{padding:14px 16px}", r"""
(function(){
  var wrap=document.querySelector('[data-code]'); if(!wrap) return;
  var input=wrap.querySelector('input'), cells=[].slice.call(wrap.querySelectorAll('.cell')),
      go=document.querySelector('[data-code-submit]');
  function paint(){var v=input.value;cells.forEach(function(c,i){
    c.textContent=v[i]||'';c.classList.toggle('filled',!!v[i]);
    c.classList.toggle('next',i===v.length);});
    if(go) go.disabled=v.length!==4;}
  input.addEventListener('input',function(){
    input.value=input.value.replace(/\D+/g,'').slice(0,4);paint();});
  input.addEventListener('paste',function(e){e.preventDefault();
    var raw=(e.clipboardData||window.clipboardData).getData('text')||'';
    var m=/[?&]gameId=(\d{4})(?!\d)/.exec(raw);
    input.value=m?m[1]:raw.replace(/\D+/g,'').slice(0,4);paint();});
  input.addEventListener('focus',paint); input.addEventListener('blur',paint);
  paint();
})();
""")


# ===========================================================================
# 14 — PASSWORD RESET, all four moments
# ===========================================================================
P14 = ("Reset your password — Engagements", f"""
<div class="page">
{top(("Back to sign in", "10-signin.html"))}
  <main class="grow pad"><div class="shell" style="padding-block:8px">
    <div class="panels">

      <div class="panel"><div class="cap">1 &mdash; <b>ask</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <h1>Reset your password</h1>
          <p class="muted" style="margin-top:10px">We will email you a
            6&#8209;digit code.</p>
        </div>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Email</span>
            <input class="input" type="email" name="e1" autocomplete="email"
                   autocapitalize="none" spellcheck="false" placeholder="you@work.com">
          </label>
          <button class="btn btn-primary">Send the code</button>
        </form>
      </div></div></div>

      <div class="panel"><div class="cap">2 &mdash; <b>code and new password</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <h1>Reset your password</h1>
          <p class="muted" style="margin-top:10px">
            If there is an account for
            <strong class="wrapany" style="color:var(--text)">{EMAIL}</strong>,
            a code is on its way.</p>
        </div>
        <form class="stack s20" onsubmit="return false">
          <label class="field">
            <span class="label">Code from the email</span>
            <input class="input" type="text" name="c2" inputmode="numeric"
                   pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
                   spellcheck="false" value="40719"
                   style="font-size:22px;letter-spacing:.4em">
          </label>
          <div class="field">
            <label class="label" for="reset-pw" style="display:block;margin-bottom:6px">New password</label>
            <span class="pwwrap">
              <input class="input" type="password" id="reset-pw" name="p2" data-pw
                     autocomplete="new-password" value="Northeast#26">
              <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
            </span>
            {RULES}
          </div>
          <button class="btn btn-primary">Set the new password</button>
          <button type="button" class="btn btn-quiet">Send another code</button>
        </form>
      </div></div></div>

      <div class="panel"><div class="cap">3 &mdash; <b>done</b></div>
      <div class="in"><div class="stack s24">
        <div>
          <h1>Password changed</h1>
          <p class="muted" style="margin-top:10px">Use the new one to sign in.
            Anywhere you were already signed in stays signed in.</p>
        </div>
        <div class="notice good">
          {ICONS['check']}
          <div class="body">
            <h3>Saved</h3>
            <p>Changed just now for
              <span class="wrapany">{EMAIL}</span>.</p>
          </div>
        </div>
        <a class="btn btn-primary" href="10-signin.html">Sign in</a>
        <p class="meta">Today this step does not exist &mdash; the form drops you
          back on the sign-in screen with nothing said. See RATIONALE &sect;8.</p>
      </div></div></div>

      <div class="panel"><div class="cap">Edge &mdash; <b>Google account</b></div>
      <div class="in"><div class="stack s24">
        <div><h1>Reset your password</h1></div>
        <div class="notice attn">
          {ICONS['alert']}
          <div class="body">
            <h3>There is no password on this account</h3>
            <p>It was created with Google, so there is nothing here to reset.</p>
          </div>
        </div>
        <button class="btn btn-social">{ICONS['google']} Continue with Google</button>
        <a class="btn btn-quiet" href="10-signin.html">Back to sign in</a>
      </div></div></div>

    </div>
  </div></main>
{FOOT}
</div>""", "code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;color:var(--text)}", PW_JS)


# ===========================================================================
# 15 — COMING BACK FROM THE PROVIDER
# ===========================================================================
P15 = ("Finishing sign-in — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad"><div class="shell" style="padding-block:8px">
    <div class="panels">

      <div class="panel"><div class="cap">In flight &mdash; <b>first 6 seconds</b></div>
      <div class="in"><div class="stack s24" style="text-align:center">
        <div style="color:var(--primary);margin-inline:auto">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8"/>
            <animateTransform attributeName="transform" type="rotate"
              from="0 12 12" to="360 12 12" dur="0.95s" repeatCount="indefinite"/>
          </svg>
        </div>
        <h1>Finishing sign-in with Google</h1>
        <p class="muted">Do not close this tab.</p>
      </div></div></div>

      <div class="panel"><div class="cap">In flight &mdash; <b>after 6 seconds</b></div>
      <div class="in"><div class="stack s24" style="text-align:center">
        <div style="color:var(--primary);margin-inline:auto">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8"/>
            <animateTransform attributeName="transform" type="rotate"
              from="0 12 12" to="360 12 12" dur="0.95s" repeatCount="indefinite"/>
          </svg>
        </div>
        <h1>Still working</h1>
        <p class="muted">This is taking longer than it should.</p>
        <a class="btn btn-ghost" href="10-signin.html">Start again</a>
        <p class="meta">A stuck callback is a blank page with a spinner on it
          today, for as long as the user is willing to wait.</p>
      </div></div></div>

      <div class="panel"><div class="cap">Failed &mdash; <b>account already linked</b></div>
      <div class="in"><div class="stack s24">
        <div><h1>You already have an account</h1></div>
        <div class="notice attn">
          {ICONS['alert']}
          <div class="body">
            <h3>This Google account is already registered</h3>
            <p>Sign in with it rather than creating a second account.</p>
          </div>
        </div>
        <button class="btn btn-social">{ICONS['google']} Continue with Google</button>
        <a class="btn btn-quiet" href="10-signin.html">Use an email and password</a>
        <p class="meta">Today this redirects itself after 3 seconds, which is
          long enough to read and too short to act on.</p>
      </div></div></div>

      <div class="panel"><div class="cap">Failed &mdash; <b>everything else</b></div>
      <div class="in"><div class="stack s24">
        <div><h1>Sign-in did not complete</h1></div>
        <div class="notice attn">
          {ICONS['alert']}
          <div class="body">
            <h3>Google sent us back without finishing</h3>
            <p>Nothing was changed on your account. Trying again usually works.</p>
          </div>
        </div>
        <a class="btn btn-primary" href="10-signin.html">Try again</a>
        <details>
          <summary>Detail for support</summary>
          <p class="meta wrapany" style="margin-top:10px;font-family:ui-monospace,Menlo,monospace">
            invalid_request &middot; 400 &middot; token endpoint &middot; 14:22:07Z</p>
        </details>
        <p class="meta">Today the raw exception text is the headline &mdash;
          &ldquo;Authentication failed: 400 {{&quot;error&quot;:&hellip;&rdquo;.
          It belongs behind this disclosure, not in an h2.</p>
      </div></div></div>

    </div>
  </div></main>
{FOOT}
</div>""", """
details summary{cursor:pointer;font-size:var(--t-label);color:var(--muted);
  min-height:var(--tap);display:flex;align-items:center}
details summary:hover{color:var(--text)}
""", "")


# ===========================================================================
# 16 — SIGNED IN, BUT NOT FOR THIS
# ===========================================================================
P16 = ("Not available to you — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad"><div class="shell" style="padding-block:8px">
    <div class="panels">

      <div class="panel"><div class="cap">Host opened <b>/admin</b></div>
      <div class="in"><div class="stack s24">
        <span class="pill">{ICONS['lock']} Admins only</span>
        <div>
          <h1>This part is for admins</h1>
          <p class="muted" style="margin-top:10px">You are signed in as
            <strong class="wrapany" style="color:var(--text)">{EMAIL}</strong>,
            which can host sessions but not manage accounts.</p>
        </div>
        <a class="btn btn-primary" href="#">Back to your sessions</a>
        <button class="btn btn-quiet">Sign out</button>
      </div></div></div>

      <div class="panel"><div class="cap">Session expired <b>mid-task</b></div>
      <div class="in"><div class="stack s24">
        <span class="pill">Signed out</span>
        <div>
          <h1>You were signed out</h1>
          <p class="muted" style="margin-top:10px">Sessions do not last forever.
            Sign in again and you will land back on the question you were editing.</p>
        </div>
        <a class="btn btn-primary" href="10-signin.html">Sign in</a>
        <p class="meta">The destination has to be carried through the sign-in for
          that last sentence to be true. If it is not carried, the sentence has
          to go &mdash; it is a promise, not a pleasantry.</p>
      </div></div></div>

    </div>
  </div></main>
{FOOT}
</div>""", ".pill .ico{width:16px;height:16px}", "")


# ===========================================================================
# 17 — FORCED PASSWORD CHANGE (account created by an admin)
# ===========================================================================
P17 = ("Choose a password — Engagements", f"""
<div class="page">
{top()}
  <main class="grow pad"><div class="col stack s24" style="padding-block:8px 40px">

    <div>
      <p class="kicker">One thing first</p>
      <h1 style="margin-top:10px">Choose your own password</h1>
      <p class="muted" style="margin-top:12px">
        Your account was set up for you, so the password you just used was
        temporary. It stops working once you pick one.</p>
    </div>

    <form class="stack s20" onsubmit="return false">
      <input type="email" name="email" autocomplete="username" value="{EMAIL}"
             hidden aria-hidden="true">
      <div class="field">
        <label class="label" for="set-pw" style="display:block;margin-bottom:6px">New password</label>
        <span class="pwwrap">
          <input class="input" type="password" id="set-pw" name="p" data-pw
                 autocomplete="new-password" value="Nor">
          <button type="button" class="pwtoggle" aria-label="Show password">Show</button>
        </span>
        {RULES}
      </div>
      <button class="btn btn-primary" disabled>Save and continue</button>
    </form>

    <p class="meta">Signed in as <span class="wrapany">{EMAIL}</span>.
      <a href="#">Not you?</a></p>

  </div></main>
{FOOT}
</div>""", "code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;color:var(--text)}", PW_JS)


PAGES = {
    "10-signin.html": P10,
    "11-register.html": P11,
    "12-verify.html": P12,
    "13-pending.html": P13,
    "14-forgot.html": P14,
    "15-oauth-return.html": P15,
    "16-blocked.html": P16,
    "17-password-change.html": P17,
}
