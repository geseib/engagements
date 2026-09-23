/**
 * The console's New set dialog — components/NewSetDialog.jsx.
 * Behaviour only; jsdom has no layout, so nothing here measures anything.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import NewSetDialog from '../components/NewSetDialog';

const draw = (props = {}) => {
  const onClose = jest.fn();
  const onOpenBuilder = jest.fn();
  render(
    <NewSetDialog
      onClose={onClose}
      onOpenBuilder={onOpenBuilder}
      engagementType="trivia"
      onEngagementTypeChange={() => {}}
      availablePrompts={[]}
      {...props}
    />
  );
  return { onClose, onOpenBuilder };
};

describe('NewSetDialog', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a named dialog and states its title once', () => {
    draw();
    expect(screen.getByRole('dialog', { name: 'New question set' })).toBeInTheDocument();
    // rejects: the panel's own <h3> repeating the dialog's title.
    expect(screen.getAllByText('New question set')).toHaveLength(1);
  });

  it('has an X and a bottom exit, and both close it', () => {
    const { onClose } = draw();
    fireEvent.click(screen.getByTestId('newset-close'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape closes it while nothing would be lost', () => {
    const { onClose } = draw();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding a typed title, and Escape is held', () => {
    const { onClose } = draw();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Offsite trivia' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByTestId('newset-close'));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('newset-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Generate with AI closes this dialog and opens the builder', () => {
    const { onClose, onOpenBuilder } = draw();
    fireEvent.click(screen.getByRole('button', { name: /^AI .* builder/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenBuilder).toHaveBeenCalledWith('trivia');
  });

  /*
    A SURVEY'S FOUR WAYS IN (docs/design/survey-redesign/01-new-survey.html)
    are drawn inside this same dialog, under the same title and sub-line — the
    mockup's own annotation: "This dialog is the shipped NewSetDialog".
  */
  describe('for a survey', () => {
    it('offers the survey routes under the one title', () => {
      draw({ engagementType: 'survey' });
      expect(screen.getByRole('dialog', { name: 'New question set' })).toBeInTheDocument();
      expect(screen.getByText('Your own material')).toBeInTheDocument();
      expect(screen.getByText('A template')).toBeInTheDocument();
      expect(screen.getByText('A file')).toBeInTheDocument();
    });

    it('Your own material hands over to the survey builder — never a modal from a modal', () => {
      // rejects: opening the generator on top of this dialog. It closes first.
      const { onClose, onOpenBuilder } = draw({ engagementType: 'survey' });
      fireEvent.click(screen.getByRole('button', { name: /Write it from my material/i }));
      expect(onClose).toHaveBeenCalled();
      expect(onOpenBuilder).toHaveBeenCalledWith('survey');
      expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onOpenBuilder.mock.invocationCallOrder[0]);
    });
  });
});
