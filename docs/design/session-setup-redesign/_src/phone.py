# -*- coding: utf-8 -*-
"""The participant's phone: arriving before the doors open (20), and answering
round 1 once they do (21, for the end-to-end board). Every page is the shipped
player shell (bar / stage / dock) with ss-phone.css on top."""
from build import phone_page, bar, write
from content import TITLE, CODE, QUESTION, QUESTION_DETAIL, ANSWERS


def build():
    # ------------------------------------------------------- 20 not open yet
    write("20-phone-not-open.html", phone_page("Not open yet — " + CODE, f"""
{bar('Session ' + CODE, who=None)}
<main class="stage">
  <span class="ss-title" title="{TITLE}">{TITLE}</span>
  <h1>Not open yet.</h1>
  <p class="lede muted">Your host hasn&rsquo;t opened the doors. Keep this page open &mdash; it lets you in by itself when they do.</p>
  <div class="field">
    <label class="lab" for="nm">Your name</label>
    <input class="inp" id="nm" value="Priya" aria-describedby="nmhelp">
    <p class="help" id="nmhelp">Type it now and you won&rsquo;t be asked again. On rounds where the room votes,
      your name is <b>not</b> shown next to your answer until voting closes.</p>
  </div>
  <p class="ss-wait" role="status" aria-live="polite"><i aria-hidden="true"></i>Checking every few seconds</p>
</main>
<footer class="dock">
  <button class="btn" disabled>Waiting for the host&hellip;</button>
  <button class="btn ghost">Use a different session code</button>
</footer>
""", volume="act", phase="var(--muted)"), "phone")

    # ------------------------------------------------------- 21 answering
    text, _ = ANSWERS[0]
    write("21-phone-answer.html", phone_page("Round 1 — your response", f"""
{bar('Round 1 of 12', 'Backlog')}
<main class="stage">
  <p class="q">{QUESTION}</p>
  <div class="task"><p class="lab">Your task</p><p>{QUESTION_DETAIL}</p></div>
  <label class="lab" for="a">Your response</label>
  <textarea class="inp" id="a" aria-describedby="ahelp">{text}</textarea>
  <p class="count">{len(text.replace("’", "'"))} characters</p>
  <p class="help" id="ahelp">The room will see this response and vote on it. Your name is not
    attached to it until voting closes.</p>
</main>
<footer class="dock">
  <button class="btn">Submit response</button>
</footer>
""", volume="act", phase="var(--primary)"), "phone")
