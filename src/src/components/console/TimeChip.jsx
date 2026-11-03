import React, { useEffect, useId, useRef, useState } from 'react';
import { TIME_PRESETS, TIMER_WORDS, presetLabel, normalizeChoice } from '../../config/roundTimer';
import './TimeChip.css';

/**
 * THE TIME CHIP (session-start D4 and frame 1-b6; experience plan 2f): a small
 * button BEFORE the opening move (Start round N, Start voting) that says the
 * time this phase will get, and opens a short list to change it.
 *
 *   - Presets only: No limit (the default, a first-class choice), 1, 2, 3, 5 min.
 *   - "Show the time on the room's window" (ticked by default, F3): the room
 *     and the phones see words and a bar, never seconds.
 *   - "Close answering at zero" (answering only, off by default, F2): advisory
 *     unless ticked.
 *
 * Not a dialog: a disclosure. Enter or a click opens it; the presets are
 * native radios, so the arrows choose; Escape or a click outside closes it.
 * Space on the chip itself still presses the main move (HostActionBar), so a
 * presenter's clicker works as it did.
 *
 * Pure props: `value` is { limitMs, onWall, closes }; `onChange` gets the next
 * value. `placement` 'up' opens above (the one-screen dock sits at the foot).
 */
export default function TimeChip({ kind = 'ask', round = null, value, onChange, placement = 'down' }) {
  const choice = normalizeChoice(value, kind);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const id = useId();
  const title = kind === 'vote' ? TIMER_WORDS.chipTitle.vote : TIMER_WORDS.chipTitle.ask(round);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // The popover's own Escape: nothing behind it (a dialog, the Session menu) hears it.
      e.stopPropagation();
      setOpen(false);
      if (buttonRef.current) buttonRef.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const set = (patch) => onChange && onChange(normalizeChoice({ ...choice, ...patch }, kind));
  const label = presetLabel(choice.limitMs);

  return (
    <span className={`tchip${open ? ' is-open' : ''}`} ref={rootRef} data-kind={kind}>
      <button
        type="button"
        ref={buttonRef}
        className={`tchip-toggle${choice.limitMs ? ' is-set' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        aria-label={TIMER_WORDS.chipButton(label)}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); setOpen((o) => !o); }
        }}
        data-testid={`time-chip-${kind}`}
      >
        <span>{label}</span>
        <span className="tchip-caret" aria-hidden="true">{placement === 'up' ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <div className={`tchip-pop tchip-pop--${placement}`} id={`${id}-pop`} role="group" aria-label={title}>
          <p className="tchip-title">{title}</p>
          <div className="tchip-presets" role="radiogroup" aria-label={title}>
            {TIME_PRESETS.map((p) => (
              <label key={p.ms} className={`tchip-preset${choice.limitMs === p.ms ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-preset`}
                  value={p.ms}
                  checked={choice.limitMs === p.ms}
                  onChange={() => set({ limitMs: p.ms })}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          <label className="tchip-tick">
            <input type="checkbox" checked={choice.onWall} onChange={(e) => set({ onWall: e.target.checked })} />
            <span>
              {TIMER_WORDS.showOnWall}
              <small>{TIMER_WORDS.showOnWallNote}</small>
            </span>
          </label>
          {kind === 'ask' ? (
            <label className={`tchip-tick${choice.limitMs ? '' : ' is-off'}`}>
              <input
                type="checkbox"
                checked={choice.closes}
                disabled={!choice.limitMs}
                onChange={(e) => set({ closes: e.target.checked })}
              />
              <span>
                {TIMER_WORDS.closeAtZero}
                <small>{TIMER_WORDS.closeAtZeroNote}</small>
              </span>
            </label>
          ) : null}
          <p className="tchip-note">{kind === 'vote' ? TIMER_WORDS.rememberedVote : TIMER_WORDS.remembered}</p>
        </div>
      ) : null}
    </span>
  );
}
