import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import path from 'node:path';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

export default defineConfig({
  // 确定性计算层与类型、数据客户端都在 shared/（纯 TS，不依赖 DOM）
  source: {
    alias: { '@': path.resolve(import.meta.dirname, '../shared') },
  },
  // 同一份代码同时产出原生 bundle 和 web bundle
  environments: {
    web: {},
    lynx: {},
  },
  // 原生端 <image src> 不认相对路径的静态资源，直接内联成 data URI
  output: {
    dataUriLimit: { image: 400 * 1024 },
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
        return `${url}?fullscreen=true`;
      },
    }),
    pluginReactLynx(),
    pluginTypeCheck(),
  ],
});
