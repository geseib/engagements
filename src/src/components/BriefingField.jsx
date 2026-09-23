/**
 * WORKIE'S BRIEFING — the create dialog's document section, Call & Answer only.
 *
 * docs/design/session-setup-redesign 01, 03, 04 and RATIONALE §c. The owner:
 * upload a PDF "the same way as when creating a question set", have it
 * "summerized to inform the workie", so that when the room's answers touch its
 * facts — "open issues up 15%, MTTR at three weeks" — Workie can connect them.
 *
 *   empty    an invitation: choose a document, or write the key points
 *   working  read (a step that finishes), then write (one model call: a sweep,
 *            never a fake percentage). Nothing else in the dialog waits.
 *   ready    the briefing in an ordinary textarea, editable to the last
 *            character, with where it came from and how many names were left
 *            out. This is what the host signs off; it is all that is stored.
 *   limit    AMBER — a fact about the file: too large, slides, password,
 *            scanned pages (with a box to type the facts), truncated.
 *   failed   RED — something broke. Try again reuses the text already read,
 *            so a retry never re-uploads.
 *
 * The document and its full text are never stored; the dialog's payload
 * carries only `value`, the map below. The reader and the drafter are props so
 * each state can be driven in a test; the defaults are utils/documentText.js.
 *
 *   value = { text, source: { name, pages, chars, truncated } | null,
 *             namesRemoved, draftedAt, editedAt } | null
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';
import {
  readDocumentText, draftBriefing, BRIEFING_MAX_BYTES, NO_TEXT_BELOW,
} from '../utils/documentText';

const CAP = 1500;
const ACCEPT = '.pdf,.docx,.txt,.md,.pptx,.ppt,.key,.odp';
const LIMITS = ['too-large', 'slides', 'password', 'unsupported', 'no-text'];

const blank = () => ({ text: '', source: null, namesRemoved: 0, draftedAt: null, editedAt: null });
const sourceOf = (doc) => ({ name: doc.name, pages: doc.pages, chars: doc.chars, truncated: doc.truncated });
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const pagesLabel = (n) => `${n} page${n === 1 ? '' : 's'}`;

export default function BriefingField({
  value = null,
  onChange,
  onWorkingChange,
  readDocument = readDocumentText,
  requestDraft = draftBriefing,
}) {
  const textId = useId();
  const fileInput = useRef(null);
  const textRef = useRef(null);
  // Every start or stop takes a new token; a result carrying an old one is
  // dropped — "Stop and choose another" must not be overtaken by the draft.
  const token = useRef(0);
  const lastDoc = useRef(null);   // the text already read, for Try again
  const lastFile = useRef(null);  // the file, for a retry after a failed READ

  const [mode, setMode] = useState(value ? 'ready' : 'empty');
  const [step, setStep] = useState('reading');
  const [file, setFile] = useState(null);       // { name, size } on screen
  const [readInfo, setReadInfo] = useState(null);
  const [issue, setIssue] = useState(null);     // { code, message }
  const [focusText, setFocusText] = useState(false);

  useEffect(() => {
    if (focusText && textRef.current) { textRef.current.focus(); setFocusText(false); }
  }, [focusText, mode]);

  const working = (on) => onWorkingChange?.(on);

  const runDraft = async (doc, mine) => {
    setStep('writing');
    try {
      const drafted = await requestDraft({ text: doc.text, pages: doc.pages, truncated: doc.truncated });
      if (mine !== token.current) return;
      onChange?.({
        text: drafted.briefing,
        source: sourceOf(doc),
        namesRemoved: drafted.namesRemoved || 0,
        draftedAt: new Date().toISOString(),
        editedAt: null,
      });
      setIssue(null);
      setMode('ready');
    } catch (e) {
      if (mine !== token.current) return;
      setIssue({ code: 'failed', message: e.message });
      setMode('failed');
    } finally {
      if (mine === token.current) working(false);
    }
  };

  const start = async (picked) => {
    const mine = ++token.current;
    lastFile.current = picked;
    lastDoc.current = null;
    setFile({ name: picked.name, size: picked.size });
    setReadInfo(null);
    setIssue(null);
    setStep('reading');
    setMode('working');
    working(true);

    let doc;
    try {
      doc = await readDocument(picked, { maxBytes: BRIEFING_MAX_BYTES });
    } catch (e) {
      if (mine !== token.current) return;
      working(false);
      setIssue({ code: e.code || 'failed', message: e.message });
      setMode(LIMITS.includes(e.code) ? 'limit' : 'failed');
      return;
    }
    if (mine !== token.current) return;
    lastDoc.current = doc;
    setReadInfo({ pages: doc.pages, chars: doc.chars });

    // Scanned pages: parse-document succeeds with next to no text. A fact about
    // the file, not a fault — so amber, and a box for the facts instead.
    if (doc.text.trim().length < NO_TEXT_BELOW) {
      working(false);
      onChange?.({ ...blank(), source: sourceOf(doc) });
      setIssue({ code: 'no-text', message: 'No text in this PDF — it looks like scanned pages or pictures.' });
      setMode('limit');
      return;
    }
    await runDraft(doc, mine);
  };

  const onPicked = (e) => {
    const picked = e.target.files && e.target.files[0];
    // Cleared so choosing the SAME file again (after a fix) still fires.
    e.target.value = '';
    if (picked) start(picked);
  };

  const choose = () => fileInput.current && fileInput.current.click();

  const stop = () => {
    token.current += 1;
    working(false);
    setIssue(null);
    setFile(null);
    setMode(value && value.text ? 'ready' : 'empty');
  };

  const retry = () => {
    if (lastDoc.current) {
      const mine = ++token.current;
      setIssue(null);
      setMode('working');
      working(true);
      runDraft(lastDoc.current, mine);
    } else if (lastFile.current) {
      start(lastFile.current);
    }
  };

  const writeYourself = () => {
    token.current += 1;
    working(false);
    onChange?.(blank());
    setIssue(null);
    setMode('ready');
    setFocusText(true);
  };

  const remove = () => {
    token.current += 1;
    lastDoc.current = null;
    onChange?.(null);
    setIssue(null);
    setFile(null);
    setMode('empty');
  };

  const edit = (text) => onChange?.({ ...(value || blank()), text, editedAt: new Date().toISOString() });

  const text = (value && value.text) || '';
  const source = value && value.source;

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPT}
      className="gsd-brief-file"
      tabIndex={-1}
      aria-hidden="true"
      onChange={onPicked}
    />
  );

  const textBox = (
    <>
      <label className="gsd-label gsd-brief-label" htmlFor={textId}>What Workie will know</label>
      <textarea
        id={textId}
        ref={textRef}
        className="dialog-textarea gsd-brief-text"
        value={text}
        maxLength={CAP}
        placeholder="e.g. Open issues are up 15% on last quarter. Mean time to resolve is 3 weeks; the goal is 10 days."
        onChange={(e) => edit(e.target.value)}
      />
    </>
  );

  const sourceLine = (fileName, detail) => (
    <div className="gsd-src">
      <b title={fileName}>{fileName}</b>
      {detail && <><span className="sep">·</span>{detail}</>}
    </div>
  );

  if (mode === 'empty') {
    return (
      <div className="gsd-brief">
        {picker}
        <span className="gsd-brief-ico"><Icon name="FileText" weight="bold" size={18} color="currentColor" /></span>
        <div className="gsd-brief-main">
          <p className="gsd-brief-t">Brief Workie from a document <span className="gsd-fine">— optional</span></p>
          <p className="gsd-brief-d">
            A report, a review, a plan: whatever explains the situation this session is about.
            Workie gets a short summary of it — you read and can edit it first — and uses it when it
            reflects the room’s answers. <b>People who join never see it.</b>
          </p>
          <div className="gsd-brief-acts">
            <button type="button" className="gsd-btn" onClick={choose}>
              <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" />Choose a document
            </button>
            <span className="gsd-fine">PDF, Word or text · up to 4 MB</span>
            <button type="button" className="gsd-btn gsd-btn--link" onClick={writeYourself}>
              or write the key points yourself
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'working') {
    return (
      <div className="gsd-brief is-working" aria-busy="true">
        {picker}
        <span className="gsd-brief-ico"><Icon name="FileText" weight="bold" size={18} color="currentColor" /></span>
        <div className="gsd-brief-main">
          {file && sourceLine(file.name, mb(file.size))}
          <ol className="gsd-steps">
            {step === 'reading' ? (
              <li className="now"><span className="gsd-dot" aria-hidden="true" /><span>Reading the document…</span></li>
            ) : (
              <>
                <li className="done">
                  <span className="gsd-dot" aria-hidden="true">✓</span>
                  <span>
                    {readInfo && readInfo.pages ? `Read ${pagesLabel(readInfo.pages)}` : 'Read the document'}
                    {readInfo && <small>{`${readInfo.chars.toLocaleString('en-US')} characters of text`}</small>}
                  </span>
                </li>
                <li className="now">
                  <span className="gsd-dot" aria-hidden="true" />
                  <span>Writing the briefing… <small>usually under 15 seconds</small></span>
                </li>
              </>
            )}
          </ol>
          <div className="gsd-sweep" aria-hidden="true"><i /></div>
          <p className="gsd-brief-d">Keep filling in the rest — nothing else waits on this. The document itself is not kept.</p>
          <div className="gsd-brief-acts">
            <button type="button" className="gsd-btn gsd-btn--link" onClick={stop}>Stop and choose another</button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'limit') {
    const scanned = issue && issue.code === 'no-text';
    const detail = scanned && source && source.pages ? pagesLabel(source.pages) : (file ? mb(file.size) : null);
    return (
      <div className="gsd-brief is-limit">
        {picker}
        <span className="gsd-brief-ico">
          <Icon name={issue && issue.code === 'password' ? 'Lock' : 'Warning'} weight="bold" size={18} color="currentColor" />
        </span>
        <div className="gsd-brief-main">
          {file && sourceLine(file.name, detail)}
          <p className="gsd-brief-t">{issue && issue.message}</p>
          {issue && issue.code === 'too-large' && (
            <p className="gsd-brief-d">
              Pictures are usually the weight. Save a smaller copy (in Preview: <b>File › Export › Reduce File Size</b>;
              in Acrobat: <b>Compress PDF</b>), upload just the pages that matter, or write the key points yourself.
            </p>
          )}
          {scanned && (
            <>
              <p className="gsd-brief-d">
                Workie can only read text. Export the original again as a PDF (not a scan), or write the few facts
                that matter yourself — numbers, problems, goals:
              </p>
              {textBox}
            </>
          )}
          <div className="gsd-brief-acts">
            <button type="button" className="gsd-btn" onClick={choose}>
              <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" />Choose another
            </button>
            {!scanned && (
              <button type="button" className="gsd-btn gsd-btn--link" onClick={writeYourself}>
                write the key points yourself
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'failed') {
    const detail = readInfo && readInfo.pages ? `${pagesLabel(readInfo.pages)} read` : (file ? mb(file.size) : null);
    return (
      <div className="gsd-brief is-failed" role="alert">
        {picker}
        <span className="gsd-brief-ico"><Icon name="Warning" weight="bold" size={18} color="currentColor" /></span>
        <div className="gsd-brief-main">
          {file && sourceLine(file.name, detail)}
          <p className="gsd-brief-t">{issue && issue.message}</p>
          <p className="gsd-brief-d">Nothing is lost: try again, or write the key points yourself.</p>
          <div className="gsd-brief-acts">
            <button type="button" className="gsd-btn" onClick={retry}>
              <Icon name="ArrowCounterClockwise" weight="bold" size={16} color="currentColor" />Try again
            </button>
            <button type="button" className="gsd-btn gsd-btn--link" onClick={writeYourself}>
              write the key points yourself
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ready
  const truncated = !!(source && source.truncated);
  const names = (value && value.namesRemoved) || 0;
  return (
    <div className={`gsd-brief ${truncated ? 'is-limit' : 'is-ready'}`}>
      {picker}
      <span className="gsd-brief-ico">
        <Icon name={truncated ? 'Warning' : 'FileText'} weight="bold" size={18} color="currentColor" />
      </span>
      <div className="gsd-brief-main">
        <div className="gsd-row-between">
          {source && source.name ? (
            <div className="gsd-src">
              From <b title={source.name}>{source.name}</b>
              {source.pages ? <><span className="sep">·</span>{pagesLabel(source.pages)}</> : null}
            </div>
          ) : (
            <div className="gsd-src">Written by you</div>
          )}
          <div className="gsd-brief-acts">
            <button type="button" className="gsd-btn" onClick={choose}>
              <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" />Replace
            </button>
            <button type="button" className="gsd-btn" onClick={remove}>
              <Icon name="Trash" weight="bold" size={16} color="currentColor" />Remove
            </button>
          </div>
        </div>
        {truncated && (
          <>
            <p className="gsd-brief-t">
              {`Workie read the first 50,000 characters${source.pages ? ` of ${pagesLabel(source.pages)}` : ''}.`}
            </p>
            <p className="gsd-brief-d">
              The briefing below is written from those. If what matters is later in the document, add it below in
              your own words, or upload just those pages.
            </p>
          </>
        )}
        {textBox}
        <div className="gsd-row-between">
          <p className="gsd-kept">
            {names > 0 && <><b>{`${names} name${names === 1 ? '' : 's'} left out.`}</b>{' The summary keeps roles, not people — '}</>}
            {names > 0 ? 'nothing here is ever shown to the room.' : 'Nothing here is ever shown to the room.'}
          </p>
          <small className="dialog-help-text gsd-count">
            {`${text.length.toLocaleString('en-US')}/1,500 characters`}
          </small>
        </div>
      </div>
    </div>
  );
}
