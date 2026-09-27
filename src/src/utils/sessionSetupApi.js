/**
 * THE TWO LISTS THE EVENT ITEM DIALOG NEEDS FOR ITS SESSION OPTIONS — Workie's
 * voices for a format and a set's categories (events M1b). The create dialog's
 * page reads the same two routes itself (GameHostPage fetchPersonas and
 * fetchCategories); the console has no such page, so the item dialog asks
 * here.
 *
 * Both go through authFetch — both routes carry the Cognito authorizer — and
 * neither failure is fatal: with no voices the picker offers "Adapt to the
 * session", which is the default anyway, and with no categories the grid is
 * simply not drawn (the item then plays every category).
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

/** A set's categories, `{ name, questionCount }`, read in the library `scope` names. */
export async function listSetCategories(setId, scope) {
  if (!setId) return [];
  try {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const res = await authFetch(adminApiUrl(`question-sets/${encodeURIComponent(setId)}/categories${query}`));
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.categories) ? body.categories : [];
  } catch (e) {
    return [];
  }
}
