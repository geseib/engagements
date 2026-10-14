/**
 * R1: ONE MOMENT, ONE DECISION FUNCTION — and both host surfaces read it.
 *
 * The host page's dock reaches roundStep through `hostControlsFor`
 * (snapshotFromHostPage); the Remote reaches it through `remoteStep`
 * (snapshotFromHostState over the /host-state payload). For every round type
 * and every moment, the same round fed through both doors must give the same
 * primary and the same secondary, id and label.
 *
 * The second block is R6's grep: no host surface types a round label itself.
 */
import fs from 'fs';
import path from 'path';
import { hostControlsFor } from '../config/hostControls';
import { remoteStep } from '../config/hostRemote';
import { allRoundLabels } from '../config/roundWords';

const TYPES = ['call-and-answer', 'trivia', 'poll', 'wavelength'];

/**
 * One round in each moment, as each surface holds it. `dock` is what the host
 * page passes hostControlsFor; `json` + `extras` are the Remote's /host-state
 * payload and what it knows beside it.
 */
function cases(gameType) {
  const noun = { 'call-and-answer': 'Round', trivia: 'Question', poll: 'Poll', wavelength: 'Subject' }[gameType];
  const base = { gameType, roundNoun: noun, hasQuestionSet: true };
  const remoteBase = { hasQuestionSet: true, roundNoun: noun };
  return [
    {
      name: 'LOBBY with people in',
      dock: { ...base, phase: 'LOBBY', playerCount: 3 },
      json: { state: 'CREATED', gameType },
      extras: { ...remoteBase, playerCount: 3 },
    },
    {
      name: 'LOBBY, empty room',
      dock: { ...base, phase: 'LOBBY', playerCount: 0 },
      json: { state: 'CREATED', gameType },
      extras: { ...remoteBase, playerCount: 0 },
    },
    {
      name: 'ANSWERING, some in',
      dock: { ...base, roundNumber: 3, phase: 'ASK', playerCount: 5, answeredCount: 2, answerCount: 2 },
      json: { state: 'ASK#003', gameType, answerProgress: { answersReceived: 2, totalPlayers: 5 } },
      extras: { ...remoteBase, playerCount: 5 },
    },
    {
      name: 'ANSWERING, nobody yet',
      dock: { ...base, roundNumber: 3, phase: 'ASK', playerCount: 5, answeredCount: 0, answerCount: 0 },
      json: { state: 'ASK#003', gameType, answerProgress: { answersReceived: 0, totalPlayers: 5 } },
      extras: { ...remoteBase, playerCount: 5 },
    },
    {
      name: 'VOTING',
      dock: { ...base, roundNumber: 3, phase: 'VOTE', playerCount: 5, votedCount: 4, answerCount: 5 },
      json: { state: 'VOTE#003', gameType, votingProgress: { votesReceived: 4, totalPlayers: 5 } },
      extras: { ...remoteBase, playerCount: 5, answerCount: 5 },
    },
    {
      name: 'VOTE_RESPONSES, the second of five',
      dock: { ...base, roundNumber: 3, phase: 'VOTE', playerCount: 5, votedCount: 4, answerCount: 5, spotlightIndex: 1 },
      json: {
        state: 'VOTE#003', gameType, votingProgress: { votesReceived: 4, totalPlayers: 5 },
        stageFocus: { focus: 'answer', index: 1, part: 0, parts: 1, phase: 'VOTE' },
      },
      extras: { ...remoteBase, playerCount: 5, answerCount: 5 },
    },
    {
      name: 'VOTE_RESPONSES, the last of five',
      dock: { ...base, roundNumber: 3, phase: 'VOTE', playerCount: 5, votedCount: 5, answerCount: 5, spotlightIndex: 4 },
      json: {
        state: 'VOTE#003', gameType, votingProgress: { votesReceived: 5, totalPlayers: 5 },
        stageFocus: { focus: 'answer', index: 4, part: 0, parts: 1, phase: 'VOTE' },
      },
      extras: { ...remoteBase, playerCount: 5, answerCount: 5 },
    },
    {
      name: 'RESULTS with responses',
      dock: { ...base, roundNumber: 3, phase: 'RESULTS', playerCount: 5, answerCount: 4 },
      json: { state: 'RESULTS#003', gameType, stageBeat: 'results', stageFocus: { focus: 'none', index: null } },
      extras: { ...remoteBase, playerCount: 5, answerCount: 4 },
    },
    {
      name: 'RESPONSES, the second of four',
      dock: { ...base, roundNumber: 3, phase: 'RESULTS', playerCount: 5, answerCount: 4, spotlightIndex: 1 },
      json: {
        state: 'RESULTS#003', gameType, stageBeat: 'results',
        stageFocus: { focus: 'answer', index: 1, part: 0, parts: 1, phase: 'RESULTS' },
      },
      extras: { ...remoteBase, playerCount: 5, answerCount: 4 },
    },
    {
      name: 'RESPONSES, the last',
      dock: { ...base, roundNumber: 3, phase: 'RESULTS', playerCount: 5, answerCount: 4, spotlightIndex: 3 },
      json: {
        state: 'RESULTS#003', gameType, stageBeat: 'results',
        stageFocus: { focus: 'answer', index: 3, part: 0, parts: 1, phase: 'RESULTS' },
      },
      extras: { ...remoteBase, playerCount: 5, answerCount: 4 },
    },
    {
      name: 'READ while Workie writes',
      dock: { ...base, roundNumber: 3, phase: 'FIELD_NOTES', notesPage: 0, notesPages: 1, notesReady: false },
      json: { state: 'RESULTS#003', gameType, stageBeat: 'field-notes', stageNotes: { page: 0, pages: 1 } },
      extras: { ...remoteBase, notesReady: false },
    },
    {
      name: 'READ, page 1 of 3',
      dock: { ...base, roundNumber: 3, phase: 'FIELD_NOTES', notesPage: 0, notesPages: 3, notesReady: true },
      json: { state: 'RESULTS#003', gameType, stageBeat: 'field-notes', stageNotes: { page: 0, pages: 3 } },
      extras: { ...remoteBase, notesReady: true },
    },
    {
      name: 'READ, the last page',
      dock: { ...base, roundNumber: 3, phase: 'FIELD_NOTES', notesPage: 2, notesPages: 3, notesReady: true },
      json: { state: 'RESULTS#003', gameType, stageBeat: 'field-notes', stageNotes: { page: 2, pages: 3 } },
      extras: { ...remoteBase, notesReady: true },
    },
    {
      name: 'FEEDBACK',
      dock: { ...base, roundNumber: 3, phase: 'FEEDBACK' },
      json: { state: 'RESULTS#003', gameType, stageBeat: 'feedback' },
      extras: { ...remoteBase },
    },
    {
      name: 'ENDED',
      dock: { ...base, phase: 'ENDED' },
      json: { state: 'ENDED', gameType },
      extras: { ...remoteBase },
    },
  ];
}

const pick = (control) => (control ? { id: control.id, label: control.label } : null);

describe('the host page and the Remote give the same step (R1)', () => {
  for (const gameType of TYPES) {
    for (const c of cases(gameType)) {
      test(`${gameType} · ${c.name}`, () => {
        const dock = hostControlsFor(c.dock);
        const remote = remoteStep(c.json, c.extras);
        expect(remote.moment).toBe(dock.step.moment);
        expect(pick(remote.primary)).toEqual(pick(dock.primary));
        expect(pick(remote.secondary)).toEqual(pick(dock.secondary));
        expect(remote.primary.disabled).toBe(dock.primary.disabled);
      });
    }
  }
});

/** The file with its comments taken out: a comment may quote a label. */
function codeOf(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

describe('no host surface types a round label itself (R1, R6)', () => {
  const FILES = [
    'HostRemote.jsx',
    'config/hostRemote.js',
    'components/stage/Dock.jsx',
    'components/HostActionBar.jsx',
    'GameHostPage.jsx',
  ];
  const labels = allRoundLabels();

  test.each(FILES)('%s', (file) => {
    const code = codeOf(file);
    const found = [];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // As a string literal, or as JSX text between tags.
      const literal = new RegExp(`['"\`]${escaped}['"\`]|>\\s*${escaped}\\s*<`);
      if (literal.test(code)) found.push(label);
    }
    expect(found).toEqual([]);
  });
});
