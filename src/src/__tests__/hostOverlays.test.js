import fs from 'fs';
import path from 'path';
import { shortcutsSuppressed, qrOverlayInstructions } from '../utils/hostOverlays';

const HOST_PAGE = path.join(__dirname, '..', 'GameHostPage.jsx');

/**
 * Spec §4 names this file's first block as the test worth writing carefully:
 * "Preview open leaves the SPACE shortcut live; pinned suppresses it ... the
 * assertion that would catch the regression a reviewer is most likely to
 * introduce by folding both states into one flag."
 *
 * GameHostPage cannot be rendered in jsdom (AuthProvider + a live socket), so
 * the rule was inline and untestable, and deleting `=== 'pinned'` broke
 * nothing. It is a pure function now, and this is what holds it.
 */
describe('shortcutsSuppressed — which overlays take SPACE away', () => {
  test('a hover/focus PREVIEW leaves the shortcut live', () => {
    // rejects: `Boolean(qrMode)`, `qrMode !== null`, `qrMode != null`, or any
    // other folding of preview and pinned into one flag. Every one of those
    // returns true here. A host who rests the mouse near the rail, or tabs
    // onto the session code, must not silently lose their advance key — and
    // the dock, which reads the same value, must not stop printing SPACE.
    expect(shortcutsSuppressed({ qrMode: 'preview' })).toBe(false);
  });

  test('a PINNED QR does suppress it', () => {
    // rejects: dropping the qrMode term entirely — a full-screen QR the host
    // deliberately pinned would then be advanced straight through.
    expect(shortcutsSuppressed({ qrMode: 'pinned' })).toBe(true);
  });

  test('with nothing open at all the shortcut is live', () => {
    expect(shortcutsSuppressed({})).toBe(false);
    expect(shortcutsSuppressed()).toBe(false);
    expect(shortcutsSuppressed({ qrMode: null })).toBe(false);
  });

  test('every reading/typing surface still suppresses it, one at a time', () => {
    // rejects: a refactor that keeps the qrMode rule but loses one of the
    // modal terms — each of these covers something the host is reading or
    // filling in, and SPACE firing underneath it advances a live room.
    for (const flag of ['showConfirmModal', 'showQuestionBrowser', 'showExpandedQR',
      'showReportsModal', 'lessonExpanded', 'isLoadingData']) {
      expect(shortcutsSuppressed({ [flag]: true })).toBe(true);
    }
  });

  test('preview does not cancel a suppression something else asked for', () => {
    // rejects: an implementation that returns `qrMode === 'pinned'` alone, or
    // otherwise lets the QR state override the modals.
    expect(shortcutsSuppressed({ qrMode: 'preview', showQuestionBrowser: true })).toBe(true);
  });

  test('the host page actually calls it, rather than keeping a private copy', () => {
    // rejects: leaving the inline Boolean(...) in GameHostPage and exporting
    // an unused helper — which is how qrOverlayClassName could stop being
    // called without a single test noticing.
    const source = fs.readFileSync(HOST_PAGE, 'utf8');
    expect(source).toMatch(/const anyOverlayOpen = shortcutsSuppressed\(/);
    expect(source).not.toMatch(/anyOverlayOpen = Boolean\(/);
  });
});

describe('qrOverlayInstructions — what the overlay tells the host to do', () => {
  test('a preview never says "click"', () => {
    // rejects: printing "Click anywhere to close" in preview mode. The preview
    // overlay is pointer-events:none, so with keyboard focus the host reads
    // that line, clicks in the lower third of the screen, and the click passes
    // through onto the dock's primary button — advancing the round while
    // answers are still arriving.
    const copy = qrOverlayInstructions('preview');
    expect(copy.toLowerCase()).not.toContain('click anywhere');
    expect(copy).toMatch(/Escape/);
  });

  test('a pinned QR — which does take clicks — still says click anywhere', () => {
    expect(qrOverlayInstructions('pinned')).toBe('Click anywhere to close');
  });

  test('the plain expanded-QR path (no qrMode) is unchanged', () => {
    expect(qrOverlayInstructions(null)).toBe('Click anywhere to close');
    expect(qrOverlayInstructions(undefined)).toBe('Click anywhere to close');
  });

  test('the host page renders the helper, not a hardcoded string', () => {
    // rejects: helper added, call site left alone.
    const source = fs.readFileSync(HOST_PAGE, 'utf8');
    expect(source).toMatch(/\{qrOverlayInstructions\(qrMode\)\}/);
    expect(source).not.toMatch(/expanded-qr-instructions">\s*\n\s*Click anywhere to close/);
  });
});
