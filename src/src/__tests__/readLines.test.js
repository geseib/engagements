/*
  THE READ AS LINES THE HOST CAN BORROW (config/readLines.js). A Redo that
  read late answers ends with "Includes N answers that arrived late."
  (game/late-labels.js lateIncludedLine): a note about the read, never a line
  to borrow or to ask the room about.
*/
import fs from 'fs';
import path from 'path';
import { readLinesOf, LATE_INCLUDED_LINE } from '../config/readLines';

const READ = '## What the room said\n- Ship it on Friday.\n- Ask the customer first.';

test('the read\'s points become lines; headings are left out', () => {
  expect(readLinesOf(READ)).toEqual(['Ship it on Friday.', 'Ask the customer first.']);
});

test('the Redo line is never a line, singular or plural', () => {
  expect(readLinesOf(`${READ}\n\nIncludes 3 answers that arrived late.`)).toEqual(['Ship it on Friday.', 'Ask the customer first.']);
  expect(readLinesOf(`${READ}\n\nIncludes 1 answer that arrived late.`)).toEqual(['Ship it on Friday.', 'Ask the customer first.']);
});

test('a real line that happens to start "Includes" is kept', () => {
  expect(readLinesOf('Includes the cost of a rollback.')).toEqual(['Includes the cost of a rollback.']);
});

test('the pattern matches the server\'s line word for word', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lambda-functions', 'game', 'late-labels.js'), 'utf8');
  expect(src).toMatch(/`Includes \$\{n\} \$\{Number\(n\) === 1 \? 'answer' : 'answers'\} that arrived late\.`/);
  expect(LATE_INCLUDED_LINE.test('Includes 12 answers that arrived late.')).toBe(true);
});
