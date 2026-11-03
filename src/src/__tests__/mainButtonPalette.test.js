/**
 * ONE ORANGE MAIN BUTTON, IN EVERY STATE (experience plan §2 principle 4).
 *
 * rejects: dev QA 2 Nov — the main button switched between blue and orange
 * from state to state. The bar's buttons carry the global `.btn-primary` /
 * `.btn-secondary`, which bare rules in other stylesheets (IssueReportForm,
 * FileUploadPrompt, BuilderPage) paint Bootstrap blue, in whatever order the
 * chunks load; and an armed primary took the warn wash instead of its fill.
 *
 * jsdom loads no stylesheet, so the contract is read from the CSS as text
 * (engage-design §5), plus one render for the structure: exactly one button
 * is the primary, and every other is quiet.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import HostActionBar from '../components/HostActionBar';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const consoleCss = strip(read('components', 'console', 'HostConsole.css'));
const stylesCss = strip(read('styles.css'));
const stageCss = strip(read('styles', 'stage.css'));
const remoteCss = strip(read('HostRemote.css'));

/** Every declaration block whose selector list contains `sel` exactly. */
function blocksFor(css, sel) {
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out;
}
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[1].trim() : null;
};

// rejects: dev QA 2 Nov — the main button went blue in some states and orange in others.
// Since experience plan step 5a the bar's buttons are ui/Button: the primary is
// `ui-btn--action` and paints from components/ui/Button.css, and they no longer carry
// the global .btn-primary / .btn-secondary that the Bootstrap-blue leaks reached.
describe('the console (and the Build Room\'s, and Setup\'s): .hc-acts', () => {
  const buttonCss = strip(read('components', 'ui', 'Button.css'));
  test('the main button is the --action fill with --on-action ink (ui/Button)', () => {
    const [body] = blocksFor(buttonCss, '.ui-btn--action');
    expect(decl(body, 'background')).toBe('var(--action)');
    expect(decl(body, 'color')).toBe('var(--on-action)');
  });
  test('armed, it keeps the fill: the ring says it, not a new colour', () => {
    const [ring] = blocksFor(stylesCss, '.host-action-bar .host-action-bar__primary.is-armed');
    expect(decl(ring, 'background')).toBeNull();
    expect(decl(ring, 'box-shadow')).toMatch(/--warn-rgb/);
  });
  test('hovered, it stays orange (the action hover)', () => {
    const [body] = blocksFor(buttonCss, '.ui-btn--action:hover:not(:disabled):not([aria-disabled="true"])');
    expect(decl(body, 'background')).toBe('var(--action-hover)');
  });
  test('disabled, it is a grey wash, never a solid fill that reads as live', () => {
    const [body] = blocksFor(buttonCss, '.ui-btn--action:disabled');
    expect(decl(body, 'background')).not.toMatch(/--action|--primary/);
    expect(decl(body, 'color')).toBe('var(--muted)');
  });
  test('the console states no paint of its own over the bar any more', () => {
    expect(consoleCss).not.toMatch(/\.hc-acts \.host-action-bar \.host-action-bar__\w+[^{]*\{[^}]*background/);
  });
});

describe('the stage dock (one screen) and the shared bar', () => {
  test('the dock\'s main button is the amber fill; +1 min is in the quiet group', () => {
    const fills = blocksFor(stageCss, '.dock .host-action-bar__primary').map((b) => decl(b, 'background')).filter(Boolean);
    expect(fills).toEqual(['var(--primary)']);
    const quiet = blocksFor(stageCss, '.dock .host-action-bar__addtime');
    expect(quiet.some((b) => decl(b, 'background') === 'transparent')).toBe(true);
  });
  test('the armed wash never lands on the main button', () => {
    // A bare `.host-action-bar button.is-armed` painted the primary warn too.
    expect(blocksFor(stylesCss, '.host-action-bar button.is-armed')).toHaveLength(0);
    const [wash] = blocksFor(stylesCss, '.host-action-bar button.is-armed:not(.host-action-bar__primary)');
    expect(decl(wash, 'background')).toMatch(/--warn-rgb/);
    const [ring] = blocksFor(stylesCss, '.host-action-bar .host-action-bar__primary.is-armed');
    expect(decl(ring, 'background')).toBeNull();
    expect(decl(ring, 'box-shadow')).toMatch(/--warn-rgb/);
  });
});

describe('the phone Remote', () => {
  test('its main button is ui/Button\'s primary (the --action fill), and armed it keeps it', () => {
    // Since step 5a the fill is the library's: the Remote's rule sets width and type only.
    const own = blocksFor(remoteCss, '.hr .hr-primary');
    expect(own).toHaveLength(1);
    expect(decl(own[0], 'background')).toBeNull();
    for (const armed of blocksFor(remoteCss, '.hr-primary.is-armed')) {
      expect(decl(armed, 'background')).toBeNull();
    }
    expect(read('HostRemote.jsx')).toMatch(/variant="primary"\s+size=\{56\}\s+className=\{`hr-primary /);
  });
  test('the Remote draws one .hr-primary, and no scoped button family is left', () => {
    const jsx = read('HostRemote.jsx');
    expect((jsx.match(/className=\{?[`'"][^`'"]*\bhr-primary\b(?!-)/g) || [])).toHaveLength(1);
    expect(remoteCss).not.toMatch(/\.hr-btn/);
  });
});

describe('the structure: exactly one primary, the rest quiet', () => {
  const control = (id, label, extra = {}) => ({ id, label, intent: id, icon: 'Circle', disabled: false, hint: '', ...extra });
  test.each([
    ['live', {}],
    ['disabled', { disabled: true, hint: 'Nobody has answered yet' }],
    ['armed', { arm: { text: '1 of 3 still writing. Press again to start voting.', confirmLabel: 'Start voting anyway', inPlace: true } }],
  ])('%s main button', (_name, extra) => {
    const { container } = render(
      <HostActionBar
        controls={{
          primary: control('open-vote', 'Start voting', extra),
          secondary: control('skip', 'Skip this round'),
          tertiary: control('other', 'Something else'),
          status: { text: '', tone: '' },
        }}
        onAction={() => {}}
        onAddTime={() => {}}
        showAddTime
      />,
    );
    const filled = container.querySelectorAll('.ui-btn--action');
    expect(filled).toHaveLength(1);
    expect(filled[0].classList.contains('host-action-bar__primary')).toBe(true);
    expect(container.querySelectorAll('.btn-primary, .btn-secondary')).toHaveLength(0);
    for (const cls of ['host-action-bar__secondary', 'host-action-bar__tertiary', 'host-action-bar__addtime']) {
      const el = container.querySelector(`.${cls}`);
      expect([cls, el.classList.contains('ui-btn--quiet'), el.classList.contains('ui-btn--h36')]).toEqual([cls, true, true]);
    }
  });
});
