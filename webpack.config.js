const Path = require('path');
const webpack = require('webpack');

const version = require('./package.json').version;
const versionDir = `dist/v${version}`;
const majorVersion = version.split('.')[0];
const majorVersionDir = `dist/v${majorVersion}`;

module.exports = (env = {}) => {
  let babelLoader = {
    test: /\.(cjs|mjs|js)$/,
    loader: 'babel-loader',
    exclude: [
      /@babel\//,
      /\bcore-js\b/,
      /\bwebpack\/buildin\b/
    ],
    options: {
      sourceType: 'unambiguous',
      plugins: [
        ['@babel/plugin-proposal-class-properties'],
        ['@babel/plugin-transform-private-methods']
      ]
    }
  };

  return {
    entry: './dist/npm/module.js',
    output: {
      filename: 'streaming-client.browser.js',
      library: 'GenesysCloudStreamingClient',
      libraryTarget: 'window',
      libraryExport: 'default',
      path: Path.resolve(versionDir)
    },

    module: {
      rules: [
        babelLoader || {}
      ]
    },
    plugins: [
      new webpack.ProvidePlugin({
        process: 'process-fast'
      })
    ]
  };
};

module.exports.version = version;
module.exports.versionDir = versionDir;
module.exports.majorVersion = majorVersion;
module.exports.majorVersionDir = majorVersionDir;
