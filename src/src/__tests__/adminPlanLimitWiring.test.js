/**
 * AdminPage's plan-limit wiring, read from source — AdminPage cannot be mounted
 * in jsdom (useAuth hard-throws), which is why the screens it drives were
 * pulled out into panels. What stays here is the plumbing, and it is pinned as
 * text: every refusal the console can meet reaches the plan-limit notice, and
 * the notice's "Request the Team plan" lands on the request dialog.
 * (docs/design/tenancy-redesign/22-plan-limit-notice.html)
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'AdminPage.jsx'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('all three upload paths hand a 402 to the notice as a limit, not as text', () => {
  // rejects: the old "… Open Plan & usage to request the Team plan." string —
  // no link, and said to people who may not request.
  expect(code).not.toMatch(/Open Plan & usage to request the Team plan/);
  const limitNotices = code.match(/setNotice\(\{ limit, outcome: 'Nothing was saved\.', tone: 'error' \}\)/g) || [];
  expect(limitNotices).toHaveLength(3);
});

test('a refused copy is the notice too, and it says nothing was copied', () => {
  // rejects: a 402 from copy-question-set.js thrown as a plain error message
  const copy = code.slice(code.indexOf('const handleCopySet'), code.indexOf('const handleAppeal'));
  expect(copy).toMatch(/parseUpgradeRequired\(res, body\)/);
  expect(copy).toMatch(/setNotice\(\{ limit, outcome: 'Nothing was copied\.', tone: 'error' \}\)/);
});

test('the library shows what its own Copy said back', () => {
  // rejects: the library's Copy reporting only to the Question sets list,
  // which is not on show when you are in the library
  const lib = code.slice(code.indexOf('<PublicLibraryPanel'), code.indexOf('onCopy={handleCopySet}', code.indexOf('<PublicLibraryPanel')));
  expect(lib).toMatch(/notice=\{notice\}/);
  expect(lib).toMatch(/onDismissNotice=/);
});

test('?request=team opens the request dialog once, for somebody who may ask', () => {
  // rejects: a Request button that lands on Plan & usage with nothing open
  expect(code).toMatch(/wantsPlanRequest\(window\.location\.search\)/);
  expect(code).toMatch(/withoutPlanRequest\(window\.location\.href\)/);
  const effect = code.slice(code.indexOf('wantsPlanRequest(window.location.search)') - 400, code.indexOf('wantsPlanRequest(window.location.search)') + 600);
  expect(effect).toMatch(/resolvedTab !== 'billing'/);
  expect(effect).toMatch(/orgRole === 'owner' \|\| activeOrg\.type === 'personal'/);
  expect(effect).toMatch(/setShowPlanRequest\(true\)/);
});
