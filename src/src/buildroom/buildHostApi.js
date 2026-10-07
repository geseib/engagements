/**
 * BUILD ROOM — the host's client (docs/design/build-room/PLAN.md §6.1).
 *
 * One small function per host route on `/games/{gameId}/build/{proxy+}`, all
 * over `authFetch` so the Cognito token and the active org ride along exactly
 * as they do for every other host call. The handler is
 * lambda-functions/game/build-room.js; the shapes it answers with are
 * build-store.js's `hostView` / `askView`.
 *
 * EVERY CALL THROWS ON FAILURE, with the server's own sentence when it sent
 * one (`{error}`), so the page can show it as it is. build-room.js writes those
 * sentences for a person ("This ask is live; \"open\" needs it to be proposed").
 *
 * The API base is read at call time, never cached: config.js sets
 * `window.API_BASE` before the bundle runs, and tests set it per case.
 */
import { authFetch } from '../auth/authFetch';
import { requestEndSession } from '../utils/endSession';
import { requestHostTicket } from '../utils/hostTicketClient';

/** `window.API_BASE`, always ending in exactly one slash. */
export function apiBase() {
  const base = String((typeof window !== 'undefined' && window.API_BASE) || '');
  return base ? base.replace(/\/+$/, '') + '/' : '';
}

const seg = (value) => encodeURIComponent(String(value));

async function readError(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch (e) {
    /* an unreadable body says nothing; fall through to the status */
  }
  return `The server said no (${response.status}).`;
}

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await authFetch(`${apiBase()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new Error('That did not reach the server. Check the connection and try again.');
  }
  if (!response.ok) {
    const err = new Error(await readError(response));
    err.status = response.status;
    throw err;
  }
  try {
    return await response.json();
  } catch (e) {
    return {};
  }
}

/**
 * A screenshot's bytes are private, so the host fetches them with its sign-in
 * and shows a blob URL. One fetch per image per page load: an image never
 * changes once sent (a new one gets a new id).
 */
const imageCache = new Map();
export function hostImageUrl(gameId, imageId) {
  const key = `${gameId}/${imageId}`;
  if (!imageCache.has(key)) {
    imageCache.set(key, authFetch(`${apiBase()}games/${seg(gameId)}/build/images/${seg(imageId)}`)
      .then((r) => { if (!r.ok) throw new Error(`image ${r.status}`); return r.blob(); })
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { imageCache.delete(key); throw e; }));
  }
  return imageCache.get(key);
}

/** The host routes of one Build Room. */
export function buildApi(gameId) {
  const root = `games/${seg(gameId)}/build/`;
  const post = (path, body = {}) => call(root + path, { method: 'POST', body });
  return {
    /** HostState. */
    state: () => call(`${root}state`),
    /** `{kind, prompt, detail?, options?, lowLabel?, highLabel?, maxPicks?, draft?}` → `{ask}` */
    createAsk: (body) => post('asks', body),
    getAsk: (askId) => call(`${root}asks/${seg(askId)}`),
    /** `{action:'edit'|'open'|'vote'|'close'|'decide'|'reopen'|'discard', …}` → `{ask}` */
    askAction: (askId, body) => post(`asks/${seg(askId)}`, body),
    /** Add what the room said out loud as a suggestion. */
    addResponse: (askId, text) => post(`asks/${seg(askId)}/responses`, { text }),
    /** `{action:'hide'|'show'|'edit', text?}` */
    responseAction: (askId, respId, body) => post(`asks/${seg(askId)}/responses/${seg(respId)}`, body),
    /** `{kind, text, detail?, link?, forAgent?}` → `{entry}` */
    postLog: (body) => post('log', body),
    /** `{action:'edit'|'delete', text?, detail?}` → `{entry}` */
    logAction: (logId, body) => post(`log/${seg(logId)}`, body),
    /** A direction; `as` is keep, later or ask (step 7c), else Do now. */
    postDirection: (text, as) => post('directions', { text, ...(as && as !== 'do-now' ? { as } : {}) }),
    /** The host removes a screenshot. */
    /** Engage staff deleting in another team's room give `reason` (the owner's delete rule, 2026-10-04). */
    deleteImage: (imageId, reason = '') => post(`images/${seg(imageId)}`, { action: 'delete', ...(reason ? { reason } : {}) }),
    /** 'direct' | 'suggest' | 'acknowledge' | 'wall' | 'later' | 'dismiss' | 'restore' */
    ideaAction: (ideaId, action, extra = {}) => post(`ideas/${seg(ideaId)}`, { action, ...extra }),
    /** Queue it: the host's own idea, waiting in the queue (step 4). */
    queueIdea: (text) => post('ideas', { text }),
    /** The room brief (step 7c): `{forWhom?, keep?, later?}` → `{brief}`. */
    editBrief: (body) => post('brief', body),
    /** The brief's Later list, to a Pick one vote. */
    laterToVote: () => post('brief/vote', {}),
    /** Send one held For Claude, later item now, as Do now. */
    sendLater: (id) => post(`brief/later/${seg(id)}/send`, {}),
    /** The opening (owner, 2026-10-06): 'answer' {step, text}, 'skip' / 'reopen' {step}, or 'start'. */
    openingAction: (action, body = {}) => post(`opening/${seg(action)}`, body),
    /** Claude's draft of the brief: 'accept' {headline, summary, lines} (as edited) or 'dismiss'. */
    settleDraft: (action, body = {}) => post(`opening/draft/${seg(action)}`, body),
    /**
     * READY QUESTIONS (step 7b, C13): every set this host can read, from the
     * session picker's own route; the library keeps those tagged build-room.
     */
    questionSets: () => call('question-sets').then((out) => (Array.isArray(out.sets) ? out.sets : [])),
    /** One set's questions, read in the scope the set was listed in. */
    setQuestions: (set) => call(`question-sets/${seg(set.id)}/questions${set.scope ? `?scope=${seg(set.scope)}` : ''}`),
    /** `{ideaIds, prompt?, maxPicks?, open?, askForMockups?}` → `{ask}`: ticked ideas to a vote (step 4, C3). */
    askFromIdeas: (body) => post('asks-from-ideas', body),
    /** Acknowledge every new idea at once (owner, 2026-10-05). */
    acknowledgeAll: () => post('ideas/acknowledge-all'),
    /** Take the room comment off the wall before its time is up. */
    clearWall: () => post('ideas/wall/clear'),
    /** `{summary, built?, links?, nextSteps?}` → `{outcome}` */
    saveOutcome: (body) => post('outcome', body),
    /** `{reviewAgentAsks?, agentName?}` → `{settings}` */
    saveSettings: (body) => post('settings', body),
    /** The Wi-Fi share: `{on}` or `{dismissOffer: true}` → `{lan}` */
    share: (body) => post('share', body),
    /** → `{key, keyId}`. The key is shown once. */
    mintKey: (label) => post('keys', label ? { label } : {}),
    revokeKey: (keyId) => post(`keys/${seg(keyId)}/revoke`),
    /** POST games/{id}/end — the same call GameHostPage's End makes. */
    endSession: async () => {
      const result = await requestEndSession({ fetchFn: authFetch, apiBase: apiBase(), gameId });
      if (!result.ended) throw new Error(result.error || 'The session did not end.');
      return result.data;
    },
    /** The single-use ticket that makes this page's socket a HOST socket. */
    hostTicket: async () => (await requestHostTicket({ fetchFn: authFetch, apiBase: apiBase(), gameId })).ticket,

    // ── Crew mode (docs/design/build-room-crew/FLOWS.md; build-crew.js) ──
    /** `{enabled?, modes?, runCrewCode?}` → `{crew}`. The repo and base come from the host's Claude (share_repo). */
    crewSettings: (body) => post('crew/settings', body),
    /** `{text, detail?}` → `{task}` */
    crewAddTask: (body) => post('crew/tasks', body),
    /** `{action:'edit'|'done'|'reopen'|'delete', text?, detail?}` → `{task}` */
    crewTaskAction: (taskId, body) => post(`crew/tasks/${seg(taskId)}`, body),
    /** 'feature' | 'unfeature' | 'not-now' | 'reopen' → `{share}` */
    crewShareAction: (shareId, action) => post(`crew/shares/${seg(shareId)}`, { action }),
    /** The room's reactions, shaped by the host, to the builder's Claude. */
    crewFeedback: (shareId, text) => post(`crew/shares/${seg(shareId)}/feedback`, { text }),
    /** Ask the host's own Claude to review an early look. */
    crewReviewRequest: (shareId) => post(`crew/shares/${seg(shareId)}/review-request`),
    /** The host replies on an early look. */
    crewComment: (shareId, text) => post(`crew/shares/${seg(shareId)}/comments`, { text }),
    /** 'send-claude' | 'resolve' for a builder who asked for help. */
    crewHelpAction: (name, action) => post(`crew/help/${seg(name)}`, { action }),
    /** `{commit, note?, shareId?}`: the base branch moved. Usually the host's Claude says so. */
    crewBase: (body) => post('crew/base', body),
  };
}

/**
 * Create and start a Build Room. Resolves the new gameId.
 *
 * `POST /games` is create-game.js, a whitelist: `eventTitle`, `engagementInfo`
 * (stored as METADATA `Details`, which build-store reads as the goal),
 * `gameType`, `visibility`, `accessCode`. Then `POST games/{id}/start`, because
 * a Build Room has no lobby: the room joins while Claude builds.
 */
export async function createBuildSession({ title, goal, visibility = 'public', accessCode = '' }) {
  const body = {
    eventTitle: String(title || '').trim(),
    engagementInfo: String(goal || '').trim(),
    gameType: 'build',
    visibility: visibility === 'private' ? 'private' : 'public',
    ...(visibility === 'private' ? { accessCode: String(accessCode || '').trim() } : {}),
  };
  const created = await call('games', { method: 'POST', body });
  const gameId = created && created.gameId;
  if (!gameId) throw new Error('The session was created without a code. Try again.');
  await call(`games/${seg(gameId)}/start`, { method: 'POST', body: {} });
  return String(gameId);
}

// ── Where a Build Room lives ────────────────────────────────────────────────

/** `build` is deliberately not in config/gameTypes.js (PLAN §4), so it is named here. */
export const BUILD_GAME_TYPE = 'build';
export const BUILD_LABEL = 'Build Room';
export const isBuildSession = (session) => Boolean(session) && session.gameType === BUILD_GAME_TYPE;
export const buildRoomPath = (gameId) => `/build?gameId=${encodeURIComponent(gameId)}`;
export const buildReportPath = (gameId) => `${buildRoomPath(gameId)}&view=report`;

// ── Untrusted text ──────────────────────────────────────────────────────────

/** An http(s) URL as a string, or '' — anything Claude or a phone sent is untrusted. */
export function safeHref(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch (e) {
    return '';
  }
}

/**
 * The one command the host pastes (PLAN §7): fetch the MCP server from this
 * site and register it with the real API base and the freshly minted key.
 */
/**
 * THE PLUGIN ROUTE (recommended). Once per laptop: fetch the server and let it
 * install the Engage plugin for Claude Code — the server, the slash commands
 * and the hook that checkpoints every turn in git. No key in it, so it can be
 * shown before one is minted.
 */
export function pluginInstallCommand({ origin, api }) {
  const site = String(origin || '').replace(/\/+$/, '');
  return [
    `curl -fsSL ${site}/engage-mcp.mjs -o ~/.engage-mcp.mjs \\`,
    `  && node ~/.engage-mcp.mjs --install-plugin --api ${api}`,
  ].join('\n');
}

/** Each session, with the plugin: one line typed into Claude Code. */
export const pluginConnectCommand = (key) => `/engage:connect ${key}`;

/**
 * THE START CAP (owner, 2026-10-06): a folder named for the project. The same
 * rule as the plugin's projectSlug (engage-mcp.mjs): lower case, words joined
 * by hyphens, a leading "Build" dropped.
 */
export function projectSlug(title) {
  const words = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const trimmed = words[0] === 'build' && words.length > 1 ? words.slice(1) : words;
  return trimmed.join('-').slice(0, 60).replace(/-+$/, '') || 'build-room';
}
/** What a host may type as the folder name: the slug's own alphabet, nothing a shell would read. */
export const cleanFolder = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
/** One paste into a terminal: make the folder, start Claude Code in it, connect. */
export const startCommand = (folder, key) => `mkdir -p ~/build-room/${folder} && cd ~/build-room/${folder} && claude "/engage:connect ${key}"`;

export function connectCommand({ origin, api, key }) {
  const site = String(origin || '').replace(/\/+$/, '');
  return [
    `curl -fsSL ${site}/engage-mcp.mjs -o ~/.engage-mcp.mjs \\`,
    '  && claude mcp add engage \\',
    `  --env ENGAGE_API=${api} \\`,
    `  --env ENGAGE_KEY=${key} \\`,
    '  -- node ~/.engage-mcp.mjs',
  ].join('\n');
}
