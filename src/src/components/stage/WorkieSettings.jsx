import React from 'react';

/**
 * WORKIE'S HOST OPTIONS, IN THE SESSION PANEL — not on the stage.
 *
 * These were drawn on the room-facing What We Heard beat (`.fn-controls` in
 * GameHostPage): the Voice and Approach selects, a "Briefing on" chip and
 * Redo. The stage is a shared surface in every display profile — the same
 * reason the Questions tab keeps correct answers off it — and a room reading
 * the read-back also read the host's pickers, plus a pale chip that was
 * styles.css's light-theme status bar dropped on the dark stage (QA drive
 * 2026-09-29, finding #21).
 *
 * So they live here, in the panel that already holds "everything the host
 * needs and the room does not", built from the panel's own classes
 * (`setup-h`, `setup-field`, `setup-note`, its button rule) so they take its
 * dusk palette with no stylesheet of their own. "Briefing on" is a note now,
 * not a chip.
 *
 * NEXT-ROUND PICKERS ONLY WHEN THERE IS A NEXT ROUND (`showNextRound`, from
 * config/workieOptions.js nextRoundPickersApply): a closed survey offered
 * "(next question)" pickers for a question that did not exist (#5b).
 *
 * REDO ONLY WHERE THERE IS A READ ON SCREEN. `onRedo` is null except on the
 * What We Heard beat; a Redo that rewrites nothing is a dead control.
 */
export default function WorkieSettings({
  roundNoun = 'question',
  showNextRound = true,
  personaId = '',
  personas = [],
  onPersona = () => {},
  personaStatus = '',
  promptId = '',
  prompts = [],
  onPrompt = () => {},
  promptStatus = '',
  briefed = false,
  onRedo = null,
  redoBusy = false,
}) {
  const noun = String(roundNoun || 'question').toLowerCase();
  const hasAnything = showNextRound || briefed || typeof onRedo === 'function';
  if (!hasAnything) return null;

  return (
    <div className="setup-workie" data-testid="workie-settings">
      <h3 className="setup-h">Workie</h3>

      {typeof onRedo === 'function' && (
        <>
          <div className="setup-row">
            <button
              type="button"
              data-testid="workie-redo"
              onClick={onRedo}
              disabled={redoBusy}
              title="Rewrite the summary on screen now, in the current voice"
            >
              {redoBusy ? 'Workie is writing…' : 'Redo the read on screen'}
            </button>
          </div>
          <p className="setup-note">Rewrites What We Heard now, in the voice and approach set below.</p>
        </>
      )}

      {showNextRound && (
        <>
          <label className="setup-field" htmlFor="game-persona">
            <span>{`Voice (next ${noun})`}</span>
            <select
              id="game-persona"
              value={personaId}
              onChange={(e) => onPersona(e.target.value)}
              title={`Changes Workie's voice from the next ${noun} onwards`}
            >
              <option value="">Adapt to the session</option>
              {personas.map((persona) => (
                <option key={persona.personaId} value={persona.personaId}>{persona.name}</option>
              ))}
            </select>
          </label>
          {personaStatus && <p className="setup-note" role="status">{personaStatus}</p>}

          {/* The approach: the prompt template, where the voice is only the
              register. Same next-round rule, same Redo. */}
          <label className="setup-field" htmlFor="game-prompt">
            <span>{`Approach (next ${noun})`}</span>
            <select
              id="game-prompt"
              value={promptId}
              onChange={(e) => onPrompt(e.target.value)}
              title={`Changes how Workie sums up each ${noun} from the next one onwards`}
            >
              <option value="">What the set says</option>
              {prompts.map((prompt) => (
                <option key={prompt.promptId} value={prompt.promptId}>{prompt.name}</option>
              ))}
            </select>
          </label>
          {promptStatus && <p className="setup-note" role="status">{promptStatus}</p>}
        </>
      )}

      {/* THAT Workie has the host's briefing — never the file name or the
          text (session-setup-redesign page 30). */}
      {briefed && (
        <p className="setup-note" data-testid="workie-briefed">
          Briefing on: Workie has your briefing for this session and uses it where the answers touch it.
        </p>
      )}
    </div>
  );
}
