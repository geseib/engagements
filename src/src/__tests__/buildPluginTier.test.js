/**
 * ONE PLUGIN PER TIER (owner, 2026-10-10): the dev and test sites install
 * engage-dev and engage-test beside prod's engage, and every command the page
 * shows names the site's own plugin. Prod is unchanged. engage-mcp.mjs names
 * the plugins the same way (tests/engage-plugin.js).
 */
import {
  siteTier, pluginName, pluginSlash, pluginInstallCommand, pluginConnectCommand, startCommand,
} from '../buildroom/buildHostApi';
import { pluginCommand } from '../buildroom/BuildRoomPage';

const API = 'https://api.example.test/dev/';
// setupTests.js runs every suite as the test site.
afterEach(() => { window.ENV = 'test'; });

describe("the site's tier names its plugin", () => {
  test.each([
    ['development', 'dev', 'engage-dev'],
    ['test', 'test', 'engage-test'],
    ['production', 'prod', 'engage'],
    [undefined, 'prod', 'engage'],
  ])('window.ENV %s: tier %s, plugin %s', (env, tier, name) => {
    if (env === undefined) delete window.ENV; else window.ENV = env;
    expect(siteTier()).toBe(tier);
    expect(pluginName()).toBe(name);
    expect(pluginSlash('kickoff')).toBe(`/${name}:kickoff`);
    expect(pluginCommand('continue')).toBe(`/${name}:continue`);
  });
});

describe('the commands the Connect window shows', () => {
  test('dev: the install names the tier, and connect is /engage-dev:connect', () => {
    window.ENV = 'development';
    expect(pluginInstallCommand({ origin: 'https://engage.dev.example', api: API })).toMatch(/--install-plugin --api https:\/\/api\.example\.test\/dev\/ --tier dev$/);
    expect(pluginConnectCommand('eng_1_x')).toBe('/engage-dev:connect eng_1_x');
    expect(startCommand('tips', 'eng_1_x')).toBe('mkdir -p ~/build-room/tips && cd ~/build-room/tips && claude "/engage-dev:connect eng_1_x"');
  });
  test('prod: exactly what it was before tiers', () => {
    window.ENV = 'production';
    expect(pluginInstallCommand({ origin: 'https://engage.example', api: API })).toMatch(/--install-plugin --api https:\/\/api\.example\.test\/dev\/$/);
    expect(pluginConnectCommand('eng_1_x')).toBe('/engage:connect eng_1_x');
  });
});
