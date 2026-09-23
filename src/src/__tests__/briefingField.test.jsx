/**
 * THE BRIEFING FIELD — components/BriefingField.jsx, in every state.
 *
 * docs/design/session-setup-redesign 01, 03 and 04: a Call & Answer host
 * picks a document; it is read (parse-document), Workie writes a short
 * factual briefing (POST /games/briefing/draft), and the host reads and edits
 * it before anything is stored. Amber is a fact about the file; red is only
 * for something that broke. The file itself is never kept.
 *
 * The reader and the drafter are injected, so each state is driven directly.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BriefingField from '../components/BriefingField';
import { DocumentProblem } from '../utils/documentText';

const DOC = { text: 'x'.repeat(19400), name: 'q3-support-ops-review.pdf', pages: 14, truncated: false, chars: 19400 };
const DRAFT = { briefing: 'Q3 review of the support team.\n- Open issues are up 15% on Q2.', namesRemoved: 2 };

/** The field as the dialog holds it: the value lives in the parent. */
function Harness({ initial = null, read, draft, onValue, onWorking }) {
  const [value, setValue] = useState(initial);
  return (
    <BriefingField
      value={value}
      onChange={(v) => { setValue(v); onValue?.(v); }}
      onWorkingChange={onWorking}
      readDocument={read}
      requestDraft={draft}
    />
  );
}

const pickFile = (name = 'q3-support-ops-review.pdf', size = 2 * 1024 * 1024) => {
  const input = document.querySelector('input[type="file"]');
  const file = new File(['%PDF'], name);
  Object.defineProperty(file, 'size', { value: size });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};

describe('empty: the invitation', () => {
  test('says what it is for, that it is optional, and that people who join never see it', () => {
    render(<Harness />);
    expect(screen.getByText(/Brief Workie from a document/)).toBeInTheDocument();
    expect(screen.getByText(/optional/)).toBeInTheDocument();
    expect(screen.getByText(/People who join never see it/)).toBeInTheDocument();
    expect(screen.getByText(/PDF, Word or text · up to 4 MB/)).toBeInTheDocument();
  });

  test('"Choose a document" opens the file picker', () => {
    render(<Harness />);
    const input = document.querySelector('input[type="file"]');
    const click = jest.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: /choose a document/i }));
    expect(click).toHaveBeenCalled();
  });

  test('"write the key points yourself" opens an empty box, no document needed', () => {
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: /write the key points yourself/i }));
    const box = screen.getByLabelText(/what workie will know/i);
    expect(box.value).toBe('');
    fireEvent.change(box, { target: { value: 'Open issues are up 15%.' } });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Open issues are up 15%.', source: null }));
  });
});

describe('a document becomes a briefing', () => {
  test('read, then written, then ready to check — with its source, and the names left out', async () => {
    let finishDraft;
    const read = jest.fn(async () => DOC);
    const draft = jest.fn(() => new Promise((resolve) => { finishDraft = resolve; }));
    const onWorking = jest.fn();
    const onValue = jest.fn();
    render(<Harness read={read} draft={draft} onWorking={onWorking} onValue={onValue} />);
    pickFile();

    // Working: the read step is done, the write step is in progress.
    expect(await screen.findByText(/Read 14 pages/)).toBeInTheDocument();
    expect(screen.getByText(/Writing the briefing/)).toBeInTheDocument();
    expect(screen.getByText(/The document itself is not kept/)).toBeInTheDocument();
    expect(onWorking).toHaveBeenLastCalledWith(true);
    // The draft gets the TEXT and its facts — never the file.
    expect(draft).toHaveBeenCalledWith({ text: DOC.text, pages: 14, truncated: false });

    await act(async () => { finishDraft(DRAFT); });

    const box = screen.getByLabelText(/what workie will know/i);
    expect(box.value).toBe(DRAFT.briefing);
    expect(screen.getByText(/2 names left out/)).toBeInTheDocument();
    expect(screen.getByText(/q3-support-ops-review\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/14 pages/)).toBeInTheDocument();
    expect(onWorking).toHaveBeenLastCalledWith(false);
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({
      text: DRAFT.briefing,
      namesRemoved: 2,
      source: { name: 'q3-support-ops-review.pdf', pages: 14, chars: 19400, truncated: false },
    }));
  });

  test('the draft is editable to the last character, and counts against 1,500', async () => {
    const onValue = jest.fn();
    render(<Harness read={async () => DOC} draft={async () => DRAFT} onValue={onValue} />);
    pickFile();
    const box = await screen.findByLabelText(/what workie will know/i);
    expect(box).toHaveAttribute('maxLength', '1500');
    fireEvent.change(box, { target: { value: 'Edited.' } });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Edited.', editedAt: expect.any(String) }));
    expect(screen.getByText('7/1,500 characters')).toBeInTheDocument();
  });

  test('Remove clears it back to the invitation', async () => {
    const onValue = jest.fn();
    render(<Harness read={async () => DOC} draft={async () => DRAFT} onValue={onValue} />);
    pickFile();
    await screen.findByLabelText(/what workie will know/i);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/Brief Workie from a document/)).toBeInTheDocument();
  });

  test('Replace opens the picker again', async () => {
    render(<Harness read={async () => DOC} draft={async () => DRAFT} />);
    pickFile();
    await screen.findByLabelText(/what workie will know/i);
    const click = jest.spyOn(document.querySelector('input[type="file"]'), 'click');
    fireEvent.click(screen.getByRole('button', { name: /replace/i }));
    expect(click).toHaveBeenCalled();
  });

  test('a long document says how much Workie read', async () => {
    render(<Harness read={async () => ({ ...DOC, pages: 60, truncated: true })} draft={async () => DRAFT} />);
    pickFile();
    expect(await screen.findByText(/Workie read the first 50,000 characters of 60 pages/)).toBeInTheDocument();
  });

  test('"Stop and choose another" drops a draft still in flight', async () => {
    let finishDraft;
    const onValue = jest.fn();
    render(<Harness read={async () => DOC} draft={() => new Promise((r) => { finishDraft = r; })} onValue={onValue} />);
    pickFile();
    fireEvent.click(await screen.findByRole('button', { name: /stop and choose another/i }));
    await act(async () => { finishDraft(DRAFT); });
    expect(screen.getByText(/Brief Workie from a document/)).toBeInTheDocument();
    expect(onValue).not.toHaveBeenCalledWith(expect.objectContaining({ text: DRAFT.briefing }));
  });
});

describe('when a document does not become a briefing', () => {
  const failRead = (code, message) => async () => { throw new DocumentProblem(code, message); };

  test.each([
    ['too-large', 'That file is 11.2 MB. The limit is 4 MB.'],
    ['slides', 'Slides can’t be read directly. Save them as a PDF first — PowerPoint: …'],
    ['password', 'This PDF is protected with a password. Nothing was read.'],
  ])('%s: amber, the reason, and a way to choose another', async (code, message) => {
    const { container } = render(<Harness read={failRead(code, message)} draft={jest.fn()} />);
    pickFile();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(container.querySelector('.gsd-brief')).toHaveClass('is-limit');
    expect(screen.getByRole('button', { name: /choose another/i })).toBeInTheDocument();
  });

  test('scanned pages: no text, said plainly, with a box to type the facts', async () => {
    const draft = jest.fn();
    const onValue = jest.fn();
    const { container } = render(<Harness read={async () => ({ ...DOC, text: 'p1 p2', chars: 5 })} draft={draft} onValue={onValue} />);
    pickFile();
    expect(await screen.findByText(/No text in this PDF/)).toBeInTheDocument();
    expect(container.querySelector('.gsd-brief')).toHaveClass('is-limit');
    expect(draft).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/what workie will know/i), { target: { value: 'MTTR is 3 weeks.' } });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'MTTR is 3 weeks.' }));
  });

  test('the summariser failed: red, and Try again reuses the text already read', async () => {
    const read = jest.fn(async () => DOC);
    const draft = jest.fn()
      .mockRejectedValueOnce(new DocumentProblem('failed', "The document was read, but Workie couldn't write the briefing."))
      .mockResolvedValueOnce(DRAFT);
    const { container } = render(<Harness read={read} draft={draft} />);
    pickFile();
    expect(await screen.findByText(/couldn.t write the briefing/)).toBeInTheDocument();
    expect(container.querySelector('.gsd-brief')).toHaveClass('is-failed');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByLabelText(/what workie will know/i)).toHaveValue(DRAFT.briefing);
    expect(read).toHaveBeenCalledTimes(1);   // not re-read, not re-uploaded
    expect(draft).toHaveBeenCalledTimes(2);
  });

  test('…or the host writes it themselves from there', async () => {
    const draft = jest.fn().mockRejectedValue(new DocumentProblem('failed', 'nope'));
    render(<Harness read={async () => DOC} draft={draft} />);
    pickFile();
    await screen.findByText(/nope/);
    fireEvent.click(screen.getByRole('button', { name: /write the key points yourself/i }));
    expect(screen.getByLabelText(/what workie will know/i)).toHaveValue('');
  });
});

describe('seeded from a saved session (the edit dialog)', () => {
  test('opens ready, with the saved text and where it came from', () => {
    render(<Harness initial={{
      text: 'Saved facts.', source: { name: 'saved.pdf', pages: 3, chars: 900, truncated: false },
      namesRemoved: 0, draftedAt: '2026-09-23T10:00:00.000Z', editedAt: null,
    }} />);
    expect(screen.getByLabelText(/what workie will know/i)).toHaveValue('Saved facts.');
    expect(screen.getByText(/saved\.pdf/)).toBeInTheDocument();
  });

  test('a typed briefing says it was written by the host', () => {
    render(<Harness initial={{ text: 'Typed.', source: null, namesRemoved: 0 }} />);
    expect(screen.getByText(/Written by you/)).toBeInTheDocument();
  });
});
