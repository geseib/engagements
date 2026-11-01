/**
 * PEOPLE CARRY THE FLAG (components/console/ConsoleRail.jsx; experience plan
 * §3.2b, §4.4, Phase 1a).
 *
 * // rejects: the owner's 1 Nov report, "When I brought up the list of people
 * //          there was no indication": consolePeopleFor reduced each person to
 * //          { name, state } and the handover flag never reached the rail.
 * // rejects: People collapsing itself on Workie's read while someone asks.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ConsoleRail from '../components/console/ConsoleRail';
import { needsYou } from '../config/needsYou';

const roster = [
  { name: 'Priya', handover: {} },
  { name: 'Sam', handover: { requested: true, requestedAt: new Date().toISOString() } },
  { name: 'Ola', handover: {} },
];
const asking = needsYou({ players: roster }).items.filter((i) => i.kind === 'name-request' || i.kind === 'name-open');
const people = roster.map((p) => ({ name: p.name, state: 'here' }));

const renderRail = (props = {}) => render(
  <ConsoleRail moment="READ" people={people} counts={{ players: 3 }} asking={asking} onNeedsAct={() => {}} {...props} />,
);

test('the asker is lifted to the top under "Needs you", flagged, and not listed twice', () => {
  renderRail();
  const people = document.querySelector('[data-section="people"]');
  const needs = within(people).getByTestId('people-needs');
  expect(needs).toHaveTextContent('Needs you');
  const row = within(needs).getByTestId('people-asker');
  expect(row).toHaveTextContent('Sam');
  expect(row).toHaveTextContent('Wants their name on a new device');
  const listed = Array.from(people.querySelectorAll('.hc-list li')).map((li) => li.textContent);
  expect(listed.some((t) => t.includes('Sam'))).toBe(false);
  // The section's header says it, in the alert style.
  expect(people.querySelector('summary .hc-count')).toHaveTextContent('1 needs you');
  expect(people.querySelector('summary .hc-count').className).toMatch(/is-alert/);
});

test('Let them / Not now sit on the row and reach the page', () => {
  const onNeedsAct = jest.fn();
  renderRail({ onNeedsAct });
  fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
  fireEvent.click(screen.getByRole('button', { name: 'Not now: Sam' }));
  expect(onNeedsAct.mock.calls.map((c) => c[1])).toEqual(['let', 'notnow']);
});

test('People never collapses while anyone asks, even on the read, even when pressed', () => {
  renderRail();
  const people = document.querySelector('[data-section="people"]');
  expect(people.open).toBe(true);
  fireEvent.click(people.querySelector('summary'));
  expect(people.open).toBe(true);
});

test('with nobody asking, the rail is as it was: the moment opens its section', () => {
  renderRail({ asking: [] });
  const people = document.querySelector('[data-section="people"]');
  expect(people.open).toBe(false);
  expect(screen.queryByTestId('people-needs')).toBeNull();
});

test('an open name shows Lock again on its row', () => {
  const open = needsYou({ players: [{ name: 'Ana', handover: { open: true } }] }).items;
  const onNeedsAct = jest.fn();
  renderRail({ asking: open, onNeedsAct });
  const row = screen.getByTestId('people-open');
  expect(row).toHaveTextContent("Ana's name is open for a new device");
  fireEvent.click(within(row).getByRole('button', { name: 'Lock again: Ana' }));
  expect(onNeedsAct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ana' }), 'lock');
});

test('a refused answer says why, on People', () => {
  renderRail({ needsError: 'Nobody is asking to take "Sam" right now.' });
  expect(screen.getByRole('alert')).toHaveTextContent('Nobody is asking to take "Sam" right now.');
});

// rejects: dev QA 1 Nov — the People row recomputed "ago" from Date.now() at
//          its own render while the Needs-you line read the page's tick, so
//          one request showed 0:03 in one place and 0:00 in the other.
test('the asker row shows the item\'s own "ago", the same words the Needs-you line has', () => {
  const NOW = Date.parse('2026-11-01T12:00:00Z');
  const stale = needsYou({
    players: [{ name: 'Sam', handover: { requested: true, requestedAt: new Date(NOW - 29000).toISOString() } }],
    now: NOW,
  }).items.filter((i) => i.kind === 'name-request');
  renderRail({ asking: stale });
  const row = screen.getByTestId('people-asker');
  expect(row).toHaveTextContent('0:29 ago');
  expect(stale[0].detail).toContain('0:29 ago');
});
