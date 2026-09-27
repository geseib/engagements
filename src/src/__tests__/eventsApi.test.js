/**
 * utils/eventsApi.js — the console's calls to the event routes.
 *
 * rejects: a call that bypasses authFetch (the routes sit behind the
 * authorizer); a wrong method or path; a refusal that loses the server's
 * sentence or its body (the builder shows the cap's sentence as the server
 * said it, and tells a cap from a changed agenda by the body).
 */
import {
  EventsApiError, listEvents, getEvent, createEvent, updateEvent,
  addItem, updateItem, removeItem, reorderItems, deleteEvent,
} from '../utils/eventsApi';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

const answer = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/dev/'; });

describe('each call goes where the route is, through authFetch', () => {
  it.each([
    ['listEvents', () => listEvents(), 'GET', 'events', undefined, { events: [] }],
    ['getEvent', () => getEvent('5307'), 'GET', 'events/5307', undefined, { event: {}, items: [] }],
    ['createEvent', () => createEvent({ title: 'Q4' }), 'POST', 'events', { title: 'Q4' }, { event: { code: '5307' } }],
    ['updateEvent', () => updateEvent('5307', { title: 'Q5' }), 'PUT', 'events/5307', { title: 'Q5' }, { event: {} }],
    ['addItem', () => addItem('5307', { type: 'break', minutes: 5 }), 'POST', 'events/5307/items', { type: 'break', minutes: 5 }, { item: {} }],
    ['updateItem', () => updateItem('5307', 'it_0a1b2c3d', { version: 3 }), 'PUT', 'events/5307/items/it_0a1b2c3d', { version: 3 }, { item: {} }],
    ['removeItem', () => removeItem('5307', 'it_0a1b2c3d'), 'DELETE', 'events/5307/items/it_0a1b2c3d', undefined, { removed: 'it_0a1b2c3d' }],
    ['reorderItems', () => reorderItems('5307', ['a', 'b']), 'PUT', 'events/5307/items', { order: ['a', 'b'] }, { order: ['a', 'b'] }],
    ['deleteEvent', () => deleteEvent('5307'), 'DELETE', 'events/5307', undefined, { deleted: '5307' }],
  ])('%s', async (_name, run, method, path, body, reply) => {
    authFetch.mockImplementation(() => answer(reply));
    await run();
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe(`https://api.test/dev/${path}`);
    expect(init.method).toBe(method);
    if (body === undefined) expect(init.body).toBeUndefined();
    else expect(JSON.parse(init.body)).toEqual(body);
  });
});

describe('what comes back', () => {
  it('listEvents gives the list, and an empty one when the body has none', async () => {
    authFetch.mockImplementation(() => answer({ events: [{ code: '5307' }] }));
    await expect(listEvents()).resolves.toEqual([{ code: '5307' }]);
    authFetch.mockImplementation(() => answer({}));
    await expect(listEvents()).resolves.toEqual([]);
  });
  it('createEvent gives the event', async () => {
    authFetch.mockImplementation(() => answer({ event: { code: '5307', title: 'Q4' } }, 201));
    await expect(createEvent({})).resolves.toEqual({ code: '5307', title: 'Q4' });
  });
  it('a refusal throws with the server\'s sentence, status and body', async () => {
    authFetch.mockImplementation(() => answer({ error: 'This event has 8 engagements, the most one can hold. Remove one to add another.', cap: 'engagements' }, 409));
    const err = await addItem('5307', {}).catch((e) => e);
    expect(err).toBeInstanceOf(EventsApiError);
    expect(err.message).toMatch(/8 engagements/);
    expect(err.status).toBe(409);
    expect(err.body.cap).toBe('engagements');
  });
  it('a refusal with no body still says something', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('no json'); } }));
    await expect(getEvent('5307')).rejects.toThrow('HTTP 500');
  });
});
