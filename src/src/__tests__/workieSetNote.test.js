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
});
