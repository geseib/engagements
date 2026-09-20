module.exports = {
  testEnvironment: 'jsdom',
  // A WALL-CLOCK BUDGET SIZED FOR THE MACHINE THIS SUITE RUNS ON.
  //
  // This suite is a DEPLOY GATE, not just a local one: buildspec-dev.yml,
  // buildspec-test.yml and buildspec-prod.yml each run `npm run lint`,
  // `npm test` and `npm run build` before syncing dist/ to S3, and
  // cicd/pipeline-clean.yaml points every tier's CodeBuild project at its
  // buildspec. (Read from the repo — the live projects could not be checked
  // from here, and CLAUDE.md warns the running pipeline can differ from the
  // template.) f68b31b5 was reported as deployed and was not: one test took the
  // whole dev build down. A test that goes red on contention rather than on
  // behaviour fails a deploy, and locally it trains whoever is gating a merge
  // to re-run until green, which is how a real regression gets waved through.
  // So this number has one job: fire for a HUNG test and never for a slow one.
  //
  // IT ALSO HAS TO CLEAR THE LONGEST waitFor IN THE SUITE. questionSetDetailsAi
  // gives its draftIt() wait 8000ms, because coming back enabled can cost a
  // real 2000ms poll cycle (06d65c10). Under jest's 5000ms default that inner
  // budget was UNREACHABLE — jest killed the test first, so the 8000ms never
  // meant anything. Any testTimeout set here must stay above the largest
  // waitFor budget in the suite or it silently overrides it.
  //
  // MEASURED 2026-09-20 on the dev laptop, over 22 full suite runs at load
  // average 17-112, several agent workflows running alongside. In this suite
  // (248 suites, 6,070 tests) the two slowest tests under this budget are
  // scoreCard's "a re-check asks for nothing but the version on the card" and
  // questionSetDetailsAi's "says how many of the set's questions were sent".
  // The latter's real cost is ~380ms — it renders 60 list items, the cap the
  // feature enforces, which cannot be shrunk without deleting the assertion —
  // and its wasteful queries have already been fixed (see the draftIt() comment
  // in that file). It still measured, on identical work:
  //
  //     827   846   908  1535  3563  4259        (ms, this suite)
  //     715  1005  1924  4556  7919  8230        (ms, smaller suite, load 112)
  //
  // A 10x spread from contention alone, peaking at 8230ms. Which test is
  // slowest changes from run to run, so this is not one test's problem to
  // solve.
  //
  // 30s is ~3.6x the worst observed and ~3.7x the longest waitFor budget it has
  // to clear. It tolerates roughly 79x inflation of that test's true cost,
  // which no merely-slow test reaches, and still reports a genuinely hung one
  // well inside a normal 30-45s suite run — in CodeBuild, on an uncontended
  // container, nothing should come near it.
  //
  // THIS IS HEADROOM, NOT A LICENCE. A new test that needs anywhere near this
  // much time is doing something wrong: measure it with
  // `npm test -- <file> --json --outputFile=/tmp/t.json` and fix the cause.
  // Tests that declare their own timeout keep it — generationJobResume.test.jsx
  // sets 30000 for the one that waits out four real 2s poll intervals.
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  // was `moduleNameMapping` — not a real Jest option, so CSS imports were
  // never stubbed and every component suite blew up on `import './x.css'`
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(js|jsx)',
    '<rootDir>/src/**/*.(test|spec).(js|jsx)'
  ],
  collectCoverageFrom: [
    'src/**/*.(js|jsx)',
    '!src/index.jsx',
    '!src/setupTests.js'
  ],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/'],
  // d3 (via WavelengthWordCloud) and internmap ship ESM only, so they have to
  // go through babel rather than being skipped with the rest of node_modules.
  transformIgnorePatterns: [
    '/node_modules/(?!(d3|d3-[^/]+|internmap|delaunator|robust-predicates)/)',
  ],
};
