/**
 * BUILD ROOM — the host's page (docs/design/build-room/PLAN.md, index.html).
 *
 *   /build                         → the create form
 *   /build?gameId=NNNN             → the room: the current ask, the timeline,
 *                                    the ideas inbox, Connect Claude Code
 *   /build?gameId=NNNN&view=report → the report (BuildReport.jsx)
 *
 * The same page is the wall (Present mode, the P key, hides every host-only
 * control, the ideas inbox, host notes, names and the key) and the host's
 * phone remote (one column under 900px).
 *
 * LIVE. A host WebSocket (ticketed, as GameHostPage's) refetches GET
 * build/state on every `buildChanged`; an 8s poll is the fallback, because a
 * dropped socket must never leave the wall frozen on an old vote.
 *
 * UNTRUSTED TEXT. Everything Claude or a phone wrote is rendered as text —
 * React escapes it — and never as HTML. A link renders only when it is
 * http(s) (`safeHref`).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import webSocketClient from '../WebSocketClient';
import { copyText } from '../utils/copyText';
import BuildReport from './BuildReport';
import BuildImage, { ImageLoader } from './BuildImage';
import {
  pluginInstallCommand,
  pluginConnectCommand,
  hostImageUrl,
  apiBase, buildApi, createBuildSession, buildRoomPath, connectCommand, safeHref,
} from './buildHostApi';
import './BuildRoom.css';

export const POLL_MS = 8000;

// ── Words ───────────────────────────────────────────────────────────────────

export const KIND_LABEL = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate' };
export const STATUS_LABEL = {
  proposed: 'Proposed',
  live: 'Live',
  voting: 'Voting',
  results: 'Closed',
  decided: 'Decided',
  discarded: 'Discarded',
};

/** One sentence under each stage: what happens next, and what the host does. Hidden in Present. */
export function stageHint(ask) {
  if (!ask) return 'Claude is working. Log what the room says, or ask the room yourself.';
  switch (ask.status) {
    case 'proposed': return "The room can't see this yet. Edit it, then open it.";
    case 'live': return ask.kind === 'suggest'
      ? 'The room is suggesting. Open voting when you have enough ideas.'
      : 'The room is answering. Close it when the count settles.';
    case 'voting': return 'The room is voting. Close it when the count settles.';
    case 'results': return 'Shape the direction, then send it to Claude.';
    default: return '';
  }
}

/** The first-run strip on an empty room. */
export const HOW_IT_WORKS = [
  'Connect Claude Code: mint a key and paste one command.',
  'Paste the Kick off prompt into Claude Code.',
  'Claude asks the room. You shape each answer and send it back.',
  'Wrap up, then share the report.',
];

/** The prompt cards (PLAN §7). The MCP server serves the same four as slash commands. */
export const PROMPT_CARDS = [
  {
    name: 'kickoff',
    title: 'Kick off',
    text: 'Read the room with room_status. Restate the goal, tell the room your plan in three short steps with post_update, then start building. Ask the room only at real decision points.',
  },
  {
    name: 'ideas',
    title: 'Ask the room for ideas',
    text: 'Ask the room for ideas about what matters most for this next step, using ask_room_for_ideas. Keep building what does not depend on it, call wait_for_room, then build from the host\'s direction.',
  },
  {
    name: 'ab-mockups',
    title: 'Show A/B mockups',
    text: 'Build two quick variants of the next screen. Create the ask first with ask_room_to_choose, stamp each variant with the exact letter Engage returns, tell me their local URLs, then wait_for_room and build the decision.',
  },
  {
    name: 'continue',
    title: 'Continue',
    text: 'Pick up my latest direction from the Build Room with check_directions and room_status, do it, post what changed, then call wait_for_direction and keep listening for the next one.',
  },
  {
    name: 'wrap-up',
    title: 'Wrap up',
    text: 'We are wrapping up. Call room_status, then write the outcome with wrap_up: a short summary for the room, what you built, the running demo link first, and next steps. Post a final milestone thanking the room, then call wait_for_direction.',
  },
];
export const slashCommand = (name) => `/mcp__engage__${name}`;
/** With the Engage plugin the same prompts are the plugin's own commands. */
export const pluginCommand = (name) => `/engage:${name}`;

const askNumber = (askId) => Number(askId) || askId;

export function clockTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function agoText(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Who wrote a timeline entry, in the wall's words. */
export function byLabel(entry) {
  if (entry.by === 'agent') return entry.kind === 'showing' ? 'Showing' : 'Claude';
  if (entry.by === 'system') return 'System';
  if (entry.by === 'room' || entry.kind === 'idea') return 'Idea';
  switch (entry.kind) {
    case 'verbal': return 'Room said';
    case 'decision': return 'Decided';
    case 'direction': return 'To Claude';
    case 'note': return 'Host note';
    case 'milestone': return 'Milestone';
    case 'outcome': return 'Wrap-up';
    default: return 'Host';
  }
}

/** One dot colour per family on the timeline. */
const entryTone = (entry) => {
  if (entry.by === 'agent') return 'claude';
  if (entry.kind === 'decision' || entry.kind === 'direction') return 'decision';
  if (entry.kind === 'verbal' || entry.kind === 'idea') return 'verbal';
  if (entry.kind === 'note') return 'note';
  if (entry.by === 'system') return 'ask';
  return 'host';
};

/** The direction the decide panel starts with: the room's top answer, as a sentence. */
export function defaultDirection(ask) {
  const r = (ask && ask.results) || {};
  if (ask.kind === 'choice') {
    const top = [...(r.options || [])].sort((a, b) => b.count - a.count)[0];
    return top && top.count ? `Go with ${top.label}: ${top.title}.` : '';
  }
  if (ask.kind === 'rating') {
    return r.rating && r.rating.avg !== null && r.rating.avg !== undefined
      ? `The room rated this ${r.rating.avg} out of 5.` : '';
  }
  const top = (r.ranked || [])[0];
  return top ? `The room's top idea: ${top.text}` : '';
}

/** What the host can fold into the direction with one click. */
export function foldSources(ask) {
  const r = (ask && ask.results) || {};
  const out = [];
  if (ask.kind === 'suggest') {
    (r.ranked || []).slice(0, 6).forEach((x, i) => {
      if (i > 0) out.push({ id: `resp:${x.respId}`, text: x.text, respId: x.respId });
    });
  } else {
    if (ask.kind === 'choice') {
      const sorted = [...(r.options || [])].sort((a, b) => b.count - a.count);
      sorted.slice(1).forEach((o) => {
        if (o.count) out.push({ id: `opt:${o.label}`, text: `Keep something from ${o.label} (${o.title})`, label: o.label });
      });
    }
    (r.whys || []).slice(0, 6).forEach((w, i) => out.push({ id: `why:${i}`, text: w.text }));
  }
  return out;
}

const appendSentence = (base, text) => {
  const b = String(base || '').trim();
  if (!b) return text;
  return /[.!?]$/.test(b) ? `${b} ${text}` : `${b}. ${text}`;
};

const removeSentence = (base, text) => String(base || '')
  .replace(`. ${text}`, '').replace(` ${text}`, '').replace(text, '')
  .trim();

const isTyping = (el) => {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

/** A ticking clock for "active 6s ago". */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A link only when it is http(s); otherwise the text, inert. */
function SafeLink({ href, children, className }) {
  const url = safeHref(href);
  if (!url) return children ? <span className={className}>{children}</span> : null;
  return <a className={className} href={url} target="_blank" rel="noopener noreferrer">{children || url}</a>;
}

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * A link the HOST opens on this laptop — a mockup, the demo, something Claude
 * is showing. Local addresses work here because Claude runs on this laptop;
 * that is the point, so the button says where it goes.
 */
export function OpenLink({ href, label, primary = false }) {
  if (!safeHref(href)) return null;
  return (
    <a className={`brm-btn brm-openbtn${primary ? ' brm-btn--primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer" title={href}>
      <Icon name="ArrowSquareOut" size={16} /> {label}
    </a>
  );
}

export default function BuildRoomPage() {
  const params = new URLSearchParams(window.location.search);
  const gameId = (params.get('gameId') || '').trim();
  if (!gameId) return <BuildCreate />;
  return <BuildRoom gameId={gameId} initialView={params.get('view') === 'report' ? 'report' : 'room'} />;
}

// ── Create ──────────────────────────────────────────────────────────────────

export function BuildCreate({ navigate = (url) => window.location.assign(url) }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [accessCode, setAccessCode] = useState('');
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) { setError('Give the room a title.'); return; }
    if (visibility === 'private' && !accessCode.trim()) { setError('A private room needs an access code.'); return; }
    setBusy(true);
    setError('');
    try {
      const gameId = await createBuildSession({ title, goal, visibility, accessCode });
      if (!review) {
        try { await buildApi(gameId).saveSettings({ reviewAgentAsks: false }); } catch (e) { /* the room can switch it */ }
      }
      navigate(buildRoomPath(gameId));
    } catch (e) {
      setError(e.message || 'The room could not be created.');
      setBusy(false);
    }
  };

  return (
    <div className="brm brm-createpage" data-theme="dark">
      <form className="brm-card brm-create" onSubmit={submit} aria-labelledby="brm-create-title">
        <div className="brm-dh">
          <h1 id="brm-create-title">New Build Room</h1>
          <a className="brm-x" href="/" aria-label="Close"><Icon name="X" size={16} /></a>
        </div>
        <p className="brm-sub">A room of people and your own Claude Code build something together. Claude asks the room at real decision points; you shape every answer before it reaches Claude.</p>
        <label className="brm-field">
          <span className="brm-lbl">Title</span>
          <input className="brm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Volunteer sign-up for the food bank" />
        </label>
        <label className="brm-field">
          <span className="brm-lbl">Goal: what should exist when we&apos;re done?</span>
          <textarea className="brm-input brm-ta" value={goal} maxLength={2000} onChange={(e) => setGoal(e.target.value)} placeholder="A one-page site where a volunteer can pick a shift in under a minute, on a phone." />
          <span className="brm-hint">Claude reads this first. It shows on the wall and at the top of the report.</span>
        </label>
        <fieldset className="brm-field brm-fieldset">
          <legend className="brm-lbl">Who can join</legend>
          <label className="brm-check"><input type="radio" name="brm-vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Anyone with the code</label>
          <label className="brm-check"><input type="radio" name="brm-vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private: an access code as well</label>
          {visibility === 'private' && (
            <input className="brm-input" aria-label="Access code" value={accessCode} maxLength={40} onChange={(e) => setAccessCode(e.target.value)} placeholder="Access code" />
          )}
        </fieldset>
        <label className="brm-check brm-field">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          <span>Review Claude&apos;s questions before the room sees them<span className="brm-hint brm-block">Recommended. You can switch this off in the room.</span></span>
        </label>
        {error && <div className="brm-alert" role="alert">{error}</div>}
        <div className="brm-row">
          <a className="brm-btn brm-btn--ghost" href="/">Cancel</a>
          <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── The room ────────────────────────────────────────────────────────────────

export function BuildRoom({ gameId, initialView = 'room' }) {
  const api = useMemo(() => buildApi(gameId), [gameId]);
  // Screenshots are private: fetched with the host's sign-in (buildHostApi).
  const loadImage = useCallback((imageId) => hostImageUrl(gameId, imageId), [gameId]);
  const [room, setRoom] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [present, setPresent] = useState(false);
  const [view, setView] = useState(initialView);
  const [dialog, setDialog] = useState(null); // 'connect' | 'wrap' | 'end' | {compose: kind}
  const now = useNow(5000);

  const inFlight = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        try {
          const next = await api.state();
          setRoom(next);
          setLoadError('');
        } catch (e) {
          setLoadError(e.message || 'The room could not be loaded.');
        }
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  // First load, the fallback poll, and the host socket.
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    webSocketClient.onMessage('buildChanged', () => refresh());
    webSocketClient.onMessage('gameEnded', () => refresh());
    webSocketClient.onReconnected(() => refresh());
    webSocketClient.connect(gameId, null, true, { hostTicket: () => api.hostTicket() });
    return () => {
      clearInterval(poll);
      webSocketClient.disconnect();
      webSocketClient.offMessage('buildChanged');
      webSocketClient.offMessage('gameEnded');
      webSocketClient.onReconnected(null);
    };
  }, [api, gameId, refresh]);

  // P toggles Present, unless somebody is typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      setPresent((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Every host action: one at a time, the server's sentence on failure, then refetch. */
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      const out = await fn();
      await refresh();
      return out;
    } catch (e) {
      setError(e.message || 'That did not work.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const goView = (next) => {
    setView(next);
    try {
      const url = next === 'report' ? `${buildRoomPath(gameId)}&view=report` : buildRoomPath(gameId);
      window.history.pushState({}, '', url);
    } catch (e) { /* the view still changes */ }
  };

  if (!room) {
    return (
      <div className="brm brm-loading" data-theme="dark">
        {loadError
          ? <div className="brm-alert" role="alert">{loadError} <a className="brm-link" href="/">Back to the host page</a></div>
          : <p className="brm-muted">Opening the Build Room…</p>}
      </div>
    );
  }

  if (view === 'report') return <ImageLoader.Provider value={loadImage}><BuildReport state={room} onBack={() => goView('room')} /></ImageLoader.Provider>;

  const host = !present;
  const ended = room.state === 'ENDED';
  const asks = room.asks || [];
  const proposed = asks.filter((a) => a.status === 'proposed');
  const current = asks.find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;
  const firstRun = !asks.length && !(room.log || []).some((l) => l.by === 'agent');

  return (
    <ImageLoader.Provider value={loadImage}>
    <div className={`brm brm-room${present ? ' brm--present' : ''}`} data-theme="dark">
      <RoomHeader
        room={room}
        now={now}
        host={host}
        present={present}
        onPresent={() => setPresent((p) => !p)}
        onConnect={() => setDialog('connect')}
        onWrap={() => setDialog('wrap')}
        onReport={() => goView('report')}
        onEnd={() => setDialog('end')}
        ended={ended}
      />
      {host && error && (
        <div className="brm-alert brm-alert--bar" role="alert">
          {error}
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {host && loadError && <div className="brm-alert brm-alert--bar" role="alert">{loadError}</div>}
      {ended && <div className="brm-notice brm-notice--bar">This session has ended. The timeline, the wrap-up and the report are still yours to edit.</div>}

      <div className="brm-grid">
        <main className="brm-main">
          {host && firstRun && (
            <section className="brm-panel brm-howto" aria-labelledby="brm-howto-h">
              <h2 className="brm-h" id="brm-howto-h">How a Build Room works</h2>
              <ol className="brm-steps">
                {HOW_IT_WORKS.map((text, i) => (
                  <li key={text}><span className="brm-n">{i + 1}</span>{text}</li>
                ))}
              </ol>
              {!room.agent?.key && (
                <button type="button" className="brm-btn brm-btn--primary" onClick={() => setDialog('connect')}>
                  <Icon name="Lock" size={16} /> Connect Claude Code
                </button>
              )}
            </section>
          )}

          {host && proposed.map((ask) => (
            <ReviewCard key={`${ask.askId}:${ask.status}`} ask={ask} busy={busy} ended={ended} run={run} api={api} connected={room.agent?.connected} />
          ))}

          {current ? (
            <AskStage key={`${current.askId}:${current.status}`} ask={current} room={room} host={host} busy={busy} ended={ended} run={run} api={api} />
          ) : (
            <IdleStage room={room} now={now} host={host && !ended} />
          )}

          <JoinFoot gameId={gameId} room={room} current={current} />

          {host && !ended && (
            <NextPanel agent={room.agent} busy={busy} run={run} api={api} onCompose={(kind) => setDialog({ compose: kind })} />
          )}

          <AskList asks={asks} host={host} busy={busy} ended={ended} run={run} api={api} currentAskId={room.currentAskId} />
          {host && <ShotsPanel images={room.images || []} busy={busy} run={run} api={api} />}
        </main>

        <aside className="brm-side">
          {host && <IdeasInbox ideas={room.ideas || []} current={current} busy={busy} ended={ended} run={run} api={api} />}
          <Timeline log={room.log || []} host={host} busy={busy} ended={ended} run={run} api={api} />
        </aside>
      </div>

      {host && dialog === 'connect' && (
        <ConnectPanel room={room} gameId={gameId} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog === 'wrap' && (
        <WrapUpPanel outcome={room.outcome} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog === 'end' && (
        <EndDialog api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
      {host && dialog && dialog.compose && (
        <AskComposer kind={dialog.compose} api={api} run={run} busy={busy} onClose={() => setDialog(null)} />
      )}
    </div>
    </ImageLoader.Provider>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

export function agentChipText(agent, now) {
  if (!agent) return 'Claude Code not connected';
  const name = agent.name || 'Claude Code';
  if (agent.listening) return `${name} is listening for you`;
  if (agent.connected) return `${name} connected · active ${agoText(agent.lastSeenAt, now) || 'just now'}`;
  if (agent.lastSeenAt) return `${name} last seen ${agoText(agent.lastSeenAt, now)}`;
  return `${name} not connected`;
}

function AgentChip({ agent, now }) {
  return (
    <span className={`brm-agentchip${agent && agent.connected ? ' is-on' : ''}`} data-testid="brm-agentchip">
      {agentChipText(agent, now)}
    </span>
  );
}

function RoomHeader({ room, now, host, present, onPresent, onConnect, onWrap, onReport, onEnd, ended }) {
  return (
    <header className="brm-hbar">
      <div className="brm-hbar-title">
        <span className="brm-t" title={room.title}>{room.title || 'Build Room'}</span>
        {room.goal && <span className="brm-goal" title={room.goal}>{room.goal}</span>}
      </div>
      <div className="brm-hbar-tools">
        <span className="brm-codewrap"><span className="brm-muted brm-small">Join code</span> <span className="brm-code">{room.gameId}</span></span>
        <span className="brm-chip">{room.playerCount || 0} joined</span>
        <AgentChip agent={room.agent} now={now} />
        {host && (
          <>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onConnect}>
              <Icon name="Lock" size={14} /> Connect Claude Code
            </button>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onWrap}>Wrap up</button>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onReport}>
              <Icon name="FileText" size={14} /> Report
            </button>
            {!ended && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" onClick={onEnd}>End session</button>}
          </>
        )}
        <button
          type="button"
          className={`brm-btn brm-btn--sm brm-btn--ghost${present ? ' is-on' : ''}`}
          onClick={onPresent}
          aria-pressed={present}
          title="Present mode hides every host-only control (P)"
        >
          <Icon name="Monitor" size={14} /> {present ? 'Exit present' : 'Present'}
        </button>
      </div>
    </header>
  );
}

function JoinFoot({ gameId, room, current }) {
  const origin = window.location.origin;
  const playUrl = `${origin}/play?gameId=${gameId}`;
  const answered = current ? (current.kind === 'suggest' && current.status === 'voting' ? current.voteCount : current.answerCount) : null;
  return (
    <div className="brm-foot">
      <div className="brm-join">
        <div className="brm-qr" aria-label={`QR code to join at ${playUrl}`} role="img">
          <QRCodeSVG value={playUrl} size={84} level="M" includeMargin={false} />
        </div>
        <div className="brm-jt"><b>{window.location.host}/play</b>code</div>
        <span className="brm-jc">{gameId}</span>
      </div>
      {current && current.status !== 'results' ? (
        <div className="brm-resp">
          {answered || 0} of {room.playerCount || 0}{' '}
          <span>{current.status === 'voting' ? 'have voted' : current.kind === 'suggest' ? 'suggestions so far' : 'have answered'}</span>
        </div>
      ) : (
        <div className="brm-resp">Got an idea? <span>Send it from your phone any time</span></div>
      )}
    </div>
  );
}

// ── Review (proposed) ───────────────────────────────────────────────────────

function ReviewCard({ ask, busy, ended, run, api, connected }) {
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const [options, setOptions] = useState(() => (ask.options || []).map((o) => ({ ...o })));
  const [low, setLow] = useState(ask.scale?.lowLabel || '');
  const [high, setHigh] = useState(ask.scale?.highLabel || '');

  const optionsDirty = JSON.stringify(options.map(({ title, detail: d, url }) => [title, d, url]))
    !== JSON.stringify((ask.options || []).map(({ title, detail: d, url }) => [title, d, url]));
  const dirty = prompt !== ask.prompt || detail !== (ask.detail || '') || optionsDirty
    || low !== (ask.scale?.lowLabel || '') || high !== (ask.scale?.highLabel || '');

  const editBody = () => ({
    action: 'edit',
    prompt,
    detail,
    ...(ask.kind === 'choice' ? { options: options.map(({ title, detail: d, url }) => ({ title, detail: d, url })) } : {}),
    ...(ask.kind === 'rating' ? { lowLabel: low, highLabel: high } : {}),
  });

  const save = () => run(() => api.askAction(ask.askId, editBody()));
  const open = () => run(async () => {
    if (dirty) await api.askAction(ask.askId, editBody());
    return api.askAction(ask.askId, { action: 'open' });
  });
  const discard = () => run(() => api.askAction(ask.askId, { action: 'discard' }));
  const setOpt = (i, key, value) => setOptions((list) => list.map((o, j) => (j === i ? { ...o, [key]: value } : o)));
  const letter = (i) => String.fromCharCode(65 + i);

  return (
    <section className="brm-panel brm-proposed" aria-label={`Proposed ask ${askNumber(ask.askId)}`}>
      <div className="brm-row brm-gap">
        <span className="brm-chip brm-chip--amber">{ask.source === 'agent' ? 'Proposed by Claude' : 'Draft'} · not shown to the room</span>
        {ask.source === 'agent' && connected && <span className="brm-muted brm-small brm-push">Claude is waiting</span>}
      </div>
      <div className="brm-row brm-gap">
        <h2 className="brm-h">Ask {askNumber(ask.askId)} · {KIND_LABEL[ask.kind]}</h2>
        {ask.kind === 'choice' && <span className="brm-hint brm-push">Options can change until someone answers</span>}
      </div>
      <p className="brm-stagehint">{stageHint(ask)}</p>
      <label className="brm-field">
        <span className="brm-lbl">Question (shown big on the wall)</span>
        <input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <label className="brm-field">
        <span className="brm-lbl">Context (optional)</span>
        <textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} />
      </label>
      {ask.kind === 'choice' && (
        <div className="brm-field">
          <span className="brm-lbl">Options</span>
          {options.map((o, i) => (
            <div className="brm-optedit" key={o.label || i}>
              <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letter(i)}</span>
              <div className="brm-optfields">
                <input className="brm-input" aria-label={`Option ${letter(i)} title`} value={o.title} maxLength={120} onChange={(e) => setOpt(i, 'title', e.target.value)} />
                <input className="brm-input brm-input--sm" aria-label={`Option ${letter(i)} preview URL`} placeholder="Preview URL (optional, http or https)" value={o.url || ''} onChange={(e) => setOpt(i, 'url', e.target.value)} />
                <BuildImage imageId={(ask.options[i] || {}).imageId} alt={`Choice ${letter(i)}`} className="brm-shot brm-shot--thumb" />
              </div>
              {/* Only the LAST option can go: the server letters options by
                  position, and Claude has already stamped "Choice A" and "B". */}
              {i === options.length - 1 && options.length > 2 ? (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label={`Remove ${letter(i)}`} onClick={() => setOptions((l) => l.slice(0, -1))}>
                  <Icon name="X" size={14} />
                </button>
              ) : <span />}
            </div>
          ))}
          {options.length < 6 && (
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setOptions((l) => [...l, { title: '', detail: '', url: '' }])}>
              <Icon name="Plus" size={14} /> Add option
            </button>
          )}
          <div className="brm-notice"><b>Letters are fixed.</b> Claude stamps &quot;Choice A&quot;, &quot;Choice B&quot; on its mockups, so renaming an option keeps its letter.</div>
        </div>
      )}
      {ask.kind === 'rating' && (
        <div className="brm-two">
          <label className="brm-field"><span className="brm-lbl">1 means</span><input className="brm-input" value={low} maxLength={40} onChange={(e) => setLow(e.target.value)} /></label>
          <label className="brm-field"><span className="brm-lbl">5 means</span><input className="brm-input" value={high} maxLength={40} onChange={(e) => setHigh(e.target.value)} /></label>
        </div>
      )}
      {!ended && (
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghostdanger" disabled={busy} onClick={discard}>Discard</button>
          {dirty && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy} onClick={save}>Save edits</button>}
          <button type="button" className={`brm-btn brm-btn--primary${dirty ? '' : ' brm-push'}`} disabled={busy || !prompt.trim()} onClick={open}>Open to the room</button>
        </div>
      )}
    </section>
  );
}

// ── The current ask ─────────────────────────────────────────────────────────

function AskStage({ ask, room, host, busy, ended, run, api }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(ask.prompt);
  const [detail, setDetail] = useState(ask.detail || '');
  const act = (action) => run(() => api.askAction(ask.askId, { action }));
  const saveWording = async () => {
    const ok = await run(() => api.askAction(ask.askId, { action: 'edit', prompt, detail }));
    if (ok !== undefined) setEditing(false);
  };

  return (
    <>
      <section className={`brm-stage brm-stage--${ask.status}`} aria-label="Current ask">
        <div className="brm-top">
          <span className="brm-eyebrow">
            <b>{ask.status === 'voting' ? 'Vote' : KIND_LABEL[ask.kind]}</b> · Ask {askNumber(ask.askId)} · {ask.source === 'agent' ? 'Claude asks' : 'Host asks'}
            {ask.status === 'results' && ' · Closed'}
          </span>
          {host && !ended && (
            <span className="brm-hostkit">
              {!editing && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setEditing(true)}>Edit wording</button>}
              {ask.status === 'live' && ask.kind === 'suggest' && (
                <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act('vote')}>Open voting</button>
              )}
              {['live', 'voting'].includes(ask.status) && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => act('close')}>Close</button>
              )}
              {ask.status === 'results' && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => act('reopen')}>Reopen</button>
              )}
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => act('discard')}>Discard</button>
            </span>
          )}
        </div>
        {host && !ended && <p className="brm-stagehint">{stageHint(ask)}</p>}
        {host && editing ? (
          <div className="brm-panel brm-inset">
            <label className="brm-field"><span className="brm-lbl">Question</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
            <label className="brm-field"><span className="brm-lbl">Context</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></label>
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { setEditing(false); setPrompt(ask.prompt); setDetail(ask.detail || ''); }}>Cancel</button>
              <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !prompt.trim()} onClick={saveWording}>Save wording</button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="brm-q">{ask.prompt}</h2>
            {ask.detail && <p className="brm-detail">{ask.detail}</p>}
          </>
        )}

        {ask.kind === 'choice' && <ChoiceBoard ask={ask} />}
        {ask.kind === 'rating' && <RatingBoard ask={ask} />}
        {ask.kind === 'suggest' && <SuggestBoard ask={ask} host={host} busy={busy} ended={ended} run={run} api={api} />}
        {ask.status === 'results' && ask.kind !== 'suggest' && <Whys ask={ask} host={host} />}
      </section>
      {host && !ended && ask.status === 'results' && (
        <DecidePanel ask={ask} busy={busy} run={run} api={api} playerCount={room.playerCount} />
      )}
    </>
  );
}

function ChoiceBoard({ ask }) {
  const opts = (ask.results && ask.results.options) || [];
  const lead = Math.max(0, ...opts.map((o) => o.count));
  return (
    <div className="brm-choices">
      {(ask.options || []).map((o, i) => {
        const r = opts.find((x) => x.label === o.label) || { count: 0, pct: 0 };
        return (
          <div key={o.label} className={`brm-choice brm-choice--${i % 3}${lead && r.count === lead ? ' is-lead' : ''}`}>
            <div className="brm-choice-head">
              <span className="brm-big" aria-hidden="true">{o.label}</span>
              <div className="brm-choice-text">
                <div className="brm-ct"><span className="brm-sr">Choice {o.label}: </span>{o.title}</div>
                {o.detail && <div className="brm-cd">{o.detail}</div>}
                <OpenLink href={o.url} label={`Open ${o.label}`} />
              </div>
            </div>
            <BuildImage imageId={o.imageId} alt={`Choice ${o.label}: ${o.title}`} className="brm-shot brm-shot--opt" />
            <div className="brm-bar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></div>
            <div className="brm-count"><b>{r.count}</b> {r.pct}%</div>
          </div>
        );
      })}
    </div>
  );
}

function RatingBoard({ ask }) {
  const rating = (ask.results && ask.results.rating) || { avg: null, count: 0, dist: [0, 0, 0, 0, 0] };
  const max = Math.max(1, ...(rating.dist || []));
  return (
    <div className="brm-rating">
      <div className="brm-rating-avg">
        <b>{rating.avg === null || rating.avg === undefined ? '–' : rating.avg}</b>
        <span>average of {rating.count || 0}</span>
      </div>
      <div className="brm-dist">
        {[1, 2, 3, 4, 5].map((n) => (
          <div className="brm-distrow" key={n}>
            <span className="brm-distn">{n}{n === 1 && ask.scale?.lowLabel ? ` · ${ask.scale.lowLabel}` : ''}{n === 5 && ask.scale?.highLabel ? ` · ${ask.scale.highLabel}` : ''}</span>
            <div className="brm-bar"><span style={{ width: `${((rating.dist || [])[n - 1] || 0) / max * 100}%` }} /></div>
            <span className="brm-distc">{(rating.dist || [])[n - 1] || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestBoard({ ask, host, busy, ended, run, api }) {
  const [said, setSaid] = useState('');
  const all = ask.responses || [];
  const shown = host ? all : all.filter((r) => !r.hidden);
  const counting = ask.status !== 'live';
  const sorted = counting ? [...shown].sort((a, b) => (b.votes || 0) - (a.votes || 0)) : shown;
  const max = Math.max(1, ...sorted.map((r) => r.votes || 0));
  const add = async (e) => {
    e.preventDefault();
    if (!said.trim()) return;
    const ok = await run(() => api.addResponse(ask.askId, said.trim()));
    if (ok !== undefined) setSaid('');
  };
  return (
    <div className="brm-suggest">
      {!sorted.length && <div className="brm-empty">Suggestions appear here as phones send them. Anonymous on the wall.</div>}
      <ul className="brm-sugs">
        {sorted.map((r) => (
          <li key={r.respId} className={`brm-sug${r.hidden ? ' is-hidden' : ''}`}>
            <span className="brm-sug-text">{r.text}</span>
            {counting && (
              <span className="brm-sug-votes">
                <span className="brm-bar brm-bar--thin" aria-hidden="true"><span style={{ width: `${((r.votes || 0) / max) * 100}%` }} /></span>
                <b>{r.votes || 0}</b> {(r.votes || 0) === 1 ? 'vote' : 'votes'}
              </span>
            )}
            {host && <span className="brm-who">{r.source === 'host' ? 'from the room, out loud' : r.playerName}{r.hidden ? ' · hidden' : ''}</span>}
            {host && !ended && (
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => run(() => api.responseAction(ask.askId, r.respId, { action: r.hidden ? 'show' : 'hide' }))}>
                {r.hidden ? 'Show' : 'Hide'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {host && !ended && ask.status !== 'results' && (
        <form className="brm-verbal" onSubmit={add}>
          <Icon name="Microphone" size={16} color="var(--success)" />
          <input className="brm-input" aria-label="Add what the room said" placeholder="+ add what the room said out loud" value={said} maxLength={280} onChange={(e) => setSaid(e.target.value)} />
          <button type="submit" className="brm-btn brm-btn--sm" disabled={busy || !said.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}

function Whys({ ask, host }) {
  const whys = (ask.results && ask.results.whys) || [];
  if (!whys.length) return null;
  return (
    <div className="brm-whysbox">
      <span className="brm-lbl">Reasons</span>
      <ul className="brm-whys">
        {whys.map((w, i) => (
          <li key={i}>
            <span className="brm-letter brm-letter--sm" aria-hidden="true">{w.label}</span>
            <span className="brm-w">{w.text}</span>
            {host && w.playerName && <span className="brm-who">{w.playerName}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecidePanel({ ask, busy, run, api, playerCount }) {
  const [direction, setDirection] = useState(() => defaultDirection(ask));
  const [note, setNote] = useState('');
  const [send, setSend] = useState(true);
  const [folded, setFolded] = useState(() => new Set());
  const sources = foldSources(ask);
  const topChoice = ask.kind === 'choice'
    ? [...((ask.results && ask.results.options) || [])].sort((a, b) => b.count - a.count).filter((o) => o.count)[0]
    : null;
  const [chosen, setChosen] = useState(() => {
    if (topChoice) return [topChoice.label];
    if (ask.kind === 'suggest' && ask.results?.ranked?.[0]) return [ask.results.ranked[0].respId];
    return [];
  });

  const toggleFold = (s) => {
    const next = new Set(folded);
    if (next.has(s.id)) {
      next.delete(s.id);
      setDirection((d) => removeSentence(d, s.text));
      if (s.respId) setChosen((c) => c.filter((x) => x !== s.respId));
    } else {
      next.add(s.id);
      setDirection((d) => appendSentence(d, s.text));
      if (s.respId) setChosen((c) => [...c, s.respId]);
    }
    setFolded(next);
  };
  const toggleChosen = (label) => setChosen((c) => (c.includes(label) ? c.filter((x) => x !== label) : [...c, label]));

  const decide = () => run(() => api.askAction(ask.askId, {
    action: 'decide', direction: direction.trim(), chosen, note: note.trim(), sendToAgent: send,
  }));
  const total = ask.results?.total || 0;

  return (
    <section className="brm-panel brm-decide" aria-labelledby={`brm-decide-${ask.askId}`}>
      <h2 className="brm-h" id={`brm-decide-${ask.askId}`}>Direction for Claude</h2>
      <p className="brm-sub">Claude builds from this sentence, not from the counts. Edit it freely. {total} of {playerCount || 0} answered.</p>
      <textarea className="brm-input brm-ta brm-dirbox" aria-label="Direction for Claude" value={direction} maxLength={2000} onChange={(e) => setDirection(e.target.value)} placeholder="What should Claude do now?" />
      {ask.kind === 'choice' && (
        <div className="brm-field">
          <span className="brm-lbl">Chosen</span>
          <div className="brm-foldchips">
            {(ask.options || []).map((o) => (
              <button key={o.label} type="button" className={`brm-fold${chosen.includes(o.label) ? ' is-in' : ''}`} aria-pressed={chosen.includes(o.label)} onClick={() => toggleChosen(o.label)}>
                {o.label} · {o.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="brm-field">
          <span className="brm-lbl">Fold in from the room</span>
          <div className="brm-foldchips">
            {sources.map((s) => (
              <button key={s.id} type="button" className={`brm-fold${folded.has(s.id) ? ' is-in' : ''}`} aria-pressed={folded.has(s.id)} onClick={() => toggleFold(s)}>
                <Icon name="Plus" size={12} /> {s.text}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="brm-field">
        <span className="brm-lbl">What the room said (optional; goes to Claude with the direction)</span>
        <input className="brm-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "show how many spots are left"' />
      </label>
      <div className="brm-row brm-gap">
        <label className="brm-toggle">
          <input type="checkbox" role="switch" checked={send} onChange={(e) => setSend(e.target.checked)} />
          <span>Send to Claude</span>
        </label>
        <span className="brm-hint">{send ? "Delivered on Claude's next call" : 'Recorded in the timeline only'}</span>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || (!direction.trim() && !total)} onClick={decide}>
          <Icon name="ArrowRight" size={16} /> {send ? 'Send to Claude' : 'Record decision'}
        </button>
      </div>
    </section>
  );
}

// ── Between asks ────────────────────────────────────────────────────────────

const TICKER_KINDS = ['progress', 'showing', 'milestone'];

/** Claude has wrapped up: the stage says so, and the demo is one click away. */
function WrappedStage({ outcome, agent, images = [] }) {
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

function IdleStage({ room, now, host }) {
  if (room.outcome && room.outcome.summary) return <WrappedStage outcome={room.outcome} agent={room.agent} images={room.images || []} />;
  const shots = (room.images || []).filter((i) => i.kind !== 'mockup');
  const latestShot = shots[shots.length - 1] || null;
  const log = room.log || [];
  const agentPosts = log.filter((l) => l.by === 'agent' && TICKER_KINDS.includes(l.kind));
  const ticker = agentPosts.slice(-3).reverse();
  const decided = (room.asks || []).filter((a) => a.status === 'decided' && a.decision).sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const latest = decided[decided.length - 1] || null;
  const since = latest ? latest.decidedAt : (agentPosts[0] && agentPosts[0].createdAt);
  const mins = since ? Math.max(0, Math.round((now - Date.parse(since)) / 60000)) : null;
  const waiting = !agentPosts.length && !(room.agent && room.agent.connected);

  return (
    <section className="brm-stage brm-stage--idle" aria-label="Claude is building">
      <div className="brm-building">
        <span className="brm-pulse" aria-hidden="true" />
        <h2 className="brm-q">{waiting ? 'Waiting for Claude Code…' : room.agent && room.agent.listening ? 'Claude is listening…' : 'Claude is building…'}</h2>
        {!waiting && mins !== null && <span className="brm-mins">working for {mins} min</span>}
      </div>
      {host && <p className="brm-stagehint">{waiting ? 'Connect Claude Code, then paste the Kick off prompt.' : stageHint(null)}</p>}
      {latest && (
        <div className="brm-latest">
          <div className="brm-kind">Latest decision · Ask {askNumber(latest.askId)}</div>
          <div className="brm-tx">{latest.decision.direction}</div>
        </div>
      )}
      {latestShot && <BuildImage imageId={latestShot.imageId} caption={latestShot.caption} className="brm-shot brm-shot--latest" />}
      {ticker.length > 0 ? (
        <ul className="brm-ticker">
          {ticker.map((t, i) => (
            <li key={t.logId} className={i === 0 ? 'is-newest' : undefined}>
              <span className="brm-kind">{t.kind}</span>
              <span className="brm-tx">{t.text}</span>
              <span className="brm-ago">{agoText(t.createdAt, now)}</span>
              {safeHref(t.link) && <span className="brm-tickopen"><OpenLink href={t.link} label="Open" /></span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress posts appear here while it builds.</div>
      )}
    </section>
  );
}

// ── Screenshots ─────────────────────────────────────────────────────────────

const SHOT_KIND = { mockup: 'Mockup', final: 'Final', progress: 'Progress' };

/** Every screenshot Claude sent, for the host to check or remove. */
function ShotsPanel({ images, busy, run, api }) {
  const [confirm, setConfirm] = useState(null);
  return (
    <section className="brm-panel" aria-labelledby="brm-shots-h">
      <h2 className="brm-h" id="brm-shots-h">Screenshots</h2>
      {!images.length ? (
        <p className="brm-hint">Claude&apos;s screenshots of mockups and of the finished product collect here, and go into the report.</p>
      ) : (
        <div className="brm-shotgrid">
          {images.slice().reverse().map((im) => (
            <div className="brm-shotcell" key={im.imageId}>
              <BuildImage imageId={im.imageId} caption={im.caption} className="brm-shot brm-shot--grid" />
              <div className="brm-row brm-gap brm-small">
                <span className="brm-chip">{im.label ? `Choice ${im.label}` : SHOT_KIND[im.kind] || im.kind}</span>
                {confirm === im.imageId ? (
                  <>
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirm(null)}>Keep</button>
                    <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy} onClick={() => run(() => api.deleteImage(im.imageId))}>Remove</button>
                  </>
                ) : (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger brm-push" aria-label={`Remove ${im.caption || 'screenshot'}`} onClick={() => setConfirm(im.imageId)}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── What next ───────────────────────────────────────────────────────────────

/** What a direction will do, said honestly: Claude only hears it on a call. */
export function deliveryLine(agent) {
  if (agent && agent.listening) return 'Claude is listening. It will act on this straight away.';
  if (agent && agent.connected) return 'Claude reads this on its next step.';
  return 'Claude reads this when it next calls Engage. If it has stopped, paste the Continue prompt into Claude Code.';
}

const CONTINUE_PROMPT = PROMPT_CARDS.find((c) => c.name === 'continue');

/**
 * The two things a host does between asks, in one place: tell Claude what to
 * do next, or ask the room something. Always here, while Claude builds and
 * after it wraps up, so steering never means hunting for the control.
 */
function NextPanel({ agent, busy, run, api, onCompose }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const send = async (e) => {
    e.preventDefault();
    const words = text.trim();
    if (!words) return;
    const ok = await run(() => api.postDirection(words));
    if (ok !== undefined) { setText(''); setSent(words); }
  };
  const quiet = !(agent && (agent.listening || agent.connected));
  return (
    <section className="brm-panel brm-next" aria-labelledby="brm-next-h">
      <h2 className="brm-h" id="brm-next-h">What next?</h2>
      <div className="brm-next-grid">
        <form className="brm-next-tell" onSubmit={send}>
          <label className="brm-label" htmlFor="brm-tell">Tell Claude</label>
          <textarea
            id="brm-tell"
            className="brm-input brm-ta"
            placeholder="e.g. Make the sign-up button bigger, and add the parking map the room asked for."
            value={text}
            maxLength={2000}
            onChange={(e) => { setText(e.target.value); setSent(''); }}
          />
          <p className="brm-hint">{deliveryLine(agent)}</p>
          <div className="brm-row brm-gap">
            <button type="submit" className="brm-btn brm-btn--primary" disabled={busy || !text.trim()}>
              <Icon name="PaperPlaneTilt" size={16} /> Send to Claude
            </button>
            {quiet && CONTINUE_PROMPT && <CopyButton text={CONTINUE_PROMPT.text} label="Copy the Continue prompt" />}
          </div>
          {sent && <p className="brm-hint" role="status">Sent: {sent}</p>}
        </form>
        <div className="brm-next-ask">
          <div className="brm-label">Ask the room</div>
          <div className="brm-askbtns brm-askbtns--stack">
            <button type="button" className="brm-btn brm-askbtn" onClick={() => onCompose('suggest')}>Ideas<span>everyone suggests, then votes</span></button>
            <button type="button" className="brm-btn brm-askbtn" onClick={() => onCompose('choice')}>Choose<span>A / B / C</span></button>
            <button type="button" className="brm-btn brm-askbtn" onClick={() => onCompose('rating')}>Rate<span>1–5 pulse</span></button>
          </div>
          <p className="brm-hint">When you decide, the answer goes to Claude too.</p>
        </div>
      </div>
    </section>
  );
}

// ── Every ask ───────────────────────────────────────────────────────────────

function AskList({ asks, host, busy, ended, run, api, currentAskId }) {
  const shown = host ? asks : asks.filter((a) => !['proposed', 'discarded'].includes(a.status));
  if (!shown.length) return null;
  return (
    <section className="brm-panel" aria-labelledby="brm-asks-h">
      <h2 className="brm-h" id="brm-asks-h">Asks</h2>
      <table className="brm-tbl">
        <thead>
          <tr>
            <th className="brm-col-n">#</th>
            <th>Question</th>
            <th className="brm-col-kind">Kind</th>
            <th className="brm-col-state">Status</th>
            {host && !ended && <th className="brm-col-acts"><span className="brm-sr">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {[...shown].reverse().map((a) => (
            <tr key={a.askId} className={a.askId === currentAskId ? 'is-current' : undefined}>
              <td className="brm-num">{askNumber(a.askId)}</td>
              <td>
                <span className="brm-nm" title={a.prompt}>{a.prompt}</span>
                {a.decision && <span className="brm-subline" title={a.decision.direction}>Decided: {a.decision.direction}</span>}
              </td>
              <td>{KIND_LABEL[a.kind]}</td>
              <td><span className={`brm-chip brm-chip--${a.status}`}>{STATUS_LABEL[a.status] || a.status}</span></td>
              {host && !ended && (
                <td>
                  <div className="brm-rowact">
                    {a.status === 'proposed' && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'open' }))}>Open</button>}
                    {['live', 'voting'].includes(a.status) && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'close' }))}>Close</button>}
                    {['results', 'decided'].includes(a.status) && <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.askAction(a.askId, { action: 'reopen' }))}>Reopen</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

function TimelineEntry({ entry, host, busy, ended, run, api }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(entry.text);
  const save = async () => {
    const ok = await run(() => api.logAction(entry.logId, { action: 'edit', text }));
    if (ok !== undefined) setEditing(false);
  };
  return (
    <li className={`brm-tl-${entryTone(entry)}`}>
      <span className="brm-tm">{clockTime(entry.createdAt)}</span>
      <span className="brm-dot" aria-hidden="true" />
      <div className="brm-tl-body">
        {editing ? (
          <div className="brm-tl-edit">
            <textarea className="brm-input brm-ta brm-ta--sm" aria-label="Edit entry" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => { setEditing(false); setText(entry.text); }}>Cancel</button>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy || !text.trim()} onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <span className="brm-by">{byLabel(entry)}</span>
            <span className="brm-tl-text">{entry.text}</span>
            {entry.detail && !['direction', 'image'].includes(entry.kind) && <span className="brm-tl-detail">{entry.detail}</span>}
            {entry.kind === 'image' && <BuildImage imageId={entry.detail} alt={entry.text} className="brm-shot brm-shot--tl" />}
            {safeHref(entry.link) && <SafeLink className="brm-lnk brm-block" href={entry.link}>{entry.link}</SafeLink>}
            {host && entry.forAgent && <span className="brm-tl-flag">{entry.deliveredAt ? 'Claude has it' : 'Waiting for Claude'}</span>}
          </>
        )}
        {host && !editing && (
          <span className="brm-tl-acts">
            {confirming ? (
              <>
                <span className="brm-hint">Delete this entry?</span>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy} onClick={() => run(() => api.logAction(entry.logId, { action: 'delete' }))}>Delete</button>
              </>
            ) : (
              <>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" aria-label={`Edit "${entry.text}"`} onClick={() => setEditing(true)}>Edit</button>
                {!ended && <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger" aria-label={`Delete "${entry.text}"`} onClick={() => setConfirming(true)}>Delete</button>}
              </>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

const WALL_HIDDEN_KINDS = ['note', 'ask', 'direction'];
const WALL_DETAIL_HIDDEN_KINDS = ['decision', 'idea'];

function Timeline({ log, host, busy, ended, run, api }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState('verbal');
  const [forAgent, setForAgent] = useState(false);
  // Newest first: in a live room the latest thing Claude or the room did is
  // what everyone looks for, and the panel scrolls.
  // On the wall (Present) the timeline is the room's, as on the phones: no host
  // notes, no system bookkeeping (the asks table says it), and no detail on a
  // decision or an idea — that is the host's note or the idea's author.
  const shown = (host ? log : log
    .filter((l) => !WALL_HIDDEN_KINDS.includes(l.kind))
    .map((l) => (WALL_DETAIL_HIDDEN_KINDS.includes(l.kind) ? { ...l, detail: '' } : l)))
    .slice().reverse();
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await run(() => api.postLog({ kind, text: text.trim(), forAgent: kind !== 'note' && forAgent }));
    if (ok !== undefined) { setText(''); setForAgent(false); }
  };
  return (
    <section className="brm-panel brm-tlpanel" aria-labelledby="brm-tl-h">
      <h2 className="brm-h5" id="brm-tl-h">Timeline</h2>
      {host && !ended && (
        <form className="brm-quicklog" onSubmit={submit}>
          <label className="brm-sr" htmlFor="brm-quicklog-text">Log what the room said</label>
          <textarea id="brm-quicklog-text" className="brm-input brm-ta brm-ta--sm" placeholder="Log what the room said…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <div className="brm-row brm-gap">
            <select className="brm-input brm-input--sm brm-select" aria-label="Entry kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="verbal">Room said</option>
              <option value="note">Host note (never shown)</option>
              <option value="milestone">Milestone</option>
            </select>
            <label className="brm-check brm-small">
              <input type="checkbox" checked={kind !== 'note' && forAgent} disabled={kind === 'note'} onChange={(e) => setForAgent(e.target.checked)} />
              Send to Claude
            </label>
            <button type="submit" className="brm-btn brm-btn--sm brm-push" disabled={busy || !text.trim()}>Log</button>
          </div>
        </form>
      )}
      {shown.length ? (
        <ul className="brm-tl">
          {shown.map((entry) => (
            <TimelineEntry key={`${entry.logId}:${entry.editedAt || ''}`} entry={entry} host={host} busy={busy} ended={ended} run={run} api={api} />
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress, the room&apos;s decisions and what people say out loud collect here.</div>
      )}
    </section>
  );
}

// ── Ideas inbox (host only) ─────────────────────────────────────────────────

function IdeasInbox({ ideas, current, busy, ended, run, api }) {
  const fresh = ideas.filter((i) => i.status === 'new');
  const handled = ideas.filter((i) => i.status !== 'new');
  const canSuggest = Boolean(current && current.kind === 'suggest' && ['live', 'voting'].includes(current.status));
  const act = (idea, action) => run(() => api.ideaAction(idea.ideaId, action));
  return (
    <section className="brm-inbox" aria-labelledby="brm-inbox-h">
      <h2 className="brm-h5" id="brm-inbox-h">Ideas inbox · {fresh.length} new <span className="brm-hostonly">host only</span></h2>
      {!fresh.length && <p className="brm-hint">Phones can send an idea at any time. They land here for you to triage.</p>}
      {fresh.map((idea) => (
        <div className="brm-idea" key={idea.ideaId}>
          <div className="brm-idea-text">{idea.text}</div>
          <div className="brm-who">{idea.playerName} · {clockTime(idea.createdAt)}</div>
          {!ended && (
            <div className="brm-idea-acts">
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act(idea, 'direct')}>Send to Claude</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy || !canSuggest} title={canSuggest ? undefined : 'Open an Ideas ask first'} onClick={() => act(idea, 'suggest')}>Add to current ideas</button>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => act(idea, 'dismiss')}>Dismiss</button>
            </div>
          )}
        </div>
      ))}
      {handled.length > 0 && (
        <details className="brm-handled">
          <summary>{handled.length} handled</summary>
          {handled.map((idea) => (
            <div className="brm-idea brm-idea--done" key={idea.ideaId}>
              <div className="brm-idea-text">{idea.text}</div>
              <div className="brm-who">{idea.playerName} · {idea.status === 'dismissed' ? 'dismissed' : 'used'}</div>
              {!ended && idea.status === 'dismissed' && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} onClick={() => act(idea, 'restore')}>Restore</button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function DialogHead({ id, title, onClose }) {
  return (
    <div className="brm-dh">
      <h2 className="brm-h" id={id}>{title}</h2>
      <button type="button" className="brm-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>
    </div>
  );
}

function CopyButton({ text, label = 'Copy', className = 'brm-btn brm-btn--sm' }) {
  const [said, setSaid] = useState('');
  const copy = async () => {
    const ok = await copyText(text);
    setSaid(ok ? 'Copied' : 'Press and hold to copy');
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      <Icon name="ClipboardText" size={14} /> {said || label}
    </button>
  );
}

export function ConnectPanel({ room, gameId, api, run, busy, onClose }) {
  // THE KEY IS SHOWN ONCE: it lives in this component's state only, and is
  // gone when the panel closes. The server stores only its sha256.
  const [minted, setMinted] = useState(null);
  const [confirmMint, setConfirmMint] = useState(false);
  const agent = room.agent || {};
  const liveKey = agent.key;
  const command = minted ? connectCommand({ origin: window.location.origin, api: apiBase(), key: minted.key }) : '';
  const install = pluginInstallCommand({ origin: window.location.origin, api: apiBase() });
  const connectLine = minted ? pluginConnectCommand(minted.key) : '';

  const mint = async () => {
    setConfirmMint(false);
    const out = await run(() => api.mintKey('Claude Code'));
    if (out && out.key) setMinted({ key: out.key, keyId: out.keyId });
  };
  const revoke = async () => {
    if (!liveKey) return;
    await run(() => api.revokeKey(liveKey.keyId));
    setMinted(null);
  };

  const step = (done, wait) => (done ? 'is-done' : wait ? 'is-wait' : '');

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--wide" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-connect-title">
      <DialogHead id="brm-connect-title" title="Connect Claude Code" onClose={onClose} />
      <p className="brm-sub">Claude Code runs on this laptop. The Engage plugin connects it to the room and saves every step in git. Needs Node 18 or later.</p>

      <h3 className="brm-h5">Once per laptop: install the Engage plugin</h3>
      <pre className="brm-cmd" data-testid="brm-install">{install}</pre>
      <div className="brm-row brm-gap">
        <CopyButton text={install} label="Copy install command" />
        <span className="brm-hint">Run it in a terminal. It adds the plugin to Claude Code: the Engage tools, the /engage commands, and a checkpoint in git at the end of every turn (in this project only; never pushed).</span>
      </div>

      <h3 className="brm-h5">Each session: connect with this room&apos;s key</h3>
      {minted ? (
        <>
          <div className="brm-keywarn"><Icon name="Lock" size={16} color="var(--primary)" />
            <div><b>This key is shown once.</b> It only works for this room and stops when you revoke it or the session ends. Lost it? Mint a new one; the old key stops working immediately.</div>
          </div>
          <pre className="brm-cmd" data-testid="brm-connect">{connectLine}</pre>
          <div className="brm-row brm-gap">
            <CopyButton text={connectLine} label="Copy" className="brm-btn brm-btn--sm brm-btn--primary" />
            <span className="brm-hint">Type it into Claude Code, in your project folder. Key …{minted.key.slice(-4)} · minted just now</span>
          </div>
          <details className="brm-alt">
            <summary>Without the plugin</summary>
            <p className="brm-hint">One command in the terminal instead, then restart Claude Code. No automatic checkpoints; Claude can still call checkpoint.</p>
            <pre className="brm-cmd" data-testid="brm-command">{command}</pre>
            <CopyButton text={command} label="Copy command" />
          </details>
        </>
      ) : liveKey ? (
        <div className="brm-notice">
          <b>A key is active</b> (minted {clockTime(liveKey.createdAt)}{liveKey.lastUsedAt ? `, last used ${clockTime(liveKey.lastUsedAt)}` : ', not used yet'}). It was shown once and cannot be shown again.
          Lost the command? Mint a new key; the old one stops working at once.
        </div>
      ) : (
        <div className="brm-notice">No key yet. Minting one gives you the command to paste.</div>
      )}

      <div className="brm-row brm-gap">
        {confirmMint ? (
          <>
            <span className="brm-hint">The current key stops working immediately.</span>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirmMint(false)}>Keep it</button>
            <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={mint}>Mint a new key</button>
          </>
        ) : (
          <button type="button" className={`brm-btn brm-btn--sm${minted ? '' : ' brm-btn--primary'}`} disabled={busy} onClick={() => (liveKey ? setConfirmMint(true) : mint())}>
            {liveKey ? 'Mint a new key' : 'Mint a key'}
          </button>
        )}
        {liveKey && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger brm-push" disabled={busy} onClick={revoke}>Revoke key</button>}
      </div>

      <ol className="brm-steps">
        <li className={step(Boolean(liveKey || minted), !(liveKey || minted))}>
          <span className="brm-n">1</span>
          <span>Install the plugin (once), then mint a key. It appears once.</span>
        </li>
        <li className={step(Boolean(agent.lastSeenAt), Boolean(liveKey || minted) && !agent.lastSeenAt)}>
          <span className="brm-n">2</span>
          <span>{agent.lastSeenAt
            ? 'Claude Code has called in.'
            : 'In Claude Code, type the /engage:connect line above.'}</span>
        </li>
        <li className={step(false, Boolean(agent.lastSeenAt))}>
          <span className="brm-n">3</span>
          <span>Type {pluginCommand('kickoff')}, or paste the Kick off card below.</span>
        </li>
      </ol>

      <label className="brm-check brm-field">
        <input
          type="checkbox"
          checked={room.settings ? room.settings.reviewAgentAsks !== false : true}
          disabled={busy}
          onChange={(e) => run(() => api.saveSettings({ reviewAgentAsks: e.target.checked }))}
        />
        <span>Review Claude&apos;s questions before the room sees them<span className="brm-hint brm-block">When off, Claude&apos;s asks open to the room straight away.</span></span>
      </label>

      <h3 className="brm-h5">Prompt cards: paste into Claude Code</h3>
      <p className="brm-hint">Each is also a command in Claude Code: {PROMPT_CARDS.map((p) => pluginCommand(p.name)).join(', ')} with the plugin, or {slashCommand('kickoff')} and so on without it.</p>
      <div className="brm-cards">
        {PROMPT_CARDS.map((p) => (
          <div className="brm-pcard" key={p.name}>
            <div className="brm-pt">{p.title} <span className="brm-slash">{pluginCommand(p.name)}</span></div>
            <p className="brm-pq">{p.text}</p>
            <CopyButton text={p.text} />
          </div>
        ))}
      </div>
      <p className="brm-hint">Game {gameId}. The key is never shown in Present mode.</p>
      <div className="brm-row"><button type="button" className="brm-btn brm-push" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

export function WrapUpPanel({ outcome, api, run, busy, onClose }) {
  const o = outcome || {};
  const initial = useMemo(() => ({
    summary: o.summary || '',
    built: (o.built || []).join('\n'),
    links: (o.links || []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
    nextSteps: (o.nextSteps || []).join('\n'),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to the wrap-up?')) return;
    onClose();
  };
  const save = async () => {
    const body = {
      summary: form.summary.trim(),
      built: lines(form.built),
      links: lines(form.links).map((l) => {
        const [a, b] = l.split('|').map((x) => x.trim());
        return b ? { label: a, url: b } : { label: '', url: a };
      }),
      nextSteps: lines(form.nextSteps),
    };
    const ok = await run(() => api.saveOutcome(body));
    if (ok !== undefined) onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brm-wrap-title">
      <DialogHead id="brm-wrap-title" title="Wrap up" onClose={requestClose} />
      <p className="brm-sub">{o.by === 'agent' ? 'Claude wrote this at wrap-up. Edit anything; ' : 'What the room built. '}It leads the report.</p>
      <label className="brm-field"><span className="brm-lbl">Summary</span><textarea className="brm-input brm-ta" value={form.summary} maxLength={4000} onChange={set('summary')} /></label>
      <label className="brm-field"><span className="brm-lbl">What we built (one per line)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.built} onChange={set('built')} /></label>
      <label className="brm-field"><span className="brm-lbl">Links (one per line: label | https://…)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.links} onChange={set('links')} /></label>
      <label className="brm-field"><span className="brm-lbl">Next steps (one per line)</span><textarea className="brm-input brm-ta brm-ta--sm" value={form.nextSteps} onChange={set('nextSteps')} /></label>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
        <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !form.summary.trim()} onClick={save}>Save wrap-up</button>
      </div>
    </Modal>
  );
}

function EndDialog({ api, run, busy, onClose }) {
  const end = async () => {
    const ok = await run(() => api.endSession());
    if (ok !== undefined) onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-end-title">
      <DialogHead id="brm-end-title" title="End this session?" onClose={onClose} />
      <p>Phones stop answering, no new asks can open, and Claude&apos;s calls are refused from now on. The timeline, the wrap-up and the report stay, and you can still edit them.</p>
      <p className="brm-hint">Only want to pause? Leave it open and close the current ask instead.</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Keep it running</button>
        <button type="button" className="brm-btn brm-btn--dangersolid brm-push" disabled={busy} onClick={end}>End session</button>
      </div>
    </Modal>
  );
}

export function AskComposer({ kind: initialKind, api, run, busy, onClose }) {
  const [kind, setKind] = useState(initialKind);
  const [prompt, setPrompt] = useState('');
  const [detail, setDetail] = useState('');
  const [options, setOptions] = useState([{ title: '', url: '' }, { title: '', url: '' }]);
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [draft, setDraft] = useState(false);
  const dirty = Boolean(prompt || detail || options.some((o) => o.title));
  const requestClose = () => {
    if (dirty && !window.confirm('Discard this question?')) return;
    onClose();
  };
  const filled = options.filter((o) => o.title.trim());
  const ready = prompt.trim() && (kind !== 'choice' || filled.length >= 2);
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    const body = {
      kind,
      prompt: prompt.trim(),
      detail: detail.trim(),
      ...(kind === 'choice' ? { options: filled.map((o) => ({ title: o.title.trim(), url: o.url.trim() })) } : {}),
      ...(kind === 'rating' ? { lowLabel: low.trim(), highLabel: high.trim() } : {}),
      ...(draft ? { draft: true } : {}),
    };
    const ok = await run(() => api.createAsk(body));
    if (ok !== undefined) onClose();
  };
  const setOpt = (i, k, v) => setOptions((l) => l.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brm-compose-title">
      <form onSubmit={submit}>
        <DialogHead id="brm-compose-title" title="Ask the room" onClose={requestClose} />
        <div className="brm-seg" role="radiogroup" aria-label="Kind of ask">
          {['suggest', 'choice', 'rating'].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`brm-segbtn${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <label className="brm-field"><span className="brm-lbl">Question (shown big on the wall)</span><input className="brm-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} /></label>
        <label className="brm-field"><span className="brm-lbl">Context (optional)</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></label>
        {kind === 'choice' && (
          <div className="brm-field">
            <span className="brm-lbl">Options</span>
            {options.map((o, i) => (
              <div className="brm-optedit" key={i}>
                <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <div className="brm-optfields">
                  <input className="brm-input" aria-label={`Option ${String.fromCharCode(65 + i)}`} value={o.title} maxLength={120} onChange={(e) => setOpt(i, 'title', e.target.value)} />
                  <input className="brm-input brm-input--sm" aria-label={`Option ${String.fromCharCode(65 + i)} preview URL`} placeholder="Preview URL (optional)" value={o.url} onChange={(e) => setOpt(i, 'url', e.target.value)} />
                </div>
                {i === options.length - 1 && options.length > 2 ? (
                  <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label="Remove option" onClick={() => setOptions((l) => l.slice(0, -1))}><Icon name="X" size={14} /></button>
                ) : <span />}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setOptions((l) => [...l, { title: '', url: '' }])}><Icon name="Plus" size={14} /> Add option</button>}
          </div>
        )}
        {kind === 'rating' && (
          <div className="brm-two">
            <label className="brm-field"><span className="brm-lbl">1 means</span><input className="brm-input" value={low} maxLength={40} onChange={(e) => setLow(e.target.value)} /></label>
            <label className="brm-field"><span className="brm-lbl">5 means</span><input className="brm-input" value={high} maxLength={40} onChange={(e) => setHigh(e.target.value)} /></label>
          </div>
        )}
        <label className="brm-check brm-field"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as a draft; don&apos;t open it yet</label>
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
          <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy || !ready}>{draft ? 'Save draft' : 'Ask the room'}</button>
        </div>
      </form>
    </Modal>
  );
}
