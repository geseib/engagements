/**
 * A READ-ONLY VALUE WITH A COPY BUTTON — the report's link and its passkey.
 *
 * Shared by ReportSavedDialog (paper, `.rshare`) and the Reports list's share
 * row (dusk, `.rp`). The behaviour is one thing and the look is two, so the
 * caller passes its own class names; this owns no stylesheet.
 *
 * WHEN COPYING FAILS IT SAYS SO. utils/copyText.js tries both ways a browser
 * can copy; if both refuse, the field's text is selected and a line says to
 * press and hold it. Before, a refusal on an iPhone looked like a dead button
 * (the owner, 2026-09-23: "the copy buttons don't seem to work").
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { copyText } from '../utils/copyText';

export default function CopyField({
  id,
  label,
  value,
  copyLabel,
  classes,
  inputClassName = '',
  copy = copyText,
}) {
  const [status, setStatus] = useState('idle');   // idle | copied | failed
  const inputRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    clearTimeout(timer.current);
    const ok = await copy(value);
    if (ok) {
      setStatus('copied');
      timer.current = setTimeout(() => setStatus('idle'), 2000);
      return;
    }
    setStatus('failed');
    const el = inputRef.current;
    if (el) {
      el.focus();
      try { el.setSelectionRange(0, String(value).length); } catch { /* some inputs refuse */ }
    }
  };

  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>{label}</label>
      <div className={classes.row}>
        <input
          ref={inputRef}
          id={id}
          className={`${classes.input} ${inputClassName}`.trim()}
          value={value}
          readOnly
          onFocus={(e) => { try { e.target.setSelectionRange(0, e.target.value.length); } catch { /* ignore */ } }}
        />
        <button type="button" className={classes.button} onClick={onCopy} aria-label={copyLabel}>
          <Icon name={status === 'copied' ? 'Check' : 'ClipboardText'} weight="bold" size={16} />
          {status === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={classes.note} role="status" aria-live="polite">
        {status === 'failed' ? 'Could not copy automatically. Press and hold the text above to copy it.' : ''}
      </p>
    </div>
  );
}
