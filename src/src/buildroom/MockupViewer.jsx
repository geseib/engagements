/**
 * THE MOCKUP VIEWER (docs/design/build-room-history-and-stage-decide R2).
 *
 * One viewer wherever a mockup can be opened: History's window, the Build
 * screen, the Host's path and queue, the Stage's Edit window. It fills the
 * screen and flips between the choices that have a picture (tabs, the two
 * arrows, the left and right keys, a swipe). Back is named for where it was
 * opened from and leaves that place exactly as it was; Esc is Back.
 *
 * The page keeps `viewer = { askId, label, from, backLabel }` and puts
 * `openViewer` in ViewerContext, so a picture anywhere can open it without the
 * prop being threaded through.
 */
import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import BuildImage, { useImageUrl } from './BuildImage';

/** `(askId, label, from) => void`, or null where a surface has no viewer. */
export const ViewerContext = createContext(null);

const SWIPE_PX = 50;
const askNo = (askId) => Number(askId) || askId;

/** Where Back goes, in words. `from` is history | build | host | stage | stage-edit. */
export function backLabelFor(from, askId) {
  if (from === 'history') return askId ? `Back to Ask ${askNo(askId)}` : 'Back to History';
  if (from === 'build') return 'Back to the build';
  if (from === 'stage') return 'Back to the Stage';
  if (from === 'stage-edit') return 'Back to Change before sending';
  return 'Back to the Host screen';
}

/** The small link for putting a picture on a second screen: the only thing here that opens a tab. */
function FullSize({ imageId }) {
  const url = useImageUrl(imageId);
  if (!url) return null;
  return <a className="brm-viewer-full" href={url} target="_blank" rel="noopener noreferrer" title="Opens in a new tab">Open full size (new tab) ↗</a>;
}

/** One picture on its own (a screenshot, not a choice): the picture, its caption, Back. */
function PictureViewer({ image, backLabel, onBack }) {
  return (
    <Modal overlayClassName="brm-viewer" contentClassName="brm-viewer-in" onClose={onBack} closeOnBackdrop={false} label="Picture viewer">
      <div className="brm-viewer-top">
        <button type="button" className="brm-btn brm-btn--sm" onClick={onBack}>
          <Icon name="CaretLeft" size={14} /> {backLabel}
        </button>
        {image.caption ? <b className="brm-viewer-q">{image.caption}</b> : null}
      </div>
      <div className="brm-viewer-main" data-testid="brm-viewer-main">
        <BuildImage imageId={image.imageId} alt={image.caption || 'Screenshot'} className="brm-viewer-pic" linked={false} />
      </div>
      <div className="brm-viewer-foot">
        <span><kbd>Esc</kbd> to go back</span>
        <span className="brm-push"><FullSize imageId={image.imageId} /></span>
      </div>
    </Modal>
  );
}

export default function MockupViewer(props) {
  return props.image ? <PictureViewer {...props} /> : <ChoiceViewer {...props} />;
}

function ChoiceViewer({ ask, startLabel, backLabel, onBack }) {
  const pics = (ask.options || []).filter((o) => o.imageId);
  const [label, setLabel] = useState(startLabel);
  const at = Math.max(0, pics.findIndex((o) => o.label === label));
  const here = pics[at];
  const chosen = (ask.decision && ask.decision.chosen) || [];
  const go = useCallback((d) => {
    setLabel((cur) => {
      const i = Math.max(0, pics.findIndex((o) => o.label === cur));
      const next = Math.min(pics.length - 1, Math.max(0, i + d));
      return pics[next] ? pics[next].label : cur;
    });
  }, [pics]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go]);

  const downX = useRef(null);
  // Nothing to look at (the ask has no pictured option): go back rather than show a blank screen.
  useEffect(() => { if (!here) onBack(); }, [here, onBack]);
  if (!here) return null;
  return (
    <Modal overlayClassName="brm-viewer" contentClassName="brm-viewer-in" onClose={onBack} closeOnBackdrop={false} label="Mockup viewer">
      <div className="brm-viewer-top">
        <button type="button" className="brm-btn brm-btn--sm" onClick={onBack}>
          <Icon name="CaretLeft" size={14} /> {backLabel}
        </button>
        <b className="brm-viewer-q">{ask.prompt}</b>
        <div className="brm-viewer-tabs" role="tablist" aria-label="Choices">
          {pics.map((o) => (
            <button key={o.label} type="button" role="tab" aria-selected={o.label === here.label} className={`brm-viewer-tab${o.label === here.label ? ' is-on' : ''}`} onClick={() => setLabel(o.label)}>
              {o.label} · {o.title}{chosen.includes(o.label) ? ' · picked' : ''}
            </button>
          ))}
        </div>
        <span className="brm-viewer-n">{at + 1} of {pics.length}</span>
      </div>
      <div
        className="brm-viewer-main"
        data-testid="brm-viewer-main"
        onPointerDown={(e) => { downX.current = e.clientX; }}
        onPointerUp={(e) => {
          if (downX.current === null) return;
          const dx = e.clientX - downX.current;
          downX.current = null;
          if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
        }}
      >
        <button type="button" className="brm-viewer-arrow brm-viewer-arrow--l" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous choice"><Icon name="CaretLeft" size={22} /></button>
        <BuildImage imageId={here.imageId} alt={`Choice ${here.label}: ${here.title}`} className="brm-viewer-pic" linked={false} />
        <button type="button" className="brm-viewer-arrow brm-viewer-arrow--r" onClick={() => go(1)} disabled={at === pics.length - 1} aria-label="Next choice"><Icon name="CaretRight" size={22} /></button>
      </div>
      <div className="brm-viewer-foot">
        <span><kbd>←</kbd> <kbd>→</kbd> to flip</span>
        <span><kbd>Esc</kbd> to go back</span>
        <span className="brm-push"><FullSize imageId={here.imageId} /></span>
        <span>Mockup {here.label}{chosen.includes(here.label) ? ' · picked' : ''}</span>
      </div>
    </Modal>
  );
}
