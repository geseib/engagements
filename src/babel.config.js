// Shared Babel config. webpack.config.js sets these presets inline for the
// build; Jest had no config at all, so every suite failed to parse before it
// ran a single test. Declaring them here makes babel-jest pick them up too.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'classic' }],
  ],
};
