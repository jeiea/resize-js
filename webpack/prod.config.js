const path = require('path');

module.exports = {
  entry: path.resolve(__dirname, '../src/resize.ts'),
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        include: path.resolve(__dirname, '../src'),
        exclude: /node_modules/
      }
    ]
  },
  target: 'node',
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ]
  },
  output: {
    filename: 'resize.js',
    path: path.resolve(__dirname, '../')
  }
};
