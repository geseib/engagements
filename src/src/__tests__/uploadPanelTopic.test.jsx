/**
 * A NEW SET NAMES ITS SHELF BEFORE IT IS MADE — QuestionSetUploadPanel.jsx.
 *
 * This is the create path with a name on it, and `upload-questions.js` answers
 * 400 for a create that lands live without a topic. The panel asks for one in
 * the same breath as the title rather than letting the person attach a file,
 * fill four fields and then be told.
 *
 * Harness copied from questionSetUploadPanel.test.jsx, including the two-hop
 * wait for FileReader.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuestionSetUploadPanel from '../components/QuestionSetUploadPanel';
import { authFetch } from '../auth/authFetch';
import { SET_TOPICS, SET_TOPIC_IDS } from '../config/setTopics';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

const GOOD = 'Category,Title,Detail_lesson\nRetro,"What broke, and when?",Context\nRetro,And after?,Context';

function mount(props = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/admin/upload-questions')) {
      return jsonResponse(200, { message: 'Created "Retro" with 2 questions' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return render(
    <QuestionSetUploadPanel
      engagementType="call-and-answer"
      onEngagementTypeChange={jest.fn()}
      availablePrompts={[]}
      defaultInstructions=""
      {...props}
    />,
  );
}

async function chooseFile(text = GOOD, name = 'questions.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [file] } });
  await waitFor(() => expect(document.querySelector('.qsets-pf')).not.toBeNull());
}

const uploadButton = () => screen.getByRole('button', { name: /^upload question set$/i });
const picker = () => screen.getByLabelText(/topic/i);
const uploadBodies = () => authFetch.mock.calls
  .filter(([u, o]) => String(u).includes('upload-questions') && (o?.method || '').toUpperCase() === 'POST')
  .map(([, o]) => JSON.parse(o.body));

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

describe('the shelf is asked for beside the title', () => {
  test('the picker offers exactly the fifteen', () => {
    mount();
    const offered = [...picker().querySelectorAll('option')].filter((o) => !o.disabled);
    expect(offered.map((o) => o.textContent)).toEqual(SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label));
  });

  test('a new set starts on no shelf rather than on whichever is first', () => {
    // rejects: seeding the picker with SET_TOPIC_IDS[0]. Everything would
    // arrive filed under Arts & Culture, which is worse than Unfiled: it is a
    // wrong answer that nobody was asked for and nobody can spot.
    mount();
    expect(picker()).toHaveValue('');
  });
});

describe('the upload will not go without one', () => {
  test('the button stays off until a shelf is chosen', async () => {
    mount();
    await chooseFile();
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Retro' } });

    expect(uploadButton()).toBeDisabled();

    fireEvent.change(picker(), { target: { value: 'business-work' } });
    expect(uploadButton()).toBeEnabled();
  });

  test('and says what the missing shelf costs, rather than a dead button', async () => {
    // A disabled control with no reason is the one people press twice. The
    // Unfiled line under the picker is the reason, and it is permanent.
    mount();
    await chooseFile();
    expect(screen.getByTestId('qsets-topic-unfiled')).toBeInTheDocument();
  });

  test('a shelf alone is not enough either — the title is still required', async () => {
    // Attaching a file seeds the title from the filename, so it is blanked here
    // deliberately: the shelf is a NEW requirement beside the old one, not a
    // replacement for it.
    mount();
    await chooseFile();
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: '' } });
    fireEvent.change(picker(), { target: { value: 'business-work' } });
    expect(uploadButton()).toBeDisabled();
  });
});

describe('what the panel sends', () => {
  test('carries the shelf and the set’s own words to the importer', async () => {
    mount();
    await chooseFile();
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Retro' } });
    fireEvent.change(picker(), { target: { value: 'business-work' } });
    fireEvent.change(screen.getByLabelText(/^tags$/i), { target: { value: 'onboarding' } });
    fireEvent.click(screen.getByRole('button', { name: /^add tag$/i }));

    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadBodies()).toHaveLength(1));
    expect(uploadBodies()[0].topic).toBe('business-work');
    expect(uploadBodies()[0].tags).toEqual(['onboarding']);
  });

  test('sends no tags key at all when none were given', async () => {
    // rejects: `tags: []` on a create. The importer writes the attribute only
    // when there is something to write, and an empty list in the body is a
    // value nobody chose being offered to a writer that would store it.
    mount();
    await chooseFile();
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Retro' } });
    fireEvent.change(picker(), { target: { value: 'business-work' } });

    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadBodies()).toHaveLength(1));
    expect('tags' in uploadBodies()[0]).toBe(false);
  });

  test('forgets the shelf after a set lands, like every other field on the form', async () => {
    // The panel clears itself so the next set is not filed by accident under
    // whatever the last one was.
    mount();
    await chooseFile();
    fireEvent.change(screen.getByLabelText(/question set title/i), { target: { value: 'Retro' } });
    fireEvent.change(picker(), { target: { value: 'business-work' } });

    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadBodies()).toHaveLength(1));
    await waitFor(() => expect(picker()).toHaveValue(''));
  });
});
