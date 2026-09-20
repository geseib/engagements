import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SetTopicField from '../components/SetTopicField';
import { SET_TOPICS, SET_TOPIC_IDS, MAX_SET_TAGS } from '../config/setTopics';

/**
 * CHOOSING A SHELF IS ONE CONTROL, AND THE PROPOSAL IS ONE CLICK.
 *
 * The control is pure — props in, callbacks out, no `authFetch` — so every
 * screen that files a set (the editor, the CSV upload, a set carved out of a
 * working copy) shows the same thing and there is one place to test it.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine; everything below is
 * roles, names, values and text.
 */

const LABELS = SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label);

/** The control is controlled; this is the smallest honest host for it. */
function Host({ topic: seed = '', tags: seedTags = [], ...props }) {
  const [topic, setTopic] = useState(seed);
  const [tags, setTags] = useState(seedTags);
  return (
    <SetTopicField
      idPrefix="t"
      topic={topic}
      onTopicChange={setTopic}
      tags={tags}
      onTagsChange={setTags}
      {...props}
    />
  );
}

const picker = () => screen.getByLabelText(/topic/i);
const selectable = () => [...picker().querySelectorAll('option')].filter((o) => !o.disabled);

describe('the picker is the shelf, and only the shelf', () => {
  it('offers exactly the fifteen, in the order the module lists them', () => {
    render(<Host topic="history" />);
    expect(selectable().map((o) => o.textContent)).toEqual(LABELS);
  });

  it('offers no way to type a shelf of your own', () => {
    // rejects: a text input or a combobox with inline create. The shelf is a
    // CLOSED list — a sixteenth one would be a shelf no filter and no browse
    // has heard of, which is the whole reason there is a fixed list at all.
    render(<Host topic="history" />);
    expect(picker().tagName).toBe('SELECT');
  });

  it('hands back the stored id, not the label on screen', () => {
    const onTopicChange = jest.fn();
    render(<SetTopicField idPrefix="t" topic="history" onTopicChange={onTopicChange} tags={[]} onTagsChange={jest.fn()} />);
    fireEvent.change(picker(), { target: { value: 'science-technology' } });
    expect(onTopicChange).toHaveBeenCalledWith('science-technology');
  });

  it('says what the chosen shelf covers, so the choice is not a guess', () => {
    render(<Host topic="general-knowledge" />);
    expect(screen.getByText(SET_TOPICS['general-knowledge'].blurb)).toBeInTheDocument();
  });
});

describe('a set on no shelf says so, and says what to do about it', () => {
  it('reads as Unfiled rather than silently showing the first shelf', () => {
    // rejects: `value={topic || SET_TOPIC_IDS[0]}`. A native select with no
    // matching option shows its first one, so an unfiled set would read as
    // "Arts & Culture" — a shelf nobody chose, stated as fact.
    render(<Host topic="" />);
    expect(picker()).toHaveValue('');
    expect(screen.getByTestId('t-unfiled')).toHaveTextContent(/unfiled/i);
  });

  it('the Unfiled state is not itself choosable', () => {
    render(<Host topic="" />);
    expect(selectable().map((o) => o.textContent)).toEqual(LABELS);
  });

  it('stops saying it the moment a shelf is chosen', () => {
    render(<Host topic="" />);
    fireEvent.change(picker(), { target: { value: 'music' } });
    expect(screen.queryByTestId('t-unfiled')).not.toBeInTheDocument();
  });

  it('a set that IS filed never shows the Unfiled line', () => {
    render(<Host topic="music" />);
    expect(screen.queryByTestId('t-unfiled')).not.toBeInTheDocument();
  });
});

describe('the proposal from the check', () => {
  const suggestion = (over = {}) => ({
    topic: 'science-technology', tags: [], filedAs: '', mismatch: false, ...over,
  });

  it('files the set in one click', () => {
    render(<Host topic="" suggestion={suggestion()} />);
    fireEvent.click(screen.getByRole('button', { name: /science & technology/i }));
    expect(picker()).toHaveValue('science-technology');
  });

  it('is not offered when the set is already on that shelf', () => {
    // Nothing to accept, so there is nothing to draw — and a button that
    // changes nothing is the control people press twice wondering why.
    render(<Host topic="science-technology" suggestion={suggestion()} />);
    expect(screen.queryByTestId('t-suggestion')).not.toBeInTheDocument();
  });

  it('is not offered when the check named no shelf this product knows', () => {
    render(<Host topic="" suggestion={suggestion({ topic: '' })} />);
    expect(screen.queryByTestId('t-suggestion')).not.toBeInTheDocument();
  });

  it('is not drawn at all when no check has run', () => {
    render(<Host topic="" suggestion={null} />);
    expect(screen.queryByTestId('t-suggestion')).not.toBeInTheDocument();
  });
});

describe('a shelf the content contradicts is said once, and blocks nothing', () => {
  const MISMATCH = {
    topic: 'science-technology', tags: [], filedAs: 'music', mismatch: true,
  };

  it('says it once — one sentence, in one place', () => {
    render(<Host topic="music" suggestion={MISMATCH} />);
    expect(screen.getAllByTestId('t-mismatch')).toHaveLength(1);
    expect(screen.getByTestId('t-mismatch')).toHaveTextContent(/science & technology/i);
  });

  it('leaves the shelf the person chose exactly where it is', () => {
    // rejects: a check that re-files somebody's set. It is a helper, never a
    // gate — the library does not rearrange itself behind its owner.
    render(<Host topic="music" suggestion={MISMATCH} />);
    expect(picker()).toHaveValue('music');
  });

  it('is nothing a person has to answer before carrying on', () => {
    render(<Host topic="music" suggestion={MISMATCH} />);
    expect(screen.getByTestId('t-mismatch').querySelectorAll('button')).toHaveLength(0);
    expect(picker()).toBeEnabled();
  });

  it('goes quiet once the shelf it argued with is no longer the one chosen', () => {
    // `filedAs` is what the set carried WHEN it was checked. Once the person
    // has moved it, the sentence is about a decision that no longer exists —
    // and repeating it would be the product arguing with a change it asked for.
    render(<Host topic="music" suggestion={MISMATCH} />);
    fireEvent.change(picker(), { target: { value: 'history' } });
    expect(screen.queryByTestId('t-mismatch')).not.toBeInTheDocument();
  });

  it('says nothing where the check found no contradiction', () => {
    render(<Host topic="music" suggestion={{ ...MISMATCH, mismatch: false }} />);
    expect(screen.queryByTestId('t-mismatch')).not.toBeInTheDocument();
  });
});

describe('the set’s own tags', () => {
  const typeTag = (text) => {
    fireEvent.change(screen.getByLabelText(/^tags$/i), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /^add tag$/i }));
  };

  it('adds one, canonicalised the way it will be stored', () => {
    render(<Host topic="music" />);
    typeTag('New Wave');
    expect(within(screen.getByTestId('t-tag-list')).getByText('new-wave')).toBeInTheDocument();
  });

  it('holds what is typed exactly as typed, mid-word hyphen and all', () => {
    // rejects: normalising on every keystroke. It eats the trailing hyphen out
    // of "remote-" the instant it is typed (utils/tags.js's editing note).
    render(<Host topic="music" />);
    const input = screen.getByLabelText(/^tags$/i);
    fireEvent.change(input, { target: { value: 'remote-' } });
    expect(input).toHaveValue('remote-');
  });

  it('clears the box after an add, so the next tag starts empty', () => {
    render(<Host topic="music" />);
    typeTag('pop');
    expect(screen.getByLabelText(/^tags$/i)).toHaveValue('');
  });

  it('adds on Enter without submitting anything around it', () => {
    render(<Host topic="music" />);
    const input = screen.getByLabelText(/^tags$/i);
    fireEvent.change(input, { target: { value: 'synth' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(screen.getByTestId('t-tag-list')).getByText('synth')).toBeInTheDocument();
  });

  it('removes one', () => {
    render(<Host topic="music" tags={['pop', 'synth']} />);
    fireEvent.click(screen.getByRole('button', { name: /remove pop/i }));
    const list = screen.getByTestId('t-tag-list');
    expect(within(list).queryByText('pop')).not.toBeInTheDocument();
    expect(within(list).getByText('synth')).toBeInTheDocument();
  });

  it('de-duplicates, including across spellings of the same word', () => {
    render(<Host topic="music" tags={['new-wave']} />);
    typeTag('New Wave');
    expect(within(screen.getByTestId('t-tag-list')).getAllByText('new-wave')).toHaveLength(1);
  });

  it('refuses a thirteenth and says what the ceiling is', () => {
    const twelve = Array.from({ length: MAX_SET_TAGS }, (_, i) => `tag-${i}`);
    render(<Host topic="music" tags={twelve} />);
    typeTag('one-too-many');
    const list = screen.getByTestId('t-tag-list');
    expect(within(list).queryByText('one-too-many')).not.toBeInTheDocument();
    expect(screen.getByTestId('t-tag-refusal')).toHaveTextContent(String(MAX_SET_TAGS));
  });

  it('adds nothing for a box holding only punctuation', () => {
    render(<Host topic="music" tags={[]} />);
    typeTag('   ---   ');
    expect(screen.getByTestId('t-tag-list').querySelectorAll('li')).toHaveLength(0);
  });

  it('never touches the topic', () => {
    // The two are separate fields on the same row and the shelf is the one the
    // filter is built on. A tag must not be able to move a set off its shelf.
    render(<Host topic="music" />);
    typeTag('history');
    expect(picker()).toHaveValue('music');
  });
});

describe('the words the check proposed beside the shelf', () => {
  const WITH_TAGS = {
    topic: 'music', tags: ['1980s', 'pop'], filedAs: 'music', mismatch: false,
  };

  it('offers each one as its own click', () => {
    render(<Host topic="music" tags={[]} suggestion={WITH_TAGS} />);
    fireEvent.click(screen.getByRole('button', { name: /add tag 1980s/i }));
    expect(within(screen.getByTestId('t-tag-list')).getByText('1980s')).toBeInTheDocument();
  });

  it('stops offering a word once it has been added', () => {
    render(<Host topic="music" tags={['1980s']} suggestion={WITH_TAGS} />);
    expect(screen.queryByRole('button', { name: /add tag 1980s/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add tag pop/i })).toBeInTheDocument();
  });

  it('draws nothing when every word it proposed is already there', () => {
    render(<Host topic="music" tags={['1980s', 'pop']} suggestion={WITH_TAGS} />);
    expect(screen.queryByTestId('t-suggested-tags')).not.toBeInTheDocument();
  });
});
