/**
 * THE SAVED REPORT'S PDF, SIZED TO WHAT AWS WILL CARRY (28 Sep 2026).
 *
 * The owner: "seeing an error trying to save reports — i have game 1423
 * failing to save report". Reproduced on the local stack with AWS's limit in
 * place: the PDF travels to save-report.js as base64 inside ONE JSON request,
 * and Lambda refuses any invocation over 6 MB (6,291,456 bytes) before the
 * function runs — API Gateway answers 413 and the host saw only "Failed to
 * save report". A short session's report is ~1.7 MB of base64; one about six
 * times as long (22,600 px of report, the length of a many-round session with
 * its summaries) was 8.2 MB. The download of an organisation's report is the
 * same limit the other way: download-report.js decrypts it and returns the
 * whole PDF in its response, so a report that could not come back down would
 * be no better saved.
 *
 * What made the PDFs large: every page is a JPEG of the rendered report, drawn
 * at twice the size and saved at quality 0.98 — effectively lossless, and
 * three to four times the bytes of 0.8, where text on white still reads
 * cleanly. So the first pass is 0.8, and a report still too large is drawn
 * once more, smaller, before the host is told anything.
 *
 * THE OTHER CEILING. html2pdf draws the whole report onto ONE canvas before
 * cutting it into pages, and browsers refuse a canvas past 32,767 px on a
 * side (Chrome's area limit, Safari's and Firefox's dimension limits) — the
 * page then comes out blank. So the scale comes down for a very long report,
 * keeping that canvas under MAX_CANVAS_PX.
 */

/** The largest base64 PDF sent: under the 6 MB invoke limit with room for the rest of the request, and for the download's response. */
export const MAX_REPORT_BASE64 = 5500000;

/** Stay under every browser's 32,767 px canvas side. */
export const MAX_CANVAS_PX = 32000;

/** Tried in order until the PDF fits. */
export const REPORT_PDF_PASSES = Object.freeze([
  Object.freeze({ quality: 0.8, scale: 2 }),
  Object.freeze({ quality: 0.6, scale: 1.5 }),
]);

/** The file name the save uses for its title — the same cleaning save-report.js applies. */
const fileTitle = (title) => String(title || 'Engagements Session').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');

/** A pass's scale, lowered so a report `heightPx` tall still fits one canvas. */
export function canvasScale(heightPx, scale) {
  const h = Number(heightPx) || 0;
  if (h <= 0) return scale;
  return Math.min(scale, Math.floor((MAX_CANVAS_PX / h) * 100) / 100);
}

/** html2pdf's options for one pass over a report `heightPx` tall. */
export function reportPdfOptions({ title, heightPx, pass, today = new Date() }) {
  return {
    margin: [0.5, 0.5, 0.5, 0.5],
    filename: `${fileTitle(title)}-${today.toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: pass.quality },
    html2canvas: {
      scale: canvasScale(heightPx, pass.scale),
      useCORS: true,
      letterRendering: true,
      scrollX: 0,
      scrollY: 0,
    },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    // html2canvas rasterises: it does not read the print stylesheet, so the
    // break rules in GameReport.css cannot reach it. This is the one lever it
    // does understand, and `.report-keep` is the same set of units the print
    // sheet marks `break-inside: avoid`.
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.report-keep'] },
  };
}

const mb = (bytes) => `${(bytes / 1000000).toFixed(1)} MB`;

const PRINT_INSTEAD = 'Use Print and choose "Save as PDF" to keep a copy of it.';

/** What the host is told when even the smallest pass is too large to save. */
export function tooLargeMessage(base64Length) {
  const pdfBytes = Math.round((base64Length * 3) / 4);
  return `This report is too long to save (${mb(pdfBytes)}; a saved report can be up to ${mb((MAX_REPORT_BASE64 * 3) / 4)}). ${PRINT_INSTEAD}`;
}

/**
 * What the host is told when the save was refused — the server's own reason
 * where it gave one, and for the two refusals that never reach the function
 * (the size limit, and a signed-out token), a sentence that says what to do.
 */
export function saveRefusalMessage(status, body) {
  if (status === 413) return `This report is too long to save. ${PRINT_INSTEAD}`;
  if (status === 401) return 'Your sign-in has expired. Sign in again, then save the report.';
  if (status === 404) {
    return 'This session was not found in the space you are working in. Switch to the space the session belongs to, then save again.';
  }
  const said = body && typeof body.error === 'string' && body.error.trim();
  return said ? `The report was not saved: ${said}` : `The report was not saved (error ${status}). Please try again.`;
}

/**
 * Anything else — the PDF could not be drawn (an image the browser will not
 * export), or the request never got an answer (a dropped connection, or an
 * AWS refusal without CORS headers, which the browser reports only as "Failed
 * to fetch"). The reason goes on screen, so the next report of a failed save
 * says what failed.
 */
export function unexpectedSaveMessage(error) {
  const why = error && typeof error.message === 'string' && error.message.trim();
  return `The report was not saved${why ? ` (${why})` : ''}. Please try again; for a long report, use Print and choose "Save as PDF".`;
}
