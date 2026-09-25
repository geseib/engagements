/**
 * DOWNLOAD FOR AN AGENT, UPLOAD A REVISED FILE — the editor's two doors to the
 * outside (AIPromptManager.jsx, PromptImportReview.jsx, utils/workieBundle.js).
 *
 * The owner, 2026-09-25: "A link that allows us to download and then upload
 * the prompt would be fantastic. This should only be for Engage admins
 * though." Spec: docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * rejects: a download built without the server's reference (the rules and
 *          the catalogue come from the gated call, or there is no file); the
 *          saved copy exported instead of the draft; an upload that writes
 *          anything; a file for another prompt, another game type or no file
 *          at all put into the editor; identity fields taken from a file; the
 *          doors offered in the read-only view.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';
import { buildWorkieBundle } from '../utils/workieBundle';

const path = require('path');

const { buildWorkieReference } = require(path.join(__dirname, '..', '..', '..', 'lambda-functions', 'admin', 'shared', 'workie-reference.js'));

const REFERENCE = buildWorkieReference('call-and-answer');
const INSTRUCTIONS = 'You are Workie.\n\n**The titles:**\n{responsesText}';
const OUTPUT_FORMAT = '## The Winning Title\nSay which won.';
const PROMPT = {
  promptId: 'art1',
  name: 'Art & Creative Titles',
  gameType: 'call-and-answer',
  category: 'art-titles',
  status: 'active',
  isDefault: false,
  promptType: 'analysis',
  promptContent: { instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT },
};

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function serve({ reference = reply(200, { reference: REFERENCE }) } = {}) {
  const posts = [];
  const writes = [];
  authFetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'POST' && /ai-prompt-advisor/.test(url)) {
      posts.push(JSON.parse(init.body));
      return reference;
    }
    if (method !== 'GET') {
      writes.push({ url, method });
      return reply(200, {});
    }
    return reply(200, { prompts: [PROMPT] });
  });
  return { posts, writes };
}

/** Read a Blob the way the page does — the test DOM has FileReader. */
const blobText = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsText(blob);
});

let saved;
let clicked;
beforeEach(() => {
  authFetch.mockReset();
  saved = [];
  clicked = [];
  window.URL.createObjectURL = jest.fn((blob) => { saved.push(blob); return 'blob:workie'; });
  window.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push(this.download); });
});
afterEach(() => jest.restoreAllMocks());

async function openEditor() {
  render(<AIPromptManager />);
  fireEvent.click(await screen.findByTitle('Edit this prompt'));
  return screen.findByTestId('prompt-input-textarea');
}

const upload = (text, name = 'art.workie.md') => {
  const file = new File([text], name, { type: 'text/markdown' });
  fireEvent.change(screen.getByTestId('pmgr-upload-input'), { target: { files: [file] } });
};

/** A file as an agent would hand it back: this prompt's, with the halves changed. */
const revised = (over = {}, identity = {}) => buildWorkieBundle({
  promptId: 'art1',
  draft: {
    ...PROMPT,
    instructions: 'You are Workie, warmer now.\n\n**The titles:**\n{responsesText}',
    outputFormat: OUTPUT_FORMAT,
    ...over,
  },
  reference: REFERENCE,
  report: null,
  ...identity,
});

describe('Download for an agent', () => {
  test('asks the server for the reference, then saves one file carrying the DRAFT and the rules', async () => {
    const { posts } = serve();
    const given = await openEditor();
    fireEvent.change(given, { target: { value: `${INSTRUCTIONS}\n\nUnsaved line.` } });
    fireEvent.click(screen.getByTestId('pmgr-download'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(posts).toEqual([{ analysisType: 'reference', gameType: 'call-and-answer' }]);
    expect(clicked).toEqual(['art-creative-titles.workie.md']);
    const md = await blobText(saved[0]);
    expect(md.split('\n')[0]).toBe('# Engage Workie: Art & Creative Titles');
    expect(md).toContain('Unsaved line.');
    expect(md).toContain(REFERENCE.rules[0].text);
    expect(md).toContain('"promptId": "art1"');
    expect(screen.getByTestId('pmgr-tools-notice')).toHaveTextContent('Downloaded art-creative-titles.workie.md');
  });

  test('a refused reference means no file, and the sentence says why', async () => {
    serve({ reference: reply(403, { error: 'Prompts are changed in Engage mode. Switch to Engage in the top bar, then try again.' }) });
    await openEditor();
    fireEvent.click(screen.getByTestId('pmgr-download'));
    await waitFor(() => expect(screen.getByTestId('pmgr-tools-notice')).toHaveTextContent(/Nothing was downloaded — Prompts are changed in Engage mode/));
    expect(saved).toHaveLength(0);
  });
});

describe('Upload a revised file', () => {
  test('a file for this prompt opens the review: what changes, and the checks on the result', async () => {
    const { writes } = serve();
    await openEditor();
    upload(revised());

    const review = await screen.findByTestId('pmgr-import-view');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Upload a revised prompt');
    expect(screen.getByTestId('pmgr-import-instructions-after')).toHaveTextContent('warmer now');
    expect(screen.queryByTestId('pmgr-import-outputFormat')).toBeNull();
    // The checks, run on the version the file would leave — inside the review itself.
    expect(within(review).getByTestId('prompt-preflight-panel')).toBeInTheDocument();
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByTestId('pmgr-import-confirm'));
    expect(await screen.findByTestId('prompt-input-textarea')).toHaveValue(
      'You are Workie, warmer now.\n\n**The titles:**\n{responsesText}',
    );
    expect(screen.getByTestId('prompt-input-textarea')).toBeVisible();
    expect(writes).toEqual([]);
  });

  test('Back to the editor drops the file and changes nothing', async () => {
    serve();
    await openEditor();
    upload(revised());
    await screen.findByTestId('pmgr-import-view');
    fireEvent.click(screen.getByTestId('pmgr-import-back'));
    expect(screen.getByTestId('prompt-input-textarea')).toHaveValue(INSTRUCTIONS);
    expect(screen.queryByTestId('pmgr-import-view')).toBeNull();
  });

  test('identity fields a file changed are named, and not taken', async () => {
    serve();
    await openEditor();
    upload(revised({ status: 'archived', isDefault: true }));
    await screen.findByTestId('pmgr-import-view');
    expect(screen.getByTestId('pmgr-import-ignored')).toHaveTextContent(/the status, the default flag/);
    fireEvent.click(screen.getByTestId('pmgr-import-confirm'));
    await screen.findByTestId('prompt-input-textarea');
    expect(screen.queryByTestId('default-blast-warning')).toBeNull();
  });

  for (const [label, text, said] of [
    ['a file for another prompt', () => revised({}, { promptId: 'other9' }), /not this one \(art1\)/],
    ['a file for another game type', () => revised({ gameType: 'trivia' }), /Trivia prompt/],
    ['a file that is not a Workie', () => '# My notes\nNothing here.', /not an Engage Workie file/],
  ]) {
    test(`${label} is refused with a sentence, and nothing changes`, async () => {
      const { writes } = serve();
      await openEditor();
      upload(text());
      await waitFor(() => expect(screen.getByTestId('pmgr-tools-notice')).toHaveTextContent(said));
      expect(screen.getByTestId('pmgr-tools-notice')).toHaveTextContent(/Nothing was changed/);
      expect(screen.queryByTestId('pmgr-import-view')).toBeNull();
      expect(screen.getByTestId('prompt-input-textarea')).toHaveValue(INSTRUCTIONS);
      expect(writes).toEqual([]);
    });
  }

  test('a file that matches the draft says so, rather than opening an empty review', async () => {
    serve();
    await openEditor();
    upload(revised({ instructions: INSTRUCTIONS }));
    await waitFor(() => expect(screen.getByTestId('pmgr-tools-notice')).toHaveTextContent(/matches the draft/));
    expect(screen.queryByTestId('pmgr-import-view')).toBeNull();
  });
});

describe('Engage admins only', () => {
  test('the read-only view offers no download, upload or improve', async () => {
    serve();
    render(<AIPromptManager readOnly />);
    fireEvent.click(await screen.findByTitle('Read this prompt'));
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('pmgr-download')).toBeNull();
    expect(screen.queryByTestId('pmgr-upload')).toBeNull();
    expect(screen.queryByTestId('pmgr-open-improve')).toBeNull();
    expect(screen.queryByTitle('Improve this prompt')).toBeNull();
    expect(screen.queryByTitle('Edit this prompt')).toBeNull();
  });
});
