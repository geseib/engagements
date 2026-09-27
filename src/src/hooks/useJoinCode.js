import { useCallback, useState } from 'react';
import { navigateTo } from '../auth/navigate';
import { resolveJoinCode, joinPathFor } from '../utils/joinCode';

export const CODE_LENGTH = 4;

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

/**
 * A code arrives as four digits, or as the whole join URL off a slide or out of
 * a calendar invite. Both shapes this app itself produces are recognised.
 */
export function codeFromUrl(raw) {
  const match =
    /[?&]gameId=(\d{4})(?!\d)/.exec(raw) || /\/play\D{0,12}(\d{4})(?!\d)/.exec(raw);
  return match ? match[1] : null;
}

/**
 * THE JOIN LOGIC, ONCE. RootPage (/join) and the marketing hero both type a
 * code; a second copy of the pre-flight rule below is how one of them would end
 * up stranding a participant.
 */
export default function useJoinCode() {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(null); // the code the server did not know
  const [focused, setFocused] = useState(false);
  const [checking, setChecking] = useState(false);

  const clearFeedback = useCallback(() => {
    setNote('');
    setMissing(null);
  }, []);

  const handleChange = (event) => {
    clearFeedback();
    setCode(digitsOnly(event.target.value).slice(0, CODE_LENGTH));
  };

  /**
   * Everything a human does on the way to typing four digits -- a space, a
   * dash, a hash, a non-breaking space out of an invite, the whole join URL --
   * is noise to remove rather than an error to report. The one exception is
   * more than four digits: guessing which four someone meant could drop them
   * into a different live room, so the field says what it sees and keeps what
   * is already there.
   */
  const handlePaste = (event) => {
    event.preventDefault();
    const clipboard = event.clipboardData || window.clipboardData;
    const raw = (clipboard && clipboard.getData('text')) || '';

    const fromUrl = codeFromUrl(raw);
    if (fromUrl) {
      setMissing(null);
      setCode(fromUrl);
      setNote('Took the code out of that link.');
      return;
    }

    const digits = digitsOnly(raw);
    if (digits.length > CODE_LENGTH) {
      setNote(`That is ${digits.length} digits. The code on screen is ${CODE_LENGTH}.`);
      return;
    }
    clearFeedback();
    setCode(digits);
  };

  /**
   * type code -> GET {API_BASE}join/{code}   (utils/joinCode.js, events M2)
   *   404           -> say so, stay put
   *   an event      -> /play?event={code}    (the attendee's page)
   *   a session     -> /play?gameId={code}
   *   anything else -> /play?gameId={code} anyway
   *
   * That last rule is the important one. A check that can strand a participant
   * is worse than no check: network failure, timeout, CORS -- navigate, and let
   * /play own the error. The check only ever saves a page load.
   *
   * It is worth doing at all because PlayerPage sets `readOnly` on a code that
   * arrives in the URL, so navigating on a typo lands someone on a play page
   * with a wrong, locked code and no way to fix it but editing the address bar.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH || checking) return;

    setChecking(true);
    clearFeedback();
    const kind = await resolveJoinCode(code);
    if (kind === 'missing') {
      setMissing(code);
      setChecking(false);
      return;
    }
    navigateTo(joinPathFor(code, kind));
  };

  return {
    code, note, missing, checking, focused, setFocused,
    canSubmit: code.length === CODE_LENGTH && !checking,
    cells: Array.from({ length: CODE_LENGTH }, (_, index) => index),
    handleChange, handlePaste, handleSubmit,
  };
}
