/**
 * GUARD RAILS FOR THE HELP CORPUS (help refresh Phase 0).
 *
 * helpContent.test.js holds the corpus to product truths one phrase at a time.
 * These hold it to the refresh's rules, so drift is a red build:
 *
 *   §1 RETIRED WORDS. The owner's decisions of 22 Oct 2026 retire several names
 *      for the same things ("projector", "the wall", "big screen" for the
 *      room's window or the stage; "the AI summary", "Field Notes" for Workie's
 *      What we heard), and some labels the UI no longer has ("New version",
 *      "Fork", "SETUP control"). The corpus still carries some of them, so the
 *      list comes with an ALLOWLIST of today's occurrences: guide id → term →
 *      count. It is a RATCHET in both directions, like the skins gate:
 *        a NEW occurrence (count above its allowance, or a guide/term not
 *          listed)                                   -> fail: remove it;
 *        FEWER than allowed                          -> fail: lower the number
 *          (delete the entry at 0), so the allowance never goes stale.
 *      Phase 1/2 agents shrink it; nobody grows it. Only text a reader sees is
 *      scanned (testing/helpLint.js userText: ids, icons and block types are
 *      not words). UI-label terms match only as the label is spelled ("a new
 *      version" is a phrase; "New version" is a button that does not exist).
 *
 *   §2 UI LABELS. A label is marked **Label** in the corpus (DocRenderer's
 *      ink() renders it bold). Every marked label must exist, character for
 *      character, somewhere in src/src outside __tests__ and config/help — so
 *      renaming a button fails here until the guide follows.
 *
 *   §3 LENGTH. A section is read on one screen: at most SECTION_CAP words, and
 *      no one paragraph, item, note or table row over UNIT_CAP. The long ones
 *      today are allowlisted at their current length, ratcheted the same way.
 */
const fs = require('fs');
const path = require('path');
const { HELP_ROLES } = require('../config/help');
const L = require('../testing/helpLint');

const guides = HELP_ROLES.flatMap((role) => role.guides);

/* ------------------------------------------------------------ §1 words */

/** Today's occurrences. SHRINK ONLY. */
const BANNED_ALLOWLIST = {
  'host-late-items': { 'the wall': 1 },
};

/* PRESENT is the dock's old name for the room's window (decision 1). It is a
   UI label on the dock, so it is banned in help only as a word in capitals. */
const BANNED = [...L.BANNED, { term: 'PRESENT', re: /\bPRESENT\b/g }];

describe('§1 retired words: no new occurrence, and the allowlist only shrinks', () => {
  test('the allowlist names real guides and real terms', () => {
    const terms = new Set(BANNED.map((b) => b.term));
    Object.entries(BANNED_ALLOWLIST).forEach(([id, byTerm]) => {
      expect(guides.map((g) => g.id)).toContain(id);
      Object.keys(byTerm).forEach((t) => expect(terms.has(t)).toBe(true));
    });
  });

  test.each(guides.map((g) => [g.id, g]))('%s', (id, guide) => {
    const text = L.userText(guide);
    const problems = [];
    BANNED.forEach((b) => {
      const count = L.countTerm(text, b);
      const allowed = (BANNED_ALLOWLIST[id] || {})[b.term] || 0;
      if (count > allowed) {
        problems.push(`"${b.term}" appears ${count}x in ${id}, allowed ${allowed}: use the glossary's word (config/help/glossary.js)`);
      } else if (count < allowed) {
        problems.push(`"${b.term}" in ${id} is down to ${count}: lower BANNED_ALLOWLIST['${id}']['${b.term}'] to ${count}${count === 0 ? ' (delete the entry)' : ''}`);
      }
    });
    if (problems.length) throw new Error(problems.join('\n'));
  });

  test('the glossary itself uses none of them', () => {
    const glossary = guides.find((g) => g.id === 'glossary');
    expect(BANNED.filter((b) => L.countTerm(L.userText(glossary), b) > 0).map((b) => b.term)).toEqual([]);
  });

  test('the matcher is the one described: labels by their spelling, words in any case', () => {
    const count = (term, text) => L.countTerm(text, BANNED.find((b) => b.term === term));
    expect(count('New version', 'Every save is a new version.')).toBe(0);
    expect(count('New version', 'Press "New version".')).toBe(1);
    expect(count('projector', 'Drag it onto the Projector.')).toBe(1);
    expect(count('the wall', 'It goes up on the wall.')).toBe(1);
    expect(count('Fork', 'Forked sets')).toBe(1);
  });
});

/* ------------------------------------------------------------ §2 labels */

const SRC = path.join(__dirname, '..');
function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '__tests__', 'testing'].includes(e.name)) continue;
      if (path.relative(SRC, p).split(path.sep).join('/') === 'config/help') continue;
      sources(p, out);
    } else if (/\.(jsx?|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}
/* Source text with JS escapes undone, so 'Room\'s window' matches Room's window. */
const CODE = sources(SRC).map((f) => fs.readFileSync(f, 'utf8').replace(/\\(['"`])/g, '$1')).join('\n');

describe('§2 every marked UI label exists in the app', () => {
  const marked = guides.flatMap((g) => L.uiLabels(L.userText(g)).map((label) => [g.id, label]));

  test('some labels are marked (the convention is in use)', () => {
    expect(marked.length).toBeGreaterThanOrEqual(5);
  });

  test.each(marked)('%s: **%s**', (_id, label) => {
    // rejects: a guide quoting a button, tab or heading the UI no longer shows.
    expect(CODE.includes(label)).toBe(true);
  });

  test('the check can fail: a label nobody wrote is not found', () => {
    expect(CODE.includes('Open the Presentation in a new window')).toBe(false);
  });
});

/* ------------------------------------------------------------ §3 length */

const SECTION_CAP = 250;
const UNIT_CAP = 120;

/** guide#section → today's words. SHRINK ONLY. */
const LONG_SECTIONS = {
  'admin-ai-prompts#versions': 322,
};
/** guide#section → today's longest paragraph/item/note/row. SHRINK ONLY. */
const LONG_UNITS = {
};

const sections = guides.flatMap((g) => g.sections.map((s) => [`${g.id}#${s.id}`, s]));

describe('§3 a section fits on a screen', () => {
  test('the allowlists name real sections', () => {
    const ids = sections.map(([id]) => id);
    [...Object.keys(LONG_SECTIONS), ...Object.keys(LONG_UNITS)].forEach((id) => expect(ids).toContain(id));
  });

  test.each(sections)('%s', (id, section) => {
    const problems = [];
    const ratchet = (n, cap, list, what, listName) => {
      const allowed = list[id];
      if (allowed === undefined) {
        if (n > cap) problems.push(`${id}: ${what} is ${n} words, over ${cap}. Split it.`);
      } else if (n > allowed) {
        problems.push(`${id}: ${what} grew to ${n} words (allowed ${allowed}). Shorten it.`);
      } else if (n < allowed) {
        problems.push(`${id}: ${what} is down to ${n} words: ${n <= cap ? `delete ${listName}['${id}']` : `lower ${listName}['${id}'] to ${n}`}.`);
      }
    };
    ratchet(L.sectionWords(section), SECTION_CAP, LONG_SECTIONS, 'the section', 'LONG_SECTIONS');
    ratchet(L.longestUnitWords(section), UNIT_CAP, LONG_UNITS, 'its longest paragraph or item', 'LONG_UNITS');
    if (problems.length) throw new Error(problems.join('\n'));
  });
});
