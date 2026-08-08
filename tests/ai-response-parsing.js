/**
 * parseAIResponse regression tests.
 *
 * The motivating failure (engagedev game 7971, 2026-08-07): Claude returned
 *
 *     # Strategic Engagement Summary: Lessons Learned Session
 *
 *     ## Challenge
 *     The provided data set is insufficient for meaningful business analysis...
 *
 * The parser only looked for `## Summary`, found nothing, and fell back to
 * "the first line longer than 20 characters" — so the Field Notes panel showed
 * one sentence out of a 1334-character analysis. That is the "thin summaries"
 * complaint.
 *
 * Structure is now system-appended to every prompt, so conforming responses are
 * the norm; these tests cover the non-conforming ones the parser must still
 * survive, because a persona or a hand-written template can always drift.
 */
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

// Several AWS SDK packages this handler imports exist only in the deployed
// bundle, so they cannot be resolved locally. Hook the loader by name.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const noopClient = class { async send() { return {}; } };
stubs.set('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: noopClient, InvokeModelCommand: class {} });
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: noopClient });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => ({ send: async () => ({}) }) },
  GetCommand: class {}, PutCommand: class {}, QueryCommand: class {},
  ScanCommand: class {}, DeleteCommand: class {}, UpdateCommand: class {},
});
stubs.set('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {}, PutObjectCommand: class {} });
stubs.set('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stubs.set('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {} });

const mod = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The shape that broke: leading H1 title, non-standard section headings.
const GAME_7971 = `# Strategic Engagement Summary: Lessons Learned Session

## Challenge
The provided data set is insufficient for meaningful business analysis. With only one participant response ("George: Hawaii") to a leisure-focused question ("Ultimate Vacation Destination"), there is no substantive business content to analyse. A single data point cannot reveal patterns, and a leisure preference does not map onto project lessons.

## Recommendations
1. Re-run the question with a larger group
2. Pair the icebreaker with a work-focused follow-up`;

const CONFORMING = `## Summary
The room converged quickly on warm-weather destinations. Hawaii took the top spot with a clear margin, and the reasoning centred on switching off completely rather than sightseeing.

## Discussion Questions
1. What does "switching off" look like for this team?
2. Does anyone actually take their full leave?
3. What would make time off feel safer to take?

## Next Steps
1. Check current leave balances across the team
2. Agree a no-Slack norm for people on leave`;

console.log('parseAIResponse\n');

assert(typeof mod.parseAIResponse === 'function',
  'get-ai-summary.js must export parseAIResponse for this to be testable');

// --- 1. The reported regression -------------------------------------------
const broken = mod.parseAIResponse(GAME_7971);

check('a non-conforming response still yields a substantial summary', () =>
  assert(broken.summaryText.length > 150,
    `summary was only ${broken.summaryText.length} chars: ${JSON.stringify(broken.summaryText)}`));

check('the summary is the full analysis, not the first line', () =>
  assert(broken.summaryText.includes('single data point'),
    'lost everything after the first sentence'));

check('the leading H1 title is not treated as body text', () =>
  assert(!broken.summaryText.startsWith('#'), `summary starts with a heading: ${broken.summaryText.slice(0, 40)}`));

check('"Recommendations" is recognised as next steps', () =>
  assert(broken.nextSteps.length >= 2, `got ${JSON.stringify(broken.nextSteps)}`));

// --- 2. The conforming case must keep working ------------------------------
const good = mod.parseAIResponse(CONFORMING);

check('conforming: summary extracted', () =>
  assert(good.summaryText.includes('warm-weather destinations')));
check('conforming: summary excludes later sections', () =>
  assert(!good.summaryText.includes('switching off look like'),
    'summary bled into the discussion questions'));
check('conforming: three discussion questions', () =>
  assert.strictEqual(good.discussionQuestions.length, 3));
check('conforming: two next steps', () =>
  assert.strictEqual(good.nextSteps.length, 2));

// --- 3. Heading-level tolerance --------------------------------------------
for (const h of ['#', '##', '###']) {
  const r = mod.parseAIResponse(`${h} Summary\nThe team agreed on the direction and the reasoning was consistent across every response given.\n\n${h} Next Steps\n1. Book the follow-up`);
  check(`heading level "${h}" parses`, () => {
    assert(r.summaryText.includes('agreed on the direction'), 'summary missed');
    assert.strictEqual(r.nextSteps.length, 1, `next steps: ${JSON.stringify(r.nextSteps)}`);
  });
}

// --- 4. Bullet styles -------------------------------------------------------
const bullets = mod.parseAIResponse(`## Summary
Short but adequate summary text for the room to read on screen.

## Discussion Questions
- What surprised you?
- What would you change?

## Next Steps
* Send the notes round`);
check('dash bullets parse as list items', () =>
  assert.strictEqual(bullets.discussionQuestions.length, 2, JSON.stringify(bullets.discussionQuestions)));
check('star bullets parse as list items', () =>
  assert.strictEqual(bullets.nextSteps.length, 1, JSON.stringify(bullets.nextSteps)));
check('bullet markers are stripped from the text', () =>
  assert(!bullets.discussionQuestions[0].startsWith('-'), bullets.discussionQuestions[0]));

// --- 5. No headings at all --------------------------------------------------
const plain = mod.parseAIResponse('The group was unanimous. Everyone picked somewhere warm, and the reasons were about rest rather than adventure.');
check('a response with no headings still yields a summary', () =>
  assert(plain.summaryText.includes('unanimous'), JSON.stringify(plain.summaryText)));

// --- 6. Raw markdown is always preserved ------------------------------------
check('raw markdown is retained for display', () =>
  assert(broken.markdownResponse && broken.markdownResponse.length >= GAME_7971.length - 40));

// --- 7. A prompt-declared output shape --------------------------------------
// A prompt may now declare its own headings (see personas.js / prompt-shape.js).
// The parser must not mangle a shape it does not recognise: `summaryText` still
// has to be populated, every section has to survive into it, and the raw
// markdown must always be kept — GameHostPage and the report both prefer
// `markdownResponse`, so a custom shape renders as written either way, and
// these fields are the fallback that must never be an empty panel.
const ART = `## The Winning Title
"SMIRK OF THE CENTURY" took it, and deservedly — it names the expression rather than the sitter.

## Also Worth Framing
"SHE KNOWS SOMETHING" is the one that keeps working after you look away.

## Workie's Take
I would have gone with THE UNBLINKING APPOINTMENT.

## The Real Title
Mona Lisa (La Gioconda), Leonardo da Vinci, c. 1503-1519.

## One Point of Trivia
It was stolen from the Louvre in 1911 by a former museum workman.`;

const art = mod.parseAIResponse(ART, { customShape: true });
check('custom shape: summaryText is not empty', () =>
  assert(art.summaryText && art.summaryText.length > 40, JSON.stringify(art.summaryText)));
check('custom shape: every section survives into summaryText', () => {
  for (const h of ['The Winning Title', 'Also Worth Framing', "Workie's Take", 'The Real Title', 'One Point of Trivia']) {
    assert(art.summaryText.includes(h), `"${h}" was dropped`);
  }
});
check('custom shape: headings are kept so the sections stay separable', () =>
  assert(art.summaryText.includes('## The Real Title'), art.summaryText.slice(0, 120)));
check('custom shape: the reveal is not lost', () =>
  assert(art.summaryText.includes('Mona Lisa')));
check('custom shape: raw markdown retained', () =>
  assert.strictEqual(art.markdownResponse, ART));
check('custom shape: triad fields degrade to empty, not to junk', () => {
  assert.deepStrictEqual(art.discussionQuestions, []);
  assert.deepStrictEqual(art.nextSteps, []);
});

// Same response WITHOUT the flag — the old code path. It still yields something
// usable, but only the first unlabelled section, which is exactly why the flag
// exists rather than the parser guessing.
const artNoFlag = mod.parseAIResponse(ART);
check('without the flag the same response still yields a summary', () =>
  assert(artNoFlag.summaryText && artNoFlag.summaryText.length > 40));
check('without the flag the raw markdown is still retained', () =>
  assert.strictEqual(artNoFlag.markdownResponse, ART));

// A custom shape whose model reply went off the rails entirely.
const artBroken = mod.parseAIResponse('The room did well and I enjoyed the titles enormously, all of them.', { customShape: true });
check('custom shape: a reply with no headings at all still yields a summary', () =>
  assert(artBroken.summaryText.includes('enjoyed the titles'), JSON.stringify(artBroken.summaryText)));

// A leading H1 is stripped in custom mode too — that is the game 7971 defence.
const artTitled = mod.parseAIResponse('# Gallery Report\n\n## The Real Title\nMona Lisa, Leonardo da Vinci, painted around 1503.', { customShape: true });
check('custom shape: a leading H1 document title is still stripped', () => {
  assert(!artTitled.summaryText.includes('# Gallery Report'), artTitled.summaryText);
  assert(artTitled.summaryText.includes('## The Real Title'), artTitled.summaryText);
});
check('custom shape: an empty response does not throw or return undefined', () => {
  const empty = mod.parseAIResponse('', { customShape: true });
  assert.strictEqual(typeof empty.summaryText, 'string');
  assert.strictEqual(empty.markdownResponse, '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
