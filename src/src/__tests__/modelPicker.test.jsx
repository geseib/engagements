/**
 * DEV'S AI MODEL PICKER, STAFF ONLY (docs/handoff/ai-model-picker-2026-10-11.md).
 *
 * rejects: a "Redo with…" drawn when the server did not say the picker is on
 * (no flag, a non-staff answer, or a hostname guess); a menu item for an
 * Anthropic model that is not connected left clickable; a Compare view with
 * no footer, or a footer missing the model, provider, time, tokens, cost or
 * fallback; the host page passing the picker anywhere but What We Heard.
 *
 * GameHostPage cannot be rendered in jsdom (the auth provider), so its wiring
 * is pinned in source, as workieHostOptions.test.jsx does.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, renderHook, waitFor, within } from '@testing-library/react';

import WorkieSettings from '../components/stage/WorkieSettings';
import ModelCompare, { footerLine } from '../components/stage/ModelCompare';
import useModelPicker, { landedSince } from '../components/stage/useModelPicker';

const MODELS = [
  { id: 'bedrock-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'bedrock', priceIn: 1, priceOut: 5, isDefault: true, available: true },
  { id: 'bedrock-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'bedrock', priceIn: 3, priceOut: 15, isDefault: false, available: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', priceIn: 4, priceOut: 20, isDefault: false,
    available: false, unavailableReason: 'Anthropic API not connected' },
];
const INFO = { enabled: true, defaultModel: 'bedrock-haiku-4-5', models: MODELS };

const VARIANTS = [
  {
    modelRequested: 'bedrock-haiku-4-5', modelRequestedLabel: 'Claude Haiku 4.5', modelLabel: 'Claude Haiku 4.5',
    provider: 'bedrock', latencyMs: 6210, inputTokens: 4100, outputTokens: 700, costUsd: 0.0076,
    markdownResponse: '## What the room said\n\nHaiku wrote this.', generatedAt: '2026-10-11T10:00:00.000Z',
  },
  {
    modelRequested: 'claude-opus-5-5', modelRequestedLabel: 'Claude Opus 5.5', modelLabel: 'Claude Haiku 4.5',
    provider: 'bedrock', latencyMs: 7400, inputTokens: 4100, outputTokens: 690, costUsd: 0.00755,
    modelFallbackReason: 'not-connected',
    markdownResponse: '## What the room said\n\nThe fallback wrote this.', generatedAt: '2026-10-11T10:01:00.000Z',
  },
];

const picker = (over = {}) => ({
  info: INFO, variants: VARIANTS, pending: {}, error: '', compareOpen: false,
  redoWith: jest.fn(), openCompare: jest.fn(), closeCompare: jest.fn(), ...over,
});

describe('the menu is drawn only when the server says so', () => {
  it('no picker prop: the Workie section is what it was', () => {
    render(<WorkieSettings onRedo={() => {}} />);
    expect(screen.getByTestId('workie-redo')).toBeInTheDocument();
    expect(screen.queryByTestId('model-picker')).toBeNull();
    expect(screen.queryByText('Redo with…')).toBeNull();
  });

  it('a picker with no server flag (info null) draws nothing', () => {
    render(<WorkieSettings onRedo={() => {}} modelPicker={picker({ info: null })} />);
    expect(screen.queryByTestId('model-picker')).toBeNull();
  });

  it('no Redo on screen, no Redo with… either', () => {
    render(<WorkieSettings onRedo={null} modelPicker={picker()} />);
    expect(screen.queryByTestId('model-picker')).toBeNull();
  });

  it('with the flag: Redo with… opens a menu of the catalogue; choosing one starts it', () => {
    const p = picker();
    render(<WorkieSettings onRedo={() => {}} modelPicker={p} />);
    fireEvent.click(screen.getByTestId('model-redo-with'));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Claude Haiku 4.5 (default)');
    fireEvent.click(items[1]);
    expect(p.redoWith).toHaveBeenCalledWith('bedrock-sonnet-4-6');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('an Anthropic model that is not connected is disabled, and says why', () => {
    const p = picker();
    render(<WorkieSettings onRedo={() => {}} modelPicker={p} />);
    fireEvent.click(screen.getByTestId('model-redo-with'));
    const opus = screen.getByRole('menuitem', { name: /Claude Opus 5\.5/ });
    expect(opus).toBeDisabled();
    expect(opus).toHaveTextContent('Anthropic API not connected');
    fireEvent.click(opus);
    expect(p.redoWith).not.toHaveBeenCalled();
  });

  it('Escape or a click outside closes the menu', () => {
    render(<WorkieSettings onRedo={() => {}} modelPicker={picker()} />);
    fireEvent.click(screen.getByTestId('model-redo-with'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTestId('model-redo-with'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Compare opens the comparison', () => {
    const p = picker();
    render(<WorkieSettings onRedo={() => {}} modelPicker={p} />);
    fireEvent.click(screen.getByTestId('model-compare'));
    expect(p.openCompare).toHaveBeenCalled();
  });
});

describe('Compare: every model\'s latest read, each with its footer', () => {
  it('renders each variant and its footer line', () => {
    render(<ModelCompare variants={VARIANTS} models={MODELS} onClose={() => {}} />);
    expect(screen.getByText('Haiku wrote this.')).toBeInTheDocument();
    expect(screen.getByText('The fallback wrote this.')).toBeInTheDocument();
    const footers = screen.getAllByTestId('variant-footer');
    expect(footers).toHaveLength(2);
    expect(footers[0]).toHaveTextContent('Claude Haiku 4.5 · Bedrock · 6.2 s · 4,100 in / 700 out · about $0.008');
    expect(footers[1]).toHaveTextContent('Claude Opus 5.5');
    expect(footers[1]).toHaveTextContent('fell back to Claude Haiku 4.5: Anthropic API not connected');
  });

  it('a model still writing shows as writing', () => {
    render(<ModelCompare variants={[]} pending={{ 'bedrock-sonnet-4-6': Date.now() }} models={MODELS} onClose={() => {}} />);
    expect(within(screen.getByTestId('variant-bedrock-sonnet-4-6')).getByText('Writing…')).toBeInTheDocument();
  });

  it('nothing yet says so and names the way to make one', () => {
    render(<ModelCompare variants={[]} models={MODELS} onClose={() => {}} />);
    expect(screen.getByText(/No model reads of this round yet/)).toBeInTheDocument();
  });

  it('an X and a bottom Close, both closing', () => {
    const onClose = jest.fn();
    render(<ModelCompare variants={VARIANTS} models={MODELS} onClose={onClose} />);
    const closes = screen.getAllByRole('button', { name: 'Close' });
    expect(closes.map((b) => b.className)).toEqual(['mcmp-x', 'mcmp-btn']);
    closes.forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('footerLine: the template is named, and a tiny cost is not printed as $0.000', () => {
    expect(footerLine({ modelLabel: 'Claude Haiku 5.5', provider: 'anthropic', costUsd: 0.0004, fallback: true }))
      .toBe('Claude Haiku 5.5 · Anthropic API · under $0.001 · template, not a model read');
  });
});

describe('useModelPicker: the flag comes from the server', () => {
  const answer = (body) => jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));

  it('asks the host route for the variants of the round on screen', async () => {
    const fetchFn = answer({ modelPicker: INFO, variants: VARIANTS });
    const { result } = renderHook(() => useModelPicker({
      gameId: '4242', round: '003', staff: true, fetchFn, apiBase: 'https://api.test/',
    }));
    await waitFor(() => expect(result.current.info).toEqual(INFO));
    expect(fetchFn).toHaveBeenCalledWith('https://api.test/games/4242/ai-summary/host?questionId=003&variants=true');
    expect(result.current.variants).toHaveLength(2);
  });

  it('an ordinary read (no modelPicker in the answer) leaves it off', async () => {
    const fetchFn = answer({ summary: 'x', markdownResponse: '## x' });
    const { result } = renderHook(() => useModelPicker({
      gameId: '4242', round: '003', staff: true, fetchFn, apiBase: 'https://api.test/',
    }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(result.current.info).toBeNull();
  });

  it('not staff, or off What We Heard: no request at all', () => {
    const fetchFn = answer({ modelPicker: INFO });
    renderHook(() => useModelPicker({ gameId: '4242', round: '003', staff: false, fetchFn, apiBase: '' }));
    renderHook(() => useModelPicker({ gameId: '4242', round: null, staff: true, fetchFn, apiBase: '' }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('landedSince: a read written after the request counts, an older one does not', () => {
    const at = Date.parse('2026-10-11T10:00:30.000Z');
    expect(landedSince(VARIANTS, 'claude-opus-5-5', at)).toBe(true);
    expect(landedSince(VARIANTS, 'bedrock-haiku-4-5', at)).toBe(false);
  });
});

describe('wiring and design contract, in source', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  it('the host page hands the picker to WorkieSettings only on What We Heard', () => {
    const src = read('GameHostPage.jsx');
    expect(src).toMatch(/modelPicker: hostPhase === 'FIELD_NOTES' \? modelPicker : null/);
    expect(src).toMatch(/useModelPicker\(\{/);
  });

  it('no hostname is consulted to decide whether the picker exists', () => {
    for (const f of ['components/stage/useModelPicker.js', 'components/stage/ModelCompare.jsx']) {
      expect(read(f).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/location\.host|hostname/);
    }
  });

  it('the stylesheet: tokens only, no orange, nothing under 12px, a scrolling scrim', () => {
    const css = read('components/stage/ModelCompare.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/var\(--primary/);
    expect(css).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(css).toMatch(/\.mcmp-scrim\s*\{[^}]*align-items:\s*flex-start[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.mcmp\s*\{[^}]*margin:\s*auto/);
    // Every selector is in this sheet's own scope.
    for (const sel of css.match(/^[^{}@]+(?=\{)/gm) || []) {
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.mcmp/);
    }
  });

  it('the menu is kept on screen', () => {
    expect(read('components/stage/ModelCompare.jsx')).toMatch(/useKeepOnScreen\(menuRef, open\)/);
  });
});
