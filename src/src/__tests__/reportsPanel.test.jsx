/**
 * components/ReportsPanel.jsx — the saved-reports list, built from
 * docs/design/reports-list/01-reports.html.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ReportsPanel, { formatKeptUntil } from '../components/ReportsPanel';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const reports = [
  { id: 'REPORT#4812#a', gameId: '4812', title: 'Nakamura Trivia Night', s3Key: 'permanent/x.pdf.enc', permanent: true, savedAt: iso(-40), expiresAt: iso(325), sessionGone: true, downloadUrl: 'reports/download?key=permanent%2Fx.pdf.enc' },
  { id: 'REPORT#7203#b', gameId: '7203', title: 'Q3 Leadership Offsite', s3Key: 'y.pdf', permanent: false, savedAt: iso(0), expiresAt: iso(90), sessionGone: false, downloadUrl: 'reports/download?key=y.pdf' },
  { id: 'REPORT#1190#c', gameId: '1190', title: 'Sales Kickoff', s3Key: 'z.pdf.enc', permanent: false, savedAt: iso(-87), expiresAt: iso(3), sessionGone: true, downloadUrl: 'reports/download?key=z.pdf.enc' },
];
const respond = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body, blob: async () => new Blob(['%PDF']) });

beforeEach(() => { authFetch.mockReset(); });

describe('ReportsPanel', () => {
  it('lists every saved report with its title, saved date and a KEPT-UNTIL date', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3));
    expect(screen.getByText('Nakamura Trivia Night')).toBeInTheDocument();
    // rejects: a countdown. A date is the same number tomorrow.
    const until = screen.getAllByTestId('kept-until').map((el) => el.textContent);
    until.forEach((t) => expect(t).toMatch(/\d{4}$/));
    until.forEach((t) => expect(t).not.toMatch(/days? left|in \d+ days/i));
  });

  it('marks a report expiring within a week, and the year-long keep', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    // Sorted newest-saved first: Offsite (today), Nakamura (-40d), Sales (-87d).
    const cells = screen.getAllByTestId('kept-until');
    expect(cells[2]).toHaveClass('rp-until--soon');       // Sales: 3 days out
    expect(cells[0]).not.toHaveClass('rp-until--soon');   // Offsite: 90 days out
    expect(cells[1].querySelector('svg')).not.toBeNull(); // Nakamura: the pin
    expect(screen.getByText('kept for a year')).toBeInTheDocument();
  });

  it('says the session has expired rather than offering a dead Open', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    expect(screen.getAllByText('Session expired')).toHaveLength(2);
    expect(screen.getByText('Still open')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^open/i })).toBeNull();
  });

  it('downloads through the authorised route, not a bare link', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    fireEvent.click(screen.getByRole('button', { name: /download nakamura/i }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringMatching(/reports\/download\?key=permanent%2Fx\.pdf\.enc$/)));
    // rejects: an <a href> to the route, which would 401 without the token.
    expect(document.querySelector('a[href*="reports/download"]')).toBeNull();
  });

  it('filters by retention and says what is hidden', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    fireEvent.change(screen.getByLabelText('Filter by retention'), { target: { value: 'year' } });
    expect(screen.getAllByTestId('report-row')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/search title/i), { target: { value: 'zzz' } });
    expect(screen.getByTestId('reports-nomatch')).toBeInTheDocument();
  });

  /*
    SHARE. The owner, 2026-09-23: "the record of the report is filed under
    reports menu on host screen but no way to get the link and passkey back."
    get-reports.js now returns the passkey (kept encrypted on the row since
    that day); the list shows it with the page link, inline under the row.
  */
  it('Share opens the link and passkey under the row, and closes again', async () => {
    const withKey = [{ ...reports[0], passkey: 'K7QM3-XPD9Z' }, reports[1], reports[2]];
    authFetch.mockImplementation(() => respond({ reports: withKey }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    const share = screen.getByRole('button', { name: /share nakamura/i });
    expect(share).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(share);
    expect(share).toHaveAttribute('aria-expanded', 'true');
    const row = screen.getByTestId('report-share-row');
    expect(row).toBeInTheDocument();
    expect(screen.getByLabelText('Passkey')).toHaveValue('K7QM3-XPD9Z');
    expect(screen.getByLabelText('Link')).toHaveValue(`${window.location.origin}/shared-report?game=4812&key=permanent%2Fx.pdf.enc`);
    expect(row).toHaveTextContent(/needs both/);
    fireEvent.click(share);
    expect(screen.queryByTestId('report-share-row')).toBeNull();
  });

  it('a report saved before passkeys were kept says how to get one, instead of an empty field', async () => {
    authFetch.mockImplementation(() => respond({ reports }));
    render(<ReportsPanel />);
    await waitFor(() => screen.getAllByTestId('report-row'));
    fireEvent.click(screen.getByRole('button', { name: /share sales kickoff/i }));
    expect(screen.getByTestId('report-share-row')).toHaveTextContent(/saved before its passkey was kept/);
    expect(screen.queryByLabelText('Passkey')).toBeNull();
  });

  it('an empty library says what a report is and where it comes from', async () => {
    authFetch.mockImplementation(() => respond({ reports: [] }));
    render(<ReportsPanel />);
    await waitFor(() => expect(screen.getByTestId('reports-empty')).toBeInTheDocument());
  });

  it('formatKeptUntil prints a date, or a dash for nothing', () => {
    expect(formatKeptUntil('2027-08-06T12:00:00Z')).toMatch(/2027/);
    expect(formatKeptUntil('')).toBe('—');
  });
});

describe('the reports stylesheet is the sessions sheet under its own scope', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');
  it('carries the same token block, renamed', () => {
    const sp = read('SessionsPanel.css');
    const rp = read('ReportsPanel.css');
    const spTokens = sp.slice(sp.indexOf('.sp {'), sp.indexOf('}', sp.indexOf('.sp {')));
    const rpTokens = rp.slice(rp.indexOf('.rp {'), rp.indexOf('}', rp.indexOf('.rp {')));
    expect(rpTokens).toBe(spTokens.replace(/\.sp\b/g, '.rp').replace(/--sp-/g, '--rp-'));
    // Every selector is rooted at .rp — nothing leaks onto another screen.
    const selectors = rp.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.rp(\b|-)/)));
  });
  it('the console and the host both mount it', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'AdminPage.jsx'), 'utf8')).toMatch(/resolvedTab === 'reports' && <ReportsPanel/);
    expect(read('HostReportsDialog.jsx')).toMatch(/<ReportsPanel/);
    expect(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')).toMatch(/onReports=/);
  });
});
