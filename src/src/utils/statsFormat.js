/**
 * How the stats screens print a month, a date and a count — one place, read by
 * ObservabilityPanel.jsx, UsageStatsPanel.jsx and StaffStatsDrill.jsx.
 * Months are parsed, never handed to Date, so no time zone can move one.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const NONE = '—';

/** `2026-09` -> `September 2026`. Parsed, never handed to Date: no zone can move it. */
export function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return String(period || '');
  return `${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** An ISO instant -> `23 September 2026`, in UTC, for the reason sinceLabel gives. */
export function dateLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** An ISO instant -> `14 Nov 2026, 10:42 UTC`. */
export function asOfLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** 4076 -> `4,076`; anything that is not a number is a dash, never a 0. */
export function countLabel(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-GB') : NONE;
}

