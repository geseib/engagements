/**
 * The page wiring for the round direction — AdminPage.jsx.
 *
 * SOURCE ASSERTIONS, because AdminPage.jsx cannot be mounted in jsdom:
 * `useAuth` hard-throws outside a provider (AuthContext.jsx:27-30), and
 * wrapping AuthProvider to get around it is explicitly not the recipe here.
 * The property is one hop of a payload, which reading the file can establish.
 *
 * WHAT IT PROTECTS. The builder steers the generator with a direction and then
 * hands the finished scenarios to `handleScenariosGenerated`, which passes them
 * to utils/generatedSetUpload.js, which POSTs them to /admin/upload-questions
 * (the host shelf shares that path). If the direction does not make that hop it steers
 * exactly one generation and is then lost: the SETS row reads as Produce for a
 * set generated as Apply, and the editor, the library and every regeneration
 * afterwards believe it. That failure is silent — the questions are right and
 * only the record of why is missing — which is precisely the kind this repo
 * keeps being bitten by (see tests/question-set-roundtrip.js).
 *
 * Comments are stripped before every assertion. A source test in this repo has
 * already passed on a comment (RESUME, Landmines); this file's own subject is
 * discussed in the comments of the very function it asserts on.
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

/*
  WHERE THE HOP IS NOW. The upload moved out of AdminPage into
  utils/generatedSetUpload.js so the host shelf could share it, and the body it
  builds is pure — so the forwarding, the poll hop and the omission of an unset
  direction are asserted BEHAVIOURALLY in generatedSetUpload.test.js ("the body
  each kind sends"), not read from source here. What stays here is the one hop
  that is still page wiring: the handler has to hand over the WHOLE payload.
*/
describe('the direction survives the hop from the builder to the set', () => {
  test('AdminPage hands the scenario payload over whole', () => {
    // rejects: destructuring `{ scenarios, metadata }` and passing only those,
    // which is what the handler did before the round-direction slice — the
    // direction would arrive on the object and be dropped one line later.
    const source = read('AdminPage.jsx');
    const handler = source.slice(source.indexOf('const handleScenariosGenerated'));
    expect(handler).toMatch(/uploadBuilderResult\('scenario', scenarioData, \{ engagementType \}\)/);
  });

  test('the poll handler does the same hop', () => {
    // rejects: wiring one builder and not the other. Both game types take a
    // direction (config/roundKinds.js ROUND_KIND_GAME_TYPES) and both
    // generators consume one, so a poll set created through the builder must
    // record what it was steered with just as a scenario set does.
    const source = read('AdminPage.jsx');
    const handler = source.slice(source.indexOf('const handlePollGenerated'));
    expect(handler).toMatch(/uploadBuilderResult\('poll', pollData\)/);
  });

  test('the shared path reads the direction off the payload it is given', () => {
    // rejects: the helper building its body from `{ metadata }` alone.
    const helper = read('utils', 'generatedSetUpload.js');
    expect(helper).toMatch(/const\s*\{[^}]*roundKind[^}]*\}\s*=\s*data/);
  });
});

describe('the builder hands it over', () => {
  test('AIScenarioBuilder puts the direction on the generation request', () => {
    // rejects: a picker that only rewrites the local participant instruction.
    // The backend places the direction in FRONT of the topic's basePrompt, and
    // that is the half of the fix that changes the questions themselves.
    const source = read('components', 'AIScenarioBuilder.jsx');
    const request = source.slice(source.indexOf('startGenerationJob'));
    expect(request).toMatch(/roundKind: scenarioConfig\.roundKind/);
    expect(request).toMatch(/roundKindBrief: scenarioConfig\.roundKindBrief/);
  });

  test('and on the payload the page turns into a set', () => {
    // rejects: steering the generation and forgetting to record what it was
    // steered with.
    const source = read('components', 'AIScenarioBuilder.jsx');
    const handover = source.slice(source.indexOf('onScenariosGenerated({'));
    expect(handover).toMatch(/roundKind: scenarioConfig\.roundKind/);
  });

  test('the poll builder offers the same picker and sends the same field', () => {
    // rejects: a picker in one builder and not the other, which leaves an
    // operator able to set a direction on a poll set in the EDITOR that the
    // creation path never asked about — the enum wired at every layer except
    // the one an operator actually touches.
    const source = read('components', 'PollAIBuilder.jsx');
    expect(source).toContain('<RoundKindPicker');
    const request = source.slice(source.indexOf('startGenerationJob'));
    expect(request).toMatch(/roundKind: pollConfig\.roundKind/);
  });

  test('the poll instruction keeps the game MECHANIC and adds the direction', () => {
    // rejects: replacing "Select your preferred option(s)" with the round
    // kind's line. The mechanic is how a poll works and never changes; the
    // direction is what the options are about. A poll set needs both, and
    // dropping the mechanic would leave the room not knowing it may pick more
    // than one.
    const source = read('components', 'PollAIBuilder.jsx');
    expect(source).toContain('Select your preferred option(s)');
    expect(source).toMatch(/roundKindParticipantInstruction\(pollConfig\.roundKind/);
  });

  test('the participant instruction is not keyed on the scenario type', () => {
    // rejects: THE REPORTED DEFECT, restored. The old map keyed six scenario
    // types to six instructions and fell through to "share your experiences and
    // insights" for everything else — which is every database prompt in the
    // product. That sentence must not reappear anywhere in this file, and the
    // direction-shaped entries that were doing the round kind's job from the
    // wrong axis must not come back either.
    const source = read('components', 'AIScenarioBuilder.jsx');
    expect(source).not.toMatch(/share your experiences and insights/i);
    expect(source).not.toMatch(/const typeInstructions = \{/);
    expect(source).not.toMatch(/'lessons-learned':\s*'Share specific experiences/);
    // What replaced it: the kind writes the line.
    expect(source).toMatch(/roundKindParticipantInstruction\(/);
  });
});
