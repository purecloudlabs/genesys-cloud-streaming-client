const Path = require('path');

module.exports = {
  entry: './dist/npm/module.js',

  output: {
    filename: 'streaming-client.browser.js',
    library: 'GenesysCloudStreamingClient',
    libraryTarget: 'window',
    libraryExport: 'default',
    path: Path.resolve('dist')
  }
};
