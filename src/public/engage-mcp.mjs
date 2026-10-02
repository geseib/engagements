#!/usr/bin/env node
/**
 * Engage Build Room — MCP server for Claude Code.
 *
 * Lets Claude Code collaborate with a live room through Engage: ask the room
 * for ideas, let it choose between labelled mockups, take a 1–5 pulse, wait
 * for the host's decision, post progress to the wall, and wrap up.
 *
 * One file, zero dependencies, Node 18+ (uses the built-in fetch).
 * Speaks MCP over stdio: newline-delimited JSON-RPC 2.0. Logs go to stderr
 * only — stdout carries protocol messages and nothing else.
 *
 * Setup (the Build Room page renders this with the real values):
 *   curl -fsSL https://engage.dev.seibtribe.us/engage-mcp.mjs -o ~/.engage-mcp.mjs
 *   claude mcp add engage --env ENGAGE_API=<api base> --env ENGAGE_KEY=eng_1234_… -- node ~/.engage-mcp.mjs
 *
 * Environment:
 *   ENGAGE_API      API base URL, e.g. https://xxxx.execute-api.us-east-1.amazonaws.com/dev/
 *   ENGAGE_KEY      session key minted on the Build Room page: eng_<gameId>_<secret>
 *   ENGAGE_POLL_MS  (optional) wait_for_room poll interval in ms, default 3000
 */

const VERSION = '1.0.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';

const POLL_MS = Math.max(10, Number(process.env.ENGAGE_POLL_MS) || 3000);
const REQUEST_TIMEOUT_MS = 30000;

function log(...args) {
  process.stderr.write(`[engage-mcp] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readConfig() {
  const key = (process.env.ENGAGE_KEY || '').trim();
  let api = (process.env.ENGAGE_API || '').trim();
  const problems = [];
  let gameId = null;
  if (!key) problems.push('ENGAGE_KEY is not set.');
  else {
    const m = /^eng_(\d+)_(.+)$/.exec(key);
    if (!m) problems.push('ENGAGE_KEY does not look like an Engage session key (expected eng_<gameId>_<secret>).');
    else gameId = m[1];
  }
  if (!api) problems.push('ENGAGE_API is not set.');
  else if (!/^https?:\/\//i.test(api)) problems.push(`ENGAGE_API must be an http(s) URL (got "${api}").`);
  else api = api.replace(/\/+$/, '') + '/';
  return { key, api, gameId, problems };
}

const CONFIG = readConfig();

function configHelp() {
  return [
    'The Engage MCP server is not configured, so it cannot reach the room.',
    '',
    ...CONFIG.problems.map(p => `- ${p}`),
    '',
    'How to fix: the host opens the session\'s Build Room page in Engage, mints a key under',
    '"Connect Claude Code", and runs the command it shows, which looks like:',
    '  claude mcp add engage --env ENGAGE_API=<api base> --env ENGAGE_KEY=eng_1234_… -- node ~/.engage-mcp.mjs',
    'Then restart Claude Code so the server picks up the environment.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function api(method, path, body, signal) {
  const url = `${CONFIG.api}games/${CONFIG.gameId}/build/${path}`;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const sig = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal || timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.key}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: sig,
    });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    throw new ApiError(0, `Could not reach Engage at ${CONFIG.api} (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`);
  }
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || raw.slice(0, 300) || res.statusText;
    throw new ApiError(res.status, String(msg), data);
  }
  if (data === null) throw new ApiError(res.status, 'Engage returned a response that is not JSON.');
  return data;
}

function errorResult(e) {
  if (e instanceof ApiError) {
    const lines = [`Engage API error${e.status ? ` (HTTP ${e.status})` : ''}: ${e.message}`];
    if (e.status === 401 || e.status === 403) {
      lines.push('',
        'The session key was refused. It may have been revoked (minting a new key revokes the old one),',
        'it may belong to a different session, or the session may have ended. The host can mint a new key',
        'on the session\'s Build Room page and re-run the "claude mcp add engage …" command it shows.');
    } else if (e.status === 404) {
      lines.push('', 'Engage could not find that. Check the askId (call room_status to list asks).');
    } else if (e.status === 0) {
      lines.push('', 'Check ENGAGE_API and your network connection.');
    }
    if (e.body && Array.isArray(e.body.inbox) && e.body.inbox.length) lines.push(renderInbox(e.body.inbox));
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
  }
  return { content: [{ type: 'text', text: `engage-mcp failed: ${e && e.message ? e.message : String(e)}` }], isError: true };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KIND_NAMES = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate' };

function s(v) { return v === undefined || v === null ? '' : String(v); }
function trunc(v, n) { const t = s(v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

function renderInbox(inbox) {
  if (!Array.isArray(inbox) || !inbox.length) return '';
  const lines = ['', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `DIRECTION FROM THE ROOM (via the host)${inbox.length > 1 ? ` — ${inbox.length} items` : ''}:`];
  for (const d of inbox) {
    const tags = [d.from ? `from ${d.from}` : '', d.askId ? `re ask ${d.askId}` : ''].filter(Boolean).join(', ');
    lines.push(`  • ${s(d.text)}${tags ? `  (${tags})` : ''}`);
  }
  lines.push('Act on this now: it is the host\'s word and takes priority over your current plan.',
    'Fold it into what you are building, then post_update to say what you changed.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

function statusLine(ask) {
  const st = s(ask.status);
  const hint = {
    proposed: 'waiting for the host to review it and open it to the room',
    live: 'open — the room is answering',
    voting: 'the room is voting on suggestions',
    results: 'closed — the host is reviewing the results',
    decided: 'decided by the host',
    discarded: 'discarded by the host',
  }[st];
  return hint ? `${st} (${hint})` : st;
}

function renderResults(ask) {
  const r = ask.results || {};
  const lines = [];
  if (ask.kind === 'choice') {
    const opts = Array.isArray(r.options) && r.options.length ? r.options : (ask.options || []).map(o => ({ ...o, count: 0, pct: 0 }));
    lines.push(`Results (${r.total || 0} respondent${r.total === 1 ? '' : 's'}):`);
    for (const o of opts) {
      lines.push(`  Choice ${o.label} — ${s(o.title)}: ${o.count || 0} (${Math.round(Number(o.pct) || 0)}%)`);
    }
  } else if (ask.kind === 'rating') {
    const rt = r.rating || {};
    const sc = ask.scale || {};
    const avg = typeof rt.avg === 'number' ? rt.avg.toFixed(1) : '—';
    lines.push(`Results: average ${avg} / ${sc.max || 5} from ${rt.count || 0} rating${rt.count === 1 ? '' : 's'}` +
      (sc.lowLabel || sc.highLabel ? `  (1 = ${s(sc.lowLabel) || 'low'}, ${sc.max || 5} = ${s(sc.highLabel) || 'high'})` : ''));
    if (Array.isArray(rt.dist)) lines.push('  ' + rt.dist.map((n, i) => `${i + 1}: ${n}`).join('   '));
  } else {
    const ranked = Array.isArray(r.ranked) ? r.ranked : [];
    lines.push(`Suggestions (${ranked.length}${r.total ? `, ${r.total} voter${r.total === 1 ? '' : 's'}` : ''}):`);
    if (!ranked.length && Array.isArray(ask.responses)) {
      for (const x of ask.responses.filter(x => !x.hidden)) lines.push(`  - ${s(x.text)}${x.votes ? ` (${x.votes} votes)` : ''}  [${x.respId}]`);
    }
    ranked.slice(0, 15).forEach((x, i) => {
      lines.push(`  ${i + 1}. ${s(x.text)} — ${x.votes || 0} vote${x.votes === 1 ? '' : 's'}  [${x.respId}]`);
    });
    if (ranked.length > 15) lines.push(`  … and ${ranked.length - 15} more`);
  }
  const whys = Array.isArray(r.whys) ? r.whys : [];
  if (whys.length) {
    lines.push('Why people chose what they did:');
    for (const w of whys.slice(0, 12)) {
      const tag = w.label ? `[${w.label}]` : (w.rating !== undefined && w.rating !== null ? `[${w.rating}/5]` : '');
      lines.push(`  ${tag} "${s(w.text)}"${w.playerName ? ` — ${w.playerName}` : ''}`);
    }
    if (whys.length > 12) lines.push(`  … and ${whys.length - 12} more`);
  }
  return lines.join('\n');
}

function renderAsk(ask, { heading = true } = {}) {
  const lines = [];
  if (heading) {
    lines.push(`Ask ${ask.askId} · ${KIND_NAMES[ask.kind] || ask.kind}: "${s(ask.prompt)}"`);
    lines.push(`Status: ${statusLine(ask)}`);
  }
  const d = ask.decision;
  if (d && (ask.status === 'decided' || d.direction)) {
    lines.push('', 'THE HOST\'S DIRECTION (final — build this):', `  ${s(d.direction) || '(no direction text)'}`);
    if (Array.isArray(d.chosen) && d.chosen.length) {
      const names = d.chosen.map(c => {
        const o = (ask.options || []).find(o => o.label === c);
        if (o) return `Choice ${c} — ${s(o.title)}`;
        const resp = (ask.responses || []).find(x => x.respId === c) || ((ask.results || {}).ranked || []).find(x => x.respId === c);
        return resp ? `"${s(resp.text)}"` : c;
      });
      lines.push(`  Chosen: ${names.join('; ')}`);
    }
    if (d.note) lines.push(`  Host's note: ${s(d.note)}`);
  }
  if (ask.status !== 'proposed') { lines.push(''); lines.push(renderResults(ask)); }
  return lines.join('\n');
}

function badgeSnippet(label) {
  return `<div class="engage-choice-badge" style="position:fixed;top:16px;right:16px;z-index:2147483647;` +
    `background:#111;color:#fff;font:800 32px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.02em;` +
    `padding:14px 24px;border-radius:14px;border:4px solid #FFD400;box-shadow:0 6px 24px rgba(0,0,0,.5);` +
    `pointer-events:none">Choice ${label}</div>`;
}

function renderState(st) {
  const lines = [];
  lines.push(`Engage Build Room · session ${s(st.gameId) || CONFIG.gameId}${st.title ? ` — ${s(st.title)}` : ''}`);
  lines.push(`Goal: ${s(st.goal) || '(no goal set)'}`);
  const n = typeof st.playerCount === 'number' ? st.playerCount : (st.players || []).length;
  lines.push(`Room: ${n} player${n === 1 ? '' : 's'} joined${st.state ? ` · session ${s(st.state)}` : ''}` +
    (st.settings && typeof st.settings.reviewAgentAsks === 'boolean'
      ? ` · your asks ${st.settings.reviewAgentAsks ? 'go to the host for review first' : 'open to the room directly'}` : ''));
  const asks = Array.isArray(st.asks) ? st.asks : [];
  const cur = st.currentAskId ? asks.find(a => a.askId === st.currentAskId) : null;
  if (cur) {
    lines.push('', `Current ask ${cur.askId} · ${KIND_NAMES[cur.kind] || cur.kind}: "${trunc(cur.prompt, 140)}" — ${statusLine(cur)}`);
    const t = (cur.results || {}).total;
    if (t) lines.push(`  ${t} response${t === 1 ? '' : 's'} so far`);
  } else {
    lines.push('', 'Current ask: none');
  }
  const pending = asks.filter(a => a !== cur && ['proposed', 'live', 'voting', 'results'].includes(a.status));
  if (pending.length) {
    lines.push('Other open asks:');
    for (const a of pending) lines.push(`  ${a.askId} · ${KIND_NAMES[a.kind] || a.kind}: "${trunc(a.prompt, 90)}" — ${a.status}`);
  }
  const decided = asks.filter(a => a.status === 'decided' && a.decision).slice(-5);
  if (decided.length) {
    lines.push('', 'Recent decisions:');
    for (const a of decided) lines.push(`  ${a.askId} "${trunc(a.prompt, 70)}" → ${trunc(a.decision.direction, 160)}`);
  }
  const entries = (Array.isArray(st.log) ? st.log : []).filter(e => e.kind !== 'note').slice(-5);
  if (entries.length) {
    lines.push('', 'Recent timeline:');
    for (const e of entries) lines.push(`  [${s(e.kind)}${e.by ? `/${e.by}` : ''}] ${trunc(e.text, 160)}`);
  }
  if (st.outcome && st.outcome.summary) lines.push('', `Wrap-up already posted: ${trunc(st.outcome.summary, 200)}`);
  return lines.join('\n');
}

function ok(text, inbox) {
  return { content: [{ type: 'text', text: text + renderInbox(inbox) }] };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

const TOOLS = [
  {
    name: 'room_status',
    description: 'Read the Engage Build Room: the goal, how many people are in the room, the current ask and its status, recent decisions and the recent timeline. Call this at the start of a session and whenever you need to re-orient. Also delivers any pending directions from the host.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ask_room_for_ideas',
    description: 'Ask the room an open question (Call & Answer): everyone suggests, everyone votes, and the host picks the direction. Use at a real decision point where the room\'s ideas matter — naming, features, content, priorities — not for routine steps. Keep the question short enough to read on a projector. Returns an askId; then call wait_for_room.',
    inputSchema: {
      type: 'object',
      properties: {
        question: str('The question, short and readable from the back of the room (ideally under 90 characters).', { minLength: 1, maxLength: 300 }),
        context: str('Optional one or two sentences of background shown under the question.', { maxLength: 1000 }),
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_room_to_choose',
    description: 'Ask the room to pick between 2–6 concrete options (a poll). Engage assigns the labels Choice A, B, C… and returns a badge snippet for each. Create this ask BEFORE showing mockups, then stamp each mockup with exactly the letter returned so the wall and the phones match what is on screen. Returns an askId; then call wait_for_room.',
    inputSchema: {
      type: 'object',
      properties: {
        question: str('The question, short and readable on a projector, e.g. "Which header should we go with?"', { minLength: 1, maxLength: 300 }),
        context: str('Optional background shown under the question.', { maxLength: 1000 }),
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          description: 'The options, in the order they should be lettered (first = A).',
          items: {
            type: 'object',
            properties: {
              title: str('Short name for the option, e.g. "Bold dark hero".', { minLength: 1, maxLength: 120 }),
              description: str('Optional one-line description.', { maxLength: 500 }),
              url: str('Optional PUBLIC http(s) URL of a preview; phones get an "Open preview" link. Omit for localhost-only mockups.'),
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
        maxPicks: { type: 'integer', minimum: 1, maximum: 6, description: 'How many options each person may pick (default 1).' },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_room_to_rate',
    description: 'Take a quick 1–5 pulse from the room, e.g. "How close is this to what we want?". Use to check direction after showing something, not for choosing between options. Returns an askId; then call wait_for_room.',
    inputSchema: {
      type: 'object',
      properties: {
        question: str('The question, short and readable on a projector.', { minLength: 1, maxLength: 300 }),
        context: str('Optional background shown under the question.', { maxLength: 1000 }),
        lowLabel: str('Optional label for 1, e.g. "Way off".', { maxLength: 60 }),
        highLabel: str('Optional label for 5, e.g. "Nailed it".', { maxLength: 60 }),
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_room',
    description: 'Wait for the host to decide an ask, then return the host\'s direction (final — build it), what was chosen, and the room\'s results and reasons. Blocks up to maxWaitSeconds (default 300). If it times out the ask is still open: call wait_for_room again, or carry on with work that does not depend on the answer.',
    inputSchema: {
      type: 'object',
      properties: {
        askId: str('The askId returned when the ask was created, e.g. "003".', { minLength: 1 }),
        maxWaitSeconds: { type: 'integer', minimum: 1, maximum: 900, description: 'How long to wait before returning (default 300, max 900).' },
      },
      required: ['askId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_results',
    description: 'Look at an ask right now without waiting: its status, the live results so far, and the host\'s direction if it has been decided.',
    inputSchema: {
      type: 'object',
      properties: { askId: str('The askId, e.g. "003".', { minLength: 1 }) },
      required: ['askId'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_update',
    description: 'Post a short line to the room\'s timeline and the "Claude is building" ticker on the wall. Do this after each meaningful change (a few per session, not every edit). kind: "progress" for work done, "milestone" for something notable finished, "showing" when you put something on screen for the room to look at.',
    inputSchema: {
      type: 'object',
      properties: {
        text: str('One short sentence for the wall, e.g. "Header B is in place with the bigger CTA".', { minLength: 1, maxLength: 300 }),
        kind: { type: 'string', enum: ['progress', 'milestone', 'showing'], description: 'Default "progress".' },
        detail: str('Optional extra detail shown when the entry is expanded.', { maxLength: 2000 }),
        link: str('Optional PUBLIC http(s) link (e.g. a deployed preview).'),
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_directions',
    description: 'Check for directions the host has sent you from the room (e.g. "the room says the colours are too dark"). Directions also arrive automatically on every other Engage tool call; use this between long stretches of work when you have not called Engage for a while.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wrap_up',
    description: 'Write the session outcome for the room and the report: what was built, links, and next steps. Call once at the end of the session (calling again replaces it). Write it for the people in the room, not for developers only.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: str('Two to five sentences: what the room set out to do and what now exists.', { minLength: 1, maxLength: 4000 }),
        built: { type: 'array', items: { type: 'string' }, description: 'What was built: features, pages, files.' },
        links: {
          type: 'array',
          description: 'Public links worth keeping (repo, preview, deployed site).',
          items: {
            type: 'object',
            properties: { label: str('Link text.'), url: str('http(s) URL.') },
            required: ['label', 'url'],
            additionalProperties: false,
          },
        },
        nextSteps: { type: 'array', items: { type: 'string' }, description: 'Suggested next steps.' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
];

class InputError extends Error {}

function reqStr(args, name) {
  const v = args[name];
  if (typeof v !== 'string' || !v.trim()) throw new InputError(`"${name}" is required and must be a non-empty string.`);
  return v.trim();
}
function optStr(args, name) {
  const v = args[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new InputError(`"${name}" must be a string.`);
  return v.trim() || undefined;
}
function strList(args, name) {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new InputError(`"${name}" must be an array of strings.`);
  return v.map(x => s(x).trim()).filter(Boolean);
}
function askIdOf(args) {
  let id = args.askId;
  if (typeof id === 'number') id = String(id);
  if (typeof id !== 'string' || !id.trim()) throw new InputError('"askId" is required (e.g. "003").');
  id = id.trim().replace(/^#/, '');
  if (/^\d{1,2}$/.test(id)) id = id.padStart(3, '0');
  return encodeURIComponent(id);
}
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(signal.reason || new Error('aborted'));
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
});

function createdAskText(ask, inbox, extra = '') {
  const lines = [`Created ask ${ask.askId} · ${KIND_NAMES[ask.kind] || ask.kind}: "${s(ask.prompt)}"`];
  if (ask.status === 'proposed') {
    lines.push('Status: proposed — the host reviews it (and may edit it) before the room sees it.');
  } else {
    lines.push(`Status: ${statusLine(ask)}`);
  }
  if (extra) lines.push('', extra);
  lines.push('', `Next: call wait_for_room with askId "${ask.askId}" to get the host's decision.` +
    ' If you have independent work to do, do it first and wait afterwards.');
  return ok(lines.join('\n'), inbox);
}

const HANDLERS = {
  async room_status(_args, ctx) {
    const st = await api('GET', 'state', undefined, ctx.signal);
    return ok(renderState(st), st.inbox);
  },

  async ask_room_for_ideas(args, ctx) {
    const body = clean({ kind: 'suggest', prompt: reqStr(args, 'question'), detail: optStr(args, 'context') });
    const res = await api('POST', 'asks', body, ctx.signal);
    return createdAskText(res.ask || {}, res.inbox,
      'The room will suggest ideas, vote on them, and the host will turn the best into a direction.');
  },

  async ask_room_to_choose(args, ctx) {
    const prompt = reqStr(args, 'question');
    const options = args.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      throw new InputError('"options" must be an array of 2 to 6 options, each { title, description?, url? }.');
    }
    const opts = options.map((o, i) => {
      if (!o || typeof o.title !== 'string' || !o.title.trim()) throw new InputError(`options[${i}].title is required.`);
      const url = optStr(o, 'url');
      if (url && !/^https?:\/\//i.test(url)) throw new InputError(`options[${i}].url must be an http(s) URL.`);
      return clean({ title: o.title.trim(), detail: optStr(o, 'description'), url });
    });
    let maxPicks;
    if (args.maxPicks !== undefined && args.maxPicks !== null) {
      maxPicks = Number(args.maxPicks);
      if (!Number.isInteger(maxPicks) || maxPicks < 1 || maxPicks > opts.length) {
        throw new InputError(`"maxPicks" must be a whole number from 1 to ${opts.length}.`);
      }
    }
    const body = clean({ kind: 'choice', prompt, detail: optStr(args, 'context'), options: opts, maxPicks });
    const res = await api('POST', 'asks', body, ctx.signal);
    const ask = res.ask || {};
    const labelled = (Array.isArray(ask.options) && ask.options.length ? ask.options : opts)
      .map((o, i) => ({ label: o.label || LETTERS[i], title: o.title, url: o.url }));
    const lines = ['Labels assigned by Engage — use EXACTLY these letters:'];
    for (const o of labelled) lines.push(`  Choice ${o.label} — ${s(o.title)}${o.url ? `  (${o.url})` : ''}`);
    lines.push('',
      'Stamp every variant with its letter so what is on the projector matches the wall and the phones.',
      'Paste the matching badge just inside <body> of each mockup (self-contained, no CSS needed):');
    for (const o of labelled) lines.push('', `Choice ${o.label}:`, badgeSnippet(o.label));
    lines.push('', 'Then tell the host the local URL of each variant (e.g. "Choice A → http://localhost:5173/a"), ' +
      'and post_update with kind "showing" when they are ready to flip through.');
    return createdAskText(ask, res.inbox, lines.join('\n'));
  },

  async ask_room_to_rate(args, ctx) {
    const body = clean({
      kind: 'rating', prompt: reqStr(args, 'question'), detail: optStr(args, 'context'),
      lowLabel: optStr(args, 'lowLabel'), highLabel: optStr(args, 'highLabel'),
    });
    const res = await api('POST', 'asks', body, ctx.signal);
    return createdAskText(res.ask || {}, res.inbox, 'The room will rate 1–5 and can add a short "why".');
  },

  async wait_for_room(args, ctx) {
    const id = askIdOf(args);
    let maxWait = args.maxWaitSeconds === undefined || args.maxWaitSeconds === null ? 300 : Number(args.maxWaitSeconds);
    if (!Number.isFinite(maxWait) || maxWait <= 0) maxWait = 300;
    maxWait = Math.min(maxWait, 900);
    const deadline = Date.now() + maxWait * 1000;
    const started = Date.now();
    // Inbox items are marked delivered as soon as a response carries them, so
    // collect every one seen across all polls — dropping one loses it for good.
    const inbox = [];
    const seen = new Set();
    const collect = (items) => {
      for (const d of Array.isArray(items) ? items : []) {
        const k = d.id || JSON.stringify(d);
        if (!seen.has(k)) { seen.add(k); inbox.push(d); }
      }
    };
    let ask;
    let lastStatus = null;
    for (let n = 0; ; n++) {
      const res = await api('GET', `asks/${id}`, undefined, ctx.signal);
      collect(res.inbox);
      ask = res.ask || {};
      if (ask.status === 'decided' || ask.status === 'discarded') break;
      if (ask.status !== lastStatus || n % 5 === 0) {
        const t = (ask.results || {}).total || 0;
        ctx.progress(Math.round((Date.now() - started) / 1000), maxWait,
          `Ask ${ask.askId || id}: ${ask.status}${t ? `, ${t} response${t === 1 ? '' : 's'}` : ''}`);
        lastStatus = ask.status;
      }
      if (Date.now() + POLL_MS > deadline) break;
      await sleep(POLL_MS, ctx.signal);
    }
    if (ask.status === 'decided') {
      return ok(`The host has decided ask ${ask.askId}.\n\n${renderAsk(ask)}\n\n` +
        'Build what the direction says — it is final, even where it departs from the raw vote. ' +
        'Then post_update to tell the room it is in place.', inbox);
    }
    if (ask.status === 'discarded') {
      return ok(`The host discarded ask ${ask.askId} ("${s(ask.prompt)}"). ` +
        'Do not wait on it; carry on with your own judgement, or ask a better-framed question if the decision still matters.' +
        (ask.decision && ask.decision.note ? `\nHost's note: ${s(ask.decision.note)}` : ''), inbox);
    }
    return ok(`Still waiting after ${Math.round((Date.now() - started) / 1000)}s — ask ${ask.askId || id} is not decided yet.\n\n` +
      `${renderAsk(ask)}\n\n` +
      'You can call wait_for_room again, or keep working on things that do not depend on this answer and check back later.', inbox);
  },

  async get_results(args, ctx) {
    const res = await api('GET', `asks/${askIdOf(args)}`, undefined, ctx.signal);
    const ask = res.ask || {};
    const tail = ask.status === 'decided' ? '' :
      ask.status === 'discarded' ? '\n\nThis ask was discarded by the host.' :
      '\n\nNot decided yet — the host\'s direction is what counts. Call wait_for_room to wait for it.';
    return ok(renderAsk(ask) + tail, res.inbox);
  },

  async post_update(args, ctx) {
    const kind = args.kind === undefined || args.kind === null || args.kind === '' ? 'progress' : args.kind;
    if (!['progress', 'milestone', 'showing'].includes(kind)) throw new InputError('"kind" must be progress, milestone or showing.');
    const link = optStr(args, 'link');
    if (link && !/^https?:\/\//i.test(link)) throw new InputError('"link" must be an http(s) URL.');
    const body = clean({ kind, text: reqStr(args, 'text'), detail: optStr(args, 'detail'), link });
    const res = await api('POST', 'log', body, ctx.signal);
    return ok(`Posted to the room's timeline (${kind}): ${body.text}`, res.inbox);
  },

  async check_directions(_args, ctx) {
    const st = await api('GET', 'state', undefined, ctx.signal);
    if (Array.isArray(st.inbox) && st.inbox.length) {
      return ok(`${st.inbox.length} new direction${st.inbox.length === 1 ? '' : 's'} from the host.`, st.inbox);
    }
    const recent = (Array.isArray(st.log) ? st.log : []).filter(e => e.kind === 'direction' || e.kind === 'decision').slice(-3);
    const lines = ['No new directions from the room. Carry on.'];
    if (recent.length) {
      lines.push('', 'Most recent directions and decisions (already delivered):');
      for (const e of recent) lines.push(`  [${e.kind}] ${trunc(e.text, 200)}`);
    }
    return ok(lines.join('\n'));
  },

  async wrap_up(args, ctx) {
    let links;
    if (args.links !== undefined && args.links !== null) {
      if (!Array.isArray(args.links)) throw new InputError('"links" must be an array of { label, url }.');
      links = args.links.map((l, i) => {
        if (!l || typeof l.url !== 'string' || !/^https?:\/\//i.test(l.url.trim())) throw new InputError(`links[${i}].url must be an http(s) URL.`);
        return { label: s(l.label).trim() || l.url.trim(), url: l.url.trim() };
      });
    }
    const body = clean({ summary: reqStr(args, 'summary'), built: strList(args, 'built'), links, nextSteps: strList(args, 'nextSteps') });
    const res = await api('POST', 'outcome', body, ctx.signal);
    return ok('Wrap-up saved. The room\'s report now shows the outcome' +
      `${body.built && body.built.length ? `, ${body.built.length} item${body.built.length === 1 ? '' : 's'} built` : ''}` +
      `${links && links.length ? `, ${links.length} link${links.length === 1 ? '' : 's'}` : ''}.` +
      ' Consider a final post_update with kind "milestone".', res.inbox);
  },
};

async function callTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  if (CONFIG.problems.length) return { content: [{ type: 'text', text: configHelp() }], isError: true };
  try {
    return await handler(args && typeof args === 'object' ? args : {}, ctx);
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    if (e instanceof InputError) return { content: [{ type: 'text', text: `Invalid input: ${e.message}` }], isError: true };
    log(`tool ${name} failed:`, e && e.message ? e.message : String(e));
    return errorResult(e);
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PROMPTS = [
  { name: 'kickoff', description: 'Start a Build Room session: read the room, restate the goal, plan out loud and post the plan.', arguments: [] },
  { name: 'ideas', description: 'Ask the room for ideas about a topic, wait for the host\'s direction, then act on it.',
    arguments: [{ name: 'topic', description: 'What to ask the room about', required: true }] },
  { name: 'ab-mockups', description: 'Build N labelled variants (Choice A, B, …), let the room choose, then build the decision.',
    arguments: [
      { name: 'topic', description: 'What the variants are of, e.g. "the landing page header"', required: true },
      { name: 'count', description: 'How many variants (2–6, default 2)', required: false },
    ] },
  { name: 'wrap-up', description: 'Summarise what was built, write the session outcome and post a final milestone.', arguments: [] },
];

function promptText(name, args) {
  switch (name) {
    case 'kickoff':
      return [
        'We are starting a Build Room session in Engage: a live room is watching on a projector and will help decide what we build.',
        '',
        '1. Call room_status. Read the goal, how many people are here, and anything already decided.',
        '2. Restate the goal to me in one or two plain sentences.',
        '3. Propose a short build plan: 3–6 steps. Mark which steps are real decision points the room should weigh in on (look and feel, naming, which feature first) and which you will simply do.',
        '4. Post the plan with post_update (kind "milestone"), one short line the room can read, e.g. "Plan: scaffold → header (room picks) → signup form → polish".',
        '5. If there is a meaningful first question for the room, ask it now (ask_room_for_ideas, ask_room_to_choose or ask_room_to_rate). Keep it short enough to read from the back of the room. Then start on any work that does not depend on the answer and call wait_for_room when you need it.',
        '6. If there is no real question yet, start building and post progress as you go.',
      ].join('\n');
    case 'ideas': {
      const topic = s(args.topic).trim() || '(no topic given — ask me what to ask about)';
      return [
        `Ask the room in Engage for ideas about: ${topic}`,
        '',
        '1. Write one short, open question (under ~90 characters, readable on a projector). Add one sentence of context if it helps.',
        '2. Call ask_room_for_ideas with it. Tell me the askId and whether it is waiting for my review.',
        '3. While the room thinks, do any work that does not depend on the answer.',
        '4. Call wait_for_room with the askId. If it times out, call it again.',
        '5. When it returns, the host\'s direction is final: implement it, even where it departs from the raw vote. Use the room\'s suggestions and reasons as colour.',
        '6. post_update to tell the room what you did with their ideas.',
      ].join('\n');
    }
    case 'ab-mockups': {
      const topic = s(args.topic).trim() || '(no topic given — ask me what the variants are of)';
      let count = parseInt(args.count, 10);
      if (!Number.isFinite(count)) count = 2;
      count = Math.min(6, Math.max(2, count));
      const letters = LETTERS.slice(0, count).split('').join(', ');
      return [
        `Let the room choose between ${count} variants of: ${topic}`,
        '',
        `1. Decide on ${count} genuinely different directions (not small tweaks of one idea). Give each a short title and a one-line description.`,
        '2. Create the ask FIRST: call ask_room_to_choose with a short question and the options in order. Engage returns the letters (normally ' + letters + ') and a badge snippet for each.',
        '3. Build each variant as a quick local page (e.g. a static HTML file per variant, or routes /a, /b … on the dev server). Keep them light: enough to judge the direction, not production code.',
        '4. Paste the matching badge snippet into each page so the letter on screen is exactly the letter Engage returned. Never re-letter or reorder.',
        '5. Tell me the local URL of each variant ("Choice A → http://localhost:…") so I can flip through them on the projector, and post_update with kind "showing".',
        '6. Call wait_for_room with the askId (call it again if it times out).',
        '7. Implement the host\'s direction — it is final and may combine variants or add the room\'s comments. Remove the badges from the result, clean up the throwaway variants, and post_update when it is in place.',
      ].join('\n');
    }
    case 'wrap-up':
      return [
        'We are wrapping up the Build Room session.',
        '',
        '1. Call room_status to review the goal and the decisions the room made.',
        '2. Summarise for me what was built: the files and features, how to run it, and anything left unfinished.',
        '3. Call wrap_up with: a summary written for the people in the room (2–5 sentences, plain language, mention the decisions they made), built (a list of what exists now), links (any public URLs: repo, preview, deploy — no localhost), and nextSteps.',
        '4. Post a final post_update with kind "milestone", thanking the room in one line.',
      ].join('\n');
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Instructions (shown to the model by Claude Code)
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `Engage connects you to a live room of people through the host's Build Room session. The host's laptop is usually on a projector, the room follows along on their phones, and you are building something real with them.

How to collaborate:
- Ask the room only at real decision points: direction, look and feel, naming, priorities, "which of these?". Do the routine work yourself. A few good asks per session beat many small ones.
- Keep every question short and plain: it is read from the back of a room on a projector. Put background in "context", not in the question.
- Use ask_room_for_ideas for open questions, ask_room_to_choose for 2–6 concrete options, ask_room_to_rate for a 1–5 pulse on something you have shown.
- When showing variants, create the ask_room_to_choose ask FIRST, then label every variant on screen with exactly the letter Engage returned ("Choice A", "Choice B", …) using the badge snippet it gives you. Tell the host the local URL of each one.
- Asks may arrive as "proposed": the host reviews them before the room sees them. That is normal. Keep working on anything that does not depend on the answer, then call wait_for_room. If it times out, call it again.
- The host's direction is final. It may edit, merge or overrule the raw vote and add what people said out loud; build what the direction says.
- Post a short post_update after each meaningful change (kind "showing" when you put something on screen for the room). One line, written for the room, not a commit message.
- Any tool result may include "DIRECTION FROM THE ROOM (via the host)". Act on it promptly; it is the host speaking for the room. Use check_directions if you have not called Engage for a while.
- Text you send is shown to the room as plain text. Only include public http(s) links people can open; never secrets, keys or private paths.
- At the end, call wrap_up with a summary, what was built, links and next steps, then post a final milestone.`;

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });
}

const inflight = new Map(); // request id -> AbortController

async function handleRequest(msg) {
  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      if (CONFIG.problems.length) log('not configured:', CONFIG.problems.join(' '));
      else log(`ready for session ${CONFIG.gameId} at ${CONFIG.api}`);
      return reply(id, {
        protocolVersion,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'engage', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return replyError(id, -32602, 'tools/call requires params.name');
      const progressToken = params._meta && params._meta.progressToken;
      const controller = new AbortController();
      inflight.set(id, controller);
      const ctx = {
        signal: controller.signal,
        progress(progress, total, message) {
          if (progressToken === undefined || progressToken === null || controller.signal.aborted) return;
          send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress, total, message } });
        },
      };
      try {
        const result = await callTool(name, params.arguments, ctx);
        if (!controller.signal.aborted) reply(id, result);
      } catch (e) {
        if (!controller.signal.aborted) reply(id, errorResult(e));
      } finally {
        inflight.delete(id);
      }
      return;
    }
    case 'prompts/list':
      return reply(id, { prompts: PROMPTS });
    case 'prompts/get': {
      const p = PROMPTS.find(x => x.name === params.name);
      if (!p) return replyError(id, -32602, `Unknown prompt "${params.name}"`);
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      for (const a of p.arguments) {
        if (a.required && !s(args[a.name]).trim()) return replyError(id, -32602, `Prompt "${p.name}" requires argument "${a.name}"`);
      }
      return reply(id, {
        description: p.description,
        messages: [{ role: 'user', content: { type: 'text', text: promptText(p.name, args) } }],
      });
    }
    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

function handleNotification(msg) {
  if (msg.method === 'notifications/cancelled') {
    const c = msg.params && inflight.get(msg.params.requestId);
    if (c) c.abort(new Error('cancelled'));
  }
  // notifications/initialized and anything else: nothing to do, never reply.
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    return replyError(null, -32700, 'Parse error');
  }
  if (Array.isArray(msg)) {
    // JSON-RPC batch (allowed by 2025-03-26): handle each element.
    for (const m of msg) dispatch(m);
    return;
  }
  dispatch(msg);
}

function dispatch(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    if (msg && msg.id !== undefined && msg.id !== null) replyError(msg.id, -32600, 'Invalid Request');
    return;
  }
  const isRequest = msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';
  if (!isRequest) {
    if (typeof msg.method === 'string') handleNotification(msg);
    return; // notifications and stray responses get no reply
  }
  handleRequest(msg).catch(e => {
    log('internal error:', e && e.stack ? e.stack : String(e));
    replyError(msg.id, -32603, 'Internal error');
  });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    handleLine(line);
  }
});
process.stdin.on('end', () => {
  if (buffer.trim()) handleLine(buffer);
  for (const c of inflight.values()) c.abort(new Error('stdin closed'));
  process.exit(0);
});
process.stdout.on('error', () => process.exit(0));
