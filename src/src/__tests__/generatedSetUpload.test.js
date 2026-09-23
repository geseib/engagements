/**
 * utils/generatedSetUpload.js — THE ONE "upload what the builder made" PATH.
 *
 * When the generation worker could not create the draft set itself, the four
 * AI builders hand their page the kept questions and the page uploads them
 * through /admin/upload-questions. The console (AdminPage) and the host shelf
 * (HostQuestionSetsDialog) both do that now, through this module. It used to be
 * four handlers and three CSV writers inside AdminPage, which the shelf could
 * not reach, so the shelf saved nothing.
 *
 * AdminPage cannot be mounted in jsdom (useAuth hard-throws), so this file pins
 * the console's half: the CSV each kind writes, the body it sends, and the
 * notice each answer becomes. The shelf's half is rendered in
 * hostShelfBuilderFallback.test.jsx.
 *
 * The CSV expectations below are what AdminPage's generateTriviaCSV,
 * generatePollCSV and generateScenariosCSV produced before they moved here.
 * They are the importer's wire format (lambda-functions/admin/upload-questions
 * .js), so a byte that changes here changes what a set imports as.
 */
import {
  generatedSetCsv,
  generatedSetUploadBody,
  generatedSetPendingNotice,
  uploadGeneratedSet,
} from '../utils/generatedSetUpload';
import { surveyItemsToCsv } from '../utils/surveyDraft';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const NOW = 1700000000000;

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('the CSV each kind writes', () => {
  test('trivia: category-relative numbering, every option column, a multi-answer joined by commas', () => {
    const csv = generatedSetCsv('trivia', [
      { title: 'RED PLANET', questionDetail: 'Which is red?', answerDetails: 'Iron.', category: 'Space', optionA: 'Mars', optionB: 'Venus', correctAnswer: 'OptionA', difficulty: 'easy', tags: ['space'] },
      { title: 'RINGS', detail: 'Which have rings?', category: 'Space', optionA: 'Saturn', optionB: 'Uranus', correctAnswer: ['OptionA', 'OptionB'], difficulty: 'hard', school: 'Astronomy' },
      { title: 'CAPITAL', questionDetail: 'Capital of France?', optionA: 'Paris', correctAnswer: 'OptionA', difficulty: 'easy' },
    ]);
    expect(csv.split('\n')).toEqual([
      'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags',
      '"Space","1","RED PLANET","Which is red?","Iron.","General","Mars","Venus","","","","","OptionA","easy","space"',
      '"Space","2","RINGS","Which have rings?","","Astronomy","Saturn","Uranus","","","","","OptionA,OptionB","hard",""',
      '"General","1","CAPITAL","Capital of France?","","General","Paris","","","","","","OptionA","easy",""',
    ]);
  });

  test('poll: ONE pipe-separated Options column and AllowMultiple as true/false', () => {
    // rejects: Option1..Option5, which the importer does not read. Every
    // AI-generated poll set once imported with zero options that way.
    const csv = generatedSetCsv('poll', [
      { title: 'LUNCH', detail: 'Where?', category: 'Team', options: ['Tacos', 'Pho', ''], allowMultiple: true, tags: ['food'] },
      { title: 'WHEN', options: ['Noon'], customInstructions: 'Pick one' },
    ]);
    expect(csv.split('\n')).toEqual([
      'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags',
      '"Team","1","LUNCH","Where?","General","","Tacos|Pho","true","food"',
      '"General","1","WHEN","","General","Pick one","Noon","false",""',
    ]);
  });

  test('scenario: filed under AI Generated and Professional Development by default', () => {
    const csv = generatedSetCsv('scenario', [
      { title: 'THE LATE DELIVERY', detail: 'A supplier slips.', category: 'Ops', tags: ['supply'] },
      { title: 'THE "RIGHT" CALL', detail: 'Quotes survive.', customInstructions: 'Be brief' },
    ]);
    expect(csv.split('\n')).toEqual([
      'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags',
      '"Ops","1","THE LATE DELIVERY","A supplier slips.","Professional Development","","supply"',
      '"AI Generated","1","THE ""RIGHT"" CALL","Quotes survive.","Professional Development","Be brief",""',
    ]);
  });

  test('survey: the survey branch of the one CSV contract, not a writer of its own', () => {
    const items = [
      { kind: 'rating', title: 'How useful was it?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['feedback'] },
      { kind: 'choice', title: 'Which part?', required: false, options: ['Demo', 'Stories'], tags: [] },
    ];
    expect(generatedSetCsv('survey', items)).toBe(surveyItemsToCsv(items));
  });
});

describe('the body each kind sends', () => {
  const metadata = {
    title: 'Space Quiz!', description: 'Planets', customInstructions: 'Pick one', aiContextInstructions: 'Say who knew',
  };

  test('scenario: the caller\'s format, the round direction, the set instructions', () => {
    const body = generatedSetUploadBody('scenario', {
      scenarios: [{ title: 'A', detail: 'B' }], metadata, roundKind: 'apply', roundKindBrief: 'Monday',
    }, { engagementType: 'wavelength', now: NOW });
    expect(body).toEqual({
      fileName: `Space_Quiz_-${NOW}.csv`,
      fileContent: generatedSetCsv('scenario', [{ title: 'A', detail: 'B' }]),
      customTitle: 'Space Quiz!',
      customDescription: 'Planets',
      customInstructions: 'Pick one',
      aiContextInstructions: 'Say who knew',
      engagementType: 'wavelength',
      roundKind: 'apply',
      roundKindBrief: 'Monday',
      isAIGenerated: true,
    });
  });

  test('scenario with no format given is call-and-answer', () => {
    const body = generatedSetUploadBody('scenario', { scenarios: [], metadata }, { now: NOW });
    expect(body.engagementType).toBe('call-and-answer');
  });

  test('an unset direction is OMITTED, not sent empty', () => {
    // rejects: `roundKind: roundKind || ''`. upload-questions.js stores the
    // attribute only when non-empty, so a set that was never asked keeps none.
    const body = generatedSetUploadBody('poll', {
      questions: [], metadata, roundKind: '', roundKindBrief: undefined,
    }, { now: NOW });
    expect(body).not.toHaveProperty('roundKind');
    expect(body).not.toHaveProperty('roundKindBrief');
  });

  test('poll: typed poll, and it carries the direction', () => {
    const body = generatedSetUploadBody('poll', {
      questions: [], metadata, roundKind: 'produce', roundKindBrief: 'Ship it',
    }, { engagementType: 'trivia', now: NOW });
    expect(body.engagementType).toBe('poll');
    expect(body.roundKind).toBe('produce');
    expect(body.roundKindBrief).toBe('Ship it');
    expect(body.customInstructions).toBe('Pick one');
  });

  test('trivia: typed trivia, and it never carries a direction', () => {
    // The trivia builder has no direction picker; the console never sent one.
    const body = generatedSetUploadBody('trivia', {
      questions: [], metadata, roundKind: 'apply',
    }, { engagementType: 'poll', now: NOW });
    expect(body.engagementType).toBe('trivia');
    expect(body).not.toHaveProperty('roundKind');
    expect(body.aiContextInstructions).toBe('Say who knew');
  });

  test('survey: typed survey, title and description only', () => {
    const body = generatedSetUploadBody('survey', { questions: [], metadata }, { now: NOW });
    expect(body).toEqual({
      fileName: `Space_Quiz_-${NOW}.csv`,
      fileContent: surveyItemsToCsv([]),
      customTitle: 'Space Quiz!',
      customDescription: 'Planets',
      engagementType: 'survey',
      isAIGenerated: true,
    });
  });
});

describe('what each answer becomes', () => {
  const trivia = { questions: [{ title: 'RED PLANET', optionA: 'Mars', correctAnswer: 'OptionA' }], metadata: { title: 'Space Quiz' } };

  test('it posts the body to admin/upload-questions', async () => {
    authFetch.mockResolvedValue(jsonResponse(200, { message: 'Created "Space Quiz"' }));
    await uploadGeneratedSet('trivia', trivia);
    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url, options] = authFetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/dev/admin/upload-questions');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toMatchObject({ customTitle: 'Space Quiz', engagementType: 'trivia' });
  });

  test.each([
    ['scenario', 'question set created'],
    ['trivia', 'trivia set created'],
    ['poll', 'poll set created'],
    ['survey', 'draft survey created'],
  ])('%s: success is the server\'s message and where to find the set', async (kind, created) => {
    authFetch.mockResolvedValue(jsonResponse(200, { message: 'Created "Space Quiz"' }));
    const outcome = await uploadGeneratedSet(kind, { scenarios: [], questions: [], metadata: { title: 'Space Quiz' } });
    expect(outcome).toEqual({
      ok: true,
      notice: { text: `Created "Space Quiz" — ${created}. Open it from the list to review it.`, tone: 'success' },
    });
  });

  test('a 402 is the plan-limit notice, carrying the parsed refusal', async () => {
    authFetch.mockResolvedValue(jsonResponse(402, {
      code: 'upgrade_required', limit: { kind: 'sets', used: 5, included: 5 },
    }));
    const outcome = await uploadGeneratedSet('trivia', trivia);
    expect(outcome.ok).toBe(false);
    expect(outcome.limit).toMatchObject({ kind: 'sets', used: 5, included: 5 });
    expect(outcome.notice).toEqual({ limit: outcome.limit, outcome: 'Nothing was saved.', tone: 'error' });
  });

  test('another refusal is the server\'s sentence', async () => {
    authFetch.mockResolvedValue(jsonResponse(409, { error: 'A set with this name already exists' }));
    const outcome = await uploadGeneratedSet('trivia', trivia);
    expect(outcome).toEqual({
      ok: false,
      notice: { text: 'Upload failed: A set with this name already exists', tone: 'error' },
    });
  });

  test('a refusal with no sentence still says it failed', async () => {
    authFetch.mockResolvedValue(jsonResponse(500, {}));
    const outcome = await uploadGeneratedSet('trivia', trivia);
    expect(outcome.notice).toEqual({ text: 'Upload failed: Unknown error', tone: 'error' });
  });

  test('a request that never arrives is reported, not thrown', async () => {
    authFetch.mockRejectedValue(new Error('Network request failed'));
    const outcome = await uploadGeneratedSet('trivia', trivia);
    expect(outcome).toEqual({ ok: false, notice: { text: 'Upload failed: Network request failed', tone: 'error' } });
  });
});

describe('while it is in flight', () => {
  test.each([
    ['scenario', 'Processing AI-generated scenarios…'],
    ['trivia', 'Processing AI-generated trivia questions…'],
    ['poll', 'Processing AI-generated poll questions…'],
    ['survey', 'Processing AI-generated survey questions…'],
  ])('%s says what it is processing', (kind, text) => {
    expect(generatedSetPendingNotice(kind)).toEqual({ text, tone: 'pending' });
  });
});
