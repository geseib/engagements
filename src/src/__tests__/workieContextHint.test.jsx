import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import WorkieContextHint from '../components/WorkieContextHint';

const ALL = { background: true, setNote: true, eventDetails: false, hostInstructions: false, briefing: false };

test('lists the five kinds of context in the spec\'s order, ticked or dashed', () => {
  render(<WorkieContextHint contextUsed={ALL} />);
  expect(screen.getByTestId('workie-context-hint').textContent).toBe(
    'Workie had: question notes ✓ · set note ✓ · event details — · host instructions — · briefing —');
});

test('renders nothing for a summary written before the flags existed', () => {
  const { container } = render(<WorkieContextHint contextUsed={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('never mounted on the host page or its sidebar — both are surfaces the room can watch', () => {
  for (const rel of ['../GameHostPage.jsx', '../components/stage/SessionSetupPanel.jsx']) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect(src).not.toMatch(/WorkieContextHint/);
  }
});

test('mounted on the host remote', () => {
  const src = fs.readFileSync(path.join(__dirname, '../HostRemote.jsx'), 'utf8');
  expect(src).toMatch(/<WorkieContextHint\s+contextUsed=\{aiSummary\?\.contextUsed/);
});
