/**
 * HONESTY PINS FOR THE MARKETING COPY.
 *
 * Marketing copy drifts toward the product someone wishes they had. Each
 * rule here names a claim the shipped product cannot back, and where that
 * was established — so a future edit that reaches for a stronger-sounding
 * word has to walk past a named reason not to.
 *
 * WHAT GREEN MEANS: none of the strings this suite can see make one of the
 * listed false claims today. It CANNOT PROVE the copy is otherwise honest,
 * that a new false claim phrased differently is absent, or that anything
 * asserted here stays true as the product changes — only that the specific,
 * previously-identified failure modes below have not crept back in. A new
 * feature that makes an old banned claim TRUE (e.g. a native app ships)
 * means updating this file's rule, not just the copy.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/* Import every content module with `import * as`, so a new export is walked
 * automatically instead of requiring this file to be told its name. */
import * as homeModule from '../marketing/content/home';
import * as howItWorksModule from '../marketing/content/howItWorks';
import * as useCasesModule from '../marketing/content/useCases';
import * as reportsModule from '../marketing/content/reports';
import * as helpModule from '../marketing/content/help';
import * as clipsModule from '../marketing/content/clips';
import * as sampleReportModule from '../marketing/content/sampleReport';

const { HOME } = homeModule;
const { REPORTS_PAGE } = reportsModule;

const CONTENT_MODULES = {
  home: homeModule,
  howItWorks: howItWorksModule,
  useCases: useCasesModule,
  reports: reportsModule,
  help: helpModule,
  clips: clipsModule,
  sampleReport: sampleReportModule,
};

/** Walk every string reachable from every export of every content module. */
function walk(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, out));
}

const ALL_WORDS = [];
for (const mod of Object.values(CONTENT_MODULES)) {
  for (const exportValue of Object.values(mod)) walk(exportValue, ALL_WORDS);
}
const COPY = ALL_WORDS.join('\n');

/* The ClipStill drawings hold lifted UI text as JSX text nodes, not as
 * imported content — read as plain text and scanned the same way, per the
 * controller's instruction (there is no exported string table for these). */
const CLIP_STILL_TEXT = read('marketing', 'components', 'ClipStill.jsx');

test('the walk is not silently checking nothing', () => {
  // rejects: an import path renamed or a module returning {} — either would
  // make every rule below vacuously true.
  expect(ALL_WORDS.length).toBeGreaterThan(80);
  expect(COPY.length).toBeGreaterThan(2000);
});

/* Built from fragments, not written out whole: this file is itself scanned
 * by the twin guard (tests/no-retired-twin-references.js), so the phrases it
 * bans must never appear contiguous in source — even inside the pattern
 * built here to reject them from marketing prose. */
const BANNED_DEPLOY_CLAIM = [['deploys', 'nothing'], ['tags', 'only']]
  .map((w) => w.join(' '));
const BANNED_DEPLOY_RE = new RegExp(BANNED_DEPLOY_CLAIM.join('|'), 'i');

/* ------------------------------------------------------- straightforward
 * false claims: features, integrations and formats the product does not
 * have, checked against the whole copy walk AND the ClipStill drawings. */
const BANNED_CLAIMS = [
  ['a "favourites" feature — the report has votes, not favourites (create-report.js and GameReport.jsx carry no favourite field anywhere)', /favou?rite/i],
  ['real-time translation', /translat/i],
  ['integrations that do not exist', /\b(slack|teams integration|zapier|salesforce|jira)\b/i],
  ['spreadsheet export — the export is PDF', /\b(csv|excel|spreadsheet)\b/i],
  ['a native app — players use a browser', /\b(ios app|android app|app store|download the app)\b/i],
  ['compliance certifications nobody holds', /\b(soc ?2|iso ?27001|hipaa|gdpr.compliant)\b/i],
  ['unlimited anything', /\bunlimited\b/i],
  ['superlatives with no evidence', /\b(best.in.class|world.class|revolutionary|#1)\b/i],
  ['the banned deploy phrases leaking into marketing prose', BANNED_DEPLOY_RE],
];

describe.each(BANNED_CLAIMS)('no claim of %s', (_label, pattern) => {
  test('not present in the marketing copy walk', () => {
    expect(COPY).not.toMatch(pattern);
  });
  test('not present in the ClipStill drawings’ visible text', () => {
    expect(CLIP_STILL_TEXT).not.toMatch(pattern);
  });
});

/* --------------------------------------------------------------- AI rule --
 * The product drafts and summarises with AI; a person reviews and decides.
 * Rather than pin the exact sentence the original sketch assumed
 * (`HOME.material.lead`), which does not carry the review language in the
 * shipped copy, this checks BY MEANING: a human-review statement exists
 * somewhere in the home page's "your material" section, and the negative
 * pattern — AI as the decision-maker — never appears anywhere.
 */
test('AI is described as drafting and summarising, which a person reviews — never as deciding', () => {
  expect(COPY).not.toMatch(/\bAI (decides|chooses|picks|knows)\b/i);

  const materialWords = [];
  walk(HOME.material, materialWords);
  const materialCopy = materialWords.join('\n');
  // HOME.material.steps[2] is titled "You review and edit" and its text says
  // "Preview the set as a player will see it, change anything, drop
  // anything. Nothing runs until you start a session with it." — the
  // human-review statement this rule requires, found by meaning rather than
  // by a field name the shipped copy does not use.
  expect(materialCopy).toMatch(/\breview\b/i);
});

/* ---------------------------------------------------- the sample is fixture
 * data, and must say so. Scoped ONLY to reports.js and sampleReport.js: the
 * home page's summit section links to /reports rather than claiming realism
 * itself, and two OTHER pages use the word "real" for a usage claim the
 * owner vouches for, not a claim about the sample sheet:
 *   - howItWorks.js's CTA "See it in a real session" (linking to /use-cases)
 *   - useCases.js's h1 "Four sessions people actually run."
 * Neither is about the fixture on /reports or /home, so the rule below does
 * not scan those two files' copy.
 */
describe('the on-page sample report never claims to be a real session', () => {
  const reportsWords = [];
  walk(reportsModule.REPORTS_PAGE, reportsWords);
  walk(reportsModule.REPORT_CALLOUTS, reportsWords);
  walk(reportsModule.REPORT_SHARING, reportsWords);
  const reportsCopy = reportsWords.join('\n');

  const sampleReportWords = [];
  walk(sampleReportModule.SAMPLE_REPORT_HOME, sampleReportWords);
  walk(sampleReportModule.SAMPLE_REPORT, sampleReportWords);
  const sampleReportCopy = sampleReportWords.join('\n');

  const REAL_CLAIM = /\b(this is )?a real (one|report|session)\b/i;

  test('reports.js makes no such claim', () => {
    expect(reportsCopy).not.toMatch(REAL_CLAIM);
  });
  test('sampleReport.js makes no such claim', () => {
    expect(sampleReportCopy).not.toMatch(REAL_CLAIM);
  });
  test('REPORTS_PAGE.lead says so instead', () => {
    expect(REPORTS_PAGE.lead).toMatch(/sample from an invented session/i);
  });

  test('the two known, accepted usage claims elsewhere are unaffected (premise check)', () => {
    // Not a defect: both are the owner's vouched-for usage claims, not a
    // claim about the sample sheet's authenticity, which is why the rule
    // above is scoped away from these two files rather than written as a
    // blanket ban on the word "real".
    expect(howItWorksModule.HOW_PAGE.cta.secondary.label).toBe('See it in a real session');
    expect(useCasesModule.USE_CASES_PAGE.title).toBe('Four sessions people actually run.');
  });
});

/* ------------------------------------------------------- players need no
 * account, and that is true of /play (join by code, no sign-in). */
test('players needing no account is claimed somewhere in the copy', () => {
  expect(COPY).toMatch(/no account/i);
});
