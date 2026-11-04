import { withLynxConfig } from '@lynx-js/react/testing-library/rstest-config';
import { defineConfig } from '@rstest/core';
import path from 'node:path';

export default defineConfig({
  extends: withLynxConfig(),
  // 与 lynx.config.ts 保持同一份别名：引擎在 shared/，测试要直接跑它
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '../shared') },
  },
});
