/**
 * THE STAGE BETWEEN ASKS: Claude's one status, the mockups to compare, and
 * what we built once Claude wraps up (moved from BuildRoomPage.jsx in B6).
 */
import React from 'react';
import Icon from '../../components/Icon';
import BuildImage from '../BuildImage';
import { W } from '../words';
import {
  claudeState, mockupsReady, looksWords, stageSide, workView, testsWords, clockOf,
} from '../buildScreens';
import { OpenLink } from './common';

/** Claude has wrapped up: the stage says so, and the demo is one click away. */
export function WrappedStage({ outcome, agent, images = [] }) {
  const links = outcome.links || [];
  const finals = images.filter((i) => i.kind === 'final');
  return (
    <section className="brm-stage brm-stage--wrapped" aria-label="What we built">
      <div className="brm-building">
        <span className="brm-donemark" aria-hidden="true"><Icon name="CheckCircle" size={30} weight="fill" /></span>
        <h2 className="brm-q">What we built</h2>
        {agent && agent.listening && <span className="brm-mins">Claude is listening</span>}
      </div>
      <p className="brm-wrapsum">{outcome.summary}</p>
      {finals.length > 0 && (
        <div className="brm-gallery">
          {finals.map((im) => <BuildImage key={im.imageId} imageId={im.imageId} caption={im.caption} className="brm-shot brm-shot--final" />)}
        </div>
      )}
      {links.length > 0 && (
        <div className="brm-openrow">
          {links.map((l, i) => (
            <OpenLink key={`${l.url}:${i}`} href={l.url} label={l.label || (i === 0 ? 'Open the demo' : l.url)} primary={i === 0} />
          ))}
        </div>
      )}
      <div className="brm-two">
        {outcome.built && outcome.built.length > 0 && (
          <div>
            <h3 className="brm-h5">Built</h3>
            <ul className="brm-list">{outcome.built.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
        {outcome.nextSteps && outcome.nextSteps.length > 0 && (
          <div>
            <h3 className="brm-h5">Next steps</h3>
            <ul className="brm-list">{outcome.nextSteps.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * WHILE CLAUDE WORKS (docs/design/build-room-ideas I10): Building / Testing /
 * Fixing / Checking / Saved from the plugin's hook, the last test run's counts,
 * and the last few lines its tools wrote (file and program names only).
 */
function WorkRow({ work }) {
  const tw = testsWords(work.tests);
  return (
    <div className="brm-work" data-testid="brm-work">
      {work.phases && (
        <ol className="brm-phases" aria-label="Where Claude is">
          {work.phases.map((p) => (
            <li key={p.name} className={p.state ? `is-${p.state}` : undefined} aria-current={p.state === 'on' ? 'step' : undefined}>{p.name}</li>
          ))}
        </ol>
      )}
      {tw && <p className={`brm-tests${work.tests && work.tests.bad ? ' is-bad' : ''}`}>{tw}</p>}
      {work.ticker.length > 0 && (
        <ul className="brm-ticker" aria-label={W.claudeWorkNow}>
          {work.ticker.map((t, i) => (
            <li key={`${t.at}:${i}`}><span className="brm-ticker-t">{clockOf(t.at)}</span><span>{t.text}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IdleStage({ room, now, host }) {
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const shots = (room.images || []).filter((i) => i.kind !== 'mockup');
  const latestShot = shots[shots.length - 1] || null;
  // ONE STATUS (owner, 2026-10-07): the same rule the dock, the host's Now
  // card and the header chip read, so the wall never says two things.
  const st = claudeState(room, now);
  // I9: what went to Claude last (or the room's latest decision), word for word.
  const side = stageSide(room);
  const looks = mockupsReady(room);
  if (looks) {
    const w = looksWords(looks.images);
    return (
      <section className="brm-stage brm-stage--idle brm-plain brm-looks" aria-label="Mockups to compare">
        <div className="brm-plain-main">
          <div className="brm-building" data-state="waiting">
            <span className="brm-sdot brm-sdot--waiting" aria-hidden="true" />
            <h2 className="brm-q">{w.headline}</h2>
          </div>
          <p className="brm-nowtext">{w.line}</p>
          <div className="brm-looks-grid">
            {looks.images.map((im) => (
              <div className="brm-look" key={im.label}>
                <BuildImage imageId={im.imageId} alt={`Mockup ${im.label}`} className="brm-shot brm-shot--look" />
                <div className="brm-look-cap"><b>{im.label}</b> {im.title}</div>
              </div>
            ))}
          </div>
        </div>
        <aside className="brm-plain-side">
          <div>
            <div className="brm-kind">Next</div>
            <div className="brm-tx">{w.next}</div>
          </div>
        </aside>
      </section>
    );
  }
  // I10: the row, the test counts and the last few things Claude's tools did, while it works.
  const work = st.key === 'building' ? workView(room, now) : null;
  const sinceAt = st.since ? new Date(st.since) : null;
  const sinceText = st.key === 'building' && sinceAt && Number.isFinite(sinceAt.getTime())
    ? sinceAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <section className="brm-stage brm-stage--idle brm-plain" aria-label="Claude">
      <div className="brm-plain-main">
        <div className="brm-building" data-state={st.key}>
          <span className={`brm-sdot brm-sdot--${st.key}`} aria-hidden="true" />
          <h2 className="brm-q">{st.headline}</h2>
        </div>
        {st.doing && !st.doing.stale && <p className="brm-nowtext brm-muted">{W.forDur(st.doing.dur)}</p>}
        {st.helperLine && <p className="brm-nowtext brm-muted">{st.helperLine}</p>}
        {st.line && (
          <p className="brm-nowtext">
            {st.line}{sinceText && !st.doing && <span className="brm-muted"> · since {sinceText}</span>}
          </p>
        )}
        {host && st.key === 'none' && <p className="brm-stagehint">Connect Claude Code, then paste the Kick off prompt.</p>}
        {work && <WorkRow work={work} />}
        {latestShot && <BuildImage imageId={latestShot.imageId} caption={latestShot.caption} className="brm-shot brm-shot--latest" />}
      </div>
      {side && (
        <aside className="brm-plain-side">
          <div data-testid="brm-stage-side">
            <div className="brm-kind">{side.label}</div>
            <div className="brm-tx">{side.text}</div>
            {side.at && side.label !== W.weDecided && <div className="brm-sidetime">{clockOf(side.at)}</div>}
          </div>
        </aside>
      )}
    </section>
  );
}
