/**
 * THE JEST SETUP FILE LOADS SILENTLY, OR NOT AT ALL.
 *
 * `setupTests.js` once replaced `window.location` with a plain object. Under
 * jsdom 26 `location` is unforgeable: the delete was a no-op, the assignment
 * went through the real setter as a cross-document navigation, and jsdom
 * answered "Not implemented: navigation" on console.error — once per suite,
 * 350 times in one dev CodeBuild log. The mock itself never took, so every test
 * ran against the real Location and nothing noticed.
 *
 * setupTests.js now guards its own load: anything written to console.error
 * while it runs makes it throw, which fails every suite by name. These pin that
 * guard, against the real file, re-run in an isolated module registry.
 */

afterEach(() => {
  jest.dontMock('@testing-library/jest-dom');
  jest.restoreAllMocks();
});

const loadSetupAgain = () => jest.isolateModules(() => { require('../setupTests'); });

// rejects: any setup line that writes to console.error at load — the location
//          mock, or whatever replaces it next.
test('setupTests.js loads without writing to console.error', () => {
  expect(loadSetupAgain).not.toThrow();
});

// rejects: a guard installed below the imports, which would miss the first
//          thing the file loads; and a guard that only logs.
test('a console.error during load, even from the first import, fails the load', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.doMock('@testing-library/jest-dom', () => {
    console.error('Error: Not implemented: navigation (except hash changes)');
    return {};
  });
  expect(loadSetupAgain).toThrow(/console\.error.*Not implemented: navigation/s);
});

// rejects: a guard that leaves its wrapper in place, so a later
//          `jest.spyOn(console, 'error')` spies on the guard and not the console.
test('the guard hands console.error back, pass or fail', () => {
  const before = jest.spyOn(console, 'error').mockImplementation(() => {});
  loadSetupAgain();
  expect(console.error).toBe(before);

  jest.doMock('@testing-library/jest-dom', () => {
    console.error('boom');
    return {};
  });
  expect(loadSetupAgain).toThrow();
  expect(console.error).toBe(before);
});
