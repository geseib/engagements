import React, { useMemo, useState } from 'react';
import {
  TEMPLATE_VARIABLES,
  VARIABLE_CATEGORY_ORDER,
} from '../config/templateVariables';
import { normalizeGameType } from '../config/gameTypes';
import Icon from './Icon';

/**
 * WHAT EACH VARIABLE ACTUALLY RESOLVES TO — and which ones are unsafe.
 *
 * WHY THIS FILE EXISTS, and why it does not read the catalogue's prose.
 * `config/templateVariables.js` is a prompt author's only spec and it is not
 * trustworthy about values. Defect D11: `voteTally`'s description reads
 * "Detailed breakdown of votes received by each response", example
 * "Alice: 3 first-place, 2 second-place votes (13 points)" — that is
 * `votingBreakdown`'s shape. The real value is a top-3 list of answer TEXTS
 * with point totals and no names at all
 * (`get-ai-summary.js:1580-1586`, the non-trivia branch of `resultsString`).
 *
 * So every sample below is BUILT THE WAY THE LAMBDA BUILDS IT, from a fixture
 * room, mirroring the emitter line by line. Nothing here paraphrases a
 * description. Where a shape cannot be derived — the survey type, which
 * `upload-questions.js` refuses outright, so no survey round has ever been
 * summarised — the sample is `null` and the UI says it does not know, rather
 * than printing the catalogue's guess.
 *
 * THE FIXTURE ROOM IS SIZED BY THE AUTHOR, on purpose, and the sizes are the
 * three the system has never been observed in:
 *
 *   0 answers  — rule-10 territory. `docs/superpowers/reviews/
 *                2026-08-11-agentic-sdlc-dry-run-hypothesis.md` H14 is
 *                UNTESTED: the smallest round ever run was 8 answers, so the
 *                thin-data branch of every prompt in this product is unread.
 *   1 answer   — the "treat it as one person's view, never the room's" branch.
 *   8 answers  — the size the one measured session actually ran at.
 *   40 answers — nothing truncates `responsesText`, so prompt size grows
 *                linearly with the room. The review's scaling note asks for a
 *                number before anyone runs a large session. This is that number.
 *
 * ⚠️ THE SAMPLES ARE ILLUSTRATIVE IN CONTENT AND EXACT IN SHAPE. The words are
 * fixture; the punctuation, ordering, truncation and units are the emitter's.
 */

/* ------------------------------------------------------------------ room -- */

/** Forty distinct names, so a 40-person room is not one name repeated. */
const NAMES = [
  'Ruth', 'Kai', 'Priya', 'Sofia', 'Yuki', 'Dan', 'Marcus', 'Tomas',
  'Ben', 'Ellis', 'Hannah', 'Ada', 'Iris', 'Nadia', 'Omar', 'Pia',
  'Quinn', 'Rafa', 'Sam', 'Tess', 'Uma', 'Vic', 'Wren', 'Xan',
  'Yara', 'Zoe', 'Arun', 'Bea', 'Cato', 'Dell', 'Esme', 'Finn',
  'Gil', 'Hugo', 'Ilse', 'Jonah', 'Kit', 'Lena', 'Milo', 'Noor',
];

/**
 * Answer texts at the length real answers run to. Taken from the one session
 * this product has been measured on (docs/superpowers/reviews/
 * 2026-08-11-agentic-sdlc-simulated-session.md §8, round 4) so the character
 * counts on screen are the counts a real round produces, not toy strings.
 */
const ANSWER_CORPUS = [
  'Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it.',
  'Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter anywhere I have worked.',
  'Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door.',
  'Human expectations, and I will name the cost precisely: it caps us at what I can write in a day, and I am one person.',
  'Two agents, one writing from the spec and one from the implementation, neither seeing the other. The cost is that it only works if the spec is good.',
  'Mutation testing. The cost is CI minutes, which we measured at roughly four times our current suite runtime, plus a fortnight of noise on legacy code.',
  'Regression-only, and verification moves into staged rollout. The cost is that users find the bug first, and I would rather say that out loud.',
  'None of the four. The cost I would pay is deleting tests. A suite that passes by construction is worse than no suite, because it buys confidence we did not earn.',
  'Mutation testing, because it is the only one on the list that does not need a person to have been right first.',
  'Regression-only. The cost lands on on-call and I am not the one carrying it, which is exactly why I distrust my own answer here.',
  'Mutation testing.',
];

const POLL_OPTIONS = ['Ship it Friday', 'Wait for the audit', 'Split the release', 'Ask the customer'];
const TRIVIA_OPTIONS = ['Artificial Intelligence', 'Machine Learning', 'Deep Learning', 'Neural Networks'];
const WORD_CORPUS = [
  ['handover', 'trust', 'review'],
  ['handover', 'speed', 'risk'],
  ['trust', 'review', 'ownership'],
  ['handover', 'cost', 'trust'],
  ['review', 'blast radius', 'speed'],
];

export const SAMPLE_ROOM_SIZES = [
  {
    id: 'empty',
    answers: 0,
    label: 'Nobody answered',
    why: 'The branch every prompt declares and no round has ever run. H14 is untested.',
  },
  { id: 'thin', answers: 1, label: 'One answer', why: 'One person’s view, never the room’s.' },
  { id: 'typical', answers: 8, label: 'A typical room (8)', why: 'The size the measured session ran at.' },
  {
    id: 'large',
    answers: 40,
    label: 'A large room (40)',
    why: 'Nothing truncates the answer list, so this is where prompt size goes.',
  },
];

export const DEFAULT_ROOM_SIZE = 'typical';

const roomSpec = (id) => SAMPLE_ROOM_SIZES.find((r) => r.id === id) || SAMPLE_ROOM_SIZES[2];

/**
 * A fixture round, with the vote arithmetic the real ballot produces:
 * a voter awards 3 / 2 / 1 points, and the tally is keyed by answer.
 */
function buildRoom(gameType, sizeId) {
  const count = roomSpec(sizeId).answers;
  const voters = count === 0 ? 0 : Math.max(1, Math.round(count * 0.9));

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const firsts = i === 0 ? Math.ceil(voters * 0.5) : i === 1 ? Math.floor(voters * 0.3) : i === 2 ? Math.floor(voters * 0.2) : 0;
    const seconds = i === 1 ? Math.ceil(voters * 0.4) : i === 2 ? Math.floor(voters * 0.3) : i === 3 ? Math.floor(voters * 0.2) : 0;
    const thirds = i === 2 ? Math.ceil(voters * 0.3) : i === 3 ? Math.floor(voters * 0.3) : i === 4 ? Math.floor(voters * 0.2) : 0;
    entries.push({
      player: NAMES[i % NAMES.length],
      answer:
        gameType === 'poll'
          ? POLL_OPTIONS[i % POLL_OPTIONS.length]
          : gameType === 'trivia'
            ? TRIVIA_OPTIONS[i % TRIVIA_OPTIONS.length]
            : gameType === 'wavelength'
              ? WORD_CORPUS[i % WORD_CORPUS.length].join(', ')
              : ANSWER_CORPUS[i % ANSWER_CORPUS.length],
      words: WORD_CORPUS[i % WORD_CORPUS.length],
      firstPlace: firsts,
      secondPlace: seconds,
      thirdPlace: thirds,
      // Trivia scores are points, not vote points; correctness alternates so
      // both branches of every correctness-shaped variable have a value.
      isCorrect: i % 3 !== 2,
    });
  }

  entries.forEach((e, i) => {
    e.totalScore =
      gameType === 'trivia'
        ? (e.isCorrect ? 100 + ((count - i) * 5) : 0)
        : e.firstPlace * 3 + e.secondPlace * 2 + e.thirdPlace;
  });

  const ranked = [...entries].sort((a, b) => b.totalScore - a.totalScore);
  return {
    gameType,
    count,
    // `votes` is a row per ballot, and `voteCount` is `votes.length`
    // (get-ai-summary.js:2103) — the number of BALLOT ROWS, not of voters.
    voteRows: gameType === 'call-and-answer' ? voters * 3 : 0,
    voters,
    entries,
    ranked,
    // Every downstream tally reads `sortedAnswers`, which is `.slice(0, 3)`
    // (get-ai-summary.js:1283-1286). Defect D4: three is a wider assumption
    // than one field — voteTally, votingBreakdown, topVotedAnswers,
    // finalResults, roundScores and scoreChanges all read this array.
    top3: ranked.slice(0, 3),
  };
}

/* ------------------------------------------------- the substitution map --- */

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * Everything `templateVars` holds, built the way `generateAISummary` builds it.
 * Cited against get-ai-summary.js so a reader can check any one of them.
 */
export function sampleTemplateVars(rawGameType, sizeId = DEFAULT_ROOM_SIZE) {
  const gameType = normalizeGameType(rawGameType);
  const room = buildRoom(gameType, sizeId);
  const { ranked, top3, count, voters } = room;
  const pointsLabel = gameType === 'trivia' ? 'points' : 'vote points';

  // :1409-1426 — ranks, ties, and the three medal emoji the output format
  // then bans (defect D5).
  let currentRank = 1;
  const responsesText = ranked
    .map((a, idx) => {
      if (idx > 0 && a.totalScore !== ranked[idx - 1].totalScore) currentRank = idx + 1;
      const rank =
        currentRank === 1 ? '\u{1F947} 1st Place'
          : currentRank === 2 ? '\u{1F948} 2nd Place'
            : currentRank === 3 ? '\u{1F949} 3rd Place'
              : `${currentRank}th Place`;
      return `${rank}: ${a.player} - "${a.answer}" (${a.totalScore} ${pointsLabel})`;
    })
    .join('\n\n');

  // :1580-1586 — and note there are no NAMES in the non-trivia branch. This is
  // the shape D11's catalogue entry gets wrong.
  const voteTally =
    gameType === 'trivia'
      ? top3.map((d, i) => `${i + 1}. ${d.player}: ${d.answer} - ${d.totalScore} points ${d.isCorrect ? '(Correct)' : '(Incorrect)'}`).join(', ')
      : top3.map((d, i) => `${i + 1}. ${d.answer} (${d.totalScore} vote points)`).join(', ');

  // :1725-1728
  const votingBreakdown = top3
    .map((d) => `${d.answer}: ${d.firstPlace} first-place, ${d.secondPlace} second-place, ${d.thirdPlace} third-place votes`)
    .join('; ');

  // :1589-1596
  const topVotedAnswers =
    gameType === 'trivia'
      ? top3.map((a) => `${a.player}: ${a.answer} - ${a.totalScore} points`).join(', ')
      : top3.map((a) => `${a.player}: ${a.totalScore} vote points`).join(', ');

  // :1625-1633
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  const finalResults =
    gameType === 'trivia'
      ? top3.map((d, i) => `${medals[i]} ${d.player}: ${d.answer} (${d.totalScore} points, ${d.isCorrect ? 'Correct' : 'Incorrect'})`).join(', ')
      : top3.map((d, i) => `${medals[i]} ${d.answer} (${d.totalScore} votes)`).join(', ');

  const winner = ranked[0];
  const winnerInfo = winner
    ? `Winner: ${winner.player} with "${winner.answer}" (${winner.totalScore} ${pointsLabel})`
    : 'No clear winner';

  // :1643-1660. The non-trivia branch is defect D13: the denominator is
  // totalVotes * 3 while a full 3/2/1 ballot awards 6, so the share is roughly
  // double and can print over 100%.
  const resultsSummary = (() => {
    if (count === 0) return gameType === 'trivia' ? 'No correct answers' : 'No votes recorded';
    if (gameType === 'trivia') return `Clear winner with ${winner.totalScore} points`;
    if (gameType === 'wavelength') return 'Team found 3 common words with 45% connection rate';
    return `Clear winner with ${Math.round((winner.totalScore / Math.max(1, room.voteRows * 3)) * 100)}% of possible vote points`;
  })();

  // :1580 — vote POINTS compared against BALLOT ROWS × 2. Defect D12.
  const votingPattern = (() => {
    if (gameType === 'trivia') return 'Trivia scoring - no voting';
    if (gameType === 'wavelength') return 'Wavelength word association - team scoring';
    if (count === 0 || room.voteRows === 0) return 'Diverse opinions';
    return winner.totalScore > room.voteRows * 2 ? 'Clear consensus' : 'Diverse opinions';
  })();

  const uniqueAnswers = [...new Set(ranked.map((a) => a.answer))];
  const leaderboard = ranked.map((a, i) => ({ name: a.player, score: a.totalScore + (10 - i) }));

  const wavelengthWords = ranked.map((a) => `${a.player}: [${a.words.join(', ')}]`).join('; ');
  const commonWords = count === 0 ? [] : [{ word: 'handover', count: 3 }, { word: 'trust', count: 3 }, { word: 'review', count: 2 }];
  const totalUniqueWords = count === 0 ? 0 : 9;
  const connectionScore = count === 0 ? 0 : 45;

  return {
    // SET INFO
    questionSetName: 'Reimagining the SDLC with agentic workflows',
    questionSetDescription: 'Six questions on what changes when review is cheap and code is not.',
    categoryCount: 6,
    totalQuestions: 6,
    sessionContext: 'Say what you would stop reading. An answer that keeps reviewing everything is not an answer.',

    // GAME INFO
    eventTitle: 'Reimagining the SDLC with agentic workflows',
    gameType,
    gameId: '4821',
    sessionDuration: '38 minutes',
    currentRound: 4,
    gameContext: 'Reimagining the SDLC with agentic workflows',

    // PLAYER INFO. `totalParticipants` is `answers.length` (:1250) — this
    // round's answer count, NOT the room's size. The name invites the exact
    // misreading 78df15ca removed.
    totalParticipants: count,
    totalPlayers: count,
    activeParticipants: room.voteRows > 0 ? room.voteRows : count,
    playerNames: ranked.map((a) => a.player).join(', '),
    playerRankings: leaderboard.slice(0, 3).map((p, i) => `${ordinal(i + 1)}: ${p.name} (${p.score} pts)`).join(', '),
    topPerformers: leaderboard.length ? `${leaderboard[0].name} leads with ${leaderboard[0].score} points` : '',

    // QUESTION INFO
    question: 'The agent wrote the code and the tests. What are the tests worth?',
    questionTitle: 'The agent wrote the code and the tests. What are the tests worth?',
    questionDetail: 'A test written from the implementation passes by construction. Say which cost you would pay.',
    questionCategory: 'Testing',
    questionContext: 'A test written from the implementation passes by construction.',
    questionNumber: 4,
    correctAnswer: gameType === 'trivia' ? 'The correct answer is B: Machine Learning' : '',
    triviaChoices: gameType === 'trivia' ? TRIVIA_OPTIONS.map((o, i) => `${'ABCD'[i]}) ${o}`).join(', ') : '',
    answerDetails: 'Machine Learning is the subset of AI that learns from data rather than rules.',
    difficulty: 'medium',
    questionExplanation: 'Machine Learning is the subset of AI that learns from data rather than rules.',
    pollOptions: gameType === 'poll' ? POLL_OPTIONS.map((o, i) => `Option ${i + 1}: ${o}`).join(', ') : '',

    // ANSWERS
    playerAnswers: ranked.map((a) => `${a.player}: "${a.answer}"`).join(', '),
    playerResponses: ranked.map((a) => `${a.player}: "${a.answer}"`).join(', '),
    responseCount: count,
    responsesText,
    uniqueAnswers: uniqueAnswers.slice(0, 5).join(', '),
    answerCategories: uniqueAnswers.length < 5 ? `${uniqueAnswers.length} unique responses` : `${uniqueAnswers.length} unique responses across various themes`,
    triviaResponses:
      gameType === 'trivia' || gameType === 'poll'
        ? uniqueAnswers.map((o) => `${o}: ${ranked.filter((a) => a.answer === o).length} votes`).join(', ')
        : '',
    correctCount: gameType === 'trivia' ? ranked.filter((a) => a.isCorrect).length : 0,

    // VOTES
    voteData: room.voteRows > 0 ? ranked.slice(0, voters).map((a) => `${a.player} voted`).join(', ') : 'No voting for trivia questions',
    voteCount: room.voteRows,
    // Empty BY DESIGN (:2105, :2124). Both were 100% by construction and went
    // straight to the model; they now resolve to nothing at all.
    votingParticipation: '',
    participationRate: '',
    votingPattern,
    consensusLevel: count === 0 ? 'No votes cast - nothing was ranked' : 'Moderate agreement',

    // VOTE TALLY
    voteTally,
    topVotedAnswers,
    votingBreakdown,

    // RESULTS
    finalResults,
    winnerInfo,
    resultsSummary,
    triviaCorrectness: gameType === 'trivia' && count ? `${ranked.filter((a) => a.isCorrect).length} of ${count} players correct (${Math.round((ranked.filter((a) => a.isCorrect).length / count) * 100)}%)` : '',

    // SCORES
    cumulativeScores: leaderboard.slice(0, 5).map((p, i) => `${i + 1}. ${p.name}: ${p.score} pts`).join(', '),
    totalScores: leaderboard.slice(0, 5).map((p, i) => `${i + 1}. ${p.name}: ${p.score} pts`).join(', '),
    scoreChanges: top3.map((d) => `${d.player}: +${d.totalScore} vote pts`).join(', ') || 'No points earned this round',
    roundScores: top3.map((d) => `${d.player}: +${d.totalScore} pts`).join(', ') || 'No scores this round',
    leaderboard: leaderboard.slice(0, 5).map((p, i) => `${ordinal(i + 1)}: ${p.name} (${p.score} pts)`).join(', '),
    scoringSystem: '1st place: 3 pts, 2nd place: 2 pts, 3rd place: 1 pt',
    averageScore: `${leaderboard.length ? Math.round(leaderboard.reduce((s, p) => s + p.score, 0) / leaderboard.length) : 0} points`,

    // WAVELENGTH
    wavelengthTopic: 'Handover',
    wavelengthWords,
    commonWords: commonWords.map((w) => w.word).join(', '),
    commonWordsCount: commonWords.length,
    totalUniqueWords,
    connectionScore: `${connectionScore}%`,
    wordAnalysis: count === 0 ? '' : `${commonWords.length} common words found out of ${totalUniqueWords} unique words (${connectionScore}% connection rate). Common words: ${commonWords.map((w) => `${w.word} (${w.count}x)`).join(', ')}`,
    teamScore: commonWords.length,

    // CONTEXT
    contextSections: '\nCONTEXT INFORMATION:\nPARTICIPANT INSTRUCTIONS: "Say what you would stop reading."\n',
    contextInstructions: '\n\nIMPORTANT: Please tailor your analysis based on the provided context information above.',
  };
}

/* ------------------------------------------------------------- verdicts --- */

/**
 * The variables that misbehave, and what they do instead of erroring.
 *
 * Each is confirmed in the code, not inferred from a name. `tier` is the
 * severity a prompt author should read it at; `silent` means the prompt saves,
 * runs, produces text, and the text is wrong or empty with nothing logged.
 */
export const UNSAFE_VARIABLES = {
  participationRate: {
    tier: 'silent',
    what: 'Resolves to the empty string, always.',
    why: 'It used to read 100% on every round by construction, so it was emptied rather than fixed (get-ai-summary.js:2124). Nothing tells you: the sentence you wrote around it just loses its number.',
  },
  votingParticipation: {
    tier: 'silent',
    what: 'Resolves to the empty string, always.',
    why: 'Same removal, same silence (:2105). A prompt that says "voting was {votingParticipation}" reads out "voting was ".',
  },
  totalParticipants: {
    tier: 'silent',
    what: 'This round’s answer count, not the room’s size.',
    why: 'It is `answers.length` (:1250). {responseCount} is the same number, honestly named. Writing "of the {totalParticipants} people here" states a falsehood about the room whenever anybody skipped the round.',
  },
  activeParticipants: {
    tier: 'silent',
    what: 'Collapses to the answer count when nobody voted.',
    why: ':1542 falls back to `answers.length`, so it cannot tell "everyone voted" from "nobody voted".',
  },
  votingPattern: {
    tier: 'silent',
    what: 'Says "Clear consensus" from an arithmetic comparison of two different units.',
    why: 'Vote POINTS against ballot ROWS × 2 (:1580). On the one measured session it fired for rounds 3 and 5 and not round 1, for no reason a reader could defend. It is live in the hardcoded lessons-learned default prompt.',
  },
  resultsSummary: {
    tier: 'silent',
    what: 'Its percentage can exceed 100%.',
    why: 'The non-trivia branch divides by `totalVotes * 3` while a full 3/2/1 ballot awards 6 (:1653-1656), so the share is roughly double the truth.',
  },
  voteTally: {
    tier: 'advisory',
    what: 'A top-3 list of answer TEXTS with point totals — no names.',
    why: 'The catalogue describes `votingBreakdown` here instead, example "Alice: 3 first-place, 2 second-place votes (13 points)". That is a different variable (defect D11). The sample beside this row is the real emitter.',
  },
  topVotedAnswers: {
    tier: 'advisory',
    what: 'Three entries, never more.',
    why: '`sortedAnswers` is truncated at 3 (:1283-1286) before anything reads it, including the branch that slices 5.',
  },
  votingBreakdown: {
    tier: 'advisory',
    what: 'Three entries, never more.',
    why: 'Same truncated array (:1283-1286).',
  },
  responsesText: {
    tier: 'advisory',
    what: 'Contains \u{1F947} \u{1F948} \u{1F949}, and grows without limit.',
    why: 'The rank prefixes are emoji (:1410-1413) while the output contract bans emoji, and nothing truncates the list — a 40-person room puts every answer in the prompt twice if you also name this variable in a sentence.',
  },
  finalResults: {
    tier: 'advisory',
    what: 'Contains \u{1F947} \u{1F948} \u{1F949}.',
    why: 'Built with medal emoji (:1625-1633) while the output contract says "no emoji".',
  },
};

/** A variable this game type does not produce resolves to nothing, silently. */
const UNAVAILABLE_NOTE =
  'Not produced for this engagement type. It is still substituted — with an empty '
  + 'or meaningless value — so it does not leave a visible {token}. It just vanishes.';

export function variableSamples(rawGameType, sizeId = DEFAULT_ROOM_SIZE) {
  const gameType = normalizeGameType(rawGameType);
  const vars = sampleTemplateVars(gameType, sizeId);
  // No survey set can exist: upload-questions.js rejects survey uploads, so no
  // survey round has ever been summarised and there is no emitted shape to
  // copy. Saying so beats printing the catalogue's guess.
  const unknown = gameType === 'survey';

  return TEMPLATE_VARIABLES.map((v) => {
    const available = v.gameTypes.map(normalizeGameType).includes(gameType);
    const raw = vars[v.name];
    const value = raw === undefined || raw === null ? '' : String(raw);
    return {
      name: v.name,
      category: v.category,
      available,
      unknown,
      value: unknown ? null : value,
      empty: !unknown && value.length === 0,
      chars: unknown ? null : value.length,
      unsafe: UNSAFE_VARIABLES[v.name] || null,
      unavailableNote: available ? null : UNAVAILABLE_NOTE,
    };
  });
}

/* ----------------------------------------------------------------- view --- */

const shorten = (text, max = 260) => (text.length <= max ? text : `${text.slice(0, max)}…`);

/**
 * The palette, plus what each variable turns into. Clicking still inserts.
 *
 * Mockup 19 shows unavailable variables greyed and kept in place rather than
 * hidden, with the reason in the tooltip. That is kept. The mockup's claim that
 * inserting one "leaves a literal {answers}" is true of its invented variable
 * names and false of this product's real ones: every catalogued token has a key
 * in `templateVars`, so it resolves — to nothing. Silent, not visible, which
 * is worse, and the row says so.
 */
export default function PromptVariableInspector({
  gameType,
  roomSize = DEFAULT_ROOM_SIZE,
  onInsert,
  usedNames = [],
}) {
  const [expanded, setExpanded] = useState(null);
  const samples = useMemo(() => variableSamples(gameType, roomSize), [gameType, roomSize]);
  const used = new Set(usedNames);

  const categories = VARIABLE_CATEGORY_ORDER.filter((c) => samples.some((s) => s.category === c));
  const unsafeCount = samples.filter((s) => s.unsafe && s.unsafe.tier === 'silent').length;

  return (
    // `template-variables-panel`, `variable-category`, `category-header` and
    // `variable-btn` are kept as a second class on each element. They are the
    // palette's identity in AIPromptManager.css and in
    // __tests__/promptVariablePalette.test.jsx, which asserts the three shipped
    // defects this palette fixed — a missing Wavelength header, a dead Context
    // header, and chips that could not be inserted. Renaming them would quietly
    // delete that coverage rather than replace it.
    <div className="template-variables-panel pvi" data-testid="prompt-variable-inspector">
      <div className="pvi-head">
        <h4>Variables</h4>
        <p className="pvi-sub">
          Click to insert. {samples.filter((s) => s.available).length} of {samples.length} produce
          something for {gameType || 'this engagement type'}.
          {unsafeCount > 0 && (
            <>
              {' '}
              <strong className="pvi-unsafe-count">
                {unsafeCount} are unsafe
              </strong>{' '}
              &mdash; they resolve without complaint and the value is wrong or empty.
            </>
          )}
        </p>
      </div>

      {categories.map((category) => (
        <div key={category} className="variable-category pvi-group">
          <h5 className="category-header">{category}</h5>
          <div className="pvi-rows">
            {samples
              .filter((s) => s.category === category)
              .map((s) => {
                const open = expanded === s.name;
                const tier = s.unsafe ? s.unsafe.tier : null;
                return (
                  <div
                    key={s.name}
                    className={[
                      'pvi-row',
                      s.available ? '' : 'pvi-row--na',
                      tier ? `pvi-row--${tier}` : '',
                      used.has(s.name) ? 'pvi-row--used' : '',
                    ].filter(Boolean).join(' ')}
                    data-testid={`pvi-row-${s.name}`}
                  >
                    <div className="pvi-row-top">
                      {/* Disabled, not hidden, for the variables this type does
                          not produce — mockup 19, "Unavailable, not hidden".
                          Hiding them makes the palette shorter and the author
                          wrong about why their sentence came out empty. */}
                      <button
                        type="button"
                        className="variable-btn pvi-token"
                        onClick={() => onInsert && onInsert(s.name)}
                        disabled={!onInsert || !s.available}
                        title={s.available ? 'Insert into the output format' : UNAVAILABLE_NOTE}
                      >
                        {`{${s.name}}`}
                      </button>
                      {tier === 'silent' && (
                        <span className="pvi-flag pvi-flag--silent">
                          <Icon name="Warning" weight="fill" size={12} color="currentColor" /> Unsafe
                        </span>
                      )}
                      {tier === 'advisory' && <span className="pvi-flag pvi-flag--advisory">Read this</span>}
                      {!s.available && <span className="pvi-flag pvi-flag--na">Produces nothing here</span>}
                      {used.has(s.name) && <span className="pvi-flag pvi-flag--used">In your prompt</span>}
                      <button
                        type="button"
                        className="pvi-more"
                        onClick={() => setExpanded(open ? null : s.name)}
                        aria-expanded={open}
                      >
                        {open ? 'Less' : 'What it becomes'}
                      </button>
                    </div>

                    {open && (
                      <div className="pvi-detail">
                        {s.unknown ? (
                          <p className="pvi-nosample">
                            <strong>No sample.</strong> No survey set can exist &mdash; the importer
                            refuses survey uploads &mdash; so no survey round has ever been
                            summarised and there is no emitted value to copy. The catalogue&rsquo;s
                            description is a guess and is not shown here.
                          </p>
                        ) : (
                          <>
                            <div className="pvi-sample-label">
                              Resolves to{' '}
                              {s.empty ? (
                                <em>nothing at all &mdash; an empty string</em>
                              ) : (
                                <>{s.chars} characters</>
                              )}
                            </div>
                            {!s.empty && <pre className="pvi-sample">{shorten(s.value)}</pre>}
                          </>
                        )}
                        {s.unsafe && (
                          <p className={`pvi-why pvi-why--${s.unsafe.tier}`}>
                            <strong>{s.unsafe.what}</strong> {s.unsafe.why}
                          </p>
                        )}
                        {!s.available && <p className="pvi-why pvi-why--na">{UNAVAILABLE_NOTE}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
