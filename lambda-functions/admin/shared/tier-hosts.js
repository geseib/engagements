/**
 * WHERE EACH TIER'S SITE LIVES — the backend's copy of src/src/config/tierHosts.js.
 *
 * The archive needs it to recognise an image stored as an absolute URL on one of Engage's own
 * sites (https://engage.dev.seibtribe.us/sets/<setId>/<file>), which is an object in that
 * tier's media bucket served through its CloudFront `sets/*` behaviour, not somebody else's
 * picture. tests/archive-tier-hosts.js holds this map equal to the frontend's.
 *
 * `eng.dev.seibtribe.us` is NOT here on purpose: it is the retired `engdev` twin (CLAUDE.md).
 */
const TIER_HOSTS = Object.freeze({
  dev: 'engage.dev.seibtribe.us',
  test: 'engage.test.seibtribe.us',
  prod: 'engage.seibtribe.us',
});

const OWN_HOSTS = new Set(Object.values(TIER_HOSTS));

/** Is `host` (lower-cased, no port) one of Engage's tier sites? */
const isTierHost = (host) => OWN_HOSTS.has(String(host || '').toLowerCase());

module.exports = { TIER_HOSTS, isTierHost };
