/**
 * WHICH OF THE THREE ENVIRONMENTS AM I TALKING TO?
 *
 * The admin console has never answered that question. `API_BASE` is read at
 * AdminPage.jsx:24 and rendered nowhere, and the archive service is shared
 * across all three tiers, so an operator deleting something has had no way to
 * know whether they were on dev or on prod.
 *
 * The authority is `window.ENV`, which the three buildspecs write as the words
 * "development" / "test" / "production" (buildspec-dev.yml:75,
 * buildspec-test.yml:75, buildspec-prod.yml:52) — NOT as "dev"/"prod". A naive
 * `env === 'prod'` check therefore matches nothing in any real deployment,
 * which is the single most likely way this chip ships broken.
 *
 * The rule this whole module exists to enforce: when it cannot tell, it says
 * so. It must never guess "dev", because the cost of that guess is an operator
 * on production believing they are on development.
 */
const { describeEnvironment } = require('../utils/adminEnvironment');

describe('naming the tier from what the buildspecs actually write', () => {
  // rejects: matching on the short id ('prod'), which is what every one of the
  // three buildspecs does NOT write. With that bug the chip reads ENV? forever.
  test('production is prod', () => {
    const env = describeEnvironment({ env: 'production' });
    expect(env.id).toBe('prod');
    expect(env.label).toBe('PROD');
  });

  // rejects: the same short-id bug on the tier people develop against, where it
  // would be noticed last because dev is also the fallback people reach for.
  test('development is dev', () => {
    expect(describeEnvironment({ env: 'development' }).id).toBe('dev');
  });

  test('test is test', () => {
    expect(describeEnvironment({ env: 'test' }).id).toBe('test');
  });

  // rejects: a case-sensitive or whitespace-sensitive comparison against a
  // value that is produced by shell `printf` in three separate files.
  test('the comparison survives case and surrounding whitespace', () => {
    expect(describeEnvironment({ env: '  Production ' }).id).toBe('prod');
  });
});

describe('when ENV is missing', () => {
  // rejects: dropping the API-stage fallback. config.js is written by a deploy
  // script; a hand-edited or partially-written one loses window.ENV while
  // API_BASE — the thing the console actually talks to — is still right there.
  test('the API stage segment answers instead', () => {
    expect(
      describeEnvironment({
        apiBase: 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/',
      }).id
    ).toBe('prod');
    expect(
      describeEnvironment({
        apiBase: 'https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/',
      }).id
    ).toBe('dev');
  });

  // THE test. rejects: defaulting to 'dev' (or to any tier at all) when nothing
  // identifies the environment. A chip that says DEV on an unidentifiable
  // console is worse than the silence it replaced, because silence does not
  // give anyone permission to press Delete all.
  test('with nothing to go on it refuses to name a tier', () => {
    const env = describeEnvironment({});
    expect(env.id).toBe('unknown');
    expect(env.label).toBe('ENV?');
    expect(['dev', 'test', 'prod']).not.toContain(env.id);
  });

  // rejects: a stage-segment reader that treats any trailing path word as a
  // tier, so a custom domain like api.seibtribe.us/v2/ would read as "V2".
  test('an unrecognised stage segment is not promoted to a tier', () => {
    expect(
      describeEnvironment({ apiBase: 'https://api.seibtribe.us/v2/' }).id
    ).toBe('unknown');
  });
});

describe('the chip has to be verifiable', () => {
  // rejects: a chip carrying a word and nothing else. Three tiers all render
  // the same three-letter label; the host is what tells an operator that DEV
  // really is pointing at the dev gateway and not at a stale config.js.
  test('it carries the API host it is describing', () => {
    const env = describeEnvironment({
      env: 'production',
      apiBase: 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/',
    });
    expect(env.detail).toContain('abc123.execute-api.us-east-1.amazonaws.com');
  });

  // rejects: building the detail string by concatenating an undefined apiBase,
  // which prints the literal "undefined" into the operator's tooltip.
  test('with no API base it says so rather than printing undefined', () => {
    const env = describeEnvironment({ env: 'test' });
    expect(env.detail).not.toMatch(/undefined/);
    expect(env.detail.length).toBeGreaterThan(0);
  });
});
