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
import { navigatorWindow, trackOf } from './navigatorWindow';

/* ------------------------------------------------------------ shared parts */

function Top({ model, right }) {
  return (
    <div className="present-top">
      <span>
        {model.sessionTitle ? <b>{model.sessionTitle}</b> : null}
        {model.sessionTitle && model.roundLabel ? ' · ' : null}
        {model.roundLabel || null}
      </span>
      <span>{right}</span>
    </div>
  );
}

export function Meter({ done, of }) {
  const cap = Math.min(Math.max(0, of), 24);
  const on = of > 0 ? Math.round((Math.min(done, of) * cap) / of) : 0;
  const all = of > 0 && done >= of;
  return (
    <div className="present-meter" aria-hidden="true">
      {Array.from({ length: cap }, (_, i) => (
        <i key={i} className={i < on ? (all ? 'is-all' : 'is-on') : undefined} />
      ))}
    </div>
  );
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
 * never into the lobby. Blue and green here, never orange (R3).
 */
const WIPE = {
  ANSWERING: { word: 'Answering', line: `Answer on your ${deviceWords}`, tone: 'live' },
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

/* ------------------------------------------------------------ the moments */

export function PresentLobby({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Joining" />
      <div className="present-main">
        <div className="present-lobby">
          <div>
            <p className="present-eyebrow">Scan to join · no app, no account</p>
            <p className="present-lead present-join-url">{model.joinHost}</p>
            <p className="present-eyebrow present-code-label">Session code</p>
            <p className="present-code">{model.code}</p>
            <p className="present-lead">{`${model.joined} in the room`}</p>
          </div>
          <div className="present-qr" aria-label="QR code to join">
            <QRCodeSVG value={model.joinUrl} size={512} level="M" includeMargin={false} />
          </div>
        </div>
      </div>
      <div className="present-foot">
        <span>{`${model.nextLabel} starts when the host is ready`}</span>
      </div>
    </div>
  );
}

export function PresentAnswering({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Answering" />
      <div className="present-main">
        {model.category ? <p className="present-eyebrow">{model.category}</p> : null}
        <h1 className="present-hero">{model.title}</h1>
        {model.task ? <p className="present-lead" data-drop="1">{model.task}</p> : null}
      </div>
      <CountsFoot counts={model.counts} />
    </div>
  );
}

export function PresentVoting({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Voting" />
      <div className="present-main">
        <p className="present-eyebrow">Vote</p>
        <h1 className="present-h2">{model.title}</h1>
        <p className="present-lead">{model.lead}</p>
      </div>
      <CountsFoot counts={model.counts} />
    </div>
  );
}

export function PresentTally({ model }) {
  return (
    <div className="present-moment present-frame">
      <Top model={model} right="Results" />
      <div className="present-main">
        {model.loading && !model.rows.length ? (
          <p className="present-lead">Counting the votes</p>
        ) : (
          <div className="present-tally">
            {model.rows.map((row) => (
              <div className="present-trow" key={row.n}>
                <span className="present-rank">{row.n}</span>
                <div className="present-who">
                  {row.label}
                  <span className="present-first">{row.first}</span>
                  {row.share !== null ? (
                    <div className="present-bar" style={{ width: `${Math.max(3, Math.round(row.share * 100))}%` }} />
                  ) : null}
                </div>
                {row.points !== null ? (
                  <span className="present-points">{row.points}<small>points</small></span>
                ) : <span />}
              </div>
            ))}
          </div>
        )}
        {model.more > 0 ? <p className="present-more">{`and ${model.more} more ${model.more === 1 ? 'response' : 'responses'}`}</p> : null}
      </div>
      <div className="present-foot">
        <span><b>{model.total}</b>{` ${model.total === 1 ? 'response' : 'responses'} · `}<b>{model.voted}</b>{' voted'}</span>
      </div>
    </div>
  );
}

function Track({ index, total }) {
  const t = trackOf(index, total);
  if (t.kind === 'bar') {
    return <div className="present-track is-bar" aria-hidden="true"><em style={{ '--at': t.at }} /></div>;
  }
  return (
    <div className="present-track" aria-hidden="true">
      {t.ticks.map((on, i) => <i key={i} className={on ? 'is-on' : undefined} />)}
    </div>
  );
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
        <div className="present-nav">
          <div className="present-flank">{flank(win.left)}</div>
          <div className="present-card">
            <div className="present-card-head">
              <div className="present-badge">{model.focused.n}</div>
              <div className="present-card-who">
                {model.focused.label}
                {model.focused.meta ? <small>{model.focused.meta}</small> : null}
              </div>
            </div>
            <p className="present-fit-text">{model.text}</p>
            {model.parts > 1 ? <div className="present-part">{RW.partOf(model.part + 1, model.parts)}</div> : null}
          </div>
          <div className="present-flank">{flank(win.right)}</div>
        </div>
      </div>
      <div className="present-foot">
        <Track index={model.index} total={model.total} />
        <span>{model.position}</span>
      </div>
    </div>
  );
}

export function ReadPage({ model }) {
  const pips = Array.from({ length: model.pages }, (_, i) => (i === model.page ? 'is-on' : i < model.page ? 'is-seen' : undefined));
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
        <div className="present-pages" aria-hidden="true">
          {pips.map((cls, i) => <i key={i} className={cls} />)}
        </div>
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
        {model.category ? <p className="present-eyebrow">{model.category}</p> : null}
        <h1 className="present-hero">{model.title}</h1>
        {model.task ? <p className="present-lead" data-drop="1">{model.task}</p> : null}
      </div>
      <div className="present-foot"><span>{model.roundLabel}</span></div>
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

/** The one moment for each model; unknown models are a quiet wait. */
export function PresentMoment({ model }) {
  switch (model.moment) {
    case 'LOBBY': return <PresentLobby model={model} />;
    case 'ANSWERING': return <PresentAnswering model={model} />;
    case 'VOTING': return <PresentVoting model={model} />;
    case 'VOTE_RESPONSE': return <ResponseNavigator model={model} vote />;
    case 'RESULTS': return <PresentTally model={model} />;
    case 'RESPONSES': return <ResponseNavigator model={model} />;
    case 'READ': return <ReadPage model={model} />;
    case 'READ_WAIT': return <PresentQuiet model={model} eyebrow={RW.whatWeHeard} line={`${RW.workieWriting}…`} />;
    case 'FEEDBACK': return <PresentQuiet model={model} eyebrow="Feedback" line={`Add your comments on your ${deviceWords}.`} foot={model.title} />;
    case 'QUESTION_FOCUS': return <PresentQuestionFocus model={model} />;
    case 'ENDED': return <PresentQuiet model={model} eyebrow="Complete" line="Thank you. This session has ended." />;
    case 'OTHER': return <PresentQuiet model={model} line="This session shows on the host's screen." />;
    case 'NOT_FOUND': return <PresentQuiet model={model} line="This session has ended or the code is wrong." />;
    default: return <PresentQuiet model={model} line="Waiting for the session" />;
  }
}
