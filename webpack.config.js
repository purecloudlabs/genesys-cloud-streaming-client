const path = require('path');

module.exports = {
  entry: './src/client.js',
  mode: 'production',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'web'),
    filename: 'pc-streaming-client.js',
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
