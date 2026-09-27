/**
 * AN EVENT'S AGENDA ON THE HOST'S SIDE — components/event/HostEventAgenda.jsx.
 *
 * The owner, 27 Sep 2026: "there is still no way to create an agenda for the
 * host. only the admin". This page mounts the console's own builder for a
 * host, with the same question sets, in a frame of the host's own.
 *
 * rejects: a second builder (anything but EventBuilder, or without the sets
 * the console hands it); no way back to the main screen or on to the stage;
 * a title that does not follow a rename; a deleted event leaving the host on
 * a page with nothing to build.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostEventAgenda from '../components/event/HostEventAgenda';

const builderProps = [];
jest.mock('../components/EventBuilder', () => ({
  __esModule: true,
  default: (props) => { builderProps.push(props); return <div data-testid="builder">{props.code}</div>; },
}));
jest.mock('../auth/navigate', () => ({ __esModule: true, navigateTo: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: jest.fn() }));
const { navigateTo } = require('../auth/navigate');
const { authFetch } = require('../auth/authFetch');

const SETS = [{ id: 'retro', name: 'Retro', engagementType: 'survey' }];

beforeEach(() => {
  jest.clearAllMocks();
  builderProps.length = 0;
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ questionSets: SETS }) });
});

test('mounts the console\'s own builder for this event, with the org\'s question sets', async () => {
  render(<HostEventAgenda code="4821" />);
  expect(screen.getByTestId('builder')).toHaveTextContent('4821');
  await waitFor(() => expect(builderProps[builderProps.length - 1].sets).toEqual(SETS));
  expect(String(authFetch.mock.calls[0][0])).toMatch(/admin\/question-sets$/);
});

test('back to the main screen, and on to the event\'s stage', () => {
  render(<HostEventAgenda code="4821" />);
  fireEvent.click(screen.getByRole('button', { name: /Main screen/ }));
  expect(navigateTo).toHaveBeenLastCalledWith('/host');
  fireEvent.click(screen.getByRole('button', { name: /Open the stage/ }));
  expect(navigateTo).toHaveBeenLastCalledWith('/host/event/4821');
});

test('the heading follows the event\'s name; a deleted event returns to the main screen', async () => {
  render(<HostEventAgenda code="4821" />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Agenda');
  const { onTitle, onDeleted } = builderProps[0];
  React.act(() => onTitle('Q4 Kickoff'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Q4 Kickoff' })).toBeInTheDocument();
  onDeleted('4821');
  expect(navigateTo).toHaveBeenLastCalledWith('/host');
});
