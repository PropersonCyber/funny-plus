import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import path from 'node:path';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';
import { pluginSass } from '@rsbuild/plugin-sass';

export default defineConfig({
  // 确定性计算层与类型、数据客户端都在 shared/（纯 TS，不依赖 DOM）
  source: {
    alias: { '@': path.resolve(import.meta.dirname, '../shared') },
    // 后端地址构建期注入：原生端没有 origin，拿不到相对路径；
    // 不注入时为空串 → 走相对路径，由下面的 dev 代理转到 8787
    define: {
      __API_BASE__: JSON.stringify(process.env.PI_API_BASE ?? ''),
    },
  },
  // web 预览与 api 不同端口，/api 代到本地服务端
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  // 同一份代码同时产出原生 bundle 和 web bundle
  environments: {
    web: {},
    lynx: {},
  },
  // 小于 400KB 的图片内联成 data URI 打进 bundle。
  //
  // 原生端一开始全军覆没，曾以为是 SDWebImage 不认 data: scheme —— 实测不是：
  // 真因是 LynxView.setClient: 把 client 同时当成了 imageFetcher，而壳里的
  // controller 没实现 LynxImageFetcher，loader 发现 respondsToSelector 全 NO 就
  // 不加载了。见 ios/FunnyPlus/FunnyPlus/main.m 里 `_lynx.imageFetcher = nil`。
  output: {
    dataUriLimit: { image: 400 * 1024 },
    // CSS Modules 的类名带上所属文件，调试时一眼看出样式在哪个模块
    cssModules: {
      localIdentName: '[path][name]__[local]',
    },
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
        return `${url}?fullscreen=true`;
      },
    }),
    pluginSass(),
    pluginReactLynx(),
    pluginTypeCheck(),
  ],
});
