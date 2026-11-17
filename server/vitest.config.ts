import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

/**
 * vitest 不会自动读 .env，但本目录的库连接全靠 `PG_URL`。
 * 这里补读一次，保证「测试连的库 = dev 连的库」，否则测试会静默跳过真实写入。
 */
function loadDotEnv(): void {
  try {
    const text = readFileSync(new URL('./.env', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    // 没有 .env 就按外部已注入的环境变量走
  }
}
loadDotEnv()

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../shared', import.meta.url)) }
  },
  test: {
    // 连接真库的用例需要时间；串行跑避免同一批测试行互相踩
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000
  }
})
