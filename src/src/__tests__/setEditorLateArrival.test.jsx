import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/**
 * A SET THAT ARRIVES AFTER ITS ID. A fresh load of a set's own address (the
 * Archive's "Open the set" link) gives the editor a bare { id } first, then the
 * real set under the same id once the list loads. The form must fill from the
 * set when it arrives, not stay blank (dev QA 2026-11-07).
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'techtoystomorrow',
  name: 'Tech, Toys & Tomorrow',
  description: 'Gadgets and the future',
  engagementType: 'trivia',
  totalQuestions: 60,
  categoryCount: 6,
  activeVersion: 2,
  topic: 'music',
};

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
  authFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' }));
});

const props = { onSaved: jest.fn(), onChanged: jest.fn(), onCancel: jest.fn() };

it('fills the form when the set arrives after a bare id', async () => {
  const { rerender } = render(<QuestionSetEditor questionSet={{ id: SET.id }} {...props} />);
  rerender(<QuestionSetEditor questionSet={SET} {...props} />);
  await waitFor(() => expect(screen.getByDisplayValue('Tech, Toys & Tomorrow')).toBeInTheDocument());
  expect(screen.getByDisplayValue('Gadgets and the future')).toBeInTheDocument();
  expect(screen.getByLabelText(/topic/i)).toHaveValue('music');
});

it('does not refill when the same set is handed back after a change (typing survives a list refresh)', async () => {
  const { rerender } = render(<QuestionSetEditor questionSet={SET} {...props} />);
  await waitFor(() => expect(screen.getByDisplayValue('Tech, Toys & Tomorrow')).toBeInTheDocument());
  const title = screen.getByDisplayValue('Tech, Toys & Tomorrow');
  const { fireEvent } = require('@testing-library/react');
  fireEvent.change(title, { target: { value: 'Renamed' } });
  rerender(<QuestionSetEditor questionSet={{ ...SET, totalQuestions: 61 }} {...props} />);
  expect(screen.getByDisplayValue('Renamed')).toBeInTheDocument();
});
