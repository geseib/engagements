/**
 * components/PlanLimitNotice.jsx — the one notice every plan-limit refusal
 * shows (docs/design/tenancy-redesign/22-plan-limit-notice.html). The words are
 * pinned in planLimitCopy.test.js; this pins how they are PUT on screen:
 * announced, in place, with a working way out and nothing that steals focus.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PlanLimitNotice from '../components/PlanLimitNotice';
import { parseUpgradeRequired } from '../utils/upgradeRequired';
import { REQUEST_HREF, BILLING_HREF } from '../utils/planLimitCopy';

const DANA = { name: 'Dana Whitfield', email: 'dana@northwind.example', role: 'owner' };
const TOMAS = { name: 'Tomás Ortega', email: 'tomas@northwind.example', role: 'admin' };
const refusal = (kind, resolve) => parseUpgradeRequired(402, {
  code: 'upgrade_required',
  limit: { kind, used: 5, included: 5 },
  upgrade: { priceCents: 500, priceDisplay: '$5.00' },
  resolve,
});
const OWNER = { role: 'owner', canRequest: true, canViewBilling: true, org: { name: 'Amara Reyes', type: 'personal' }, contacts: [], request: null, resetsOn: '2026-10-01' };
const MEMBER = { role: 'member', canRequest: false, canViewBilling: false, org: { name: 'Northwind Learning', type: 'team' }, contacts: [DANA, TOMAS], request: null, resetsOn: '2026-10-01' };

let scrolled;
beforeEach(() => {
  scrolled = 0;
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled += 1; };
});

test('it is announced, and says what ran out and what did not happen', () => {
  render(<PlanLimitNotice refusal={refusal('sessions', OWNER)} />);
  // rejects: a silent notice — role="alert" is how a screen reader learns the press failed
  const box = screen.getByRole('alert');
  expect(box).toHaveTextContent('You’ve used the 5 sessions included this month.');
  expect(box).toHaveTextContent('Nothing was created.');
  expect(box).toHaveTextContent('A session counts once two of its questions have been answered.');
});

test('the owner gets one button, straight to the request', () => {
  render(<PlanLimitNotice refusal={refusal('sessions', OWNER)} />);
  const link = screen.getByRole('link', { name: 'Request the Team plan' });
  // rejects: a button to Plan & usage that leaves the owner to find the request themselves
  expect(link).toHaveAttribute('href', REQUEST_HREF);
  expect(link.className).toMatch(/plim-btn--primary/);
  expect(screen.getByRole('alert')).toHaveTextContent('Or wait until 1 October, when your 5 sessions start again.');
});

test('a member is shown whom to ask, each one a mail link, and no button', () => {
  render(<PlanLimitNotice refusal={refusal('sets', MEMBER)} outcome="Nothing was copied." />);
  const box = screen.getByRole('alert');
  expect(box).toHaveTextContent('Northwind Learning holds 5 of the 5 question sets it includes.');
  expect(box).toHaveTextContent('Nothing was copied.');
  // rejects: "contact your admin" with no way to reach them
  const dana = within(box).getByRole('link', { name: /Dana Whitfield/ });
  expect(dana).toHaveAttribute('href', 'mailto:dana@northwind.example');
  expect(dana).toHaveTextContent('owner');
  expect(within(box).getByRole('link', { name: /Tomás Ortega/ })).toHaveAttribute('href', 'mailto:tomas@northwind.example');
  // rejects: a billing link for somebody with no Billing section
  expect(within(box).queryByRole('link', { name: /Plan & usage|Request/ })).toBeNull();
});

test('a contact with no address is still named, just not linked', () => {
  const noMail = { ...MEMBER, contacts: [{ name: 'Dana Whitfield', email: '', role: 'owner' }] };
  render(<PlanLimitNotice refusal={refusal('sets', noMail)} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Dana Whitfield');
  expect(screen.queryByRole('link', { name: /Dana Whitfield/ })).toBeNull();
});

test('an older server with no resolve still points somewhere useful', () => {
  render(<PlanLimitNotice refusal={refusal('sessions', undefined)} />);
  expect(screen.getByRole('link', { name: 'Open Plan & usage' })).toHaveAttribute('href', BILLING_HREF);
});

test('it scrolls itself into view and leaves focus where it was', () => {
  render(<><button type="button">Create session</button><PlanLimitNotice refusal={refusal('sessions', OWNER)} /></>);
  const pressed = screen.getByRole('button', { name: 'Create session' });
  pressed.focus();
  // rejects: a refusal rendered off-screen at the foot of a long form
  expect(scrolled).toBeGreaterThan(0);
  // rejects: yanking focus into the notice mid-keyboard-flow
  expect(document.activeElement).toBe(pressed);
});

test('dismissable only when the caller can dismiss it', () => {
  const onDismiss = jest.fn();
  const { rerender } = render(<PlanLimitNotice refusal={refusal('sessions', OWNER)} />);
  expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  rerender(<PlanLimitNotice refusal={refusal('sessions', OWNER)} onDismiss={onDismiss} />);
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
  expect(onDismiss).toHaveBeenCalled();
});

test('surface and compact are classes, not inline styles', () => {
  const { container } = render(<PlanLimitNotice refusal={refusal('sessions', OWNER)} surface="paper" compact />);
  const root = container.querySelector('.plim');
  expect(root.className).toMatch(/plim--paper/);
  expect(root.className).toMatch(/plim--compact/);
  expect(root.getAttribute('style')).toBeNull();
  // compact drops the price line
  expect(root).not.toHaveTextContent('$5.00 a month');
});

test('nothing renders without a refusal', () => {
  const { container } = render(<PlanLimitNotice refusal={null} />);
  expect(container.firstChild).toBeNull();
});
