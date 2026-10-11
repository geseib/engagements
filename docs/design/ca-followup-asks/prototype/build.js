// Builds the prompts for the prototype runs. Read-only: requires the repo's
// personas.js for the output contract and the voice, exactly as production does.
// usage: node build.js <read|readInBand|asks> <r3|r2> [readBackFile] > prompt.txt
// readInBand = run A's prompt; asks = run B's prompt, given the read (the text of run A's read).
const fs = require('fs');
const path = require('path');
const W = path.resolve(__dirname, '../../../..'); // the repo root
const P = require(path.join(W, 'lambda-functions/game/personas.js'));
const base = JSON.parse(fs.readFileSync(path.join(W, 'sets/prompt-callandanswer-workie-advisor.json'), 'utf8'));
const draft = JSON.parse(fs.readFileSync(path.join(W, 'docs/design/ca-followup-asks/prompt-draft.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'rounds.json'), 'utf8'));

const [mode, key, readBackFile] = process.argv.slice(2);
const r = data.rounds[key];
const hidden = r.hidden;
const scored = r.answers.map((a) => ({ ...a, points: 3 * a.first + 2 * a.second + a.third }))
  .sort((x, y) => y.points - x.points);
const who = (a) => (hidden ? 'a participant' : a.name);

let rank = 1;
const responsesText = scored.map((a, i) => {
  if (i > 0 && a.points !== scored[i - 1].points) rank = i + 1;
  const label = rank === 1 ? '🥇 1st Place' : rank === 2 ? '🥈 2nd Place' : rank === 3 ? '🥉 3rd Place' : `${rank}th Place`;
  return `${label}: ${who(a)} - "${a.text}" (${a.points} vote points)`;
}).join('\n\n');
const voteTallyByAuthor = hidden
  ? 'Authors are hidden this round. Name nobody.'
  : scored.map((a) => `- ${a.name}: ${a.points} vote points (${a.first} first, ${a.second} second, ${a.third} third)`).join('\n');
const votingBreakdown = scored.slice(0, 3)
  .map((a) => `${a.text}: ${a.first} first-place, ${a.second} second-place, ${a.third} third-place votes`).join('; ');
const vars = {
  eventTitle: data.eventTitle,
  currentRound: r.currentRound,
  task: r.task,
  questionTitle: r.questionTitle,
  questionDetail: r.questionDetail,
  responseCount: String(r.answers.length),
  voteCount: String(r.answers.length),
  scoringSystem: '1st place: 3 pts, 2nd place: 2 pts, 3rd place: 1 pt',
  votingBreakdown,
  voteTallyByAuthor,
  responsesText,
};
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

const persona = P.SEED_PERSONAS.find((p) => p.personaId === 'session-advisor');
const OPENING = P.OPENING_MOVES[1]; // fixed, so the runs are comparable

if (mode === 'read' || mode === 'readInBand') {
  const inBand = mode === 'readInBand';
  const promptData = inBand
    ? { ...base, outputSections: [...base.outputSections, draft.inBandVariant.extraOutputSection] }
    : base;
  let instructions = base.instructions;
  if (inBand) {
    instructions = instructions.replace('WHAT YOU HAVE BEEN GIVEN', `${draft.inBandVariant.rulesAppendedToInstructions}\n\nWHAT YOU HAVE BEEN GIVEN`);
  }
  let outputFormat = base.outputFormat;
  if (inBand) outputFormat = outputFormat.replace('no code fences, ', 'no code fences except the one json block in the last section, ');
  const body = fill(`${instructions}\n\n${outputFormat}`, vars);
  const prompt = `VOICE:\n${persona.voice}\n\n${body}\n\n${P.buildOutputContract(promptData, { openingMove: OPENING })}\n\n${P.buildVoiceDirective(persona)}`;
  process.stdout.write(prompt);
} else if (mode === 'asks') {
  const readBack = fs.readFileSync(readBackFile, 'utf8').trim();
  const fu = draft.followUpAsks;
  // Numbered, nameless, in the read's ranked order: the asks never need an author.
  const numberedAnswers = '\n' + scored.map((a, i) => `${i + 1}. (${a.points} vote points) "${a.text}"`).join('\n');
  process.stdout.write(fill(fu.instructions, { ...vars, numberedAnswers, readBack: `\n\n${readBack}` }));
} else {
  throw new Error('mode?');
}
