/**
 * Integration test: a prompt owns the SHAPE of Workie's output.
 *
 * The complaint this exists for: every question set produced the same
 * `## Summary` / `## Discussion Questions` / `## Next Steps`, because
 * buildOutputContract() took no arguments and get-ai-summary appended that
 * fixed triad unconditionally. The whole point of attaching a prompt to a set
 * is to get a DIFFERENT, appropriate output — an art round wants the winning
 * title, entries worth quoting, Workie's own take, the real title of the work
 * and a point of trivia. "Next Steps" for a painting is nonsense.
 *
 * The tension: the fixed contract was a deliberate fix, not an accident (see
 * docs/superpowers/specs/2026-08-07-workie-personas-design.md). Structure had
 * been tangled into free-text templates and the parser depended on whatever
 * someone typed into a textarea. So structure is now prompt-owned but
 * system-VALIDATED, and this file drives the REAL get-ai-summary handler in
 * worker mode with Bedrock stubbed, so it asserts against the prompt that
 * would actually be sent and the fields that would actually be stored.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK by module name before the handler loads --------------
// (client-s3 / client-lambda / client-bedrock-runtime exist only in the
// deployed bundle, so require.cache-by-path silently misses them.)
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

const GAME_ID = '4242';
const SET_ID = 'famousarttitles';
const ART_PROMPT_ID = 'art-titles-prompt';
const PLAIN_PROMPT_ID = 'lessons-learned-prompt';

// The reveal. Lives in AnswerDetails on the question, which reaches NO player
// or host payload — only this handler, which runs at RESULTS.
const REVEAL =
  'Real title: Mona Lisa (La Gioconda), Leonardo da Vinci, c. 1503-1519, Louvre, Paris. ' +
  'Trivia: it was stolen from the Louvre in 1911 by Vincenzo Peruggia, a former museum workman.';

const ART_SECTIONS = [
  { heading: 'The Winning Title', guidance: 'Name the title that won.' },
  { heading: 'Also Worth Framing', guidance: 'Quote two or three others.' },
  { heading: "Workie's Take", guidance: 'Your own view.' },
  { heading: 'The Real Title', guidance: 'Reveal it.' },
  { heading: 'One Point of Trivia', guidance: 'One fact, from THE REVEAL.' },
];

const ddb = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => ddb.set(key(item.PK, item.SK), item);

function seed({ promptId, questionAnswerDetails }) {
  ddb.clear();
  put({ PK: `GAME#${GAME_ID}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001', LessonNumber: 1 });
  put({
    PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID,
    Title: 'Gallery Night', GameType: 'call-and-answer', QuestionSetId: SET_ID,
  });
  put({
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#renaissance#001', SetId: SET_ID,
    StartedAt: new Date(0).toISOString(),
  });
  put({
    PK: `SET#${SET_ID}`, SK: 'QUESTION#renaissance#001',
    Title: 'THE ENIGMATIC SMILE',
    Detail: '',                                  // blank on purpose: shown to players
    Category: 'Renaissance',
    School: 'Leonardo da Vinci, c. 1503',
    Image: 'https://example.test/mona.jpg',
    ...(questionAnswerDetails ? { AnswerDetails: questionAnswerDetails } : {}),
  });
  put({ PK: 'SETS', SK: `SET#${SET_ID}`, setId: SET_ID, name: 'Famous Art Titles', promptId });

  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#ANSWER#p1', PlayerName: 'Ada', Answer: 'SMIRK OF THE CENTURY' });
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#ANSWER#p2', PlayerName: 'Ben', Answer: 'SHE KNOWS SOMETHING' });
  // Votes are stored as { answerIndex: rank } — the shape get-results.js writes.
  put({ PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#VOTE#v1', PlayerId: 'p2', Votes: { 0: 1, 1: 2 } });

  put({ PK: `GAME#${GAME_ID}`, SK: 'PLAYER#p1', PlayerId: 'p1', Name: 'Ada', Score: 3 });
  put({ PK: `GAME#${GAME_ID}`, SK: 'PLAYER#p2', PlayerId: 'p2', Name: 'Ben', Score: 1 });

  for (const p of [
    { id: ART_PROMPT_ID, name: 'Art & Creative Titles' },
    { id: PLAIN_PROMPT_ID, name: 'Lessons Learned' },
  ]) {
    put({
      PK: 'AIPROMPTS', SK: `AIPROMPT#${p.id}`, promptId: p.id, name: p.name,
      gameType: 'call-and-answer', category: 'lessons-learned', status: 'active',
      isDefault: p.id === PLAIN_PROMPT_ID,
      s3Key: `prompts/call-and-answer/${p.id}/v1.json`,
    });
  }
}

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const written = [];
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get':
        return { Item: ddb.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put':
        written.push(inp.Item);
        put(inp.Item);
        return {};
      case 'delete':
        ddb.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update':
        return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'];
        const prefix = v[':sk'] ?? '';
        const items = [...ddb.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...ddb.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk']) &&
          (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// S3 serves the prompt bodies. The ART prompt declares its own outputSections;
// the PLAIN one declares nothing, which is every prompt authored before the
// field existed — it must be completely unaffected.
const s3Bodies = {
  [`prompts/call-and-answer/${ART_PROMPT_ID}/v1.json`]: {
    name: 'Art & Creative Titles',
    template:
      'Close out an art-title round.\n\nTHE REVEAL: {answerDetails}\n\nTitles: {responsesText}',
    outputSections: ART_SECTIONS,
  },
  [`prompts/call-and-answer/${PLAIN_PROMPT_ID}/v1.json`]: {
    name: 'Lessons Learned',
    template: 'Summarise the responses: {responsesText}',
  },
};
let s3Override = null;   // lets a case swap in a malformed declaration
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const k = cmd.input.Key;
      const body = s3Override && s3Override.key === k ? s3Override.body : s3Bodies[k];
      if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => JSON.stringify(body) } };
    }
  },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});

// Bedrock echoes a canned reply and records the prompt it was handed — the
// prompt is the artefact under test.
let lastPrompt = null;
let cannedReply = '## Summary\nx';
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      lastPrompt = JSON.parse(cmd.input.body).messages[0].content;
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: cannedReply }] })) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-fn';

const mod = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** Run the real worker and return the stored AISummary item. */
async function runWorker() {
  written.length = 0;
  lastPrompt = null;
  await mod.handler({ __workerMode: true, gameId: GAME_ID, questionId: '001' });
  return written.find((i) => String(i.SK).endsWith('#AISummary'));
}

const TRIAD = ['## Summary', '## Discussion Questions', '## Next Steps'];

(async () => {
  // Chatter from the handler drowns the results; it is not what we are testing.
  const realLog = console.log;
  const realWarn = console.warn;
  const quiet = () => { console.log = () => {}; console.warn = () => {}; };
  const loud = () => { console.log = realLog; console.warn = realWarn; };

  realLog('\n1. no declared shape — the default triad, unchanged\n');
  seed({ promptId: PLAIN_PROMPT_ID, questionAnswerDetails: null });
  cannedReply = [
    '## Summary',
    'The room split between the sincere and the silly, and the sincere ones won on votes.',
    '',
    '## Discussion Questions',
    '1. Why did that one win?',
    '',
    '## Next Steps',
    '1. Play another round',
  ].join('\n');
  quiet();
  let item = await runWorker();
  let prompt = lastPrompt;
  const plainPrompt = prompt;
  loud();

  check('the worker produced and stored a summary', () => assert(item, 'no AISummary item written'));
  for (const h of TRIAD) {
    check(`prompt still contains "${h}"`, () => assert(prompt.includes(h), 'the default contract went missing'));
  }
  check('the contract is the LAST formatting instruction in the prompt', () =>
    assert(prompt.lastIndexOf('FORMAT (this part is not negotiable') > prompt.indexOf('Summarise the responses'),
      'a template that carries its own format section would win'));
  check('structured fields still populate', () => {
    assert(item.SummaryText.includes('split between the sincere'), item.SummaryText);
    assert.strictEqual(item.DiscussionQuestions.length, 1);
    assert.strictEqual(item.NextSteps.length, 1);
  });
  check('raw markdown retained', () => assert(item.MarkdownResponse.includes('## Discussion Questions')));

  realLog('\n2. declared shape — the prompt\'s own headings, and NOT the triad\n');
  seed({ promptId: ART_PROMPT_ID, questionAnswerDetails: REVEAL });
  cannedReply = [
    '## The Winning Title',
    '"SMIRK OF THE CENTURY" took it, and deservedly — it names the expression rather than the sitter.',
    '',
    '## Also Worth Framing',
    '"SHE KNOWS SOMETHING" is the one that keeps working after you look away.',
    '',
    "## Workie's Take",
    'I would have called it THE UNBLINKING APPOINTMENT. It is a smaller painting than anyone expects.',
    '',
    '## The Real Title',
    'Mona Lisa (La Gioconda), Leonardo da Vinci, c. 1503-1519.',
    '',
    '## One Point of Trivia',
    'It was stolen from the Louvre in 1911 by a former museum workman.',
  ].join('\n');
  quiet();
  item = await runWorker();
  prompt = lastPrompt;
  loud();

  for (const s of ART_SECTIONS) {
    check(`prompt declares "## ${s.heading}"`, () => assert(prompt.includes(`## ${s.heading}`)));
  }
  for (const h of ['## Discussion Questions', '## Next Steps']) {
    check(`prompt does NOT impose "${h}"`, () =>
      assert(!prompt.includes(h), 'the triad is still being appended over the declared shape'));
  }
  check('the contract counts the declared sections, not three', () =>
    assert(/exactly these five headings/.test(prompt), 'contract still says "three"'));

  realLog('\n3. the art reveal reaches the summary input\n');
  check('the real title is in the prompt sent to Bedrock', () =>
    assert(prompt.includes('Mona Lisa'), 'the reveal never reached the model'));
  check('the trivia is in the prompt sent to Bedrock', () =>
    assert(prompt.includes('Vincenzo Peruggia')));
  check('and only because the question carries it — case 1 had none', () =>
    assert(!plainPrompt.includes('Mona Lisa') && !plainPrompt.includes('Vincenzo Peruggia'),
      'the reveal appeared for a question that has no AnswerDetails'));

  realLog('\n4. a custom-shaped response still parses into usable fields\n');
  check('summaryText is not empty', () =>
    assert(item.SummaryText && item.SummaryText.length > 40, JSON.stringify(item.SummaryText)));
  check('summaryText carries EVERY declared section, not just the first', () => {
    for (const s of ART_SECTIONS) {
      assert(item.SummaryText.includes(s.heading), `"${s.heading}" missing from summaryText`);
    }
  });
  check('summaryText keeps its headings so five sections do not run together', () =>
    assert(item.SummaryText.includes('## The Real Title'), item.SummaryText.slice(0, 200)));
  check('raw markdown is retained for the shape-agnostic renderer', () =>
    assert(item.MarkdownResponse.includes("## Workie's Take")));
  check('the triad fields degrade to empty rather than to junk', () => {
    assert(Array.isArray(item.DiscussionQuestions) && item.DiscussionQuestions.length === 0);
    assert(Array.isArray(item.NextSteps) && item.NextSteps.length === 0);
  });

  realLog('\n5. a garbage declaration degrades to the default rather than breaking\n');
  const garbage = [
    { label: 'not an array', value: '## Summary\n## Whatever' },
    { label: 'empty array', value: [] },
    { label: 'heading carrying markdown', value: [{ heading: '## Injected' }, { heading: 'Ok' }] },
    { label: 'multi-line heading', value: [{ heading: 'One\n## Two' }] },
    { label: 'duplicate headings', value: [{ heading: 'Summary' }, { heading: 'summary' }] },
    { label: 'missing heading', value: [{ guidance: 'no heading here' }] },
    { label: 'too many sections', value: Array.from({ length: 9 }, (_, i) => ({ heading: `S${i}` })) },
  ];
  for (const g of garbage) {
    seed({ promptId: ART_PROMPT_ID, questionAnswerDetails: REVEAL });
    s3Override = {
      key: `prompts/call-and-answer/${ART_PROMPT_ID}/v1.json`,
      body: { name: 'Broken', template: 'Do the thing.', outputSections: g.value },
    };
    cannedReply = '## Summary\nA perfectly ordinary summary of what the room said, long enough to keep.';
    quiet();
    const broken = await runWorker();
    const brokenPrompt = lastPrompt;
    loud();
    check(`${g.label} → default triad, prompt still well-formed`, () => {
      for (const h of TRIAD) assert(brokenPrompt.includes(h), `missing ${h}`);
      assert(!brokenPrompt.includes('## Injected'), 'a declared heading leaked into the contract');
      assert(/exactly these three headings/.test(brokenPrompt));
      assert(broken && broken.SummaryText.length > 40, 'summary went empty');
    });
  }
  s3Override = null;

  realLog('\n6. an unrecognised response shape never yields an empty panel\n');
  /*
    THE REPLIES ARE COMPLETIONS NOW, NOT WHOLE DOCUMENTS. The model call
    prefills the first section heading (get-ai-summary.js), so the stored
    markdown is mechanically `## <first heading>` + whatever the model wrote —
    a reply that "forgets" its first heading can no longer exist on the wire.
    These fixtures are what a model writes AFTER the prefill when it then goes
    off-shape anyway, leading \n\n included, exactly as the live model
    continues (verified against Bedrock before shipping).
  */
  for (const [label, reply] of [
    ['prose with no headings', '\n\nEveryone reached for a joke and the joke that won was the shortest one on the board.'],
    ['a wandering unknown section', '\n\nSo far so good.\n\n## Verdict\nThe room was kinder to the painting than it was to each other, which is a first.'],
  ]) {
    seed({ promptId: ART_PROMPT_ID, questionAnswerDetails: REVEAL });
    cannedReply = reply;
    quiet();
    const odd = await runWorker();
    loud();
    check(`${label}: summaryText non-empty`, () =>
      assert(odd && odd.SummaryText && odd.SummaryText.length > 20, JSON.stringify(odd && odd.SummaryText)));
    check(`${label}: raw markdown retained, under the prefilled heading`, () => {
      assert(odd.MarkdownResponse.startsWith('## '), 'the prefilled heading must open the document');
      assert(odd.MarkdownResponse.endsWith(reply.trimStart()),
        'the model\'s own markdown must always survive, verbatim, after the prefill');
    });
  }

  realLog('\n7. the shipped art prompt is a working reference example\n');
  const defaults = require(path.join(REPO, 'lambda-functions', 'admin', 'default-ai-prompts.json'));
  const { normalizeOutputSections } = require(path.join(REPO, 'lambda-functions', 'game', 'prompt-shape.js'));
  const shipped = defaults['call-and-answer'] && defaults['call-and-answer']['art-titles'];

  check('an art-titles prompt ships in default-ai-prompts.json', () =>
    assert(shipped, 'the art prompt is missing'));
  const shippedSections = normalizeOutputSections(shipped && shipped.outputSections);
  check('it declares a valid output shape', () =>
    assert(shippedSections, 'the shipped declaration would be silently rejected at runtime'));
  check('its shape is the owner\'s, not the triad', () => {
    const headings = shippedSections.map((x) => x.heading);
    for (const banned of ['Summary', 'Discussion Questions', 'Next Steps']) {
      assert(!headings.includes(banned), `still carries "${banned}"`);
    }
    assert(headings.some((h) => /winning title/i.test(h)), 'no winning-title section');
    assert(headings.some((h) => /real title/i.test(h)), 'no real-title section');
    assert(headings.some((h) => /trivia/i.test(h)), 'no trivia section');
  });
  // The body the ENGINE will assemble, not one named field. These two used to
  // read `shipped.template` alone, which passed only while the defaults were
  // single-field: the 2026-08-15 rewrite moved every prompt onto the two named
  // halves and both assertions went green-to-red without the prompt losing
  // anything. Mirror get-ai-summary.js:2168-2174 instead — template when there
  // is one, otherwise instructions + outputFormat — so the check follows the
  // prompt across a shape change and still fails if the reveal is dropped.
  const shippedBody = shipped && (shipped.template
    || [shipped.instructions, shipped.outputFormat].filter(Boolean).join('\n\n'));
  check('its prompt body reads the reveal from {answerDetails}', () =>
    assert(/\{answerDetails\}/.test(shippedBody),
      'the prompt cannot see the real title, so it cannot reveal it'));
  check('it tells the model not to invent a fact it was not given', () =>
    // A bare /guess|invent/ passes on the opening line "the room INVENTED titles
    // for it", which is not a rule about anything — the check survived a
    // mutation that deleted the actual instruction. What has to be present is a
    // SUBSTITUTION rule: when the reveal is absent, do the safe thing INSTEAD OF
    // supplying a fact. {answerDetails} resolves to the literal "No explanation
    // provided" when the CSV carried no reveal (get-ai-summary.js:2096), so this
    // sentence is the only thing standing between an empty column and a
    // confident invented fact read out to a room.
    assert(/\b(skip|omit|say)\b[^.\n]*\b(rather than|instead of)\b[^.\n]*\b(guess|invent)\w*/i
      .test(shippedBody),
    'a wrong fact read aloud to a room is worse than no fact'));
  check('it is usable as a summary prompt at all', () =>
    assert(shipped.template || (shipped.instructions && shipped.outputFormat),
      'fails the gate in game/prompt-shape.js and would silently fall back'));
  check('the seeder reads the same field name it is stored under', () => {
    const seeder = require('fs').readFileSync(
      path.join(REPO, 'lambda-functions', 'admin', 'populate-defaults.js'), 'utf8');
    assert(/promptData\.outputSections/.test(seeder), 'populate-defaults.js never reads outputSections');
    assert(/outputSections \}\),/.test(seeder), 'populate-defaults.js never writes outputSections');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
