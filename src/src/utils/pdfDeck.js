/**
 * A PRESENTATION'S SLIDES IN THE BROWSER — pdf.js, loaded only when a PDF is
 * actually opened: the item dialog counting a chosen file's pages, the event's
 * stage drawing a slide, a phone that asked to see the slides. Nothing else in
 * the app pays for it; `import()` puts it in a chunk of its own.
 *
 * THE BUILD: `pdfjs-dist`'s LEGACY build, so an older iPad or a venue's
 * locked-down laptop still opens a deck (the modern build needs features
 * Safari only shipped in 17.4). Its worker is not bundled into the app:
 * webpack.config.js copies `legacy/build/pdf.worker.min.mjs` into dist/ as
 * `pdf.worker.<version>.min.js` — a `.js` name, so the S3 sync serves it as
 * JavaScript, which a module worker insists on, and a versioned one, so a new
 * pdf.js never meets an old worker — and hands its path in as
 * `process.env.PDF_WORKER_SRC`. Same origin, no CDN.
 *
 * `isEvalSupported: false`: pdf.js never compiles a font's code with `eval`.
 * The PDF is somebody's upload; that path is where CVE-2024-4367 lived.
 *
 * Every export is async and mockable: jsdom has no canvas and no worker, so
 * the suites mock this module (jest.mock('../utils/pdfDeck')) and what they
 * pin is what the screens do with it.
 */
// `process.env` is replaced whole by webpack's DefinePlugin (never guard it
// with `typeof process`: there is no `process` in the browser, so the guard
// would always pick the fallback).
const WORKER_SRC = process.env.PDF_WORKER_SRC || '/pdf.worker.min.js';

let loading = null;

/**
 * pdf.js itself, loaded once. A failed load (a chunk gone after a deploy) may
 * be tried again. `pdf.mjs`, not `pdf.min.mjs`: the minified file has lost
 * the `webpackIgnore` hint on pdf.js's own dynamic import, and webpack warns
 * about it on every build; the production build minifies this one anyway.
 */
function loadPdfJs() {
  if (!loading) {
    loading = import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return pdfjs;
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** A PDF opened from its bytes: pdf.js's document (numPages, getPage, destroy). */
export async function openPdf(bytes) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
}

/**
 * How many pages a chosen file has, read here in the browser before it is
 * uploaded. Throws when the file is not a PDF pdf.js can open — which is the
 * dialog's cue to say so before a byte moves.
 */
export async function countPages(file) {
  const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    return doc.numPages;
  } finally {
    doc.destroy();
  }
}

/**
 * The PDF behind a signed read URL, fetched whole and opened. Whole, not in
 * ranges: the media bucket exposes no range headers to the page, and a slide
 * that waits on a range request mid-talk is worse than a longer first load.
 */
export async function openPdfAt(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The slides could not be fetched (HTTP ${res.status}).`);
  return openPdf(new Uint8Array(await res.arrayBuffer()));
}

/**
 * Draw one page into `canvas`, as large as a `width` × `height` box (CSS
 * pixels) allows while keeping the page's shape — letterboxed, never cropped,
 * never stretched. Drawn off-screen first and copied in, so turning a page
 * never flashes an empty canvas. Sharp on a high-density screen, up to 2×.
 * `signal` cancels a draw the page has moved on from.
 */
export async function drawPage(doc, pageNumber, canvas, { width, height }, { signal } = {}) {
  const page = await doc.getPage(pageNumber);
  if (signal && signal.aborted) return false;
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(width / base.width, height / base.height);
  const ratio = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  const viewport = page.getViewport({ scale: fit * ratio });
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.floor(viewport.width));
  off.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvasContext: off.getContext('2d'), viewport });
  const cancel = () => task.cancel();
  if (signal) signal.addEventListener('abort', cancel);
  try {
    await task.promise;
  } finally {
    if (signal) signal.removeEventListener('abort', cancel);
  }
  if (signal && signal.aborted) return false;
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.style.width = `${Math.floor(base.width * fit)}px`;
  canvas.style.height = `${Math.floor(base.height * fit)}px`;
  canvas.getContext('2d').drawImage(off, 0, 0);
  return true;
}

/** A draw that was cancelled because the page moved on — not a failure to report. */
export const isCancelled = (error) => Boolean(error && error.name === 'RenderingCancelledException');
