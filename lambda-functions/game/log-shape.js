/**
 * WHAT A VALUE IS, NEVER WHAT IT SAYS — for a log line about content.
 *
 * An answer, a question's title or options, the host's brief and Workie's reply
 * are all encrypted at rest on an organisation's rows (tenant-crypto.js,
 * ENCRYPTED_FIELDS), and the handlers decrypt them because the prompt, the
 * scoring and the report need the words. A log line that then quoted them would
 * hand the same words to anyone who can read the log group — no key, no audit
 * trail. So a log line says what happened: that a field was there, its type
 * and size, whether it was still sealed. tests/ai-summary-content-not-logged.js
 * and tests/answer-content-not-logged.js hold the handlers to it.
 *
 * `correctAnswer` is not on the boundary, and is described here all the same:
 * many sets spell the right answer as the option's own TEXT, which an org's set
 * holds as ciphertext in optionA..F.
 */
function shapeForLog(value) {
  if (value === undefined || value === null || value === '') return 'absent';
  if (typeof value === 'string') return `${value.length} chars`;
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'object') {
    return typeof value.ct === 'string' && typeof value.iv === 'string' ? 'still sealed' : 'an object';
  }
  return `a ${typeof value}`;
}

module.exports = { shapeForLog };
