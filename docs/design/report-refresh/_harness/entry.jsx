import React from 'react';
import { createRoot } from 'react-dom/client';
import html2pdf from 'html2pdf.js';
import '/home/user/engagements/src/src/styles/skins/classic.css';
import '/home/user/engagements/src/src/styles/skins/present.css';
import '/home/user/engagements/src/src/styles/roles.css';
import '/home/user/engagements/src/src/styles.css';
import { ReportDocument } from '/home/user/engagements/src/src/components/GameReport.jsx';
import { reportPdfOptions, REPORT_PDF_PASSES } from '/home/user/engagements/src/src/config/reportPdf.js';
import { reportData } from './fixture.js';

createRoot(document.getElementById('root')).render(
  <div className="report-container report-paper" data-theme="light">
    <ReportDocument reportData={reportData} />
  </div>,
);
// Exactly utils/saveReport.js's first pass.
window.makePdf = async () => {
  const element = document.querySelector('.report-doc');
  const opts = reportPdfOptions({ title: reportData.eventTitle, heightPx: element.scrollHeight, pass: REPORT_PDF_PASSES[0], today: new Date('2026-10-28') });
  return html2pdf().set(opts).from(element).outputPdf('dataurlstring');
};
