/**
 * components/ScopeTabs.jsx — the row of scope tabs that replaced the
 * organisation chip (docs/design/admin-landing, SPEC §4; frames "1, 3 and 8
 * teams", 660 and 375).
 *
 * jsdom has no layout, so the number of team tabs that fit is given
 * (`maxTeamTabs`) and the phone layout is forced (`phone`). The measuring
 * itself is checked in a browser and reported in the handoff.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ScopeTabs from '../components/ScopeTabs';

const ME = { orgId: 'org_me', name: 'Maya Reyes', type: 'personal' };
const team = (id, name, role = 'member') => ({ orgId: id, name, type: 'team', yourRole: role });
const NW = team('org_nw', 'Northwind Learning', 'owner');
const EIGHT = [
  team('org_a', 'Acorn Choir'), team('org_b', 'Bayview Hospital Training', 'admin'),
  team('org_h', 'Harbour School', 'owner'), team('org_l', 'Lakeside Rotary'),
  NW, team('org_r', 'Riverside Church'), team('org_s', 'Seib Tribe', 'owner'),
  team('org_w', 'Westfield College Debating Society', 'admin'),
];

const row = () => screen.getByRole('navigation', { name: 'Where you work' });
const tabNames = () => within(row()).getAllByRole('link').map((a) => a.getAttribute('data-key'));

describe('the order and the marks', () => {
  test('Personal only: one tab and + New team', () => {
    render(<ScopeTabs orgs={[ME]} activeKey="org_me" onCreateTeam={() => {}} phone={false} />);
    expect(tabNames()).toEqual(['org_me']);
    expect(screen.getByTestId('scp-add')).toHaveTextContent('+ New team');
  });

  // rejects: ordering by the server's list, by activity or by count
  test('Personal, teams A to Z, a rule, then Engage for staff', () => {
    render(<ScopeTabs orgs={[NW, team('org_h', 'Harbour School'), ME]} activeKey="org_nw" staff phone={false} />);
    expect(tabNames()).toEqual(['org_me', 'org_h', 'org_nw', '~platform']);
  });

  test('a host never sees Engage', () => {
    render(<ScopeTabs orgs={[ME, NW]} activeKey="org_nw" phone={false} />);
    expect(tabNames()).not.toContain('~platform');
  });

  test('the active tab is aria-current and the only one naming the role', () => {
    render(<ScopeTabs orgs={[ME, NW, team('org_h', 'Harbour School', 'admin')]} activeKey="org_nw" phone={false} />);
    const current = row().querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('Northwind Learning');
    expect(current).toHaveTextContent('Owner');
    expect(within(row()).getByRole('link', { name: /Harbour School/ })).not.toHaveTextContent('Admin');
  });

  // rejects: a "0" pill (an empty state that lies) or a count on the wrong tab
  test('counts from /me/attention, invitations on Personal, nothing shown for zero', () => {
    render(
      <ScopeTabs
        orgs={[ME, NW, team('org_h', 'Harbour School')]}
        activeKey="org_me"
        attention={{ scopes: { org_me: 2, org_nw: 6, org_h: 0 }, invites: 1 }}
        phone={false}
      />,
    );
    expect(within(row()).getByRole('link', { name: /Personal/ })).toHaveTextContent('3');
    expect(within(row()).getByRole('link', { name: /Northwind/ })).toHaveTextContent('6');
    expect(within(row()).getByRole('link', { name: /Harbour/ }).querySelector('.scp-n')).toBeNull();
  });

  test('choosing a tab hands its key up; the link is a real link', () => {
    const onSelect = jest.fn();
    render(<ScopeTabs orgs={[ME, NW]} activeKey="org_me" onSelect={onSelect} phone={false} />);
    const link = within(row()).getByRole('link', { name: /Northwind/ });
    expect(link).toHaveAttribute('href', '/admin?section=overview');
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith('org_nw', expect.objectContaining({ kind: 'team' }));
  });

  test('+ Personal space appears only when offered', () => {
    const { rerender } = render(<ScopeTabs orgs={[NW]} activeKey="org_nw" phone={false} />);
    expect(screen.queryByTestId('scp-add-personal')).toBeNull();
    const make = jest.fn();
    rerender(<ScopeTabs orgs={[NW]} activeKey="org_nw" onCreatePersonal={make} phone={false} />);
    fireEvent.click(screen.getByTestId('scp-add-personal'));
    expect(make).toHaveBeenCalled();
  });
});

describe('three teams and eight teams', () => {
  test('three teams that fit: no More', () => {
    render(<ScopeTabs orgs={[ME, ...EIGHT.slice(0, 3)]} activeKey="org_me" maxTeamTabs={3} phone={false} />);
    expect(screen.queryByTestId('scp-more')).toBeNull();
    expect(tabNames()).toHaveLength(4);
  });

  test('eight teams, three slots: N more carries the hidden teams’ counts', () => {
    render(
      <ScopeTabs
        orgs={[ME, ...EIGHT]}
        activeKey="org_h"
        staff
        maxTeamTabs={3}
        attention={{ scopes: { org_b: 4, org_nw: 2, org_s: 1 } }}
        phone={false}
      />,
    );
    // Acorn, Bayview, Harbour visible; five folded.
    expect(tabNames()).toEqual(['org_me', 'org_a', 'org_b', 'org_h', '~platform']);
    const more = screen.getByTestId('scp-more');
    expect(more).toHaveTextContent('5 more');
    expect(more).toHaveTextContent('3'); // Northwind 2 + Seib Tribe 1
  });

  // rejects: the active team folded into More; Engage folded into More
  test('the active team keeps a tab; Engage is never in More', () => {
    render(<ScopeTabs orgs={[ME, ...EIGHT]} activeKey="org_s" staff maxTeamTabs={3} phone={false} />);
    expect(tabNames()).toEqual(['org_me', 'org_a', 'org_b', 'org_s', '~platform']);
    fireEvent.click(screen.getByTestId('scp-more'));
    const menu = screen.getByRole('menu', { name: 'More teams' });
    const items = within(menu).getAllByRole('menuitem').map((b) => b.textContent);
    expect(items.join('|')).not.toMatch(/Engage/);
    expect(items.join('|')).not.toMatch(/Seib Tribe/);
    // A to Z, then + New team only when offered.
    expect(items[0]).toMatch(/Harbour School/);
  });

  test('the More menu: Escape closes it and gives focus back', () => {
    render(<ScopeTabs orgs={[ME, ...EIGHT]} activeKey="org_a" maxTeamTabs={2} phone={false} />);
    const more = screen.getByTestId('scp-more');
    fireEvent.click(more);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  test('choosing from More selects that team', () => {
    const onSelect = jest.fn();
    render(<ScopeTabs orgs={[ME, ...EIGHT]} activeKey="org_a" maxTeamTabs={2} onSelect={onSelect} phone={false} />);
    fireEvent.click(screen.getByTestId('scp-more'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Riverside Church/ }));
    expect(onSelect).toHaveBeenCalledWith('org_r', expect.anything());
  });
});

describe('a phone: one button and a sheet', () => {
  test('the button names where you are and how much waits elsewhere', () => {
    render(
      <ScopeTabs
        orgs={[ME, ...EIGHT]}
        activeKey="org_h"
        staff
        attention={{ scopes: { org_b: 4, org_nw: 2, org_s: 1, '~platform': 10 } }}
        phone
      />,
    );
    const btn = screen.getByTestId('scp-current');
    expect(btn).toHaveTextContent('Harbour School');
    expect(btn).toHaveTextContent('Owner');
    expect(btn).toHaveTextContent('17 elsewhere');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  test('the sheet lists every scope, Engage after the teams, and closes', () => {
    const onSelect = jest.fn();
    render(<ScopeTabs orgs={[ME, ...EIGHT]} activeKey="org_h" staff onSelect={onSelect} onCreateTeam={() => {}} phone />);
    fireEvent.click(screen.getByTestId('scp-current'));
    const sheet = screen.getByRole('dialog', { name: 'Where you work' });
    const names = within(sheet).getAllByRole('button').map((b) => b.textContent);
    expect(names[0]).toMatch(/Personal/);
    expect(names.findIndex((n) => /Engage/.test(n))).toBeGreaterThan(names.findIndex((n) => /Westfield/.test(n)));
    expect(names).toEqual(expect.arrayContaining(['+ New team', 'Close']));
    fireEvent.click(within(sheet).getByRole('button', { name: /Riverside Church/ }));
    expect(onSelect).toHaveBeenCalledWith('org_r', expect.anything());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
