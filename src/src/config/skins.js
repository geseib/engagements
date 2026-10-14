/**
 * THE SKIN REGISTRY (docs/design/themes/SPEC.md §1, §5).
 *
 * Which looks Engage can wear. A skin is a values file
 * (`styles/skins/<id>.css`) plus one entry here — and the same id in the
 * backend allowlist, `lambda-functions/admin/shared/site-skin.js` and its
 * guarded copy `lambda-functions/websocket/site-skin.js`.
 * `tests/site-skin-registry.js` fails when the three lists differ or an id has
 * no values file.
 *
 * Classic is the default and what a missing, unknown or corrupt id renders:
 * `styles/skins/classic.css` is declared on bare `:root`.
 *
 * Names and descriptions are what the staff panel (components/SiteSkinPanel)
 * shows. Plain words, no colours here: a colour belongs in the skin's values.
 */
export const SKINS = Object.freeze([
  Object.freeze({
    id: 'classic',
    name: 'Classic',
    description: 'The stage look: orange for what is selected and in progress, muted capitals over titles.',
  }),
  Object.freeze({
    id: 'present',
    name: 'Present',
    description: 'The Presentation look: blue for what is selected and in progress, blue capitals over titles.',
  }),
]);

export const DEFAULT_SKIN = 'classic';

/** Where the boot script (public/index.html) and SkinProvider remember the skin. */
export const SKIN_STORAGE_KEY = 'engage.skin';

/** The shape the boot script accepts before it sets the attribute. Kept equal to its copy there. */
export const SKIN_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;

export const SKIN_IDS = Object.freeze(SKINS.map((s) => s.id));

export const isSkinId = (id) => typeof id === 'string' && SKIN_IDS.includes(id);

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS.find((s) => s.id === DEFAULT_SKIN);
