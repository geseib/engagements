/**
 * SAID IN THE ROOM (owner, 2026-10-13: "the host should get to type things in
 * as well, because things might be said in the room"). The meter's box sends
 * the line, clears on success, keeps it and says why on failure, and is only
 * there when the host page hands it a sender (the feedback round).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';

const meter = (compose) => render(<RoomMeter phase="FEEDBACK" heading="Comments" body="0" compose={compose} />);

test('no sender, no box', () => {
  const { container } = meter(null);
  expect(container.querySelector('.room-note')).toBeNull();
});

test('Enter sends the line and clears it', async () => {
  const onSend = jest.fn().mockResolvedValue({ ok: true });
  meter({ onSend });
  const box = screen.getByLabelText('Said in the room');
  fireEvent.change(box, { target: { value: '  We tried this in 2024.  ' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(box.value).toBe(''));
  expect(onSend).toHaveBeenCalledWith('We tried this in 2024.');
});

test('a failure keeps the words and says so', async () => {
  meter({ onSend: jest.fn().mockResolvedValue({ ok: false, error: 'This round is no longer open for comments' }) });
  const box = screen.getByLabelText('Said in the room');
  fireEvent.change(box, { target: { value: 'Keep me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer open');
  expect(box.value).toBe('Keep me');
});

test('nothing typed, nothing to add', () => {
  meter({ onSend: jest.fn() });
  expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
});

test('the Remote carries the same box in its feedback round, sent as the signed-in host', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'HostRemote.jsx'), 'utf8');
  expect(src).toMatch(/import RoomNote from '\.\/components\/RoomNote'/);
  expect(src).toMatch(/postRoomNote\(\{ fetchFn: authFetch/);
  const feedback = src.slice(src.indexOf('{onFeedback && ('), src.indexOf('{onFeedback && (') + 900);
  expect(feedback).toMatch(/<RoomNote compose=\{\{ onSend: sendRoomNote \}\}/);
});
