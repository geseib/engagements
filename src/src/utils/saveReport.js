/**
 * SAVE A REPORT — draw the document as a PDF and keep it through
 * POST /games/{id}/save-report (lambda-functions/game/save-report.js).
 *
 * One function for every report that is kept (2026-10-04). The session report
 * (components/GameReport.jsx) had it inline; a Build Room's report
 * (buildroom/BuildReport.jsx) could only be printed, so it lived exactly as
 * long as the room's rows — 7 days from start — and never reached Reports.
 * The owner asked for Build Rooms to have the lifecycle every engagement has,
 * so both save the same way: Keep for 90 days or Keep for 1 year, one report
 * per session, a link and a passkey, listed in Reports.
 *
 * SIZED TO WHAT AWS CARRIES (config/reportPdf.js): the PDF rides in one request
 * that Lambda refuses past 6 MB. Drawn at quality 0.8, and once more smaller if
 * it is still too large; past that it throws with `hostMessage` saying to print
 * instead. A refusal from the server throws with the server's own reason in
 * `hostMessage` (saveRefusalMessage). Resolves with save-report's answer
 * (fileName, passkey, shareUntil, …), which ReportSavedDialog shows.
 */
import html2pdf from 'html2pdf.js';
import { authFetch } from '../auth/authFetch';
import {
  MAX_REPORT_BASE64, REPORT_PDF_PASSES, reportPdfOptions, saveRefusalMessage, tooLargeMessage,
} from '../config/reportPdf';

export async function saveReportPdf({
  element, gameId, title, permanent = false, apiBase = '', fetchFn = authFetch,
}) {
  const heightPx = element ? element.scrollHeight : 0;
  let base64Data = '';
  for (const pass of REPORT_PDF_PASSES) {
    // eslint-disable-next-line no-await-in-loop
    const pdfDataUrl = await html2pdf()
      .set(reportPdfOptions({ title, heightPx, pass }))
      .from(element)
      .outputPdf('dataurlstring');
    base64Data = String(pdfDataUrl).split(',')[1] || '';
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
