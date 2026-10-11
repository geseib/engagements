/**
 * WHO EARNED WHAT, said once and then checked.
 *
 * Relay pilot, test game 6497, round 1: the prompt listed Lena 6 and Omar 6,
 * and Haiku wrote "Theo … and Omar … both earned 6 points". The data was
 * right; the model joined text to names itself, from a top-three split keyed
 * by answer text, and slipped. Two parts, both here:
 *
 *   authorTallyLines   `{voteTallyByAuthor}` — one line per author, name and
 *                      points, so the model copies rather than joins.
 *   findTallyMismatches  reads a reply and returns every name-and-points claim
 *                      that disagrees with the tally. get-ai-summary.js
 *                      regenerates once on a mismatch and, if it persists,
 *                      keeps the reply and logs a warning.
 *
 * THE CHECK IS DELIBERATELY FORGIVING. A false alarm costs a second model call
 * and a worse reply; a missed slip costs what it cost before. So a claim is
 * only a claim when a points figure follows the names in the same clause, and
 * it is only wrong when NO number in that stretch is the author's tally —
 * "Theo's answer led with 7 of the 18 points cast" passes, because 7 is there.
 */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUMBER = `(?:\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()]);

/** A points figure: "7 points", "7 vote points", "six pts", "1 point". */
const POINTS_RE = new RegExp(`\\b(${NUMBER})\\s+(?:vote\\s+)?(?:points?|pts)\\b`, 'gi');
const ANY_NUMBER_RE = new RegExp(`\\b(${NUMBER})\\b`, 'gi');
/**
 * "Points" is also a plain word — "the three points the room raised". A bare
 * "N points" counts as a score only beside a scoring verb; "vote points" and
 * "pts" always do.
 */
const SCORING_RE = /\b(earn\w*|collect\w*|scor\w*|receiv\w*|took|take[sn]?|won|win\w*|drew|draw\w*|gather\w*|got|gets?|tied?|ties|led|leads?|top\w*|finish\w*|land\w*|picked up|totals?|totall\w*)\b/i;
const isScore = (match, stretch) => /vote\s+points?|pts/i.test(match) || SCORING_RE.test(stretch);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rows from a vote-tally map, in the order the caller wants ties broken.
 * `voteTallies` is get-ai-summary's `{ [index]: { playerName, totalScore,
 * firstPlace, secondPlace, thirdPlace } }`; `order` (optional) lists the
 * indexes in the round's display order, so a tie never reads alphabetically.
 */
function tallyRows(voteTallies, order) {
  const entries = Object.entries(voteTallies || {});
  const rank = new Map((order || []).map((idx, pos) => [String(idx), pos]));
  return entries
    .map(([idx, t]) => ({
      idx: String(idx),
      name: typeof t.playerName === 'string' ? t.playerName.trim() : '',
      points: Number(t.totalScore) || 0,
      first: Number(t.firstPlace) || 0,
      second: Number(t.secondPlace) || 0,
      third: Number(t.thirdPlace) || 0,
    }))
    .filter((r) => r.name)
    .sort((a, b) => (b.points - a.points)
      || ((rank.has(a.idx) ? rank.get(a.idx) : Infinity) - (rank.has(b.idx) ? rank.get(b.idx) : Infinity))
      || (Number(a.idx) - Number(b.idx)));
}

/**
 * `{voteTallyByAuthor}`: one line per author. On an anonymous round the names
 * are not the model's to have, so the line says that and lists nobody.
 */
function authorTallyLines(voteTallies, { hidden = false, pointsLabel = 'vote points', order } = {}) {
  if (hidden) return 'Authors are hidden this round. Name nobody.';
  const rows = tallyRows(voteTallies, order);
  if (!rows.length) return 'No votes recorded';
  return rows
    .map((r) => `- ${r.name}: ${r.points} ${pointsLabel} (${r.first} first, ${r.second} second, ${r.third} third)`)
    .join('\n');
}

/**
 * Every claim in `text` that pairs an author with points other than their own.
 *
 * @param text     the reply, markdown and all
 * @param tallies  [{ name, points }]
 * @returns [{ name, claimed: number[], actual }]  — empty when nothing is wrong
 */
function findTallyMismatches(text, tallies) {
  const rows = (tallies || []).filter((t) => t && typeof t.name === 'string' && t.name.trim());
  if (!rows.length || !text) return [];

  // How each author may be written: the full name always; the first name too
  // when it is long enough to mean something and no other author shares it.
  const firsts = new Map();
  for (const r of rows) {
    const first = r.name.trim().split(/\s+/)[0];
    firsts.set(first, (firsts.get(first) || 0) + 1);
  }
  const forms = [];
  for (const r of rows) {
    const full = r.name.trim();
    forms.push({ form: full, row: r });
    const first = full.split(/\s+/)[0];
    if (first !== full && first.length >= 3 && firsts.get(first) === 1
      && !rows.some((o) => o !== r && o.name.trim() === first)) {
      forms.push({ form: first, row: r });
    }
  }
  // Longest first, so "Omar Patel" is found before "Omar" claims the same span.
  forms.sort((a, b) => b.form.length - a.form.length);

  const plain = String(text).replace(/[*_`#>]/g, ' ');
  // A clause ends at a sentence stop, a semicolon, a colon or a line break.
  // A colon matters: "**Lena Ortiz**: 6 points" is one clause, but "Theo: x.
  // Omar: 6 points" are two.
  const clauses = plain.split(/(?<=[.!?;])\s+|\n+/);
  const out = new Map();

  for (const clause of clauses) {
    POINTS_RE.lastIndex = 0;
    let start = 0;
    let m;
    while ((m = POINTS_RE.exec(clause)) !== null) {
      const stretch = clause.slice(start, m.index + m[0].length);
      start = m.index + m[0].length;

      // Names in this stretch, each span counted once.
      const taken = [];
      const named = new Set();
      for (const { form, row } of forms) {
        const re = new RegExp(`(^|[^\\p{L}])${escapeRe(form)}(?![\\p{L}])`, 'gu');
        let n;
        while ((n = re.exec(stretch)) !== null) {
          const s = n.index + n[1].length;
          const e = s + form.length;
          if (taken.some(([a, b]) => s < b && e > a)) continue;
          taken.push([s, e]);
          named.add(row);
        }
      }
      if (!named.size || !isScore(m[0], stretch)) continue;

      const numbers = [];
      ANY_NUMBER_RE.lastIndex = 0;
      let k;
      while ((k = ANY_NUMBER_RE.exec(stretch)) !== null) {
        const v = toNumber(k[1]);
        if (Number.isFinite(v)) numbers.push(v);
      }
      for (const row of named) {
        if (numbers.includes(row.points)) continue;
        const prev = out.get(row.name) || { name: row.name, claimed: [], actual: row.points };
        const claimed = toNumber(m[1]);
        if (!prev.claimed.includes(claimed)) prev.claimed.push(claimed);
        out.set(row.name, prev);
      }
    }
  }
  return [...out.values()];
}

module.exports = { authorTallyLines, findTallyMismatches, tallyRows };
