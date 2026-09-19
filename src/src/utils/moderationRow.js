/**
 * THE QUEUE'S WORDS. A pointer row (shared/moderation-queue.js) says why a set
 * is waiting; this turns it into the one line the table shows — band words,
 * never scores (spec §10.5). Content-notice labels are Stage 4's vocabulary;
 * until then an id reads as its words ("graphic-medical" → "graphic medical").
 *
 * The score card reads a REVIEW row's reasons through the same function, so a
 * reason reads the same on both screens. Those are the check's own
 * (set-check-worker.js): 'guardrail' is the escalation the queue already words,
 * the check unsure. A queue row the check escalated carries the same list as
 * `checkReasons` (reasonsOf, below), so images, a declared notice, a budget
 * that ran out, a snapshot that would not save and a check that threw read the
 * same on the queue as on the card.
 */
const APPEAL_MAX = 80;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ').trim();
/** One notice id, or the review row's list of what the author declared (up to eight, check-question-set.js). */
const noticeWords = (notice) => (Array.isArray(notice) ? notice : [notice]).map(humanise).filter(Boolean).join(', ');

const BANDS = ['HIGH', 'MEDIUM', 'LOW'];
/**
 * A queue row's `bands` is one band per category — { HATE: 'MEDIUM' } (spec
 * §3.2), as the check and the appeal write it — so it reads worst band first,
 * each with the categories seen at it, in the review dialog's own words for
 * them: "medium: hate, violence". A value that is not a band is skipped, never
 * printed: no writer has ever stored a count here, and a number on this line
 * would be a score.
 */
function bandWords(bands) {
  const seen = new Map(BANDS.map((b) => [b, []]));
  for (const [category, band] of Object.entries(bands && typeof bands === 'object' ? bands : {})) {
    const b = String(band || '').toUpperCase();
    if (seen.has(b)) seen.get(b).push(humanise(category).toLowerCase());
  }
  return BANDS.filter((b) => seen.get(b).length).map((b) => `${b.toLowerCase()}: ${seen.get(b).sort().join(', ')}`).join('; ');
}

function escalationWords(item) {
  const ids = Array.isArray(item.uncertainQuestionIds) ? item.uncertainQuestionIds : [];
  const head = ids.length ? plural(ids.length, 'uncertain question') : 'Uncertain';
  const detail = bandWords(item.bands);
  return detail ? `${head} (${detail})` : head;
}

function appealWords(item) {
  const msg = String(item.appealMessage || '').trim();
  if (!msg) return 'Appealed';
  const shown = msg.length > APPEAL_MAX ? `${msg.slice(0, APPEAL_MAX - 1)}…` : msg;
  return `Appealed: “${shown}”`;
}

function reportWords(item) {
  const r = item.reports && typeof item.reports === 'object' ? item.reports : {};
  const count = Number(r.count) || 0;
  const byType = r.byType && typeof r.byType === 'object' ? r.byType : {};
  const types = Object.entries(byType).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).map(([t, n]) => `${t} (${Number(n)})`);
  return `Reported${count ? ` ×${count}` : ''}${types.length ? ` · ${types.join(', ')}` : ''}`;
}

/**
 * What a row is waiting for. A queue row the check escalated says only
 * 'escalated', and carries beside it what the escalation was for — the check's
 * own reasons, `checkReasons` (set-check-worker.js). Those replace it, and
 * 'escalated' keeps its words only for what they leave unexplained: questions
 * or bands the guardrail could not decide. A row that carries none — an appeal,
 * or a row written before the check named them — reads as it always did.
 */
function reasonsOf(item) {
  const listed = Array.isArray(item.reasons) ? item.reasons : [];
  const own = Array.isArray(item.checkReasons) ? item.checkReasons : [];
  if (!own.length || !listed.includes('escalated')) return listed;
  const undecided = (Array.isArray(item.uncertainQuestionIds) && item.uncertainQuestionIds.length > 0) || bandWords(item.bands) !== '';
  return [...listed.filter((r) => r !== 'escalated' || undecided), ...own];
}

export function whyLabel(item = {}) {
  const reasons = reasonsOf(item);
  const parts = [];
  if (reasons.includes('escalated') || reasons.includes('guardrail')) parts.push(escalationWords(item));
  if (reasons.includes('appealed')) parts.push(appealWords(item));
  if (reasons.includes('reported')) parts.push(reportWords(item));
  if (reasons.includes('declared')) parts.push(`Declared: ${noticeWords(item.declaredNotice) || 'a content notice'}`);
  if (reasons.includes('images')) parts.push('Images');
  if (reasons.includes('timeout')) parts.push('Out of time');
  if (reasons.includes('snapshot')) parts.push('Snapshot not saved');
  if (reasons.includes('error')) parts.push('Error');
  // A check reason with no words here yet still sent the set to a person: say
  // what the queue always said of an escalation, not "Waiting".
  if (!parts.length && Array.isArray(item.reasons) && item.reasons.includes('escalated')) parts.push(escalationWords(item));
  return parts.length ? parts.join(' · ') : 'Waiting';
}

export function waitedLabel(sinceIso, nowMs = Date.now()) {
  if (!sinceIso) return '';
  const ms = nowMs - Date.parse(sinceIso);
  if (!Number.isFinite(ms) || ms < 60 * 1000) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}

export function queueHeadline(count, oldestSinceIso, nowMs = Date.now()) {
  const n = Number(count) || 0;
  if (!n) return '';
  return `${plural(n, 'set')} the check would not decide on its own. Oldest has waited ${waitedLabel(oldestSinceIso, nowMs) || 'just now'}.`;
}
