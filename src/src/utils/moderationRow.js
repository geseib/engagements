/**
 * THE QUEUE'S WORDS. A pointer row (shared/moderation-queue.js) says why a set
 * is waiting; this turns it into the one line the table shows — band words,
 * never scores (spec §10.5). Content-notice labels are Stage 4's vocabulary;
 * until then an id reads as its words ("graphic-medical" → "graphic medical").
 */
const APPEAL_MAX = 80;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ').trim();

function escalationWords(item) {
  const ids = Array.isArray(item.uncertainQuestionIds) ? item.uncertainQuestionIds : [];
  if (ids.length) return `${plural(ids.length, 'uncertain question')}`;
  const bands = item.bands && typeof item.bands === 'object' ? item.bands : {};
  const parts = ['HIGH', 'MEDIUM', 'LOW'].filter((b) => Number(bands[b]) > 0).map((b) => `${b.toLowerCase()} ×${Number(bands[b])}`);
  return parts.length ? `Uncertain (${parts.join(', ')})` : 'Uncertain';
}

function appealWords(item) {
  const msg = String(item.appealMessage || '').trim();
  if (!msg) return 'Appealed';
  const shown = msg.length > APPEAL_MAX ? `${msg.slice(0, APPEAL_MAX - 1)}…` : msg;
  return `Appealed: "${shown}"`;
}

function reportWords(item) {
  const r = item.reports && typeof item.reports === 'object' ? item.reports : {};
  const count = Number(r.count) || 0;
  const byType = r.byType && typeof r.byType === 'object' ? r.byType : {};
  const types = Object.entries(byType).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).map(([t, n]) => `${t} (${Number(n)})`);
  return `Reported${count ? ` ×${count}` : ''}${types.length ? ` · ${types.join(', ')}` : ''}`;
}

export function whyLabel(item = {}) {
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const parts = [];
  if (reasons.includes('escalated')) parts.push(escalationWords(item));
  if (reasons.includes('appealed')) parts.push(appealWords(item));
  if (reasons.includes('reported')) parts.push(reportWords(item));
  if (reasons.includes('declared')) parts.push(`Declared: ${humanise(item.declaredNotice) || 'a content notice'}`);
  if (reasons.includes('images')) parts.push('Images');
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
