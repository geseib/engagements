# -*- coding: utf-8 -*-
"""40 — how an event, its items, decks, invitations, attendees and the
sessions it starts are stored. Drawn in the console's own vocabulary (panels,
tables, mono keys) so it reads as product documentation, not a new diagram
style. Single table; every key built in tenant.js."""
from build import console_page, write, anno


def pre(s):
    return f'<pre class="ag-pre">{s}</pre>'


def build():
    K = lambda k: f'<span class="k">{k}</span>'
    S = lambda v: f'<span class="s">{v}</span>'
    C = lambda c: f'<span class="c">{c}</span>'
    event = pre(f"""{C("// the code, reserved as a session's is")}
{K("PK")} GAMES  {K("SK")} GAME#5307
{K("orgId")} · {K("ttl")} · {K("Kind")} {S('"event"')}
{C("  ↑ the one new field")}

{C("// the org's list (tenant.js: eventsIndexPk)")}
{K("PK")} ORG#&lt;org&gt;#EVENTS
{K("SK")} EVENT#5307
{K("Title")} {C("enc")} · {K("StartsAt")} · {K("Access")} · {K("State")}

{C("// the event itself")}
{K("PK")} EVENT#5307  {K("SK")} METADATA
{K("orgId")} · {K("CreatedBy")}
{K("Title")} · {K("Place")}   {C('enc, entity "event"')}
{K("StartsAt")} {S('"2026-10-09T09:00"')}
{K("TimeZone")} {S('"Europe/London"')}
{K("Access")}   {S('"open"')} | {S('"invite"')}
{K("AttendeeReports")} {S('"full"')} | {S('"anonymous"')} | {S('"none"')}
{C("  ↑ the default; Full unless changed")}
{K("NamesPromised")} true {C("set at first join")}
{K("State")}    DRAFT|SCHEDULED|LIVE|ENDED
{K("LiveItem")} {S('"it_7Hq2"')}
{K("ttl")}      StartsAt + 90 days""")
    items = pre(f"""{C("// one row per item (16 at most, 8 of them")}
{C("// engagements); order is a field")}
{K("PK")} EVENT#5307  {K("SK")} ITEM#it_7Hq2
{K("Order")} 3 · {K("Type")} {S('"trivia"')} · {K("Minutes")} 15
{K("Title")} · {K("Description")}  {C("enc")}
{K("SetRef")} {{ scope, orgId, setId, version:2 }}
{C("  ↑ pinned when the item is added")}
{K("State")}  planned → active → done | skipped
{C("  ↑ nothing is answerable before active")}
{K("GameId")} {S('"8816"')}  {C("the session it became")}
{K("StartedAt")} · {K("EndedAt")}
{K("ReportKeys")} {{ full, anonymous }}
{C("  ↑ two saved PDFs, REPORT# rows")}
{K("Share")} {S('"inherit"')}|{S('"full"')}|{S('"anonymous"')}|{S('"none"')}

{C("// a presentation: a talk, plus an optional")}
{C("// reference copy. No slide images.")}
{K("Type")} {S('"slides"')} · {K("Presenter")} {C("enc")}
{K("DeckId")} {S('"dk_Pw3m"')} | none
{K("Share")} {S('"copy"')} | {S('"none"')}  {C("default copy")}
{C("  ↑ the copy opens only once active")}

{C("// a break: listed, not counted, stores")}
{C("// nothing but its place on the agenda")}
{K("Type")} {S('"break"')} · {K("Minutes")} 15 · {K("Description")}

{K("SK")} DECK#dk_Pw3m
{K("FileName")} {C("enc")} · {K("Pages")} 31 · {K("Bytes")}
{K("S3Key")} decks/&lt;org&gt;/5307/dk_Pw3m.pdf.enc
{C("  ↑ org envelope, as save-report writes")}
{K("Status")} staged|sealed""")
    people = pre(f"""{C("// one row per person on the list")}
{K("PK")} EVENT#5307  {K("SK")} INVITE#iv_3Kx9
{K("Name")}  {C('enc, entity "invite"')}
{K("Email")} {C("optional, enc: host's records only")}
{K("PassHmac")} HMAC(passcode, secret key)
{C("  ↑ the passcode itself is never stored")}
{K("MadeAt")} · {K("ReplacedAt")}
{K("SeatClient")} · {K("SeatAt")}  {C("one phone")}
{K("ttl")} {C("the event's")}

{C("// how a typed passcode finds its person")}
{K("SK")} PASS#&lt;passHmac&gt;  {K("Invite")} iv_3Kx9

{C("// wrong tries, per phone and per address")}
{K("SK")} TRIES#&lt;clientId&gt;  {K("ttl")} 10 min

{C("// anyone in the room, invited or not")}
{K("SK")} ATTENDEE#at_Qm81
{K("Name")}   {C("plaintext, as PlayerName is")}
{K("Invite")} iv_3Kx9 | none
{K("ClientId")} · {K("JoinedAt")}

{C("// the day's standings (decision 6)")}
{K("Points")} {{ it_7Hq2: 540, it_Qv2m: 200 }}
{K("DayTotal")} 740  {C("sum of scored items only")}

{C("// the phone's line, as connect.js writes")}
{K("SK")} CONNECTION#&lt;connId&gt;  {K("ttl")} 2 h""")

    flow = "".join(f'<div class="s"><b>{t}</b><span>{d}</span></div>' for t, d in [
        ("Plan", "<code>POST /events</code> reserves the code in <code>GAMES</code>; the builder writes <code>ITEM#</code> rows, each pinned to a set version, or a talk with an optional PDF copy."),
        ("Invite", "<code>POST …/invites</code> makes a passcode per person, keeps only its HMAC, returns it once. The host hands it out; nothing is emailed."),
        ("Join", "<code>GET /join/5307</code> says event, invite-only. <code>POST …/attendees</code> takes the passcode; the phone keeps a signed attendee token."),
        ("Start", "<code>POST …/items/{id}/start</code> runs today's create + start for that item's set, stamps <code>EventRef</code>, and tells every phone."),
        ("Follow", "Each phone adds its connection under the new <code>GAME#</code> and joins as a player from its attendee row &mdash; no code, no name typed."),
        ("Keep", "When the item ends the stage saves two PDFs, full and anonymous (<code>REPORT#</code>, 90 / 365 days). The hub and the agenda read those."),
    ])

    life = [("GAMES / GAME#5307", "event created", "until event ttl", "the code; Kind = event"),
            ("EVENT#5307 / METADATA, ITEM#, DECK#", "the builder", "event + 90 d", "the plan and what happened"),
            ("INVITE#, PASS#, ATTENDEE#", "the list, joins", "event + 90 d", "who was asked, who came"),
            ("TRIES#&lt;client&gt;", "a wrong passcode", "10 min", "the pause"),
            ("CONNECTION#", "a phone", "2 h", "as today (<code>connect.js:30-43</code>)"),
            ("GAME#&lt;item&gt; (the session)", "Start", "7 d after start", "as today (<code>session-ttl.js:29-30</code>)"),
            ("REPORT# under ORG#&lt;org&gt;#REPORTS", "item end", "90 d / 365 d", "as today (<code>save-report.js:161-182</code>); now two per item, <code>Variant</code> full | anonymous"),
            ("decks/…/&lt;deck&gt;.pdf.enc", "the seal", "event + 90 d", "reports bucket, org envelope; re-tagged <code>retention=standard</code> at event end so the 90 days count from the event"),
            ("staging/decks/…", "presigned PUT", "1 d", "the unsealed upload; deleted by the seal, and by a lifecycle rule if it never runs")]
    lrows = "".join(f'<tr><td class="wrap"><span class="ag-key">{k}</span></td><td class="wrap">{w}</td><td class="num">{d}</td>'
                    f'<td class="wrap dim">{n}</td></tr>' for k, w, d, n in life)
    routes = [("POST", "/events", "host", "create; reserves the code (same conditional put as a session); 402 from a Personal space"),
              ("GET / PUT", "/events/{code}", "host", "read / edit details, the report default; access locks once a passcode exists"),
              ("POST PUT DELETE", "/events/{code}/items[/{id}]", "host", "add, edit, remove, reorder; refuses a 17th item or a 9th engagement"),
              ("POST", "/events/{code}/decks", "host", "a presigned PUT to <code>staging/</code>, then <code>…/{id}/seal</code> encrypts it into the org envelope"),
              ("GET", "/events/{code}/decks/{id}", "host, attendee", "the copy, decrypted by the Lambda as <code>download-saved-report.js</code> does; attendee only if shared"),
              ("POST", "/events/{code}/invites[/{id}/replace]", "host", "add people / replace a passcode; returns passcodes once"),
              ("GET", "/join/{code}", "public", "session or event; open or invite; title and date only"),
              ("POST", "/events/{code}/attendees", "public", "open: a name. invite: a passcode. Returns a token"),
              ("POST", "/events/{code}/items/{id}/start", "host", "State → active; for an engagement, create + start the session; broadcast eventItemStarted"),
              ("POST", "/events/{code}/items/{id}/end", "host", "State → done; copy each player's final points onto their attendee row; save both reports"),
              ("GET", "/games/{id}/report?view=anonymous", "host", "the report payload with every name replaced, server-side; rendered and saved as the anonymous PDF"),
              ("GET", "/events/{code}/agenda", "see note", "before, during, after: times, titles, descriptions; links only for active or done items, in the variant the setting allows. Open event: anyone with the code. Invite only: an attendee token"),
              ("POST", "/events/{code}/end", "host", "State ENDED; phones show the final agenda")]
    rrows = "".join(f'<tr><td class="mono">{m}</td><td class="wrap"><span class="ag-key">{p}</span></td><td>{a}</td><td class="wrap dim">{w}</td></tr>'
                    for m, p, a, w in routes)

    session = pre(f"""{C("// today's METADATA, written by today's")}
{C("// create path, plus one field")}
{K("PK")} GAME#8816  {K("SK")} METADATA
{K("GameType")} {S('"trivia"')} · {K("QuestionSetId")}
{K("QuestionSetScope")} · {K("QuestionSetVersion")} 2
{K("orgId")} · {K("Title")} {C("enc")}
{K("EventRef")} {{ code:{S('"5307"')}, itemId:{S('"it_7Hq2"')} }}
{C("  ↑ new")}""")

    body = f"""
    <div class="work-head"><div><h1>How an event is stored</h1>
      <p class="sub">Single table, the prefixes this product already uses. One new partition per event (<span class="mono">EVENT#&lt;code&gt;</span>), one org index (<span class="mono">ORG#&lt;org&gt;#EVENTS</span>), one field on the code reservation (<span class="mono">Kind</span>) and one on a session (<span class="mono">EventRef</span>). Every engagement is still an ordinary session.</p></div></div>
    <div class="work-body">
      <div class="ag-flow">{flow}</div>
      <div class="ag-dm">
        <section class="panel"><header><h2>The event</h2><p class="note">the code, the index, the row</p></header><div class="body">{event}</div></section>
        <section class="panel"><header><h2>The agenda</h2><p class="note">items and decks</p></header><div class="body">{items}</div></section>
        <section class="panel"><header><h2>The people</h2><p class="note">invitations, attendees, phones</p></header><div class="body">{people}</div></section>
      </div>
      <div style="margin-top:14px">
        <section class="panel"><header><h2>What a started item becomes</h2><p class="note">a session, unchanged</p></header><div class="body">{session}
          <p class="dim" style="font-size:var(--t-label);margin:10px 0 0;line-height:1.5">Every reader that resolves a round's set from METADATA or the <span class="mono">REF</span> row (<span class="mono">next-question.js:1108-1128</span>, <span class="mono">get-question.js:90-116</span>) keeps working, because nothing about the set pin changes. <span class="mono">EventRef</span> is read in three places only: the join gate (an invite-only event's session refuses a bare code), the usage meter (the event is billed, not each item) and the stage (Back to the agenda).</p></div></section>
        <section class="panel"><header><h2>How long each thing is kept</h2></header><div class="body flush">
          <table class="tbl ag-dmt"><thead><tr><th style="width:300px">Row</th><th style="width:150px">Written by</th><th class="num" style="width:120px">Kept</th><th>Note</th></tr></thead><tbody>{lrows}</tbody></table></div></section>
      </div>
      <section class="panel" style="margin-top:14px"><header><h2>Routes</h2><p class="note">all new; host = Cognito + <span class="mono">callerMayDriveSession</span>'s org rule, 404 when refused</p></header>
        <div class="body flush"><table class="tbl ag-dmt"><thead><tr><th style="width:150px"></th><th style="width:330px">Path</th><th style="width:90px">Who</th><th>Does</th></tr></thead><tbody>{rrows}</tbody></table></div></section>
    </div>
{anno("The code is the id", "A session's code is its id (<code>create-game.js:192</code>, <code>GAME#&lt;code&gt;</code> everywhere). An event does the same: <code>EVENT#5307</code>. Both reserve in <code>GAMES</code> under <code>attribute_not_exists(PK)</code> (<code>schema-compliant-manager.js:109-124</code>), so the numbers cannot collide and <code>/play?gameId=5307</code> can ask one question to learn which it is.")}
{anno("Kind on the reservation", "That row's comment says nothing else belongs on it, because it once leaked session briefs. <code>Kind</code> is routing, not content: it is what lets <code>GET /join/{code}</code> answer without a second read.")}
{anno("Passcodes: a keyed fingerprint only", "Decision 2: the join is the event code plus a personal passcode. The server keeps <code>HMAC(passcode, secret key)</code> and a <code>PASS#</code> row pointing at the person, so a typed passcode is one read and a copied table lets nobody in. Email, when a host keeps one, is an encrypted note for their records &mdash; never a key, never used to join.")}
{anno("Anonymous is written, not hidden", "Decision 3: attendees get Full reports by default, or Anonymous, or nothing. Anonymous is a second PDF rendered from <code>?view=anonymous</code>, where the server has already replaced every name (standings, answers, voters, a featured comment's author) with Player N / Response N. The agenda serves one variant or the other; no client ever receives a name it must hide.")}
{anno("Decks: a sealed PDF, nothing else", "Decisions 5 and 8: no slide images, no viewer. One PDF in the org envelope <code>save-report.js</code> uses (<code>:82-94</code>), opened through a decrypting Lambda. That Lambda answers in its body, as <code>download-saved-report.js</code> does, so a copy over ~4 MB needs a short-lived decrypted object instead (PLAN Phase 2).")}
{anno("Keys through tenant.js only", "<code>eventsIndexPk(orgId)</code> joins <code>gamesIndexPk</code> and <code>reportsIndexPk</code> in all three copies (<code>tests/tenant-keys.js</code>). New encrypted entities <code>event</code>, <code>item</code>, <code>deck</code>, <code>invite</code> each need an entry in <code>ENCRYPTED_FIELDS</code> (<code>tenant-crypto.js</code> throws on an unknown one, <code>:610-619</code>).")}
{anno("Nothing active before its time", "Decision 11: <code>State</code> moves planned &rarr; active &rarr; done, and only the host's Start moves it. The agenda route returns descriptions for every item but a link, a survey or a copy only for active and done ones, so an early visitor can read and never answer.")}
{anno("Breaks and rehearsal store nothing", "A break row is its place on the agenda and nothing else (decision 7). Rehearsal (decision 9) is a view of the event on the stage with the doors closed, as session-setup's Preview is for a session: it writes no row at all.")}
{anno("Billing: its own allowance", "Decisions 1 and 12: one event is one charge, billed at first join. Now it counts as one session; with event pricing it moves to its own counter &mdash; one event a month included on the Team plan, $1 each after &mdash; under <code>LEDGER#&lt;period&gt;#EVENT#5307</code>. Sessions carrying <code>EventRef</code> are never counted.")}
"""
    write("40-data-model.html", console_page("Event data model", body, nav="events"), group="data")
