import React, { useState } from 'react';

/*
 * SAID IN THE ROOM (owner, 2026-10-13: "the host should get to type things in
 * as well, because things might be said in the room"). The host's own line in
 * a feedback round: it lands with the room's comments, credited to the room.
 * `compose.onSend(text)` resolves { ok, error }. One box for the laptop's
 * meter and the Remote; each surface styles it under its own scope.
 */
export default function RoomNote({ compose, className = '' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = `room-note-${className || 'stage'}`;
  const send = async (event) => {
    event.preventDefault();
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true);
    setError('');
    const result = await compose.onSend(line);
    setBusy(false);
    if (result && result.ok) setText('');
    else setError((result && result.error) || 'That did not save. Try again.');
  };
  return (
    <form className={`room-note${className ? ` ${className}` : ''}`} onSubmit={send}>
      <label className="room-note-label" htmlFor={id}>Said in the room</label>
      <textarea
        id={id}
        rows={2}
        value={text}
        maxLength={1000}
        placeholder="Type what someone said"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds it; Shift+Enter is a new line.
          if (e.key === 'Enter' && !e.shiftKey) send(e);
        }}
      />
      <button type="submit" className="room-note-add" disabled={busy || !text.trim()}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      {error ? <p className="room-note-error" role="alert">{error}</p> : null}
    </form>
  );
}
