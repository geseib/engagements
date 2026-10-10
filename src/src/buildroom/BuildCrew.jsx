/**
 * BUILD ROOM CREW MODE — the host's side (docs/design/build-room-crew/FLOWS.md,
 * storyboard index.html frames 1, 3, 4, 5, 6, 8, 9).
 *
 * Builders are people in the room with their own laptop and Claude Code. They
 * take a task, build on their own branch of the shared repo, and share EARLY LOOKS: screenshots,
 * what changed, what they are unsure of. The host curates: an early look lands
 * in the host's Incoming list and reaches the wall only when the host puts it
 * there. The host's Claude reviews under one visible switch, Run crew code:
 * On / Off (no prompt every time). Only the host merges.
 *
 * ONE REPO (owner, 2026-10-02): the whole team has access to the same repo.
 * Builders clone it, push their own branch crew/<name>/<task> and open a pull
 * request there. No forks, no patches, so no mode to pick.
 *
 * TWO KINDS OF PEOPLE: builders link their own Claude Code and build and test
 * on their laptop; everyone else follows on a phone (answers, reacts) with no
 * setup. The board says how many of each.
 *
 * Everything here reads `state.crew`, which build-crew.js `crewView(room,
 * 'host')` shapes, and calls the host crew routes in buildHostApi.js.
 *
 * PRESENT MODE (`host` false) shows the board, the pipeline and the featured
 * early look, and never: Incoming, a host button, a PR link, the
 * switch, help details, or the name of anyone in the room who reacted.
 *
 * UNTRUSTED TEXT. Builders' Claudes and phones wrote most of what is shown
 * here. It renders as text; a link renders only when it is http(s).
 */
import React, { useMemo, useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { copyText } from '../utils/copyText';
import BuildImage from './BuildImage';
import { safeHref, pluginSlash } from './buildHostApi';
import './BuildCrew.css';

// ── Words ───────────────────────────────────────────────────────────────────

export const BUILDER_STATUS = {
  'setting-up': 'Setting up',
  building: 'Building',
  synced: 'Synced',
  'needs-rebase': 'Needs a rebase',
  'needs-help': 'Needs help',
  idle: 'Idle',
};
const STATUS_TONE = {
  'setting-up': '', building: 'blue', synced: 'green', 'needs-rebase': 'red', 'needs-help': 'amber', idle: '',
};

export const LANE_LABEL = {
  shared: 'Early look', reviewed: 'Reviewed', pr: 'PR open', merged: 'Merged', 'not-now': 'Not now',
};
const LANE_TONE = { shared: 'amber', reviewed: 'blue', pr: 'blue', merged: 'green', 'not-now': '' };

/** The pipeline strip, left to right (crew.pipeline holds the counts). */
export const PIPELINE = [
  ['building', 'Building'],
  ['shared', 'Early look'],
  ['reviewed', 'Reviewed'],
  ['pr', 'PR open'],
  ['merged', 'Merged'],
];

export const RECOMMENDATION = { merge: 'Merge', 'merge-after-changes': 'Merge after changes', 'not-yet': 'Not yet' };
const REC_TONE = { merge: 'green', 'merge-after-changes': 'amber', 'not-yet': 'red' };

const REACTION = {
  'looks-right': { label: 'Looks right', tone: 'green', icon: 'Check' },
  question: { label: 'Question', tone: 'blue', icon: 'Question' },
  concern: { label: 'Concern', tone: 'amber', icon: 'Warning' },
};
const COMMENT_LABEL = {
  'looks-right': 'Looks right', question: 'Question', concern: 'Concern', feedback: 'Feedback sent', reply: 'Reply',
};

export const RUN_CREW_CODE_ON = "Claude may install and run builders' code on this laptop: their tests, and the project, to review or merge it.";
export const RUN_CREW_CODE_OFF = "Claude reads builders' code and runs none of it.";

/** How long the "Base moved" notice stays up. */
export const BASE_NOTICE_MS = 30 * 60 * 1000;

const short = (commit) => String(commit || '').slice(0, 7);

/** "checkpointed 4 min ago" and the like. */
export function minutesAgo(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

const clock = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
};

/** Early looks the host has not put on the wall yet, newest first. */
export function incomingShares(crew) {
  return ((crew && crew.shares) || [])
    .filter((s) => !s.featured && !['merged', 'not-now'].includes(s.lane))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

/** The early look the wall shows: the one the host featured most recently. */
export function featuredShare(crew) {
  const on = ((crew && crew.shares) || []).filter((s) => s.featured);
  return on.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
}

/** A builder's newest early look that is still moving. */
function liveShareOf(crew, name) {
  return ((crew && crew.shares) || [])
    .filter((s) => s.builder === name && !['merged', 'not-now'].includes(s.lane))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
}

/**
 * The feedback composer starts from what the room said on the latest version:
 * every question and concern, and how many said it looks right. The host edits
 * it before it goes.
 */
export function feedbackDraft(share) {
  if (!share) return '';
  const v = (share.versions || []).length;
  const onThis = (share.comments || []).filter((c) => !c.version || c.version === v);
  const said = (kind) => onThis.filter((c) => c.kind === kind && c.text).map((c) => `- ${c.text}`);
  const looks = onThis.filter((c) => c.kind === 'looks-right').length;
  const out = [];
  if (looks) out.push(`${looks} in the room said it looks right.`);
  const q = said('question');
  if (q.length) out.push('The room asked:', ...q);
  const c = said('concern');
  if (c.length) out.push('Concerns:', ...c);
  return out.join('\n').slice(0, 2000);
}

function Chip({ tone, children, title }) {
  return <span className={`brm-chip brc-chip${tone ? ` brc-tone-${tone}` : ''}`} title={title}>{children}</span>;
}

function Link({ href, children }) {
  const url = safeHref(href);
  if (!url) return children ? <span>{children}</span> : null;
  return <a className="brm-lnk" href={url} target="_blank" rel="noopener noreferrer">{children || url}</a>;
}

function DialogHead({ id, title, onClose }) {
  return (
    <div className="brm-dh">
      <h2 className="brm-h" id={id}>{title}</h2>
      {onClose && <button type="button" className="brm-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>}
    </div>
  );
}

function Copy({ text, label }) {
  const [said, setSaid] = useState('');
  return (
    <button
      type="button"
      className="brm-btn brm-btn--sm"
      onClick={async () => {
        const ok = await copyText(text);
        setSaid(ok ? 'Copied' : 'Press and hold to copy');
        setTimeout(() => setSaid(''), 2500);
      }}
    >
      <Icon name="ClipboardText" size={14} /> {said || label}
    </button>
  );
}

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';
function Avatar({ name, i = 0 }) {
  return <span className={`brc-av brc-av--${i % 4}`} aria-hidden="true">{initial(name)}</span>;
}

// ── The header switch ───────────────────────────────────────────────────────

/**
 * RUN CREW CODE: On / Off, always in view in the host's header while crew
 * mode is on. Off is neutral; On is amber, because Claude may then run other
 * people's code on this laptop. Turning it On asks once, right here.
 */
export function RunCrewCodeSwitch({ crew, busy, run, api }) {
  const [confirming, setConfirming] = useState(false);
  const on = Boolean(crew && crew.runCrewCode);
  const flip = () => (on ? run(() => api.crewSettings({ runCrewCode: false })) : setConfirming(true));
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`brc brc-switch${on ? ' is-on' : ''}`}
        disabled={busy}
        onClick={flip}
        title={on ? RUN_CREW_CODE_ON : RUN_CREW_CODE_OFF}
      >
        <Icon name="Terminal" size={14} />
        <span>Run crew code: <b>{on ? 'On' : 'Off'}</b></span>
      </button>
      {confirming && (
        <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm brc" onClose={() => setConfirming(false)} labelledBy="brc-run-title">
          <DialogHead id="brc-run-title" title="Switch Run crew code on?" onClose={() => setConfirming(false)} />
          <p>Claude may install and run builders&apos; code on this laptop: their tests, and the project, to review or merge it.</p>
          <p className="brm-hint">Their code is untrusted. Claude says in every review which way the switch was set. Switch it off again at any time.</p>
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--ghost" onClick={() => setConfirming(false)}>Keep it off</button>
            <button
              type="button"
              className="brm-btn brm-btn--primary brm-push"
              disabled={busy}
              onClick={async () => { setConfirming(false); await run(() => api.crewSettings({ runCrewCode: true })); }}
            >
              Switch on
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Open to a crew ──────────────────────────────────────────────────────────

/**
 * Turn crew mode on, pick how code travels, set the switch. The repo and base
 * branch are read-only here: the host's Claude shares them with share_repo,
 * because it is the one that knows the remote and cut the branch.
 */
export function CrewDialog({ crew, gameId, busy, run, api, shareCard, onClose }) {
  const c = crew || {};
  const enabled = Boolean(c.enabled);
  const [runCode, setRunCode] = useState(Boolean(c.runCrewCode));
  const [closing, setClosing] = useState(false);
  const dirty = enabled && runCode !== Boolean(c.runCrewCode);
  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to the crew settings?')) return;
    onClose();
  };
  const save = async () => {
    const ok = await run(() => api.crewSettings({ enabled: true, runCrewCode: runCode }));
    if (ok !== undefined) onClose();
  };
  const stop = async () => {
    const ok = await run(() => api.crewSettings({ enabled: false }));
    if (ok !== undefined) onClose();
  };
  const repo = c.repoUrl;

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--wide brc" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brc-open-title">
      <DialogHead id="brc-open-title" title={enabled ? 'The crew' : 'Open to a crew'} onClose={requestClose} />
      <p className="brm-sub">People in the room who brought a laptop with Claude Code can build parts of this with you. They build on their own branches and show you early looks. You decide what reaches the wall, and you alone merge.</p>
      <ul className="brc-kinds">
        <li><b>Builders</b> link their own Claude Code, and build and test on their own laptop.</li>
        <li><b>Everyone else</b> follows on their phone: answers, reacts and comments. No setup.</li>
      </ul>

      <h3 className="brm-h5">The project</h3>
      {repo ? (
        <dl className="brc-facts">
          <dt>Repository</dt><dd className="brm-mono"><Link href={repo}>{repo}</Link></dd>
          <dt>Base branch</dt>
          <dd><span className="brm-mono">{c.baseBranch || 'not set'}</span>{c.baseCommit && <span className="brm-hint"> at <span className="brm-mono">{short(c.baseCommit)}</span></span>}</dd>
        </dl>
      ) : (
        <div className="brm-notice brc-ask">
          <b>Claude has not shared the repo yet.</b> Ask Claude to share it: type <span className="brm-mono">{pluginSlash('share-repo')}</span> in Claude Code, or paste the card below. Claude cuts a base branch for this session and tells Engage the repo, the branch and the commit.
          {shareCard && <div className="brm-row brm-gap"><Copy text={shareCard.text} label={`Copy "${shareCard.title}"`} /></div>}
        </div>
      )}
      <p className="brc-access">
        <Icon name="GitBranch" size={16} />
        <span>
          Everyone has access to {repo ? 'this repo' : 'the repo'}. Builders push their own branch and open a pull request.
          {repo && <span className="brm-hint brm-block">Shared by your Claude. To change it, ask Claude to share the repo again.</span>}
        </span>
      </p>

      <h3 className="brm-h5">Running builders&apos; code</h3>
      <label className="brc-switchrow">
        <input type="checkbox" role="switch" checked={runCode} onChange={(e) => setRunCode(e.target.checked)} />
        <span><b>Run crew code: {runCode ? 'On' : 'Off'}</b><span className="brm-hint brm-block">{runCode ? RUN_CREW_CODE_ON : RUN_CREW_CODE_OFF} Builders run their own work on their own laptops either way. The switch stays in the header.</span></span>
      </label>

      <div className="brm-notice"><b>Builders join on their phone:</b> join with code {gameId} as usual, tap <b>I have Claude Code</b>, then type the line the phone shows into Claude Code. Up to 8 builders. Everyone else just joins.</div>

      {closing ? (
        <div className="brm-row brm-gap">
          <span className="brm-hint">Builders can no longer share or take tasks. Their early looks, reviews and tasks stay.</span>
          <button type="button" className="brm-btn brm-btn--ghost" onClick={() => setClosing(false)}>Keep the crew</button>
          <button type="button" className="brm-btn brm-btn--dangersolid brm-push" disabled={busy} onClick={stop}>Close the crew</button>
        </div>
      ) : (
        <div className="brm-row brm-gap">
          {enabled && <button type="button" className="brm-btn brm-btn--ghostdanger" onClick={() => setClosing(true)}>Close the crew</button>}
          <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>{enabled && !dirty ? 'Done' : 'Cancel'}</button>
          {(!enabled || dirty) && (
            <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy} onClick={save}>
              <Icon name="UsersThree" size={16} /> {enabled ? 'Save' : 'Open to a crew'}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── The stage switch ────────────────────────────────────────────────────────

export function StageTabs({ stage, onStage, crew, host }) {
  const builders = (crew.builders || []).length;
  const incoming = host ? incomingShares(crew).length : 0;
  return (
    <div className="brc brc-tabs" role="tablist" aria-label="What the stage shows">
      <button type="button" role="tab" aria-selected={stage === 'room'} className={`brc-tab${stage === 'room' ? ' is-on' : ''}`} onClick={() => onStage('room')}>
        <Icon name="ChatCircleText" size={16} /> The room
      </button>
      <button type="button" role="tab" aria-selected={stage === 'crew'} className={`brc-tab${stage === 'crew' ? ' is-on' : ''}`} onClick={() => onStage('crew')}>
        <Icon name="UsersThree" size={16} /> The crew
        <span className="brc-tabn">{builders} {builders === 1 ? 'builder' : 'builders'}</span>
        {incoming > 0 && <span className="brc-tabnew">{incoming} new</span>}
      </button>
    </div>
  );
}

// ── The crew board ──────────────────────────────────────────────────────────

function Pipeline({ counts }) {
  const c = counts || {};
  return (
    <ol className="brc-pipe" aria-label="Where the work is">
      {PIPELINE.map(([key, label]) => (
        <li key={key} className={`brc-pipe-${key}${c[key] ? ' has' : ''}`}>
          <span className="brc-pipe-l">{label}</span>
          <b className="brc-pipe-n">{c[key] || 0}</b>
        </li>
      ))}
    </ol>
  );
}

/** "Base moved" — after a merge every builder's Claude syncs and reports back. */
export function BaseNotice({ crew, now }) {
  const at = Date.parse(crew.baseMovedAt || '');
  if (!Number.isFinite(at) || now - at > BASE_NOTICE_MS) return null;
  const builders = crew.builders || [];
  const rebase = builders.filter((b) => b.status === 'needs-rebase');
  return (
    <section className="brc-base" aria-label="The base moved">
      <span className="brc-base-icon" aria-hidden="true"><Icon name="GitMerge" size={22} /></span>
      <div className="brc-base-text">
        <div className="brc-base-t">Base moved to <span className="brm-mono brc-commit">{short(crew.baseCommit)}</span>{crew.baseNote ? `: ${crew.baseNote}` : ''}</div>
        <div className="brm-hint">
          {minutesAgo(crew.baseMovedAt, now)}. Every builder&apos;s Claude was told to pull it in.
          {rebase.length > 0 && <> <span className="brc-red">{rebase.map((b) => b.name).join(', ')} {rebase.length === 1 ? 'needs' : 'need'} a rebase.</span></>}
        </div>
      </div>
      <div className="brc-base-chips">
        {builders.map((b) => (
          b.status === 'synced' ? <Chip key={b.name} tone="green">{b.name} synced</Chip>
            : b.status === 'needs-rebase' ? <Chip key={b.name} tone="red">{b.name}: needs a rebase</Chip>
              : <Chip key={b.name}>{b.name}: not synced yet</Chip>
        ))}
      </div>
    </section>
  );
}

function Lane({ b, i, crew, host, now, onOpen }) {
  const task = (crew.tasks || []).find((t) => t.taskId === b.taskId) || null;
  const share = liveShareOf(crew, b.name);
  const merged = (crew.shares || []).filter((s) => s.builder === b.name && s.lane === 'merged').length;
  const race = task && (task.claimedBy || []).length > 1;
  const rivals = race ? task.claimedBy.filter((n) => n !== b.name) : [];
  const flagged = ['needs-rebase', 'needs-help'].includes(b.status);
  // Nothing open and something merged: say so, not "Building" on old news.
  const taskMerged = (crew.shares || []).some((s) => s.builder === b.name && s.lane === 'merged' && s.taskId === b.taskId);
  const chip = !flagged && !share && taskMerged && b.status !== 'setting-up'
    ? <Chip tone="green">Merged</Chip>
    : flagged || !share
      ? <Chip tone={STATUS_TONE[b.status]}>{BUILDER_STATUS[b.status] || b.status}</Chip>
      : <Chip tone={LANE_TONE[share.lane]}>{LANE_LABEL[share.lane]} · v{share.versions.length}</Chip>;
  const checkpoint = minutesAgo(b.checkpointAt, now);
  return (
    <li className={`brc-lane brc-lane--${i % 4}${flagged ? ` is-${b.status}` : ''}`} aria-label={`${b.name}'s lane`}>
      <div className="brc-who">
        <Avatar name={b.name} i={i} />
        <div className="brc-who-t">
          <span className="brc-name">{b.name}</span>
          <span className="brm-hint">with Claude Code</span>
        </div>
      </div>
      <div className="brc-lane-body">
        <div className="brc-task" title={task ? task.text : undefined}>{task ? task.text : (b.status === 'setting-up' ? 'Setting up the laptop' : 'No task yet')}</div>
        {b.branch && <div className="brm-mono brc-branch">{b.branch}</div>}
        <div className="brc-lane-meta">
          {chip}
          {share && share.featured && <Chip tone="amber">On the wall</Chip>}
          <span className={`brm-hint${checkpoint && now - Date.parse(b.checkpointAt) > 10 * 60000 ? ' brc-stale' : ''}`}>
            {checkpoint ? `checkpointed ${checkpoint}` : 'no checkpoint yet'}
          </span>
          {race && <Chip tone="amber">Race with {rivals.join(', ')}</Chip>}
          {merged > 0 && <Chip tone="green">{merged} merged</Chip>}
        </div>
        {b.status === 'needs-rebase' && b.note && <div className="brc-note">{b.note}</div>}
        {host && share && (
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brc-openlook" title={share.title} onClick={() => onOpen(share.shareId)}>
            Open the early look{share.title ? `: ${share.title}` : ''}
          </button>
        )}
      </div>
      <div className="brc-lane-shot">
        {b.latestImageId
          ? <BuildImage imageId={b.latestImageId} alt={`${b.name}'s latest screenshot`} className="brc-shot" linked={host} />
          : <span className="brc-noshot">No screenshot yet</span>}
      </div>
    </li>
  );
}

function HelpCard({ b, crew, busy, run, api, now }) {
  const task = (crew.tasks || []).find((t) => t.taskId === b.taskId);
  return (
    <section className="brc-help" aria-label={`${b.name} asks for help`}>
      <div className="brm-row">
        <Icon name="Lifebuoy" size={18} color="var(--primary)" />
        <b>{b.name} asks for help</b>
        {task && <span className="brm-hint">{task.text}</span>}
        {b.lastSeenAt && <span className="brm-hint brm-push">{minutesAgo(b.lastSeenAt, now)}</span>}
      </div>
      {b.note && <blockquote className="brc-quote">{b.note}</blockquote>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => run(() => api.crewHelpAction(b.name, 'send-claude'))}>
          <Icon name="MagnifyingGlass" size={14} /> Send my Claude
        </button>
        <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.crewHelpAction(b.name, 'resolve'))}>
          <Icon name="Check" size={14} /> Mark handled
        </button>
        <span className="brm-hint">Your Claude fetches the branch, reads it and posts suggestions. It runs nothing of theirs while Run crew code is Off.</span>
      </div>
    </section>
  );
}

/** The crew board: base notice, help, pipeline, one lane per builder (storyboard frame 4). */
export function crewHeadline(crew, playerCount) {
  const n = (crew.builders || []).length;
  const following = Math.max(0, (Number(playerCount) || 0) - n);
  return `${n} building with Claude Code · ${following} following along`;
}

export function CrewBoard({ crew, host, now, busy, run, api, onOpen, playerCount = 0 }) {
  const builders = crew.builders || [];
  const needHelp = builders.filter((b) => b.status === 'needs-help');
  return (
    <section className="brc brc-board" aria-labelledby="brc-board-h">
      <div className="brc-board-head">
        <h2 className="brm-h" id="brc-board-h"><span className="brc-amber">Crew</span> · {crewHeadline(crew, playerCount)}</h2>
        {crew.baseBranch && (
          <span className="brm-hint">
            {crew.repoUrl && <><span className="brm-mono">{crew.repoUrl}</span> · </>}base <span className="brm-mono">{crew.baseBranch}</span>{crew.baseCommit && <> at <span className="brm-mono">{short(crew.baseCommit)}</span></>}
          </span>
        )}
      </div>
      <BaseNotice crew={crew} now={now} />
      {host && needHelp.map((b) => <HelpCard key={b.name} b={b} crew={crew} busy={busy} run={run} api={api} now={now} />)}
      <Pipeline counts={crew.pipeline} />
      {builders.length ? (
        <ul className="brc-lanes">
          {builders.map((b, i) => <Lane key={b.name} b={b} i={i} crew={crew} host={host} now={now} onOpen={onOpen} />)}
        </ul>
      ) : (
        <div className="brm-empty">No builders yet. Anyone with a laptop and Claude Code can build: on the phone, tap I have Claude Code. Everyone else follows along on their phone.</div>
      )}
    </section>
  );
}

// ── Incoming (host only) ────────────────────────────────────────────────────

export function CrewIncoming({ crew, busy, run, api, onOpen }) {
  const list = incomingShares(crew);
  return (
    <section className="brc brc-incoming" aria-labelledby="brc-in-h">
      <h2 className="brm-h5" id="brc-in-h">Incoming · {list.length} <span className="brm-hostonly">host only</span></h2>
      {!list.length && <p className="brm-hint">Early looks land here first. The room sees one only when you put it on the wall.</p>}
      {list.map((s, i) => {
        const v = s.versions[s.versions.length - 1] || {};
        const review = s.reviews[s.reviews.length - 1];
        return (
          <div className="brc-in" key={s.shareId}>
            <div className="brm-row">
              <Avatar name={s.builder} i={i} />
              <b className="brc-in-who">{s.builder} · {LANE_LABEL[s.lane]} v{v.v || s.versions.length}</b>
              <span className="brm-hint brm-push">{clock(v.createdAt || s.updatedAt)}</span>
            </div>
            <div className="brc-in-t">{s.title}</div>
            {review && <div className="brm-hint">Claude: {RECOMMENDATION[review.recommendation] || review.recommendation}</div>}
            <div className="brc-in-acts">
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.crewShareAction(s.shareId, 'feature'))}>Put on the wall</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.crewReviewRequest(s.shareId))}>Ask Claude to review</button>
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => onOpen(s.shareId)}>Open</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ── An early look ───────────────────────────────────────────────────────────

function ReviewCard({ r }) {
  return (
    <section className="brc-review" aria-label={`Review by Claude on v${r.version}`}>
      <div className="brm-row">
        <Icon name="MagnifyingGlass" size={16} color="var(--secondary)" />
        <b>Review by Claude</b>
        <span className="brm-hint">on v{r.version}{r.createdAt ? ` · ${clock(r.createdAt)}` : ''}</span>
        <span className="brm-push"><Chip tone={REC_TONE[r.recommendation]}>{RECOMMENDATION[r.recommendation] || r.recommendation}</Chip></span>
      </div>
      <dl className="brc-rev">
        <dt>What it does</dt><dd>{r.does}</dd>
        {r.fits.length > 0 && <><dt>How it fits</dt><dd><ul>{r.fits.map((f, i) => <li key={i}>{f}</li>)}</ul></dd></>}
        {r.risk && <><dt>Risk</dt><dd>{r.risk}</dd></>}
        {r.suggestions.length > 0 && (
          <>
            <dt>Suggestions</dt>
            <dd>
              <ol className="brc-sugs">
                {r.suggestions.map((s, i) => <li key={i}><span className="brc-sn" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}
              </ol>
            </dd>
          </>
        )}
      </dl>
      <div className={`brc-tests${r.testsRun ? ' is-run' : ''}`}>
        <Icon name={r.testsRun ? 'CheckCircle' : 'Eye'} size={16} />
        <span>
          {r.testsRun ? `Tests run${r.testsSummary ? `: ${r.testsSummary}` : ''}.` : 'Read the code only; ran nothing of theirs.'}
          {' '}Run crew code was <b>{r.runCrewCode ? 'On' : 'Off'}</b> at review time.
        </span>
      </div>
    </section>
  );
}

/**
 * The early look itself (frames 5 and 6). `host` false is the wall: no
 * buttons, no PR link, and nobody in the room is named.
 */
export function EarlyLook({ share, crew, host, busy, run, api, onDirty, stage = false }) {
  const versions = share.versions || [];
  const [pick, setPick] = useState(null);
  const vi = pick === null || pick >= versions.length ? versions.length - 1 : pick;
  const v = versions[vi] || {};
  const [composing, setComposing] = useState(false);
  const draft = useMemo(() => feedbackDraft(share), [share]);
  const [feedback, setFeedback] = useState('');
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState('');
  const d = v.diffstat || { files: [], fileCount: 0, added: 0, removed: 0 };
  const reviews = (share.reviews || []).slice().reverse();
  const shown = (share.comments || []).filter((c) => c.text);
  const nameOf = (c) => {
    if (c.by === 'room') return host ? c.name : '';
    if (c.by === 'agent') return c.name || "Host's Claude";
    return c.name || (c.by === 'host' ? 'Host' : '');
  };

  const openComposer = () => { setFeedback(draft); setComposing(true); setSent(''); if (onDirty) onDirty(false); };
  const sendFeedback = async () => {
    const ok = await run(() => api.crewFeedback(share.shareId, feedback.trim()));
    if (ok !== undefined) { setComposing(false); setSent(`Sent to ${share.builder}'s Claude.`); if (onDirty) onDirty(false); }
  };
  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const ok = await run(() => api.crewComment(share.shareId, reply.trim()));
    if (ok !== undefined) { setReply(''); if (onDirty) onDirty(false); }
  };
  const act = (action) => run(() => api.crewShareAction(share.shareId, action));

  return (
    <article className={`brc brc-look${stage ? ' brc-look--stage' : ''}`} aria-label={`Early look: ${share.title}`}>
      <div className="brc-look-top">
        <span className="brc-eyebrow"><b>Early look</b> · {share.builder} · v{v.v || vi + 1}{v.createdAt ? ` · ${clock(v.createdAt)}` : ''}</span>
        <Chip tone={LANE_TONE[share.lane]}>{LANE_LABEL[share.lane]}</Chip>
        {host && share.featured && <Chip tone="amber">On the wall</Chip>}
      </div>
      <h2 className="brc-look-title">{share.title}</h2>

      {versions.length > 1 && (
        <div className="brc-vtabs" role="tablist" aria-label="Versions">
          {versions.map((x, i) => (
            <button key={x.v} type="button" role="tab" aria-selected={i === vi} className={`brc-vtab${i === vi ? ' is-on' : ''}`} onClick={() => setPick(i)}>v{x.v}</button>
          ))}
        </div>
      )}

      <div className="brc-look-grid">
        <div className="brc-look-shots">
          {(v.imageIds || []).length
            ? v.imageIds.map((id, i) => <BuildImage key={id} imageId={id} alt={`${share.title}, screenshot ${i + 1}`} className="brc-lookshot" linked={host} />)
            : <div className="brm-empty">No screenshots with this version.</div>}
          <div className="brc-nums" role="group" aria-label="The change in numbers">
            <span><b>{d.fileCount}</b> {d.fileCount === 1 ? 'file' : 'files'}</span>
            <span className="brc-add">+{d.added}</span>
            <span className="brc-del">−{d.removed}</span>
            {v.commit && <span className="brm-mono brm-muted">{short(v.commit)}</span>}
          </div>
          {d.files.length > 0 && (
            <details className="brc-files">
              <summary>Files</summary>
              <ul>{d.files.map((f) => <li key={f} className="brm-mono">{f}</li>)}</ul>
            </details>
          )}
        </div>
        <div className="brc-look-words">
          <h3 className="brc-k">What I changed</h3>
          <p className="brc-p">{v.summary}</p>
          {v.unsure && (
            <div className="brc-unsure">
              <h3 className="brc-k">What I&apos;m unsure about</h3>
              <p className="brc-p">{v.unsure}</p>
            </div>
          )}
          {v.feedbackWanted && (
            <>
              <h3 className="brc-k">I&apos;d like feedback on</h3>
              <p className="brc-p">{v.feedbackWanted}</p>
            </>
          )}
          {host && (
            <dl className="brc-facts brc-where">
              {crew && crew.repoUrl && <><dt>Repository</dt><dd className="brm-mono"><Link href={crew.repoUrl}>{crew.repoUrl}</Link></dd></>}
              {v.branch && <><dt>Branch</dt><dd className="brm-mono">{v.branch}</dd></>}
              {share.prUrl && <><dt>Pull request</dt><dd><Link href={share.prUrl}>{share.prUrl}</Link></dd></>}
              {share.mergedCommit && <><dt>Merged</dt><dd className="brm-mono">{short(share.mergedCommit)}</dd></>}
            </dl>
          )}
        </div>
      </div>

      <div className="brc-reacts" role="group" aria-label="Reactions">
        {Object.entries(REACTION).map(([k, r]) => (
          <span key={k} className={`brc-react brc-tone-${r.tone}`}><Icon name={r.icon} size={16} /> {r.label} <b>{(share.reactions || {})[k] || 0}</b></span>
        ))}
      </div>

      {shown.length > 0 && (
        <ul className="brc-comments" aria-label="Comments">
          {shown.map((c, i) => (
            <li key={`${c.createdAt}:${i}`} className={`brc-c brc-c--${c.kind}`}>
              <span className="brc-ck">{COMMENT_LABEL[c.kind] || c.kind}</span>
              {nameOf(c) && <span className="brc-cn">{nameOf(c)}</span>}
              {c.version && c.version !== v.v && <span className="brm-hint">on v{c.version}</span>}
              <span className="brc-ct">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {!host && shown.length > 0 && <p className="brm-hint">Anonymous on the wall.</p>}

      {reviews.map((r, i) => <ReviewCard key={`${r.createdAt}:${i}`} r={r} />)}

      {host && (
        <>
          {composing ? (
            <div className="brc-compose">
              <label className="brm-field">
                <span className="brm-lbl">Feedback for {share.builder}&apos;s Claude (from the room&apos;s questions and concerns; edit freely)</span>
                <textarea
                  className="brm-input brm-ta"
                  aria-label="Feedback"
                  value={feedback}
                  maxLength={2000}
                  onChange={(e) => { setFeedback(e.target.value); if (onDirty) onDirty(e.target.value !== draft); }}
                />
              </label>
              <div className="brm-row brm-gap">
                <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { setComposing(false); if (onDirty) onDirty(false); }}>Cancel</button>
                <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !feedback.trim()} onClick={sendFeedback}>
                  <Icon name="PaperPlaneTilt" size={16} /> Send to {share.builder}&apos;s Claude
                </button>
              </div>
            </div>
          ) : (
            <div className="brm-row brm-gap brc-look-acts">
              {share.featured
                ? <button type="button" className="brm-btn" disabled={busy} onClick={() => act('unfeature')}><Icon name="EyeSlash" size={16} /> Take off the wall</button>
                : <button type="button" className="brm-btn brm-btn--primary" disabled={busy} onClick={() => act('feature')}><Icon name="Monitor" size={16} /> Put on the wall</button>}
              <button type="button" className="brm-btn" disabled={busy} onClick={() => run(() => api.crewReviewRequest(share.shareId))}><Icon name="MagnifyingGlass" size={16} /> Ask Claude to review</button>
              <button type="button" className="brm-btn" disabled={busy} onClick={openComposer}><Icon name="NotePencil" size={16} /> Write feedback</button>
              {share.lane === 'not-now'
                ? <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy} onClick={() => act('reopen')}>Back in the lane</button>
                : share.lane !== 'merged' && <button type="button" className="brm-btn brm-btn--ghost brm-push" disabled={busy} onClick={() => act('not-now')}>Not now</button>}
            </div>
          )}
          {sent && <p className="brm-hint" role="status">{sent}</p>}
          {crew && <p className="brm-hint">Run crew code is {crew.runCrewCode ? 'On: a review may run their tests.' : 'Off: a review reads the code only.'}</p>}
          <form className="brc-reply" onSubmit={sendReply}>
            <input className="brm-input" aria-label="Reply on this early look" placeholder="Reply on this early look… type 2 to point at a suggestion" value={reply} maxLength={500} onChange={(e) => { setReply(e.target.value); if (onDirty) onDirty(Boolean(e.target.value.trim())); }} />
            <button type="submit" className="brm-btn brm-btn--sm" disabled={busy || !reply.trim()}>Post</button>
          </form>
        </>
      )}
    </article>
  );
}

export function EarlyLookDialog({ share, crew, busy, run, api, onClose }) {
  const [dirty, setDirty] = useState(false);
  const requestClose = () => {
    if (dirty && !window.confirm('Discard what you wrote?')) return;
    onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--wide brc brc-lookmodal" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brc-look-title">
      <div className="brm-dh">
        <span className="brm-sr" id="brc-look-title">Early look: {share.title}</span>
        <button type="button" className="brm-x" aria-label="Close" onClick={requestClose}><Icon name="X" size={16} /></button>
      </div>
      <EarlyLook share={share} crew={crew} host busy={busy} run={run} api={api} onDirty={setDirty} />
      <div className="brm-row brm-gap"><button type="button" className="brm-btn brm-push" onClick={requestClose}>Close</button></div>
    </Modal>
  );
}

// ── Tasks ───────────────────────────────────────────────────────────────────

function TaskDialog({ task, busy, run, api, onClose }) {
  const [text, setText] = useState(task ? task.text : '');
  const [detail, setDetail] = useState(task ? task.detail : '');
  const dirty = text !== (task ? task.text : '') || detail !== (task ? task.detail : '');
  const requestClose = () => {
    if (dirty && !window.confirm('Discard this task?')) return;
    onClose();
  };
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await run(() => (task
      ? api.crewTaskAction(task.taskId, { action: 'edit', text: text.trim(), detail: detail.trim() })
      : api.crewAddTask({ text: text.trim(), detail: detail.trim() })));
    if (ok !== undefined) onClose();
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brc" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !dirty} labelledBy="brc-task-title">
      <form onSubmit={save}>
        <DialogHead id="brc-task-title" title={task ? 'Edit the task' : 'Add a task'} onClose={requestClose} />
        <label className="brm-field"><span className="brm-lbl">Task (what to build)</span><input className="brm-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Parking map" /></label>
        <label className="brm-field"><span className="brm-lbl">Detail (optional; the builder&apos;s Claude reads it when they take the task)</span><textarea className="brm-input brm-ta brm-ta--sm" value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} /></label>
        <div className="brm-row brm-gap">
          <button type="button" className="brm-btn brm-btn--ghost" onClick={requestClose}>Cancel</button>
          <button type="submit" className="brm-btn brm-btn--primary brm-push" disabled={busy || !text.trim()}>{task ? 'Save task' : 'Add task'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function CrewTasks({ crew, host, busy, run, api }) {
  const tasks = crew.tasks || [];
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const [deleting, setDeleting] = useState(null);
  return (
    <section className="brm-panel brc brc-tasks" aria-labelledby="brc-tasks-h">
      <div className="brm-row">
        <h2 className="brm-h" id="brc-tasks-h">Tasks</h2>
        {host && <button type="button" className="brm-btn brm-btn--sm brm-push" onClick={() => setEditing('new')}><Icon name="Plus" size={14} /> Add a task</button>}
      </div>
      <p className="brm-sub">Builders take a task from their phone or from Claude. Taking one sends it to their Claude. Two builders on one task is a race, and that is fine: the room compares.</p>
      {!tasks.length ? (
        <div className="brm-empty">No tasks yet. Add one, or ask Claude to propose tasks from the decisions so far.</div>
      ) : (
        <table className="brm-tbl brc-tbl">
          <thead>
            <tr>
              <th className="brc-col-n">#</th>
              <th>Task</th>
              <th className="brc-col-who">Builders</th>
              {host && <th className="brc-col-acts"><span className="brm-sr">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => {
              const who = t.claimedBy || [];
              return (
                <tr key={t.taskId} className={t.state === 'done' ? 'is-done' : undefined}>
                  <td className="brm-num">{i + 1}</td>
                  <td>
                    <span className="brm-nm" title={t.text}>{t.text}</span>
                    {t.detail && <span className="brm-subline" title={t.detail}>{t.detail}</span>}
                  </td>
                  <td>
                    <div className="brc-claims">
                      {t.state === 'done' ? <Chip tone="green">Done</Chip>
                        : who.length ? who.map((n) => <Chip key={n}>{n}</Chip>) : <Chip>Open</Chip>}
                      {t.state !== 'done' && who.length > 1 && <Chip tone="amber">Race</Chip>}
                    </div>
                  </td>
                  {host && (
                    <td>
                      {deleting === t.taskId ? (
                        <div className="brm-rowact">
                          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setDeleting(null)}>Keep</button>
                          <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy} onClick={async () => { await run(() => api.crewTaskAction(t.taskId, { action: 'delete' })); setDeleting(null); }}>Delete</button>
                        </div>
                      ) : (
                        <div className="brm-rowact">
                          <button type="button" className="brm-btn brm-btn--sm brm-btn--link" aria-label={`Edit ${t.text}`} onClick={() => setEditing(t)}>Edit</button>
                          {t.state === 'done'
                            ? <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} aria-label={`Reopen ${t.text}`} onClick={() => run(() => api.crewTaskAction(t.taskId, { action: 'reopen' }))}>Reopen</button>
                            : <button type="button" className="brm-btn brm-btn--sm brm-btn--link" disabled={busy} aria-label={`Mark ${t.text} done`} onClick={() => run(() => api.crewTaskAction(t.taskId, { action: 'done' }))}>Done</button>}
                          <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger" aria-label={`Delete ${t.text}`} onClick={() => setDeleting(t.taskId)}>Delete</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {host && editing && (
        <TaskDialog key={editing === 'new' ? 'new' : editing.taskId} task={editing === 'new' ? null : editing} busy={busy} run={run} api={api} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
