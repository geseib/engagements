# Events M2: attendees join the event and read the agenda

## Requirements for the plan drafter

## The owner's words (27 Sep 2026)

> "start M2 so attendees can join event 1124"

Event 1124 exists on dev. It was made in the console, M1 and M1b are on dev (`a7c29924`), and
`EVENTS_ENABLED` is on for dev only.

## The spec

`docs/superpowers/plans/2026-09-26-events-roadmap.md` §4 M2:

- `useJoinCode` asks `GET /join/{code}`. An event code routes to the event.
- The attendee types a name once and gets an attendee token (`attendees.js`), kept in `localStorage`
  under the event code.
- The attendee shell shows two screens, at phone, tablet and laptop widths, from `PlayerSurface.css`'s
  ladders:
  - the pre-event agenda (p-05a), with every item "Not started" and its description;
  - the agenda at rest (p-05).
- A reload lands the attendee back where they were, identified by the token.
- Tests:
  - token signing and expiry;
  - the join resolver;
  - a phone, tablet and laptop render contract for the new screens (the existing `PlayerSurface`
    CSS-contract test pattern).

Also read, in the same folder:

- §3 of the roadmap (the item and navigation model);
- §5 Global Constraints;
- §6 Review Focus;
- `docs/design/agenda-redesign/PLAN.md` (Phases 1–2, attendees) and `40-data-model.html`.

## The mockups are the design

Serve `docs/design/agenda-redesign/` on :8124 and look before writing any UI task. Read their `_src/` too.

- `10-join.html` — joining by code.
- `p-05a-before.html` — the agenda before the day.
- `p-05-agenda.html` — the agenda at rest.

These are out of scope for M2: `p-01…p-04` are invite-only and paused joining (Phase 3 / M3–M4), and
`p-06…p-09` are live items (M4).

Build from what these three draw: copy, layout, the item rows (type, title, leader "Presentation ·
Dana Whitfield", time, description, "Not started"), and the event header (title, place, date).

## What exists (dev `a7c29924`)

Verify every item below in the code before relying on it.

- **`GET /join/{code}`.** `lambda-functions/websocket/events/resolve-code.js`, M1. It is public and
  answers:
  - event vs session vs nothing;
  - 404 "Nothing is running with that code." when nothing is found;
  - nothing for an event while the switch is off? Check how it applies `EVENTS_ENABLED`.
- **`GET /events/{code}/agenda`.** `get-agenda.js`, public. It projects items with `itemId`, `type`,
  `title`, `description`, `ledBy`, `minutes`, `at`, `until` and `state`, plus the event header. It
  never carries settings.
- **The player join flow.** `src/src/PlayerPage.jsx` and the join-code hook/page (find `useJoinCode`
  or its equivalent). Today a typed code joins a SESSION: name, then `POST` join, then a player token
  and connection. The survey player flow is also there.
  - M2 must NOT break session joining, including the share-link survey route and the host remote's
    "Enter a different code".
- **Tenancy and crypto.**
  - `tenant.js`: `eventPk(code)`, `EVENT#<code>` rows (METADATA, `ITEM#`), and the org index.
  - `tenant-crypto.js` (three identical copies) has `event` and `item` entities.
  - An attendee's name is personal data, so it is sealed.
- **Existing token and ticket patterns to reuse, not reinvent.** Read these first:
  - host socket tickets (`POST /games/{id}/host-ticket`, single-use);
  - player tokens / ClientId for sessions;
  - report passkeys.

## Controller rulings (binding)

1. **No new Lambda function.** The stack holds about 440 of CloudFormation's 500 resources. Any new
   route rides an existing events function; function families are fine.
   - A new API route costs one route plus one permission. Keep the count minimal and say how many the
     plan adds.
   - `template-clean.yaml` gets only the route events and the authorizer entries they need. Public
     attendee routes need no Cognito.
2. **The attendee token.**
   - Prefer an OPAQUE random bearer token over a signed one: at least 128 bits, base64url.
   - The server stores only its SHA-256 on the attendee row. There is no new secret, no new KMS key
     and no new resource.
   - If the codebase already has an HMAC signing pattern with a managed secret that fits, the plan may
     use it, but must say why.
   - The token expires with the event: the attendee row carries the event's `ttl`, and a request with
     an unknown or expired token is refused as "not joined".
   - It is kept in `localStorage` under the event code, wrapped in try/catch (private mode can throw).
3. **The attendee row.**
   - It lives under the event partition, e.g. `EVENT#<code>` / `ATTENDEE#<id>`.
   - It holds the sealed name, the token hash, joined-at, the event's ttl, and the org (for sealing).
   - Name rules match the session player's name rules (length and trimming; reuse their module).
   - Duplicate names are allowed; there is no roster shown to attendees in M2.
   - The event's attendee count is a METADATA counter or derived. Do NOT count toward billing in M2
     (roadmap decision 1; metering is M3).
4. **Joining.**
   - `POST /events/{code}/attendees` (public, with a name) → `{ token, attendee }`.
   - `GET /events/{code}/me` (bearer token) → the attendee.
   - Or one route with both methods. The plan names the exact routes.
   - A switch-off tier (test/prod) answers exactly as for an unknown code.
   - Refuse joining an event whose date passed plus a grace period? Decide from the data model; if
     unclear, allow joining until the event's ttl and say so.
   - Rate limiting is an owner decision already taken (not now).
   - Joining never creates or starts a session.
5. **The attendee shell.**
   - A new player-side route or surface: e.g. `/join/1124` or the existing join page resolving to an
     event.
   - It shows the event header and the agenda from `GET /events/{code}/agenda`, with every item "Not
     started" for now; M3 adds live states.
   - It polls or refreshes at a modest interval, so a host's agenda edits appear. No WebSocket in M2;
     that is M4.
   - A reload with a valid token goes straight to the agenda with no name prompt.
   - "Leave" or "Not you?" clears the token and returns to the name step.
   - It is built at phone (375), tablet (768) and laptop (1280) widths from `PlayerSurface.css`'s
     ladders.
   - The copy follows the design system: "phone, laptop or tablet", never "phone" alone; plain words.
6. **The host side, a minimum.** The builder may show "N joined" on the event (a count only, no
   names), if cheap. Otherwise skip it and say so.
7. **Privacy.**
   - Attendee names are never returned by any public route.
   - The agenda route stays free of settings and internal ids beyond `itemId`.
   - Logs never contain the token or the name (`tests/lambda-event-not-logged.js`).
8. **Design system.** Follow `.claude/skills/engage-design/SKILL.md`:
   - tokens only;
   - measured contrast with a palette/CSS-contract test;
   - nothing under 12px;
   - the container rule;
   - reduced motion.

## Constraints (repo)

- TDD, with maker/checker execution.
- **Tests.**
  - Backend: `node tests/<file>.js` by exit code. Async suites arm `tests/helpers/finish-guard.js`, and
    event handler suites use `tests/helpers/event-harness.js`.
  - Frontend: `cd src && npm test -- <pattern>`. Never `npx jest`, never `npm install`.
  - Backend tests read frontend source.
- **Copies that must stay identical:**
  - `tenant.js` (three copies);
  - `tenant-crypto.js` (three copies);
  - `session-ttl.js`;
  - `set-version.js`;
  - `session-goal.js`.
- **Data rules.**
  - No bare partition literals outside `tenant.js` (`tests/no-global-partition-literals.js`).
  - Paginate any multi-page read.
  - The pipeline runs jest on Node 18: no Node 20+ APIs.
- **Words and deploys.**
  - Never write the twin guard's banned deploy phrases (tests/no-retired-twin-references.js FALSE_RULE) in any tracked file.
  - Pushing to dev is the controller's job after the full gate.

## Owner addition (27 Sep 2026)

"go ahead, and show the joined count in the builder." Ruling 6 is REQUIRED, not optional. The builder
shows "N joined": a count only, never names. It comes from a METADATA counter that the join route
maintains with an atomic ADD, never a Scan, and it rides the host's GET /events/{code}.

A "Not you?" re-join makes a new attendee row, so it counts again. That is why the copy says "joined",
not "people". Put the count on the Events list row too, if that is cheap.
