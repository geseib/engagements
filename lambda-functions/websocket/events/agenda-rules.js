/**
 * THE AGENDA'S RULES — what an event may hold, when each item starts, and how
 * long the event's rows are kept. Written once, and read on both sides of the
 * wire: the event routes in this folder, and the console's builder
 * (src/src/components/EventBuilder.jsx, EventItemDialog.jsx and
 * EventDetailsDialog.jsx import this file, as PlanRequestDialog.jsx imports
 * lambda-functions/game/pricing.js).
 *
 * PURE. No AWS SDK, no `process`, no DOM, and no clock of its own: a caller
 * that needs "now" passes it. That is what lets one file be the rule in a
 * Lambda and in a browser, and lets tests/event-agenda-rules.js pin it with no
 * stubs. `require` must never appear in this file; that test reads it as text.
 *
 * ── THE CAPS (owner, 23 Sep 2026, decision 1) ─────────────────────────────
 * "up to 16 agenda items with 8 of them being engagement sessions".
 *   - A BREAK counts toward neither (decision 7): "breaks should be listed but
 *     dont count toward any count".
 *   - A break is still a row, so it has a ceiling of its own, MAX_BREAKS. Not
 *     a limit anybody asked for: a bound that keeps a whole agenda (16 + 16
 *     rows) inside one DynamoDB transaction (100 items) when it is reordered
 *     or re-dated.
 *
 * ── THE TIMES ──────────────────────────────────────────────────────────────
 * "The planned times are the event's start plus the running total"
 * (RATIONALE §b). Nothing is stored per item: move one and every time after it
 * moves, on the server and in the builder alike, because both call
 * `agendaTimes`. `startsAt` is the event's LOCAL wall-clock start,
 * `YYYY-MM-DDTHH:MM`, read in the event's own `timeZone` (40-data-model:
 * `StartsAt "2026-10-09T09:00"`, `TimeZone "Europe/London"`). Times print as
 * that wall clock, 24-hour, never converted: the agenda is a printed plan and
 * reads the same on every phone, laptop or tablet.
 *
 * ── HOW LONG AN EVENT IS KEPT ──────────────────────────────────────────────
 * RATIONALE §b: event rows are kept 90 days after the event. A session's clock
 * (session-ttl.js) runs from its creation, 90 days unstarted, 7 once started.
 * An event is booked weeks ahead, so its clock runs from its DATE, and never
 * from before now. `eventTtl` takes UTC midnight two days after the event's
 * date — later than the last minute of that date in every time zone on Earth
 * (UTC-12 to UTC+14) — plus 90 days. The code's reservation carries the same
 * figure, so the code outlives the day and its child sessions' 7 days by more
 * than 80 days, and websocket/code-reservation.js refuses the code to anyone
 * while an EVENT# row is still there (DynamoDB deletes lazily).
 */

const MAX_ITEMS = 16;
const MAX_ENGAGEMENTS = 8;
const MAX_BREAKS = 16;

const ENGAGEMENT_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']);
const PRESENTATION = 'presentation';
/**
 * AN ACTIVITY — the owner's "custom choice ... where they could fill in what
 * they want" (26 Sep 2026): networking, lunch with a speaker, an open
 * discussion, a workshop activity. A title the host writes, an optional
 * leader, a length and a description. Nothing to answer and no session; it
 * counts toward the 16 items and never toward the 8 engagements. `custom` on
 * the wire, "Activity" wherever a person reads it (TYPE_LABELS).
 */
const CUSTOM = 'custom';
const BREAK = 'break';
/**
 * Every kind may be added (events M1b). A presentation is a placeholder until
 * roadmap M5 brings its PDF copy: a title, a presenter, a length and a
 * description, on the agenda and counted as an item.
 */
const ITEM_TYPES = Object.freeze([...ENGAGEMENT_TYPES, PRESENTATION, CUSTOM, BREAK]);

const TYPE_LABELS = Object.freeze({
  trivia: 'Trivia',
  'call-and-answer': 'Call & Answer',
  poll: 'Poll',
  wavelength: 'Wavelength',
  survey: 'Survey',
  [PRESENTATION]: 'Presentation',
  [CUSTOM]: 'Activity',
  [BREAK]: 'Break',
});

/**
 * Set rows store `engagementType` under older spellings too. A verbatim copy
 * of ALIASES in lambda-functions/game/game-types.js and src/src/config/
 * gameTypes.js — the websocket bundle carries no game-types.js — and
 * tests/event-agenda-rules.js holds them equal.
 */
const TYPE_ALIASES = Object.freeze({
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll',
});

/** A set row's type as an engagement type, or '' for one no event can play. */
function canonicalSetType(raw) {
  const key = String(raw == null ? '' : raw).trim().toLowerCase();
  // A set row with no type predates the field; create-game.js has always
  // played one as Call & Answer.
  if (!key) return 'call-and-answer';
  if (ENGAGEMENT_TYPES.includes(key)) return key;
  return TYPE_ALIASES[key] || '';
}

const isEngagement = (type) => ENGAGEMENT_TYPES.includes(type);
const isCounted = (type) => type !== BREAK;

/** `{items, engagements, breaks}` for a list of items (`type` or `Type`). */
function countItems(items) {
  const out = { items: 0, engagements: 0, breaks: 0 };
  for (const it of items || []) {
    const type = it && (it.type || it.Type);
    if (type === BREAK) {
      out.breaks += 1;
    } else {
      out.items += 1;
      if (isEngagement(type)) out.engagements += 1;
    }
  }
  return out;
}

/** The sentences a refusal says, in the builder's menu and from the server alike. */
const CAP_SENTENCES = Object.freeze({
  engagements: `This event has ${MAX_ENGAGEMENTS} engagements, the most one can hold. Remove one to add another.`,
  items: `This event has ${MAX_ITEMS} items, the most one can hold. Remove one to add another.`,
  breaks: `This event has ${MAX_BREAKS} breaks, the most one can hold.`,
});

/** Why an item of `type` cannot join an agenda holding `counts`, or null. */
function capRefusal(counts, type) {
  const c = counts || {};
  if (type === BREAK) {
    return (Number(c.breaks) || 0) >= MAX_BREAKS ? { cap: 'breaks', message: CAP_SENTENCES.breaks } : null;
  }
  if ((Number(c.items) || 0) >= MAX_ITEMS) return { cap: 'items', message: CAP_SENTENCES.items };
  if (isEngagement(type) && (Number(c.engagements) || 0) >= MAX_ENGAGEMENTS) {
    return { cap: 'engagements', message: CAP_SENTENCES.engagements };
  }
  return null;
}

// ── Fields ──────────────────────────────────────────────────────────────────
const TITLE_MAX = 120;
const PLACE_MAX = 120;
const DESCRIPTION_MAX = 600;
/**
 * WHO LEADS AN ITEM (events M1b): one free-text name on every item but a
 * break, labelled for its kind. Optional — a talk is often booked before its
 * speaker. A person's name is personal data: items.js stores it as `LedBy`,
 * sealed with the `item` entity.
 */
const LED_BY_MAX = 80;
const LED_BY_LABELS = Object.freeze({
  engagement: 'Facilitator',
  [PRESENTATION]: 'Presenter',
  [CUSTOM]: 'Led by',
});
const hasLeader = (type) => ITEM_TYPES.includes(type) && type !== BREAK;
/** "Facilitator", "Presenter" or "Led by"; '' for a break. */
function ledByLabel(type) {
  if (isEngagement(type)) return LED_BY_LABELS.engagement;
  return LED_BY_LABELS[type] || '';
}
const MIN_MINUTES = 1;
const MAX_MINUTES = 240;
/** Who can join. `invite` is PLAN Phase 3; the dialog shows it, disabled. */
const ACCESS_CHOICES = Object.freeze(['open', 'invite']);
const ACCESS_NOW = Object.freeze(['open']);
/** What attendees get of each report (decision 3); Full unless changed. */
const REPORT_DEFAULTS = Object.freeze(['full', 'anonymous', 'none']);

const DAY = 24 * 60 * 60;
const KEEP_DAYS = 90;
const MAX_DAYS_AHEAD = 366;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Is this an IANA time zone this runtime knows? */
function isTimeZone(zone) {
  const z = text(zone);
  if (!z) return false;
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone);
  } catch (e) {
    return false;
  }
}

/** `YYYY-MM-DDTHH:MM` on a real calendar day, as numbers, or null. */
function parseStartsAt(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text(value));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d, h, mi };
}

/**
 * An event's details, checked and normalised — for the new-event dialog and
 * for POST and PUT /events alike. `nowSeconds`, when given, bounds how far
 * ahead a date may be: a code held for years is a code nobody else can have.
 * @returns {{value?: object, error?: string}}
 */
function checkEventFields(input, { nowSeconds } = {}) {
  const i = input || {};
  const title = text(i.title);
  if (!title) return { error: 'Give the event a name.' };
  if (title.length > TITLE_MAX) return { error: `A name can be ${TITLE_MAX} characters at most.` };
  const place = text(i.place);
  if (place.length > PLACE_MAX) return { error: `A place can be ${PLACE_MAX} characters at most.` };
  const startsAt = text(i.startsAt);
  const s = parseStartsAt(startsAt);
  if (!s) return { error: 'Choose a date and a start time.' };
  if (Number.isFinite(nowSeconds)) {
    const day = Date.UTC(s.y, s.mo - 1, s.d) / 1000;
    if (day > nowSeconds + MAX_DAYS_AHEAD * DAY) return { error: 'Choose a date within the next year.' };
  }
  const timeZone = text(i.timeZone);
  if (!isTimeZone(timeZone)) return { error: 'Choose a time zone.' };
  const access = text(i.access) || 'open';
  if (!ACCESS_CHOICES.includes(access)) return { error: 'Choose who can join.' };
  if (!ACCESS_NOW.includes(access)) return { error: 'Invite-only events are not available yet.' };
  const attendeeReports = text(i.attendeeReports) || 'full';
  if (!REPORT_DEFAULTS.includes(attendeeReports)) return { error: 'Choose what attendees get of each report.' };
  return { value: { title, place, startsAt, timeZone, access, attendeeReports } };
}

/**
 * An item's own words and length. A break may leave its title blank; it is
 * then called "Break".
 * @returns {{value?: {title, description, minutes}, error?: string}}
 */
function checkItemFields(input, type) {
  const i = input || {};
  const title = text(i.title) || (type === BREAK ? 'Break' : '');
  if (!title) return { error: 'Give the item a title for the agenda.' };
  if (title.length > TITLE_MAX) return { error: `A title can be ${TITLE_MAX} characters at most.` };
  const description = text(i.description);
  if (description.length > DESCRIPTION_MAX) {
    return { error: `A description can be ${DESCRIPTION_MAX} characters at most.` };
  }
  const minutes = Number(i.minutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return { error: `A planned length is a whole number of minutes, ${MIN_MINUTES} to ${MAX_MINUTES}.` };
  }
  return { value: { title, description, minutes } };
}

/**
 * Who leads an item, checked (events M1b): a trimmed name of at most
 * LED_BY_MAX characters, '' for nobody. A break is led by nobody, and a name
 * sent for one is refused rather than dropped.
 * @returns {{value: string}|{error: string}}
 */
function checkLedBy(input, type) {
  const ledBy = text(input);
  if (type === BREAK) return ledBy ? { error: 'A break is not led by anyone.' } : { value: '' };
  if (ledBy.length > LED_BY_MAX) return { error: `A name can be ${LED_BY_MAX} characters at most.` };
  return { value: ledBy };
}

// ── An engagement's session options (events M1b) ───────────────────────────
/**
 * WHAT AN ENGAGEMENT ITEM CARRIES OF THE SESSION IT BECOMES. The owner, 26
 * Sep 2026: "It would also be nice if all of the options that you get when
 * setting up each engagement is avail". The item dialog renders the create
 * dialog's own options (src/src/components/SessionOptions.jsx), and the item
 * stores what they say as one map, `Settings`, under the create dialog's own
 * payload keys — so roadmap M3 turns an item into a session with
 * `sessionFormOf` below and the create dialog's createGameBody, and cannot
 * drift (src/src/__tests__/itemSessionMapping.test.js).
 *
 * Which options a format has is the create dialog's rule:
 *   every engagement   personaId, promptId, aiContext, eventDetails
 *   not a survey       randomizeQuestions, categoryIds, target
 *   a vote to hide     anonymousResponses   (call-and-answer, poll)
 *   a survey           names
 *   call-and-answer    briefing
 * `SETTING_DEFAULTS` is what the create dialog sends for an untouched form
 * (config/setupDefaults.js); an empty `categoryIds` means every category, as
 * it does at create.
 */
const SETTING_DEFAULTS = Object.freeze({
  anonymousResponses: true,
  randomizeQuestions: true,
  names: 'anonymous',
  target: null,
  categoryIds: Object.freeze([]),
  personaId: '',
  promptId: '',
  aiContext: '',
  eventDetails: '',
  briefing: null,
});
const SETTING_KEYS = Object.freeze(Object.keys(SETTING_DEFAULTS));
const ANONYMITY_TYPES = Object.freeze(['call-and-answer', 'poll']);
const WORKIE_KEYS = Object.freeze(['personaId', 'promptId', 'aiContext', 'eventDetails']);

/** The option keys an item of `type` stores; [] for anything but an engagement. */
function settingKeysFor(type) {
  if (!isEngagement(type)) return [];
  if (type === 'survey') return ['names', ...WORKIE_KEYS];
  return [
    ...(ANONYMITY_TYPES.includes(type) ? ['anonymousResponses'] : []),
    'randomizeQuestions', 'categoryIds', 'target',
    ...(type === 'call-and-answer' ? ['briefing'] : []),
    ...WORKIE_KEYS,
  ];
}

/** Only the keys that apply to `type`: each given value, else its default (an array is always a fresh copy). */
function settingsFor(type, values) {
  const given = values && typeof values === 'object' ? values : {};
  const out = {};
  for (const key of settingKeysFor(type)) {
    const value = given[key] === undefined ? SETTING_DEFAULTS[key] : given[key];
    out[key] = Array.isArray(value) ? value.slice() : value;
  }
  return out;
}

/**
 * An item as the create dialog's payload (GameSetupDialog → createGameBody).
 * `setVersion` rides beside it: createGameBody has no version input, and M3
 * sends it as `questionSetVersion`, which create-game.js already accepts. The
 * item's description, leader and length are the agenda's own, and stay out.
 */
function sessionFormOf(item) {
  const i = item || {};
  const ref = i.setRef || {};
  return {
    title: i.title || '',
    gameType: i.type,
    setId: ref.setId || '',
    setScope: ref.scope || '',
    setVersion: ref.version === undefined ? null : ref.version,
    ...settingsFor(i.type, i.settings),
  };
}

// ── Times ───────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

/** Minutes after midnight as a 24-hour wall clock, `9:05`; wraps past midnight. */
function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/**
 * Every item's planned start and end, in agenda order, and when the day ends.
 * Items are taken in the order given; each needs `minutes` (or `Minutes`).
 * @returns {{rows: Array<object>, endsAt: string, totalMinutes: number}}
 */
function agendaTimes(startsAt, items) {
  const s = parseStartsAt(startsAt);
  const start = s ? s.h * 60 + s.mi : 0;
  let t = start;
  const rows = (items || []).map((item) => {
    const minutes = Number(item && (item.minutes !== undefined ? item.minutes : item.Minutes)) || 0;
    const row = { ...item, at: clock(t), until: clock(t + minutes) };
    t += minutes;
    return row;
  });
  return { rows, endsAt: clock(t), totalMinutes: t - start };
}

/** `2 h 43 min`, or `45 min`. */
function formatDuration(totalMinutes) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Epoch seconds at which an event dated `startsAt` may be forgotten. */
function eventTtl(startsAt, nowSeconds) {
  const s = parseStartsAt(startsAt);
  const now = Number.isFinite(nowSeconds) ? Math.floor(nowSeconds) : 0;
  const afterTheDay = s ? Math.floor(Date.UTC(s.y, s.mo - 1, s.d + 2) / 1000) : now;
  return Math.max(afterTheDay, now) + KEEP_DAYS * DAY;
}

// ── Words for a date ────────────────────────────────────────────────────────
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekdayOf(s) {
  return WEEKDAYS[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()];
}

/** `Fri 9 Oct 2026` — the facts strip and the agenda page. */
function formatEventDay(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? `${weekdayOf(s)} ${s.d} ${MONTHS[s.mo - 1]} ${s.y}` : '';
}

/** `9:00` — the start, as the agenda prints times. */
function formatStartTime(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? clock(s.h * 60 + s.mi) : '';
}

/** `Fri 9 Oct · 9:00` — the events list's When column. */
function formatEventWhen(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? `${weekdayOf(s)} ${s.d} ${MONTHS[s.mo - 1]} · ${formatStartTime(startsAt)}` : '';
}

module.exports = {
  MAX_ITEMS, MAX_ENGAGEMENTS, MAX_BREAKS,
  ENGAGEMENT_TYPES, PRESENTATION, CUSTOM, BREAK, ITEM_TYPES,
  TYPE_LABELS, TYPE_ALIASES, CAP_SENTENCES,
  TITLE_MAX, PLACE_MAX, DESCRIPTION_MAX, LED_BY_MAX, LED_BY_LABELS, MIN_MINUTES, MAX_MINUTES,
  hasLeader, ledByLabel,
  ACCESS_CHOICES, ACCESS_NOW, REPORT_DEFAULTS, DAY, KEEP_DAYS, MAX_DAYS_AHEAD,
  canonicalSetType, isEngagement, isCounted, countItems, capRefusal,
  SETTING_DEFAULTS, SETTING_KEYS, settingKeysFor, settingsFor, sessionFormOf,
  isTimeZone, parseStartsAt, checkEventFields, checkItemFields, checkLedBy,
  clock, agendaTimes, formatDuration, eventTtl,
  formatEventDay, formatStartTime, formatEventWhen,
};
