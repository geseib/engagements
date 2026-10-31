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
 * page then comes out blank. Since the report refresh (2026-10-31) a long
 * report is drawn in PARTS, cut at its sections (utils/saveReport.js), each on
 * its own canvas under MAX_CANVAS_PX at full scale; the scale still comes down
 * for a single section too tall for one canvas.
 */

/**
 * THE PAGE (report refresh, 2026-10-31). Letter, with margins that leave room
 * for the head and foot utils/saveReport.js stamps on each page: 0.75in head
 * and sides, 0.85in foot. html2pdf's order is [top, left, bottom, right].
 * The text block is 7in x 9.4in; GameReport.css's `.report-pdf` cover is
 * that tall, and its print sheet's @page carries the same margins.
 */
export const PDF_PAGE_IN = Object.freeze({ width: 8.5, height: 11 });
export const PDF_MARGIN_IN = Object.freeze([0.75, 0.75, 0.85, 0.75]);
export const PDF_INNER_IN = Object.freeze({
  width: PDF_PAGE_IN.width - PDF_MARGIN_IN[1] - PDF_MARGIN_IN[3],
  height: PDF_PAGE_IN.height - PDF_MARGIN_IN[0] - PDF_MARGIN_IN[2],
});

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
    margin: [...PDF_MARGIN_IN],
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
    // html2canvas rasterises: it does not read the print stylesheet. 'css'
    // reads the COMPUTED break-inside of every element in the clone — which
    // GameReport.css's `.report-pdf` mode sets on every line of text, so the
    // slicer never cuts a glyph in half — and `.report-keep` is the same set
    // of units the print sheet marks `break-inside: avoid`.
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.report-keep'] },
  };
}

/**
 * HOW TALL ONE CANVAS MAY BE, in CSS px of the report, at a pass's scale.
 * html2pdf draws each part of the report on one canvas; a long report is cut
 * into parts at its sections (utils/saveReport.js `partsFor`) so each canvas
 * stays under MAX_CANVAS_PX without shrinking the scale — a shrunk scale is
 * what turned a long report's text soft. The margin is for the spacers
 * html2pdf adds to push a unit onto the next page.
 */
export function partHeightPx(scale) {
  return Math.floor((MAX_CANVAS_PX / scale) * 0.85);
}

/*
 * THE RUNNING HEAD AND FOOT, stamped with jsPDF on every page after the
 * cover. html2pdf has no header option and html2canvas cannot read @page, so
 * they are drawn onto the finished pages: `Engage · Session report` and the
 * session's title at the head, the session and its date and `Page n of N` at
 * the foot. Helvetica, jsPDF's built-in face — zero bytes, where embedding
 * Inter would cost ~320 KB of the 5.5 MB budget per weight.
 */
const INK = [27, 41, 66];      // paper --text #1B2942
const MUTED = [94, 97, 103];   // paper --muted #5E6167
const RULE = [201, 205, 212];  // #C9CDD4
const AMBER = [246, 169, 76];  // #F6A94C, the mark only

/**
 * Text Helvetica can draw. jsPDF's built-in faces are WinAnsi: Latin-1 plus
 * the typographic quotes, dashes and ellipsis (an em dash verified in a
 * rendered PDF). A character outside that set is dropped rather than printed
 * as a wrong glyph, so a title in another script still gets its page numbers.
 */
export function pdfText(text) {
  return String(text || '')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .replace(/\u2212/g, '-')
    .replace(/[^\x20-\x7E\u00A1-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `text` cut with an ellipsis so it is no wider than `maxIn` at the current font. */
function fitText(pdf, text, maxIn) {
  if (pdf.getTextWidth(text) <= maxIn) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > maxIn) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * Stamp the head and foot on every page of `pdf` (a jsPDF document in inches).
 * `running`: { kind, title, footLeft, cover } — `cover: true` leaves page 1
 * bare, and still counts it, so the second sheet reads "Page 2 of N".
 * Returns the pages it stamped, for the tests.
 */
export function stampRunningHeads(pdf, running = {}) {
  const total = pdf.internal.getNumberOfPages();
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const left = PDF_MARGIN_IN[1];
  const right = W - PDF_MARGIN_IN[3];
  const kind = pdfText(running.kind || 'Report').toUpperCase();
  const title = pdfText(running.title || '');
  const footLeft = pdfText(running.footLeft || '');
  const headY = 0.45;
  const footY = H - 0.42;
  const stamped = [];

  for (let page = 1; page <= total; page += 1) {
    if (!(running.cover && page === 1)) {
      pdf.setPage(page);

      // The mark: BrandMark's mountain, as a filled path 0.13in wide.
      const s = 0.13 / 28;
      pdf.setFillColor(...AMBER);
      pdf.lines([[9 * s, -14 * s], [5 * s, 7 * s], [6 * s, -14 * s], [8 * s, 21 * s]], left, headY + 0.005, [1, 1], 'F', true);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(...INK);
      const brand = `ENGAGE \u00B7 ${kind}`;
      pdf.text(brand, left + 0.19, headY, { charSpace: 0.012 });
      if (title) {
        const room = right - (left + 0.19 + pdf.getTextWidth(brand) + 0.3);
        pdf.setFontSize(7.5);
        pdf.text(fitText(pdf, title, Math.max(room, 1)), right, headY, { align: 'right' });
      }
      pdf.setDrawColor(...RULE);
      pdf.setLineWidth(0.5 / 72);
      pdf.line(left, headY + 0.09, right, headY + 0.09);

      pdf.line(left, footY - 0.15, right, footY - 0.15);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(...MUTED);
      if (footLeft) pdf.text(footLeft, left, footY);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...INK);
      pdf.text(`Page ${page} of ${total}`, right, footY, { align: 'right' });
      stamped.push(page);
    }
  }
  return stamped;
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
