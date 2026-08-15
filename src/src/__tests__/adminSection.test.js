/**
 * THE SECTION IN THE URL — config/adminSection.js.
 *
 * The console kept `activeTab` in local state seeded with a constant, so reload
 * dropped you on Question sets, Back left the console entirely, and no section
 * could be sent to anyone. These are the pure halves of the fix; the mounted
 * behaviour is asserted in adminDeepLink.test.jsx, because a correct pair of
 * string functions that nothing calls is the failure mode this repo has shipped
 * before.
 */
import {
  SECTION_PARAM, sectionFromSearch, searchForSection, searchMatchesSection,
} from '../config/adminSection';

const IDS = ['questionsets', 'games', 'prompts', 'archive', 'users', 'settings'];
const DEFAULT = 'questionsets';

describe('reading a section out of a URL', () => {
  test('a named section is returned', () => {
    expect(sectionFromSearch('?section=users', IDS, DEFAULT)).toBe('users');
  });

  test('it survives other parameters, in any position', () => {
    // rejects: a hand-rolled `search.split('=')[1]` parse, which is what this
    // would have been without URLSearchParams and which returns 'users&ref' for
    // the first of these and 'q' for the second.
    expect(sectionFromSearch('?section=users&ref=email', IDS, DEFAULT)).toBe('users');
    expect(sectionFromSearch('?ref=email&section=users', IDS, DEFAULT)).toBe('users');
  });

  test('no parameter at all is the default section', () => {
    expect(sectionFromSearch('', IDS, DEFAULT)).toBe(DEFAULT);
    expect(sectionFromSearch('?', IDS, DEFAULT)).toBe(DEFAULT);
    expect(sectionFromSearch('?ref=email', IDS, DEFAULT)).toBe(DEFAULT);
  });

  test('an unrecognised section is the default, not an empty screen', () => {
    // rejects: trusting the value. It is whatever was last in somebody's address
    // bar — a bookmark of a renamed section, a truncated paste, a guess. A
    // console that renders no work area because a string did not match reads as
    // broken, and the URL is the last place anyone looks.
    expect(sectionFromSearch('?section=Users', IDS, DEFAULT)).toBe(DEFAULT);
    expect(sectionFromSearch('?section=aiprompts', IDS, DEFAULT)).toBe(DEFAULT);
    expect(sectionFromSearch('?section=', IDS, DEFAULT)).toBe(DEFAULT);
  });

  test('undefined and null are handled like an empty search', () => {
    // The caller reads `window.location.search`, which is '' in jsdom before a
    // pushState and can be undefined in a non-browser render.
    expect(sectionFromSearch(undefined, IDS, DEFAULT)).toBe(DEFAULT);
    expect(sectionFromSearch(null, IDS, DEFAULT)).toBe(DEFAULT);
  });
});

describe('writing a section into a URL', () => {
  test('a non-default section becomes the parameter', () => {
    expect(searchForSection('', 'users', DEFAULT)).toBe('?section=users');
  });

  test('THE DEFAULT SECTION IS WRITTEN AS ABSENCE', () => {
    // rejects: emitting '?section=questionsets'. /admin and that URL render the
    // same screen, so writing both means Back lands on a page that looks
    // identical and has to be pressed twice — which is exactly what people call
    // a broken Back button.
    expect(searchForSection('?section=users', DEFAULT, DEFAULT)).toBe('');
    expect(searchForSection('', DEFAULT, DEFAULT)).toBe('');
  });

  test('every other parameter survives the change', () => {
    // rejects: rebuilding the search from the section alone. Nothing else on
    // /admin reads a parameter today, which is precisely why this is cheap to
    // get wrong now and expensive to find later.
    expect(searchForSection('?ref=email', 'users', DEFAULT)).toBe('?ref=email&section=users');
    expect(searchForSection('?ref=email&section=games', 'users', DEFAULT))
      .toBe('?ref=email&section=users');
    // ...including when the section is being removed.
    expect(searchForSection('?ref=email&section=games', DEFAULT, DEFAULT)).toBe('?ref=email');
  });

  test('an existing section is replaced, never appended', () => {
    // rejects: `params.append`, which yields '?section=games&section=users' —
    // and `URLSearchParams.get` returns the FIRST, so the URL would then read
    // back as the section you just left.
    const next = searchForSection('?section=games', 'users', DEFAULT);
    expect(next).toBe('?section=users');
    expect(sectionFromSearch(next, IDS, DEFAULT)).toBe('users');
  });

  test('the key is the one both halves share', () => {
    expect(SECTION_PARAM).toBe('section');
    expect(searchForSection('', 'users', DEFAULT)).toContain(`${SECTION_PARAM}=`);
  });
});

describe('deciding whether the address bar already says it', () => {
  test('a canonical URL needs no rewrite', () => {
    expect(searchMatchesSection('?section=users', 'users', DEFAULT)).toBe(true);
    expect(searchMatchesSection('', DEFAULT, DEFAULT)).toBe(true);
  });

  test('the three URLs that mean the landing section are told apart', () => {
    // Only the bare one is canonical; the other two get replaced on arrival so
    // the address bar never names a section that is not on screen.
    expect(searchMatchesSection('?section=questionsets', DEFAULT, DEFAULT)).toBe(false);
    expect(searchMatchesSection('?section=bogus', DEFAULT, DEFAULT)).toBe(false);
  });

  test('a URL carrying other parameters is still canonical', () => {
    // rejects: rebuilding the search from the section alone, which would make
    // '?a=1&section=users' compare unequal to '?section=users' and rewrite
    // history on arrival — silently dropping the other parameter as it went.
    //
    // NOT an ordering assertion, which is what this claimed to be until a
    // mutation walked through it. `URLSearchParams.set` replaces a key in
    // place, so a search that already names this section rebuilds byte for
    // byte whatever the order was, and the normalising implementation this was
    // written to protect turned out to be dead weight. See searchMatchesSection.
    expect(searchMatchesSection('?a=1&section=users', 'users', DEFAULT)).toBe(true);
    expect(searchMatchesSection('?section=users&a=1', 'users', DEFAULT)).toBe(true);
  });
});
