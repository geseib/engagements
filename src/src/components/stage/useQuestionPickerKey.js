import { useEffect, useRef } from 'react';
import { isTypingTarget } from '../HostActionBar';
import { pickerKeyIntent } from '../../config/questionPicker';

/**
 * C: CHOOSE A QUESTION (docs/design/question-picker D2, F6). A copy of Q's
 * hook (useOwnQuestionKey.js) with Q's guards: never while typing, never
 * with a modifier (Cmd/Ctrl+C is copy), never on a held key's repeat, never
 * for a keystroke another listener already took, and — through `enabled`,
 * built at the call site from Q's own — never under a dialog or a surface
 * that replaced the stage, and only for the set-based types (F7).
 *
 * On `document`, beside the Session menu's own listener, for the reason
 * useSessionPanelKey.js gives: one target, one phase, one press.
 */
export const questionPickerKeyIntent = (event) => pickerKeyIntent(event, isTypingTarget);

export default function useQuestionPickerKey({ enabled = false, onChoose = () => {} } = {}) {
  const latest = useRef(onChoose);
  latest.current = onChoose;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (questionPickerKeyIntent(event) !== 'choose') return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
