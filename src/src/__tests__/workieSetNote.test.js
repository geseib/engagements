import { buildWorkieSetNote, SET_NOTE_MAX, SET_NOTE_FIXED_LINE } from '../utils/workieSetNote';

describe('buildWorkieSetNote — the set note is the admin\'s brief, never invented', () => {
  test('carries subject, audience, difficulty and the brief verbatim, then the fixed line', () => {
    const note = buildWorkieSetNote({
      subject: 'Version control', audience: 'the platform team', difficulty: 'medium',
      brief: 'We move from SVN to Git in January.',
    });
    expect(note).toContain('Version control');
    expect(note).toContain('the platform team');
    expect(note).toContain('medium');
    expect(note).toContain('We move from SVN to Git in January.');
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('the fixed line is the spec\'s text', () => {
    expect(SET_NOTE_FIXED_LINE).toBe('Each question carries Background notes from the set\'s author. '
      + 'Draw facts from those notes and from what the room says.');
  });

  test('empty parts leave no empty labels behind', () => {
    const note = buildWorkieSetNote({ subject: 'Trivia night', audience: '', difficulty: '', brief: '' });
    expect(note).not.toMatch(/Audience:\s*(\.|$)/m);
    expect(note).not.toMatch(/brief:\s*(\.|$)/im);
  });

  test('a long brief is trimmed so the whole note fits, and the fixed line survives', () => {
    const note = buildWorkieSetNote({ subject: 'S', audience: 'A', difficulty: 'easy', brief: 'x'.repeat(5000) });
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('no boilerplate the admin never wrote', () => {
    const note = buildWorkieSetNote({ subject: 'S', audience: '', difficulty: '', brief: '' });
    expect(note).not.toMatch(/professional development|encourage learning|constructive feedback/i);
  });

  test('900-char subject with empty brief stays under limit, no brief line, ends with fixed line', () => {
    const note = buildWorkieSetNote({ subject: 'S'.repeat(900), audience: '', difficulty: '', brief: '' });
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note).not.toMatch(/The author's brief/i);
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('500-char subject + 500-char audience + 500-char brief stays under limit', () => {
    const note = buildWorkieSetNote({
      subject: 'S'.repeat(500),
      audience: 'A'.repeat(500),
      difficulty: 'D'.repeat(500),
      brief: 'B'.repeat(500),
    });
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('empty brief never yields "The author\'s brief" line', () => {
    const note = buildWorkieSetNote({ subject: 'Test', audience: 'Users', difficulty: 'easy', brief: '' });
    expect(note).not.toMatch(/The author's brief/i);
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });
});

/*
 * A SET WHOSE QUESTIONS CARRY NO BACKGROUND MUST NOT SAY THEY DO.
 *
 * The fixed line tells Workie "Each question carries Background notes from the
 * set's author". Wavelength items never carry one (the players supply the
 * meaning; structured-generation.js writes `background` for call-and-answer
 * only), so for a wavelength set that line is a false statement to the model —
 * exactly the invented text this note exists to keep out. The builder asks for
 * the note without it.
 */
describe('buildWorkieSetNote — without the Background line', () => {
  test('leaves the fixed line out and keeps every word the admin typed', () => {
    const note = buildWorkieSetNote({
      subject: 'Remote work', audience: 'the platform team', difficulty: 'medium',
      brief: 'We moved to four office days in March.',
    }, { backgroundLine: false });
    expect(note).not.toContain(SET_NOTE_FIXED_LINE);
    expect(note).not.toMatch(/Background notes/i);
    expect(note).toContain('Remote work');
    expect(note).toContain('the platform team');
    expect(note).toContain('medium');
    expect(note).toContain('We moved to four office days in March.');
    expect(note).not.toMatch(/\n$/);
  });

  test('the default still carries it', () => {
    const note = buildWorkieSetNote({ subject: 'S', audience: '', difficulty: '', brief: '' });
    expect(note.endsWith(SET_NOTE_FIXED_LINE)).toBe(true);
  });

  test('a long brief still fits the limit', () => {
    const note = buildWorkieSetNote(
      { subject: 'S'.repeat(500), audience: 'A'.repeat(500), difficulty: 'easy', brief: 'x'.repeat(5000) },
      { backgroundLine: false },
    );
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note).not.toContain(SET_NOTE_FIXED_LINE);
    expect(note).toMatch(/The author's brief: x/);
  });

  test('a long subject with no brief still fits the limit', () => {
    const note = buildWorkieSetNote({ subject: 'S'.repeat(2000), audience: '', difficulty: '', brief: '' },
      { backgroundLine: false });
    expect(note.length).toBeLessThanOrEqual(SET_NOTE_MAX);
    expect(note).not.toContain(SET_NOTE_FIXED_LINE);
  });

  test('nothing typed is an empty note, never a line the admin did not write', () => {
    expect(buildWorkieSetNote({ subject: '', audience: '', difficulty: '', brief: '' },
      { backgroundLine: false })).toBe('');
  });
});
