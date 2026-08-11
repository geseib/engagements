/**
 * Source assertions for the four AI builders and the poll client.
 *
 * Why source and not render: three of these four builders reach their review
 * step only through several minutes of configuration, and the property that
 * matters is a NEGATIVE one — that no branch anywhere re-derives "did it work?"
 * from how many items came back. A rendered test can show the good path; only
 * reading the file can show the bad one is absent from all four.
 *
 * Comments are stripped before every assertion. A previous agent's source test
 * in this repo passed on a comment, which is why podium.test.jsx carries the
 * same helper.
 */
import fs from 'fs';
import path from 'path';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')        // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const read = (...p) => stripComments(fs.readFileSync(src(...p), 'utf8'));

const BUILDERS = {
  'TriviaAIBuilder.jsx': 'generatedTrivia',
  'PollAIBuilder.jsx': 'generatedPolls',
  'SurveyAIBuilder.jsx': 'surveyQuestions',
  'AIScenarioBuilder.jsx': 'generatedScenarios',
};

describe('no builder decides the outcome from how many items came back', () => {
  for (const [file, list] of Object.entries(BUILDERS)) {
    test(`${file} branches on the interpreted outcome`, () => {
      // rejects: `) : generatedTrivia.length > 0 ? (` and its three siblings —
      // the exact expression that rendered the review table and a live "Load
      // into System" over a FAILED job, because failJob writes items and
      // status:'error' in the same UpdateCommand.
      const source = read('components', file);

      expect(source).toContain('interpretGenerationJob');
      expect(source).toMatch(/interpreted\.outcome === 'complete'/);
      // The ternary that used to pick the review UI, in any spacing.
      expect(source).not.toMatch(new RegExp(`${list}\\.length\\s*>\\s*0\\s*\\?`));
      expect(source).not.toMatch(/generatedSurvey\s*\?\s*\(/);
    });

    test(`${file} mounts the shared panel and the shared table`, () => {
      // rejects: replicating either screen per builder — four copies of the
      // same 200 lines is four places for the next fix to be applied three
      // times. G6's owner decision was explicit about sharing the table.
      const source = read('components', file);
      expect(source).toContain('<GenerationJobPanel');
      expect(source).toContain('<GeneratedItemsTable');
    });

    test(`${file} persists the job id and forgets it when the job is gone`, () => {
      // rejects: dropping G5.1. Without the stored id, closing the modal loses
      // the job forever and the client's own timeout copy — "reopen the builder
      // to check" — is impossible to act on.
      const source = read('components', file);
      expect(source).toContain('rememberGenerationJob');
      expect(source).toContain('recallGenerationJob');
      expect(source).toContain('forgetGenerationJob');
      expect(source).toContain('resumeIsGone');
    });
  }
});

describe('the survey builder does not claim to load anything', () => {
  const source = read('components', 'SurveyAIBuilder.jsx');

  test('nothing in it says "Load into System"', () => {
    // rejects: restoring the old label. O1, owner decision "label it".
    // `onSurveyGenerated` is AdminPage.handleSurveyGenerated, which builds a
    // Blob, clicks an anchor and reports "exported as JSON file". There is no
    // survey write path at all — upload-questions.js rejects survey outright —
    // so "Load into System" reported a success it never achieved.
    expect(source).not.toMatch(/Load into System/i);
  });

  test('its terminal action says Export JSON', () => {
    expect(source).toMatch(/Export JSON and close/);
  });

  test('and it says on screen that a survey set cannot be uploaded', () => {
    // rejects: silently renaming the button and leaving the operator to work
    // out why nothing appears in the question-set list.
    expect(source).toMatch(/cannot<\/b> be added to the/);
  });
});

describe('the client waits longer than the worker can run', () => {
  test('POLL_TIMEOUT_MS is past the generation Lambdas\' own ceiling', () => {
    // rejects: the shipped 10 * 60 * 1000. The worker is configured
    // `Timeout: 900` and only stops early when getRemainingTimeInMillis() says
    // it must, so the watcher used to give up on a job that was still
    // legitimately working — and then advise reopening a builder that stored
    // nothing. Also rejects raising the Lambda timeout in the template without
    // moving this constant with it.
    const client = read('utils', 'aiBatchClient.js');
    const match = client.match(/const POLL_TIMEOUT_MS\s*=\s*([^;]+);/);
    expect(match).toBeTruthy();
    // eslint-disable-next-line no-new-func
    const timeoutMs = Function(`"use strict"; return (${match[1]});`)();

    const template = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'template-clean.yaml'), 'utf8'
    );
    const workerSeconds = [...template.matchAll(
      /AdminAIGenerate[A-Za-z]*Function:[\s\S]*?Timeout:\s*(\d+)/g
    )].map((m) => Number(m[1]));

    expect(workerSeconds.length).toBeGreaterThan(0);
    expect(timeoutMs).toBeGreaterThan(Math.max(...workerSeconds) * 1000);
  });
});
