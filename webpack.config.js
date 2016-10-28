const path = require('path');

module.exports = {
  entry: './build/staging/app/app.js',
  output: {
    path: path.resolve(__dirname, 'build', 'app', 'js'),
    publicPath: '/js/',
    filename: 'bundle.js'
  },
  devtool: 'inline-source-map'
};
