/**
 * THE SENTENCE 06-share-rejected.html PROMISES — spec §4.3.
 *
 * Bedrock Guardrails returns a category and a band. The mockup shows a
 * sentence that separates WHAT was flagged from the SUBJECT ("asking a room to
 * describe injuries in detail is the part that was flagged, not the safety
 * topic"), and its rationale calls that sentence load-bearing: without it the
 * author concludes the checker is broken. One Haiku call per question writes
 * it.
 *
 * Since the score card (2026-09-19) the rows explained are the check's
 * OBSERVATIONS — every band it saw, on passed sets too — not only what held a
 * set, within the SAME allowance: at most `limit` (12) calls per check in
 * total, spent on the worst band first, so a refusal is never left with the
 * band sentence while a near-miss got the model. A row that did not intervene
 * (`intervened: false`) is described to the model, and by the fallback, as
 * NOTED — never as flagged, and never as something a person will look at.
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
/**
 * Did this row hold the set? Only an intervention can, and only at HIGH or
 * MEDIUM (content-guardrail.js `outcomeForBand`). A finding written before
 * observations existed carries no `intervened` flag — and every finding held.
 */
const held = (row) => row.intervened !== false;
function bandSentence(finding) {
  const what = CATEGORY_WORDS[String(finding.category || '').toUpperCase()] || 'this category';
  const band = String(finding.band || '').toUpperCase();
  if (held(finding) && band === 'HIGH') return `The check was confident this question contains ${what}.`;
  if (held(finding) && band === 'MEDIUM') return `The check was unsure (medium confidence) whether this question contains ${what}, so a person will look.`;
  return `The check noted ${what} at ${band.toLowerCase() || 'low'} confidence and let the question through.`;
}
const plain = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
const questionById = (snapshot, id) => (snapshot.questions || []).find((q) => String(q.SK) === `QUESTION#${id}`);

/** Worst first: HIGH, MEDIUM, LOW — and within a band, what held before what was let through. */
const BAND_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });
function rank(row) {
  const b = BAND_RANK[String(row.band || '').toUpperCase()];
  return (b === undefined ? 3 : b) * 2 + (held(row) ? 0 : 1);
}

async function explainOne(bedrock, InvokeModelCommand, question, finding) {
  // Told "flagged", the model writes "X is what was flagged" — onto a question
  // the check let through. So a near-miss is described as what it is.
  const lead = held(finding)
    ? [
      `A content check for a workplace quiz flagged this question for ${finding.category} at ${finding.band} confidence.`,
      'In ONE sentence of at most 200 characters, say which part of the question was flagged and separate it from the subject the question is about.',
    ]
    : [
      `A content check for a workplace quiz noted this question for ${finding.category} at ${finding.band} confidence, and let it through.`,
      'In ONE sentence of at most 200 characters, say which part of the question the check noted and separate it from the subject the question is about.',
    ];
  const prompt = [
    ...lead,
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

/**
 * Explain `rows` — findings or observations — and return them in the order
 * given, each question row carrying an `explanation`. System rows and the
 * set's own subject have no question to explain and come back untouched.
 *
 * At most `limit` model calls, worst band first. `budget`, when given, is
 * asked before EVERY call: a check that finishes late gets band sentences for
 * the rest rather than being killed before its review row is written.
 */
async function explainFindings(bedrock, InvokeModelCommand, snapshot, rows = [], { limit = 12, budget } = {}) {
  const out = rows.map((f) => ({ ...f }));
  const explainable = [];
  out.forEach((f, i) => {
    const category = String(f.category || '').toUpperCase();
    const q = f.questionId && f.questionId !== '(set)' ? questionById(snapshot, f.questionId) : null;
    if (!SYSTEM_CATEGORIES.includes(category) && q) explainable.push({ i, q });
  });
  explainable.sort((a, b) => rank(out[a.i]) - rank(out[b.i]) || a.i - b.i);
  let calls = 0;
  for (const { i, q } of explainable) {
    const f = out[i];
    let explanation = '';
    if (calls < limit && (typeof budget !== 'function' || budget())) {
      calls += 1;
      try {
        explanation = await explainOne(bedrock, InvokeModelCommand, q, f); // eslint-disable-line no-await-in-loop
      } catch (error) {
        console.warn(`⚠️ explanation for ${f.questionId} failed: ${error.message}`);
      }
    }
    out[i] = { ...f, explanation: explanation || bandSentence(f) };
  }
  return out;
}
module.exports = { explainFindings, bandSentence, MAX_CHARS, SYSTEM_CATEGORIES };
