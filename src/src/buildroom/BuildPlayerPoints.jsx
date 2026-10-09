/**
 * TALKING POINTS ON A PHONE, A TABLET OR A LAPTOP (docs/design/build-room-talking-points T4, T7c, T8).
 *
 *   TalkItOver   the point the host put on the Stage: where it came from, its
 *                words, the source site, a line to talk it over, and the idea
 *                box. An idea sent now is tied to the point by the server.
 *   RunBlock     the host's run list: "Claude is working on 2 of 4: ..." and
 *                the list with the current item lit. Words and states only.
 *   LanePoints   a builder's own Research... and Ideas... for their task, the
 *                chip while their Claude works, and what became of their points.
 *
 * Room safety: a point arrives as `{kind, text, site, from}` and nothing more
 * (never its detail or its source list); `from` is 'claude' or a builder's
 * name, which the spec allows on that builder's own point. A run item is its
 * words and its state. No participant is named anywhere here.
 * Everything Claude or a builder's Claude wrote renders as React text.
 */
import React, { useState } from 'react';
import Icon from '../components/Icon';
import { W } from './words';
import { stageFrom, POINT_TAGS } from './buildScreens';
import { sendIdea, requestPoints } from './buildPlayApi';

const TEXT_MAX = 280;
const SUBJECT_MAX = 200;

function Err({ error }) {
  if (!error) return null;
  return (
    <p className="plr-err" role="alert">
      <Icon name="Warning" size={16} />
      <span>{error}</span>
    </p>
  );
}

export function TalkItOver({ point, api, onResult }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [said, setSaid] = useState(false);
  const words = text.trim();
  const send = async () => {
    if (!words || busy) return;
    setBusy(true);
    setError(null);
    setSaid(false);
    const r = await sendIdea(api, words);
    setBusy(false);
    if (r.ok) { setText(''); setSaid(true); } else setError(r.error);
    onResult(r);
  };
  return (
    <section className="bpl-point" aria-label={W.talkItOver}>
      <p className="bpl-eyebrow"><b>{W.talkItOver}</b> {'·'} {stageFrom(point)}</p>
      <h1 className="plr-h1 plr-h1--primary bpl-text">{point.text}</h1>
      {point.site ? <p className="plr-help">{W.sourceSite(point.site)}</p> : null}
      <p className="plr-lede">{W.talkPrompt}</p>
      <div className="bpl-ideabox">
        <label className="bpl-label" htmlFor="bpl-pt-idea">{W.talkIdeaLabel}</label>
        <textarea
          id="bpl-pt-idea" className="plr-inp bpl-area bpl-area--short" maxLength={TEXT_MAX}
          value={text} onChange={(e) => { setText(e.target.value); setSaid(false); }}
        />
        <p className="plr-help">{W.talkHelp}</p>
        <button type="button" className="bpl-send" disabled={!words || busy} onClick={send}>{busy ? 'Sending…' : W.talkSend}</button>
        {said ? <p className="bpl-ok" role="status">{W.talkIdeaSent}</p> : null}
        <Err error={error} />
      </div>
    </section>
  );
}

/** The run list as a phone reads it. `lead` puts "Working through" as the page's heading. */
export function RunBlock({ run, lead = false }) {
  const cur = run.items.find((x) => x.k === run.cur) || null;
  return (
    <section className="bpl-run" aria-label={W.workingThrough}>
      {lead ? <h1 className="plr-h1 plr-h1--primary">{W.workingThrough}</h1> : <p className="bpl-eyebrow"><b>{W.workingThrough}</b></p>}
      {cur ? <p className="plr-lede bpl-text">{W.claudeWorkingText(run.cur, run.total, cur.text)}</p> : null}
      <ol className="bpl-runlist">
        {run.items.map((it) => (
          <li key={it.k} className={`bpl-runitem is-${it.state}`} aria-current={it.state === 'doing' ? 'step' : undefined}>
            <span className="bpl-runn" aria-hidden="true">{it.state === 'done' ? <Icon name="Check" size={16} /> : it.k}</span>
            <span className="bpl-text">{it.text}</span>
          </li>
        ))}
      </ol>
      {lead ? <p className="plr-help">{W.runWatch}</p> : null}
    </section>
  );
}

const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const KIND_NOUN = { idea: ['idea', 'ideas'], talk: ['talking point', 'talking points'], finding: ['finding', 'findings'] };

/** "3 ideas, 1 talking point". */
export function pointsCount(items) {
  const by = {};
  for (const it of items) by[it.kind] = (by[it.kind] || 0) + 1;
  return ['idea', 'talk', 'finding'].filter((k) => by[k]).map((k) => counted(by[k], ...KIND_NOUN[k])).join(', ');
}

const clock = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

export function LanePoints({ task, myPoints, api, onResult }) {
  const [open, setOpen] = useState(null); // 'research' | 'ideas' | null
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const items = (myPoints && myPoints.items) || [];
  const requests = ((myPoints && myPoints.requests) || []).filter((r) => ['waiting', 'working'].includes(r.status));
  const taskName = task && task.text ? task.text : W.forYourTask;
  const begin = (kind) => {
    setError(null);
    if (open === kind) { setOpen(null); return; }
    setSubject(task && task.text ? task.text.slice(0, SUBJECT_MAX) : '');
    setOpen(kind);
  };
  const send = async () => {
    const words = subject.trim();
    if (!words || busy) return;
    setBusy(true);
    setError(null);
    const r = await requestPoints(api, open, words);
    setBusy(false);
    if (r.ok) { setOpen(null); setSubject(''); } else setError(r.error);
    onResult(r);
  };
  const ideas = open === 'ideas';
  return (
    <div className="bpl-lp">
      <div className="bpl-lp-btns">
        <button type="button" className="bpl-send bpl-send--alt" aria-expanded={open === 'research'} onClick={() => begin('research')}>{W.research}</button>
        <button type="button" className="bpl-send bpl-send--alt" aria-expanded={open === 'ideas'} onClick={() => begin('ideas')}>{W.ideasAsk}</button>
      </div>
      <p className="plr-help">{W.lanePointsNote}</p>
      {open ? (
        <div className="bpl-lp-form" role="group" aria-label={ideas ? W.ideasFor(taskName) : W.researchFor(taskName)}>
          <h4 className="plr-lab">{ideas ? W.ideasFor(taskName) : W.researchFor(taskName)}</h4>
          <label className="bpl-label" htmlFor="bpl-lp-subject">{ideas ? W.ideasLabel : W.researchLabel}</label>
          <input id="bpl-lp-subject" className="plr-inp" maxLength={SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <p className="plr-help">{ideas ? W.ideasNote : W.researchNote}</p>
          <div className="bpl-fbrow">
            <button type="button" className="bpl-send bpl-send--alt" onClick={() => setOpen(null)}>{W.close}</button>
            <button type="button" className="bpl-send" disabled={!subject.trim() || busy} onClick={send}>{W.sendRequest}</button>
          </div>
          <Err error={error} />
        </div>
      ) : null}
      {requests.length > 0 && (
        <ul className="bpl-lp-chips" aria-label={W.requestsLabel}>
          {requests.map((r) => (
            <li key={r.id} className="bpl-text">
              {r.kind === 'ideas' ? W.laneFindingIdeas(r.subject) : W.laneResearching(r.subject)}
              {r.status === 'waiting' ? ` ${W.laneWaits}` : ''}
            </li>
          ))}
        </ul>
      )}
      <h4 className="plr-lab bpl-tasks-h">{W.yourPoints}</h4>
      {items.length ? (
        <>
          <p className="plr-help">{pointsCount(items)} {'·'} {W.yourPointsNote}</p>
          <ul className="bpl-myideas" aria-label={W.yourPoints}>
            {items.map((p) => (
              <li key={p.id}>
                <span className="bpl-status">{POINT_TAGS[p.kind]} {clock(p.createdAt)}</span>
                <span className="bpl-text">{p.text}</span>
                <span className="bpl-status">{W.mineStatus[p.status] || W.mineStatus.new}</span>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="plr-help">{W.yourPointsNone}</p>}
    </div>
  );
}
