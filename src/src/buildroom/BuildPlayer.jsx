import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BuildImage, { ImageLoader, ImageViewer } from './BuildImage';
import { PlayerShell } from '../components/PlayerShell';
import Icon from '../components/Icon';
import RatingInput from '../components/survey/RatingInput';
import { fetchBuildState, sendResponse, sendVote, sendIdea, sendPreviewFeedback, sendSpin } from './buildPlayApi';
import BuildWheel from './BuildWheel';
import { W } from './words';
import { RATING_SCALE, roomStory, filterStory, STORY_FILTERS, doingLine } from './buildScreens';
import CrewSection, { BaseNotice, lastBaseEntry } from './BuildPlayerCrew';
import { TalkItOver, RunBlock } from './BuildPlayerPoints';
import './BuildPlayer.css';

/**
 * A BUILD ROOM, ON THE PHONE OF SOMEBODY WHO HAS JOINED ONE.
 *
 * The player half of docs/design/build-room/PLAN.md (§6.2 the calls, §6.3 the
 * PublicState shape, §8 the experience), drawn from frame 4 "Phones" of
 * docs/design/build-room/index.html: one task per screen, one button in the
 * dock, an optional short "why", and "Send an idea to the host" always there.
 *
 * WHAT DECIDES THE SCREEN is `current` in PublicState
 * (lambda-functions/game/build-store.js `publicView`):
 *
 *   live      the ask itself   — suggest (text), choice (lettered cards), rating (1–5)
 *   voting    the approval ballot for an Ideas ask, own suggestions not votable
 *   results / decided   what the room picked, and the host's direction once sent
 *   none      "Watch the build": goal, Claude's connection, latest decision, timeline
 *   ENDED     "What we built", Claude's wrap-up
 *
 * REFRESH. PlayerPage bumps `rev` on every `buildChanged` WebSocket frame and
 * this refetches (notify → refresh, as everywhere). A 10s poll covers a socket
 * that is quietly dead. Drafts live in the screen components, keyed by ask and
 * status, so a refetch never wipes what somebody is typing.
 *
 * EVERYTHING CLAUDE OR A PHONE WROTE IS UNTRUSTED TEXT (PLAN §9). It is
 * rendered as React text — never as markup — and a link renders only when it
 * is http(s).
 *
 * CREW MODE (view.crew.enabled; docs/design/build-room-crew/FLOWS.md) adds
 * BuildPlayerCrew.jsx's section under every screen: the pipeline line, "Your
 * lane" for a builder, the early looks on the wall, and "I have Claude Code"
 * for everyone else. It sits BELOW the ask and the idea composer, so it is
 * never in the way of answering. The base-moved notice rides in the feed.
 *
 * It draws in PlayerShell, so it sits in the `.plr` scope and reuses the
 * player's own controls (`.plr-opt`, `.plr-inp`, `.plr-btn`, RatingInput's
 * `.plr-scale`); what is particular to a Build Room is under `.bpl`
 * (BuildPlayer.css).
 */

export const POLL_MS = 10000;
const MAX_SUGGESTIONS = 3;
const TEXT_MAX = 280;

const KIND_WORD = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate' };

/** The timeline kinds a phone shows, and what each is called. `note` and `ask` are not here, so never drawn. */
export const FEED_KINDS = Object.freeze({
  progress: 'Progress',
  showing: 'Showing',
  milestone: 'Milestone',
  decision: 'Decided',
  direction: 'To Claude',
  verbal: 'Room said',
  idea: 'Idea',
  outcome: 'Wrapped up',
  crew: 'Crew',
  base: 'Base moved',
  help: 'Help',
});
/** Only Claude's own posts carry a detail worth a phone's room. */
const DETAIL_KINDS = ['progress', 'showing', 'milestone'];
const FEED_LENGTH = 8;

const IDEA_STATUS = { new: 'With the host', promoted: 'Picked up', acknowledged: 'Seen by the host', later: 'Saved for later', dismissed: 'Not used this time' };
/**
 * What a phone says about its own idea; one shown on the wall says so (owner,
 * 2026-10-05), and one the host put to a vote says so (step 4).
 */
const ideaStatusText = (idea, current = null) => {
  if (idea.walled) return 'Shown on the wall';
  if (idea.status === 'promoted' && idea.promotedTo) {
    const open = current && current.askId === idea.promotedTo && ['live', 'voting'].includes(current.status);
    return open ? 'In a vote now' : 'Put to a vote';
  }
  // How it was used (step 7, C11): to Claude, or into the room's open ideas.
  if (idea.status === 'promoted' && idea.promotedVia === 'claude') return 'Sent to Claude';
  if (idea.status === 'promoted' && idea.promotedVia === 'ideas') return "In the room's ideas";
  return IDEA_STATUS[idea.status] || IDEA_STATUS.new;
};

export function isHttpUrl(value) {
  if (!value) return false;
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const askNo = (askId) => {
  const n = parseInt(askId, 10);
  return Number.isFinite(n) ? n : askId;
};

const sameSet = (a, b) => {
  const x = [...(a || [])].map(String).sort();
  const y = [...(b || [])].map(String).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const clock = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function Eyebrow({ word, askId, extra }) {
  return (
    <p className="bpl-eyebrow">
      <b>{word}</b>
      {askId ? ` · Ask ${askNo(askId)}` : ''}
      {extra ? ` · ${extra}` : ''}
    </p>
  );
}

/**
 * THE OPENING ON A PHONE (owner, 2026-10-06; mockup O4): a question that
 * frames the build says how far the room has got, so people know the
 * questions lead somewhere.
 */
function OpeningProgress({ ask }) {
  if (!ask.openingIndex || !ask.openingOf) return null;
  return (
    <div className="bpl-opening" aria-label={`Shaping the build, step ${ask.openingIndex} of ${ask.openingOf}`}>
      <p className="plr-help bpl-opening-t">Shaping the build · step {ask.openingIndex} of {ask.openingOf}</p>
      <div className="bpl-opening-bar" aria-hidden="true">
        {Array.from({ length: ask.openingOf }, (_, i) => <i key={i} className={i < ask.openingIndex ? 'on' : ''} />)}
      </div>
    </div>
  );
}

function AskHead({ ask, word, extra }) {
  return (
    <>
      <OpeningProgress ask={ask} />
      <Eyebrow word={word} askId={ask.askId} extra={extra} />
      <h2 className="plr-q bpl-text">{ask.prompt}</h2>
      {ask.detail ? <p className="plr-help bpl-text bpl-askdetail">{ask.detail}</p> : null}
    </>
  );
}

function ErrorLine({ error }) {
  if (!error) return null;
  return (
    <p className="plr-err" role="alert">
      <Icon name="Warning" size={16} />
      <span>{error}</span>
    </p>
  );
}

function WhyField({ id, value, onChange }) {
  return (
    <div className="bpl-why">
      <label className="bpl-label" htmlFor={id}>
        Why? <span className="bpl-opt-word">(optional)</span>
      </label>
      <input
        id={id}
        type="text"
        className="plr-inp"
        maxLength={TEXT_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ the asks -- */

function useSend(onResult) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error);
    onResult(r);
    return r;
  };
  return { busy, error, run };
}

/**
 * THE WHEEL ON A PHONE (owner, 2026-10-05). Everyone sees it spin and land;
 * the one phone the wheel picked gets the button. Where it lands is the
 * server's, so this phone and the wall show the same answer.
 */
function PhoneWheel({ ask, api, onResult }) {
  const { busy, error, run } = useSend(onResult);
  const w = ask.wheel;
  return (
    <div className="bpl-wheel">
      {w.mine && <p className="plr-help bpl-wheel-turn"><b>Your turn.</b> Spin the wheel for the room.</p>}
      <BuildWheel wheel={w} size="md" onSpin={w.mine ? () => run(() => sendSpin(api, ask.askId)) : null} spinLabel={W.spin} busy={busy} />
      <ErrorLine error={error} />
    </div>
  );
}

function SuggestAsk({ ask, mine, api, onResult, shell }) {
  const [draft, setDraft] = useState('');
  const { busy, error, run } = useSend(onResult);
  const mineList = (mine && mine.responses) || [];
  const full = mineList.length >= MAX_SUGGESTIONS;
  const text = draft.trim();

  const submit = async () => {
    if (!text || full || busy) return;
    const r = await run(() => sendResponse(api, ask.askId, { text }));
    if (r.ok) setDraft('');
  };

  const dock = (
    <>
      <button type="button" className="plr-btn" disabled={!text || full || busy} onClick={submit}>
        {full ? `${MAX_SUGGESTIONS} of ${MAX_SUGGESTIONS} sent` : busy ? 'Sending…' : 'Suggest'}
      </button>
      <p className="plr-note plr-note--after bpl-center">{W.votingSoon}</p>
    </>
  );

  return shell({
    phase: 'ask',
    volume: 'act',
    dock,
    body: (
      <>
        <AskHead ask={ask} word={KIND_WORD.suggest} />
        {mineList.length > 0 && (
          <div className="bpl-mine">
            <p className="bpl-mine-h">Yours so far ({mineList.length} of {MAX_SUGGESTIONS})</p>
            <ul className="bpl-list">
              {mineList.map((r) => <li key={r.respId} className="bpl-text">{r.text}</li>)}
            </ul>
          </div>
        )}
        {!full && (
          <div className="bpl-why">
            <label className="bpl-label" htmlFor={`bpl-sug-${ask.askId}`}>Your suggestion</label>
            <textarea
              id={`bpl-sug-${ask.askId}`}
              className="plr-inp plr-inp--area bpl-area"
              maxLength={TEXT_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
        )}
        <p className="plr-help">{W.noNamesOnWall(MAX_SUGGESTIONS)}</p>
        <ErrorLine error={error} />
      </>
    ),
  });
}

function OptionCard({ option, index, checked, disabled, role, onToggle }) {
  return (
    <div className={`bpl-card${checked ? ' bpl-card--on' : ''}`}>
      <button
        type="button"
        role={role}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        className="bpl-pick"
        onClick={onToggle}
      >
        <span className={`bpl-letter bpl-letter--${index % 3}`} aria-hidden="true">{option.label}</span>
        <span className="bpl-otext">
          <span className="bpl-otitle bpl-text">
            <span className="bpl-sr">Choice {option.label}: </span>
            {option.title}
          </span>
          {option.detail ? <span className="bpl-odetail bpl-text">{option.detail}</span> : null}
        </span>
      </button>
      <BuildImage imageId={option.imageId} alt={`Choice ${option.label}: ${option.title}`} className="bpl-shot" />
      {isHttpUrl(option.url) ? (
        <a className="bpl-preview" href={option.url} target="_blank" rel="noopener noreferrer">
          Open preview<span className="bpl-sr"> of choice {option.label}</span>
        </a>
      ) : option.imageId ? null : (
        <span className="bpl-look">Look at the big screen</span>
      )}
    </div>
  );
}

function ChoiceAsk({ ask, mine, api, onResult, shell }) {
  const sent = (mine && mine.answer) || null;
  const max = Math.max(1, Number(ask.maxPicks) || 1);
  const multi = max > 1;
  const [picks, setPicks] = useState(() => (sent && Array.isArray(sent.choice) ? sent.choice : []));
  const [why, setWhy] = useState(() => (sent && sent.why) || '');
  const { busy, error, run } = useSend(onResult);
  const atLimit = multi && picks.length >= max;

  const toggle = (label) => {
    if (!multi) { setPicks([label]); return; }
    if (picks.includes(label)) setPicks(picks.filter((p) => p !== label));
    else if (picks.length < max) setPicks([...picks, label]);
  };

  const ordered = (ask.options || []).map((o) => o.label).filter((l) => picks.includes(l));
  const unchanged = Boolean(sent) && sameSet(sent.choice, picks) && (sent.why || '') === why.trim();
  const submit = () => {
    if (!picks.length || unchanged || busy) return;
    run(() => sendResponse(api, ask.askId, { choice: ordered, why: why.trim() }));
  };

  let label;
  if (!picks.length) label = multi ? `Pick up to ${max}` : 'Pick an option';
  else if (busy) label = 'Sending…';
  else if (unchanged) label = `Picked ${ordered.join(' + ')}`;
  else if (sent) label = `Change to ${ordered.join(' + ')}`;
  else label = `Pick ${ordered.join(' + ')}`;

  const dock = (
    <>
      <button type="button" className="plr-btn" disabled={!picks.length || unchanged || busy} onClick={submit}>
        {label}
      </button>
      <p className="plr-note plr-note--after bpl-center">{W.changeUntilClose}</p>
    </>
  );

  return shell({
    phase: 'ask',
    volume: 'act',
    dock,
    body: (
      <>
        <AskHead ask={ask} word={KIND_WORD.choice} />
        <p className="plr-rule">
          {multi ? W.pickedOf(picks.length, max) : 'Pick one.'}
        </p>
        <div className="bpl-cards" role={multi ? 'group' : 'radiogroup'} aria-label={multi ? `Pick up to ${max}` : 'Pick one'}>
          {(ask.options || []).map((o, i) => {
            const checked = picks.includes(o.label);
            return (
              <OptionCard
                key={o.label}
                option={o}
                index={i}
                checked={checked}
                disabled={atLimit && !checked}
                role={multi ? 'checkbox' : 'radio'}
                onToggle={() => toggle(o.label)}
              />
            );
          })}
        </div>
        <WhyField id={`bpl-why-${ask.askId}`} value={why} onChange={setWhy} />
        <ErrorLine error={error} />
      </>
    ),
  });
}

function RatingAsk({ ask, mine, api, onResult, shell }) {
  const sent = (mine && mine.answer) || null;
  const [value, setValue] = useState(() => (sent && sent.rating) || null);
  const [why, setWhy] = useState(() => (sent && sent.why) || '');
  const { busy, error, run } = useSend(onResult);
  const unchanged = Boolean(sent) && sent.rating === value && (sent.why || '') === why.trim();

  const submit = () => {
    if (!value || unchanged || busy) return;
    run(() => sendResponse(api, ask.askId, { rating: value, why: why.trim() }));
  };

  let label;
  if (!value) label = 'Pick a number';
  else if (busy) label = 'Sending…';
  else if (unchanged) label = `Rated ${value}`;
  else if (sent) label = `Change to ${value}`;
  else label = `Rate ${value}`;

  const dock = (
    <>
      <button type="button" className="plr-btn" disabled={!value || unchanged || busy} onClick={submit}>{label}</button>
      <p className="plr-note plr-note--after bpl-center">{W.changeUntilClose}</p>
    </>
  );

  return shell({
    phase: 'ask',
    volume: 'act',
    dock,
    body: (
      <>
        <AskHead ask={ask} word={KIND_WORD.rating} />
        <RatingInput
          question={{ scale: '1-5', lowLabel: RATING_SCALE.lowLabel, highLabel: RATING_SCALE.highLabel }}
          value={value}
          onChange={setValue}
        />
        <WhyField id={`bpl-why-${ask.askId}`} value={why} onChange={setWhy} />
        <ErrorLine error={error} />
      </>
    ),
  });
}

function VoteAsk({ ask, mine, api, onResult, shell }) {
  const max = Math.max(1, Number(ask.maxPicks) || 3);
  const sent = (mine && Array.isArray(mine.vote)) ? mine.vote : [];
  const [sel, setSel] = useState(sent);
  const { busy, error, run } = useSend(onResult);
  const responses = ask.responses || [];
  const atLimit = sel.length >= max;
  const voted = sent.length > 0;
  const unchanged = voted && sameSet(sent, sel);

  // Your own idea counts too (owner, 2026-10-06); it is marked "yours".
  const toggle = (r) => {
    if (sel.includes(r.respId)) setSel(sel.filter((x) => x !== r.respId));
    else if (!atLimit) setSel([...sel, r.respId]);
  };
  const submit = () => {
    if ((!sel.length && !voted) || unchanged || busy) return;
    run(() => sendVote(api, ask.askId, sel));
  };

  let label;
  if (!sel.length && !voted) label = `Pick up to ${max}`;
  else if (busy) label = 'Sending…';
  else if (unchanged) label = 'Votes in';
  else if (!sel.length) label = 'Take back my votes';
  else label = `Submit ${sel.length} ${sel.length === 1 ? 'vote' : 'votes'}`;

  const dock = (
    <>
      <div className="bpl-slots" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => <i key={i} className={i < sel.length ? 'bpl-slot--on' : ''} />)}
      </div>
      <button type="button" className="plr-btn" disabled={(!sel.length && !voted) || unchanged || busy} onClick={submit}>{label}</button>
    </>
  );

  return shell({
    phase: 'vote',
    volume: 'act',
    dock,
    body: (
      <>
        <Eyebrow word="Vote" askId={ask.askId} extra={`pick up to ${max}`} />
        <h2 className="plr-q bpl-text">{ask.prompt}</h2>
        <p className="plr-rule">
          {W.buildFirst(sel.length, max)}
        </p>
        {responses.length === 0 ? (
          <p className="plr-lede plr-muted">Nothing to vote on yet.</p>
        ) : (
          <div className="bpl-ballot" role="group" aria-label={`Pick up to ${max}`}>
            {responses.map((r, i) => {
              const on = sel.includes(r.respId);
              return (
                <button
                  key={r.respId}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-disabled={(atLimit && !on) || undefined}
                  className={`bpl-vrow${r.mine ? ' bpl-vrow--own' : ''}`}
                  onClick={() => toggle(r)}
                >
                  <span className="bpl-vn" aria-hidden="true">{i + 1}</span>
                  <span className="bpl-vt bpl-text">
                    {r.text}
                    {r.mine ? <span className="bpl-yours"> · yours</span> : null}
                  </span>
                  <span className="bpl-tick" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
        <ErrorLine error={error} />
      </>
    ),
  });
}

/* ------------------------------------------------------------ results -- */

function Bar({ pct }) {
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return <span className="bpl-bar" aria-hidden="true"><span style={{ width: `${w}%` }} /></span>;
}

function Results({ ask, mine }) {
  const res = ask.results || {};
  const total = Number(res.total) || 0;
  if (ask.kind === 'choice') {
    const opts = res.options || [];
    const top = Math.max(0, ...opts.map((o) => o.count || 0));
    const myPick = mine && mine.answer && Array.isArray(mine.answer.choice) ? mine.answer.choice : [];
    return (
      <>
        <ul className="bpl-res">
          {opts.map((o, i) => (
            <li key={o.label} className={top > 0 && o.count === top ? 'bpl-res--top' : ''}>
              <span className={`bpl-letter bpl-letter--${i % 3} bpl-letter--sm`} aria-hidden="true">{o.label}</span>
              <span className="bpl-rbody">
                <span className="bpl-rline">
                  <span className="bpl-rtitle bpl-text"><span className="bpl-sr">Choice {o.label}: </span>{o.title}</span>
                  <span className="bpl-rnum">{o.count} · {o.pct}%</span>
                </span>
                <Bar pct={o.pct} />
              </span>
            </li>
          ))}
        </ul>
        <p className="plr-help">{total} {total === 1 ? 'person' : 'people'} answered.{myPick.length ? ` You picked ${myPick.join(' + ')}.` : ''}</p>
      </>
    );
  }
  if (ask.kind === 'rating') {
    const r = res.rating || {};
    const dist = Array.isArray(r.dist) ? r.dist : [0, 0, 0, 0, 0];
    const most = Math.max(1, ...dist);
    return (
      <>
        <p className="bpl-avg">
          <b>{r.avg === null || r.avg === undefined ? '–' : r.avg}</b>
          <span> out of 5 · {r.count || 0} {(r.count || 0) === 1 ? 'rating' : 'ratings'}</span>
        </p>
        <ul className="bpl-dist">
          {dist.map((n, i) => (
            <li key={i}>
              <span className="bpl-rnum">{i + 1}</span>
              <Bar pct={(n / most) * 100} />
              <span className="bpl-rnum">{n}</span>
            </li>
          ))}
        </ul>
        {mine && mine.answer && mine.answer.rating ? <p className="plr-help">You rated it {mine.answer.rating}.</p> : null}
      </>
    );
  }
  const ranked = res.ranked || [];
  const most = Math.max(1, ...ranked.map((r) => r.votes || 0));
  if (!ranked.length) return <p className="plr-help">No suggestions this time.</p>;
  return (
    <>
      <ol className="bpl-ranked">
        {ranked.map((r) => (
          <li key={r.respId}>
            <span className="bpl-rline">
              <span className="bpl-rtitle bpl-text">{r.text}</span>
              <span className="bpl-rnum">{r.votes} {r.votes === 1 ? 'vote' : 'votes'}</span>
            </span>
            <Bar pct={((r.votes || 0) / most) * 100} />
          </li>
        ))}
      </ol>
      <p className="plr-help">{total} {total === 1 ? 'person' : 'people'} voted.</p>
    </>
  );
}

function Whys({ whys }) {
  const list = (whys || []).filter((w) => w && w.text);
  if (!list.length) return null;
  return (
    <section className="bpl-sec">
      <h3 className="plr-lab">What people said</h3>
      <ul className="bpl-whys">
        {list.map((w, i) => (
          <li key={i} className="bpl-text">
            {w.label ? <span className="bpl-wl">{w.label}</span> : null}
            {w.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decided({ decision }) {
  if (!decision) return null;
  const sentToClaude = decision.sendToAgent !== false;
  return (
    <div className="bpl-decided">
      <p className="bpl-sent">
        <Icon name="CheckCircle" weight="fill" size={18} />
        {sentToClaude ? 'Sent to Claude' : 'Decided'}
      </p>
      {decision.direction ? <p className="plr-quote bpl-text">{decision.direction}</p> : null}
      {sentToClaude && decision.deliveredAt ? <p className="plr-help">Claude has picked it up.</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------- watch feed -- */

function Outcome({ outcome, images = [] }) {
  if (!outcome) return null;
  const finals = images.filter((i) => i && i.kind === 'final');
  const built = (outcome.built || []).filter(Boolean);
  const links = (outcome.links || []).filter((l) => l && isHttpUrl(l.url));
  const next = (outcome.nextSteps || []).filter(Boolean);
  return (
    <section className="bpl-outcome" aria-label="What we built">
      <h3 className="bpl-h">What we built</h3>
      {outcome.summary ? <p className="bpl-text bpl-summary">{outcome.summary}</p> : null}
      {finals.map((im) => <BuildImage key={im.imageId} imageId={im.imageId} caption={im.caption} className="bpl-shot" />)}
      {built.length > 0 && (
        <>
          <h4 className="plr-lab">Built</h4>
          <ul className="bpl-list">{built.map((b, i) => <li key={i} className="bpl-text">{b}</li>)}</ul>
        </>
      )}
      {links.length > 0 && (
        <>
          <h4 className="plr-lab">Links</h4>
          <ul className="bpl-list bpl-links">
            {links.map((l, i) => (
              <li key={i}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="bpl-link">{l.label || l.url}</a>
              </li>
            ))}
          </ul>
        </>
      )}
      {next.length > 0 && (
        <>
          <h4 className="plr-lab">Next steps</h4>
          <ul className="bpl-list">{next.map((s, i) => <li key={i} className="bpl-text">{s}</li>)}</ul>
        </>
      )}
    </section>
  );
}

/**
 * A link as a participant reads it. A Wi-Fi share link carries the gateway's
 * key (?k=); it opens with it, but the key is not text to show on a screen
 * the room can see. Any other link reads exactly as it is.
 */
export function linkText(url) {
  try {
    const u = new URL(String(url));
    if (!u.searchParams.has('k')) return String(url);
    u.searchParams.delete('k');
    return u.toString().replace(/\/$/, '');
  } catch (e) {
    return String(url);
  }
}

function Feed({ view, showGoal = true, skipAskId = null }) {
  const crew = view.crew && view.crew.enabled ? view.crew : null;
  // The newest base move is the notice above the ticker; said once, not twice.
  const baseShown = crew && crew.baseMovedAt && crew.baseCommit ? lastBaseEntry(view.log) : null;
  const entries = (view.log || []).filter((e) => e && e !== baseShown && Object.prototype.hasOwnProperty.call(FEED_KINDS, e.kind));
  const recent = entries.slice(-FEED_LENGTH).reverse();
  const decisions = view.decisions || [];
  const last = decisions.length ? decisions[decisions.length - 1] : null;
  // Never the decision already on screen above it (one fact, once a viewport).
  const latest = last && last.askId !== skipAskId ? last : null;
  return (
    <section className="bpl-feed" aria-label="Watch the build">
      {view.state !== 'ENDED' && (
        <p className={`bpl-agent${view.agentConnected ? ' bpl-agent--on' : ''}`}>
          {view.agentConnected ? 'Claude Code is connected' : 'Claude Code is not connected'}
        </p>
      )}
      {showGoal && view.goal ? (
        <div className="bpl-goal">
          <h3 className="plr-lab">The goal</h3>
          <p className="bpl-text">{view.goal}</p>
        </div>
      ) : null}
      {latest ? (
        <div className="bpl-latest">
          <h3 className="bpl-kind bpl-kind--amber">Latest decision · Ask {askNo(latest.askId)}</h3>
          <p className="bpl-text bpl-latest-tx">{latest.direction}</p>
        </div>
      ) : null}
      <BaseNotice crew={crew} log={view.log} />
      <h3 className="plr-lab bpl-feed-h">Watch the build</h3>
      {recent.length === 0 ? (
        <p className="plr-help">{W.nothingYet}</p>
      ) : (
        <ul className="bpl-ticker">
          {recent.map((e, i) => (
            <li key={e.logId || i} className={`bpl-entry bpl-entry--${e.kind}${i === 0 ? ' bpl-entry--newest' : ''}`}>
              <span className="bpl-kind">{FEED_KINDS[e.kind]}</span>
              <span className="bpl-ago">{clock(e.createdAt)}</span>
              <span className="bpl-tx bpl-text">{e.text}</span>
              {DETAIL_KINDS.includes(e.kind) && e.detail ? <span className="bpl-dt bpl-text">{e.detail}</span> : null}
              {isHttpUrl(e.link) ? (
                <a className="bpl-link bpl-lnk" href={e.link} target="_blank" rel="noopener noreferrer">{linkText(e.link)}</a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------ preview feedback -- */

/** The newest thing Claude is showing, or null. */
export function latestPreview(log) {
  const shown = (log || []).filter((e) => e && e.kind === 'showing');
  return shown.length ? shown[shown.length - 1] : null;
}

/**
 * WHEN CLAUDE SHOWS THE WORK, THE ROOM CAN ANSWER (owner, 2026-10-04).
 * "Looks good" goes at once; "Needs a change" asks what. It reaches the host
 * as an idea that names the preview, once per preview per phone.
 */
function PreviewFeedback({ api, preview, sent, onResult }) {
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (verdict) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await sendPreviewFeedback(api, preview.logId, verdict, verdict === 'change' ? text.trim() : '');
    setBusy(false);
    if (!r.ok) setError(r.error);
    onResult(r);
  };
  return (
    <section className="bpl-ideas bpl-pvfb" aria-label="Feedback on the preview">
      {/* On its preview, in History (C11): the preview is the line above. */}
      <h3 className="plr-lab">What do you think of the preview?</h3>
      {sent ? (
        <p className="bpl-ok" role="status">{W.thanksSent}</p>
      ) : (
        <>
          {!changing ? (
            <div className="bpl-fbrow">
              <button type="button" className="bpl-send" disabled={busy} onClick={() => send('good')}>Looks good</button>
              <button type="button" className="bpl-send bpl-send--alt" disabled={busy} onClick={() => setChanging(true)}>Needs a change</button>
            </div>
          ) : (
            <>
              <label className="bpl-label" htmlFor="bpl-pvfb-text">What should change?</label>
              <textarea id="bpl-pvfb-text" className="plr-inp bpl-area bpl-area--short" maxLength={TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="bpl-fbrow">
                <button type="button" className="bpl-send" disabled={busy || !text.trim()} onClick={() => send('change')}>Send</button>
                <button type="button" className="bpl-send bpl-send--alt" disabled={busy} onClick={() => setChanging(false)}>Back</button>
              </div>
            </>
          )}
          <ErrorLine error={error} />
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- ideas -- */

function IdeaComposer({ api, ideas, open, setOpen, draft, setDraft, onResult, current = null, alwaysOpen = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentNote, setSentNote] = useState(false);
  const text = draft.trim();
  const mine = ideas || [];

  const send = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setSentNote(false);
    const r = await sendIdea(api, text);
    setBusy(false);
    if (r.ok) {
      setDraft('');
      setSentNote(true);
    } else {
      setError(r.error);
    }
    onResult(r);
  };

  return (
    <section className="bpl-ideas">
      {alwaysOpen ? (
        <h2 className="plr-h1 bpl-tabh">Your ideas</h2>
      ) : (
        <button type="button" className="bpl-ideabtn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="Lightbulb" size={18} />
          <span>Send an idea to the host</span>
          {mine.length ? <span className="bpl-ideacount">{mine.length} sent</span> : null}
        </button>
      )}
      {(open || alwaysOpen) && (
        <div className="bpl-ideabox">
          <label className="bpl-label" htmlFor="bpl-idea">Your idea</label>
          <textarea
            id="bpl-idea"
            className="plr-inp bpl-area bpl-area--short"
            maxLength={TEXT_MAX}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setSentNote(false); }}
          />
          <p className="plr-help">{W.talkHelp}</p>
          <button type="button" className="bpl-send" disabled={!text || busy} onClick={send}>
            {busy ? 'Sending…' : 'Send idea'}
          </button>
          {sentNote ? <p className="bpl-ok" role="status">Sent to the host.</p> : null}
          <ErrorLine error={error} />
          {mine.length > 0 && (
            <ul className="bpl-myideas" aria-label="Your ideas">
              {mine.map((idea) => (
                <li key={idea.ideaId}>
                  <span className="bpl-text">{idea.text}</span>
                  <span className={`bpl-status bpl-status--${idea.walled ? 'walled' : idea.status || 'new'}`}>{ideaStatusText(idea, current)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- history -- */

/**
 * WHAT WE HAVE BUILT SO FAR (step 7, C11): the room's story on this phone or
 * laptop, newest first — what Claude showed (with its pictures), what was
 * decided, what the room said. Feedback on a preview sits on the preview it
 * is about. The same story the wall shows (buildScreens roomStory).
 */
function HistoryTab({ view, api, onResult, now }) {
  const [filter, setFilter] = useState('all');
  const story = roomStory({ log: view.log || [], decisions: view.decisions || [], images: view.images || [], myIdeas: view.myIdeas || [], doing: doingLine(view.doing, now) });
  const shown = filterStory(story, filter);
  const preview = latestPreview(view.log);
  const previewSent = Boolean(preview && (view.myIdeas || []).some((i) => i.aboutLogId === preview.logId));
  // One body for a top-level item and for what a step holds.
  const body = (it) => (
    <>
      <p className="bpl-text bpl-story-t"><b className="bpl-story-h">{it.heading}</b> · {it.text}</p>
      {it.mine ? <p className="plr-help bpl-story-mine">Your idea was in this vote</p> : null}
      {it.imageIds.map((id) => <BuildImage key={id} imageId={id} alt={it.text} className="bpl-shot" />)}
      {isHttpUrl(it.link) ? <a className="bpl-link bpl-lnk" href={it.link} target="_blank" rel="noopener noreferrer">{linkText(it.link)}</a> : null}
      {preview && it.type === 'showed' && it.id === preview.logId && view.state !== 'ENDED' && (
        <PreviewFeedback key={preview.logId} api={api} preview={preview} sent={previewSent} onResult={onResult} />
      )}
    </>
  );
  return (
    <section className="bpl-history" aria-label="History">
      <h2 className="plr-h1 bpl-tabh">{W.builtSoFar}</h2>
      <div className="bpl-filters" role="group" aria-label="Show">
        {STORY_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`bpl-filter${filter === f.key ? ' is-on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {!shown.length && <p className="plr-help">{filter === 'decisions' ? 'Nothing decided yet.' : filter === 'pictures' ? 'No pictures yet.' : W.nothingYet}</p>}
      <ol className="bpl-story">
        {shown.map((it) => (
          <li key={it.id} className={`bpl-story-it bpl-story-it--${it.type}`}>
            <span className="bpl-ago">{clock(it.at)}</span>
            <div className="bpl-story-body">
              {it.type === 'step' ? (
                <>
                  <p className="bpl-text bpl-story-t"><b className="bpl-story-h">{it.heading}</b>{it.dur ? ` · ${it.dur}` : ''}</p>
                  {it.kids.length > 0 && (
                    <ul className="bpl-kids">
                      {it.kids.map((k) => <li key={k.id}>{body(k)}</li>)}
                    </ul>
                  )}
                </>
              ) : body(it)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Now · Ideas · History (C11), the same at the top of every screen, phone or laptop. */
const TABS = [
  { key: 'now', label: 'Now' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'history', label: 'History' },
];
function Tabs({ tab, setTab, nowBadge, ideaCount, hideIdeas = false }) {
  return (
    <nav className="bpl-tabs" aria-label="Build Room">
      {TABS.filter((t) => !(hideIdeas && t.key === 'ideas')).map((t) => (
        <button key={t.key} type="button" className={`bpl-tab${tab === t.key ? ' is-on' : ''}`} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
          {t.label}
          {t.key === 'now' && nowBadge && tab !== 'now' ? <span className="bpl-tabdot">{nowBadge}</span> : null}
          {t.key === 'ideas' && ideaCount ? <span className="bpl-tabcount">{ideaCount}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------- page -- */

/** One picture, full screen, with a Back. Esc and the backdrop-free layout keep it simple on a phone. */
function PictureView({ image, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bpl-viewer" role="dialog" aria-modal="true" aria-label="Picture">
      <div className="bpl-viewer-top">
        <button type="button" className="bpl-viewer-back" onClick={onClose}><Icon name="CaretLeft" size={16} /> Back</button>
        {image.caption ? <span className="bpl-viewer-cap">{image.caption}</span> : null}
        <button type="button" className="bpl-viewer-x" onClick={onClose} aria-label="Close the picture"><Icon name="X" size={18} /></button>
      </div>
      <div className="bpl-viewer-main"><BuildImage imageId={image.imageId} alt={image.caption || 'Screenshot'} className="bpl-viewer-pic" linked={false} /></div>
    </div>
  );
}

export default function BuildPlayer({
  gameId, playerName, clientId, apiBase, rev = 0, online = true, banner = null, ended = false,
}) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // The host removed this person (Session panel, Remove): the room refuses the
  // phone it had let in. Cleared the moment a read works again (Bring back).
  const [removed, setRemoved] = useState(false);
  // Or the name was taken by another device (the host let it): 'moved'.
  const [refusal, setRefusal] = useState('removed');
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState('');
  const [tab, setTab] = useState('now');
  // The doing line counts minutes and goes stale as time passes.
  const [now, setNow] = useState(() => Date.now());
  const hasDoing = Boolean(view && view.doing);
  useEffect(() => {
    if (!hasDoing) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, [hasDoing]);
  const lastOpenAsk = useRef(null);
  // A builder key, held only until "Done" (shown once; never stored).
  const [builderKey, setBuilderKey] = useState(null);
  const seq = useRef(0);
  const seen = useRef(false);
  const firstScreen = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const r = await fetchBuildState({ apiBase, gameId, playerName, clientId });
    if (!alive.current || mine !== seq.current) return;
    if (r.ok) {
      setView(r.data);
      setLoadError(null);
      setRemoved(false);
    } else if (r.status === 403 && seen.current) {
      setRefusal(r.data && r.data.code === 'moved' ? 'moved' : 'removed');
      setRemoved(true);
    } else {
      setLoadError(r.error);
    }
    if (r.ok) seen.current = true;
  }, [apiBase, gameId, playerName, clientId]);

  useEffect(() => { load(); }, [load, rev, ended]);

  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // A NEW QUESTION BRINGS EVERYONE BACK TO NOW (step 7): whoever is reading
  // History or writing an idea sees the room is waiting on them.
  const openKey = view && view.current && ['live', 'voting'].includes(view.current.status) ? `${view.current.askId}:${view.current.status}` : null;
  useEffect(() => {
    if (openKey && openKey !== lastOpenAsk.current) {
      lastOpenAsk.current = openKey;
      setTab('now');
    }
  }, [openKey]);

  const api = { apiBase, gameId, playerName, clientId };

  /** After any write: take the server's `mine` at once, then refetch the room. */
  const onResult = (r) => {
    if (r.ok && r.data && r.data.mine) setView((v) => (v ? { ...v, mine: r.data.mine } : v));
    load();
  };

  // A screenshot is read through this phone's own seat, like everything else
  // it reads (build-room.js routePlay); an <img> cannot send headers, so the
  // seat rides in the query string.
  const loadImage = useCallback((imageId) => (
    `${apiBase}games/${encodeURIComponent(gameId)}/build-play/images/${encodeURIComponent(imageId)}`
    + `?playerName=${encodeURIComponent(playerName || '')}&clientId=${encodeURIComponent(clientId || '')}`
  ), [apiBase, gameId, playerName, clientId]);
  // A picture opens full screen in the app, with a Back; never a new tab (owner, 2026-10-08).
  const [shown, setShown] = useState(null);
  const shell = ({ phase = 'quiet', volume = 'watch', dock = null, body, centre = false }) => (
    <ImageLoader.Provider value={loadImage}>
    <ImageViewer.Provider value={setShown}>
    <PlayerShell
      phase={phase}
      volume={volume}
      ctx={(view && view.title) || 'Build Room'}
      who={playerName}
      online={online}
      banner={banner}
      dock={dock ? <div className="bpl">{dock}</div> : null}
      centre={centre}
    >
      <div className="bpl">{body}</div>
      {/* On document.body, never inside the shell: iOS Safari keeps a fixed box
         inside the stage's touch scroller, which put Back under the header
         (owner's iPhone, 2026-10-10). The wrapper only carries the scopes. */}
      {shown && createPortal(
        <div className="plr plr-portal" data-theme="dark"><div className="bpl"><PictureView image={shown} onClose={() => setShown(null)} /></div></div>,
        document.body,
      )}
    </PlayerShell>
    </ImageViewer.Provider>
    </ImageLoader.Provider>
  );

  if (removed && refusal === 'moved') {
    return shell({
      volume: 'rest',
      centre: true,
      body: <p className="plr-lede">This name is on another device now. Join again with another name.</p>,
    });
  }
  if (removed) {
    const wasBuilder = Boolean(view && view.crew && view.crew.me);
    return shell({
      volume: 'rest',
      centre: true,
      body: (
        <>
          <p className="plr-lede">The host took you out of this session.</p>
          {wasBuilder && <p className="plr-help">{W.unlinked}</p>}
          <p className="plr-help">{W.staysInReport}</p>
        </>
      ),
    });
  }

  if (!view) {
    return shell({
      volume: 'rest',
      centre: true,
      body: loadError
        ? (<><p className="plr-lede">Could not load the room.</p><ErrorLine error={loadError} /></>)
        : <p className="plr-lede plr-muted">Joining the build…</p>,
    });
  }

  const isEnded = ended || view.state === 'ENDED';
  const ask = view.current;
  const mine = view.mine || {};
  const myIdeas = view.myIdeas || [];
  const preview = latestPreview(view.log);
  const previewSent = Boolean(preview && myIdeas.some((i) => i.aboutLogId === preview.logId));
  const openAsk = Boolean(ask && ['live', 'voting'].includes(ask.status));
  const shownTab = isEnded && tab === 'ideas' ? 'now' : tab;

  const crewOn = Boolean(view.crew && view.crew.enabled);
  const crew = crewOn ? (
    <>
      <hr className="plr-sep" />
      <CrewSection crew={view.crew} api={api} onResult={onResult} builderKey={builderKey} setBuilderKey={setBuilderKey} myPoints={view.myPoints} />
    </>
  ) : null;

  /* NOW · IDEAS · HISTORY (C11). On Ideas or History the dock goes and the
     body is that tab, while the Now screen stays mounted underneath, so an
     answer being typed survives a look at History. */
  const tabs = (
    <Tabs
      tab={shownTab}
      setTab={setTab}
      nowBadge={openAsk ? `Ask ${askNo(ask.askId)}` : null}
      ideaCount={isEnded ? 0 : myIdeas.length}
      hideIdeas={isEnded}
    />
  );
  const ideasTab = (
    <IdeaComposer
      api={api} ideas={myIdeas} open setOpen={setIdeaOpen} draft={ideaDraft} setDraft={setIdeaDraft}
      onResult={onResult} current={ask} alwaysOpen
    />
  );
  const otherTab = shownTab === 'ideas' ? ideasTab : shownTab === 'history' ? <HistoryTab view={view} api={api} onResult={onResult} now={now} /> : null;
  /* On Now: a word when Claude shows something new (the feedback is on its
     picture in History), and the way to send an idea. */
  /* OPEN THE BUILD, at the top of Now (mockup L5): the first thing a
     participant sees while the host shares the build on this Wi-Fi. */
  const openBuild = !isEnded && view.lan && view.lan.open ? (
    <section className="bpl-open" aria-label="Open the build">
      <a className="bpl-send bpl-open-btn" href={view.lan.open} target="_blank" rel="noopener noreferrer" title="Opens in a new tab">{W.openBuild} ↗</a>
      <p className="plr-help bpl-open-note">{W.sameWifiOnly}</p>
    </section>
  ) : null;
  const run = view.run && view.run.status === 'running' ? view.run : null;
  const nowExtras = isEnded ? null : (
    <>
      {run && ask ? <RunBlock run={run} /> : null}
      {preview && !previewSent && (
        <section className="bpl-ideas bpl-pvnote" aria-label="Claude is showing something">
          <p className="plr-help">Claude is showing something new: <span className="bpl-text">{preview.text}</span></p>
          {view.lan && view.lan.open && <p className="plr-help">Try it, then say what you think.</p>}
          <button type="button" className="bpl-send bpl-send--alt" onClick={() => setTab('history')}>{W.haveALook}</button>
        </section>
      )}
      <section className="bpl-ideas">
        <button type="button" className="bpl-ideabtn" onClick={() => setTab('ideas')}>
          <Icon name="Lightbulb" size={18} />
          <span>Send an idea to the host</span>
          {myIdeas.length ? <span className="bpl-ideacount">{myIdeas.length} sent</span> : null}
        </button>
      </section>
    </>
  );
  const page = ({ dock = null, volume = 'watch', phase, body, centre = false }) => shell({
    phase,
    volume: shownTab === 'now' ? volume : 'watch',
    dock: shownTab === 'now' ? dock : null,
    centre: shownTab === 'now' ? centre : false,
    body: <>{tabs}{shownTab === 'now' ? body : otherTab}</>,
  });

  /* ENDED: the wrap-up, and nothing to send — the server refuses every write. */
  if (isEnded) {
    return page({
      volume: 'rest',
      body: (
        <>
          <h1 className="plr-h1 plr-h1--primary">That's a wrap</h1>
          {view.outcome ? <Outcome outcome={view.outcome} images={view.images || []} /> : <p className="plr-lede">The session has ended. Thanks for building.</p>}
          <Feed view={view} />
        </>
      ),
    });
  }

  /* WHAT THIS IS, said once: on the first screen this phone sees (until that
     screen changes), and always on the watch screen, which is home. */
  const screenKey = ask && ['live', 'voting', 'results', 'decided'].includes(ask.status) ? `${ask.askId}:${ask.status}` : 'watch';
  if (firstScreen.current === null) firstScreen.current = screenKey;
  const intro = (screenKey === 'watch' || screenKey === firstScreen.current) ? (
    <p className="bpl-intro">
      {W.playerIntro(view.title || 'this')}
    </p>
  ) : null;
  /* The ask screens draw their own shell (they own the dock); the Now extras
     ride under every one of them. Keyed by ask AND status, so a refetch keeps
     a draft and a new ask or phase starts clean. */
  const askShell = (props) => page({ ...props, body: <>{intro}{openBuild}{props.body}{nowExtras}{crew}</> });
  const kids = { ask, mine, api, onResult, shell: askShell };

  if (ask && ask.status === 'live') {
    const key = `${ask.askId}:live`;
    if (ask.kind === 'suggest') return <SuggestAsk key={key} {...kids} />;
    if (ask.kind === 'choice') return <ChoiceAsk key={key} {...kids} />;
    if (ask.kind === 'rating') return <RatingAsk key={key} {...kids} />;
  }
  if (ask && ask.status === 'voting' && ask.kind === 'suggest') {
    return <VoteAsk key={`${ask.askId}:voting`} {...kids} />;
  }
  /* A point the host shows wins over a settled question: the host can only show
     one once the question is no longer open, but the last decided ask stays
     current on the phone, so without this the point never reached the room. */
  if (ask && (ask.status === 'results' || ask.status === 'decided') && !view.shownPoint) {
    const decided = ask.status === 'decided';
    return page({
      volume: 'watch',
      body: (
        <>
          {intro}
          {openBuild}
          <Eyebrow word={decided ? 'Decided' : 'Results'} askId={ask.askId} />
          <h2 className="plr-q bpl-text">{ask.prompt}</h2>
          {decided ? <Decided decision={ask.decision} /> : null}
          {ask.wheel ? <PhoneWheel ask={ask} api={api} onResult={onResult} /> : null}
          <Results ask={ask} mine={mine} />
          <Whys whys={ask.results && ask.results.whys} />
          {!decided ? null : null}
          {nowExtras}
          {crew}
          <hr className="plr-sep" />
          <Feed view={view} showGoal={false} skipAskId={ask.askId} />
        </>
      ),
    });
  }

  /* No current ask: watch the build. A point the host put on the Stage comes
     first (Talk it over), then the host's run list; both replace the heading. */
  const point = view.shownPoint || null;
  const doingNow = doingLine(view.doing, now);
  return page({
    volume: 'watch',
    body: (
      <>
        {intro}
        {openBuild}
        {point ? <TalkItOver key={`${point.kind}:${point.text}`} point={point} api={api} onResult={onResult} /> : null}
        {point && run ? <RunBlock run={run} /> : null}
        {!point && run ? <RunBlock run={run} lead /> : null}
        {!point && !run ? (
          <>
            <h1 className="plr-h1 plr-h1--primary">{doingNow && doingNow.text ? doingNow.headline : 'Claude is building'}</h1>
            {doingNow && doingNow.text && !doingNow.stale ? <p className="bpl-dur">{W.forDur(doingNow.dur)}</p> : null}
            {doingNow && doingNow.helperLine ? <p className="bpl-helper">{doingNow.helperLine}</p> : null}
            {(doingNow && doingNow.text && doingNow.stale ? W.hostPicksUp : W.buildingHint) ? <p className="plr-help bpl-hint">{doingNow && doingNow.text && doingNow.stale ? W.hostPicksUp : W.buildingHint}</p> : null}
          </>
        ) : null}
        {view.outcome ? <Outcome outcome={view.outcome} images={view.images || []} /> : null}
        {crewOn ? <CrewSection crew={view.crew} api={api} onResult={onResult} builderKey={builderKey} setBuilderKey={setBuilderKey} myPoints={view.myPoints} /> : null}
        <Feed view={view} />
        {nowExtras}
      </>
    ),
  });

}
