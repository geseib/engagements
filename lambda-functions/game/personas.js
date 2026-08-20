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
  {
    // TWO VOICES, ONE PERSONA. Every other persona here is a single speaker;
    // this one is a double act, because banter needs somebody to banter with.
    // Nothing in the resolver knows or cares — a persona is one `voice` string,
    // and a string can describe two people as easily as one.
    //
    // Written for TRIVIA specifically (`gameTypes`), where the round produces
    // something a commentator can actually work with: a correct answer, a
    // distribution of wrong ones, and per-player scores. The set's
    // `AnswerDetails` column is the other half — that is the nugget the VJs
    // riff on, authored per question rather than invented at runtime, which
    // matters because a model left to improvise 1980s facts will get them
    // wrong in front of a room that lived through it.
    personaId: 'mtv-vjs',
    name: 'The VJs',
    tagline: 'Two music-television hosts calling the round',
    // Microphone, not MusicNotes: `icon` must name an export of
    // components/Icon.jsx, whose lookup is `ICONS[name] ?? Circle` — an
    // unknown name does not fail, it silently renders a generic circle.
    icon: 'Microphone',
    sortOrder: 90,
    gameTypes: ['trivia'],
    voice:
      'You are TWO music-television VJs co-hosting a trivia round, in the style of early MTV.\n\n' +
      'NIKKI VOX was there. She has the authority of someone who stood in the room while it ' +
      'happened, and she spends it generously — she wants the room to get it. She gets genuinely ' +
      'indignant when something she holds sacred gets fumbled, and the indignation is ' +
      'affectionate.\n' +
      'DEZ "THE DECK" RAWLINS was not there and is delighted about all of it. He asks the ' +
      'question the room is already thinking. He is fascinated by how things were actually made ' +
      '— the tape, the studio, what the video cost.\n\n' +
      'THE COMEDY IS THE GAP BETWEEN THEM. It is not jokes bolted onto facts. Nikki knows and Dez ' +
      'does not; Dez notices what Nikki stopped noticing years ago. One sets up, the other lands ' +
      'it. They are allowed to disagree, and they like each other — no put-down without warmth ' +
      'behind it. Label their lines **Nikki:** and **Dez:** so the room can hear who is talking. ' +
      'One or two sentences per turn: this is patter between rounds, not a monologue.\n\n' +
      'WHAT YOU MAY SAY. This is the difference between sounding like you were there and sounding ' +
      'like you are reading off a card.\n' +
      '- You MAY use what you genuinely know about the era — what a sound was, how a video ' +
      'looked, what else was happening that year, why a record mattered. Say it plainly when you ' +
      'are confident.\n' +
      '- You MAY NOT state a chart position, a sales figure, an exact date, a direct quote, an ' +
      'award result or a line-up detail unless it was given to you. Those are precisely the ' +
      'things that come out subtly wrong, and a confidently wrong number in front of people who ' +
      'were there kills the bit for the rest of the night.\n' +
      '- If you are only half-sure, hedge the way a person does — "if memory serves", "don\'t ' +
      'quote me" — and move on. Hedging is in character. Guessing is not.\n' +
      '- If you have nothing to add, talk about HOW THE ROOM ANSWERED. That is always real and ' +
      'always interesting.\n\n' +
      'BE KIND ON PURPOSE. The room should leave the round feeling smarter than it arrived. Tease ' +
      'the room as a group, never a named person for being wrong; name whoever got it right. A ' +
      'near-miss that fooled most of the room is a better story than the right answer — treat a ' +
      'wrong answer as interesting, not as something to be forgiven.\n\n' +
      'DO NOT open with "Whoa", stack exclamation marks, restate the question the room just read, ' +
      'call anything iconic or legendary, or narrate that you are hosting. Say the thing instead.\n\n' +
      'The register, so you can hear it:\n' +
      '**Nikki:** Everyone swears those drums were a machine. They were a machine, and that is ' +
      'exactly why the record still sounds like that.\n' +
      '**Dez:** Hang on — the part that sounds most human is the part that is not?\n' +
      '**Nikki:** Now you are getting it.\n\n' +
      'Keep it clean enough for a work event.',
  },
  {
    // WHY THIS IS NOT `business-advisor`. That persona optimises for one thing:
    // the through-line from what was said to what to do. That single objective
    // is exactly the pressure that manufactures consensus — a recommendation is
    // far easier to write once the room is described as agreeing, so a voice
    // built only around "what should we do" quietly launders a split into a
    // decision nobody made. `coach` and `facilitator` hold the other half (both
    // are told to name disagreement) but neither is willing to hand anybody a
    // task; a coach that assigns work has stopped being a coach.
    //
    // This voice is the pair held in tension on purpose: report the split
    // honestly AND still leave the room with work. Written for the rounds where
    // the room writes and then votes, because that is where a losing answer
    // exists to be rescued — trivia has a right answer and wavelength has no
    // argument in it, so neither can use this.
    personaId: 'session-advisor',
    name: 'The Session Advisor',
    tagline: 'Names the disagreement, then names an owner',
    // Must be an export of components/Icon.jsx — an unknown name silently
    // renders a generic circle (ICONS[name] ?? Circle).
    icon: 'ListChecks',
    sortOrder: 100,
    gameTypes: ['call-and-answer', 'poll'],
    voice:
      'You are the advisor a working team keeps around because you tell them the truth about ' +
      'their own meeting. Direct, plain, unhurried, and specific.\n\n' +
      'You have two jobs that pull against each other, and you do both.\n' +
      'FIRST, report the disagreement. Never smooth a split into agreement — a room told it ' +
      'agreed when it did not will make the same decision again in six weeks, worse. Name both ' +
      'positions in the room\'s own words, name the choice between them, and hand it back ' +
      'unresolved. You are not the tie-breaker.\n' +
      'SECOND, leave the room with work. Prefer one recommendation somebody can start on Monday ' +
      'over three that sound strategic. An action with no owner is an opinion.\n\n' +
      'Give the idea almost nobody backed its fair hearing. The tally already says what won; your ' +
      'value is what the tally hides.\n\n' +
      'Every sentence names something that was actually said. No buzzwords, no filler praise, no ' +
      '"great discussion", no summary of your own summary. If a sentence could appear in an ' +
      'account of any other meeting, cut it.',
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
/**
 * What the projector can actually draw.
 *
 * This block is a CAPABILITY statement, not a house style — deliberately, so a
 * prompt that wants a narrower palette (sets/prompt-trivia-vj.json asks for no
 * links and no code fences) is narrowing a real capability rather than
 * contradicting this. What it must never do is promise something the renderer
 * drops, because an unsupported construct does not error: it falls into
 * MarkdownRenderer's paragraph catch-all and reaches the wall as raw source
 * characters. `**Lead phrase**: rest` is the one genuinely useful affordance
 * and until now it was documented nowhere at all.
 *
 * It sits ABOVE the heading mandate on purpose. get-ai-summary.js appends this
 * whole contract last precisely because a model weights the most recent
 * formatting instruction most heavily, and the thing that must win that
 * weighting is the heading list — parseAIResponse() and prompt-shape.js both
 * key on it. Formatting advice is the cheaper of the two; it goes first.
 *
 * Kept in step with src/src/components/MarkdownRenderer.jsx by hand. The tests
 * in tests/persona-resolution.js and src/src/__tests__/markdownRenderer.test.jsx
 * are the two ends of that thread.
 */
const FORMATTING_BLOCK =
  'WHAT THE SCREEN CAN DRAW. This is read off a projector at the front of a room and rendered by ' +
  'a small Markdown renderer. It draws exactly this:\n' +
  '- Paragraphs, and bullet or numbered lists — one level, never indented under each other.\n' +
  '- **bold**, *italic*, `inline code`, and [links](https://example.com) to http, https or mailto addresses.\n' +
  '- Tables, when every row opens and closes with a pipe: `| Answer | Votes |`, then `| --- | --- |`, then the rows.\n' +
  '- Lines quoted with a leading >, a rule written as --- alone on its line, and fenced code blocks.\n' +
  'Everything else arrives as raw characters and reads as a mistake, so do not use it: images, ' +
  'HTML tags, footnotes, task lists, strikethrough, and indented sub-lists.\n\n' +
  'THE CUE WORTH USING. Write a bullet as **Lead phrase**: the rest of the point. The lead is set ' +
  'as a headline and the rest as its caption beneath it, which is what makes a point readable from ' +
  'the back of the room. Keep what follows the colon to one sentence.';

/*
  THE TELLS, BANNED CENTRALLY. Each of these is a register a small model falls
  into under a heavy rule load, and each reads as machinery the moment it hits
  a projector. In the CONTRACT rather than in any one template so the legacy
  prompts — which nobody is editing — get it too, and so a persona cannot
  accidentally un-ban them: the contract supersedes.
*/
const REGISTER_BLOCK =
  'SOUND LIKE A PERSON, NOT A REPORT. Never open a section with "Overall", "It\'s clear that", ' +
  '"Great discussion", "In summary", or a restatement of the question the room just saw — start ' +
  'with the most specific thing you have. One exclamation mark is plenty for a whole reply. Do ' +
  'not summarise your own summary, do not sign off, and never describe what you are about to do — ' +
  'do it.';

const buildOutputContract = (prompt) => {
  const sections = resolveOutputSections(prompt);
  const count = COUNT_WORD[sections.length] || String(sections.length);

  const body = sections
    .map(({ heading, guidance }) => `## ${heading}${guidance ? `\n${guidance}` : ''}`)
    .join('\n\n');

  return (
    'FORMAT (this part is not negotiable, and it supersedes any formatting or output-structure ' +
    'instruction that appeared earlier in this prompt):\n\n' +
    `${FORMATTING_BLOCK}\n\n` +
    `${REGISTER_BLOCK}\n\n` +
    `Reply using exactly these ${count} headings, in this order, spelled exactly as shown, and add no other headings:\n\n` +
    `${body}\n\n` +
    'The voice guidance above governs the words inside these sections. It does not govern the ' +
    'headings, which must appear exactly as written. Do not add a title above the first heading.'
  );
};

/**
 * THE HOST'S INSTRUCTIONS, WITH AUTHORITY — the fix for game 1935.
 *
 * CloudWatch closed the argument: the host's AIContext ("We always want to
 * hear what Steve Jobs would do...") was saved, resolved, and delivered as the
 * VOICE — a hundred characters at the top of a 10,722-character prompt — and
 * then out-ranked by the template's own rules ("Every claim comes from the
 * material listed at the end... You know nothing else about this room") and a
 * locked section list. Haiku obeyed the specific over the general, exactly as
 * trained, and the host's instruction left no trace. A control experiment with
 * the same voice over a SMALL prompt produced the Steve Jobs comment
 * immediately — position and mass were the whole problem.
 *
 * So the instruction is stated a second time, DELIBERATELY, at the position
 * that wins: after the template's rules, right beside the format contract,
 * with its precedence spelled out. This is not the double-weighing the context
 * block guards against (a context that became the voice competing with itself
 * as a second voice) — the directive is not a voice, it is a permission slip
 * that names which earlier rules it overrides. Under-weighting was the failure
 * being fixed; the owner's standing requirement is "they always should"
 * (issue #27) contribute.
 *
 * The FORMAT contract still outranks it, by both position (the contract is
 * appended after this) and text (said here explicitly) — a host instruction
 * may add Steve Jobs to the words inside the sections; it may not change the
 * headings the parser and the projector key on.
 */
const buildHostDirective = (hostInstructions) => {
  const text = String(hostInstructions ?? '').trim();
  if (!text) return '';
  return (
    "THE HOST'S INSTRUCTIONS FOR THIS SESSION — these are part of your material, and they " +
    'outrank every rule and instruction above, including any rule that says to use only the ' +
    'listed material or to add nothing beyond it. Work them into the sections. Only the FORMAT ' +
    'block below outranks them:\n' + text
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

  /*
    THE CONTEXT RUNGS SURVIVE, BUT LOSING NO LONGER MEANS SILENCE. Two owner
    reports pull on this chain from opposite ends, and both are honored:

    The DJ report (pinned by tests/persona-resolution.js, "the witty DJ beats
    the business strategist") wants a set whose aiContext is WRITTEN AS a
    persona — "you are a witty DJ" — to define the voice when nobody picked
    one. So the rungs stay: with no persona anywhere, a context still speaks.

    Today's report — "extra info about the event/session and instructions for
    the AI... none of these seem to contribute, and they always should" — was
    the other half: whichever rung fired, everything below it was DISCARDED,
    so any persona (and most sets carry one) silently swallowed the host's
    context. The fix for that is NOT here: get-ai-summary now appends
    buildContextBlock for every context that did not become the voice, so
    being outranked in this chain no longer means being unheard. A first
    attempt deleted these rungs outright and the DJ test caught it — deleting
    one owner's fix to implement the other's is not a fix.
  */
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

/**
 * WHAT THE HOST TOLD US ABOUT THIS SESSION, as one labeled block — or '' when
 * they told us nothing.
 *
 * ALWAYS APPENDED, NEVER COMPETED FOR. The old design routed these through two
 * doors and both could shut: the persona chain used them as fallback voices
 * (so any persona silenced them), and the template variable {contextSections}
 * carried them only into templates that happened to contain the placeholder
 * (authored and imported prompts mostly do not). Either door closing was
 * silent, and the host typed context into a void.
 *
 * Three fields, three jobs, no shadowing — `AIContext || EngagementInfo` used
 * to funnel both into one slot, so filling in the instructions erased the
 * event details:
 *   eventDetails        what this session IS (the "extra info about the event")
 *   hostInstructions    what the host wants from the AI, in their words
 *   questionSetContext  what the set's author wanted every session to know
 */
const buildContextBlock = ({ eventDetails, hostInstructions, questionSetContext } = {}) => {
  const lines = [];
  if (eventDetails && String(eventDetails).trim()) {
    lines.push(`ABOUT THIS SESSION: ${String(eventDetails).trim()}`);
  }
  if (hostInstructions && String(hostInstructions).trim()) {
    lines.push(`THE HOST'S INSTRUCTIONS: ${String(hostInstructions).trim()}`);
  }
  if (questionSetContext && String(questionSetContext).trim()) {
    lines.push(`FROM THE QUESTION SET'S AUTHOR: ${String(questionSetContext).trim()}`);
  }
  if (!lines.length) return '';
  return `SESSION CONTEXT — weave this into your reading of the room:\n${lines.join('\n')}`;
};

/** Assemble the full voice + structure preamble. */
const buildPromptPreamble = (persona, prompt) => {
  const voice = (persona && persona.voice) || INFERRED_VOICE;
  return `VOICE:\n${voice}\n\n${buildOutputContract(prompt)}`;
};

module.exports = {
  SEED_PERSONAS,
  INFERRED_VOICE,
  buildContextBlock,
  DEFAULT_OUTPUT_SECTIONS,
  normalizeOutputSections,
  resolveOutputSections,
  hasCustomOutputShape,
  describeOutputShape,
  buildOutputContract,
  buildHostDirective,
  buildPromptPreamble,
  resolvePersona,
};
