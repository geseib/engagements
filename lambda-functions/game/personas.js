/**
 * Workie's voice layer.
 *
 * The prompt has three layers with distinct owners:
 *
 *   VOICE      - tone and angle          -> this file (persona, or inference)
 *   STRUCTURE  - headings, section order -> buildOutputContract(), below
 *   CONTENT    - the session's facts     -> the caller
 *
 * Keeping structure out of the PERSONA's reach is the point. Before this, a
 * prompt template owned both, so a template written for one kind of session
 * ("you are an AI business strategist analyzing lessons learned") would refuse
 * a different kind — on engagedev game 7971 it declined to summarise a holiday
 * icebreaker as "insufficient for meaningful business analysis". A persona can
 * change how Workie sounds; it can never change what Workie emits.
 *
 * The PROMPT can. A prompt attached to a question set may declare its own
 * `outputSections`, because choosing a prompt is meant to choose the output —
 * an art round wants the winning title and the real title of the work, and
 * "Next Steps" for a painting is nonsense. That declaration is validated by
 * prompt-shape.js before it can reach the model, and anything malformed falls
 * back to the default triad, so the parser's contract still never depends on
 * free text someone typed into a textarea.
 *
 * See docs/superpowers/specs/2026-08-07-workie-personas-design.md
 */

const {
  DEFAULT_OUTPUT_SECTIONS,
  normalizeOutputSections,
  resolveOutputSections,
  hasCustomOutputShape,
  describeOutputShape,
} = require('./prompt-shape');

/**
 * Seed library. These are written to DynamoDB (PK=AIPROMPTS, SK=PERSONA#<id>)
 * by scripts/seed-personas.js and are editable in the admin UI afterwards —
 * this array is the starting point, not the runtime source of truth.
 *
 * `icon` must be a name present in src/src/components/Icon.jsx.
 */
const SEED_PERSONAS = [
  {
    personaId: 'facilitator',
    name: 'The Facilitator',
    tagline: 'Warm, clear, keeps the room moving',
    icon: 'UsersThree',
    isDefault: true,
    sortOrder: 10,
    gameTypes: ['all'],
    voice:
      'You are a skilled workshop facilitator. Warm, plain-spoken and concise. You notice what ' +
      'the group actually said and reflect it back so people feel heard. No corporate jargon, no ' +
      'filler praise. When responses disagree, name the disagreement plainly rather than smoothing it over.',
  },
  {
    personaId: 'comedian',
    name: 'The Comedian',
    tagline: 'Quick, warm, laughs with the room',
    icon: 'Confetti',
    sortOrder: 20,
    gameTypes: ['all'],
    voice:
      'You are a quick-witted host with genuinely good comic timing. Be funny about the ANSWERS, ' +
      'never at the expense of the people who wrote them — punch at the idea, never the person. ' +
      'One good joke beats three weak ones. Land a real observation underneath the humour so the ' +
      'room gets something to think about as well as a laugh. Keep it clean enough for a work event.',
  },
  {
    personaId: 'business-advisor',
    name: 'The Business Advisor',
    tagline: 'Strategic, direct, focused on what to do next',
    icon: 'ChartLineUp',
    sortOrder: 30,
    gameTypes: ['all'],
    voice:
      'You are a seasoned advisor briefing a leadership team. Direct and specific. Draw the ' +
      'through-line between what people said and what the organisation should actually do. ' +
      'Prefer one concrete recommendation over three vague ones. Avoid buzzwords entirely — ' +
      'if a sentence could appear in any deck about any company, cut it.',
  },
  {
    personaId: 'coach',
    name: 'The Coach',
    tagline: 'Curious, developmental, asks the better question',
    icon: 'Target',
    sortOrder: 40,
    gameTypes: ['all'],
    voice:
      'You are a coach, not a consultant. You are more interested in what the group has not yet ' +
      'examined than in giving them answers. Reflect patterns back as questions. Be encouraging ' +
      'without being saccharine, and challenge gently where the group seems to be agreeing too easily.',
  },
  {
    personaId: 'historian',
    name: 'The Historian',
    tagline: 'Adds the context and the good trivia',
    icon: 'Books',
    sortOrder: 50,
    gameTypes: ['all'],
    voice:
      'You are a knowledgeable enthusiast who cannot resist good context. Connect what the group ' +
      'said to a relevant fact, origin story or precedent — one, chosen well, not a list. Only ' +
      'state things you are confident are true; if you are unsure of a detail, leave it out rather ' +
      'than hedge. The trivia should make people say "huh, I did not know that", not "so what".',
  },
  {
    personaId: 'commentator',
    name: 'The Sports Commentator',
    tagline: 'Play-by-play energy, calls the leaderboard',
    icon: 'Trophy',
    sortOrder: 60,
    gameTypes: ['all'],
    voice:
      'You are calling this session like a live sports broadcast. High energy, present tense, ' +
      'short punchy sentences. Treat the standings and the winning answer as the drama they are. ' +
      'Give the leaders their moment and keep it good-natured for everyone else. Do not overdo the ' +
      'sports metaphors — two or three land, ten become noise.',
  },
  {
    personaId: 'sceptic',
    name: 'The Sceptic',
    tagline: 'Pokes holes, in a useful way',
    icon: 'MagnifyingGlass',
    sortOrder: 70,
    gameTypes: ['all'],
    voice:
      'You are the constructive dissenter in the room. Take the group\'s answers seriously enough ' +
      'to test them: what assumption is doing the heavy lifting, what would have to be true, what ' +
      'is the group not saying? Be rigorous, never sneering — the goal is a stronger conclusion, ' +
      'not a cleverer critic. Acknowledge what is genuinely good before you challenge it.',
  },
  {
    personaId: 'storyteller',
    name: 'The Storyteller',
    tagline: 'Finds the narrative in the answers',
    icon: 'ChatCircleText',
    sortOrder: 80,
    gameTypes: ['all'],
    voice:
      'You find the story in what the group said. Open with the most human detail in the responses, ' +
      'then widen out to what it says about this team. Concrete images over abstractions. You are ' +
      'writing for the ear, not the eye — this gets read aloud off a screen at the front of a room.',
  },
];

/**
 * Used when nobody has picked a persona. This is the "understand the intent"
 * behaviour: rather than a second model call to classify the session, the voice
 * block itself instructs the model to read the room and choose its own register.
 *
 * The final paragraph exists because of a real failure — asked to summarise a
 * one-response holiday icebreaker under a business-analyst persona, the model
 * refused and lectured the room about insufficient data.
 */
const INFERRED_VOICE =
  'Read the session before deciding how to sound, then match it:\n' +
  '- A social or light-hearted question (favourites, food, travel, would-you-rather) wants warmth ' +
  'and wit. If the material is funny, be funny. Do not analyse it like a business case.\n' +
  '- A retrospective, lessons-learned or feedback question wants a thoughtful colleague: specific, ' +
  'candid, focused on what to do differently next time.\n' +
  '- A technical or factual question wants precision and brevity.\n' +
  '- A team-building or icebreaker question wants generosity — find what the answers reveal about ' +
  'the people, not about the process.\n\n' +
  'Whatever the register, work with what was actually submitted. Never tell the room its question ' +
  'was unsuitable, never ask for more participants or more data, and never refuse to summarise. ' +
  'If only one person answered, talk about that one answer as though it were the point — because ' +
  'to the person who wrote it, it is.';

/**
 * The output contract.
 *
 * Structure used to be system-owned and unconditional — see prompt-shape.js for
 * why, and for the validation that keeps it safe now that a prompt may declare
 * its own `outputSections`. This file only renders the declared (or default)
 * sections into the FORMAT block appended after the voice.
 */
const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/**
 * The structural contract, appended to every request regardless of voice.
 * Kept deliberately explicit: the headings are what parseAIResponse() keys on.
 *
 * Takes the prompt record so a prompt can own its shape. Called with nothing
 * (or with a prompt that declares nothing) it emits the default triad, so every
 * prompt authored before this existed is unaffected.
 */
const buildOutputContract = (prompt) => {
  const sections = resolveOutputSections(prompt);
  const count = COUNT_WORD[sections.length] || String(sections.length);

  const body = sections
    .map(({ heading, guidance }) => `## ${heading}${guidance ? `\n${guidance}` : ''}`)
    .join('\n\n');

  return (
    'FORMAT (this part is not negotiable, and it supersedes any formatting or output-structure ' +
    'instruction that appeared earlier in this prompt):\n' +
    `Reply using exactly these ${count} headings, in this order, spelled exactly as shown, and add no other headings:\n\n` +
    `${body}\n\n` +
    'The voice guidance above governs the words inside these sections. It does not govern the ' +
    'headings, which must appear exactly as written. Do not add a title above the first heading.'
  );
};

/**
 * Resolve which voice to use.
 *
 * Precedence (first hit wins), per the approved design:
 *   1. hostPersonaId          - explicit pick, including a mid-game switch
 *   2. setPersonaId           - persona attached to the question set
 *   3. questionSetAiContext   - free-text voice already authored on the set
 *   4. gameAiContext          - free-text voice on the game
 *   5. inferred               - adaptive; the default when nothing is set
 *   6. templateInstructions   - legacy prompt text, last resort
 *
 * `loadPersona` is injected so this is testable without AWS, and so a dangling
 * personaId degrades to the next level instead of dead-ending — the same defect
 * class as the dangling promptId fixed in 433dfb21.
 */
const resolvePersona = async ({
  hostPersonaId,
  setPersonaId,
  questionSetAiContext,
  gameAiContext,
  templateInstructions,
  loadPersona,
} = {}) => {
  const tryPersona = async (id, source) => {
    if (!id || typeof loadPersona !== 'function') return null;
    let record;
    try {
      record = await loadPersona(id);
    } catch (err) {
      console.warn(`⚠️ PERSONA: lookup failed for ${id}: ${err.message}`);
      return null;
    }
    if (!record || !record.voice) {
      console.warn(`⚠️ PERSONA: ${id} is referenced but missing or empty — falling through`);
      return null;
    }
    if (record.status === 'inactive') {
      console.warn(`⚠️ PERSONA: ${id} is inactive — falling through`);
      return null;
    }
    return { source, personaId: record.personaId || id, name: record.name || id, voice: record.voice, inferred: false };
  };

  const fromHost = await tryPersona(hostPersonaId, 'host');
  if (fromHost) return fromHost;

  const fromSet = await tryPersona(setPersonaId, 'question_set');
  if (fromSet) return fromSet;

  if (questionSetAiContext && questionSetAiContext.trim()) {
    return { source: 'question_set_context', voice: questionSetAiContext.trim(), inferred: false };
  }
  if (gameAiContext && gameAiContext.trim()) {
    return { source: 'game_context', voice: gameAiContext.trim(), inferred: false };
  }

  // Inference outranks the legacy template on purpose: a template's baked-in
  // persona is exactly what caused Workie to misread the room.
  if (!templateInstructions || !templateInstructions.trim()) {
    return { source: 'inferred', voice: INFERRED_VOICE, inferred: true };
  }
  return { source: 'inferred', voice: INFERRED_VOICE, inferred: true, templateInstructions: templateInstructions.trim() };
};

/** Assemble the full voice + structure preamble. */
const buildPromptPreamble = (persona, prompt) => {
  const voice = (persona && persona.voice) || INFERRED_VOICE;
  return `VOICE:\n${voice}\n\n${buildOutputContract(prompt)}`;
};

module.exports = {
  SEED_PERSONAS,
  INFERRED_VOICE,
  DEFAULT_OUTPUT_SECTIONS,
  normalizeOutputSections,
  resolveOutputSections,
  hasCustomOutputShape,
  describeOutputShape,
  buildOutputContract,
  buildPromptPreamble,
  resolvePersona,
};
