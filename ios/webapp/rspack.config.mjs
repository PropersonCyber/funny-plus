import path from 'node:path';
export default {
  mode: 'production',
  entry: { boot: './boot.js' },
  output: { path: path.resolve('out'), filename: '[name].js', clean: true },
  resolve: {
    extensions: ['.js', '.mjs', '.json', '.css'],
    // ?inline 后缀按字符串导入，交给 asset/source 处理
  },
  module: {
    rules: [
      { test: /\.css\?inline$/, type: 'asset/source' },
      { test: /\.css$/, type: 'asset/source' },
      { test: /\.(wasm|bin)$/, type: 'asset/resource' },
    ],
  },
  experiments: { topLevelAwait: true },
};
