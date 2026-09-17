/**
 * THE SENTENCE 06-share-rejected.html PROMISES — spec §4.3.
 *
 * Bedrock Guardrails returns a category and a band. The mockup shows a
 * sentence that separates WHAT was flagged from the SUBJECT ("asking a room to
 * describe injuries in detail is the part that was flagged, not the safety
 * topic"), and its rationale calls that sentence load-bearing: without it the
 * author concludes the checker is broken. So for flagged and escalated
 * questions only — a handful per set — one Haiku call each writes it.
 *
 * The output is UNTRUSTED TEXT about the author's own content: tags are
 * stripped, it is capped, and it is rendered as text, never markup. The
 * fallback is the band sentence, so a Bedrock failure costs nothing but prose.
 */
const { questionText } = require('./publishable');

const HAIKU = () => `arn:aws:bedrock:${process.env.AWS_REGION || 'us-east-1'}:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
const SYSTEM_CATEGORIES = Object.freeze(['EMPTY', 'ERROR', 'UNCONFIGURED', 'TIMEOUT', 'SNAPSHOT']);
const MAX_CHARS = 240;

const CATEGORY_WORDS = Object.freeze({
  VIOLENCE: 'violence or injury', SEXUAL: 'sexual content', HATE: 'hateful content',
  INSULTS: 'insulting or harassing language', MISCONDUCT: 'dangerous or criminal instructions',
});
function bandSentence(finding) {
  const what = CATEGORY_WORDS[String(finding.category || '').toUpperCase()] || 'this category';
  return String(finding.band || '').toUpperCase() === 'HIGH'
    ? `The check was confident this question contains ${what}.`
    : `The check was unsure (medium confidence) whether this question contains ${what}, so a person will look.`;
}
const plain = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
const questionById = (snapshot, id) => (snapshot.questions || []).find((q) => String(q.SK) === `QUESTION#${id}`);

async function explainOne(bedrock, InvokeModelCommand, question, finding) {
  const prompt = [
    `A content check for a workplace quiz flagged this question for ${finding.category} at ${finding.band} confidence.`,
    'In ONE sentence of at most 200 characters, say which part of the question was flagged and separate it from the subject the question is about.',
    'Plain text only. Do not quote the question back. Do not address the reader.',
    '',
    'QUESTION:',
    questionText(question),
  ].join('\n');
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: HAIKU(),
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 160,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  return plain(text);
}

async function explainFindings(bedrock, InvokeModelCommand, snapshot, findings = [], { limit = 12 } = {}) {
  let calls = 0;
  const out = [];
  for (const f of findings) {
    const category = String(f.category || '').toUpperCase();
    const q = f.questionId && f.questionId !== '(set)' ? questionById(snapshot, f.questionId) : null;
    if (SYSTEM_CATEGORIES.includes(category) || !q) { out.push({ ...f }); continue; }
    let explanation = '';
    if (calls < limit) {
      calls += 1;
      try {
        explanation = await explainOne(bedrock, InvokeModelCommand, q, f); // eslint-disable-line no-await-in-loop
      } catch (error) {
        console.warn(`⚠️ explanation for ${f.questionId} failed: ${error.message}`);
      }
    }
    out.push({ ...f, explanation: explanation || bandSentence(f) });
  }
  return out;
}
module.exports = { explainFindings, bandSentence, MAX_CHARS, SYSTEM_CATEGORIES };
