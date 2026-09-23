# -*- coding: utf-8 -*-
"""Boards: real pages side by side, each in an iframe at its own device size.
22 — the preview from both sides of the door. 31 — the owner's MTTR example,
end to end, from the document to the wall."""
from build import board_page, frame, mk_anno, write
from content import DOC_NAME, DOC_NAMES

PW, PH, PS = 390, 844, 0.62          # a phone
SW, SH, SS = 1920, 1080, 0.40        # the wall, Room profile
DW, DH, DS = 1600, 1000, 0.44        # the laptop, for a dialog page


def phone(src, cap):
    return frame(src + "#bare", PW, PH, PS, cap, "phone")


def wall(src, cap, s=SS):
    return frame(src + "#bare", SW, SH, s, cap, "stage")


def laptop(src, cap, s=DS):
    return frame(src + "#bare", DW, DH, s, cap, "laptop")


DOC_CSS = """
.ss-doc{width:420px;min-height:340px;background:#FBF7F1;color:#1B2942;border-radius:10px;padding:22px 24px;
  box-shadow:0 18px 44px rgba(0,0,0,.45);font:400 13px/1.55 "Inter",system-ui,sans-serif}
.ss-doc h3{font:800 16px/1.2 "Inter",system-ui,sans-serif;margin:0 0 4px}
.ss-doc .m{font-size:12px;color:#5E6167;margin:0 0 12px}
.ss-doc table{border-collapse:collapse;width:100%;margin:8px 0 10px;font-size:12.5px}
.ss-doc td,.ss-doc th{border-bottom:1px solid #E4DDD1;padding:5px 4px;text-align:left}
.ss-doc th{font-size:12px;color:#5E6167;text-transform:uppercase;letter-spacing:.06em}
.ss-doc mark{background:rgba(246,169,76,.35);color:inherit;padding:0 2px;border-radius:3px}
.ss-doc p{margin:0 0 8px}
.ss-flow{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
.ss-arrow{align-self:center;font:800 28px/1 "Inter",system-ui,sans-serif;color:#F6A94C}
"""


def build():
    # ------------------------------------------------ 22 both sides of the door
    body = f"""
<h1>Preview: both sides of the door</h1>
<p class="lede">The host looks, edits and steps through with the doors closed; a phone that scans the code meanwhile is told it is not open yet and waits with its name typed; the host presses <b>Open the doors</b> and every waiting phone lets itself in. Open any frame on its own to see it full size.</p>
<div class="row">
{wall("10-preview-lobby.html", "<b>The stage, in preview</b><span>Dashed chip and band; the meter says Closed; the primary opens the doors</span>")}
{phone("20-phone-not-open.html", "<b>A phone that scans now</b><span>Keeps the name; checks by itself</span>")}
</div>
<div class="row">
{laptop("12-preview-edit.html", "<b>Edit, from the preview</b><span>The shipped edit dialog, over the stage, with the briefing</span>", 0.38)}
{wall("11-preview-round.html", "<b>Stepping through</b><span>The plan&rsquo;s round 1, read-only</span>", 0.30)}
</div>
<div class="row">
{phone("../player-redesign/05-lobby.html", "<b>After Open the doors</b><span>The waiting phone joins itself and lands here (player-redesign 05)</span>")}
{phone("../player-redesign/03-join-ended.html", "<b>The family it belongs to</b><span>player-redesign 03: say what happened, offer only what can succeed</span>")}
</div>"""
    notes = "".join([
        mk_anno("The state model", "<b>Created</b> (closed, not on any stage) &rarr; <b>Preview</b> (closed, on the stage: a view, not a stored state) &rarr; <b>Open</b> (<code>Started: true</code>, joins accepted, lobby) &rarr; <b>Started</b> (round 1 asked) &rarr; <b>Ended</b>. The server already stores the first boundary; only the host page learns to show it."),
        mk_anno("Today the phone just says no", "A refused join sets an inline error on the join form with the server&rsquo;s sentence (<code>PlayerPage.jsx:565</code>); the shared-link auto-join swallows it entirely (<code>quiet</code>, <code>:540</code>). <code>joinResult.js</code> already classifies the case as <code>not-started</code> (<code>:89-91</code>); nothing renders it."),
        mk_anno("Waiting without joining", "The phone polls the public <code>GET /games/{id}</code>, which already returns <code>started</code> (<code>get-game.js:85</code>), every 5 seconds while the page is visible, and joins with the typed name the moment it flips. No join is attempted early, so no player row, no billable session, no roster entry."),
        mk_anno("The name stays where the rules put it", "The name gate sits behind the session gate (<code>session-gate.js:14-21</code>): an unstarted session refuses before it looks at names. Waiting keeps that order &mdash; the name is only sent when the doors are open."),
        mk_anno("Opening is the 7-day clock", "Open the doors is <code>start-game.js</code>, which rewrites every row&rsquo;s TTL to opened + 7 days (<code>:69-97</code>). Preview never touches it, so a session previewed for a week is still on its 90-day unstarted clock (<code>session-ttl.js:13-14</code>)."),
    ])
    write("22-preview-board.html", board_page("Preview — both sides of the door", body, notes), "preview")

    # ------------------------------------------------ 31 the example, end to end
    body = f"""
<h1>The owner&rsquo;s example, end to end</h1>
<p class="lede">&ldquo;Lets say that the doc had metrics in it about how issues had increased by 15% and mttr is extended to 3 weeks. A comment about prioritization of easy fix tickets get done immediately, the workie would comment knowledgeable based on its own knowledge and then comment about the mttr could be quickly reduced from its current high of 3 weeks.&rdquo; &mdash; the owner, 23 Sep. Four moments, left to right.</p>
<div class="ss-flow">
<figure style="margin:0"><p class="step">1 · The document</p>
<div class="ss-doc"><h3>Support operations &mdash; Q3 review</h3><p class="m">{DOC_NAME} &middot; page 2 of 14 &middot; prepared by {DOC_NAMES[0]}, Support Director</p>
<table><tr><th>Measure</th><th>Q2</th><th>Q3</th></tr>
<tr><td>Open issues</td><td>1,840</td><td><mark>2,116 (+15%)</mark></td></tr>
<tr><td>Mean time to resolve</td><td>11 days</td><td><mark>3 weeks</mark></td></tr>
<tr><td>Reopened after first fix</td><td>9%</td><td>14%</td></tr></table>
<p>Roughly a third of the open backlog is tagged <i>quick fix</i> &mdash; estimated under a day &mdash; yet the median quick fix has waited 34 days. {DOC_NAMES[1]} (Tier 2 lead) notes two tier-2 roles were vacant for most of the quarter&hellip;</p>
<p><b>Q4 target:</b> MTTR under 10 days, no new headcount.</p></div>
<figcaption><b>A PDF the host already has</b><span>Parsed to text by admin/parse-document.js; not kept</span></figcaption></figure>
<span class="ss-arrow" aria-hidden="true">&rarr;</span>
{laptop("03-briefing-ready.html", "<b>2 · The briefing, checked</b><span>Seven facts, 2 names left out, edited by the host before the doors open</span>", 0.36)}
</div>
<div class="ss-flow" style="margin-top:26px">
{phone("21-phone-answer.html", "<b>3 · A participant answers</b><span>&lsquo;Prioritise the easy-fix tickets…&rsquo; — top of the vote, 18 points</span>")}
<span class="ss-arrow" aria-hidden="true">&rarr;</span>
{wall("30-workie-briefed.html", "<b>4 · Workie on the wall</b><span>Its own knowledge (the quick-win play) and the brief (‘an MTTR the brief puts at three weeks’)</span>", 0.42)}
</div>"""
    notes = "".join([
        mk_anno("What moves from the file to the wall", "Only facts: two numbers, one ratio, one cause, one goal. The document&rsquo;s names, its table and its other twelve pages stay behind. The wall shows Workie&rsquo;s words, never the briefing itself."),
        mk_anno("Where Workie&rsquo;s own knowledge comes in", "The shipped Call &amp; Answer default forbids it: ‘You know nothing else about this room, this company or this industry’ (rule 1, <code>admin/default-ai-prompts.json:6</code>). The briefing block widens exactly that rule for a briefed session: general professional practice, said as general practice. The owner&rsquo;s example needs both halves."),
        mk_anno("Where it enters the prompt", "Last, after the host&rsquo;s required additions (<code>get-ai-summary.js:2536</code>): that position is the one the game 1935 and 4567 experiments showed a model obeys (<code>personas.js:464-529</code>). See 40 for the block, word for word."),
        mk_anno("What would make it wrong", "Saying ‘someone said MTTR is three weeks’ (a brief fact as a participant&rsquo;s); inventing ‘cut MTTR by 40%’ (a number not in the material); naming the director. Each is a line in the block and an assertion in <code>tests/briefing-prompt.js</code> (PLAN phase 3)."),
    ])
    write("31-mttr-end-to-end.html", board_page("The MTTR example, end to end", body, notes, DOC_CSS), "workie")
