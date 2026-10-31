const path = require('path');
const R = '/home/user/engagements/src/node_modules/';
module.exports = {
  mode: 'development', devtool: false,
  entry: path.resolve(__dirname, 'entry.jsx'),
  output: { path: path.resolve(__dirname, 'dist'), filename: 'bundle.js' },
  resolve: { extensions: ['.js', '.jsx'], modules: [R, 'node_modules'] },
  resolveLoader: { modules: [R] },
  module: { rules: [
    { test: /\.(js|jsx)$/, exclude: /node_modules/, use: { loader: 'babel-loader', options: { presets: [R + '@babel/preset-env', R + '@babel/preset-react'], babelrc: false, configFile: false } } },
    { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    { test: /\.(png|jpe?g|svg|gif)$/, type: 'asset/inline' },
  ] },
  plugins: [new (require(R + 'webpack').DefinePlugin)({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
};
