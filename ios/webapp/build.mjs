import { rspack } from '/Users/maka/code/private/funny-plus/lynx/node_modules/@rspack/core/dist/index.js';
import path from 'node:path';
import fs from 'node:fs';

const config = {
  mode: 'production',
  context: path.resolve('.'),
  entry: { boot: './boot.js' },
  output: { path: path.resolve('out'), filename: '[name].js', clean: true },
  resolve: {
    extensions: ['.js', '.mjs', '.json', '.css'],
    modules: ['/Users/maka/code/private/funny-plus/lynx/node_modules', 'node_modules'],
  },
  module: {
    rules: [
      { test: /\.css\?inline$/, type: 'asset/source' },
      { test: /\.css$/, type: 'asset/source' },
      { test: /\.wasm$/, type: 'webassembly/sync' },
    ],
  },
  experiments: { topLevelAwait: true, syncWebAssembly: true },
};

rspack(config, (err, stats) => {
  if (err || stats.hasErrors()) {
    console.error(err || stats.toString({ errors: true }));
    process.exit(1);
  }
  fs.copyFileSync('../..//lynx/dist/main.web.bundle'.replace('..//..//', '../../'), 'out/main.web.bundle');
  fs.copyFileSync('index.html', 'out/index.html');
  console.log(stats.toString({ assets: true, chunks: false, modules: false }).split('\n').slice(0, 8).join('\n'));
});
