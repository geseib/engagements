/**
 * THE THREE TIERS — components/PromptPreflightPanel.jsx
 *
 * The report shape is the fixed contract with `utils/promptPreflight.js`:
 *
 *   { blocking: Finding[], silent: Finding[], advisory: Finding[], stats }
 *   Finding = { code, title, detail, evidence, fix }
 *
 * STUBBED HERE ON PURPOSE. These are the panel's tests, and a panel that only
 * draws correctly against one particular module's current output is not tested,
 * it is coincidental. Every report below is a literal.
 *
 * The assertion this file exists for is the third describe: SILENT MUST NOT
 * READ AS A MINOR WARNING. Every defect this repo has shipped into a live
 * prompt sits in that tier — a participation figure that was 100% by
 * construction, a consensus label computed from a comparison that could not
 * vary, a rule that rendered as "If 11 is 0". None of them failed anything.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so "louder" is asserted
 * as content and class, never as a measured size.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import PromptPreflightPanel, { blocksSave, findingCounts } from '../components/PromptPreflightPanel';

const finding = (code, extra = {}) => ({
  code,
  title: `${code} title`,
  detail: `${code} detail`,
  evidence: `${code} evidence`,
  fix: `${code} fix`,
  ...extra,
});

const report = (over = {}) => ({ blocking: [], silent: [], advisory: [], stats: {}, ...over });

describe('blocksSave is the one question the save button asks', () => {
  test('only a blocking finding blocks', () => {
    // rejects: `report.silent.length || report.blocking.length`, which would
    // make a silent finding stop a save. A silent finding is a thing the author
    // must READ, not a thing that makes the prompt unwritable — blocking it
    // would train people to clear the tier by deleting the variable rather than
    // by understanding it.
    expect(blocksSave(report({ blocking: [finding('b')] }))).toBe(true);
    expect(blocksSave(report({ silent: [finding('s')], advisory: [finding('a')] }))).toBe(false);
  });

  test('no report does not block', () => {
    // rejects: `!report` being read as "unsafe, therefore stop". The checks not
    // having run is not a finding, and a build without the module must still be
    // able to save a prompt.
    expect(blocksSave(null)).toBe(false);
    expect(blocksSave(undefined)).toBe(false);
  });

  test('counts survive a report missing a tier entirely', () => {
    // rejects: `report.silent.length` on a report that omits the key — one
    // undefined tier would throw and take the whole editor down.
    expect(findingCounts({ blocking: [finding('b')] })).toEqual({ blocking: 1, silent: 0, advisory: 0 });
  });
});

describe('the tiers are three different things, drawn three different ways', () => {
  test('each tier renders under its own heading', () => {
    // rejects: one merged "issues" list. The tiers differ in what happens next
    // — one stops the write, one ships quietly, one is worth knowing — and a
    // single list makes them all look like the middle one.
    render(<PromptPreflightPanel report={report({
      blocking: [finding('b')], silent: [finding('s')], advisory: [finding('a')],
    })} />);
    expect(within(screen.getByTestId('ppf-tier-blocking')).getByText(/Stops the save/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ppf-tier-silent')).getByText(/Saves fine\. Misbehaves quietly\./)).toBeInTheDocument();
    expect(within(screen.getByTestId('ppf-tier-advisory')).getByText(/Worth knowing/)).toBeInTheDocument();
  });

  test('an empty tier draws nothing at all', () => {
    // rejects: rendering an empty section with a zero count. Three headings
    // with two zeros beside them makes the one real finding harder to see.
    render(<PromptPreflightPanel report={report({ silent: [finding('s')] })} />);
    expect(screen.queryByTestId('ppf-tier-blocking')).toBeNull();
    expect(screen.queryByTestId('ppf-tier-advisory')).toBeNull();
  });

  test('a clean report says the checks ran and found nothing', () => {
    // rejects: rendering nothing on a clean report, which is indistinguishable
    // from the panel being broken or absent.
    render(<PromptPreflightPanel report={report()} />);
    expect(screen.getByText('Nothing found')).toBeInTheDocument();
  });
});

describe('SILENT is not a warning, and is not drawn as one', () => {
  const silentReport = report({ blocking: [finding('b')], silent: [finding('s')], advisory: [finding('a')] });

  test('the silent tier carries its evidence and its fix on the face of the panel', () => {
    // rejects: collapsing silent behind a "show detail" toggle, or dropping
    // `evidence`/`fix` from the render. A finding that saves fine and
    // misbehaves quietly is precisely the one nobody clicks into — the whole
    // reason it ships is that it never demanded attention.
    render(<PromptPreflightPanel report={silentReport} />);
    const tier = screen.getByTestId('ppf-tier-silent');
    expect(within(tier).getByText('s evidence')).toBeInTheDocument();
    expect(within(tier).getByText(/s fix/)).toBeInTheDocument();
  });

  test('advisory is the only tier allowed to be small', () => {
    // rejects: expanding every tier, which would flatten the three back into
    // one wall of text and lose the ranking the panel exists to express.
    render(<PromptPreflightPanel report={silentReport} />);
    const tier = screen.getByTestId('ppf-tier-advisory');
    expect(within(tier).getByText('a title')).toBeInTheDocument();
    expect(within(tier).queryByText('a evidence')).toBeNull();
    expect(within(tier).queryByText(/a fix/)).toBeNull();
  });

  test('the word "warning" is never used for the silent tier', () => {
    // rejects: relabelling this tier "Warnings". "Warning" is the word a reader
    // has been trained to skip, and the tier's lede has to say what actually
    // happens instead: it saves, it runs, and the room hears something wrong.
    render(<PromptPreflightPanel report={silentReport} />);
    const tier = screen.getByTestId('ppf-tier-silent');
    expect(tier.textContent.toLowerCase()).not.toContain('warning');
    expect(tier.textContent).toMatch(/nothing in the logs/i);
  });

  test('the silent tier is styled apart from blocking and advisory', () => {
    // rejects: reusing the blocking tier's class for silent. The stylesheet is
    // where "louder" is expressed — jsdom cannot measure it, so the hook it
    // hangs on is what gets asserted. See __tests__/promptEditorPalette.test.js
    // for the rule the class actually carries.
    render(<PromptPreflightPanel report={silentReport} />);
    expect(screen.getByTestId('ppf-tier-silent').className).toContain('ppf-tier--silent');
    expect(screen.getByTestId('ppf-tier-silent').className).not.toContain('ppf-tier--blocking');
  });
});

describe('the checks not running is a stated absence, not a green tick', () => {
  test('a missing module draws "the checks did not run"', () => {
    // rejects: rendering null, or rendering the clean state, when the report is
    // absent. "There is nothing wrong" and "nothing was checked" are different
    // sentences and this repo has shipped the first one meaning the second.
    render(<PromptPreflightPanel report={null} unavailable />);
    const absent = screen.getByTestId('prompt-preflight-absent');
    expect(within(absent).getByText(/The checks did not run/)).toBeInTheDocument();
    expect(absent.textContent).toMatch(/not the same as nothing being wrong/);
    expect(screen.queryByText('Nothing found')).toBeNull();
  });
});
