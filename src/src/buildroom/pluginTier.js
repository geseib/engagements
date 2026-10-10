/**
 * ONE PLUGIN PER TIER (owner, 2026-10-10): the site's tier, from the
 * window.ENV its config.js sets (development / test / production). Prod when
 * it is unset (a local dev server, the tests). engage-mcp.mjs names the
 * plugin the same way: engage, engage-dev, engage-test.
 *
 * Its own small module so the public marketing page can name the tier's
 * plugin and paths without pulling in the host bundle (buildHostApi.js
 * re-exports these).
 */
export function siteTier() {
  const env = typeof window !== 'undefined' ? window.ENV : '';
  return env === 'development' ? 'dev' : env === 'test' ? 'test' : 'prod';
}
export const pluginName = () => (siteTier() === 'prod' ? 'engage' : `engage-${siteTier()}`);
/** A slash command of this site's plugin: /engage:kickoff, /engage-dev:kickoff … */
export const pluginSlash = (command) => `/${pluginName()}:${command}`;
/**
 * What --install-plugin writes under ~/.engage on this tier (engage-mcp.mjs
 * installPlugin and globalFile): claude-plugin/ and config.json on prod,
 * claude-plugin-dev/ and config-dev.json on dev, the same with -test on test.
 */
export function pluginPaths() {
  const t = siteTier();
  return {
    pluginDir: `~/.engage/${t === 'prod' ? 'claude-plugin' : `claude-plugin-${t}`}/`,
    configFile: `~/.engage/${t === 'prod' ? 'config.json' : `config-${t}.json`}`,
  };
}
