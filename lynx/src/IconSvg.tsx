import type { ImageProps } from '@lynx-js/types/element';

/**
 * 图标字符串的渲染边界。
 *
 * 源是完整 SVG（icon() / filledIcon() 已换掉 currentColor）。
 * 原生端注册的是 LynxUISVG，标签名 svg，属性 content，由 ServalSVG 直接画。
 *
 * PNG / JPEG 仍走 <image>。用代码拼出来的 SVG 图（地图路线、建议页弧线）
 * 也走 <image src="data:image/svg+xml">，那是图片，不是这里的图标。
 */
export function IconSvg(props: { content: string; style?: ImageProps['style']; className?: string }) {
  const { content, style, className } = props;
  if (!content) return null as any;
  return <svg content={content} style={style} className={className} />;
}
