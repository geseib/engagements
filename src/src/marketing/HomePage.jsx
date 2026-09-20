import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import useScrollProgress from './useScrollProgress';
import RidgeScene from './components/RidgeScene';
import ClipFrame from './components/ClipFrame';
import SampleReport from './components/SampleReport';
import JoinCodeEntry from '../components/JoinCodeEntry';
import { HOME } from './content/home';
import './HomePage.css';

/**
 * The register/sign-in pair the mockup draws in the hero
 * (docs/design/marketing-redesign/01-home.html `.mk-hero-ctas`). The closing
 * CTA (#start) pairs register with a different second link ("See how it
 * works" -> /how-it-works) rather than sign-in, so it is built inline there
 * instead of reusing this component.
 */
const Doors = ({ primary, secondary }) => (
  <div className="mk-hero-ctas">
    <a className="mk-btn mk-btn-primary mk-btn-lg" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>
      {primary}
    </a>
    <a className="mk-btn mk-btn-ghost mk-btn-lg" href="/auth" onClick={goToAuth('/auth')}>
      {secondary}
    </a>
  </div>
);

export default function HomePage() {
  const progress = useScrollProgress();
  const { hero, problem, modes, material, room, summit, start } = HOME;

  return (
    <MarketingShell title="" current="home">
      <div className="mk-home">
        <RidgeScene progress={progress} />

        <section id="top" className="mk-hero">
          <div className="mk-shell mk-hero-top">
            <p className="mk-kicker">{hero.kicker}</p>
            <h1 className="mk-display mk-hero-copy">{hero.headline}</h1>
            <p className="mk-lead mk-hero-sub">{hero.lead}</p>
          </div>
          <div className="mk-shell mk-hero-foot">
            <Doors primary={hero.ctaPrimary} secondary={hero.ctaSecondary} />
            <JoinCodeEntry />
          </div>
        </section>

        <section id="problem" className="mk-section mk-section--a mk-problem">
          <div className="mk-shell">
            <div className="mk-section-head">
              <p className="mk-kicker">{problem.kicker}</p>
              <h2 className="mk-title">{problem.title}</h2>
            </div>
            <div className="mk-problem-grid">
              {problem.items.map((item) => (
                <article key={item.n} className="mk-stmt">
                  <span className="mk-stmt-n">{item.n}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="modes" className="mk-section mk-section--b mk-modes">
          <div className="mk-shell">
            <div className="mk-section-head">
              <p className="mk-kicker">{modes.kicker}</p>
              <h2 className="mk-title">{modes.title}</h2>
              <p className="mk-lead">{modes.lead}</p>
            </div>
            {modes.items.map((mode) => (
              <div key={mode.id} className={`mk-mode${mode.flip ? ' mk-mode--flip' : ''}`}>
                <div className="mk-mode-copy">
                  {/* The mockup draws the tag as a sibling pill above the h3.
                      It is nested inside the h3 here instead (see
                      HomePage.css `.mk-mode-copy h3`, which keeps it visually
                      on its own line) so the heading's accessible name
                      carries the mode's name, per the report. */}
                  <h3>
                    <span className="mk-mode-tag">{mode.tag}</span>
                    {mode.heading}
                  </h3>
                  <p>{mode.text}</p>
                  <ul className="mk-mode-list">
                    {mode.list.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                <div className="mk-mode-screens">
                  {mode.slots.map((slot) => <ClipFrame key={slot} slot={slot} />)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="material" className="mk-section mk-section--a mk-material">
          <div className="mk-shell">
            <div className="mk-section-head">
              <p className="mk-kicker">{material.kicker}</p>
              <h2 className="mk-title">{material.title}</h2>
              <p className="mk-lead">{material.lead}</p>
            </div>
            <div className="mk-flow">
              {material.steps.map((step) => (
                <article key={step.n} className="mk-flow-step">
                  <div className="mk-flow-n">{step.n}</div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
            <div className="mk-material-clip">
              <ClipFrame slot="builder" />
            </div>
            <p className="mk-material-note">
              <b>{material.note.strong}</b> {material.note.text}
            </p>
          </div>
        </section>

        <section id="room" className="mk-section mk-section--b mk-react">
          <div className="mk-shell">
            <div className="mk-section-head">
              <p className="mk-kicker">{room.kicker}</p>
              <h2 className="mk-title">{room.title}</h2>
            </div>
            <div className="mk-react-grid">
              <div className="mk-tally">
                <div className="mk-tally-head">
                  <h3>{room.tally.question}</h3>
                </div>
                <p className="mk-muted">{room.tally.meta}</p>
                <div className="mk-tally-rows">
                  {room.tally.rows.map((row) => (
                    <div key={row.text} className={`mk-tally-row${row.cool ? ' mk-tally-row--cool' : ''}`}>
                      <div className="mk-tally-top">
                        <b>{row.text}</b>
                        <span className="mk-tally-n">{row.votes} votes</span>
                      </div>
                      <div className="mk-tally-track"><i style={{ width: `${row.width}%` }} /></div>
                    </div>
                  ))}
                </div>
                <p className="mk-tally-note">{room.tally.note}</p>
              </div>
              <div>
                <p className="mk-lead">{room.lead}</p>
                <ul className="mk-mode-list mk-room-list">
                  {room.list.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="summit" className="mk-section mk-section--a mk-summit">
          <div className="mk-shell">
            <div className="mk-section-head">
              <p className="mk-kicker">{summit.kicker}</p>
              <h2 className="mk-title">{summit.title}</h2>
              <p className="mk-lead">{summit.lead}</p>
            </div>
            <SampleReport />
            <p className="mk-muted mk-summit-link">
              <a href="/reports">{summit.link}</a>
            </p>
          </div>
        </section>

        <section id="start" className="mk-cta">
          <div className="mk-shell mk-cta-in">
            <p className="mk-kicker">{start.kicker}</p>
            <h2 className="mk-title">{start.title}</h2>
            <div className="mk-cta-row">
              <a className="mk-btn mk-btn-primary mk-btn-lg" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>
                {start.ctaPrimary}
              </a>
              <a className="mk-btn mk-btn-ghost mk-btn-lg" href="/how-it-works">{start.ctaSecondary}</a>
            </div>
            <p className="mk-cta-fine">{start.fine}</p>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
