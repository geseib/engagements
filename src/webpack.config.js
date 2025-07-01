// <project>/src/webpack.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    // ---- ENTRY is src/src/index.jsx ----
    entry: path.resolve(__dirname, 'src', 'index.jsx'),

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
      publicPath: '/',
      clean: true,
    },

    resolve: { extensions: ['.js', '.jsx'] },

    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react'],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },

    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'public', 'index.html'),
        filename: 'index.html',
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'public'),
            to: path.resolve(__dirname, 'dist'),
            globOptions: {
              ignore: ['**/index.html'], // Don't copy index.html since HtmlWebpackPlugin handles it
            },
          },
        ],
      }),
    ],

    devServer: {
      static: { directory: path.resolve(__dirname, 'dist') },
      historyApiFallback: true,
      port: 3000,
      open: true,
      proxy: {
        '/games': {
          target: 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com',
          changeOrigin: true,
          secure: true,
        },
        '/questions': {
          target: 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com',
          changeOrigin: true,
          secure: true,
        },
      },
    },

    devtool: isProd ? false : 'source-map',
  };
};

