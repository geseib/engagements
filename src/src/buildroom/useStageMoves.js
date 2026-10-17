/**
 * WHAT A PRESS OF ONE OF THE STAGE'S MOVES DOES (parity PLAN §2.5, §2.6, B6).
 *
 * Lifted out of the Stage screen's `doMove` so the screen can be a display
 * component, and so the two-screen console's footer (B8) presses the very same
 * moves from the very same controls (buildControls). Every control carries its
 * stageModel fields (action, askId, point, k …); this maps each action to the
 * call the Host screen's rows make, with the same guards:
 *
 * - nothing while a host action is in flight, nothing on a disabled move, and
 *   no pick while the wheel is still turning;
 * - `to-claude` sends the room's choice with its own sentence, including a
 *   direction the host already changed (settleMove + decideBody, as Settle);
 * - `run-next` reaching here has been confirmed: before Claude reported, the
 *   bar armed it in place, so the second press sends with `force`.
 *
 * Returns `doMove(control)`. The page owns the state; `on*` are its handlers.
 */
import { useCallback } from 'react';
import { settleMove, decideBody } from './buildScreens';

const none = () => undefined;

export default function useStageMoves({
  current, draft = null, busy = false, run, api, wheelTurning = false, editable = false,
  onEdit = none, onSent = none, onHideCodes = none, onTakeDown = none, onPointLater = none,
  onPointsMove = none, onRunNext = none, onRunSkip = none, onRunStop = none,
}) {
  return useCallback((m) => {
    if (!m || busy) return;
    // The turning wheel offers nothing: a pick waits for it to stop, as the Host's button does.
    if (m.action === 'noop' || m.disabled || (m.action === 'to-claude' && wheelTurning)) return;
    if (m.action === 'hide-codes') { onHideCodes(); return; }
    // EDIT opens the send window here; TO CLAUDE sends the room's choice with
    // its own sentence, as the Host's panel would (owner, 2026-10-08).
    if (m.action === 'edit') { if (editable) onEdit(); return; }
    // A TALKING POINT is up: Take it down (which may offer the ideas a vote) or save it for later.
    if (m.action === 'take-down') { if (m.point) onTakeDown(m.point); return; }
    if (m.action === 'point-later') { if (m.point) onPointLater(m.point); return; }
    // THE HIGHLIGHT AND THE RUN LIST: the same moves as the Host's rows.
    if (m.action === 'points-send') { onPointsMove(current, 'send'); return; }
    if (m.action === 'points-run') { onPointsMove(current, 'run'); return; }
    if (m.action === 'points-later') { onPointsMove(current, 'later-rest'); return; }
    if (m.action === 'points-close') { onPointsMove(current, 'close'); return; }
    if (m.action === 'run-next') { onRunNext(!m.claudeDone); return; }
    if (m.action === 'run-skip') { onRunSkip(); return; }
    if (m.action === 'run-stop') { onRunStop(); return; }
    if (!current && !m.askId) return;
    if (m.action === 'to-claude') {
      // The same move as the Host's Settle press, including a direction the host already changed.
      const go = settleMove(current, draft);
      if (!go) return;
      run(async () => {
        const out = await api.askAction(current.askId, decideBody(current, { direction: go.direction, chosen: go.chosen, as: go.kind }));
        onSent({ as: go.kind, send: true, direction: go.direction });
        return out;
      });
      return;
    }
    run(() => api.askAction(m.askId || current.askId, { action: m.action }));
  }, [current, draft, busy, run, api, wheelTurning, editable, onEdit, onSent, onHideCodes, onTakeDown, onPointLater, onPointsMove, onRunNext, onRunSkip, onRunStop]);
}
