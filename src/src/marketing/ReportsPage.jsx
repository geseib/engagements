import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import SampleReport from './components/SampleReport';
import { REPORTS_PAGE, REPORT_CALLOUTS, REPORT_SHARING } from './content/reports';
import './ReportsPage.css';

export default function ReportsPage() {
  const { kicker, title, lead, sharing, anonymity, cta } = REPORTS_PAGE;

  return (
    <MarketingShell title="Reports" current="reports">
      <section className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{kicker}</p>
            <h1 className="mk-title">{title}</h1>
            {/* This lead's second sentence is the sheet's own "it is a
                sample" notice — the sheet is fixture data, so it must say
                so; there is no second note under the sheet. */}
            <p className="mk-lead">{lead}</p>
          </div>

          <div className="mk-annot">
            {/*
              DOM order matches the mockup's visual order (sheet, then the
              callout list) — reading order and tab order must match what is
              seen (WCAG 1.3.2 / 2.4.3). Fix round 1: an earlier version
              swapped this order and used CSS `order` to fake the visual
              layout back, which made a screen-reader or keyboard user meet
              the callouts before the report they annotate. Headings now
              descend through `headingLevel={2}` below instead (the sheet's
              own headings drop to h2/h3, one level under this page's h1),
              not through DOM reordering.

              The mockup draws the callout list as a div of <article>s with
              no list semantics. Ruling: the pins on the sheet are numbered,
              so the list beside them should read as an ordered list rather
              than as unrelated cards — <ol>/<li> in place of the mockup's
              div/article, same classes, so `.mk-callouts`/`.mk-callout` in
              ReportsPage.css draw the identical layout.
            */}
            <SampleReport callouts headingLevel={2} />

            <ol className="mk-callouts">
              {REPORT_CALLOUTS.map((c) => (
                <li key={c.n} className="mk-callout">
                  {/* The <ol> already conveys order, so the numeral badge is
                      decoration, not the only place the order lives. */}
                  <div className="mk-callout-n" aria-hidden="true">{c.n}</div>
                  <div>
                    {/* Mockup: h3. Kept at h2 here (below the sheet's own h2
                        title and h3 block headings) so this page's headings
                        keep descending without a skip. */}
                    <h2>{c.title}</h2>
                    <p>{c.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--b">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{sharing.kicker}</p>
            <h2 className="mk-title">{sharing.title}</h2>
          </div>
          <div className="mk-export">
            {REPORT_SHARING.map((card) => (
              <article key={card.title} className="mk-export-card">
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">{anonymity.kicker}</p>
            <h2 className="mk-title">{anonymity.title}</h2>
            <p className="mk-lead">{anonymity.lead}</p>
          </div>
          <p className="mk-muted mk-reports-anon-note">{anonymity.note}</p>
        </div>
      </section>

      <section className="mk-cta">
        <div className="mk-shell mk-cta-in">
          <h2 className="mk-title">{cta.title}</h2>
          <div className="mk-cta-row">
            <a
              className="mk-btn mk-btn-primary mk-btn-lg"
              href="/auth?mode=register"
              onClick={goToAuth('/auth?mode=register')}
            >
              {cta.primary}
            </a>
            <a className="mk-btn mk-btn-ghost mk-btn-lg" href={cta.secondary.href}>
              {cta.secondary.label}
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
