import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import { authFetch } from '../auth/authFetch';
import {
  MAX_FILES_PER_REQUEST,
  classifyImage,
  mediaPrefix,
  planFolderUpload,
} from '../utils/setMedia';
import './SetMediaPanel.css';

/* Same accessor QuestionsPanel and QuestionSetEditor use: config.js sets
   window.API_BASE at load time, so it cannot be read into a module constant. */
const API_BASE = () => window.API_BASE;

/**
 * THE IMAGES PANEL — pick a folder, the pictures go to S3, then say which
 * questions are pointing at nothing.
 *
 * The owner's brief, verbatim: *"i would like it to be where you can select a
 * local folder and those files will be imported to the S3 bucket using a sign
 * URL??? or some other way that doesnt require a bunch of hoops. after the
 * import it should verify these images are mapped to the questions."*
 *
 * ── NO HOOPS, SPELLED OUT ─────────────────────────────────────────────────
 *
 * Choosing the folder is the last decision. There is no key to type, no
 * per-file confirmation, no "now press Upload": the picker's onChange plans
 * the batch, asks the server for URLs and starts putting bytes. The only
 * things that stop are files that cannot be uploaded, and they are reported
 * rather than prompted about.
 *
 * A folder picker hands over EVERY file in the tree. `planFolderUpload` skips
 * non-images as a group and counts them — a `.DS_Store` is not an error the
 * author needs to read, it is noise the operating system put there — while an
 * image that fails a rule is named individually, because that one they meant.
 *
 * ── THE PUT DOES NOT GO THROUGH authFetch, AND THAT IS LOAD-BEARING ───────
 *
 * `authFetch` attaches `Authorization: Bearer <Cognito JWT>`. A presigned S3
 * URL carries its signature in the QUERY STRING, and S3 seeing an Authorization
 * header switches to header-based SigV4 and rejects the request. So the upload
 * is a bare `fetch`. The credential is the URL; nothing else may be added to
 * the request except the exact `Content-Type` that was signed.
 *
 * ── WHY THE REPORT IS SERVER-SIDE ────────────────────────────────────────
 *
 * The browser cannot check whether an object exists by fetching it. The
 * CloudFront distribution maps 403 and 404 to `/index.html` with status **200**
 * (template-clean.yaml, CustomErrorResponses) so every missing image would come
 * back as a successful fetch of the app's HTML. `GET .../media` lists the
 * bucket prefix server-side and compares it against the stored `Image` values,
 * which is the only answer that is actually true.
 */
export default function SetMediaPanel({
  setId,
  /**
   * The Questions panel's WORKING COPY, when the editor has one. Used for the
   * "questions with no image at all" count only — never for the missing check,
   * which needs the persisted rows the server just compared against the bucket.
   * A working copy can contain unsaved rows the bucket has never heard of.
   */
  rows = null,
  /** Told when files land, so the editor can re-read anything it caches. */
  onUploaded,
}) {
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState('');
  const [verifying, setVerifying] = useState(false);
  // One row per file in the batch: { name, key, state, note }.
  const [batch, setBatch] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [planNote, setPlanNote] = useState('');
  const pickerRef = useRef(null);
  // A verify that returns after the panel closes must not setState.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const verify = useCallback(async () => {
    if (!setId) return;
    setVerifying(true);
    setReportError('');
    try {
      const response = await authFetch(`${API_BASE()}admin/question-sets/${setId}/media`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `The check failed (${response.status}).`);
      if (alive.current) setReport(data);
    } catch (error) {
      if (alive.current) setReportError(error.message || 'The check could not run.');
    } finally {
      if (alive.current) setVerifying(false);
    }
  }, [setId]);

  useEffect(() => { verify(); }, [verify]);

  /** Upload one planned file to its presigned URL. Returns a state + note. */
  const putOne = async (planned, signed) => {
    const response = await fetch(signed.url, {
      method: 'PUT',
      // The ONLY header. See the header comment: no Authorization, and the
      // content type must be byte-identical to the one that was signed.
      headers: { 'Content-Type': signed.contentType },
      body: planned.file,
    });
    if (!response.ok) {
      throw new Error(`S3 refused it (${response.status}).`);
    }
  };

  const startUpload = async (fileList) => {
    const plan = planFolderUpload(fileList, setId);

    if (plan.accepted.length === 0) {
      setBatch(plan.rejected.map((r) => ({ name: r.name, key: '', state: 'bad', note: r.reason })));
      setPlanNote(plan.total === 0
        ? 'That folder was empty.'
        : `Nothing in that folder could be uploaded. ${plan.skipped} file${plan.skipped === 1 ? '' : 's'} `
          + 'skipped for not being an image.');
      return;
    }
    if (plan.accepted.length > MAX_FILES_PER_REQUEST) {
      setPlanNote(`${plan.accepted.length} images in one folder. The ceiling is ${MAX_FILES_PER_REQUEST} `
        + 'per go — split the folder and pick it twice.');
      return;
    }

    setUploading(true);
    setPlanNote(
      `${plan.accepted.length} image${plan.accepted.length === 1 ? '' : 's'} found`
      + (plan.skipped ? `, ${plan.skipped} non-image file${plan.skipped === 1 ? '' : 's'} skipped` : '')
      + '.'
    );
    setBatch([
      ...plan.accepted.map((a) => ({ name: a.name, key: a.key, state: 'wait', note: '' })),
      ...plan.rejected.map((r) => ({ name: r.name, key: '', state: 'bad', note: r.reason })),
    ]);

    const mark = (name, state, note) => {
      if (!alive.current) return;
      setBatch((current) => current.map((row) => (
        row.name === name && row.state !== 'bad' ? { ...row, state, note: note || '' } : row
      )));
    };

    try {
      const response = await authFetch(`${API_BASE()}admin/question-sets/${setId}/media/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: plan.accepted.map((a) => ({ name: a.name, size: a.size })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not get upload URLs (${response.status}).`);

      const signedByName = new Map((data.uploads || []).map((u) => [u.fileName || u.name, u]));
      for (const refused of (data.rejected || [])) {
        mark(refused.name, 'bad', refused.reason);
      }

      // Four at a time. Serial makes a 60-image folder feel broken; unbounded
      // opens 200 sockets and the browser queues them anyway, while every
      // failure arrives at once with no partial progress to look at.
      const queue = plan.accepted.filter((a) => signedByName.has(a.name));
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const planned = queue[index];
          mark(planned.name, 'busy');
          try {
            await putOne(planned, signedByName.get(planned.name));
            mark(planned.name, 'ok', planned.key);
          } catch (error) {
            mark(planned.name, 'bad', error.message || 'The upload failed.');
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);

      if (onUploaded) onUploaded();
    } catch (error) {
      if (alive.current) {
        setBatch((current) => current.map((row) => (
          row.state === 'wait' || row.state === 'busy'
            ? { ...row, state: 'bad', note: error.message || 'The upload failed.' }
            : row
        )));
      }
    } finally {
      if (alive.current) setUploading(false);
      // Whatever happened, re-read the truth from the bucket rather than
      // inferring it from what the PUTs returned.
      await verify();
    }
  };

  const onPick = (event) => {
    const { files } = event.target;
    startUpload(files);
    // Let the same folder be picked twice — a browser fires no change event
    // for an identical selection, so a retry after a failure would do nothing.
    if (pickerRef.current) pickerRef.current.value = '';
  };

  const missing = report?.missing || [];
  const deadRemote = report?.deadRemote || [];
  const unused = report?.unused || [];
  const counts = report?.counts || { none: 0, remote: 0, asset: 0, key: 0 };
  const done = batch.filter((r) => r.state === 'ok' || r.state === 'bad').length;
  // Rows the editor is holding that carry no image at all. From the working
  // copy when there is one, so it reflects what the author is looking at.
  const withoutImage = Array.isArray(rows)
    ? rows.filter((r) => !r.removed && classifyImage(r.image) === 'none').length
    : counts.none;

  return (
    <div className="smed" data-theme="light">
      <p className="smed-lede">
        Pick the folder your pictures are in and they go straight to storage under{' '}
        <code>{mediaPrefix(setId)}</code>. A question finds its picture by <strong>file name</strong>:
        put <code>mona-lisa.jpg</code> in the question&rsquo;s Image field and upload a file called
        <code> mona-lisa.jpg</code>. Full <code>https://</code> addresses and repo assets starting with
        <code> /</code> are left exactly as they are and are not uploaded or checked here.
      </p>

      <div className="smed-tools">
        <label className="smed-picker smed-btn smed-btn--primary smed-btn--lg">
          <Icon name="FolderOpen" weight="bold" size={15} color="currentColor" />
          {uploading ? 'Uploading…' : 'Choose a folder of images'}
          <input
            ref={pickerRef}
            type="file"
            multiple
            /* Both spellings: `webkitdirectory` is what every shipping browser
               reads, `directory` is the standardised name. React lowercases
               unknown attributes, so they are written as data-free DOM props. */
            webkitdirectory=""
            directory=""
            accept="image/*"
            disabled={uploading || !setId}
            onChange={onPick}
            data-testid="smed-folder-input"
          />
        </label>
        <button
          type="button"
          className="smed-btn"
          onClick={verify}
          disabled={verifying || uploading}
          data-testid="smed-recheck"
        >
          <Icon name="ArrowsClockwise" weight="bold" size={14} color="currentColor" />
          {verifying ? 'Checking…' : 'Check again'}
        </button>
        {planNote && <span className="smed-tools-grow smed-note" title={planNote}>{planNote}</span>}
      </div>

      {uploading && (
        <div className="smed-progress" data-testid="smed-progress">
          <span>{done} of {batch.length}</span>
          <div className="smed-bar">
            <div
              className="smed-bar-fill"
              style={{ width: `${batch.length ? Math.round((done / batch.length) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {batch.length > 0 && (
        <div className="smed-scroll" data-testid="smed-batch">
          <table className="smed-tbl">
            <thead>
              <tr>
                <th className="smed-col-file">File</th>
                <th className="smed-col-state">State</th>
                <th className="smed-col-note">Where it went</th>
              </tr>
            </thead>
            <tbody>
              {batch.map((row) => (
                <tr key={row.name}>
                  <td><span className="smed-file" title={row.name}>{row.name}</span></td>
                  <td>
                    <span className={`smed-state smed-state--${row.state}`}>
                      {row.state === 'ok' && <Icon name="CheckCircle" weight="fill" size={13} color="currentColor" />}
                      {row.state === 'bad' && <Icon name="WarningOctagon" weight="fill" size={13} color="currentColor" />}
                      {row.state === 'ok' ? 'Uploaded'
                        : row.state === 'bad' ? 'Refused'
                          : row.state === 'busy' ? 'Sending' : 'Waiting'}
                    </span>
                  </td>
                  <td><span className="smed-note" title={row.note}>{row.note || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportError && (
        <div className="smed-report smed-report--bad" role="status">
          <h4>The check could not run</h4>
          <p>{reportError}</p>
        </div>
      )}

      {report && (
        <>
          <div className="smed-summary" data-testid="smed-summary">
            <span className="smed-chip" title="Questions in the version this check read">
              {report.totalQuestions} question{report.totalQuestions === 1 ? '' : 's'}
            </span>
            {/* The glyph has ONE owner. SetImageBadge is already the product's
                "this set has images" marker in four places, so its broken
                variant is the "…and one of them is not there" marker rather
                than a second icon that means the same thing in a different
                visual language. */}
            <span className={`smed-chip ${missing.length ? 'smed-chip--bad' : 'smed-chip--ok'}`}>
              <SetImageBadge hasImages={counts.key > 0} missingCount={missing.length} size={13} />
              {missing.length
                ? `${missing.length} image${missing.length === 1 ? '' : 's'} missing`
                : `${counts.key} uploaded image${counts.key === 1 ? '' : 's'} in place`}
            </span>
            {counts.remote > 0 && (
              <span
                className={`smed-chip${deadRemote.length ? ' smed-chip--bad' : ''}`}
                title={deadRemote.length
                  ? 'Full https:// addresses — checked live, and some did not answer with an image.'
                  : 'Full https:// addresses — each one checked live and answering.'}
              >
                {deadRemote.length
                  ? `${deadRemote.length} of ${counts.remote} web link${counts.remote === 1 ? '' : 's'} broken`
                  : `${counts.remote} web link${counts.remote === 1 ? '' : 's'} checked`}
              </span>
            )}
            {counts.asset > 0 && (
              <span className="smed-chip" title="Paths starting with / — files shipped with the app itself.">
                {counts.asset} built-in
              </span>
            )}
            {withoutImage > 0 && (
              <span className="smed-chip" title="These questions carry no image at all, which may be exactly right.">
                {withoutImage} with no image
              </span>
            )}
            {unused.length > 0 && (
              <span className="smed-chip smed-chip--warn">
                {unused.length} uploaded file{unused.length === 1 ? '' : 's'} nothing points at
              </span>
            )}
          </div>

          {/*
            DEAD WEB LINKS, beside the missing files — the Art set regression:
            an AI-drafted CSV pointed 26 questions at Wikimedia files that do
            not exist, nothing checked, and the blanks debuted on a projector.
            The endpoint now verifies every remote URL; this is where the
            verdicts land. 'dead' means the server answered and said no —
            replace the link; 'unreachable' means no answer inside the
            timeout — try the check again before rewriting anything.
          */}
          {deadRemote.length > 0 && (
            <div className="smed-report smed-report--bad" data-testid="smed-dead-remote">
              <h4>
                {deadRemote.length} web image link{deadRemote.length === 1 ? '' : 's'} did not answer with an image
              </h4>
              <p>
                These addresses were checked just now. A <b>dead</b> link got an answer like 404 —
                the file is not there under that name; fix the Image field on the question.
                An <b>unreachable</b> one got no answer in time — run the check again before
                changing anything.
              </p>
              <table className="smed-tbl">
                <thead>
                  <tr>
                    <th className="smed-col-q">#</th>
                    <th className="smed-col-title">Question</th>
                    <th className="smed-col-key">Link</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {deadRemote.map((row) => (
                    <tr key={row.sk || row.image}>
                      <td className="smed-num">{row.questionNumber ?? '—'}</td>
                      <td><span className="smed-file" title={row.title}>{row.title}</span></td>
                      <td><span className="smed-file" title={row.image}>{row.image}</span></td>
                      <td>{row.verdict === 'dead' ? `dead (${row.status})` : 'unreachable'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {missing.length > 0 ? (
            <div className="smed-report smed-report--bad" data-testid="smed-missing">
              <h4>
                {missing.length} question{missing.length === 1 ? '' : 's'} point
                {missing.length === 1 ? 's' : ''} at a file that is not there
              </h4>
              <p>
                Either the file has not been uploaded yet, or the name in the question does not
                match the name of the file. Upload the folder again, or correct the Image field on
                the question in the Questions panel above.
              </p>
              <table className="smed-tbl">
                <thead>
                  <tr>
                    <th className="smed-col-q">#</th>
                    <th className="smed-col-title">Question</th>
                    <th className="smed-col-key">Looking for</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.map((row) => (
                    <tr key={row.sk || row.image}>
                      <td className="smed-num">{row.questionNumber ?? '—'}</td>
                      <td><span className="smed-file" title={row.title}>{row.title}</span></td>
                      <td><span className="smed-file" title={row.image}>{row.image}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : deadRemote.length === 0 ? (
            <div className="smed-report smed-report--ok" data-testid="smed-allgood">
              <h4>Every image this set names is in place</h4>
              <p>
                {counts.key} uploaded file{counts.key === 1 ? '' : 's'} checked
                {counts.remote > 0
                  ? `, and ${report.remoteChecked ?? counts.remote} web link${counts.remote === 1 ? '' : 's'} answered`
                  : ''}
                {report.unverifiable > 0
                  ? `. ${report.unverifiable} question${report.unverifiable === 1 ? '' : 's'} use a built-in file, which is shipped with the app and not checked here.`
                  : '.'}
              </p>
            </div>
          ) : null}

          {unused.length > 0 && (
            <div className="smed-report" data-testid="smed-unused">
              <h4>{unused.length} uploaded file{unused.length === 1 ? '' : 's'} nothing points at</h4>
              <p>
                Harmless, and often a typo&rsquo;s other half — if a question is looking for
                <code> mona-lisa.jpg</code> and this list has <code>mona_lisa.jpg</code>, that is the
                same picture under two names. Nothing here is deleted.
              </p>
              <ul className="smed-keys">
                {unused.map((key) => <li key={key} title={key}>{key}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
