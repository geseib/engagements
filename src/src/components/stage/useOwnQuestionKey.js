import { useEffect, useRef } from 'react';
import { isTypingTarget } from '../HostActionBar';

/**
 * Q: WRITE A QUESTION (impromptu ask, README D2). The host console's and the
 * stage's key for the composer, with the same guards as every other host key:
 * never while typing (a text field, a textarea, contenteditable), never with
 * a modifier (Ctrl/Cmd+Q belongs to the browser), never on a held key's
 * repeat, never for a keystroke another listener already took, and — through
 * `enabled`, built at the call site exactly as `useSessionPanelKey`'s is —
 * never under a dialog or a surface that replaced the stage.
 *
 * On `document`, beside the Session menu's own listener, for the reason
 * useSessionPanelKey.js gives at length: one target, one phase, one press.
 */
export function ownQuestionKeyIntent(event) {
  if (!event || (event.key !== 'q' && event.key !== 'Q')) return null;
  if (event.repeat || event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return 'write';
}

export default function useOwnQuestionKey({ enabled = false, onWrite = () => {} } = {}) {
  const latest = useRef(onWrite);
  latest.current = onWrite;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (ownQuestionKeyIntent(event) !== 'write') return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
