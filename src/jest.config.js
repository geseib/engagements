module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  // was `moduleNameMapping` — not a real Jest option, so CSS imports were
  // never stubbed and every component suite blew up on `import './x.css'`
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(js|jsx)',
    '<rootDir>/src/**/*.(test|spec).(js|jsx)'
  ],
  collectCoverageFrom: [
    'src/**/*.(js|jsx)',
    '!src/index.jsx',
    '!src/setupTests.js'
  ],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/'],
  // d3 (via WavelengthWordCloud) and internmap ship ESM only, so they have to
  // go through babel rather than being skipped with the rest of node_modules.
  transformIgnorePatterns: [
    '/node_modules/(?!(d3|d3-[^/]+|internmap|delaunator|robust-predicates)/)',
  ],
};
