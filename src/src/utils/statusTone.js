/**
 * Classify a user-facing status string as success / error / pending.
 *
 * The admin and upload panels used to do this by sniffing the message for a ✅
 * or ❌ that the copy happened to contain — which meant the styling silently
 * broke the moment anyone reworded a message (or removed the emoji). This reads
 * the words instead, and every branch is visible in one place.
 *
 * Returns '' for an empty status so callers can render nothing.
 */

// "Upload failed", "Error: …", "Invalid file type", "Please select a file first"
const ERROR_RE = /\b(fail(ed|s|ure)?|error|invalid|unable|denied|not supported|not yet supported|too large|required|missing|please (select|enter|fill))\b/i;

// "Processing…", "Reading file…", "Saving...", anything still in flight
const PENDING_RE = /(\.\.\.|…)\s*$|^\s*(processing|reading|downloading|uploading|saving|deleting|generating|loading)\b/i;

export function statusTone(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';
  if (ERROR_RE.test(text)) return 'error';
  if (PENDING_RE.test(text)) return 'pending';
  return 'success';
}

/** Phosphor icon name matching a tone, for the status chip. */
export function statusIcon(tone) {
  if (tone === 'error') return 'XCircle';
  if (tone === 'pending') return 'Timer';
  if (tone === 'success') return 'CheckCircle';
  return null;
}

/** CSS colour token matching a tone. */
export function statusColor(tone) {
  if (tone === 'error') return 'var(--danger)';
  if (tone === 'pending') return 'var(--muted)';
  return 'var(--success)';
}

export default statusTone;
