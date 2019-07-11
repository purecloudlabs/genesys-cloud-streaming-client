const path = require('path');
const webpack = require('webpack');
const WebpackAutoInject = require('webpack-auto-inject-version');

module.exports = (env) => {
  const minimize = env && env.production;
  const node = env && env.node;
  const file = minimize ? 'streaming-client.min' : 'streaming-client';
  const extension = node ? '.cjs' : '.js';
  const filename = file + extension;
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
      library: 'pc-streaming',
      libraryTarget: 'umd'
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
          test: /\.js$/,
          loader: 'babel-loader',
          query: {
            presets: ['env']
          }
        }
      ]
    }
  };
};
