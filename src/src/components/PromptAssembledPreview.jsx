import React, { useMemo, useState } from 'react';
import { extractVariableTokens } from '../config/templateVariables';
import { normalizeGameType } from '../config/gameTypes';
import { promptOutputHeadings, DEFAULT_OUTPUT_HEADINGS } from './PromptShapePreview';
import {
  sampleTemplateVars,
  SAMPLE_ROOM_SIZES,
  DEFAULT_ROOM_SIZE,
} from './PromptVariableInspector';

/**
 * WHAT ACTUALLY REACHES THE MODEL.
 *
 * THE DEFECT THIS EXISTS FOR. A session authored one prompt with unusual care,
 * ran it end to end, and shipped six defects — every one of them visible in the
 * prompt text before save, and the author had no way to see any of them. The
 * sharpest is D2: rule 10 was written
 *
 *     "If {responseCount} is 0, write one plain line…"
 *
 * and the substitution loop at get-ai-summary.js:2214-2217 replaces every
 * `{token}` EVERYWHERE, including inside prose that was talking ABOUT the
 * field. So the model was handed
 *
 *     "If 11 is 0, write one plain line…"
 *
 * Rule 4 rendered at 1,557 characters, 1,390 of them inlined tally. Three of
 * fourteen rules arrived unreadable. Every existing gate passed:
 * `debugInfo.unresolvedVariables` was empty on all six rounds, because H13
 * tests for a token with NO key and this is a token with a key, used as a noun.
 *
 * One glance at the substituted text is the whole fix.
 *
 * THE SIZE NUMBERS, and why occupancy is the one that matters. In the measured
 * 18,072-character prompt, `responsesText` (2,244), `voteTally` (635) and
 * `votingBreakdown` (732) each appeared TWICE — 7,222 characters, 40.0% of the
 * whole, of which 3,611 is pure duplication. Nothing in the product told the
 * author that naming a variable in a sentence inlines two kilobytes of answers
 * into it.
 *
 * WHERE THE NUMBERS COME FROM, and why not from the preflight report.
 * `preflightPrompt()` returns `stats: { assembledChars, variablesUsed,
 * inlinedChars, duplicatedChars, estimatedWords }` and they are good numbers —
 * but they are computed from a fixed per-variable size table, so they cannot
 * move when the author changes the sample room. Displaying them beside a
 * preview that DOES move would put a number on screen that does not describe
 * the text under it, which is the class of defect this whole screen exists to
 * remove. So every figure here is measured from the exact string rendered
 * below it, and the preflight's own size finding carries its own figure.
 * Neither is wrong; they answer different questions and each says which.
 *
 * THE FRAME IS SHOWN TOO, and it is not optional. `get-ai-summary.js:2181`
 * assembles `VOICE + your prompt + FORMAT contract`, so the authored text is
 * never the whole prompt. Roughly 10.9 KB of the measured prompt was fixed
 * text. A size figure that counts only the middle third is the kind of number
 * that gets quoted and is wrong.
 */

/* ------------------------------------------------------------- assembly --- */

/**
 * The FORMAT block get-ai-summary.js appends last.
 *
 * Mirrors `buildOutputContract` in lambda-functions/game/personas.js, the same
 * way PromptShapePreview mirrors prompt-shape.js: the lambda is a separate
 * CodeUri and a separate bundle, so importing it here is not possible. Only the
 * heading list varies with the prompt; the rest is a constant, and its LENGTH
 * is the point — it is the part of the prompt an author cannot see and cannot
 * shorten.
 */
const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

const FORMATTING_BLOCK =
  'WHAT THE SCREEN CAN DRAW. This is read off a projector at the front of a room and rendered by '
  + 'a small Markdown renderer. It draws exactly this:\n'
  + '- Paragraphs, and bullet or numbered lists — one level, never indented under each other.\n'
  + '- **bold**, *italic*, `inline code`, and [links](https://example.com) to http, https or mailto addresses.\n'
  + '- Tables, when every row opens and closes with a pipe: `| Answer | Votes |`, then `| --- | --- |`, then the rows.\n'
  + '- Lines quoted with a leading >, a rule written as --- alone on its line, and fenced code blocks.\n'
  + 'Everything else arrives as raw characters and reads as a mistake, so do not use it: images, '
  + 'HTML tags, footnotes, task lists, strikethrough, and indented sub-lists.\n\n'
  + 'THE CUE WORTH USING. Write a bullet as **Lead phrase**: the rest of the point. The lead is set '
  + 'as a headline and the rest as its caption beneath it, which is what makes a point readable from '
  + 'the back of the room. Keep what follows the colon to one sentence.';

/**
 * Reused, not re-derived. `promptOutputHeadings` already mirrors
 * prompt-shape.js for the set editor and the upload form, and a second copy of
 * "which headings does this prompt produce" is exactly the drift that gave this
 * repo three disagreeing variable catalogues.
 */
export function resolveOutputHeadings(outputSections) {
  return promptOutputHeadings({ outputSections });
}

export function buildOutputContract(outputSections) {
  const sections = Array.isArray(outputSections) && outputSections.length
    ? outputSections
    : DEFAULT_OUTPUT_HEADINGS.map((heading) => ({ heading, guidance: '' }));
  const headings = resolveOutputHeadings(outputSections);
  const count = COUNT_WORD[headings.length] || String(headings.length);
  const body = headings
    .map((heading, i) => {
      const guidance = sections[i] && typeof sections[i].guidance === 'string' ? sections[i].guidance : '';
      return `## ${heading}${guidance ? `\n${guidance}` : ''}`;
    })
    .join('\n\n');

  return (
    'FORMAT (this part is not negotiable, and it supersedes any formatting or output-structure '
    + 'instruction that appeared earlier in this prompt):\n\n'
    + `${FORMATTING_BLOCK}\n\n`
    + `Reply using exactly these ${count} headings, in this order, spelled exactly as shown, and add no other headings:\n\n`
    + `${body}\n\n`
    + 'The voice guidance above governs the words inside these sections. It does not govern the '
    + 'headings, which must appear exactly as written. Do not add a title above the first heading.'
  );
}

/**
 * A stand-in for the persona voice.
 *
 * The real one is resolved at request time from six sources in precedence order
 * (personas.js `resolvePersona`) — a host pick, the set's persona, free-text AI
 * context on the set or game, an inferred adaptive voice, and finally the
 * prompt's own instructions. None of them are knowable in this editor. It is
 * shown, labelled as an estimate, because leaving it out understates the
 * assembled size by about a kilobyte and the author would budget against a
 * number that is not the number.
 */
const VOICE_STANDIN =
  'You are the advisor a working team keeps around because you tell them the truth about their own '
  + 'meeting. Direct, plain, unhurried, and specific. Every sentence names something that was actually '
  + 'said. No buzzwords, no filler praise, no summary of your own summary. If a sentence could appear '
  + 'in an account of any other meeting, cut it.';

/**
 * Substitute exactly the way the lambda substitutes: one global replace per
 * key, over the WHOLE prompt, in `templateVars` order — prose included.
 */
export function substitute(text, vars) {
  let out = typeof text === 'string' ? text : '';
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * The body the lambda builds: a legacy single-field `template`, or
 * `instructions + '\n\n' + outputFormat` (get-ai-summary.js:2160-2172).
 */
export function promptBody({ template, instructions, outputFormat }) {
  if (template) return template;
  return `${instructions || ''}\n\n${outputFormat || ''}`;
}

export function assemblePrompt({
  template,
  instructions,
  outputFormat,
  outputSections,
  gameType,
  roomSize = DEFAULT_ROOM_SIZE,
}) {
  const vars = sampleTemplateVars(normalizeGameType(gameType), roomSize);
  const authored = promptBody({ template, instructions, outputFormat });
  const contract = buildOutputContract(outputSections);
  const body = substitute(authored, vars);

  return {
    vars,
    authored,
    voice: VOICE_STANDIN,
    body,
    contract,
    text: `VOICE:\n${VOICE_STANDIN}\n\n${body}\n\n${contract}`,
  };
}

/**
 * How much of the prompt is data, and how much of the data is there twice.
 *
 * `inlinedChars` is occupancy: every occurrence of every token, at its rendered
 * length. `duplicatedChars` is the part of that occupancy a second and third
 * occurrence added — the characters the model reads twice for no instruction.
 */
export function measureAssembly(assembly) {
  const { authored, vars, text } = assembly;
  const names = extractVariableTokens(authored);

  const variables = names.map((name) => {
    const known = Object.prototype.hasOwnProperty.call(vars, name);
    const value = known ? String(vars[name]) : '';
    const occurrences = authored.split(`{${name}}`).length - 1;
    return {
      name,
      known,
      occurrences,
      valueChars: value.length,
      totalChars: known ? value.length * occurrences : 0,
      duplicateChars: known ? value.length * Math.max(0, occurrences - 1) : 0,
    };
  });

  const inlinedChars = variables.reduce((sum, v) => sum + v.totalChars, 0);
  const duplicatedChars = variables.reduce((sum, v) => sum + v.duplicateChars, 0);

  return {
    assembledChars: text.length,
    estimatedWords: text.trim() ? text.trim().split(/\s+/).length : 0,
    inlinedChars,
    duplicatedChars,
    // A COUNT, matching `preflightPrompt()`'s `stats.variablesUsed`, so the two
    // shapes cannot be confused if they ever meet. The per-variable detail is
    // the additive `variables` array beside it.
    variablesUsed: variables.length,
    variables,
  };
}

/* ----------------------------------------------------------------- view --- */

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const num = (n) => Number(n).toLocaleString('en-US');

function SizeBar({ stats }) {
  const total = Math.max(1, stats.assembledChars);
  const inlined = Math.min(stats.inlinedChars, total);
  return (
    <div className="pap-bar" data-testid="pap-size-bar">
      <div className="pap-bar-track">
        <div className="pap-bar-inlined" style={{ width: `${pct(inlined, total)}%` }} />
      </div>
      <div className="pap-bar-key">
        <span className="pap-key pap-key--inlined">
          {num(stats.inlinedChars)} chars ({pct(stats.inlinedChars, total)}%) is substituted data
        </span>
        <span className="pap-key pap-key--authored">
          the rest is instruction &mdash; yours and the system&rsquo;s
        </span>
      </div>
    </div>
  );
}

/**
 * The preview.
 *
 * Three blocks, in the order the lambda concatenates them, because seeing the
 * frame is the only way the size figure means anything. The middle block is the
 * only one an author can change.
 */
export default function PromptAssembledPreview({
  template,
  instructions,
  outputFormat,
  outputSections,
  gameType,
  roomSize: controlledRoomSize,
  onRoomSizeChange,
}) {
  const [localRoomSize, setLocalRoomSize] = useState(DEFAULT_ROOM_SIZE);
  const roomSize = controlledRoomSize || localRoomSize;
  const setRoomSize = (id) => {
    setLocalRoomSize(id);
    if (onRoomSizeChange) onRoomSizeChange(id);
  };

  const assembly = useMemo(
    () => assemblePrompt({ template, instructions, outputFormat, outputSections, gameType, roomSize }),
    [template, instructions, outputFormat, outputSections, gameType, roomSize]
  );
  const stats = useMemo(() => measureAssembly(assembly), [assembly]);
  const duplicated = stats.variables.filter((v) => v.occurrences > 1 && v.known);
  const room = SAMPLE_ROOM_SIZES.find((r) => r.id === roomSize) || SAMPLE_ROOM_SIZES[2];

  return (
    <div className="pap" data-testid="prompt-assembled-preview">
      <div className="pap-head">
        <div>
          <h4>What the model is handed</h4>
          <p className="pap-sub">
            Substituted, not templated. This is the string, in the order
            <code> get-ai-summary.js </code> concatenates it.
          </p>
        </div>
        <div className="pap-room" role="group" aria-label="Sample room size">
          {SAMPLE_ROOM_SIZES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`pap-room-btn${r.id === roomSize ? ' is-on' : ''}`}
              aria-pressed={r.id === roomSize}
              onClick={() => setRoomSize(r.id)}
              title={r.why}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="pap-roomwhy">{room.why}</p>

      <div className="pap-stats" data-testid="pap-stats">
        <div className="pap-stat">
          <span className="pap-stat-n">{num(stats.assembledChars)}</span>
          <span className="pap-stat-l">characters assembled</span>
        </div>
        <div className="pap-stat">
          <span className="pap-stat-n">{num(stats.estimatedWords)}</span>
          <span className="pap-stat-l">words, roughly</span>
        </div>
        <div className="pap-stat">
          <span className="pap-stat-n">{num(stats.inlinedChars)}</span>
          <span className="pap-stat-l">inlined data, not instruction</span>
        </div>
        <div className={`pap-stat${stats.duplicatedChars > 0 ? ' pap-stat--bad' : ''}`}>
          <span className="pap-stat-n">{num(stats.duplicatedChars)}</span>
          <span className="pap-stat-l">the model reads twice</span>
        </div>
      </div>

      <SizeBar stats={stats} />

      {duplicated.length > 0 && (
        <div className="pap-dupe" data-testid="pap-duplication">
          <strong>
            {duplicated.length === 1
              ? 'One variable appears more than once.'
              : `${duplicated.length} variables appear more than once.`}
          </strong>{' '}
          Every occurrence inlines the whole value again.
          <ul>
            {duplicated.map((v) => (
              <li key={v.name}>
                <code>{`{${v.name}}`}</code> &times;{v.occurrences} &mdash; {num(v.valueChars)}{' '}
                characters each, {num(v.duplicateChars)} of them repeated
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pap-blocks">
        <section className="pap-block pap-block--frame">
          <header>
            <h5>1. VOICE</h5>
            <span className="pap-block-size">{num(assembly.voice.length)} chars &middot; estimated</span>
          </header>
          <p className="pap-block-note">
            Resolved at request time from the persona attached to the set, a host pick, or an
            inferred adaptive voice. You cannot see the real one from here; this is a stand-in of
            typical length so the total is not understated.
          </p>
          <pre className="pap-text pap-text--dim">{assembly.voice}</pre>
        </section>

        <section className="pap-block pap-block--yours">
          <header>
            <h5>2. Your prompt, substituted</h5>
            <span className="pap-block-size">{num(assembly.body.length)} chars</span>
          </header>
          <pre className="pap-text" data-testid="pap-body">{assembly.body}</pre>
        </section>

        <section className="pap-block pap-block--frame">
          <header>
            <h5>3. FORMAT contract</h5>
            <span className="pap-block-size">{num(assembly.contract.length)} chars &middot; system</span>
          </header>
          <p className="pap-block-note">
            Appended after your text, always, and it overrides formatting instructions above it. You
            change it only by declaring output sections.
          </p>
          <pre className="pap-text pap-text--dim">{assembly.contract}</pre>
        </section>
      </div>
    </div>
  );
}
