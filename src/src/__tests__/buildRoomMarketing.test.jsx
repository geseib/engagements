import React from 'react';
import { render, screen } from '@testing-library/react';
import HomePage from '../marketing/HomePage';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

test('the home page teases the Build Room and sends visitors to its own page', () => {
  render(<HomePage />);
  expect(screen.getByText('New · Build Room')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /let the room guide what claude code builds/i })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /see the build room/i })[0]).toHaveAttribute('href', '/build-room');
});
