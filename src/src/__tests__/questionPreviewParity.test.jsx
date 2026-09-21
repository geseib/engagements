import React from 'react';
import { render } from '@testing-library/react';
import QuestionCard from '../components/QuestionCard';
import { stagedQuestion } from '../config/questionPreview';
import { resolveInstruction } from '../config/instructions';
import { normalizeGameType, PICKER_GAME_TYPES } from '../config/gameTypes';
import { toRow } from '../utils/questionRows';

/**
 * TWO ROW SHAPES, ONE CARD — the preview shows what the room will see.
 *
 * The stage is handed a question by game/get-question.js; the set editor holds
 * the same question as a utils/questionRows.js:toRow row, read from
 * admin/get-question-set-questions.js. One stored item, seen through both, must
 * render the same card. The fixtures below are that one item and its two
 * projections, written out by hand from the handlers (line numbers cited) —
 * jsdom cannot run a Lambda, and tests/question-set-roundtrip.js already owns
 * the handler-level round trip.
 */
const SET_ID = 'true-crime';

/** The stored row, as admin/upload-questions.js writes it. */
const STORED = {
  SK: 'QUESTION#c001#003',
  Title: 'Which killer was caught by a parking ticket?',
  Detail: 'New York, 1977.',
  Category: 'History',
  CustomInstructions: 'Pick the name, not the nickname.',
  Image: `sets/${SET_ID}/son-of-sam.jpg`,
  optionA: 'Ted Bundy',
  optionB: 'David Berkowitz',
  optionC: 'John Wayne Gacy',
  optionD: 'Richard Ramirez',
  correctAnswer: 'OptionB',
  difficulty: 'easy',
  AnswerDetails: 'Stopped for parking beside a hydrant.',
};

/** get-question-set-questions.js:109-139 — what the editor loads. */
const EDITOR_PAYLOAD = {
  id: 'c001#003',
  title: STORED.Title,
  questionDetail: STORED.Detail,
  category: STORED.Category,
  image: STORED.Image,
  optionA: STORED.optionA,
  optionB: STORED.optionB,
  optionC: STORED.optionC,
  optionD: STORED.optionD,
  correctAnswer: STORED.correctAnswer,
  answerDetails: STORED.AnswerDetails,
  difficulty: STORED.difficulty,
  customInstructions: STORED.CustomInstructions,
};

/** get-question.js:221-268 — what the host is handed at RESULTS. */
const WIRE = {
  title: STORED.Title,
  questionDetail: STORED.Detail,
  detail: STORED.Detail,
  category: STORED.Category,
  image: STORED.Image,
  customInstructions: STORED.CustomInstructions,
  optionA: STORED.optionA,
  optionB: STORED.optionB,
  optionC: STORED.optionC,
  optionD: STORED.optionD,
  optionE: '',
  optionF: '',
  correctAnswer: STORED.optionB,       // "OptionB" rewritten to its text
};

const SET_LINE = 'Answer for your table, not yourself.';
const html = (element) => render(element).container.innerHTML;
const row = () => toRow(EDITOR_PAYLOAD);

describe('the how-to-answer line', () => {
  test('the premise: an editor row spells its own instruction differently from the wire', () => {
    // If this ever fails, toRow changed its spelling and the mapping below may
    // have become unnecessary — or wrong. It is what makes the next test bite.
    expect(row().customInstruction).toBe(STORED.CustomInstructions);
    expect(row().customInstructions).toBeUndefined();
    expect(resolveInstruction(row(), SET_LINE, 'trivia')).toBe(SET_LINE);
  });

  test('a staged row and the wire question produce the same line', () => {
    // rejects: handing the raw editor row to resolveInstruction, which shows the
    // SET's line for a question that has its own (spec §3.4).
    const staged = stagedQuestion(row(), { setId: SET_ID });
    expect(resolveInstruction(staged, SET_LINE, 'trivia')).toBe(resolveInstruction(WIRE, SET_LINE, 'trivia'));
    expect(resolveInstruction(staged, SET_LINE, 'trivia')).toBe(STORED.CustomInstructions);
  });

  test('a row with no instruction of its own still falls to the set, as the wire does', () => {
    const bare = stagedQuestion(toRow({ ...EDITOR_PAYLOAD, customInstructions: '' }), { setId: SET_ID });
    const wire = { ...WIRE, customInstructions: '' };
    expect(resolveInstruction(bare, SET_LINE, 'trivia')).toBe(resolveInstruction(wire, SET_LINE, 'trivia'));
    expect(resolveInstruction(bare, SET_LINE, 'trivia')).toBe(SET_LINE);
  });
});

describe('the card itself', () => {
  test('ASK: the staged row renders exactly what the wire question renders', () => {
    const staged = stagedQuestion(row(), { setId: SET_ID });
    const line = resolveInstruction(WIRE, SET_LINE, 'trivia');
    expect(html(<QuestionCard phase="ASK" question={staged} gameType="trivia" instruction={line} />))
      .toBe(html(<QuestionCard phase="ASK" question={WIRE} gameType="trivia" instruction={line} />));
  });

  test('REVEAL: the same option is marked correct', () => {
    const staged = stagedQuestion(row(), { setId: SET_ID });
    expect(html(<QuestionCard phase="REVEAL" question={staged} gameType="trivia" />))
      .toBe(html(<QuestionCard phase="REVEAL" question={WIRE} gameType="trivia" />));
  });

  test('REVEAL on a question whose filled slots are not contiguous marks one option, not two', () => {
    // A, C and D filled; C correct. On screen those read A, B, C — so the
    // option in slot D is LETTERED C, and the raw "OptionC" matches it too.
    const gappy = { ...EDITOR_PAYLOAD, optionB: '', correctAnswer: 'OptionC' };
    const wire = { ...WIRE, optionB: '', correctAnswer: STORED.optionC };
    const correctIn = (question) => [...render(
      <QuestionCard phase="REVEAL" question={question} gameType="trivia" />
    ).container.querySelectorAll('.opt.correct .txt')].map((n) => n.textContent);

    // The premise, so this cannot pass vacuously: unstaged, two rows light up.
    expect(correctIn(toRow(gappy))).toEqual([STORED.optionC, STORED.optionD]);
    // rejects: previewing a Reveal the room will never see.
    expect(correctIn(stagedQuestion(toRow(gappy), { setId: SET_ID }))).toEqual(correctIn(wire));
    expect(correctIn(wire)).toEqual([STORED.optionC]);
  });

  test('no row stages as nothing, so nothing selected draws no card', () => {
    // The preview hands the card whatever is selected; with nothing selected
    // there must be no half-built question object for the card to render.
    expect(stagedQuestion(null, { setId: SET_ID })).toBeNull();
    expect(stagedQuestion(undefined, { setId: SET_ID })).toBeNull();
    expect(html(<QuestionCard phase="ASK" question={stagedQuestion(null, { setId: SET_ID })} gameType="trivia" instruction={SET_LINE} />))
      .toBe('');
  });
});

describe('the picture', () => {
  const imageOf = (image) => stagedQuestion(toRow({ ...EDITOR_PAYLOAD, image }), { setId: SET_ID }).image;

  test.each([
    ['an upload not yet saved is keyed to this set', 'son-of-sam.jpg', `sets/${SET_ID}/son-of-sam.jpg`],
    // Nested on purpose: a flat key re-keyed to this set comes out identical,
    // so only a path below the prefix shows the key was left alone.
    ['a key already in this set is left alone', `sets/${SET_ID}/art/son-of-sam.jpg`, `sets/${SET_ID}/art/son-of-sam.jpg`],
    ['a key copied from another set is re-keyed, as Save will', 'sets/other/son-of-sam.jpg', `sets/${SET_ID}/son-of-sam.jpg`],
    ['a web address is kept verbatim', 'https://upload.wikimedia.org/x.jpg', 'https://upload.wikimedia.org/x.jpg'],
    ['a file shipped with the app is kept verbatim', '/assets/art/x.jpg', '/assets/art/x.jpg'],
    ['no picture stays no picture', '', ''],
  ])('%s', (_label, value, expected) => {
    // Mirrors lambda-functions/admin/upload-questions.js:81-92 (toMediaKey).
    expect(imageOf(value)).toBe(expected);
  });

  test('with no set id there is nothing to key to, so the value is left as typed', () => {
    // QuestionsPanel's setId is `questionSet?.id || ''`. Keying to an empty id
    // would invent `sets//son-of-sam.jpg`, a path no Save ever writes.
    expect(stagedQuestion(toRow({ ...EDITOR_PAYLOAD, image: 'son-of-sam.jpg' }), { setId: '' }).image)
      .toBe('son-of-sam.jpg');
  });
});

describe('the game type a set previews as is the one the host plays it as', () => {
  /*
   * The host's chain: GameSetupDialog lists a set under the pill P only when
   * `set.engagementType === P` (GameSetupDialog.jsx:196) and submits
   * `gameType: P` (:278); create-game.js:197 stores `gameType || 'call-and-answer'`;
   * the host restores `gameData.gameType || 'call-and-answer'`
   * (GameHostPage.jsx:2121, :4712). game/get-question-sets.js:115 serves a set
   * with no type as 'call-and-answer'. QuestionsPanel already maps the set's type
   * through normalizeGameType (QuestionsPanel.jsx:156) and hands that on.
   */
  test.each(PICKER_GAME_TYPES.map((t) => t.id))('a %s set previews as that same type', (id) => {
    expect(normalizeGameType(id)).toBe(id);
  });

  test('a set with no type previews as call-and-answer, which is how the host plays it', () => {
    expect(normalizeGameType(undefined)).toBe('call-and-answer');
    expect(normalizeGameType('')).toBe('call-and-answer');
    expect(normalizeGameType(null)).toBe('call-and-answer');
  });
});
