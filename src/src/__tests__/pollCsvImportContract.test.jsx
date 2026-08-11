/**
 * The poll CSV contract, verified against the REAL importer.
 *
 * These tests require lambda-functions/admin/upload-questions.js itself — the
 * actual Lambda handler — with only the AWS SDK stubbed out, and read the rows
 * it tries to write to DynamoDB. Nothing here asserts against a re-implemented
 * parser: the emitter's output is fed to the code that will actually consume it
 * in production.
 *
 * The bug this pins down: the poll generators emitted Option1..Option5, the
 * importer reads a single pipe-separated `Options` column and has no fallback,
 * so every AI-generated poll set imported with an empty options array. The last
 * test in this file reproduces that shape and shows it still imports empty —
 * without it, a passing suite would prove nothing about which shape is right.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PollAIBuilder from '../components/PollAIBuilder';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from '../utils/csv';
import { tagsToCsvCell } from '../utils/tags';

const TABLE_NAME = 'engage-test-table';

// The AWS SDK is not installed under src/; these virtual mocks stand in for it.
// The command classes only have to record their input — the handler and
// shared/set-version.js both construct them and hand them to db.send().
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

jest.mock('../utils/aiBatchClient', () => ({
  startGenerationJob: jest.fn(),
  pollGenerationJob: jest.fn(),
}));

const { startGenerationJob, pollGenerationJob } = require('../utils/aiBatchClient');

/**
 * Run a CSV through the real importer and return the question rows it wrote.
 * Throws with the handler's own error text if the import did not return 200.
 */
async function importCsv(csvText, { engagementType = 'poll', setTitle = 'Contract Set' } = {}) {
  process.env.TABLE_NAME = TABLE_NAME;
  const writtenItems = [];

  mockSend = (command) => {
    if (command.__kind === 'get') return Promise.resolve({}); // no set with this id yet
    if (command.__kind === 'query') return Promise.resolve({ Items: [] });
    if (command.__kind === 'batch') {
      for (const request of command.input.RequestItems[TABLE_NAME]) {
        writtenItems.push(request.PutRequest.Item);
      }
    }
    return Promise.resolve({});
  };

  jest.isolateModules(() => {});
  const { handler } = require('../../../lambda-functions/admin/upload-questions.js');

  const response = await handler({
    body: JSON.stringify({
      fileName: 'contract.csv',
      fileContent: csvText,
      customTitle: setTitle,
      engagementType,
      isAIGenerated: true,
    }),
  });

  if (response.statusCode !== 200) {
    throw new Error(`importer returned ${response.statusCode}: ${response.body}`);
  }

  return writtenItems.filter((item) => String(item.SK).startsWith('QUESTION#'));
}

/** The exact poll CSV the shipping emitters produce, for one poll. */
const pollCsv = (poll) => buildCsv(
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags',
  [csvRow([
    poll.category,
    1,
    poll.title,
    poll.detail || '',
    poll.school || 'General',
    poll.customInstructions || '',
    optionsToCsvCell(poll.options),
    allowMultipleToCsvCell(poll.allowMultiple),
    tagsToCsvCell(poll.tags),
  ])],
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('poll CSV → real upload-questions.js importer', () => {
  // Rejects: reverting the `Options` header back to Option1..Option5, or
  // dropping optionsToCsvCell's pipe join.
  test('options survive the import', async () => {
    const questions = await importCsv(pollCsv({
      category: 'Team',
      title: 'Where should we meet?',
      options: ['Office', 'Remote', 'Hybrid'],
      allowMultiple: true,
    }));

    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(['Office', 'Remote', 'Hybrid']);
    expect(questions[0].allowMultiple).toBe(true);
  });

  // Rejects: removing the `.filter(option => option !== '')` in
  // optionsToCsvCell, or restoring the emitters' pad-to-five loop — the
  // importer does not filter, so padding lands as empty options.
  test('blank option slots are not imported as empty options', async () => {
    const questions = await importCsv(pollCsv({
      category: 'Team',
      title: 'Pick one',
      options: ['Yes', '', 'No', '   ', undefined],
    }));

    expect(questions[0].options).toEqual(['Yes', 'No']);
  });

  // Rejects: reverting csvCell to bare `"${value}"` interpolation. Without the
  // doubling, the quote in the title ends the field and every later column
  // shifts — options land somewhere else entirely.
  test('quotes, commas and newlines in cell values do not shift columns', async () => {
    const questions = await importCsv(pollCsv({
      category: 'Team, Extended',
      title: 'THE "RIGHT" CALL',
      detail: 'Line one\nLine two, with a comma',
      options: ['He said "go"', 'Wait, then go'],
    }));

    expect(questions).toHaveLength(1);
    expect(questions[0].Title).toBe('THE "RIGHT" CALL');
    expect(questions[0].Category).toBe('Team, Extended');
    expect(questions[0].Detail).toBe('Line one\nLine two, with a comma');
    expect(questions[0].options).toEqual(['He said "go"', 'Wait, then go']);
  });

  // Rejects: removing the pipe folding in optionsToCsvCell. The importer splits
  // on `|` unconditionally, so an unfolded pipe silently becomes two options.
  test('a pipe inside an option does not split it in two', async () => {
    const questions = await importCsv(pollCsv({
      category: 'Team',
      title: 'Pick one',
      options: ['yes|no', 'maybe'],
    }));

    expect(questions[0].options).toEqual(['yes/no', 'maybe']);
  });

  // The bug, reproduced. Rejects any change that makes this file's other tests
  // pass for the wrong reason — if Option1..Option5 ever started importing,
  // these tests would no longer be evidence of anything.
  test('the old Option1..Option5 shape still imports with ZERO options', async () => {
    const legacyCsv = buildCsv(
      'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Option1,Option2,Option3,Option4,Option5,AllowMultiple,Tags',
      [csvRow(['Team', 1, 'Where should we meet?', '', 'General', '', 'Office', 'Remote', 'Hybrid', '', '', 'true', ''])],
    );

    const questions = await importCsv(legacyCsv);

    expect(questions[0].options).toEqual([]);
  });
});

describe('trivia CSV → real upload-questions.js importer', () => {
  // Rejects: reverting csvCell to bare `"${value}"`. A quote in the title ends
  // the field early, so every later column shifts and the row's correct answer
  // is read out of the wrong cell — a silently wrong trivia set, not an error.
  test('a quote in the title does not shift the answer columns', async () => {
    const csvText = buildCsv(
      'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags',
      [csvRow([
        'History',
        1,
        'Who said "I have a dream"?',
        'A speech, in 1963',
        'Delivered at the Lincoln Memorial',
        'General',
        'MLK', 'JFK', 'RFK', 'LBJ', '', '',
        'OptionA',
        'easy',
        tagsToCsvCell(['history', 'speeches']),
      ])],
    );

    const questions = await importCsv(csvText, { engagementType: 'trivia' });

    expect(questions).toHaveLength(1);
    expect(questions[0].Title).toBe('Who said "I have a dream"?');
    expect(questions[0].optionA).toBe('MLK');
    expect(questions[0].optionD).toBe('LBJ');
    expect(questions[0].correctAnswer).toBe('OptionA');
    expect(questions[0].difficulty).toBe('easy');
    expect(questions[0].Tags).toEqual(['history', 'speeches']);
  });
});

describe('PollAIBuilder Export CSV → real importer', () => {
  const POLLS = [{
    category: 'Team',
    title: 'Which "policy" wins, all things considered?',
    detail: 'Background, with a comma',
    school: 'General',
    options: ['Office first', 'Remote first', ''],
    allowMultiple: true,
    tags: ['remote-work', 'feedback'],
  }];

  /** Drive the real component to step 2, then capture the exported CSV text. */
  async function exportCsvFromBuilder() {
    startGenerationJob.mockResolvedValue({ jobId: 'job-1', status: 'queued', requested: POLLS.length });
    // The exact shape jobToResponse() sends — lambda-functions/admin/shared/
    // generation-jobs.js:178-192. `status` is load-bearing: the builder branches
    // on interpretGenerationJob(job).outcome, and a response with no status is
    // read as still-running, which is correct and is not a shape this API can
    // produce. A fixture missing it would be testing nothing real.
    pollGenerationJob.mockResolvedValue({
      jobId: 'job-1',
      status: 'complete',
      phase: `Generated ${POLLS.length} of ${POLLS.length}`,
      requested: POLLS.length,
      completed: POLLS.length,
      items: POLLS,
      warnings: [],
      meta: null,
      error: null,
      updatedAt: '2026-08-11T00:00:00.000Z',
    });

    // jsdom implements neither of these, so they are assigned rather than spied.
    window.URL.createObjectURL = () => 'blob:mock';
    window.URL.revokeObjectURL = () => {};
    // jsdom treats clicking an anchor with an href as a navigation.
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    // jsdom's Blob has no .text(), so the CSV is read off the constructor call.
    let captured = null;
    const RealBlob = window.Blob;
    window.Blob = class extends RealBlob {
      constructor(parts, options) {
        super(parts, options);
        captured = parts.join('');
      }
    };

    render(<PollAIBuilder onClose={() => {}} onPollGenerated={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Team Preferences/i), {
      target: { value: 'Meeting policy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate Poll Questions/i }));

    const exportButton = await screen.findByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportButton);

    await waitFor(() => expect(captured).not.toBeNull());
    window.Blob = RealBlob;
    return captured;
  }

  // Rejects: any change to PollAIBuilder.generatePollCSV that stops emitting the
  // `Options` column the importer reads — including a revert to Option1..Option5.
  test('a set exported from the builder imports with its options intact', async () => {
    const csvText = await exportCsvFromBuilder();

    expect(csvText).toContain(',Options,AllowMultiple,Tags');
    expect(csvText).not.toContain('Option1');

    const questions = await importCsv(csvText);

    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(['Office first', 'Remote first']);
    expect(questions[0].allowMultiple).toBe(true);
    expect(questions[0].Title).toBe('Which "policy" wins, all things considered?');
    expect(questions[0].Tags).toEqual(['remote-work', 'feedback']);
  });
});
