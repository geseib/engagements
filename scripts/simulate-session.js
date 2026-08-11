#!/usr/bin/env node
/**
 * Play a whole call-and-answer session offline, against the REAL handlers.
 *
 *   node scripts/simulate-session.js                # full transcript to stdout
 *   node scripts/simulate-session.js --prompts 4,6  # also dump those rounds' prompts
 *   node scripts/simulate-session.js --quiet-prompts
 *
 * NO AWS CREDENTIALS. NO BEDROCK CALL. NO WRITES ANYWHERE BUT MEMORY.
 *
 * WHY THIS EXISTS. `docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md`
 * asks a set of falsifiable questions about a question set, a prompt and the
 * advisor's report. Answering them needs a played session — a roster, answers,
 * ballots, tallies, an assembled prompt, a report. The only honest way to get
 * one without a room and a table is to drive the deployed code paths in-process
 * with the SDK stubbed, which is what this does.
 *
 * THE ONE RULE THIS FILE IS BUILT AROUND: every number that reaches the
 * transcript is labelled with its provenance. `[REAL]` means the figure came
 * out of a lambda handler in this repo. `[FIXTURE]` means it is input this
 * script authored — the room, the answers, the ballots. Nothing is
 * `[REIMPLEMENTED]`; if that tag ever appears, it means a handler could not be
 * driven and its logic was copied here, which is the thing to avoid.
 *
 * Precedent for the stubbing: scripts/install-question-set.js (patch before
 * require, restore after) and tests/delete-question-set-flow.js /
 * tests/output-shape-flow.js (hook Module._load BY MODULE NAME, because
 * @aws-sdk/client-s3, client-lambda and client-bedrock-runtime exist only in
 * the deployed bundle and cannot be resolved from the repo root).
 *
 * DETERMINISM. Math.random is replaced with a fixed-seed mulberry32 and the
 * clock is frozen, so two runs of this file produce byte-identical output. The
 * game id, the category order and every timestamp are therefore reproducible.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};
const PROMPT_ROUNDS = String(flag('prompts', '4,6') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* ========================================================================== *
 * 0. Determinism
 * ========================================================================== */

// mulberry32, fixed seed. schema-compliant-manager.js shuffles question order
// with Math.random and websocket/create-game.js mints the 4-digit game id with
// it, so seeding this is what makes the whole run reproducible.
let __seed = 0x5eed1234;
Math.random = function seededRandom() {
  __seed |= 0; __seed = (__seed + 0x6D2B79F5) | 0;
  let t = Math.imul(__seed ^ (__seed >>> 15), 1 | __seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const FROZEN = Date.parse('2026-08-11T14:00:00.000Z');
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FROZEN); else super(...args); }
  static now() { return FROZEN; }
}
global.Date = FrozenDate;

/* ========================================================================== *
 * 1. The stubbed AWS SDK — one in-memory single-table store
 * ========================================================================== */

const TABLE = 'simulated-table';
process.env.TABLE_NAME = TABLE;
process.env.AI_PROMPTS_BUCKET = 'simulated-prompts-bucket';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'simulated-fn';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.invalid';
process.env.AWS_REGION = 'us-east-1';

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const store = new Map();
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);

/**
 * A SET-only UpdateExpression applier. Every handler this script drives uses
 * `SET a = :v, #b = :w` and nothing else (verified by grepping UpdateExpression
 * across the ten handlers below), so this covers the whole surface honestly
 * rather than pretending to be DynamoDB.
 */
function applyUpdate(input) {
  const key = k(input.Key.PK, input.Key.SK);
  const item = store.get(key) || { ...input.Key };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const setClause = String(input.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
  for (const pair of setClause.split(',')) {
    const [lhs, rhs] = pair.split('=').map((s) => s && s.trim());
    if (!lhs || !rhs) continue;
    item[names[lhs] || lhs] = values[rhs];
  }
  store.set(key, item);
  return {};
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(k(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return applyUpdate(inp);
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':setpk'] !== undefined ? v[':setpk'] : v[':pk'];
        const prefix = v[':sk'] ?? '';
        // SORTED BY SK. This is not cosmetic: the ballot is positional, and the
        // index a vote carries is the position of the answer in exactly this
        // query's result (get-results.js:406). DynamoDB returns a partition in
        // sort-key order, so ANSWER# rows come back alphabetically by player
        // name. A Map-insertion-order stub would silently score the wrong
        // answers.
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        return { Items: items.map((i) => ({ ...i })), Count: items.length };
      }
      case 'scan': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) => {
          if (v[':pk'] !== undefined && i.PK !== v[':pk']) return false;
          if (v[':isDefault'] !== undefined && i.isDefault !== v[':isDefault']) return false;
          if (v[':gameType'] !== undefined && i.gameType !== v[':gameType']) return false;
          return true;
        });
        return { Items: items, Count: items.length };
      }
      case 'batchWrite': {
        const reqs = Object.values(inp.RequestItems || {})[0] || [];
        for (const r of reqs) {
          if (r.PutRequest) put(r.PutRequest.Item);
          if (r.DeleteRequest) store.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
        }
        return { UnprocessedItems: {} };
      }
      default: return { Items: [], Count: 0 };
    }
  },
};

/** Every WebSocket frame a handler tried to push. */
const frames = [];
/** Every prompt handed to the (stubbed) Bedrock client, keyed by round. */
const prompts = {};
/** What the stub hands back as the model completion, keyed by round. */
let currentRound = null;

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class {
    async send(cmd) { frames.push({ to: cmd.input.ConnectionId, msg: JSON.parse(cmd.input.Data) }); return {}; }
  },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});

// S3 serves the prompt body. The bytes are the real
// sets/prompt-callandanswer-workie-advisor.json, read off disk — this stub is a
// transport, not an author.
const PROMPT_JSON = JSON.parse(
  fs.readFileSync(path.join(REPO, 'sets', 'prompt-callandanswer-workie-advisor.json'), 'utf8'));
const PROMPT_ID = 'callandanswer-workie-advisor';
const PROMPT_S3_KEY = `prompts/call-and-answer/${PROMPT_ID}/v1.json`;
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.input.Key !== PROMPT_S3_KEY) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => JSON.stringify(PROMPT_JSON) } };
    }
  },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});

// Bedrock: records the assembled prompt and returns the completion this file
// carries for that round. NO NETWORK CALL IS MADE. The completions in
// ADVISOR_COMPLETIONS were written by a model reading the recorded prompt — see
// the header comment on that constant.
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const prompt = JSON.parse(cmd.input.body).messages[0].content;
      prompts[currentRound] = prompt;
      const text = ADVISOR_COMPLETIONS[currentRound] || PLACEHOLDER_COMPLETION(currentRound);
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text }] })) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

/* ========================================================================== *
 * 2. The room  [FIXTURE]
 * ========================================================================== *
 *
 * Deliberately NOT tidy. The hypothesis (§D.2) warns that simulated answers
 * will be more coherent, more on-topic and more evenly distributed than a real
 * room's, and will understate near-duplicates and thin answers. So this room
 * carries, on purpose:
 *
 *   - a near-duplicate pair in round 1 (Dan and Kai say the same thing in
 *     different words, and split the vote for it: 4 points and 2 points);
 *   - genuinely thin answers (Hannah's three-word rounds; her round-3 answer
 *     refers to another answer by name, which is exactly the legibility problem
 *     the prompt's rule 8 is about);
 *   - a non-uniform denominator: Yuki joins at round 2, Ellis stops after
 *     round 4, and Ben, Kai, Hannah and Tomas each miss a round;
 *   - one close vote (round 2: 17 to 16), one runaway (round 5: 21 to 6);
 *   - well-argued answers that collect few or no points (Ellis in round 4 at
 *     zero, Ruth in round 6 at zero).
 */

const ROSTER = [
  { name: 'Priya',  full: 'Priya Raghavan',   role: 'staff engineer, payments' },
  { name: 'Marcus', full: 'Marcus Oyelaran',  role: 'SRE, primary on-call rotation' },
  { name: 'Dan',    full: 'Dan Whitfield',    role: 'senior full-stack' },
  { name: 'Yuki',   full: 'Yuki Tanaka',      role: 'platform / infrastructure (joins at round 2)' },
  { name: 'Sofia',  full: 'Sofia Marchetti',  role: 'test engineer' },
  { name: 'Ben',    full: 'Ben Kowalczyk',    role: 'engineer, two years in' },
  { name: 'Ellis',  full: 'Ellis Ngata',      role: 'mobile tech lead (leaves after round 4)' },
  { name: 'Hannah', full: 'Hannah Brecht',    role: 'data engineer' },
  { name: 'Tomas',  full: 'Tomas Ferreira',   role: 'security engineer' },
  { name: 'Ruth',   full: 'Ruth Adeyemi',     role: 'principal engineer' },
  { name: 'Kai',    full: 'Kai Lindstrom',    role: 'developer experience / build' },
];

/** Round n is played by whoever appears in ANSWERS[n]. */
const ANSWERS = {
  1: [
    ['Priya', 'Handed over: writing the migration plus its rollback script from a schema diff. Four months, right every time. Took back: anything touching the idempotency keys on the refund path. Third attempt it produced code that was correct in isolation and wrong against our retry semantics, and I only caught it because I already knew the answer.'],
    ['Marcus', 'Terraform module scaffolding went across and stayed across. The IAM policies came straight back. Third time round it handed me a policy that was wider than what I asked for and looked tighter, because it had swapped a wildcard resource for a wildcard action.'],
    ['Dan', 'Handed over the boilerplate for good: DTOs, mappers, the CRUD layer. Took back anything that needs a model of the whole system, like our socket reconnect, because it optimises the file in front of it and not the fleet.'],
    ['Sofia', 'Test fixture generation, permanently. Reclaimed flake triage: by the third pass it was confidently telling me a test was flaky when it was order-dependent, which is a different bug with a different fix.'],
    ['Ben', 'I stopped writing commit messages and PR descriptions by hand and I am not going back. Took back debugging the billing cron. Third time I asked, it just explained the code back to me in a more confident voice.'],
    ['Ellis', 'Handed over the Kotlin-to-Swift parity work, the boring half of it. Took back anything that crosses the JS bridge, because it cannot see both sides at once so it guesses, and a guess across a bridge looks exactly like a working change until the release.'],
    ['Hannah', 'dbt model boilerplate. Nothing reclaimed yet.'],
    ['Tomas', 'Handed over first drafts of threat model docs. Reclaimed dependency triage. Third time it told me a CVE did not apply to us and it did, because the vulnerable path was reachable through a transitive dev dependency it never opened.'],
    ['Ruth', 'The boundary is not stable for me and I think that is the actual answer. What I reclaimed in March I handed back in June and it worked. So I have stopped drawing the line by task type and started drawing it by whether I can check the output in less time than it would take me to produce it.'],
    ['Kai', 'Boilerplate went across permanently, DTOs and mappers and CRUD endpoints. What came back was anything needing a whole-system picture, our socket reconnect for instance, since it only ever sees the one file and not the fleet.'],
  ],
  2: [
    ['Priya', 'We are drifting toward heavier specs and I think it is right. Ambiguity used to cost a Slack thread; now it costs a merged branch that did the wrong thing convincingly. Our tickets have grown an acceptance-criteria block nobody mandated and everybody now writes.'],
    ['Marcus', 'Drifting to disposable. I built three versions of the alert-routing change in an afternoon and the argument ended itself. Nobody reads a doc that costs more than the thing it describes.'],
    ['Dan', 'We are drifting to the branch being the proposal and I think it is bad. Reviewing three speculative branches is more work than reading one paragraph, and the paragraph does not need a rebase.'],
    ['Yuki', 'More rigorous, but the rigour moved: the spec is now the test file and the interface stub, not prose. Whoever writes those is writing the ticket whether the tracker knows it or not.'],
    ['Sofia', 'Toward rigour, and it is exposing that we never actually agreed what half our features do. Every under-specified ticket now comes back as code that made the choice for us.'],
    ['Ben', 'Cheaper. I stopped writing up my own tickets and started opening a draft PR with a note on it. Whether that is good I genuinely cannot tell yet. It is faster, and I have shipped one thing I should not have.'],
    ['Ellis', 'More rigorous, and worse for us, because the rigour lands on the two people who can write a precise spec and they are now the bottleneck the agents were meant to remove.'],
    ['Hannah', 'Depends on the team.'],
    ['Tomas', 'Toward rigour, and not by choice. Our security requirements were unwritten folklore, and folklore does not survive being handed to something that will happily implement the literal words.'],
    ['Ruth', 'The ticket is becoming a receipt. We write it after the branch exists, for the audit trail. I do not think that is a drift anybody chose; I think it is what happens when the cheapest artefact to produce is the implementation.'],
    ['Kai', 'Disposable, and I would defend it. Three implementations cost an afternoon of compute and one of the three is usually obviously right in a way nobody predicted from the doc.'],
  ],
  3: [
    ['Priya', 'I stopped reading control flow line by line. What I read is the interface and its call sites, because if the shape is wrong it is wrong in fourteen places in six weeks and no second agent is going to tell me that.'],
    ['Marcus', 'I read the blast radius and nothing else. Does it touch data we cannot regenerate, does it touch auth, can it be reverted in one command. Anything inside a revertable, isolated blast radius I now let through unread.'],
    ['Dan', 'I read the tests, not the code. Specifically whether the test would fail if the code were wrong, which is a different question from whether the test passes.'],
    ['Yuki', 'I stopped reading anything with full coverage and no schema change. I read migrations character by character, because the reviewing agent is not on the pager at 3am and I am.'],
    ['Sofia', 'I stopped reading diffs entirely on internal admin tools. On customer-facing code I read the error paths only. The happy path is the part the machine is genuinely good at.'],
    ['Ben', 'Honestly I still read all of it, because that is how I learn what our code looks like. I know that is not the answer the question wants. If I stop reading I stop getting better, and I am two years in.'],
    ['Ellis', 'I read whether the change should exist. Half the agent PRs on our board are technically fine and solve a problem we invented. I stopped reading implementation quality and started reading justification.'],
    ['Hannah', 'Same as Dan, the tests.'],
    ['Tomas', 'I stopped reading for correctness. I read for trust boundaries: where untrusted input enters, and whether this change moved that line. A reviewing agent finds the null deref. It does not know which of our services is on the internet.'],
    ['Ruth', 'I read who else now depends on this. What I consciously let through unread is any code with a single caller inside one module, and I will keep doing that until it burns me.'],
  ],
  4: [
    ['Priya', 'Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else.'],
    ['Marcus', 'Regression-only, and verification moves into staged rollout. The cost is that users find the bug first, and I would rather say that out loud than pretend a canary is free.'],
    ['Dan', 'Mutation testing. The cost is CI minutes, which we measured at roughly four times our current suite runtime, plus a fortnight of noise on legacy code before the signal is usable.'],
    ['Yuki', 'Two agents, one writing from the spec and one from the implementation, neither seeing the other. The cost is that it only works if the spec is good, which just moves the bill to round two.'],
    ['Sofia', 'Human expectations, and I will name the cost precisely: it caps us at what I can write in a day, and I am one person. I would still take that over a suite that asserts the implementation back at me.'],
    ['Ben', 'Mutation testing, because it is the only one on the list that does not need a person to have been right first.'],
    ['Ellis', 'Regression-only. The cost lands on on-call and I am not the one carrying it, which is exactly why I distrust my own answer here.'],
    ['Hannah', 'Mutation testing.'],
    ['Tomas', 'None of the four. The cost I would pay is deleting tests. A suite that passes by construction is worse than no suite, because it buys confidence we did not earn. Cut it to the twenty tests we would actually cry about and let the coverage number fall.'],
    ['Ruth', 'Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it.'],
    ['Kai', 'Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at.'],
  ],
  5: [
    ['Priya', 'Policy. We cap agent-authored change at anything that cannot be undone by a single revert commit: no data migrations, no auth, nothing with a customer-visible failure mode. I have taken that page. A backfill that ran clean in staging doubled a fee in production. Monday I draw the line at write-path migrations, and Tuesday I defend it in the throughput meeting.'],
    ['Marcus', 'Tooling, and this was always the right answer; agents only made it urgent. My worst page was ninety minutes because the rollback needed a rebuild. If a revert is one command and ninety seconds, understanding the code at 2am is genuinely optional. Monday I make revert a one-button path and I measure it.'],
    ['Dan', 'I have never carried this pager and I am going to answer anyway: cap the autonomy. But I notice everyone who has carried one is answering tooling, and that probably tells me something about my answer.'],
    ['Yuki', 'Reframe. The last three pages I took, the first useful thing I did was paste the stack trace in and ask for three hypotheses. That is the job now, judging hypotheses rather than forming them. What changes Monday is the runbook: it should tell the on-call what to ask, not what to know.'],
    ['Sofia', 'Policy, but a narrower line than blast radius. Anything that changes an existing contract. New code can be agent-written all day; changed behaviour on something that already has callers cannot.'],
    ['Hannah', 'Rollback tooling.'],
    ['Tomas', 'Policy at the auth boundary specifically, and I will name the page: a dependency bump nobody read that changed a default from deny to allow. One line in a changelog. Monday I would put a required human sign-off on any diff that touches a policy file, and on nothing else.'],
    ['Ruth', 'What changes on Monday is what we page with. If no human read the change, the alert has to carry the diff and the last-known-good, or the on-call is doing archaeology under load. We changed our alert payload after exactly this and it halved our time to revert.'],
    ['Kai', 'None of the three, honestly. What changes is that nothing merges without a revert plan in the PR body, written by whoever pressed merge, human or not. It is a paperwork answer and I am aware of that.'],
  ],
  6: [
    ['Priya', 'Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything.'],
    ['Marcus', 'Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop.'],
    ['Dan', 'Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice.'],
    ['Yuki', 'Naming things. It sounds trivial and it decides whether the next person can find anything. The cost is that I hold up merges over words, and people find it tedious, including me.'],
    ['Sofia', 'Deciding what counts as a bug. The cost is that triage does not scale past me, the backlog grows faster than I can read it, and one day something in there will matter.'],
    ['Ben', 'The learning. It is a selfish answer. I will keep doing by hand the work that would make me better at it, and the cost is that I ship less than the person next to me and it shows at review time.'],
    ['Ruth', 'Giving junior engineers the work that used to make them senior. The cost is entirely present-tense and the payoff is five years out. It is slower this quarter, every quarter, and there is no dashboard on which it looks like anything but waste. It is the answer everyone nods at and nobody funds, and I have failed to fund it twice.'],
    ['Kai', 'Build and release. Not because a machine could not do it, but because when it breaks every person here is blocked, and I want that blast radius owned by somebody who can be woken up. The cost is that I am the single point of failure I am complaining about.'],
  ],
};

/**
 * Ballots. [voter, [first, second, third]] naming AUTHORS, not indices — the
 * index a vote actually carries is looked up from the real ballot order that
 * websocket/start-vote.js returns, so this file never guesses at positions.
 *
 * Not everyone who answers votes. Hannah never votes; Ben skips round 2 and
 * round 6's vote. That is the ordinary shape of a room, and it makes
 * responseCount and voteCount genuinely different numbers, which is the pair
 * the prompt's rule 2 turns on.
 */
const BALLOTS = {
  1: [
    ['Priya',  ['Ruth', 'Tomas', 'Marcus']],
    ['Marcus', ['Ruth', 'Priya', 'Tomas']],
    ['Dan',    ['Ruth', 'Kai', 'Priya']],
    ['Sofia',  ['Tomas', 'Ruth', 'Priya']],
    ['Ben',    ['Priya', 'Marcus', 'Ruth']],
    ['Ellis',  ['Marcus', 'Tomas', 'Dan']],
    ['Tomas',  ['Ruth', 'Marcus', 'Sofia']],
    ['Ruth',   ['Priya', 'Sofia', 'Tomas']],
    ['Kai',    ['Dan', 'Ruth', 'Marcus']],
  ],
  2: [
    ['Priya',  ['Ruth', 'Yuki', 'Sofia']],
    ['Marcus', ['Kai', 'Ruth', 'Dan']],
    ['Dan',    ['Priya', 'Ellis', 'Tomas']],
    ['Yuki',   ['Priya', 'Ruth', 'Tomas']],
    ['Sofia',  ['Priya', 'Tomas', 'Yuki']],
    ['Ellis',  ['Ruth', 'Priya', 'Marcus']],
    ['Hannah', ['Priya', 'Kai', 'Ruth']],
    ['Tomas',  ['Ruth', 'Sofia', 'Priya']],
    ['Ruth',   ['Yuki', 'Priya', 'Marcus']],
    ['Kai',    ['Marcus', 'Ruth', 'Dan']],
  ],
  3: [
    ['Priya',  ['Marcus', 'Tomas', 'Ruth']],
    ['Marcus', ['Tomas', 'Dan', 'Ruth']],
    ['Dan',    ['Marcus', 'Tomas', 'Priya']],
    ['Yuki',   ['Marcus', 'Ruth', 'Tomas']],
    ['Sofia',  ['Marcus', 'Dan', 'Ruth']],
    ['Ben',    ['Marcus', 'Priya', 'Ellis']],
    ['Ellis',  ['Marcus', 'Yuki', 'Ruth']],
    ['Tomas',  ['Marcus', 'Ruth', 'Priya']],
    ['Ruth',   ['Tomas', 'Marcus', 'Ellis']],
  ],
  4: [
    ['Priya',  ['Ruth', 'Kai', 'Sofia']],
    ['Marcus', ['Kai', 'Ruth', 'Dan']],
    ['Dan',    ['Ruth', 'Kai', 'Yuki']],
    ['Yuki',   ['Ruth', 'Priya', 'Tomas']],
    ['Sofia',  ['Priya', 'Ruth', 'Kai']],
    ['Ben',    ['Kai', 'Dan', 'Marcus']],
    ['Ellis',  ['Kai', 'Marcus', 'Ruth']],
    ['Tomas',  ['Ruth', 'Sofia', 'Kai']],
    ['Ruth',   ['Yuki', 'Kai', 'Priya']],
    ['Kai',    ['Ruth', 'Tomas', 'Sofia']],
  ],
  5: [
    ['Priya',  ['Marcus', 'Ruth', 'Yuki']],
    ['Marcus', ['Priya', 'Ruth', 'Yuki']],
    ['Dan',    ['Priya', 'Kai', 'Sofia']],
    ['Yuki',   ['Priya', 'Sofia', 'Marcus']],
    ['Sofia',  ['Priya', 'Tomas', 'Dan']],
    ['Tomas',  ['Priya', 'Marcus', 'Ruth']],
    ['Ruth',   ['Priya', 'Yuki', 'Sofia']],
    ['Kai',    ['Priya', 'Dan', 'Tomas']],
  ],
  6: [
    ['Priya',  ['Marcus', 'Dan', 'Kai']],
    ['Marcus', ['Priya', 'Sofia', 'Dan']],
    ['Dan',    ['Marcus', 'Yuki', 'Priya']],
    ['Yuki',   ['Marcus', 'Dan', 'Sofia']],
    ['Sofia',  ['Marcus', 'Kai', 'Yuki']],
    ['Ruth',   ['Marcus', 'Priya', 'Kai']],
    ['Kai',    ['Marcus', 'Dan', 'Priya']],
  ],
};

/* ========================================================================== *
 * 3. The advisor completions
 * ========================================================================== *
 *
 * NO BEDROCK CALL IS POSSIBLE HERE, so these were written by a model (Opus)
 * reading the prompt this script assembled for that round — the exact string
 * recorded in `prompts[n]` — and following its rules. They are pasted back in
 * so the REAL parseAIResponse() and the REAL create-report.js run over them.
 *
 * Production runs Haiku 4.5 (get-ai-summary.js:2255). Confirming a rule was
 * followed here says nothing about whether Haiku would follow it.
 */
const PLACEHOLDER_COMPLETION = (round) => [
  '## What the room said',
  `- **Not generated**: no advisor completion was authored for round ${round}; this placeholder stands in so the storage and report paths still run.`,
  '',
  '## What the room voted',
  '- **Not generated**: see above.',
  '',
  '## Discussion topics',
  '1. Not generated.',
  '',
  '## Next steps',
  '1. Not generated.',
].join('\n');

const ADVISOR_COMPLETIONS = require('./simulate-session-completions.js');

/* ========================================================================== *
 * 4. Drive the real handlers
 * ========================================================================== */

// Handlers are required AFTER the loader hook is installed.
const uploadQuestions = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;
const createGame = require(path.join(REPO, 'lambda-functions', 'websocket', 'create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions', 'game', 'start-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions', 'game', 'join-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions', 'game', 'next-question.js')).handler;
const wsMessage = require(path.join(REPO, 'lambda-functions', 'websocket', 'message.js')).handler;
const startVote = require(path.join(REPO, 'lambda-functions', 'websocket', 'start-vote.js')).handler;
const submitVote = require(path.join(REPO, 'lambda-functions', 'game', 'submit-vote.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions', 'game', 'get-results.js')).handler;
const aiSummary = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js')).handler;
const createReport = require(path.join(REPO, 'lambda-functions', 'game', 'create-report.js')).handler;
const getQuestion = require(path.join(REPO, 'lambda-functions', 'game', 'get-question.js')).handler;

// consensus.js is required directly for the audit line below. get-ai-summary.js
// already calls it internally; this second call proves what the label WOULD be
// given the round's real tally, which is not the same thing — see the note in
// the transcript.
const { consensusLabel } = require(path.join(REPO, 'lambda-functions', 'game', 'consensus.js'));

const out = [];
const say = (...a) => out.push(a.join(' '));

// The handlers log heavily. Silence them unless DEBUG=1.
const realLog = console.log, realWarn = console.warn, realErr = console.error;
const quiet = () => { if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; } };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realErr; };

const body = (res) => JSON.parse(res.body || '{}');

async function main() {
  quiet();

  /* -- 4a. Import the CSV through the REAL importer ------------------------ */
  const csvPath = path.join(REPO, 'sets', 'agentic-sdlc-call-and-answer.csv');
  const importRes = await uploadQuestions({
    body: JSON.stringify({
      fileName: 'agentic-sdlc-call-and-answer.csv',
      fileContent: fs.readFileSync(csvPath, 'utf8'),
      customTitle: 'Reimagining the SDLC with agentic workflows',
      customDescription: 'Six rounds on where agent work actually sits in the SDLC.',
      engagementType: 'call-and-answer',
    }),
  });
  const imported = body(importRes);
  const setId = imported.setId || imported.questionSetId;

  /* -- 4b. Wire the prompt and persona onto the set ------------------------ *
   * [FIXTURE] wiring, mirroring what scripts/install-question-set.js does
   * after an import: promptId and personaId are attributes on the SETS row
   * that upload-questions.js does not write. The prompt BODY and the persona
   * TEXT are the real artefacts (read off disk / off personas.js).
   */
  const setsRow = store.get(k('SETS', `SET#${setId}`));
  if (setsRow) {
    setsRow.promptId = PROMPT_ID;
    setsRow.promptName = PROMPT_JSON.name;
    setsRow.personaId = 'session-advisor';
    put(setsRow);
  }
  put({
    PK: 'AIPROMPTS', SK: `AIPROMPT#${PROMPT_ID}`,
    promptId: PROMPT_ID, name: PROMPT_JSON.name, gameType: 'call-and-answer',
    category: PROMPT_JSON.category, isDefault: true, status: 'active',
    s3Key: PROMPT_S3_KEY,
  });
  const { SEED_PERSONAS } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));
  const advisorPersona = SEED_PERSONAS.find((p) => p.personaId === 'session-advisor');
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#session-advisor', ...advisorPersona, status: 'active' });

  /* -- 4c. Create + start the game ---------------------------------------- */
  const created = body(await createGame({
    body: JSON.stringify({
      eventTitle: 'Reimagining the SDLC with agentic workflows',
      gameType: 'call-and-answer',
      questionSetId: setId,
      randomizeQuestions: false,   // in-order, so round n is CSV question n
      hostName: 'Priya Raghavan',
      personaId: 'session-advisor',
    }),
  }));
  const gameId = created.gameId;
  await startGame({ pathParameters: { gameId } });

  // A host screen, so the WebSocket broadcasts actually have somewhere to go.
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST', GameId: gameId });

  /* -- 4d. Play the six rounds -------------------------------------------- */
  const roundReports = [];

  for (const round of [1, 2, 3, 4, 5, 6]) {
    const padded = String(round).padStart(3, '0');
    const roster = ANSWERS[round].map(([n]) => n);

    // Players join before their first round. join-game.js is the real handler;
    // Yuki joins at round 2, which is why the roster is not uniform.
    for (const name of roster) {
      if (!store.has(k(`GAME#${gameId}`, `PLAYER#${name}`))) {
        await joinGame({ pathParameters: { gameId }, body: JSON.stringify({ playerName: name, clientId: `client-${name}` }) });
      }
    }

    // ASK
    await nextQuestion({ pathParameters: { gameId }, body: '{}' });

    const qRes = body(await getQuestion({ pathParameters: { gameId }, queryStringParameters: { questionNumber: padded, role: 'host' } }));

    // Answers, through the real WebSocket message handler.
    for (const [name, text] of ANSWERS[round]) {
      await wsMessage({
        requestContext: { connectionId: `conn-${name}` },
        body: JSON.stringify({ messageType: `ANSWER#${padded}`, gameId, playerName: name, answer: text }),
      });
    }

    // VOTE. start-vote.js returns the ballot; its ORDER is the index order the
    // vote records must use, and it is the real query order, not a guess.
    const voteRes = body(await startVote({ pathParameters: { gameId }, body: JSON.stringify({ questionNumber: round }) }));
    const ballotOrder = (voteRes.answers || []).map((a) => a.playerName || a.name || null);

    // While anonymousUntilReveal is on (the default), start-vote redacts the
    // ballot — which is correct, and means the index-to-author map has to come
    // from the ANSWER# rows in the same sorted order the handler used.
    const answerRows = (await fakeDoc.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': `QUESTION#${padded}#ANSWER#` },
    }))).Items;
    const indexOf = new Map(answerRows.map((r, i) => [r.PlayerName, i]));

    for (const [voter, ranked] of BALLOTS[round]) {
      const votes = {};
      ranked.forEach((author, rank) => {
        const idx = indexOf.get(author);
        if (idx === undefined) throw new Error(`round ${round}: ${voter} ranked ${author}, who did not answer`);
        votes[String(idx)] = rank + 1;
      });
      const res = await submitVote({
        pathParameters: { gameId },
        body: JSON.stringify({ playerName: voter, questionNumber: round, votes }),
      });
      if (res.statusCode !== 200) throw new Error(`round ${round}: vote from ${voter} rejected: ${res.body}`);
    }

    // RESULTS, on the host route so the transition and the author reveal happen.
    const results = body(await getResults({
      requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
      pathParameters: { gameId },
      body: JSON.stringify({ questionNumber: round }),
    }));

    // Field Notes. Worker mode is the path that actually generates.
    currentRound = round;
    await aiSummary({ __workerMode: true, gameId, questionId: padded, debug: 'true' });
    const summaryItem = store.get(k(`GAME#${gameId}`, `QUESTION#${padded}#AISummary`));

    roundReports.push({ round, padded, question: qRes, results, ballotOrder, answerRows, summaryItem });
  }

  /* -- 4e. The session report --------------------------------------------- */
  const report = body(await createReport({ pathParameters: { gameId } })).report;

  loud();

  /* ====================================================================== *
   * 5. Transcript
   * ====================================================================== */

  say('# Simulated session transcript');
  say('');
  say('Produced by `scripts/simulate-session.js`. Deterministic: seeded Math.random,');
  say('frozen clock. No AWS credentials, no Bedrock call, no network.');
  say('');
  say('PROVENANCE TAGS');
  say('  [REAL]     the value came out of a lambda handler in this repo, named inline');
  say('  [FIXTURE]  the value is input this script authored (the room, the answers, the ballots)');
  say('');
  say(`Game id ${gameId} [REAL websocket/create-game.js, from the seeded Math.random]`);
  say(`Question set id ${setId} [REAL admin/upload-questions.js]`);
  say(`Imported questions: ${imported.questionsAdded ?? imported.questionCount ?? 'n/a'}, ` +
      `skipped rows: ${imported.skippedRowCount ?? 'n/a'}, categories: ${imported.categoriesCreated ?? imported.categoryCount ?? 'n/a'} [REAL admin/upload-questions.js]`);
  say(`Prompt: ${PROMPT_JSON.name} (${PROMPT_ID}) [REAL file sets/prompt-callandanswer-workie-advisor.json]`);
  say(`Persona: ${advisorPersona.name} (session-advisor) [REAL lambda-functions/game/personas.js]`);
  say('');

  say('## Roster [FIXTURE]');
  say('');
  for (const p of ROSTER) say(`- ${p.name} — ${p.full}, ${p.role}`);
  say('');
  say('Rounds answered [REAL: counted from the stored ANSWER# rows]:');
  for (const p of ROSTER) {
    const rounds = roundReports.filter((r) => r.answerRows.some((a) => a.PlayerName === p.name)).map((r) => r.round);
    say(`- ${p.name}: ${rounds.length ? rounds.join(', ') : 'none'}  (${rounds.length}/6)`);
  }
  say('');

  for (const r of roundReports) {
    const tallies = r.results.voteTallies || {};
    const sorted = Object.entries(tallies).sort(([, a], [, b]) => b.totalScore - a.totalScore);
    say(`## Round ${r.round} — ${r.question.title || r.question.question?.title || '(title unavailable)'}`);
    say('');
    say(`Category: ${r.question.category || r.question.question?.category || 'n/a'} [REAL game/get-question.js]`);
    say(`Custom instruction the players were shown: ${JSON.stringify(r.question.customInstructions || '')} [REAL game/get-question.js]`);
    say(`  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)`);
    say('');
    say(`Answers: ${r.answerRows.length} [REAL: the ANSWER# rows get-results.js scored]`);
    say(`Voters: ${r.results.totalVotes} [REAL game/get-results.js totalVotes]`);
    say('');
    say('### Answers, in ballot order [FIXTURE text, [REAL] index and author]');
    say('');
    say('Index is the position the ballot uses — the sort-key order of the ANSWER# rows,');
    say('which is alphabetical by player name, exactly as the live table returns them.');
    say('');
    r.answerRows.forEach((a, i) => {
      say(`${String(i).padStart(2)}  ${a.PlayerName}: ${a.Answer}`);
      say('');
    });
    say('### Ballots [FIXTURE]');
    say('');
    for (const [voter, ranked] of BALLOTS[r.round]) say(`- ${voter}: 1st ${ranked[0]}, 2nd ${ranked[1]}, 3rd ${ranked[2]}`);
    say('');
    say('### Tally [REAL game/get-results.js]');
    say('');
    say('| Rank | Author | 1st | 2nd | 3rd | Vote points |');
    say('| --- | --- | --- | --- | --- | --- |');
    sorted.forEach(([, t], i) => {
      say(`| ${i + 1} | ${t.playerName} | ${t.firstPlace} | ${t.secondPlace} | ${t.thirdPlace} | ${t.totalScore} |`);
    });
    say('');
    say(`Winner: ${(r.results.winners || []).map((w) => `${w.playerName} (${w.score})`).join(', ')} [REAL game/get-results.js]`);
    say(`maxScore: ${r.results.maxScore} [REAL game/get-results.js]`);

    // consensusLabel, called two ways. The difference between them is a finding.
    const top3 = sorted.slice(0, 3);
    const auditLabel = consensusLabel({
      gameType: 'call-and-answer', sortedAnswers: top3, maxScore: r.results.maxScore, connectionScore: 0,
    });
    const shippedLabel = r.summaryItem?.DebugInfo?.templateVariables?.consensusLevel;
    say(`consensusLevel, as the deployed handler emitted it: "${shippedLabel}" ` +
        `[REAL game/get-ai-summary.js templateVars]`);
    say(`consensusLevel, from consensus.js given this round's real tally and maxScore: "${auditLabel}" ` +
        `[REAL game/consensus.js, called directly]`);
    say('');
  }

  /* -- Assembled prompts -------------------------------------------------- */
  for (const n of PROMPT_ROUNDS) {
    const p = prompts[Number(n)];
    if (!p) continue;
    say(`## Assembled prompt, round ${n} — VERBATIM [REAL game/get-ai-summary.js]`);
    say('');
    say(`Length ${p.length} characters. This is the exact string handed to InvokeModelCommand.`);
    const rr = roundReports.find((r) => r.round === Number(n));
    const unresolved = rr?.summaryItem?.DebugInfo?.unresolvedVariables || [];
    say(`Unresolved template variables: ${unresolved.length ? unresolved.join(', ') : 'none'} [REAL debugInfo.unresolvedVariables]`);
    say('');
    say('```text');
    say(p);
    say('```');
    say('');
  }

  /* -- Session report ----------------------------------------------------- */
  say('## Session report [REAL game/create-report.js]');
  say('');
  say(`Title: ${report.gameTitle}`);
  say(`Game type: ${report.gameType}   State: ${report.currentState}`);
  say('');
  say('gameStats:');
  for (const [key, v] of Object.entries(report.gameStats)) say(`  ${key}: ${v}`);
  say('');
  say('Player performance, as create-report.js ordered it:');
  say('');
  say('| Player | Total score | Answers given | Votes given | Wins | participationRate |');
  say('| --- | --- | --- | --- | --- | --- |');
  for (const p of report.playerPerformance) {
    say(`| ${p.playerName} | ${p.totalScore} | ${p.answersGiven} | ${p.votesGiven} | ${p.gamesWon} | ${p.participationRate} |`);
  }
  say('');
  say('Per round:');
  say('');
  say('| Round | Answers | Votes | maxScore | averageScore | Field Notes stored |');
  say('| --- | --- | --- | --- | --- | --- |');
  for (const q of report.detailedQuestions) {
    say(`| ${q.questionNumber} | ${q.voteStats.totalAnswers} | ${q.voteStats.totalVotes} | ${q.voteStats.maxScore} | ${q.voteStats.averageScore} | ${q.aiSummary ? 'yes' : 'no'} |`);
  }
  say('');

  /* -- What the parser made of each completion ---------------------------- */
  say('## What the REAL parser made of each advisor completion [REAL get-ai-summary.js parseAIResponse]');
  say('');
  say('| Round | Completion | summaryText chars | discussionQuestions | nextSteps | persona stamped |');
  say('| --- | --- | --- | --- | --- | --- |');
  for (const r of roundReports) {
    const i = r.summaryItem;
    const authored = Boolean(ADVISOR_COMPLETIONS[r.round]);
    say(`| ${r.round} | ${authored ? 'authored' : 'placeholder'} | ${(i?.SummaryText || '').length} | ` +
        `${(i?.DiscussionQuestions || []).length} | ${(i?.NextSteps || []).length} | ${i?.PersonaName || 'none'} |`);
  }
  say('');

  /* -- The advisor's reports, as stored ----------------------------------- */
  for (const n of PROMPT_ROUNDS) {
    const r = roundReports.find((x) => x.round === Number(n));
    if (!r || !ADVISOR_COMPLETIONS[r.round]) continue;
    const text = ADVISOR_COMPLETIONS[r.round];
    const naive = text.trim().split(/\s+/).length;
    // The same count with markdown furniture removed — headings, list markers,
    // and emphasis characters. Rule 14 caps "the whole reply" at 400 words and
    // does not say which of these two it means; both are reported so the
    // evaluator does not have to guess.
    const spoken = text
      .replace(/^#{1,6}\s.*$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
      .replace(/[*_`]/g, '')
      .trim().split(/\s+/).filter(Boolean).length;
    say(`## Advisor report, round ${n} — as stored in MarkdownResponse [REAL storage path]`);
    say('');
    say(`Word count: ${naive} counting every whitespace-separated token, ${spoken} counting only the words read aloud. The prompt's cap is 400.`);
    say('');
    say(r.summaryItem.MarkdownResponse);
    say('');
  }

  /* -- Frames ------------------------------------------------------------- */
  say('## WebSocket frames the handlers emitted [REAL]');
  say('');
  const byType = frames.reduce((m, f) => { m[f.msg.type || f.msg.messageType] = (m[f.msg.type || f.msg.messageType] || 0) + 1; return m; }, {});
  for (const [t, c] of Object.entries(byType)) say(`- ${t}: ${c}`);
  say('');

  process.stdout.write(out.join('\n') + '\n');
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });
