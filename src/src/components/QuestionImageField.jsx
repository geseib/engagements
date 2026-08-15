import React, { useRef, useState } from 'react';
import Icon from './Icon';
import { authFetch } from '../auth/authFetch';
import { classifyImage, contentTypeFor, safeFileName } from '../utils/setMedia';
import './QuestionImageField.css';

const API_BASE = () => window.API_BASE;

/**
 * ONE QUESTION'S PICTURE — what it is now, and a way to replace it.
 *
 * The owner: *"the image should also be replaceable on the question. and when
 * you do that it uploads and edits DDB with the image file location in s3."*
 *
 * ── THERE IS NO SECOND WRITE PATH, ON PURPOSE ─────────────────────────────
 *
 * The upload is immediate: pick a file, it goes to S3 under
 * `sets/<setId>/<filename>` through a presigned PUT. The DynamoDB half is NOT
 * a new endpoint. This field sets `draft.image` to the file name, which makes
 * the Questions panel dirty, and the panel's existing Save — the one it calls
 * THE ONE WRITE PATH (QuestionsPanel.jsx:540) — serialises the rows to CSV and
 * POSTs `admin/upload-questions` with `replaceSetId`. The importer's
 * `toMediaKey` turns the file name into `sets/<setId>/<filename>` on the way
 * in, exactly as it does for a CSV a human typed.
 *
 * A dedicated `PUT .../questions/{id}/image` would be a second writer of a
 * question row that the version machinery, the ownership guard, the category
 * bitmask and the CSV round trip all know nothing about. Reusing the save
 * costs one thing — a replace makes a new version, like every other question
 * edit — and buys consistency with all of them. The panel already tells the
 * author that Save creates a version, so the cost is already on screen.
 *
 * ── THE THREE KINDS OF VALUE ARE ALL EDITABLE HERE ────────────────────────
 *
 * The text field takes any of them and says which it is:
 *
 *   https://…    a web address. Kept verbatim, never uploaded. This is what
 *                the Art set uses and it must keep working — pasting a
 *                Wikimedia link here is a supported way to give a question a
 *                picture and requires no upload at all.
 *   /assets/…    a file shipped with the app.
 *   name.jpg     an uploaded file. The one kind Replace produces and the one
 *                kind the Images panel can verify.
 */
export default function QuestionImageField({ setId, value, onChange, inputId }) {
  const [status, setStatus] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef(null);

  const kind = classifyImage(value);

  const replace = async (file) => {
    if (!file) return;
    const name = safeFileName(file.name);
    const contentType = contentTypeFor(file.name);
    if (!contentType) {
      setStatus({ tone: 'bad', text: `${file.name} is not an image type this accepts.` });
      return;
    }
    if (!setId) {
      setStatus({ tone: 'bad', text: 'Save this set once before adding pictures to it.' });
      return;
    }

    setBusy(true);
    setStatus({ tone: 'busy', text: `Uploading ${name}…` });
    try {
      const response = await authFetch(`${API_BASE()}admin/question-sets/${setId}/media/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, size: file.size }] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not get an upload URL (${response.status}).`);

      const signed = (data.uploads || [])[0];
      if (!signed) {
        throw new Error((data.rejected || [])[0]?.reason || 'The server would not accept that file.');
      }

      // A bare fetch, never authFetch: a presigned URL signs its credentials
      // into the query string and an Authorization header makes S3 switch to
      // header auth and refuse it.
      const put = await fetch(signed.url, {
        method: 'PUT',
        headers: { 'Content-Type': signed.contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`S3 refused the upload (${put.status}).`);

      // The file NAME, not the key. `toMediaKey` adds the prefix on import and
      // is idempotent either way; storing the bare name keeps the CSV column
      // readable and keeps this field agreeing with what a human would type.
      onChange(signed.fileName || name);
      setStatus({
        tone: 'ok',
        text: `${name} uploaded. It is on this question once you press Save — that save makes a new version, like any other question edit.`,
      });
    } catch (error) {
      setStatus({ tone: 'bad', text: error.message || 'The upload failed.' });
    } finally {
      setBusy(false);
      // Allow the same file to be picked again after a failure.
      if (pickerRef.current) pickerRef.current.value = '';
    }
  };

  return (
    <div className="qimg">
      <div className="qimg-row">
        <input
          id={inputId}
          className="form-input qimg-input"
          value={value || ''}
          placeholder="mona-lisa.jpg, or https://…"
          onChange={(e) => { onChange(e.target.value); setStatus(null); }}
        />
        <label className="qimg-picker btn-secondary btn-small">
          <Icon name="UploadSimple" weight="bold" size={14} color="currentColor" />
          {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
          <input
            ref={pickerRef}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => replace(e.target.files && e.target.files[0])}
            data-testid="qimg-file"
          />
        </label>
        {value && (
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={() => { onChange(''); setStatus(null); }}
            title="Take the picture off this question. Nothing is deleted from storage."
          >
            Clear
          </button>
        )}
      </div>

      <p className="qimg-kind" data-testid="qimg-kind">
        {kind === 'none' && 'No picture on this question.'}
        {kind === 'remote' && 'A web address. Used exactly as typed and never uploaded — this is how the art sets work.'}
        {kind === 'asset' && 'A file that ships with the app itself. Used exactly as typed.'}
        {kind === 'key' && 'An uploaded file. The Images panel below checks that it is really there.'}
      </p>

      {status && (
        <p className={`qimg-status qimg-status--${status.tone}`} role="status">
          {status.tone === 'ok' && <Icon name="CheckCircle" weight="fill" size={13} color="currentColor" />}
          {status.tone === 'bad' && <Icon name="WarningOctagon" weight="fill" size={13} color="currentColor" />}
          {' '}{status.text}
        </p>
      )}
    </div>
  );
}
