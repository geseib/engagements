/**
 * Test helpers for components/SetChooser.jsx: pick a set by its pair key
 * (utils/setRef.js) the way a host does: open the chooser (focus its search,
 * or press Change), then press the set's row.
 */
import { fireEvent, screen, within } from '@testing-library/react';

export const chooser = () => screen.getByTestId('set-chooser');

/** The key the chooser holds now ('' when none). */
export const chosenSet = () => chooser().getAttribute('data-value') || '';

/** Open the chooser if it is folded. */
export function openChooser() {
  const c = chooser();
  if (c.querySelector('[data-set-key]')) return c;
  const change = within(c).queryByRole('button', { name: 'Change' });
  if (change) fireEvent.click(change);
  else fireEvent.focus(c.querySelector('input'));
  return chooser();
}

/** Pick the set with this key. */
export function pickSet(key) {
  const c = openChooser();
  const radio = c.querySelector(`[data-set-key="${key}"]`);
  if (!radio) throw new Error(`No set ${key} in the chooser`);
  fireEvent.click(radio);
}

/** The names the open chooser lists, in order. */
export function listedSets() {
  const c = openChooser();
  return Array.from(c.querySelectorAll('[data-set-key]')).map((r) => r.getAttribute('aria-label'));
}
