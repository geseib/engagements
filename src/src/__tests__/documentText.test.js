/**
 * ONE DOCUMENT PIPELINE — utils/documentText.js.
 *
 * The AI builders' FileUploadPrompt and the create dialog's briefing both turn
 * a host's file into text: .txt/.md read in the browser, PDF and Word through
 * POST /admin/parse-document. That code lived inside FileUploadPrompt; the
 * briefing (session-setup-redesign Phase 3) needs it too, so it is one helper
 * both call, and each failure the briefing names (RATIONALE §c "Limits and
 * failure states") is a code the caller can draw — not a string to parse.
 *
 * Also here: the briefing's own call, POST /games/briefing/draft.
 */
import {
  readDocumentText, draftBriefing, DocumentProblem, BRIEFING_MAX_BYTES,
} from '../utils/documentText';

const file = (name, content = 'hello', type = '') => new File([content], name, { type });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status, body) => ({ ok: false, status, json: async () => body });

beforeEach(() => { window.API_BASE = 'https://api.test/dev/'; });

describe('reading a file into text', () => {
  test('a .txt file is read in the browser, with no request', async () => {
    const fetchImpl = jest.fn();
    const r = await readDocumentText(file('notes.txt', 'Open issues up 15%.'), { fetchImpl });
    expect(r).toEqual({ text: 'Open issues up 15%.', name: 'notes.txt', pages: null, truncated: false, chars: 19 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a PDF goes to parse-document as base64, and its pages and truncation come back', async () => {
    const fetchImpl = jest.fn(async () => ok({ success: true, text: 'Q3 review text', pages: 14, truncated: false }));
    const r = await readDocumentText(file('q3.pdf', '%PDF-1.4'), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/dev/admin/parse-document');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body);
    expect(sent.fileType).toBe('pdf');
    expect(atob(sent.fileContent)).toBe('%PDF-1.4');
    expect(r).toEqual({ text: 'Q3 review text', name: 'q3.pdf', pages: 14, truncated: false, chars: 14 });
  });

  test('a Word file takes the same road', async () => {
    const fetchImpl = jest.fn(async () => ok({ success: true, text: 'Agenda' }));
    const r = await readDocumentText(file('plan.docx'), { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).fileType).toBe('docx');
    expect(r.pages).toBeNull();
    expect(r.truncated).toBe(false);
  });

  test('a long text file is cut at 50,000 characters and says so, like the server', async () => {
    const r = await readDocumentText(file('long.txt', 'x'.repeat(60000)), { fetchImpl: jest.fn() });
    expect(r.text.length).toBe(50000);
    expect(r.truncated).toBe(true);
  });
});

describe('what cannot be read is named, with a code the dialog can draw', () => {
  const problem = async (promise) => {
    try { await promise; } catch (e) { return e; }
    throw new Error('it did not throw');
  };

  test('over the limit: refused in the browser, before any upload, with both sizes', async () => {
    const fetchImpl = jest.fn();
    const big = file('big.pdf', new Uint8Array(BRIEFING_MAX_BYTES + 1));
    const e = await problem(readDocumentText(big, { fetchImpl, maxBytes: BRIEFING_MAX_BYTES }));
    expect(e).toBeInstanceOf(DocumentProblem);
    expect(e.code).toBe('too-large');
    expect(e.message).toMatch(/4\.0 MB\. The limit is 4 MB/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each(['deck.pptx', 'deck.ppt', 'talk.key', 'slides.odp'])('slides (%s): save them as a PDF first', async (name) => {
    const e = await problem(readDocumentText(file(name), { fetchImpl: jest.fn() }));
    expect(e.code).toBe('slides');
    expect(e.message).toMatch(/Save them as a PDF first/);
    expect(e.message).toMatch(/PowerPoint/);
    expect(e.message).toMatch(/Keynote/);
    expect(e.message).toMatch(/Google Slides/);
  });

  test('anything else unreadable says what is', async () => {
    const e = await problem(readDocumentText(file('photo.png'), { fetchImpl: jest.fn() }));
    expect(e.code).toBe('unsupported');
    expect(e.message).toMatch(/PDF, Word/);
  });

  test('a password-protected PDF: nothing was read', async () => {
    const fetchImpl = jest.fn(async () => bad(500, { success: false, error: 'Failed to parse PDF: No password given' }));
    const e = await problem(readDocumentText(file('locked.pdf'), { fetchImpl }));
    expect(e.code).toBe('password');
    expect(e.message).toBe('This PDF is protected with a password. Nothing was read.');
  });

  test('any other parse failure keeps the server\'s reason', async () => {
    const fetchImpl = jest.fn(async () => bad(500, { success: false, error: 'Failed to parse PDF: bad xref' }));
    const e = await problem(readDocumentText(file('broken.pdf'), { fetchImpl }));
    expect(e.code).toBe('failed');
    expect(e.message).toMatch(/bad xref/);
  });

  test('a request that never arrives is a failure too, not a crash', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    const e = await problem(readDocumentText(file('q3.pdf'), { fetchImpl }));
    expect(e.code).toBe('failed');
  });
});

describe('asking Workie for the briefing', () => {
  test('posts the text and its facts to /games/briefing/draft, never the file name', async () => {
    const fetchImpl = jest.fn(async () => ok({ briefing: 'Q3 review.\n- Up 15%.', namesRemoved: 2 }));
    const r = await draftBriefing({ text: 'doc text', pages: 14, truncated: false }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/dev/games/briefing/draft');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'doc text', pages: 14, truncated: false });
    expect(r).toEqual({ briefing: 'Q3 review.\n- Up 15%.', namesRemoved: 2 });
  });

  test('a refused draft carries the server\'s words for the red state', async () => {
    const fetchImpl = jest.fn(async () => bad(502, { error: "The document was read, but Workie couldn't write the briefing." }));
    await expect(draftBriefing({ text: 'x' }, { fetchImpl })).rejects.toMatchObject({
      code: 'failed', message: expect.stringMatching(/couldn't write the briefing/),
    });
  });
});
