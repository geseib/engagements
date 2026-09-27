/**
 * utils/pollDraft.js — A POLL QUESTION IS A SURVEY QUESTION THE HOST ASKS.
 *
 * Two writers make a generated poll set's CSV: the worker's
 * (lambda-functions/admin/shared/generated-set.js `pollsToCsv`), when it
 * creates the draft set itself, and the browser's (`pollItemsToCsv`), when the
 * builder's "Load into System" or "Export CSV" has to. Two writers of one set
 * are two sets that differ by which path made them, so the first block holds
 * them byte-identical — the REAL server module, required here, with only the
 * AWS SDK stood in for, as pollCsvImportContract.test.jsx does for the
 * importer.
 */
import {
  POLL_KINDS, POLL_KIND_IDS, DEFAULT_POLL_KINDS,
  pollKindOf, pollKindLabel, pollItemsToCsv, pollItemProblem, pollSummary, pollMechanicInstruction,
} from '../utils/pollDraft';

// The AWS SDK is not installed under src/; generated-set.js and the job module
// it requires only construct command classes at call time.
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const command = class { constructor(input) { this.input = input; } };
  return { PutCommand: command, GetCommand: command, UpdateCommand: command };
}, { virtual: true });

const { pollsToCsv } = require('../../../lambda-functions/admin/shared/generated-set.js');
const { SURVEY_CSV_HEADER, POLL_KINDS: SERVER_POLL_KINDS } = require('../../../lambda-functions/admin/shared/survey-kinds.js');

/** Every kind, the awkward cells, two categories interleaved, and one item from before kinds. */
const ITEMS = [
  {
    kind: 'choice', title: 'Which "cadence" wins, all told?', category: 'Delivery', detail: 'Pick one, or two.',
    options: ['Weekly', 'Fort|nightly', 'Monthly'], allowMultiple: true, maxPicks: 2, allowOther: true, shuffle: false,
    tags: ['Delivery', 'release cadence'],
  },
  {
    kind: 'rating', title: 'How ready is the launch', category: 'Launch',
    scale: '1-5', lowLabel: 'Not ready', highLabel: 'Ready', tags: ['launch'],
  },
  {
    kind: 'yesno', title: 'Adopt the review rule', category: 'Delivery',
    yesLabel: 'Approve', noLabel: 'Decline', unsure: true, followUpWhen: '', tags: [],
  },
  {
    kind: 'text', title: 'One word for the quarter', category: 'Launch', school: 'Culture',
    textLength: 'short', maxLength: 280, placeholder: 'One word', themes: true, tags: ['mood'],
  },
  // An item from before kinds: options and allowMultiple, nothing else.
  { title: 'Where should we meet', options: ['Office', 'Remote'], allowMultiple: false, customInstructions: 'Pick one' },
];

describe('the browser writes exactly what the worker writes', () => {
  test('pollItemsToCsv and the server\'s pollsToCsv are byte-identical for the same items', () => {
    // rejects: either writer changing a column, a default, the grouping or the
    // quoting without the other — the set would differ by which path made it.
    expect(pollItemsToCsv(ITEMS)).toBe(pollsToCsv(ITEMS));
  });

  test('the header is the survey contract\'s, and every question keeps its own category', () => {
    const [header, ...rows] = pollItemsToCsv(ITEMS).trim().split('\n');
    expect(header).toBe(`${SURVEY_CSV_HEADER},Tags`);
    expect(rows.map((row) => row.split(',')[0])).toEqual(['"Delivery"', '"Delivery"', '"Launch"', '"Launch"', '"General"']);
    expect(rows.join('\n')).not.toMatch(/"Survey"/);
  });

  test('the four kinds are the contract\'s POLL_KINDS, in its order', () => {
    expect(POLL_KIND_IDS).toEqual([...SERVER_POLL_KINDS]);
    expect(DEFAULT_POLL_KINDS).toEqual(POLL_KIND_IDS);
    expect(POLL_KINDS.map((k) => k.label)).toEqual(['Pick from choices', 'Rate', 'Yes / No', 'Open answer']);
  });
});

describe('a poll\'s kind is read the way the server reads it', () => {
  test('its own kind; else two or more options make a choice; else an open answer', () => {
    expect(pollKindOf({ kind: 'yesno' })).toBe('yesno');
    expect(pollKindOf({ options: ['A', 'B'] })).toBe('choice');
    expect(pollKindOf({ options: ['A', ' '] })).toBe('text');
    expect(pollKindOf({})).toBe('text');
    expect(pollKindLabel({ kind: 'rating' })).toBe('Rate');
  });
});

describe('what would stop a poll importing, in the importer\'s words', () => {
  test('a choice needs two options; a ranking is not a poll; a valid poll has nothing to say', () => {
    expect(pollItemProblem({ kind: 'choice', title: 'Pick', options: ['Only'] })).toBe('needs at least two options');
    expect(pollItemProblem({ kind: 'rank', title: 'Order', options: ['A', 'B', 'C'] })).toBe('a poll can\'t be a rank question');
    expect(pollItemProblem({ kind: 'choice', title: '', options: ['A', 'B'] })).toBe('needs a title');
    ITEMS.forEach((item) => expect(pollItemProblem(item)).toBeNull());
  });
});

describe('the review line says what the room will see', () => {
  test.each([
    [ITEMS[0], 'Weekly · Fort|nightly · Monthly — pick up to 2 · + write-in'],
    [ITEMS[1], '1–5 · Not ready → Ready'],
    [ITEMS[2], 'Approve / Decline / Not sure'],
    [ITEMS[3], 'Short answer · up to 280 characters · “One word”'],
    [{ kind: 'choice', options: [] }, 'No options yet'],
  ])('%#', (item, line) => {
    expect(pollSummary(item)).toBe(line);
  });
});

describe('the set\'s participant instruction states how a poll of these kinds is answered', () => {
  test('one kind names its one action', () => {
    expect(pollMechanicInstruction(['rating']))
      .toBe('Answer each question as it comes up: rate it. The results appear on screen as the room answers.');
  });

  test('several are listed in the contract order, whatever order they were ticked in', () => {
    expect(pollMechanicInstruction(['yesno', 'choice']))
      .toBe('Answer each question as it comes up — pick an option or answer yes or no, as each one asks. '
        + 'The results appear on screen as the room answers.');
  });

  test('"select your preferred option(s)" is gone: it was wrong for three of the four kinds', () => {
    expect(pollMechanicInstruction(DEFAULT_POLL_KINDS)).not.toMatch(/preferred option/);
  });
});
