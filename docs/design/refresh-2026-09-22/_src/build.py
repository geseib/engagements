#!/usr/bin/env python3
"""
Emits the self-contained mockups in docs/design/refresh-2026-09-22/.

Every output inlines its whole stylesheet, so each file opens from file://
with no build step, no CDN and no external asset — the rule the host and
admin sets follow (see admin-redesign/_src/build.py).

The base stylesheets are READ FROM THE APPROVED SETS, not retyped:
  home  = marketing-redesign/mk.css            + refresh-home.css
  stage = host-redesign/02-ask-…html <style>   + refresh-stage.css
so every token, wash, ladder and floor is byte-identical to what was audited,
and the refresh is legible as a diff (the two refresh-*.css files).

    python3 _src/build.py          # from docs/design/refresh-2026-09-22/
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
DESIGN = os.path.dirname(OUT)

def read(p):
    with open(p, encoding="utf-8") as f: return f.read()

MK = read(os.path.join(DESIGN, "marketing-redesign", "mk.css"))
STAGE_BASE = read(os.path.join(HERE, "stage-base.css"))
HOME_X = read(os.path.join(HERE, "refresh-home.css"))
STAGE_X = read(os.path.join(HERE, "refresh-stage.css"))
NOTES_JS = read(os.path.join(DESIGN, "marketing-redesign", "notes.js"))

# The design-notes rail, lifted from mk.css's tooling block so the stage pages
# carry the same rail (mk.css already includes it for the home pages).
ANNO_CSS = MK[MK.index("/* ============================================================= design notes"):]

# ---------------------------------------------------------------- the ridge
RIDGE = """
<div class="mk-ridge" aria-hidden="true">
  <div class="mk-ridge-sky"></div>
  <svg class="mk-ridge-stars" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMin slice">
    <circle cx="88" cy="54" r="1.5"/><circle cx="212" cy="122" r="1.1"/><circle cx="318" cy="40" r="1.7"/>
    <circle cx="404" cy="150" r="1"/><circle cx="512" cy="76" r="1.3"/><circle cx="596" cy="34" r="1"/>
    <circle cx="688" cy="118" r="1.6"/><circle cx="770" cy="58" r="1.1"/><circle cx="866" cy="142" r="1.2"/>
    <circle cx="944" cy="46" r="1.5"/><circle cx="1042" cy="104" r="1"/><circle cx="1136" cy="66" r="1.4"/>
    <circle cx="150" cy="196" r="1"/><circle cx="1004" cy="180" r="1.1"/>
  </svg>
  <div class="mk-ridge-glow"></div>
  <div class="mk-ridge-haze"></div>
  <svg class="mk-ridge-layer mk-ridge-back" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice">
    <path class="mk-ridge-body" d="M0 300 L120 236 L230 268 L360 176 L470 232 L600 108 L720 196 L840 150 L960 224 L1080 180 L1200 246 L1200 420 L0 420 Z"/>
  </svg>
  <svg class="mk-ridge-layer mk-ridge-mid" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" data-summit="0">
    <path class="mk-ridge-body" d="M0 352 L150 300 L280 330 L420 244 L540 292 L600 214 L680 270 L810 226 L940 300 L1060 262 L1200 318 L1200 420 L0 420 Z"/>
    <path class="mk-ridge-route" id="mkRoute" pathLength="1" d="M92 418 C 196 398 238 352 328 338 S 468 302 520 270 S 572 236 600 216"/>
    <circle class="mk-ridge-climber-halo" id="mkHalo" cx="92" cy="418" r="15"/>
    <circle class="mk-ridge-climber" id="mkClimber" cx="92" cy="418" r="6.5"/>
    <line class="mk-ridge-mast" x1="600" y1="216" x2="600" y2="186"/>
    <path class="mk-ridge-flag" d="M601 186 L628 195 L601 204 Z"/>
  </svg>
  <svg class="mk-ridge-layer mk-ridge-front" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice">
    <path class="mk-ridge-body" d="M0 400 L110 360 L240 388 L380 322 L500 364 L600 300 L700 348 L830 310 L980 368 L1110 336 L1200 372 L1200 420 L0 420 Z"/>
  </svg>
</div>
"""

NAV = """
<header class="mk-nav">
  <div class="mk-shell mk-nav-in">
    <a class="mk-brand" href="01-home.html">
      <svg class="mk-brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M2 27 L11 13 L16 20 L22 6 L30 27 Z"/></svg>
      Engagements
    </a>
    <nav class="mk-nav-links" aria-label="Main">
      <a class="mk-nav-link" href="../marketing-redesign/02-how-it-works.html">How it works</a>
      <a class="mk-nav-link" href="../marketing-redesign/03-use-cases.html">Use cases</a>
      <a class="mk-nav-link" href="../marketing-redesign/04-reports.html">Reports</a>
      <a class="mk-nav-link" href="../marketing-redesign/05-help.html">Help</a>
    </nav>
    <div class="mk-nav-acts">
      <a class="mk-btn mk-btn-quiet" href="#">Sign in</a>
      <a class="mk-btn mk-btn-primary" href="#">Create a host account</a>
      <button class="mk-nav-burger" type="button" aria-label="Menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div>
</header>
"""

# The drawn stage still used in the hero: trivia RESULTS, the correct row
# carrying the headline, shares beside each option. Same classes as the
# approved clip stills, so the React ClipStill can render it.
HERO_STAGE = """
<div class="mk-hero-stage" aria-hidden="true">
  <figure class="mk-device mk-device--tv" style="margin:0">
    <div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-clip">
      <span class="mk-clip-badge">Clip slot</span>
      <div class="mk-ss">
        <div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Results &middot; Q4 of 10</span><span class="mk-ss-code">4821</span></div>
        <p class="mk-ss-q">Which did the retro name as the biggest cause of rework?</p>
        <div class="mk-ss-bars">
          <div class="mk-ss-bar mk-ss-right"><span><b style="color:var(--mk-amber)">C</b> Requirements agreed in a call and never written down</span><em>58%</em><span class="mk-ss-track"><i style="width:58%"></i></span></div>
          <div class="mk-ss-bar"><span>A Unclear acceptance criteria</span><em>22%</em><span class="mk-ss-track mk-ss-cool"><i style="width:22%"></i></span></div>
          <div class="mk-ss-bar"><span>B Late design changes</span><em>14%</em><span class="mk-ss-track mk-ss-cool"><i style="width:14%"></i></span></div>
          <div class="mk-ss-bar"><span>D Environment drift</span><em>6%</em><span class="mk-ss-track mk-ss-cool"><i style="width:6%"></i></span></div>
        </div>
        <div class="mk-ss-foot"><span class="mk-ss-chip">20 of 20 answered</span><span class="mk-ss-grow"></span><span class="mk-ss-chip">Next question</span></div>
      </div>
    </div></div></div>
    <div class="mk-device-foot"></div>
  </figure>
  <figure class="mk-device mk-device--phone" style="margin:0">
    <div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-device-notch"></div><div class="mk-clip">
      <div class="mk-ss">
        <div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Priya</span></div>
        <p class="mk-ss-q">You picked C</p>
        <div class="mk-ss-opts"><div class="mk-ss-opt mk-ss-right"><b>C</b> Never written</div></div>
        <div class="mk-ss-cta">+120 pts</div>
      </div>
    </div></div></div>
  </figure>
</div>
"""

def art(label, req, extra=""):
    return f"""<div class="mk-art {extra}" role="img" aria-label="{label}">
  <div class="mk-art-req"><b>Image request &middot; {label}</b><p>{req}</p><div class="mk-art-sil"></div></div>
</div>"""

HOME_BODY = f"""
<div class="mk-page">
{NAV}
<section class="mk-hero" id="top">
  <div class="mk-shell mk-hero-top">
    <div>
      <p class="mk-kicker">Base camp</p>
      <h1 class="mk-display mk-hero-copy mk-rise" style="margin-top:18px"><span>Your team&rsquo;s own</span><span>material, turned into</span><span>decisions everyone</span><span>climbed toward.</span></h1>
      <p class="mk-lead mk-hero-sub">Build question sets from what your team already has. Run them as trivia to warm the room up, or as call and answer to collect every idea and put it to a vote. Everyone plays from their phone. The session ends with a report.</p>
    </div>
    {HERO_STAGE}
  </div>
  <div class="mk-shell mk-hero-foot">
    <div class="mk-hero-ctas">
      <a class="mk-btn mk-btn-primary mk-btn-lg" href="#">Create a host account</a>
      <a class="mk-btn mk-btn-ghost mk-btn-lg" href="#">Sign in</a>
    </div>
    <form class="jce" onsubmit="return false">
      <label class="jce-label" for="jce-code">Have a code?</label>
      <div class="jce-row">
        <div class="jce-cells" aria-hidden="true"><div class="jce-cell">4</div><div class="jce-cell">8</div><div class="jce-cell">2</div><div class="jce-cell jce-next"></div></div>
        <button class="mk-btn jce-go" type="submit">Join</button>
      </div>
      <input id="jce-code" type="text" inputmode="numeric" maxlength="4" hidden aria-label="Session code, 4 digits">
      <p class="jce-hint">No account and no app. The code is on the screen at the front of the room.</p>
    </form>
  </div>
</section>

<section class="mk-section mk-section--a" id="problem">
  <div class="mk-shell">
    <div class="mk-section-head"><h2 class="mk-title">Most sessions lose the thing they were for.</h2></div>
    <div class="mk-stmts">
      <div><h3>A few voices decide</h3><p>The same three people talk. The quiet half of the room has the answer and no way into the conversation.</p></div>
      <div><h3>Ideas leave with the people</h3><p>Written on a whiteboard, photographed by two of them, typed up by nobody.</p></div>
      <div><h3>Nobody remembers what was decided</h3><p>Six weeks later the decision is folklore, and the reasoning that produced it is gone.</p></div>
    </div>
  </div>
</section>

<section class="mk-section mk-section--b" id="modes">
  <div class="mk-shell">
    <div class="mk-section-head">
      <h2 class="mk-title">One set of questions, two shapes of round.</h2>
      <p class="mk-lead">Both run on the screen at the front of the room while everyone answers on their own phone.</p>
    </div>
    <div class="mk-mode">
      <div class="mk-mode-copy">
        <span class="mk-mode-tag">Trivia</span>
        <h3>Warm the room up, or check what landed.</h3>
        <ul class="mk-mode-list">
          <li>A question, four options, one right answer &mdash; revealed with its explanation.</li>
          <li>Ask, then results. Trivia has no vote phase.</li>
          <li>Running standings after every question.</li>
        </ul>
      </div>
      <div class="mk-mode-screens">
        <figure class="mk-device mk-device--tv" style="margin:0"><div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-clip"><span class="mk-clip-badge">Clip slot</span>
          <div class="mk-ss"><div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Trivia &middot; Question 4 of 10</span><span class="mk-ss-code">4821</span></div>
          <p class="mk-ss-q">Which of these did the 2025 retro name as the single biggest cause of rework?</p>
          <div class="mk-ss-opts"><div class="mk-ss-opt"><b>A</b> Unclear acceptance criteria</div><div class="mk-ss-opt"><b>B</b> Late design changes</div><div class="mk-ss-opt mk-ss-right"><b>C</b> Requirements agreed in a call and never written down</div><div class="mk-ss-opt"><b>D</b> Environment drift</div></div>
          <div class="mk-ss-foot"><span class="mk-ss-chip">18 of 20 answered</span><span class="mk-ss-grow"></span><span class="mk-ss-chip">Reveal</span></div></div>
        </div></div></div><div class="mk-device-foot"></div>
        <figcaption class="mk-device-cap"><b>trivia-host</b> &mdash; question, answers lock, the right answer and the standings.</figcaption></figure>
        <figure class="mk-device mk-device--phone" style="margin:0"><div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-device-notch"></div><div class="mk-clip"><span class="mk-clip-badge">Clip</span>
          <div class="mk-ss"><div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Priya</span></div><p class="mk-ss-q">Biggest cause of rework?</p>
          <div class="mk-ss-opts"><div class="mk-ss-opt"><b>A</b> Criteria</div><div class="mk-ss-opt"><b>B</b> Design</div><div class="mk-ss-opt mk-ss-right"><b>C</b> Never written</div><div class="mk-ss-opt"><b>D</b> Drift</div></div><div class="mk-ss-cta">Locked in</div></div>
        </div></div></div><figcaption class="mk-device-cap"><b>trivia-player</b> &mdash; answering.</figcaption></figure>
      </div>
    </div>
    <div class="mk-mode mk-mode--flip">
      <div class="mk-mode-copy">
        <span class="mk-mode-tag">Call and answer</span>
        <h3>Pose a prompt, collect every idea, then vote.</h3>
        <ul class="mk-mode-list">
          <li>Everyone writes at once, so the room hears from the people it usually does not.</li>
          <li>Ask, vote, results &mdash; three phases you move through.</li>
          <li>Every answer is kept, not only the ones that won votes, and the breakdown goes into the report.</li>
        </ul>
      </div>
      <div class="mk-mode-screens">
        <figure class="mk-device mk-device--tv" style="margin:0"><div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-clip"><span class="mk-clip-badge">Clip slot</span>
          <div class="mk-ss"><div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Call and answer &middot; Vote</span><span class="mk-ss-code">4821</span></div>
          <p class="mk-ss-q">What should we stop doing in the next quarter?</p>
          <div class="mk-ss-bars"><div class="mk-ss-bar"><span>Parallel discovery on three products</span><em>9</em><span class="mk-ss-track"><i style="width:82%"></i></span></div><div class="mk-ss-bar"><span>Weekly status meeting nobody reads</span><em>7</em><span class="mk-ss-track"><i style="width:64%"></i></span></div><div class="mk-ss-bar"><span>Hand-built release notes</span><em>4</em><span class="mk-ss-track mk-ss-cool"><i style="width:36%"></i></span></div></div>
          <div class="mk-ss-foot"><span class="mk-ss-chip">20 votes cast</span><span class="mk-ss-grow"></span><span class="mk-ss-chip">Results</span></div></div>
        </div></div></div><div class="mk-device-foot"></div>
        <figcaption class="mk-device-cap"><b>poll-host</b> &mdash; prompt, answers arriving, the vote, results revealed.</figcaption></figure>
        <figure class="mk-device mk-device--phone" style="margin:0"><div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-device-notch"></div><div class="mk-clip"><span class="mk-clip-badge">Clip</span>
          <div class="mk-ss"><div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Your idea</span></div><p class="mk-ss-q">What should we stop doing?</p><div class="mk-ss-field">Parallel discovery on three products at once</div><div class="mk-ss-doc"><span class="mk-ss-line"></span><span class="mk-ss-line mk-ss-short"></span></div><div class="mk-ss-cta">Send</div></div>
        </div></div></div><figcaption class="mk-device-cap"><b>poll-player</b> &mdash; writing, then voting.</figcaption></figure>
      </div>
    </div>
  </div>
</section>

<section class="mk-section mk-section--a" id="material">
  <div class="mk-shell">
    <div class="mk-section-head">
      <h2 class="mk-title">The questions come from your work, not from a quiz pack.</h2>
      <p class="mk-lead">Hand the builder the strategy document, the retro notes, the deck you are about to present. It drafts a set. You decide what runs.</p>
    </div>
    <ol class="mk-seq" style="list-style:none;padding:0;margin-top:40px">
      <li class="mk-seq-step"><span class="mk-seq-n">1</span><h3>Supply the material</h3><p>Documents and topics you already have. Or write the questions yourself &mdash; the builder is a convenience, not a requirement.</p></li>
      <li class="mk-seq-step"><span class="mk-seq-n">2</span><h3>A set is drafted</h3><p>Trivia questions or call-and-answer prompts, each with its category and its detail.</p></li>
      <li class="mk-seq-step"><span class="mk-seq-n">3</span><h3>You review and edit</h3><p>Preview the set as a player will see it, change anything, drop anything. Nothing runs until you start a session.</p></li>
      <li class="mk-seq-step"><span class="mk-seq-n">4</span><h3>It is stored where it belongs</h3><p>In your organisation&rsquo;s private library, encrypted. Or start from the moderated public library.</p></li>
    </ol>
    <div class="mk-material-row">
      <figure class="mk-device mk-device--laptop" style="margin:0"><div class="mk-device-bezel"><div class="mk-device-screen"><div class="mk-clip"><span class="mk-clip-badge">Clip slot</span>
        <div class="mk-ss"><div class="mk-ss-top"><span class="mk-ss-dot"></span><span class="mk-ss-chip">Builder &middot; drafting</span><span class="mk-ss-code">14 / 20</span></div>
        <div class="mk-ss-doc"><span class="mk-ss-line"></span><span class="mk-ss-line"></span><span class="mk-ss-line mk-ss-warm"></span><span class="mk-ss-line mk-ss-short"></span></div>
        <div class="mk-ss-opts"><div class="mk-ss-opt"><b>Q12</b> Which constraint did the plan name first?</div><div class="mk-ss-opt"><b>Q13</b> What does &ldquo;done&rdquo; mean for a discovery spike?</div></div>
        <div class="mk-ss-foot"><span class="mk-ss-chip">Review before anything runs</span></div></div>
      </div></div></div><div class="mk-device-foot"></div>
      <figcaption class="mk-device-cap"><b>builder</b> &mdash; a set being drafted from supplied material.</figcaption></figure>
      <p class="mk-material-note"><b>Private stays private.</b> An organisation&rsquo;s sets are encrypted and are readable only inside that organisation. The public library is separate, moderated, and nothing reaches it without being published on purpose.</p>
    </div>
  </div>
</section>

<section class="mk-section mk-section--b" id="room">
  <div class="mk-shell">
    <div class="mk-section-head"><h2 class="mk-title">Answers arrive live. The team votes. The strongest ideas rise.</h2></div>
    <div class="mk-react-grid">
      <div class="mk-tally" id="mkTally">
        <div class="mk-tally-head"><h3>What should we stop doing?</h3></div>
        <p class="mk-muted" style="margin-top:10px">20 people answered. 20 votes cast.</p>
        <div class="mk-tally-rows">
          <div class="mk-tally-row"><div class="mk-tally-top"><b>Parallel discovery on three products at once</b><span class="mk-tally-n"><span data-count="9">0</span> votes</span></div><div class="mk-tally-track"><i style="--w:82%"></i></div></div>
          <div class="mk-tally-row"><div class="mk-tally-top"><b>The weekly status meeting nobody reads</b><span class="mk-tally-n"><span data-count="7">0</span> votes</span></div><div class="mk-tally-track"><i style="--w:64%"></i></div></div>
          <div class="mk-tally-row mk-tally-row--cool"><div class="mk-tally-top"><b>Hand-built release notes</b><span class="mk-tally-n"><span data-count="4">0</span> votes</span></div><div class="mk-tally-track"><i style="--w:36%"></i></div></div>
          <div class="mk-tally-row mk-tally-row--cool"><div class="mk-tally-top"><b>Two-week estimates on unscoped work</b><span class="mk-tally-n"><span data-count="0">0</span> votes</span></div><div class="mk-tally-track"><i style="--w:2%"></i></div></div>
        </div>
        <p class="mk-tally-note">The answer with no votes is kept too. A session that quietly discards it is a session you cannot go back to.</p>
      </div>
      <div class="mk-react-side">
        {art("The room, looking up",
             "A real meeting room, dusk-lit, 12&ndash;20 people seated, most holding phones, all faces turned up toward an off-frame screen at the front &mdash; the moment a result lands. Shot from behind and slightly above the back row so the screen glow is on their faces and the screen itself is out of frame (the product still is drawn beside it; a photographed screen would date). Warm amber key from the screen, cool blue ambient. 4:3, ~1600px, WebP &le;180KB. Low-key: no face brighter than mid-grey so --mk-text over any 70% wash still clears 4.5:1. No laptops, no lanyards, no brand marks.")}
        <p class="mk-lead">Everyone writes at the same time, so the room does not have to take turns to be heard.</p>
        <ul class="mk-mode-list">
          <li>The room reads every answer, then votes &mdash; on what was said, not on who said it loudest.</li>
          <li>The count is a vote count. It is not a quality score and the report never calls it one.</li>
          <li>Names can be hidden for a whole session if the subject needs it.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="mk-section mk-section--a mk-summit" id="summit">
  <div class="mk-shell">
    <div class="mk-section-head">
      <p class="mk-kicker">The summit</p>
      <h2 class="mk-title">Everyone leaves with the same page.</h2>
      <p class="mk-lead">The report is written as the session runs. Nobody has to type the whiteboard up afterwards.</p>
    </div>
    <div class="mk-summit-grid">
      <div class="mk-report" data-theme="light">
        <div class="mk-report-head"><p class="mk-report-kicker">Session report</p><h3>Q3 planning &mdash; what we stop, what we start</h3><p class="mk-report-meta">Thursday 18 September &middot; 20 participants &middot; 6 questions &middot; code 4821</p></div>
        <div class="mk-report-body">
          <section class="mk-report-block"><h4>Question 3 &middot; call and answer</h4><p class="mk-report-q">What should we stop doing in the next quarter?</p>
            <ul class="mk-report-answers">
              <li><span>Parallel discovery on three products at once</span><span class="mk-report-votes">9 votes</span><span class="mk-report-meter"><i style="width:82%"></i></span><span class="mk-report-by">Priya N. &middot; &ldquo;We are three deep on everything and finished on nothing.&rdquo;</span></li>
              <li><span>The weekly status meeting nobody reads</span><span class="mk-report-votes">7 votes</span><span class="mk-report-meter"><i style="width:64%"></i></span><span class="mk-report-by">Tomas B.</span></li>
              <li><span>Hand-built release notes</span><span class="mk-report-votes">4 votes</span><span class="mk-report-meter"><i style="width:36%"></i></span><span class="mk-report-by">Alina K. &middot; &ldquo;Forty minutes a week, every week.&rdquo;</span></li>
              <li><span>Two-week estimates on unscoped work</span><span class="mk-report-votes">0 votes</span><span class="mk-report-meter"><i style="width:2%"></i></span><span class="mk-report-by">Sam O.</span></li>
            </ul></section>
          <section class="mk-report-block"><h4>Summary and next steps</h4><div class="mk-report-summary"><p>The room agreed on one thing far more strongly than on anything else: too much discovery is running at once. Two of the four answers describe recurring process cost rather than product work, which suggests the quarter&rsquo;s real constraint is attention, not capacity.</p>
            <ol class="mk-report-list"><li>Name one product as the discovery focus before the next planning session.</li><li>Decide who owns release notes, or decide to stop writing them.</li><li>Revisit the status meeting with the four people who said they read it.</li></ol></div></section>
        </div>
        <div class="mk-report-foot"><a class="mk-report-btn" href="../marketing-redesign/04-reports.html">Export PDF</a><a class="mk-report-btn" href="../marketing-redesign/04-reports.html">Copy shareable link</a><span class="mk-report-note">Every answer, every vote and every comment is kept.</span></div>
      </div>
      <div class="mk-summit-aside">
        {art("The summit, held",
             "A single sheet of paper on a dark table, held at its top corners by two hands from opposite sides &mdash; two people reading the same page. Overhead, tight crop; the sheet is the brightest thing in frame and is blank or out of focus (the report is drawn, not photographed). 3:4 on desktop, 16:9 crop on mobile, ~1400px tall, WebP &le;160KB. This is the payoff frame; it should feel like agreement, not paperwork.")}
        <p class="mk-muted"><a href="../marketing-redesign/04-reports.html">See a full report, annotated &rarr;</a></p>
      </div>
    </div>
  </div>
</section>

<section class="mk-cta" id="start">
  <div class="mk-shell mk-cta-in">
    <h2 class="mk-title">Bring your own material. Leave with a decision.</h2>
    <div class="mk-cta-row"><a class="mk-btn mk-btn-primary mk-btn-lg" href="#">Create a host account</a><a class="mk-btn mk-btn-ghost mk-btn-lg" href="../marketing-redesign/02-how-it-works.html">See how it works</a></div>
    <p class="mk-cta-fine">Players never need an account. Hosts sign in once.</p>
  </div>
</section>

<footer class="mk-foot"><div class="mk-shell mk-foot-in"><span class="mk-foot-legal">Engagements</span><nav class="mk-foot-links" aria-label="Footer"><a href="#">Privacy</a><a href="#">Terms</a><a href="../marketing-redesign/05-help.html">Help</a><a href="#">Join with a code</a></nav></div></footer>
</div>
"""

HOME_NOTES = """
<aside class="mk-anno-rail" aria-label="Design notes">
  <h6>Design notes — 01 home (refresh)</h6>
  <div class="mk-anno"><b>The product is in the first viewport</b>The shipped hero is 88vh of sky over two buttons; a cold visitor cannot tell what this is until the third screen. The drawn RESULTS still now sits right of the headline. It is a dark object with its own contrast, so it may enter the amber band the headline may not.</div>
  <div class="mk-anno"><b>One filled amber per viewport</b>Shipped: nav primary, hero primary and the Join button are all filled amber above the fold. Here the nav door and Join are outlines; the hero's primary is the only filled control in view.</div>
  <div class="mk-anno"><b>The route draws itself</b>The climber already moves with scroll (RidgeScene.jsx:97). The route was fully drawn from frame one, so the plan read as already walked. Now <code>stroke-dashoffset</code> follows the same progress and the flag lights when you reach the report. Reduced motion: drawn in full, still.</div>
  <div class="mk-anno"><b>Headline rises once</b>Three lines, 620ms, 90ms apart, <code>cubic-bezier(.16,1,.3,1)</code>, from an already-painted default (react-bits SplitText / motion-primitives text-effect). A failed script hides nothing.</div>
  <div class="mk-anno"><b>Scaffold tells removed</b>Impeccable's craft floor names each one the shipped page uses: a kicker on every heading, 01/02/03 numerals, same-size card grids as page structure, a 3px coloured border-left. The kicker survives twice — Base camp and The summit — because it carries the climb. The sequence numbers survive because the order is information.</div>
  <div class="mk-anno"><b>The tally performs</b>Bars grow from zero and counts count up when the block enters view, once, in 700ms (motion-primitives in-view + animated-number). It is the product's own live moment and the one motion this section gets.</div>
  <div class="mk-anno"><b>Two photographs, requested</b>Placeholders carry the request text. Both are low-key so the wash keeps AA; both keep the screen and the sheet out of focus so the drawn stills stay the product image and the photos stay true after the next UI change.</div>
  <div class="mk-anno"><b>Unchanged on purpose</b>The glow stays in the bottom 40%; every word in the join card is <code>--mk-text</code>; trivia says it has no vote phase; the zero-vote answer is kept; the paper sheet converts markup and theme together.</div>
</aside>
<button class="mk-anno-toggle" type="button" id="mkAnno">Hide design notes</button>
"""

HOME_JS = """
<script>
/* The route draws with scroll, just ahead of the climber. Same progress the
   shipped useScrollProgress produces; reduced motion pins it to 1. */
(function () {
  var route = document.getElementById('mkRoute'), climber = document.getElementById('mkClimber'),
      halo = document.getElementById('mkHalo'), mid = route && route.closest('.mk-ridge-mid');
  if (!route || !climber) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var len = route.getTotalLength();
  function progress() {
    var max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }
  function paint() {
    var p = reduced ? 1 : progress();
    var ahead = Math.min(1, p + 0.08);
    route.style.strokeDashoffset = (1 - ahead).toFixed(3);
    var pt = route.getPointAtLength(len * p);
    climber.setAttribute('cx', pt.x.toFixed(1)); climber.setAttribute('cy', pt.y.toFixed(1));
    halo.setAttribute('cx', pt.x.toFixed(1)); halo.setAttribute('cy', pt.y.toFixed(1));
    if (mid) mid.dataset.summit = p > 0.86 ? '1' : '0';
  }
  paint();
  if (!reduced) { addEventListener('scroll', paint, { passive: true }); addEventListener('resize', paint); }
})();
/* The tally: bars grow and counts count up once the block is in view. */
(function () {
  var box = document.getElementById('mkTally'); if (!box) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el) {
    var target = +el.dataset.count, t0 = performance.now(), dur = 700;
    if (reduced) { el.textContent = target; return; }
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function go() { box.classList.add('is-in'); box.querySelectorAll('[data-count]').forEach(countUp); }
  if (!('IntersectionObserver' in window)) return go();
  var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { go(); io.disconnect(); } }, { threshold: .35 });
  io.observe(box);
})();
</script>
"""

def home_page(mobile=False):
    title = "Engagements — turn your team's own material into decisions"
    extra = ""
    if mobile:
        # The same page reviewed at 390px beside the desktop one. The narrow
        # branches are forced on inside the column; the document itself stays
        # at the viewport width (audit A1: no horizontal scroll, ever).
        extra = """
/* ---- 390px review frame: mk.css's narrow branches, forced on. ---- */
body { background: #070C16; }
.mk-frame { width: 390px; margin: 0 auto; box-shadow: 0 0 0 1px rgba(244,237,228,.14); }
.mk-frame .mk-root { --mk-t-head: 25px; --mk-t-title: 32px; --mk-t-display: 42px; --mk-gutter: 16px;
  /* The band is the hero's REAL height here, not 92vh: with the still in the
     hero the content out-measures a phone viewport, and a glow clamped to 60%
     of 92vh rose into the lead. In React the scene reads the hero's measured
     height on narrow viewports (RATIONALE step 1). */
  --mk-ridge-band: 1080px; }
.mk-frame .mk-ridge { position: absolute; }
.mk-frame .mk-ridge-route, .mk-frame .mk-ridge-climber, .mk-frame .mk-ridge-climber-halo, .mk-frame .mk-ridge-mast, .mk-frame .mk-ridge-flag { display: none; }
.mk-frame .mk-nav-links { display: none; }
.mk-frame .mk-nav-acts .mk-btn-primary { display: none; }
.mk-frame .mk-nav-burger { display: inline-grid; place-items: center; width: var(--mk-tap); height: var(--mk-tap); border-radius: var(--mk-radius-sm); background: transparent; color: var(--mk-text); border: 1px solid var(--mk-rule-strong); }
.mk-frame .mk-nav-burger svg { width: 20px; height: 20px; } .mk-frame .mk-nav-burger path { stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.mk-frame .mk-hero { row-gap: 26px; }
.mk-frame .mk-hero-top { grid-template-columns: minmax(0,1fr); }
.mk-frame .mk-hero-copy { max-width: none; }
.mk-frame .mk-hero-stage { justify-self: stretch; }
.mk-frame .mk-hero-stage .mk-device--phone { display: none; }
.mk-frame .mk-rise > span { display: inline; animation: none; } .mk-frame .mk-rise > span::after { content: " "; }
.mk-frame .mk-hero-stage .mk-ss-bar:nth-child(n+3), .mk-frame .mk-hero-stage .mk-clip-badge { display: none; }
.mk-frame .mk-hero-foot { flex-direction: column; align-items: stretch; }
.mk-frame .mk-hero-ctas .mk-btn { flex: 1 1 100%; }
.mk-frame .jce { min-width: 0; }
.mk-frame .mk-stmts, .mk-frame .mk-seq, .mk-frame .mk-material-row, .mk-frame .mk-react-grid, .mk-frame .mk-summit-grid, .mk-frame .mk-mode { grid-template-columns: minmax(0,1fr); }
.mk-frame .mk-seq::before { display: none; }
.mk-frame .mk-seq-step { padding-top: 0; padding-left: 50px; } .mk-frame .mk-seq-step h3 { margin-top: 0; }
.mk-frame .mk-stmts h3, .mk-frame .mk-stmts p, .mk-frame .mk-seq-step p { max-width: none; }
.mk-frame .mk-mode--flip .mk-mode-copy { order: 0; }
.mk-frame .mk-mode-screens { grid-template-columns: minmax(0,1fr); justify-items: center; }
.mk-frame .mk-mode-screens .mk-device--phone { width: 190px; }
.mk-frame .mk-summit-aside { position: static; } .mk-frame .mk-summit-aside .mk-art { aspect-ratio: 16/9; }
.mk-frame .mk-art { aspect-ratio: 16/10; }
.mk-frame .mk-report-head, .mk-frame .mk-report-body, .mk-frame .mk-report-foot { padding-inline: 18px; }
.mk-frame .mk-report-note { margin-left: 0; }
"""
        title += " (390px)"
    notes = HOME_NOTES.replace("01 home (refresh)", "01m home at 390px" if mobile else "01 home (refresh)")
    if mobile:
        notes = notes.replace('<h6>Design notes — 01m home at 390px</h6>',
            '<h6>Design notes — 01m home at 390px</h6><div class="mk-anno"><b>What changes at 390</b>The stage still stacks under the headline and keeps its place above the buttons: the room screen is still the first thing after the claim. The phone overlay goes (it would cover the still). The nav keeps Sign in and drops the account door — the hero\'s first button is that action. Route, climber and flag are hidden under 720px as before.</div>')
    body = HOME_BODY
    if mobile:
        body = '<div class="mk-frame">\n<div class="mk-root">' + RIDGE + body + '</div>\n</div>'
    else:
        body = '<div class="mk-root">' + RIDGE + body + '</div>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>{title}</title>
<style>
{MK}
{HOME_X}
{extra}
</style>
</head>
<body class="mk-anno-on">
{body}
{notes}
{HOME_JS}
<script>{NOTES_JS}</script>
</body>
</html>
"""

# =============================================================== the stage
def stage_page(title, body, notes, tag, extra_js=""):
    return f"""<!doctype html>
<html lang="en" class="d-room">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{STAGE_BASE}
{STAGE_X}
/* ---- mockup tooling: the design-notes rail (mk.css), not product CSS ---- */
{ANNO_CSS}
body.mk-anno-on .stage{{width:100%}}
.tag{{right:auto}}
</style>
</head>
<body class="mk-anno-on">
{body}
<div class="tag">{tag}</div>
{notes}
<script>{NOTES_JS}</script>
{extra_js}
</body>
</html>
"""

ASK_BODY = """
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  <header class="rail"><span class="chip ask"><span class="dot"></span>Answering</span><span class="rail-title" data-drop="1">Q3 Leadership Offsite — Pricing Strategy &amp; Competitive Response Workshop</span><span class="rail-ctx"><span>Competitive Response</span><i>/</i><b>Round 3</b><span>of 8</span></span><span class="rail-timer" aria-label="2 minutes 14 seconds left">2:14</span><div class="rail-join"><span data-drop="2">JOIN</span><span data-drop="3">engage.seibtribe.us/play</span><code>4821</code></div></header><div class="bar" data-phase="ask" role="presentation"></div>
  <div class="wipe" aria-hidden="true">Answering<small>Write your answer on your phone</small></div>
  <div class="main">
    <div class="content" data-grow="1.35"><div class="fitbox"><h1 class="q">Our largest competitor cut list price 20% this morning and briefed the trade press before they briefed their own sales team. With no extra budget, no new headcount and no change to the roadmap, what is the first move you would make inside your own function on Monday?</h1><p class="qdetail" data-drop="1" data-drop-note="Full prompt">Answer for the function you actually run, not for the company. Name the one thing you would stop doing to pay for it.</p><p class="anon-line" data-drop="3" data-drop-note="Anonymity note"><b>Answers are anonymous.</b> Nobody sees who wrote what — the host included.</p><p class="reduced" hidden></p></div></div>
    <aside class="meter arrivals"><h4>Answered</h4><div class="count"><span class="n" id="cnt">31</span><small> / 40</small></div>
      <h5>Arriving</h5>
      <div id="arrivals">
        <div class="arr"><p class="ans">Stop the Q4 feature freeze review and put that week into a price-fence rewrite.</p><span class="n">Response 31</span></div>
        <div class="arr older"><p class="ans">Pull sales engineering off the two smallest accounts and onto renewals due in 60 days.</p><span class="n">Response 30</span></div>
        <div class="arr oldest"><p class="ans">Cancel the partner summit.</p><span class="n">Response 29</span></div>
      </div>
    </aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Session setup" title="Session setup — backslash key">⋯<span class="dock-more-lbl">Setup</span></button><span class="status" aria-live="polite">Some are still answering</span><span class="spacer"></span><button class="btn ghost" type="button">Skip Round</button><span class="kbd">SPACE</span><button class="btn primary" type="button">Start Voting</button></footer>
</main>
"""

ASK_NOTES = """
<aside class="mk-anno-rail" aria-label="Design notes">
  <h6>Design notes — 02 stage · ASK (call and answer, Room)</h6>
  <div class="mk-anno"><b>What moved and why it may</b>Three things move on this screen, each once, each because something happened: the phase wipe on entry (1.4s, then gone), an arrival (240ms rise), and the count ticking with it. Nothing idles. Reload to see the wipe; an arrival is simulated at 2.5s.</div>
  <div class="mk-anno"><b>The phase wipe, finally</b>16-phase-wipe was approved and never shipped: <code>PhaseBar.jsx:21</code> flips a data attribute and the band just changes colour. A room heads-down on phones needs one beat it cannot miss. Transforms and opacity only; a solid plate in Call; absent under reduced motion (the band still changes).</div>
  <div class="mk-anno"><b>Arrivals on the wall</b>The home page says "answers appear on the front screen as they are submitted" (<code>content/home.js:115</code>); the stage shows a count. The meter column widens to carry the last three, unattributed, newest first, older ones dimmer. It is the moment the marketing sells. Anchoring risk is real: propose it as a session setting, default on for call and answer — open question 1.</div>
  <div class="mk-anno"><b>The code a latecomer can read</b><code>stage.css:202</code> sets the rail's code at 1.3&times; the label tier: 26&ndash;31px at Room, ~10.7&prime; at 25ft. Once ASK begins the QR is gone and this is the only way in. Secondary tier now; the rail's sacrifice order is unchanged.</div>
  <div class="mk-anno"><b>What did not change</b>The four ladders, the floors, the fitter, the content-before-chrome rule, the dock, the anonymity line (already body size), the timer. Type sizes are the audited ones; the arrivals read the ladder (<code>--t-body</code>, <code>--t-meta</code>) and scale with the profile.</div>
</aside>
<button class="mk-anno-toggle" type="button" id="mkAnno">Hide design notes</button>
"""

ASK_JS = """
<script>
/* Simulate one arrival at 2.5s: the count ticks, a card rises, the oldest
   card leaves. This is the whole motion vocabulary of ASK. */
setTimeout(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var list = document.getElementById('arrivals'), cnt = document.getElementById('cnt');
  var cards = list.querySelectorAll('.arr');
  cards[2].remove(); cards[1].className = 'arr oldest'; cards[0].className = 'arr older';
  var el = document.createElement('div'); el.className = 'arr';
  el.innerHTML = '<p class="ans">Move the whole enablement team onto a one-page “why we cost more” brief and ship it by Wednesday.</p><span class="n">Response 32</span>';
  list.insertBefore(el, list.firstChild);
  cnt.textContent = '32'; cnt.classList.add('tick');
}, 2500);
</script>
"""

RESULTS_BODY = """
<main class="stage">
  <div class="field alpenglow" aria-hidden="true"></div>
  <header class="rail"><span class="chip results"><span class="dot"></span>Results</span><span class="rail-title" data-drop="1">Q3 Leadership Offsite — Pricing Strategy &amp; Competitive Response Workshop</span><span class="rail-ctx"><span>Pricing Mechanics</span><i>/</i><b>Question 4</b><span>of 10</span></span><div class="rail-join"><span data-drop="2">JOIN</span><span data-drop="3">engage.seibtribe.us/play</span><code>4821</code></div></header><div class="bar" data-phase="results" role="presentation"></div>
  <div class="wipe results" aria-hidden="true">Results<small>Look up</small></div>
  <div class="main">
    <div class="content"><div class="fitbox"><p class="recap">Across large B2B software companies, which single pricing change has historically produced the largest one-year improvement in gross margin, holding volume roughly constant?</p><div class="opts list"><div class="opt correct hero-row"><span class="fill" style="width:42%"></span><span class="ltr">A</span><span class="txt">A 5% increase to list price, held through the renewal cycle without exception</span><span class="flag">Correct</span><span class="pct" data-pct="42">0%</span></div><div class="opt dim"><span class="fill" style="width:21%"></span><span class="ltr">B</span><span class="txt">Migrating the installed base from seat-based licensing to usage-based billing</span><span class="pct" data-pct="21">0%</span></div><div class="opt dim"><span class="fill" style="width:14%"></span><span class="ltr">C</span><span class="txt">Introducing a premium support tier at roughly 20% of contract value</span><span class="pct" data-pct="14">0%</span></div><div class="opt dim"><span class="fill" style="width:10%"></span><span class="ltr">D</span><span class="txt">Discounting the entry-level plan to widen the top of the funnel</span><span class="pct" data-pct="10">0%</span></div><div class="opt dim" data-drop="5" data-drop-note="Options E–F"><span class="fill" style="width:8%"></span><span class="ltr">E</span><span class="txt">Consolidating three regional price books into a single global one</span><span class="pct" data-pct="8">0%</span></div><div class="opt dim" data-drop="4" data-drop-note="Options E–F"><span class="fill" style="width:5%"></span><span class="ltr">F</span><span class="txt">Shortening payment terms from net-60 to net-30 across all accounts</span><span class="pct" data-pct="5">0%</span></div></div><p class="qdetail explain" data-drop="1" data-drop-note="Explanation">A 1% price improvement lifts operating profit about 11% on average — more than a 1% volume or cost gain.</p><p class="reduced" hidden></p></div></div>
    <aside class="meter"><h4>Standings</h4><ul class="roster"><li><span class="nm">Priya Raghavan</span><span class="delta">▲2</span><span class="sc">1,240</span></li><li><span class="nm">Wes Duncan</span><span class="delta down">▼1</span><span class="sc">980</span></li><li><span class="nm">Aisha Bello</span><span class="delta down">▼1</span><span class="sc">870</span></li><li><span class="nm">Lee Chen</span><span class="sc">640</span></li><li><span class="nm">Marcus Ola</span><span class="delta">▲3</span><span class="sc">610</span></li><li><span class="nm">Aleksandra Wiśniewska</span><span class="sc">520</span></li></ul><div class="more">+ 34 more</div></aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Session setup" title="Session setup — backslash key">⋯<span class="dock-more-lbl">Setup</span></button><span class="status" aria-live="polite">Results are on screen</span><span class="spacer"></span><button class="btn ghost" type="button">Next Question</button><span class="kbd">SPACE</span><button class="btn primary" type="button">What we heard</button></footer>
</main>
"""

RESULTS_NOTES = """
<aside class="mk-anno-rail" aria-label="Design notes">
  <h6>Design notes — 03 stage · RESULTS (trivia, Room)</h6>
  <div class="mk-anno"><b>Three things the shipped stage lost from 07</b>The question recap (<code>GameHostPage.jsx:5798</code> passes no <code>withQuestion</code>; <code>QuestionCard.jsx:74</code> returns options alone), the explanation (<code>answerDetails</code> renders nowhere on the stage), and the CORRECT word-flag &mdash; so "correct" is a border colour, which the spec's own "never colour alone" forbids. All three are back. The kicker "Question 4 &middot; Results" (<code>GameHostPage.jsx:5749</code>) is gone: the rail already says it.</div>
  <div class="mk-anno"><b>The reveal performs</b>Shares grow from zero (620ms, <code>cubic-bezier(.16,1,.3,1)</code>), percentages count up in step, rows land 80ms apart capped at 450ms, the correct row's border turns green at 550ms and the flag arrives at 720ms, the explanation last. One sequence, once, then still. Transforms and opacity only, so Call encodes it cleanly; TV and Table inherit their ladders and nothing here depends on size. Reduced motion: the final frame.</div>
  <div class="mk-anno"><b>The standings move</b>The home page says so and the stage never showed it. Rows that changed carry a delta for this screen only (react-bits AnimatedList). Trivia has no anonymity, so score-beside-name is allowed here &mdash; and RoomMeter has no standings slot yet (<code>GameHostPage.jsx:5784</code> records the conflict). Names wrap; nothing ellipses.</div>
  <div class="mk-anno"><b>Alpenglow on results</b>07's <code>.field.alpenglow</code> (a stronger amber bloom, bottom 40% only) never reached <code>stage.css</code>. It is the one field variant that marks a payoff state without touching the type.</div>
  <div class="mk-anno"><b>What did not change</b>Ladders, floors, fitter, drop order (E&ndash;F first, then the explanation), the dock, the correct row carrying the headline weight rather than a restated answer above the list.</div>
</aside>
<button class="mk-anno-toggle" type="button" id="mkAnno">Hide design notes</button>
"""

RESULTS_JS = """
<script>
/* Percentages count up in step with the bars they label. */
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.pct[data-pct]').forEach(function (el, i) {
    var target = +el.dataset.pct;
    if (reduced) { el.textContent = target + '%'; return; }
    var delay = 1000 + 50 + i * 80, dur = 620, t0 = performance.now() + delay;
    (function step(t) {
      var k = Math.min(1, Math.max(0, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * e) + '%';
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  });
})();
</script>
"""

INDEX = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Refresh 2026-09-22 — mockups</title>
<style>
:root{--bg:#0F1A2E;--text:#F4EDE4;--muted:#9BA8BE;--primary:#F6A94C;--rule:rgba(155,168,190,.22)}
body{margin:0;background:var(--bg);color:var(--text);font:400 16px/1.55 "Inter",system-ui,sans-serif;padding:52px 26px 90px}
.wrap{max-width:860px;margin:0 auto}h1{font-family:"Archivo Expanded","Archivo",system-ui,sans-serif;font-weight:800;font-size:clamp(28px,4vw,40px);line-height:1.05;margin:0 0 12px}
p{color:var(--muted);max-width:74ch}ol{list-style:none;padding:0;margin:26px 0 0;counter-reset:m}
li{counter-increment:m;border-bottom:1px solid var(--rule);padding:15px 0 15px 52px;position:relative}
li::before{content:counter(m,decimal-leading-zero);position:absolute;left:0;top:17px;font-family:"Archivo Expanded",system-ui,sans-serif;font-weight:800;color:var(--primary);font-size:14px}
li a{color:var(--text);text-decoration:none;font-weight:700;font-size:18px}li a:hover{color:var(--primary)}
li span{display:block;color:var(--muted);font-size:15px;margin-top:4px}code{color:var(--primary)}
</style></head><body><div class="wrap">
<h1>Front page and session page — refresh mockups</h1>
<p>Built from the approved <code>marketing-redesign</code> and <code>host-redesign</code> shells: tokens, washes, ladders and floors are read from those files at build time and only the refresh rules are new (<code>_src/refresh-home.css</code>, <code>_src/refresh-stage.css</code>). Press <b>N</b> to hide the design notes. Reload a stage page to replay its one performing sequence. <a href="RATIONALE.md" style="color:var(--primary)">RATIONALE.md</a> has the critique, the sources, the image requests and the implementation sequence.</p>
<ol>
<li><a href="01-home.html">01 — Home</a><span>The product in the first viewport, one filled amber per view, the route that draws itself, the tally that performs, two photographs requested.</span></li>
<li><a href="01m-home-mobile.html">01m — Home at 390px</a><span>Same markup in a 390px column; the stage still stacks under the claim and above the buttons.</span></li>
<li><a href="02-stage-ask.html">02 — Stage · ASK (call and answer, Room)</a><span>The phase wipe shipped, arrivals on the wall, a join code a latecomer can read. Simulated arrival at 2.5s.</span></li>
<li><a href="03-stage-results.html">03 — Stage · RESULTS (trivia, Room)</a><span>Recap, explanation and CORRECT flag restored; the reveal performs once; the standings move.</span></li>
</ol>
<p style="margin-top:30px">Switch profile on a stage page by editing the <code>&lt;html class="d-room"&gt;</code> class to <code>d-tv</code>, <code>d-call</code> or <code>d-table</code>, or open it through <code>../host-redesign/view.html</code>'s 1&ndash;4 keys.</p>
</div></body></html>
"""

def write(name, s):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f: f.write(s)
    print("wrote", name, len(s.encode()), "bytes")

write("01-home.html", home_page(False))
write("01m-home-mobile.html", home_page(True))
write("02-stage-ask.html", stage_page("ASK (call and answer) — stage refresh", ASK_BODY, ASK_NOTES,
      "<b>REFRESH · ASK</b> · Call &amp; Answer · Room · wipe on entry, arrivals in the meter column, code at secondary tier", ASK_JS))
write("03-stage-results.html", stage_page("RESULTS (trivia) — stage refresh", RESULTS_BODY, RESULTS_NOTES,
      "<b>REFRESH · RESULTS</b> · Trivia · Room · recap + explanation + CORRECT flag restored; reveal performs once; standings deltas", RESULTS_JS))
write("index.html", INDEX)

# The self-containment rule: nothing fetched from anywhere.
for n in ["01-home.html", "01m-home-mobile.html", "02-stage-ask.html", "03-stage-results.html"]:
    s = read(os.path.join(OUT, n))
    assert not re.search(r'https?://|<link |src="(?!data:)', s), n + " fetches something"
print("ok: no external asset in any mockup")
