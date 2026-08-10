/**
 * What the session setup panel shows, as pure data.
 *
 * The panel replaces both edge tabs and both side panels (spec §3.1). Its
 * decisions live here rather than inline in GameHostPage.jsx for the reason
 * `config/hostControls.js` gives: that file needs an AuthProvider and a live
 * socket to render at all, so a rule written inside it is a rule nothing can
 * test — which is how the bitmask decode below came to exist TWICE, byte for
 * byte, in two places that could drift apart silently.
 *
 * "Console" is the internal name for this surface and must stay internal: user
 * testing killed the proper noun ("Nobody in the room needs to learn a proper
 * noun"). The dock says SETUP and the panel heading says Session setup.
 */

/**
 * Three tabs, named by the owner: Players · Questions · Settings.
 *
 * A function rather than a constant because the panel's siblings in this
 * codebase are all phase-aware and the next change to this file will be too —
 * but nothing yet varies by phase, and inventing a variation nothing asks for
 * would be a fourth tab nobody ruled on. It takes the argument and ignores it,
 * visibly.
 */
export function setupPanelTabs() {
  return [
    { id: 'players', label: 'Players' },
    { id: 'questions', label: 'Questions' },
    { id: 'settings', label: 'Settings' },
  ];
}

/**
 * THE ONE DECODE OF THE CATEGORY BITMASK.
 *
 * Categories are stored as three bytes of `1`/`0` — `HostMask1-8`,
 * `HostMask9-16`, `HostMask17-24` — beside a parallel `categoryCounts` map of
 * how many questions each still has. Position is 1-based because that is what
 * the toggle endpoint takes; the arrays are 0-based. Getting that seam wrong
 * toggles the neighbouring category, which is why `position` is returned rather
 * than recomputed at the call site.
 *
 * Before a game starts there are no masks and no counts, so the row falls back
 * to the setup-time selection (`activeCategoryIds`) and the set's own static
 * question count. `live` says which of the two a row came from, because the
 * click means different things: during a game it hits the API, during setup it
 * edits a local Set.
 */
export function categoryRows({
  categories = [],
  categoryCounts = null,
  categoryBitmasks = null,
  activeCategoryIds = new Set(),
} = {}) {
  const live = Boolean(categoryCounts && categoryBitmasks);

  return categories.map((category, index) => {
    const position = index + 1;
    let enabled;
    let remaining;

    if (live) {
      const [maskKey, countKey, offset] = position <= 8
        ? ['HostMask1-8', '1-8', 1]
        : position <= 16
          ? ['HostMask9-16', '9-16', 9]
          : ['HostMask17-24', '17-24', 17];
      enabled = categoryBitmasks[maskKey]?.charAt(position - offset) === '1';
      remaining = categoryCounts[countKey]?.[position - offset] || 0;
    } else {
      enabled = activeCategoryIds.has(category.name);
      remaining = category.questionCount || 0;
    }

    return {
      name: category.name,
      position,
      enabled,
      remaining,
      // The state that stops a host enabling a category which cannot yield a
      // question. Drawn nowhere in the mockups; shipped and correct.
      exhausted: remaining === 0,
      live,
    };
  });
}

/** How many questions the host can still reach — enabled categories only. */
export function questionsRemaining(rows = []) {
  return rows.reduce((total, row) => (row.enabled ? total + (row.remaining || 0) : total), 0);
}

const OPTION_KEYS = [
  ['optionA', 'OptionA'], ['optionB', 'OptionB'],
  ['optionC', 'OptionC'], ['optionD', 'OptionD'],
];

const first = (question, ...names) => {
  for (const name of names) {
    const value = question[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

/**
 * One row of the question browser — everything a host needs in order to choose,
 * and nothing that would spoil the round for the room reading over their
 * shoulder.
 *
 * AN ALLOW-LIST, NEVER A SPREAD, and that is the whole design. The browsing
 * endpoint (`admin/get-question-set-questions.js`) explicitly maps the fields
 * it knows and then passes through every field it does not, so
 * `{ ...question }` ships whatever a set happens to carry — including a second
 * copy of the answer under a name this file has never heard of.
 *
 * THE OPTIONS ARE GONE, and this is a deliberate change to what
 * `18-question-browser.html` draws. Sets in the wild record `correctAnswer` as
 * the option's own TEXT as often as they record it as "OptionB", so a row that
 * carries the four options carries the answer whenever that variant is used —
 * on a surface every display profile shares with the room. The row says a
 * question is multiple choice and how many options it has; it does not say what
 * they are. The stage browser shows what the question is ABOUT; the remote, on
 * the host's own phone, is where the text lives.
 */
export function browserRow(question = {}, { usedIds = [] } = {}) {
  const id = first(question, 'id', 'Id', 'questionId');
  const used = usedIds instanceof Set ? usedIds.has(id) : usedIds.includes(id);
  const optionCount = OPTION_KEYS
    .filter((names) => first(question, ...names) !== undefined).length;

  return {
    id,
    title: first(question, 'title', 'Title') || '',
    detail: first(
      question,
      'questionDetail', 'QuestionDetail', 'detail', 'Detail',
      'customInstructions', 'CustomInstructions',
    ) || '',
    category: first(question, 'category', 'Category') || '',
    difficulty: first(question, 'difficulty', 'Difficulty') || '',
    responseKind: optionCount > 0 ? 'Multiple choice' : 'Free-text response',
    optionCount,
    used,
  };
}

/**
 * Search, category chip and `Unasked only`, composed.
 *
 * Used rows are NOT hidden by default: "did I already use this?" is the
 * question a host asks most, and hiding the row hides the answer to it. They
 * stay in the list at reduced opacity with `Ask again`, and the filter is
 * opt-in.
 */
export function filterBrowserRows(rows = [], { search = '', category = '', unaskedOnly = false } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (needle && !(row.title || '').toLowerCase().includes(needle)) return false;
    if (category && row.category !== category) return false;
    if (unaskedOnly && row.used) return false;
    return true;
  });
}

/**
 * Every player, in score order, with a per-round done/pending tick.
 *
 * THE OWNER'S RULING, against a design review that wanted this moved to the
 * phone: *"the anonymity is just for preventing people voting for an answer
 * based on who said it. thats it."* `config/anonymity.js` already argues the
 * same position — no points exist until RESULTS, and entering RESULTS is what
 * reveals — so a cumulative total cannot attribute an unrevealed answer.
 *
 * The tick is keyed off the phase because the two lists mean different things:
 * during ASK everyone who has answered is done, and during VOTE everyone has
 * already answered, so reading `playersWhoAnswered` there would show a full set
 * of green ticks through a vote nobody had cast. Outside those two phases there
 * is nothing being waited for and the tick is `null` rather than a permanently
 * pending timer.
 *
 * The projection is an allow-list for the same reason `browserRow` is: the room
 * can watch this panel, and the room must never see an email address.
 */
export function rosterRows({
  players = [],
  gameState = '',
  playersWhoAnswered = [],
  playersWhoVoted = [],
} = {}) {
  const asking = gameState.startsWith('ASK#');
  const voting = gameState.startsWith('VOTE#');

  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

  let currentRank = 1;
  return sorted.map((player, index) => {
    if (index > 0 && (player.score || 0) !== (sorted[index - 1].score || 0)) {
      currentRank = index + 1;
    }
    const name = player.name || player.playerName || 'Unknown Player';
    const done = asking
      ? playersWhoAnswered.includes(player.name)
      : voting
        ? playersWhoVoted.includes(player.name)
        : null;
    return { name, score: player.score || 0, rank: currentRank, done };
  });
}
