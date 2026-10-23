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
 * checkRead({ read, material, vote, voice, instructions }) → { issues: [{ kind, token, why, quote }] }
 *
 *   number      a number in the read that the material never gave it: digits
 *               with or without a unit ("15-minute", "4pm", "30%", "$200",
 *               "2x"), and number WORDS used with a unit or a noun ("fifteen
 *               minutes", "two Friday runs"). "15-minute", "15 minutes" and
 *               "fifteen minutes" are the same claim, and "4pm" ≈ "4 pm".
 *               UNIT-AWARE (review #46): a number attached to a unit or a noun
 *               passes only when the material has the same value with the same
 *               unit or noun ("two-week" ≈ "two weeks"; "two branches" licenses
 *               branches, not "two Friday runs" or "a two-week pilot"). A bare
 *               number keeps the by-value rule. Allowed whatever follows them:
 *               the printed counts and points and the round number (but not
 *               with a duration, a clock, a percentage or money), rank ordinals
 *               ("2nd") the ranking has, and counts of the room's own things
 *               ("three answers"). "one question" is prose, not a number.
 *   claim       a word about the ROOM the vote has to support: unanimous,
 *               everyone, all agreed only when every point went to one
 *               answer; consensus, the room agreed, clear winner, decisive,
 *               overwhelming, landslide only on 'Strong consensus'
 *               (consensus.js); "strongest" never — a ranking measures
 *               preference, not strength. Negated ("no consensus") is fine.
 *   commitment  a Next steps item written as already decided: "<Name|The X>
 *               will …", "has agreed to", "is responsible for", "owns",
 *               "commits to" — or handed out as a task, "<Owner>: <verb> …"
 *               (review #46: the v1 prompts ask for that shape). A step
 *               starting **Suggested**, or with could/might/may, is a
 *               suggestion and passes.
 *   owner       a Next steps item's owner ("Route lead:", "Whoever runs the
 *               weekly release") the answers never named: grounded when the
 *               phrase, a player name in it, or its head noun is in the
 *               material ("route lead", "driver", "growth sponsors"). An owner
 *               phrase that is in the prompt's own `instructions` but not in
 *               the material is the prompt's example leaking, and is flagged
 *               whatever its head noun.
 *   practice    a claim about what the organisation currently, habitually or
 *               already does ("the current habit is", "currently", "already
 *               has", "as usual", "signals that … is to") — review #46's
 *               "the current habit is to build visible tooling first" — unless
 *               an answer says the same thing in its own words.
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

// The units a digit may carry glued or spaced ("15-minute", "6 weeks"): time,
// clock, percentage, money, multiples, and headcounts. What a number COUNTS
// is read by unitAfter below, for digits and words alike.
const UNIT_RE = [
  'seconds?', 'secs?', 'minutes?', 'mins?', 'hours?', 'hrs?', 'days?', 'weeks?', 'wks?', 'months?',
  'years?', 'yrs?', 'quarters?', 'sprints?', 'fortnights?', 'weekends?',
  'am', 'pm', 'a\\.m\\.', 'p\\.m\\.', "o'clock",
  'percent', 'per cent', 'percentage points?',
  'dollars?', 'pounds?', 'euros?', 'bucks',
  'times', 'fold',
  'people', 'persons?', 'participants?', 'staff', 'employees?', 'members?', 'teams?', 'items?', 'units?',
].join('|');

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

/*
  UNITS AND NOUNS (review #46, test cb30e35d). "two branches" in an answer let
  "the next two Friday runs" and "a two-week pilot" through, because the check
  compared the value alone. A number now carries what it counts: a unit family
  (a duration, a clock, a percentage, money, a multiple, a headcount) or the
  nouns after it, plural or singular ("two-week" ≈ "two weeks", "branches" ≈
  "branch").
*/
const UNIT_FAMILY = {
  second: 'second', seconds: 'second', sec: 'second', secs: 'second',
  minute: 'minute', minutes: 'minute', min: 'minute', mins: 'minute',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour',
  day: 'day', days: 'day', week: 'week', weeks: 'week', wk: 'week', wks: 'week',
  month: 'month', months: 'month', year: 'year', years: 'year', yr: 'year', yrs: 'year',
  quarter: 'quarter', quarters: 'quarter', sprint: 'sprint', sprints: 'sprint',
  fortnight: 'fortnight', fortnights: 'fortnight', weekend: 'weekend', weekends: 'weekend',
  am: 'clock', pm: 'clock', 'a.m.': 'clock', 'p.m.': 'clock', "o'clock": 'clock',
  percent: 'percent', '%': 'percent', percentage: 'percent',
  dollar: 'money', dollars: 'money', pound: 'money', pounds: 'money', euro: 'money', euros: 'money', bucks: 'money',
  k: 'thousand', times: 'times', fold: 'times', x: 'times', '×': 'times',
  people: 'people', person: 'people', persons: 'people', participant: 'people', participants: 'people',
  staff: 'people', employee: 'people', employees: 'people', member: 'people', members: 'people',
  player: 'people', players: 'people', attendee: 'people', attendees: 'people',
};
// A measurement a count cannot license: "4 answered" allows "4 people", never
// "4 weeks", "4pm", "4%" or "$4".
const MEASURES = new Set(['second', 'minute', 'hour', 'day', 'week', 'month', 'year', 'quarter', 'sprint',
  'fortnight', 'weekend', 'clock', 'percent', 'money', 'times', 'thousand']);
// The room's own things: a count of them is a count of the vote or the
// answers, not a fact about the organisation ("named by three answers").
const COUNT_NOUNS = new Set(['answer', 'response', 'vote', 'voter', 'point', 'people', 'round', 'question',
  'place', 'rank', 'idea', 'option', 'choice', 'objection', 'concern', 'theme', 'camp', 'view', 'suggestion',
  'proposal', 'name', 'mention', 'word', 'side', 'way', 'step', 'thing', 'reply', 'list', 'entry',
  'submission', 'pick', 'group', 'reason', 'other']);
// Words that end the phrase a number counts.
const UNIT_STOP = new Set(['of', 'and', 'or', 'but', 'nor', 'to', 'the', 'a', 'an', 'in', 'for', 'with', 'that',
  'which', 'who', 'whom', 'whose', 'is', 'are', 'was', 'were', 'be', 'been', 'on', 'at', 'by', 'from', 'per',
  'than', 'as', 'it', 'its', 'their', 'this', 'these', 'those', 'each', 'if', 'when', 'then', 'so', 'out',
  'up', 'over', 'under', 'into', 'before', 'after', 'about', 'not', 'no', 'will', 'would', 'could', 'might',
  'may', 'can', 'should', 'did', 'do', 'does', 'had', 'have', 'has', 'all', 'both', 'here', 'there', 'where',
  'while', 'until', 'between', 'among', 'against', 'say', 'says', 'want', 'wants', 'put', 'see', 'agree',
  'disagree', 'split', 'stand', 'stood', 'took', 'got', 'came', 'went', 'gave', 'left', 'hold', 'holds',
  'keep', 'keeps', 'name', 'names', 'back', 'backs', 'wait', 'waits',
  // Verbs a count is the subject of ("two found it useful", "three said so").
  'found', 'find', 'finds', 'said', 'felt', 'feel', 'feels', 'thought', 'think', 'thinks', 'chose', 'choose',
  // (Not "lead" or "run": "route lead", "Friday runs" are what is counted or named.)
  'made', 'make', 'saw', 'knew', 'know', 'kept', 'ran', 'met', 'led', 'sent', 'spent', 'lost',
  'won', 'built', 'brought', 'heard', 'held', 'told', 'meant', 'like', 'likes', 'prefer', 'prefers', 'rate',
  'rates', 'gives', 'give', 'get', 'gets', 'need', 'needs', 'ask', 'asks', 'pick', 'picks', 'went', 'got']);

/** "branches" → "branch", "Friday's" → "friday", "weeks" → "week" (a unit word → its family). */
function singular(word) {
  let w = String(word || '').toLowerCase().replace(/['’]s$/, '').replace(/['’]$/, '');
  if (UNIT_FAMILY[w]) return UNIT_FAMILY[w];
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  return UNIT_FAMILY[w] || w;
}

/**
 * What the number ending at `at` counts: up to `max` words after it, joined by
 * a space or a hyphen, cut at a stop word, a past participle, an adverb or a
 * unit (a unit ends the phrase: "two-week pilot" counts weeks).
 * → { measure, nouns: [singular forms], words: [as written], sep } or null (bare).
 */
function unitAfter(text, at, max) {
  const rest = String(text || '').slice(at);
  // A hyphenated word is one word, counted by its last part: "second-place" is a place.
  const WORD = "[A-Za-z][A-Za-z'’]*(?:-[A-Za-z][A-Za-z'’]*)*";
  const m = rest.match(new RegExp(`^([ \\t]*-[ \\t]*|[ \\t]+)(${WORD})((?:[ \\t]+${WORD}){0,4})`));
  if (!m) return null;
  const words = [];
  for (const w of [m[2], ...m[3].trim().split(/[ \t]+/).filter(Boolean)]) {
    const lower = w.toLowerCase().split('-').pop();
    if (UNIT_STOP.has(lower) || /(?:ed|ly)$/.test(lower) || NUMBER_WORDS[lower] !== undefined) break;
    words.push(w);
    // A unit or a count of the room's things ends it: "12 points second" counts points.
    if (UNIT_FAMILY[singular(lower)] || MEASURES.has(singular(lower)) || COUNT_NOUNS.has(singular(lower))) break;
    if (words.length >= max) break;
  }
  if (!words.length) return null;
  const nouns = words.map((w) => singular(w.split('-').pop()));
  const measure = nouns.find((n) => MEASURES.has(n)) || null;
  return { measure, nouns, words, sep: m[1].includes('-') ? '-' : ' ' };
}

const addUnit = (map, value, family) => {
  if (!family) return;
  if (!map.has(value)) map.set(value, new Set());
  map.get(value).add(family);
};

/** The family a digit's own suffix or currency sign gives it: "4pm", "30%", "$200", "5x". */
function digitSuffixFamily(m) {
  if (m[1]) return 'money';
  const suffix = String(m[5] || '').trim().toLowerCase();
  return suffix ? (UNIT_FAMILY[suffix] || null) : null;
}

/** Where a digit's number ends, before any unit DIGIT_RE took after it. */
const digitCoreEnd = (m) => m.index + m[0].length - (m[6] || '').length - (m[7] || '').length;

/**
 * Every numeric value the material holds, as digits or as words, and the
 * units and nouns each is printed with: { values: Set, units: Map<value, Set> }.
 */
function materialNumbers(text) {
  const values = new Set();
  const units = new Map();
  const s = String(text || '');
  for (const m of s.matchAll(DIGIT_RE)) {
    const value = norm(m[2].replace(/,/g, ''));
    values.add(value);
    if (m[3]) values.add(`${value}:${m[3]}`);
    addUnit(units, value, digitSuffixFamily(m));
    const after = unitAfter(s, digitCoreEnd(m), 3);
    if (after) after.nouns.forEach((n) => addUnit(units, value, n));
  }
  for (const m of s.matchAll(ANY_NUMBER_WORD)) {
    const v = wordsToNumber(m[1]);
    if (v === null) continue;
    values.add(norm(v));
    const after = unitAfter(s, m.index + m[0].length, 3);
    if (after) after.nouns.forEach((n) => addUnit(units, norm(v), n));
  }
  return { values, units };
}

/** Numbered-list markers ("1. ", "**2.** ") are layout, not numbers. */
function stripListMarkers(text) {
  return String(text || '').split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]\s+)?(?:\*\*)?\d+[.)](?:\*\*)?\s+/, ''))
    .join('\n');
}

/**
 * A number with a unit or nouns after it is the material's when the material
 * printed the same value with the same family. 1 is prose ("one Friday") and
 * keeps the by-value rule; the vote's counts, points and round pass with
 * anything but a measurement; a count of the room's own things passes by value.
 */
function unitAllowed(value, after, nums) {
  if (value === '1') return nums.values.has(value);
  const have = nums.units.get(value) || new Set();
  if (after.measure) return have.has(after.measure);
  if (nums.counts.has(value)) return true;
  if (after.nouns.some((n) => COUNT_NOUNS.has(n))) return nums.values.has(value);
  return after.nouns.some((n) => have.has(n));
}

function numberIssues(read, nums, rankCount) {
  const allowed = nums.values;
  const issues = [];
  const text = stripListMarkers(read);
  const flag = (token) => issues.push({ kind: 'number', token: token.trim(), why: 'not in the material' });
  for (const m of text.matchAll(DIGIT_RE)) {
    const end = m.index + m[0].length;
    // "3D", "4G", "B2B": a digit glued to letters is a name, not a claim.
    if (/[A-Za-z]/.test(text[end] || '') && !m[6]) continue;
    const value = norm(m[2].replace(/,/g, ''));
    const clock = m[3] ? `${value}:${m[3]}` : null;
    if (m[4]) {
      // An ordinal: a rank the ranking has, or a number the material gave.
      if ((Number(value) >= 1 && Number(value) <= rankCount) || allowed.has(value)) continue;
      flag(m[0]);
    } else if (clock) {
      if (allowed.has(clock) || (m[3] === '00' && allowed.has(value))) continue;
      flag(m[0]);
    } else if (digitSuffixFamily(m)) {
      // "4pm" needs a 4 the material printed as a clock; "30%" a 30 as a percentage.
      if ((nums.units.get(value) || new Set()).has(digitSuffixFamily(m))) continue;
      flag(m[0]);
    } else {
      const core = text.slice(m.index, digitCoreEnd(m));
      const after = unitAfter(text, digitCoreEnd(m), 2);
      if (after ? unitAllowed(value, after, nums) : allowed.has(value)) continue;
      flag(after && !after.measure ? `${core}${after.sep}${after.words.join(' ')}` : m[0]);
    }
  }
  for (const m of text.matchAll(ANY_NUMBER_WORD)) {
    const v = wordsToNumber(m[1]);
    if (v === null) continue;
    const after = unitAfter(text, m.index + m[0].length, 2);
    // A bare number word is prose ("three of four"), and so is the count after
    // "of" ("two of two found it useful"); a word count of the room's own
    // things is the room's ("three answers").
    if (!after || (!after.measure && after.nouns.some((n) => COUNT_NOUNS.has(n)))) continue;
    if (!after.measure && /\bof\s+$/i.test(text.slice(Math.max(0, m.index - 4), m.index))) continue;
    if (unitAllowed(norm(v), after, nums)) continue;
    flag(`${m[0]}${after.sep}${after.words.join(' ')}`);
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

/**
 * The items under a Next-steps-like heading, each with whether its heading
 * already calls them suggestions ("## Suggested next steps"); [] when none.
 */
function stepEntries(read) {
  const lines = String(read || '').split('\n');
  const items = [];
  let inSteps = false;
  let suggested = false;
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/) || line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/);
    if (heading) {
      inSteps = STEP_HEADING.test(heading[1]);
      suggested = /\bsuggest(?:ed|ions?)\b/i.test(heading[1]);
      continue;
    }
    if (!inSteps || !line.trim()) continue;
    items.push({ text: line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim(), suggested });
  }
  return items;
}

/** The items under a Next-steps-like heading; [] when the read has none. */
const stepItems = (read) => stepEntries(read).map((e) => e.text);

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

// ---- owners the answers never named, and steps handed out as tasks ---------

/*
  Review #46 (test cb30e35d): "Whoever runs the weekly release: book paid
  cover…" when no answer had a release — the words were the prompt's own
  example ("whoever runs the weekly release, whoever owns that wiki page") —
  and "Route lead: count…", "Growth sponsors: list…" handed out as tasks, the
  shape the v1 prompts ask for. An owner must be one the answers name; a step
  is a suggestion.
*/
const SUGGESTED_PREFIX = /^\s*\**\s*suggested\b\s*\**\s*[:—–-]?\s*\**\s*/i;
const HEDGED = /\b(?:could|might|may)\b/i;
const WHOEVER = /\bwhoever\s+(?:runs|owns|leads|manages|handles|chairs|coordinates|organi[sz]es|maintains|plans|schedules|books|drives|keeps|looks after|is responsible for|is in charge of)\s+[^:,.;!?\n]{1,60}/i;
// The head of a role: "route lead", "growth sponsors", "the driver".
const ROLE_HEADS = new Set(['lead', 'leader', 'owner', 'manager', 'coordinator', 'driver', 'team', 'sponsor',
  'director', 'head', 'chair', 'host', 'facilitator', 'committee', 'board', 'staff', 'department', 'champion',
  'analyst', 'engineer', 'planner', 'dispatcher', 'supervisor', 'officer', 'rep', 'representative', 'steward',
  'receiver', 'sender', 'admin', 'crew', 'volunteer', 'organiser', 'organizer', 'scheduler', 'operator',
  'person', 'people', 'worker', 'keeper', 'maintainer', 'reviewer', 'trainer', 'teacher', 'editor', 'author',
  'clerk', 'assistant', 'agent', 'nurse', 'doctor', 'principal', 'partner', 'ops', 'desk', 'group', 'unit']);
// Owners every session has: the person running it ("the host", "Session lead",
// "the workshop organiser") — the survey prompt asks for exactly that role.
const ALWAYS_OWNERS = new Set(['host', 'facilitator', 'organiser', 'organizer', 'you']);
const SESSION_ROLE = /^(?:(?:the|this|our|your)\s+)?(?:(?:session|event|workshop|meeting|offsite|survey|round)\s+)?(?:host|facilitator|lead|leader|owner|organi[sz]er|chair|runner)s?$/i;
const sessionRole = (phrase) => ALWAYS_OWNERS.has(phrase.toLowerCase())
  || (/^(?:(?:the|this|our|your)\s+)?(?:session|event|workshop|meeting|offsite|survey|round)\s+/i.test(phrase) && SESSION_ROLE.test(phrase))
  || /^(?:(?:the|this|our|your)\s+)?(?:host|facilitator|organi[sz]er)s?$/i.test(phrase);
const OWNER_STOP = new Set([...UNIT_STOP, 'whoever', 'runs', 'owns', 'leads', 'manages', 'handles', 'chairs',
  'coordinates', 'organises', 'organizes', 'maintains', 'plans', 'schedules', 'books', 'drives', 'keeps',
  'looks', 'responsible', 'charge', 'our', 'your', 'every', 'any', 'next', 'weekly', 'daily', 'monthly']);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every word of the material, singular, for "does the material name this role?". */
function materialWords(text) {
  return new Set((String(text || '').match(/[A-Za-z][A-Za-z'’-]*/g) || [])
    .flatMap((w) => w.split('-'))
    .map(singular));
}

/**
 * The owner a step names, if it names one: "Route lead: …", "**Maya:** …",
 * "Whoever runs the weekly release: …". → { phrase, head, names, colon, rest } or null.
 */
function stepOwner(item, nameSet) {
  const body = item.replace(SUGGESTED_PREFIX, '').replace(/\*\*/g, '').trim();
  const colon = body.match(/^([^:.;!?\n]{2,140}):\s+(\S[\s\S]*)$/);
  const colonWords = colon ? colon[1].trim().split(/\s+/).length : 0;
  const whoever = body.match(WHOEVER);
  let phrase = null;
  // "Route lead:" is short; "Whoever manages the team that …:" may run longer.
  if (colon && (colonWords <= 7 || (/^whoever\b/i.test(colon[1].trim()) && colonWords <= 20))) phrase = colon[1].trim();
  else if (whoever) phrase = whoever[0].trim();
  if (!phrase) return null;
  const words = phrase.split(/\s+/);
  const names = words.map((w) => w.replace(/['’]s$/, '').replace(/[^\w'’-]/g, '')).filter((w) => nameSet.has(w));
  const isWhoever = /^whoever\b/i.test(phrase);
  // The head of each alternative ("code review or pair programming"), before
  // any relative clause ("the team that described …" is a team).
  const heads = phrase
    .replace(/\s+(?:that|who|which|whose|where|whom)\b[\s\S]*$/i, '')
    .split(/\s+(?:or|and)\s+|\s*[,/&]\s*/i)
    .map((alt) => alt.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z'’-]/g, ''))
      .filter((w) => w && !OWNER_STOP.has(w) && !names.some((n) => n.toLowerCase() === w)))
    .filter((c) => c.length)
    .map((c) => singular(c[c.length - 1].split('-').pop()));
  // A colon prefix is an owner only when it is a person: a name, a role, or "whoever …".
  if (!isWhoever && !names.length && !heads.some((h) => ROLE_HEADS.has(h))) return null;
  return { phrase, heads, names, isWhoever, colon: Boolean(colon && phrase === colon[1].trim()), rest: colon ? colon[2] : '' };
}

/** A phrase as a token: never a participant's name. */
const withoutNames = (phrase, names) => names
  .reduce((s, n) => s.replace(new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?:['’]s)?(?![A-Za-z])`, 'g'), '…'), phrase)
  .replace(/\s+/g, ' ').trim();

function ownerIssues(read, { names, materialText, instructions }) {
  const issues = [];
  const nameSet = new Set((names || []).map((n) => String(n || '').trim()).filter((n) => /^[A-Z]/.test(n)));
  const words = materialWords(materialText);
  for (const { text: item, suggested } of stepEntries(read)) {
    const owner = stepOwner(item, nameSet);
    if (!owner) continue;
    const { phrase, heads } = owner;
    const bare = phrase.replace(/^(?:the|our|your)\s+/i, '');
    const inMaterial = inText(bare, materialText);
    // The prompt's own example, copied: in the instructions, not in the material.
    const leaked = !inMaterial && bare.split(/\s+/).length >= 2 && inText(bare, instructions);
    const grounded = !leaked && (inMaterial
      || sessionRole(phrase)
      || (owner.names.length
        ? owner.names.every((n) => inText(n, materialText))
        : heads.some((h) => words.has(h))));
    if (!grounded) {
      issues.push({
        kind: 'owner',
        token: withoutNames(phrase, owner.names),
        quote: phrase,
        why: leaked ? "the prompt's own example, not the answers'" : 'an owner the answers never named',
      });
    }
    // "Route lead: count …" is a task handed out; a step is a suggestion. Under
    // a "Suggested next steps" heading every step already is one.
    if (owner.colon && !suggested && !SUGGESTED_PREFIX.test(item) && !HEDGED.test(owner.rest)) {
      const verb = (owner.rest.match(/^[\w'’-]+/) || [''])[0];
      issues.push({
        kind: 'commitment',
        token: `${withoutNames(phrase, owner.names)}: ${verb}`.trim(),
        quote: `${phrase}: ${verb}`.trim(),
        why: 'written as a task',
      });
    }
  }
  return issues;
}

// ---- what the organisation already does ------------------------------------

/*
  Review #46: "…which signals that the current habit is to build visible
  tooling first." No answer said what the organisation does now; the answers
  proposed. A read may say what an answer says the organisation does, never
  infer it.
*/
const PRACTICE = [
  /\bsignals?\s+that\b[^.!?\n]{0,80}?\bis\s+to\b/gi,
  /\b(?:the|its|their|our|your|an?)\s+(?:current|existing|usual|established|present|normal|standing)\s+(?:habits?|practices?|approach(?:es)?|process(?:es)?|ways?|patterns?|norms?|defaults?|culture|routines?|instincts?|set-?ups?|arrangements?|workflows?|polic(?:y|ies)|rules?)\b(?:\s+(?:is|are|was)\b)?/gi,
  /\bcurrently\b/gi,
  /\bas\s+(?:usual|always)\b/gi,
  /\b(?:usually|habitually|routinely|customarily|traditionally)\b/gi,
  /\b(?:has|have)\s+always\b/gi,
  // "already has a rota", never "or where it already has." (an auxiliary).
  /\balready\s+(?:does|do|did|has|have|is|are|runs?|uses?|builds?|holds?|works?|tends?|starts?|puts?|ships?|treats?|prioriti[sz]es?|focus(?:es)?|spends?)\b(?=[ \t]+[A-Za-z])/gi,
];
// "the second answer already has a fix" is about an answer, not the organisation.
const ABOUT_THE_ROOM = /\b(?:answers?|responses?|votes?|ranking|room|list|question|round|idea|proposal|suggestion)['’]?s?\s*$/i;
const PRACTICE_CUE = /\b(?:current(?:ly)?|already|usual(?:ly)?|habit\w*|practice\w*|always|routine\w*|today|now|existing|tradition\w*)\b/i;
const CONTENT_STOP = new Set([...UNIT_STOP, 'what', 'they', 'them', 'first', 'most', 'more', 'some', 'any',
  'very', 'just', 'also', 'only', 'signals', 'signal', 'current', 'currently', 'habit', 'practice', 'already',
  'usual', 'usually', 'always', 'existing', 'which', 'we', 'our', 'us', 'you', 'your']);

const contentWords = (s) => new Set((String(s || '').toLowerCase().match(/[a-z][a-z'’-]{3,}/g) || [])
  .filter((w) => !CONTENT_STOP.has(w))
  .map(singular));

function practiceIssues(text, { materialText, names }) {
  const issues = [];
  const nameList = (names || []).filter((n) => /^[A-Z]/.test(String(n || '')));
  // Material sentences that say what is done now: the only ones that can ground a claim.
  const grounds = String(materialText || '').split(/[.!?\n]+/).filter((s) => PRACTICE_CUE.test(s)).map(contentWords);
  const hits = [];
  for (const re of PRACTICE) for (const m of text.matchAll(re)) hits.push({ at: m.index, end: m.index + m[0].length, token: m[0] });
  hits.sort((a, b) => a.at - b.at || b.end - a.end);
  let lastEnd = -1;
  for (const h of hits) {
    if (h.at < lastEnd) continue;
    lastEnd = h.end;
    if (/^already/i.test(h.token) && ABOUT_THE_ROOM.test(text.slice(Math.max(0, h.at - 30), h.at))) continue;
    const start = Math.max(text.lastIndexOf('.', h.at), text.lastIndexOf('\n', h.at)) + 1;
    const stop = text.slice(h.end).search(/[.!?\n]/);
    const sentence = text.slice(start, stop < 0 ? text.length : h.end + stop);
    // A question asks what is done now ("Who currently owns the rollback plan?"); it claims nothing.
    if (stop >= 0 && text[h.end + stop] === '?') continue;
    // …and so does a step that sets out to find out ("confirm whether it currently covers …").
    if (/\b(?:whether|if|ask|asks|check|checks|find out|confirm|confirms)\b[^.;:!?\n]{0,60}$/i.test(text.slice(start, h.at))) continue;
    const mine = contentWords(sentence);
    if (grounds.some((g) => [...mine].filter((w) => g.has(w)).length >= 2)) continue;
    const quote = text.slice(h.at, stop < 0 ? text.length : h.end + stop).trim().slice(0, 140);
    issues.push({
      kind: 'practice',
      token: withoutNames(h.token, nameList),
      quote,
      why: 'what the organisation does, which no answer says',
    });
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
 * @param {string} args.instructions  the prompt's own instruction text (template, contract,
 *                                   rules) — NOT material: an owner found only here is the
 *                                   prompt's example leaking into the read
 */
function checkRead({ read = '', material = '', vote = {}, voice = '', instructions = '' } = {}) {
  const materialText = Array.isArray(material) ? material.filter((m) => m !== null && m !== undefined).join('\n') : String(material || '');
  const nums = materialNumbers(`${materialText}\n${voice || ''}`);
  nums.counts = new Set();
  for (const n of [vote.votes, vote.answered, vote.joined, vote.round, ...(vote.points || [])]) {
    if (Number.isFinite(Number(n)) && n !== null && n !== '') { nums.values.add(norm(n)); nums.counts.add(norm(n)); }
  }
  const rankCount = Number(vote.rankCount) || (Array.isArray(vote.points) ? vote.points.length : 0);
  const text = withoutQuotes(read, materialText);

  const hard = dedupe([
    ...numberIssues(text, nums, rankCount),
    ...claimIssues(text, vote, voice),
    ...commitmentIssues(text, vote.names),
    ...ownerIssues(text, { names: vote.names, materialText, instructions: String(instructions || '') }),
    ...practiceIssues(text, { materialText, names: vote.names }),
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
  owner: (q) => `- "${q}" is an owner the answers never named: use a person or a role an answer names.`,
  practice: (q) => `- "${q}" says what the organisation already does; the answers only propose it: say it as their proposal.`,
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
