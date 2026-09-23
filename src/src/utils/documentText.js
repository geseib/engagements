/**
 * ONE DOCUMENT PIPELINE: a host's file → text.
 *
 * Lifted out of FileUploadPrompt (the AI builders' upload) so the create
 * dialog's briefing (docs/design/session-setup-redesign, PLAN Phase 3) reads a
 * file the same way: .txt and .md in the browser, PDF and Word through
 * POST /admin/parse-document. One pipeline, not two.
 *
 * Every failure the briefing names (RATIONALE §c "Limits and failure states")
 * is a DocumentProblem with a `code` the caller draws — a fact about the file
 * (too-large, slides, unsupported, password) or something that broke (failed).
 * Nothing here decides how it looks.
 *
 * Also here: the briefing's own request, POST /games/briefing/draft.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

/** The briefing's limit: base64 grows a file ~37%, and a synchronous Lambda
    request caps at 6 MB, so ~4.3 MB is the real ceiling (RATIONALE §c). */
export const BRIEFING_MAX_BYTES = 4 * 1024 * 1024;
/** parse-document keeps this much text; a text file read here is cut the same. */
export const TEXT_CAP = 50000;
/** Under this many characters, a PDF is scanned pages, not a document. */
export const NO_TEXT_BELOW = 200;

const SLIDES = ['pptx', 'ppt', 'key', 'odp'];
const IN_BROWSER = ['txt', 'md'];
const ON_SERVER = ['pdf', 'docx'];

export class DocumentProblem extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentProblem';
    this.code = code;
  }
}

const extensionOf = (name) => String(name || '').split('.').pop().toLowerCase();
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const readAs = (file, how) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = () => reject(reader.error || new Error('The file could not be read'));
  reader[how](file);
});

/**
 * Read a file's text.
 *
 * @returns {Promise<{ text, name, pages: number|null, truncated: boolean, chars: number }>}
 * @throws {DocumentProblem}
 */
export async function readDocumentText(file, { maxBytes = 5 * 1024 * 1024, fetchImpl = authFetch } = {}) {
  const name = (file && file.name) || '';
  const ext = extensionOf(name);

  if (SLIDES.includes(ext)) {
    throw new DocumentProblem('slides',
      'Slides can’t be read directly. Save them as a PDF first — PowerPoint: File › Save As › PDF. '
      + 'Keynote: File › Export To › PDF. Google Slides: File › Download › PDF Document.');
  }
  if (!IN_BROWSER.includes(ext) && !ON_SERVER.includes(ext)) {
    throw new DocumentProblem('unsupported', 'Choose a PDF, Word (.docx) or text file.');
  }
  if (file.size > maxBytes) {
    throw new DocumentProblem('too-large',
      `That file is ${mb(file.size)}. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  if (IN_BROWSER.includes(ext)) {
    const raw = String(await readAs(file, 'readAsText'));
    const truncated = raw.length > TEXT_CAP;
    const text = truncated ? raw.slice(0, TEXT_CAP) : raw;
    return { text, name, pages: null, truncated, chars: text.length };
  }

  let response;
  let result = {};
  try {
    const dataUrl = String(await readAs(file, 'readAsDataURL'));
    response = await fetchImpl(adminApiUrl('admin/parse-document'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileContent: dataUrl.split(',')[1] || '', fileType: ext, fileName: name }),
    });
    result = await response.json().catch(() => ({}));
  } catch (e) {
    throw new DocumentProblem('failed', 'The file could not be sent to be read. Check the connection and try again.');
  }

  if (!response.ok || result.success === false) {
    const reason = String(result.error || `HTTP ${response.status}`);
    if (/password/i.test(reason)) {
      throw new DocumentProblem('password', 'This PDF is protected with a password. Nothing was read.');
    }
    throw new DocumentProblem('failed', `The document could not be read: ${reason}`);
  }

  const text = String(result.text || '');
  return {
    text,
    name,
    pages: Number.isInteger(result.pages) ? result.pages : null,
    truncated: result.truncated === true,
    chars: text.length,
  };
}

/**
 * Ask Workie for a briefing from a document's text. The file NAME is not sent
 * — it can say more than the contents, and the summariser does not need it.
 *
 * @returns {Promise<{ briefing: string, namesRemoved: number }>}
 * @throws {DocumentProblem} code 'failed', carrying the server's sentence
 */
export async function draftBriefing({ text, pages = null, truncated = false }, { fetchImpl = authFetch } = {}) {
  let response;
  let result = {};
  try {
    response = await fetchImpl(adminApiUrl('games/briefing/draft'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pages, truncated }),
    });
    result = await response.json().catch(() => ({}));
  } catch (e) {
    throw new DocumentProblem('failed', 'Workie couldn’t be reached to write the briefing. Try again.');
  }
  if (!response.ok || typeof result.briefing !== 'string') {
    throw new DocumentProblem('failed',
      result.error || 'The document was read, but Workie couldn’t write the briefing.');
  }
  return { briefing: result.briefing, namesRemoved: Number(result.namesRemoved) || 0 };
}
