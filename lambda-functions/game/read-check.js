/**
 * WORKIE'S AFTER-WRITING CHECK — the backstop of docs/design/workie-grounding/STEP0.md.
 *
 * Review #38 (test, session 7360, round 1): Workie wrote "The route lead: run
 * one Friday with a 15-minute hold on departure for unacknowledged returns"
 * when no answer, no question and no count held fifteen minutes, and called
 * one objection the "strongest resistance" when the vote never measured
 * strength. The prompt rules already said not to. A rule the model can break
 * is checked after it writes.
 *
 * checkRead({ read, material, vote, voice }) → { issues: [{ kind, token, why, quote }] }
 *
 *   number      a number in the read that the material never gave it: digits
 *               with or without a unit ("15-minute", "4pm", "30%", "$200",
 *               "2x"), and number WORDS used with a unit ("fifteen minutes").
 *               Compared by value, so "15-minute", "15 minutes" and "fifteen
 *               minutes" are the same claim, and "4pm" ≈ "4 pm". Allowed: any
 *               value in the material (as digit or word), the printed counts
 *               and points, the round number, and rank ordinals ("2nd") the
 *               ranking has. "one question" is prose, not a number.
 *   claim       a word about the ROOM the vote has to support: unanimous,
 *               everyone, all agreed only when every point went to one
 *               answer; consensus, the room agreed, clear winner, decisive,
 *               overwhelming, landslide only on 'Strong consensus'
 *               (consensus.js); "strongest" never — a ranking measures
 *               preference, not strength. Negated ("no consensus") is fine.
 *   commitment  a Next steps item written as already decided: "<Name|The X>
 *               will …", "has agreed to", "is responsible for", "owns",
 *               "commits to". A step starting **Suggested**, or with
 *               could/might/may, is a suggestion and passes.
 *   filler      generic AI hype ("game-changer", "powerful", "delve"…). Low
 *               weight: reported only when another issue is, or when three or
 *               more appear.
 *
 * Words in the persona's voice text are exempt from claim and filler (a
 * voice's catchphrase is the voice). Pure: no AWS, no logging. The caller
 * logs kinds and counts only (tests/ai-summary-content-not-logged.js).
 *
 * `token` is safe to store: the read's own words, never a participant's name
 * (a commitment by a named person keeps only its verb phrase). `quote` is the
 * read's words as written, for the revision note the model gets — the model
 * already holds every name.
 */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12,
  million: 1000000,
};
const NUMBER_WORD_RE = Object.keys(NUMBER_WORDS).join('|');

// Units a number word must carry to count as a numeric claim: time, clock,
// percentage, money, multiples, and headcounts.
const UNIT_RE = [
  'seconds?', 'secs?', 'minutes?', 'mins?', 'hours?', 'hrs?', 'days?', 'weeks?', 'wks?', 'months?',
  'years?', 'yrs?', 'quarters?', 'sprints?', 'fortnights?', 'weekends?',
  'am', 'pm', 'a\\.m\\.', 'p\\.m\\.', "o'clock",
  'percent', 'per cent', 'percentage points?',
  'dollars?', 'pounds?', 'euros?', 'bucks',
  'times', 'fold',
  'people', 'persons?', 'participants?', 'staff', 'employees?', 'members?', 'teams?', 'items?', 'units?',
].join('|');

const WORD_NUMBER_WITH_UNIT = new RegExp(
  `\\b((?:${NUMBER_WORD_RE})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORD_RE}))*)[\\s-]+(${UNIT_RE})(?![A-Za-z])`, 'gi');
const ANY_NUMBER_WORD = new RegExp(
  `\\b((?:${NUMBER_WORD_RE})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORD_RE}))*)(?![A-Za-z])`, 'gi');

// Digits: an optional currency sign, the number (1,200 / 4.5 / 4:30), an
// optional ordinal or suffix, and an optional unit after a space or hyphen.
const DIGIT_RE = new RegExp(
  '(?<![A-Za-z0-9])([$£€]\\s?)?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?::(\\d{2}))?'
  + '(st|nd|rd|th)?'
  + '(\\s?(?:%|×|x(?![A-Za-z])|k(?![A-Za-z])|am(?![A-Za-z])|pm(?![A-Za-z])|a\\.m\\.|p\\.m\\.))?'
  + `(?:([\\s-]+)(${UNIT_RE})(?![A-Za-z]))?`, 'gi');

/** "twenty-five" → 25, "two hundred" → 200, "a dozen" is not reached (no "a"). */
function wordsToNumber(phrase) {
  let total = 0;
  let current = 0;
  for (const raw of String(phrase).toLowerCase().split(/[\s-]+/)) {
    if (raw === 'and' || !raw) continue;
    const n = NUMBER_WORDS[raw];
    if (n === undefined) return null;
    if (n === 100) current = (current || 1) * 100;
    else if (n >= 1000) { total += (current || 1) * n; current = 0; } else current += n;
  }
  return total + current;
}

const norm = (n) => String(Number(n));

/** Every numeric value the material holds, as digits or as words. */
function materialNumbers(text) {
  const out = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(DIGIT_RE)) {
    const value = m[2].replace(/,/g, '');
    out.add(norm(value));
    if (m[3]) out.add(`${norm(value)}:${m[3]}`);
  }
  for (const m of s.matchAll(ANY_NUMBER_WORD)) {
    const v = wordsToNumber(m[1]);
    if (v !== null) out.add(norm(v));
  }
  return out;
}

/** Numbered-list markers ("1. ", "**2.** ") are layout, not numbers. */
function stripListMarkers(text) {
  return String(text || '').split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]\s+)?(?:\*\*)?\d+[.)](?:\*\*)?\s+/, ''))
    .join('\n');
}

function numberIssues(read, allowed, rankCount) {
  const issues = [];
  const text = stripListMarkers(read);
  for (const m of text.matchAll(DIGIT_RE)) {
    const end = m.index + m[0].length;
    // "3D", "4G", "B2B": a digit glued to letters is a name, not a claim.
    if (/[A-Za-z]/.test(text[end] || '') && !m[6]) continue;
    const value = norm(m[2].replace(/,/g, ''));
    const clock = m[3] ? `${value}:${m[3]}` : null;
    if (m[4]) {
      // An ordinal: a rank the ranking has, or a number the material gave.
      if (Number(value) >= 1 && Number(value) <= rankCount) continue;
      if (allowed.has(value)) continue;
    } else if (clock) {
      if (allowed.has(clock) || (m[3] === '00' && allowed.has(value))) continue;
    } else if (allowed.has(value)) {
      continue;
    }
    issues.push({ kind: 'number', token: m[0].trim(), why: 'not in the material' });
  }
  for (const m of text.matchAll(WORD_NUMBER_WITH_UNIT)) {
    const v = wordsToNumber(m[1]);
    if (v === null || allowed.has(norm(v))) continue;
    issues.push({ kind: 'number', token: m[0].trim(), why: 'not in the material' });
  }
  return issues;
}

// ---- claims about the room -------------------------------------------------

const CLAIMS = [
  { re: /\bstrongest\b/gi, rule: 'never' },
  { re: /\boverwhelming(?:ly)?\b/gi, rule: 'strong' },
  { re: /\bunanimous(?:ly)?\b/gi, rule: 'unanimous' },
  { re: /\b(?:everyone|everybody|all)\s+agreed\b/gi, rule: 'unanimous' },
  { re: /\beveryone\b(?!\s+agreed)/gi, rule: 'unanimous' },
  { re: /\beverybody\b(?!\s+agreed)/gi, rule: 'unanimous' },
  { re: /\bnobody\s+(?:disagreed|objected|dissented|opposed|pushed back)\b/gi, rule: 'unanimous' },
  { re: /\bconsensus\b/gi, rule: 'strong' },
  { re: /\bthe\s+(?:room|group|team)\s+(?:agreed|agrees)\b/gi, rule: 'strong' },
  { re: /\bclear\s+winner\b/gi, rule: 'strong' },
  { re: /\blandslide\b/gi, rule: 'strong' },
  { re: /\bdecisive(?:ly)?\b/gi, rule: 'strong' },
];
const NEGATED = /\b(?:no|not|without|lack of|short of|nor|never|isn't|wasn't|hardly)\b[\w\s,'-]{0,24}$/i;

const inText = (needle, hay) => {
  const n = String(needle || '').toLowerCase().trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${esc}(?![a-z])`, 'i').test(String(hay || ''));
};

function claimIssues(text, vote, voice) {
  const points = Array.isArray(vote.points) ? vote.points.map(Number).filter(Number.isFinite) : [];
  const unanimous = vote.unanimous === true
    || (points.filter((p) => p > 0).length === 1 && (Number(vote.votes) > 0 || points.some((p) => p > 0)));
  const strong = unanimous || vote.consensus === 'Strong consensus';
  const issues = [];
  for (const { re, rule } of CLAIMS) {
    for (const m of text.matchAll(re)) {
      const token = m[0];
      if (inText(token, voice)) continue;
      if (rule === 'unanimous' && unanimous) continue;
      if (rule === 'strong' && strong) continue;
      if (rule !== 'never' && NEGATED.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      issues.push({ kind: 'claim', token, why: 'not something the vote shows' });
    }
  }
  return issues;
}

// ---- next steps written as decided -----------------------------------------

const STEP_HEADING = /next\s*steps?|actions?|to\s+try|follow[\s-]?ups?|what\s+now|try\s+next|steps?\s+to\s+take/i;
// A role is a person: "the route lead", "the coordinator". "The pilot will
// show…" is a thing, and a thing cannot be handed a job.
const ROLE_NOUNS = /(?:^|\s)(?:lead|leads|leader|leaders|owner|owners|manager|managers|coordinators?|drivers?|team|sponsors?|director|directors|head|chair|host|facilitator|committee|board|staff|department|champion|champions|analyst|engineer|planner|dispatcher|supervisor|officer|rep|representative|steward|receivers?|senders?|admins?)$/i;
const COMMIT_VERBS = '(?:will|has agreed to|have agreed to|agreed to|is responsible for|are responsible for|owns|own|commits to|has committed to|is committed to|is going to)';

/** The items under a Next-steps-like heading; [] when the read has none. */
function stepItems(read) {
  const lines = String(read || '').split('\n');
  const items = [];
  let inSteps = false;
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/) || line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/);
    if (heading) { inSteps = STEP_HEADING.test(heading[1]); continue; }
    if (!inSteps || !line.trim()) continue;
    items.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim());
  }
  return items;
}

function commitmentIssues(read, names) {
  const issues = [];
  const nameSet = new Set((names || []).map((n) => String(n || '').trim()).filter((n) => /^[A-Z]/.test(n)));
  const nameAlt = [...nameSet].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const subject = `((?:[Tt]he|[Oo]ur|[Yy]our)\\s+[a-z][a-z-]*(?:\\s+[a-z][a-z-]*){0,2}${nameAlt ? `|${nameAlt}` : ''})`;
  const re = new RegExp(`(?<![A-Za-z])${subject}\\s+(${COMMIT_VERBS})\\s+([a-z][\\w-]*)`, 'g');
  for (const item of stepItems(read)) {
    if (/^\**\s*suggested\b/i.test(item)) continue;
    for (const m of item.matchAll(re)) {
      const who = m[1];
      const isName = nameSet.has(who);
      if (!isName && !ROLE_NOUNS.test(who.replace(/^(?:the|our|your)\s+/i, ''))) continue;
      const verbPhrase = `${m[2]} ${m[3]}`;
      issues.push({
        kind: 'commitment',
        token: isName ? verbPhrase : `${who} ${verbPhrase}`,
        quote: `${who} ${verbPhrase}`,
        why: 'written as decided',
      });
    }
  }
  return issues;
}

// ---- generic filler ---------------------------------------------------------

const FILLER = [
  /\bgame[\s-]?chang(?:er|ers|ing)\b/gi, /\bpowerful(?:ly)?\b/gi, /\bcrucial(?:ly)?\b/gi,
  /\btransformative\b/gi, /\bincredibl[ey]\b/gi, /\bamazing(?:ly)?\b/gi,
  /\brevolutionar(?:y|ise|ize|ised|ized)\b/gi, /\bunlock(?:s|ed|ing)?\b/gi,
  /\bsupercharg(?:e|es|ed|ing)\b/gi, /\bseamless(?:ly)?\b/gi, /\brobust\b/gi,
  /\bdelv(?:e|es|ed|ing)\b/gi, /\bdive\s+deep\b|\bdeep[\s-]dive\b/gi, /\blandscape\b/gi,
  /\bjourneys?\b/gi, /\btapestry\b/gi, /\btestament\b/gi,
];

function fillerHits(text, voice, material) {
  const hits = [];
  for (const re of FILLER) {
    for (const m of text.matchAll(re)) {
      if (inText(m[0], voice) || inText(m[0], material)) continue;
      hits.push({ kind: 'filler', token: m[0], why: 'generic filler' });
    }
  }
  return hits;
}

/** Quoted words the material holds are the room's, not Workie's claims. */
function withoutQuotes(read, material) {
  return String(read || '').replace(/["“]([^"”\n]{2,400})["”]/g, (all, inner) =>
    (String(material || '').toLowerCase().includes(inner.toLowerCase().trim()) ? ' ' : all));
}

function dedupe(issues) {
  const seen = new Set();
  return issues.filter((i) => {
    const k = `${i.kind}|${String(i.token).toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * @param {Object} args
 * @param {string} args.read       the model's reply (markdown)
 * @param {string|string[]} args.material  what the model was given as the room's/author's material
 * @param {Object} args.vote       { points: [each answer's points], votes, answered, joined,
 *                                   round, consensus (consensusLabel), names: [player names],
 *                                   rankCount, unanimous? }
 * @param {string} args.voice      the persona's voice text
 */
function checkRead({ read = '', material = '', vote = {}, voice = '' } = {}) {
  const materialText = Array.isArray(material) ? material.filter((m) => m !== null && m !== undefined).join('\n') : String(material || '');
  const allowed = materialNumbers(`${materialText}\n${voice || ''}`);
  for (const n of [vote.votes, vote.answered, vote.joined, vote.round, ...(vote.points || [])]) {
    if (Number.isFinite(Number(n)) && n !== null && n !== '') allowed.add(norm(n));
  }
  const rankCount = Number(vote.rankCount) || (Array.isArray(vote.points) ? vote.points.length : 0);
  const text = withoutQuotes(read, materialText);

  const hard = dedupe([
    ...numberIssues(text, allowed, rankCount),
    ...claimIssues(text, vote, voice),
    ...commitmentIssues(text, vote.names),
  ]);
  const filler = fillerHits(text, voice, materialText);
  const issues = hard.length || filler.length >= 3 ? [...hard, ...dedupe(filler)] : hard;
  return { issues };
}

/**
 * Everything the model was given as the room's or the author's material: the
 * template variables (question, answers ranked with points, counts, scores,
 * event details…) plus the layers outside them (the host's context, the
 * briefing, late answers, the angle's standings). The generator's one helper.
 */
function collectMaterial(templateVars = {}, extra = []) {
  const out = [];
  for (const [k, v] of Object.entries(templateVars || {})) {
    if (k === 'contextInstructions') continue; // a fixed instruction, not material
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
  }
  for (const v of extra || []) {
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String));
  }
  return out.filter((s) => s.trim());
}

const NOTE_LINES = {
  number: (q) => `- "${q}" is not in the material: remove it, or use a number the material contains.`,
  claim: (q) => `- "${q}" is not something the vote shows: say what it shows instead (for example, "named by three answers").`,
  commitment: (q) => `- "${q}…" is written as decided: the room has not agreed; make it a suggestion starting **Suggested**.`,
  filler: (q) => `- "${q}" is generic filler: cut it, or say the specific thing the material shows.`,
};

/** The exact revision note for one more call. */
function revisionNote(issues) {
  return ['Revise your reply. Change only these, keep everything else, keep the headings:']
    .concat((issues || []).map((i) => NOTE_LINES[i.kind](i.quote || i.token)))
    .join('\n');
}

/** Counts by kind, for a log line: never a token. */
function issueKinds(issues) {
  const out = {};
  for (const i of issues || []) out[i.kind] = (out[i.kind] || 0) + 1;
  return out;
}

module.exports = { checkRead, collectMaterial, revisionNote, issueKinds, stepItems };
