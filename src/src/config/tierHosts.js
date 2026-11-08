/**
 * WHERE EACH TIER'S SITE LIVES, and which tier work goes to next.
 *
 * The three hosts are the CloudFront aliases recorded in CLAUDE.md's environment table
 * (read from live AWS on 2026-08-15). `eng.dev.seibtribe.us` is NOT here on purpose: it is
 * the retired `engdev` twin, frozen at a July bundle, and a promotion link to it would land
 * the admin on a site where nothing they shipped is visible.
 *
 * Promotion runs one way, dev → test → prod (CLAUDE.md "Flow"). Prod has no next tier.
 */
export const TIER_HOSTS = Object.freeze({
  dev: 'engage.dev.seibtribe.us',
  test: 'engage.test.seibtribe.us',
  prod: 'engage.seibtribe.us',
});

const NEXT = Object.freeze({ dev: 'test', test: 'prod' });

/** The tier work on `tier` is promoted to, or '' when there is none (prod, or unknown). */
export const nextTier = (tier) => NEXT[tier] || '';

/** `https://<host>` for a tier, or '' for a tier with no site. */
export const tierOrigin = (tier) => (TIER_HOSTS[tier] ? `https://${TIER_HOSTS[tier]}` : '');
