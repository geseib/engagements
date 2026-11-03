/**
 * THE SERVER'S CLOCK, as this browser measures it (experience plan 2f; the
 * round timer). A laptop's clock can be minutes out (the name takeover's
 * countdown once read a skewed 5:07), so time left is never worked out from
 * `Date.now()` alone: every state read and every frame carries the server's
 * `serverNow`, and this module keeps the offset between the two.
 *
 * A sample from an HTTP read knows its round trip (sent, received): the server
 * read its clock somewhere inside it, so the midpoint is the best guess and
 * half the round trip is the error. A frame knows no round trip; it counts as
 * an error of one second. The sample with the smallest error among the recent
 * ones wins, so one slow response cannot drag the clock.
 */
const KEEP = 8;
const FRAME_ERROR_MS = 1000;
let samples = [];

/** Record one reading of the server's clock. Ignores anything that is not a number. */
export function noteServerNow(serverNow, sentAt = null, receivedAt = Date.now()) {
  const server = Number(serverNow);
  if (!Number.isFinite(server) || server <= 0) return;
  const got = Number(receivedAt);
  if (!Number.isFinite(got)) return;
  const sent = Number(sentAt);
  const timed = Number.isFinite(sent) && sent > 0 && sent <= got;
  const local = timed ? (sent + got) / 2 : got;
  const error = timed ? (got - sent) / 2 : FRAME_ERROR_MS;
  samples = samples.concat({ offset: server - local, error }).slice(-KEEP);
}

/** Server time minus this browser's time, in ms; 0 before any reading. */
export function serverOffsetMs() {
  if (!samples.length) return 0;
  return samples.reduce((best, s) => (s.error < best.error ? s : best)).offset;
}

/** The server's time now, by this browser's measure. */
export function serverNowMs(localNow = Date.now()) {
  return localNow + serverOffsetMs();
}

/** Tests only. */
export function resetServerClock() {
  samples = [];
}
