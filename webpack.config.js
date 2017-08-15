const path = require('path');

module.exports = {
  entry: './src/client.js',
  output: {
    path: path.resolve(__dirname, 'web'),
    filename: 'pc-streaming-client.js',
    library: 'pc-streaming',
    libraryTarget: 'umd'
  },
  module: {
    loaders: [
      {
        test: /\.js$/,
        include: [
          /src/,
          /node_modules\/firehose-webrtc-sessions/
        ],
        loader: 'babel-loader',
        query: {
          presets: ['es2015']
        }
      }
    ]
  }
};
