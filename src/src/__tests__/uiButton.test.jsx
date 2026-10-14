/**
 * Button behaviour — components/ui/Button.jsx (unit L3). The colours are pinned by
 * uiButtonPalette.test.js; this pins the markup a stylesheet and a caller rely on.
 */
import React, { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Button, { BUTTON_VARIANTS, BUTTON_SIZES } from '../components/ui/Button';

describe('Button', () => {
  test('defaults: a quiet, medium <button type="button">', () => {
    render(<Button>Skip</Button>);
    const b = screen.getByRole('button', { name: 'Skip' });
    expect(b.tagName).toBe('BUTTON');
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toBe('ui-btn ui-btn--quiet');
  });

  test.each(BUTTON_VARIANTS)('variant %s carries its class', (variant) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('ui-btn', `ui-btn--${variant}`);
  });

  test('an unknown variant or size falls back instead of rendering an unstyled class', () => {
    render(<Button variant="primary" size="xl">Go</Button>);
    expect(screen.getByRole('button').className).toBe('ui-btn ui-btn--quiet');
  });

  test.each(BUTTON_SIZES.filter((s) => s !== 'md'))('size %s adds its class; md adds none', (size) => {
    render(<Button size={size}>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass(`ui-btn--${size}`);
    expect(screen.getByRole('button').className).not.toMatch(/ui-btn--md/);
  });

  test('className is appended, other props pass through, the ref is forwarded', () => {
    const ref = createRef();
    render(<Button ref={ref} variant="action" className="mine" aria-label="Start" data-x="1">Go</Button>);
    const b = screen.getByRole('button', { name: 'Start' });
    expect(b.className).toBe('ui-btn ui-btn--action mine');
    expect(b).toHaveAttribute('data-x', '1');
    expect(ref.current).toBe(b);
  });

  test('a submit button keeps its type', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  test('disabled <button> is disabled and does not fire', () => {
    const onClick = jest.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('as="a" renders a link with the button classes and no button type', () => {
    render(<Button as="a" href="/help" variant="accent">Read the guide</Button>);
    const a = screen.getByRole('link', { name: 'Read the guide' });
    expect(a).toHaveAttribute('href', '/help');
    expect(a).not.toHaveAttribute('type');
    expect(a).toHaveClass('ui-btn', 'ui-btn--accent');
  });

  test('a disabled link is aria-disabled, out of the tab order and swallows its click', () => {
    const onClick = jest.fn();
    render(<Button as="a" href="/help" disabled onClick={onClick} tabIndex={0}>Help</Button>);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('aria-disabled', 'true');
    expect(a).toHaveAttribute('tabindex', '-1');
    fireEvent.click(a);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('as a component receives the classes and the click', () => {
    const Custom = React.forwardRef((props, ref) => <span ref={ref} role="button" {...props} />);
    const onClick = jest.fn();
    render(<Button as={Custom} onClick={onClick}>Pick</Button>);
    const el = screen.getByRole('button', { name: 'Pick' });
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('ui-btn');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
