/**
 * BUILD ROOM — the pure half (docs/design/build-room/PLAN.md).
 *
 * A Build Room is a session in which the room and the host's own Claude Code
 * build something together. Claude asks the room (Ideas / Choose / Rate), the
 * host shapes the answer and sends it back as a direction, and everything that
 * happens lands on one timeline that becomes the report.
 *
 * Everything here is a pure function of rows: validation, the ask lifecycle,
 * the tallies and the three views (host, agent, phone). build-room.js does the
 * I/O. A whole room is one `begins_with(SK,'BUILD#')` query — hundreds of rows,
 * not millions — so every view is computed in memory from the full set.
 *
 * Nothing here trusts what Claude or a phone sent: every string is trimmed and
 * capped, every URL must be http(s), and the views never carry markup.
 */
const crypto = require('crypto');

const GAME_TYPE_BUILD = 'build';

const KINDS = Object.freeze(['suggest', 'choice', 'rating']);
/**
 * Every Rate ask uses one fixed scale (owner, 2026-10-06): 1 needs work, 5 is
 * great. Hosts and Claude cannot relabel it, so a 4 always means the same
 * thing in the room, in the log and to Claude. Rows written with custom
 * labels read as this scale.
 */
const RATING_SCALE = Object.freeze({ min: 1, max: 5, lowLabel: 'Needs work', highLabel: 'Great' });
const STATUSES = Object.freeze(['proposed', 'live', 'voting', 'results', 'decided', 'discarded']);
/** Statuses in which the room is answering right now. */
const OPEN_STATUSES = Object.freeze(['live', 'voting']);

const LOG_KINDS = Object.freeze([
  'progress', 'milestone', 'showing', 'image', 'checkpoint', 'crew', 'base', 'help', 'decision', 'direction', 'verbal', 'idea', 'note', 'ask', 'outcome', 'answer',
]);
/** What Claude may post. Decisions and directions are the host's to write. `answer` answers an Ask Claude. */
const AGENT_LOG_KINDS = Object.freeze(['progress', 'milestone', 'showing', 'checkpoint', 'answer']);

/**
 * WHAT CLAUDE GETS (step 7c, C14; owner, 2026-10-05: "yes, four kinds and the
 * room brief"). Everything sent to Claude is one of four kinds:
 *   do-now  the next thing to build; Claude stops and does it (the default)
 *   keep    a rule or a fact for everything from now on; onto the brief
 *   later   something to build, not now; onto the brief's Later list
 *   ask     a question; Claude answers on the screen and keeps building
 */
const CLAUDE_GETS = Object.freeze(['do-now', 'keep', 'later', 'ask']);
const claudeGetsOf = (v, fallback = 'do-now') => {
  const k = String(v || '').trim().toLowerCase();
  return CLAUDE_GETS.includes(k) ? k : fallback;
};

/**
 * THE ROOM BRIEF (C14): who it is for, what to keep in mind, what is for
 * later. Kept on BUILD#STATE (sealed with it), shown on the host's screen,
 * sent to Claude whenever it changes and on room_status. It belongs to this
 * room, never to the project's own memory.
 */
const BRIEF_MAX_ITEMS = 30;
function briefView(state) {
  const b = (state && state.Brief) || {};
  const items = (list) => (Array.isArray(list) ? list : []).map((i) => ({ id: i.id, text: i.text || '', from: i.from || 'you', askId: i.askId || null, at: i.at || null }));
  return { forWhom: b.forWhom || '', keep: items(b.keep), later: items(b.later) };
}
/** The brief with one item added to Keep in mind or Later (newest last; capped). */
function briefWith(state, as, item) {
  const b = briefView(state);
  const list = as === 'keep' ? 'keep' : 'later';
  if (b[list].some((i) => i.text === item.text)) return b;
  b[list] = [...b[list], item].slice(-BRIEF_MAX_ITEMS);
  return b;
}
/** A host edit of the brief: `{forWhom?, keep?, later?}`, each list of `{id?, text}`. */
function normalizeBrief(state, body) {
  const b = body || {};
  const cur = briefView(state);
  const list = (v, old) => (Array.isArray(v)
    ? v.map((i) => (typeof i === 'string' ? { text: i } : (i || {})))
      .map((i) => ({ ...(old.find((o) => o.id === i.id) || {}), id: i.id || newId(), text: cleanText(i.text, LIMITS.listItem) }))
      .filter((i) => i.text).slice(0, BRIEF_MAX_ITEMS)
    : old);
  return {
    forWhom: b.forWhom !== undefined ? cleanText(b.forWhom, LIMITS.listItem) : cur.forWhom,
    keep: list(b.keep, cur.keep),
    later: list(b.later, cur.later),
  };
}
/** The brief as Claude reads it, and as the plugin writes it to .engage/brief.md. */
function briefText(brief) {
  const b = brief || { forWhom: '', keep: [], later: [] };
  if (!b.forWhom && !b.keep.length && !b.later.length) return '';
  const lines = ['THE ROOM BRIEF (the room\'s standing direction; apply it to everything you build)'];
  if (b.forWhom) lines.push(`Who it is for: ${b.forWhom}`);
  if (b.keep.length) lines.push('Keep in mind:', ...b.keep.map((i) => `  - ${i.text}`));
  if (b.later.length) lines.push('Later (not now; when you finish your current work, say which you would take next):', ...b.later.map((i) => `  - ${i.text}`));
  return lines.join('\n');
}
/** What the host may post by hand. */
const HOST_LOG_KINDS = Object.freeze(['verbal', 'note', 'milestone', 'progress']);
/** Never shown to the room, and never to Claude. */
const PRIVATE_LOG_KINDS = Object.freeze(['note']);
/** Never shown on a phone. */
const PHONE_HIDDEN_LOG_KINDS = Object.freeze(['direction']);
/** Shown on a phone without their detail (the host's note, an idea's author). */
const DETAIL_PRIVATE_LOG_KINDS = Object.freeze(['decision', 'idea']);

const LIMITS = Object.freeze({
  prompt: 300,
  detail: 2000,
  optionTitle: 120,
  optionDetail: 500,
  url: 500,
  response: 280,
  why: 280,
  logText: 500,
  logDetail: 2000,
  idea: 280,
  direction: 2000,
  note: 1000,
  scaleLabel: 40,
  summary: 4000,
  listItem: 300,
  listItems: 20,
  links: 10,
  label: 60,
  agentName: 40,
});
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_SUGGESTIONS_PER_PLAYER = 3;
const DEFAULT_MAX_PICKS = 3;
/** "Claude Code connected" means a call in the last two minutes. */
const AGENT_ACTIVE_MS = 2 * 60 * 1000;
/** "Claude is listening": wait_for_direction polled in the last 20 seconds. */
const AGENT_LISTENING_MS = 20 * 1000;
const KEY_PREFIX = 'eng_';

// ── Small helpers ────────────────────────────────────────────────────────────

/** Trim, drop control characters (keeping newlines), cap. Never throws. */
function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  const s = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** An http(s) URL or ''. Anything else (javascript:, data:, relative) is dropped. */
function safeUrl(value) {
  const s = cleanText(value, LIMITS.url);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch (e) {
    return '';
  }
}

/**
 * A link only the laptop can open: localhost, a loopback or private address,
 * or a `.local` name. Claude runs on the host's laptop, so its mockups and its
 * demo are usually here — the HOST can click them, a phone cannot, so phones
 * never see them.
 */
function isLocalUrl(value) {
  try {
    const h = new URL(String(value)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0' || h === '::1'
      || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch (e) {
    return false;
  }
}
const publicUrl = (u) => (u && !isLocalUrl(u) ? u : '');

const pad3 = (n) => String(n).padStart(3, '0');
const labelFor = (i) => String.fromCharCode(65 + i); // 0 → 'A'
const newId = () => crypto.randomBytes(6).toString('hex');
/** Sortable by time, then unique. */
const timeKey = (iso) => `${String(Date.parse(iso) || Date.now()).padStart(13, '0')}#${newId()}`;

const SK = Object.freeze({
  state: 'BUILD#STATE',
  activity: 'BUILD#ACTIVITY',
  ask: (askId) => `BUILD#ASK#${askId}`,
  resp: (askId, respId) => `BUILD#RESP#${askId}#${respId}`,
  ans: (askId, player) => `BUILD#ANS#${askId}#${player}`,
  vote: (askId, player) => `BUILD#VOTE#${askId}#${player}`,
  log: (iso) => `BUILD#LOG#${timeKey(iso)}`,
  idea: (iso) => `BUILD#IDEA#${timeKey(iso)}`,
  key: (hash) => `BUILD#KEY#${hash}`,
  img: (iso) => `BUILD#IMG#${timeKey(iso)}`,
});

// ── Images (a mockup, the finished product) ──────────────────────────────────

/** What a picture may be, by its first bytes — never by what the sender says. */
const IMAGE_MAGIC = Object.freeze([
  { type: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' },
  { type: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { type: 'image/webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
]);
/** 3 MB: base64 in and base64 out both stay under Lambda's 6 MB payload. */
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_KINDS = Object.freeze(['mockup', 'final', 'progress']);
const MAX_IMAGES = 60;

function sniffImage(buf) {
  const hit = IMAGE_MAGIC.find((m) => m.test(buf));
  return hit ? hit.type : null;
}

/** The S3 key of a room's image. Random, and under a prefix nothing makes public. */
const imageKey = (gameId, imageId) => `builds/${gameId}/${imageId}`;

/** Which tenant-crypto entity a BUILD# row belongs to (null = nothing sealed). */
function entityForSk(sk) {
  if (sk === SK.state) return 'buildState';
  if (sk === SK.activity) return 'buildActivity';
  if (sk.startsWith('BUILD#ASK#')) return 'buildAsk';
  if (sk.startsWith('BUILD#RESP#') || sk.startsWith('BUILD#ANS#')) return 'buildResponse';
  if (sk.startsWith('BUILD#LOG#')) return 'buildLog';
  if (sk.startsWith('BUILD#IDEA#')) return 'buildIdea';
  if (sk.startsWith('BUILD#IMG#')) return 'buildImage';
  // Crew mode (build-crew.js), named here so the store needs no import of it.
  if (sk.startsWith('BUILD#BLD#')) return 'buildBuilder';
  if (sk.startsWith('BUILD#TASK#')) return 'buildTask';
  if (sk.startsWith('BUILD#SHR#')) return 'buildShare';
  if (sk.startsWith('BUILD#CMT#')) return 'buildComment';
  if (sk.startsWith('BUILD#REV#')) return 'buildReview';
  return null;
}

// ── Agent keys ───────────────────────────────────────────────────────────────

/** `eng_<gameId>_<secret>` — the game is in the key so the authorizer can find the row. */
function mintKey(gameId) {
  const key = `${KEY_PREFIX}${gameId}_${crypto.randomBytes(32).toString('base64url')}`;
  return { key, hash: hashKey(key) };
}
const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
function parseKey(key) {
  const m = /^eng_(\d{4})_([A-Za-z0-9_-]{43})$/.exec(String(key || ''));
  return m ? { gameId: m[1] } : null;
}

// ── Validation ───────────────────────────────────────────────────────────────

function cleanList(list, maxItems, maxLen) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => cleanText(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

function cleanOptions(options) {
  if (!Array.isArray(options)) return { error: 'options must be a list' };
  const out = options
    .map((o) => (typeof o === 'string' ? { title: o } : (o || {})))
    .map((o) => ({
      title: cleanText(o.title, LIMITS.optionTitle),
      detail: cleanText(o.detail !== undefined ? o.detail : o.description, LIMITS.optionDetail),
      url: safeUrl(o.url),
    }))
    .filter((o) => o.title);
  if (out.length < MIN_OPTIONS) return { error: `A choice needs at least ${MIN_OPTIONS} options` };
  if (out.length > MAX_OPTIONS) return { error: `A choice takes at most ${MAX_OPTIONS} options` };
  return { value: out.map((o, i) => ({ label: labelFor(i), ...o })) };
}

/**
 * A new ask from Claude or the host. Returns `{value}` or `{error}`; the error
 * is written for whoever sent it — Claude reads these and corrects itself.
 */
function normalizeAsk(body) {
  const b = body || {};
  const kind = String(b.kind || '').trim().toLowerCase();
  if (!KINDS.includes(kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };
  const prompt = cleanText(b.prompt !== undefined ? b.prompt : b.question, LIMITS.prompt);
  if (!prompt) return { error: 'The question (prompt) is required' };
  const value = {
    kind,
    prompt,
    detail: cleanText(b.detail !== undefined ? b.detail : b.context, LIMITS.detail),
    options: [],
    scale: null,
    maxPicks: null,
    // From a ready question (step 7b): what Claude gets when it is decided, and how to use it.
    claudeGets: b.claudeGets !== undefined && b.claudeGets !== '' ? claudeGetsOf(b.claudeGets) : '',
    claudeNote: cleanText(b.claudeNote, LIMITS.note),
  };
  if (kind === 'choice') {
    const opts = cleanOptions(b.options);
    if (opts.error) return opts;
    value.options = opts.value;
    const mp = Number(b.maxPicks);
    value.maxPicks = Number.isInteger(mp) && mp >= 1 ? Math.min(mp, value.options.length) : 1;
  }
  if (kind === 'rating') value.scale = { ...RATING_SCALE };
  if (kind === 'suggest') {
    const mp = Number(b.maxPicks);
    value.maxPicks = Number.isInteger(mp) && mp >= 1 ? Math.min(mp, 5) : DEFAULT_MAX_PICKS;
  }
  return { value };
}

/** A host edit. Options are frozen once anybody has answered (the letters would lie). */
function applyEdit(ask, body, { answered }) {
  const b = body || {};
  const next = { ...ask };
  if (b.prompt !== undefined) {
    const p = cleanText(b.prompt, LIMITS.prompt);
    if (!p) return { error: 'The question cannot be empty' };
    next.Prompt = p;
  }
  if (b.detail !== undefined) next.Detail = cleanText(b.detail, LIMITS.detail);
  if (b.options !== undefined && ask.Kind === 'choice') {
    if (answered) return { error: 'People have already answered, so the options can no longer change' };
    const opts = cleanOptions(b.options);
    if (opts.error) return opts;
    next.Options = opts.value;
    next.MaxPicks = Math.min(next.MaxPicks || 1, opts.value.length);
  }
  return { value: next };
}

/**
 * The lifecycle. `from` → the statuses each action may start from, and where
 * it lands. `vote` is Ideas-only: a pick or a rating needs no second phase.
 */
const TRANSITIONS = Object.freeze({
  open: { from: ['proposed'], to: 'live' },
  vote: { from: ['live'], to: 'voting', kinds: ['suggest'] },
  close: { from: ['live', 'voting'], to: 'results' },
  // `proposed` too: the host may answer FOR the room without opening the ask
  // to phones, when people are talking instead of tapping (owner, 2026-10-04).
  decide: { from: ['proposed', 'live', 'voting', 'results', 'decided'], to: 'decided' },
  reopen: { from: ['results', 'decided'], to: 'live' },
  discard: { from: ['proposed', 'live', 'voting', 'results'], to: 'discarded' },
});

function transition(ask, action) {
  const t = TRANSITIONS[action];
  if (!t) return { error: `Unknown action "${action}"` };
  if (t.kinds && !t.kinds.includes(ask.Kind)) return { error: `"${action}" applies to Ideas asks only` };
  if (!t.from.includes(ask.Status)) {
    return { error: `This ask is ${ask.Status}; "${action}" needs it to be ${t.from.join(' or ')}`, conflict: true };
  }
  return { to: t.to };
}

// ── Rows → room ──────────────────────────────────────────────────────────────

/** Sort every BUILD# row into its kind. Rows must already be decrypted. */
function roomFromRows(rows) {
  const room = {
    state: null, activity: null, asks: [], resps: [], answers: [], votes: [], logs: [], ideas: [], keys: [], images: [],
    builders: [], tasks: [], shares: [], comments: [], reviews: [],
  };
  for (const r of rows || []) {
    const sk = String(r.SK || '');
    if (sk === SK.state) room.state = r;
    else if (sk === SK.activity) room.activity = r;
    else if (sk.startsWith('BUILD#ASK#')) room.asks.push(r);
    else if (sk.startsWith('BUILD#RESP#')) room.resps.push(r);
    else if (sk.startsWith('BUILD#ANS#')) room.answers.push(r);
    else if (sk.startsWith('BUILD#VOTE#')) room.votes.push(r);
    else if (sk.startsWith('BUILD#LOG#')) room.logs.push(r);
    else if (sk.startsWith('BUILD#IDEA#')) room.ideas.push(r);
    else if (sk.startsWith('BUILD#KEY#')) room.keys.push(r);
    else if (sk.startsWith('BUILD#IMG#')) room.images.push(r);
    else if (sk.startsWith('BUILD#BLD#')) room.builders.push(r);
    else if (sk.startsWith('BUILD#TASK#')) room.tasks.push(r);
    else if (sk.startsWith('BUILD#SHR#')) room.shares.push(r);
    else if (sk.startsWith('BUILD#CMT#')) room.comments.push(r);
    else if (sk.startsWith('BUILD#REV#')) room.reviews.push(r);
  }
  const bySk = (a, b) => String(a.SK).localeCompare(String(b.SK));
  room.asks.sort(bySk);
  room.logs.sort(bySk);
  room.ideas.sort(bySk);
  room.images.sort(bySk);
  room.builders.sort(bySk);
  room.tasks.sort(bySk);
  room.comments.sort(bySk);
  room.reviews.sort(bySk);
  room.resps.sort((a, b) => String(a.CreatedAt || '').localeCompare(String(b.CreatedAt || '')));
  return room;
}

const forAsk = (rows, askId) => rows.filter((r) => r.AskId === askId);
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

/** The tally of one ask, with names. Views strip what an audience may not see. */
function tally(ask, room) {
  const kind = ask.Kind;
  const askId = ask.AskId;
  if (kind === 'suggest') {
    const resps = forAsk(room.resps, askId);
    const votes = forAsk(room.votes, askId);
    const count = new Map();
    for (const v of votes) for (const id of v.RespIds || []) count.set(id, (count.get(id) || 0) + 1);
    const visible = resps.filter((r) => !r.Hidden);
    const ranked = visible
      .map((r) => ({ respId: r.RespId, text: r.Text, playerName: r.PlayerName || '', source: r.Source || 'player', votes: count.get(r.RespId) || 0 }))
      .sort((a, b) => b.votes - a.votes || 0);
    return { total: votes.length, responses: resps.length, ranked, count };
  }
  const answers = forAsk(room.answers, askId);
  const whys = answers
    .filter((a) => a.Why)
    .map((a) => ({ label: kind === 'choice' ? (a.Choice || []).join(', ') : String(a.Rating || ''), text: a.Why, playerName: a.PlayerName || '' }));
  if (kind === 'choice') {
    const options = (ask.Options || []).map((o) => {
      const voters = answers.filter((a) => (a.Choice || []).includes(o.label)).map((a) => a.PlayerName || '');
      return { label: o.label, title: o.title, count: voters.length, pct: pct(voters.length, answers.length), voters };
    });
    return { total: answers.length, options, whys };
  }
  // rating
  const dist = [0, 0, 0, 0, 0];
  let sum = 0;
  let n = 0;
  for (const a of answers) {
    const r = Number(a.Rating);
    if (Number.isInteger(r) && r >= 1 && r <= 5) { dist[r - 1] += 1; sum += r; n += 1; }
  }
  return { total: n, rating: { avg: n ? Math.round((sum / n) * 10) / 10 : null, count: n, dist }, whys };
}

/** One ask, as `audience` may see it. `me` = {playerName} for a phone. */
function askView(ask, room, audience, me) {
  const t = tally(ask, room);
  const isHost = audience === 'host' || audience === 'agent';
  const showResults = isHost || ['results', 'decided'].includes(ask.Status);
  const out = {
    askId: ask.AskId,
    kind: ask.Kind,
    prompt: ask.Prompt || '',
    detail: ask.Detail || '',
    status: ask.Status,
    source: ask.Source || 'host',
    options: (ask.Options || []).map((o) => ({ label: o.label, title: o.title, detail: o.detail || '', url: o.url || '', imageId: o.imageId || optionImages(room, ask.AskId)[o.label] || null })),
    scale: ask.Kind === 'rating' ? RATING_SCALE : null,
    maxPicks: ask.MaxPicks || null,
    createdAt: ask.CreatedAt || null,
    openedAt: ask.OpenedAt || null,
    votingAt: ask.VotingAt || null,
    closedAt: ask.ClosedAt || null,
    decidedAt: ask.DecidedAt || null,
    answerCount: ask.Kind === 'suggest' ? t.responses : t.total,
    voteCount: ask.Kind === 'suggest' ? t.total : null,
    responses: [],
    results: null,
    decision: null,
  };
  if (ask.Kind === 'suggest') {
    const resps = forAsk(room.resps, ask.AskId);
    if (isHost) {
      out.responses = resps.map((r) => ({
        respId: r.RespId, text: r.Text, playerName: r.PlayerName || '', source: r.Source || 'player',
        hidden: Boolean(r.Hidden), createdAt: r.CreatedAt || null, votes: t.count.get(r.RespId) || 0,
      }));
    } else if (['voting', 'results', 'decided'].includes(ask.Status)) {
      // Anonymous on phones. A phone's own suggestions are flagged so it
      // cannot vote for itself.
      out.responses = resps.filter((r) => !r.Hidden).map((r) => ({
        respId: r.RespId, text: r.Text, mine: Boolean(me && r.PlayerName === me.playerName && (r.Source || 'player') === 'player'),
        ...(showResults ? { votes: t.count.get(r.RespId) || 0 } : {}),
      }));
    }
  }
  if (showResults) {
    if (ask.Kind === 'suggest') {
      out.results = { total: t.total, ranked: t.ranked.map((r) => (isHost ? r : { respId: r.respId, text: r.text, votes: r.votes })) };
    } else if (ask.Kind === 'choice') {
      out.results = {
        total: t.total,
        options: t.options.map((o) => (isHost ? o : { label: o.label, title: o.title, count: o.count, pct: o.pct })),
        whys: t.whys.map((w) => (isHost ? w : { label: w.label, text: w.text })),
      };
    } else {
      out.results = { total: t.total, rating: t.rating, whys: t.whys.map((w) => (isHost ? w : { label: w.label, text: w.text })) };
    }
  }
  if (showResults && out.results && ask.Kind !== 'rating') out.results.tied = tiedIds(ask, room);
  if (ask.Wheel) out.wheel = wheelView(ask.Wheel, me);
  if (ask.RevotedAs) out.revotedAs = ask.RevotedAs;
  // THE QUEUE (step 4): a vote made from ideas, and one waiting on Claude's
  // mockups. Ready when every option has a picture; it never opens by itself
  // unless the host said "Open next" (owner, 2026-10-05).
  if (ask.FromIdeas && ask.FromIdeas.length) out.fromIdeas = ask.FromIdeas;
  if (isHost && ask.ClaudeGets) out.claudeGets = ask.ClaudeGets;
  if (isHost && ask.ClaudeNote) out.claudeNote = ask.ClaudeNote;
  if (ask.AskForMockups && isHost) {
    const m = mockupProgress(out);
    out.mockups = { asked: true, have: m.have, total: m.total, ready: ask.Status === 'proposed' && m.total > 0 && m.have === m.total };
  }
  if (isHost && room.state && room.state.NextAskId === ask.AskId && ask.Status === 'proposed') out.next = true;
  if (ask.RevoteOf) out.revoteOf = ask.RevoteOf;
  if (ask.Decision) {
    out.decision = {
      direction: ask.Decision.direction || '',
      chosen: ask.Decision.chosen || [],
      ...(isHost ? { note: ask.Decision.note || '' } : {}),
      sentToAgent: ask.Decision.sendToAgent !== false,
      spoken: Boolean(ask.Decision.spoken),
      method: ask.Decision.method || (ask.Decision.spoken ? 'spoken' : 'vote'),
      decidedAt: ask.DecidedAt || null,
      deliveredAt: ask.Decision.deliveredAt || null,
    };
  }
  return out;
}

function logView(r) {
  return {
    logId: r.LogId,
    as: r.ForAgent ? claudeGetsOf(r.ForAgentAs) : null,
    kind: r.Kind,
    text: r.Text || '',
    detail: r.Detail || '',
    link: r.Link || '',
    by: r.By || 'host',
    askId: r.AskId || null,
    forAgent: Boolean(r.ForAgent),
    name: r.Name || null,
    shareId: r.ShareId || null,
    deliveredAt: r.DeliveredAt || null,
    createdAt: r.CreatedAt || null,
    editedAt: r.EditedAt || null,
  };
}

function imageView(r) {
  return {
    imageId: r.ImageId,
    caption: r.Caption || '',
    kind: r.Kind || 'progress',
    askId: r.AskId || null,
    label: r.Label || null,
    contentType: r.ContentType,
    bytes: r.Bytes || 0,
    by: r.By || 'agent',
    createdAt: r.CreatedAt || null,
  };
}

/** The newest picture of each option of an ask: { A: imageId, … }. */
function optionImages(room, askId) {
  const out = {};
  for (const img of room.images) if (img.AskId === askId && img.Label) out[img.Label] = img.ImageId;
  return out;
}

function ideaView(r) {
  return {
    ideaId: r.IdeaId, text: r.Text || '', playerName: r.PlayerName || '', status: r.Status || 'new', createdAt: r.CreatedAt || null, aboutLogId: r.AboutLogId || null,
    walled: Boolean(r.WalledAt),
    // 'room' (a phone) or 'host' (Queue it, from the host's own composer).
    source: r.Source || 'room',
    promotedTo: r.PromotedTo || null,
  };
}

/** How many of a viewed ask's options carry a picture. */
function mockupProgress(view) {
  const opts = (view && view.options) || [];
  return { have: opts.filter((o) => o.imageId).length, total: opts.length };
}

/**
 * IDEAS TO A VOTE (step 4, C3). The ticked ideas become a Choose ask, one
 * option each, in the order they were ticked. An idea longer than an option
 * title keeps its whole text as the option's detail. Pick one is the default
 * (owner, 2026-10-05). Returns `{value}` or `{error}`.
 */
const DEFAULT_VOTE_PROMPT = 'Which should Claude build next?';
function voteFromIdeas(ideas, body) {
  const b = body || {};
  if (ideas.length < MIN_OPTIONS) return { error: `Tick at least ${MIN_OPTIONS} ideas to put to a vote` };
  if (ideas.length > MAX_OPTIONS) return { error: `A vote takes at most ${MAX_OPTIONS} ideas` };
  const prompt = cleanText(b.prompt, LIMITS.prompt) || DEFAULT_VOTE_PROMPT;
  const options = ideas.map((i, n) => {
    const text = cleanText(i.Text, LIMITS.idea);
    const title = text.length > LIMITS.optionTitle ? `${text.slice(0, LIMITS.optionTitle - 1).trimEnd()}…` : text;
    return { label: labelFor(n), title, detail: text.length > LIMITS.optionTitle ? text : '', url: '' };
  });
  const mp = Number(b.maxPicks);
  const maxPicks = Number.isInteger(mp) && mp >= 1 ? Math.min(mp, options.length) : 1;
  return { value: { kind: 'choice', prompt, detail: cleanText(b.detail, LIMITS.detail), options, maxPicks } };
}

/** The direction that asks Claude for a mockup of each option of a waiting vote. */
function mockupDirection(askId, labels) {
  const list = labels.join(', ');
  return `Before ask ${Number(askId)} opens to the room: make a quick mockup of ${labels.length === 1 ? `option ${list}` : `options ${list}`}, `
    + `stamp each with its letter, screenshot it, and attach it to its option with share_image (askId "${askId}", label ${list}). `
    + 'The vote waits until they are in. Then tell me they are ready.';
}

/**
 * A ROOM COMMENT ON THE WALL (owner, 2026-10-05: "build acknowledge, show on
 * wall too"). One at a time, anonymous, for a short while: the Stage shows it
 * while it is fresh. The host's screen only; never Claude's, never a phone's.
 */
const WALL_COMMENT_MS = 20 * 1000;
function wallCommentView(state) {
  const w = state && state.WallComment;
  return w && w.Text ? { ideaId: w.IdeaId || null, text: w.Text, at: w.At || null } : null;
}

function outcomeView(o) {
  if (!o || typeof o !== 'object') return null;
  return {
    summary: o.summary || '',
    built: Array.isArray(o.built) ? o.built : [],
    links: Array.isArray(o.links) ? o.links : [],
    nextSteps: Array.isArray(o.nextSteps) ? o.nextSteps : [],
    by: o.by || 'host',
    updatedAt: o.updatedAt || null,
  };
}

function normalizeOutcome(body, by, now) {
  const b = body || {};
  const summary = cleanText(b.summary, LIMITS.summary);
  if (!summary) return { error: 'A wrap-up needs a summary' };
  const links = (Array.isArray(b.links) ? b.links : [])
    .map((l) => (typeof l === 'string' ? { label: '', url: l } : (l || {})))
    .map((l) => ({ label: cleanText(l.label, LIMITS.label), url: safeUrl(l.url) }))
    .filter((l) => l.url)
    .slice(0, LIMITS.links);
  return {
    value: {
      summary,
      built: cleanList(b.built, LIMITS.listItems, LIMITS.listItem),
      links,
      nextSteps: cleanList(b.nextSteps, LIMITS.listItems, LIMITS.listItem),
      by,
      updatedAt: now,
    },
  };
}

function agentStatus(stateRow, keys, now) {
  const s = stateRow || {};
  const seen = s.AgentSeenAt ? Date.parse(s.AgentSeenAt) : NaN;
  const live = (keys || []).filter((k) => !k.RevokedAt && (k.Role || 'host') === 'host').sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)))[0];
  const heard = s.AgentListeningAt ? Date.parse(s.AgentListeningAt) : NaN;
  return {
    connected: Number.isFinite(seen) && Date.parse(now) - seen < AGENT_ACTIVE_MS,
    listening: Number.isFinite(heard) && Date.parse(now) - heard < AGENT_LISTENING_MS,
    lastSeenAt: s.AgentSeenAt || null,
    name: s.AgentName || 'Claude Code',
    key: live ? { keyId: live.KeyId, label: live.Label || '', createdAt: live.CreatedAt || null, lastUsedAt: live.LastUsedAt || null } : null,
  };
}

const settingsOf = (stateRow) => ({
  reviewAgentAsks: !(stateRow && stateRow.Settings && stateRow.Settings.reviewAgentAsks === false),
});

/** What the host (and Claude) sees: everything. */
// ── What Claude Code is doing (owner, 2026-10-04) ─────────────────────────
// The plugin's PostToolUse hook writes one plain line per tool Claude uses
// ("Edited Header.jsx", "Ran npm test"); its server sends them here in
// batches. One row holds the latest few: it is a live view, not a record, so
// it never reaches the timeline, the report or a phone.
const ACTIVITY_KINDS = Object.freeze(['edit', 'read', 'run', 'search', 'web', 'agent', 'plan', 'other']);
const ACTIVITY_KEEP = 12;
const ACTIVITY_PER_POST = 25;

/** A posted batch, cleaned: known kinds, short plain text, a sane time. */
function normalizeActivity(items, nowIso) {
  if (!Array.isArray(items)) return { error: 'items must be a list' };
  const now = Date.parse(nowIso);
  const out = [];
  for (const it of items.slice(-ACTIVITY_PER_POST)) {
    if (!it || typeof it !== 'object') continue;
    const text = cleanText(it.text, 120).replace(/\s+/g, ' ');
    if (!text) continue;
    const kind = ACTIVITY_KINDS.includes(it.kind) ? it.kind : 'other';
    const t = Date.parse(it.at);
    // A laptop clock can be off; never in the future, never older than an hour.
    const at = new Date(Number.isFinite(t) ? Math.min(Math.max(t, now - 3600000), now) : now).toISOString();
    out.push({ at, kind, text });
  }
  return { value: out };
}

/** The kept list after a batch: newest last, at most ACTIVITY_KEEP. */
function mergeActivity(kept, incoming) {
  return [...(Array.isArray(kept) ? kept : []), ...incoming]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(-ACTIVITY_KEEP);
}

const activityView = (row) => ((row && Array.isArray(row.Items)) ? row.Items.slice(-ACTIVITY_KEEP) : []);

function hostView({ gameId, meta, sessionState, room, players, now, audience = 'host' }) {
  const isAgent = audience === 'agent';
  return {
    gameId,
    title: meta.Title || '',
    goal: meta.Details || meta.EngagementInfo || '',
    state: sessionState || null,
    players,
    playerCount: players.length,
    settings: settingsOf(room.state),
    agent: agentStatus(room.state, room.keys, now),
    activity: activityView(room.activity),
    currentAskId: (room.state && room.state.CurrentAskId) || null,
    asks: room.asks.map((a) => askView(a, room, audience)),
    // Host notes are the host's own; Claude never sees them.
    // A builder's own deliveries (feedback, the base moving) are plumbing; the
    // crew entries beside them say what happened.
    log: room.logs.filter((l) => !l.ForBuilder && !(isAgent && PRIVATE_LOG_KINDS.includes(l.Kind))).map(logView),
    ideas: isAgent ? [] : room.ideas.map(ideaView),
    wallComment: isAgent ? null : wallCommentView(room.state),
    brief: briefView(room.state),
    images: room.images.map(imageView),
    outcome: outcomeView(room.state && room.state.Outcome),
    rev: (room.state && room.state.Rev) || 0,
  };
}

/** What a phone sees. */
function publicView({ gameId, meta, sessionState, room, players, me, now }) {
  const currentAskId = (room.state && room.state.CurrentAskId) || null;
  const visibleAsks = room.asks.filter((a) => !['proposed', 'discarded'].includes(a.Status));
  const current = currentAskId ? room.asks.find((a) => a.AskId === currentAskId && OPEN_STATUSES.concat(['results', 'decided']).includes(a.Status)) : null;
  const mine = { responses: [], vote: [], answer: null };
  if (current && me) {
    mine.responses = forAsk(room.resps, current.AskId)
      .filter((r) => r.PlayerName === me.playerName && (r.Source || 'player') === 'player')
      .map((r) => ({ respId: r.RespId, text: r.Text }));
    const v = forAsk(room.votes, current.AskId).find((r) => r.PlayerName === me.playerName);
    mine.vote = v ? v.RespIds || [] : [];
    const a = forAsk(room.answers, current.AskId).find((r) => r.PlayerName === me.playerName);
    mine.answer = a ? { choice: a.Choice || [], rating: a.Rating || null, why: a.Why || '' } : null;
  }
  return {
    gameId,
    title: meta.Title || '',
    goal: meta.Details || meta.EngagementInfo || '',
    state: sessionState || null,
    playerCount: players.length,
    currentAskId: current ? current.AskId : null,
    current: current ? publicAsk(askView(current, room, 'public', me)) : null,
    decisions: visibleAsks.filter((a) => a.Status === 'decided' && a.Decision).map((a) => ({
      askId: a.AskId, prompt: a.Prompt || '', direction: a.Decision.direction || '', decidedAt: a.DecidedAt || null,
    })),
    // A phone sees the timeline the room made, not the host's working:
    // directions are Claude's copy of a decision the phone already sees (and
    // carry the host's note), and a decision's or idea's detail is the host's
    // note or the idea's author.
    log: room.logs.filter((l) => !l.ForBuilder && !PRIVATE_LOG_KINDS.includes(l.Kind) && !PHONE_HIDDEN_LOG_KINDS.includes(l.Kind)).map(logView)
      .map(({ forAgent, deliveredAt, ...rest }) => (DETAIL_PRIVATE_LOG_KINDS.includes(rest.kind) ? { ...rest, detail: '' } : rest))
      .map((l) => ({ ...l, link: publicUrl(l.link) })),
    myIdeas: me ? room.ideas.filter((i) => i.PlayerName === me.playerName && i.Source !== 'host').map(ideaView) : [],
    images: room.images.map(imageView),
    outcome: publicOutcome(outcomeView(room.state && room.state.Outcome)),
    agentConnected: agentStatus(room.state, [], now || new Date().toISOString()).connected,
    mine,
    rev: (room.state && room.state.Rev) || 0,
  };
}

/** A phone's copy of an ask: a preview it cannot open is not offered. */
function publicAsk(ask) {
  return { ...ask, options: ask.options.map((o) => ({ ...o, url: publicUrl(o.url) })) };
}
function publicOutcome(o) {
  return o ? { ...o, links: o.links.filter((l) => !isLocalUrl(l.url)) } : o;
}

/**
 * Entries Claude has not yet been handed, oldest first. One timeline entry is
 * both the record and the message: a decision, what the room said, an idea
 * the host passed on, or a plain direction — whichever carries ForAgent.
 */
function pendingDirections(room) {
  return room.logs.filter((l) => l.ForAgent && !l.ForBuilder && !l.DeliveredAt && l.Kind !== 'note');
}

/** Entries for one builder's Claude (crew mode): feedback, the base moving. */
function pendingForBuilder(room, name) {
  return room.logs.filter((l) => l.ForBuilder === name && !l.DeliveredAt);
}

/** The words Claude receives for one entry. */
function inboxText(entry) {
  if (entry.Kind === 'decision') {
    // The question and the answer, and the host's note when they added one.
    // How it was decided stays on the decision (owner, 2026-10-06).
    return entry.Text + (entry.Detail ? `\n\nAlso from the room: ${entry.Detail}` : '')
      // How to use the answer, from a ready question's set (step 7b): never shown to the room.
      + (entry.ClaudeNote ? `\n\nHow to use it: ${entry.ClaudeNote}` : '');
  }
  if (entry.Kind === 'idea') return `An idea from the room: ${entry.Text}`;
  if (entry.Kind === 'verbal') return `The room said: ${entry.Text}`;
  return entry.Text;
}
const inboxFrom = (entry) => (entry.Kind === 'decision' ? 'decision' : entry.Kind === 'idea' ? 'idea' : 'host');

/** The text a decision hands Claude when the host did not write one. */
// ── The wheel (owner, 2026-10-05) ───────────────────────────────────────────
//
// At results the host may spin a wheel over the tied options (or all of
// them): a random person in the room spins it from their phone, the host can
// always spin, and the room can ask for a respin. WHERE IT LANDS IS DECIDED
// HERE, ON THE SERVER, so the wall, every phone and the host animate to the
// same answer. The slices copy the options' words, so `Wheel` is sealed with
// the ask (tenant-crypto buildAsk).

const WHEEL_MIN = 2;
const WHEEL_MAX = 12;
const WHEEL_KEEP_SPINS = 20;

/** The options or suggestions sharing the top count (two or more, and above zero). */
function tiedIds(ask, room) {
  const t = tally(ask, room);
  if (ask.Kind === 'choice') {
    const top = Math.max(0, ...t.options.map((o) => o.count));
    const tied = t.options.filter((o) => o.count === top && top > 0);
    return tied.length >= 2 ? tied.map((o) => o.label) : [];
  }
  if (ask.Kind === 'suggest') {
    const top = Math.max(0, ...t.ranked.map((r) => r.votes));
    const tied = t.ranked.filter((r) => r.votes === top && top > 0);
    return tied.length >= 2 ? tied.map((r) => r.respId) : [];
  }
  return [];
}

/** What goes on the wheel: the tied ones when `among` is 'tied', else every option (top suggestions). */
function wheelSlices(ask, room, among) {
  const t = tally(ask, room);
  const tied = new Set(tiedIds(ask, room));
  const keep = (id) => among !== 'tied' || tied.has(id);
  if (ask.Kind === 'choice') {
    return (ask.Options || []).filter((o) => keep(o.label))
      .map((o) => ({ id: o.label, label: o.label, text: cleanText(o.title, 120) })).slice(0, WHEEL_MAX);
  }
  if (ask.Kind === 'suggest') {
    return t.ranked.filter((r) => keep(r.respId))
      .map((r) => ({ id: r.respId, label: '', text: cleanText(r.text, 120) })).slice(0, WHEEL_MAX);
  }
  return [];
}

/** The wheel as a screen sees it. `mine` is true on the phone whose turn it is to spin. */
function wheelView(w, me) {
  const spins = (w.Spins || []).map((x) => ({ spinId: x.SpinId, at: x.At, by: x.By, result: x.Result, turns: x.Turns }));
  const last = spins[spins.length - 1] || null;
  return {
    slices: (w.Slices || []).map((x) => ({ id: x.id, label: x.label || '', text: x.text || '' })),
    spinner: w.Spinner || null,
    armed: Boolean(w.Armed),
    spins,
    landed: last ? last.result : null,
    mine: Boolean(me && w.Spinner && w.Armed && me.playerName === w.Spinner),
  };
}

/** The slice the wheel last landed on, or null. */
function wheelLanded(ask) {
  const w = ask && ask.Wheel;
  const last = w && (w.Spins || [])[(w.Spins || []).length - 1];
  return last ? (w.Slices || []).find((x) => x.id === last.Result) || null : null;
}

/**
 * WHAT CLAUDE IS TOLD IS THE QUESTION AND THE ANSWER (owner, 2026-10-06:
 * "Claude only needs question/answer: What should the background color be:
 * blue"). How the room got there (a vote, the wheel, the host's pick, said out
 * loud) is recorded on the decision (`method`) and never sent to Claude.
 */
const questionOf = (prompt) => String(prompt || '').trim().replace(/[\s?]+$/, '');
const questionAnswer = (prompt, answer) => (answer ? `${questionOf(prompt)}: ${answer}` : '');
const DECISION_METHODS = Object.freeze(['vote', 'wheel', 'host', 'spoken']);
/** A rating answer that carries its own meaning, so Claude and the log read it right. */
const ratingAnswer = (avg) => (avg === null || avg === undefined || avg === '' ? '' : `${avg} out of 5 (5 is great, 1 needs work)`);
const RATING_MEANING = '(5 is great, 1 needs work)';
/** A rating decision always says what its numbers mean, even after the host rewrites it. */
const withRatingMeaning = (kind, direction) => (kind !== 'rating' || !direction || /needs work/i.test(direction) ? direction : `${direction} ${RATING_MEANING}`);

function defaultDirection(ask, room) {
  const landed = wheelLanded(ask);
  if (landed) return questionAnswer(ask.Prompt, landed.text);
  const t = tally(ask, room);
  if (ask.Kind === 'choice') {
    const top = [...t.options].sort((a, b) => b.count - a.count)[0];
    return top && top.count ? questionAnswer(ask.Prompt, top.title) : '';
  }
  if (ask.Kind === 'rating') return t.rating.avg === null ? '' : questionAnswer(ask.Prompt, ratingAnswer(t.rating.avg));
  const top = t.ranked[0];
  return top ? questionAnswer(ask.Prompt, top.text) : '';
}

module.exports = {
  GAME_TYPE_BUILD, KINDS, STATUSES, OPEN_STATUSES, LOG_KINDS, AGENT_LOG_KINDS, HOST_LOG_KINDS, PRIVATE_LOG_KINDS, PHONE_HIDDEN_LOG_KINDS, DETAIL_PRIVATE_LOG_KINDS,
  LIMITS, MIN_OPTIONS, MAX_OPTIONS, MAX_SUGGESTIONS_PER_PLAYER, DEFAULT_MAX_PICKS, AGENT_ACTIVE_MS, AGENT_LISTENING_MS, KEY_PREFIX,
  SK, TRANSITIONS,
  cleanText, safeUrl, isLocalUrl, publicUrl, pad3,
  IMAGE_MAX_BYTES, IMAGE_KINDS, MAX_IMAGES, sniffImage, imageKey, imageView, optionImages, labelFor, newId, entityForSk,
  mintKey, hashKey, parseKey,
  normalizeAsk, applyEdit, transition, normalizeOutcome,
  ACTIVITY_KINDS, ACTIVITY_KEEP, normalizeActivity, mergeActivity, activityView,
  roomFromRows, tally, askView, logView, ideaView, outcomeView, agentStatus, settingsOf,
  WHEEL_MIN, WHEEL_MAX, WHEEL_KEEP_SPINS, tiedIds, wheelSlices, wheelView, wheelLanded,
  WALL_COMMENT_MS, wallCommentView, CLAUDE_GETS, claudeGetsOf, briefView, briefWith, normalizeBrief, briefText, BRIEF_MAX_ITEMS, voteFromIdeas, mockupDirection, mockupProgress, DEFAULT_VOTE_PROMPT, questionAnswer, DECISION_METHODS, RATING_SCALE, ratingAnswer, withRatingMeaning,
  hostView, publicView, pendingDirections, pendingForBuilder, inboxText, inboxFrom, defaultDirection,
};
