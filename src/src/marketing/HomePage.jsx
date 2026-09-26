import React, { useRef } from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import ClipFrame from './components/ClipFrame';
import ClipStill from './components/ClipStill';
import DeviceFrame from './components/DeviceFrame';
import SampleReport from './components/SampleReport';
import JoinCodeEntry from '../components/JoinCodeEntry';
import useInViewOnce, { useCountUp } from './useInViewOnce';
import useHeroBand from './useHeroBand';
import { HOME } from './content/home';
import { SAMPLE_REPORT_HOME } from './content/sampleReport';
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

/**
 * The product in the first viewport (refresh 2026-09-22 §1 change 1): the
 * drawn trivia-RESULTS still on a TV, with a phone overlay that has just been
 * told its score. Decoration beside the headline, so the block is
 * `aria-hidden`; the stills still carry alt text for anything that reads
 * past that. No captions — the headline is the caption.
 */
const HeroStage = () => (
  <div className="mk-hero-stage" aria-hidden="true">
    <DeviceFrame kind="tv">
      <ClipStill slot="hero-results" alt="The front screen at results: the correct answer carries the headline, with every option's share beside it" />
    </DeviceFrame>
    <DeviceFrame kind="phone">
      <ClipStill slot="hero-phone" alt="A player's phone after the reveal: the option they picked, and the points it earned" />
    </DeviceFrame>
  </div>
);

/** A photograph with its caption in the wash band at its foot (§4a). */
const Photo = ({ photo, extraClass = '' }) => (
  <figure className={`mk-art mk-art--photo${extraClass ? ` ${extraClass}` : ''}`}>
    <img src={photo.src} alt={photo.alt} loading="lazy" />
    <figcaption className="mk-art-wash">{photo.caption}</figcaption>
  </figure>
);

/**
 * The tally performs once (§1 change 5): bars are declared at zero with the
 * real value in `--w`, and once the block is 35% in view `.mk-tally--in` lands, the
 * bars grow and the counts count up in the same 700ms. Then stillness.
 *
 * The count is POINTS, not votes (2026-09-25): each player ranks a top three,
 * scored 3/2/1, and points are what the results and the report show. The
 * unit comes from content/home.js with the numbers it describes.
 */
const TallyRow = ({ row, unit, go }) => {
  const points = useCountUp(row.points, go);
  return (
    <div className={`mk-tally-row${row.cool ? ' mk-tally-row--cool' : ''}`}>
      <div className="mk-tally-top">
        <b>{row.text}</b>
        <span className="mk-tally-n"><span data-count={row.points}>{points}</span> {unit}</span>
      </div>
      <div className="mk-tally-track"><i style={{ '--w': `${row.width}%` }} /></div>
    </div>
  );
};

const Tally = ({ tally }) => {
  const ref = useRef(null);
  const inView = useInViewOnce(ref, 0.35);
  return (
    <div ref={ref} className={`mk-tally${inView ? ' mk-tally--in' : ''}`}>
      <div className="mk-tally-head">
        <h3>{tally.question}</h3>
      </div>
      <p className="mk-muted">{tally.meta}</p>
      <div className="mk-tally-rows">
        {tally.rows.map((row) => <TallyRow key={row.text} row={row} unit={tally.unit} go={inView} />)}
      </div>
      <p className="mk-tally-note">{tally.note}</p>
    </div>
  );
};

export default function HomePage() {
  const { hero, problem, modes, material, room, summit, start, photos } = HOME;
  const heroRef = useRef(null);
  useHeroBand(heroRef);

  return (
    <MarketingShell title="" current="home" rootClass="mk-home">
      <div>
        <section id="top" className="mk-hero" ref={heroRef}>
          <div className="mk-shell mk-hero-top">
            <div>
              <p className="mk-kicker">{hero.kicker}</p>
              {/* Four authored lines that rise once, 90ms apart, from an
                  already-painted default (§1 change 6). Under 720px the spans
                  go inline and the h1 rises as one. */}
              <h1 className="mk-display mk-hero-copy mk-rise">
                {hero.headlineLines.map((line) => <span key={line}>{line}</span>)}
              </h1>
              <p className="mk-lead mk-hero-sub">{hero.lead}</p>
            </div>
            <HeroStage />
          </div>
          <div className="mk-shell mk-hero-foot">
            <Doors primary={hero.ctaPrimary} secondary={hero.ctaSecondary} />
            <JoinCodeEntry />
          </div>
        </section>

        <section id="problem" className="mk-section mk-section--a">
          <div className="mk-shell">
            <div className="mk-section-head">
              <h2 className="mk-title">{problem.title}</h2>
            </div>
            {/* Three statements on a hairline: no cards, no 01/02/03 (§1
                change 3). */}
            <div className="mk-stmts">
              {problem.items.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="modes" className="mk-section mk-section--b">
          <div className="mk-shell">
            <div className="mk-section-head">
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

        <section id="material" className="mk-section mk-section--a">
          <div className="mk-shell">
            <div className="mk-section-head">
              <h2 className="mk-title">{material.title}</h2>
              <p className="mk-lead">{material.lead}</p>
            </div>
            {/* A sequence on a rule with waypoint numerals: the order IS
                information here, so the numbers survive (§1 change 3). */}
            <ol className="mk-seq" role="list">
              {material.steps.map((step) => (
                <li key={step.n} className="mk-seq-step">
                  <span className="mk-seq-n" aria-hidden="true">{step.n}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="mk-material-row">
              <ClipFrame slot="builder" />
              <p className="mk-material-note">
                <b>{material.note.strong}</b> {material.note.text}
              </p>
            </div>
          </div>
        </section>

        <section id="room" className="mk-section mk-section--b">
          <div className="mk-shell">
            <div className="mk-section-head">
              <h2 className="mk-title">{room.title}</h2>
            </div>
            <div className="mk-react-grid">
              <Tally tally={room.tally} />
              <div className="mk-react-side">
                <Photo photo={photos.room} />
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
            {/* The second candidate for "The summit, held" (2026-09-22) has
                the sheet carrying a rendering of this very report, not a blank
                page. Two options were weighed: retire the drawn report and let
                the photo be it, or keep the drawn report as the product image
                and let the photo carry only the gesture. The drawn report
                stays. At the widths this aside renders (≈500px on desktop, 358px
                at 390) the photographed body copy is under 7px and reads as
                texture, so the photo could not carry the report's content; a
                photographed screen dates the moment the report changes, where
                SampleReport is the live component; and the report on the sheet
                is the one thing on this page that must stay a paper surface
                with its own contract (the [data-theme="light"] tests). So the
                photo is cropped to the gesture: 3:4 here, and a top-anchored
                16:9 on phones that keeps the hands and the sheet's head with
                the body out of frame. The caption band alone carries a word. */}
            <div className="mk-summit-grid">
              <SampleReport report={SAMPLE_REPORT_HOME} />
              <div className="mk-summit-aside">
                <Photo photo={photos.sheet} extraClass="mk-art--sheet" />
                <p className="mk-muted mk-summit-link">
                  <a href="/reports">{summit.link}</a>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="start" className="mk-cta">
          <div className="mk-shell mk-cta-in">
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
