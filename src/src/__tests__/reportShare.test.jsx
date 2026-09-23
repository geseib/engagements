/**
 * SHARING A SAVED REPORT TAKES TWO ITEMS: THE LINK AND THE PASSKEY.
 *
 * The owner, 2026-09-23: "a second item a passkey that the host can give out so
 * that if you are not logged in you could share it with the passkey."
 *
 * Save now hands the host a link to /shared-report and a passkey, once
 * (ReportSavedDialog); the recipient types the passkey on that page
 * (SharedReportPage), which sends it in X-Report-Passkey to the public
 * download route. Every expectation below is written out by hand.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('html2pdf.js', () => () => ({
  set: () => ({ from: () => ({ outputPdf: async () => 'data:application/pdf;base64,JVBERi0=' }) }),
}));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

import { authFetch } from '../auth/authFetch';
import {
  PASSKEY_HEADER, shareLinkFor, readShareLink, describeReportKey, reportFilename,
  looksLikePasskey, fetchSharedReport,
} from '../config/reportShare';
import SharedReportPage from '../components/SharedReportPage';
import ReportSavedDialog from '../components/ReportSavedDialog';
import GameReport from '../components/GameReport';

const KEY = 'Q3-Offsite-2026-09-23-4821.pdf.enc';
const PERMANENT_KEY = `permanent/${KEY}`;
const API = 'https://api.example/dev/';

function pdfResponse() {
  return { ok: true, status: 200, blob: async () => new Blob(['%PDF-'], { type: 'application/pdf' }) };
}
const refused = () => ({ ok: false, status: 404, blob: async () => new Blob([]) });

let created;
beforeEach(() => {
  created = [];
  global.URL.createObjectURL = jest.fn(() => 'blob:report');
  global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { created.push(this.download); });
});
afterEach(() => jest.restoreAllMocks());

describe('the link and what it carries', () => {
  // rejects: a link that points at the API, or that carries the passkey.
  test('the link is this site\'s /shared-report page, naming the game and the key only', () => {
    const link = shareLinkFor('https://engage.dev.seibtribe.us', '4821', PERMANENT_KEY);
    expect(link).toBe('https://engage.dev.seibtribe.us/shared-report?game=4821&key=permanent%2FQ3-Offsite-2026-09-23-4821.pdf.enc');
    expect(link).not.toMatch(/passkey/i);
  });

  test('the page reads the same two values back, and refuses a link missing either', () => {
    expect(readShareLink('?game=4821&key=permanent%2FQ3-Offsite-2026-09-23-4821.pdf.enc'))
      .toEqual({ gameId: '4821', key: PERMANENT_KEY });
    expect(readShareLink('?game=4821')).toBeNull();
    expect(readShareLink('?key=x.pdf')).toBeNull();
    expect(readShareLink('?game=48a1&key=x.pdf')).toBeNull();
  });

  test('the key names the report and the day it was saved', () => {
    expect(describeReportKey(PERMANENT_KEY, '4821')).toEqual({ title: 'Q3 Offsite', savedOn: '2026-09-23' });
    expect(describeReportKey('odd.pdf', '4821')).toEqual({ title: 'Session report', savedOn: null });
    expect(reportFilename(PERMANENT_KEY)).toBe('Q3-Offsite-2026-09-23-4821.pdf');
  });

  test('a passkey is ten letters and numbers, however it was typed', () => {
    expect(looksLikePasskey('K7QM3-XPD9Z')).toBe(true);
    expect(looksLikePasskey(' k7qm3 xpd9z ')).toBe(true);
    expect(looksLikePasskey('K7QM3-XPD9')).toBe(false);
  });

  // rejects: the passkey in the URL, and a token sent to a public route.
  test('the download sends the passkey in the header, never the URL, and no Authorization', async () => {
    const fetchFn = jest.fn(async () => pdfResponse());
    const out = await fetchSharedReport({ apiBase: API, gameId: '4821', key: PERMANENT_KEY, passkey: ' K7QM3-XPD9Z ', fetchFn });
    expect(out.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example/dev/games/4821/report/download?key=permanent%2FQ3-Offsite-2026-09-23-4821.pdf.enc');
    expect(init.headers).toEqual({ [PASSKEY_HEADER]: 'K7QM3-XPD9Z' });
    expect(PASSKEY_HEADER).toBe('X-Report-Passkey');
  });

  test('a refusal is a mismatch; a thrown fetch is the network', async () => {
    expect(await fetchSharedReport({ apiBase: API, gameId: '1', key: 'k', passkey: 'p', fetchFn: async () => refused() }))
      .toEqual({ ok: false, reason: 'mismatch' });
    expect(await fetchSharedReport({ apiBase: API, gameId: '1', key: 'k', passkey: 'p', fetchFn: async () => { throw new Error('offline'); } }))
      .toEqual({ ok: false, reason: 'network' });
  });
});

describe('the recipient\'s page', () => {
  const open = (fetchFn, search = `?game=4821&key=${encodeURIComponent(KEY)}`) =>
    render(<SharedReportPage search={search} apiBase={API} fetchFn={fetchFn} />);

  test('it names the report and asks for the passkey — and does not pre-fill it', () => {
    open(jest.fn());
    expect(screen.getByRole('heading', { name: 'Q3 Offsite' })).toBeInTheDocument();
    expect(screen.getByLabelText('Passkey')).toHaveValue('');
    expect(screen.getByRole('button', { name: /download report/i })).toBeEnabled();
  });

  test('an incomplete link says so and offers no field', () => {
    open(jest.fn(), '?game=4821');
    expect(screen.getByRole('heading', { name: /this link is incomplete/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Passkey')).toBeNull();
  });

  // rejects: a round trip for something that cannot be a passkey.
  test('too short: a hint in the passkey\'s shape, and no request', () => {
    const fetchFn = jest.fn();
    open(fetchFn);
    fireEvent.change(screen.getByLabelText('Passkey'), { target: { value: 'K7QM3' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));
    // The example sits in its own no-wrap span, so the sentence is two nodes.
    expect(document.getElementById('rshare-status'))
      .toHaveTextContent('A passkey is ten letters and numbers, like K7QM3-XPD9Z.');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('a refused passkey says what to check, as an alert', async () => {
    open(jest.fn(async () => refused()));
    fireEvent.change(screen.getByLabelText('Passkey'), { target: { value: 'ABCDE-FGHJK' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not open this report/);
    expect(created).toEqual([]);
  });

  test('the right passkey downloads the PDF under the report\'s own name', async () => {
    const fetchFn = jest.fn(async () => pdfResponse());
    open(fetchFn);
    fireEvent.change(screen.getByLabelText('Passkey'), { target: { value: 'k7qm3-xpd9z' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));
    expect(await screen.findByText(/Downloaded/)).toBeInTheDocument();
    expect(fetchFn.mock.calls[0][1].headers).toEqual({ 'X-Report-Passkey': 'k7qm3-xpd9z' });
    expect(created).toEqual(['Q3-Offsite-2026-09-23-4821.pdf']);
  });
});

describe('the host\'s "Report saved" dialog', () => {
  const saved = { fileName: KEY, passkey: 'K7QM3-XPD9Z', shareUntil: '2026-09-29T12:00:00.000Z' };
  const show = (props = {}) => render(
    <ReportSavedDialog saved={saved} gameId="4821" apiBase={API} origin="https://engage.test" onClose={jest.fn()} {...props} />,
  );

  test('it shows both items: the page link and the passkey', () => {
    show();
    expect(screen.getByRole('dialog', { name: 'Report saved' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link')).toHaveValue(`https://engage.test/shared-report?game=4821&key=${encodeURIComponent(KEY)}`);
    expect(screen.getByLabelText('Passkey')).toHaveValue('K7QM3-XPD9Z');
    expect(screen.getByText(/only time the passkey is shown/)).toBeInTheDocument();
  });

  test('copy puts each item on the clipboard separately', async () => {
    const writeText = jest.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    show();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy the passkey' })); });
    expect(writeText).toHaveBeenLastCalledWith('K7QM3-XPD9Z');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy the link' })); });
    expect(writeText).toHaveBeenLastCalledWith(`https://engage.test/shared-report?game=4821&key=${encodeURIComponent(KEY)}`);
  });

  test('Download PDF uses the passkey it was just given', async () => {
    const fetchFn = jest.fn(async () => pdfResponse());
    show({ fetchFn });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(created).toEqual(['Q3-Offsite-2026-09-23-4821.pdf']));
    expect(fetchFn.mock.calls[0][1].headers).toEqual({ 'X-Report-Passkey': 'K7QM3-XPD9Z' });
  });

  // rejects: a dialog with only one way out.
  test('the X and Done both close it', () => {
    const onClose = jest.fn();
    show({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('saving from the report opens the dialog with the server\'s passkey', () => {
  const reportData = { gameId: '4821', eventTitle: 'Q3 Offsite', gameType: 'poll', players: [], questions: [] };

  test('Save report → the passkey the server minted is on screen', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ fileName: KEY, passkey: 'M4NP2-QRS7T', shareUntil: null, downloadUrlIsRelative: true }),
    });
    render(<GameReport reportData={reportData} status="ready" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /save report/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('dialog', { name: 'Report saved' })).toBeInTheDocument();
    expect(screen.getByLabelText('Passkey')).toHaveValue('M4NP2-QRS7T');
    expect(authFetch.mock.calls[0][0]).toMatch(/games\/4821\/save-report$/);
  });
});

describe('the save options say what the bucket actually does', () => {
  /*
    The owner, 2026-09-23, on the choice "24 hrs or 1 year": the dialog said
    "Temporary Save (24 hours) — deleted after 24 hours" while the bucket kept a
    standard report 90 days, and called a 365-day report "Permanent". The
    numbers come from ReportsBucket's lifecycle rule, read here as text, so the
    copy cannot drift from them again.
  */
  const fs = require('fs');
  const path = require('path');
  const template = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'template-clean.yaml'), 'utf8');
  const rule = template.slice(template.indexOf('Id: DeleteOldReports'));
  const standardDays = Number(rule.match(/Value: standard\s+ExpirationInDays: (\d+)/)[1]);
  const permanentDays = Number(rule.match(/Prefix: permanent\/\s+ExpirationInDays: (\d+)/)[1]);

  test('the template still says 90 and 365 (guards the parse)', () => {
    expect([standardDays, permanentDays]).toEqual([90, 365]);
  });

  // rejects: "24 hours", "Temporary", "Permanent" — every claim that was false.
  test('each option names its real retention, and nothing claims forever', () => {
    render(<GameReport reportData={{ gameId: '4821', eventTitle: 'Q3 Offsite', players: [], questions: [] }} status="ready" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /save report/i }));
    // 90 days is the default, as the 24-hour option was.
    expect(screen.getByLabelText(new RegExp(`Keep for ${standardDays} days`))).toBeChecked();
    expect(screen.getByText(`Deleted automatically ${standardDays} days after you save it.`)).toBeInTheDocument();
    expect(screen.getByLabelText(/Keep for 1 year/)).toBeInTheDocument();
    expect(permanentDays).toBe(365);
    const dialog = document.querySelector('.save-report-modal');
    expect(dialog.textContent).not.toMatch(/24 hours|temporary|permanent/i);
  });
});
