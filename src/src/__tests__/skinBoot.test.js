/**
 * THE SKIN BOOT SCRIPT (public/index.html) AND THE PROVIDER BEHIND IT
 * (components/SkinProvider.jsx) — docs/design/themes/SPEC.md §5.3, §7.
 *
 * The boot script is what makes a returning visitor's FIRST paint the right
 * skin: the app's CSS arrives with the bundle (style-loader), so an attribute
 * set by an inline script in <head> is in place before any styled paint. This
 * fails when the script is missing, comes after the first <script src>, stops
 * wrapping storage in try/catch, or drifts from the id shape config/skins.js
 * accepts. It also RUNS the script, in this jsdom, against the cases that
 * matter: nothing stored, a stored id, a staff preview, junk, and a storage
 * that throws (private mode).
 *
 * Then the provider: a usable GET /site answer is applied and remembered; an
 * unusable one changes nothing; no API configured asks nothing.
 *
 * What green cannot prove: that a real browser paints no flash. Only a fresh
 * private window on dev can (PLAN 0d "done when").
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import SkinProvider, { fetchSiteSkin } from '../components/SkinProvider';
import { SKIN_ID_RE, SKIN_STORAGE_KEY } from '../config/skins';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const scripts = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2], at: m.index }));
const boot = scripts.find((s) => !/\bsrc=/.test(s.attrs) && /dataset\.skin/.test(s.body));

describe('the boot script in public/index.html', () => {
  test('exists, inline, in <head>', () => {
    expect(boot).toBeTruthy();
    expect(boot.at).toBeLessThan(HTML.indexOf('</head>'));
  });

  test('runs before the first <script src> and before any stylesheet link', () => {
    const firstSrc = scripts.find((s) => /\bsrc=/.test(s.attrs));
    if (firstSrc) expect(boot.at).toBeLessThan(firstSrc.at);
    const firstSheet = HTML.search(/<link[^>]+rel="stylesheet"/);
    if (firstSheet >= 0) expect(boot.at).toBeLessThan(firstSheet);
  });

  test('wraps storage in try/catch', () => {
    expect(boot.body).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch\s*\(/);
  });

  test('accepts exactly the id shape config/skins.js accepts, under the same key', () => {
    const re = boot.body.match(/\/(\^\[a-z\][^/]*\$)\/\.test/);
    expect(re).toBeTruthy();
    expect(re[1]).toBe(SKIN_ID_RE.source);
    expect(boot.body).toContain(`'${SKIN_STORAGE_KEY}'`);
    expect(boot.body).toContain(`'${SKIN_STORAGE_KEY}.preview'`);
  });

  describe('run', () => {
    const run = () => { new Function(boot.body)(); }; // eslint-disable-line no-new-func
    beforeEach(() => { window.localStorage.clear(); delete document.documentElement.dataset.skin; });

    test('nothing stored: no attribute, so bare :root renders Classic', () => {
      run();
      expect(document.documentElement.dataset.skin).toBeUndefined();
    });
    test('a stored skin is put on <html>', () => {
      window.localStorage.setItem('engage.skin', 'present');
      run();
      expect(document.documentElement.dataset.skin).toBe('present');
    });
    test('a staff preview wins over the stored skin', () => {
      window.localStorage.setItem('engage.skin', 'classic');
      window.localStorage.setItem('engage.skin.preview', 'present');
      run();
      expect(document.documentElement.dataset.skin).toBe('present');
    });
    test('junk is ignored', () => {
      window.localStorage.setItem('engage.skin', '"><script>');
      run();
      expect(document.documentElement.dataset.skin).toBeUndefined();
    });
    test('a storage that throws (private mode) is survived', () => {
      const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
      expect(run).not.toThrow();
      expect(document.documentElement.dataset.skin).toBeUndefined();
      spy.mockRestore();
    });
  });
});

describe('SkinProvider asks GET /site once and follows a usable answer', () => {
  beforeEach(() => {
    window.API_BASE = 'https://api.test/';
    window.localStorage.clear();
    delete document.documentElement.dataset.skin;
  });

  test('a usable answer: applied to <html> and remembered', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ skin: 'present', updatedAt: '2026-10-13T00:00:00Z' }) }));
    render(<SkinProvider><p>page</p></SkinProvider>);
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('present'));
    expect(window.localStorage.getItem('engage.skin')).toBe('present');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.test/site');
    // No auth header, so no preflight: a plain GET.
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  test('a failed answer changes nothing that booted', async () => {
    window.localStorage.setItem('engage.skin', 'present');
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    render(<SkinProvider><p>page</p></SkinProvider>);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(document.documentElement.dataset.skin).toBe('present');
    expect(window.localStorage.getItem('engage.skin')).toBe('present');
  });

  test('an unknown skin from the server is ignored, not stored', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ skin: 'neon' }) }));
    expect(await fetchSiteSkin('https://api.test/')).toBeNull();
  });

  test('a network error is survived', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchSiteSkin('https://api.test/')).toBeNull();
  });

  test('no API configured: nothing is asked', async () => {
    global.fetch = jest.fn();
    expect(await fetchSiteSkin('')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
