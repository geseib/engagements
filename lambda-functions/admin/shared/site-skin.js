/**
 * THE SITE SKIN — which look every page of Engage wears (docs/design/themes/SPEC.md §5).
 *
 * One platform-wide setting owned by Engage staff, Classic by default:
 *
 *   PK PLATFORM#SETTINGS   SK SITE_SKIN
 *   RecordType "PLATFORM_SETTING"   Skin "classic" | "present"
 *   UpdatedAt (ISO)   UpdatedBy (the staff member's sub)
 *
 * NO ROW MEANS CLASSIC, and so does a row naming a skin this code does not
 * know: an unknown id must never reach a browser as anything but Classic.
 *
 * NO TTL, deliberately. CLAUDE.md's TTL rules govern session and report rows,
 * which are content with a lifetime; this is one configuration row that must
 * outlive every session, exactly like CLAUDE_MODELS. Its history is the audit
 * log (`platform.site-skin`), kept one year.
 *
 * NOT ENCRYPTED: it is public by design — GET /site serves it to signed-out
 * visitors. It names no organisation and touches no SETS/GAMES partition.
 *
 * Copied byte-for-byte into lambda-functions/websocket/site-skin.js, because
 * the public reader (websocket/events/resolve-code.js) lives in that CodeUri
 * and the packages cannot import each other. tests/site-skin-registry.js holds
 * the two identical, and holds SKINS equal to the ids in
 * src/src/config/skins.js. A third skin is one entry there, one here (both
 * copies), and its styles/skins/<id>.css.
 */
const SKINS = Object.freeze(['classic', 'present']);
const DEFAULT_SKIN = 'classic';
const SITE_SKIN_KEY = Object.freeze({ PK: 'PLATFORM#SETTINGS', SK: 'SITE_SKIN' });
const SITE_SKIN_FIELD = 'Skin';

/** Browsers cache GET /site this long; a staff change reaches everyone on their next load. */
const SITE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';

const isSkin = (id) => typeof id === 'string' && SKINS.includes(id);

/** The skin a row names, or Classic for no row, a malformed row or an unknown id. */
function skinFromItem(item) {
  const id = item && item[SITE_SKIN_FIELD];
  return isSkin(id) ? id : DEFAULT_SKIN;
}

/** What GET /site answers, and nothing else: no staff id, no record type. */
function publicView(item) {
  return {
    skin: skinFromItem(item),
    updatedAt: (item && typeof item.UpdatedAt === 'string' && item.UpdatedAt) || null,
  };
}

module.exports = {
  SKINS,
  DEFAULT_SKIN,
  SITE_SKIN_KEY,
  SITE_SKIN_FIELD,
  SITE_CACHE_CONTROL,
  isSkin,
  skinFromItem,
  publicView,
};
