/**
 * THE IMAGES PANEL, DRIVEN — components/SetMediaPanel.jsx
 *
 * Four claims about behaviour, so they are RENDERED rather than read out of
 * the source:
 *
 *   1. NO HOOPS. Choosing a folder is the last decision — the presign call and
 *      every PUT follow from the one change event, with no second button.
 *   2. THE PUT CARRIES NO Authorization HEADER. A presigned URL signs its
 *      credentials into the query string; an Authorization header makes S3
 *      switch to header-based SigV4 and refuse the upload. This is the failure
 *      that would look like "S3 is broken" and be neither obvious nor logged.
 *   3. A FOLDER IS NOT A CURATED LIST. A picker hands over .DS_Store and the
 *      CSV too; those are skipped as a group, while an image that fails a rule
 *      is named.
 *   4. REMOTE URLS ARE NEVER REPORTED MISSING. The Art set is entirely
 *      https:// values and it works; a verification that condemned it would be
 *      worse than no verification.
 *
 * Only `../auth/authFetch` and `global.fetch` are mocked — the panel uses no
 * context, following the recipe generationJobResume.test.jsx established.
 *
 * NO GEOMETRY IS ASSERTED ANYWHERE IN THIS FILE. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const SetMediaPanel = require('../components/SetMediaPanel').default;

const SET_ID = 'set-42';

/** A jsdom File that can pretend to be any size and to live in a folder. */
function file(name, { type = 'image/jpeg', size = 1024, folder = 'art' } = {}) {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  Object.defineProperty(f, 'webkitRelativePath', { value: `${folder}/${name}` });
  return f;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const EMPTY_REPORT = {
  setId: SET_ID,
  prefix: `sets/${SET_ID}/`,
  totalQuestions: 0,
  counts: { none: 0, remote: 0, asset: 0, key: 0 },
  missingCount: 0,
  missing: [],
  unused: [],
  unverifiable: 0,
};

/**
 * Route by URL. `reports` is consumed one per verification call, so a test can
 * say what the second check finds after an upload.
 */
function mockApi({ reports = [EMPTY_REPORT], presign = null, presignStatus = 200 } = {}) {
  const calls = { verify: 0, presign: [] };
  const queue = [...reports];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.endsWith(`/media`)) {
      calls.verify += 1;
      return jsonResponse(200, queue.length > 1 ? queue.shift() : queue[0]);
    }
    if (method === 'POST' && url.endsWith('/media/uploads')) {
      calls.presign.push(JSON.parse(options.body));
      return jsonResponse(presignStatus, presign || { uploads: [], rejected: [] });
    }
    throw new Error(`unexpected authFetch ${method} ${url}`);
  });
  return calls;
}

let puts;
beforeEach(() => {
  window.API_BASE = 'https://api.example.test/dev/';
  authFetch.mockReset();
  puts = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    puts.push({ url, ...options });
    return { ok: true, status: 200 };
  });
});

afterEach(() => { delete global.fetch; });

describe('the verification report', () => {
  test('names every question pointing at a file that is not there', async () => {
    mockApi({
      reports: [{
        ...EMPTY_REPORT,
        totalQuestions: 3,
        counts: { none: 0, remote: 0, asset: 0, key: 3 },
        missingCount: 2,
        missing: [
          { sk: 'QUESTION#1', questionNumber: 1, title: 'The enigmatic smile', image: `sets/${SET_ID}/mona-lisa.jpg` },
          { sk: 'QUESTION#2', questionNumber: 2, title: 'A swirling night sky', image: `sets/${SET_ID}/starry.jpg` },
        ],
      }],
    });

    render(<SetMediaPanel setId={SET_ID} />);

    const report = await screen.findByTestId('smed-missing');
    expect(within(report).getByText('The enigmatic smile')).toBeInTheDocument();
    expect(within(report).getByText(`sets/${SET_ID}/starry.jpg`)).toBeInTheDocument();
    expect(screen.getByText(/2 images missing/)).toBeInTheDocument();
    // The broken-image glyph the owner asked for, and it is SetImageBadge's —
    // not a second icon meaning the same thing.
    expect(screen.getByTestId('set-image-badge-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('smed-allgood')).not.toBeInTheDocument();
  });

  test('a set of nothing but web links is not condemned', async () => {
    // The Art set. Every Image is a Wikimedia https:// URL, none of them is in
    // the bucket, and every one of them works.
    mockApi({
      reports: [{
        ...EMPTY_REPORT,
        totalQuestions: 7,
        counts: { none: 0, remote: 7, asset: 0, key: 0 },
        unverifiable: 7,
      }],
    });

    render(<SetMediaPanel setId={SET_ID} />);

    expect(await screen.findByTestId('smed-allgood')).toBeInTheDocument();
    expect(screen.queryByTestId('smed-missing')).not.toBeInTheDocument();
    expect(screen.getByText(/7 web links/)).toBeInTheDocument();
    expect(screen.queryByTestId('set-image-badge-missing')).not.toBeInTheDocument();
  });

  test('files nothing points at are reported, and nothing offers to delete them', async () => {
    mockApi({
      reports: [{
        ...EMPTY_REPORT,
        totalQuestions: 1,
        counts: { none: 0, remote: 0, asset: 0, key: 1 },
        unused: [`sets/${SET_ID}/mona_lisa.jpg`],
      }],
    });

    render(<SetMediaPanel setId={SET_ID} />);

    const unused = await screen.findByTestId('smed-unused');
    expect(within(unused).getByText(`sets/${SET_ID}/mona_lisa.jpg`)).toBeInTheDocument();
    expect(within(unused).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('a failed check says so instead of claiming everything is fine', async () => {
    authFetch.mockResolvedValue(jsonResponse(403, { error: 'This question set belongs to someone else.' }));
    render(<SetMediaPanel setId={SET_ID} />);
    expect(await screen.findByText(/belongs to someone else/)).toBeInTheDocument();
    expect(screen.queryByTestId('smed-allgood')).not.toBeInTheDocument();
  });
});

describe('picking a folder uploads it, with no second button to press', () => {
  const pick = (files) => {
    const input = screen.getByTestId('smed-folder-input');
    fireEvent.change(input, { target: { files } });
  };

  test('one change event presigns and puts every image', async () => {
    const calls = mockApi({
      presign: {
        uploads: [
          { name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a?X-Amz-Signature=1' },
          { name: 'b.png', fileName: 'b.png', key: `sets/${SET_ID}/b.png`, contentType: 'image/png', url: 'https://s3.test/b?X-Amz-Signature=2' },
        ],
        rejected: [],
      },
    });

    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');

    pick([file('a.jpg'), file('b.png', { type: 'image/png' })]);

    await waitFor(() => expect(puts).toHaveLength(2));
    // No confirm step: the only interaction was choosing the folder.
    expect(calls.presign).toHaveLength(1);
    expect(calls.presign[0].files.map((f) => f.name).sort()).toEqual(['a.jpg', 'b.png']);

    const batch = await screen.findByTestId('smed-batch');
    await waitFor(() => expect(within(batch).getAllByText('Uploaded')).toHaveLength(2));
  });

  test('the PUT carries the signed content type and NO Authorization header', async () => {
    mockApi({
      presign: {
        uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a?X-Amz-Signature=1' }],
        rejected: [],
      },
    });

    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');
    pick([file('a.jpg')]);

    await waitFor(() => expect(puts).toHaveLength(1));
    const put = puts[0];
    expect(put.method).toBe('PUT');
    expect(put.url).toBe('https://s3.test/a?X-Amz-Signature=1');
    expect(put.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(Object.keys(put.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    // And the panel used the browser's own fetch for it, never authFetch,
    // which is what attaches the bearer token.
    for (const [url] of authFetch.mock.calls) {
      expect(String(url)).not.toContain('s3.test');
    }
  });

  test('a folder of junk plus one picture uploads the picture and says what it skipped', async () => {
    const calls = mockApi({
      presign: {
        uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a' }],
        rejected: [],
      },
    });

    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');

    pick([
      file('.DS_Store', { type: '' }),
      file('questions.csv', { type: 'text/csv' }),
      file('a.jpg'),
    ]);

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(calls.presign[0].files).toHaveLength(1);
    expect(await screen.findByText(/2 non-image files skipped/)).toBeInTheDocument();
  });

  test('an oversized image is refused in the browser, before a URL is asked for', async () => {
    const calls = mockApi();
    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');

    pick([file('huge.jpg', { size: 20 * 1024 * 1024 })]);

    const batch = await screen.findByTestId('smed-batch');
    expect(within(batch).getByText('Refused')).toBeInTheDocument();
    expect(within(batch).getByText(/20\.0 MB — the ceiling is 12 MB/)).toBeInTheDocument();
    // A write credential was never even requested for it.
    expect(calls.presign).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  test('a file the server refuses is named, against that file, with the server’s reason', async () => {
    // The client accepted both — same extension, same size. The SERVER is the
    // one that refuses `b.jpg`, and its reason has to land on b's row and
    // nowhere else. Dropping the loop that applies server refusals would
    // otherwise leave b sitting on "Waiting" forever with no explanation.
    mockApi({
      presign: {
        uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a' }],
        rejected: [{ name: 'b.jpg', reason: '"b.jpg" and "B.JPG" both become sets/x/b.jpg. Rename one.' }],
      },
    });

    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');
    pick([file('a.jpg'), file('b.jpg')]);

    const batch = await screen.findByTestId('smed-batch');
    const refusal = await within(batch).findByText(/both become sets\/x\/b\.jpg/);
    // The reason is on b's row, not a's.
    const row = refusal.closest('tr');
    expect(within(row).getByText('b.jpg')).toBeInTheDocument();
    expect(within(row).getByText('Refused')).toBeInTheDocument();
    // Nothing is left claiming to be in flight.
    expect(within(batch).queryByText('Waiting')).not.toBeInTheDocument();
    // And only the accepted file was actually sent.
    expect(puts).toHaveLength(1);
    expect(within(batch).getAllByText('Uploaded')).toHaveLength(1);
  });

  test('the report is re-read from the bucket after the uploads, not inferred', async () => {
    const calls = mockApi({
      reports: [
        {
          ...EMPTY_REPORT,
          totalQuestions: 1,
          counts: { none: 0, remote: 0, asset: 0, key: 1 },
          missingCount: 1,
          missing: [{ sk: 'QUESTION#1', questionNumber: 1, title: 'The enigmatic smile', image: `sets/${SET_ID}/a.jpg` }],
        },
        { ...EMPTY_REPORT, totalQuestions: 1, counts: { none: 0, remote: 0, asset: 0, key: 1 } },
      ],
      presign: {
        uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a' }],
        rejected: [],
      },
    });

    render(<SetMediaPanel setId={SET_ID} />);
    expect(await screen.findByTestId('smed-missing')).toBeInTheDocument();

    pick([file('a.jpg')]);

    expect(await screen.findByTestId('smed-allgood')).toBeInTheDocument();
    expect(calls.verify).toBe(2);
  });

  test('an upload that fails at S3 is shown as failed, not as done', async () => {
    mockApi({
      presign: {
        uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a' }],
        rejected: [],
      },
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));

    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');
    pick([file('a.jpg')]);

    const batch = await screen.findByTestId('smed-batch');
    expect(await within(batch).findByText('Refused')).toBeInTheDocument();
    expect(within(batch).queryByText('Uploaded')).not.toBeInTheDocument();
    expect(within(batch).getByText(/S3 refused it \(403\)/)).toBeInTheDocument();
  });
});

describe('the controls', () => {
  test('Check again re-runs the verification', async () => {
    const calls = mockApi();
    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');
    expect(calls.verify).toBe(1);

    fireEvent.click(screen.getByTestId('smed-recheck'));
    await waitFor(() => expect(calls.verify).toBe(2));
  });

  test('the folder picker is a real focusable input, not a mouse-only div', async () => {
    mockApi();
    render(<SetMediaPanel setId={SET_ID} />);
    await screen.findByTestId('smed-summary');

    const input = screen.getByTestId('smed-folder-input');
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.disabled).toBe(false);
  });

  test('it picks a FOLDER, which is the whole request', () => {
    // *"select a local folder"*. Without `webkitdirectory` this is an ordinary
    // multi-file picker — it still works, it just makes the author ctrl-click
    // forty files, which is the "bunch of hoops" the brief rules out. React
    // passes both spellings through as attributes; jsdom exposes neither as a
    // property, so they are read off the element.
    mockApi();
    render(<SetMediaPanel setId={SET_ID} />);

    const input = screen.getByTestId('smed-folder-input');
    expect(input.hasAttribute('webkitdirectory')).toBe(true);   // every shipping browser
    expect(input.hasAttribute('directory')).toBe(true);         // the standardised name
  });
});
