/**
 * NOTHING EMPTY PROJECTED, ON SETUP TOO (owner, 5 Nov 2026, cut 3).
 *
 * // rejects: dev QA 5 Nov — the one-screen Setup page still drew the calm
 * // "Nothing needs you now." line, which the room can see. The live stage
 * // already left it out; Setup's console frame drew the private line.
 *
 * One rule (config/needsYou.js projectNeedsLine) and one element in the page
 * (`needsLine`), handed to both frames: on a laptop the room reads, nothing
 * while calm or Soon, the public count line only while a Now item waits.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { needsYou, projectNeedsLine, NEEDS_LEVELS } from '../config/needsYou';
import HostConsole from '../components/console/HostConsole';

const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

describe('projectNeedsLine: the one rule', () => {
  test('calm: nothing to project', () => {
    expect(projectNeedsLine(needsYou({}))).toBe(false);
    expect(projectNeedsLine(null)).toBe(false);
  });
  test('only Soon items: nothing (the bell counts them)', () => {
    expect(projectNeedsLine({ items: [{ id: 'a', level: NEEDS_LEVELS.SOON }] })).toBe(false);
  });
  test('a Now item: the public line', () => {
    expect(projectNeedsLine({ items: [{ id: 'a', level: NEEDS_LEVELS.SOON }, { id: 'b', level: NEEDS_LEVELS.NOW }] })).toBe(true);
  });
});

describe('the page hands the same line to Setup and the stage', () => {
  test('both frames take `needsLine`; no frame builds its own', () => {
    const uses = page.match(/needs=\{needsLine\}/g) || [];
    expect(uses.length).toBe(2);
    expect(page).not.toMatch(/needs=\{<NeedsYouLine/);
  });

  test('one screen, once chosen, is a laptop the room reads: public line on Now, else nothing', () => {
    const at = page.indexOf('const roomReadsThisLaptop = ');
    expect(at).toBeGreaterThan(-1);
    const block = page.slice(at, page.indexOf(';\n\n', at));
    expect(block).toMatch(/!twoSurfaces && \(!setupFrame \|\| setupChoice === 'classic'\)/);
    const line = page.slice(page.indexOf('const needsLine = '), page.indexOf(';\n', page.indexOf('const needsLine = ')));
    expect(line).toMatch(/projectNeedsLine\(needs\)/);
    expect(line).toMatch(/<PublicNeedsLine/);
    expect(line).toMatch(/: null/);
  });

  test('HostConsole with no line draws no Needs-you row at all', () => {
    const { container } = render(<HostConsole top={{ title: 'Engagements' }} needs={null}><p>Setup</p></HostConsole>);
    expect(container.querySelector('.hc-needs')).toBeNull();
    expect(screen.queryByText('Nothing needs you now.')).toBeNull();
  });
});
