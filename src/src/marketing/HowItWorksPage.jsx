import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import ClipFrame from './components/ClipFrame';
import { HOW_STEPS, HOW_PAGE } from './content/howItWorks';
import './HowItWorksPage.css';

export default function HowItWorksPage() {
  const { kicker, title, lead, profiles, cta } = HOW_PAGE;

  return (
    <MarketingShell title="How it works" current="how">
      <section className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{kicker}</p>
            <h1 className="mk-title">{title}</h1>
            <p className="mk-lead">{lead}</p>
          </div>

          {/*
            The mockup's six `<article class="mk-step">` are drawn as a plain
            grid, not a `<ol>` — nesting them inside `<li>` would fight the
            zig-zag `grid-template-columns` each step already sets on itself.
            `role="list"`/`role="listitem"` keeps the ordered-structure
            contract without changing that layout.
          */}
          <div className="mk-steps" role="list">
            {HOW_STEPS.map((step, i) => (
              <article
                key={step.n}
                role="listitem"
                className={`mk-step${i % 2 === 1 ? ' mk-step--flip' : ''}`}
              >
                <div className="mk-step-copy">
                  <div className="mk-step-n" aria-hidden="true">{step.n}</div>
                  {/* h2, not the mockup's h3: this page's only heading above it
                      is the h1, so h2 is what keeps levels sequential. */}
                  <h2>{step.title}</h2>
                  {step.text.map((paragraph, idx) => (
                    <p key={paragraph}>
                      {paragraph}
                      {step.link && idx === step.text.length - 1 && (
                        <> <a href={step.link.href}>{step.link.label}</a></>
                      )}
                    </p>
                  ))}
                </div>
                <ClipFrame slot={step.slot} still={step.still} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--b">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{profiles.kicker}</p>
            <h2 className="mk-title">{profiles.title}</h2>
            <p className="mk-lead">{profiles.lead}</p>
          </div>
          <div className="mk-profiles">
            {profiles.items.map((profile) => (
              <div key={profile.name} className="mk-profile">
                <b>{profile.name}</b>
                <span>{profile.text}</span>
              </div>
            ))}
          </div>
          <p className="mk-muted mk-how-note">{profiles.note}</p>
        </div>
      </section>

      <section className="mk-cta">
        <div className="mk-shell mk-cta-in">
          <h2 className="mk-title">{cta.title}</h2>
          <div className="mk-cta-row">
            <a className="mk-btn mk-btn-primary mk-btn-lg" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>
              {cta.primary}
            </a>
            <a className="mk-btn mk-btn-ghost mk-btn-lg" href={cta.secondary.href}>{cta.secondary.label}</a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
