const path = require('path');

module.exports = (env) => {
  const minimize = env && env.production;
  return {
    entry: './src/client.js',
    mode: minimize ? 'production' : 'development',
    optimization: {
      minimize
    },
    devtool: 'source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: minimize ? 'streaming-client.min.js' : 'streaming-client.js',
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
};
