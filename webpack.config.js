const path = require('path');
const webpack = require('webpack');
const WebpackAutoInject = require('webpack-auto-inject-version');

module.exports = (env) => {
  const minimize = env && env.production;
  const cdn = env && env.cdn;

  let filename = 'streaming-client';
  let babelExcludes = [];

  /* if building for the cdn */
  if (cdn) {
    /*
      this is so babel doesn't try to polyfill/transpile core-js (which is the polyfill)
        and the build tools.
      But we want it polyfill/transpile all other node_modules when building for the web
    */
    babelExcludes = [
      /\bcore-js\b/,
      /\bwebpack\/buildin\b/
    ];

    filename += '.bundle';
  } else {
    /* if we are building for 'module', don't polyfill/transpile any dependencies */
    babelExcludes = [/node_modules/];
  }

  filename += minimize ? '.min.js' : '.js';

  return {
    target: 'web',
    entry: './src/client.js',
    mode: minimize ? 'production' : 'development',
    optimization: {
      minimize
    },
    devtool: minimize ? 'source-map' : '',
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
