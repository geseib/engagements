import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { walkthroughFor, PLAY_MS } from '../config/formatWalkthrough';

/**
 * HOW A FORMAT RUNS, STEP BY STEP (docs/design/new-engagement README "Round 2
 * — owner feedback", decisions 4–6; frames 2-01, 2-03, 2-04, 2-06, 2-09).
 *
 * Replaces the one-picture preview the owner said "doesnt shed light as to
 * what happens". Each step pairs what YOU do, what PHONES show and what the
 * ROOM SCREEN shows, with a picture of both screens; the last dot is "What you
 * get". The words live in config/formatWalkthrough.js.
 *
 *   ‹ Back · the dots · Next ›   labelled buttons; ← → on a dot moves too
 *   ▶ Play                        off by default; every 8s; paused while the
 *                                 pointer or focus is inside; stops at the
 *                                 end; never offered under reduced motion
 *   "Step n of m"                 said politely as it changes
 *
 * The picture is boxes and a few words (aria-hidden: the rows say it), and
 * each is its step's end state, so nothing depends on animation.
 *
 *   layout  'pane'   the Guided side pane: heading, picture, step, controls
 *           'guide'  the Format guide's top row: picture | step | step rail
 *           'phone'  the phone guide: picture, step, controls
 *   head    the guide's own head (name + Use button) in place of "How X runs"
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

/* ── the walkthrough ─────────────────────────────────────────────────────── */

export default function FormatWalkthrough({
  format = '', label = '', layout = 'pane', head = null, summary = '', idPrefix = 'gsd-wt',
}) {
  const walk = walkthroughFor(format);
  const total = walk ? walk.steps.length + 1 : 0; // the last is "What you get"
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  /* Paused while the pointer or the host's focus is inside (README decision
     4). Focus on Play itself does not count, or pressing it would pause it. */
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const paused = hover || focusIn;
  const rootRef = useRef(null);
  const dotsRef = useRef([]);
  const reduced = prefersReducedMotion();

  /* A NEW FORMAT STARTS AT STEP 1, and stops playing (README decision 4). */
  useEffect(() => { setStep(0); setPlaying(false); }, [format]);

  /* PLAY: one step every 8s while nothing of the host's is inside the pane. */
  useEffect(() => {
    if (!playing || paused || reduced || !total) return undefined;
    const t = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= total - 1) setPlaying(false);
        return Math.min(s + 1, total - 1);
      });
    }, PLAY_MS);
    return () => clearInterval(t);
  }, [playing, paused, reduced, total]);

  if (!walk) {
    return (
      <section className={`gsd-wt gsd-wt--${layout} is-empty`} aria-labelledby={`${idPrefix}-h`}>
        <h3 className="gsd-wt-h" id={`${idPrefix}-h`}>How it runs</h3>
        <WalkthroughPicture art={null} />
        <p className="gsd-wt-empty">Choose a format to see how it runs, step by step.</p>
      </section>
    );
  }

  const atGet = step === total - 1;
  const current = atGet ? null : walk.steps[step];
  const art = atGet ? walk.get.art : current.art;
  const status = atGet ? 'What you get' : `Step ${step + 1} of ${total - 1}`;
  const go = (n) => setStep(Math.max(0, Math.min(total - 1, n)));
  const stepName = (i) => (i === total - 1 ? 'What you get' : `Step ${i + 1} of ${total - 1}: ${walk.steps[i].title}`);

  const focusMoved = (event) => {
    const el = event.target;
    setFocusIn(Boolean(el && !(el.classList && el.classList.contains('gsd-wt-play'))));
  };
  const leave = (event) => {
    if (!rootRef.current || !rootRef.current.contains(event.relatedTarget)) setFocusIn(false);
  };
  const dotKey = (event, i) => {
    let next = null;
    if (event.key === 'ArrowRight') next = Math.min(total - 1, i + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = total - 1;
    if (next === null) return;
    event.preventDefault();
    go(next);
    if (dotsRef.current[next]) dotsRef.current[next].focus();
  };

  const rows = current ? [
    ['you', 'UserCircle', 'You', current.you],
    ['phones', 'DeviceMobile', 'Phones', current.phones],
    ['room', 'Monitor', layout === 'phone' ? 'Room' : 'Room screen', current.room],
  ].filter((r) => r[3]) : [];

  const play = reduced ? null : (
    <button
      type="button"
      className="gsd-btn gsd-wt-play"
      aria-pressed={playing}
      onClick={() => { if (atGet && !playing) go(0); setPlaying((p) => !p); }}
    >
      <Icon name={playing ? 'Pause' : 'Play'} size={13} weight="fill" /> {playing ? 'Pause' : 'Play'}
    </button>
  );

  const controls = (
    <div className="gsd-wt-ctl">
      <button type="button" className="gsd-btn gsd-wt-back" aria-disabled={step === 0 || undefined} onClick={() => go(step - 1)}>
        <Icon name="CaretLeft" size={13} weight="bold" />{layout === 'phone' ? <span className="gsd-sr">Back</span> : ' Back'}
      </button>
      <span className="gsd-wt-dots-nav" role="group" aria-label={`Steps of ${label}`}>
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            ref={(el) => { dotsRef.current[i] = el; }}
            type="button"
            className={`gsd-wt-dot${i === step ? ' is-on' : ''}${i === total - 1 ? ' is-get' : ''}`}
            aria-label={stepName(i)}
            aria-current={i === step ? 'step' : undefined}
            tabIndex={i === step ? 0 : -1}
            onClick={() => go(i)}
            onKeyDown={(event) => dotKey(event, i)}
          >
            {i === total - 1 && <Icon name="Check" size={10} weight="bold" />}
          </button>
        ))}
      </span>
      <button type="button" className="gsd-btn gsd-wt-next" aria-disabled={atGet || undefined} onClick={() => go(step + 1)}>
        {layout === 'phone' ? <span className="gsd-sr">Next</span> : 'Next '}<Icon name="CaretRight" size={13} weight="bold" />
      </button>
      {layout === 'guide' && play}
    </div>
  );

  const stepText = (
    <div className="gsd-wt-step">
      <h4 className="gsd-wt-t">
        <span className={`gsd-wt-n${atGet ? ' is-get' : ''}`} aria-hidden="true">
          {atGet ? <Icon name="Check" size={12} weight="bold" /> : step + 1}
        </span>
        {atGet ? 'What you get' : current.title}
      </h4>
      {atGet ? (
        <p className="gsd-wt-get">{walk.get.text}</p>
      ) : (
        <dl className="gsd-wt-rows">
          {rows.map(([key, icon, name, text]) => (
            <div key={key} className="gsd-wt-row-l">
              <dt><Icon name={icon} size={14} /> {name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );

  return (
    <section
      ref={rootRef}
      className={`gsd-wt gsd-wt--${layout}`}
      aria-labelledby={`${idPrefix}-h`}
      data-format={format}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={focusMoved}
      onBlur={leave}
    >
      {layout === 'pane' && (
        <div className="gsd-wt-head">
          <h3 className="gsd-wt-h" id={`${idPrefix}-h`}>How {label} runs</h3>
          <span className="gsd-wt-status" aria-live="polite">{status}</span>
          {play}
        </div>
      )}
      {layout !== 'pane' && (
        <>
          <h3 className="gsd-sr" id={`${idPrefix}-h`}>How {label} runs</h3>
          <span className="gsd-sr" aria-live="polite">{status}</span>
        </>
      )}
      {layout === 'guide' ? (
        <div className="gsd-wt-grid">
          <WalkthroughPicture art={art} report={atGet} />
          <div className="gsd-wt-main">
            {head}
            {summary && <p className="gsd-wt-sum">{summary}</p>}
            {stepText}
            {controls}
          </div>
          <ol className="gsd-wt-rail" aria-label={`All the steps of ${label}`}>
            {Array.from({ length: total }, (_, i) => (
              <li key={i} className={i === step ? 'is-on' : ''}>
                <button type="button" className="gsd-wt-railbtn" aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
                  <span className={`gsd-wt-n${i === total - 1 ? ' is-get' : ''}`} aria-hidden="true">
                    {i === total - 1 ? <Icon name="Check" size={11} weight="bold" /> : i + 1}
                  </span>
                  {i === total - 1 ? 'What you get' : walk.steps[i].title}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          {layout === 'phone' && summary && <p className="gsd-wt-sum">{summary}</p>}
          <WalkthroughPicture art={art} report={atGet} />
          {stepText}
          {controls}
        </>
      )}
    </section>
  );
}
