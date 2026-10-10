/**
 * THE BUILD ROOM'S FOUR SCREENS (docs/design/build-room-host-redesign, the
 * second pass the owner approved on 2026-10-05: "yes to the shape").
 *
 * One header carries four screens. Host is where the host works; Stage,
 * Build and History are made to be shown to the room. Choosing what the room
 * looks at replaces the old Present toggle, which only hid controls. P still
 * means "show the room": it flips between Host and the last screen the room
 * saw.
 *
 * Pure: no React, no fetch. The page and its tests share these.
 */
import { safeHref } from './buildHostApi';
import { wifiState } from './wifiShare';
import { W } from './words';

export const SCREENS = Object.freeze([
  Object.freeze({ key: 'host', label: 'Host', shortcut: '1' }),
  Object.freeze({ key: 'stage', label: 'Stage', shortcut: '2' }),
  Object.freeze({ key: 'build', label: 'Build', shortcut: '3' }),
  Object.freeze({ key: 'history', label: 'History', shortcut: '4' }),
]);

/** The screens made to be seen by the room. Nothing host-only renders on them. */
export const PROJECTED = Object.freeze(['stage', 'build', 'history']);

export const isProjected = (screen) => PROJECTED.includes(screen);

/** The screen a number key selects, or null. */
export function screenForKey(key) {
  const hit = SCREENS.find((s) => s.shortcut === key);
  return hit ? hit.key : null;
}

/** P: from Host to the last screen the room saw (Stage the first time), and back. */
export function togglePresent(current, lastProjected) {
  if (isProjected(current)) return 'host';
  return isProjected(lastProjected) ? lastProjected : 'stage';
}

/**
 * How many things are waiting on the host: Claude's proposed asks and the
 * room's new ideas (preview feedback is an idea too). A number only: on a
 * projected screen the room sees the count, never the content.
 */
export function waitingCount(room) {
  return queueItems(room).length;
}

/**
 * THE QUEUE (step 4, C1): everything waiting on the host, in one list.
 * Claude's asks first (Claude is waiting on them), then everything else
 * oldest first: the host's drafts and waiting votes, the room's ideas and
 * the host's own queued ideas. Each item: `{type: 'ask'|'idea', id, from:
 * 'claude'|'room'|'you', at, ask?|idea?}`.
 */
export function queueItems(room) {
  if (!room) return [];
  const asks = (room.asks || []).filter((a) => a.status === 'proposed')
    .map((a) => ({ type: 'ask', id: `ask:${a.askId}`, from: a.source === 'agent' ? 'claude' : 'you', at: a.createdAt || '', ask: a }));
  const ideas = (room.ideas || []).filter((i) => i.status === 'new')
    .map((i) => ({ type: 'idea', id: `idea:${i.ideaId}`, from: i.source === 'host' ? 'you' : 'room', at: i.createdAt || '', idea: i }));
  const byAge = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
  const claude = asks.filter((x) => x.from === 'claude').sort(byAge);
  const rest = [...asks.filter((x) => x.from !== 'claude'), ...ideas].sort(byAge);
  return [...claude, ...rest];
}

// ── The Host alert (docs/design/build-room-host-alert, owner 2026-10-10) ────
// What waits on the host, for the two screens the room sees. A count and a few
// folded lines of FIXED words: never a name, never a word a participant typed.
// Claude's question and mockups ready turn it amber (Claude is blocked on the
// host); ideas and early looks are grey. "Claude finished", the host's own
// drafts and queued ideas, and takeover requests (SESSION carries those) are
// not counted. "Seen" is kept on the room (room.seen) so every device agrees;
// `local` is this device's just-seen items, applied before the server answers.

const isMockupAsk = (a) => a.kind === 'choice' && (a.options || []).length >= 2 && (a.options || []).every((o) => o.imageId);
/** Claude asked for mockups and has not finished them: the host is not being waited on yet. */
const mockupsPending = (a) => Boolean(a.mockups && a.mockups.asked && !a.mockups.ready);

/** An item is unseen when its id was not opened and it was made after the last Mark all seen. */
function unseenFilter(room, local) {
  const seen = (room && room.seen) || {};
  const ids = new Set([...(seen.ids || []), ...((local && local.ids) || [])]);
  const allAt = [seen.allAt, local && local.allAt].filter(Boolean).sort().pop() || '';
  return (id, at) => !ids.has(id) && !(allAt && at && String(at) <= allAt);
}

const byAt = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);

/**
 * @returns {{count: number, amber: boolean, lines: Array<{key: string, label: string, go: string, ids: string[], target: {kind: 'ask', id: string}|{kind: 'waiting'}}>}}
 */
export function hostAlert(room, local) {
  const none = { count: 0, amber: false, lines: [] };
  if (!room) return none;
  const fresh = unseenFilter(room, local);
  const proposed = (room.asks || []).filter((a) => a.status === 'proposed' && a.source === 'agent' && !mockupsPending(a))
    .map((a) => ({ id: `ask:${a.askId}`, askId: a.askId, at: a.createdAt || '', a }))
    .filter((x) => fresh(x.id, x.at)).sort(byAt);
  const questions = proposed.filter((x) => !isMockupAsk(x.a));
  const mockups = proposed.filter((x) => isMockupAsk(x.a));
  const ideas = (room.ideas || []).filter((i) => i.status === 'new' && i.source !== 'host')
    .map((i) => ({ id: `idea:${i.ideaId}`, at: i.createdAt || '' }))
    .filter((x) => fresh(x.id, x.at)).sort(byAt);
  const looks = ((room.crew && room.crew.enabled && room.crew.shares) || []).filter((s) => s.lane === 'shared' && !s.featured)
    .map((s) => ({ id: `share:${s.shareId}`, at: s.updatedAt || s.createdAt || '' }))
    .filter((x) => fresh(x.id, x.at)).sort(byAt);
  const ids = (list) => list.map((x) => x.id);
  const lines = [];
  if (questions.length) lines.push({ key: 'question', label: W.alertQuestion(questions.length), go: W.alertOpen, ids: ids(questions), target: { kind: 'ask', id: questions[0].askId } });
  if (mockups.length) lines.push({ key: 'mockups', label: W.alertMockups(mockups.length, mockups[0].a.options.length), go: W.alertSee, ids: ids(mockups), target: { kind: 'ask', id: mockups[0].askId } });
  if (ideas.length) lines.push({ key: 'ideas', label: W.alertIdeas(ideas.length), go: W.alertReview, ids: ids(ideas), target: { kind: 'waiting' } });
  if (looks.length) lines.push({ key: 'looks', label: W.alertLooks(looks.length), go: W.alertReview, ids: ids(looks), target: { kind: 'waiting' } });
  return {
    count: questions.length + mockups.length + ideas.length + looks.length,
    amber: questions.length + mockups.length > 0,
    lines,
  };
}

/** The queue's filter chips (C1), with counts. */
export const QUEUE_FILTERS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'claude', label: 'Claude' },
  { key: 'room', label: 'Room' },
  { key: 'you', label: 'You' },
]);
export const filterQueue = (items, key) => (key === 'all' ? items : items.filter((x) => x.from === key));

/** Ideas the host set aside with Later: their own fold under the queue. */
export const laterIdeas = (room) => ((room && room.ideas) || []).filter((i) => i.status === 'later');

/**
 * THE ONE LATER LIST (batch 2-3, B4): a merged view of two things the server
 * keeps apart: room ideas the host saved (status `later`) and directions held
 * for Claude (`brief.later`, which also holds a decision saved with the old
 * `later` kind). Newest first; an item with no time sorts last.
 * Item: `{ key, type: 'idea'|'direction', id, text, tag, from, at }`.
 */
export function laterItems(room) {
  const ideas = laterIdeas(room).map((i) => ({
    key: `idea:${i.ideaId}`, type: 'idea', id: i.ideaId, text: i.text, tag: W.ideaTag,
    from: i.source === 'host' ? 'You \u00b7 typed' : `${i.playerName || 'Someone'} \u00b7 ${i.aboutLogId ? 'on the preview' : 'idea'}`,
    at: i.createdAt || '',
  }));
  const dirs = (((room && room.brief) || {}).later || []).map((i) => ({
    key: `dir:${i.id}`, type: 'direction', id: i.id, text: i.text, tag: W.directionTag,
    from: !i.from || i.from === 'you' ? 'You \u00b7 typed' : `You \u00b7 from ${i.from.charAt(0).toUpperCase()}${i.from.slice(1)}`,
    at: i.at || '',
  }));
  return [...ideas, ...dirs].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The open ask the header pill names, or null: "Ask 3 · 5 of 18" / "Ask 3 · results". */
export function askPill(room) {
  if (!room || !room.currentAskId) return null;
  const ask = (room.asks || []).find((a) => a.askId === room.currentAskId);
  if (!ask || !['live', 'voting', 'results'].includes(ask.status)) return null;
  const n = Number(ask.askId) || ask.askId;
  if (ask.status === 'results') return { text: `Ask ${n} · results`, results: true };
  const count = ask.kind === 'suggest' && ask.status === 'voting' ? ask.voteCount : ask.answerCount;
  return { text: `Ask ${n} · ${count || 0} of ${room.playerCount || 0}`, results: false };
}

const BUILD_LOG_KINDS = ['showing', 'progress', 'milestone'];

/**
 * What the Build screen shows: the newest link to the running work and the
 * newest screenshot of it. The link is the newest one Claude posted with a
 * showing, progress or milestone entry, or the wrap-up's demo; the picture is
 * the newest screenshot that is not an option's mockup.
 */
export function latestBuild(room) {
  const log = (room && room.log) || [];
  let link = '';
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const l = log[i];
    if (l.by === 'agent' && BUILD_LOG_KINDS.includes(l.kind) && safeHref(l.link)) { link = l.link; break; }
  }
  if (!link) {
    const demo = ((room && room.outcome && room.outcome.links) || []).find((l) => safeHref(l.url));
    if (demo) link = demo.url;
  }
  const shots = ((room && room.images) || []).filter((im) => im.kind !== 'mockup');
  const shot = shots.length ? shots[shots.length - 1] : null;
  return { link, shot };
}

/** What the room can do, never a second status; Wi-Fi sharing adds one sentence. */
function roomDockLine(room, now) {
  const w = wifiState(room && room.lan, now).state;
  return `Send an idea any time.${w === 'on' || w === 'quiet' ? ' Open the build on this Wi-Fi.' : ''}`;
}

const STAGE_KIND = Object.freeze({ suggest: 'Ideas', choice: 'Choose', rating: 'Rate' });

// ── Claude's one status (owner, 2026-10-07) ─────────────────────────────────
//
// "Its listening but its building": the stage, the dock, the host's Now card
// and the header chip each guessed. This is the one rule they all read.

/** Claude has done something this recently: it is building. */
export const BUILDING_WINDOW_MS = 90 * 1000;
const POST_KINDS = ['progress', 'showing', 'milestone'];
const timeOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const stripEnd = (text) => String(text || '').trim().replace(/[\s.!?]+$/, '');

// ── What Claude is doing, in one line (owner, 2026-10-10) ───────────────────
//
// docs/design/build-room-doing. The server resolves the line (build-store.js
// doingView); every screen reads it here, so they never disagree.

/** No command and no post for this long, and Claude not waiting: "Claude was …". */
export const DOING_STALE_MS = 3 * 60 * 1000;
const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');
const upperFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
export const durText = (mins) => (mins < 1 ? 'under 1 min' : `${mins} min`);

/**
 * The doing line as a screen says it, or null. Stale is re-derived from
 * `lastActiveAt` as the clock moves; the server's flag is only a snapshot.
 * @returns {{ text, headline, stale, mins, dur, helper, helperLine, source, startedAt, lastActiveAt }|null}
 */
export function doingLine(doing, now) {
  const text = doing && typeof doing.text === 'string' ? doing.text.trim() : '';
  const helper = doing && typeof doing.helper === 'string' ? doing.helper.trim() : '';
  // A helper can work while Claude has no line of its own: text is '' then.
  if (!text && !helper) return null;
  const at = new Date(now).getTime();
  const started = Date.parse(doing.startedAt || '');
  const active = Date.parse(doing.lastActiveAt || '');
  // A laptop clock more than 2 min behind the server cannot judge age: trust the server's flag.
  const skewed = Number.isFinite(active) && at - active < -2 * 60 * 1000;
  const stale = Number.isFinite(active) && !skewed ? at - active > DOING_STALE_MS : Boolean(doing.stale);
  const mins = Number.isFinite(started) ? Math.max(0, Math.floor((at - started) / 60000)) : 0;
  return {
    text,
    headline: text ? `${stale ? 'Claude was' : 'Claude is'} ${lowerFirst(text)}` : '',
    stale,
    mins,
    dur: durText(mins),
    helper,
    helperLine: helper ? W.helperIs(helper) : '',
    source: doing.source || '',
    startedAt: doing.startedAt || null,
    lastActiveAt: doing.lastActiveAt || null,
  };
}

/**
 * `host: true` is the host's own screen: the line speaks to the host, never about
 * them (`continueOn`: the Continue prompt button is on that screen).
 * @returns {{ key: 'building'|'waiting'|'paused'|'none', headline: string, line: string, since: string|null }}
 */
export function claudeState(room, now, opts = {}) {
  // A line Claude or its to-do list gave wins, unless Claude is waiting for direction.
  const dl = room && room.agent && room.agent.listening ? null : doingLine(room && room.doing, now);
  const st = claudeBase(room, now, opts, dl && dl.text ? dl : null);
  // A helper alone leaves the headline as it was and adds its own line.
  return dl && !dl.text && dl.helperLine ? { ...st, helperLine: dl.helperLine } : st;
}

function claudeBase(room, now, { host = false, continueOn = false } = {}, dl = null) {
  const at = new Date(now).getTime();
  const agent = (room && room.agent) || {};
  const log = (room && room.log) || [];
  if (dl && !dl.stale) {
    return { key: 'building', headline: dl.headline, line: dl.helperLine, since: dl.startedAt, doing: dl };
  }
  if (dl) {
    const line = host ? (continueOn ? 'Copy the Continue prompt.' : '') : W.hostPicksUp;
    return { key: 'paused', headline: dl.headline, line, since: null, doing: dl };
  }
  const posts = log.filter((l) => l.by === 'agent' && POST_KINDS.includes(l.kind) && l.text);
  const lastPost = posts.reduce((best, l) => (!best || timeOf(l.createdAt) >= timeOf(best.createdAt) ? l : best), null);
  const acts = ((room && room.activity) || []).filter((a) => a && Number.isFinite(timeOf(a.at)));
  const lastAct = acts.reduce((best, a) => (!best || timeOf(a.at) >= timeOf(best.at) ? a : best), null);
  const agentTimes = log.filter((l) => l.by === 'agent').map((l) => timeOf(l.createdAt)).filter(Number.isFinite);
  const latestMs = Math.max(-Infinity, lastAct ? timeOf(lastAct.at) : -Infinity, ...agentTimes);
  if (Number.isFinite(latestMs) && at - latestMs <= BUILDING_WINDOW_MS) {
    return {
      key: 'building',
      headline: 'Claude is building',
      line: lastPost ? lastPost.text : (lastAct ? lastAct.text : ''),
      since: lastPost ? lastPost.createdAt : (lastAct ? lastAct.at : null),
    };
  }
  if (agent.listening || agent.connected) {
    return {
      key: 'waiting',
      headline: 'Claude is ready',
      line: host
        ? (lastPost ? `Done: ${stripEnd(lastPost.text)}.` : '')
        : (lastPost ? `Done: ${stripEnd(lastPost.text)}.` : ''),
      since: null,
    };
  }
  if (agent.lastSeenAt || lastPost) {
    // The host's own screen never speaks of the host in the third person: it
    // points at the one action that is on the screen, or says nothing.
    const line = host ? (continueOn ? 'Copy the Continue prompt.' : '') : W.hostPicksUp;
    return { key: 'paused', headline: 'Claude has paused', line, since: null };
  }
  return { key: 'none', headline: 'Waiting for Claude Code', line: '', since: null };
}

/** The latest decision as "Question: answer", or ''. */
export function latestDecisionLine(room) {
  const decided = ((room && room.asks) || []).filter((a) => a.status === 'decided' && a.decision)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
  const d = decided[decided.length - 1];
  if (!d) return '';
  const dir = String(d.decision.direction || '');
  const q = questionOf(d.prompt);
  return q && dir && !dir.startsWith(q) ? `${q}: ${dir}` : dir;
}

/**
 * THE STAGE SCREEN, as the regular host stage draws it (Rail, RoomMeter,
 * Dock: components/stage/). Everything here is room-safe: a phase, a count,
 * one sentence. `primary` is the dock's one move, the same key (Space) and
 * place as Start Voting on the regular stage. At results the host decides on
 * the Stage: `to-claude` sends the room's choice, `edit` opens the send window.
 */
/**
 * THE STAGE'S SEND, the Host's Settle button as a dock move: the same words,
 * the same rule and the same kept draft (settleMove). A set that says Later
 * saves instead of sending, on both screens. Null when there is no pick.
 */
function stageSend(ask, draft) {
  const move = settleMove(ask, draft);
  return move ? { action: 'to-claude', label: move.label, verb: move.verb } : null;
}

/** "B leads, 7 to 4" · "Tied, 5 to 5" · "Average 3.4 from 10" (B3a). */
function resultsLine(ask) {
  if (ask.kind === 'rating') {
    const r = ask.results && ask.results.rating;
    return r && r.avg !== null && r.avg !== undefined ? `Average ${r.avg} from ${r.count || (ask.results && ask.results.total) || 0}` : 'Results';
  }
  const ranked = decisionChoices(ask).map((c) => c.count).sort((a, b) => b - a);
  if (!ranked.length || !ranked[0]) return 'Results';
  const win = winnerOf({ ...ask, wheel: null });
  if (win) {
    const pick = decisionChoices(ask).find((c) => c.id === win);
    return `${pick && pick.label ? pick.label : 'The top idea'} leads, ${ranked[0]} to ${ranked[1] || 0}`;
  }
  return ranked[1] === ranked[0] && ranked[2] === ranked[0] ? `Tied, ${ranked[0]} each` : `Tied, ${ranked[0]} to ${ranked[1]}`;
}

export function stageModel(room, current, now = Date.now(), { crewOn = false, draft = null, turning = false, highlight = null } = {}) {
  const here = (room && room.playerCount) || 0;
  const ended = Boolean(room && room.state === 'ENDED');
  if (ended) {
    return { phase: 'ENDED', context: { category: 'Build Room' }, meter: { heading: 'Took part', count: here, of: null }, status: 'Session ended.', primary: null };
  }
  if (!current && room && room.shownPoint && !(room.opening && room.opening.phase === 'opening') && !crewOn) {
    // A TALKING POINT ON THE STAGE (talking points T4): the host chose it; the room talks it over.
    const p = shownPointOf(room);
    return {
      phase: null, context: { category: W.talkItOver }, point: p,
      meter: { heading: W.ideasOnThis, count: shownPointIdeas(room).length, of: null },
      status: '',
      primary: { action: 'take-down', label: W.takeItDown, point: p },
      secondary: { action: 'point-later', label: W.saveLater, point: p },
    };
  }
  if (!current && room && runRunning(room) && !(room.opening && room.opening.phase === 'opening') && !crewOn) {
    // THE RUN LIST ON THE STAGE (talking points T7): the room's picks, the current one lit.
    const run = room.run;
    const nextItem = runNextItem(run);
    const doneNow = Boolean(run.claudeDone);
    return {
      phase: null, context: { category: W.workingThrough }, run,
      meter: { heading: W.runLabel, count: runDoneCount(run), of: run.total },
      status: doneNow ? W.claudeFinishedItem(run.cur) : W.claudeIsWorking(run.cur, run.total),
      ...(nextItem ? {
        primary: { action: 'run-next', label: W.nextShort(nextItem.k), k: nextItem.k, from: run.cur, claudeDone: doneNow },
        secondary: { action: 'run-skip', label: W.skipItem(nextItem.k) },
      } : { primary: null }),
      extras: [{ action: 'run-stop', label: W.stop }],
    };
  }
  if (!current) {
    const agent = (room && room.agent) || {};
    const status = room && room.outcome && room.outcome.summary ? 'Here is what we built.'
      // The opening (owner, 2026-10-06): the room frames the build first.
      : room && room.opening && room.opening.phase === 'opening' ? 'Framing the build.'
        : roomDockLine(room, now);
    // MOCKUPS TO LOOK AT (host-flow S4): the pictures are in, the vote is not
    // open; the host's one move is to open it.
    // Not while the opening frames the build, nor while the crew board is up.
    const framing = Boolean(room && room.opening && room.opening.phase === 'opening');
    const looks = room && !framing && !crewOn && !(room.outcome && room.outcome.summary) ? mockupsReady(room) : null;
    if (looks) {
      return {
        phase: null, context: { category: 'Build Room' }, meter: { heading: 'In the room', count: here, of: null },
        status: 'Mockups ready',
        primary: { action: 'open', label: W.openVoting, askId: looks.ask.askId },
      };
    }
    return { phase: null, context: { category: 'Build Room' }, meter: { heading: 'In the room', count: here, of: null }, status, primary: null };
  }
  const n = Number(current.askId) || current.askId;
  const context = { category: STAGE_KIND[current.kind] || 'Ask', round: n, noun: 'Ask' };
  if (current.status === 'results') {
    const total = (current.results && current.results.total) || current.answerCount || 0;
    const meter = { heading: 'Answered', count: total, of: here };
    const w = current.wheel;
    if (isPointsVote(current) && !w && !current.revotedAs) {
      // A VOTE MADE FROM POINTS (T6): the same three moves as the Host, Send as the main button.
      const rows = pointVoteRows(current, room);
      const live = rows.filter(rowIsLive);
      if (!live.length) return { phase: 'RESULTS', context, meter, status: W.movedForwardDone, primary: { action: 'points-close', label: W.closeThisVote } };
      const n = highlightOf(current, room, highlight).length;
      return {
        phase: 'RESULTS', context, meter, pointsVote: true,
        status: `${W.moveForward} \u00b7 ${W.nHighlighted(n)}`,
        primary: { action: 'points-send', label: sendHighlighted(n), disabled: n < 1 },
        secondary: { action: 'points-run', label: W.workInTurn, disabled: n < 2 },
        extras: [{ action: 'points-later', label: W.saveRest }],
      };
    }
    const change = { action: 'edit', label: W.change };
    if (w && !current.revotedAs) {
      // THE WHEEL (owner, 2026-10-05): the host can always spin; a person in
      // the room may have the turn. Landed, the pick goes in one press, as on
      // the Host (B3b); until then Change before sending opens the window.
      // Where it landed is not said while the wheel still turns (the projector would give it away).
      const landedPick = w.landed ? decisionChoices(current).find((c) => c.id === w.landed) : null;
      const status = w.landed
        ? (turning ? 'The wheel is turning' : `The wheel landed${landedPick && landedPick.label ? ` on ${landedPick.label}` : ''}`)
        : w.spinner && w.armed ? `${w.spinner} spins the wheel` : W.spin;
      if (w.landed && turning) {
        return {
          phase: 'RESULTS', context, meter, status, wheel: true,
          primary: { action: 'noop', label: 'The wheel is turning…', disabled: true },
          secondary: { action: 'spin', label: W.spinAgain, disabled: true },
        };
      }
      const landedSend = w.landed ? stageSend(current, draft) : null;
      if (landedSend) {
        return {
          phase: 'RESULTS', context, meter, status, wheel: true,
          primary: landedSend, secondary: { action: 'spin', label: W.spinAgain },
        };
      }
      return {
        phase: 'RESULTS', context, meter, status, wheel: true,
        primary: { action: 'spin', label: w.landed ? W.spinAgain : W.spin },
        secondary: change,
      };
    }
    // DECIDING ON THE STAGE (owner, 2026-10-08): the same words and the same
    // press as the Host's Settle row (B3). A tie, or no votes, has nothing to
    // send: Spin the wheel leads, as on the Host, with Change before sending
    // beside it. A rating nobody gave is reopened, as on the Host.
    const status = resultsLine(current);
    const send = stageSend(current, draft);
    if (current.kind === 'rating') {
      return send
        ? { phase: 'RESULTS', context, meter, status, primary: send, secondary: change }
        : { phase: 'RESULTS', context, meter, status, primary: { action: 'reopen', label: 'Reopen' } };
    }
    if (send) return { phase: 'RESULTS', context, meter, status, primary: send, secondary: change };
    if (decisionChoices(current).length && !current.revotedAs) {
      return { phase: 'RESULTS', context, meter, status, primary: { action: 'wheel', label: W.spin }, secondary: change };
    }
    return { phase: 'RESULTS', context, meter, status, primary: change };
  }
  // THE WHEEL INSTEAD OF A VOTE (owner, 2026-10-06): wherever the room could
  // vote between options, the host may let the wheel pick instead.
  const instead = { action: 'wheel', label: W.spin };
  if (current.status === 'voting') {
    const voted = current.voteCount || 0;
    return { phase: 'VOTE', context, meter: { heading: 'Voted', count: voted, of: here }, status: `${voted} of ${here} voted`, primary: { action: 'close', label: W.showResults }, secondary: instead };
  }
  const answered = current.answerCount || 0;
  if (current.kind === 'suggest') {
    return {
      phase: 'ASK', context, meter: { heading: 'Ideas', count: answered, of: null }, status: `${answered} ${answered === 1 ? 'idea' : 'ideas'}`,
      primary: { action: 'vote', label: W.openVoting }, ...(answered >= 2 ? { secondary: instead } : {}),
    };
  }
  return {
    phase: 'ASK', context, meter: { heading: 'Answered', count: answered, of: here }, status: `${answered} of ${here} answered`,
    primary: { action: 'close', label: W.showResults }, ...(current.kind === 'choice' ? { secondary: instead } : {}),
  };
}

// ── Deciding (owner, 2026-10-06) ────────────────────────────────────────────
//
// "When the host decides, by default the winning vote is the button, and it
// takes you to the direction for Claude with the text already there; or you
// click another submission ('choose this idea instead') and the alternate
// text is in the box; and the host can change their mind and reclick one of
// the choices, and the text is swapped." These are the shared rules.

/** The options a decision can pick between: Choose options, or Ideas suggestions. */
export function decisionChoices(ask) {
  const r = (ask && ask.results) || {};
  if (ask && ask.kind === 'choice') {
    return (ask.options || []).map((o) => {
      const res = (r.options || []).find((x) => x.label === o.label) || { count: 0 };
      return { id: o.label, label: o.label, text: o.title, detail: o.detail || '', count: res.count || 0 };
    });
  }
  if (ask && ask.kind === 'suggest') {
    return (r.ranked || []).map((x) => ({ id: x.respId, label: '', text: x.text, count: x.votes || 0 }));
  }
  return [];
}

/**
 * The default pick: where the wheel landed, else the single top answer.
 * A tie (two or more sharing the top count) has no default: the host spins,
 * revotes, or picks one.
 */
export function winnerOf(ask) {
  const w = ask && ask.wheel;
  if (w && w.landed) return w.landed;
  const choices = decisionChoices(ask);
  const top = Math.max(0, ...choices.map((c) => c.count));
  if (!top) return null;
  const leaders = choices.filter((c) => c.count === top);
  return leaders.length === 1 ? leaders[0].id : null;
}

/**
 * WHAT CLAUDE IS TOLD IS THE QUESTION AND THE ANSWER (owner, 2026-10-06):
 * "What should the background color be: blue". The same on the server
 * (build-store.js questionAnswer).
 */
export const questionOf = (prompt) => String(prompt || '').trim().replace(/[\s?]+$/, '');
export const questionAnswer = (prompt, answer) => (answer ? `${questionOf(prompt)}: ${answer}` : '');
/**
 * WHAT THE ROOM VOTED ON, IN FULL (owner, 2026-10-10: "we only pass the title.
 * it also needs the details or examples since thats what was voted on"). An
 * option's detail travels with its title into the direction Claude builds from.
 */
export const optionAnswer = (title, detail) => {
  const t = String(title || '').trim();
  const d = String(detail || '').trim();
  return d ? `${t} (${d})` : t;
};
const optionDetail = (ask, labelOrTitle) => {
  const o = ((ask && ask.options) || []).find((x) => x.label === labelOrTitle || x.title === labelOrTitle);
  return o ? o.detail || '' : '';
};

/**
 * Every Rate ask uses one fixed scale (owner, 2026-10-06), the server's
 * RATING_SCALE: 1 needs work, 5 is great. A rating sent to Claude carries that
 * meaning in its own words, so "4 out of 5" can never be misread.
 */
export const RATING_SCALE = Object.freeze({ min: 1, max: 5, lowLabel: 'Needs work', highLabel: 'Great' });
export const RATING_MEANING = '(5 is great, 1 needs work)';
export const ratingAnswer = (n) => (n === null || n === undefined || n === '' ? '' : `${n} out of 5 ${RATING_MEANING}`);
/** "1 · Needs work", "3", "5 · Great". */
export const ratingStep = (n) => (n === 1 ? `1 · ${RATING_SCALE.lowLabel}` : n === 5 ? `5 · ${RATING_SCALE.highLabel}` : String(n));

/** The sentence Claude gets for a pick, however it was picked. */
export function directionFor(ask, id) {
  const pick = decisionChoices(ask).find((c) => c.id === id);
  return pick ? questionAnswer(ask.prompt, optionAnswer(pick.text, pick.detail)) : '';
}

/** How a decision was made, for the record; never sent to Claude. */
export function decisionMethod(ask, chosen, spoken) {
  if (spoken) return 'spoken';
  const w = ask && ask.wheel;
  if (w && w.landed && chosen.length === 1 && chosen[0] === w.landed) return 'wheel';
  const win = winnerOf(ask);
  if (!chosen.length || (win && chosen.length === 1 && chosen[0] === win)) return 'vote';
  return 'host';
}
/**
 * THE HOST PICKS, AND IS TOLD WHAT THAT MEANS (owner, 2026-10-06: "click on
 * one and it asks if you want to pick the preferred choice of the room ... or
 * an alternate one (not the room's preference); same goes for spin").
 * `{ isPreferred, preferred: {id, label, text, count}|null, by: 'wheel'|'vote'|null,
 *    tied: [labels], total, pick: {id, label, text, count} }`
 */
export function pickVerdict(ask, id) {
  const choices = decisionChoices(ask);
  const pick = choices.find((c) => c.id === id) || null;
  const w = ask && ask.wheel;
  const total = (ask && ask.results && ask.results.total) || choices.reduce((n, c) => n + c.count, 0);
  if (w && w.landed) {
    const landed = choices.find((c) => c.id === w.landed) || null;
    return { pick, preferred: landed, by: 'wheel', tied: [], total, isPreferred: Boolean(landed && landed.id === id) };
  }
  const top = Math.max(0, ...choices.map((c) => c.count));
  const leaders = top ? choices.filter((c) => c.count === top) : [];
  if (leaders.length === 1) {
    return { pick, preferred: leaders[0], by: 'vote', tied: [], total, isPreferred: leaders[0].id === id };
  }
  return { pick, preferred: null, by: null, tied: leaders.map((c) => c.label || c.text), total, isPreferred: false };
}

/** The direction the decide panel starts with: the room's top answer, as a sentence. */
export function defaultDirection(ask) {
  // The question and the answer (owner, 2026-10-06).
  const w = ask && ask.wheel;
  const landed = w && w.landed ? (w.slices || []).find((x) => x.id === w.landed) : null;
  if (landed) return questionAnswer(ask.prompt, ask.kind === 'choice' ? optionAnswer(landed.text, optionDetail(ask, landed.label || landed.id)) : landed.text);
  const r = (ask && ask.results) || {};
  if (ask.kind === 'choice') {
    const top = [...(r.options || [])].sort((a, b) => b.count - a.count)[0];
    return top && top.count ? questionAnswer(ask.prompt, optionAnswer(top.title, optionDetail(ask, top.label))) : '';
  }
  if (ask.kind === 'rating') {
    return r.rating && r.rating.avg !== null && r.rating.avg !== undefined
      ? questionAnswer(ask.prompt, ratingAnswer(r.rating.avg)) : '';
  }
  const top = (r.ranked || [])[0];
  return top ? questionAnswer(ask.prompt, top.text) : '';
}

/**
 * The room's choice and the sentence for it. A tie, or no votes, has no choice:
 * nothing picked and no sentence until the host picks one. A rating has no
 * options to pick; its sentence is the average.
 */
export function roomChoice(ask) {
  if (ask && ask.kind === 'rating') return { chosen: [], direction: defaultDirection(ask) };
  const win = winnerOf(ask);
  return win ? { chosen: [win], direction: directionFor(ask, win) } : { chosen: [], direction: '' };
}

/** How a decision goes to Claude when the host does not choose: the set's kind, else Keep in mind for an opening step, else Do now. The server's rule (build-room.js decide). */
export const defaultKind = (ask) => (ask && ask.claudeGets) || (ask && ask.openingStep ? 'keep' : 'do-now');

/**
 * THE BODY OF A DECISION, one builder for every place that decides (the Host
 * screen's panel, the Stage's Send and its Change before sending window). `as` goes only
 * when it differs from the question's own kind: the server's default.
 */
export function decideBody(ask, { direction, chosen, note = '', send = true, as, spoken = false }) {
  return {
    action: 'decide', direction: String(direction || '').trim(), chosen, note: String(note || '').trim(), sendToAgent: send, ...(spoken ? { spoken: true } : {}),
    method: decisionMethod(ask, chosen, spoken),
    // Always said when sending, so the line the host read can never disagree with the server's default.
    ...(send ? { as: as || defaultKind(ask) } : {}),
  };
}

/**
 * WHAT ONE PRESS AT SETTLE SENDS (B1b): the room's pick (or where the wheel
 * landed), its sentence, and the button that says so. Null when there is no
 * pick yet (a tie, no votes, a rating nobody gave).
 */
export function settleSend(ask) {
  if (!ask) return null;
  if (ask.kind === 'rating') {
    const r = ask.results && ask.results.rating;
    if (!r || r.avg === null || r.avg === undefined) return null;
    return { id: String(r.avg), chosen: [], direction: defaultDirection(ask), button: W.send(r.avg) };
  }
  const id = winnerOf(ask);
  if (!id) return null;
  const direction = directionFor(ask, id);
  const pick = decisionChoices(ask).find((c) => c.id === id);
  const spun = Boolean(ask.wheel && ask.wheel.landed);
  const button = pick && pick.label ? W.send(pick.label) : spun ? W.sendPlain : W.sendTopIdea;
  return { id, chosen: [id], direction, button };
}

/**
 * THE WORDS OF THE ONE SETTLE PRESS, shared by the Host's row and the Stage's
 * dock: the button (Save for later when the kind is `later`, else the pick's
 * own Send B to Claude) and the verb Space does.
 */
export function settleWords(ask, kind) {
  const move = settleSend(ask);
  const held = kind === 'later';
  return { held, label: held ? W.saveLater : (move ? move.button : W.sendPlain), verb: held ? 'save for later' : 'send' };
}

/**
 * THE ONE SETTLE PRESS (B1b, B3): what a press at Settle sends, for the Host's
 * row and the Stage's dock alike. A direction (and kind) the host already
 * changed for this very pick is what goes. Null when there is no pick yet.
 */
export function settleMove(ask, draft = null) {
  const base = settleSend(ask);
  if (!base) return null;
  const kept = draft && !draft.spoken && draft.pickId === base.id && String(draft.direction || '').trim() ? draft : null;
  const kind = kept && kept.as ? kept.as : defaultKind(ask);
  const { held, label, verb } = settleWords(ask, kind);
  return {
    id: base.id, kind, held, label, verb,
    direction: kept ? String(kept.direction).trim() : base.direction,
    chosen: kept ? (kept.chosen || base.chosen) : base.chosen,
  };
}

export const METHOD_WORDS = Object.freeze({ vote: 'by vote', wheel: 'by the wheel', host: "the host's pick", spoken: 'said out loud' });

/**
 * What Claude has not heard yet: every entry meant for Claude that its
 * plugin has not collected (the server's pendingDirections, as the host sees
 * it). A host note never goes to Claude.
 */
export const unheard = (room) => ((room && room.log) || []).filter((l) => l.forAgent && !l.deliveredAt && l.kind !== 'note');

/**
 * Claude Code has stopped (owner, 2026-10-06): it connected once and is now
 * neither working nor listening. Anything sent waits until the host runs
 * /engage:continue in Claude Code, so the host must be told.
 */
export const agentStopped = (agent) => Boolean(agent && agent.lastSeenAt && !agent.connected && !agent.listening);

/**
 * WHAT CLAUDE GETS (step 7c, C14; owner, 2026-10-05): the four kinds of
 * message, in the order the Send to Claude menu lists them. The server's
 * CLAUDE_GETS (build-store.js) holds the same keys.
 */
export const CLAUDE_KINDS = Object.freeze([
  { key: 'do-now', label: 'Do now', hint: 'Claude stops and does it.' },
  { key: 'keep', label: 'Keep in mind', hint: 'A standing rule. Claude keeps going.' },
  // Held, not sent (owner, 2026-10-06: "only when I send it").
  { key: 'later', label: W.later, hint: 'Claude hears nothing yet.' },
  { key: 'ask', label: 'Ask Claude', hint: 'Claude answers and keeps building.' },
]);
/** The kinds the host may choose: Later is a list, never a way Claude takes a direction. */
export const HOST_KINDS = Object.freeze(CLAUDE_KINDS.filter((k) => k.key !== 'later'));
export const claudeKindLabel = (key) => (CLAUDE_KINDS.find((k) => k.key === key) || CLAUDE_KINDS[0]).label;
/** The body field for a kind: Do now is the default, so it sends nothing. */
export const asField = (key) => (key && key !== 'do-now' ? { as: key } : {});

/* ------------------------------------------------------------- history -- */

/**
 * THE ROOM'S STORY (step 5, C9 and C11): what Claude showed, what the room
 * decided and how, what the room said, and the pictures, newest first. One
 * model for the History screen the room sees on the wall and the History tab
 * on every phone and laptop. Built from what each already has: the host's
 * view carries `asks`; a phone's carries `decisions` and its own ideas.
 *
 * Item: `{ id, at, type, heading, text, askId?, imageIds[], link?, chain[], mine? }`
 *   type  showed | decided | said | milestone | picture | wrapped
 */
const STORY_GAP_MS = 2 * 60 * 1000;
const t = (iso) => Date.parse(iso || '') || 0;
const askNo = (askId) => Number(askId) || askId;

/** How a decided ask came to be decided, in a few words each (host only). */
export function decisionChain(ask) {
  if (!ask || !ask.decision) return [];
  const d = ask.decision;
  const chain = [];
  if (ask.fromIdeas && ask.fromIdeas.length) chain.push(ask.fromIdeas.length === 1 ? 'an idea from the room' : `${ask.fromIdeas.length} ideas from the room`);
  else if (ask.fromQuestion) chain.push('a ready question');
  else if (ask.source === 'agent') chain.push('Claude asked');
  const r = ask.results || {};
  const method = d.method || (d.spoken ? 'spoken' : 'vote');
  if (method === 'wheel') chain.push('the wheel picked it');
  else if (method === 'spoken') chain.push('said out loud');
  else if (method === 'host') chain.push("the host's pick");
  else if (ask.kind === 'rating' && r.rating && r.rating.avg !== null && r.rating.avg !== undefined) chain.push(`rated ${r.rating.avg} of 5 by ${r.rating.count}`);
  else if (ask.kind === 'choice' && Array.isArray(r.options)) {
    const pick = r.options.find((o) => (d.chosen || []).includes(o.label));
    if (pick && r.total) chain.push(`${pick.count} of ${r.total} picked it`);
  } else if (ask.kind === 'suggest' && Array.isArray(r.ranked)) {
    const pick = r.ranked.find((x) => (d.chosen || []).includes(x.respId));
    if (pick && pick.votes) chain.push(`${pick.votes} voted for it`);
  }
  if (d.sentToAgent === false) chain.push('recorded only');
  else if (d.heldForLater) chain.push('for Claude, later');
  else chain.push(d.deliveredAt ? 'Claude has it' : 'waiting for Claude');
  return chain;
}

export function roomStory({ log = [], asks = null, decisions = null, images = [], myIdeas = [], doing = null } = {}) {
  const items = [];
  const imgById = new Map((images || []).map((im) => [im.imageId, im]));
  // A picture shared within two minutes after Claude showed something belongs to it.
  const showings = [];
  for (const e of log || []) {
    if (e.kind === 'showing') {
      const it = { id: e.logId, at: e.createdAt, type: 'showed', heading: 'Claude showed', text: e.text, link: e.link || '', imageIds: [], chain: [] };
      items.push(it);
      showings.push(it);
    } else if (e.kind === 'verbal') {
      items.push({ id: e.logId, at: e.createdAt, type: 'said', heading: 'The room said', text: e.text, imageIds: [], chain: [] });
    } else if (e.kind === 'milestone') {
      items.push({ id: e.logId, at: e.createdAt, type: 'milestone', heading: 'Milestone', text: e.text, imageIds: [], chain: [] });
    } else if (e.kind === 'outcome') {
      items.push({ id: e.logId, at: e.createdAt, type: 'wrapped', heading: 'Wrapped up', text: e.detail || e.text, imageIds: [], chain: [] });
    }
  }
  for (const e of log || []) {
    if (e.kind !== 'image' || !e.detail) continue;
    const im = imgById.get(e.detail);
    if (im && im.askId) continue; // a mockup belongs to its ask's decision
    const near = showings.filter((s) => t(e.createdAt) >= t(s.at) && t(e.createdAt) - t(s.at) <= STORY_GAP_MS).pop();
    if (near) near.imageIds.push(e.detail);
    else items.push({ id: e.logId, at: e.createdAt, type: 'picture', heading: im && im.kind === 'final' ? 'The finished product' : 'Picture', text: e.text, imageIds: [e.detail], chain: [] });
  }
  const decided = asks
    ? asks.filter((a) => a.status === 'decided' && a.decision).map((a) => ({ askId: a.askId, direction: a.decision.direction, at: a.decision.decidedAt || a.decidedAt, ask: a }))
    : (decisions || []).map((d) => ({ askId: d.askId, direction: d.direction, at: d.decidedAt }));
  for (const d of decided) {
    const mockups = (images || []).filter((im) => im.askId === d.askId && im.label);
    const chosen = d.ask ? (d.ask.decision.chosen || []) : [];
    const shown = chosen.length ? mockups.filter((im) => chosen.includes(im.label)).concat(mockups.filter((im) => !chosen.includes(im.label))) : mockups;
    items.push({
      id: `decided:${d.askId}`, at: d.at, type: 'decided', heading: `Decided · Ask ${askNo(d.askId)}`, text: d.direction || '',
      askId: d.askId, imageIds: shown.map((im) => im.imageId), chosenLabels: chosen,
      chain: d.ask ? decisionChain(d.ask) : [],
      mine: (myIdeas || []).some((i) => i.promotedTo === d.askId),
    });
  }
  // A FINISHED STEP (docs/design/build-room-doing D4) is one entry; what Claude
  // posted while it ran hangs under it, oldest first. Commands never come here.
  const steps = (log || []).filter((e) => e.kind === 'step' && e.step).map((e) => ({
    id: e.logId, at: e.step.startedAt || e.createdAt, type: 'step', heading: e.text, text: '', imageIds: [], chain: [], kids: [],
    dur: stepDur(e.step.durationMs), endAt: e.step.endedAt || e.createdAt,
  }));
  const live = doing && doing.text && !doing.stale && Number.isFinite(t(doing.startedAt))
    ? { id: 'step:now', at: doing.startedAt, type: 'step', now: true, heading: upperFirst(doing.text), text: '', imageIds: [], chain: [], kids: [], dur: W.soFar(doing.dur), endAt: null }
    : null;
  const loose = [];
  for (const it of items) {
    const home = steps.find((st) => t(it.at) >= t(st.at) && t(it.at) <= t(st.endAt));
    if (home) home.kids.push(it);
    else if (live && t(it.at) >= t(live.at)) live.kids.push(it);
    else loose.push(it);
  }
  for (const st of live ? [...steps, live] : steps) st.kids.sort((a, b) => t(a.at) - t(b.at));
  return [...(live ? [live] : []), ...[...loose, ...steps].sort((a, b) => t(b.at) - t(a.at))];
}

/** A step's length for History: '' when unknown, 'under 1 min', else 'N min'. */
function stepDur(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '';
  return n < 60000 ? 'under 1 min' : `${Math.floor(n / 60000)} min`;
}

export const STORY_FILTERS = Object.freeze([
  { key: 'all', label: 'Everything' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'pictures', label: 'Pictures' },
]);
// A step holds its own decisions and pictures: the filters look inside.
const flatStory = (items) => items.flatMap((i) => (i.type === 'step' ? i.kids : [i]));
export const filterStory = (items, key) => (key === 'decisions' ? flatStory(items).filter((i) => i.type === 'decided') : key === 'pictures' ? flatStory(items).filter((i) => i.imageIds.length) : items);

/** Every picture, newest first, each saying what it was for (C10). */
export function artifactsOf({ images = [], asks = [] } = {}) {
  const askById = new Map((asks || []).map((a) => [a.askId, a]));
  return (images || []).slice().sort((a, b) => t(b.createdAt) - t(a.createdAt)).map((im) => {
    const ask = im.askId ? askById.get(im.askId) : null;
    const chosen = Boolean(ask && ask.decision && (ask.decision.chosen || []).includes(im.label));
    const who = im.by === 'agent' ? 'Claude' : im.by === 'builder' ? 'A builder' : 'The host';
    const what = im.askId ? `Ask ${askNo(im.askId)} mockup${chosen ? ' · chosen' : ''}` : im.kind === 'final' ? 'the finished product' : 'progress';
    return { ...im, title: im.caption || (im.label ? `Choice ${im.label}` : 'A screenshot'), meta: `${who} · ${what}`, chosen };
  });
}

// ── THE HOST'S PATH (owner, 2026-10-07; docs/design/build-room-host-flow) ──
// Every ask runs Ask, Collect, Settle, Send to Claude. The step decides which
// button has focus; the summaries are what a folded step says.

// h:mm in the host's locale (same format as the page's clockTime; kept here so
// this file never imports the page).
const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function askPathStep(ask, { pickId = null, answering = false } = {}) {
  if (!ask) return 'collect';
  if (answering) return 'send';
  if (['live', 'voting'].includes(ask.status)) return 'collect';
  // A landed wheel is still Settle (H3): the host goes with it, or spins again.
  if (pickId) return 'send';
  return 'settle';
}

const countOf = (ask, label) => {
  const o = ((ask.results && ask.results.options) || []).find((x) => x.label === label);
  return o ? Number(o.count) || 0 : 0;
};

export function askPathSummaries(ask, { pickId = null, playerCount = 0 } = {}) {
  const opened = ask.openedAt ? `Opened ${clockOf(ask.openedAt)}` : 'Opened';
  const total = (ask.results && ask.results.total) || 0;
  const verb = ask.kind === 'suggest' ? 'answered' : ask.kind === 'rating' ? 'rated' : 'voted';
  const collect = `${total} of ${Math.max(Number(playerCount) || 0, total)} ${verb}`;
  const wheel = ask.wheel && ask.wheel.landed;
  const leader = winnerOf({ ...ask, wheel: null }); // a unique vote leader only
  let settle = '';
  if (wheel) {
    settle = !pickId || pickId === wheel ? `The wheel picked ${wheel}` : `${pickId} \u00b7 your pick, not the wheel's ${wheel}`;
  } else if (pickId) {
    if (!leader) settle = `${pickId} \u00b7 your pick`;
    else if (pickId === leader) {
      const others = ((ask.results && ask.results.options) || []).filter((o) => o.label !== pickId).map((o) => Number(o.count) || 0);
      settle = `${pickId} \u00b7 the room's choice, ${countOf(ask, pickId)} to ${others.length ? Math.max(...others) : 0}`;
    } else settle = `${pickId} \u00b7 your pick, not ${leader}`;
  }
  return { ask: opened, collect, settle };
}

/** The most ideas one vote takes. */
export const VOTE_IDEAS_MAX = 6;

export function whatsNextMoves(room, { ticked = 0, laterTicked = 0 } = {}) {
  const ideas = ((room && room.ideas) || []).filter((i) => i.status === 'new');
  const moves = [];
  // MOCKUPS TO LOOK AT (host-flow S4): the Stage says the vote is ready to open,
  // so this leads with the same move (not while the opening frames the build).
  const framing = Boolean(room && room.opening && room.opening.phase === 'opening');
  const looks = room && !framing && !(room.outcome && room.outcome.summary) ? mockupsReady(room) : null;
  if (looks) {
    moves.push({
      key: 'vote-mockups', askId: looks.ask.askId, title: "Open voting on Claude's mockups",
      hint: `${lettersLine(looks.images.map((i) => i.label))} ${looks.images.length === 1 ? 'is' : 'are'} ready`, button: W.openVoting,
    });
  }
  // CLAUDE'S OWN QUESTION is waiting to be opened (not one still waiting on its mockups).
  const waiting = room && !framing && !(room.outcome && room.outcome.summary)
    ? ((room.asks || []).find((a) => a.status === 'proposed' && !(looks && a.askId === looks.ask.askId) && !(a.mockups && !a.mockups.ready)) || null) : null;
  if (waiting) {
    moves.push({ key: 'open-proposed', askId: waiting.askId, title: "Open Claude's question", hint: String(waiting.prompt || '').slice(0, 80), button: 'Open it' });
  }
  if (ideas.length >= 2) {
    // The dialog takes six at most; the title says what it will do.
    const n = Math.min(ideas.length, VOTE_IDEAS_MAX);
    moves.push({
      key: 'vote-ideas', count: n, title: `Put ${n} ideas to a vote`,
      hint: ideas.length > n ? `${n} of ${ideas.length} waiting` : '', button: 'To a vote',
    });
  }
  if (ticked > 0) moves.push({ key: 'combine', count: ticked, title: `Combine ${ticked} decided ${ticked === 1 ? 'answer' : 'answers'}`, hint: 'One prompt, yours to edit', button: 'Combine' });
  // One move for both (copy pass 2026-10-10): the window opens with the cursor in the question and the starters beside it.
  moves.push({ key: 'ask-room', title: W.askRoom, hint: W.askRoomHint, button: W.askRoomButton });
  moves.push({ key: 'tell', title: 'Tell Claude', hint: 'Do now, keep in mind, or ask Claude', button: 'Write' });
  // THREE OR MORE NEW POINTS (talking points T1): a way to talk while Claude builds. Never the lead.
  const newPoints = ((room && room.points && room.points.items) || []).filter((p) => p.status === 'new').length;
  if (newPoints >= 3 && !room.shownPoint) {
    moves.push({ key: 'talk-points', title: 'Talk over a point', hint: 'Tick one in Points', button: W.points });
  }
  // Nothing runs without Claude: with none connected, that is the first move.
  if (room && room.agent && !room.agent.key && !room.agent.connected && !framing) {
    moves.unshift({ key: 'connect', title: 'Connect Claude Code', hint: 'Nothing is built without it', button: 'Connect' });
  }
  // TICKED ON THE LATER LIST: the host chose these, so this leads (2 to 6 fit a vote).
  // It deliberately jumps ahead of Connect: ticking is a choice made just now.
  if (laterTicked >= 2 && laterTicked <= VOTE_IDEAS_MAX) {
    moves.unshift({ key: 'vote-later', count: laterTicked, title: `Put ${laterTicked} from Later to a vote`, hint: 'The room picks one', button: W.openVoting });
  }
  return moves;
}

export function combineLine(ask) {
  const prompt = String(ask.prompt || '').trim();
  const q = questionOf(prompt);
  const d = String((ask.decision && ask.decision.direction) || '').trim();
  const answer = d.toLowerCase().startsWith(`${q.toLowerCase()}:`) ? d.slice(q.length + 1).trim() : d;
  if (!answer) return prompt;
  return /[?:]$/.test(prompt) ? `${prompt} ${answer}` : `${prompt}: ${answer}`;
}

export function combineText(asks) {
  return [...(asks || [])]
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)))
    .map(combineLine)
    .join('\n');
}

export function mockupsReady(room) {
  const ask = ((room && room.asks) || []).find((a) => a.kind === 'choice' && a.status === 'proposed'
    && (a.options || []).length >= 2 && (a.options || []).every((o) => o.imageId));
  return ask ? { ask, images: ask.options.map((o) => ({ label: o.label, imageId: o.imageId, title: o.title || '' })) } : null;
}

const LOOK_COUNTS = { 2: 'Two', 3: '3', 4: '4', 5: '5', 6: '6' };

/** "A and B", "A, B and C": the letters Claude made looks for. */
export function lettersLine(labels) {
  const l = (labels || []).filter(Boolean);
  return l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

/** The idle stage's words when mockups are ready (S4). */
export function looksWords(images) {
  const n = (images || []).length;
  return {
    headline: `${LOOK_COUNTS[n] || n} looks to compare`,
    line: `Claude made ${lettersLine((images || []).map((i) => i.label))}.`,
    next: 'Voting opens next',
  };
}


// ── Talking points (docs/design/build-room-talking-points) ──────────────────

/** The most points open at once, and the most a vote takes (the server's own limits). */
export const POINTS_OPEN_MAX = 40;
export const VOTE_POINTS_MAX = 8;
/** A point the host can still act on: it has not been sent, saved, voted or removed. */
export const POINT_OPEN = Object.freeze(['new', 'shown', 'queued']);

/** hostView.points, with its defaults. Null when the server sent none (an older room). */
export function pointsOf(room) {
  const p = room && room.points;
  if (!p) return null;
  return { items: p.items || [], requests: p.requests || [], open: Number(p.open) || 0 };
}

/**
 * The point on the Stage with its id. The room-safe shownPoint carries no id
 * (server fix round 1); the host's own Points list does, so join them there.
 */
export function shownPointOf(room) {
  const p = room && room.shownPoint;
  if (!p) return null;
  const mine = ((room.points && room.points.items) || []).find((x) => x.status === 'shown');
  return { ...p, id: p.id || (mine ? mine.id : null) };
}

/** The ideas the room sent about the point on the Stage, not yet dismissed. */
export function shownPointIdeas(room) {
  const p = shownPointOf(room);
  if (!p || !p.id) return [];
  return (room.ideas || []).filter((i) => i.aboutPoint === p.id && i.status !== 'dismissed');
}

/** The ideas to offer a vote on when the point comes down: the ones still new. */
export const takeDownIdeas = (room) => shownPointIdeas(room).filter((i) => i.status === 'new');

/** Who a point is from, as the host reads it: "Claude" or "Priya's Claude". */
export const pointFrom = (p) => (p.fromBuilder ? W.claudeOf(p.by) : 'Claude');
/** "From Claude's research" / "From Claude" / "From Priya's Claude": the Stage's line. */
export function stageFrom(p) {
  if (p.from && p.from !== 'claude') return W.fromBuilderClaude(p.from);
  return p.kind === 'finding' ? W.fromResearch : W.fromClaude;
}

export const POINT_TAGS = Object.freeze({ talk: W.tagTalk, finding: W.tagFinding, idea: W.tagIdea });

/** A used point says so: "On the Stage", "In the vote", "Sent to Claude", "Saved for later". */
export function pointNote(p) {
  return W.pointNotes[p.status] || '';
}

/** The noun a group counts, singular: finding, idea or point (a mixed group counts points). */
function nounFor(kinds) {
  const k = kinds.length === 1 ? kinds[0] : 'talk';
  return { finding: 'finding', idea: 'idea', talk: 'point' }[k];
}
const counted = (n, noun) => (n === 1 ? noun : `${noun}s`);

/**
 * The panel's groups: one request, one milestone or one builder's post is one
 * group, newest first. `{ key, heading, by, at, points, noun }`.
 */
export function pointGroups(room) {
  const pts = pointsOf(room);
  if (!pts) return [];
  const reqs = new Map(pts.requests.map((r) => [r.id, r]));
  const groups = new Map();
  for (const p of pts.items) {
    const key = p.requestId || p.batchId || `solo:${p.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const first = list[0];
    const req = first.requestId ? reqs.get(first.requestId) : null;
    const n = list.length;
    const noun = nounFor([...new Set(list.map((x) => x.kind))]);
    let label;
    if (req) label = req.kind === 'ideas' ? W.groupIdeas(req.subject) : W.groupResearch(req.subject);
    else if (first.fromBuilder) label = pointFrom(first);
    else label = first.about ? W.fromStep(first.about) : W.fromClaude;
    out.push({
      key,
      heading: `${label} · ${n} ${counted(n, noun)}${!req && first.fromBuilder && first.about ? W.forAbout(first.about) : ''}`,
      by: pointFrom(first),
      at: list[list.length - 1].createdAt,
      points: list,
      noun,
    });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ── The vote from points, the highlight, the run list (talking points T5 to T7) ──

/** Picks per person in a points vote: 1 to 5. */
export const VOTE_PICKS_MAX = 5;
/** The window opens on 3 picks, or one fewer than the options when that is smaller. */
export const defaultPicks = (n) => Math.max(1, Math.min(3, n - 1));
/** A vote the host made from ticked points. */
export const isPointsVote = (ask) => Boolean(ask && Array.isArray(ask.fromPoints) && ask.fromPoints.length);

/**
 * The rows of a points vote, most votes first (ties keep the options' order).
 * Each carries its point, so the page knows what is still the host's to move.
 */
export function pointVoteRows(ask, room) {
  const byId = new Map((((room && room.points && room.points.items) || [])).map((p) => [p.id, p]));
  const counts = (ask && ask.results && ask.results.options) || [];
  // A point waiting its turn in a list that runs cannot be moved again from here.
  const waiting = new Set(room && room.run && room.run.status === 'running' ? room.run.items.filter((x) => x.state === 'pending').map((x) => x.pointId) : []);
  return ((ask && ask.options) || []).map((o, index) => {
    const point = byId.get(o.pointId) || null;
    const r = counts.find((x) => x.label === o.label) || { count: 0 };
    return { label: o.label, pointId: o.pointId || null, text: (point && point.text) || o.detail || o.title, count: r.count || 0, point, index, inRun: waiting.has(o.pointId) };
  }).sort((a, b) => b.count - a.count || a.index - b.index);
}

/** A voted point the host can still move forward: it is in the vote or already highlighted. */
export const rowIsLive = (row) => Boolean(row.point) && !row.inRun && ['voting', 'queued'].includes(row.point.status);

/**
 * The top three by votes, and a tie at the cut highlights every tied row.
 * Rows nobody picked are never highlighted by default.
 */
export function defaultHighlight(rows) {
  const ranked = rows.filter((r) => rowIsLive(r) && r.count > 0);
  if (!ranked.length) return [];
  const cut = ranked[Math.min(2, ranked.length - 1)].count;
  return ranked.filter((r) => r.count >= cut).map((r) => r.label);
}

/** The labels highlighted now: the host's own choice if they made one, else the default. */
export function highlightOf(ask, room, override) {
  const rows = pointVoteRows(ask, room);
  const live = new Set(rows.filter(rowIsLive).map((r) => r.label));
  const base = Array.isArray(override) ? override : defaultHighlight(rows);
  return rows.filter((r) => live.has(r.label) && base.includes(r.label)).map((r) => r.label);
}

/** A tie at the cut: the rows past the third that share its count (empty when there is none). */
export function tiedAtCut(rows) {
  const ranked = rows.filter((r) => rowIsLive(r) && r.count > 0);
  if (ranked.length <= 3) return [];
  const cut = ranked[2].count;
  const tied = ranked.filter((r) => r.count === cut);
  return tied.length > 1 && ranked[3].count === cut ? tied : [];
}

/** The ids of the highlighted rows, in vote order: what the server is told. */
export function highlightedPointIds(ask, room, override) {
  const on = new Set(highlightOf(ask, room, override));
  return pointVoteRows(ask, room).filter((r) => on.has(r.label)).map((r) => r.pointId).filter(Boolean);
}

/** The run list as the host's page holds it: null when there is none. */
export const runOf = (room) => (room && room.run) || null;
export const runRunning = (room) => Boolean(room && room.run && room.run.status === 'running');
export const runDoneCount = (run) => (run ? run.items.filter((x) => x.state === 'done').length : 0);
/** The next item to send, or null when this is the last. */
export function runNextItem(run) {
  if (!run || !run.next) return null;
  return run.items.find((x) => x.k === run.next) || null;
}
/** The item Claude is on (sent, not yet reported), or null. */
export function runCurrentItem(run) {
  if (!run) return null;
  return run.items.find((x) => x.k === run.cur) || null;
}
/** "Send these 3 to Claude", or "Send to Claude" for one. */
export const sendHighlighted = (n) => (n === 1 ? W.sendPlain : W.sendThese(n));

/** What Research… and Ideas… start with: the open ask's question, else Claude's last step, else nothing. */
export function defaultSubject(room) {
  const cur = ((room && room.asks) || []).find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status));
  if (cur && cur.prompt) return String(cur.prompt).trim().slice(0, 200);
  const step = [...((room && room.log) || [])].reverse().find((l) => l.by === 'agent' && ['milestone', 'progress'].includes(l.kind) && l.text);
  return step ? String(step.text).trim().slice(0, 200) : '';
}


/**
 * WHAT THE NOW AREA SHOWS BETWEEN ASKS, derived once for the page and for
 * NowBuilding: the opening just over (`framed`), the starter question
 * (`starter`) and What's next (`whatsNext`). The page adds its own conditions
 * (an ask open, the crew board) and NowBuilding its callbacks.
 */
export function nowFlags(room) {
  const ended = Boolean(room && room.state === 'ENDED');
  const asks = (room && room.asks) || [];
  const opening = (room && room.opening) || null;
  const noBuildingAsk = !asks.some((x) => !x.openingStep);
  const framed = Boolean(opening && opening.phase === 'building')
    && (opening.steps || []).some((x) => ['done', 'skipped'].includes(x.status)) && noBuildingAsk;
  const starter = !ended && !framed && noBuildingAsk;
  const wrapped = Boolean(room && room.outcome && room.outcome.summary);
  return { framed, starter, whatsNext: !ended && !starter && !wrapped };
}
