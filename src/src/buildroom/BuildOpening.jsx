/**
 * THE OPENING (owner, 2026-10-06; docs/design/build-room-opening/, mockups
 * O1-O3): frame the build with the room before Claude builds. Nine steps in
 * Amazon's working-backwards order fill the build brief; the host walks them
 * in order and can skip, reword, probe or answer any of them; Start building
 * sends Claude the whole brief and the session moves to building.
 *
 * The steps and the kinds come from the server (build-store.js OPENING_STEPS,
 * OPENING_KINDS) on room.opening, so the page and Claude read the same list.
 */
import React, { useState } from 'react';
import { questionAnswer } from './buildScreens';

const stepOf = (opening, key) => (opening.steps || []).find((x) => x.key === key) || null;
const doneCount = (opening) => (opening.steps || []).filter((x) => ['done', 'skipped'].includes(x.status)).length;

/** The step the host is on: the one they chose in the brief, else the next one. */
export function focusStep(opening, focus) {
  return stepOf(opening, focus) || stepOf(opening, opening.current) || null;
}

/** Step 1: the list the room picks from, editable per session (up to six, for the wheel). */
function KindStep({ step, kinds: initial, busy, run, api }) {
  const [q, setQ] = useState(step.question);
  const [kinds, setKinds] = useState(() => initial.map((k) => ({ ...k })));
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const filled = kinds.filter((k) => k.title.trim());
  const askBody = (extra = {}) => ({
    kind: 'choice', prompt: q.trim(), detail: '', openingStep: 'kind',
    options: filled.map((k) => ({ title: k.title.trim(), detail: (k.detail || '').trim() })), ...extra,
  });
  const ask = () => run(() => api.createAsk(askBody()));
  const spin = () => run(async () => {
    const out = await api.createAsk(askBody());
    return api.askAction(out.ask.askId, { action: 'wheel' });
  });
  const pickFor = (i) => run(async () => {
    const out = await api.createAsk(askBody({ draft: true }));
    const opt = out.ask.options[i];
    return api.askAction(out.ask.askId, { action: 'decide', direction: questionAnswer(q, opt.title), chosen: [opt.label], method: 'host' });
  });
  const set = (i, key, value) => setKinds((list) => list.map((k, j) => (j === i ? { ...k, [key]: value } : k)));
  const ready = q.trim() && filled.length >= 2;
  return (
    <>
      <label className="brm-field"><span className="brm-lbl">The question</span>
        <input className="brm-input brm-op-q" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} />
      </label>
      {editing ? (
        <div className="brm-field" role="group" aria-label="The kinds">
          {kinds.map((k, i) => (
            <div className="brm-row brm-gap" key={i}>
              <input className="brm-input brm-input--sm" aria-label={`Kind ${i + 1}`} value={k.title} maxLength={120} onChange={(e) => set(i, 'title', e.target.value)} />
              <input className="brm-input brm-input--sm" aria-label={`Kind ${i + 1}, in a few words`} value={k.detail || ''} maxLength={120} onChange={(e) => set(i, 'detail', e.target.value)} />
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label={`Remove kind ${i + 1}`} disabled={kinds.length <= 2} onClick={() => setKinds((list) => list.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="brm-row brm-gap">
            {kinds.length < 6 && <button type="button" className="brm-btn brm-btn--sm" onClick={() => setKinds((list) => [...list, { title: '', detail: '' }])}>Add a kind</button>}
            <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" onClick={() => setEditing(false)}>Done</button>
          </div>
        </div>
      ) : (
        <ul className="brm-op-kinds" aria-label={picking ? 'Pick one for the room' : 'The kinds'}>
          {filled.map((k, i) => (
            <li key={i}>
              {picking ? (
                <button type="button" className="brm-op-kind is-pick" disabled={busy} onClick={() => pickFor(i)}><b>{k.title}</b><span>{k.detail}</span></button>
              ) : (
                <div className="brm-op-kind"><b>{k.title}</b><span>{k.detail}</span></div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editing && (
        <div className="brm-row brm-gap">
          {picking ? (
            <>
              <span className="brm-hint">Click the one the room settled on.</span>
              <button type="button" className="brm-btn brm-btn--ghost brm-push" onClick={() => setPicking(false)}>Back</button>
            </>
          ) : (
            <>
              <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !ready} onClick={ask}>Ask the room to pick</button>
              <button type="button" className="brm-btn" disabled={busy || !ready} onClick={spin}>Spin the wheel</button>
              <button type="button" className="brm-btn brm-btn--ghost" disabled={busy || !ready} onClick={() => setPicking(true)}>Pick for the room</button>
              <button type="button" className="brm-btn brm-btn--link brm-push" onClick={() => setEditing(true)}>Edit the list</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Steps 2 to 9: ask the room, answer it yourself, or skip. Tools and style opens on Answer. */
function AskStep({ step, busy, run, api }) {
  const [q, setQ] = useState(step.question);
  const [answering, setAnswering] = useState(Boolean(step.host));
  const [text, setText] = useState('');
  const ask = () => run(() => api.createAsk({ kind: 'suggest', prompt: q.trim(), detail: '', openingStep: step.key }));
  const answer = async () => {
    const ok = await run(() => api.openingAction('answer', { step: step.key, text: text.trim() }));
    if (ok !== undefined) setText('');
  };
  return (
    <>
      <label className="brm-field"><span className="brm-lbl">The question</span>
        <input className="brm-input brm-op-q" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} />
      </label>
      {step.host && <p className="brm-hint">You usually know this one. Answer it, or ask the room instead.</p>}
      {answering ? (
        <form className="brm-field" onSubmit={(e) => { e.preventDefault(); if (text.trim()) answer(); }}>
          <span className="brm-lbl">Your answer</span>
          <textarea className="brm-input brm-ta brm-ta--sm" aria-label="Your answer" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <div className="brm-row brm-gap">
            <button type="submit" className="brm-btn brm-btn--primary" disabled={busy || !text.trim()}>Save the answer</button>
            <button type="button" className="brm-btn" disabled={busy || !q.trim()} onClick={ask}>{step.host ? 'Ask the room instead' : 'Ask the room'}</button>
            {!step.host && <button type="button" className="brm-btn brm-btn--ghost" onClick={() => setAnswering(false)}>Back</button>}
          </div>
        </form>
      ) : (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !q.trim()} onClick={ask}>Ask the room</button>
          <button type="button" className="brm-btn" onClick={() => setAnswering(true)}>Answer it yourself</button>
        </div>
      )}
    </>
  );
}

/**
 * THE OPENING PANEL (O1, O2): the Now card while the room frames the build
 * and nothing is being asked. The step, the ways to answer it, Skip, and
 * Start building.
 */
export function OpeningPanel({ room, focus, setFocus, busy, ended, run, api, onShowWall }) {
  const opening = room.opening || { steps: [] };
  const step = focusStep(opening, focus);
  const n = step ? opening.steps.indexOf(step) + 1 : opening.steps.length;
  const start = () => run(() => api.openingAction('start', {}));
  return (
    <section className="brm-panel brm-nowcard brm-opening" aria-labelledby="brm-opening-h">
      <div className="brm-row brm-gap">
        <h2 className="brm-h5 brm-op-phase" id="brm-opening-h">Opening{step ? ` · step ${n} of ${opening.steps.length}` : ''}</h2>
        <span className="brm-hint brm-push">Planning: Claude writes no code yet</span>
      </div>
      {step ? (
        <>
          <p className="brm-nowline">{step.label}</p>
          {step.status === 'done' ? (
            <div className="brm-op-done">
              <p className="brm-op-value">{step.value}</p>
              {!ended && (
                <div className="brm-row brm-gap">
                  <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.openingAction('reopen', { step: step.key }))}>Ask it again</button>
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setFocus(null)}>Next step</button>
                </div>
              )}
            </div>
          ) : (
            !ended && (step.key === 'kind'
              ? <KindStep key={step.key} step={step} kinds={opening.kinds || []} busy={busy} run={run} api={api} />
              : <AskStep key={step.key} step={step} busy={busy} run={run} api={api} />)
          )}
          {!ended && step.status !== 'done' && (
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} onClick={() => run(async () => { await api.openingAction('skip', { step: step.key }); setFocus(null); return true; })}>Skip this step</button>
            </div>
          )}
        </>
      ) : (
        <p className="brm-hint">Every step is answered or skipped. Show the brief on the wall, then start building.</p>
      )}
      {!ended && (
        <div className="brm-op-start">
          <span>{doneCount(opening)} of {opening.steps.length} framed. Start building whenever you like; Claude gets the brief as it is.</span>
          <button type="button" className="brm-btn brm-btn--sm" onClick={onShowWall}>Show the brief on the wall</button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={start}>Start building</button>
        </div>
      )}
    </section>
  );
}

/**
 * THE BRIEF IS THE PATH (O1, O2): one line per step, done, asking now or
 * next. A line opens that step on the Now card; a done line offers its probes.
 */
export function BriefPath({ room, focus, setFocus, busy, ended, run, api }) {
  const opening = room.opening || { steps: [] };
  const cur = focusStep(opening, focus);
  const probe = (step, question) => run(() => api.createAsk({ kind: 'suggest', prompt: question, detail: '', openingStep: step.key, probe: true }));
  return (
    <section className="brm-briefpath" aria-label="The opening: the build brief">
      <p className="brm-hint">One line per step. Click a line to work on it; Claude reads each as it lands.</p>
      <ol className="brm-bp">
        {opening.steps.map((st) => (
          <li key={st.key} className={`brm-bp-it is-${st.status}${cur && cur.key === st.key ? ' is-focus' : ''}`}>
            <button type="button" className="brm-bp-line" onClick={() => setFocus(st.key)} aria-current={cur && cur.key === st.key ? 'step' : undefined}>
              <span className="brm-bp-dot" aria-hidden="true" />
              <span className="brm-bp-k">{st.label}</span>
              <span className="brm-bp-v">{st.value || (st.status === 'skipped' ? 'Skipped' : st.status === 'asking' ? 'Asking the room now' : st.host ? 'You answer this one' : st.question)}</span>
            </button>
            {!ended && st.status === 'done' && st.probes.length > 0 && (
              <div className="brm-bp-probes" role="group" aria-label={`Probe ${st.label}`}>
                {st.probes.map((p) => <button key={p} type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => probe(st, p)}>{p}</button>)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * THE BUILD BRIEF ON THE WALL (O3): what the room decided, read back like the
 * start of a press release, before Claude builds.
 */
export function WallBrief({ room, busy, run, api, host }) {
  const b = room.brief || { lines: {}, keep: [] };
  const l = b.lines || {};
  const never = (b.keep || []).map((i) => i.text).join('; ');
  const rows = [
    ['Making', l.kind], ['For', b.forWhom], ['Today', l.problem], ['Good looks like', l.good], ['We will know', l.proof],
    ['Never', never], ['First build', l.firstBuild], ['Tools, style', l.tools], ['Look and feel', l.look],
  ].filter(([, v]) => v);
  return (
    <section className="brm-stage brm-wallbrief" aria-label="The build brief">
      <span className="brm-eyebrow"><b>The build brief</b>{room.opening && room.opening.phase === 'opening' ? ' · framing the build' : ''}</span>
      <h2 className="brm-q">{room.title || 'What we are building'}</h2>
      {rows.length ? (
        <dl className="brm-wb-lines">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
          ))}
        </dl>
      ) : <p className="brm-detail">The room's answers appear here as each step is decided.</p>}
      {host && room.opening && room.opening.phase === 'opening' && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--primary" disabled={busy} onClick={() => run(() => api.openingAction('start', {}))}>Start building</button>
        </div>
      )}
    </section>
  );
}
