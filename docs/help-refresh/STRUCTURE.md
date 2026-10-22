# Help: how the corpus is built (Phase 0, 22 Oct 2026)

This is the map every later writer works from. The plan and the owner's six
decisions are in [README.md](README.md); what each screen does is in
[`inventory/`](inventory/).

## 1. Files: one per area

Every guide lives in exactly one **area file** under `src/src/config/help/`. Two
writers never need to edit the same file unless they share an area.

Each area file exports:

```js
export const AREA = { id: 'host-setup', guides: { host: [quickStart, gameSetup] } };
```

`guides` is keyed by **role**, so one area can feed two roles (`ai` feeds admin and
builder). `index.js` lists, per role, which areas it reads and in what order; a role's
guides are those areas' guides for it, concatenated. Nothing else lists guides.

| Role (order) | Area → file | Guide ids |
|---|---|---|
| **player** | player → `player.js` | `player-getting-started`, `player-joining`, `player-playing`, `player-scoring` |
| | player-surveys → `player-surveys.js` | (empty; W5) |
| | player-events → `player-events.js` | (empty; W6) |
| | build-room-participant → `build-room-participant.js` | (empty; W7) |
| **host** | host-setup → `host-setup.js` | `host-quick-start`, `host-game-setup` |
| | host-running → `host-running.js` | `host-running-engagements`, `host-late-items`, `host-player-management` |
| | host-two-screens → `host-two-screens.js` | `host-two-screens` (new: split from `host-running-engagements`) |
| | host-surveys → `host-surveys.js` | (empty; W5) |
| | host-events → `host-events.js` | (empty; W6) |
| | host-reports → `host-reports.js` | `host-reporting` |
| | build-room → `build-room.js` | `host-build-room` |
| | build-room-claude → `build-room-claude.js` | (empty; W7) |
| | host-plan → `host-plan.js` | `host-plan` |
| **admin** | admin-console → `admin-console.js` | `admin-getting-started`, `admin-question-sets`, `admin-game-management`, `admin-settings` |
| | ai → `ai.js` | `admin-ai-prompts`, `admin-ai-builders` |
| | admin-team → `admin-team.js` | (empty; W8) |
| | admin-staff → `admin-staff.js` | (empty; W10) |
| **builder** | builder → `builder.js` | `builder-manual` |
| | ai → `ai.js` | `builder-ai` |
| **technical** | technical → `technical.js` | `technical-troubleshooting`, `technical-requirements` |
| | glossary → `glossary.js` | `glossary` ("Words we use") |

Also in the folder: `index.js` (roles, lookups, aliases, resolver, search),
`screens.js` (`HELP_FOR_SCREEN`, section 3).

**Empty areas** export `guides: { <role>: [] }`. Do not register a placeholder guide:
`helpContent.test.js` fails any guide under 600 characters or saying "coming soon".
When you write the first guide of an empty area, put it in that area's list.

**Moving or splitting a guide.** Content moves verbatim. Keep the old guide id resolving:
add it to `HELP_ALIASES` (old id → new id), and for a section that moved to another guide
add `'old-guide#section': 'new-guide#section'` to `HELP_SECTION_MOVES`. A section keeps its
id when it moves. `helpScreens.test.js` lists the 22 ids that existed before Phase 0 and
requires each to resolve.

**The glossary's place.** A guide belongs to one role (ids are unique across roles), so
"Words we use" is one guide, last under Technical, and the help modal's footer links to
it (Troubleshooting · What you need · Words we use · Report an issue). Alias: `words`.

## 2. Sections have ids

Every section carries a stable `id`: kebab-case, unique within its guide, written in the
source (never computed from the title, because titles get rewritten).

```js
{ id: 'name-taken', title: 'When your name is taken', icon: 'Lock', blocks: [ … ] }
```

- Address a section as `guideId#sectionId`, e.g. `player-joining#name-taken`.
- `resolveHelpTarget('player-joining#name-taken')` or
  `resolveHelpTarget('player-joining', 'name-taken')` →
  `{ kind: 'guide', id: 'player-joining', section: 'name-taken' }`. A section id that
  does not exist is dropped (the guide opens at its top).
- `DocRenderer` renders each section as `<section id="help-<guide>--<section>"
  data-section-id="<section>">`, its heading focusable (`tabIndex=-1`).
  `scrollToHelpSection(root, guide, section)` scrolls to it and focuses the heading;
  `activeSection` marks it (`.help-doc-section--active`).
- Public page: `/help/<role>/<guide>#<section>` scrolls there on load and on every hash
  change. `helpHref({ kind: 'guide', id, section })` writes that URL.
- Rename an id only with a `HELP_SECTION_MOVES` entry; ids are in links.

## 3. Help that opens where you are: `HELP_FOR_SCREEN`

`src/src/config/help/screens.js` is the one map from a screen to its help:

```js
export const HELP_FOR_SCREEN = { 'host-console': { guide: 'host-two-screens', section: 'laptop-console' }, … };
<HelpButton {...helpFor('host-console')} variant="inline" size="small" tooltip="Help" />
```

`HelpButton` takes `guide` + `section` (a guide id or alias, and a section id) and opens
the modal there. Without `guide`, `section` keeps its old meaning (a role, a guide, an
alias, or `guide#section`). Never hand-write a guide id at a call site: add a screen here.

**To add a screen:** pick a kebab-case id `<surface>-<screen>`; point it at the section
that answers "what do I do on this screen?"; if the right section does not exist yet,
point at the nearest one and add the id to `PROVISIONAL_SCREENS`. `helpScreens.test.js`
fails an entry whose guide or section does not exist.

Screen ids today (provisional ones marked *): `host-start`, `host-session-panel`,
`player-page`, `admin-console`, `admin-prompts`, `admin-settings-realtime`, `host-create`,
`host-create-advanced`*, `host-quick-start`, `host-question-sets`, `host-sessions`*,
`host-reports`, `host-room-screen-chooser`*, `host-stage`, `host-dock`*,
`host-session-players`, `host-session-questions`, `host-session-rounds`,
`host-session-settings`, `host-late-items`, `host-what-we-heard`, `host-session-report`,
`host-survey`*, `host-console`, `host-remote`, `event-builder`*, `event-agenda`*,
`event-stage`*, `admin-overview`, `admin-question-sets`, `admin-new-set`*,
`admin-set-editor`, `admin-set-versions`, `admin-public-library`*, `admin-sessions`,
`admin-events`*, `admin-prompt-versions`, `admin-members`*, `admin-activity`*,
`admin-plan`, `admin-data-privacy`*, `admin-settings`, `staff-organisations`*,
`staff-observability`*, `staff-plan-requests`*, `staff-discount-codes`*,
`staff-shared-library`*, `staff-public-library`*, `staff-prompts`, `staff-moderation`*,
`staff-accounts`, `staff-archive`, `staff-engage-settings`*, `ai-builders`,
`ai-draft-review`, `ai-bell`, `build-create`, `build-connect`, `build-host`*,
`build-stage`*, `build-build`*, `build-history`*, `build-session-panel`*,
`build-console`*, `player-join`, `player-name-taken`, `player-join-errors`,
`player-lobby`, `player-answering`, `player-voting`, `player-results`, `player-end`,
`player-survey`*, `player-event`*, `player-build-room`*.

Phase 0 wired only AdminPage's three inline buttons to `helpFor`. Phase 3 adds the rest
of the buttons, retargets the provisional entries and removes them from the list.
**Never put a help button on a screen the room sees** (the stage, the room's window, the
Build Room's wall).

## 4. Marking UI labels: `**Label**`

When help quotes a button, tab or heading, write it exactly as the screen shows it, inside
double asterisks:

```js
'Choose **Create engagement** on the welcome screen.'
```

`DocRenderer`'s `ink()` renders it bold (`strong.help-ui`) in every text-bearing block
(paragraphs, items, notes, FAQ, keys, table cells). `helpGuardrails.test.js` §2 fails if a
marked label is not found, character for character, in `src/src` outside `__tests__` and
`config/help` (JS escapes such as `\'` are undone first). Mark labels, not concepts; do not
mark text that a test pins verbatim without updating that test. Marked so far: Create
engagement, Ask the host to hand it over, Take over the name, Let them take it, Unlock
name, Mark reviewed, Save report, Keep for 90 days, Keep for 1 year.

## 5. Retired words: the shrinking allowlist

`helpGuardrails.test.js` §1 bans, in text a reader sees:

| Term | Matched | Use instead |
|---|---|---|
| Presentation, PRESENT | as spelled | the room's window |
| SETUP control | as spelled | SESSION on the dock / the Session panel |
| New version, Fork | as spelled (labels that do not exist) | what the set list really shows |
| codes card | any case | the join code panel |
| display profile | any case | room screen size |
| word cloud | any case | (describe Wavelength's result) |
| Field Notes, the AI summary | any case | What we heard (written by Workie) |
| projector, big screen, the wall | any case | the room's window (two screens) or the stage (one screen) |

Today's occurrences are in `BANNED_ALLOWLIST` (guide → term → count):

| Term | Total | Where |
|---|---|---|
After Phase 1 (22 Oct 2026):

| Term | Total | Where |
|---|---|---|
| the wall | 12 | host-two-screens 7, host-late-items 2, host-reporting 2, host-quick-start 1 |
| projector | 8 | host-two-screens 6, host-game-setup 1, host-build-room 1 |
| big screen | 2 | host-two-screens 1, host-quick-start 1 |
| the AI summary | 3 | host-quick-start 2, host-reporting 1 |
| PRESENT | 1 | host-build-room 1 (the dock's label still reads PRESENT) |
| display profile, New version, Fork, word cloud, SETUP control, Presentation, codes card, Field Notes | 0 | |

**It is a ratchet both ways.** A new occurrence fails. When you remove one, the test fails
until you lower that number (delete the entry at 0). Nobody raises a number. The glossary
may contain none of these.

## 6. Length caps

A section is at most **250 words**, and no one paragraph, list item, note or table row is
over **120**. Today's long ones are in `LONG_SECTIONS` and `LONG_UNITS` at their current
length, with the same two-way ratchet: they may only shrink, and an entry is deleted once
it fits. The worst: `host-build-room#during-after` (1,437 words, one item of 303),
`host-two-screens#laptop-console` (552), `player-playing#answering` (481),
`host-game-setup#settings-before-you-start` (435).

## 7. Style rules for writers

- **Plain words.** Short sentences. The words on the screen, not the words in the code.
- **Task first.** Lead with what the reader is trying to do and the answer; explanation
  after. Title sections by the task ("Getting back in"), not the component.
- **Short sections.** One screen each (section 6). Split rather than stretch.
- **One fact, one place.** Session expiry, polling, where AI sets are saved: say it once in
  the guide that owns it and link (`guide#section`) from elsewhere. Never restate a
  glossary definition; use the word.
- **The glossary's words** (section 8), and none of the retired ones (section 5).
- **Cite code in comments, not prose.** File and line references, dates and "the owner
  said" go in a `/* */` comment above the section. Readers never see file names, plugin
  version numbers or internal site names.
- **Quote labels exactly, and mark them** (section 4).
- **Never on projected screens.** Help is for the host's and the player's own screens; no
  help text or button on anything the room sees.
- **No emoji** (icons come from `components/Icon.jsx`; use an icon name the file imports).

## 8. Words we use (the glossary)

`glossary.js`, one section each, ids in brackets: session and "Create engagement"
(`session`), question set (`question-set`), Yours / Team / Engage / Public (`owner-tags`),
Your space (`your-space`), team (`team`), the stage (`the-stage`), the room's window
(`rooms-window`), room screen size (`room-screen-size`), Session panel (`session-panel`),
the dock (`the-dock`), Workie (`workie`), What we heard (`what-we-heard`), Ask the room
(`ask-the-room`), draft / AI draft (`draft`), the bell (`the-bell`), Build Room
(`build-room`), Claude Code plugin (`claude-code-plugin`), event (`event`). Each term's UI
source is cited in the file's header comment.

## 9. Drift

`node scripts/help-drift.js` prints, per guide, the commits to the code it covers since the
guide's file last changed (`--all` for every guide, `--since <ref>` to count from a ref).
The guide → code map is `COVERS` in the script; add an entry with every new guide (the
report lists guides without one). Advisory; always exits 0. Run it before every push to
test (CLAUDE.md).

## 10. The tests

| Test | Holds |
|---|---|
| `helpContent.test.js` | corpus shape, block types, routing, search, product truths |
| `helpScreens.test.js` | section ids, `guide#section`, old ids and moves, every `HELP_FOR_SCREEN` entry |
| `helpGuardrails.test.js` | retired words, marked labels, length caps |
| `helpDialog.test.jsx` | the modal is a dialog (role, name, Escape, focus in/out, Tab trap, portal), opening at a section, `#section` links |
| `helpSystemPalette.test.js` | both stylesheets on role tokens only, AA in every skin |
| `helpSystem.test.jsx`, `helpPage.test.jsx`, `helpEntryPoints.test.jsx`, `helpButtonMenu.test.jsx` | the modal, the public page, the buttons |
| `infoTip.test.jsx` | the Build Room's "i" works on touch |
