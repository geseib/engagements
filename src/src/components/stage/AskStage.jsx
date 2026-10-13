import React from 'react';
import Icon from '../Icon';
import './AskStage.css';
import FW, { KINDS, RATE_ENDS } from '../../config/followUpWords';
import RW from '../../config/roundWords';

/**
 * A QUESTION FOR THE ROOM, ON THE HOST'S STAGE (docs/design/followup-icons
 * mockup §3-4, PLAN B5). The `ask` beat: the question while the room answers,
 * then its results. Counts only, never a name. For Ideas the host decides what
 * reaches the wall: every answer is listed here, and pressing one puts it up
 * (or takes it down), as featured comments are.
 *
 *   ask     the host's wire for the question on screen (useRoundAsks().shown)
 *   total   people in the room
 *   onPick  (askId, ideaId, picked) => void
 */
export default function AskStage({ ask, total = 0, onPick }) {
  if (!ask) return <p className="qdetail">{FW.questionForRoom}</p>;
  const kind = KINDS[ask.kind] || KINDS.ideas;
  const closed = ask.status === 'closed';
  const tally = ask.tally || { n: 0 };
  const n = tally.n || 0;
  const words = ask.kind === 'rate' ? `“${ask.statement}”` : ask.question;

  return (
    <div className="askstage" data-kind={ask.kind} data-status={ask.status}>
      <div className="kicker askstage-kicker">
        <Icon name={kind.icon} size={20} />
        {closed ? FW.theRoomsAnswer : `${FW.questionForRoom} · ${kind.label}`}
      </div>
      <h1 className="q askstage-q">{words}</h1>

      {!closed && ask.kind === 'choice' && (
        <ol className="askstage-options">
          {(ask.options || []).map((o, i) => (
            <li key={i}><span className="askstage-letter">{String.fromCharCode(65 + i)}</span>{o.text}</li>
          ))}
        </ol>
      )}
      {!closed && ask.kind === 'rate' && (
        <div className="askstage-ends"><span>{RATE_ENDS.low}</span><span>{RATE_ENDS.high}</span></div>
      )}
      {!closed && (
        <p className="askstage-count">{FW.answeredOn(n, total || n)}</p>
      )}

      {closed && ask.kind === 'choice' && <ChoiceResult ask={ask} tally={tally} />}
      {closed && ask.kind === 'rate' && <RateResult tally={tally} />}
      {closed && ask.kind === 'ideas' && <IdeasResult ask={ask} onPick={onPick} />}
      {closed && ask.kind !== 'ideas' && <p className="askstage-count">{FW.answered(n)}</p>}
    </div>
  );
}

function ChoiceResult({ ask, tally }) {
  const counts = Array.isArray(tally.counts) ? tally.counts : [];
  const max = Math.max(1, ...counts);
  return (
    <ol className="askstage-bars">
      {(ask.options || []).map((o, i) => (
        <li key={i} className={counts[i] === max && counts[i] > 0 ? 'is-top' : ''}>
          <span className="askstage-letter">{String.fromCharCode(65 + i)}</span>
          <span className="askstage-bar-label">{o.text}</span>
          <span className="askstage-bar" aria-hidden="true"><i style={{ width: `${((counts[i] || 0) / max) * 100}%` }} /></span>
          <b className="askstage-bar-n">{counts[i] || 0}</b>
        </li>
      ))}
    </ol>
  );
}

function RateResult({ tally }) {
  const counts = Array.isArray(tally.counts) ? tally.counts : [0, 0, 0, 0, 0];
  const max = Math.max(1, ...counts);
  const rows = [5, 4, 3, 2, 1];
  const label = (v) => (v === 5 ? RATE_ENDS.high : v === 1 ? RATE_ENDS.low : String(v));
  return (
    <div className="askstage-rate">
      <p className="askstage-mean">
        <b>{tally.mean === null || tally.mean === undefined ? '–' : tally.mean.toFixed(1)}</b>
        <span>{FW.averageOf5}</span>
      </p>
      <ol className="askstage-bars askstage-spread">
        {rows.map((v) => (
          <li key={v}>
            <span className="askstage-bar-label">{label(v)}</span>
            <span className="askstage-bar" aria-hidden="true"><i style={{ width: `${((counts[v - 1] || 0) / max) * 100}%` }} /></span>
            <b className="askstage-bar-n">{counts[v - 1] || 0}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function IdeasResult({ ask, onPick }) {
  const ideas = Array.isArray(ask.ideas) ? ask.ideas : [];
  const picked = new Set((ask.picked || []).map((p) => p.id));
  if (!ideas.length) return <p className="askstage-count">{RW.nobodyAnswered || FW.answered(0)}</p>;
  return (
    <>
      <ul className="askstage-ideas">
        {ideas.map((idea) => {
          const on = picked.has(idea.id);
          return (
            <li key={idea.id}>
              <button
                type="button"
                className={`askstage-idea${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={on ? FW.takeOffWall : FW.pickForWall}
                onClick={() => onPick && onPick(ask.askId, idea.id, !on)}
              >
                <span>{idea.text}</span>
                {on ? <em>{FW.onTheWall}</em> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="askstage-count">{FW.ideasCount(ideas.length, picked.size)}</p>
    </>
  );
}
