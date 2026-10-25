/**
 * WHAT A WAVELENGTH SUBJECT IS, in the words a generation model is given.
 *
 * Wavelength is a word-association alignment game: the host shows a SUBJECT,
 * every participant lists up to 10 words for it, and the game measures how
 * many words overlap across participants.
 *
 * ONE COPY FOR THE BACKEND. It used to be pasted into populate-generation-
 * prompts.js (the seeded rows' basePrompt) and ai-generate-scenarios.js (the
 * fallback when no row matches), and the two could drift. The builder in the
 * browser (src/src/components/AIScenarioBuilder.jsx) still carries its own
 * copy; it cannot require this file.
 *
 * NO EXAMPLE SUBJECTS. The spec once gave "Remote Work" and "Customer Trust"
 * as examples, and examples in a generation prompt come back as output — a set
 * on any topic tended to open with one of them.
 */
const WAVELENGTH_SPEC = 'Create wavelength subjects for a team word-association alignment game. '
  + 'Each item is a single short, evocative SUBJECT of 1-4 words that every participant responds to '
  + 'by listing up to 10 words or short phrases that come to mind; the game then measures how many '
  + 'words overlap across participants. Pick subjects broad enough that everyone can produce 10 '
  + 'associations, yet specific enough that overlap is meaningful. Mix concrete and abstract subjects. '
  + 'Do NOT write questions, scenarios, sentences to complete, or anything with a correct answer.';

module.exports = { WAVELENGTH_SPEC };
