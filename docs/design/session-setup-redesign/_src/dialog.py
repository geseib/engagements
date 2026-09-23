# -*- coding: utf-8 -*-
"""The create dialog (01-03), every state of the briefing (04), and the same
dialog in edit mode, opened over the preview stage (12).

Markup is GameSetupDialog.jsx's own — .gsd, .form-group, .gsd-pill,
.category-button, .gsd-opt, .gsd-section, .dialog-actions — so the shipped
stylesheet draws it. What is new carries ss- and lives in ss-dialog.css."""
from build import dialog_page, write, ico, mk_anno, BOARD_CSS
import build
from content import (TITLE, SET_NAME, SET_TOTAL, CATEGORIES, DOC_NAME, DOC_PAGES, DOC_MB, DOC_CHARS,
                     BRIEF_TEXT, BRIEF_LEN, BRIEF_CAP, PERSONA_DEFAULT, PERSONA_PICK, PERSONA_SHORT,
                     APPROACH_DEFAULT)

FORMATS = [("call", "Call &amp; Answer"), ("trivia", "Trivia"), ("poll", "Poll"), ("wave", "Wavelength")]
BLURB = {"call": "Open responses, then the room votes on the best ones.",
         "trivia": "Multiple choice with one correct answer and a scoreboard.",
         "poll": "Gauge opinion — no right answer, distribution is the result.",
         "wave": "Word association — a word counts when everyone says it. Works best with groups of ten or less."}
FMT_LABEL = dict(FORMATS)


# ------------------------------------------------------------------ pieces
def head(title, sub="", edit=False):
    lab = "Close without saving changes" if edit else "Close without creating"
    s = f'<p class="ss-sub">{sub}</p>' if sub else ""
    return (f'<div class="ss-head"><h2 id="gsd-heading">{title}</h2>{s}'
            f'<button type="button" class="gsd-close" aria-label="{lab}" title="{lab}">&times;</button></div>')


def title_field(value=TITLE):
    return (f'<div class="form-group"><label for="gsd-title">Event title</label>'
            f'<input id="gsd-title" type="text" class="dialog-input" value="{value}"></div>')


def format_group(active="call", edit=False):
    pills = "".join(
        f'<button type="button" class="gsd-pill{" on" if k == active else ""}" aria-pressed="{str(k == active).lower()}"'
        f'{" disabled" if edit else ""}>{v}</button>' for k, v in FORMATS)
    lock = ""
    if edit:
        lock = (f'<p class="ss-locked">{ico("lock")}<span>The format and question set are fixed once a session is created '
                f'— the question order was drawn from them. Create a new session to change either.</span></p>')
    return (f'<div class="form-group"><span class="gsd-label" id="gsd-format-label">Format</span>'
            f'<div class="gsd-types" role="group" aria-labelledby="gsd-format-label">{pills}</div>'
            f'<p class="gsd-blurb">{BLURB[active]}</p>{lock}</div>')


def set_row(selected=frozenset(), edit=False, fmt="call"):
    if fmt != "call":
        name, n = {"trivia": ("80s movie night", 48), "poll": ("Team pulse", 10),
                   "wave": ("Warm-up words", 20)}[fmt]
        opt = f"{name} ({n} questions)"
        return (f'<div class="gsd-row"><div class="form-group"><label for="gsd-set">Question set</label>'
                f'<select id="gsd-set" class="dialog-select"><option>{opt}</option></select>'
                f'<button type="button" class="gsd-setlink">Your question sets</button></div></div>')
    cats = "".join(
        f'<button type="button" class="category-button{" selected" if n in selected else ""}" '
        f'aria-pressed="{str(n in selected).lower()}"><span class="category-name">{n}</span>'
        f'<span class="category-count">({c})</span></button>' for n, c in CATEGORIES)
    if selected:
        qn = sum(c for n, c in CATEGORIES if n in selected)
        helptext = f"{len(selected)} of {len(CATEGORIES)} categories &middot; {qn} questions"
    else:
        helptext = f"None picked, so all {len(CATEGORIES)} are in &middot; {SET_TOTAL} questions"
    link = "" if edit else '<button type="button" class="gsd-setlink">Your question sets</button>'
    dis = " disabled" if edit else ""
    return (f'<div class="gsd-row"><div class="form-group"><label for="gsd-set">Question set</label>'
            f'<select id="gsd-set" class="dialog-select"{dis}><option>{SET_NAME} ({SET_TOTAL} questions)</option></select>{link}</div>'
            f'<div class="form-group"><span class="gsd-label" id="gsd-cat-label">Categories</span>'
            f'<div class="category-selection"><div class="category-button-grid" role="group" aria-labelledby="gsd-cat-label">{cats}</div>'
            f'<small class="dialog-help-text">{helptext}</small></div></div></div>')


BRIEF_HEAD = ('<h3 class="gsd-section">Workie&rsquo;s briefing<span class="ss-tag">Call &amp; Answer only</span></h3>')


def brief(state="empty"):
    """The briefing block in each of its states."""
    if state == "empty":
        return (f'<div class="ss-brief"><span class="ss-brief-ico">{ico("file")}</span><div class="ss-brief-main">'
                f'<p class="ss-brief-t">Brief Workie from a document <span class="ss-fine">&mdash; optional</span></p>'
                f'<p class="ss-brief-d">A report, a review, a plan: whatever explains the situation this session is about. '
                f'Workie gets a short summary of it &mdash; you read and can edit it first &mdash; and uses it when it reflects '
                f'the room&rsquo;s answers. <b>People who join never see it.</b></p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Choose a document</button>'
                f'<span class="ss-fine">PDF, Word or text &middot; up to 4 MB</span>'
                f'<button type="button" class="ss-btn ss-btn--link">or write the key points yourself</button></div></div></div>')
    if state == "working":
        return (f'<div class="ss-brief is-working"><span class="ss-brief-ico">{ico("file")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>{DOC_NAME}</b><span class="sep">&middot;</span>{DOC_MB}</div>'
                f'<ol class="ss-steps">'
                f'<li class="done"><span class="ss-dot" aria-hidden="true">&#10003;</span><span>Read {DOC_PAGES} pages <small>{DOC_CHARS} characters of text</small></span></li>'
                f'<li class="now"><span class="ss-dot" aria-hidden="true"></span><span>Writing the briefing&hellip; <small>usually under 15 seconds</small></span></li>'
                f'</ol><div class="ss-sweep" aria-hidden="true"><i></i></div>'
                f'<p class="ss-brief-d">Keep filling in the rest &mdash; nothing waits on this. The document itself is not kept.</p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn ss-btn--link">Stop and choose another</button></div></div></div>')
    if state == "ready":
        return (f'<div class="ss-brief is-ready"><span class="ss-brief-ico">{ico("file")}</span><div class="ss-brief-main">'
                f'<div class="ss-row"><div class="ss-src">From <b title="{DOC_NAME}">{DOC_NAME}</b><span class="sep">&middot;</span>{DOC_PAGES} pages</div>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Replace</button>'
                f'<button type="button" class="ss-btn">{ico("trash")}Remove</button></div></div>'
                f'<label class="gsd-label" for="ss-brief-text" style="margin:2px 0 0">What Workie will know</label>'
                f'<textarea id="ss-brief-text" class="dialog-textarea ss-brief-text" maxlength="{BRIEF_CAP}">{BRIEF_TEXT}</textarea>'
                f'<div class="ss-row"><p class="ss-kept"><b>2 names left out.</b> The summary keeps roles, not people &mdash; '
                f'nothing here is ever shown to the room.</p><small class="dialog-help-text" style="margin:0">{BRIEF_LEN:,}/{BRIEF_CAP:,} characters</small></div>'
                f'</div></div>')
    if state == "truncated":
        return (f'<div class="ss-brief is-limit"><span class="ss-brief-ico">{ico("warn")}</span><div class="ss-brief-main">'
                f'<div class="ss-src">From <b>fy26-support-annual-report.pdf</b><span class="sep">&middot;</span>60 pages</div>'
                f'<p class="ss-brief-t">Workie read the first 50,000 characters &mdash; about pages 1&ndash;38.</p>'
                f'<p class="ss-brief-d">The briefing below is written from those. If what matters is later in the document, '
                f'add it below in your own words, or upload just those pages.</p>'
                f'<textarea class="dialog-textarea ss-brief-text" style="min-height:96px">FY26 review of the support organisation.\n- Ticket volume grew 22% year on year…</textarea></div></div>')
    if state == "scanned":
        return (f'<div class="ss-brief is-limit"><span class="ss-brief-ico">{ico("warn")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>board-pack-scan.pdf</b><span class="sep">&middot;</span>9 pages</div>'
                f'<p class="ss-brief-t">No text in this PDF &mdash; it looks like scanned pages or pictures.</p>'
                f'<p class="ss-brief-d">Workie can only read text. Export the original again as a PDF (not a scan), or write '
                f'the few facts that matter yourself &mdash; numbers, problems, goals:</p>'
                f'<textarea class="dialog-textarea ss-brief-text" style="min-height:84px" placeholder="e.g. Open issues are up 15% on last quarter…"></textarea>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Choose another</button></div></div></div>')
    if state == "toolarge":
        return (f'<div class="ss-brief is-limit"><span class="ss-brief-ico">{ico("warn")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>q3-board-pack.pdf</b><span class="sep">&middot;</span>11.2 MB</div>'
                f'<p class="ss-brief-t">That file is 11.2 MB. The limit is 4 MB.</p>'
                f'<p class="ss-brief-d">Pictures are usually the weight. Save a smaller copy (in Preview: <b>File &rsaquo; Export &rsaquo; Reduce File Size</b>; '
                f'in Acrobat: <b>Compress PDF</b>), upload just the pages that matter, or write the key points yourself.</p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Choose another</button>'
                f'<button type="button" class="ss-btn ss-btn--link">write the key points yourself</button></div></div></div>')
    if state == "locked":
        return (f'<div class="ss-brief is-limit"><span class="ss-brief-ico">{ico("lock")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>incident-review-FINAL.pdf</b><span class="sep">&middot;</span>1.4 MB</div>'
                f'<p class="ss-brief-t">This PDF is protected with a password.</p>'
                f'<p class="ss-brief-d">Open it, save an unprotected copy, and upload that. Nothing was read.</p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Choose another</button></div></div></div>')
    if state == "pptx":
        return (f'<div class="ss-brief is-limit"><span class="ss-brief-ico">{ico("warn")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>q3-review-deck.pptx</b></div>'
                f'<p class="ss-brief-t">Slides can&rsquo;t be read here &mdash; save them as a PDF first.</p>'
                f'<p class="ss-brief-d">PowerPoint: <b>File &rsaquo; Save As &rsaquo; PDF</b>. Keynote: <b>File &rsaquo; Export To &rsaquo; PDF</b>. '
                f'Google Slides: <b>File &rsaquo; Download &rsaquo; PDF</b>.</p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("upload")}Choose another</button></div></div></div>')
    if state == "failed":
        return (f'<div class="ss-brief is-failed"><span class="ss-brief-ico">{ico("warn")}</span><div class="ss-brief-main">'
                f'<div class="ss-src"><b>{DOC_NAME}</b><span class="sep">&middot;</span>{DOC_PAGES} pages read</div>'
                f'<p class="ss-brief-t">The document was read, but Workie couldn&rsquo;t write the briefing.</p>'
                f'<p class="ss-brief-d">The AI service didn&rsquo;t answer in time. Nothing is lost: try again, or write the key points yourself.</p>'
                f'<div class="ss-brief-acts"><button type="button" class="ss-btn">{ico("revert")}Try again</button>'
                f'<button type="button" class="ss-btn ss-btn--link">write the key points yourself</button></div></div></div>')
    raise ValueError(state)


def summary_line(fmt="call", changed=None):
    """The Advanced <summary>: every default in force, changes named first in amber."""
    defaults = []
    if fmt == "call":
        defaults.append("answers anonymous until voting closes")
    defaults.append("questions shuffled")
    wk = f"the standard {FMT_LABEL[fmt]} summary"
    if changed:
        rest = ", ".join(defaults + [wk])
        return f'<b>Changed: {changed}.</b> Otherwise the defaults &mdash; {rest}.'
    return (f'Using the defaults &mdash; {", ".join(defaults)}; Workie adapts its voice and gives {wk}. '
            f'<span class="ss-open-only">Change any of them here.</span>')


def responses_card():
    return """<div class="gsd-opt is-on">
  <label class="gsd-opt-head"><input type="checkbox" checked><span class="gsd-opt-name">Anonymous responses</span><span class="gsd-opt-state" aria-hidden="true">On</span></label>
  <p class="gsd-opt-does">Until voting closes, nobody sees who wrote which answer &mdash; not the room, not you. The room votes on the answers, not on the people. You can also reveal the names earlier if you want to.</p>
  <div class="gsd-preview"><div class="gsd-pv"><h6>While voting</h6><p class="gsd-pv-ans">&ldquo;Prioritise the easy-fix tickets so they get done immediately&hellip;&rdquo;</p><p class="gsd-pv-who">Response 1</p></div>
  <div class="gsd-pv"><h6>After voting closes</h6><p class="gsd-pv-ans">&ldquo;Prioritise the easy-fix tickets so they get done immediately&hellip;&rdquo;</p><p class="gsd-pv-who named">Priya Raghavan &middot; +18 pts</p></div></div>
  <p class="gsd-opt-else"><b>Turn it off</b> and every answer is labelled with its author from the moment voting opens.</p>
  <p class="gsd-opt-limit">This hides names, not identities. In a small group, people may still recognise each other&rsquo;s answers.</p>
</div>"""


def shuffle_card(edit=False):
    lim = ('<p class="gsd-opt-limit">Fixed once the session is created &mdash; the question order was drawn when this session was set up.</p>'
           if edit else "")
    return f"""<div class="gsd-opt is-on">
  <label class="gsd-opt-head"><input type="checkbox" checked{" disabled" if edit else ""}><span class="gsd-opt-name">Shuffle the question order</span><span class="gsd-opt-state" aria-hidden="true">On</span></label>
  <p class="gsd-opt-does">Questions are drawn at random from the categories you picked, rather than in the order they were written.</p>{lim}
</div>"""


def workie_fields(voice_changed=False):
    v_opts = f'<option{"" if voice_changed else " selected"}>{PERSONA_DEFAULT}</option><option{" selected" if voice_changed else ""}>{PERSONA_PICK}</option>'
    v_help = ("Workie keeps this voice for the whole session. You can change it between rounds."
              if voice_changed else
              "Workie reads the room and picks its own register &mdash; playful for an icebreaker, analytical for a retro.")
    return f"""<div class="form-group"><label for="gsd-persona">Workie&rsquo;s voice</label>
    <select id="gsd-persona" class="dialog-select">{v_opts}</select>
    <small class="dialog-help-text">{v_help}</small></div>
<div class="form-group"><label for="gsd-prompt">Summary approach</label>
    <select id="gsd-prompt" class="dialog-select"><option>{APPROACH_DEFAULT}</option><option>Problem-Solving - Solution Architecture</option></select>
    <small class="dialog-help-text">How Workie sums up each round &mdash; the shape and content, where the voice is only the register.</small></div>
<div class="form-group"><label for="gsd-ai-context">Instructions for Workie</label>
  <textarea id="gsd-ai-context" class="dialog-textarea" rows="2" maxlength="500" placeholder="Anything Workie must always do &mdash; e.g. &lsquo;end every round with one question for the ops leads&rsquo;"></textarea>
  <small class="dialog-help-text">Workie treats these as rules for every round. Facts about the situation belong in the briefing. 0/500 characters</small></div>"""


def people_fields():
    return """<div class="form-group"><label for="gsd-details">Event details</label>
  <textarea id="gsd-details" class="dialog-textarea" rows="2" maxlength="300" placeholder="What this session is for, in a sentence or two."></textarea>
  <small class="dialog-help-text">Shown to people on the screen they land on after joining. Workie reads it too. 0/300 characters</small></div>"""


def advanced(open_=False, fmt="call", changed=None, edit=False, voice_changed=False):
    body = ""
    if open_:
        parts = []
        if fmt == "call":
            parts.append('<h3 class="gsd-section">Responses</h3>' + responses_card())
        parts.append('<h3 class="gsd-section">Questions</h3>' + shuffle_card(edit))
        parts.append('<h3 class="gsd-section">Workie</h3>' + workie_fields(voice_changed))
        parts.append('<h3 class="gsd-section">What people see when they join</h3>' + people_fields())
        body = '<div class="ss-adv-body">' + "".join(parts) + "</div>"
    return (f'<details class="ss-adv"{" open" if open_ else ""}><summary>'
            f'<span class="ss-adv-k"><i class="ss-chev" aria-hidden="true"></i>Advanced</span>'
            f'<span class="ss-adv-s">{summary_line(fmt, changed)}</span></summary>{body}</details>')


def foot(primary="Create engagement", note="Nobody can join until you open the doors.", confirm=False):
    if confirm:
        return ('<div class="dialog-actions ss-foot is-confirm" role="alertdialog" aria-label="Discard changes?">'
                '<p class="ss-confirm-t"><b>Discard your changes?</b> The edited briefing and the new title are lost; the session stays as it was.</p>'
                '<button type="button" class="btn-secondary">Keep editing</button>'
                '<button type="button" class="btn-danger-deep">Discard</button></div>')
    return (f'<div class="dialog-actions ss-foot"><p class="ss-foot-note">{ico("door")}{note}</p>'
            f'<button type="button" class="btn-secondary">Cancel</button>'
            f'<button type="button" class="btn-primary">{primary}</button></div>')


def card(inner, extra_cls=""):
    return (f'<div class="new-game-dialog gsd ss-dlg {extra_cls}" role="dialog" aria-modal="true" aria-labelledby="gsd-heading">'
            f'{inner}</div>')


def create_dialog(brief_state="empty", adv_open=False, changed=None, voice_changed=False, selected=frozenset()):
    return card(
        head("New engagement") +
        '<div class="dialog-content">' +
        title_field() + format_group("call") + set_row(selected) +
        BRIEF_HEAD + brief(brief_state) +
        advanced(adv_open, "call", changed, voice_changed=voice_changed) +
        '</div>' + foot())


# ------------------------------------------------------------------- pages
def build():
    # ---------------------------------------------------- 01 advanced closed
    notes = "".join([
        mk_anno("Three decisions up front", "Title, format and question set are the only fields that can&rsquo;t default &mdash; the shipped guard already knows it: Create stays disabled until a set and a title exist (<code>GameSetupDialog.jsx:197</code>). Categories stay beside the set because they change <i>what</i> gets asked; everything that changes <i>how</i> moved under Advanced."),
        mk_anno("The summary line is the promise", "Closed, Advanced says every default in force: anonymous until voting closes, shuffled, Workie adapts its voice, the standard Call &amp; Answer summary. That sentence replaces the old green plan line (<code>:741-749</code>) &mdash; one statement of the plan, not two."),
        mk_anno("The briefing sits in the main view", "It is optional, but it is the one Workie input that changes what Workie <i>knows</i>, and an upload hidden under Advanced is one nobody finds. It is a single dashed row until used. Call &amp; Answer only &mdash; the section is not rendered for other formats."),
        mk_anno("Created closed", "The foot says what Create does to the room: nothing. A session is born <code>State: CREATED</code> with <code>Started: false</code> (<code>schema-compliant-manager.js:218,241-257</code>) and every join is refused until it starts (<code>session-gate.js:57-70</code>). Create now lands on the preview stage instead of the history list (<code>GameHostPage.jsx:4404-4410</code>)."),
        mk_anno("Exits you can see", "Head and foot are sticky. Today the whole card scrolls (<code>styles.css</code> <code>.new-game-dialog</code>: <code>max-height:90vh; overflow-y:auto</code>), so the absolute X leaves with the title and Cancel waits below the last field."),
        mk_anno("A defect fixed on the way", "Rendering the two shipped sheets together shows an <b>unselected</b> category name at <code>#333</code> on the dusk card &mdash; 1.15:1. <code>styles.css:4858</code> colours <code>.category-name</code> directly; the dialog re-colours only the count (<code>GameSetupDialog.css:312-316</code>). One rule in ss-dialog.css; it moves into the dialog&rsquo;s sheet."),
    ])
    write("01-create.html", dialog_page("New engagement — Advanced closed", create_dialog(), notes), "create")

    # ---------------------------------------------------- 02 advanced open
    notes = "".join([
        mk_anno("Everything that has a safe default", "Responses, question order, Workie&rsquo;s voice and approach, instructions and event details. Each keeps its shipped control and copy (<code>GameSetupDialog.jsx:542-739</code>); only the grouping and two labels change."),
        mk_anno("A change is named in the summary", "The voice was switched, so the summary leads with <b>Changed: Workie speaks as The Business Advisor</b> in amber, then the defaults still in force. Close the section and the decision is still on screen."),
        mk_anno("‘AI context’ says what it does", "Renamed <b>Instructions for Workie</b>. The prompt already treats it as the host&rsquo;s rules: it rides the last block with ‘EVERY section must contain…’ enforcement (<code>personas.js:488-529</code>). Facts about the situation belong in the briefing, which is weighted differently (40)."),
        mk_anno("Event details: who sees it", "Grouped under <i>What people see when they join</i>, because that is its main job (<code>GameSetupDialog.jsx:644-647</code>); it also reaches Workie as ABOUT THIS SESSION (<code>personas.js:655-657</code>)."),
        mk_anno("Consistent with the survey start", "Responses is Call &amp; Answer only: polls lost their vote phase on 23 Sep, so <code>anonymityApplies</code> narrows from three formats to one (<code>config/anonymity.js:19-21</code>). A survey, when it ships, shows the three-way <b>Names</b> choice here instead &mdash; survey-redesign 07 re-cuts this same card."),
        mk_anno("Room settings stay on the stage", "Auto-advance, names while waiting and comments on the wall are judgements about <i>this</i> room at run time (<code>config/gameSession.js:122-137</code>) and stay in the stage&rsquo;s Setup panel. Advanced holds only what the session is."),
    ])
    write("02-create-advanced.html",
          dialog_page("New engagement — Advanced open",
                      create_dialog(adv_open=True, changed=f"Workie speaks as {PERSONA_SHORT}", voice_changed=True), notes,
                      scroll_adv=True),
          "create")

    # ---------------------------------------------------- 03 briefing ready
    notes = "".join([
        mk_anno("Read it before the room does", "The owner: the doc &lsquo;would be summerized to inform the workie&rsquo;. The summary is the thing the host signs off, so it is on screen in full, in an ordinary textarea, editable to the last character. 1,500 characters at most &mdash; about eight facts."),
        mk_anno("Facts, not the file", "Only this text is kept. The PDF goes to <code>admin/parse-document.js</code>, which returns text and stores nothing (<code>:68-80</code>); the text goes to a new stateless summariser; the file and the full text are dropped in the browser. See 40 for why."),
        mk_anno("Names left out, and said so", "The summariser swaps people for roles. The count is shown because a silent removal is a reduction with no recovery &mdash; the host can add a name back by typing it, knowing Workie may then say it on the wall."),
        mk_anno("Replace and Remove", "Replace runs the same two steps again; Remove clears the briefing (the session then carries none). Both are plain buttons inside the block &mdash; no second dialog."),
        mk_anno("Workie still has a default", "The Advanced summary lists what the briefing does not change. A briefing is additive: the voice, the approach and the format contract are exactly what they were (40)."),
    ])
    write("03-briefing-ready.html",
          dialog_page("New engagement — the briefing, ready to check",
                      create_dialog("ready", selected=frozenset({"Backlog", "Handoffs", "Tooling"})), notes),
          "create")

    # ---------------------------------------------------- 04 states (sheet)
    def st(cap, inner, sub=""):
        return (f'<figure class="ss-st"><figcaption><b>{cap}</b>{f"<span>{sub}</span>" if sub else ""}</figcaption>'
                f'<div class="new-game-dialog gsd ss-dlg ss-mini"><div class="dialog-content">{inner}</div></div></figure>')

    seq = "".join([
        st("1 · Nothing chosen", BRIEF_HEAD + brief("empty"), "The invitation. Optional, one row."),
        st("2 · Reading, then writing", BRIEF_HEAD + brief("working"), "parse-document, then the summariser."),
        st("3 · Ready to check", BRIEF_HEAD + brief("ready"), "Editable; this is what Workie gets."),
    ])
    errs = "".join([
        st("No text — scanned pages", BRIEF_HEAD + brief("scanned"), "parse-document succeeds with almost no text."),
        st("Too large", BRIEF_HEAD + brief("toolarge"), "Refused in the browser, before any upload."),
        st("Long document", BRIEF_HEAD + brief("truncated"), "Past 50,000 characters, the text is cut."),
        st("Password-protected", BRIEF_HEAD + brief("locked"), "pdf-parse throws; nothing read."),
        st("Slides, not a PDF", BRIEF_HEAD + brief("pptx"), "The one wrong type with a known way out."),
        st("The summariser failed", BRIEF_HEAD + brief("failed"), "A fault, so the danger rule."),
    ])
    lines = "".join(
        f'<figure class="ss-st"><figcaption><b>{lab}</b></figcaption><div class="new-game-dialog gsd ss-dlg ss-mini"><div class="dialog-content">'
        f'{advanced(False, fmt, ch)}</div></div></figure>'
        for lab, fmt, ch in [("Call &amp; Answer", "call", None), ("Trivia", "trivia", None),
                             ("Poll or Wavelength", "poll", None),
                             ("Call &amp; Answer, two changes", "call", "responses named from the start, Workie speaks as The Business Advisor")])
    lines = lines.replace("the standard Poll summary", "the standard Poll (or Wavelength) summary")
    confirm = (f'<figure class="ss-st ss-wide"><figcaption><b>Closing with work in hand</b><span>X, Cancel and Escape all reach one requestClose().</span></figcaption>'
               f'<div class="new-game-dialog gsd ss-dlg ss-mini">{foot(confirm=True)}</div></figure>')
    body = f"""<main class="ss-sheet">
<h1>The briefing, every state &mdash; and the Advanced line per format</h1>
<p class="lede">Each card is the real dialog stylesheet (GameSetupDialog.css + ss-dialog.css) drawing one section. The top row is the happy path; the second is every way a document can fail to become a briefing, each with the one action that can succeed. Amber is a fact about the file; red is only for something that broke.</p>
<h2>Upload &rarr; read &rarr; write &rarr; check</h2><div class="ss-grid">{seq}</div>
<h2>When a document does not become a briefing</h2><div class="ss-grid">{errs}</div>
<h2>The Advanced summary line, per format</h2><div class="ss-grid">{lines}</div>
<h2>Closing the dialog</h2><div class="ss-grid">{confirm}</div>
</main>"""
    sheet_css = BOARD_CSS + """
body{background:#0B1322}
.ss-sheet{padding:26px 30px 60px}
.ss-sheet h1{font:800 24px/1.15 "Archivo Expanded","Archivo",system-ui,sans-serif;margin:0 0 6px;color:#F4EDE4}
.ss-sheet .lede{color:#B6C2D4;margin:0 0 22px;max-width:96ch;font-size:15px}
.ss-sheet h2{font:800 15px/1.2 "Inter",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#9BA8BE;margin:26px 0 12px}
.ss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:22px;align-items:start}
.ss-st{margin:0;min-width:0}
.ss-st.ss-wide{grid-column:1/-1;max-width:720px}
.ss-st figcaption{font:700 12px/1.4 "Inter",system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#B6C2D4;margin:0 0 8px}
.ss-st figcaption b{color:#F6A94C}
.ss-st figcaption span{display:block;text-transform:none;letter-spacing:0;font-weight:400;margin-top:2px;color:#9BA8BE}
.gsd.new-game-dialog.ss-mini{max-height:none;overflow:visible;max-width:none}
.gsd.ss-mini .dialog-content{padding:4px 22px 16px}
.gsd.ss-mini .gsd-section{margin-top:12px}
.gsd.ss-mini .ss-adv{margin:0;border-top:0}
.gsd.ss-mini .dialog-actions.ss-foot{position:static;border-radius:0 0 14px 14px}
"""
    notes = "".join([
        mk_anno("Two steps, two honest indicators", "Reading is a step that finishes (pages and characters come back from <code>parse-document.js:74-79</code>). Writing is one Bedrock call that returns once, so it gets a sweep and an expected time, never a fake percentage (component-library §5)."),
        mk_anno("Scanned PDFs are not an error", "<code>pdf-parse</code> returns an empty string for image-only pages and <code>parse-document</code> reports success (<code>:99-108</code>). Under 200 characters of text is treated as ‘no text’: amber, the reason, and the box to type the facts yourself. OCR is an open question, not built."),
        mk_anno("4 MB, not the 5 MB the uploader claims", "<code>FileUploadPrompt</code> defaults to 5 MB (<code>:10</code>) but base64 inflates a file by ~37% and a synchronous Lambda request caps at 6 MB, so anything over ~4.3 MB fails after the upload. It already warns about this (<code>:39-42</code>). The briefing passes <code>maxFileSize</code> 4 MB and refuses before sending."),
        mk_anno("Long documents are cut, and say where", "<code>cleanText</code> truncates at 50,000 characters with a bare ‘[truncated]’ (<code>parse-document.js:144-148</code>). The response grows <code>truncated</code> and <code>pages</code>, so the host is told which part Workie read."),
        mk_anno("Slides get the way out", "PDF, Word and text are what <code>parse-document</code> reads (<code>:43-60</code>). A .pptx is refused with how to save it as PDF from each tool &mdash; the agenda design&rsquo;s deck upload uses the same three lines."),
        mk_anno("One close, one rule", "The shipped dialog discards on X and Escape by design (<code>GameSetupDialog.jsx:357-364</code>). A briefing is minutes of work and a model call, so with one in hand both exits ask first &mdash; inline in the foot, never a second modal."),
    ])
    from build import ANNO_CSS, NOTES_JS, DIALOG_BASE, GSD_CSS, SS_DIALOG, sprite, rail_html
    html = f"""<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The briefing, every state</title>
<style>
{DIALOG_BASE}
body{{margin:0;font-family:var(--font-ui);line-height:1.6;color:var(--text)}}
*,*::before,*::after{{box-sizing:border-box}}
{GSD_CSS}
{SS_DIALOG}
{sheet_css}
{ANNO_CSS}
</style></head>
<body class="mk-anno-on">{sprite()}
{body}
{rail_html(notes)}
</body></html>"""
    write("04-briefing-states.html", html, "create")

    # ---------------------------------------------------- 12 edit in preview
    edit = card(
        head("Edit session", "Preview &middot; nobody can join yet", edit=True) +
        '<div class="dialog-content">' +
        title_field("Support Ops Review — Q3 (with Tier 2)") + format_group("call", edit=True) +
        set_row(frozenset({"Backlog", "Handoffs", "Tooling"}), edit=True) +
        BRIEF_HEAD + brief("ready") +
        advanced(False, "call", f"Workie speaks as {PERSONA_SHORT}") +
        '</div>' + foot("Save changes", "Saving changes nothing for the room &mdash; the doors are still closed."))
    behind = '<iframe class="ss-behind" src="10-preview-lobby.html#bare" title="The preview stage behind the dialog" tabindex="-1"></iframe>'
    notes = "".join([
        mk_anno("The same dialog, from the stage", "Edit opens <code>GameSetupDialog mode=&quot;edit&quot;</code> &mdash; the component that already exists (<code>GameHostPage.jsx:4915-4927</code>) &mdash; over the preview, and Save brings the host back to it. Today edit is an early return over a blank page, reached only from the history list."),
        mk_anno("What can change here", "Everything <code>PUT /games/{id}</code> accepts while the session is <code>CREATED</code>: title, details, instructions, voice, approach, anonymity and the category subset (<code>update-game.js:69-72</code>) &mdash; plus the new <code>briefing</code>."),
        mk_anno("What cannot, and why", "Format, question set and shuffle pin rows at create time: the set version, the per-category ORDER shuffles, STATE#CATS (<code>update-game.js:28-35</code>). Offering them live would be a form that lies about what Save does, so they show disabled with the reason."),
        mk_anno("A stale sentence corrected", "The shipped edit note says ‘The format, question set <b>and categories</b> are fixed’ (<code>GameSetupDialog.jsx:424-425</code>) directly above a category grid that is live and saves (<code>update-game.js:26-27</code>). The note drops ‘categories’."),
        mk_anno("Exits that ask", "With the title and the briefing edited, X and Cancel both turn the foot into ‘Discard your changes?’ (04). Escape answers the same way; the backdrop stays inert, as shipped (<code>:339-344</code>)."),
    ])
    write("12-preview-edit.html",
          dialog_page("Edit session — from the preview", edit, notes, behind=behind).replace(
              '<div class="new-game-overlay">', '<div class="new-game-overlay ss-lighter">'),
          "preview")
