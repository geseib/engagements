/**
 * PROOF, NOT ASSERTION, THAT THESE FOUR CSVs IMPORT.
 *
 * Neither half of this file hand-writes what the importer "should" do. It reads
 * each `quiz-*.csv` off disk and puts it through the two pieces of code that
 * will really run:
 *
 *   1. `src/src/utils/csvPreflight.js` — the browser-side report the console
 *      shows before the file is sent. It must report zero blocking problems,
 *      zero skipped rows and zero gaps.
 *   2. `lambda-functions/admin/upload-questions.js` — the actual Lambda handler,
 *      with only the AWS SDK stubbed, exactly as
 *      `src/src/__tests__/questionCategories.test.js` stubs it. The rows it
 *      TRIES to write are captured and asserted against.
 *
 * The assertion that matters most is the last one: every question's
 * `correctAnswer` must name an option column that is actually populated. A
 * trivia row whose CorrectAnswer points at an empty option is a broken round in
 * front of a room, and it imports with a cheerful 200.
 *
 * Run from the repo root:
 *   npx --prefix src jest --config demo-sets/quiz-verify-jest.config.js
 */

const fs = require('fs');
const path = require('path');

const DEMO_DIR = __dirname;
const TABLE_NAME = 'engage-verify-table';
const ENGAGEMENT_TYPE = 'trivia';

/** The four sets, and what each one claims to be. */
const SETS = [
  {
    file: 'quiz-1-knowledge-organization-foundations.csv',
    title: 'Intro to Ontology, Taxonomy, Glossary & Controlled Vocabulary',
    questions: 12,
    categories: ['Telling Them Apart', 'Glossary', 'Controlled Vocabulary', 'Taxonomy', 'Ontology'],
  },
  {
    file: 'quiz-2-genai-dev-eng-business.csv',
    title: 'GenAI From Three Angles: Development, Engineering, Business',
    questions: 12,
    categories: ['Development', 'Engineering', 'Business'],
  },
  {
    file: 'quiz-3-vocabulary-standards-and-failure-modes.csv',
    title: 'Running a Vocabulary: Standards and Failure Modes',
    questions: 5,
    categories: ['Standards', 'Failure Modes'],
  },
  {
    file: 'quiz-4-grounding-genai-rag.csv',
    title: 'Grounding GenAI: RAG and the Retrieval Layer',
    questions: 5,
    categories: ['How Retrieval Works', 'When It Goes Wrong'],
  },
];

/* -- the AWS stub, copied from questionCategories.test.js ------------------ */

let mockSend;

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const kinded = (kind) => class {
    constructor(input) {
      this.input = input;
      this.__kind = kind;
    }
  };
  return {
    DynamoDBDocumentClient: { from: () => ({ send: (command) => mockSend(command) }) },
    GetCommand: kinded('get'),
    QueryCommand: kinded('query'),
    BatchWriteCommand: kinded('batch'),
    UpdateCommand: kinded('update'),
  };
}, { virtual: true });

/** Import one CSV with the real handler; return the response and every row written. */
async function importCsv(fileContent, fileName, customTitle) {
  process.env.TABLE_NAME = TABLE_NAME;
  const written = [];

  mockSend = (command) => {
    if (command.__kind === 'get') return Promise.resolve({});
    if (command.__kind === 'query') return Promise.resolve({ Items: [] });
    if (command.__kind === 'batch') {
      for (const request of command.input.RequestItems[TABLE_NAME]) {
        written.push(request.PutRequest.Item);
      }
    }
    return Promise.resolve({});
  };

  // eslint-disable-next-line global-require
  const { handler } = require('../lambda-functions/admin/upload-questions.js');
  const response = await handler({
    body: JSON.stringify({
      fileName,
      fileContent,
      customTitle,
      engagementType: ENGAGEMENT_TYPE,
      // roundKind is deliberately NOT sent. `roundKindApplies` is
      // ['call-and-answer','poll'] only — see shared/round-kinds.js — so a
      // direction on a trivia set would be stored and mean nothing.
    }),
  });

  return { response, body: JSON.parse(response.body), written };
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const VALID_DIFFICULTY = ['easy', 'medium', 'hard'];
const MAX_MASKABLE_CATEGORIES = 24;

/** Collected for the summary table printed at the end of the run. */
const report = [];

describe('the four quiz demo sets survive the real preflight and the real importer', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(SETS)('$file', (set) => {
    const text = fs.readFileSync(path.join(DEMO_DIR, set.file), 'utf8');

    // rejects: a file that the console would refuse, skip rows from, or import
    // with something silently missing. All three tiers must be empty — this is
    // the same report an operator sees before pressing Upload.
    test('preflight reports no blocking problems, no skipped rows and no gaps', async () => {
      // csvPreflight is ESM under src/, so it is imported rather than required.
      const { preflight } = await import('../src/src/utils/csvPreflight.js');
      const pf = preflight(text, ENGAGEMENT_TYPE, { fileName: set.file });

      expect(pf.blocking).toEqual([]);
      expect(pf.skipped).toEqual([]);
      expect(pf.gaps).toEqual([]);
      expect(pf.ok).toBe(true);
      expect(pf.dataRowCount).toBe(set.questions);
      expect(pf.importedCount).toBe(set.questions);
      expect(pf.categories).toEqual(set.categories);
    });

    // rejects: any row the handler would drop, any category that folds into
    // another, and any drift between the count the file claims and the count
    // the backend would store.
    test('the real handler accepts every row and produces the intended categories', async () => {
      const { response, body, written } = await importCsv(text, set.file, set.title);

      expect(response.statusCode).toBe(200);
      expect(body.questionCount).toBe(set.questions);
      expect(body.skippedRowCount).toBe(0);
      expect(body.skippedRows).toEqual([]);
      expect(body.categoryCount).toBe(set.categories.length);
      expect(body.categoryCount).toBeLessThanOrEqual(MAX_MASKABLE_CATEGORIES);

      const categoryRows = written.filter((i) => String(i.SK).startsWith('CATEGORY#'));
      expect(categoryRows.map((c) => c.Name)).toEqual(set.categories);

      const questionRows = written.filter((i) => String(i.SK).startsWith('QUESTION#'));
      expect(questionRows).toHaveLength(set.questions);

      const counted = categoryRows.reduce((n, c) => n + c.QuestionCount, 0);
      expect(counted).toBe(set.questions);
    });

    /*
      THE ONE THAT MATTERS MOST.

      `upload-questions.js` stores CorrectAnswer verbatim — it validates
      nothing. The value has to be the literal token `OptionA`..`OptionF`,
      because `websocket/message.js:419` scores with
      `correctAnswer === 'Option' + answer`. Anything else, including the
      answer TEXT, imports with a 200 and scores nobody.

      And naming a valid token is not enough: the column it names has to hold
      something. `OptionD` pointing at an empty optionD is a question with no
      right answer on screen.
    */
    test('every question has a valid CorrectAnswer pointing at a non-empty option', async () => {
      const { written } = await importCsv(text, set.file, set.title);
      const questionRows = written.filter((i) => String(i.SK).startsWith('QUESTION#'));

      const distribution = {};
      const difficulties = {};

      for (const q of questionRows) {
        expect(typeof q.correctAnswer).toBe('string');
        expect(OPTION_LETTERS.map((l) => `Option${l}`)).toContain(q.correctAnswer);

        const letter = q.correctAnswer.replace('Option', '');
        const target = q[`option${letter}`];
        expect(typeof target).toBe('string');
        expect(target.trim().length).toBeGreaterThan(0);

        // Four populated options, E and F deliberately unused.
        const populated = OPTION_LETTERS.filter((l) => (q[`option${l}`] || '').trim().length > 0);
        expect(populated).toEqual(['A', 'B', 'C', 'D']);

        // No duplicate option text — two identical choices make two right answers.
        const texts = populated.map((l) => q[`option${l}`].trim().toLowerCase());
        expect(new Set(texts).size).toBe(texts.length);

        // The reveal must have survived the import. AnswerDetails is written
        // only when non-empty, and it is the only field carrying "why".
        expect(typeof q.AnswerDetails).toBe('string');
        expect(q.AnswerDetails.trim().length).toBeGreaterThan(80);

        // Shown during ASK, so it must be there and must not give the game away.
        expect(q.Detail.trim().length).toBeGreaterThan(0);

        expect(VALID_DIFFICULTY).toContain(q.difficulty);

        // roundKind does not apply to trivia; nothing may have set one.
        expect(q.RoundKind).toBeUndefined();

        distribution[q.correctAnswer] = (distribution[q.correctAnswer] || 0) + 1;
        difficulties[q.difficulty] = (difficulties[q.difficulty] || 0) + 1;
      }

      report.push({
        file: set.file,
        questions: questionRows.length,
        categories: set.categories.length,
        distribution,
        difficulties,
      });
    });
  });

  afterAll(() => {
    if (!report.length) return;
    // Printed, not asserted: an even-ish spread of correct answers across the
    // four letters is a quality signal, not a rule. A set where every answer is
    // OptionB is guessable, and this is how you notice.
    /* eslint-disable no-console */
    console.info('\n--- correct-answer spread per set ---');
    for (const r of report) {
      console.info(
        `${r.file}: ${r.questions} questions, ${r.categories} categories, `
        + `answers ${JSON.stringify(r.distribution)}, difficulty ${JSON.stringify(r.difficulties)}`
      );
    }
    /* eslint-enable no-console */
  });
});
