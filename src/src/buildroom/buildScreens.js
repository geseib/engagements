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

const STAGE_KIND = Object.freeze({ suggest: 'Ideas', choice: 'Choose', rating: 'Rate' });

/**
 * THE STAGE SCREEN, as the regular host stage draws it (Rail, RoomMeter,
 * Dock: components/stage/). Everything here is room-safe: a phase, a count,
 * one sentence. `primary` is the dock's one move, the same key (Space) and
 * place as Start Voting on the regular stage; deciding needs words, so at
 * results the move is back to the Host screen.
 */
export function stageModel(room, current) {
  const here = (room && room.playerCount) || 0;
  const ended = Boolean(room && room.state === 'ENDED');
  if (ended) {
    return { phase: 'ENDED', context: { category: 'Build Room' }, meter: { heading: 'Took part', count: here, of: null }, status: 'This session has ended.', primary: null };
  }
  if (!current) {
    const agent = (room && room.agent) || {};
    const status = room && room.outcome && room.outcome.summary ? 'Here is what we built.'
      : agent.connected || agent.listening ? 'Claude is building. Send an idea from your phone any time.'
        : 'Waiting for Claude Code.';
    return { phase: null, context: { category: 'Build Room' }, meter: { heading: 'In the room', count: here, of: null }, status, primary: null };
  }
  const n = Number(current.askId) || current.askId;
  const context = { category: STAGE_KIND[current.kind] || 'Ask', round: n, noun: 'Ask' };
  if (current.status === 'results') {
    const total = (current.results && current.results.total) || current.answerCount || 0;
    const meter = { heading: 'Answered', count: total, of: here };
    const w = current.wheel;
    if (w && !current.revotedAs) {
      // THE WHEEL (owner, 2026-10-05): the host can always spin; a person in
      // the room may have the turn. Deciding stays a step on the Host screen.
      const status = w.landed ? 'The wheel has picked'
        : w.spinner && w.armed ? `${w.spinner} spins the wheel` : 'Spin the wheel';
      return {
        phase: 'RESULTS', context, meter, status, wheel: true,
        primary: { action: 'spin', label: w.landed ? 'Spin again' : 'Spin' },
        secondary: { action: 'decide', label: 'Decide on Host' },
      };
    }
    // The winning vote is the button (owner, 2026-10-06); a tie decides on the Host.
    const win = winnerOf(current);
    const pick = win ? decisionChoices(current).find((c) => c.id === win) : null;
    const label = pick ? (pick.label ? `Go with ${pick.label}` : 'Go with the top idea') : 'Decide on Host';
    return { phase: 'RESULTS', context, meter, status: 'Results', primary: { action: 'decide', label } };
  }
  // THE WHEEL INSTEAD OF A VOTE (owner, 2026-10-06): wherever the room could
  // vote between options, the host may let the wheel pick instead.
  const instead = { action: 'wheel', label: 'Spin the wheel instead' };
  if (current.status === 'voting') {
    const voted = current.voteCount || 0;
    return { phase: 'VOTE', context, meter: { heading: 'Voted', count: voted, of: here }, status: `${voted} of ${here} have voted`, primary: { action: 'close', label: 'Close and show results' }, secondary: instead };
  }
  const answered = current.answerCount || 0;
  if (current.kind === 'suggest') {
    return {
      phase: 'ASK', context, meter: { heading: 'Ideas', count: answered, of: null }, status: `${answered} ${answered === 1 ? 'idea' : 'ideas'} so far`,
      primary: { action: 'vote', label: 'Open voting' }, ...(answered >= 2 ? { secondary: instead } : {}),
    };
  }
  return {
    phase: 'ASK', context, meter: { heading: 'Answered', count: answered, of: here }, status: `${answered} of ${here} have answered`,
    primary: { action: 'close', label: 'Close and show results' }, ...(current.kind === 'choice' ? { secondary: instead } : {}),
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
      return { id: o.label, label: o.label, text: o.title, count: res.count || 0 };
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
  return pick ? questionAnswer(ask.prompt, pick.text) : '';
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
  { key: 'do-now', label: 'Do now', hint: 'The next thing to build. Claude stops and does it.' },
  { key: 'keep', label: 'Keep in mind', hint: 'A rule or a fact for everything from now on. Goes on the brief; Claude does not stop.' },
  { key: 'later', label: 'Later', hint: "Something to build, not now. Goes on the brief's Later list." },
  { key: 'ask', label: 'Ask Claude', hint: 'A question. Claude answers on the screen and keeps building.' },
]);
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
  else chain.push(d.deliveredAt ? 'Claude has it' : 'waiting for Claude');
  return chain;
}

export function roomStory({ log = [], asks = null, decisions = null, images = [], myIdeas = [] } = {}) {
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
    else items.push({ id: e.logId, at: e.createdAt, type: 'picture', heading: im && im.kind === 'final' ? 'The finished product' : 'Claude shared a picture', text: e.text, imageIds: [e.detail], chain: [] });
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
  return items.sort((a, b) => t(b.at) - t(a.at));
}

export const STORY_FILTERS = Object.freeze([
  { key: 'all', label: 'Everything' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'pictures', label: 'Pictures' },
]);
export const filterStory = (items, key) => (key === 'decisions' ? items.filter((i) => i.type === 'decided') : key === 'pictures' ? items.filter((i) => i.imageIds.length) : items);

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
