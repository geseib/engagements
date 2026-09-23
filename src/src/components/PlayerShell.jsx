import React from 'react';
import BrandMark from './BrandMark';
import HelpButton from './HelpButton';
// The shell is the `.plr` scope root, so it brings the scope's stylesheet with
// it; PlayerPage imports it too, and webpack loads it once.
import './PlayerSurface.css';

/**
 * THE SHELL: bar, stage, dock. Three regions, and the dock is OUTSIDE the
 * scrolling region rather than pinned over it.
 *
 * That is what makes "scrolling to read is fine, scrolling to act is not"
 * (RATIONALE §5.2) structural rather than editorial: the primary action cannot
 * be pushed below the fold because it is not in the thing that scrolls. It is
 * also not `position: fixed`, which on iOS Safari interacts badly with the
 * collapsing URL bar and with the soft keyboard.
 *
 * `dock` IS OMITTED, NOT DISABLED, IN REST AND WATCH (§2.2). If there is
 * nothing to do there must be nothing that looks pressable, and a design that
 * renders a greyed bar has already lost that argument. Declared at module scope
 * so React keeps one element identity across renders — a component defined
 * inside PlayerPage would remount its whole subtree on every keystroke and take
 * the focused textarea with it.
 *
 * ITS OWN FILE since the survey (docs/design/survey-redesign/
 * IMPLEMENTATION-phase-2.md §4 Track C). `SurveyRunner` draws its screens in
 * this shell, and PlayerPage renders `SurveyRunner`; with the shell inside
 * PlayerPage that is a circular import. PlayerPage re-exports it, so every
 * existing `import { PlayerShell } from '../PlayerPage'` still resolves.
 *
 * `progress` (0–100, optional) turns the 4px phase strip into a meter. A
 * survey is the only thing on the phone that has a LENGTH, so it is the only
 * thing that carries one, and it grows in the strip that is already there
 * rather than in a second bar (survey-phone.css, "progress, one line").
 */
export const PlayerShell = ({
  phase, volume, ctx, category, who, online = true, banner,
  centre = false, dock = null, after = null, progress = null, children,
}) => {
  const metered = typeof progress === 'number' && Number.isFinite(progress);
  const pct = metered ? Math.max(0, Math.min(100, Math.round(progress))) : null;
  return (
    <div className="plr" data-theme="dark" data-phase={phase} data-volume={volume}>
      {banner}
      <header className="plr-bar">
        <div
          className={`plr-strip${metered ? ' plr-strip--prog' : ''}`}
          style={metered ? { '--plr-progress': `${pct}%` } : undefined}
        />
        <div className="plr-line">
          {/* The mark, NOT a link: a tap here must never leave a live round. */}
          <BrandMark size={18} />
          <span className="plr-ctx">{ctx}</span>
          {category && <span className="plr-cat">{category}</span>}
          <span className="plr-spacer" />
          {who && (
            <span className="plr-who">
              <span className={`plr-dot${online ? '' : ' plr-dot--off'}`} />
              {who}
            </span>
          )}
          {/*
            THE PLAYER'S ONLY WAY INTO THE DOCUMENTATION WRITTEN FOR THEM.

            `HelpButton` was mounted in exactly one file — `AdminPage.jsx` — while
            the help system's contents advertised four player guides. The audience
            with the least context and the smallest screen had a documentation set
            and no door into it from anywhere in the product.

            IN THE BAR, NOT THE DOCK. The dock is the primary action and is
            omitted entirely when there is nothing to do (see the note on
            `dock` above); help has to be reachable in precisely those states —
            "that name is taken" is a dock-less screen, and it is the single most
            likely moment for a player to want an explanation.

            It renders inside `.plr` so the modal is in the dusk scope rather
            than beside it, for the same reason `after` is: a dialog rendered as
            a sibling of this shell resolves none of the --plr-* tokens.
          */}
          <HelpButton
            section="player"
            variant="inline"
            size="small"
            tooltip="Help"
            className="plr-helpbtn"
            reports={{ context: 'player' }}
          />
        </div>
      </header>
      <main className={`plr-stage${centre ? ' plr-stage--centre' : ''}`}>
        {children}
      </main>
      {dock && <footer className="plr-dock">{dock}</footer>}
      {/* OVERLAYS, INSIDE THE SCOPE RATHER THAN BESIDE IT.
          A dialog rendered as a sibling of this shell is outside `.plr`, so it
          inherits the data-theme="light" that public/index.html puts on <html>
          and resolves none of the --plr-* tokens — which is how the spotlight
          came to open a white card with 1.96:1 buttons over a dusk ballot. It is
          NOT part of `children`: children land in `.plr-stage`, the scrolling
          region, and a dialog does not belong inside the thing it covers. */}
      {after}
    </div>
  );
};

export default PlayerShell;
