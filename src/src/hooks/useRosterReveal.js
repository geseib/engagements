import { useEffect, useState } from 'react';

/**
 * THE ROOM METER'S NAME LIST, as local state: hover or focus previews it,
 * a click pins it, Escape (or another click) puts it away. Shared by the host
 * stage and the Build Room stage so both behave the same way; the contract
 * itself is written in components/stage/RoomMeter.jsx.
 *
 * `useRosterMode()` holds the state and the Escape key. `rosterRevealFor()`
 * turns it into the `reveal` mode and the three handlers RoomMeter wants,
 * SCOPED TO `key` (the phase and round it was opened in) so a pinned list
 * cannot ride into the next beat.
 */
export function useRosterMode() {
  const [rosterMode, setRosterMode] = useState(null);
  useEffect(() => {
    if (!rosterMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setRosterMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rosterMode]);
  return [rosterMode, setRosterMode];
}

export function rosterRevealFor(rosterMode, setRosterMode, key) {
  const pinnedHere = (m) => Boolean(m && m.key === key && m.mode === 'pinned');
  return {
    reveal: rosterMode && rosterMode.key === key ? rosterMode.mode : null,
    handlers: {
      onPreview: () => setRosterMode((m) => (pinnedHere(m) ? m : { key, mode: 'preview' })),
      onPreviewEnd: () => setRosterMode((m) => (pinnedHere(m) ? m : null)),
      onPin: () => setRosterMode((m) => (pinnedHere(m) ? null : { key, mode: 'pinned' })),
    },
  };
}
