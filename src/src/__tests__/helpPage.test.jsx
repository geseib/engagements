// src/src/__tests__/helpPage.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HelpPage, { helpTargetFromPath, helpHref } from '../marketing/HelpPage';
import {
  HELP_ROLES, HELP_ALIASES, ROLE_ID_BY_GUIDE_ID, GUIDE_BY_ID, resolveHelpTarget,
} from '../config/help';
import { HELP_PAGE } from '../marketing/content/help';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const goTo = (p) => window.history.pushState({}, '', p);
afterEach(() => goTo('/'));

const role = HELP_ROLES[0];
const guide = role.guides[0];

test('the path resolves through the same resolver the modal uses', () => {
  expect(helpTargetFromPath('/help')).toEqual({ kind: 'home', id: 'home' });
  expect(helpTargetFromPath('/help/')).toEqual({ kind: 'home', id: 'home' });
  expect(helpTargetFromPath(`/help/${role.id}`)).toEqual({ kind: 'role', id: role.id });
  expect(helpTargetFromPath(`/help/${role.id}/${guide.id}`)).toEqual({ kind: 'guide', id: guide.id });
  expect(helpTargetFromPath(`/help/${guide.id}`)).toEqual({ kind: 'guide', id: guide.id });
});

test('an alias in a URL lands on the guide it names', () => {
  const [alias, real] = Object.entries(HELP_ALIASES)[0];
  expect(helpTargetFromPath(`/help/${alias}`)).toEqual({ kind: 'guide', id: real });
});

test('a link nobody recognises goes home, never to a blank page', () => {
  expect(helpTargetFromPath('/help/admin/not-a-guide')).toEqual({ kind: 'role', id: 'admin' });
  expect(helpTargetFromPath('/help/nonsense/also-nonsense')).toEqual({ kind: 'home', id: 'home' });
});

test('hrefs are canonical: /help/<role>/<guide>', () => {
  expect(helpHref({ kind: 'home', id: 'home' })).toBe('/help');
  expect(helpHref({ kind: 'role', id: role.id })).toBe(`/help/${role.id}`);
  expect(helpHref({ kind: 'guide', id: guide.id })).toBe(`/help/${ROLE_ID_BY_GUIDE_ID[guide.id]}/${guide.id}`);
});

test('home lists every role, and every guide is a real link', () => {
  goTo('/help');
  render(<HelpPage />);
  const total = HELP_ROLES.reduce((n, r) => n + r.guides.length, 0);
  const guideLinks = screen.getAllByRole('link').filter((a) => /^\/help\/[^/]+\/[^/]+$/.test(a.getAttribute('href')));
  expect(guideLinks).toHaveLength(total);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HELP_PAGE.title);
});

test('a guide URL renders that guide, with its title as the h1', () => {
  goTo(`/help/${role.id}/${guide.id}`);
  render(<HelpPage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(guide.title);
  expect(document.title).toBe(`${guide.title} · Engagements`);
});

test('a role URL renders that role\'s index, with exactly one h1', () => {
  goTo(`/help/${role.id}`);
  render(<HelpPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(role.title);
});

test('the breadcrumb on a guide view names the role and marks the guide current', () => {
  goTo(`/help/${role.id}/${guide.id}`);
  render(<HelpPage />);
  const crumb = document.querySelector('.mk-help-crumb');
  expect(crumb).toBeTruthy();
  const roleLink = Array.from(crumb.querySelectorAll('a')).find((a) => a.textContent === role.title);
  expect(roleLink).toBeTruthy();
  expect(roleLink.getAttribute('href')).toBe(`/help/${role.id}`);
  const current = crumb.querySelector('[aria-current="page"]');
  expect(current.textContent).toBe(guide.title);
});

test('every guide in the corpus round-trips through a canonical URL', () => {
  HELP_ROLES.forEach((r) => {
    r.guides.forEach((g) => {
      const target = { kind: 'guide', id: g.id };
      expect(helpTargetFromPath(helpHref(target))).toEqual(target);
    });
    expect(helpTargetFromPath(helpHref({ kind: 'role', id: r.id }))).toEqual({ kind: 'role', id: r.id });
  });
});

test('every alias resolves via a URL', () => {
  Object.keys(HELP_ALIASES).forEach((alias) => {
    const resolved = resolveHelpTarget(alias);
    expect(helpTargetFromPath(`/help/${alias}`)).toEqual(resolved);
  });
});

test('typing a term that matches a known guide shows it as a canonical link, and clearing restores the view', () => {
  goTo('/help');
  render(<HelpPage />);
  const input = screen.getByLabelText(HELP_PAGE.searchLabel);
  fireEvent.change(input, { target: { value: guide.title } });
  const resultLink = screen.getAllByRole('link').find((a) => a.getAttribute('href') === helpHref({ kind: 'guide', id: guide.id }) && a.closest('.mk-help-results'));
  expect(resultLink).toBeTruthy();
  fireEvent.change(input, { target: { value: '' } });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HELP_PAGE.title);
});

test('a term matching nothing shows the empty sentence', () => {
  goTo('/help');
  render(<HelpPage />);
  const input = screen.getByLabelText(HELP_PAGE.searchLabel);
  fireEvent.change(input, { target: { value: 'zzzznopenoresults' } });
  expect(screen.getByText(HELP_PAGE.searchEmpty)).toBeInTheDocument();
});

test('exactly one h1 on the home view', () => {
  goTo('/help');
  render(<HelpPage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});
