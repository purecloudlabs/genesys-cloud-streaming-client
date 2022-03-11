const Path = require('path');
const webpack = require('webpack');

const version = require('./package.json').version;
const versionDir = `dist/v${version}`;
const majorVersion = version.split('.')[0];
const majorVersionDir = `dist/v${majorVersion}`;

const browserFilename = 'streaming-client.browser.js';
const ieFilename = 'streaming-client.browser.ie.js'

module.exports = (env = {}) => {
  let babelLoader;
  let entry = './dist/npm/module.js';
  let filename = browserFilename;

  if (env.ie) {
    console.log('Building for IE compatibility');
    filename = ieFilename;

    entry = [
      './node_modules/unorm/lib/unorm.js',
      './node_modules/whatwg-fetch/fetch.js',
      './dist/npm/module.js'
    ];

    babelLoader = {
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
          ['@babel/plugin-proposal-decorators', { decoratorsBeforeExport: true }],
          ['@babel/plugin-proposal-class-properties'],
          ['@babel/transform-runtime']
        ],
        presets: [
          ['@babel/preset-env', {
            corejs: { version: 3 },
            useBuiltIns: 'usage',
            targets: [
              'last 2 versions',
              '> 5%',
              'IE 11',
              'not dead'
            ]
          }]
        ]
      }
    };
  }

  return {
    entry,

    output: {
      filename,
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

module.exports.browserFilename = browserFilename;
module.exports.ieFilename = ieFilename;
module.exports.version = version;
module.exports.versionDir = versionDir;
module.exports.majorVersion = majorVersion;
module.exports.majorVersionDir = majorVersionDir;