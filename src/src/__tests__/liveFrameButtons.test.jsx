/**
 * THE LIVE FRAME, THE PHONE REMOTE AND THE PHONE DOCK ON ui/Button
 * (experience plan §5.1 and §5.2, Phase 5 step 5a).
 *
 * The console's top bar, Your part now (the action bar), the Needs-you line,
 * the pulse, the person rows and the Session menu are drawn with
 * components/ui/Button; so are the host's phone Remote and the participant's
 * dock. Their scoped primary-button classes are gone (the button-class ratchet
 * in driftRatchets.test.js holds the count).
 *
 * rejects: a live screen drawing a button family of its own again (.hc-btn,
 * .hr-btn, .plr-btn); more than one primary in Your part now; the Session
 * menu's End session in anything but the danger look; a name request flagged
 * without words.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ConsoleTop from '../components/console/ConsoleTop';
import HostActionBar from '../components/HostActionBar';
import NeedsYouLine from '../components/needs/NeedsYouLine';
import PersonRow, { PERSON_WORDS } from '../components/people/PersonRow';
import ConsolePulse from '../components/console/ConsolePulse';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { needsYou } from '../config/needsYou';
import HW from '../config/hostWords';

jest.mock('../utils/libraries', () => ({ fetchOrgs: () => Promise.resolve([]), librariesFrom: () => [] }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => null, QRCodeCanvas: () => null }));

const D = require('../testing/driftScan');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const isUi = (el) => el.classList.contains('ui-btn');

describe('the console top bar', () => {
  test('Main menu, Join and the Session menu are ui/Button, secondary, 36px', () => {
    render(
      <ConsoleTop
        title="Relay expansion"
        code="7924"
        onJoin={() => {}}
        joinPressed={false}
        presentHref="/present?gameId=7924"
        presentDetail={{ open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() }}
        onLeave={() => {}}
        onSessionMenu={() => {}}
        bell={<span />}
      />,
    );
    for (const slot of ['main-menu', 'join', 'session-menu']) {
      const el = document.querySelector(`.hc-top [data-slot="${slot}"]`);
      expect([slot, isUi(el), el.classList.contains('ui-btn--quiet'), el.classList.contains('ui-btn--h36')]).toEqual([slot, true, true, true]);
    }
    // The bar spends no orange: Your part now has the one primary.
    expect(document.querySelector('.hc-top .ui-btn--action')).toBeNull();
  });
});

describe('Your part now', () => {
  const control = (id, label, extra = {}) => ({ id, label, intent: id, icon: 'Circle', disabled: false, hint: '', ...extra });
  test('one primary, every other button secondary, all 36px', () => {
    const { container } = render(
      <HostActionBar
        controls={{ primary: control('open-vote', 'Start voting'), secondary: control('skip', 'Skip this round'), status: { text: '', tone: '' } }}
        onAction={() => {}}
        onAddTime={() => {}}
        showAddTime
      />,
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.every(isUi)).toBe(true);
    expect(buttons.every((b) => b.classList.contains('ui-btn--h36'))).toBe(true);
    expect(container.querySelectorAll('.ui-btn--action')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Start voting/ })).toHaveClass('ui-btn--action');
  });
});

describe('the Needs-you line and the person row', () => {
  const asker = (name) => ({ name, handover: { requested: true, requestedAt: new Date().toISOString() } });
  test('the line\'s buttons are secondary 36px; "See in People" is the tertiary look', () => {
    render(<NeedsYouLine needs={needsYou({ players: [asker('Sam')] })} onAct={() => {}} />);
    const line = screen.getByTestId('needs-line');
    const buttons = within(line).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect([b.textContent, isUi(b)]).toEqual([b.textContent, true]);
    expect(buttons.filter((b) => b.classList.contains('ui-btn--action'))).toHaveLength(0);
    const see = buttons.find((b) => b.classList.contains('ny-link'));
    if (see) expect(see).toHaveClass('ui-btn--tertiary');
  });

  test('a name request: the row flag (amber dot plus words) and the pair, on ui/Button', () => {
    const item = needsYou({ players: [asker('Sam')] }).items[0];
    const { container } = render(
      <ul><PersonRow name="Sam" status="here" needsItem={item} onNeedsAct={() => {}} menu={[{ id: 'rename', label: 'Rename', onSelect: () => {} }]} /></ul>,
    );
    const flag = container.querySelector('.ui-flag');
    expect(flag).toHaveClass('ui-flag--needs');
    expect(flag.querySelector('.ui-flag-dot')).not.toBeNull();
    expect(flag).toHaveTextContent(PERSON_WORDS.wantsName);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.every(isUi)).toBe(true);
    expect(screen.getByRole('button', { name: PERSON_WORDS.more('Sam') })).toHaveClass('ui-btn--quiet');
  });
});

describe('the pulse', () => {
  test('+1 min and the late link are ui/Button, secondary 36px', () => {
    const now = Date.now();
    const { container } = render(
      <ConsolePulse moment="ANSWERING" players={4} answered={3} voted={0} openedAt={now - 84000} now={now} onAddMinute={() => {}}
        timer={{ endsAt: new Date(now + 60000).toISOString(), givenMs: 120000 }} />,
    );
    const buttons = [...container.querySelectorAll('button')];
    for (const b of buttons) expect([b.textContent, isUi(b), b.classList.contains('ui-btn--h36')]).toEqual([b.textContent, true, true]);
  });
});

describe('the Session menu', () => {
  test('its actions are ui/Button; End session is outlined danger text in the foot', () => {
    render(<SessionSetupPanel gameType="call-and-answer" gameState="ASK#001" initialTab="end" onEndSession={() => {}} onSwitchGame={() => {}} onSignOut={() => {}} />);
    const end = screen.getByTestId('session-menu-end');
    // Outlined text, not a filled button (docs/design/session-menu desk
    // review 1): the outline is ui/Button's secondary; the danger-text ink is
    // SessionMenu.css's `.smenu-end`.
    expect(end).toHaveClass('ui-btn', 'ui-btn--quiet', 'ui-btn--h36', 'smenu-end');
    expect(read('components', 'stage', 'SessionMenu.css')).toMatch(/\.smenu-end\[class~="ui-btn"\]\s*\{[^}]*color:\s*var\(--danger-text\)/);
    expect(screen.getByRole('button', { name: HW.mainMenu })).toHaveClass('ui-btn', 'ui-btn--quiet');
    // No Sign out in the live menu (fork F5): Home has it.
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    // The close is the Icon X, never a text glyph.
    const close = screen.getByRole('button', { name: HW.closeSessionMenu });
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Joining' }));
    expect(screen.getByRole('button', { name: 'Copy join link' })).toHaveClass('ui-btn', 'ui-btn--quiet');
  });

  test('the blanket repaint in styles.css leaves ui/Button alone', () => {
    expect(read('styles.css')).toMatch(/\.setup-panel button:not\([^{]*:not\(\[class~="ui-btn"\]\)\s*\{/);
  });
});

/* ------------------------------------------------- the phone, statically ---- */
/* The Remote's and the player's own page tests render these surfaces; here the
   structure is read from the source, so it holds whatever those tests mock. */

const REMOTE = ['HostRemote.jsx', 'components/RemoteFocusPanel.jsx', 'components/RemoteQuestionBrowser.jsx',
  'components/RemoteScoreboardPanel.jsx', 'components/RemoteTimeCard.jsx'];
const DOCK = ['PlayerPage.jsx', 'components/NameMoved.jsx', 'components/JoinNameCollision.jsx', 'components/PlayerEnded.jsx',
  'components/survey/SurveyRunner.jsx', 'components/FollowUpCard.jsx', 'buildroom/BuildPlayer.jsx', 'components/event/EventAttendeePage.jsx'];

describe('the phone Remote', () => {
  test.each(REMOTE)('%s: every button is ui/Button, no .hr-btn left', (r) => {
    const src = read(r);
    expect(src).toMatch(/import Button from '[./]+(components\/)?ui\/Button';/);
    expect(src).not.toMatch(/\bhr-btn\b/);
  });
  test('the dock\'s main button is the one primary at the phone dock\'s 56px; the rest are 44px', () => {
    const src = read('HostRemote.jsx');
    expect((src.match(/size=\{56\}/g) || [])).toHaveLength(1);
    expect(src).toMatch(/variant="primary"\s+size=\{56\}\s+className=\{`hr-primary/);
    expect((src.match(/size=\{44\}/g) || []).length).toBeGreaterThan(10);
  });
  test('HostRemote.css declares no button family of its own', () => {
    expect(D.scanButtonClasses(read('HostRemote.css')).families).toEqual(['help-button', 'ui-btn']);
  });
});

describe('the participant\'s dock', () => {
  test.each(DOCK)('%s: the dock\'s buttons are ui/Button at 56px, no .plr-btn left', (r) => {
    const src = read(r);
    expect(src).toMatch(/import Button from '[./]+(components\/)?ui\/Button';/);
    expect(src).not.toMatch(/\bplr-btn\b/);
    expect(src).toMatch(/size=\{56\}/);
  });
  test('PlayerSurface.css declares no .plr-btn family; it sizes the dock\'s ui/Button', () => {
    const css = read('components', 'PlayerSurface.css');
    const fams = D.scanButtonClasses(css).families;
    expect(fams).not.toContain('plr-btn');
    expect(fams).not.toContain('plr-feedback-btn');
    expect(css).toMatch(/\.plr \.ui-btn--h56\s*\{[^}]*width:\s*100%/);
  });
});

describe('the console stylesheet', () => {
  test('HostConsole.css declares no .hc-btn family any more', () => {
    expect(D.scanButtonClasses(read('components', 'console', 'HostConsole.css')).families).toEqual(['ui-btn']);
  });
});
