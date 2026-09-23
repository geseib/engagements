# -*- coding: utf-8 -*-
"""The wall. The preview lobby (10), stepping through the first round (11),
and Workie's read-back that uses the briefing (30). Every page is the audited
stage (stage-base.css + refresh-stage.css) with ss-stage.css on top."""
from build import stage_page, write, mk_anno, ico
from content import TITLE, CODE, URL, QUESTION, QUESTION_DETAIL, WORKIE_MD, SET_TOTAL, qr_svg, PERSONA_SHORT

DOOR = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
        'stroke-linejoin="round" aria-hidden="true"><path d="M5 20.4h14"/><path d="M7 20.4V4.6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.8"/>'
        '<circle cx="14" cy="12.4" r=".9"/></svg>')


def rail(chip, chip_cls, ctx):
    return (f'<header class="rail"><span class="chip {chip_cls}"><span class="dot"></span>{chip}</span>'
            f'<span class="rail-title" data-drop="1">{TITLE}</span><span class="rail-ctx">{ctx}</span>'
            f'<div class="rail-join"><span data-drop="2">JOIN</span><span data-drop="3">{URL}</span><code>{CODE}</code></div></header>')


def dock(status, buttons, primary, kbd="SPACE"):
    return (f'<footer class="dock"><button class="dock-more" type="button" aria-label="Session setup" '
            f'title="Session setup — backslash key">&#8943;<span class="dock-more-lbl">Setup</span></button>'
            f'<span class="status" aria-live="polite">{status}</span><span class="spacer"></span>{buttons}'
            f'<span class="kbd">{kbd}</span><button class="btn primary" type="button">{primary}</button></footer>')


def md(blocks):
    out = []
    for kind, v in blocks:
        if kind == "h":
            out.append(f"<h2>{v}</h2>")
        elif kind == "p":
            out.append(f"<p>{v}</p>")
        else:
            items = "".join(f"<li>{x}</li>" for x in v)
            out.append(f"<{kind}>{items}</{kind}>")
    return "".join(out)


def build():
    # ---------------------------------------------------------- 10 preview
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Preview", "ss-preview", f'<span>Call &amp; Answer</span><i>/</i><b>{SET_TOTAL} rounds</b>')}<div class="bar" data-phase="preview" role="presentation"></div>
  <div class="main">
    <div class="content" data-grow="1.5"><div class="fitbox center">
      <div class="kicker ss-soon">Opening soon &middot; scan now and your phone lets you in when it opens</div>
      <div class="joinblock"><div class="qr">{qr_svg()}</div>
        <div class="joininfo"><div class="lbl">Open on your phone</div><div class="url">{URL}</div>
          <div class="lbl">Session code</div><div class="code">{CODE}</div></div></div>
      <p class="anon-line" data-drop="2" data-drop-note="Anonymity note"><b>Answers are anonymous.</b> Nobody sees who wrote what &mdash; the host included &mdash; until voting closes.</p>
    </div></div>
    <aside class="meter"><h4>Doors</h4><div class="ss-doors">{DOOR}Closed</div></aside>
  </div>
  {dock("Look it over, then open the doors",
        '<button class="btn ghost" type="button">Edit</button><button class="btn ghost" type="button" title="Look at round 1 as the room will see it — nothing is asked">Round 1 &rsaquo;</button>',
        "Open the doors")}
</main>"""
    notes = "".join([
        mk_anno("A state the server already has", "Nothing new is stored for preview. A created session is <code>State: CREATED</code>, <code>Started: false</code> (<code>schema-compliant-manager.js:218,241-257</code>), and the join gate refuses it with 403 ‘Game not started’ before it looks at names (<code>session-gate.js:57-70</code>). Preview is that session, on the stage."),
        mk_anno("Today there is no way to look", "<b>Open</b> &mdash; ‘look at the stage without starting’ &mdash; was removed from the history row (<code>SessionHistoryPanel.jsx:50-79</code>), and a session opened from a link while unstarted bounces to the history list (<code>GameHostPage.jsx:1618-1624</code>). Start is the only way onto the stage, and it lets people in."),
        mk_anno("The lobby, told the truth", "Everything the room will see once open is here: title, code, QR, the anonymity line. The kicker changes from ‘Scan to join’ to what is true now. A dashed chip and a dashed band are the only new marks &mdash; ‘not yet’ without a fifth phase colour."),
        mk_anno("One word in the meter", "‘In the room: 0’ would be a count that means ‘closed’. The meter says <b>Closed</b>. Nothing else repeats it: the chip names the state, the kicker tells the room what to do."),
        mk_anno("The primary opens the doors", "Today&rsquo;s lobby primary is ‘Start First Round’, disabled until a player joins (<code>config/hostControls.js:228-240</code>) &mdash; in a closed session it would read ‘At least one player has to join first’ forever. Preview&rsquo;s primary is <b>Open the doors</b>: <code>POST /games/{id}/start</code>, which already flips <code>Started</code> and moves the TTL to 7 days (<code>start-game.js:67-114</code>)."),
        mk_anno("Edit and look ahead", "<b>Edit</b> opens the edit dialog over this screen (12). <b>Round 1 &rsaquo;</b> (and the → key) steps through the plan read-only (11). The Setup panel&rsquo;s category toggles already work before start (<code>SessionHistoryPanel.jsx:67-69</code>)."),
    ])
    write("10-preview-lobby.html", stage_page("Preview — the lobby, doors closed", body, notes,
                                              tag="<b>10</b> · preview · lobby · Room 1920×1080"), "preview")

    # ---------------------------------------------------------- 11 look at round 1
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Preview", "ss-preview", f'<span>Backlog</span><i>/</i><b>Round 1</b><span>of {SET_TOTAL}</span>')}<div class="bar" data-phase="preview" role="presentation"></div>
  <div class="main solo">
    <div class="content" data-grow="1.35"><div class="fitbox">
      <div class="kicker ss-pk">Preview &middot; <b>round 1</b> as the room will see it &middot; nothing is asked yet</div>
      <h1 class="q">{QUESTION}</h1>
      <p class="qdetail" data-drop="1" data-drop-note="Full prompt">{QUESTION_DETAIL}</p>
      <p class="anon-line" data-drop="3" data-drop-note="Anonymity note"><b>Answers are anonymous.</b> Nobody sees who wrote what &mdash; the host included.</p>
    </div></div>
  </div>
  {dock("The plan&rsquo;s first question &middot; read-only",
        '<button class="btn ghost" type="button">&lsaquo; Lobby</button><button class="btn ghost" type="button">Round 2 &rsaquo;</button>',
        "Open the doors")}
</main>"""
    notes = "".join([
        mk_anno("‘Step through what the room will see’", "The plan, not a guess. <code>GET /games/{id}/up-next</code> runs the same <code>pickIndex</code> that <code>next-question.js</code> will run at the moment, over copies, writing nothing (<code>up-next.js:12-26</code>). Round 1 here is round 1 there &mdash; unless a category is toggled first, and then this simply re-reads."),
        mk_anno("Read-only, and marked", "Nothing is asked, spent or broadcast. The kicker says ‘Preview · round 1 · nothing is asked yet’ at room size, and the chip stays <b>Preview</b>, because the host may be looking at this on the projector."),
        mk_anno("Trivia gives answers away", "A trivia question on a projector the room can already see is a question answered early. For trivia the step-through asks once: ‘The room may see these — look anyway?’ Call &amp; Answer, poll and wavelength step straight in."),
        mk_anno("How far", "‹ Lobby and Round N › step one at a time, up to five ahead (<code>up-next.js</code>&rsquo;s default count). Further than that, the Setup panel&rsquo;s Questions tab already lists the order."),
    ])
    write("11-preview-round.html", stage_page("Preview — round 1, read-only", body, notes,
                                              tag="<b>11</b> · preview · stepping through · Room 1920×1080"), "preview")

    # ---------------------------------------------------------- 30 workie with the brief
    body = f"""
<main class="stage">
  <div class="field alpenglow" aria-hidden="true"></div>
  {rail("Results", "results", f'<span>Backlog</span><i>/</i><b>Round 1</b><span>of {SET_TOTAL}</span>')}<div class="bar" data-phase="results" role="presentation"></div>
  <div class="main solo">
    <div class="content" data-grow="1.35"><div class="fitbox">
      <div class="kicker">What we heard</div>
      <div class="notes"><div class="notes-md">{md(WORKIE_MD)}</div></div>
      <p class="pager" data-drop="2"><span>What we heard &middot; all on one page</span></p>
      <div class="fn-controls" data-drop="1">
        <label>Voice (next round)</label><select><option>{PERSONA_SHORT}</option></select>
        <button type="button">Redo</button>
        <label>Approach (next round)</label><select><option>What the set says</option></select>
        <span class="ss-briefed" title="This round was read with the session's briefing"><i></i>Briefing on</span>
      </div>
    </div></div>
  </div>
  {dock("Discussion prompt on screen", '<button class="btn ghost" type="button">&lsaquo; Results</button>', "Next Round")}
</main>"""
    notes = "".join([
        mk_anno("The owner&rsquo;s example, on the wall", "Doc: issues up 15%, MTTR stretched to three weeks. Answer: ‘prioritise easy-fix tickets so they get done immediately’. Workie: the classic quick-win play (its own knowledge) &mdash; <i>and</i> the fastest lever on an MTTR ‘the brief puts at three weeks’ (the briefing)."),
        mk_anno("Cited as the brief, never as the room", "Every briefing fact is said as the brief&rsquo;s (‘the brief puts…’, ‘which the brief says…’). The room&rsquo;s words are quoted as the room&rsquo;s. The prompt block that makes this so, and the test that holds it, are on 40."),
        mk_anno("Numbers only as the brief states them", "The default Call &amp; Answer prompt forbids any number not copyable from its material (rule 2, <code>admin/default-ai-prompts.json:6</code>). The briefing joins that material, so ‘three weeks’ is allowed and an invented ‘cut MTTR by 40%’ still is not."),
        mk_anno("No names from the document", "The summariser dropped the two people the PDF names, and the host saw that count (03). The prompt also says it: never name a person from the briefing. <code>content.check()</code> fails this build if either name reaches this page."),
        mk_anno("A host mark, not a room mark", "<b>Briefing on</b> sits with the voice and approach controls &mdash; host chrome, droppable, label tier (<code>stage.css:891-899</code>). It never shows the file name: this line is on the projector too."),
        mk_anno("Where these words come from", "This is the shipped markdown path (<code>AISummaryStatus.jsx:97-108</code>): <code>##</code> headings, two columns, paged at the headings. The briefing changes what Workie knows, not the shape it answers in."),
    ])
    write("30-workie-briefed.html", stage_page("What we heard — Workie uses the briefing", body, notes,
                                               tag="<b>30</b> · FIELD_NOTES · briefed · Room 1920×1080"), "workie")
