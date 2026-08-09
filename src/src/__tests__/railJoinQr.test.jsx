import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import Rail from '../components/stage/Rail';

const join = (extra = {}) => ({ code: '4821', url: 'eng.dev/play', ...extra });

describe('the session code as a QR trigger', () => {
  test('with handlers it is focusable and reachable by keyboard', () => {
    // rejects: a mouse-only implementation, which is unusable on a laptop
    // driven by keyboard and invisible to a screen reader
    const onPreview = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(code);
    expect(onPreview).toHaveBeenCalled();
  });

  test('hover previews and leaving dismisses', () => {
    const onPreview = jest.fn();
    const onPreviewEnd = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview, onPreviewEnd, onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    fireEvent.mouseEnter(code);
    expect(onPreview).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(code);
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
  });

  test('clicking pins', () => {
    // rejects: hover-only, which does not exist at all on a touchscreen
    const onPin = jest.fn();
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin })} />
    );
    fireEvent.click(container.querySelector('.rail-join code'));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  test('without handlers the code is inert, not a fake button', () => {
    const { container } = render(<Rail phase="ASK" title="Q3" join={join()} />);
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('tabindex')).toBeNull();
    expect(code.getAttribute('role')).toBeNull();
  });

  test('the code still carries no data-drop', () => {
    // rejects: a wrapper or an attribute that lets the fitter sacrifice the one
    // thing the room needs in order to join. The drop order is title(1),
    // JOIN(2), url(3) -- deliberately asymmetric, and the code is not in it.
    const { container } = render(
      <Rail phase="ASK" title="Q3" join={join({ onPreview: jest.fn(), onPreviewEnd: jest.fn(), onPin: jest.fn() })} />
    );
    const code = container.querySelector('.rail-join code');
    expect(code.getAttribute('data-drop')).toBeNull();
    expect(code.closest('[data-drop]')).toBeNull();
  });

  test('a closed session offers no QR at all', () => {
    // rejects: advertising a way into a session that has ended
    const { container } = render(
      <Rail phase="ENDED" title="Q3" join={join({ closed: true, onPreview: jest.fn() })} />
    );
    expect(container.querySelector('.rail-join code')).toBeNull();
  });
});
