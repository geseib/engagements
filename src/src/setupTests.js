/*
  THIS FILE MUST LOAD WITHOUT WRITING TO console.error.

  It runs before every suite, so one noisy line here is hundreds of lines in a
  CodeBuild log, and noise that repeats is noise nobody reads. It also hid a
  mock that never worked: this file used to replace `window.location`, jsdom 26
  refused (the property is unforgeable), and the only trace was a
  "Not implemented: navigation" error per suite.

  So the load is watched and a write fails it. The guard goes first and jest-dom
  is `require`d rather than imported: an import is hoisted above everything in
  the file, and would load unwatched. `__tests__/setupTestsLoad.test.js` pins
  all of this.
*/
const consoleError = console.error;
const loadErrors = [];
console.error = (...args) => {
  loadErrors.push(args);
  consoleError.apply(console, args);
};

require('@testing-library/jest-dom');

// Mock window.API_BASE and other global variables
global.window.API_BASE = 'http://localhost:3000/api/';
global.window.WS_URL = 'ws://localhost:3001';
global.window.ENV = 'test';

// Mock fetch
global.fetch = jest.fn();

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
  close: jest.fn(),
  send: jest.fn(),
  readyState: 1,
  OPEN: 1,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

// Mock html2pdf
jest.mock('html2pdf.js', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock QRCodeSVG
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }) => `<div data-testid="qr-code" data-value="${value}" data-size="${size}">QR Code</div>`,
}));

/*
  NO window.location MOCK, AND THERE CANNOT BE ONE. jsdom's Location is
  unforgeable: it cannot be deleted, redefined or spied on, and neither can its
  assign/replace/reload. Every suite gets the real one, at http://localhost/.
  - To put a test at a URL: `window.history.pushState({}, '', '/path?x=1')`,
    or `@jest-environment-options {"url": "..."}` in the file's docblock.
  - To see where code sends the browser: route it through `auth/navigate.js`
    and mock that. Assigning `location.href` is a navigation jsdom does not
    implement; it changes nothing a test can read.
  Suites that move the URL with pushState and read it back off `location`
  depend on the real object — a plain-object stand-in would break them.
*/

console.error = consoleError;
if (loadErrors.length > 0) {
  throw new Error(
    `setupTests.js wrote to console.error ${loadErrors.length} time(s) while loading, `
    + 'and it runs before every suite. First: '
    + loadErrors[0].map(String).join(' '),
  );
}
