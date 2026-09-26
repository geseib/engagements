/**
 * THE WAIT BUDGET STAYS AT TESTING LIBRARY'S 1000ms, AND A SLOW WAIT IS FIXED
 * WHERE IT IS.
 *
 * This suite is a deploy gate (see jest.config.js), so the tempting answer to a
 * `findBy` that times out in CodeBuild is a suite-wide
 * `configure({ asyncUtilTimeout })` in setupTests.js, or a 5000ms passed to
 * every wait in the file that failed. Both were weighed on 2026-09-25, after
 * the dev build of 616c0bd1 went red on hostRemoteBrowser's "opens from This
 * round and lists the set", and both were rejected on measurement:
 *
 *   1. THAT FAILURE WAS NOT SLOW. The test tapped "Choose next question" before
 *      the session's first reply had enabled it, so the tap was swallowed and
 *      the list never opened. With the reply held back by 5ms the title is
 *      still missing after a 5000ms wait. No budget fixes a wait for something
 *      that is never going to happen; connect() now waits for the reply
 *      instead, and hostRemoteBrowser's late-reply test pins it.
 *
 *   2. NOTHING ON A MOCK NEEDS MORE THAN 1000ms. Every waitFor/findBy in the
 *      suite, timed (342 suites, 2,518 waits). At 3 workers, the shape
 *      CodeBuild runs (BUILD_GENERAL1_MEDIUM, 4 vCPU): p50 4.3ms, p99 54ms, and
 *      all fifteen waits over 100ms were on a REAL clock in the product — a
 *      retry backoff, a poll interval, a count-up — each now with its own
 *      explicit budget (surveyRunner, scoreCard, generationJobResume,
 *      oauthCallbackRoute, homePage). At 16 workers on 12 cores (load average
 *      37, far past CodeBuild): p99 323ms, and the worst wait on the default
 *      budget was 800ms, from contention alone — the answer to that is
 *      `--maxWorkers=3`, not a longer wait. The host-remote suites' waits, the
 *      ones 95875026 gave 5000ms each: never over 21ms at 3 workers.
 *
 *   3. A RAISE IS NOT FREE. Every genuine failure takes the whole budget to
 *      report. A deliberate miss (consolePersonas awaits a navigation that some
 *      personas never render) costs the whole budget on every pass, seven
 *      times a run today. And a wait that thrashes — the relabelled control
 *      re-queried inside waitFor that d2c2c084 fixed, ~1s a poll — runs five
 *      times longer before it says so, starving the rest of the worker pool
 *      while it does.
 *
 * So: a wait that genuinely needs more than a second is waiting on a real clock.
 * Give THAT call its own `{ timeout }`, under jest's 30000ms testTimeout, and
 * say which clock. A wait that times out on a mocked reply is a race or a bug —
 * measure it (time the wait, then check what the DOM held when it gave up)
 * before touching any number.
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '@testing-library/react';

describe('the async wait budget', () => {
  // Rejects: `configure({ asyncUtilTimeout: N })` in setupTests.js, or anywhere
  // else that runs before a suite. The header above is the evidence; a new
  // failure is a reason to measure, not to move this.
  it("is Testing Library's own default, for every suite", () => {
    expect(getConfig().asyncUtilTimeout).toBe(1000);
  });
});

/*
  EVERY SUITE THAT MOUNTS THE WHOLE REMOTE WAITS FOR ITS FIRST REPLY BEFORE IT
  TAPS. The 616c0bd1 failure lived in a connect() helper that five suites carry
  a copy of, and only one of them has a test that exercises a late reply. A new
  remote suite copies whichever connect() it finds, so this holds every copy.

  Rejects: a connect() that returns once the session-code box has gone.
*/
describe('connecting the host remote in a test', () => {
  const dir = __dirname;
  const suites = fs.readdirSync(dir)
    .filter((name) => /\.test\.jsx?$/.test(name))
    .map((name) => ({ name, src: fs.readFileSync(path.join(dir, name), 'utf8') }))
    .filter(({ src }) => /render\(\s*<HostRemote\b/.test(src));

  // Rejects: a scan that matches nothing and passes by default.
  it('finds the suites that mount the remote', () => {
    expect(suites.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'hostRemoteBrowser.test.jsx',
      'hostRemoteFailureCopy.test.jsx',
      'hostRemoteOrgScope.test.jsx',
      'hostRemoteScreen.test.jsx',
      'hostRemoteSession.test.jsx',
    ]));
  });

  it.each(suites.map(({ name }) => name))('%s waits for Live before it taps', (name) => {
    const { src } = suites.find((suite) => suite.name === name);
    const connect = src.match(/async function connect\(\)\s*\{([\s\S]*?)\n\}/);
    expect(connect).not.toBeNull();
    expect(connect[1]).toMatch(/toHaveTextContent\(\/\^Live\$\/\)/);
  });
});
