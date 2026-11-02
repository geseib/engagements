/**
 * WHERE A COMMENT SITS — the phone, the report and the backend agree
 * (docs/design/phone-comments, backend B1).
 *
 * Two copies of one rule: `lambda-functions/game/comment-placement.js` (what
 * create-report stamps as `placement`) and `config/commentPlacement.js` (what
 * the phone's sections and GameReport place by). Both run the same fixtures
 * here and must agree.
 *
 * rejects: a ballot ref read as a position; a tie that files a reply under the
 *          other tied response; an older reply placed by its position rather
 *          than its quote; an unmatched older reply dropped.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { placeComment as fePlace, placeComments } from '../config/commentPlacement';
import { ReportDocument } from '../components/GameReport';

const be = require('../../../lambda-functions/game/comment-placement.js');

/** Two tied responses, drawn rank-first: Bea (ballot 3) above Ada (ballot 1). */
const ROWS = [
  { answer: 'Re-price the onboarding package.', playerName: 'Bea', rank: 1, ballot: 3 },
  { answer: 'Freeze **all** discounting.', playerName: 'Ada', rank: 1, ballot: 1 },
  { answer: 'Call the ten largest accounts.', playerName: 'Cy', rank: 3, ballot: 2 },
];

const FIXTURES = {
  'ballot 1 is Ada, wherever Ada is drawn': { anchorKind: 'response', anchorRef: '1', anchorBasis: 'ballot' },
  'ballot 3 is Bea, though position 3 does not exist': { anchorKind: 'response', anchorRef: '3', anchorBasis: 'ballot' },
  'a ballot nobody carries': { anchorKind: 'response', anchorRef: '9', anchorBasis: 'ballot' },
  'an older reply: position 0 (Bea) but Ada\'s quote': { anchorKind: 'response', anchorRef: '0', anchorExcerpt: 'Freeze all discounting.' },
  'an older reply whose response is gone': { anchorKind: 'response', anchorRef: '1', anchorExcerpt: 'Nothing like any of these' },
  'an older reply with no quote at all': { anchorKind: 'response', anchorRef: '1', anchorExcerpt: '' },
  'Workie\'s read': { anchorKind: 'summary', anchorRef: '' },
  'the whole round': { anchorKind: 'results', anchorRef: '' },
};

const EXPECTED = {
  'ballot 1 is Ada, wherever Ada is drawn': { section: 'response', index: 1, ballot: 1 },
  'ballot 3 is Bea, though position 3 does not exist': { section: 'response', index: 0, ballot: 3 },
  'a ballot nobody carries': { section: 'round', index: null, ballot: null },
  'an older reply: position 0 (Bea) but Ada\'s quote': { section: 'response', index: 1, ballot: 1 },
  'an older reply whose response is gone': { section: 'round', index: null, ballot: null },
  'an older reply with no quote at all': { section: 'round', index: null, ballot: null },
  'Workie\'s read': { section: 'summary', index: null, ballot: null },
  'the whole round': { section: 'round', index: null, ballot: null },
};

describe.each(Object.keys(FIXTURES))('%s', (name) => {
  test('the frontend places it as written by hand', () => {
    expect(fePlace(FIXTURES[name], ROWS)).toEqual(EXPECTED[name]);
  });
  test('the backend copy agrees', () => {
    expect(be.placeComment(FIXTURES[name], ROWS)).toEqual(fePlace(FIXTURES[name], ROWS));
  });
  test('and the report’s spelling of the rows (answerText) places it the same', () => {
    const reportRows = ROWS.map(({ answer, ...r }) => ({ ...r, answerText: answer }));
    expect(fePlace(FIXTURES[name], reportRows)).toEqual(EXPECTED[name]);
  });
});

test('placeComments groups a round’s comments, in writing order', () => {
  const list = [
    { id: 1, ...FIXTURES['ballot 1 is Ada, wherever Ada is drawn'] },
    { id: 2, ...FIXTURES['Workie\'s read'] },
    { id: 3, ...FIXTURES['an older reply: position 0 (Bea) but Ada\'s quote'] },
    { id: 4, ...FIXTURES['the whole round'] },
  ];
  const placed = placeComments(list, ROWS);
  expect(placed.summary.map((c) => c.id)).toEqual([2]);
  expect(placed.byRow.get(1).map((c) => c.id)).toEqual([1, 3]);
  expect(placed.round.map((c) => c.id)).toEqual([4]);
});

describe('the session report groups a round’s comments as the phone does (§5)', () => {
  const data = {
    gameId: '4821',
    gameType: 'call-and-answer',
    questions: [{
      questionNumber: '001',
      questionData: { title: 'Competitive response' },
      aiSummary: { summaryText: 'The room wants to defend price.' },
      answers: ROWS.map(({ answer, ...r }, i) => ({ ...r, answerText: answer, answerIndex: i, totalScore: 4 - i })),
      comments: [
        { commentId: 'c1', anchorKind: 'response', anchorRef: '1', anchorBasis: 'ballot', anchorExcerpt: 'Freeze all discounting.', text: 'Ballot reply to Ada.', playerName: 'Lee' },
        { commentId: 'c2', anchorKind: 'summary', anchorRef: '', text: 'On the read.', playerName: 'Lee' },
        { commentId: 'c3', anchorKind: 'response', anchorRef: '0', anchorExcerpt: 'Call the ten largest accounts.', text: 'Older reply to Cy.', playerName: 'Lee' },
        { commentId: 'c4', anchorKind: 'response', anchorRef: '5', anchorLabel: 'Response 6 — Zed', anchorExcerpt: 'Gone now', text: 'Older, unmatched.', playerName: 'Lee' },
        { commentId: 'c5', anchorKind: 'results', anchorRef: '', anchorLabel: 'Results', text: 'Room note.', playerName: 'Said in the room' },
      ],
    }],
  };

  test('three groups in order, each reply under its response by ballot number, in ballot order', () => {
    const { container } = render(<ReportDocument reportData={data} />);
    const block = container.querySelector('.report-comments');
    const heads = [...block.querySelectorAll('.comment-group-head')].map((n) => n.textContent);
    expect(heads).toEqual(['On Workie’s read', 'On the responses', 'On the whole round']);
    const labels = [...block.querySelectorAll('.comment-on')].map((n) => n.textContent);
    // Ada is ballot 1, Cy ballot 2: ballot order, not the report's rank order.
    expect(labels).toEqual(['Response 1 — Ada', 'Response 2 — Cy', 'On Zed’s response']);
    const texts = [...block.querySelectorAll('.comment-text')].map((n) => n.textContent);
    expect(texts).toEqual(['On the read.', 'Ballot reply to Ada.', 'Older reply to Cy.', 'Older, unmatched.', 'Room note.']);
    // The unmatched one keeps its quote.
    expect(block.textContent).toContain('Gone now');
    expect(block.textContent).toMatch(/5 comments on this round/);
  });
});
