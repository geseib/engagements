/**
 * THE ORG SWITCHER, RENDERED AND DRIVEN.
 *
 * Behaviour only. NO GEOMETRIC ASSERTIONS — jsdom has no layout engine, so a
 * width or an offset here is 0 and passes unconditionally. Where the contract
 * is a CSS declaration it is asserted as text in orgSwitcherPalette.test.js.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import OrgSwitcher, { initialsOf, roleLabelOf } from '../components/OrgSwitcher';

const ORGS = [
  { orgId: 'o-nw', name: 'Northwind Learning', role: 'admin', type: 'team', plan: 'team' },
  { orgId: 'o-hc', name: 'Halcyon Coaching', role: 'member', type: 'team', plan: 'team' },
  { orgId: 'o-ar', name: 'Amara Reyes', role: 'owner', type: 'personal', plan: 'free' },
];

const openMenu = () => fireEvent.click(screen.getByTestId('orgsw-chip'));

describe('initials', () => {
  // rejects: initials taken from the first two words of a three-word org name
  test('two words give first and last, one word gives two letters', () => {
    expect(initialsOf('Northwind Learning')).toBe('NL');
    expect(initialsOf('Halcyon')).toBe('HA');
    expect(initialsOf('  ')).toBe('??');
  });
});

describe('the right-hand column of a row', () => {
  // rejects: showing "Owner" for the personal org, which has no role to hold
  test('the personal organisation says Personal, a team says the role', () => {
    expect(roleLabelOf(ORGS[2])).toBe('Personal');
    expect(roleLabelOf(ORGS[0])).toBe('Admin');
    expect(roleLabelOf(ORGS[1])).toBe('Member');
  });
});

describe('a user with ONE organisation', () => {
  // rejects: rendering a caret and an openable menu whose list has one item
  test('gets the same chip with nothing to open, and it is not focusable', () => {
    render(<OrgSwitcher organisations={[ORGS[0]]} activeOrgId="o-nw" onSelect={() => {}} />);
    const chip = screen.getByTestId('orgsw-chip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('aria-haspopup');
    expect(chip).toHaveTextContent('Northwind Learning');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('a user with NO organisation', () => {
  // rejects: an empty chip that names a world the account is not in
  test('gets no chip at all', () => {
    const { container } = render(<OrgSwitcher organisations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the menu', () => {
  const setup = (props = {}) => {
    const onSelect = jest.fn();
    const onCreate = jest.fn();
    render(
      <OrgSwitcher
        organisations={ORGS}
        activeOrgId="o-nw"
        onSelect={onSelect}
        onCreate={onCreate}
        {...props}
      />
    );
    return { onSelect, onCreate };
  };

  // rejects: dropping aria-haspopup/aria-expanded, which is all a menu button says
  test('the chip announces itself as a menu button', () => {
    setup();
    const chip = screen.getByTestId('orgsw-chip');
    expect(chip).toHaveAttribute('aria-haspopup', 'menu');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    openMenu();
    expect(chip).toHaveAttribute('aria-expanded', 'true');
  });

  // rejects: dropping the role column, or the create row, from the menu
  test('lists every organisation with its role, and offers creating one', () => {
    setup();
    openMenu();
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Northwind Learning');
    expect(items[0]).toHaveTextContent('Admin');
    expect(items[2]).toHaveTextContent('Personal');
    expect(items[3]).toHaveTextContent('Create an organisation');
  });

  // rejects: marking the current org by tint alone, with nothing for assistive tech
  test('the current organisation is marked, and only that one', () => {
    setup();
    openMenu();
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.filter((i) => i.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
  });

  // rejects: firing onSelect for the org already active, which refetches for nothing
  test('choosing another organisation reports it; choosing the current one does not', () => {
    const { onSelect } = setup();
    openMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[1]);
    expect(onSelect).toHaveBeenCalledWith('o-hc', ORGS[1]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    onSelect.mockClear();
    openMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // rejects: leaving the create row wired to nothing
  test('Create an organisation calls back and closes', () => {
    const { onCreate } = setup();
    openMenu();
    fireEvent.click(screen.getByText('Create an organisation'));
    expect(onCreate).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // rejects: no create row offered when the caller passed no handler — a dead affordance
  test('no create row is drawn when there is no handler for it', () => {
    render(<OrgSwitcher organisations={ORGS} activeOrgId="o-nw" onSelect={() => {}} />);
    openMenu();
    expect(screen.queryByText('Create an organisation')).not.toBeInTheDocument();
  });
});

describe('keyboard and focus', () => {
  const setup = () => render(
    <OrgSwitcher organisations={ORGS} activeOrgId="o-nw" onSelect={() => {}} onCreate={() => {}} />
  );

  // rejects: opening the menu and leaving focus on the chip with nothing to arrow
  test('opening moves focus into the menu', () => {
    setup();
    openMenu();
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  // rejects: Escape closing the menu and dropping focus on <body>
  test('Escape closes and returns focus to the chip', () => {
    setup();
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId('orgsw-chip'));
  });

  // rejects: Tab walking out of the open menu into the page behind it
  test('Tab cycles inside the menu and does not escape', () => {
    setup();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'Tab' });
    expect(document.activeElement).toBe(items[1]);
    items[items.length - 1].focus();
    fireEvent.keyDown(items[items.length - 1], { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  // rejects: arrow keys doing nothing, which is the only way through with no mouse
  test('the arrows walk the list and wrap', () => {
    setup();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(items[items.length - 1], { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(items[items.length - 1], { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  // rejects: a closed chip that cannot be opened from the keyboard alone
  test('ArrowDown on the chip opens the menu', () => {
    setup();
    fireEvent.keyDown(screen.getByTestId('orgsw-chip'), { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  // rejects: a menu that stays open behind whatever you clicked next
  test('a click outside closes it', () => {
    setup();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('the platform chip', () => {
  /*
    THIS TEST USED TO REQUIRE THE OPPOSITE, and the reversal is the point.

    It read "is inert, named, and has no menu" and asserted the staff chip drew
    no button at all — correct while the platform LINKS were stacked onto the
    org nav, because the chip was then only a label saying which tier you were
    on. Once those links became an exclusive mode (config/consoleSections.js),
    the switcher became the only way to enter it, and an inert chip meant Engage
    staff could not reach their own console. Engage is still not an organisation
    — it sits under its own "Act as" heading, never under "Your organisations".
  */
  // rejects: an inert staff chip, which is a platform console with no door.
  test('offers the mode rather than merely naming it', () => {
    render(<OrgSwitcher platform organisations={[]} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Engage/ }));
    expect(screen.getByRole('menuitem', { name: /Engage/ })).toBeInTheDocument();
  });

  // rejects: filing Engage under "Your organisations", which would say the
  // operator is a member of a tenant called Engage.
  test('files it under Act as, not under Your organisations', () => {
    render(<OrgSwitcher platform organisations={[{ orgId: 'org_a', name: 'Amara', type: 'personal' }]} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Amara/ }));
    expect(screen.getByText('Act as')).toBeInTheDocument();
  });
});
