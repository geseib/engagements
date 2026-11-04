import React from 'react';
import PersonRow, { PERSON_WORDS } from '../people/PersonRow';
import PrivateReveal from '../needs/PrivateReveal';
import { NEEDS_ACTIONS } from '../../config/needsYou';

/**
 * THE SESSION MENU'S PEOPLE SECTION (docs/design/session-menu; the owner's one
 * change, 3 Nov 2026: "yes, add People"). In every version of the menu.
 *
 * The whole list, with who left, in THE SAME PERSON ROW as the rail
 * (components/people/PersonRow.jsx): dot, name, doing now, the format's one
 * fact (place and points), ⋯. Nothing the old Players list offered is lost:
 *
 *   old Players list                 here
 *   Let them take it                 the asker's amber line: Let them
 *   Not now                          the asker's amber line: Not now
 *   Unlock name                      ⋯ Move to a new device
 *   Lock again                       ⋯ Lock name (while the name is open)
 *   Remove                           ⋯ Remove from session (press twice)
 *   Bring back                       a left row's ⋯ Bring back
 *   rank, points, the round's tick   the fact ("#1 · 120 pts") and doing now
 *
 * Rename is not offered: there is no host rename in the product (PersonRow
 * leaves out what the format cannot do).
 *
 * ONE SCREEN (experience plan §3.3; config/privateParts.js "scores-roster"
 * and "name-request"): the room can see this laptop, so the list is
 * count-only until "Show on this screen", and the phone Remote's People has
 * it privately. Presentational: every action is the page's.
 */
export const PEOPLE_WORDS = Object.freeze({
  heading: 'Everyone in the session',
  count: (n) => (n === 1 ? '1 person' : `${n} people`),
  left: 'Left the session',
  leftNote: 'Out of the live counts. Their answers, votes and points stay in the session report.',
  empty: 'Nobody has joined yet.',
  bringBack: 'Bring back',
  answered: 'answered',
  voted: 'voted',
  waiting: 'waiting',
  open: 'name open',
  onPhone: 'Or open People on your phone, where only you see it.',
  fromRail: 'The People column shows who is here now; this is everyone, and who left.',
});

/** What one person is doing this round, in the row's "doing now" slot. */
export function doingFor(row, gameState = '') {
  if (row.handoverOpen) return PEOPLE_WORDS.open;
  if (row.done === true) return String(gameState).startsWith('VOTE#') ? PEOPLE_WORDS.voted : PEOPLE_WORDS.answered;
  if (row.done === false) return PEOPLE_WORDS.waiting;
  return '';
}

/** The one-screen count line: people, who left, name requests. Never a name. */
export function peopleCountLine({ rows = [], departed = [] } = {}) {
  const asking = rows.filter((r) => r.handoverRequested && !r.handoverOpen).length;
  return [
    PEOPLE_WORDS.count(rows.length),
    departed.length ? `${departed.length} left` : '',
    asking ? (asking === 1 ? '1 name request' : `${asking} name requests`) : '',
  ].filter(Boolean).join(' · ');
}

export default function SessionPeople({
  rows = [],
  departed = [],
  players = [],
  gameState = '',
  oneScreen = false,
  // Keys the one-screen show/hide choice to this session (PrivateReveal `remember`).
  gameId = '',
  peopleColumn = false,
  onGrant = () => {},
  onRefuse = null,
  onLock = null,
  onRemove = () => {},
  onRestore = () => {},
}) {
  const device = new Map((players || []).map((p) => [p && (p.name || p.playerName), p]));
  const needsFor = (row) => {
    if (!(row.handoverRequested && !row.handoverOpen)) return null;
    const p = device.get(row.name) || {};
    return {
      id: `name:${row.name}`,
      kind: 'name-request',
      name: row.name,
      armLet: p.deviceConnected === true,
      actions: onRefuse ? [NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW] : [NEEDS_ACTIONS.LET],
    };
  };
  const onNeedsAct = (item, action) => {
    if (action === NEEDS_ACTIONS.LET) onGrant(item.name, true);
    else if (action === NEEDS_ACTIONS.NOT_NOW && onRefuse) onRefuse(item.name);
  };
  const menuFor = (row) => [
    !row.handoverOpen && !(row.handoverRequested && !row.handoverOpen) && {
      id: 'move', label: PERSON_WORDS.move, onSelect: () => onGrant(row.name, false),
    },
    row.handoverOpen && onLock && { id: 'lock', label: PERSON_WORDS.lock, onSelect: () => onLock(row.name) },
    { id: 'remove', label: PERSON_WORDS.remove, danger: true, onSelect: () => onRemove(row.name) },
  ].filter(Boolean);
  // Askers first, until answered (PLAN §4.4), then score order as given.
  const asking = rows.filter((r) => r.handoverRequested && !r.handoverOpen);
  const ordered = [...asking, ...rows.filter((r) => !(r.handoverRequested && !r.handoverOpen))];

  const list = (
    <div className="smenu-people" data-testid="people-list">
      {rows.length === 0 ? (
        <p className="setup-empty">{PEOPLE_WORDS.empty}</p>
      ) : (
        <ul className="smenu-people__rows" aria-label={PEOPLE_WORDS.heading}>
          {ordered.map((row) => (
            <PersonRow
              key={row.name}
              name={row.name}
              status="here"
              doing={doingFor(row, gameState)}
              fact={`#${row.rank} · ${row.score} pts`}
              menu={menuFor(row)}
              needsItem={needsFor(row)}
              onNeedsAct={onNeedsAct}
            />
          ))}
        </ul>
      )}
      {departed.length ? (
        <div className="smenu-people__left" data-testid="people-left">
          <h4 className="setup-h setup-h--sub">{PEOPLE_WORDS.left}</h4>
          <p className="setup-note">{PEOPLE_WORDS.leftNote}</p>
          <ul className="smenu-people__rows" aria-label={PEOPLE_WORDS.left}>
            {departed.map((row) => (
              <PersonRow
                key={row.name}
                name={row.name}
                status="left"
                doing={PERSON_WORDS.left}
                fact={`${row.score} pts`}
                menu={[{ id: 'restore', label: PEOPLE_WORDS.bringBack, onSelect: () => onRestore(row.name) }]}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {/* The count once: on one screen it is the reveal's own summary. */}
      {!oneScreen ? (
        <p className="setup-note smenu-people__count" data-testid="people-count">
          {peopleCountLine({ rows, departed })}
          {peopleColumn ? <span className="smenu-people__why">{` · ${PEOPLE_WORDS.fromRail}`}</span> : null}
        </p>
      ) : null}
      <PrivateReveal
        oneScreen={oneScreen}
        testId="private-people"
        remember={gameId ? `${gameId}.people` : ''}
        summary={`${peopleCountLine({ rows, departed })}. ${PEOPLE_WORDS.onPhone}`}
      >
        {list}
      </PrivateReveal>
    </>
  );
}
