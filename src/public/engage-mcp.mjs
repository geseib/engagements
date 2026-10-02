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

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.0';
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


/** The project Claude Code is working in (the plugin's hooks and tools act here). */
const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
/** Per project: which Build Room this folder is connected to. Never committed. */
const sessionFile = (dir = projectDir()) => pathJoin(dir, '.engage', 'session.json');
/** Per laptop: the Engage API this install talks to (written by --install-plugin). */
const globalFile = () => pathJoin(homedir(), '.engage', 'config.json');

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Where the key and API come from, first match wins:
 *   1. ENGAGE_KEY / ENGAGE_API in the environment (the `claude mcp add` route);
 *   2. this project's .engage/session.json (written by the connect tool — the
 *      plugin route, so a new session needs no reinstall);
 *   3. the API alone from ~/.engage/config.json.
 */
function readConfig() {
  const local = readJson(sessionFile()) || {};
  const global = readJson(globalFile()) || {};
  const key = (process.env.ENGAGE_KEY || local.key || '').trim();
  let api = (process.env.ENGAGE_API || local.api || global.api || '').trim();
  const problems = [];
  let gameId = null;
  if (!key) problems.push('No session key yet. Connect this project to a Build Room: in Claude Code, /engage:connect <key> (plugin), or set ENGAGE_KEY.');
  else {
    const m = /^eng_(\d+)_(.+)$/.exec(key);
    if (!m) problems.push('ENGAGE_KEY does not look like an Engage session key (expected eng_<gameId>_<secret>).');
    else gameId = m[1];
  }
  if (!api) problems.push('The Engage API address is not set (ENGAGE_API, or pass api to connect).');
  else if (!/^https?:\/\//i.test(api)) problems.push(`ENGAGE_API must be an http(s) URL (got "${api}").`);
  else api = api.replace(/\/+$/, '') + '/';
  return { key, api, gameId, problems };
}

let CONFIG = readConfig();
/** Re-read before every tool call: connect can change it mid-session. */
const reloadConfig = () => { CONFIG = readConfig(); };

function configHelp() {
  return [
    'The Engage MCP server is not configured, so it cannot reach the room.',
    '',
    ...CONFIG.problems.map(p => `- ${p}`),
    '',
    'How to fix: the host opens the session\'s Build Room page in Engage and mints a key under',
    '"Connect Claude Code". With the Engage plugin installed, connect with: /engage:connect eng_1234_…',
    '(or call the connect tool with that key). Without the plugin, run the claude mcp add command the page shows.',
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

const api_ = (...a) => api(...a);
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
              url: str('The URL of this variant, e.g. http://localhost:5173/a. ALWAYS set it when the variant is running: the host gets an "Open A" button on the big screen. Local URLs are fine (only the host\'s laptop opens them; phones see public URLs only).'),
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
    name: 'connect',
    description: 'Connect this project to a Build Room with the session key the host gives you (eng_<code>_…). Saves it in .engage/session.json in this project (never committed), checks it works, and from then on every Engage tool and the version-control checkpoints use it. Call this when the host says /engage:connect or pastes a key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: str('The session key, eng_<gameId>_<secret>.', { minLength: 10 }),
        api: str('Optional Engage API address; only needed if the plugin was installed without one.'),
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'checkpoint',
    description: 'Save the work so far as a git commit in this project (making it a git repository first if it is not one) and put the commit on the room\'s timeline, so every decision maps to a version the room can come back to. Call it after implementing each decision, with a message that says what changed and why ("Header B, as the room chose"). With the Engage plugin a checkpoint is also taken automatically at the end of every turn. Never pushes.',
    inputSchema: {
      type: 'object',
      properties: { message: str('The commit message: what changed, in plain words.', { minLength: 1, maxLength: 300 }) },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'share_image',
    description: 'Put a screenshot in front of the room: a mockup (tie it to its Choose option with askId + label, and it appears on that option on the big screen AND on every phone), the finished product (kind "final"; it goes on the "What we built" screen and into the report), or progress. Take the screenshot first with whatever this machine has, e.g. `npx playwright screenshot --viewport-size=1280,800 http://localhost:5173/a a.png` (PNG, JPEG or WebP, up to 3 MB; prefer the viewport over a very tall full page). Send one per variant after creating the Choose ask, and one or two of the final result before wrap_up.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('Path to the image file, absolute or relative to the project directory.', { minLength: 1 }),
        caption: str('One line for the room, e.g. "Choice A: bold header".', { maxLength: 500 }),
        kind: { type: 'string', enum: ['mockup', 'final', 'progress'], description: 'mockup (a variant to choose from), final (what was built), or progress (default).' },
        askId: str('For a mockup: the askId of the Choose ask it belongs to, e.g. "003".'),
        label: str('For a mockup: the option letter it shows, e.g. "A".', { maxLength: 1 }),
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_direction',
    description: 'Wait for the host to tell you what to do next. Call it whenever you have finished what you were asked and have nothing else to do — above all right after wrap_up — so the host can keep steering from the Build Room screen instead of typing in the terminal. While you wait, the host sees "Claude is listening". Returns the moment a direction arrives; if none does before the time is up, call it again.',
    inputSchema: {
      type: 'object',
      properties: {
        maxWaitSeconds: { type: 'integer', minimum: 10, maximum: 1800, description: 'How long to wait before returning empty-handed (default 600).' },
      },
      additionalProperties: false,
    },
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
          description: 'Links to what was built. Put the running demo FIRST (local URLs such as http://localhost:5173 are fine: the host gets a big "Open the demo" button); add public ones too (repo, preview, deploy). Phones see public links only.',
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
        'Then post_update to tell the room it is in place.',
        // This decision is already printed in full above; repeat only the rest.
        inbox.filter((d) => d.askId !== ask.askId));
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
    return ok(renderAsk(ask) + tail,
      ask.status === 'decided' ? (res.inbox || []).filter((d) => d.askId !== ask.askId) : res.inbox);
  },

  async post_update(args, ctx) {
    const kind = args.kind === undefined || args.kind === null || args.kind === '' ? 'progress' : args.kind;
    if (!['progress', 'milestone', 'showing'].includes(kind)) throw new InputError('"kind" must be progress, milestone or showing.');
    const link = optStr(args, 'link');
    if (link && !/^https?:\/\//i.test(link)) throw new InputError('"link" must be an http(s) URL.');
    const body = clean({ kind, text: reqStr(args, 'text'), detail: optStr(args, 'detail'), link });
    const res = await api('POST', 'log', body, ctx.signal);
    rememberUpdate(body.text);
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

  async connect(args, ctx) {
    const key = reqStr(args, 'key').trim();
    const m = /^eng_(\d+)_[A-Za-z0-9_-]+$/.exec(key);
    if (!m) throw new InputError('That does not look like a session key (expected eng_<code>_…). Copy it from the Build Room\'s Connect Claude Code panel.');
    let api = (optStr(args, 'api') || process.env.ENGAGE_API || (readJson(sessionFile()) || {}).api || (readJson(globalFile()) || {}).api || '').trim();
    if (!/^https?:\/\//i.test(api)) throw new InputError('I do not know the Engage API address yet. Pass api (it is in the Connect panel\'s command), or reinstall the plugin with --api.');
    api = api.replace(/\/+$/, '') + '/';
    const dir = pathJoin(projectDir(), '.engage');
    mkdirSync(dir, { recursive: true });
    // Everything in .engage/ stays out of git: the key is a secret.
    writeFileSync(pathJoin(dir, '.gitignore'), '*\n');
    writeFileSync(sessionFile(), JSON.stringify({ key, api, connectedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    reloadConfig();
    let st;
    try { st = await api_('GET', 'state', undefined, ctx.signal); } catch (e) {
      return errorResult(e);
    }
    return ok(`Connected this project (${projectDir()}) to Build Room ${m[1]}.\n\n${renderState(st)}\n\n` +
      'Checkpoints: call checkpoint after each decision you implement; with the Engage plugin one is also taken at the end of every turn.', st.inbox);
  },

  async checkpoint(args, ctx) {
    const message = reqStr(args, 'message');
    const r = gitCheckpoint(projectDir(), message);
    if (r.error) return { content: [{ type: 'text', text: `Could not checkpoint: ${r.error}` }], isError: true };
    if (!r.hash) return ok(`Nothing to commit${r.initialized ? ' (made this folder a git repository first)' : ''}. The work is already saved as ${r.head || 'the last checkpoint'}.`);
    const res = await api('POST', 'log', { kind: 'checkpoint', text: message, detail: `commit ${r.hash} · ${r.files} file${r.files === 1 ? '' : 's'}` }, ctx.signal);
    return ok(`${r.initialized ? 'Made this folder a git repository, then saved' : 'Saved'} ${r.files} changed file${r.files === 1 ? '' : 's'} as commit ${r.hash}: "${message}". The room's timeline shows it.`, res.inbox);
  },

  async share_image(args, ctx) {
    const { readFile, stat } = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const rel = reqStr(args, 'path');
    const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const file = pathMod.isAbsolute(rel) ? rel : pathMod.resolve(base, rel);
    let info;
    try { info = await stat(file); } catch { throw new InputError(`No file at ${file}. Take the screenshot first, then pass its path.`); }
    if (!info.isFile()) throw new InputError(`${file} is not a file.`);
    if (info.size > 3 * 1024 * 1024) throw new InputError(`${file} is ${(info.size / 1048576).toFixed(1)} MB; the limit is 3 MB. Screenshot the viewport instead of the full page, or save it as JPEG.`);
    const buf = await readFile(file);
    const png = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
    const jpg = buf[0] === 0xFF && buf[1] === 0xD8;
    const webp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    if (!png && !jpg && !webp) throw new InputError(`${file} is not a PNG, JPEG or WebP image.`);
    const askId = optStr(args, 'askId');
    const body = clean({
      data: buf.toString('base64'),
      caption: optStr(args, 'caption'),
      kind: optStr(args, 'kind'),
      askId: askId ? askId.padStart(3, '0') : undefined,
      label: optStr(args, 'label'),
    });
    const res = await api('POST', 'images', body, ctx.signal);
    const im = res.image || {};
    const where = im.label ? `on Choice ${im.label} of ask ${im.askId}, on the big screen and every phone` :
      im.kind === 'final' ? 'on the "What we built" screen and in the report' : 'on the room\'s timeline and in the report';
    return ok(`Shared ${pathMod.basename(file)} (${Math.round((im.bytes || buf.length) / 1024)} KB) ${where}.`, res.inbox);
  },

  async wait_for_direction(args, ctx) {
    let maxWait = args.maxWaitSeconds === undefined || args.maxWaitSeconds === null ? 600 : Number(args.maxWaitSeconds);
    if (!Number.isFinite(maxWait)) throw new InputError('"maxWaitSeconds" must be a number.');
    maxWait = Math.min(1800, Math.max(10, Math.round(maxWait)));
    const started = Date.now();
    const deadline = started + maxWait * 1000;
    let polls = 0;
    for (;;) {
      const res = await api('GET', 'inbox?listening=1', undefined, ctx.signal);
      if (Array.isArray(res.inbox) && res.inbox.length) {
        return ok(`The host has something for you (after ${Math.round((Date.now() - started) / 1000)}s).`, res.inbox);
      }
      polls += 1;
      ctx.progress(Math.min(polls, 1000), undefined, 'Listening for the host');
      if (Date.now() + POLL_MS > deadline) break;
      await sleep(POLL_MS, ctx.signal);
    }
    return ok(`No direction yet after ${maxWait}s. The host can still see that you were listening. ` +
      'Call wait_for_direction again to keep listening, or check room_status if you want to see what the room is doing.');
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
      ' Post a final post_update with kind "milestone", then call wait_for_direction so the host can keep steering.', res.inbox);
  },
};

async function callTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  reloadConfig();
  if (CONFIG.problems.length && name !== 'connect') return { content: [{ type: 'text', text: configHelp() }], isError: true };
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
  { name: 'continue', description: 'Pick up the host\'s latest direction from the Build Room and keep going; then listen for the next one.', arguments: [] },
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
        '4b. Screenshot each variant (e.g. npx playwright screenshot --viewport-size=1280,800 <url> a.png) and share_image it with askId and its label, so the room sees each mockup on the big screen and on their phones.',
        '5. Make sure each option carries its local URL (pass url in ask_room_to_choose; the host gets an "Open A" button for each on the big screen), tell me the URLs too ("Choice A → http://localhost:…"), and post_update with kind "showing" and link set to the first variant.',
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
        '2b. Screenshot the finished result (one or two screens) and share_image each with kind "final" — they go on the What we built screen and into the report.',
        '3. Make sure the finished result is running, then call wrap_up with: a summary written for the people in the room (2–5 sentences, plain language, mention the decisions they made), built (a list of what exists now), links (the running demo FIRST — a localhost URL is fine, the host gets an "Open the demo" button — then any public URLs: repo, preview, deploy), and nextSteps.',
        '4. Post a final post_update with kind "milestone", thanking the room in one line.',
        '5. Call wait_for_direction and keep calling it: the host may want one more change, or another question for the room.',
      ].join('\n');
    case 'continue':
      return [
        'The host is steering from the Build Room.',
        '',
        '1. Call check_directions and room_status to see what the host and the room want now.',
        '2. Do it. Ask the room only if there is a real decision to make.',
        '3. post_update to say what changed (kind "showing", with the link, if there is something new to look at).',
        '4. Then call wait_for_direction and keep calling it until the host gives you the next thing.',
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
- Show, don't just tell: screenshot each mockup and share_image it onto its Choose option (askId + label), so phones see it too; before wrap_up, share_image one or two screenshots of the finished product with kind "final" for the report.
- Always attach the URL of what you show: the url of every Choose option, and link on post_update "showing". Local URLs (localhost) are right here — the host opens them on this laptop, on the projector; phones only ever see public URLs.
- At the end, call wrap_up with a summary, what was built, links (the running demo first) and next steps, then post a final milestone.
- After you implement each decision, call checkpoint with a plain message ("Header B, as the room chose"). The work stays in git, step by step, and the room's timeline and report show each version.
- When you have nothing left to do — after wrap_up above all — call wait_for_direction and keep calling it. The host sees "Claude is listening" and can steer you from the Build Room screen.`;

// ---------------------------------------------------------------------------
// Version control (git) — the checkpoint tool and the plugin's Stop hook
// ---------------------------------------------------------------------------

const DEFAULT_GITIGNORE = ['node_modules/', 'dist/', 'build/', '.env', '.env.*', '.DS_Store', '.engage/', ''].join('\n');

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Commit everything in `dir` (making it a repository first if it is not one).
 * Local only: never pushes, never touches a remote. Returns {hash, files,
 * initialized} — hash is null when there was nothing to commit.
 */
function gitCheckpoint(dir, message) {
  try { git(dir, ['--version']); } catch { return { error: 'git is not installed on this machine.' }; }
  let initialized = false;
  try { git(dir, ['rev-parse', '--is-inside-work-tree']); } catch {
    try { git(dir, ['init', '-q']); initialized = true; } catch (e) { return { error: `git init failed: ${e.message}` }; }
    if (!existsSync(pathJoin(dir, '.gitignore'))) writeFileSync(pathJoin(dir, '.gitignore'), DEFAULT_GITIGNORE);
  }
  try {
    git(dir, ['add', '-A']);
    const changed = git(dir, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    let head = null;
    try { head = git(dir, ['rev-parse', '--short', 'HEAD']); } catch { /* no commits yet */ }
    if (!changed.length) return { hash: null, files: 0, initialized, head };
    // Someone's machine may have no git identity; never fail the room for it.
    let who = [];
    try { git(dir, ['config', 'user.email']); } catch { who = ['-c', 'user.name=Claude Code (Engage)', '-c', 'user.email=claude-code@engage.local']; }
    git(dir, [...who, 'commit', '-q', '--no-verify', '-m', message]);
    return { hash: git(dir, ['rev-parse', '--short', 'HEAD']), files: changed.length, initialized };
  } catch (e) {
    return { error: (e.stderr || e.message || String(e)).toString().trim().slice(0, 300) };
  }
}

/** The last thing Claude told the room: the hook's commit message. */
function rememberUpdate(text) {
  try {
    const dir = pathJoin(projectDir(), '.engage');
    if (existsSync(dir)) writeFileSync(pathJoin(dir, 'last-update.txt'), String(text).slice(0, 300));
  } catch { /* best effort */ }
}

/**
 * --checkpoint: the plugin's Stop hook. Runs at the end of every turn Claude
 * takes. Acts ONLY in a project connected to a Build Room (.engage/session.json
 * exists) — an unrelated project is never touched — and never fails the turn:
 * whatever happens, it exits 0 and prints nothing to stdout.
 */
async function hookCheckpoint() {
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let data = {};
  try { data = JSON.parse(input || '{}'); } catch { /* not JSON */ }
  // The project root Claude Code hands every hook wins over the turn's cwd,
  // which may be a subfolder Claude cd'ed into.
  const dir = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  if (!existsSync(sessionFile(dir))) return;
  process.env.CLAUDE_PROJECT_DIR = dir;
  reloadConfig();
  let note = '';
  try { note = readFileSync(pathJoin(dir, '.engage', 'last-update.txt'), 'utf8').trim(); } catch { /* none */ }
  const message = `Build Room ${CONFIG.gameId || ''}: ${note || 'work in progress'}`.replace(/\s+:/, ':');
  const r = gitCheckpoint(dir, message);
  if (r.error) { log('checkpoint:', r.error); return; }
  if (!r.hash) return;
  try { writeFileSync(pathJoin(dir, '.engage', 'last-update.txt'), ''); } catch { /* */ }
  if (CONFIG.problems.length) return;
  try {
    await api('POST', 'log', { kind: 'checkpoint', text: note || 'Work in progress', detail: `commit ${r.hash} · ${r.files} file${r.files === 1 ? '' : 's'}` }, AbortSignal.timeout(10000));
  } catch (e) { log('checkpoint post failed:', e.message); }
}

/**
 * --install-plugin [--api <url>]: write the Engage plugin for Claude Code to
 * ~/.engage/claude-plugin (a local marketplace holding one plugin: this server,
 * the slash commands, and the Stop hook above), remember the API, and register
 * it with Claude Code if the `claude` command is here.
 */
function installPlugin(argv) {
  const apiArg = argv[argv.indexOf('--api') + 1];
  const home = pathJoin(homedir(), '.engage');
  const root = pathJoin(home, 'claude-plugin');
  const plug = pathJoin(root, 'engage');
  for (const d of [pathJoin(root, '.claude-plugin'), pathJoin(plug, '.claude-plugin'), pathJoin(plug, 'commands'), pathJoin(plug, 'hooks')]) mkdirSync(d, { recursive: true });
  const w = (file, body) => writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  w(pathJoin(root, '.claude-plugin', 'marketplace.json'), {
    name: 'engage-local',
    owner: { name: 'Engage' },
    metadata: { description: 'The Engage Build Room plugin, installed from your Engage session page.' },
    plugins: [{ name: 'engage', source: './engage', description: 'Build with the room: Engage Build Room for Claude Code.' }],
  });
  w(pathJoin(plug, '.claude-plugin', 'plugin.json'), {
    name: 'engage',
    version: VERSION,
    description: 'Build with the room: ask a live audience through Engage, take their direction, and keep every step in git.',
    author: { name: 'Engage' },
  });
  w(pathJoin(plug, '.mcp.json'), { mcpServers: { engage: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/engage-mcp.mjs'] } } });
  w(pathJoin(plug, 'hooks', 'hooks.json'), {
    description: 'Checkpoint the work in git at the end of every turn, in projects connected to a Build Room.',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/engage-mcp.mjs" --checkpoint', timeout: 60 }] }] },
  });
  copyFileSync(fileURLToPath(import.meta.url), pathJoin(plug, 'engage-mcp.mjs'));
  const cmd = (name, description, hint, body) => w(pathJoin(plug, 'commands', `${name}.md`),
    `---\ndescription: ${description}\n${hint ? `argument-hint: ${hint}\n` : ''}---\n\n${body}\n`);
  cmd('connect', 'Connect this project to an Engage Build Room', '<session key>',
    'Connect this project to the Engage Build Room: call the engage connect tool with key "$ARGUMENTS". Then tell me the room\'s goal in one line, and suggest I use /engage:kickoff.');
  for (const p of PROMPTS.filter((x) => x.name !== 'connect')) {
    const arg = p.arguments && p.arguments[0];
    const body = promptText(p.name, arg ? { [arg.name]: '$ARGUMENTS' } : {});
    cmd(p.name, p.description, arg ? `<${arg.name}>` : '', body);
  }
  if (apiArg && /^https?:\/\//i.test(apiArg)) {
    mkdirSync(home, { recursive: true });
    w(globalFile(), { api: apiArg.replace(/\/+$/, '') + '/' });
  }
  const out = (...lines) => process.stdout.write(lines.join('\n') + '\n');
  out(`Wrote the Engage plugin to ${plug}`);
  const claude = (args) => spawnSync('claude', args, { encoding: 'utf8' });
  const probe = claude(['--version']);
  if (probe.error) {
    out('', 'The claude command is not on PATH here. In Claude Code, run:');
    out(`  /plugin marketplace add ${root}`);
    out('  /plugin install engage@engage-local');
  } else {
    const add = claude(['plugin', 'marketplace', 'add', root]);
    if (add.status !== 0) claude(['plugin', 'marketplace', 'update', 'engage-local']);
    const inst = claude(['plugin', 'install', 'engage@engage-local']);
    out(inst.status === 0 ? 'Installed the engage plugin in Claude Code.' :
      `Could not install automatically (${(inst.stderr || inst.stdout || '').trim().slice(0, 200)}). In Claude Code run: /plugin marketplace add ${root} then /plugin install engage@engage-local`);
  }
  out('', 'Next: start (or restart) Claude Code in your project folder and type', '  /engage:connect <the key from the Build Room page>');
}

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

const CLI = process.argv.includes('--install-plugin') ? 'install' : process.argv.includes('--checkpoint') ? 'checkpoint' : null;
if (CLI === 'install') {
  try { installPlugin(process.argv); } catch (e) { process.stderr.write(`Install failed: ${e.message}\n`); process.exit(1); }
  process.exit(0);
}
if (CLI === 'checkpoint') {
  hookCheckpoint().catch((e) => log('checkpoint hook:', e && e.message)).finally(() => process.exit(0));
}

let buffer = '';
if (!CLI) process.stdin.setEncoding('utf8');
if (!CLI) process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    handleLine(line);
  }
});
if (!CLI) process.stdin.on('end', () => {
  if (buffer.trim()) handleLine(buffer);
  for (const c of inflight.values()) c.abort(new Error('stdin closed'));
  process.exit(0);
});
process.stdout.on('error', () => process.exit(0));
