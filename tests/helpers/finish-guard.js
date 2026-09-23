/**
 * Turns "the suite never reached its end" into exit code 1.
 *
 * WHY. Most suites here are `(async () => { ...checks...; process.exit(fail ? 1 : 0); })();`.
 * If one awaited promise never settles, Node does not hang: nothing is left on
 * the event loop, so it drains and exits with code 0 WITHOUT printing the
 * summary. The backend gate judges by exit code only, so that suite reads as
 * green. Seen 2026-09-23: a race test in tests/name-handover.js awaited
 * `table.hold(...).reached` for an update the handler never issued (it had
 * already answered 404), printed four FAIL lines, and exited 0.
 *
 * HOW. 'beforeExit' fires only when the event loop empties on its own. An
 * explicit process.exit() skips it, and so does an uncaught throw — so it fires
 * exactly when a suite ran out of work without saying it was done. At that
 * moment nothing can ever settle the pending promise, so the verdict is
 * deterministic: no timeout to tune, nothing that flakes under machine load.
 *
 * USE. Requiring this arms it; call the export where the suite finishes, just
 * before its final process.exit / summary:
 *
 *   const suiteFinished = require('./helpers/finish-guard');
 *   ...
 *   suiteFinished();
 *   process.exit(fail ? 1 : 0);
 *
 * One guard per process (Node caches the module), so a suite and the harness it
 * uses share it — either one marking it done is enough. The harnesses in this
 * directory mark it from their own summary()/finish().
 */
const path = require('path');

// Bound now, because several suites mute console.log (and some stdout) for the
// run; the one line that explains a silent red exit must still get out.
const writeErr = process.stderr.write.bind(process.stderr);

let finished = false;

process.on('beforeExit', () => {
  if (finished) return;
  writeErr(
    `\n${path.basename(process.argv[1] || 'suite')}: SUITE DID NOT FINISH — the event loop ` +
    'emptied while an awaited promise was still pending, so nothing could ever settle it.\n' +
    'Exiting 1. Look for an await on a latch, stub or event the code under test never triggered.\n'
  );
  process.exitCode = 1;
});

module.exports = function suiteFinished() {
  finished = true;
};
