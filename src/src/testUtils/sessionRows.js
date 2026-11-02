/**
 * Reading a SessionList row the way a person does (experience plan 4a): the
 * row's one primary button is on the row; everything else is under its ⋯
 * menu, which has to be opened first. `rowAction` finds an action either way
 * and returns the button (or null), so a test can assert on it or click it.
 */
import { screen, within, fireEvent } from '@testing-library/react';

/** The row (`<tr>`) a title is in. */
export const rowFor = (title) => screen.getAllByText(title)
  .map((el) => el.closest('tr'))
  .find(Boolean);

/** The row's ⋯ button. */
export const moreButton = (row) => within(row).queryByRole('button', { name: /^More for/ });

/** Open the row's ⋯ menu (no-op if it is open); the menu element, or null. */
export function openMenu(row) {
  const more = moreButton(row);
  if (!more) return null;
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
  return screen.queryByRole('menu', { name: more.getAttribute('aria-label') });
}

/** Close any open ⋯ menu. */
export function closeMenus() {
  screen.queryAllByRole('button', { name: /^More for/ })
    .filter((b) => b.getAttribute('aria-expanded') === 'true')
    .forEach((b) => fireEvent.click(b));
}

/**
 * The control for an action on a row: the primary button if it matches, else
 * the menu item. `name` is a RegExp or string matched against the accessible
 * name. Leaves the menu open when the action was found there.
 */
export function rowAction(row, name) {
  const re = name instanceof RegExp ? name : new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const onRow = within(row).queryAllByRole('button').find((b) => !/^More for/.test(b.getAttribute('aria-label') || '') && re.test(b.textContent.trim()));
  if (onRow) return onRow;
  const menu = openMenu(row);
  const item = menu ? within(menu).queryAllByRole('menuitem').find((b) => re.test(b.textContent.trim())) : null;
  if (!item) closeMenus();
  return item || null;
}

/** Click an action on a row; throws if the row does not offer it. */
export function clickRowAction(row, name) {
  const btn = rowAction(row, name);
  if (!btn) throw new Error(`No "${name}" on that row`);
  fireEvent.click(btn);
  return btn;
}

/** Every action a row offers, primary first, in their words. */
export function rowActionNames(row) {
  const onRow = within(row).queryAllByRole('button')
    .filter((b) => !/^More for/.test(b.getAttribute('aria-label') || '') && !b.hasAttribute('aria-expanded'))
    .map((b) => b.textContent.trim());
  const menu = openMenu(row);
  const inMenu = menu ? within(menu).queryAllByRole('menuitem').map((b) => b.textContent.trim()) : [];
  closeMenus();
  return [...onRow, ...inMenu];
}
