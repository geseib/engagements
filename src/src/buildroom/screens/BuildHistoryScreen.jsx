/**
 * HISTORY (step 5, C9 and C10; parity PLAN §2.5, B6): the session's story for
 * the room, a display component. Everything is what Claude showed, what was
 * decided and how, and what the room said, newest first, with the pictures at
 * the moment they were made; Decisions is the decisions alone; Artifacts is
 * every picture, each saying what it was for; Full timeline is the room's
 * whole timeline. Nothing here edits: that stays on the Host screen.
 *
 * With `controls` (one screen: the host's page) the filters, the decided
 * items and the ask window are pressable, as before. With none (the room's
 * window, B7) it shows Everything and nothing on it can be pressed.
 *
 * `fit` is the wall's: `{ story, decided }`, how many of the newest of each
 * fit the screen (measured by present/buildwall/BuildWall.jsx); the rest are
 * counted, "and N earlier", never cut silently. The host's page passes none.
 *
 * controls: { onOpenAsk(askId) }
 */
import React, { useState } from 'react';
import BuildImage from '../BuildImage';
import { W } from '../words';
import {
  contributionsOf, roomStory, doingLine, artifactsOf, filterStory, METHOD_WORDS,
} from '../buildScreens';
import { safeHref } from '../links';
import { clockTime, askNumber } from './common';
import { Timeline } from './Timeline';
import ClaudeStatus from './ClaudeStatus';
import { buildRoomContent } from '../roomContentData';

const HISTORY_FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'timeline', label: 'Full timeline' },
];

/** The room's ideas that went into an ask, each with what came of it; never who sent it (H3). */
function StoryIdeas({ ideas }) {
  if (!ideas || !ideas.length) return null;
  return (
    <ul className="brm-story-ideas" aria-label="Ideas from the room">
      {ideas.map((x) => <li key={x.ideaId} className="brm-story-idea">{x.text} · {x.word}</li>)}
    </ul>
  );
}

/** "How it was decided" for a decision; "What happened to it" for an idea or an ask still open. */
const chainLabel = (type) => (type === 'decided' ? 'How it was decided' : 'What happened to it');

/** What a step produced: a small row under it, oldest first. */
function StoryKid({ kid, onOpen }) {
  const openable = Boolean(onOpen) && kid.type === 'decided' && kid.askId;
  return (
    <li className={`brm-story-kid brm-story-kid--${kid.type}`}>
      <span className="brm-story-kidh">{kid.type === 'decided' ? W.decided : kid.heading}</span>
      {openable
        ? <button type="button" className="brm-story-open brm-story-kidt" aria-label={`Open Ask ${askNumber(kid.askId)}`} onClick={() => onOpen(kid.askId)}>{kid.text}</button>
        : <span className="brm-story-kidt">{kid.text}</span>}
      <span className="brm-story-tm">{clockTime(kid.at)}</span>
      {safeHref(kid.link) && <a className="brm-story-kidlink" href={safeHref(kid.link)} target="_blank" rel="noopener noreferrer">{kid.link}</a>}
      {kid.type !== 'decided' && kid.chain && kid.chain.length > 0 && <span className="brm-story-kidmark" aria-label={chainLabel(kid.type)}>{kid.chain.join(' → ')}</span>}
      <StoryIdeas ideas={kid.ideas} />
      {kid.imageIds.length > 0 && (
        <span className="brm-story-pics">
          {kid.imageIds.map((id) => <BuildImage key={id} imageId={id} alt={kid.text} className="brm-shot brm-story-pic" />)}
        </span>
      )}
    </li>
  );
}

export function StoryItem({ item, onOpen = null }) {
  // A decided item opens its ask's window (History, R1); a click anywhere on
  // it does, except on a link or button of its own.
  const openable = Boolean(onOpen) && item.type === 'decided' && item.askId;
  const isStep = item.type === 'step';
  return (
    <li
      className={`brm-story-it brm-story-it--${item.type}${openable ? ' is-openable' : ''}${item.now ? ' is-now' : ''}`}
      onClick={openable ? (e) => { if (!(e.target.closest && e.target.closest('a, button'))) onOpen(item.askId); } : undefined}
    >
      <span className="brm-story-tm">{clockTime(item.at)}</span>
      <span className="brm-story-dot" aria-hidden="true" />
      <div className="brm-story-body">
        {openable
          ? <button type="button" className="brm-story-h brm-story-open" aria-label={`Open Ask ${askNumber(item.askId)}`} onClick={() => onOpen(item.askId)}>{item.heading}</button>
          : <span className="brm-story-h">{item.heading}{isStep && item.dur && <span className="brm-muted">{` · ${item.dur}`}</span>}</span>}
        {!isStep && <p className="brm-story-t">{item.text}</p>}
        {isStep && item.kids.length > 0 && (
          <ul className="brm-story-kids">
            {item.kids.map((k) => <StoryKid key={k.id} kid={k} onOpen={onOpen} />)}
          </ul>
        )}
        <StoryIdeas ideas={item.ideas} />
        {item.chain.length > 0 && (
          <p className="brm-story-chain" aria-label={chainLabel(item.type)}>
            {item.chain.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && <span className="brm-story-arrow" aria-hidden="true">→</span>}
                <span className="brm-story-step">{c}</span>
              </React.Fragment>
            ))}
          </p>
        )}
        {item.imageIds.length > 0 && (
          <div className="brm-story-pics">
            {item.imageIds.map((id) => (
              <BuildImage key={id} imageId={id} alt={item.text} linked={!openable} className={`brm-shot brm-story-pic${(item.chosenLabels || []).length && item.imageIds[0] === id ? ' is-chosen' : ''}`} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** "and N earlier": what the wall's fit left out, said, never cut silently (standards §5). */
function Earlier({ n }) {
  if (!n) return null;
  return <p className="brm-hint brm-earlier" data-earlier={n}>{W.wallEarlier(n)}</p>;
}

export default function BuildHistoryScreen({
  room, now = Date.now(), controls = null, fit = null, profile = 'room',
}) {
  const [chosen, setFilter] = useState('all');
  // The room's window has no filters: it shows the story.
  const filter = controls ? chosen : 'all';
  const onOpenAsk = (controls && controls.onOpenAsk) || null;
  const asks = room.asks || [];
  // What the room gave, each marked (parity PLAN §2.8, H3). "Used" in Made so far is the same list
  // (H4): an idea the room voted on, sent, or written into a direction; not one in a vote the room
  // has not seen, nor one only put on the wall (Q13).
  const gave = contributionsOf(room);
  const story = roomStory({ log: room.log || [], asks, images: room.images || [], doing: doingLine(room.doing, now), gave, ended: room.state === 'ENDED' });
  const arts = artifactsOf({ images: room.images || [], asks });
  const shown = filterStory(story, filter === 'decisions' ? 'decisions' : 'all');
  const decided = asks
    .filter((a) => a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  // The wall's read carries only the used ideas, and the counts beside them.
  const ideaTotal = room.ideaCounts ? Number(room.ideaCounts.total) || 0 : (room.ideas || []).length;
  const usedIdeas = room.ideaCounts ? Number(room.ideaCounts.used) || 0 : gave.length;
  // THE WALL'S FIT (fit lever 3): the newest story entries that fit, the newest decisions that fit.
  const storyCap = fit && Number.isInteger(fit.story) ? Math.max(1, fit.story) : shown.length;
  const storyShown = shown.slice(0, storyCap);
  const decidedCap = fit && Number.isInteger(fit.decided) ? Math.max(1, fit.decided) : decided.length;
  const decidedShown = decided.slice(Math.max(0, decided.length - decidedCap));
  const noop = () => undefined;
  return (
    <div className="brm-screenbody brm-histscreen" data-capability="history">
      <div className="brm-histmain">
        {/* Claude's status, essential on every screen the room sees (owner, 17 Oct 2026). */}
        <ClaudeStatus rc={buildRoomContent('BUILD_HISTORY', profile, room, null, now)} />
        {filter === 'timeline' && <Timeline log={room.log || []} host={false} busy={false} ended run={noop} api={null} deleteAs="" />}
        {filter === 'artifacts' && (arts.length ? (
          <ul className="brm-arts" aria-label="Artifacts">
            {arts.map((a) => (
              <li key={a.imageId} className={`brm-art${a.chosen ? ' is-chosen' : ''}`}>
                <BuildImage imageId={a.imageId} alt={a.title} className="brm-shot brm-art-img" />
                <span className="brm-art-t">{a.title}</span>
                <span className="brm-who">{a.meta} · {clockTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="brm-empty">Claude&apos;s screenshots and mockups collect here as it works.</p>)}
        {(filter === 'all' || filter === 'decisions') && (shown.length ? (
          <ol className="brm-story" aria-label={filter === 'decisions' ? 'Decisions' : 'The story so far'}>
            {storyShown.map((it) => <StoryItem key={it.id} item={it} onOpen={onOpenAsk} />)}
          </ol>
        ) : (
          <p className="brm-empty">{filter === 'decisions' ? 'Nothing decided yet.' : W.nothingYet}</p>
        ))}
        {(filter === 'all' || filter === 'decisions') && <Earlier n={shown.length - storyShown.length} />}
      </div>
      <div className="brm-histside">
        {controls && (
          <div className="brm-qfilters" role="group" aria-label="Show">
            {HISTORY_FILTERS.map((f) => (
              <button key={f.key} type="button" className={`brm-qchip${filter === f.key ? ' is-on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}{f.key === 'artifacts' ? ` · ${arts.length}` : ''}
              </button>
            ))}
          </div>
        )}
        <section className="brm-panel" aria-labelledby="brm-decided-h">
          <h2 className="brm-h" id="brm-decided-h">Decided so far</h2>
          <Earlier n={decided.length - decidedShown.length} />
          {decided.length ? (
            <ol className="brm-list brm-decided" start={decided.length - decidedShown.length + 1}>
              {decidedShown.map((a) => {
                const words = (
                  <>
                    {a.decision.direction || a.prompt}
                    {a.decision.method && <span className="brm-muted brm-small">{` · ${METHOD_WORDS[a.decision.method] || a.decision.method}`}</span>}
                  </>
                );
                return (
                  <li key={a.askId}>
                    {onOpenAsk
                      ? <button type="button" className="brm-decided-open" onClick={() => onOpenAsk(a.askId)}>{words}</button>
                      : <span className="brm-decided-open">{words}</span>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="brm-hint">Nothing decided yet.</p>
          )}
        </section>
        <section className="brm-panel" aria-labelledby="brm-made-h">
          <h2 className="brm-h" id="brm-made-h">Made so far</h2>
          <p className="brm-made">
            {W.madeSoFar(arts.length, ideaTotal, usedIdeas)}
          </p>
        </section>
      </div>
    </div>
  );
}
