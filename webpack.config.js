const path = require('path');
const webpack = require('webpack');
const WebpackAutoInject = require('webpack-auto-inject-version');

module.exports = (env) => {
  const minimize = env && env.production;
  const node = env && env.node;
  const file = minimize ? 'streaming-client.min' : 'streaming-client';
  const extension = node ? '.cjs' : '.js';
  const filename = file + extension;
  let babelExcludes = [];

  if (node) {
    /* if we are building for 'node', don't polyfill/transpile any dependencies */
    babelExcludes = [/node_modules/];
  } else {
    /*
      this is so babel doesn't try to polyfill/transpile core-js (which is the polyfill)
        and the build tools.
      But we want it polyfill/transpile all other node_modules when building for the web
    */
    babelExcludes = [
      /\bcore-js\b/,
      /\bwebpack\/buildin\b/,
      /\bregenerator-runtime\b/
    ];
  }

  return {
    target: node ? 'node' : 'web',
    entry: './src/client.js',
    mode: minimize ? 'production' : 'development',
    optimization: {
      minimize
    },
    devtool: 'source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename,
      library: 'PureCloudStreamingClient',
      libraryTarget: 'umd',
      libraryExport: 'default'
    },
    plugins: [
      new webpack.DefinePlugin({ 'global.GENTLY': false }),
      new WebpackAutoInject({
        components: {
          AutoIncreaseVersion: false,
          InjectByTag: {
            fileRegex: /\.+/,
            AIVTagRegexp: /(\[AIV])(([a-zA-Z{} ,:;!()_@\-"'\\\/])+)(\[\/AIV])/g // eslint-disable-line
          }
        }
      })
    ],
    module: {
      rules: [
        {
          test: /\.(c|m)?js$/,
          loader: 'babel-loader',
          exclude: babelExcludes
        }
      ]
    }
  };
};
