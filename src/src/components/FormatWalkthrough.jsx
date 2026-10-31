import React from 'react';
import Icon from './Icon';
import { walkthroughFor } from '../config/formatWalkthrough';

/**
 * HOW A FORMAT RUNS, AS A STORYBOARD (docs/design/new-engagement README
 * rounds 2 and 3; the owner, 30 Oct 2026: "rather than having to click
 * through prev and next if you just scrolled through the stages. with an
 * image and description").
 *
 * A run of stage cards the host scrolls through — each a picture of the room
 * screen and a phone, a numbered title and a plain description — ending with
 * "What you get". The words live in config/formatWalkthrough.js. Nothing has
 * to be clicked; there is no current step, so switching format can never
 * point past the end of a shorter storyboard (the round-2 white page).
 *
 *   index   a small row of numbered buttons at the top: each scrolls its
 *           stage into view and focuses it (no animation under reduced
 *           motion). Not drawn on a phone, where the stages are stacked.
 *
 *   layout  'pane'   the side pane: heading (+ Hide), index, stages in a column
 *           'guide'  the Format guide: name, Use, summary, index, then the
 *                    stages in a row that scrolls sideways inside the panel
 *           'phone'  the fold under Format: the stages in a column
 *
 * The pictures are boxes and a few words (aria-hidden: the text says it),
 * each its stage's end state, so nothing depends on animation.
 */

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia)
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/* ── the picture ─────────────────────────────────────────────────────────── */

function Lines({ n = 2 }) {
  return Array.from({ length: n }, (_, i) => <s key={i} className="gsd-wt-line" />);
}

function Stage({ art }) {
  if (!art) return null;
  const top = art.chip ? (
    <span className="gsd-wt-top"><span className="gsd-wt-chip">{art.chip}</span><span>Join code 4821</span></span>
  ) : null;
  switch (art.kind) {
    case 'question':
      return (
        <>
          {top}
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-count"><em>{art.count}</em> {art.of}</span>
          {art.dots && (
            <span className="gsd-wt-dots">
              {Array.from({ length: art.dots[1] }, (_, i) => <i key={i} className={i < art.dots[0] ? 'is-on' : ''} />)}
            </span>
          )}
        </>
      );
    case 'vote':
      return (
        <>
          {top}
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-vote">
            {art.items.map((t, i) => <span key={t} className="gsd-wt-item"><em>{i + 1}</em><span>{t}</span></span>)}
          </span>
        </>
      );
    case 'results':
      return (
        <>
          {top}
          <span className="gsd-wt-res">
            <span className="gsd-wt-k">{art.label}</span>
            {art.rows.map(([t, who], i) => (
              <span key={t} className={`gsd-wt-row${i === 0 ? ' is-win' : ''}`}><span>{t}</span><small>{who}</small></span>
            ))}
            <span className="gsd-wt-read"><span className="gsd-wt-k">What we heard · Workie</span>{art.read}</span>
          </span>
        </>
      );
    case 'read':
      return (
        <>
          {top}
          <span className="gsd-wt-read is-big"><span className="gsd-wt-k">{art.k}</span>{art.text}</span>
        </>
      );
    case 'comments':
      return (
        <>
          {top}
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-quote">{art.quote}</span>
          <span className="gsd-wt-count"><em>{art.count}</em> {art.of}</span>
        </>
      );
    case 'report':
      return (
        <span className="gsd-wt-report">
          <b>{art.title}</b>
          {art.rows.map((r) => <span key={r}><span>{r}</span><Lines n={2} /></span>)}
        </span>
      );
    case 'options': {
      const labels = art.labels || ['A', 'B', 'C', 'D'];
      return (
        <>
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-opts">
            {labels.map((l) => {
              const right = art.right && l === art.right;
              const dim = art.right && !right;
              return (
                <span key={l} className={`gsd-wt-opt${right ? ' is-right' : ''}${dim ? ' is-dim' : ''}`}>
                  {l}{right && <Icon name="Check" size={12} weight="bold" />}
                </span>
              );
            })}
          </span>
        </>
      );
    }
    case 'count':
      return (
        <>
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-count is-big"><em>{art.count}</em>{art.of}</span>
        </>
      );
    case 'scores':
      return (
        <span className="gsd-wt-scores">
          {art.rows.map(([who, pts], i) => <span key={who}><span>{i + 1} {who}</span><em>{pts}</em></span>)}
        </span>
      );
    case 'bars':
      return (
        <>
          <b className="gsd-wt-title">{art.title}</b>
          <span className={`gsd-wt-bars${art.done ? ' is-done' : ''}`}>
            {art.bars.map(([label, w]) => (
              <span key={label} className="gsd-wt-bar"><span>{label}</span><i><b style={{ '--w': `${w}%` }} /></i></span>
            ))}
          </span>
        </>
      );
    case 'subject':
      return (
        <>
          <b className="gsd-wt-title">{art.term}</b>
          <span className="gsd-wt-boxes">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>
        </>
      );
    case 'cloud':
      return (
        <span className="gsd-wt-cloud">
          {art.words.map(([w, n, big]) => <span key={w} className={big ? 'is-big' : ''}>{w} <em>{n}</em></span>)}
        </span>
      );
    case 'shared':
      return <span className="gsd-wt-shared">{art.words.map((w) => <span key={w}>{w}</span>)}</span>;
    case 'qr':
      return (
        <span className="gsd-wt-qr">
          <i className="gsd-wt-qrbox" />
          <span>Join code<b>{art.code}</b></span>
        </span>
      );
    case 'progress':
      return (
        <span className={`gsd-wt-prog${art.warn ? ' is-warn' : ''}`}>
          <span>{art.label}</span>
          <i><b style={{ '--w': `${art.pct}%` }} /></i>
        </span>
      );
    case 'connected':
      return (
        <>
          <b className="gsd-wt-title">{art.title}</b>
          <span className="gsd-wt-ok"><Icon name="Check" size={12} weight="bold" /> {art.ok}</span>
        </>
      );
    case 'mockups':
      return (
        <>
          <span className="gsd-wt-mocks">
            <i className={art.pick === 'A' ? 'is-pick' : ''}>A</i>
            <i>B</i>
          </span>
          {art.bars
            ? <span className="gsd-wt-bars is-done"><span className="gsd-wt-bar"><span>A</span><i><b style={{ '--w': '72%' }} /></i></span><span className="gsd-wt-bar"><span>B</span><i><b style={{ '--w': '28%' }} /></i></span></span>
            : <span className="gsd-wt-cap">{art.cap}</span>}
        </>
      );
    case 'direction':
      return <span className="gsd-wt-dir"><span className="gsd-wt-k">{art.k}</span><b>{art.text}</b></span>;
    case 'agenda':
      return (
        <span className="gsd-wt-agenda">
          {art.items.map(([t, label, state]) => (
            <span key={t} className={state ? `is-${state}` : ''}><em>{t}</em>{label}</span>
          ))}
        </span>
      );
    default:
      return null;
  }
}

function Phone({ art }) {
  if (!art) return null;
  let body = null;
  switch (art.kind) {
    case 'answer':
      body = (
        <>
          <b>{art.q}</b>
          <span className="gsd-wt-field">{art.typed || ''}</span>
          <span className="gsd-wt-send">Send</span>
          {art.note && <small>{art.note}</small>}
        </>
      );
      break;
    case 'rank':
      body = (
        <>
          <b>{art.q}</b>
          {art.ranks.map((r, i) => (
            <span key={i} className={`gsd-wt-rank${r ? ' is-on' : ''}`}><em>{r || ''}</em>{i + 1}</span>
          ))}
        </>
      );
      break;
    case 'points':
      body = (
        <>
          <b>{art.q}</b>
          <span className="gsd-wt-pts">{art.pts}</span>
          <small>{art.note}</small>
        </>
      );
      break;
    case 'abcd':
      body = (
        <>
          <span className="gsd-wt-abcd">
            {['A', 'B', 'C', 'D'].map((l) => <i key={l} className={art.picked === l ? 'is-on' : ''}>{l}</i>)}
          </span>
          {art.result && <span className="gsd-wt-right"><Icon name="Check" size={12} weight="bold" /> {art.result}</span>}
        </>
      );
      break;
    case 'choice':
      body = art.opts.map((o, i) => <span key={o} className={`gsd-wt-rank${art.picked === i ? ' is-on' : ''}`}><em>{art.picked === i ? '✓' : ''}</em>{o}</span>);
      break;
    case 'boxes':
      body = (
        <>
          <b>{art.q}</b>
          {[0, 1, 2, 3].map((i) => <span key={i} className="gsd-wt-field is-sm">{(art.typed && art.typed[i]) || ''}</span>)}
        </>
      );
      break;
    case 'form':
      body = [0, 1, 2].map((i) => <span key={i} className={`gsd-wt-rank${i < art.done ? ' is-on' : ''}`}><em>{i < art.done ? '✓' : ''}</em><s className="gsd-wt-line" /></span>);
      break;
    default:
      return null;
  }
  return <span className="gsd-wt-phone"><i className="gsd-wt-notch" />{body}</span>;
}

export function WalkthroughPicture({ art, report = false }) {
  return (
    <span className={`gsd-wt-pic${report ? ' is-report' : ''}${art && art.phone ? ' has-phone' : ''}`} aria-hidden="true">
      <span className="gsd-wt-stage"><Stage art={art && art.stage} /></span>
      {art && art.phone && <Phone art={art.phone} />}
    </span>
  );
}

/* ── the storyboard ──────────────────────────────────────────────────────── */

export default function FormatWalkthrough({
  format = '', label = '', layout = 'pane', head = null, summary = '', idPrefix = 'gsd-wt', headActs = null,
  /* No format chosen yet (live check, round 3): 'example' heads it "— an
     example", 'hover' is the gallery card being looked at. Either way one
     plain line says how to see your own. Nothing here is a live region, so
     a pointer crossing the gallery says nothing to a screen reader. */
  preview = '',
  /* NOTHING CHOSEN, NOTHING POINTED AT (New engagement round 4, Fork 1 A):
     the pane stays quiet. One sentence, one plain line saying the card below
     is only an example, and that example's first stage under its own label,
     "Example · Call & Answer, stage 1 of 6". No index, no storyboard (review
     Dana 2: the example read as a recommendation). */
  exampleOnly = false,
}) {
  const walk = walkthroughFor(format);

  if (!walk) {
    return (
      <section className={`gsd-wt gsd-wt--${layout} is-empty`} aria-labelledby={`${idPrefix}-h`}>
        <div className="gsd-wt-head">
          <h3 className="gsd-wt-h" id={`${idPrefix}-h`}>How it runs</h3>
          {headActs}
        </div>
        <p className="gsd-wt-empty">Choose a format to see how it runs, stage by stage.</p>
      </section>
    );
  }

  const cards = [
    ...walk.stages.map((s, i) => ({ key: `s${i}`, n: String(i + 1), title: s.title, text: s.text, art: s.art, get: false })),
    { key: 'get', n: '', title: 'What you get', text: walk.get.text, art: walk.get.art, get: true },
  ];
  const cardId = (c) => `${idPrefix}-${format}-${c.key}`;

  if (exampleOnly) {
    const first = cards[0];
    const total = walk.stages.length;
    return (
      <section className={`gsd-wt gsd-wt--${layout} is-example`} aria-labelledby={`${idPrefix}-h`} data-format={format}>
        <div className="gsd-wt-sticky">
          {layout !== 'phone' ? (
            <div className="gsd-wt-head">
              <h3 className="gsd-wt-h" id={`${idPrefix}-h`}>How it runs</h3>
              {headActs}
            </div>
          ) : <h3 className="gsd-sr" id={`${idPrefix}-h`}>How it runs</h3>}
        </div>
        <p className="gsd-wt-welcome">Pick a format and this side shows what happens in the room, stage by stage.</p>
        <p className="gsd-wt-note gsd-wt-ex">
          <Icon name="Info" size={14} />
          <span>An example while you choose: the first stage of <b>{label}</b>. Point at or focus a format to see its own.</span>
        </p>
        <div className="gsd-sb-card gsd-sb-card--example" data-testid="gsd-wt-example">
          <span className="gsd-wt-exlbl">Example · {label}, stage 1 of {total}</span>
          <WalkthroughPicture art={first.art} />
          <h4 className="gsd-wt-t">
            <span className="gsd-wt-n" aria-hidden="true">1</span>
            {first.title}
          </h4>
          <p className="gsd-sb-text">{first.text}</p>
        </div>
      </section>
    );
  }

  /* The index scrolls the stage into view and gives it focus; no animation
     under reduced motion (README round 3, owner's storyboard). */
  const goTo = (c) => {
    const el = typeof document !== 'undefined' ? document.getElementById(cardId(c)) : null;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
    }
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  };

  const index = (
    <nav className="gsd-sb-index" aria-label={`Stages of ${label}`}>
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`gsd-sb-jump${c.get ? ' is-get' : ''}`}
          aria-label={c.get ? 'What you get' : `Stage ${c.n}: ${c.title}`}
          title={c.get ? 'What you get' : c.title}
          onClick={() => goTo(c)}
        >
          {c.get ? <Icon name="Check" size={11} weight="bold" /> : c.n}
        </button>
      ))}
    </nav>
  );

  const list = (
    <ol className="gsd-sb" aria-label={`How ${label} runs, stage by stage`}>
      {cards.map((c) => (
        <li key={c.key} id={cardId(c)} className={`gsd-sb-card${c.get ? ' is-get' : ''}`} tabIndex={-1}>
          <WalkthroughPicture art={c.art} report={c.get} />
          <h4 className="gsd-wt-t">
            <span className={`gsd-wt-n${c.get ? ' is-get' : ''}`} aria-hidden="true">
              {c.get ? <Icon name="Check" size={12} weight="bold" /> : c.n}
            </span>
            {c.title}
          </h4>
          <p className="gsd-sb-text">{c.text}</p>
        </li>
      ))}
    </ol>
  );

  if (layout === 'guide') {
    return (
      <section className="gsd-wt gsd-wt--guide" aria-labelledby={`${idPrefix}-h`} data-format={format}>
        <h3 className="gsd-sr" id={`${idPrefix}-h`}>How {label} runs</h3>
        <div className="gsd-wt-guidehead">
          {head}
          {summary && <p className="gsd-wt-sum">{summary}</p>}
          {index}
        </div>
        {list}
      </section>
    );
  }

  return (
    <section className={`gsd-wt gsd-wt--${layout}`} aria-labelledby={`${idPrefix}-h`} data-format={format}>
      {/* The heading, Hide and the index stay at the top while the stages
          scroll under them. */}
      <div className="gsd-wt-sticky">
        {layout !== 'phone' && (
          <div className="gsd-wt-head">
            <h3 className="gsd-wt-h" id={`${idPrefix}-h`}>How {label} runs{preview === 'example' ? ' — an example' : ''}</h3>
            {headActs}
          </div>
        )}
        {preview === 'hover' && <p className="gsd-wt-note">A preview of the card you are on. Click it, or press Enter, to choose it.</p>}
        {preview === 'example' && <p className="gsd-wt-note">Pick a format to see its own.</p>}
        {layout === 'phone' && <h3 className="gsd-sr" id={`${idPrefix}-h`}>How {label} runs{preview === 'example' ? ' — an example' : ''}</h3>}
        {layout === 'phone' && summary && <p className="gsd-wt-sum">{summary}</p>}
        {layout !== 'phone' && index}
      </div>
      {list}
    </section>
  );
}
