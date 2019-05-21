const path = require('path');
const webpack = require('webpack');
require('babel-polyfill');

module.exports = (env) => {
  const minimize = env && env.production;
  const node = env && env.node;
  const file = minimize ? 'streaming-client.min' : 'streaming-client';
  const extension = node ? '.cjs' : '.js';
  const filename = file + extension;
  return {
    target: 'web',
    entry: ['babel-polyfill', './src/client.js'],
    mode: minimize ? 'production' : 'development',
    optimization: {
      minimize
    },
    devtool: 'source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename,
      library: 'pc-streaming',
      libraryTarget: node ? 'commonjs' : 'umd'
    },
    plugins: [
      new webpack.DefinePlugin({ 'global.GENTLY': false })
    ],
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: 'babel-loader',
          query: {
            presets: ['@babel/preset-env']
          }
        }
      ]
    }
  };
};
