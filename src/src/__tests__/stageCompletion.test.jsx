import React from 'react';
import { render } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';

describe('the completed state reaches the DOM', () => {
  test('the meter fraction takes the done class when complete', () => {
    // rejects: a `complete` prop that is accepted and ignored
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="8 / 8" complete />
    );
    expect(container.querySelector('.count.done')).not.toBeNull();
    expect(container.querySelector('.meter.is-complete')).not.toBeNull();
  });

  test('and does not when it is not', () => {
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="7 / 8" />
    );
    expect(container.querySelector('.count.done')).toBeNull();
    expect(container.querySelector('.meter.is-complete')).toBeNull();
  });

  test('the dock status takes the go class, which is already styled and was never applied', () => {
    // rejects: leaving `.dock .status.go` dead, which is how it shipped
    const { container } = render(<Dock status="Safe to move on" complete />);
    expect(container.querySelector('.status.go')).not.toBeNull();
  });

  test('the dock status is plain when the room is still working', () => {
    const { container } = render(<Dock status="Some are still answering" />);
    expect(container.querySelector('.status')).not.toBeNull();
    expect(container.querySelector('.status.go')).toBeNull();
  });
});
