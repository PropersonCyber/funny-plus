export default {
  source: { entry: { boot: './boot.js' } },
  output: { distPath: { root: 'out-rs' }, cleanDistPath: true, wasmLoading: 'url', assetPrefix: './' },
  html: { template: './index.html' },
  tools: {
    rspack: {
      experiments: { asyncWebAssembly: false, topLevelAwait: true },
      module: {
        // 让 wasm 走资源文件，运行时用 new URL(...) fetch，而不是被当成 wasm 模块解析
        rules: [{ test: /\.wasm$/, type: 'asset/resource', generator: { filename: 'wasm/[name][ext]' } }],
      },
    },
  },
};
