/**
 * Copy for /use-cases, transcribed verbatim from
 * docs/design/marketing-redesign/03-use-cases.html (entities decoded).
 *
 * @typedef {Object} UseCase
 * @property {string} id
 * @property {string} kicker - the "NN · Name" label above the case's own heading.
 * @property {string} title - the case's own heading (the mockup's <h3> text).
 * @property {{kind: string, detail: string}} setType - "Set type: <kind>, <detail>".
 * @property {string} before
 * @property {string} after
 * @property {{label: string, href: string, primary?: boolean}[]} actions
 */

/** @type {UseCase[]} */
export const USE_CASES = [
  {
    id: 'build-room',
    kicker: '01 · Build Room',
    title: 'Build software with the people who will use it',
    setType: {
      kind: 'Build Room',
      detail: 'a shared session connected to a Claude Code project.',
    },
    before: 'Requirements pass from meeting notes to a developer. The team sees the result days later, after the choices are hard to change.',
    after: 'The room suggests, votes and tests while Claude Code builds. The host carries each decision into the project, and History keeps the reasons with the work.',
    actions: [
      { label: 'See the Build Room', href: '/build-room' },
      { label: 'Create a host account', href: '/auth?mode=register', primary: true },
    ],
  },
  {
    id: 'offsite',
    kicker: '02 · Strategy offsite',
    title: 'Two days, forty opinions, one plan',
    setType: {
      kind: 'call and answer',
      detail: 'drafted from the strategy paper everyone was sent and nobody finished.',
    },
    before: 'The loudest table sets the agenda by lunchtime. Three flip charts of sticky notes go home in a phone photo and are never opened.',
    after: 'Every person answers each prompt from their seat, so the quiet half is on the screen too. The room votes on what it has just read. The report is circulated before anyone reaches the car park.',
    actions: [
      { label: 'Create a host account', href: '/auth?mode=register', primary: true },
      { label: 'See the report', href: '/reports' },
    ],
  },
  {
    id: 'retro',
    kicker: '03 · Retrospective',
    title: 'What we stop, start and keep',
    setType: {
      kind: 'call and answer',
      detail: 'three prompts, drafted from the last two retro notes.',
    },
    before: 'People wait to hear what the manager thinks before saying what they think. The same two items are raised every sprint and never resolved.',
    after: 'Everyone writes at the same moment, before anyone has heard anyone else. Names can be hidden for the whole session. The vote decides which item the team carries, and the report shows the ones it did not.',
    actions: [
      { label: 'Create a host account', href: '/auth?mode=register', primary: true },
      { label: 'How a round runs', href: '/how-it-works' },
    ],
  },
  {
    id: 'decision',
    kicker: '04 · Decision workshop',
    title: 'Three options, one room, a record of why',
    setType: {
      kind: 'call and answer',
      detail: 'one prompt per option, drafted from the options paper.',
    },
    before: 'The decision is made in the room and the reasoning stays in the room. Six weeks later nobody can say which objections were raised and answered.',
    after: 'Each option collects its own answers and its own vote. The report keeps the objections with the option they were raised against, including the ones that won no votes.',
    actions: [
      { label: 'Create a host account', href: '/auth?mode=register', primary: true },
      { label: 'See the report', href: '/reports' },
    ],
  },
  {
    id: 'warmup',
    kicker: '05 · Team trivia warm-up',
    title: 'Ten minutes that wake the room up',
    setType: {
      kind: 'trivia',
      detail: 'ten questions, drafted from the onboarding handbook and last quarter’s numbers.',
    },
    before: 'The first twenty minutes of the day are spent waiting for people to stop reading email. An icebreaker with no connection to the work.',
    after: 'Ten questions about your own material, with the explanation on the results screen. People arrive knowing what the day is about, and the standings give the room something to laugh at.',
    actions: [
      { label: 'Create a host account', href: '/auth?mode=register', primary: true },
      { label: 'How a round runs', href: '/how-it-works' },
    ],
  },
];

export const USE_CASES_PAGE = {
  kicker: 'Use cases',
  title: 'Five sessions people actually run.',
  lead: 'Bring a problem, a project or your own material. The room helps decide what happens next.',
  cta: {
    title: 'Bring the material. We will draft the questions.',
    primary: 'Create a host account',
    secondary: { label: 'Back to the overview', href: '/' },
  },
};
