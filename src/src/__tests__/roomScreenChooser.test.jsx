/**
 * "Where will the room watch?" and "Help me pick" (session flow v3 §4.7). The
 * owner, 14 Oct: the two drawings become the choice, with a help-me-pick
 * button "a great part of the setup when you first launch the session". The
 * recommendation table is RECOMMENDATIONS §4.7's, row for row.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import RoomScreenChooser from '../components/stage/RoomScreenChooser';
import { recommendRoomScreen, storedRoomScreen, storeRoomScreen, ROOM_WORDS } from '../config/roomScreen';
import { SURFACES_KEY, twoSurfacesOn } from '../config/surfaces';

describe('the recommendation', () => {
  test('connected, its own picture: two screens', () => {
    expect(recommendRoomScreen({ connected: 'yes', picture: 'own', private: 'yes' }).choice).toBe('two');
  });
  test('connected, a copy: one screen, with the Remote for private notes', () => {
    const r = recommendRoomScreen({ connected: 'yes', picture: 'copy', private: 'yes' });
    expect(r.choice).toBe('classic');
    expect(r.detail).toMatch(/Remote/);
  });
  test('connected, not sure: try two screens', () => {
    expect(recommendRoomScreen({ connected: 'yes', picture: 'unsure' })).toMatchObject({ choice: 'two', lead: 'Try two screens.' });
  });
  test('not connected yet: one screen for now', () => {
    expect(recommendRoomScreen({ connected: 'no' })).toMatchObject({ choice: 'classic', lead: 'One screen for now.' });
  });
  test('the privacy question changes only the words', () => {
    const a = recommendRoomScreen({ connected: 'yes', picture: 'copy', private: 'yes' });
    const b = recommendRoomScreen({ connected: 'yes', picture: 'copy', private: 'no' });
    expect(a.choice).toBe(b.choice);
    expect(a.lead).not.toBe(b.lead);
  });
  test('nothing to say until the picture is known', () => {
    expect(recommendRoomScreen({})).toBeNull();
    expect(recommendRoomScreen({ connected: 'yes' })).toBeNull();
  });
});

describe('the stored choice is the switch surfaces.js reads', () => {
  const memory = () => {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
  };
  test('stored two is two screens on any tier; classic is one', () => {
    const st = memory();
    expect(storedRoomScreen(st)).toBeNull();
    storeRoomScreen(st, 'two');
    expect(st.getItem(SURFACES_KEY)).toBe('two');
    expect(twoSurfacesOn({ env: 'production', storage: st, gameType: 'call-and-answer' })).toBe(true);
    storeRoomScreen(st, 'classic');
    expect(twoSurfacesOn({ env: 'development', storage: st, gameType: 'call-and-answer' })).toBe(false);
  });
  test('a refusing storage is survived', () => {
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(storedRoomScreen(bad)).toBeNull();
    expect(storeRoomScreen(bad, 'two')).toBe(false);
  });
});

describe('the chooser', () => {
  test('two cards with their words, Open the room\'s window on the two-screen card, and each chooses', () => {
    const onChoose = jest.fn();
    render(<RoomScreenChooser presentHref="/present?gameId=1" onChoose={onChoose} />);
    expect(screen.getByRole('heading', { name: ROOM_WORDS.heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ROOM_WORDS.openPresent })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.useOne }));
    expect(onChoose).toHaveBeenCalledWith('classic');
  });

  test('Help me pick asks three questions in place, then offers one button for its recommendation', () => {
    const onChoose = jest.fn();
    render(<RoomScreenChooser presentHref="/p" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.helpMePick }));
    expect(screen.getByText(ROOM_WORDS.q1)).toBeInTheDocument();
    expect(screen.getByText(/Nothing changes until you choose/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.q1Yes }));
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.q2Own }));
    expect(screen.getByRole('status')).toHaveTextContent('We recommend two screens.');
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.useTwo }));
    expect(onChoose).toHaveBeenCalledWith('two');
  });

  test('"Not yet" skips the other two questions', () => {
    render(<RoomScreenChooser onChoose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.helpMePick }));
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.q1No }));
    expect(screen.queryByText(ROOM_WORDS.q2)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('One screen for now.');
  });

  test('a host who already chose can keep the choice', () => {
    const onClose = jest.fn();
    render(<RoomScreenChooser current="two" onChoose={() => {}} onClose={onClose} />);
    expect(screen.getByRole('button', { name: ROOM_WORDS.chosen })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.keepChoice }));
    expect(onClose).toHaveBeenCalled();
  });

  test('the host page asks in the lobby until this browser has chosen', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/hostPhase === 'LOBBY'[\s\S]{0,200}roomScreenChoice === null \|\| roomScreenOpen/);
  });
});
