import React, { useState } from 'react';
import BuildImage from './BuildImage';
import Icon from '../components/Icon';
import { mintBuilderKey, claimTask, react } from './buildPlayApi';

/**
 * CREW MODE ON THE PHONE (docs/design/build-room-crew/FLOWS.md, storyboard
 * frames 2, 3 and 5B of docs/design/build-room-crew/index.html).
 *
 * Everything here reads `view.crew`, which is `crewView(room, 'public', me)`
 * in lambda-functions/game/build-crew.js: the lanes, the tasks, and only the
 * early looks the host put on the wall, plus this phone's own when it is a
 * builder (`crew.me`).
 *
 *   CrewPipeline   "2 building · 1 early look · 1 merged"
 *   BaseNotice     the base branch moved (drawn in the watch feed)
 *   CrewSection    Your lane (builders), the early looks, and the way in
 *                  ("Want to build too?" → "I have Claude Code"), which is
 *                  optional: the room's default is no setup at all
 *
 * THE BUILDER KEY IS SHOWN ONCE. The server keeps only its hash. The key lives
 * in BuildPlayer's state (so a refetch or a new ask does not lose it while it
 * is being typed) and is dropped on "Done" or when the page goes; nothing
 * writes it to storage.
 *
 * Owner rules: "early look", never "peek"; the room is anonymous on a phone
 * ("You" for your own); the host alone puts an early look on the wall.
 * Everything a builder, a Claude or a phone wrote renders as React text.
 */

export const MAX_BUILDERS = 8;

export const BUILDER_STATUS = Object.freeze({
  'setting-up': 'Setting up',
  building: 'Building',
  synced: 'Up to date with the base',
  'needs-rebase': 'Needs a rebase',
  'needs-help': 'Needs help',
  idle: 'Idle',
  merged: 'Merged',
});

export const LANE_WORD = Object.freeze({
  shared: 'Early look',
  reviewed: 'Reviewed',
  pr: 'Pull request open',
  merged: 'Merged',
  'not-now': 'Not now',
});

export const RECOMMENDATION_WORD = Object.freeze({
  merge: 'Ready to merge',
  'merge-after-changes': 'Merge after changes',
  'not-yet': 'Not yet',
});

const REACTION = Object.freeze({
  'looks-right': { word: 'Looks right', icon: 'Check', tone: 'good' },
  question: { word: 'Question', icon: 'Question', tone: 'blue' },
  concern: { word: 'Concern', icon: 'Warning', tone: 'amber' },
});
const COMMENT_WORD = { question: 'Question', concern: 'Concern', reply: 'Reply', feedback: 'Feedback' };
const TEXT_MAX = 500;

const short = (commit) => String(commit || '').slice(0, 7);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function Err({ error }) {
  if (!error) return null;
  return (
    <p className="plr-err" role="alert">
      <Icon name="Warning" size={16} />
      <span>{error}</span>
    </p>
  );
}

/* ------------------------------------------------------------ pipeline -- */

/** "2 building · 1 early look · 1 merged" — only the stages something is in. */
export function pipelineLine(p) {
  const x = p || {};
  const parts = [];
  if (x.building) parts.push(`${x.building} building`);
  if (x.shared) parts.push(plural(x.shared, 'early look', 'early looks'));
  if (x.reviewed) parts.push(`${x.reviewed} reviewed`);
  if (x.pr) parts.push(plural(x.pr, 'pull request', 'pull requests'));
  if (x.merged) parts.push(`${x.merged} merged`);
  return parts.length ? parts.join(' · ') : 'Nobody is building yet';
}

export function CrewPipeline({ crew }) {
  return <p className="bpl-pipe">{pipelineLine(crew.pipeline)}</p>;
}

/* --------------------------------------------------------- base moved -- */

/** The newest `base` entry on the timeline, which names what was merged. */
export function lastBaseEntry(log) {
  const list = (log || []).filter((e) => e && e.kind === 'base');
  return list.length ? list[list.length - 1] : null;
}

export function BaseNotice({ crew, log }) {
  if (!crew || !crew.enabled || !crew.baseMovedAt || !crew.baseCommit) return null;
  const entry = lastBaseEntry(log);
  const said = entry && entry.text.includes(': ') ? entry.text.slice(entry.text.indexOf(': ') + 2) : '';
  const what = crew.baseNote || said;
  return (
    <div className="bpl-base" role="status">
      <h3 className="bpl-kind bpl-kind--amber">The base moved</h3>
      <p className="bpl-text bpl-base-tx">
        {crew.baseBranch || 'The base branch'} is now at <code className="bpl-mono">{short(crew.baseCommit)}</code>
        {what ? `: ${what}` : ''}
      </p>
      {crew.me ? <p className="plr-help">Your Claude has been told to pull it in.</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------- the key -- */

function KeyCard({ keyText, onDone }) {
  const line = `/engage:connect ${keyText}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="bpl-key" aria-label="Your builder key">
      <p className="bpl-eyebrow"><b>Your builder key</b> · shown once</p>
      <h3 className="bpl-h">Type this into Claude Code on your laptop</h3>
      <code className="bpl-keyline">{line}</code>
      <button type="button" className="bpl-copy" onClick={copy}>
        <Icon name={copied ? 'Check' : 'Copy'} size={16} />
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <p className="plr-help">No plugin? Ask the host for the install command on the Connect panel.</p>
      <p className="plr-help">
        This key is yours, not the host&apos;s. Your Claude can read the room, push your branch, share work and get feedback. It cannot merge.
        You will not see it again; a new key replaces it.
      </p>
      <button type="button" className="bpl-send" onClick={onDone}>Done</button>
    </section>
  );
}

function useMint(api, setBuilderKey, onResult) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mint = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await mintBuilderKey(api);
    setBusy(false);
    if (r.ok && r.data && r.data.key) setBuilderKey(r.data.key);
    else setError(r.error || 'Could not make a key. Try again.');
    onResult(r);
  };
  return { busy, error, mint };
}

/**
 * The way in for a builder, and plainly optional: most of the room has no
 * setup at all and just follows along. A builder needs Claude Code on their
 * laptop and access to the project's repo (owner, 2026-10-02: one shared repo,
 * a branch each, pull requests there).
 */
function JoinCard({ crew, api, setBuilderKey, onResult }) {
  const { busy, error, mint } = useMint(api, setBuilderKey, onResult);
  const full = (crew.builders || []).length >= MAX_BUILDERS;
  return (
    <section className="bpl-join" aria-label="Want to build too?">
      <h3 className="bpl-h bpl-join-h">
        <Icon name="TerminalWindow" size={20} />
        <span>Want to build too?</span>
      </h3>
      {full ? (
        <p className="plr-help">The crew is full ({MAX_BUILDERS} builders). You can still react to their work here.</p>
      ) : (
        <>
          <p className="bpl-join-tx">You need Claude Code on your laptop and access to the project&apos;s repo. You build one task on your own branch and show it to the room as you go.</p>
          <p className="bpl-join-tx">Everyone else: just follow along here.</p>
          <button type="button" className="bpl-send" disabled={busy} onClick={mint}>
            {busy ? 'Making your key…' : 'I have Claude Code'}
          </button>
          <Err error={error} />
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- your lane -- */

function TaskRow({ task, index, me, api, onResult }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const by = task.claimedBy || [];
  const mine = by.includes(me);
  const others = by.filter((n) => n !== me);
  const take = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await claimTask(api, task.taskId);
    setBusy(false);
    if (!r.ok) setError(r.error);
    onResult(r);
  };
  let who = null;
  if (mine && others.length) who = <span className="bpl-race">Race: {others.join(' and ')} {others.length === 1 ? 'has' : 'have'} it too</span>;
  else if (mine) who = <span className="bpl-task-who">Yours</span>;
  else if (others.length) who = <span className="bpl-task-who">{others.join(' and ')} {others.length === 1 ? 'is' : 'are'} on it</span>;
  return (
    <li className={`bpl-task${mine ? ' bpl-task--mine' : ''}`}>
      <span className="bpl-vn" aria-hidden="true">{index + 1}</span>
      <span className="bpl-task-body">
        <span className="bpl-task-t bpl-text">{task.text}</span>
        {task.detail ? <span className="bpl-task-d bpl-text">{task.detail}</span> : null}
        {who}
        <Err error={error} />
      </span>
      {!mine && (
        <button type="button" className="bpl-take" disabled={busy} onClick={take}>
          {busy ? 'Taking…' : 'Take this task'}
          <span className="bpl-sr">: {task.text}</span>
        </button>
      )}
    </li>
  );
}

function YourLane({ crew, api, setBuilderKey, onResult }) {
  const me = crew.me.name;
  const b = (crew.builders || []).find((x) => x.name === me) || { status: 'setting-up' };
  const task = (crew.tasks || []).find((t) => t.taskId === b.taskId) || null;
  const open = (crew.tasks || []).filter((t) => t.state === 'open');
  const flagged = b.status === 'needs-rebase' || b.status === 'needs-help';
  const mineShares = (crew.shares || []).filter((s) => s.builder === me);
  const open_ = mineShares.filter((s) => !['merged', 'not-now'].includes(s.lane));
  // Nothing open and something merged: the lane says Merged, not "Building".
  const merged = !flagged && b.status && b.status !== 'setting-up' && !open_.length && mineShares.some((s) => s.lane === 'merged' && s.taskId === b.taskId);
  const status = merged ? 'merged' : b.status || 'setting-up';
  const feedback = open_
    .flatMap((s) => (s.comments || []).filter((c) => c.kind === 'feedback').map((c) => ({ ...c, title: s.title })))
    .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))
    .pop();
  const shownBelow = mineShares.some((sh) => {
    const vs = sh.versions || [];
    return ((vs[vs.length - 1] || {}).imageIds || []).includes(b.latestImageId);
  });
  const { busy, error, mint } = useMint(api, setBuilderKey, onResult);
  return (
    <section className="bpl-lane" aria-label="Your lane">
      <p className="bpl-eyebrow"><b>Your lane</b> · {task ? task.text : 'no task yet'}</p>
      <p className={`bpl-lstatus bpl-lstatus--${status}`}>{BUILDER_STATUS[status] || status}</p>
      {flagged && b.note ? <p className="bpl-text bpl-lnote">{b.note}</p> : null}
      {b.branch ? <p className="plr-help">Your branch: <code className="bpl-mono">{b.branch}</code></p> : null}
      {status === 'setting-up' ? <p className="plr-help">Waiting for your laptop. Type the key into Claude Code there.</p> : null}
      {feedback ? (
        <div className="bpl-fb">
          <p className="bpl-fb-h">Feedback on {feedback.title} · from the host</p>
          <p className="bpl-text bpl-fb-tx">{feedback.text}</p>
          <p className="plr-help">Sent to your Claude too.</p>
        </div>
      ) : null}
      {/* Said once: not when the same screenshot is on an early look below. */}
      {shownBelow ? null : <BuildImage imageId={b.latestImageId} alt="Your latest screenshot" className="bpl-shot" />}
      <h4 className="plr-lab bpl-tasks-h">Open tasks</h4>
      {open.length ? (
        <ol className="bpl-tasks">
          {open.map((t, i) => <TaskRow key={t.taskId} task={t} index={i} me={me} api={api} onResult={onResult} />)}
        </ol>
      ) : (
        <p className="plr-help">No open tasks. The host adds them.</p>
      )}
      <p className="plr-help">Two of you on one task is fine. The room compares. Your Claude gets the task as a direction.</p>
      <button type="button" className="bpl-textbtn" disabled={busy} onClick={mint}>
        {busy ? 'Making a new key…' : 'Lost the key? Make a new one'}
      </button>
      <Err error={error} />
    </section>
  );
}

/* --------------------------------------------------------- early looks -- */

function Reactions({ share, api, onResult }) {
  const [open, setOpen] = useState(null); // 'question' | 'concern' | null
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mineAll = (share.comments || []).filter((c) => c.name === 'You' && REACTION[c.kind]);
  const said = mineAll.length ? mineAll[mineAll.length - 1] : null;

  const send = async (kind, words) => {
    if (busy) return;
    if (kind !== 'looks-right' && !String(words || '').trim()) {
      setError(`Say what the ${kind} is.`);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await react(api, share.shareId, kind, kind === 'looks-right' ? '' : words);
    setBusy(false);
    if (r.ok) { setOpen(null); setText(''); } else setError(r.error);
    onResult(r);
  };
  const pick = (kind) => {
    setError(null);
    if (kind === 'looks-right') { setOpen(null); send(kind); return; }
    setOpen(open === kind ? null : kind);
  };

  return (
    <div className="bpl-rx">
      <div className="bpl-rx-row" role="group" aria-label="React to this early look">
        {Object.entries(REACTION).map(([kind, r]) => (
          <button
            key={kind}
            type="button"
            className={`bpl-rxbtn bpl-rxbtn--${r.tone}`}
            aria-pressed={open === kind || (!open && said && said.kind === kind) ? 'true' : 'false'}
            disabled={busy}
            onClick={() => pick(kind)}
          >
            <Icon name={r.icon} size={18} />
            <span>{r.word}</span>
          </button>
        ))}
      </div>
      {open ? (
        <div className="bpl-why">
          <label className="bpl-label" htmlFor={`bpl-rx-${share.shareId}`}>Your {open}</label>
          <textarea
            id={`bpl-rx-${share.shareId}`}
            className="plr-inp bpl-area bpl-area--short"
            maxLength={TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="bpl-send" disabled={busy || !text.trim()} onClick={() => send(open, text)}>
            {busy ? 'Sending…' : `Send ${open}`}
          </button>
          <p className="plr-help">Anonymous on the wall.</p>
        </div>
      ) : null}
      {said ? (
        <p className="bpl-said">
          You said: <b>{REACTION[said.kind].word}</b>
          {said.text ? <span className="bpl-text">{`: ${said.text}`}</span> : null}
          <span className="bpl-said-hint"> · one reaction each, your latest counts</span>
        </p>
      ) : null}
      <Err error={error} />
    </div>
  );
}

function ReactionCounts({ reactions }) {
  const r = reactions || {};
  return (
    <p className="bpl-rxn">
      {Object.entries(REACTION).map(([kind, x], i) => (
        <span key={kind}>
          {i ? ' · ' : ''}
          {x.word} <b>{r[kind] || 0}</b>
        </span>
      ))}
    </p>
  );
}

function commentWho(c) {
  if (c.kind === 'feedback') return 'Host';
  return c.name || '';
}

function EarlyLook({ share, me, api, onResult }) {
  const versions = share.versions || [];
  const v = versions[versions.length - 1] || { v: 1, imageIds: [] };
  const own = Boolean(me) && share.builder === me;
  const review = (share.reviews || []).length ? share.reviews[share.reviews.length - 1] : null;
  // Your own reaction is "You said" above the list; said once, not twice.
  const comments = (share.comments || []).filter((c) => c.text && COMMENT_WORD[c.kind] && !(own === false && c.name === 'You' && REACTION[c.kind]));
  const lane = share.lane || 'shared';
  return (
    <article className={`bpl-el${own && !share.featured ? ' bpl-el--private' : ''}`} aria-label={`Early look: ${share.title}`}>
      <p className="bpl-eyebrow">
        <b>Early look</b> · {own ? 'Yours' : share.builder} · v{v.v || versions.length}
        {versions.length > 1 ? ` of ${versions.length}` : ''}
        {lane !== 'shared' ? <span className={`bpl-chip bpl-chip--${lane}`}>{LANE_WORD[lane] || lane}</span> : null}
      </p>
      <h3 className="bpl-h bpl-text">{share.title}</h3>
      {own && !share.featured ? (
        <p className="bpl-private">Only you and the host see this until it is on the wall.</p>
      ) : null}
      {(v.imageIds || []).map((id) => <BuildImage key={id} imageId={id} alt={`${share.title}, v${v.v}`} className="bpl-shot" />)}
      {v.summary ? <p className="bpl-text bpl-el-sum">{v.summary}</p> : null}
      {v.unsure ? (
        <div className="bpl-unsure">
          <p className="bpl-el-k">Unsure about</p>
          <p className="bpl-text">{v.unsure}</p>
        </div>
      ) : null}
      {v.feedbackWanted ? (
        <div className="bpl-el-ask">
          <p className="bpl-el-k">Would like feedback on</p>
          <p className="bpl-text">{v.feedbackWanted}</p>
        </div>
      ) : null}
      {lane === 'merged' && share.mergedCommit ? (
        <p className="bpl-merged"><Icon name="CheckCircle" weight="fill" size={16} /> Merged at <code className="bpl-mono">{short(share.mergedCommit)}</code></p>
      ) : null}
      {review ? (
        <div className="bpl-review">
          <p className="bpl-el-k">Claude&apos;s review (v{review.version})</p>
          <p className="bpl-review-rec">{RECOMMENDATION_WORD[review.recommendation] || review.recommendation}</p>
          {review.does ? <p className="bpl-text">{review.does}</p> : null}
        </div>
      ) : null}
      <ReactionCounts reactions={share.reactions} />
      {!own ? <Reactions share={share} api={api} onResult={onResult} /> : null}
      {comments.length > 0 && (
        <ul className="bpl-cmts" aria-label="What the room said">
          {comments.map((c, i) => {
            const who = commentWho(c);
            return (
              <li key={`${c.createdAt}-${i}`}>
                <span className={`bpl-cmt-k bpl-cmt-k--${c.kind}`}>{COMMENT_WORD[c.kind]}{who ? ` · ${who}` : ''}</span>
                <span className="bpl-text">{c.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

/* --------------------------------------------------------- the section -- */

export default function CrewSection({ crew, api, onResult, builderKey, setBuilderKey }) {
  if (!crew || !crew.enabled) return null;
  const me = crew.me ? crew.me.name : null;
  const shares = crew.shares || [];
  return (
    <section className="bpl-crew" aria-label="The crew">
      <h3 className="plr-lab bpl-crew-h">The crew</h3>
      <CrewPipeline crew={crew} />
      {builderKey ? <KeyCard keyText={builderKey} onDone={() => setBuilderKey(null)} /> : null}
      {me ? <YourLane crew={crew} api={api} setBuilderKey={setBuilderKey} onResult={onResult} /> : null}
      {shares.length > 0 && (
        <div className="bpl-els">
          {shares.map((s) => <EarlyLook key={s.shareId} share={s} me={me} api={api} onResult={onResult} />)}
        </div>
      )}
      {!me && !builderKey ? <JoinCard crew={crew} api={api} setBuilderKey={setBuilderKey} onResult={onResult} /> : null}
    </section>
  );
}
