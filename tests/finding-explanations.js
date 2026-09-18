// tests/finding-explanations.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const E = require(path.join(H.REPO, 'lambda-functions/admin/shared/finding-explanations.js'));
const bedrock = new BedrockRuntimeClient({});
const snapshot = {
  questions: [
    { SK: 'QUESTION#q001', Title: 'Describe the worst injury you have seen on site', Detail: 'and what caused it.' },
    { SK: 'QUESTION#q002', Title: 'Which crew is usually the problem?', Detail: '' },
  ],
};
(async () => {
  console.log('\nfinding explanations\n');
  await H.test('a flagged question gets one Haiku sentence, trimmed to 240 characters of plain text', async () => {
    H.reset();
    H.state.haikuReplies = ['<b>Asking a room to describe injuries in detail</b> is what was flagged, not the safety topic.'];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q001', category: 'VIOLENCE', band: 'HIGH' }]);
    assert.strictEqual(out[0].explanation, 'Asking a room to describe injuries in detail is what was flagged, not the safety topic.');
    assert.strictEqual(H.state.sentHaiku.length, 1);
    const prompt = H.state.sentHaiku[0].messages[0].content;
    assert.ok(prompt.includes('Describe the worst injury'), 'the question text was not in the prompt');
    assert.ok(prompt.includes('VIOLENCE') && prompt.includes('HIGH'), 'category and band were not in the prompt');
  });
  await H.test('a Bedrock error falls back to the band sentence and never throws', async () => {
    H.reset();
    H.state.haikuReplies = [new Error('ThrottlingException')];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q002', category: 'HATE', band: 'MEDIUM' }]);
    assert.strictEqual(out[0].explanation, E.bandSentence({ category: 'HATE', band: 'MEDIUM' }));
    assert.match(out[0].explanation, /unsure|medium/i);
  });
  await H.test('system findings and the set subject are left alone, and the call limit holds', async () => {
    H.reset();
    H.state.haikuReplies = ['one', 'two'];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [
      { questionId: null, category: 'TIMEOUT', band: 'NONE' },
      { questionId: '(set)', category: 'INSULTS', band: 'HIGH' },
      { questionId: 'q001', category: 'VIOLENCE', band: 'HIGH' },
      { questionId: 'q002', category: 'HATE', band: 'MEDIUM' },
    ], { limit: 1 });
    assert.strictEqual(out[0].explanation, undefined);
    assert.strictEqual(out[1].explanation, undefined);
    assert.strictEqual(out[2].explanation, 'one');
    assert.strictEqual(out[3].explanation, E.bandSentence(out[3]), 'the second finding should have used the fallback');
    assert.strictEqual(H.state.sentHaiku.length, 1);
  });
  H.summary();
})();
