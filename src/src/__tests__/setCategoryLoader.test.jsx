/**
 * THE STALE-CATEGORIES BUG, AT THE PAGE (docs/design/new-engagement README §2b).
 *
 * The owner: "if the users decides to change the question set during setup the
 * catagories of the old question set stay up". GameHostPage.fetchCategories
 * (1) did not clear before it awaited, (2) accepted whichever response arrived
 * last, (3) only logged a failure and never checked res.ok, so (4) Create could
 * send set A's categories for set B.
 *
 * GameHostPage cannot be mounted in jsdom (anonymitySetup.test.js:3-7), so the
 * request logic is the hook hooks/useSetCategoryLoader.js and the page wires
 * it; gameSetupCallSite-style source checks below hold the wiring.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import useSetCategoryLoader, { loadSetCategories } from '../hooks/useSetCategoryLoader';

const A = [{ name: 'Architecture', questionCount: 2 }, { name: 'Law', questionCount: 2 }];
const B = [{ name: 'Pricing', questionCount: 4 }];

/** A fetch whose responses the test releases one by one, in any order. */
function deferredFetch() {
  const pending = {};
  const fn = jest.fn((url) => new Promise((resolve, reject) => {
    const id = url.match(/question-sets\/([^/]+)\/categories/)[1];
    pending[id] = { resolve, reject };
  }));
  const answer = (id, body, ok = true, status = 200) => pending[id].resolve({ ok, status, json: async () => body });
  const fail = (id, err) => pending[id].reject(err);
  return { fn, answer, fail };
}

function harness(fetchImpl) {
  const state = { categories: A, active: new Set(A.map((c) => c.name)) };
  const setCategories = jest.fn((v) => { state.categories = v; });
  const setActiveCategoryIds = jest.fn((v) => { state.active = v; });
  const view = renderHook(() => useSetCategoryLoader({
    fetcher: fetchImpl, apiBase: 'https://api/', setCategories, setActiveCategoryIds,
  }));
  return { ...view, state, setCategories, setActiveCategoryIds };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('changing the set clears the old categories before the new ones arrive', () => {
  test('picking set B empties the list at once, before B\'s fetch resolves', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('setb', 'platform'); });
    // Set A's names are gone from the page state already.
    expect(h.state.categories).toEqual([]);
    expect(Array.from(h.state.active)).toEqual([]);
    expect(h.result.current.status).toEqual({ key: 'platform:setb', loading: true, error: '' });
    await act(async () => { f.answer('setb', { categories: B }); });
    await flush();
    expect(h.state.categories).toEqual(B);
    expect(Array.from(h.state.active)).toEqual(['Pricing']);
    expect(h.result.current.status).toEqual({ key: 'platform:setb', loading: false, error: '' });
  });

  test('a late response for set A, after set B is selected, is ignored', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('seta', 'platform'); });
    act(() => { h.result.current.load('setb', 'org'); });
    await act(async () => { f.answer('setb', { categories: B }); });
    await flush();
    await act(async () => { f.answer('seta', { categories: A }); });
    await flush();
    expect(h.state.categories).toEqual(B);
    expect(h.result.current.status.key).toBe('org:setb');
  });

  test('a failed fetch leaves zero categories and an error, not set A\'s', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('setb', 'platform'); });
    await act(async () => { f.fail('setb', new Error('network down')); });
    await flush();
    expect(h.state.categories).toEqual([]);
    expect(h.result.current.status.loading).toBe(false);
    expect(h.result.current.status.error).toMatch(/could not load/i);
  });

  test('a non-OK response is an error too — res.ok is checked', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('setb', 'platform'); });
    await act(async () => { f.answer('setb', { error: 'Forbidden' }, false, 403); });
    await flush();
    expect(h.state.categories).toEqual([]);
    expect(h.result.current.status.error).toMatch(/403|Forbidden/);
  });

  test('clearing the set (a format switch) clears, and a pending fetch is dropped', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('setb', 'platform'); });
    act(() => { h.result.current.load('', 'platform'); });
    expect(h.result.current.status).toEqual({ key: '', loading: false, error: '' });
    await act(async () => { f.answer('setb', { categories: B }); });
    await flush();
    expect(h.state.categories).toEqual([]);
  });

  test('claim() lets another caller retire a pending request', async () => {
    const f = deferredFetch();
    const h = harness(f.fn);
    act(() => { h.result.current.load('setb', 'platform'); });
    let ticket;
    act(() => { ticket = h.result.current.claim(); });
    expect(h.result.current.isCurrent(ticket)).toBe(true);
    await act(async () => { f.answer('setb', { categories: B }); });
    await flush();
    expect(h.state.categories).toEqual([]);
  });
});

describe('loadSetCategories', () => {
  test('names the library with ?scope=, and throws on a non-OK response', async () => {
    const fetcher = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(loadSetCategories({ fetcher, apiBase: 'https://api/', setId: 'x y', scope: 'org' }))
      .rejects.toThrow(/500/);
    expect(fetcher).toHaveBeenCalledWith('https://api/question-sets/x%20y/categories?scope=org');
  });
});

describe('the page wires it (GameHostPage cannot mount in jsdom)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const body = (name) => {
    const at = src.indexOf(`const ${name} = `);
    return src.slice(at, src.indexOf('\n  };', at));
  };

  test('handleSetupSetChange goes through the loader, not the unguarded fetch', () => {
    expect(body('handleSetupSetChange')).toMatch(/setCategoryLoader\.load\(/);
    expect(body('handleSetupSetChange')).not.toMatch(/fetchCategories\(/);
  });

  test('fetchCategories claims a ticket, checks res.ok and drops stale answers', () => {
    const fn = body('fetchCategories');
    expect(fn).toMatch(/setCategoryLoader\.claim\(\)/);
    expect(fn).toMatch(/isCurrent\(/);
    expect(fn).toMatch(/res\.ok/);
  });

  test('the create dialog is told whose categories it holds, and can retry', () => {
    expect(src).toMatch(/categoryStatus=\{setCategoryLoader\.status\}/);
    expect(src).toMatch(/onRetryCategories=/);
  });
});
