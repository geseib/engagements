import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SKIN, SKIN_ID_RE, SKIN_STORAGE_KEY, isSkinId,
} from '../config/skins';

/**
 * THE SITE SKIN ON THE PAGE (docs/design/themes/SPEC.md §3, §5.3).
 *
 * The skin lives on <html data-skin> and nowhere else (skin never nests;
 * __tests__/skinLiteralsPalette.test.js refuses an element-level data-skin
 * outside this file and the SiteSkinPanel). Three moments set it:
 *
 *   1. BOOT. The inline script at the top of public/index.html copies the
 *      remembered id onto <html> before any stylesheet exists, so a returning
 *      visitor's first paint is already the right skin.
 *   2. REFRESH. This provider asks GET ${API_BASE}site once per page load —
 *      no auth header, so a plain GET with no preflight — and, when the answer
 *      is a skin this build knows, sets the attribute and remembers it. A
 *      failed or odd answer changes nothing: whatever booted stays.
 *   3. STAFF. The panel sets it for the staff member's own tab at once.
 *
 * A STAFF PREVIEW (SPEC Q7) is a second key, `engage.skin.preview`, that wins
 * over the site's answer in this browser only. The boot script reads it first
 * too. Clearing it returns the tab to the site's skin.
 *
 * Mounted in App.jsx OUTSIDE AuthProvider: marketing, /play and /present are
 * signed out and must wear the skin too.
 */
export const SKIN_PREVIEW_KEY = `${SKIN_STORAGE_KEY}.preview`;

function readKey(key) {
  try {
    const v = window.localStorage.getItem(key);
    return typeof v === 'string' && SKIN_ID_RE.test(v) ? v : null;
  } catch (_) {
    return null; // private mode, blocked storage
  }
}

function writeKey(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch (_) { /* private mode: the attribute still changes for this tab */ }
}

/** Put a skin on <html>. An unknown id renders Classic, so it is written as Classic. */
export function applySkin(id) {
  const next = isSkinId(id) ? id : DEFAULT_SKIN;
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root && root.dataset.skin !== next) root.dataset.skin = next;
  return next;
}

/** What the page is wearing right now. */
export function currentSkin() {
  const id = typeof document !== 'undefined' ? document.documentElement.dataset.skin : '';
  return isSkinId(id) ? id : DEFAULT_SKIN;
}

/** The site's skin as GET /site answers it, or null when the answer is unusable. */
export async function fetchSiteSkin(apiBase = (typeof window !== 'undefined' && window.API_BASE) || '') {
  if (!apiBase || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`${apiBase}site`, { method: 'GET', credentials: 'omit' });
    if (!res || !res.ok || typeof res.json !== 'function') return null;
    const body = await res.json();
    return body && isSkinId(body.skin) ? { skin: body.skin, updatedAt: body.updatedAt || null } : null;
  } catch (_) {
    return null;
  }
}

const SkinContext = createContext({
  skin: DEFAULT_SKIN,
  siteSkin: null,
  preview: null,
  setSiteSkin: () => {},
  setPreview: () => {},
});

export function useSkin() {
  return useContext(SkinContext);
}

export default function SkinProvider({ children }) {
  const [skin, setSkin] = useState(() => currentSkin());
  const [siteSkin, setSiteSkinState] = useState(null);
  const [preview, setPreviewState] = useState(() => {
    const stored = readKey(SKIN_PREVIEW_KEY);
    return isSkinId(stored) ? stored : null;
  });

  // The preview wins in this browser; otherwise the site's skin as GET /site
  // answered it; otherwise the last answer remembered here; otherwise Classic.
  // Never "whatever <html> wears now": after a preview that is the preview.
  useEffect(() => {
    const remembered = readKey(SKIN_STORAGE_KEY);
    const want = preview || siteSkin || (isSkinId(remembered) ? remembered : DEFAULT_SKIN);
    setSkin(applySkin(want));
  }, [preview, siteSkin]);

  useEffect(() => {
    let live = true;
    fetchSiteSkin().then((answer) => {
      if (!live || !answer) return;
      writeKey(SKIN_STORAGE_KEY, answer.skin);
      setSiteSkinState(answer.skin);
    });
    return () => { live = false; };
  }, []);

  /** After a staff save: the site's skin changed; this tab follows at once. */
  const setSiteSkin = useCallback((id) => {
    if (!isSkinId(id)) return;
    writeKey(SKIN_STORAGE_KEY, id);
    setSiteSkinState(id);
  }, []);

  /** A staff preview in this browser only; null ends it. */
  const setPreview = useCallback((id) => {
    const next = isSkinId(id) ? id : null;
    writeKey(SKIN_PREVIEW_KEY, next);
    setPreviewState(next);
  }, []);

  const value = useMemo(() => ({
    skin, siteSkin, preview, setSiteSkin, setPreview,
  }), [skin, siteSkin, preview, setSiteSkin, setPreview]);

  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}
