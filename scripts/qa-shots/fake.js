/* The fake API + Cognito stub for the new-host / new-participant shots.
   A scenario is a plain object; respond(scn, req) answers one request or returns null. */
const GAME = '4821';
const TITLE = 'Northwind Q4 planning offsite';

const NAMES = ['Maya', 'Sam', 'Priya', 'Jon', 'Aisha', 'Tom', 'Lena', 'Diego', 'Kofi', 'Hannah', 'Ravi', 'Grace', 'Omar', 'Elin', 'Marcus'];
const ANSWERS = [
  'Weekly status meetings that could be a two-line written note. Write the note, cancel the meeting.',
  'Reviewing every pull request twice. One careful review beats two quick ones.',
  'Saying yes to every request mid-sprint. Protect the plan we agreed on.',
  'Rebuilding the reporting dashboard every quarter.',
  'Copying the whole team on every email thread.',
  'Starting new projects before we finish the old ones.',
  'Running retros where nothing changes afterwards.',
  'Waiting for sign-off from three managers on small spend.',
  'Writing docs nobody reads instead of talking to the customer.',
  'Hand-building the monthly numbers in spreadsheets.',
  'Booking hour-long meetings by default.',
  'Treating every bug as urgent.',
  'Planning in detail more than two quarters ahead.',
  'Answering Slack within minutes as if it were a phone call.',
  'Re-litigating decisions we already made.',
];

const MY_ANSWER = 'The Monday status call. Thirty people, an hour, and it repeats what the tracker already says.';
const QUESTION = {
  id: '003', questionNumber: '003',
  title: 'What should we stop doing next quarter?',
  detail: 'Every team carries habits that made sense once and now cost more than they return: a meeting nobody would miss, a report nobody reads, an approval step that only adds a day. Think about the last month of your own work. Name one thing this team does regularly that you would stop tomorrow if nobody objected, and say in a sentence what it costs us now. Be specific; we will vote on these next.',
  questionDetail: '',
  category: 'Retro', field: 'Retro', school: '', image: '',
  customInstructions: 'One habit, one sentence on its cost. Keep it under 20 words.',
  setId: 'team-retro', setRoundNoun: null, setCustomInstruction: null,
  startedAt: new Date(Date.now() - 95000).toISOString(),
  optionA: '', optionB: '', optionC: '', optionD: '', optionE: '', optionF: '',
};
QUESTION.questionDetail = QUESTION.detail;

function scenario(o) {
  const s = { phase: 'lobby', joined: 0, answered: 0, voted: 0, me: null, myAnswered: false, myVoted: false, ...o };
  s.players = NAMES.slice(0, s.joined);
  if (s.me) { const rest = NAMES.filter((n) => n !== s.me).slice(0, Math.max(0, s.joined - 1)); s.players = s.myAnswered ? [s.me, ...rest] : [...rest, s.me]; }
  s.answerers = s.players.slice(0, s.answered);
  s.voters = s.players.slice(0, s.voted);
  return s;
}

function stateString(s) {
  return { lobby: 'STARTED', ask: 'ASK#003', vote: 'VOTE#003', results: 'RESULTS#003', created: 'CREATED' }[s.phase];
}

const textOf = (s, n, i) => (n === s.me ? MY_ANSWER : ANSWERS[i % ANSWERS.length]);
function answers(s) {
  return s.answerers.map((n, i) => ({ playerName: n, name: n, answer: textOf(s, n, i), answerType: 'text', submittedAt: new Date(Date.now() - 60000 + i * 3000).toISOString() }));
}

function tallies(s) {
  const out = {};
  const pts = [14, 11, 9, 7, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0];
  s.answerers.forEach((n, i) => {
    out[i] = { playerName: n, answerText: textOf(s, n, i), totalScore: pts[i] || 0, firstPlace: Math.max(0, 4 - i), secondPlace: i % 3, thirdPlace: i % 2 };
  });
  return out;
}

function hostState(s, { host = true, playerName = null, view = null } = {}) {
  const st = stateString(s);
  const inRound = s.phase !== 'lobby' && s.phase !== 'created';
  const r = {
    gameId: GAME, state: st, names: null, openedAt: new Date(Date.now() - 600000).toISOString(), warnedAt: null,
    currentQuestion: inRound ? 3 : 0,
    currentQuestionData: inRound ? QUESTION : null,
    commentsOpen: true, time: null, serverNow: Date.now(),
    authorsRevealed: s.phase === 'results',
    stageBeat: s.beat || 'results',
    stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
    stageNotes: { page: 0, pages: null, plan: null, planKey: null, rev: 0 },
    stageProfile: null,
    scoreboard: { open: false, look: 'standard', rev: 0 },
    eventPaused: false, gameType: 'call-and-answer',
    gameMetadata: {
      title: TITLE, hostName: 'Rachel Kim', gameType: 'call-and-answer', questionSetId: 'team-retro', questionSetScope: 'platform',
      selectedCategories: [], personaId: null, promptId: null, briefed: false, createdAt: new Date(Date.now() - 3600000).toISOString(),
      names: null, openedAt: null, warnedAt: null,
    },
  };
  if (host) {
    Object.assign(r, {
      target: 5, presenting: s.presenting == null ? 1 : s.presenting, presentDetail: (s.presenting == null || s.presenting > 0) ? { open: true, visible: true, fullscreen: true, ageMs: 4000, statusAt: new Date().toISOString() } : null, hostTime: null, phaseStartedAt: new Date(Date.now() - 95000).toISOString(),
      hostNotes: null, hostAnswer: null,
      questionQueue: { queue: [], version: 0, setId: null, setVersion: null, updatedAt: null, ownQuestions: [] },
    });
    if (s.phase === 'ask') r.answerProgress = { answersReceived: s.answered, totalPlayers: s.players.length, answererIds: s.answerers };
    if (s.phase === 'vote') r.votingProgress = { votesReceived: s.voted, totalPlayers: s.players.length, votersIds: s.voters };
  }
  if (view === 'room') r.roomCounts = { joined: s.players.length, answered: s.answered, voted: s.voted };
  if (playerName) {
    r.playerData = { playerId: `p-${playerName}`, playerName, totalScore: s.phase === 'results' ? 9 : 0, joinedAt: new Date(Date.now() - 500000).toISOString() };
    if (inRound) r.playerQuestionState = { questionNumber: '003', hasAnswered: !!s.myAnswered, hasVoted: !!s.myVoted };
  }
  return r;
}

function players(s) {
  const st = stateString(s);
  const list = s.players.map((n, i) => {
    const hasAnswered = s.answerers.includes(n); const hasVoted = s.voters.includes(n);
    const isReady = st.startsWith('ASK') ? hasAnswered : st.startsWith('VOTE') ? hasVoted : st.startsWith('RESULTS');
    return {
      playerId: `p-${n}`, playerName: n, totalScore: s.phase === 'results' ? Math.max(0, 14 - i * 2) : 0, rank: null, movement: 0, previousScore: null,
      joinedAt: new Date(Date.now() - 500000 + i * 7000).toISOString(), isConnected: true, deviceConnected: true,
      readiness: { isReady, type: st.startsWith('ASK') ? 'answered' : st.startsWith('VOTE') ? 'voted' : 'waiting', hasAnswered, hasVoted },
      handover: { requested: false }, ranking: { rank: null, label: null, isTop3: false, position: i + 1 },
    };
  });
  return {
    gameId: GAME, players: list, removedPlayers: [],
    stats: { totalPlayers: list.length, readyCount: list.filter((p) => p.readiness.isReady).length, answeredCount: s.answered, votedCount: s.voted, connectedCount: list.length, readyPercentage: 0 },
    currentState: st, currentQuestionId: 'q-17', currentRound: s.phase === 'lobby' ? null : '003', afterRound: s.phase === 'results' ? 3 : 2, timestamp: new Date().toISOString(),
  };
}

function gameBrief(s) {
  return {
    gameId: GAME, title: TITLE, gameType: 'call-and-answer', anonymousUntilReveal: true, createdAt: new Date(Date.now() - 3600000).toISOString(),
    hostName: 'Rachel Kim', visibility: 'public', started: s.phase !== 'created', state: stateString(s), currentQuestionId: null,
    lessonNumber: s.phase === 'lobby' ? 0 : 3, names: null, openedAt: null, warnedAt: null,
    engagementInfo: 'Half-day planning session for the Northwind product team.',
  };
}

const SUMMARY = {
  questionId: '003', status: 'ready',
  summary: 'The room wants fewer standing rituals and more protected focus time. The strongest theme is meetings that exist to report status: five of nine answers name one. A second theme is decisions that get reopened or need too many sign-offs.',
  markdownResponse: '## What the room said\n\n- Status meetings that could be a short written note cost the most time.\n- Double reviews and three-step sign-offs slow small work without catching more.\n- Mid-sprint requests break the plan the team agreed.\n\n## Discussion topics\n\n1. Which recurring meeting would nobody miss next week?\n2. What would one careful review need to be enough?\n\n## Next steps\n\n- Pick two meetings to replace with a written update for a month.',
  discussionQuestions: ['Which recurring meeting would nobody miss next week?', 'What would one careful review need to be enough?'],
  nextSteps: ['Pick two meetings to replace with a written update for a month.'],
  generatedAt: new Date(Date.now() - 30000).toISOString(),
};

const SETS = [{ id: 'team-retro', setId: 'team-retro', name: 'Team retro', title: 'Team retro', description: 'Questions for a team looking back at a quarter.', gameType: 'call-and-answer', questionCount: 12, scope: 'platform', categories: ['Retro', 'Planning'] }];

/** Answer one API request (path without the /__api/ prefix). Returns { status, body } or null. */
function respond(s, method, p, q, bodyText) {
  let m;
  const ok = (body) => ({ status: 200, body });
  if (p === 'games' && method === 'GET') return ok({ games: [] });
  if (p === 'orgs') return ok({ orgs: [], memberships: [], yourRole: null, personal: { id: 'personal', name: 'Rachel Kim' } });
  if (p === 'question-sets') return ok({ questionSets: SETS, sets: SETS });
  if ((m = p.match(/^question-sets\/([^/]+)\/categories$/))) return ok({ categories: [{ id: 1, name: 'Retro', count: 8 }, { id: 2, name: 'Planning', count: 4 }], setId: m[1] });
  if ((m = p.match(/^question-sets\/([^/]+)\/questions$/))) return ok({ questions: [] });
  if (p === 'games/get-results') {
    if (s.phase !== 'results') return { status: 400, body: { error: 'not results' } };
    return ok({ gameId: GAME, gameType: 'call-and-answer', questionNumber: '003', voteTallies: tallies(s), state: 'RESULTS#003' });
  }
  if ((m = p.match(/^games\/(\w+)$/)) && method === 'GET') return ok(gameBrief(s));
  if ((m = p.match(/^games\/(\w+)\/host-details$/))) return ok({ ...gameBrief(s), questionSetId: 'team-retro', questionSetScope: 'platform', details: '', personaId: '', promptId: '', target: 5, randomizeQuestions: true, usedQuestions: [], playedQuestions: [], categoryState: null, aiContext: '', briefing: null });
  if ((m = p.match(/^games\/(\w+)\/host-state$/))) return ok(hostState(s));
  if ((m = p.match(/^games\/(\w+)\/state$/))) {
    const pn = q.get('playerName') || q.get('playerId') || null;
    return ok(hostState(s, { host: false, playerName: pn ? (pn.replace(/^p-/, '')) : null, view: q.get('view') }));
  }
  if ((m = p.match(/^games\/(\w+)\/players$/))) {
    if (method === 'POST') {
      let b = {}; try { b = JSON.parse(bodyText || '{}'); } catch (e) { /* none */ }
      return ok({ success: true, gameId: GAME, playerId: `p-${b.playerName}`, playerName: b.playerName, isReconnection: false, gameType: 'call-and-answer', state: stateString(s) });
    }
    return ok(players(s));
  }
  if ((m = p.match(/^games\/(\w+)\/answers\/host$/))) return ok({ gameId: GAME, questionId: '003', answers: answers(s), answerCount: s.answered, timestamp: new Date().toISOString() });
  if ((m = p.match(/^games\/(\w+)\/state\/([^/]+)$/))) return ok(hostState(s, { host: false, playerName: decodeURIComponent(m[2]) }));
  if ((m = p.match(/^games\/(\w+)\/feedback-round$/))) return ok({ open: false });
  if ((m = p.match(/^games\/(\w+)\/followup-play\/live$/))) return { status: 404, body: { error: 'none' } };
  if ((m = p.match(/^games\/(\w+)\/answers$/)) && q.get('player')) return ok(s.myAnswered ? { hasAnswer: true, answer: MY_ANSWER } : { hasAnswer: false });
  if ((m = p.match(/^games\/(\w+)\/answers$/))) {
    if (s.phase === 'vote' || s.phase === 'results') return ok({ gameId: GAME, questionId: '003', answers: answers(s).map(({ answer, answerType }) => ({ answer, answerType })), answerCount: s.answered });
    return ok({ gameId: GAME, questionId: '003', answerCount: s.answered });
  }
  if ((m = p.match(/^games\/(\w+)\/question$/))) return s.phase === 'lobby' ? { status: 404, body: { error: 'No current question' } } : ok(QUESTION);
  if ((m = p.match(/^games\/(\w+)\/votes\/host$/))) return ok({ gameId: GAME, questionNumber: '003', votes: s.voters.map((v, i) => ({ voter: v, voterName: v, rankings: [i % 3, (i + 1) % 3, (i + 2) % 3] })), voteCount: s.voted });
  if ((m = p.match(/^games\/(\w+)\/votes$/))) return ok({ gameId: GAME, questionNumber: '003', voteCount: s.voted, votes: [] });
  if ((m = p.match(/^games\/(\w+)\/ai-summary(\/host)?$/))) return s.phase === 'results' ? ok(SUMMARY) : ok({ status: 'not_ready' });
  if (p === 'site') return ok({});
  if (p === 'me/notifications/list') return ok({ items: [], notifications: [], unread: 0 });
  if (p === 'invites') return ok({ invites: [] });
  if (p === 'events') return ok({ events: [] });
  if (p.startsWith('admin/personas')) return ok({ personas: [] });
  if (p === 'admin/ai-prompts') return ok({ prompts: [] });
  if ((m = p.match(/^games\/(\w+)\/host-ticket$/))) return ok({ ticket: 'fixture-ticket' });
  if ((m = p.match(/^games\/(\w+)\/queue$/))) return ok({ queue: [], version: 0, setId: null, setVersion: null, updatedAt: null, ownQuestions: [] });
  if ((m = p.match(/^games\/(\w+)\/up-next$/))) return ok({ upNext: [], questions: [], remaining: 9 });
  if ((m = p.match(/^games\/(\w+)\/comments$/))) return ok({ comments: [] });
  if ((m = p.match(/^games\/(\w+)\/late$/))) return ok({ items: [], open: true });
  if ((m = p.match(/^games\/(\w+)\/asks/))) return ok({ asks: [], live: null });
  if ((m = p.match(/^games\/(\w+)\/stage-beat$/))) return ok({ ok: true });
  return null;
}

/* ---------- Cognito: unsigned tokens the frontend decodes but never verifies ---------- */
const CLIENT_ID = 'skinsfixtureclient';
const USERNAME = '0a1b2c3d-host-0000-0000-fixturehost01';
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(payload) { return `${b64u({ alg: 'RS256', kid: 'fixture', typ: 'JWT' })}.${b64u(payload)}.${b64u('not-a-signature')}`; }
function cognitoStorage() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 24 * 3600;
  const common = { sub: USERNAME, iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SKINSFIXTURE', 'cognito:groups': ['admins'], iat: now, auth_time: now, exp };
  const id = jwt({ ...common, aud: CLIENT_ID, token_use: 'id', 'cognito:username': USERNAME, email: 'rachel.kim@northwind.example', email_verified: true, name: 'Rachel Kim' });
  const access = jwt({ ...common, client_id: CLIENT_ID, token_use: 'access', scope: 'aws.cognito.signin.user.admin', username: USERNAME });
  const k = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  return {
    [`${k}.LastAuthUser`]: USERNAME,
    [`${k}.${USERNAME}.idToken`]: id,
    [`${k}.${USERNAME}.accessToken`]: access,
    [`${k}.${USERNAME}.refreshToken`]: 'fixture-refresh-token',
    [`${k}.${USERNAME}.clockDrift`]: '0',
  };
}
function cognitoRespond(target) {
  if (/GetUser$/.test(target)) {
    return { Username: USERNAME, UserAttributes: [
      { Name: 'sub', Value: USERNAME }, { Name: 'email', Value: 'rachel.kim@northwind.example' }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: 'Rachel Kim' },
    ] };
  }
  return {};
}

module.exports = { GAME, TITLE, scenario, respond, cognitoStorage, cognitoRespond, CLIENT_ID };
