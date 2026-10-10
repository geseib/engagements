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
const LAN = require('./build-lan');

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
  // One finished piece of Claude's work (a "what Claude is doing" line that ended), with its duration.
  'step',
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

/**
 * THE OPENING (owner, 2026-10-06; docs/design/build-room-opening/PLAN.md):
 * frame the build with the room before Claude builds. Nine steps in Amazon's
 * working-backwards order, each filling one line of the brief; a guided path
 * the host can skip; Tools and style the host answers by default.
 */
const OPENING_STEPS = Object.freeze([
  { key: 'kind', label: 'Making', question: 'What are we making?', ask: 'choice' },
  { key: 'forWhom', label: 'For', question: 'Who is it for? Name a person and the moment they need it.', ask: 'suggest', probes: ['Who else is it for?', 'Who is it not for?'] },
  { key: 'problem', label: 'The problem', question: 'What problem do they have today?', ask: 'suggest', probes: ['What do they do instead today?', 'Why is that not good enough?'] },
  { key: 'good', label: 'Good looks like', question: 'It is launch day. Write the headline.', ask: 'suggest', probes: ['What would they tell a friend?'] },
  { key: 'proof', label: 'We will know', question: 'How will we know it worked?', ask: 'suggest', probes: ['What would we see, or count?'] },
  { key: 'never', label: 'Never', question: 'What must it never do?', ask: 'suggest' },
  { key: 'firstBuild', label: 'First build', question: 'What is the smallest version we could show today?', ask: 'suggest' },
  { key: 'tools', label: 'Tools and style', question: 'Any tools, frameworks, libraries or styles to use, or to avoid?', ask: 'suggest', host: true },
  { key: 'look', label: 'Look and feel', question: 'How should it look and feel?', ask: 'suggest' },
]);
const OPENING_KEYS = Object.freeze(OPENING_STEPS.map((x) => x.key));
/** Step 1's list: six, so it fits the wheel. The host may edit it per session. */
const OPENING_KINDS = Object.freeze([
  { title: 'A website or page', detail: 'Something people visit' },
  { title: 'An app', detail: 'On a phone, laptop or tablet' },
  { title: 'A game', detail: 'Something to play' },
  { title: 'A tool that saves time', detail: 'A script, an automation, a helper' },
  { title: 'A document or guide', detail: 'A plan, a how-to, a proposal' },
  { title: 'Figure something out', detail: 'Compare, test an idea, decide' },
]);
/** The brief's opening lines, beside Who it is for (forWhom) and Never (Keep in mind). */
const BRIEF_LINES = Object.freeze(['kind', 'problem', 'good', 'proof', 'firstBuild', 'tools', 'look']);

function briefView(state) {
  const b = (state && state.Brief) || {};
  const items = (list) => (Array.isArray(list) ? list : []).map((i) => ({ id: i.id, text: i.text || '', from: i.from || 'you', askId: i.askId || null, at: i.at || null }));
  const lines = {};
  for (const k of BRIEF_LINES) lines[k] = (b.lines && b.lines[k]) || '';
  const steps = {};
  for (const k of OPENING_KEYS) if (b.steps && ['done', 'skipped'].includes(b.steps[k])) steps[k] = b.steps[k];
  return { forWhom: b.forWhom || '', keep: items(b.keep), later: items(b.later), lines, steps, headline: b.headline || '', summary: b.summary || '' };
}

/**
 * CLAUDE'S DRAFT OF THE BRIEF (owner, 2026-10-06: "build the Claude brief
 * draft too"). Once the room has said who it is for, the problem and what
 * good looks like, Claude drafts a headline, a short summary and, if it
 * helps, plainer wording for any line. The host edits it, then uses it or
 * dismisses it. Kept on BUILD#STATE (BriefDraft, sealed with it).
 */
const DRAFT_LIMITS = Object.freeze({ headline: 120, summary: 600 });
function normalizeDraft(body) {
  const b = body || {};
  const headline = cleanText(b.headline, DRAFT_LIMITS.headline);
  if (!headline) return { error: 'The draft needs a headline: one line, the promise of the thing, in the room\'s words.' };
  const lines = {};
  if (b.lines && typeof b.lines === 'object') {
    for (const k of BRIEF_LINES.concat(['forWhom'])) {
      const v = cleanText(b.lines[k], LIMITS.listItem);
      if (v) lines[k] = v;
    }
  }
  return { value: { headline, summary: cleanText(b.summary, DRAFT_LIMITS.summary), lines } };
}
function draftView(state) {
  const d = state && state.BriefDraft;
  return d && d.headline ? { headline: d.headline, summary: d.summary || '', lines: d.lines || {}, at: d.at || null } : null;
}

/**
 * A decided opening step lands on its line: Who it is for, Never (a Keep in
 * mind rule each), or one of BRIEF_LINES. A probe adds to the line.
 */
function briefWithStep(state, key, text, { probe = false, id = '', askId = null, at = null } = {}) {
  const b = briefView(state);
  const t = cleanText(text, LIMITS.listItem);
  if (!t || !OPENING_KEYS.includes(key)) return b;
  const join = (old) => (probe && old ? `${old}${/[.!?]$/.test(old) ? '' : '.'} ${t}` : t);
  if (key === 'forWhom') b.forWhom = join(b.forWhom);
  else if (key === 'never') {
    if (!b.keep.some((i) => i.text === t)) b.keep = [...b.keep, { id: id || newId(), text: t, from: askId ? `ask ${Number(askId)}` : 'you', askId, at }].slice(-BRIEF_MAX_ITEMS);
  } else b.lines = { ...b.lines, [key]: join(b.lines[key]) };
  b.steps = { ...b.steps, [key]: 'done' };
  return b;
}

/** The session's phase: an opening until the host starts building. Rooms made before it have asks, so they are building. */
function phaseOf(state, room) {
  if (state && ['opening', 'building'].includes(state.Phase)) return state.Phase;
  return (room && room.asks && room.asks.length) || (state && state.Outcome) ? 'building' : 'opening';
}

/** The opening as the host, Claude and the phones see it. */
function openingView(state, room) {
  const brief = briefView(state);
  const phase = phaseOf(state, room);
  const open = (room.asks || []).filter((a) => a.OpeningStep && OPEN_STATUSES.concat(['results']).includes(a.Status));
  const asking = new Set(open.map((a) => a.OpeningStep));
  const valueOf = (k) => (k === 'forWhom' ? brief.forWhom : k === 'never' ? brief.keep.map((i) => i.text).join('; ') : brief.lines[k] || '');
  const steps = OPENING_STEPS.map((st) => ({
    ...st,
    probes: st.probes || [],
    value: valueOf(st.key),
    status: asking.has(st.key) ? 'asking' : brief.steps[st.key] || 'next',
  }));
  const current = steps.find((st) => st.status === 'asking') || steps.find((st) => st.status === 'next') || null;
  // Enough for Claude to draft the one page: who, the problem, and good.
  const readyForDraft = Boolean(brief.forWhom && brief.lines.problem && brief.lines.good);
  return { phase, steps, current: current ? current.key : null, kinds: OPENING_KINDS, readyForDraft, drafted: Boolean(brief.headline) };
}
/** The brief with one item added to Keep in mind or Later (newest last; capped). */
function briefWith(state, as, item) {
  const b = briefView(state);
  const list = as === 'keep' ? 'keep' : 'later';
  if (b[list].some((i) => i.text === item.text)) return b;
  b[list] = [...b[list], item].slice(-BRIEF_MAX_ITEMS);
  return b;
}
/** A host edit of the brief: `{forWhom?, keep?, later?, lines?}`, each list of `{id?, text}`. */
function normalizeBrief(state, body) {
  const b = body || {};
  const cur = briefView(state);
  const list = (v, old) => (Array.isArray(v)
    ? v.map((i) => (typeof i === 'string' ? { text: i } : (i || {})))
      .map((i) => ({ ...(old.find((o) => o.id === i.id) || {}), id: i.id || newId(), text: cleanText(i.text, LIMITS.listItem) }))
      .filter((i) => i.text).slice(0, BRIEF_MAX_ITEMS)
    : old);
  const lines = { ...cur.lines };
  if (b.lines && typeof b.lines === 'object') for (const k of BRIEF_LINES) if (b.lines[k] !== undefined) lines[k] = cleanText(b.lines[k], LIMITS.listItem);
  return {
    forWhom: b.forWhom !== undefined ? cleanText(b.forWhom, LIMITS.listItem) : cur.forWhom,
    keep: list(b.keep, cur.keep),
    later: list(b.later, cur.later),
    lines,
    steps: cur.steps,
    headline: b.headline !== undefined ? cleanText(b.headline, DRAFT_LIMITS.headline) : cur.headline,
    summary: b.summary !== undefined ? cleanText(b.summary, DRAFT_LIMITS.summary) : cur.summary,
  };
}
/** The brief as Claude reads it, and as the plugin writes it to .engage/brief.md. */
function briefText(brief) {
  const b = brief || { forWhom: '', keep: [], later: [] };
  const l = b.lines || {};
  if (!b.forWhom && !b.keep.length && !b.headline && !BRIEF_LINES.some((k) => l[k])) return '';
  const lines = ['THE ROOM BRIEF (the room\'s standing direction; apply it to everything you build)'];
  if (b.headline) lines.push(`Headline: ${b.headline}`);
  if (b.summary) lines.push(`In short: ${b.summary}`);
  if (l.kind) lines.push(`Making: ${l.kind}`);
  if (b.forWhom) lines.push(`Who it is for: ${b.forWhom}`);
  if (l.problem) lines.push(`The problem today: ${l.problem}`);
  if (l.good) lines.push(`Good looks like: ${l.good}`);
  if (l.proof) lines.push(`We will know it worked when: ${l.proof}`);
  if (l.firstBuild) lines.push(`First build: ${l.firstBuild}`);
  if (l.tools) lines.push(`Tools and style: ${l.tools}`);
  if (l.look) lines.push(`Look and feel: ${l.look}`);
  if (b.keep.length) lines.push('Keep in mind:', ...b.keep.map((i) => `  - ${i.text}`));
  // The Later list is not in the brief Claude reads: it hears nothing from Later until the host sends an item.
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
  lan: LAN.SK_LAN,
  ask: (askId) => `BUILD#ASK#${askId}`,
  resp: (askId, respId) => `BUILD#RESP#${askId}#${respId}`,
  ans: (askId, player) => `BUILD#ANS#${askId}#${player}`,
  vote: (askId, player) => `BUILD#VOTE#${askId}#${player}`,
  log: (iso) => `BUILD#LOG#${timeKey(iso)}`,
  idea: (iso) => `BUILD#IDEA#${timeKey(iso)}`,
  key: (hash) => `BUILD#KEY#${hash}`,
  img: (iso) => `BUILD#IMG#${timeKey(iso)}`,
  // Talking points, research and ideas (docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md).
  point: (iso) => `BUILD#POINT#${timeKey(iso)}`,
  preq: (iso) => `BUILD#PREQ#${timeKey(iso)}`,
  run: 'BUILD#RUN',
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
  if (sk === SK.lan) return 'buildLan';
  if (sk.startsWith('BUILD#ASK#')) return 'buildAsk';
  if (sk.startsWith('BUILD#RESP#') || sk.startsWith('BUILD#ANS#')) return 'buildResponse';
  if (sk.startsWith('BUILD#LOG#')) return 'buildLog';
  if (sk.startsWith('BUILD#IDEA#')) return 'buildIdea';
  if (sk.startsWith('BUILD#IMG#')) return 'buildImage';
  if (sk.startsWith('BUILD#POINT#')) return 'buildPoint';
  if (sk.startsWith('BUILD#PREQ#')) return 'buildPointReq';
  if (sk === SK.run) return 'buildRun';
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
    // Which ready question it came from (`<scope>:<setId>:<question sk>`), so the
    // host's library can say it was asked already (owner, 2026-10-06).
    fromQuestion: cleanText(b.fromQuestion, 200),
    openingStep: OPENING_KEYS.includes(b.openingStep) ? b.openingStep : '',
    probe: b.probe === true,
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
    // An option made from a talking point keeps its point when its words stay.
    next.Options = opts.value.map((o) => {
      const old = (ask.Options || []).find((x) => x.title === o.title && x.pointId);
      return old ? { ...o, pointId: old.pointId } : o;
    });
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
    state: null, activity: null, lan: null, asks: [], resps: [], answers: [], votes: [], logs: [], ideas: [], keys: [], images: [],
    builders: [], tasks: [], shares: [], comments: [], reviews: [], points: [], preqs: [], run: null,
  };
  for (const r of rows || []) {
    const sk = String(r.SK || '');
    if (sk === SK.state) room.state = r;
    else if (sk === SK.activity) room.activity = r;
    else if (sk === SK.lan) room.lan = r;
    else if (sk.startsWith('BUILD#ASK#')) room.asks.push(r);
    else if (sk.startsWith('BUILD#RESP#')) room.resps.push(r);
    else if (sk.startsWith('BUILD#ANS#')) room.answers.push(r);
    else if (sk.startsWith('BUILD#VOTE#')) room.votes.push(r);
    else if (sk.startsWith('BUILD#LOG#')) room.logs.push(r);
    else if (sk.startsWith('BUILD#IDEA#')) room.ideas.push(r);
    else if (sk.startsWith('BUILD#KEY#')) room.keys.push(r);
    else if (sk.startsWith('BUILD#IMG#')) room.images.push(r);
    else if (sk.startsWith('BUILD#POINT#')) room.points.push(r);
    else if (sk.startsWith('BUILD#PREQ#')) room.preqs.push(r);
    else if (sk === SK.run) room.run = r;
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
  // By time first: two posted in the same millisecond keep the order they were made in.
  const byTime = (a, b) => String(a.CreatedAt || '').localeCompare(String(b.CreatedAt || '')) || bySk(a, b);
  room.points.sort(byTime);
  room.preqs.sort(byTime);
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
    options: (ask.Options || []).map((o) => ({ label: o.label, title: o.title, detail: o.detail || '', url: o.url || '', imageId: o.imageId || optionImages(room, ask.AskId)[o.label] || null, ...(isHost && o.pointId ? { pointId: o.pointId } : {}) })),
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
  // A vote made from talking points (Task 2): the host's results step reads these.
  if (isHost && ask.FromPoints && ask.FromPoints.length) out.fromPoints = ask.FromPoints;
  if (isHost && ask.ClaudeGets) out.claudeGets = ask.ClaudeGets;
  if (isHost && ask.ClaudeNote) out.claudeNote = ask.ClaudeNote;
  if (isHost && ask.FromQuestion) out.fromQuestion = ask.FromQuestion;
  // An opening step (and whether it is a probe): phones see the step too, for "step 3 of 9".
  if (ask.OpeningStep) {
    out.openingStep = ask.OpeningStep;
    out.openingIndex = OPENING_KEYS.indexOf(ask.OpeningStep) + 1;
    out.openingOf = OPENING_KEYS.length;
    if (ask.Probe) out.probe = true;
  }
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
      ...(isHost && ask.Decision.heldForLater ? { heldForLater: true } : {}),
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
    as: r.ForAgentAs ? claudeGetsOf(r.ForAgentAs) : null,
    // For Claude, later: on the host's list, not sent (owner, 2026-10-06).
    held: Boolean(r.ForAgentAs === 'later' && !r.ForAgent),
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
    // A finished step carries when it ran; no other entry has this key.
    ...(r.Kind === 'step' ? { step: { startedAt: r.StartedAt || null, endedAt: r.EndedAt || null, durationMs: Number(r.DurationMs) || 0, source: r.Source || 'claude' } } : {}),
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
    promotedVia: r.PromotedVia || null,
    // Sent while a talking point was on the Stage: tied to that point.
    aboutPoint: r.AboutPoint || null,
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

// ── The plugin's version (owner, 2026-10-10) ────────────────────────────────
// The plugin sends its VERSION in X-Engage-Plugin on every call. The server
// keeps the host's Claude's version on the state row (plain: it is a version,
// not content), compares it with the one it knows, and tells the host in
// Session > Claude and Claude in a line of its tool replies. Never the Stage,
// never a device. tests/engage-plugin-version.js keeps this constant equal to
// the plugin's own VERSION, so the two move together.
const LATEST_PLUGIN = '1.15.0';
const PLUGIN_OUTDATED_NOTE = 'The Engage plugin here is out of date; ask the host to run the update command from Connect.';
const PLUGIN_HEADER = 'x-engage-plugin';

/** A clean x.y.z or ''. The header is the caller's word; nothing else is kept. */
const cleanPluginVersion = (v) => (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(v || '').trim()) ? String(v).trim() : '');
/** The version a request announced, from any header casing. */
function pluginVersionOf(event) {
  const h = (event && event.headers) || {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === PLUGIN_HEADER);
  return k ? cleanPluginVersion(h[k]) : '';
}
const pluginOlder = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};
/** The note for Claude's tool replies, or '' when it is current (or did not say). */
const PLUGIN_OUTDATED_NOTE_CREW = 'The Engage plugin here is out of date; update your Engage plugin (run the update command from the Connect panel the host shows).';
const pluginNoteFor = (version, role = 'agent') => (version && pluginOlder(version, LATEST_PLUGIN) ? (role === 'builder' ? PLUGIN_OUTDATED_NOTE_CREW : PLUGIN_OUTDATED_NOTE) : '');
/**
 * The host's view: what is running, what is current, and whether to say so.
 * A Claude that has called in but never announced a version is older than the
 * header itself, so it is out of date.
 */
function pluginView(stateRow) {
  const s = stateRow || {};
  const running = cleanPluginVersion(s.AgentPlugin);
  const seen = Boolean(s.AgentSeenAt);
  return { running, latest: LATEST_PLUGIN, outdated: seen && (!running || pluginOlder(running, LATEST_PLUGIN)) };
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
    // CONNECT STEP 4 (owner, 2026-10-07): when Claude ran /engage:kickoff
    // (room_status with kickoff), and, for older plugins that never say so,
    // when it last listened for the host.
    kickedOffAt: s.KickedOffAt || null,
    listenedAt: s.AgentListeningAt || null,
    name: s.AgentName || 'Claude Code',
    key: live ? { keyId: live.KeyId, label: live.Label || '', createdAt: live.CreatedAt || null, lastUsedAt: live.LastUsedAt || null } : null,
  };
}

const settingsOf = (stateRow) => ({
  reviewAgentAsks: !(stateRow && stateRow.Settings && stateRow.Settings.reviewAgentAsks === false),
  // Whether the Stage's room meter may list who has joined (owner, 2026-10-09). Off until the host says so.
  listNames: Boolean(stateRow && stateRow.Settings && stateRow.Settings.listNames === true),
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


// ── What Claude is doing, in one short line (owner, 2026-10-10) ─────────────
// docs/design/build-room-doing (D6). Two sources feed one line:
//   B  Claude states it (post_update doing/done): wins while fresh;
//   A  the in-progress item of Claude Code's to-do list (the plugin's hook).
// The row keeps both (DoingA, DoingB) plus the helper line; the views resolve
// them. A line that ends becomes ONE `step` timeline entry with its duration.
const DOING_MAX_CHARS = 50;
const DOING_HELPER_MAX_CHARS = 60;
const DOING_MIN_WORDS = 2;
const DOING_STALE_MS = 3 * 60 * 1000;
const DOING_B_FRESH_MS = 15 * 60 * 1000;
const DOING_SOURCES = Object.freeze(['todo', 'claude']);
// A path, a command, a mention, a link, a file name: never for the room. "3.5" is not a file name.
// The plugin carries the same rule (unsafeForRoom); tests/build-doing.js holds them equal over one list.
const DOING_UNSAFE = /[\\/`@]|:\/\/|www\.|\.[A-Za-z][A-Za-z0-9]{0,4}\b/i;
// A helper line outlives neither a quiet Claude (the SubagentStop may have been lost) nor half an hour.
const DOING_HELPER_QUIET_MS = 10 * 60 * 1000;
const DOING_HELPER_MAX_MS = 30 * 60 * 1000;

/**
 * A line, cleaned for the room: plain words, at most 50 characters (cut at the
 * last whole word, no ellipsis), at least two words. '' when it must not be
 * shown (a `/`, backtick, `@`, `://`, a file extension, or too short).
 */
function cleanDoingLine(raw, max = DOING_MAX_CHARS) {
  if (typeof raw !== 'string') return '';
  let t = cleanText(raw, 400).replace(/\s+/g, ' ').trim();
  if (!t || DOING_UNSAFE.test(t)) return '';
  const trail = (x) => x.replace(/[\s.,;:!?-]+$/, '').trim();
  t = trail(t);
  if (t.length > max) {
    const head = t.slice(0, max);
    t = t[max] === ' ' ? head : head.slice(0, Math.max(0, head.lastIndexOf(' ')));
    t = trail(t);
  }
  return t.split(' ').filter(Boolean).length >= DOING_MIN_WORDS ? t : '';
}

// A step never ends before it started (a laptop clock can be behind).
const stepOf = (line, endedAtMs, text) => {
  const started = Date.parse(line.startedAt);
  const end = Number.isFinite(started) ? Math.max(endedAtMs, started) : endedAtMs;
  return {
    text,
    startedAt: line.startedAt,
    endedAt: new Date(end).toISOString(),
    durationMs: Math.max(0, end - (Number.isFinite(started) ? started : end)),
    source: line.source,
  };
};
/** History's words: Claude's own past line, else the to-do item's own words ("Done: Build the bar chart"). */
const stepText = (line) => (line.source === 'claude' && line.past ? line.past : `Done: ${line.past || line.text}`);

const bExpired = (A, B, nowMs) => Boolean(B && A && nowMs - Date.parse(B.at) >= DOING_B_FRESH_MS && Date.parse(A.startedAt) > Date.parse(B.at));

/** The line the room reads: B while fresh, else A, else none. */
function doingWinner(row, nowMs) {
  const A = (row && row.DoingA) || null;
  const B = (row && row.DoingB) || null;
  if (B && !bExpired(A, B, nowMs)) return B;
  return A;
}

/** The helper line, or null once it cannot be trusted: Claude quiet for 10 minutes, or the line 30 minutes old. */
function helperLive(row, nowMs) {
  const H = (row && row.Helper) || null;
  if (!H || !H.text) return null;
  const at = Date.parse(H.at);
  if (Number.isFinite(at) && nowMs - at > DOING_HELPER_MAX_MS) return null;
  const active = Date.parse(row.ActiveAt);
  if (Number.isFinite(active) && nowMs - active > DOING_HELPER_QUIET_MS) return null;
  return H;
}

/**
 * One event applied to the doing record. Pure: returns the fields to keep on
 * BUILD#ACTIVITY (DoingA, DoingB, Helper; the caller owns ActiveAt and
 * DoingRev), the steps to write, and whether the room-visible line moved.
 * Within one event the order is: done, then doing, then helper.
 *   input.source   'todo' | 'claude'
 *   input.done     true | string: the line of `source` that JUST ENDED. For claude a
 *                  string is that line's past tense ("Scaffolded the site"); for todo
 *                  a string is the item's own words; true / '' use the line's own text
 *   input.doing    the line that starts now (string)
 *   input.helper   string sets, '' / null clears, undefined leaves alone
 *   input.waiting  Claude is waiting for direction: everything ends
 */
function applyDoing(prev, input, nowIso) {
  const nowMs = Date.parse(nowIso);
  const row = prev || {};
  let A = row.DoingA || null;
  let B = row.DoingB || null;
  let H = helperLive(row, nowMs);
  const before = doingWinner(row, nowMs);
  const beforeKey = JSON.stringify([before && before.text, H && H.text]);
  const steps = [];
  const aVisible = () => !(B && !bExpired(A, B, nowMs));
  const endA = (text) => {
    if (A && aVisible()) steps.push(stepOf(A, nowMs, text ? `Done: ${text}` : stepText(A)));
    // An item finished that was never seen in progress (a batch can hold several): a step with no duration.
    else if (!A && text && aVisible()) steps.push(stepOf({ startedAt: nowIso, source: 'todo' }, nowMs, `Done: ${text}`));
    A = null;
  };
  const endB = (endMs = nowMs) => { if (B) steps.push(stepOf(B, endMs, stepText(B))); B = null; };
  // An expired B ended when the to-do list took over, not when somebody next posted.
  const expire = () => { if (bExpired(A, B, nowMs)) endB(Math.min(nowMs, Math.max(Date.parse(B.at), Date.parse(A.startedAt)))); };
  const inp = input || {};

  if (inp.waiting) {
    // B first: A's end is not a step while B was the line the room read.
    expire();
    const aWasVisible = aVisible();
    // A line the room last heard of long ago ended then, not when Claude finally stopped to wait.
    const lastMs = Date.parse(row.ActiveAt);
    const endMs = Number.isFinite(lastMs) && nowMs - lastMs > DOING_STALE_MS ? Math.min(nowMs, lastMs) : nowMs;
    if (B) endB(endMs);
    if (A && aWasVisible) steps.push(stepOf(A, endMs, stepText(A)));
    A = null; B = null; H = null;
  } else {
    expire();
    const src = inp.source === 'claude' ? 'claude' : 'todo';
    if (inp.done) {
      const given = typeof inp.done === 'string' ? cleanDoingLine(inp.done) : '';
      if (src === 'todo') endA(given || undefined);
      else if (B) { if (given) B = { ...B, past: given }; endB(); }
    }
    // A line that cannot go on screen (a file name, a link, too short) is IGNORED,
    // never taken as "the line ended": the line the room is reading stays (dev walk, 2026-10-10).
    const refused = typeof inp.doing === 'string' && inp.doing.trim() !== '' && !cleanDoingLine(inp.doing);
    if (!refused && (typeof inp.doing === 'string' || inp.doing === null)) {
      const text = cleanDoingLine(inp.doing);
      if (src === 'todo') {
        if (!text) endA();
        else if (A && A.text === text) A = { ...A, at: nowIso };
        else { endA(); A = { text, source: 'todo', startedAt: nowIso, at: nowIso }; }
      } else if (!text) endB();
      else if (B && B.text === text) B = { ...B, at: nowIso };
      else { endB(); B = { text, source: 'claude', startedAt: nowIso, at: nowIso }; }
    }
    if (inp.helper !== undefined) {
      const h = inp.helper ? cleanDoingLine(inp.helper, DOING_HELPER_MAX_CHARS) : '';
      // Same rule for the helper: an unsafe helper line leaves the current one alone.
      if (h || !inp.helper) H = h ? { text: h, at: nowIso } : null;
    }
    expire();
  }

  const fields = {
    ...(A ? { DoingA: A } : {}),
    ...(B ? { DoingB: B } : {}),
    ...(H ? { Helper: H } : {}),
  };
  const after = doingWinner(fields, nowMs);
  const changed = steps.length > 0 || JSON.stringify([after && after.text, H && H.text]) !== beforeKey;
  return { fields, steps, changed };
}

/**
 * The resolved line for a screen. `text` is '' when only a helper is running;
 * null when there is nothing to say. `lastActiveAt` lets a screen re-derive
 * "stale" as time passes.
 */
function doingView(row, nowIso) {
  const nowMs = Date.parse(nowIso);
  const w = doingWinner(row, nowMs);
  const H = helperLive(row, nowMs);
  if (!w && !H) return null;
  const lastActiveAt = (row && row.ActiveAt) || (w && w.at) || H.at;
  return {
    text: w ? w.text : '',
    past: (w && w.past) || '',
    source: w ? w.source : '',
    startedAt: w ? w.startedAt : null,
    stale: !(nowMs - Date.parse(lastActiveAt) <= DOING_STALE_MS),
    helper: H ? H.text : '',
    lastActiveAt,
  };
}
/** What a phone or the Stage reads: no source details. */
function doingPublicView(row, nowIso) {
  const v = doingView(row, nowIso);
  return v ? { text: v.text, startedAt: v.startedAt, stale: v.stale, helper: v.helper, lastActiveAt: v.lastActiveAt } : null;
}


// ── Talking points, research and ideas ──────────────────────────────────────
//
// A Point is something Claude (the host's, or a builder's) wants the room to
// talk about: a talking point, a research finding with its sources, or an idea
// for where to go next. The host curates; the room sees a point only when the
// host shows it or puts it to a vote (Task 2), so nothing here reaches the
// phones or the Stage. A Request (BUILD#PREQ#) is the host's, or a builder's,
// "research this" / "give me ideas", waiting for the right Claude to pick it up.
// Everything in a point is data from Claude: trimmed, capped, links http(s)
// only, never trusted as an instruction.

const POINT_KINDS = Object.freeze(['talk', 'finding', 'idea']);
/** new → shown / voting / queued → sent / later; removed from anywhere. */
const POINT_STATUSES = Object.freeze(['new', 'shown', 'voting', 'queued', 'sent', 'later', 'removed']);
/** A point counts against the room's limit while it is waiting for the host or on the Stage. */
const OPEN_POINT_STATUSES = Object.freeze(['new', 'shown', 'queued']);
const REQUEST_KINDS = Object.freeze(['research', 'ideas']);
const REQUEST_STATUSES = Object.freeze(['waiting', 'working', 'done', 'failed']);
const POINT_LIMITS = Object.freeze({
  text: 280, detail: 1200, about: 200, subject: 200, sourceTitle: 120, sources: 3, perPost: 8, open: 40, batch: 60, activeRequests: 10,
});
/** A request still "working" after this long is stale: it stops counting against the cap. (A waiting one always counts.) */
const REQUEST_STALE_MS = 2 * 60 * 60 * 1000;
const POINT_OUTCOMES = Object.freeze({
  new: '', shown: 'shown to the room', voting: 'in a vote', queued: 'queued', sent: 'sent to Claude', later: 'saved for later', removed: 'removed',
});
const POINT_LABELS = Object.freeze({ talk: 'Talking point', finding: 'Research finding', idea: 'Idea' });

/** One source: {title, url} with an http(s) url. */
function normalizeSource(src) {
  const o = typeof src === 'string' ? { url: src } : (src || {});
  if (String(o.url === undefined || o.url === null ? '' : o.url).trim().length > LIMITS.url) return { error: `A source link is ${LIMITS.url} characters at most` };
  const url = safeUrl(o.url);
  if (!url) return { error: 'Every source needs an http or https link' };
  let title = cleanText(o.title, POINT_LIMITS.sourceTitle);
  if (!title) { try { title = new URL(url).hostname; } catch (e) { title = url; } }
  return { value: { title, url } };
}

/** One posted point, cleaned; `{error}` is a plain sentence the plugin can relay. */
function normalizePoint(p) {
  const b = p && typeof p === 'object' ? p : {};
  const kind = String(b.kind || '').trim().toLowerCase();
  if (!POINT_KINDS.includes(kind)) return { error: `kind must be ${POINT_KINDS.join(', ')}` };
  const rawText = String(b.text === undefined || b.text === null ? '' : b.text).trim();
  if (!rawText) return { error: 'Write the point' };
  if (rawText.length > POINT_LIMITS.text) return { error: `A point is ${POINT_LIMITS.text} characters at most; put the rest in detail` };
  let sources = [];
  if (b.sources !== undefined && b.sources !== null) {
    if (!Array.isArray(b.sources)) return { error: 'sources must be a list of {title, url}' };
    if (b.sources.length > POINT_LIMITS.sources) return { error: `A point takes up to ${POINT_LIMITS.sources} sources` };
    for (const src of b.sources) {
      const n = normalizeSource(src);
      if (n.error) return { error: n.error };
      sources.push(n.value);
    }
  }
  if (kind === 'finding' && !sources.length) return { error: 'A finding needs at least one source: a title and an http or https link' };
  sources = sources.slice(0, POINT_LIMITS.sources);
  return {
    value: {
      kind,
      text: cleanText(rawText, POINT_LIMITS.text),
      detail: cleanText(b.detail, POINT_LIMITS.detail),
      sources,
      about: cleanText(b.about, POINT_LIMITS.about),
    },
  };
}

/** A posted batch: 1 to 8 points (or none, when it only closes a request). */
function normalizePointsPost(body) {
  const b = body || {};
  const list = Array.isArray(b.points) ? b.points : [];
  if (list.length > POINT_LIMITS.perPost) return { error: `Post up to ${POINT_LIMITS.perPost} points at a time` };
  const done = b.done === true;
  const ID_OK = /^[A-Za-z0-9_-]{1,60}$/;
  const idOf1 = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const requestId = idOf1(b.requestId);
  const batchId = idOf1(b.batchId);
  if (requestId && !ID_OK.test(requestId)) return { error: 'requestId is letters, digits, - and _ only (60 at most)' };
  if (batchId && !ID_OK.test(batchId)) return { error: 'batchId is letters, digits, - and _ only (60 at most)' };
  if (done && !requestId) return { error: 'done closes a request: send its requestId too' };
  if (!list.length && !done) return { error: 'Post at least one point' };
  const points = [];
  for (let i = 0; i < list.length; i += 1) {
    const n = normalizePoint(list[i]);
    if (n.error) return { error: list.length > 1 ? `Point ${i + 1}: ${n.error}` : n.error };
    points.push(n.value);
  }
  return { value: { points, done, requestId, batchId } };
}

/** A Research or Ideas request: {kind, subject}. */
function normalizePointRequest(body) {
  const b = body || {};
  const kind = String(b.kind || '').trim().toLowerCase();
  if (!REQUEST_KINDS.includes(kind)) return { error: `kind must be ${REQUEST_KINDS.join(' or ')}` };
  const subject = cleanText(b.subject, POINT_LIMITS.subject + 1);
  if (!subject) return { error: 'Say what to look into' };
  if (subject.length > POINT_LIMITS.subject) return { error: `The subject is ${POINT_LIMITS.subject} characters at most` };
  return { value: { kind, subject } };
}

const idOf = (sk, prefix) => String(sk).slice(prefix.length).replace('#', '-');
const pointIdOf = (sk) => idOf(sk, 'BUILD#POINT#');
const requestIdOf = (sk) => idOf(sk, 'BUILD#PREQ#');

const isOpenPoint = (p) => OPEN_POINT_STATUSES.includes(p.Status || 'new');
const openPointCount = (room) => (room.points || []).filter(isOpenPoint).length;

/** Requests Claude has not finished, for one owner, ignoring stale ones. */
function activeRequests(room, forBuilder, nowMs) {
  return (room.preqs || []).filter((r) => (r.ForBuilder || '') === (forBuilder || '')
    && (r.Status === 'waiting'
      || (r.Status === 'working' && nowMs - (Date.parse(r.UpdatedAt || r.CreatedAt) || 0) < REQUEST_STALE_MS)));
}

function pointView(p) {
  return {
    id: p.PointId,
    kind: p.Kind,
    text: p.Text || '',
    detail: p.Detail || '',
    sources: (p.Sources || []).map((s) => ({ title: s.title, url: s.url })),
    about: p.About || '',
    batchId: p.BatchId || '',
    requestId: p.RequestId || null,
    by: p.By,
    fromBuilder: p.ByRole === 'builder',
    status: p.Status || 'new',
    outcome: p.Outcome || POINT_OUTCOMES[p.Status || 'new'] || '',
    createdAt: p.CreatedAt || null,
  };
}

function requestView(r) {
  return {
    id: r.ReqId,
    kind: r.Kind,
    subject: r.Subject || '',
    for: r.ForBuilder || 'host',
    status: r.Status || 'waiting',
    count: Number(r.Count) || 0,
    createdAt: r.CreatedAt || null,
    updatedAt: r.UpdatedAt || r.CreatedAt || null,
  };
}

/** Whose Claude posted this point: the host's (role 'agent') or one builder's. */
const isOwnPoint = (p, who) => (who.role === 'builder' ? p.ByRole === 'builder' && p.By === who.name : p.ByRole !== 'builder');
const isOwnRequest = (r, who) => (who.role === 'builder' ? r.ForBuilder === who.name : !r.ForBuilder);

/** The host's Points panel: every point still on the list, every request, the open count. */
function pointsHostView(room) {
  return {
    items: (room.points || []).filter((p) => p.Status !== 'removed').map(pointView),
    requests: (room.preqs || []).map(requestView),
    open: openPointCount(room),
  };
}

/** What a Claude sees: its own requests and the fate of its own points, not the host's list. */
function pointsClaudeView(room, who) {
  return {
    digest: (room.points || []).filter((p) => isOwnPoint(p, who)).map((p) => {
      const v = pointView(p);
      return { id: v.id, status: v.status, outcome: v.outcome };
    }),
    requests: (room.preqs || []).filter((r) => isOwnRequest(r, who)).map(requestView),
    open: openPointCount(room),
  };
}

/**
 * A builder's own screen: the fate of their own Claude's points and their own
 * requests, nothing else. Words and state only (no sources list, no detail);
 * never another builder's point, never the host's own.
 */
function pointsBuilderView(room, name) {
  const who = { role: 'builder', name };
  return {
    items: (room.points || []).filter((p) => p.Status !== 'removed' && isOwnPoint(p, who)).map((p) => {
      const v = pointView(p);
      return { id: v.id, kind: v.kind, text: v.text, status: v.status, outcome: v.outcome, createdAt: v.createdAt };
    }),
    requests: (room.preqs || []).filter((r) => isOwnRequest(r, who)).map(requestView),
  };
}

/** The line a point leaves on the Later list: its words, and where a finding came from. */
function pointLaterText(p) {
  const src = (p.Sources || [])[0];
  return p.Kind === 'finding' && src ? `${oneLine(p.Text)} (${src.url})` : oneLine(p.Text);
}

/** One line: newlines and runs of spaces collapse, so a point cannot start a line of its own in a direction. */
const oneLine = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();

/** The words a point carries to Claude when the host sends it. `withDetail: false` drops the Detail line. */
function pointDirectionText(p, { withDetail = true } = {}) {
  const from = p.ByRole === 'builder' ? `From ${oneLine(p.By)}'s Claude: ` : '';
  const bits = [`${from}${POINT_LABELS[p.Kind] || 'Point'}: ${oneLine(p.Text)}`];
  if (withDetail && p.Detail) bits.push(oneLine(p.Detail));
  for (const s of p.Sources || []) bits.push(`Source: ${oneLine(s.title)} (${s.url})`);
  return bits.join('\n');
}

/**
 * One direction for one or more points. Never cut: if it is over the direction
 * limit the Detail lines go first; if it is still over, `{error}`.
 */
function pointsDirection(rows) {
  const build = (withDetail) => (rows.length === 1
    ? pointDirectionText(rows[0], { withDetail })
    : `${rows.length} points from the room's list:\n\n${rows.map((p) => pointDirectionText(p, { withDetail })).join('\n\n')}`);
  for (const withDetail of [true, false]) {
    const text = build(withDetail);
    if (text.length <= LIMITS.direction) return { value: text };
  }
  return { error: 'Too much to send at once; send fewer' };
}

// ── Talking points, Task 2: the vote, the run list, the Stage ───────────────

/** A vote made from points takes 2 to 8 (more than the 6 an ideas vote takes), 1 to 5 picks each. */
const POINT_VOTE = Object.freeze({ min: 2, max: 8, picks: 3, maxPicks: 5 });
const DEFAULT_POINT_VOTE_PROMPT = 'Which of these should we take forward?';
const RUN_MAX_ITEMS = 8;
const RUN_STATES = Object.freeze(['pending', 'doing', 'done', 'skipped']);

/** "webaim.org" from a link, for the Stage ("Source: webaim.org"). */
function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

/** The ask the vote becomes. Options carry the point they came from. */
function pointVoteAsk(points, body) {
  const b = body || {};
  if (points.length < POINT_VOTE.min) return { error: `Tick at least ${POINT_VOTE.min} points to put to a vote` };
  if (points.length > POINT_VOTE.max) return { error: `A vote takes at most ${POINT_VOTE.max} points` };
  let picks = POINT_VOTE.picks;
  if (b.maxPicks !== undefined && b.maxPicks !== null && b.maxPicks !== '') {
    const mp = Number(b.maxPicks);
    if (!Number.isInteger(mp) || mp < 1 || mp > POINT_VOTE.maxPicks) return { error: `Picks each is a whole number from 1 to ${POINT_VOTE.maxPicks}` };
    picks = mp;
  }
  const options = points.map((p, n) => {
    const text = cleanText(p.Text, LIMITS.idea);
    const title = text.length > LIMITS.optionTitle ? `${text.slice(0, LIMITS.optionTitle - 1).trimEnd()}…` : text;
    return { label: labelFor(n), title, detail: text.length > LIMITS.optionTitle ? text : '', url: '', pointId: p.PointId };
  });
  return {
    value: {
      kind: 'choice',
      prompt: cleanText(b.prompt, LIMITS.prompt) || DEFAULT_POINT_VOTE_PROMPT,
      detail: cleanText(b.detail, LIMITS.detail),
      options,
      maxPicks: Math.min(picks, options.length),
    },
  };
}

/** What each point got in a vote: pointId -> count of people who picked it. */
function pointVoteCounts(ask, room) {
  const t = tally(ask, room);
  const out = {};
  for (const o of t.options || []) {
    const src = (ask.Options || []).find((x) => x.label === o.label);
    if (src && src.pointId) out[src.pointId] = o.count;
  }
  return out;
}

/** The point's fate in plain words, with the vote that got it there when it had one. */
function outcomeFor(p, label) {
  if (!label) return '';
  return p.VoteCount !== undefined && p.VoteCount !== null ? `voted ${p.VoteCount}, ${label}` : label;
}

/** Point ids waiting their turn in a list that is running: other moves on them are refused. */
function runPendingIds(room) {
  const r = room.run;
  if (!r || r.Status !== 'running') return new Set();
  const marks = r.Marks || [];
  return new Set((r.Items || []).filter((it, i) => (marks[i] || 'pending') === 'pending').map((it) => it.pointId));
}

/**
 * The direction one run item carries. Capped so the "Run list, item k of n:"
 * line in front still fits the direction limit; never cut.
 */
function runDirection(p) {
  const room = LIMITS.direction - 80;
  for (const withDetail of [true, false]) {
    const text = pointDirectionText(p, { withDetail });
    if (text.length <= room) return { value: text };
  }
  return { error: 'One of those is too long to send on its own; shorten it first' };
}
const runItemText = (k, n, dir) => `Run list, item ${k} of ${n}: ${dir}`;

/**
 * The run list. The host (and its Claude) see every item with its state and times;
 * the room sees the words, the kind, the source site and the state: no point ids,
 * no notes, no one's name but a builder's tag on their own point.
 */
function runView(run, audience) {
  if (!run) return null;
  const isHost = audience === 'host' || audience === 'agent';
  const items = Array.isArray(run.Items) ? run.Items : [];
  const marks = run.Marks || [];
  const cur = Number(run.Cur) || 0;
  const list = items.map((it, i) => ({
    k: i + 1,
    text: it.text || '',
    kind: it.kind || 'talk',
    site: it.site || '',
    state: marks[i] || 'pending',
    ...(isHost && it.byBuilder ? { by: it.byBuilder } : {}),
    ...(isHost ? { pointId: it.pointId, sentAt: (run.SentAt || [])[i] || null, doneAt: (run.DoneAt || [])[i] || null, note: it.note || '' } : {}),
  }));
  const out = {
    status: run.Status || 'running',
    ...(isHost ? { runId: run.RunId } : {}),
    cur,
    total: items.length,
    startedAt: run.StartedAt || null,
    finishedAt: run.FinishedAt || null,
    items: list,
  };
  if (isHost) {
    const nextIdx = marks.findIndex((m, i) => i < items.length && (m || 'pending') === 'pending');
    out.claudeDone = Boolean(cur && marks[cur - 1] === 'done');
    out.next = nextIdx >= 0 ? nextIdx + 1 : null;
    out.ver = Number(run.Ver) || 0;
  }
  return out;
}

/** The point on the Stage, as the room may see it: words, kind, source site, who it came from. */
function shownPointView(room) {
  const p = (room.points || []).find((x) => x.Status === 'shown');
  if (!p) return null;
  const src = (p.Sources || [])[0];
  return {
    kind: p.Kind,
    text: p.Text || '',
    site: src ? siteOf(src.url) : '',
    from: p.ByRole === 'builder' ? p.By : 'claude',
  };
}

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
    // The Session panel's "Claude's plugin is out of date" line. Claude and the room never get it.
    ...(isAgent ? {} : { plugin: pluginView(room.state) }),
    activity: activityView(room.activity),
    ...(isAgent ? {} : { doing: doingView(room.activity, now) }),
    lan: LAN.lanHostView(room.lan, now, { withKey: !isAgent }),
    currentAskId: (room.state && room.state.CurrentAskId) || null,
    asks: room.asks.map((a) => askView(a, room, audience)),
    // Host notes are the host's own; Claude never sees them.
    // A builder's own deliveries (feedback, the base moving) are plumbing; the
    // crew entries beside them say what happened.
    // Claude hears nothing from Later until the host sends it: held entries are not in its view.
    log: room.logs.filter((l) => !l.ForBuilder && !(isAgent && (PRIVATE_LOG_KINDS.includes(l.Kind) || (l.ForAgentAs === 'later' && !l.ForAgent)))).map(logView),
    ideas: isAgent ? [] : room.ideas.map(ideaView),
    wallComment: isAgent ? null : wallCommentView(room.state),
    // Claude's copy has no Later list: it hears an item only when the host sends it.
    brief: isAgent ? { ...briefView(room.state), later: [] } : briefView(room.state),
    opening: openingView(room.state, room),
    briefDraft: isAgent ? null : draftView(room.state),
    images: room.images.map(imageView),
    points: isAgent ? pointsClaudeView(room, { role: 'agent' }) : pointsHostView(room),
    run: runView(room.run, audience),
    shownPoint: shownPointView(room),
    outcome: outcomeView(room.state && room.state.Outcome),
    rev: (room.state && room.state.Rev) || 0,
  };
}

/** What a phone sees. */
function publicView({ gameId, meta, sessionState, room, players, me, now }) {
  const lanLink = LAN.lanTranslator(room.lan, now);
  const forRoom = (u) => (u && !isLocalUrl(u) ? u : (u ? lanLink(u) : ''));
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
    current: current ? publicAsk(askView(current, room, 'public', me), forRoom) : null,
    decisions: visibleAsks.filter((a) => a.Status === 'decided' && a.Decision).map((a) => ({
      askId: a.AskId, prompt: a.Prompt || '', direction: a.Decision.direction || '', decidedAt: a.DecidedAt || null,
    })),
    // A phone sees the timeline the room made, not the host's working:
    // directions are Claude's copy of a decision the phone already sees (and
    // carry the host's note), and a decision's or idea's detail is the host's
    // note or the idea's author.
    log: room.logs.filter((l) => !l.ForBuilder && !PRIVATE_LOG_KINDS.includes(l.Kind) && !PHONE_HIDDEN_LOG_KINDS.includes(l.Kind)).map(logView)
      .map(({ forAgent, deliveredAt, as, held, step, ...rest }) => ({
        ...(DETAIL_PRIVATE_LOG_KINDS.includes(rest.kind) ? { ...rest, detail: '' } : rest),
        // A phone sees when a step ran, not where Claude took it from.
        ...(step ? { step: { startedAt: step.startedAt, endedAt: step.endedAt, durationMs: step.durationMs } } : {}),
      }))
      .map((l) => ({ ...l, link: forRoom(l.link) })),
    myIdeas: me ? room.ideas.filter((i) => i.PlayerName === me.playerName && i.Source !== 'host').map(ideaView) : [],
    images: room.images.map(imageView),
    outcome: publicOutcome(outcomeView(room.state && room.state.Outcome), forRoom),
    doing: doingPublicView(room.activity, now),
    lan: LAN.lanPublicView(room, now),
    // The room sees a point only when the host shows it, and the run list once it starts.
    shownPoint: shownPointView(room),
    run: room.run && room.run.Status === 'running' ? runView(room.run, 'public') : null,
    agentConnected: agentStatus(room.state, [], now || new Date().toISOString()).connected,
    mine,
    rev: (room.state && room.state.Rev) || 0,
  };
}

/** A phone's copy of an ask: a preview it cannot open is not offered. */
function publicAsk(ask, forRoom = publicUrl) {
  return { ...ask, options: ask.options.map((o) => ({ ...o, url: forRoom(o.url) })) };
}
function publicOutcome(o, forRoom = publicUrl) {
  return o ? { ...o, links: o.links.map((l) => ({ ...l, url: forRoom(l.url) })).filter((l) => l.url) } : o;
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
// Only when the sentence carries a score: "add dark mode" is a direction, not a
// rating, and must not grow a bracket about a scale (owner, 2026-10-06).
const carriesScore = (text) => /\b[1-5](\.\d+)?\b|out of 5/i.test(text);
const withRatingMeaning = (kind, direction) => (kind !== 'rating' || !direction || /needs work/i.test(direction) || !carriesScore(direction) ? direction : `${direction} ${RATING_MEANING}`);

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
  DOING_MAX_CHARS, DOING_STALE_MS, DOING_B_FRESH_MS, DOING_SOURCES, cleanDoingLine, applyDoing, doingView, doingPublicView,
  roomFromRows, tally, askView, logView, ideaView, outcomeView, agentStatus, settingsOf,
  LATEST_PLUGIN, PLUGIN_OUTDATED_NOTE, PLUGIN_OUTDATED_NOTE_CREW, cleanPluginVersion, pluginVersionOf, pluginNoteFor, pluginView,
  WHEEL_MIN, WHEEL_MAX, WHEEL_KEEP_SPINS, tiedIds, wheelSlices, wheelView, wheelLanded,
  WALL_COMMENT_MS, wallCommentView, DRAFT_LIMITS, normalizeDraft, draftView, OPENING_STEPS, OPENING_KEYS, OPENING_KINDS, BRIEF_LINES, briefWithStep, phaseOf, openingView, CLAUDE_GETS, claudeGetsOf, briefView, briefWith, normalizeBrief, briefText, BRIEF_MAX_ITEMS, voteFromIdeas, mockupDirection, mockupProgress, DEFAULT_VOTE_PROMPT, questionAnswer, DECISION_METHODS, RATING_SCALE, ratingAnswer, withRatingMeaning,
  POINT_KINDS, POINT_STATUSES, OPEN_POINT_STATUSES, REQUEST_KINDS, REQUEST_STATUSES, POINT_LIMITS, REQUEST_STALE_MS, POINT_OUTCOMES,
  normalizePoint, normalizePointsPost, normalizePointRequest, pointIdOf, requestIdOf, isOpenPoint, openPointCount, activeRequests,
  POINT_VOTE, RUN_MAX_ITEMS, RUN_STATES, siteOf, pointVoteAsk, pointVoteCounts, outcomeFor, runPendingIds, runDirection, runItemText, runView, shownPointView,
  pointView, requestView, isOwnPoint, isOwnRequest, pointsHostView, pointsClaudeView, pointsBuilderView, pointDirectionText, pointLaterText, pointsDirection, oneLine,
  hostView, publicView, pendingDirections, pendingForBuilder, inboxText, inboxFrom, defaultDirection,
};
