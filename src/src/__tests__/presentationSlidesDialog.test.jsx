/**
 * A PRESENTATION'S SLIDES IN THE BUILDER — components/EventItemDialog.jsx
 * (choose, check, count, upload, replace, remove) and EventBuilder.jsx's row
 * ("Dana Whitfield · 12 slides"); utils/eventsApi.js's four slide calls.
 *
 * The owner, 27 Sep 2026: "can the presentation show pdf presentation with
 * arrow key forward/backward through the pages?" — so a presentation takes
 * one PDF, uploaded straight to storage, and the item names it on Save.
 *
 * pdf.js (utils/pdfDeck.countPages) and the signed upload are mocked.
 *
 * rejects: a .pptx, or a PDF pdf.js cannot open, sent anywhere; an upload
 * never named on the item it was for; Save pressed while the file is still
 * going up; slides removed (or replaced) the moment the button is pressed
 * rather than on Save; an edit that does not touch the slides sending them;
 * a staged upload lost by closing without a word; the builder's row silent
 * about a deck; a slide call that bypasses authFetch or goes to the wrong route.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import EventItemDialog from '../components/EventItemDialog';
import EventBuilder from '../components/EventBuilder';

jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
  signDeckUpload: jest.fn(),
  putDeckFile: jest.fn(),
  getEvent: jest.fn(),
  deleteEvent: jest.fn(),
  reorderItems: jest.fn(),
}));
jest.mock('../utils/pdfDeck', () => ({ countPages: jest.fn() }));
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => []),
  listSetCategories: jest.fn(async () => []),
}));
const api = require('../utils/eventsApi');
const pdf = require('../utils/pdfDeck');

const CODE = '5307';
const UPLOAD = { key: 'staging/decks/0a1b2c3d4e5f6a7b/5307/0123456789abcdef.pdf', url: 'https://media.test/put', contentType: 'application/pdf' };
const ITEMS = [{ itemId: 'it_00000001', order: 1, type: 'poll', title: 'Before we start', minutes: 8, description: '', ledBy: '', state: 'planned' }];
const TALK = {
  itemId: 'it_00000002', order: 2, type: 'presentation', title: 'FY26 in review', minutes: 20, description: '',
  ledBy: 'Dana Whitfield', state: 'planned', deck: { id: 'aa', name: 'FY26.pdf', pages: 12, bytes: 3.4 * 1024 * 1024 }, deckPage: 1,
};
const base = (over = {}) => ({
  code: CODE, mode: 'add', type: 'presentation', items: ITEMS, sets: [],
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});
const pdfFile = (name = 'FY26 review.pdf', type = 'application/pdf') => new File(['%PDF-1.7 slides'], name, { type });
const choose = (file) => fireEvent.change(screen.getByTestId('deck-file'), { target: { files: [file] } });
const slidesField = () => screen.getByTestId('item-slides');

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.addItem.mockResolvedValue({ item: {} });
  api.updateItem.mockResolvedValue({ item: {} });
  api.signDeckUpload.mockResolvedValue({ upload: UPLOAD });
  api.putDeckFile.mockImplementation(async (upload, file, onProgress) => { onProgress(0.5); onProgress(1); });
  pdf.countPages.mockResolvedValue(12);
});

describe('adding a presentation with its slides', () => {
  test('a PDF is counted, uploaded straight to storage, and named on the item when it is added', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    const file = pdfFile();
    choose(file);
    expect(await within(slidesField()).findByText('FY26 review.pdf')).toBeInTheDocument();
    expect(within(slidesField()).getByText(/12 slides · \d+ KB · not saved yet/)).toBeInTheDocument();
    expect(pdf.countPages).toHaveBeenCalledWith(file);
    expect(api.signDeckUpload).toHaveBeenCalledWith(CODE, file);
    expect(api.putDeckFile).toHaveBeenCalledWith(UPLOAD, file, expect.any(Function));

    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'FY26 in review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith(CODE, {
      type: 'presentation', title: 'FY26 in review', description: '', minutes: 15,
      deck: { key: UPLOAD.key, name: 'FY26 review.pdf', pages: 12 },
    });
  });

  test('anything but a PDF is refused in words, and nothing is read or sent', async () => {
    render(<EventItemDialog {...base()} />);
    choose(pdfFile('Q4 plan.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
    expect(await screen.findByRole('alert')).toHaveTextContent('“Q4 plan.pptx” is not a PDF. PowerPoint, Keynote and Google Slides all save as PDF.');
    expect(pdf.countPages).not.toHaveBeenCalled();
    expect(api.signDeckUpload).not.toHaveBeenCalled();
  });

  test('a PDF that cannot be opened is refused before a byte is uploaded', async () => {
    pdf.countPages.mockRejectedValue(new Error('Invalid PDF structure'));
    render(<EventItemDialog {...base()} />);
    choose(pdfFile('broken.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('“broken.pdf” could not be opened as a PDF.');
    expect(api.signDeckUpload).not.toHaveBeenCalled();
    expect(api.putDeckFile).not.toHaveBeenCalled();
  });

  test('while the PDF is going up, its progress shows and Save waits', async () => {
    let finish;
    api.putDeckFile.mockImplementation((upload, file, onProgress) => new Promise((resolve) => {
      onProgress(0.4);
      finish = resolve;
    }));
    render(<EventItemDialog {...base()} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'FY26 in review' } });
    choose(pdfFile());
    expect(await screen.findByText('Uploading… 40%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to agenda' })).toBeDisabled();
    await act(async () => { finish(); });
    expect(await within(slidesField()).findByText(/12 slides/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to agenda' })).not.toBeDisabled();
  });

  test('an upload that failed says so, and the item can still be added without slides', async () => {
    const p = base();
    api.putDeckFile.mockRejectedValue(Object.assign(new Error('The PDF did not upload. Try again.'), { status: 403 }));
    render(<EventItemDialog {...p} />);
    choose(pdfFile());
    expect(await screen.findByRole('alert')).toHaveTextContent('The PDF did not upload. Try again.');
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'FY26 in review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem.mock.calls[0][1]).not.toHaveProperty('deck');
  });

  test('closing with an uploaded PDF not yet saved asks first', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    choose(pdfFile());
    await within(slidesField()).findByText(/not saved yet/);
    // Both exits (the X and the footer's Close) go through one requestClose.
    for (const exit of screen.getAllByRole('button', { name: 'Close' })) fireEvent.click(exit);
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  test('only a presentation is offered slides', () => {
    render(<EventItemDialog {...base({ type: 'custom' })} />);
    expect(screen.queryByTestId('item-slides')).toBeNull();
  });
});

describe('editing a presentation that has slides', () => {
  const edit = (over = {}) => base({ mode: 'edit', item: TALK, ...over });

  test('the slides are named with their pages and size; a plain edit leaves them alone', async () => {
    const p = edit();
    render(<EventItemDialog {...p} />);
    expect(within(slidesField()).getByText('FY26.pdf')).toHaveAttribute('title', 'FY26.pdf');
    expect(within(slidesField()).getByText('12 slides · 3.4 MB')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem.mock.calls[0][2]).not.toHaveProperty('deck');
  });

  test('Remove PDF takes them off on Save, not before', async () => {
    const p = edit();
    render(<EventItemDialog {...p} />);
    fireEvent.click(within(slidesField()).getByRole('button', { name: 'Remove PDF' }));
    expect(within(slidesField()).getByText('The slides come off when you save.')).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith(CODE, TALK.itemId, expect.objectContaining({ deck: null }));
  });

  test('Replace uploads the new PDF, and Save names it in place of the old one', async () => {
    const p = edit();
    render(<EventItemDialog {...p} />);
    fireEvent.click(within(slidesField()).getByRole('button', { name: 'Replace' }));
    pdf.countPages.mockResolvedValue(4);
    choose(pdfFile('FY26 v2.pdf'));
    expect(await within(slidesField()).findByText('FY26 v2.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith(CODE, TALK.itemId, expect.objectContaining({
      deck: { key: UPLOAD.key, name: 'FY26 v2.pdf', pages: 4 },
    }));
  });
});

describe('the builder\'s row', () => {
  test('a presentation with slides says how many, after who gives it', async () => {
    api.getEvent.mockResolvedValue({
      event: {
        code: CODE, title: 'Q4 Kickoff', place: '', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
        access: 'open', state: 'SCHEDULED', itemCount: 1, engagementCount: 0, breakCount: 0, attendeeReports: 'full',
      },
      items: [TALK, { ...TALK, itemId: 'it_00000003', order: 3, ledBy: '', deck: undefined, title: 'Open floor' }],
    });
    render(<EventBuilder code={CODE} sets={[]} />);
    await waitFor(() => expect(screen.getAllByTestId('agenda-row')).toHaveLength(2));
    const lines = screen.getAllByTestId('agenda-row').map((r) => (r.querySelector('.evb-sub') || {}).textContent || '');
    expect(lines).toEqual(['Dana Whitfield · 12 slides', '']);
  });
});

describe('utils/eventsApi.js — the slide calls', () => {
  const real = jest.requireActual('../utils/eventsApi');
  let authFetch;
  beforeEach(() => {
    authFetch = jest.spyOn(require('../auth/authFetch'), 'authFetch')
      .mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ upload: UPLOAD, deck: {}, page: 3 }) }));
    window.API_BASE = 'https://api.test/dev/';
  });
  afterEach(() => authFetch.mockRestore());

  test.each([
    ['signDeckUpload', () => real.signDeckUpload(CODE, { name: 'a.pdf', size: 10, type: 'application/pdf' }), 'POST', 'events/5307/deck', { name: 'a.pdf', size: 10, type: 'application/pdf' }],
    ['readDeck', () => real.readDeck(CODE, 'it_00000002'), 'GET', 'events/5307/items/it_00000002/deck', undefined],
    ['turnPage', () => real.turnPage(CODE, 'it_00000002', 3), 'POST', 'events/5307/run', { action: 'page', itemId: 'it_00000002', page: 3 }],
  ])('%s goes through authFetch to its route', async (_name, run, method, path, body) => {
    await run();
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe(`https://api.test/dev/${path}`);
    expect(init.method).toBe(method);
    if (body === undefined) expect(init.body).toBeUndefined();
    else expect(JSON.parse(init.body)).toEqual(body);
  });

  test('putDeckFile PUTs the file itself to the signed URL, typed as signed, with no bearer token', async () => {
    const sent = {};
    const Xhr = function FakeXhr() {
      this.upload = {};
      this.headers = {};
      this.open = (method, url) => Object.assign(sent, { method, url });
      this.setRequestHeader = (k, v) => { this.headers[k] = v; };
      this.send = (body) => {
        Object.assign(sent, { body, headers: this.headers });
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        this.status = 200;
        this.onload();
      };
    };
    const was = window.XMLHttpRequest;
    window.XMLHttpRequest = Xhr;
    try {
      const file = pdfFile();
      const progress = jest.fn();
      await real.putDeckFile(UPLOAD, file, progress);
      expect(sent).toEqual({ method: 'PUT', url: UPLOAD.url, body: file, headers: { 'Content-Type': 'application/pdf' } });
      expect(progress).toHaveBeenCalledWith(0.5);
      expect(authFetch).not.toHaveBeenCalled();
    } finally {
      window.XMLHttpRequest = was;
    }
  });
});
