/**
 * THE TWO LISTS THE EVENT ITEM DIALOG NEEDS FOR ITS SESSION OPTIONS — Workie's
 * voices for a format and a set's categories (events M1b). The create dialog's
 * page reads the same two routes itself (GameHostPage fetchPersonas and
 * fetchCategories); the console has no such page, so the item dialog asks
 * here.
 *
 * Both go through authFetch — both routes carry the Cognito authorizer — and
 * neither failure is fatal: with no voices the picker offers "Adapt to the
 * session", which is the default anyway. With no categories the grid is
 * simply not drawn — on an ADD that reads as "every category", the same
 * default the create dialog uses before a category is ever chosen; on an
 * EDIT of an item that already narrowed its categories, an empty list is not
 * "every category" but a fetch that has not (yet, or ever) come back, and the
 * dialog says so rather than silently sending the item's own chosen
 * categoryIds back as if the grid had confirmed them (fix round 1).
 *
 * `listSetCategories` reads the PINNED version, not the set's current one — a
 * host editing a v2 item must see v2's categories, never a newer version's
 * (fix round 1). Pass `item.setRef.version` on an edit and the picked set's
 * `activeVersion` on an add; `get-categories.js` already accepts `?version=`
 * and falls back to the set's active version through the same
 * `resolvePartitionFromMeta` rule every other reader uses when a pin has
 * since been deleted, so a dangling pin here behaves exactly as it does
 * everywhere else that reads a pinned set.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

/** The voices that suit `gameType` (admin/personas honours each voice's gameTypes). */
export async function listPersonas(gameType) {
  try {
    const query = gameType ? `?gameType=${encodeURIComponent(gameType)}` : '';
    const res = await authFetch(adminApiUrl(`admin/personas${query}`));
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.personas) ? body.personas : [];
  } catch (e) {
    return [];
  }
}

/**
 * A set's categories, `{ name, questionCount }`, read in the library `scope`
 * names, at `version` when one is given (the version this item actually
 * plays — its pin on an edit, the picked version on an add). No `version`
 * reads the set's current active version, as before.
 */
export async function listSetCategories(setId, scope, version) {
  if (!setId) return [];
  try {
    const params = [];
    if (scope) params.push(`scope=${encodeURIComponent(scope)}`);
    if (version !== undefined && version !== null && version !== '') {
      params.push(`version=${encodeURIComponent(version)}`);
    }
    const query = params.length ? `?${params.join('&')}` : '';
    const res = await authFetch(adminApiUrl(`question-sets/${encodeURIComponent(setId)}/categories${query}`));
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.categories) ? body.categories : [];
  } catch (e) {
    return [];
  }
}
