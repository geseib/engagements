/**
 * THE MOMENTS THE WALL SHOWS (two-surface PLAN 2.7, NOTES §10).
 *
 * Each takes the plain model from presentModel.js and draws it on the 1920x1080
 * canvas. Shapes and words follow what the room already knows from the host's
 * stage: the lobby's "Scan to join · no app, no account" join block with the
 * Session code, the one-shot phase wipe, "x of n answered" meters, the results
 * tally, and Workie's read paged exactly as the host page pages it.
 *
 * One position indicator per paged thing, at the foot, same place every time.
 * No control anywhere: nothing here is a button, link or role="button".
 */
import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import MarkdownRenderer from '../components/MarkdownRenderer';
import RW, { deviceWords } from '../config/roundWords';
import { navigatorWindow } from './navigatorWindow';
import TopLine from '../components/ui/TopLine';
import Eyebrow from '../components/ui/Eyebrow';
import Heading from '../components/ui/Heading';
import Pips from '../components/ui/Pips';
import NumberBadge from '../components/ui/NumberBadge';
import Card from '../components/ui/Card';
import TallyRow from '../components/ui/TallyRow';
import FW, { KINDS as ASK_KINDS, endsOf, scaleLabel } from '../config/followUpWords';
import {
  shows, roleOf, sizeOf, textOf, dropRank, ROLE,
} from '../config/roomContent';

/* ------------------------------------------------------------ shared parts */

/* The library's parts (components/ui, skins Phase 2): the top line, the
   eyebrow, the headings, the pips, the badge, the card and the tally row. The
   present-* classes stay on each so present.css can pass the wall's ladder to
   them; the colours and the treatment are the skin's. */

/** The data attributes every room-content part carries: which part, which role. */
export const rcAttrs = (rc, key) => ({ 'data-rc-part': key, 'data-rc': roleOf(rc, key) });

function Top({ model, right }) {
  // The session title rides the top line only where the room content keeps it
  // (Call; the lobby and the end everywhere): config/roomContent.js.
  const title = model.sessionTitle && (!model.room || shows(model.room, 'sessionTitle')) ? model.sessionTitle : '';
  return (
    <TopLine
      className="present-top"
      left={(
        <>
          {title ? <b>{title}</b> : null}
          {title && model.roundLabel ? ' · ' : null}
          {model.roundLabel || null}
        </>
      )}
      right={right}
    />
  );
}

/** "x of n answered": one pill per person up to 24 (Pips, the meter). */
export function Meter({ done, of }) {
  return <Pips variant="meter" done={done} of={of} className="present-meter" />;
}

function CountsFoot({ counts }) {
  return (
    <div className="present-foot">
      <Meter done={counts.done} of={counts.of} />
      <span>{counts.line}</span>
    </div>
  );
}

/**
 * THE PHASE WIPE, as the host's stage plays it (components/stage/PhaseBar.jsx):
 * one band across the middle when the phase changes, never on first mount and
 * never into the lobby. Answering reads --phase-ask (orange in Classic, blue in
 * Present), voting --phase-vote (blue), results green: under Present the wall
 * carries no orange (R3).
 */
const WIPE = {
  ANSWERING: { word: 'Answering', line: `Answer on your ${deviceWords}`, tone: 'ask' },
  VOTING: { word: 'Voting', line: `Vote on your ${deviceWords}`, tone: 'live' },
  RESULTS: { word: 'Results', line: 'Look up', tone: 'results' },
};
export function PhaseWipe({ moment }) {
  const phase = moment === 'VOTE_RESPONSE' ? 'VOTING' : moment === 'RESPONSES' || moment === 'READ' ? 'RESULTS' : moment;
  const previous = useRef(phase);
  const [wipe, setWipe] = useState(null);
  useEffect(() => {
    if (previous.current === phase) return;
    previous.current = phase;
    setWipe(WIPE[phase] ? { phase, key: Date.now() } : null);
  }, [phase]);
  if (!wipe) return null;
  const w = WIPE[wipe.phase];
  return (
    <div key={wipe.key} className={`present-wipe is-${w.tone}`} aria-hidden="true" onAnimationEnd={() => setWipe(null)}>
      {w.word}
      <small>{w.line}</small>
    </div>
  );
}

/**
 * The team's task as one slim line, while the room votes on or reads what it
 * answered. While the question is up the task is the LEAD instead
 * (RoomQuestion). Here it is support: on Room, TV and Table it may give way
 * for space (config/roomContent.js); on Call it stays.
 */
function TaskLine({ task, rc = null }) {
  if (!task) return null;
  if (rc && !shows(rc, 'task')) return null;
  const extra = rc ? { ...rcAttrs(rc, 'task'), ...(dropRank(rc, 'task') ? { 'data-drop': String(dropRank(rc, 'task')) } : {}) } : {};
  return <p className="present-task is-slim" {...extra}><span className="present-task-ey">The task</span>{task}</p>;
}

/* ------------------------------------------------------------ the moments */

/**
 * THE LOBBY (owner, 18 Oct 2026: "why is the title of the session tiny. the
 * link and room id can be under the QR code. on the left could be nicely
 * designed title of the session and potentially the summary of the event").
 * Left: the session's title at the hero step, the host's Event Details under
 * it (may give way for space), and how many are in. Right: the QR, with the
 * address and the session code under it. The top line carries no title here:
 * the title is the page.
 */
export function PresentLobby({ model }) {
  const midSession = model.moment === 'JOIN';
  const title = model.sessionTitle || 'Welcome';
  return (
    <div className="present-moment present-frame">
      <Top model={{ ...model, sessionTitle: '' }} right={midSession ? 'Join' : 'Joining'} />
      <div className="present-main">
        <div className="present-lobby">
          <div className="present-lobby-about">
            <Heading level={1} size="hero" balance className="present-lobby-title">{title}</Heading>
            {model.details ? <p className="present-lobby-details" data-drop="1">{model.details}</p> : null}
            <p className="present-lead present-lobby-count">{`${model.joined} in the room`}</p>
          </div>
          <div className="present-lobby-join">
            <div className="present-qr" aria-label="QR code to join">
              <QRCodeSVG value={model.joinUrl} size={512} level="M" includeMargin={false} />
            </div>
            <Eyebrow className="present-eyebrow present-join-ey">Scan to join<br />no app, no account</Eyebrow>
            <p className="present-join-url">{model.joinHost}</p>
            <Eyebrow tone="muted" className="present-eyebrow present-code-label">Session code</Eyebrow>
            <p className="present-code">{model.code}</p>
          </div>
        </div>
      </div>
      <div className="present-foot">
        <span>{midSession ? `${model.roundLabel} is under way. Join on your ${deviceWords}.` : `${model.nextLabel} starts when the host is ready`}</span>
      </div>
    </div>
  );
}

/**
 * A QUESTION OR A LESSON IS UP (owner, 18 Oct 2026: "the instructions is the
 * optional one. the title often is nice to have big too";
 * docs/design/room-content-v2 frames 1-3). What shows and how large is
 * config/roomContent.js's: the category a small eyebrow, the title the lead
 * (hero when short), the lesson under it at the secondary step (never dropped:
 * the fitter shrinks it toward --fit-min), and the question's own instruction
 * in one "Your turn" band. A generic instruction is off Room, TV and Table;
 * on Call it is one slim line that may give way.
 */
export function RoomQuestion({ model }) {
  const rc = model.room;
  const titleRole = roleOf(rc, 'title');
  const lead = (key) => (
    <p className={`present-rc-lead is-${sizeOf(rc, key)}`} data-rc-size={sizeOf(rc, key)} {...rcAttrs(rc, key)}>{textOf(rc, key)}</p>
  );
  const taskRole = roleOf(rc, 'task');
  const taskDrop = dropRank(rc, 'task');
  return (
    <>
      {shows(rc, 'category') ? <Eyebrow className="present-eyebrow" {...rcAttrs(rc, 'category')}>{textOf(rc, 'category')}</Eyebrow> : null}
      {titleRole === ROLE.KICKER ? <Eyebrow tone="muted" className="present-eyebrow present-rc-kicker" {...rcAttrs(rc, 'title')}>{textOf(rc, 'title')}</Eyebrow> : null}
      {titleRole === ROLE.SUPPORT ? <Heading level={2} size="primary" balance className="present-h2 present-rc-title" {...rcAttrs(rc, 'title')}>{textOf(rc, 'title')}</Heading> : null}
      {titleRole === ROLE.LEAD ? lead('title') : null}
      {roleOf(rc, 'story') === ROLE.LEAD ? lead('story') : null}
      {roleOf(rc, 'story') === ROLE.SUPPORT ? (
        <p className="present-rc-story" data-rc-size={sizeOf(rc, 'story')} {...rcAttrs(rc, 'story')}>{textOf(rc, 'story')}</p>
      ) : null}
      {taskRole === ROLE.LEAD ? lead('task') : null}
      {taskRole === ROLE.SUPPORT && !taskDrop ? (
        // "Your turn": the question the room answers (its own instruction, or
        // the question pulled from the front of the lesson). Never dropped.
        <div className="present-turn" {...rcAttrs(rc, 'task')}>
          <span className="present-turn-ey">Your turn</span>
          <p className="present-turn-text">{textOf(rc, 'task')}</p>
        </div>
      ) : null}
      {taskRole === ROLE.SUPPORT && taskDrop ? (
        // Call only: the set's or the type's generic instruction, slim, first to give way.
        <p className="present-task is-slim present-rc-task" data-drop={String(taskDrop)} {...rcAttrs(rc, 'task')}>{textOf(rc, 'task')}</p>
      ) : null}
    </>
  );
}

export function PresentAnswering({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Answering" />
      <div className="present-main">
        <RoomQuestion model={model} />
      </div>
      <CountsFoot counts={model.counts} />
    </div>
  );
}

/**
 * VOTING (owner, 18 Oct 2026, docs/design/room-content-v2 frame 4): "nice to
 * see a bar chart results but not at the expense of seeing what was voted
 * on". When every answer fits (presentModel, config/roomContent.js
 * overviewFits) they are all up, whole and numbered so the room can name one
 * out loud; the title stays as the reminder; how many have voted and the cue
 * are small. No tally while voting, and never a name. Before any answer has
 * arrived it is the cue alone.
 */
export function PresentVoting({ model }) {
  const rc = model.room;
  if (model.overview && Array.isArray(model.answers)) {
    const many = model.answers.length > 3;
    return (
      <div className="present-moment present-frame" data-mode="overview">
        <Top model={model} right="Voting" />
        <div className="present-main is-top">
          {shows(rc, 'title') ? <Heading level={1} size="primary" balance className="present-h2 present-reminder" {...rcAttrs(rc, 'title')}>{model.title}</Heading> : null}
          <ol className={`present-answers${many ? ' is-grid' : ''}`} {...rcAttrs(rc, 'answers')}>
            {model.answers.map((a) => (
              <li key={a.n}>
                <Card className="present-answer">
                  <NumberBadge as="span" n={a.n} className="present-answer-n" />
                  <p className="present-answer-text">{a.text}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
        <div className="present-foot is-start">
          <Meter done={model.counts.done} of={model.counts.of} />
          <span className="present-foot-count">{model.counts.line}</span>
          {shows(rc, 'cue') ? <span {...rcAttrs(rc, 'cue')}>{model.lead}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Voting" />
      <div className="present-main">
        <Eyebrow className="present-eyebrow">Vote</Eyebrow>
        {shows(rc, 'title') ? <Heading level={1} size="primary" balance className="present-h2" {...rcAttrs(rc, 'title')}>{model.title}</Heading> : null}
        <TaskLine task={model.task} rc={rc} />
        <p className="present-rc-lead is-primary" data-rc-size="primary" {...rcAttrs(rc, 'cue')}>{model.lead}</p>
      </div>
      <CountsFoot counts={model.counts} />
    </div>
  );
}

/**
 * RESULTS (owner, 18 Oct 2026, frame 5, building on 16 Oct's ideas first):
 * "think of what is important to take away and discuss". The room's pick in
 * full in a gold card; the runners-up keep their text; the bar is the FILL
 * behind each, relative to the pick (the pick is 100%), so the chart and what
 * was voted on are one thing. Where names are hidden there is no count, point
 * or percentage beside an answer (a number beside an answer is attribution by
 * arithmetic); a named round keeps the credit line and its points. Rows that
 * do not fit fold into "and N more answers" (PresentStage fitTally); the talk
 * line at the foot gives way first.
 */
export function PresentTally({ model }) {
  const rc = model.room;
  const talk = model.talk && (!rc || shows(rc, 'talk')) ? model.talk : '';
  return (
    <div className="present-moment present-frame">
      <Top model={model} right={model.heading || 'Results'} />
      <div className="present-main is-top">
        {model.title && (!rc || shows(rc, 'title')) ? (
          <Heading level={1} size="primary" balance className="present-h2 present-reminder" {...(rc ? rcAttrs(rc, 'title') : {})}>{model.title}</Heading>
        ) : null}
        {model.loading && !model.rows.length ? (
          <p className="present-lead">Counting the votes</p>
        ) : (
          <div className="present-tally is-ideas is-fill" {...(rc ? rcAttrs(rc, 'ideas') : {})}>
            {model.rows.map((row) => (
              <TallyRow
                key={row.n}
                className={`present-trow${row.top ? ' is-top is-pick' : ''}`}
                rank={row.top ? null : row.n}
                label={row.top ? (
                  <>
                    <span className="present-pick-ey">{"The room's pick"}</span>
                    <span className="present-idea">{row.idea}</span>
                  </>
                ) : <span className="present-idea">{row.idea}</span>}
                sub={row.credit}
                share={row.share}
                points={null}
              />
            ))}
          </div>
        )}
        {/* Always drawn, so the fitter can count the rows it takes down
            (PresentStage.jsx fitTally); data-more is the model's own count. */}
        <p className="present-more" data-more={model.more || 0} hidden={!(model.more > 0)}>
          {model.more > 0 ? moreAnswers(model.more) : ''}
        </p>
        {talk ? (
          <p className="present-talk" data-drop={String((rc && dropRank(rc, 'talk')) || 1)} {...(rc ? rcAttrs(rc, 'talk') : {})}>
            <span className="present-talk-ey">Talk about it</span>
            {talk}
          </p>
        ) : null}
      </div>
      <div className="present-foot">
        <span><b>{model.total}</b>{` ${model.total === 1 ? 'response' : 'responses'} · `}<b>{model.voted}</b>{' voted'}</span>
      </div>
    </div>
  );
}

/** "and 5 more answers": the rows the tally folds away (PresentStage's fitter counts the same way). */
export const moreAnswers = (n) => `and ${n} more ${n === 1 ? 'answer' : 'answers'}`;

/**
 * ONE ANSWER PUT UP WHILE VOTING (frame 11): the answer large, its number, and
 * chips showing where it sits among all of them. Never a name, points or rank.
 * A long answer pages ("Part 1 of 2"), as presentKeys steps it.
 */
export function VoteFocus({ model }) {
  return (
    <div className="present-moment present-frame" data-mode="vote">
      <Top model={model} right={model.title && shows(model.room, 'title') ? model.title : 'Voting'} />
      <div className="present-main present-main-nav">
        <div className="present-focus">
          <div className="present-focus-head">
            <NumberBadge as="div" n={model.focused.n} size="var(--L-secondary)" className="present-badge" />
            <span className="present-focus-of">{model.position}</span>
          </div>
          <p className="present-fit-text" {...rcAttrs(model.room, 'response')}>{model.text}</p>
          {model.parts > 1 ? <div className="present-part">{RW.partOf(model.part + 1, model.parts)}</div> : null}
        </div>
      </div>
      <div className="present-foot is-start">
        <ol className="present-chips" aria-label="Answers">
          {(model.chips || []).map((c) => (c.gap ? (
            <li key={c.key} className="present-chip-gap" aria-hidden="true">…</li>
          ) : (
            <li key={c.key}>
              <NumberBadge as="span" n={c.n} tone={c.current ? 'accent' : 'muted'} className={`present-chip${c.current ? ' is-current' : ''}`} />
            </li>
          )))}
        </ol>
        {model.counts ? <span className="present-foot-count">{model.counts.line}</span> : null}
      </div>
    </div>
  );
}

/**
 * ONE RESULT PUT UP (frame 12): the answer large with its place ("2nd"), and a
 * ladder of bars showing where it sits, the pick at the top. Where names are
 * hidden the ladder carries no number but the rank; a named round adds the
 * credit (name and points) under the answer and the points on the ladder.
 */
export function ResultFocus({ model }) {
  return (
    <div className="present-moment present-frame" data-mode="results">
      <Top model={model} right={model.title || 'Results'} />
      <div className="present-main present-main-nav">
        <div className="present-result">
          <div className="present-focus">
            <Eyebrow className="present-eyebrow present-place">{model.place}</Eyebrow>
            <p className="present-fit-text">{model.text}</p>
            {model.credit ? <p className="present-credit">{model.credit}</p> : null}
            {model.parts > 1 ? <div className="present-part">{RW.partOf(model.part + 1, model.parts)}</div> : null}
          </div>
          <ol className="present-ladder" aria-label="Where it sits">
            {(model.ladder || []).map((r) => (
              <li
                key={r.key}
                className={`present-rung${r.top ? ' is-top' : ''}${r.current ? ' is-current' : ''}${r.range ? ' is-range' : ''}`}
              >
                <span className="present-rung-fill" style={{ width: `${Math.round(Math.max(0.03, Math.min(1, r.share || 0)) * 100)}%` }} />
                <span className="present-rung-n">{r.label}</span>
                {!model.hidden && r.points !== null ? <span className="present-rung-pts">{r.points}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="present-foot">
        <span>{model.position}</span>
        {model.focused && model.focused.meta && !model.hidden ? <span>{model.focused.meta}</span> : null}
      </div>
    </div>
  );
}

/**
 * THE QR BESIDE THE MOMENT (owner, 18 Oct 2026: "it moves the screen around a
 * bit so all content is there but the qr code is avail"; frames 9-10). The
 * lobby's join block, on the right; the moment keeps its column and the fitter
 * fits it to the narrower width. Nothing leaves the screen.
 */
export function JoinPanel({ join }) {
  return (
    <aside className="present-joinpanel" aria-label="Join this session">
      <div className="present-qr" aria-label="QR code to join">
        <QRCodeSVG value={join.joinUrl} size={512} level="M" includeMargin={false} />
      </div>
      <Eyebrow className="present-eyebrow present-join-ey">Scan to join · no app, no account</Eyebrow>
      <p className="present-join-url">{join.joinHost}</p>
      <Eyebrow tone="muted" className="present-eyebrow present-code-label">Session code</Eyebrow>
      <p className="present-code">{join.code}</p>
    </aside>
  );
}

/** The foot track: one tick per response up to 24, then a bar (Pips, the track). */
function Track({ index, total }) {
  return <Pips variant="track" done={index} of={total} className="present-track" />;
}

/**
 * THE RESPONSE NAVIGATOR (NOTES §5): the focused response as a card, two
 * neighbours each side and one range chip beyond. In `vote` mode (the owner's
 * ruling) it carries no name, no points and no rank: "Response 6 · name
 * hidden", neighbours by their first words.
 */
export function ResponseNavigator({ model, vote = false }) {
  const win = navigatorWindow(model.index, model.total);
  const byIndex = (i) => model.neighbours[i] || { n: i + 1, word: '' };
  const flank = (items) => items.map((x) => (x.kind === 'range' ? (
    <div className="present-range" key={`r${x.from}`}>
      <div className="present-n">{`${x.from + 1}–${x.to + 1}`}</div>
      <div className="present-w">{`${x.count} responses`}</div>
    </div>
  ) : (
    <div className="present-mini" key={`m${x.index}`}>
      <div className="present-n">{x.index + 1}</div>
      <div className="present-w">{byIndex(x.index).word}</div>
    </div>
  )));
  return (
    <div className="present-moment present-frame" data-mode={vote ? 'vote' : 'results'}>
      <Top model={model} right={vote ? 'Voting' : 'Responses'} />
      <div className="present-main present-main-nav">
        {vote ? <Eyebrow className="present-eyebrow present-vote-cue">{`Vote on your ${deviceWords}`}</Eyebrow> : null}
        {vote ? <TaskLine task={model.task} rc={model.room} /> : null}
        <div className="present-nav">
          <div className="present-flank">{flank(win.left)}</div>
          <Card selected className="present-card">
            <div className="present-card-head">
              <NumberBadge as="div" n={model.focused.n} size="var(--L-secondary)" className="present-badge" />
              <div className="present-card-who">
                {model.focused.label}
                {model.focused.meta ? <small>{model.focused.meta}</small> : null}
              </div>
            </div>
            <p className="present-fit-text">{model.text}</p>
            {model.parts > 1 ? <div className="present-part">{RW.partOf(model.part + 1, model.parts)}</div> : null}
          </Card>
          <div className="present-flank">{flank(win.right)}</div>
        </div>
      </div>
      <div className="present-foot">
        <Track index={model.index} total={model.total} />
        <span>{model.position}</span>
        {vote && model.counts ? <span className="present-foot-count">{model.counts.line}</span> : null}
      </div>
    </div>
  );
}

export function ReadPage({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right={RW.whatWeHeard} />
      <div className="present-main is-top">
        <div className={`present-read${model.isTopics ? ' is-topics' : ''}`}>
          <MarkdownRenderer content={model.content} />
        </div>
      </div>
      <div className="present-foot">
        <span>{"Workie's read"}</span>
        <Pips variant="pages" done={model.page} of={model.pages} className="present-pages" />
        <span>{model.position}</span>
      </div>
    </div>
  );
}

export function PresentQuestionFocus({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="The question" />
      <div className="present-main">
        <RoomQuestion model={model} />
      </div>
      <div className="present-foot"><span>{model.roundLabel}</span></div>
    </div>
  );
}

/**
 * FEEDBACK (owner, 2026-10-13: "not even a clue to what round or question this
 * relates to"): the round and the question it asks about, then the ask itself.
 */
export function PresentFeedback({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Feedback" />
      <div className="present-main">
        <Eyebrow className="present-eyebrow">{model.roundLabel ? `${model.roundLabel} · Feedback` : 'Feedback'}</Eyebrow>
        {/* The round's title as a reminder, not the question again (owner,
            2026-10-13: "too much like the original question"). */}
        {model.title ? <Eyebrow tone="muted" className="present-eyebrow present-rc-kicker" {...rcAttrs(model.room, 'title')}>{model.title}</Eyebrow> : null}
        {model.featured ? (
          // The comment the host put up, as the laptop shows it.
          <figure className="present-quote">
            <blockquote data-drop="1">{model.featured.text}</blockquote>
            {model.featured.who || model.featured.credit ? (
              <figcaption>
                {model.featured.who ? <b>{model.featured.who}</b> : null}
                {model.featured.who && model.featured.credit ? ' ' : ''}
                {model.featured.credit}
              </figcaption>
            ) : null}
          </figure>
        ) : (
          <p className="present-rc-lead is-primary" data-rc-size="primary" {...rcAttrs(model.room, 'ask')}>{`Provide feedback on the round from your ${deviceWords}.`}</p>
        )}
      </div>
      <div className="present-foot"><span>{model.roundLabel || ''}</span></div>
    </div>
  );
}

/**
 * A QUESTION FOR THE ROOM (docs/design/followup-icons mockup §3-4). Live: the
 * question, its options or scale, and how many have answered. Results: Choose
 * as bars with counts, Rate as the average and the spread, Ideas only as the
 * host picked them. Counts only, never a name or a percentage.
 */
export function PresentAsk({ model }) {
  const a = model.ask;
  const kind = ASK_KINDS[a.kind] || ASK_KINDS.ideas;
  const closed = model.moment === 'ROOM_RESULTS';
  const words = a.kind === 'rate' ? `\u201c${a.statement}\u201d` : a.question;
  const n = closed && a.tally ? a.tally.n : model.answered;
  const of = model.counts ? model.counts.of : 0;
  return (
    <div className="present-moment present-frame" data-ask={a.kind}>
      <Top model={model} right={closed ? FW.theRoomsAnswer : FW.questionForRoom} />
      <div className="present-main">
        <Eyebrow className="present-eyebrow">{kind.wall}</Eyebrow>
        <Heading level={1} size="primary" balance className="present-h2 present-ask-q">{words}</Heading>
        {!closed && a.kind === 'choice' && (
          <ol className="present-ask-options">
            {a.options.map((o, i) => (
              <li key={i}><NumberBadge as="span" n={String.fromCharCode(65 + i)} size="var(--L-body)" />{o}</li>
            ))}
          </ol>
        )}
        {!closed && a.kind === 'rate' && (
          <div className="present-ask-scale">
            {[1, 2, 3, 4, 5].map((v) => <span key={v}>{v}</span>)}
            <p><span>{scaleLabel(endsOf(a), 1)}</span><span>{scaleLabel(endsOf(a), 5)}</span></p>
          </div>
        )}
        {closed && a.kind === 'choice' && a.tally && (
          <div className="present-tally">
            {a.options.map((o, i) => {
              const max = Math.max(1, ...a.tally.counts);
              return (
                <TallyRow key={i} className="present-trow" rank={String.fromCharCode(65 + i)} label={o}
                  share={(a.tally.counts[i] || 0) / max} points={a.tally.counts[i] || 0} unit="" />
              );
            })}
          </div>
        )}
        {closed && a.kind === 'rate' && a.tally && (
          <div className="present-ask-rate">
            <p className="present-ask-mean">
              <b>{a.tally.mean === null ? '\u2013' : a.tally.mean.toFixed(1)}</b>
              <span>{FW.averageOf5}</span>
            </p>
            <div className="present-tally">
              {[5, 4, 3, 2, 1].map((v) => {
                const max = Math.max(1, ...a.tally.counts);
                const label = scaleLabel(endsOf(a), v);
                return <TallyRow key={v} className="present-trow" label={label} share={(a.tally.counts[v - 1] || 0) / max} points={a.tally.counts[v - 1] || 0} unit="" />;
              })}
            </div>
          </div>
        )}
        {closed && a.kind === 'ideas' && (
          a.picked.length ? (
            <ul className="present-ask-ideas">
              {a.picked.map((t, i) => <li key={i}><blockquote>{t}</blockquote></li>)}
            </ul>
          ) : <p className="present-lead">{`${FW.answered(n)}.`}</p>
        )}
      </div>
      <div className="present-foot">
        {!closed ? <Meter done={n} of={of} /> : null}
        <span>
          {!closed
            ? FW.answeredOn(n, of || n)
            : a.kind === 'ideas' ? FW.ideasCount(n, a.picked.length) : FW.answered(n)}
        </span>
      </div>
    </div>
  );
}

export function PresentQuiet({ model, eyebrow, line, foot }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right={eyebrow || ''} />
      <div className="present-main">
        <p className="present-quiet">{line}</p>
      </div>
      <div className="present-foot"><span>{foot || ''}</span></div>
    </div>
  );
}

/** The one moment for each model, with the QR beside it when the host put it up. */
export function PresentMoment({ model }) {
  const moment = <MomentFor model={model} />;
  if (!model.join) return moment;
  return (
    <div className="present-with-join">
      {moment}
      <JoinPanel join={model.join} />
    </div>
  );
}

/** The one moment for each model; unknown models are a quiet wait. */
function MomentFor({ model }) {
  switch (model.moment) {
    case 'LOBBY':
    case 'JOIN': return <PresentLobby model={model} />;
    case 'ANSWERING': return <PresentAnswering model={model} />;
    case 'VOTING': return <PresentVoting model={model} />;
    case 'VOTE_RESPONSE': return <VoteFocus model={model} />;
    case 'RESULTS': return <PresentTally model={model} />;
    case 'RESPONSES': return <ResultFocus model={model} />;
    case 'READ': return <ReadPage model={model} />;
    case 'READ_WAIT': return <PresentQuiet model={model} eyebrow={RW.whatWeHeard} line={`${RW.workieWriting}…`} />;
    case 'FEEDBACK': return <PresentFeedback model={model} />;
    case 'ROOM_QUESTION':
    case 'ROOM_RESULTS': return <PresentAsk model={model} />;
    case 'QUESTION_FOCUS': return <PresentQuestionFocus model={model} />;
    case 'ENDED': return <PresentQuiet model={model} eyebrow="Complete" line="Thank you. This session has ended." />;
    case 'OTHER': return <PresentQuiet model={model} line="This session shows on the host's screen." />;
    case 'NOT_FOUND': return <PresentQuiet model={model} line="This session has ended or the code is wrong." />;
    default: return <PresentQuiet model={model} line="Waiting for the session" />;
  }
}
