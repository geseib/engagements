/**
 * SAVE A REPORT — draw the document as a PDF and keep it through
 * POST /games/{id}/save-report (lambda-functions/game/save-report.js).
 *
 * One function for every report that is kept (2026-10-04): the session report
 * (components/GameReport.jsx) and a Build Room's (buildroom/BuildReport.jsx).
 * Keep for 90 days or Keep for 1 year, one report per session, a link and a
 * passkey, listed in Reports.
 *
 * SIZED TO WHAT AWS CARRIES (config/reportPdf.js): the PDF rides in one request
 * that Lambda refuses past 6 MB. Drawn at quality 0.8, and once more smaller if
 * it is still too large; past that it throws with `hostMessage` saying to print
 * instead. A refusal from the server throws with the server's own reason in
 * `hostMessage` (saveRefusalMessage). Resolves with save-report's answer
 * (fileName, passkey, shareUntil, …), which ReportSavedDialog shows.
 *
 * WHAT IS DRAWN (report refresh, 2026-10-31). html2pdf clones the element it
 * is given into an overlay on <body>, outside every ancestor — which is how
 * the session report's own stylesheet came to miss the saved PDF entirely
 * (GameReport.css's header has the story). So this hands html2pdf clones it
 * made itself, each one:
 *   - a shallow copy of the element (its classes, its data-theme), so the
 *     document's scope travels with it, plus `report-pdf`, the stylesheet's
 *     PDF mode (print sizes in pt; html2canvas never sees @media print);
 *   - one PART of the report: the cover (`data-pdf-part`) on a page of its
 *     own, then the `data-pdf-block` sections, packed so no part's canvas
 *     passes MAX_CANVAS_PX. Each part starts a new page.
 * Then jsPDF stamps the running head and foot on every page after the cover
 * (stampRunningHeads), and only then is the file written out.
 */
import html2pdf from 'html2pdf.js';
import { authFetch } from '../auth/authFetch';
import {
  MAX_REPORT_BASE64, PDF_INNER_IN, REPORT_PDF_PASSES, partHeightPx, reportPdfOptions,
  saveRefusalMessage, stampRunningHeads, tooLargeMessage,
} from '../config/reportPdf';

/** The class GameReport.css keys its PDF mode on. */
export const PDF_MODE_CLASS = 'report-pdf';

/** A shallow copy of `element` in PDF mode, holding deep copies of `children`. */
function shellWith(element, children) {
  const shell = element.cloneNode(false);
  shell.classList.add(PDF_MODE_CLASS);
  shell.removeAttribute('id');
  children.forEach((child) => shell.appendChild(child.cloneNode(true)));
  return shell;
}

/**
 * Each block's height, laid out exactly as the PDF will lay it out: a clone in
 * PDF mode, 7in wide, off screen. Zeros where there is no layout (jsdom),
 * which packs everything into one part — the right answer for a short report.
 */
function measureBlocks(element, blocks) {
  if (typeof document === 'undefined' || !document.body) return blocks.map(() => 0);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'absolute', left: '-100000px', top: '0', width: `${PDF_INNER_IN.width}in`, visibility: 'hidden',
  });
  const probe = shellWith(element, blocks);
  host.appendChild(probe);
  document.body.appendChild(host);
  try {
    const kids = Array.from(probe.children);
    return kids.map((kid, i) => {
      const top = kid.getBoundingClientRect().top;
      const next = kids[i + 1];
      const bottom = next ? next.getBoundingClientRect().top : probe.getBoundingClientRect().bottom;
      return Math.max(0, bottom - top);
    });
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * The parts html2pdf draws, each a detached element in PDF mode, with the
 * tallest one's height for the canvas scale. An element with no
 * `data-pdf-part`/`data-pdf-block` children (a Build Room report) is one part.
 */
export function partsFor(element, { maxPartPx }) {
  const children = Array.from(element.children);
  const cover = children.filter((c) => c.hasAttribute('data-pdf-part'));
  const blocks = children.filter((c) => c.hasAttribute('data-pdf-block'));
  if (cover.length === 0 && blocks.length === 0) {
    return { parts: [shellWith(element, children)], tallestPx: element.scrollHeight || 0 };
  }
  // Anything unmarked rides with the block before it, so nothing is dropped.
  const groups = [];
  children.forEach((c) => {
    if (cover.includes(c)) return;
    if (c.hasAttribute('data-pdf-block') || groups.length === 0) groups.push([c]);
    else groups[groups.length - 1].push(c);
  });
  const heights = measureBlocks(element, groups.map((g) => g[0]));
  const packed = [];
  let run = [];
  let runPx = 0;
  let tallestPx = 0;
  groups.forEach((group, i) => {
    const h = heights[i] || 0;
    if (run.length && runPx + h > maxPartPx) {
      packed.push(run);
      tallestPx = Math.max(tallestPx, runPx);
      run = [];
      runPx = 0;
    }
    run.push(...group);
    runPx += h;
  });
  if (run.length) { packed.push(run); tallestPx = Math.max(tallestPx, runPx); }
  return {
    parts: [...cover.map((c) => shellWith(element, [c])), ...packed.map((p) => shellWith(element, p))],
    tallestPx,
  };
}

/** One pass: every part on its own canvas, the head and foot stamped, the file as base64. */
export async function drawReportPdf({ element, title, pass, running }) {
  const { parts, tallestPx } = partsFor(element, { maxPartPx: partHeightPx(pass.scale) });
  let worker = html2pdf().set(reportPdfOptions({ title, heightPx: tallestPx, pass }));
  parts.forEach((part, i) => {
    if (i > 0) worker = worker.get('pdf').then((pdf) => { pdf.addPage(); });
    worker = worker.from(part).toContainer().toCanvas().toPdf();
  });
  worker = worker.get('pdf').then((pdf) => { stampRunningHeads(pdf, running || { title }); });
  const dataUrl = await worker.outputPdf('dataurlstring');
  return String(dataUrl).split(',')[1] || '';
}

export async function saveReportPdf({
  element, gameId, title, permanent = false, apiBase = '', fetchFn = authFetch, running = null,
}) {
  let base64Data = '';
  for (const pass of REPORT_PDF_PASSES) {
    // eslint-disable-next-line no-await-in-loop
    base64Data = await drawReportPdf({ element, title, pass, running });
    if (base64Data.length <= MAX_REPORT_BASE64) break;
  }
  if (base64Data.length > MAX_REPORT_BASE64) {
    throw Object.assign(new Error('report too large'), { hostMessage: tooLargeMessage(base64Data.length) });
  }

  // authFetch, not fetch: the route carries the Cognito authorizer.
  const response = await fetchFn(`${apiBase}games/${gameId}/save-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId, eventTitle: title, pdfBlob: base64Data, permanent,
    }),
  });
  if (!response.ok) {
    const refusal = await response.json().catch(() => ({}));
    throw Object.assign(new Error(`save-report ${response.status}`), {
      hostMessage: saveRefusalMessage(response.status, refusal),
    });
  }
  return response.json();
}

export default saveReportPdf;
