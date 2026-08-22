/**
 * U SHOWS AND HIDES THE NAMES — the meter's keyboard route.
 *
 * The owner: *"for the main screen a shortcut to show hide the users in the
 * upper right."* The shortcut calls the SAME onPin the pointer path calls, so
 * the two cannot drift; these tests hold the binding and, more importantly,
 * its refusals — a letter key on the window is one typo away from stealing
 * text input.
 */
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';

function MeterHarness({ names = ['Ada', 'Grace'] }) {
  const [mode, setMode] = useState(null);
  return (
    <RoomMeter
      phase="ASK"
      heading="Answered"
      body="1 / 3"
      waiting={{
        names,
        mode,
        onPreview: () => setMode((m) => (m === 'pinned' ? m : 'preview')),
        onPreviewEnd: () => setMode((m) => (m === 'pinned' ? m : null)),
        onPin: () => setMode((m) => (m === 'pinned' ? null : 'pinned')),
      }}
    />
  );
}

describe('the U key on the room meter', () => {
  test('U pins the list and U unpins it', () => {
    const { container } = render(<MeterHarness />);
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
    fireEvent.keyDown(window, { key: 'u' });
    expect(container.querySelector('[data-waiting-list]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'U' });
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
  });

  test('a U typed into a field stays typed', () => {
    // rejects: the stage toggling the roster while the host types "Quarterly
    // update" into any input on the page.
    const { container } = render(
      <>
        <input aria-label="field" defaultValue="" />
        <MeterHarness />
      </>
    );
    const field = document.querySelector('input');
    field.focus();
    fireEvent.keyDown(field, { key: 'u' });
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
  });

  test('modified U is someone else\'s shortcut', () => {
    // rejects: eating Cmd+U / Ctrl+U, which belong to the browser.
    const { container } = render(<MeterHarness />);
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'u', metaKey: true });
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
  });

  test('no names, no binding', () => {
    // rejects: a window listener mounted on a meter with nothing to show —
    // U must do nothing at all when the list is not offerable, not pin an
    // empty box.
    const { container } = render(
      <RoomMeter phase="ASK" heading="Answered" body="0 / 3" waiting={null} />
    );
    fireEvent.keyDown(window, { key: 'u' });
    expect(container.querySelector('[data-waiting-list]')).toBeNull();
  });

  test('the control says its key', () => {
    // rejects: shipping the shortcut with no way to learn it exists.
    const { container } = render(<MeterHarness />);
    const count = container.querySelector('.count.revealable');
    expect(count.getAttribute('aria-label')).toContain('Press U');
    expect(count.getAttribute('title')).toContain('U ');
  });
});
