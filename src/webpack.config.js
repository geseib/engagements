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
      // Content-hashed and namespaced under assets/ in production so CloudFront
      // can cache the whole prefix forever: a new build produces new filenames,
      // so there is nothing stale to invalidate. index.html and config.js stay
      // at the root, unhashed and uncached — config.js is rewritten per
      // environment at deploy time. Dev keeps stable names for readable rebuilds.
      filename: isProd ? 'assets/[name].[contenthash:8].js' : '[name].bundle.js',
      chunkFilename: isProd
        ? 'assets/[name].[contenthash:8].chunk.js'
        : '[name].chunk.js',
      publicPath: '/',
      clean: true,
    },

    resolve: { extensions: ['.js', '.jsx'] },

    optimization: {
      // Keep the module id stable across builds so an unrelated change does not
      // invalidate the vendor chunk's hash.
      moduleIds: 'deterministic',
      runtimeChunk: 'single',
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          // React and friends change far less often than app code, so give them
          // their own long-lived chunk. Scoped to `initial` so that dependencies
          // reached only through a dynamic import() (html2pdf) stay in their own
          // lazy chunk instead of being hoisted back into the initial payload.
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendor',
            chunks: 'initial',
            reuseExistingChunk: true,
          },
        },
      },
    },

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

