import React from 'react';
import { render } from '@testing-library/react';
import Icon, { ICONS } from '../components/Icon';
import RankIcon, { rankLabel } from '../components/RankIcon';
import StatusMessage from '../components/StatusMessage';
import { statusTone } from '../utils/statusTone';
import { GAME_TYPES, GAME_TYPE_LIST, PICKER_GAME_TYPES, UNPLAYABLE_GAME_TYPES, gameTypeMeta, gameTypeLabel, gameTypePromptKey, normalizeGameType, hasVotePhase } from '../config/gameTypes';

describe('Icon', () => {
  it('renders an svg for a known name', () => {
    const { container } = render(<Icon name="Trophy" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  // Icon falls back to Circle on an unknown name, so a bad map entry would ship
  // silently as a meaningless dot rather than failing loudly.
  it('every name in the map resolves to a real Phosphor component', () => {
    const broken = Object.entries(ICONS)
      .filter(([, C]) => typeof C !== 'function' && typeof C !== 'object')
      .map(([name]) => name);
    expect(broken).toEqual([]);
    expect(Object.keys(ICONS).length).toBeGreaterThan(70);
  });

  it('tags every icon with .ws-icon so the alignment rule applies', () => {
    const { container } = render(<Icon name="Trophy" />);
    expect(container.querySelector('svg')).toHaveClass('ws-icon');
  });

  it('merges a caller-supplied className instead of dropping it', () => {
    const { container } = render(<Icon name="Trophy" className="rank-icon" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('ws-icon');
    expect(svg).toHaveClass('rank-icon');
  });

  it('falls back to a shape rather than crashing on an unknown name', () => {
    const { container } = render(<Icon name="NotARealGlyph" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('honours the size prop', () => {
    const { container } = render(<Icon name="Trophy" size={48} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '48');
  });
});

describe('gameTypes registry', () => {
  it('covers all five engagement types', () => {
    expect(GAME_TYPE_LIST.map((t) => t.id).sort()).toEqual(
      ['call-and-answer', 'poll', 'survey', 'trivia', 'wavelength']
    );
  });

  it('every game type icon renders', () => {
    for (const type of GAME_TYPE_LIST) {
      const { container } = render(<Icon name={type.icon} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('normalises the storage spelling of call-and-answer', () => {
    expect(normalizeGameType('callandanswer')).toBe('call-and-answer');
    expect(gameTypeLabel('callandanswer')).toBe('Call & Answer');
    expect(gameTypePromptKey('call-and-answer')).toBe('callandanswer');
  });

  it('falls back to call-and-answer for unknown or missing types', () => {
    expect(normalizeGameType(undefined)).toBe('call-and-answer');
    expect(normalizeGameType('')).toBe('call-and-answer');
    expect(gameTypeMeta('nonsense').id).toBe('call-and-answer');
  });

  it('knows which types run a vote phase', () => {
    // These describe what GameHostPage.handleFinishQuestion ACTUALLY does: it
    // special-cases trivia and wavelength straight to results, and everything
    // else falls through to a vote. The table used to disagree on two of five
    // types and nothing caught it, because hasVotePhase had no runtime reader.
    expect(hasVotePhase('trivia')).toBe(false);
    expect(hasVotePhase('wavelength')).toBe(false);
    expect(hasVotePhase('call-and-answer')).toBe(true);
    expect(hasVotePhase('poll')).toBe(true);
    expect(hasVotePhase('survey')).toBe(true);
  });

  it('exposes a label and accent for every type', () => {
    for (const type of Object.values(GAME_TYPES)) {
      expect(type.label).toBeTruthy();
      expect(type.accent).toMatch(/^var\(--/);
    }
  });

  describe('what the create picker may offer', () => {
    // rejects: hand-listing the offered types, which is how the shipped
    // <select> ended up naming three of five and never noticing.
    it('is the whole registry minus the types that cannot be played', () => {
      expect(PICKER_GAME_TYPES.map((t) => t.id)).toEqual(
        GAME_TYPE_LIST.filter((t) => !UNPLAYABLE_GAME_TYPES.includes(t.id)).map((t) => t.id)
      );
    });

    // rejects: an exclusion id that does not name a real type — 'surveys',
    // 'Survey', a stale id — which would silently let the dead pill through.
    it('every excluded id names a real type', () => {
      for (const id of UNPLAYABLE_GAME_TYPES) {
        expect(GAME_TYPES[id]).toBeDefined();
      }
    });

    // upload-questions.js:146-157 rejects survey uploads outright, so a Survey
    // set cannot exist and the pill would be a dead end.
    it('holds survey, and offers poll', () => {
      expect(UNPLAYABLE_GAME_TYPES).toContain('survey');
      expect(PICKER_GAME_TYPES.map((t) => t.id)).toContain('poll');
      expect(PICKER_GAME_TYPES.map((t) => t.id)).not.toContain('survey');
    });

    // rejects: rendering a blurb line under the picker for a type that has none,
    // which would print an empty row.
    it('every offered type carries a blurb to print under the picker', () => {
      for (const type of PICKER_GAME_TYPES) {
        expect(typeof type.blurb).toBe('string');
        expect(type.blurb.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('RankIcon', () => {
  it('renders a placement mark for the podium and for the rest', () => {
    for (const rank of [1, 2, 3, 4, 27]) {
      const { container } = render(<RankIcon rank={rank} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('builds ordinal labels, including the teens', () => {
    expect(rankLabel(1)).toBe('1st Place');
    expect(rankLabel(2)).toBe('2nd Place');
    expect(rankLabel(3)).toBe('3rd Place');
    expect(rankLabel(4)).toBe('4th Place');
    expect(rankLabel(11)).toBe('11th Place');
    expect(rankLabel(12)).toBe('12th Place');
    expect(rankLabel(13)).toBe('13th Place');
    expect(rankLabel(21)).toBe('21st Place');
    expect(rankLabel(22)).toBe('22nd Place');
  });
});

describe('statusTone', () => {
  // Real strings from AdminPage / FileUploadPrompt. These used to be classified
  // by sniffing the copy for a ✅ / ❌, which broke when the emoji were removed.
  const cases = [
    ['Question set updated successfully', 'success'],
    ['tech.csv downloaded successfully', 'success'],
    ['File loaded: 12 questions detected. Fields auto-populated from CSV.', 'success'],
    ['File processed successfully', 'success'],
    ['Content added to prompt', 'success'],
    ['Upload failed: Unknown error', 'error'],
    ['Save failed: boom', 'error'],
    ['Failed to download template: x', 'error'],
    ['Please select a file first', 'error'],
    ['Please enter a title for the question set', 'error'],
    ['Invalid file type. Accepted formats: .csv', 'error'],
    ['File too large. Maximum size: 5.0MB', 'error'],
    ['Error: network down', 'error'],
    ['Title is required', 'error'],
    ['Processing question set...', 'pending'],
    ['Reading file...', 'pending'],
    ['Downloading template...', 'pending'],
    ['Saving...', 'pending'],
    ['', ''],
  ];

  it.each(cases)('classifies %p as %p', (message, expected) => {
    expect(statusTone(message)).toBe(expected);
  });
});

describe('StatusMessage', () => {
  it('renders nothing for an empty status', () => {
    const { container } = render(<StatusMessage message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('applies the tone class derived from the message', () => {
    const { container } = render(<StatusMessage message="Upload failed: nope" />);
    expect(container.firstChild).toHaveClass('error');
  });

  it('lets the caller override the tone', () => {
    const { container } = render(<StatusMessage message="anything" tone="success" />);
    expect(container.firstChild).toHaveClass('success');
  });

  it('announces itself to screen readers', () => {
    const { container } = render(<StatusMessage message="Saved" />);
    expect(container.firstChild).toHaveAttribute('role', 'status');
  });
});
