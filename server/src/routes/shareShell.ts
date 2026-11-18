import { webAssets } from '../env.ts'

/**
 * 分享页外壳 HTML（F08 后半）。
 *
 * 为什么需要这一层而不是直接把 web bundle 的 index.html 拿来用：分享到微信/WhatsApp 时，
 * 抓取器只读静态 `<head>`、不执行 JS（调研见 e2e-report）。所以标题与封面必须在这里
 * 拼进 og 标签 —— 客户端可以改 `document.title`，但对分享卡片无效，抓取器早已读完 head。
 *
 * 正文仍由 Lynx web bundle 渲染：`<lynx-view>` 读 `global-props` 里的 `__fpShareToken`，
 * 由前端拉 `/api/share/:token`。Lynx 官方没有 SSR（用 IFR + initData 替代），
 * 因此「服务端拼 head」与「客户端渲染 body」是两件互不冲突的事。
 *
 * 失效链接也出这一页：显示引导文案，不带任何原文内容，HTTP 仍是 200。
 */

/** HTML 属性与文本都要转义：标题是用户输入，直接拼进标签会被注入 */
function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type ShellInput = {
  token: string
  title: string
  summary: string
  /** 封面（必须是 remote 地址）；空串则用品牌默认图 */
  coverUrl: string
  valid: boolean
  /** 当前请求的 origin，用来拼 og:url 的绝对地址 */
  origin: string
}

const BRAND = '趣哪玩儿'

export function renderShareShell(input: ShellInput): string {
  const url = `${input.origin}/s/${input.token}`
  // 失效页的标题固定，且不带原文 —— 撤回之后连标题都不该继续露出
  const pageTitle = input.valid ? `${input.title} · ${BRAND}` : `内容已不再公开 · ${BRAND}`
  const desc = input.valid ? input.summary.slice(0, 120) : '这份攻略已被作者撤回，或链接已失效。'
  const cover = input.coverUrl ? esc(input.coverUrl) : ''
  // 资源走绝对前缀：外壳挂在 /s/:token 下，用相对路径浏览器会请求 /s/main.web.bundle
  const assetBase = webAssets.base

  // og:image 缺失时不留空标签：抓取器遇到空 og:image 会显示破图，不如整条不给
  const ogImage = cover
    ? `    <meta property="og:image" content="${cover}" />\n    <meta name="twitter:image" content="${cover}" />\n`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <title>${esc(pageTitle)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:title" content="${esc(pageTitle)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${esc(url)}" />
${ogImage}    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(pageTitle)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <link rel="stylesheet" href="${assetBase}/static/css/client.css" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #f5f8ff; }
      lynx-view { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <lynx-view src="${assetBase}/main.web.bundle" global-props='${esc(
      JSON.stringify({ __fpShareToken: input.token, __fpShareValid: input.valid })
    )}'></lynx-view>
    <script type="module" src="${assetBase}/static/js/client.js"></script>
  </body>
</html>
`
}
