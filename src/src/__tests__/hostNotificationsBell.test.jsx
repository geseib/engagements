/**
 * THE BELL ON THE HOST'S OWN SCREENS (owner, 21 Oct 2026: "add the bell to the
 * host page and remote too").
 *
 * // rejects: a notification click from a live session's page taking that page
 * //          away from the session; a draft in another library opening in the
 * //          wrong one; the bell on a screen the room sees (the one-screen
 * //          stage, the room's window), where it would project private names.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { openNotificationAway } from '../components/HostNotificationsBell';
import { hrefFor } from '../utils/notificationsApi';

const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');
const draft = { link: { type: 'draft', draftId: 'draft123abc', orgId: 'org_team' } };

describe('where a click goes', () => {
  test('a draft link names its library, so the console reads it without switching', () => {
    expect(hrefFor(draft.link)).toBe('/admin?section=questionsets&draft=draft123abc&library=org_team');
    expect(hrefFor({ type: 'section', section: 'members', orgId: 'org_team' })).toBe('/admin?section=members');
  });

  test('from a live session page it opens a new tab and leaves the session page where it is', () => {
    const tab = { opener: 'x' };
    const win = { open: jest.fn(() => tab), location: { assign: jest.fn() } };
    openNotificationAway(draft, { newTab: true, win });
    expect(win.open).toHaveBeenCalledWith('/admin?section=questionsets&draft=draft123abc&library=org_team', '_blank');
    expect(tab.opener).toBeNull();
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  test('from the host menu (no session open) it opens in place', () => {
    const win = { open: jest.fn(), location: { assign: jest.fn() } };
    openNotificationAway(draft, { win });
    expect(win.open).not.toHaveBeenCalled();
    expect(win.location.assign).toHaveBeenCalledWith('/admin?section=questionsets&draft=draft123abc&library=org_team');
  });
});

describe('where the bell is', () => {
  test('on the host menu, the two-screen console\'s top line and the remote\'s bar', () => {
    expect(read('components/WelcomeScreen.jsx')).toMatch(/<HostNotificationsBell \/>/);
    expect(read('components/console/ConsoleTop.jsx')).toMatch(/<HostNotificationsBell newTab \/>/);
    expect(read('HostRemote.jsx')).toMatch(/<HostNotificationsBell newTab \/>/);
  });

  test('never on a screen the room sees', () => {
    ['PresentPage.jsx', 'present/PresentMoments.jsx', 'present/PresentStage.jsx', 'components/stage/Stage.jsx', 'present/buildwall/BuildWall.jsx']
      .forEach((rel) => expect(read(rel)).not.toMatch(/NotificationsBell/));
  });

  test('the console reads a draft\'s library from the address', () => {
    expect(read('AdminPage.jsx')).toMatch(/params\.get\('library'\)/);
  });
});
