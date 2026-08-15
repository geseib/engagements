/**
 * REPLACING ONE QUESTION'S PICTURE — components/QuestionImageField.jsx
 *
 * The owner: *"the image should also be replaceable on the question. and when
 * you do that it uploads and edits DDB with the image file location in s3."*
 *
 * The half that is easy to get wrong is the second one. There is NO new write
 * endpoint: the field uploads the bytes and then reports the FILE NAME upward,
 * which makes the Questions panel dirty and lets its existing Save — the one
 * `POST /admin/upload-questions` with `replaceSetId` that every other question
 * edit already goes through — write the row. The importer's `toMediaKey` turns
 * the file name into `sets/<setId>/<name>` on the way in.
 *
 * So the assertions are: the bytes go to S3 with the signed content type and
 * no bearer token, the value handed upward is the one the importer will key,
 * and the three stored shapes are all still editable — a Wikimedia URL typed
 * into this field must survive untouched, because that is the Art game.
 *
 * NO GEOMETRY IS ASSERTED ANYWHERE IN THIS FILE.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const QuestionImageField = require('../components/QuestionImageField').default;

const SET_ID = 'set-42';

/** Mounts the field the way the question form does: it owns the value. */
function Harness({ initial = '', onValue }) {
  const [value, setValue] = useState(initial);
  return (
    <QuestionImageField
      setId={SET_ID}
      inputId="q-image-1"
      value={value}
      onChange={(next) => { setValue(next); if (onValue) onValue(next); }}
    />
  );
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function imageFile(name, type = 'image/jpeg') {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: 2048 });
  return f;
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

describe('replacing the picture', () => {
  const upload = (name = 'mona-lisa.jpg') => {
    fireEvent.change(screen.getByTestId('qimg-file'), { target: { files: [imageFile(name)] } });
  };

  test('uploads the bytes and hands the FILE NAME upward for the existing save', async () => {
    const seen = [];
    authFetch.mockResolvedValue(jsonResponse(200, {
      uploads: [{
        name: 'mona-lisa.jpg',
        fileName: 'mona-lisa.jpg',
        key: `sets/${SET_ID}/mona-lisa.jpg`,
        contentType: 'image/jpeg',
        url: 'https://s3.test/mona?X-Amz-Signature=1',
      }],
      rejected: [],
    }));

    render(<Harness initial="old.jpg" onValue={(v) => seen.push(v)} />);
    upload();

    await waitFor(() => expect(puts).toHaveLength(1));
    // The bare name, not the key: `toMediaKey` adds the prefix on import and is
    // idempotent, and a bare name is what a human types in the CSV column.
    await waitFor(() => expect(seen).toContain('mona-lisa.jpg'));
    expect(seen).not.toContain(`sets/${SET_ID}/mona-lisa.jpg`);
  });

  test('the PUT carries the signed content type and no Authorization header', async () => {
    authFetch.mockResolvedValue(jsonResponse(200, {
      uploads: [{
        name: 'mona-lisa.jpg',
        fileName: 'mona-lisa.jpg',
        key: `sets/${SET_ID}/mona-lisa.jpg`,
        contentType: 'image/jpeg',
        url: 'https://s3.test/mona?X-Amz-Signature=1',
      }],
      rejected: [],
    }));

    render(<Harness />);
    upload();

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].method).toBe('PUT');
    expect(puts[0].headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(Object.keys(puts[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  test('it asks for exactly one URL, for exactly this file', async () => {
    const bodies = [];
    authFetch.mockImplementation(async (url, options) => {
      bodies.push({ url, body: JSON.parse(options.body) });
      return jsonResponse(200, {
        uploads: [{ name: 'x.png', fileName: 'x.png', key: `sets/${SET_ID}/x.png`, contentType: 'image/png', url: 'https://s3.test/x' }],
        rejected: [],
      });
    });

    render(<Harness />);
    fireEvent.change(screen.getByTestId('qimg-file'), {
      target: { files: [imageFile('x.png', 'image/png')] },
    });

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].url).toBe(`https://api.example.test/dev/admin/question-sets/${SET_ID}/media/uploads`);
    expect(bodies[0].body.files).toHaveLength(1);
    expect(bodies[0].body.files[0].name).toBe('x.png');
  });

  test('a refusal leaves the existing value alone and says why', async () => {
    const seen = [];
    authFetch.mockResolvedValue(jsonResponse(200, {
      uploads: [],
      rejected: [{ name: 'huge.jpg', reason: '"huge.jpg" is 40.0 MB. The ceiling is 12 MB.' }],
    }));

    render(<Harness initial="keep-me.jpg" onValue={(v) => seen.push(v)} />);
    upload('huge.jpg');

    expect(await screen.findByText(/The ceiling is 12 MB/)).toBeInTheDocument();
    expect(seen).toEqual([]);
    expect(screen.getByDisplayValue('keep-me.jpg')).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  test('an S3 failure does not move the question onto a file that is not there', async () => {
    const seen = [];
    authFetch.mockResolvedValue(jsonResponse(200, {
      uploads: [{ name: 'a.jpg', fileName: 'a.jpg', key: `sets/${SET_ID}/a.jpg`, contentType: 'image/jpeg', url: 'https://s3.test/a' }],
      rejected: [],
    }));
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));

    render(<Harness initial="keep-me.jpg" onValue={(v) => seen.push(v)} />);
    upload();

    expect(await screen.findByText(/S3 refused the upload \(403\)/)).toBeInTheDocument();
    expect(seen).toEqual([]);
    expect(screen.getByDisplayValue('keep-me.jpg')).toBeInTheDocument();
  });

  test('a non-image is refused without asking for a URL at all', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('qimg-file'), {
      target: { files: [imageFile('notes.pdf', 'application/pdf')] },
    });

    expect(await screen.findByText(/not an image type this accepts/)).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });
});

describe('the three stored shapes are all editable here', () => {
  test.each([
    ['', /No picture on this question/],
    ['https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg', /web address/],
    ['/assets/art/the-enigmatic-smile.jpg', /ships with the app itself/],
    ['mona-lisa.jpg', /An uploaded file/],
  ])('%s is described as what it is', (value, description) => {
    render(<Harness initial={value} />);
    expect(screen.getByTestId('qimg-kind').textContent).toMatch(description);
  });

  test('a pasted web address is passed upward exactly as typed', () => {
    const seen = [];
    const url = 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg?width=900';
    render(<Harness onValue={(v) => seen.push(v)} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: url } });
    // Not lowercased, not prefixed, not stripped of its query string — this is
    // what every question in the art sets carries.
    expect(seen).toEqual([url]);
  });

  test('Clear takes the picture off the question and nothing else', () => {
    const seen = [];
    render(<Harness initial="mona-lisa.jpg" onValue={(v) => seen.push(v)} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(seen).toEqual(['']);
    // No delete request anywhere: the bytes stay in the bucket, because another
    // question may still be pointing at them.
    expect(authFetch).not.toHaveBeenCalled();
  });
});
