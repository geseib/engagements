/**
 * The setup panel's decisions, as data.
 *
 * `GameHostPage` cannot be mounted in jsdom (it dies on the auth provider), so
 * anything expressed inline in it is unreachable from a test — which is how the
 * bitmask decode came to exist twice, byte for byte, with nothing holding the
 * two copies together. Following `config/hostControls.js`: the decision lives
 * here as pure data, and the panel renders it.
 */
import {
  setupPanelTabs, categoryRows, questionsRemaining,
  browserRow, filterBrowserRows, rosterRows,
} from '../config/setupPanel';

describe('setupPanelTabs — four tabs, none of them empty', () => {
  /**
   * THIS SAID THREE, AND THE OWNER ADDED THE FOURTH.
   *
   *   "perhaphs there is even a session tab that list questions so far, and
   *    lists those."
   *
   * Rounds sits between Questions and Settings on purpose: it is read
   * mid-session — "what did they say in round two" — while Settings is set once
   * and left. The assertion is still exact rather than loosened to a
   * `toContain`, because "a tab arriving unnoticed" is the thing worth
   * catching and a fifth one should come past this line too.
   */
  test('the four tabs are Players, Questions, Rounds and Settings, in that order', () => {
    // rejects: reordering, renaming, or a fifth tab arriving unnoticed.
    expect(setupPanelTabs({}).map((t) => t.id))
      .toEqual(['players', 'questions', 'history', 'settings']);
    expect(setupPanelTabs({}).map((t) => t.label))
      .toEqual(['Players', 'Questions', 'Rounds', 'Settings']);
  });

  test('no tab is ever emitted empty', () => {
    // rejects: a tab whose label is '' or whose id is missing — the failure
    // mode hostControls.test.js guards for the action bar.
    for (const phase of ['LOBBY', 'ASK', 'VOTE', 'RESULTS', 'FIELD_NOTES', 'ENDED']) {
      for (const tab of setupPanelTabs({ phase })) {
        expect(tab.id).toMatch(/\S/);
        expect(tab.label).toMatch(/\S/);
      }
    }
  });

  test('the word "Console" appears on none of them', () => {
    // rejects: reintroducing the proper noun user testing killed. The dock
    // says SETUP; nothing on screen says Console.
    for (const tab of setupPanelTabs({})) {
      expect(tab.label.toLowerCase()).not.toContain('console');
    }
  });
});

describe('categoryRows — one decode of the bitmask, not two', () => {
  const categories = [
    { name: 'Pricing Power', questionCount: 12 },
    { name: 'Competitive Response', questionCount: 9 },
    { name: 'Packaging', questionCount: 6 },
  ];
  const categoryCounts = { '1-8': [7, 9, 0], '9-16': [], '17-24': [] };
  const categoryBitmasks = {
    'HostMask1-8': '10100000',
    'HostMask9-16': '00000000',
    'HostMask17-24': '00000000',
  };

  test('a live game reads enabled state and remaining count off the masks', () => {
    // rejects: reading `activeCategoryIds` during a live game (the setup-time
    // source), which is what makes a toggle appear to do nothing until reload.
    const rows = categoryRows({ categories, categoryCounts, categoryBitmasks });
    expect(rows.map((r) => r.enabled)).toEqual([true, false, true]);
    expect(rows.map((r) => r.remaining)).toEqual([7, 9, 0]);
  });

  test('positions are 1-based, because the toggle endpoint takes a position', () => {
    // rejects: an off-by-one that toggles the neighbouring category — the
    // decode is index-based and the API is position-based.
    const rows = categoryRows({ categories, categoryCounts, categoryBitmasks });
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
  });

  test('a category at zero is marked exhausted', () => {
    // rejects: dropping the `exhausted` state, which is the only thing that
    // stops a host enabling a category that cannot yield a question.
    const rows = categoryRows({ categories, categoryCounts, categoryBitmasks });
    expect(rows.map((r) => r.exhausted)).toEqual([false, false, true]);
  });

  test('categories past the first byte decode from the second and third masks', () => {
    // rejects: the single-byte decode that would silently report every
    // category above position 8 as disabled with zero remaining. 24 categories
    // is the documented ceiling; a set with 10 is ordinary.
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `C${i + 1}` }));
    const rows = categoryRows({
      categories: many,
      categoryCounts: {
        '1-8': [0, 0, 0, 0, 0, 0, 0, 0],
        '9-16': [0, 0, 4, 0, 0, 0, 0, 0],
        '17-24': [0, 0, 0, 5],
      },
      categoryBitmasks: {
        'HostMask1-8': '00000000',
        'HostMask9-16': '00100000',
        'HostMask17-24': '00010000',
      },
    });
    expect(rows[10]).toMatchObject({ position: 11, enabled: true, remaining: 4 });
    expect(rows[19]).toMatchObject({ position: 20, enabled: true, remaining: 5 });
  });

  test('before a game starts it falls back to the setup-time selection', () => {
    // rejects: requiring the masks. During setup there are no counts and no
    // masks, and the row must still say which categories the host picked.
    const rows = categoryRows({
      categories,
      categoryCounts: null,
      categoryBitmasks: null,
      activeCategoryIds: new Set(['Packaging']),
    });
    expect(rows.map((r) => r.enabled)).toEqual([false, false, true]);
    expect(rows.map((r) => r.remaining)).toEqual([12, 9, 6]);
    expect(rows.every((r) => r.live === false)).toBe(true);
  });
});

describe('questionsRemaining — counted over ENABLED categories only', () => {
  test('a disabled category contributes nothing', () => {
    // rejects: summing every row, which prints a number the host cannot reach
    // — the shipped arithmetic the mockup drew as a static badge.
    const rows = [
      { enabled: true, remaining: 7 },
      { enabled: false, remaining: 9 },
      { enabled: true, remaining: 6 },
    ];
    expect(questionsRemaining(rows)).toBe(13);
  });

  test('with no rows at all it is zero, not NaN', () => {
    expect(questionsRemaining([])).toBe(0);
  });
});

describe('browserRow — the answer never reaches the stage', () => {
  /**
   * Question sets in the wild record `correctAnswer` four different ways —
   * "OptionA", "A", the option's own TEXT, or an array of any of those. The
   * text variant is the one that makes this test bite: a projection that keeps
   * the option block leaks the answer without ever naming the field.
   */
  const variants = {
    'the slot id': 'OptionB',
    'the bare letter': 'B',
    'the option text': 'Seat-based to usage-based billing',
    'an array': ['OptionB'],
  };

  const questionWith = (correctAnswer, key = 'correctAnswer') => ({
    id: 'q-12',
    title: 'Which pricing change produced the largest margin gain?',
    questionDetail: 'At a large B2B software company.',
    category: 'Pricing Mechanics',
    difficulty: 'Hard',
    optionA: 'A 5% list increase held through renewal',
    optionB: 'Seat-based to usage-based billing',
    optionC: 'A premium support tier',
    optionD: 'Discounting the entry plan',
    answerDetails: 'Because usage tracks value.',
    [key]: correctAnswer,
  });

  const valuesOf = (row) => Object.values(row).flatMap((v) => (Array.isArray(v) ? v : [v]));

  for (const [name, correct] of Object.entries(variants)) {
    for (const field of ['correctAnswer', 'CorrectAnswer']) {
      test(`no value in the row equals the answer, given ${name} in ${field}`, () => {
        // rejects: keeping the mockup's option block. With the answer recorded
        // as option TEXT, shipping optionB puts the answer on a surface the
        // room is looking at — which is the entire reason this projection
        // exists rather than passing the question through.
        const question = questionWith(correct, field);
        const row = browserRow(question);
        const answers = Array.isArray(correct) ? correct : [correct];
        for (const value of valuesOf(row)) {
          for (const answer of answers) {
            expect(value).not.toBe(answer);
          }
        }
      });
    }
  }

  test('the answer explanation does not ride along either', () => {
    // rejects: keeping `answerDetails`, which get-question.js calls "the
    // spoiler" in its own comment and withholds from players for that reason.
    const row = browserRow(questionWith('OptionB'));
    expect(valuesOf(row)).not.toContain('Because usage tracks value.');
  });

  test('it is an allow-list, not a spread', () => {
    // rejects: `{ ...question, correctAnswer: undefined }`. The browsing
    // endpoint passes through EVERY unrecognised database field
    // (get-question-set-questions.js), so a spread ships whatever a future set
    // happens to carry — including a second copy of the answer under a name
    // nothing here knows to strip.
    const row = browserRow({ ...questionWith('OptionB'), secretSauce: 'OptionB is right' });
    expect(valuesOf(row)).not.toContain('OptionB is right');
    expect(Object.keys(row)).not.toContain('secretSauce');
  });

  test('it still carries what a host needs in order to choose', () => {
    // rejects: over-stripping into uselessness. What the question asks, which
    // category, how hard, and whether it has been used — and nothing else.
    expect(browserRow(questionWith('OptionB'))).toMatchObject({
      id: 'q-12',
      title: 'Which pricing change produced the largest margin gain?',
      detail: 'At a large B2B software company.',
      category: 'Pricing Mechanics',
      difficulty: 'Hard',
      used: false,
    });
  });

  test('a multiple-choice question says so by shape, never by content', () => {
    // rejects: printing the options. The row must distinguish free-text from
    // multiple choice — the mockup's own "Free-text response" line — without
    // reproducing a single option.
    const mc = browserRow(questionWith('OptionB'));
    expect(mc.responseKind).toBe('Multiple choice');
    expect(mc.optionCount).toBe(4);

    const free = browserRow({ id: 'q-13', title: 'What would have to be true?' });
    expect(free.responseKind).toBe('Free-text response');
    expect(free.optionCount).toBe(0);
  });

  test('it reads the capitalised field names too', () => {
    // rejects: handling only the lower-case variants. The browsing endpoint
    // maps most fields but passes others through raw, and sets in the wild
    // carry both spellings.
    expect(browserRow({ id: 'x', Title: 'Cap T', Detail: 'Cap D', Category: 'Cap C' }))
      .toMatchObject({ title: 'Cap T', detail: 'Cap D', category: 'Cap C' });
  });

  test('a question the host has already asked is marked used', () => {
    // rejects: dropping the used flag, which is the question a host asks most
    // — "did I already use this?" — and the reason used rows stay in the list
    // rather than disappearing from it.
    expect(browserRow({ id: 'q-12' }, { usedIds: ['q-12'] }).used).toBe(true);
    expect(browserRow({ id: 'q-99' }, { usedIds: ['q-12'] }).used).toBe(false);
    expect(browserRow({ id: 'q-12' }, { usedIds: new Set(['q-12']) }).used).toBe(true);
  });
});

describe('filterBrowserRows — narrowing forty-seven rows to five', () => {
  const rows = [
    { id: '1', title: 'Pricing power at renewal', category: 'Pricing Power', used: false },
    { id: '2', title: 'Competitor cuts list price', category: 'Competitive Response', used: true },
    { id: '3', title: 'Packaging and pricing the top tier', category: 'Packaging', used: false },
    { id: '4', title: 'Discount discipline', category: 'Pricing Power', used: true },
  ];

  test('with no filters at all, every row survives', () => {
    expect(filterBrowserRows(rows, {}).map((r) => r.id)).toEqual(['1', '2', '3', '4']);
  });

  test('search matches the title, case-insensitively', () => {
    // rejects: a case-sensitive `includes`, which makes the box look broken
    // for the first character a host types.
    expect(filterBrowserRows(rows, { search: 'PRICING' }).map((r) => r.id)).toEqual(['1', '3']);
  });

  test('a category chip narrows to that category', () => {
    expect(filterBrowserRows(rows, { category: 'Pricing Power' }).map((r) => r.id))
      .toEqual(['1', '4']);
  });

  test('"Unasked only" hides used rows and nothing else', () => {
    // rejects: making used rows disappear unconditionally. They stay at
    // reduced opacity by default — hiding the row hides the answer to the
    // question the host was asking.
    expect(filterBrowserRows(rows, { unaskedOnly: true }).map((r) => r.id)).toEqual(['1', '3']);
  });

  test('the filters compose', () => {
    expect(filterBrowserRows(rows, { category: 'Pricing Power', unaskedOnly: true })
      .map((r) => r.id)).toEqual(['1']);
  });
});

describe('rosterRows — every player, in score order', () => {
  const players = [
    { name: 'Ada', score: 3 },
    { name: 'Grace', score: 9 },
    { name: 'Alan', score: 9 },
    { name: 'Edsger' },
  ];

  test('highest score first, and a missing score sorts as zero', () => {
    // rejects: leaving the roster in arrival order, or letting an undefined
    // score sort above a real one.
    expect(rosterRows({ players }).map((r) => r.name))
      .toEqual(['Grace', 'Alan', 'Ada', 'Edsger']);
    expect(rosterRows({ players }).map((r) => r.score)).toEqual([9, 9, 3, 0]);
  });

  test('a tie shares a rank, and the next player skips one', () => {
    // rejects: re-deriving rank as index+1 — the tie handling
    // calculatePlayerRankings already gets right.
    expect(rosterRows({ players }).map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  test('during ASK the tick reads who has ANSWERED', () => {
    const rows = rosterRows({
      players, gameState: 'ASK#001', playersWhoAnswered: ['Grace'], playersWhoVoted: ['Ada'],
    });
    expect(rows.find((r) => r.name === 'Grace').done).toBe(true);
    expect(rows.find((r) => r.name === 'Ada').done).toBe(false);
  });

  test('during VOTE the tick reads who has VOTED', () => {
    // rejects: keying both phases off playersWhoAnswered — everyone answered,
    // so every tick would be green through a vote nobody had cast.
    const rows = rosterRows({
      players, gameState: 'VOTE#001', playersWhoAnswered: ['Grace'], playersWhoVoted: ['Ada'],
    });
    expect(rows.find((r) => r.name === 'Ada').done).toBe(true);
    expect(rows.find((r) => r.name === 'Grace').done).toBe(false);
  });

  test('outside those two phases there is no tick to show', () => {
    // rejects: rendering a permanently-pending timer icon on LOBBY and
    // RESULTS, where nothing is being waited for.
    for (const gameState of ['LOBBY', 'RESULTS#001', 'ENDED', '']) {
      expect(rosterRows({ players, gameState }).every((r) => r.done === null)).toBe(true);
    }
  });

  test('a player with no name at all still gets a row', () => {
    // rejects: keying off `player.name` alone and dropping the row (or
    // crashing) for a player the socket delivered under `playerName`.
    expect(rosterRows({ players: [{ playerName: 'Barbara', score: 1 }] })[0].name)
      .toBe('Barbara');
    expect(rosterRows({ players: [{ score: 1 }] })[0].name).toBe('Unknown Player');
  });

  test('no row carries an email address', () => {
    // rejects: widening the projection to pass the player object through. The
    // room can watch this panel; the room must never see an email address.
    const rows = rosterRows({ players: [{ name: 'Ada', score: 1, email: 'ada@example.com' }] });
    expect(Object.values(rows[0])).not.toContain('ada@example.com');
    expect(Object.keys(rows[0])).not.toContain('email');
  });
});
