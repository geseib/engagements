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

describe('the page does not create a set the worker already created', () => {
  /**
   * Source, and it has to be. AdminPage.jsx cannot render in jsdom — see
   * docs/handoff/RESUME.md, Landmines, and the pre-existing AdminPage.test.jsx
   * failures — so the only way to assert that its three AI handlers return
   * BEFORE their POST is to read them.
   */
  const source = read('AdminPage.jsx');

  // handleSurveyGenerated joined the list in the Phase 0 fixes (Surveys
  // phases 0+1, fix 2): it used to build a Blob and click an anchor — a JSON
  // download, with no set anywhere — and the survey worker now creates a
  // draft set like the other three.
  // The upload itself is utils/generatedSetUpload.js since the host shelf
  // began sharing it; each handler hands its builder's kind to that path.
  const HANDLERS = {
    handleScenariosGenerated: 'scenario',
    handleTriviaGenerated: 'trivia',
    handlePollGenerated: 'poll',
    handleSurveyGenerated: 'survey',
  };
  for (const [handler, kind] of Object.entries(HANDLERS)) {
    test(`${handler} returns on createdSet without uploading`, () => {
      // rejects: leaving the old unconditional POST in place. The worker now
      // creates the set before the job goes terminal, so this path would send
      // the same questions to /admin/upload-questions a second time — the
      // importer refuses to overwrite an existing set, and the operator would
      // be shown "already exists" over a set that is sitting in the list.
      const body = source.split(`const ${handler} = async`)[1].split('\n  };\n')[0];
      expect(body).toBeTruthy();
      const guard = body.indexOf('createdSet?.setId');
      const upload = body.indexOf(`uploadBuilderResult('${kind}'`);
      expect(guard).toBeGreaterThan(-1);
      expect(upload).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(upload);
      // The early return has to be inside the guard, before the upload.
      expect(body.slice(guard, upload)).toMatch(/return;/);
    });
  }

  test('the four handlers upload through the one shared path', () => {
    // rejects: a handler growing its own POST or CSV writer again. There were
    // four handlers and three CSV writers here, the host shelf could reach
    // none of them, and so the shelf saved nothing on this path.
    const upload = source.split('const uploadBuilderResult = async')[1];
    expect(upload).toBeTruthy();
    expect(upload.split('\n  };\n')[0]).toMatch(/uploadGeneratedSet\(kind, data, options\)/);
    expect(source).not.toMatch(/admin\/upload-questions/);
    expect(source).not.toMatch(/generateTriviaCSV|generatePollCSV|generateScenariosCSV|surveyItemsToCsv/);
  });
});

describe('the host shelf uploads through the same path', () => {
  test('HostQuestionSetsDialog has no upload of its own', () => {
    // The behaviour is rendered in hostShelfBuilderFallback.test.jsx; this is
    // the anti-copy half. rejects: a second writer of the builders' CSV.
    const host = read('components', 'HostQuestionSetsDialog.jsx');
    expect(host).toMatch(/uploadGeneratedSet\(kind, result/);
    expect(host).not.toMatch(/admin\/upload-questions/);
  });
});

describe('every whole-set builder promises a set gets made — survey included now', () => {
  test('all four builders pass createsSet to the panel', () => {
    // rejects: shipping server-side creation without the copy that tells
    // anyone. The report is that "Close — this keeps running" was believed and
    // produced nothing; the panel has to say what actually happens now. The
    // survey worker joined the other three (A5's setCreation), so its panel
    // makes the same promise — withholding it would now be the untruth.
    for (const file of ['AIScenarioBuilder.jsx', 'TriviaAIBuilder.jsx', 'PollAIBuilder.jsx', 'SurveyAIBuilder.jsx']) {
      expect(read('components', file)).toMatch(/<GenerationJobPanel[\s\S]{0,400}?createsSet/);
    }
  });
});

describe('the survey builder is a draft-set builder, not an exporter', () => {
  const source = read('components', 'SurveyAIBuilder.jsx');

  test('the three dead include* checkboxes are gone, and the kinds travel as `kinds`', () => {
    // THE PHASE 0 FIX, pinned where it happened. rejects: the key template
    // that built `includeMultiplechoice` against state named
    // `includeMultipleChoice`, so two of three boxes did nothing.
    expect(source).not.toMatch(/include\$\{/);
    expect(source).not.toMatch(/includeMultipleChoice|includeTextEntry|includeRating/);
    expect(source).toMatch(/\bkinds,/);
  });

  test('nothing in it exports JSON any more', () => {
    // rejects: "Export JSON and close". The worker creates the draft set, and
    // a survey JSON file was never something the library could read back
    // until the importer learned to (Track A, A2).
    expect(source).not.toMatch(/Export JSON/i);
    expect(source).not.toMatch(/application\/json/);
  });

  test('it opens the set the worker made, and hands over questions only when there is none', () => {
    expect(source).toMatch(/onSurveyGenerated\(\{ createdSet: interpreted\.createdSet \}\)/);
    expect(source).toMatch(/onSurveyGenerated\(\{ questions: keptItems, metadata:/);
  });

  test('the host dialog routes it through the same finishBuilder as the other three', () => {
    // THE PHASE 0 FIX, host half. rejects: `onSurveyGenerated={() =>
    // setBuilder(null)}`, which closed the builder and re-read nothing — the
    // draft the worker had just made never opened.
    const host = read('components', 'HostQuestionSetsDialog.jsx');
    expect(host).toMatch(/<SurveyAIBuilder[\s\S]{0,120}?onSurveyGenerated=\{finishBuilder\}/);
  });

  test('the page makes the manual-path set from the survey CSV contract', () => {
    // The fallback, when the worker could not create the set: the same
    // upload the trivia and poll handlers make, as the survey kind — not a
    // Blob. The kind's CSV is rowsToCsv's survey branch (utils/surveyDraft.js),
    // typed survey; generatedSetUpload.test.js pins both.
    const page = read('AdminPage.jsx');
    const body = page.split('const handleSurveyGenerated = async')[1].split('\n  };\n')[0];
    expect(body).toMatch(/uploadBuilderResult\('survey', surveyData\)/);
    expect(body).not.toMatch(/new Blob/);
    const helper = read('utils', 'generatedSetUpload.js');
    expect(helper).toMatch(/survey: \{[\s\S]*?toCsv: surveyItemsToCsv, type: 'survey'/);
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
