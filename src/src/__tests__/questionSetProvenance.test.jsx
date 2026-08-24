/**
 * WHOSE SET IS THIS, AND WHAT MAY I DO TO IT.
 *
 * The owner's requirement, verbatim:
 *
 *   "every org should get access to the basic default prompts and questions set
 *    from the system. as well as any public ones. org admins and host should be
 *    able to copy these and modify their creations and copies, but not the ones
 *    managed by the engage admin."
 *
 * Two halves, and BOTH were missing from this table even though the server had
 * already decided them:
 *
 *   1. Every row rendered Edit and Delete, on every set, whatever its scope.
 *      `admin/get-question-sets.js` has projected `canManage` per row for a
 *      while and this panel ignored it, so a host saw Edit on an Engage-managed
 *      set and got a 403 on click. A control that is always refused is worse
 *      than no control: it reads as a broken product rather than a boundary.
 *   2. There was no Copy at all, so the shared library was something you could
 *      look at and never use.
 *
 * The rows also could not be told apart — an Engage set, a public one and the
 * team's own all looked identical, which makes "why can't I edit this?"
 * unanswerable from the screen.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import QuestionSetsPanel from '../components/QuestionSetsPanel';

const base = {
  totalQuestions: 10,
  categoryCount: 2,
  active: true,
  engagementType: 'trivia',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const MINE = {
  ...base, id: 'teamretro', name: 'Team Retro', scope: 'org', canManage: true,
};
const ENGAGE = {
  ...base, id: '80strivia', name: '80s Trivia', scope: 'platform', canManage: false,
};
const PUBLIC = {
  ...base, id: 'sharedset', name: 'Shared Set', scope: 'public', canManage: false,
};

const rowFor = (name) => screen.getByText(name).closest('tr');

const draw = (sets, props = {}) => render(
  <QuestionSetsPanel questionSets={sets} onEdit={jest.fn()} onDelete={jest.fn()} {...props} />,
);

describe('a set this organisation owns', () => {
  // rejects: hiding the controls from the person who is allowed to use them.
  it('can be edited and deleted', () => {
    draw([MINE]);
    const row = rowFor('Team Retro');
    expect(within(row).getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});

describe('a set Engage manages', () => {
  // rejects: THE SHIPPED BEHAVIOUR — Edit and Delete on every row regardless of
  // scope, each one a 403 waiting to happen.
  it('offers neither Edit nor Delete', () => {
    draw([ENGAGE]);
    const row = rowFor('80s Trivia');
    expect(within(row).queryByRole('button', { name: /edit/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  // rejects: a read-only row with no way forward. Copying is the whole answer
  // to "can I adapt this?", and without it the library is a museum.
  it('offers a copy instead', () => {
    const onCopy = jest.fn();
    draw([ENGAGE], { onCopy });
    within(rowFor('80s Trivia')).getByRole('button', { name: /copy/i }).click();
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: '80strivia' }));
  });

  // rejects: three visually identical rows, which makes the refusal above
  // unexplainable from the screen.
  it('is marked as Engage’s', () => {
    draw([ENGAGE, PUBLIC, MINE]);
    expect(within(rowFor('80s Trivia')).getByText('Engage')).toBeInTheDocument();
    expect(within(rowFor('Shared Set')).getByText('Public')).toBeInTheDocument();
    // The org's own rows carry no badge: the common case should be the quiet
    // one, or every row shouts and none of them reads.
    expect(within(rowFor('Team Retro')).queryByText('Engage')).toBeNull();
    expect(within(rowFor('Team Retro')).queryByText('Public')).toBeNull();
  });
});

describe('when the page passes no onCopy', () => {
  // rejects: rendering a Copy button on a surface that cannot honour it — the
  // host's own set picker reuses this panel.
  it('draws no copy control', () => {
    draw([ENGAGE]);
    expect(within(rowFor('80s Trivia')).queryByRole('button', { name: /copy/i })).toBeNull();
  });
});
