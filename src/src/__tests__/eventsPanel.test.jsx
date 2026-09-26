/**
 * THE EVENTS PLACE, RENDERED — components/EventsPanel.jsx and
 * EventDetailsDialog.jsx (docs/design/agenda-redesign/01, 01b, 05).
 *
 * rejects: a Personal space shown a builder, or asking the server for events
 * it cannot have; Past as a second page instead of a filter; one empty state
 * for "nothing exists" and "nothing matches"; a failed load dressed as an
 * empty list; a dialog with one exit, or one that drops typed words without
 * asking; invite-only offered as if it worked; a refusal that closes the
 * dialog and loses what was typed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventsPanel, { NewEventButton, isUpcoming, todayIso } from '../components/EventsPanel';
import { zoneOptions } from '../components/EventDetailsDialog';

jest.mock('../utils/eventsApi', () => ({
  listEvents: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
}));
const api = require('../utils/eventsApi');

const DAY = 86400000;
const dayFromNow = (n) => todayIso(new Date(Date.now() + n * DAY));
const EVENTS = [
  { code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: `${dayFromNow(10)}T09:00`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 8 },
  { code: '6120', title: 'Sales onboarding, cohort 7', place: 'Online', startsAt: `${dayFromNow(15)}T13:30`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0 },
  { code: '2289', title: 'Partner day', place: 'Riverside Hall', startsAt: `${dayFromNow(-20)}T10:00`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 11 },
];
const props = (over = {}) => ({
  teamPlan: true, creating: false, onCreatingChange: jest.fn(), onOpen: jest.fn(),
  onRequestPlan: jest.fn(), onShowPlan: jest.fn(), ...over,
});
const rows = () => screen.queryAllByTestId('event-row');

beforeEach(() => {
  jest.clearAllMocks();
  api.listEvents.mockResolvedValue(EVENTS);
  window.confirm = jest.fn(() => false);
});

describe('a Team-plan organisation (01)', () => {
  it('lists upcoming events with their facts, and calls an empty agenda a Draft', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent('Q4 Kickoff');
    expect(rows()[0]).toHaveTextContent('Harbour Room, 4th floor');
    expect(rows()[0]).toHaveTextContent('5307');
    expect(rows()[0]).toHaveTextContent('Anyone with the code');
    expect(rows()[0]).toHaveTextContent('Scheduled');
    expect(rows()[1]).toHaveTextContent('Draft');
    expect(screen.getByRole('button', { name: /upcoming 2/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Past is a filter, not a second page', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /past 1/i }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Partner day');
  });

  it('a search that matches nothing says so, with the way back', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('events-nomatch')).toHaveTextContent('No upcoming event matches “zzz”.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(rows()).toHaveLength(2);
  });

  it('opening an event hands its code and title up, from the name or from Open', async () => {
    const p = props();
    render(<EventsPanel {...p} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Q4 Kickoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Sales onboarding, cohort 7' }));
    expect(p.onOpen.mock.calls).toEqual([['5307', 'Q4 Kickoff'], ['6120', 'Sales onboarding, cohort 7']]);
  });

  it('nothing made yet: one sentence and the way to make one', async () => {
    api.listEvents.mockResolvedValue([]);
    const p = props();
    render(<EventsPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('events-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('events-nomatch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    expect(p.onCreatingChange).toHaveBeenCalledWith(true);
  });

  it('a failed load says so, and is not the empty state', async () => {
    api.listEvents.mockRejectedValue(new Error('Could not load events. Try again.'));
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load events'));
    expect(screen.queryByTestId('events-empty')).toBeNull();
  });
});

describe('a space not on the Team plan (01b)', () => {
  it('explains the Team plan and never asks for events', () => {
    const p = props({ teamPlan: false });
    render(<EventsPanel {...p} />);
    expect(screen.getByTestId('events-team-only')).toHaveTextContent('Events are part of the Team plan');
    expect(api.listEvents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Request the Team plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'What the Team plan adds' }));
    expect(p.onRequestPlan).toHaveBeenCalled();
    expect(p.onShowPlan).toHaveBeenCalled();
  });

  it('offers the request only to someone who may make it', () => {
    render(<EventsPanel {...props({ teamPlan: false, onRequestPlan: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Request the Team plan' })).toBeNull();
    expect(screen.getByTestId('events-team-only')).toHaveTextContent('Only an owner of this organisation can request the Team plan.');
  });
});

describe('New event (05)', () => {
  const openDialog = async (over = {}) => {
    const p = props({ creating: true, ...over });
    render(<EventsPanel {...p} />);
    await screen.findByRole('dialog');
    return p;
  };

  it('both exits close a clean dialog, and ask before dropping typed words', async () => {
    const p = await openDialog();
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits).toHaveLength(2);
    exits.forEach((b) => fireEvent.click(b));
    expect(p.onCreatingChange.mock.calls).toEqual([[false], [false]]);
    expect(window.confirm).not.toHaveBeenCalled();
    p.onCreatingChange.mockClear();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    exits.forEach((b) => fireEvent.click(b));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(p.onCreatingChange).not.toHaveBeenCalled();
  });

  it('creates an open event from the date, the start and the zone', async () => {
    api.createEvent.mockResolvedValue({ code: '5307', title: 'Q4 Kickoff' });
    const p = await openDialog();
    const date = dayFromNow(30);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: 'Harbour Room' } });
    fireEvent.click(screen.getByLabelText(/Anonymous/));
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(p.onOpen).toHaveBeenCalledWith('5307', 'Q4 Kickoff'));
    expect(api.createEvent).toHaveBeenCalledWith({
      title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: `${date}T09:30`,
      timeZone: 'Europe/London', access: 'open', attendeeReports: 'anonymous',
    });
    expect(p.onCreatingChange).toHaveBeenCalledWith(false);
  });

  it('says what is missing before sending anything', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the event a name.');
    expect(api.createEvent).not.toHaveBeenCalled();
  });

  it('invite-only is shown, disabled, and says it is coming', async () => {
    await openDialog();
    const invite = screen.getByLabelText(/Only people you invite/);
    expect(invite).toBeDisabled();
    expect(screen.getByText(/Coming soon\. Each person will get their own passcode/)).toBeInTheDocument();
  });

  it('a refusal keeps the dialog open with the server\'s sentence and what was typed', async () => {
    api.createEvent.mockRejectedValue(new Error('Events are part of the Team plan, and this space is on the Personal plan.'));
    const p = await openDialog();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: dayFromNow(30) } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Events are part of the Team plan');
    expect(screen.getByLabelText('Name')).toHaveValue('Q4 Kickoff');
    expect(p.onOpen).not.toHaveBeenCalled();
  });
});

describe('the pieces', () => {
  it('NewEventButton is a named button inside the events scope', () => {
    const onClick = jest.fn();
    const { container } = render(<NewEventButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    expect(onClick).toHaveBeenCalled();
    expect(container.querySelector('.evts .evts-btn--primary')).not.toBeNull();
  });
  it('upcoming means today or later, by the event\'s own date', () => {
    expect(isUpcoming({ startsAt: '2026-10-09T09:00' }, '2026-10-09')).toBe(true);
    expect(isUpcoming({ startsAt: '2026-10-08T23:00' }, '2026-10-09')).toBe(false);
  });
  it('the zone list starts with the one given and always has UTC', () => {
    const zones = zoneOptions('Europe/London');
    expect(zones[0]).toBe('Europe/London');
    expect(zones).toContain('UTC');
    expect(new Set(zones).size).toBe(zones.length);
  });
});
