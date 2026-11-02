/**
 * THE BUILD ROOM USES ONE BUTTON (experience plan §5.1, Phase 5 step 5d).
 *
 * Every Build Room action moved onto components/ui/Button: one orange primary
 * per screen, the outlined secondary, the tertiary for a text link, the filled
 * danger for the answer to a destructive confirm; 36px in rows and bars, 44px
 * in a dialog's foot. Its scoped button looks (.brm-btn and its --primary,
 * --ghost, --ghostdanger, --dangersolid, --solid, --link and --sm; the
 * report's .brr-btn; .brm-halist-btn) are deleted, and the two layout classes
 * that only carried a "btn" word are renamed (.brm-chip--tap, .bpl-open-go).
 * Its dialogs draw the shared head and foot (ui/DialogParts: the Icon X, the
 * way back left, the action right), and its five "discard?" questions are the
 * small confirm dialog (useConfirm), never window.confirm.
 *
 * Exactly one primary per screen is held where each screen renders: the host
 * screens in buildRoomCounts, buildPoints, buildPointsVote, buildSessionPanel,
 * buildTwoScreenLaptop and buildLiveBuild (`.ui-btn--action`); the dialogs and
 * the report below. No geometry: jsdom has no layout engine.
 */
import React from 'react';
import {
  render, screen, fireEvent, within, waitFor,
} from '@testing-library/react';
import { WrapUpPanel } from '../buildroom/BuildRoomPage';
import BuildReport from '../buildroom/BuildReport';

const fs = require('fs');
const path = require('path');
const { scanButtonClasses, scanDialogs } = require('../testing/driftScan');
const S = require('../../../lambda-functions/game/build-store');

const ROOT = path.join(__dirname, '..', 'buildroom');
const files = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
const JSX = [...files(ROOT, '.jsx'), ...files(path.join(ROOT, 'screens'), '.jsx')];
const CSS = files(ROOT, '.css');
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f);
const PRIMARY = '.ui-btn--action';

describe('the source', () => {
  test('no Build Room file names a deleted button class', () => {
    const left = [...JSX, ...CSS].filter((f) => /\b(brm-btn|brr-btn|brm-halist-btn|brm-chip--btn|bpl-open-btn)\b/.test(read(f))).map(rel);
    expect(left).toEqual([]);
  });

  test('no Build Room stylesheet declares a button family of its own or a scoped primary', () => {
    for (const f of CSS) {
      const { primaries } = scanButtonClasses(read(f));
      // `.ui-btn` is the library's family, placed in the room (`.brm .ui-btn.brm-ctl`), not a new one.
      const families = scanButtonClasses(read(f)).families.filter((x) => x !== 'ui-btn');
      expect({ sheet: rel(f), families, primaries }).toEqual({ sheet: rel(f), families: [], primaries: [] });
    }
  });

  test('every file that draws a button imports ui/Button, and its size is one of the three heights', () => {
    for (const f of JSX) {
      const src = read(f);
      if (!/<Button\b/.test(src)) continue;
      expect([rel(f), /import Button from '(\.\.\/)+components\/ui\/Button';/.test(src)]).toEqual([rel(f), true]);
      for (const m of src.matchAll(/<Button\b[^>]*?\ssize=\{(\d+)\}/g)) expect([36, 44, 56]).toContain(Number(m[1]));
    }
  });

  test('a Build Room dialog foot is 44px; its way back is the foot\'s cancel slot', () => {
    for (const f of JSX) {
      const src = read(f);
      for (const m of src.matchAll(/<DialogFoot\b[\s\S]*?<\/DialogFoot>|<DialogFoot\b[^>]*\/>/g)) {
        for (const b of m[0].matchAll(/<Button\b[^>]*?\ssize=\{(\d+)\}/g)) expect([rel(f), Number(b[1])]).toEqual([rel(f), 44]);
      }
    }
  });

  test('no browser dialog: every "discard?" is the small confirm dialog', () => {
    for (const f of JSX) expect([rel(f), scanDialogs(read(f), rel(f))]).toEqual([rel(f), []]);
    const asks = JSX.flatMap((f) => [...read(f).matchAll(/askConfirm\(\{ title: '([^']+)'/g)].map((m) => m[1]));
    expect(asks.sort()).toEqual([
      'Discard this question?',
      'Discard this task?',
      'Discard what you wrote?',
      'Discard your changes to the crew settings?',
      'Discard your changes to the wrap-up?',
    ]);
  });

  test('every Modal in the Build Room draws the shared head or the shared close', () => {
    for (const f of JSX) {
      const src = read(f);
      const modals = (src.match(/<Modal\b/g) || []).length;
      if (!modals) continue;
      const heads = (src.match(/<(DialogHead|SharedDialogHead|DialogClose)\b/g) || []).length;
      expect([rel(f), heads >= modals]).toEqual([rel(f), true]);
    }
  });

  test('the room\'s type rides the button itself, never inherited by a shared control inside .brm', () => {
    const css = read(path.join(ROOT, 'BuildRoom.css'));
    expect(css).toMatch(/\.brm \.ui-btn\.brm-ctl \{ --ui-size: var\(--brm-t-body\); \}/);
    expect(css).toMatch(/\.brm \.ui-btn\.brm-tight \{ --ui-size: var\(--brm-t-label\); \}/);
    expect(css).not.toMatch(/^\.brm \{[^}]*--ui-size/m);
    expect(css).not.toMatch(/color: var\(--danger\);/);
  });
});

describe('the wrap-up dialog', () => {
  const draw = (onClose = jest.fn()) => {
    render(<WrapUpPanel outcome={null} room={{ title: 'Parking app' }} api={{}} run={jest.fn()} busy={false} onClose={onClose} />);
    return { dlg: screen.getByRole('dialog', { name: 'Wrap up' }), onClose };
  };
  beforeEach(() => { window.confirm = jest.fn(() => true); });

  test('one primary, in the foot on the right; the way back on the left', () => {
    const { dlg } = draw();
    const foot = dlg.querySelector('.ui-dialog-foot');
    expect([...dlg.querySelectorAll(PRIMARY)].map((b) => b.textContent.trim())).toEqual(['Save wrap-up']);
    expect(within(foot.querySelector('.ui-dialog-foot-start')).getByRole('button', { name: 'Cancel' })).toHaveClass('ui-btn--quiet', 'ui-btn--h44');
    expect(foot.querySelector('.ui-dialog-foot-end').querySelector(PRIMARY)).toHaveClass('ui-btn--h44');
    expect(dlg.querySelector('.ui-dialog-x')).not.toBeNull();
  });

  test('closing with changes asks in the small confirm dialog: Keep editing stays, Discard closes', async () => {
    const { dlg, onClose } = draw();
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Summary' }), { target: { value: 'We built a map' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    const ask = await screen.findByRole('dialog', { name: 'Discard your changes to the wrap-up?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Discard your changes/ })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Discard your changes/ })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  test('closing with nothing changed does not ask', () => {
    const { dlg, onClose } = draw();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    return waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('the report', () => {
  const state = () => S.hostView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up' },
    sessionState: 'ENDED',
    room: S.roomFromRows([]),
    players: ['Ana'],
    now: '2026-10-02T19:59:00.000Z',
  });

  test('every action is ui/Button and Save report is the one primary', () => {
    const { container } = render(<BuildReport state={state()} />);
    const bar = container.querySelector('.brr-printbar');
    const buttons = [...bar.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b).toHaveClass('ui-btn'));
    expect([...container.querySelectorAll(PRIMARY)].map((b) => b.textContent.trim())).toEqual(['Save report']);
  });

  test('while the keep choice is open its Save holds the orange, not the opener', () => {
    const { container } = render(<BuildReport state={state()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save report/ }));
    expect([...container.querySelectorAll(PRIMARY)].map((b) => b.textContent.trim())).toEqual(['Save']);
  });
});
