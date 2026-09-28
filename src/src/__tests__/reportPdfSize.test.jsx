/**
 * A SAVED REPORT'S PDF FITS WHAT AWS WILL CARRY — config/reportPdf.js and the
 * save in components/GameReport.jsx.
 *
 * The owner, 28 Sep 2026: "seeing an error trying to save reports — i have
 * game 1423 failing to save report". Reproduced on the local stack with
 * Lambda's 6 MB invoke limit in place: a report ~22,600 px long was 8.2 MB of
 * base64 in one request, refused with 413 before save-report.js ran, and the
 * host saw only "Failed to save report. Please try again." (see the commit).
 *
 * rejects: a JPEG quality of 0.98 (the three-to-four-times-larger setting that
 * made a long report too large); a canvas drawn taller than a browser allows,
 * which comes out blank; sending a PDF past the limit rather than drawing it
 * smaller; giving up without the smaller pass; a refusal shown as "Failed to
 * save report" when the reason is known — too long, signed out, the wrong
 * space, or the server's own sentence.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  MAX_REPORT_BASE64, MAX_CANVAS_PX, REPORT_PDF_PASSES, canvasScale, reportPdfOptions,
  saveRefusalMessage, tooLargeMessage, unexpectedSaveMessage,
} from '../config/reportPdf';

const mockPasses = [];
let mockSizes = [];
jest.mock('html2pdf.js', () => () => ({
  set: (opt) => {
    mockPasses.push(opt);
    return {
      from: () => ({
        outputPdf: async () => `data:application/pdf;base64,${'A'.repeat(mockSizes[mockPasses.length - 1] ?? 16)}`,
      }),
    };
  },
}));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');
import GameReport from '../components/GameReport';

describe('the PDF\'s settings', () => {
  test('the first pass is JPEG 0.8 at twice the size; the second smaller still', () => {
    expect(REPORT_PDF_PASSES.map((p) => [p.quality, p.scale])).toEqual([[0.8, 2], [0.6, 1.5]]);
    const opt = reportPdfOptions({ title: 'Q3 Offsite!', heightPx: 3874, pass: REPORT_PDF_PASSES[0], today: new Date('2026-09-28T10:00:00Z') });
    expect(opt.image).toEqual({ type: 'jpeg', quality: 0.8 });
    expect(opt.html2canvas.scale).toBe(2);
    expect(opt.filename).toBe('Q3-Offsite-2026-09-28.pdf');
    // Unchanged from before: letter, portrait, the report's own keep-together units.
    expect(opt.jsPDF).toEqual({ unit: 'in', format: 'letter', orientation: 'portrait' });
    expect(opt.pagebreak).toEqual({ mode: ['css', 'legacy'], avoid: ['.report-keep'] });
  });

  test.each([3874, 15135, 22642, 45000, 90000])('a %ipx report is drawn on a canvas no browser refuses', (h) => {
    for (const pass of REPORT_PDF_PASSES) {
      const scale = canvasScale(h, pass.scale);
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThanOrEqual(pass.scale);
      expect(h * scale).toBeLessThanOrEqual(MAX_CANVAS_PX);
    }
    expect(MAX_CANVAS_PX).toBeLessThan(32767);
  });

  test('a short report keeps the full scale; an unmeasured one (0 px) too', () => {
    expect(canvasScale(3874, 2)).toBe(2);
    expect(canvasScale(0, 2)).toBe(2);
    expect(canvasScale(22642, 2)).toBe(1.41);
  });

  test('the ceiling leaves room under Lambda\'s 6 MB for the rest of the request and for the download', () => {
    expect(MAX_REPORT_BASE64).toBeLessThan(6291456 - 500000);
  });
});

describe('what the host is told', () => {
  test('too long: the size, the limit, and what to do instead', () => {
    const text = tooLargeMessage(8230615);
    expect(text).toMatch(/too long to save \(6\.2 MB; a saved report can be up to 4\.1 MB\)/);
    expect(text).toMatch(/Print and choose "Save as PDF"/);
  });

  test.each([
    [413, {}, /too long to save\. Use Print/],
    [401, {}, /sign-in has expired/],
    [404, { error: 'Game not found' }, /not found in the space you are working in\. Switch to the space/],
    [500, { error: 'Failed to save report: AccessDenied' }, /^The report was not saved: Failed to save report: AccessDenied$/],
    [502, {}, /^The report was not saved \(error 502\)\. Please try again\.$/],
  ])('%i', (status, body, re) => {
    expect(saveRefusalMessage(status, body)).toMatch(re);
  });
});

describe('the save', () => {
  const reportData = { gameId: '1423', eventTitle: 'Leadership offsite', gameType: 'call-and-answer', players: [], questions: [] };
  let alerts;
  beforeEach(() => {
    mockPasses.length = 0;
    mockSizes = [];
    alerts = [];
    jest.spyOn(window, 'alert').mockImplementation((m) => alerts.push(m));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    authFetch.mockReset();
    authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ fileName: 'x.pdf.enc', passkey: 'M4NP2-QRS7T', downloadUrlIsRelative: true }) });
  });
  afterEach(() => jest.restoreAllMocks());

  const save = () => {
    render(<GameReport reportData={reportData} status="ready" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /save report/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  };

  test('a report that fits goes up after one pass, at 0.8', async () => {
    mockSizes = [1000];
    save();
    expect(await screen.findByRole('dialog', { name: 'Report saved' })).toBeInTheDocument();
    expect(mockPasses).toHaveLength(1);
    expect(mockPasses[0].image.quality).toBe(0.8);
    const body = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(body.pdfBlob).toHaveLength(1000);
    expect(body).toMatchObject({ gameId: '1423', eventTitle: 'Leadership offsite', permanent: false });
  });

  test('a report too large at 0.8 is drawn again, smaller, and the smaller one is sent', async () => {
    mockSizes = [MAX_REPORT_BASE64 + 1, 3000000];
    save();
    expect(await screen.findByRole('dialog', { name: 'Report saved' })).toBeInTheDocument();
    expect(mockPasses.map((p) => p.image.quality)).toEqual([0.8, 0.6]);
    expect(JSON.parse(authFetch.mock.calls[0][1].body).pdfBlob).toHaveLength(3000000);
  });

  test('too large even then: nothing is sent, and the host is told to print it instead', async () => {
    mockSizes = [MAX_REPORT_BASE64 + 1, MAX_REPORT_BASE64 + 1];
    save();
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(authFetch).not.toHaveBeenCalled();
    expect(alerts[0]).toMatch(/too long to save .*Print and choose "Save as PDF"/);
  });

  test('a refusal says why, in the server\'s words where it gave some', async () => {
    mockSizes = [1000];
    authFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Game not found' }) });
    save();
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(alerts[0]).toMatch(/not found in the space you are working in/);
    expect(alerts[0]).not.toBe('Failed to save report. Please try again.');
  });

  test('no answer at all (a dropped connection, or a refusal the browser hides): the reason is on screen', async () => {
    mockSizes = [1000];
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    save();
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(alerts[0]).toBe(unexpectedSaveMessage(new TypeError('Failed to fetch')));
    expect(alerts[0]).toMatch(/^The report was not saved \(Failed to fetch\)\. Please try again; for a long report, use Print/);
  });

  test('a 413 that never reached the function (no JSON body) still says what happened', async () => {
    mockSizes = [1000];
    authFetch.mockResolvedValue({ ok: false, status: 413, json: async () => { throw new Error('not json'); } });
    save();
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(alerts[0]).toMatch(/too long to save/);
  });
});
