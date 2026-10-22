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
import { siteTier, pluginSlash } from './pluginTier';

/** `window.API_BASE`, always ending in exactly one slash. */
export function apiBase() {
  const base = String((typeof window !== 'undefined' && window.API_BASE) || '');
  return base ? base.replace(/\/+$/, '') + '/' : '';
}

const seg = (value) => encodeURIComponent(String(value));

async function readError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    /* an unreadable body says nothing; fall through to the status */
  }
  if (body && typeof body.error === 'string' && body.error.trim()) return { message: body.error, body };
  if (body && typeof body.message === 'string' && body.message.trim()) return { message: body.message, body };
  return { message: `The server said no (${response.status}).`, body };
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
    const said = await readError(response);
    const err = new Error(said.message);
    err.status = response.status;
    // The server's whole answer: a refusal can carry more than a sentence (a run's `needsConfirm`).
    err.body = said.body;
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
    /**
     * What the room's window shows (parity PLAN §2.9a): `{screen?, codes?, profile?, rotate?}`
     * → `{wall}`, plus `{wallKey}` when it rotated.
     */
    wall: (body) => post('wall', body),
    /** `{kind, prompt, detail?, options?, lowLabel?, highLabel?, maxPicks?, draft?}` → `{ask}` */
    createAsk: (body) => post('asks', body),
    /** The room's ready questions for Claude (question-sets plan step 4): `{ kind, sets }`. */
    saveReady: (body) => post('ready', body),
    getAsk: (askId) => call(`${root}asks/${seg(askId)}`),
    /** `{action:'edit'|'open'|'vote'|'close'|'decide'|'reopen'|'discard', …}` → `{ask}` */
    askAction: (askId, body) => post(`asks/${seg(askId)}`, body),
    reask: (askId, body) => post(`asks/${seg(askId)}`, { action: 'reask', ...body }),
    /** Add what the room said out loud as a suggestion. */
    addResponse: (askId, text) => post(`asks/${seg(askId)}/responses`, { text }),
    /** `{action:'hide'|'show'|'edit', text?}` */
    responseAction: (askId, respId, body) => post(`asks/${seg(askId)}/responses/${seg(respId)}`, body),
    /** `{kind, text, detail?, link?, forAgent?}` → `{entry}` */
    postLog: (body) => post('log', body),
    /** `{action:'edit'|'delete', text?, detail?}` → `{entry}` */
    logAction: (logId, body) => post(`log/${seg(logId)}`, body),
    /**
     * A direction; `as` is keep, later or ask (step 7c), else Do now. `from` names
     * what it was written from (`{ askIds, ideaIds }`, parity PLAN §2.8 H1), so
     * History can mark those as sent to Claude.
     */
    postDirection: (text, as, from = null) => post('directions', {
      text,
      ...(as && as !== 'do-now' ? { as } : {}),
      ...(from && from.askIds && from.askIds.length ? { fromAskIds: from.askIds } : {}),
      ...(from && from.ideaIds && from.ideaIds.length ? { fromIdeaIds: from.ideaIds } : {}),
    }),
    /** The host removes a screenshot. */
    /** Engage staff deleting in another team's room give `reason` (the owner's delete rule, 2026-10-04). */
    deleteImage: (imageId, reason = '') => post(`images/${seg(imageId)}`, { action: 'delete', ...(reason ? { reason } : {}) }),
    /**
     * CONSIDER (docs/design/build-room-consider): one thing the room gave, by its
     * item key (`idea:…`, `resp:ask:id`, `option:ask:label`, `why:ask:id`).
     * `{ item, go: 'send'|'later', text?, why? }` → `{entry}`;
     * `{ item, go: 'queue', round: 'vote'|'yesno'|'feedback', prompt? }` → `{idea}` or `{ask}`.
     */
    consider: (body) => post('consider', body),
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
    /** The Host alert's seen, kept on the room: `{ids}` or `{all: true}` → `{seen}`. */
    markSeen: (body) => post('seen', body),
    /** Take the room comment off the wall before its time is up. */
    clearWall: () => post('ideas/wall/clear'),
    /** `{summary, built?, links?, nextSteps?}` → `{outcome}` */
    saveOutcome: (body) => post('outcome', body),
    /**
     * THE RELEASE GATE (parity PLAN §2c): Claude's held posts to the room
     * (`release`), or the host's for good (`keep`). → `{released}` | `{kept}`
     */
    postsAction: (action, ids) => post('posts', { action, ids }),
    /** `{reviewAgentAsks?, reviewAgentPosts?, listNames?, agentName?}` → `{settings}` */
    saveSettings: (body) => post('settings', body),
    // ── Talking points (docs/design/build-room-talking-points; build-room.js) ──
    /** `{kind:'research'|'ideas', subject}` → `{request}`: Claude (or a helper) starts when it next listens. */
    pointRequest: (kind, subject) => post('points/requests', { kind, subject }),
    /** Cancel a request that is stuck. → `{request}` */
    cancelPointRequest: (requestId) => post(`points/requests/${seg(requestId)}`, { action: 'cancel' }),
    /** A question set Claude wrote (question-sets plan step 7): `saved` or `remove`. */
    claudeSetAction: (setId, action) => post(`question-sets/${seg(setId)}`, { action }),
    /** One of its drafts into the AI drafts review behind the bell (admin/generation-drafts.js from-build). */
    draftFromBuild: (body) => call('admin/generation-drafts/from-build', { method: 'POST', body }),
    /** `'remove'|'later'|'show'|'hide'|'send'` → `{point, ideasAbout?, ideaIds?}` */
    pointAction: (pointId, action) => post(`points/${seg(pointId)}`, { action }),
    /** Several points to Claude as ONE direction. → `{sent:[ids]}` */
    sendPoints: (ids) => post('points/send', { ids }),
    /** `{ids (2-8), prompt?, maxPicks?}` → `{ask}`: ticked points to a multi-pick vote. */
    votePoints: (body) => post('points/vote', body),
    /** The run list (Work through in turn). `{force?, from?}` → `{run}`; 409 `needsConfirm` when Claude has not reported the item done. */
    runNext: (body = {}) => post('run/next', body),
    /** The next pending item goes to Later; the one after becomes next. → `{run}` */
    runSkip: (body = {}) => post('run/skip', body),
    /** Everything not yet sent goes to Later, and the list closes. → `{run}` */
    runStop: (body = {}) => post('run/stop', body),
    /** `{order: [pointIds of every pending item], ver}` → `{run}`; 409 when the list changed. */
    runReorder: (order, ver, runId) => post('run/reorder', { order, ver, ...(runId ? { runId } : {}) }),
    // ── The Session panel's Players (the routes every engagement's Players tab uses) ──
    /** The roster: `{players, removedPlayers}`. A public route, read with the host's sign-in all the same. */
    players: () => call(`games/${seg(gameId)}/players`),
    /** Unlock a name for one handover (`bindToRequester` binds it to the device that asked), `{lock:true}` closes it, `{refuse:true}` answers Not now. */
    playerHandover: (name, body) => call(`games/${seg(gameId)}/players/${seg(name)}/handover`, { method: 'POST', body }),
    /** Take a person out of the live counts (`removed: true`) or bring them back (`false`). Nothing they did is lost. */
    playerRemoved: (name, removed) => call(`games/${seg(gameId)}/players/${seg(name)}/remove`, { method: 'POST', body: { removed } }),
    /** A builder's Remove: closes the seat, retires their keys, soft-removes the player. */
    removeBuilder: (name) => post(`crew/builders/${seg(name)}/remove`),
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

// Pure, in links.js so the room's window can use it without this module (B5).
export { safeHref } from './links';

/**
 * The one command the host pastes (PLAN §7): fetch the MCP server from this
 * site and register it with the real API base and the freshly minted key.
 */
// ONE PLUGIN PER TIER: siteTier, pluginName and pluginSlash live in pluginTier.js
// (the marketing page reads them without this module); re-exported here.
export { siteTier, pluginName, pluginSlash } from './pluginTier';

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
    `  && node ~/.engage-mcp.mjs --install-plugin --api ${api}${siteTier() === 'prod' ? '' : ` --tier ${siteTier()}`}`,
  ].join('\n');
}

/** Each session, with the plugin: one line typed into Claude Code. */
export const pluginConnectCommand = (key) => `${pluginSlash('connect')} ${key}`;

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
/**
 * One paste into a terminal: make the folder, start Claude Code in it, and
 * kick off with the key (plugin 1.25.0: kickoff connects first; owner 18 Oct,
 * "why not just kickoff as well?"). The key travels once, here.
 */
export const startCommand = (folder, key) => `mkdir -p ~/build-room/${folder} && cd ~/build-room/${folder} && claude "${pluginSlash('kickoff')} ${key}"`;

/**
 * A folder the plugin reported, as a shell would read it: "~/a/b" as is when
 * it is plain; otherwise quoted after $HOME. '' when there is none, or it is
 * not under the home folder (the plugin sends only the name then).
 */
export function shellFolder(folder) {
  const f = String(folder || '');
  if (!f.startsWith('~/')) return '';
  const rest = f.slice(2);
  if (/^[A-Za-z0-9._/-]+$/.test(rest)) return `~/${rest}`;
  return `"$HOME/${rest.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** COMING BACK (W3): open Claude Code in the folder on kickoff. No key: the folder keeps its own. */
export const resumeCommand = (folder) => {
  const cd = shellFolder(folder);
  return `${cd ? `cd ${cd} && ` : ''}claude "${pluginSlash('kickoff')}"`;
};

/** W4: the plugin update, then the same reopen, in one paste. */
export const updateAndResumeCommand = ({ origin, api, folder }) => `${pluginInstallCommand({ origin, api })} \\\n  && ${resumeCommand(folder)}`;

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
