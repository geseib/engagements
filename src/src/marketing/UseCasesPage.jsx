import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import { USE_CASES, USE_CASES_PAGE } from './content/useCases';
import './UseCasesPage.css';

export default function UseCasesPage() {
  const { kicker, title, lead, cta } = USE_CASES_PAGE;

  return (
    <MarketingShell title="Use cases" current="cases">
      <section className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{kicker}</p>
            <h1 className="mk-title">{title}</h1>
            <p className="mk-lead">{lead}</p>
          </div>

          <div className="mk-cases">
            {USE_CASES.map((useCase) => {
              const headingId = `mk-case-${useCase.id}`;
              return (
                <article key={useCase.id} className="mk-case" aria-labelledby={headingId}>
                  <div className="mk-case-head">
                    <span className="mk-kicker">{useCase.kicker}</span>
                    {/* h2, not the mockup's h3: this page's only heading above
                        it is the h1, so h2 is what keeps levels sequential. */}
                    <h2 id={headingId}>{useCase.title}</h2>
                    <p className="mk-case-set">
                      Set type: <b>{useCase.setType.kind}</b>, {useCase.setType.detail}
                    </p>
                  </div>
                  <div className="mk-case-ba">
                    <div className="mk-case-panel">
                      <h3>Before</h3>
                      <p>{useCase.before}</p>
                    </div>
                    <div className="mk-case-panel mk-case-panel--with">
                      <h3>With Engagements</h3>
                      <p>{useCase.after}</p>
                    </div>
                    <div className="mk-case-acts">
                      {useCase.actions.map((action) => (
                        <a
                          key={action.label}
                          className={`mk-btn ${action.primary ? 'mk-btn-primary' : 'mk-btn-ghost'}`}
                          href={action.href}
                          onClick={action.primary ? goToAuth(action.href) : undefined}
                        >
                          {action.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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
