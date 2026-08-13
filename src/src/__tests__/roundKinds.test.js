/**
 * ROUND KINDS — the vocabulary, and the line that produced the reported defect.
 *
 * Pure module, no rendering. The picker's own behaviour is
 * roundKindPicker.test.jsx and the builder's wiring is
 * aiScenarioBuilderKind.test.jsx; this file is the contract those two stand on.
 *
 * THE DEFECT, in the owner's words: *"if someone is creating a call and answer
 * based on a improve idea, but currently the question set generator prompt has
 * direction like improve, you get a confusing question set."*
 *
 * The narrow version, which is what this file guards: `generateCustomInstructions()`
 * built the set-level participant instruction from a hardcoded map keyed on
 * SCENARIO TYPE, with this fallback for every type outside its six keys — which
 * is every database prompt and every "something else":
 *
 *     'Engage thoughtfully with each scenario and share your experiences
 *      and insights.'
 *
 * upload-questions.js stamps that string onto every question with no
 * instruction of its own, and the room reads it during ASK. So a round that had
 * just handed people a passage about somebody else's surgical checklists told
 * them to draw on their own experience. The questions were not the problem; the
 * instruction was answering a different question from the one on screen.
 */
import {
  ROUND_KIND_IDS,
  ROUND_KIND_LIST,
  ROUND_KINDS,
  DETAIL_CEILINGS,
  DEFAULT_ROUND_KIND,
  MAX_ROUND_KIND_BRIEF,
  normalizeRoundKind,
  resolveRoundKind,
  roundKindApplies,
  roundKindParticipantInstruction,
  roundKindDetailCeiling,
  roundKindGaps,
} from '../config/roundKinds';

describe('the enum is closed', () => {
  test('exactly five ids, in picker order', () => {
    // rejects: adding a sixth kind without deciding what it hands the room,
    // what the generator is told, and what the participant reads — every branch
    // downstream switches on this list exhaustively.
    expect(ROUND_KIND_IDS).toEqual(['produce', 'apply', 'improve', 'judge', 'custom']);
    expect(ROUND_KIND_LIST.map((k) => k.id)).toEqual(ROUND_KIND_IDS);
  });

  test('operator text can never become a key', () => {
    // rejects: making normalizeRoundKind a pass-through so a free-text
    // direction could be stored as the kind itself. `custom` plus a separate
    // brief is the escape hatch precisely so this stays impossible.
    expect(normalizeRoundKind('apply')).toBe('apply');
    expect(normalizeRoundKind(' JUDGE ')).toBe('judge');
    expect(normalizeRoundKind('reflect on it')).toBeNull();
    expect(normalizeRoundKind(undefined)).toBeNull();
  });

  test('absent means produce, and nothing else does', () => {
    // rejects: defaulting to `improve` because the GENERATOR was improve-shaped.
    // The generator's defect was in its instructions; the sets themselves hand
    // the room a prompt and the room supplies the material, which is Produce.
    expect(DEFAULT_ROUND_KIND).toBe('produce');
    expect(resolveRoundKind('')).toBe('produce');
    expect(resolveRoundKind(undefined)).toBe('produce');
    expect(resolveRoundKind('nonsense')).toBe('produce');
    expect(resolveRoundKind('judge')).toBe('judge');
  });
});

describe('every kind carries the four things everything else derives from', () => {
  for (const id of ROUND_KIND_IDS) {
    test(`${id} is complete`, () => {
      // rejects: adding a kind with no picker copy, which would render a card
      // somebody has to guess the meaning of.
      const kind = ROUND_KINDS[id];
      for (const field of ['label', 'icon', 'blurb', 'handThem', 'theWork', 'pickWhen']) {
        expect(typeof kind[field]).toBe('string');
        expect(kind[field].length).toBeGreaterThan(0);
      }
      expect(DETAIL_CEILINGS[id]).toBeGreaterThan(0);
    });
  }

  test('only `custom` has no house direction and no house instruction', () => {
    // rejects: giving custom a generic direction or a generic instruction. A
    // generic instruction is the defect; a generic direction would silently
    // overrule the operator's own words.
    for (const id of ['produce', 'apply', 'improve', 'judge']) {
      expect(ROUND_KINDS[id].direction).toEqual(expect.any(String));
      expect(ROUND_KINDS[id].participantInstruction).toEqual(expect.any(String));
    }
    expect(ROUND_KINDS.custom.direction).toBeNull();
    expect(ROUND_KINDS.custom.participantInstruction).toBeNull();
  });

  test('the icons are all real exports of Icon.jsx', () => {
    // rejects: naming an icon that does not exist. personas.js:226-228 renders
    // a generic circle with no error for an unknown name, and the picker would
    // do the same — five identical grey circles and no complaint anywhere.
    // eslint-disable-next-line global-require
    const iconSource = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'components', 'Icon.jsx'), 'utf8'
    );
    for (const id of ROUND_KIND_IDS) {
      expect(iconSource).toMatch(new RegExp(`\\b${ROUND_KINDS[id].icon}\\b`));
    }
  });
});

describe('the participant instruction comes from the KIND, never from the topic', () => {
  test('apply tells the room the material is not theirs', () => {
    // rejects: re-keying this on scenario type. THIS IS THE REPORTED DEFECT.
    // An Apply round that says "share your experiences" is asking about the
    // wrong thing entirely — the room was handed a passage seconds earlier.
    const line = roundKindParticipantInstruction('apply');
    expect(line).toMatch(/not ours/i);
    expect(line).not.toMatch(/your own experience/i);
  });

  test('produce and apply say opposite things about where the answer comes from', () => {
    // rejects: one instruction for every kind, which is what the fallback was.
    expect(roundKindParticipantInstruction('produce')).toMatch(/your own experience/i);
    expect(roundKindParticipantInstruction('apply')).not
      .toBe(roundKindParticipantInstruction('produce'));
  });

  test('judge forbids the fix and improve demands the words', () => {
    // rejects: collapsing judge into improve. A Judge round that collects fixes
    // never gets its verdict, and the two are one word apart in a dropdown.
    expect(roundKindParticipantInstruction('judge')).toMatch(/do not fix it/i);
    expect(roundKindParticipantInstruction('improve')).toMatch(/rewrite it/i);
  });

  test('the old generic fallback is gone from the vocabulary', () => {
    // rejects: the exact sentence that made every non-matching set say the same
    // wrong thing. It must not reappear as a "sensible default" for custom.
    for (const id of ROUND_KIND_IDS) {
      expect(roundKindParticipantInstruction(id))
        .not.toMatch(/share your experiences and insights/i);
    }
  });

  test('custom returns the operator line and invents nothing when it is empty', () => {
    // rejects: a `|| 'Engage thoughtfully…'` fallback on the custom path, which
    // would rebuild the defect in the one place the operator explicitly took
    // responsibility for the wording.
    expect(roundKindParticipantInstruction('custom', '  Pick one and say why.  '))
      .toBe('Pick one and say why.');
    expect(roundKindParticipantInstruction('custom', '')).toBe('');
  });
});

describe('the direction reaches only the engagement types it means anything for', () => {
  test('call-and-answer and poll, and nothing else', () => {
    // rejects: applying a discussion-round direction to trivia (which has a
    // correct answer, so "invention" and "verdict" are meaningless) or to
    // wavelength (which hands the room a bare subject and no material at all).
    expect(roundKindApplies('call-and-answer')).toBe(true);
    expect(roundKindApplies('poll')).toBe(true);
    expect(roundKindApplies('trivia')).toBe(false);
    expect(roundKindApplies('wavelength')).toBe(false);
    expect(roundKindApplies('survey')).toBe(false);
    expect(roundKindApplies(undefined)).toBe(false);
  });
});

describe('the detail ceiling', () => {
  test('apply and improve are raised; produce is not', () => {
    // rejects: a flat ceiling. lengthGuidance is appended LAST and a model
    // weights the most recent formatting instruction most heavily, so 350
    // characters silently beats an Apply direction that needs the material
    // carried — and the exemplar set's Detail_lesson fields run 400-700.
    expect(roundKindDetailCeiling('call-and-answer', 'apply')).toBe(900);
    expect(roundKindDetailCeiling('call-and-answer', 'improve')).toBe(900);
    expect(roundKindDetailCeiling('call-and-answer', 'produce')).toBe(350);
  });

  test('a type that takes no direction keeps the ordinary ceiling', () => {
    // rejects: letting a stray roundKind on a trivia set widen its questions to
    // 900 characters, which is the runaway-output bug the limits exist for.
    expect(roundKindDetailCeiling('trivia', 'apply')).toBe(350);
    expect(roundKindDetailCeiling('wavelength', 'improve')).toBe(350);
  });
});

describe('only `custom` can be incomplete', () => {
  test('the four named kinds are always ready to generate', () => {
    // rejects: a required-field check that blocks Produce because no brief was
    // typed — the four named kinds supply their own direction and instruction.
    for (const id of ['produce', 'apply', 'improve', 'judge']) {
      expect(roundKindGaps(id, { brief: '', instruction: '' })).toEqual([]);
    }
  });

  test('custom names WHICH box is empty', () => {
    // rejects: returning a bare boolean and disabling a button with no reason
    // given. An operator who cannot see which field is missing retypes both.
    expect(roundKindGaps('custom', { brief: '', instruction: '' })).toEqual(['brief', 'instruction']);
    expect(roundKindGaps('custom', { brief: 'Do a thing', instruction: '' })).toEqual(['instruction']);
    expect(roundKindGaps('custom', { brief: 'Do a thing', instruction: 'Say why' })).toEqual([]);
  });

  test('whitespace is not an answer', () => {
    // rejects: a truthiness check, which would send the generator a direction
    // block containing three spaces.
    expect(roundKindGaps('custom', { brief: '   ', instruction: '\t' })).toEqual(['brief', 'instruction']);
  });
});

describe('the brief ceiling', () => {
  test('matches the number the backend refuses above', () => {
    // rejects: a client cap that differs from the server's, which turns a
    // typed-in direction into an unexplained 400 at save time.
    expect(MAX_ROUND_KIND_BRIEF).toBe(500);
  });
});
