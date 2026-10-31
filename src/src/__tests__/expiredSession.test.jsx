/**
 * A SESSION THAT NO LONGER EXISTS (owner, 31 Oct 2026, event 9630). A
 * session's rows expire 7 days after it starts (lambda-functions, each
 * session-ttl.js); an event item keeps its code, and Open sent the host to a
 * 404 that the host page turned silently into its main menu.
 *
 * GameHostPage.jsx cannot be mounted in jsdom, so its half is held by reading
 * the source; the helpers it uses and the welcome screen's line are rendered.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import WelcomeScreen from '../components/WelcomeScreen';
import {
  expiredItemPath, readExpiredParam, expiredItemNotice, goneSessionNotice, EXPIRED_PARAM,
} from '../config/runningOrder';

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

test('the bounce: back to the event\'s board, carrying the session that is gone', () => {
  expect(expiredItemPath('9630', '8912')).toBe('/host/event/9630?expired=8912');
  expect(readExpiredParam('?expired=8912')).toBe('8912');
  expect(readExpiredParam('?expired=<script>')).toBe('');
  expect(readExpiredParam('')).toBe('');
  expect(EXPIRED_PARAM).toBe('expired');
});

test('the host page: a 404 is "gone", and an event item that is gone goes back to its board, never the menu', () => {
  const check = PAGE.slice(PAGE.indexOf('const checkGameStatus = async'), PAGE.indexOf('const checkGameStatus = async') + 1200);
  expect(check).toMatch(/status === 404\)[\s\S]*gone: true/);
  const url = PAGE.slice(PAGE.indexOf('checkGameStatus(gameIdFromUrl).then'), PAGE.indexOf('checkGameStatus(gameIdFromUrl).then') + 3000);
  expect(url).toMatch(/gameStatus\.gone && eventItemStage[\s\S]*navigateTo\(expiredItemPath\(urlParams\.get\('event'\), gameIdFromUrl\)\)/);
  expect(url).toMatch(/if \(gameStatus\.gone\) setWelcomeNotice\(goneSessionNotice\(gameIdFromUrl\)\)/);
  expect(PAGE).toMatch(/<WelcomeScreen[\s\S]*?notice=\{welcomeNotice\}/);
});

test('the words: the board names the item; the welcome screen names the code', () => {
  expect(expiredItemNotice('Brainstorm'))
    .toBe('Brainstorm: this session’s answers were removed 7 days after it ran. Its report is under Reports if one was saved.');
  expect(goneSessionNotice('8912')).toMatch(/^That session \(8912\) no longer exists\./);
});

test('outside an event, the welcome screen says the session no longer exists rather than nothing', () => {
  render(<WelcomeScreen notice={goneSessionNotice('8912')} />);
  expect(screen.getByRole('status')).toHaveTextContent('That session (8912) no longer exists.');
});

test('no notice, no line', () => {
  render(<WelcomeScreen />);
  expect(document.querySelector('.wel-notice')).toBeNull();
});
