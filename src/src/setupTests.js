import '@testing-library/jest-dom';

// Mock window.API_BASE and other global variables
global.window.API_BASE = 'http://localhost:3000/api/';
global.window.WS_URL = 'ws://localhost:3001';
global.window.ENV = 'test';

// Mock fetch
global.fetch = jest.fn();

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
  close: jest.fn(),
  send: jest.fn(),
  readyState: 1,
  OPEN: 1,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

// Mock html2pdf
jest.mock('html2pdf.js', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock QRCodeSVG
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }) => `<div data-testid="qr-code" data-value="${value}" data-size="${size}">QR Code</div>`,
}));

// Mock window.location
delete window.location;
window.location = {
  pathname: '/',
  search: '',
  hash: '',
  href: 'http://localhost:3000/',
  origin: 'http://localhost:3000',
  protocol: 'http:',
  host: 'localhost:3000',
  hostname: 'localhost',
  port: '3000',
  assign: jest.fn(),
  replace: jest.fn(),
  reload: jest.fn(),
};
