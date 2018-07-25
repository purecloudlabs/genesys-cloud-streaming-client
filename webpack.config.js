const path = require('path');

module.exports = {
  entry: './src/client.js',
  mode: 'development',
  optimization: {
    minimize: !!process.env.MINIMIZE
  },
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'web'),
    filename: process.env.MINIMIZE ? 'pc-streaming-client.min.js' : 'pc-streaming-client.js',
    library: 'pc-streaming',
    libraryTarget: 'umd'
  },
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
